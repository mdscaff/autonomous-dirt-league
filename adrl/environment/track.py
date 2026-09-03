"""Procedural dirt oval generator.

Milestone 1. Generates a smooth closed centerline for a two-straight,
two-turn oval, parameterized by arc length. Provides fast conversion
between world (x, y) and track (s, d) Frenet coordinates, which the
surface grid, reward function, and observations all use.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

MILE_M = 1609.344


@dataclass
class Track:
    length: float                      # centerline length [m]
    width: float                       # racing surface width [m]
    wall_margin: float
    centerline: np.ndarray             # (N, 2) world coords
    s_values: np.ndarray               # (N,) arc length of each point
    headings: np.ndarray               # (N,) tangent heading [rad]
    curvatures: np.ndarray             # (N,) signed curvature [1/m]
    banking: float = 0.0               # [rad]
    _kd: object = field(default=None, repr=False)

    @property
    def half_width(self) -> float:
        return self.width / 2.0

    @property
    def wall_distance(self) -> float:
        return self.half_width + self.wall_margin

    # ------------------------------------------------------------------
    def frenet(self, x: float, y: float) -> tuple[float, float]:
        """World (x, y) -> (s, d). d > 0 is left of travel direction."""
        p = np.array([x, y])
        i = int(np.argmin(np.einsum("ij,ij->i", self.centerline - p, self.centerline - p)))
        c = self.centerline[i]
        h = self.headings[i]
        tangent = np.array([np.cos(h), np.sin(h)])
        normal = np.array([-np.sin(h), np.cos(h)])
        delta = p - c
        s = (self.s_values[i] + float(delta @ tangent)) % self.length
        d = float(delta @ normal)
        return s, d

    def sample(self, s: float) -> tuple[np.ndarray, float, float]:
        """(s) -> (centerline point, heading, curvature), s wrapped."""
        s = s % self.length
        i = int(np.searchsorted(self.s_values, s) % len(self.s_values))
        return self.centerline[i], float(self.headings[i]), float(self.curvatures[i])

    def progress_delta(self, s_prev: float, s_now: float) -> float:
        """Signed forward progress handling start/finish wraparound."""
        raw = s_now - s_prev
        if raw > self.length / 2:
            raw -= self.length
        elif raw < -self.length / 2:
            raw += self.length
        return raw


def make_oval(
    length_miles: float = 0.375,
    straight_fraction: float = 0.42,
    width: float = 18.0,
    banking_deg: float = 8.0,
    wall_margin: float = 0.5,
    n_points: int = 800,
    rng: np.random.Generator | None = None,
    roughness: float = 0.0,
) -> Track:
    """Build a stadium oval (two straights + two 180-degree turns).

    ``roughness`` > 0 perturbs the centerline with low-frequency noise so
    every generated track is slightly different (procedural variation).
    """
    total = length_miles * MILE_M
    straight_len = total * straight_fraction / 2.0
    turn_len = (total - 2 * straight_len) / 2.0
    radius = turn_len / np.pi

    s = np.linspace(0.0, total, n_points, endpoint=False)
    pts = np.zeros((n_points, 2))
    headings = np.zeros(n_points)
    curvatures = np.zeros(n_points)

    # Piecewise: straight1, turn1, straight2, turn2. CCW travel.
    b1 = straight_len
    b2 = b1 + turn_len
    b3 = b2 + straight_len
    for k, si in enumerate(s):
        if si < b1:                                  # bottom straight, +x
            pts[k] = [si - straight_len / 2.0, -radius]
            headings[k] = 0.0
        elif si < b2:                                # turn 1 (right end)
            a = (si - b1) / radius
            pts[k] = [
                straight_len / 2.0 + radius * np.sin(a),
                -radius * np.cos(a),
            ]
            headings[k] = a
            curvatures[k] = 1.0 / radius
        elif si < b3:                                # top straight, -x
            pts[k] = [straight_len / 2.0 - (si - b2), radius]
            headings[k] = np.pi
        else:                                        # turn 2 (left end)
            a = (si - b3) / radius
            pts[k] = [
                -straight_len / 2.0 - radius * np.sin(a),
                radius * np.cos(a),
            ]
            headings[k] = np.pi + a
            curvatures[k] = 1.0 / radius

    if roughness > 0.0 and rng is not None:
        # Low-frequency lateral perturbation, closed-loop periodic.
        n_modes = 4
        phase = rng.uniform(0, 2 * np.pi, n_modes)
        amp = rng.uniform(0.2, 1.0, n_modes) * roughness
        wobble = sum(
            a * np.sin(2 * np.pi * (m + 2) * s / total + p)
            for m, (a, p) in enumerate(zip(amp, phase))
        )
        normals = np.stack([-np.sin(headings), np.cos(headings)], axis=1)
        pts = pts + normals * wobble[:, None]
        # Recompute headings/curvature numerically after perturbation.
        d = np.gradient(pts, axis=0)
        headings = np.unwrap(np.arctan2(d[:, 1], d[:, 0]))
        dh = np.gradient(headings)
        ds = np.linalg.norm(d, axis=1)
        curvatures = dh / np.maximum(ds, 1e-9)
        headings = np.mod(headings, 2 * np.pi)

    return Track(
        length=total,
        width=width,
        wall_margin=wall_margin,
        centerline=pts,
        s_values=s,
        headings=headings,
        curvatures=curvatures,
        banking=np.deg2rad(banking_deg),
    )
