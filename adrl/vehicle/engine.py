"""Engine speed model for audio and gauges.

Phase 1 vehicle dynamics are force-based with no drivetrain state, so this
derives a plausible crankshaft speed from wheel speed: a direct-drive dirt
late model in high gear with a quick-change rear end. Wheelspin overspeeds
the engine, launch slips the clutch, and a rev limiter cuts at the top.
Purely presentational - it never feeds back into the physics.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EngineParams:
    idle_rpm: float = 1300.0
    limiter_rpm: float = 8000.0
    max_rpm: float = 8300.0
    final_drive: float = 7.0         # quick-change ratio, high gear
    low_gear: float = 1.7            # 2-speed transmission low ratio multiplier
    shift_up_speed: float = 13.0     # [m/s] driver grabs high gear
    shift_down_speed: float = 6.0
    tire_circumference: float = 2.31  # ~29" dirt tire [m]
    spin_up_tau: float = 0.09         # seconds to close ~63% of the gap on throttle
    spin_down_tau: float = 0.35


class Engine:
    def __init__(self, params: EngineParams | None = None):
        self.p = params or EngineParams()
        self.rpm = self.p.idle_rpm
        self.limiter = False
        self.gear = "LO"
        self._cut_phase = 0.0

    def reset(self) -> None:
        self.rpm = self.p.idle_rpm
        self.limiter = False
        self.gear = "LO"

    def update(self, speed: float, throttle: float, rear_slip: float, dt: float) -> float:
        p = self.p
        if self.gear == "LO" and speed > p.shift_up_speed:
            self.gear = "HI"
        elif self.gear == "HI" and speed < p.shift_down_speed:
            self.gear = "LO"
        ratio = p.final_drive * (p.low_gear if self.gear == "LO" else 1.0)
        wheel_rpm = speed / p.tire_circumference * 60.0
        driven = wheel_rpm * ratio * (1.0 + 0.9 * rear_slip)
        # Below ~6 m/s the clutch slips: throttle raises rpm faster than the wheels.
        launch = max(0.0, 1.0 - speed / 6.0)
        target = max(driven, p.idle_rpm, p.idle_rpm + launch * throttle * 4200.0)
        tau = p.spin_up_tau if target > self.rpm else p.spin_down_tau
        self.rpm += (target - self.rpm) * min(1.0, dt / tau)

        if self.rpm >= p.limiter_rpm:
            # Ignition cut chatter: hold between limiter and limiter-250.
            self._cut_phase += dt * 30.0
            self.limiter = True
            self.rpm = p.limiter_rpm - 250.0 * (self._cut_phase % 1.0)
        else:
            self.limiter = False
        self.rpm = min(self.rpm, p.max_rpm)
        return self.rpm
