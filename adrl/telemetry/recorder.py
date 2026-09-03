"""Telemetry recorder and replay (Milestones 6 & 7).

Telemetry -> Parquet (columnar, Plotly/Grafana-friendly).
Replay files store (config, seed, action sequence). Because the sim is
fully deterministic, replaying the actions through a fresh env
reproduces the run bit-exactly; verify_replay() proves it.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq


class TelemetryRecorder:
    def __init__(self) -> None:
        self._rows: list[dict[str, Any]] = []

    def __call__(self, sample: dict[str, Any]) -> None:
        self._rows.append(sample)

    def __len__(self) -> int:
        return len(self._rows)

    def to_parquet(self, path: str | Path) -> None:
        if not self._rows:
            return
        cols = {k: [r[k] for r in self._rows] for k in self._rows[0]}
        pq.write_table(pa.table(cols), str(path))


class ReplayWriter:
    def __init__(self, config: dict, seed: int):
        self.header = {"version": 1, "seed": seed, "config": config}
        self.actions: list[list[float]] = []

    def record(self, action: np.ndarray) -> None:
        self.actions.append([float(a) for a in action])

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps({**self.header, "actions": self.actions}))


def replay(path: str | Path, env_factory) -> list[dict]:
    """Re-run a replay file; returns per-step info dicts."""
    data = json.loads(Path(path).read_text())
    env = env_factory(data["config"])
    env.reset(seed=data["seed"])
    infos = []
    for a in data["actions"]:
        _, _, term, trunc, info = env.step(np.array(a, np.float32))
        infos.append(info)
        if term or trunc:
            break
    return infos


def verify_replay(path: str | Path, env_factory, reference_final: dict) -> bool:
    infos = replay(path, env_factory)
    last = infos[-1]
    return (
        abs(last["s"] - reference_final["s"]) < 1e-9
        and abs(last["d"] - reference_final["d"]) < 1e-9
        and last["laps"] == reference_final["laps"]
    )
