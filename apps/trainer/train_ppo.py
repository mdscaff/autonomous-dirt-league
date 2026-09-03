"""Stage 1-4 PPO training on DirtOvalEnv.

Runs on the DGX Spark. Requires stable-baselines3 + torch:
    pip install stable-baselines3 torch tensorboard

Curriculum is expressed through the reward config, not code changes:
  Stage 1 (survive):  raise wall/spin penalties, zero slip_tracking
  Stage 2 (fast):     default config
  Stage 3 (slip):     raise slip_tracking
  Stage 4 (adapt):    raise surface.moisture_dry_rate so grip falls off
                      within an episode

Usage:
    python apps/trainer/train_ppo.py --steps 5_000_000 --envs 16
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from adrl.environment.race_env import DirtOvalEnv


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/default.yaml")
    ap.add_argument("--steps", type=int, default=2_000_000)
    ap.add_argument("--envs", type=int, default=8)
    ap.add_argument("--out", default="runs/ppo")
    args = ap.parse_args()

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import SubprocVecEnv, VecMonitor
    except ImportError:
        raise SystemExit("Install RL deps first: pip install stable-baselines3 torch tensorboard")

    cfg = yaml.safe_load(Path(args.config).read_text())

    def make_env(rank: int):
        def _f():
            env = DirtOvalEnv(cfg)
            env.reset(seed=cfg["seed"] + rank)
            return env
        return _f

    venv = VecMonitor(SubprocVecEnv([make_env(i) for i in range(args.envs)]))
    model = PPO(
        "MlpPolicy",
        venv,
        n_steps=1024,
        batch_size=4096,
        learning_rate=3e-4,
        gamma=0.995,
        gae_lambda=0.95,
        ent_coef=0.003,
        tensorboard_log=str(Path(args.out) / "tb"),
        verbose=1,
        device="auto",
    )
    model.learn(total_timesteps=args.steps)
    model.save(str(Path(args.out) / "ppo_dirt_oval"))


if __name__ == "__main__":
    main()
