"""Run the baseline driver for the Phase 1 acceptance test.

Usage:
    python apps/simulator/run_baseline.py --laps 20 --out runs/baseline
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from adrl.agents.baseline import BaselineDriver
from adrl.environment.race_env import DirtOvalEnv
from adrl.telemetry.recorder import ReplayWriter, TelemetryRecorder, verify_replay


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/default.yaml")
    ap.add_argument("--laps", type=int, default=20)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default="runs/baseline")
    ap.add_argument("--verify-replay", action="store_true")
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    seed = args.seed if args.seed is not None else cfg["seed"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    env = DirtOvalEnv(cfg)
    telemetry = TelemetryRecorder()
    env.set_telemetry_hook(telemetry)
    replay_w = ReplayWriter(cfg, seed)

    env.reset(seed=seed)
    driver = BaselineDriver(env)

    t0 = time.perf_counter()
    terminated = truncated = False
    final_info: dict = {}
    while env.laps < args.laps and not (terminated or truncated):
        action = driver.act()
        replay_w.record(action)
        _, _, terminated, truncated, info = env.step(action)
        final_info = info
        if "lap_time" in info:
            mu = env.surface.friction(env.s, 0.0)
            print(f"  lap {env.laps:2d}  {info['lap_time']:6.2f}s   mu@line={mu:.3f}")
    wall = time.perf_counter() - t0

    ok = env.laps >= args.laps and env.wall_contacts == 0 and not terminated
    rtf = env.t / wall if wall > 0 else float("inf")
    laptimes = np.array(env.lap_times)
    print(f"\nlaps={env.laps} wall_contacts={env.wall_contacts} sim_time={env.t:.1f}s "
          f"wall_time={wall:.1f}s realtime_factor={rtf:.1f}x")
    if len(laptimes) > 2:
        print(f"lap time mean={laptimes.mean():.2f}s std={laptimes.std():.2f}s "
              f"best={laptimes.min():.2f}s drift(first->last)={laptimes[-1]-laptimes[0]:+.2f}s")

    telemetry.to_parquet(out / "telemetry.parquet")
    replay_w.save(out / "replay.json")
    print(f"telemetry rows={len(telemetry)} -> {out}/telemetry.parquet")

    if args.verify_replay:
        same = verify_replay(out / "replay.json", DirtOvalEnv, final_info)
        print(f"replay determinism verified: {same}")
        ok = ok and same

    print("PHASE 1 ACCEPTANCE:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
