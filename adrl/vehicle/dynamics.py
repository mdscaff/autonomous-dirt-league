"""Dirt late model vehicle dynamics.

Phase 1 fidelity target: a dynamic bicycle model (3-DOF planar: x, y, yaw
plus body-frame velocities) with:

  * Pacejka-style lateral tire forces tuned for dirt (low stiffness,
    broad peak at large slip angles — this is what makes sustained
    controlled oversteer possible and rewardable)
  * combined-slip friction ellipse limiting
  * per-axle normal load with longitudinal weight transfer and aero
  * surface-dependent friction sampled per axle from the DirtSurface
  * banking contribution as an effective lateral gravity component

Deliberately NOT modeled yet (Phase 2+): individual wheel spin states,
suspension kinematics, left-side weight offset, drivetrain inertia.
The module boundary (VehicleState in, forces out) is designed so a
higher-fidelity model or Isaac Sim articulation can replace it without
touching the environment or agents.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

G = 9.81


@dataclass
class TireParams:
    B: float = 7.5
    C: float = 1.45
    E: float = -0.6
    peak_slip_angle_deg: float = 12.0
    relaxation_length: float = 0.6


@dataclass
class VehicleParams:
    mass: float = 1050.0
    yaw_inertia: float = 1400.0
    wheelbase: float = 2.31
    cg_to_front: float = 1.27
    cg_height: float = 0.42
    track_width: float = 1.68
    max_steer_deg: float = 22.0
    steer_rate_deg: float = 180.0
    max_engine_force: float = 9500.0
    max_brake_force: float = 12000.0
    drag_coeff: float = 1.05
    downforce_coeff: float = 1.9
    rolling_resistance: float = 0.018
    tire: TireParams = field(default_factory=TireParams)

    @property
    def cg_to_rear(self) -> float:
        return self.wheelbase - self.cg_to_front


@dataclass
class VehicleState:
    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0
    vx: float = 0.0          # body-frame longitudinal velocity
    vy: float = 0.0          # body-frame lateral velocity
    yaw_rate: float = 0.0
    steer: float = 0.0       # actual steering angle [rad]
    rear_slip_ratio: float = 0.0   # proxy for wheelspin [0..1]

    @property
    def speed(self) -> float:
        return float(np.hypot(self.vx, self.vy))

    @property
    def slip_angle(self) -> float:
        """Body slip angle beta [rad]. Positive = tail out to the right of travel."""
        if abs(self.vx) < 0.5:
            return 0.0
        return float(np.arctan2(self.vy, self.vx))


def pacejka(slip_angle: float, mu: float, fz: float, p: TireParams) -> float:
    """Lateral force magnitude from slip angle via magic formula."""
    return mu * fz * np.sin(
        p.C * np.arctan(p.B * slip_angle - p.E * (p.B * slip_angle - np.arctan(p.B * slip_angle)))
    )


class Vehicle:
    def __init__(self, params: VehicleParams):
        self.p = params
        self.state = VehicleState()

    def reset(self, x: float, y: float, yaw: float, speed: float = 0.0) -> None:
        self.state = VehicleState(x=x, y=y, yaw=yaw, vx=speed)

    # ------------------------------------------------------------------
    def step(
        self,
        steer_cmd: float,     # [-1, 1]
        throttle: float,      # [0, 1]
        brake: float,         # [0, 1]
        mu_front: float,
        mu_rear: float,
        banking: float,
        dt: float,
    ) -> None:
        p, st = self.p, self.state

        # Steering actuator with slew limit.
        target = np.clip(steer_cmd, -1, 1) * np.deg2rad(p.max_steer_deg)
        max_delta = np.deg2rad(p.steer_rate_deg) * dt
        st.steer += float(np.clip(target - st.steer, -max_delta, max_delta))

        vx = max(st.vx, 0.1)

        # Slip angles (front includes steer).
        alpha_f = st.steer - np.arctan2(st.vy + p.cg_to_front * st.yaw_rate, vx)
        alpha_r = -np.arctan2(st.vy - p.cg_to_rear * st.yaw_rate, vx)

        # Normal loads: static split + aero + longitudinal transfer.
        speed2 = st.vx**2 + st.vy**2
        downforce = p.downforce_coeff * 0.5 * 1.225 * speed2
        fz_total = p.mass * G * np.cos(banking) + downforce
        ax_est = (p.max_engine_force * throttle - p.max_brake_force * brake) / p.mass
        transfer = p.mass * ax_est * p.cg_height / p.wheelbase
        fz_f = fz_total * (p.cg_to_rear / p.wheelbase) - transfer
        fz_r = fz_total * (p.cg_to_front / p.wheelbase) + transfer
        fz_f, fz_r = max(fz_f, 100.0), max(fz_r, 100.0)

        # Longitudinal forces (rear-drive).
        fx_drive = p.max_engine_force * np.clip(throttle, 0, 1)
        fx_brake = p.max_brake_force * np.clip(brake, 0, 1) * np.sign(vx)
        drag = p.drag_coeff * 0.5 * 1.225 * speed2 * np.sign(st.vx)
        rolling = p.rolling_resistance * fz_total * np.sign(st.vx)

        # Traction-limit rear drive force; overflow becomes wheelspin,
        # which reduces effective mu (dirt: spinning tires dig, not grip).
        fx_rear_cap = mu_rear * fz_r
        wheelspin = max(0.0, (fx_drive - fx_rear_cap) / max(fx_rear_cap, 1.0))
        st.rear_slip_ratio = float(np.clip(wheelspin, 0.0, 1.0))
        fx_drive_eff = min(fx_drive, fx_rear_cap) * (1.0 - 0.25 * st.rear_slip_ratio)

        # Lateral tire forces with friction-ellipse derating on the rear.
        fy_f = pacejka(alpha_f, mu_front, fz_f, p.tire)
        rear_lat_budget = np.sqrt(max(1e-6, 1.0 - (fx_drive_eff / max(fx_rear_cap, 1.0)) ** 2))
        fy_r = pacejka(alpha_r, mu_rear, fz_r, p.tire) * rear_lat_budget

        # Banking: component of gravity pulls the car down-slope (toward
        # the inside for positive banking), aiding cornering.
        # Body +y is the car's left, which is the inside of this counter-clockwise
        # oval, so the down-slope pull is +y.
        f_bank = p.mass * G * np.sin(banking)

        # Equations of motion (body frame).
        ax = (fx_drive_eff - fx_brake - drag - rolling - fy_f * np.sin(st.steer)) / p.mass \
            + st.yaw_rate * st.vy
        ay = (fy_f * np.cos(st.steer) + fy_r + f_bank) / p.mass - st.yaw_rate * st.vx
        r_dot = (p.cg_to_front * fy_f * np.cos(st.steer) - p.cg_to_rear * fy_r) / p.yaw_inertia

        st.vx += ax * dt
        st.vy += ay * dt
        st.yaw_rate += r_dot * dt
        st.vx = max(st.vx, 0.0)  # Phase 1: no reverse gear

        st.yaw += st.yaw_rate * dt
        st.x += (st.vx * np.cos(st.yaw) - st.vy * np.sin(st.yaw)) * dt
        st.y += (st.vx * np.sin(st.yaw) + st.vy * np.cos(st.yaw)) * dt
