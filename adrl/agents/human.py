"""Human input shaping shared by the 2D and 3D games.

Turns held keys (or gamepad axes) into smooth continuous actions. Steer
authority shrinks with speed so a held key at 80 mph is a committed corner
entry rather than an instant spin; taps give small inputs.
"""
from __future__ import annotations

import numpy as np


class HumanInput:
    def __init__(self):
        self.steer = 0.0
        self.throttle = 0.0
        self.brake = 0.0

    def reset(self) -> None:
        self.steer = self.throttle = self.brake = 0.0

    @staticmethod
    def authority(speed: float) -> float:
        return float(np.clip(1.0 - (speed - 8.0) / 42.0, 0.35, 1.0))

    def update(
        self,
        dt: float,
        speed: float,
        left: bool = False,
        right: bool = False,
        gas: bool = False,
        brake: bool = False,
        steer_axis: float | None = None,   # -1..1, positive = left
        throttle_axis: float | None = None,
        brake_axis: float | None = None,
    ) -> np.ndarray:
        auth = self.authority(speed)
        if steer_axis is not None and abs(steer_axis) > 0.08:
            target = float(np.clip(steer_axis, -1, 1)) * auth
            rate = 8.0
        else:
            target = (1.0 if left else 0.0) - (1.0 if right else 0.0)
            target *= auth
            rate = 3.0 if abs(target) > abs(self.steer) else 7.0
        self.steer += float(np.clip(target - self.steer, -rate * dt, rate * dt))

        if throttle_axis is not None and throttle_axis > 0.05:
            self.throttle += (throttle_axis - self.throttle) * min(1.0, 10.0 * dt)
        else:
            self.throttle += (3.0 if gas else -6.0) * dt
        if brake_axis is not None and brake_axis > 0.05:
            self.brake += (brake_axis - self.brake) * min(1.0, 10.0 * dt)
        else:
            self.brake += (4.0 if brake else -8.0) * dt
        self.throttle = float(np.clip(self.throttle, 0.0, 1.0))
        self.brake = float(np.clip(self.brake, 0.0, 1.0))
        return np.array([self.steer, self.throttle, self.brake], np.float32)
