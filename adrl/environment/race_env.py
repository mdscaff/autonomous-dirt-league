"""DirtOvalEnv: Gymnasium environment for Phase 1 RL training.

Privileged-state observations per the handover doc. Physics substeps at
sim.dt; the agent acts at sim.control_dt. Deterministic given (config,
seed) — every state mutation flows from the seeded RNG.
"""
from __future__ import annotations

from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from ..vehicle.dynamics import TireParams, Vehicle, VehicleParams
from .dirt_surface import DirtSurface, SurfaceConfig
from .track import Track, make_oval

N_LOOKAHEAD = 8          # curvature preview points
LOOKAHEAD_DS = 12.0      # meters between preview points


class DirtOvalEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, config: dict[str, Any]):
        super().__init__()
        self.cfg = config
        self.dt = config["sim"]["dt"]
        self.control_dt = config["sim"]["control_dt"]
        self.substeps = max(1, int(round(self.control_dt / self.dt)))
        self.max_steps = int(config["sim"]["max_episode_time"] / self.control_dt)

        vp = dict(config["vehicle"])
        tire = TireParams(**{k: v for k, v in vp.pop("tire").items()})
        self.vehicle_params = VehicleParams(**vp, tire=tire)

        # obs: [speed, vy, yaw_rate, steer, slip_angle, rear_slip,
        #       d/half_width, heading_err, local_mu, lap_frac,
        #       curvature preview * N]
        n_obs = 10 + N_LOOKAHEAD
        self.observation_space = spaces.Box(-np.inf, np.inf, (n_obs,), np.float32)
        self.action_space = spaces.Box(
            np.array([-1.0, 0.0, 0.0], np.float32),
            np.array([1.0, 1.0, 1.0], np.float32),
        )

        self.track: Track | None = None
        self.surface: DirtSurface | None = None
        self.vehicle: Vehicle | None = None
        self._telemetry_hook = None

    # ------------------------------------------------------------------
    def set_telemetry_hook(self, fn) -> None:
        """fn(sample: dict) called once per physics substep."""
        self._telemetry_hook = fn

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        tc = self.cfg["track"]
        self.track = make_oval(
            length_miles=tc["length_miles"],
            straight_fraction=tc["straight_fraction"],
            width=tc["width"],
            banking_deg=tc["banking_deg"],
            wall_margin=tc["wall_margin"],
            n_points=tc["n_centerline_points"],
            rng=self.np_random,
            roughness=tc.get("roughness", 0.0),
        )
        sc = SurfaceConfig(**self.cfg["surface"])
        self.surface = DirtSurface(self.track, sc, self.np_random)
        self.vehicle = Vehicle(self.vehicle_params)

        # Start on the back-straight centerline at modest speed ("pit exit").
        start_s = self.track.length * 0.55
        pt, heading, _ = self.track.sample(start_s)
        self.vehicle.reset(pt[0], pt[1], heading, speed=8.0)

        self.s = start_s
        self.d = 0.0
        self.laps = 0
        self.lap_start_time = 0.0
        self.lap_times: list[float] = []
        self.t = 0.0
        self.steps = 0
        self.prev_action = np.zeros(3, np.float32)
        self.wall_contacts = 0
        return self._obs(), {}

    # ------------------------------------------------------------------
    def step(self, action: np.ndarray):
        assert self.track and self.surface and self.vehicle
        steer, throttle, brake = float(action[0]), float(action[1]), float(action[2])
        rc = self.cfg["reward"]
        reward = 0.0
        terminated = truncated = False
        info: dict[str, Any] = {}

        s_prev = self.s
        for _ in range(self.substeps):
            st = self.vehicle.state
            # Sample surface friction under front/rear axles.
            sf, df = self._axle_frenet(+self.vehicle_params.cg_to_front)
            sr, dr = self._axle_frenet(-self.vehicle_params.cg_to_rear)
            mu_f = self.surface.friction(sf, df)
            mu_r = self.surface.friction(sr, dr)
            _, _, kappa = self.track.sample(self.s)
            bank = self.track.banking if abs(kappa) > 1e-4 else 0.0

            self.vehicle.step(steer, throttle, brake, mu_f, mu_r, bank, self.dt)
            self.s, self.d = self.track.frenet(st.x, st.y)

            # Surface interaction: two axle passes per substep.
            self.surface.tire_pass(sf, df, 0.45, abs(st.slip_angle) / 0.5)
            self.surface.tire_pass(sr, dr, 0.55, max(st.rear_slip_ratio, abs(st.slip_angle) / 0.5))
            self.surface.step(self.dt)
            self.t += self.dt

            if self._telemetry_hook is not None:
                self._telemetry_hook(self._telemetry_sample(steer, throttle, brake, mu_f, mu_r))

        st = self.vehicle.state
        progress = self.track.progress_delta(s_prev, self.s)

        # --- reward shaping -------------------------------------------
        reward += rc["progress"] * max(progress, 0.0)
        reward += rc["reverse"] * max(-progress, 0.0)

        _, _, kappa = self.track.sample(self.s)
        in_corner = abs(kappa) > 1e-4
        slip_deg = np.rad2deg(abs(st.slip_angle))
        if in_corner and st.speed > 10.0:
            reward += rc["slip_tracking"] * np.exp(
                -((slip_deg - rc["target_slip_deg"]) / 8.0) ** 2
            )
        reward += rc["wheelspin"] * st.rear_slip_ratio
        reward += rc["smoothness"] * float(np.abs(action - self.prev_action).sum())
        self.prev_action = np.asarray(action, np.float32).copy()

        if abs(self.d) > self.track.half_width:
            reward += rc["off_track"]
        if abs(self.d) > self.track.wall_distance:
            reward += rc["wall_contact"]
            self.wall_contacts += 1
            terminated = True
            info["termination"] = "wall_contact"
        if slip_deg > 60.0 or (in_corner is False and slip_deg > 40.0):
            reward += rc["spin"]
            terminated = True
            info["termination"] = "spin"

        # Lap accounting (start/finish at s=0 crossing).
        if s_prev > self.track.length * 0.9 and self.s < self.track.length * 0.1:
            self.laps += 1
            self.lap_times.append(self.t - self.lap_start_time)
            self.lap_start_time = self.t
            reward += rc["lap_bonus"]
            info["lap_time"] = self.lap_times[-1]

        self.steps += 1
        if self.steps >= self.max_steps:
            truncated = True

        info.update(laps=self.laps, s=self.s, d=self.d, speed=st.speed, t=self.t)
        return self._obs(), float(reward), terminated, truncated, info

    # ------------------------------------------------------------------
    def _axle_frenet(self, offset: float) -> tuple[float, float]:
        st = self.vehicle.state
        ax = st.x + offset * np.cos(st.yaw)
        ay = st.y + offset * np.sin(st.yaw)
        return self.track.frenet(ax, ay)

    def _obs(self) -> np.ndarray:
        st = self.vehicle.state
        _, track_heading, _ = self.track.sample(self.s)
        heading_err = np.arctan2(
            np.sin(st.yaw - track_heading), np.cos(st.yaw - track_heading)
        )
        preview = [
            self.track.sample(self.s + (k + 1) * LOOKAHEAD_DS)[2] * 50.0
            for k in range(N_LOOKAHEAD)
        ]
        return np.array(
            [
                st.speed / 40.0,
                st.vy / 10.0,
                st.yaw_rate,
                st.steer,
                st.slip_angle,
                st.rear_slip_ratio,
                self.d / self.track.half_width,
                heading_err,
                self.surface.friction(self.s, self.d),
                (self.s / self.track.length),
                *preview,
            ],
            np.float32,
        )

    def _telemetry_sample(self, steer, throttle, brake, mu_f, mu_r) -> dict:
        st = self.vehicle.state
        return {
            "t": self.t,
            "x": st.x, "y": st.y, "yaw": st.yaw,
            "vx": st.vx, "vy": st.vy, "yaw_rate": st.yaw_rate,
            "speed": st.speed,
            "steer_cmd": steer, "throttle": throttle, "brake": brake,
            "steer_angle": st.steer,
            "slip_angle": st.slip_angle, "rear_slip": st.rear_slip_ratio,
            "mu_front": mu_f, "mu_rear": mu_r,
            "s": self.s, "d": self.d, "lap": self.laps,
        }
