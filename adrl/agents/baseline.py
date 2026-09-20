"""Baseline classical controller (Milestone 4).

Steering: curvature feedforward + Stanley-style feedback
    delta = ff_gain * atan(L * kappa) - k_h * heading_err - atan(k_d * d / v)
The feedforward gain > 1 compensates the dirt understeer gradient (front
tires operate at large slip angles). Feedback terms regulate heading and
cross-track error toward the centerline groove.

Speed: grip-limited target from upcoming curvature, v = sqrt(a_lat * R)
with banking assist, run at a configurable fraction of the limit.

This is the sanity oracle for the physics and the lap-time floor RL must
beat. It is intentionally conservative; it does not hunt the cushion.
"""
from __future__ import annotations

import numpy as np

from ..environment.race_env import DirtOvalEnv

G = 9.81


class BaselineDriver:
    def __init__(
        self,
        env: DirtOvalEnv,
        aggression: float = 0.78,
        ff_gain: float = 1.6,
        k_heading: float = 0.9,
        k_crosstrack: float = 0.55,
        k_slip: float = 0.8,
        k_yaw_damp: float = 0.12,
        v_max: float = 38.0,
        throttle_max: float = 0.85,
        aero_aware: bool = False,
        brake_decel: float | None = None,
        ff_lookahead: float = 0.35,
        traction_circle: bool = False,
    ):
        self.env = env
        self.aggression = aggression
        self.ff_gain = ff_gain
        self.k_heading = k_heading
        self.k_crosstrack = k_crosstrack
        self.k_slip = k_slip
        self.k_yaw_damp = k_yaw_damp
        self.v_max = v_max
        self.throttle_max = throttle_max
        self.aero_aware = aero_aware   # include downforce in the corner-speed plan
        self.brake_decel = brake_decel # if set, plan braking by distance instead of lifting early
        self.ff_lookahead = ff_lookahead   # seconds of travel to look ahead for turn-in
        self.traction_circle = traction_circle   # only add power as lateral load comes off
        self._i_speed = 0.0
        # Set by a race director (both default to 'not racing anyone'):
        self.line_offset = 0.0         # lateral lane to hold [m], +d = inside
        self.v_cap: float | None = None  # temporary speed cap, e.g. tucked behind a slower car

    def act(self) -> np.ndarray:
        env = self.env
        st = env.vehicle.state
        track = env.track
        p = env.vehicle_params
        v = max(st.speed, 3.0)

        # ---- steering -------------------------------------------------
        # Feedforward on curvature slightly ahead (compensates actuator +
        # tire relaxation lag).
        _, track_heading, _ = track.sample(env.s)
        _, _, kappa_ff = track.sample(env.s + self.ff_lookahead * v)
        heading_err = np.arctan2(
            np.sin(st.yaw - track_heading), np.cos(st.yaw - track_heading)
        )
        # Slip damping (early countersteer) and yaw-rate damping around
        # the kinematic reference keep slides recoverable on slick spots.
        r_ref = v * kappa_ff
        lane_err = env.d - self.line_offset
        delta = (
            self.ff_gain * np.arctan(p.wheelbase * kappa_ff)
            - self.k_heading * heading_err
            - np.arctan(self.k_crosstrack * lane_err / v)
            + self.k_slip * st.slip_angle
            - self.k_yaw_damp * (st.yaw_rate - r_ref)
        )
        steer = float(np.clip(delta / np.deg2rad(p.max_steer_deg), -1, 1))

        # ---- speed ----------------------------------------------------
        horizon = max(3.0 * v, 60.0) if self.brake_decel else max(2.0 * v, 30.0)
        aheads = np.linspace(5.0, horizon, 16 if self.brake_decel else 10)
        kappas = [abs(track.sample(env.s + f)[2]) for f in aheads]
        if self.line_offset:
            # Curvature of the lane actually being driven (tighter inside, wider outside).
            kappas = [k / max(1.0 - k * self.line_offset, 0.3) for k in kappas]
        kappa_max = max(max(kappas), 1e-5)
        # Grip for speed planning = worst mu over the preview horizon near
        # the current line; the surface is dynamic and slick patches ahead
        # must set corner speed, not the grip under the car right now.
        mu = min(
            env.surface.friction(env.s + f, env.d)
            for f in np.linspace(0.0, horizon, 8)
        )
        bank = track.banking
        a_lat = mu * G * np.cos(bank) + G * np.sin(bank)
        def corner_limit(kappa: float) -> float:
            if self.aero_aware:
                # v^2*kappa = mu*(g*cos(b) + k*v^2/m) + g*sin(b)  ->  solve for v
                k_aero = 0.5 * 1.225 * p.downforce_coeff
                denom = kappa - mu * k_aero / p.mass
                return float(np.sqrt(a_lat / denom)) if denom > 1e-4 else self.v_max
            return float(np.sqrt(a_lat / kappa))

        if self.brake_decel:
            # Latest-braking plan: each point ahead allows v = sqrt(v_corner^2 + 2*a*distance).
            v_target = self.v_max
            for f, k in zip(aheads, kappas):
                v_c = self.aggression * corner_limit(max(k, 1e-5))
                v_target = min(v_target, float(np.sqrt(v_c**2 + 2.0 * self.brake_decel * max(f - 8.0, 0.0))))
        else:
            v_target = self.aggression * corner_limit(kappa_max)
        v_target = min(v_target, self.v_max)
        if self.v_cap is not None:
            v_target = min(v_target, self.v_cap)

        dv = v_target - st.speed
        self._i_speed = float(np.clip(self._i_speed + 0.002 * dv, -0.3, 0.3))
        u = 0.30 * dv + self._i_speed
        throttle = float(np.clip(u, 0.0, self.throttle_max))
        if self.traction_circle:
            k_aero = 0.5 * 1.225 * p.downforce_coeff
            a_avail = mu * (G * np.cos(bank) + k_aero * st.speed**2 / p.mass) + G * np.sin(bank)
            used = min(abs(st.speed * st.yaw_rate) / max(a_avail, 1e-3), 1.0)
            throttle = min(throttle, 0.12 + self.throttle_max * float(np.sqrt(1.0 - used**2)))
        # Throttle cut when the slide gets big: stop feeding the spin.
        slip_deg = abs(np.rad2deg(st.slip_angle))
        if slip_deg > 14.0:
            throttle *= max(0.0, 1.0 - (slip_deg - 14.0) / 10.0)
        brake = float(np.clip(-u - 0.2, 0.0, 0.8))
        return np.array([steer, throttle, brake], np.float32)
