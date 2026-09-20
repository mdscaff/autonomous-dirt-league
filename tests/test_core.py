"""Unit tests for Phase 1 physics components and determinism."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adrl.environment.dirt_surface import DirtSurface, SurfaceConfig
from adrl.environment.race_env import DirtOvalEnv
from adrl.environment.track import make_oval
from adrl.vehicle.dynamics import TireParams, Vehicle, VehicleParams, pacejka


@pytest.fixture(scope="module")
def cfg():
    return yaml.safe_load(
        (Path(__file__).resolve().parents[1] / "configs/default.yaml").read_text()
    )


# ---------------------------------------------------------------- track
def test_oval_length_and_closure():
    t = make_oval(length_miles=0.375, n_points=1000)
    assert abs(t.length - 0.375 * 1609.344) < 1e-6
    seg = np.diff(np.vstack([t.centerline, t.centerline[:1]]), axis=0)
    measured = np.linalg.norm(seg, axis=1).sum()
    assert abs(measured - t.length) / t.length < 0.01


def test_frenet_roundtrip():
    t = make_oval()
    for s in [10.0, t.length * 0.3, t.length * 0.7]:
        pt, h, _ = t.sample(s)
        n = np.array([-np.sin(h), np.cos(h)])
        for d in [-4.0, 0.0, 4.0]:
            p = pt + n * d
            s2, d2 = t.frenet(p[0], p[1])
            assert abs(t.progress_delta(s, s2)) < 1.5
            assert abs(d2 - d) < 0.5


def test_progress_wraparound():
    t = make_oval()
    assert t.progress_delta(t.length - 1.0, 1.0) == pytest.approx(2.0)
    assert t.progress_delta(1.0, t.length - 1.0) == pytest.approx(-2.0)


# -------------------------------------------------------------- surface
def test_surface_evolves_with_tire_passes():
    t = make_oval()
    surf = DirtSurface(t, SurfaceConfig(), np.random.default_rng(0))
    mu0 = surf.friction(100.0, 0.0)
    for _ in range(40):
        surf.tire_pass(100.0, 0.0, load_frac=1.0, slip=0.0)
    mu_packed = surf.friction(100.0, 0.0)
    assert mu_packed != mu0  # groove changes with passes
    st = surf.state_at(100.0, 0.0)
    assert st["compaction"] > 0.5


def test_surface_dries_globally():
    t = make_oval()
    cfg = SurfaceConfig(moisture_dry_rate=0.01)
    surf = DirtSurface(t, cfg, np.random.default_rng(0))
    m0 = surf.moisture.mean()
    for _ in range(1000):
        surf.step(0.1)
    assert surf.moisture.mean() < m0


def test_friction_bounds():
    t = make_oval()
    c = SurfaceConfig()
    surf = DirtSurface(t, c, np.random.default_rng(3))
    for s in np.linspace(0, t.length, 50):
        for d in np.linspace(-8, 8, 9):
            mu = surf.friction(s, d)
            assert c.min_friction <= mu <= c.max_friction


# ------------------------------------------------------------- dynamics
def test_pacejka_peak_and_sign():
    p = TireParams()
    assert pacejka(0.1, 0.6, 5000, p) > 0
    assert pacejka(-0.1, 0.6, 5000, p) < 0
    assert abs(pacejka(0.2, 0.6, 5000, p)) <= 0.6 * 5000 * 1.01


def test_vehicle_accelerates_straight():
    v = Vehicle(VehicleParams())
    v.reset(0, 0, 0, speed=5.0)
    for _ in range(500):
        v.step(0.0, 0.6, 0.0, 0.6, 0.6, 0.0, 0.01)
    # traction-limited on dirt (mu*Fz caps drive force) -> modest accel
    assert v.state.vx > 15.0
    assert abs(v.state.y) < 1.0


def test_vehicle_turns_with_steer():
    v = Vehicle(VehicleParams())
    v.reset(0, 0, 0, speed=15.0)
    for _ in range(200):
        v.step(0.5, 0.3, 0.0, 0.6, 0.6, 0.0, 0.01)
    assert v.state.yaw > 0.15


def test_low_grip_reduces_cornering():
    """Low mu -> less lateral path displacement and larger slip angle
    (the car slides rather than turns). Yaw alone is misleading because a
    spin also produces yaw."""

    def after(mu: float):
        v = Vehicle(VehicleParams())
        v.reset(0, 0, 0, speed=20.0)
        for _ in range(150):
            v.step(0.5, 0.2, 0.0, mu, mu, 0.0, 0.01)
        return v.state.y, abs(v.state.slip_angle)

    y_hi, slip_hi = after(0.7)
    y_lo, slip_lo = after(0.35)
    assert y_hi > y_lo
    assert slip_lo > slip_hi


# ------------------------------------------------------------------ env
def test_env_api_and_determinism(cfg):
    def rollout():
        env = DirtOvalEnv(cfg)
        obs, _ = env.reset(seed=123)
        traj = [obs]
        rng = np.random.default_rng(7)
        for _ in range(100):
            a = rng.uniform([-0.3, 0.2, 0.0], [0.3, 0.6, 0.0]).astype(np.float32)
            obs, r, term, trunc, _ = env.step(a)
            traj.append(obs)
            if term or trunc:
                break
        return np.vstack(traj)

    t1, t2 = rollout(), rollout()
    assert t1.shape == t2.shape
    assert np.array_equal(t1, t2), "environment is not deterministic"


def test_env_wall_termination(cfg):
    env = DirtOvalEnv(cfg)
    env.reset(seed=5)
    terminated = False
    for _ in range(2000):
        _, _, terminated, trunc, info = env.step(np.array([1.0, 1.0, 0.0], np.float32))
        if terminated or trunc:
            break
    assert terminated
    assert info.get("termination") in {"wall_contact", "spin"}


def test_banking_pulls_toward_the_inside():
    """On the CCW oval the inside is the car's left (+y): banking must push vy positive."""
    from adrl.vehicle.dynamics import Vehicle, VehicleParams
    import numpy as np
    flat, banked = Vehicle(VehicleParams()), Vehicle(VehicleParams())
    for v in (flat, banked):
        v.reset(0.0, 0.0, 0.0, speed=20.0)
    for _ in range(20):
        flat.step(0.0, 0.0, 0.0, 0.7, 0.7, 0.0, 0.01)
        banked.step(0.0, 0.0, 0.0, 0.7, 0.7, np.deg2rad(10.0), 0.01)
    assert banked.state.y > flat.state.y + 1e-3
