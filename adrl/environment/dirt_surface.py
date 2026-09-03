"""Dynamic dirt surface model.

The surface is a Frenet-frame grid over the racing surface: rows indexed
by arc length s, columns by lateral offset d. Each cell tracks friction
inputs (moisture, compaction, loose material, temperature) and derives an
effective friction coefficient from them.

Every tire pass mutates the cells under the contact patch:
  * compaction increases (rubbering-in / packing the groove)
  * loose material is displaced outward toward the cushion
  * moisture is worked out of the surface locally
Global drying slowly lowers moisture everywhere, so the track transitions
tacky -> slick over a run, and the fast groove migrates. This is the
mechanism that forces the agent to adapt (success criterion 4).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .track import Track


@dataclass
class SurfaceConfig:
    grid_ds: float = 2.0
    grid_dl: float = 1.5
    base_friction: float = 0.52
    min_friction: float = 0.30
    max_friction: float = 0.75
    base_moisture: float = 0.55
    moisture_dry_rate: float = 8e-5
    compaction_per_pass: float = 0.035
    loose_per_pass: float = 0.02
    loose_settle_rate: float = 5e-4
    cushion_lateral_frac: float = 0.75
    moisture_friction_gain: float = 0.18
    compaction_friction_gain: float = 0.10
    loose_friction_penalty: float = 0.30


class DirtSurface:
    def __init__(self, track: Track, cfg: SurfaceConfig, rng: np.random.Generator):
        self.track = track
        self.cfg = cfg
        self.n_s = max(8, int(round(track.length / cfg.grid_ds)))
        self.n_l = max(4, int(round(track.width / cfg.grid_dl)))
        shape = (self.n_s, self.n_l)

        noise = rng.normal(0.0, 0.03, shape)
        self.moisture = np.clip(cfg.base_moisture + noise, 0.0, 1.0)
        self.compaction = np.clip(rng.normal(0.35, 0.05, shape), 0.0, 1.0)
        self.loose = np.clip(rng.normal(0.15, 0.04, shape), 0.0, 1.0)
        self.temperature = np.full(shape, 25.0)

    # ------------------------------------------------------------------
    def _cell(self, s: float, d: float) -> tuple[int, int]:
        i = int((s % self.track.length) / self.track.length * self.n_s) % self.n_s
        frac = (d + self.track.half_width) / self.track.width
        j = int(np.clip(frac * self.n_l, 0, self.n_l - 1))
        return i, j

    def friction(self, s: float, d: float) -> float:
        """Effective mu at a point on the surface."""
        i, j = self._cell(s, d)
        c = self.cfg
        # Moisture: peak grip near 0.5 (tacky), drops when muddy or dusty.
        moist_term = c.moisture_friction_gain * (
            1.0 - 4.0 * (self.moisture[i, j] - 0.5) ** 2
        )
        comp_term = c.compaction_friction_gain * self.compaction[i, j]
        loose_term = -c.loose_friction_penalty * self.loose[i, j]
        mu = c.base_friction + moist_term + comp_term + loose_term
        return float(np.clip(mu, c.min_friction, c.max_friction))

    def state_at(self, s: float, d: float) -> dict[str, float]:
        i, j = self._cell(s, d)
        return {
            "friction": self.friction(s, d),
            "moisture": float(self.moisture[i, j]),
            "compaction": float(self.compaction[i, j]),
            "loose": float(self.loose[i, j]),
            "temperature": float(self.temperature[i, j]),
        }

    # ------------------------------------------------------------------
    def tire_pass(self, s: float, d: float, load_frac: float = 1.0, slip: float = 0.0) -> None:
        """Apply one tire pass at (s, d).

        ``slip`` in [0, 1]: high wheelspin/slide tears the surface, adding
        loose material instead of packing it.
        """
        i, j = self._cell(s, d)
        c = self.cfg
        pack = c.compaction_per_pass * load_frac * (1.0 - 0.7 * slip)
        tear = c.loose_per_pass * load_frac * (0.3 + 1.5 * slip)

        self.compaction[i, j] = min(1.0, self.compaction[i, j] + max(pack, 0.0))
        self.moisture[i, j] = max(0.0, self.moisture[i, j] - 0.002 * load_frac)

        # Displace loose material one cell toward the cushion (outside).
        cushion_j = int(c.cushion_lateral_frac * (self.n_l - 1))
        step = int(np.sign(cushion_j - j)) if cushion_j != j else 0
        moved = min(self.loose[i, j], tear * 0.6)
        self.loose[i, j] = np.clip(self.loose[i, j] + tear - moved, 0.0, 1.0)
        if step != 0:
            self.loose[i, j + step] = min(1.0, self.loose[i, j + step] + moved)

    def step(self, dt: float) -> None:
        """Global surface evolution (drying, settling)."""
        c = self.cfg
        self.moisture -= c.moisture_dry_rate * dt * (0.5 + self.temperature / 50.0)
        np.clip(self.moisture, 0.0, 1.0, out=self.moisture)
        self.loose -= c.loose_settle_rate * dt
        np.clip(self.loose, 0.0, 1.0, out=self.loose)
