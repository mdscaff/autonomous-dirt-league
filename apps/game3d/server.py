"""ADRL 3D game server.

Steps the Phase 1 simulator at 60 Hz and streams state to the three.js
client (static/) over a WebSocket; the client renders the driver's-eye
view, dash gauges and engine audio, and sends key/gamepad input back.
The first connected client drives; later clients spectate.

Usage:
    python apps/game3d/server.py            # http://localhost:8000
    python apps/game3d/server.py --port 8000 --ws-port 8765 --mode demo
"""
from __future__ import annotations

import argparse
import asyncio
import functools
import http.server
import json
import math
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
import yaml
from websockets.asyncio.server import broadcast, serve

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from adrl.agents.baseline import BaselineDriver
from adrl.agents.human import HumanInput
from adrl.environment.race_env import DirtOvalEnv
from adrl.vehicle.engine import Engine

FPS = 60

# Game-only "fast" tune: a tacky, heavily banked bullring and a full-aero super late
# model. Applied on top of the research config (which stays untouched) unless --stock.
FAST_TUNE = {
    "track": {"banking_deg": 14.0},
    "surface": {"base_friction": 0.86, "min_friction": 0.55, "max_friction": 1.30},
    "vehicle": {"max_engine_force": 14000.0, "max_brake_force": 15000.0, "downforce_coeff": 4.5, "drag_coeff": 1.0},
}
# AI settings swept headless on this tune: 21 s laps, ~92 mph, no crashes over 19 laps
# as the track dries. Aggression above ~1.0 starts finding the wall.
FAST_AI = {"aggression": 0.96, "v_max": 55.0, "throttle_max": 0.85, "aero_aware": True, "brake_decel": 7.0}
SURFACE_EVERY = 12          # surface grid broadcast cadence (5 Hz)
STATIC = Path(__file__).resolve().parent / "static"


class World:
    def __init__(self, cfg: dict, seed: int, mode: str, ai: dict | None = None, final_drive: float | None = None):
        self.cfg, self.seed = cfg, seed
        self.ai = ai or {}
        self.final_drive = final_drive
        self.title = mode == "title"
        self.autopilot = mode != "play"
        self.ghost_on = mode == "race"
        self.human = HumanInput()
        self.engine, self.ghost_engine = Engine(), Engine()
        if final_drive:
            self.engine.p.final_drive = self.ghost_engine.p.final_drive = final_drive
        self.banner = ("", 0.0)
        self.tick = 0
        self.quit_requested = False
        self.reset()

    def reset(self) -> None:
        self.env = DirtOvalEnv(self.cfg)
        self.env.reset(seed=self.seed)
        self.driver = BaselineDriver(self.env, **self.ai)
        self.ghost_env = DirtOvalEnv(self.cfg)
        self.ghost_env.reset(seed=self.seed)
        self.ghost_driver = BaselineDriver(self.ghost_env, **self.ai)
        self.human.reset()
        self.engine.reset()
        self.ghost_engine.reset()
        self.crashes = 0
        self.best_lap = None
        self.last_lap = None
        self.ghost_last = None
        self.dt = self.env.control_dt

    def respawn(self, env: DirtOvalEnv, why: str) -> None:
        pt, heading, _ = env.track.sample(env.s)
        env.vehicle.reset(float(pt[0]), float(pt[1]), heading, speed=6.0)
        env.s, env.d = env.track.frenet(pt[0], pt[1])
        env.prev_action[:] = 0
        if env is self.env:
            self.human.reset()
            self.driver._i_speed = 0.0
            self.crashes += 1
            self.banner = ("WALL!" if why == "wall_contact" else "SPIN!", 1.5)

    def command(self, cmd: str) -> None:
        if cmd == "start":            # ENTER on the title screen: drive
            self.title = False; self.autopilot = False; self.ghost_on = False; self.reset()
        elif cmd == "watch":          # SPACE: watch the AI
            self.title = False; self.autopilot = True
        elif cmd == "race":           # G on title: race the ghost
            self.title = False; self.autopilot = False; self.ghost_on = True; self.reset()
        elif cmd == "autopilot":
            self.autopilot = not self.autopilot
            self.driver._i_speed = 0.0
            self.human.reset()
        elif cmd == "ghost":
            self.ghost_on = not self.ghost_on
        elif cmd == "reset":
            self.reset()
        elif cmd == "quit":
            self.quit_requested = True

    def step(self, inp: dict) -> None:
        env = self.env
        if self.autopilot:
            action = self.driver.act()
        else:
            action = self.human.update(
                self.dt, env.vehicle.state.speed,
                left=bool(inp.get("left")), right=bool(inp.get("right")),
                gas=bool(inp.get("gas")), brake=bool(inp.get("brake")),
                steer_axis=inp.get("steer"), throttle_axis=inp.get("thr"), brake_axis=inp.get("brk"),
            )
        _, _, term, _, info = env.step(action)
        if "lap_time" in info:
            self.last_lap = info["lap_time"]
            if env.laps >= 2:      # lap 1 is the out-lap from pit exit
                self.best_lap = min(self.best_lap or 1e9, self.last_lap)
        if term:
            self.respawn(env, info.get("termination", ""))
        st = env.vehicle.state
        self.engine.update(st.speed, float(action[1]), st.rear_slip_ratio, self.dt)

        if self.ghost_on:
            g = self.ghost_env
            ga = self.ghost_driver.act()
            _, _, gterm, _, ginfo = g.step(ga)
            if "lap_time" in ginfo:
                self.ghost_last = ginfo["lap_time"]
            if gterm:
                self.respawn(g, ginfo.get("termination", ""))
            gs = g.vehicle.state
            self.ghost_engine.update(gs.speed, float(ga[1]), gs.rear_slip_ratio, self.dt)

        if self.banner[1] > 0:
            self.banner = (self.banner[0], self.banner[1] - self.dt)
        self.tick += 1

    # ------------------------------------------------------------------
    def track_json(self) -> str:
        tr, sf = self.env.track, self.env.surface
        return json.dumps({
            "type": "track",
            "length": tr.length, "width": tr.width, "wall_distance": tr.wall_distance,
            "banking": tr.banking,
            "centerline": np.round(tr.centerline, 3).tolist(),
            "headings": np.round(tr.headings, 5).tolist(),
            "curvatures": np.round(tr.curvatures, 6).tolist(),
            "n_s": sf.n_s, "n_l": sf.n_l,
            "mu_min": sf.cfg.min_friction, "mu_max": sf.cfg.max_friction,
        })

    def surface_bytes(self) -> bytes:
        sf, c = self.env.surface, self.env.surface.cfg
        moist = c.moisture_friction_gain * (1.0 - 4.0 * (sf.moisture - 0.5) ** 2)
        mu = c.base_friction + moist + c.compaction_friction_gain * sf.compaction \
            - c.loose_friction_penalty * sf.loose
        mu01 = (np.clip(mu, c.min_friction, c.max_friction) - c.min_friction) / (c.max_friction - c.min_friction)
        return b"\x01" + np.concatenate([
            (mu01 * 255).astype(np.uint8).ravel(),
            (np.clip(sf.loose, 0, 1) * 255).astype(np.uint8).ravel(),
            (np.clip(sf.moisture, 0, 1) * 255).astype(np.uint8).ravel(),
        ]).tobytes()

    def car_state(self, env: DirtOvalEnv, engine: Engine) -> dict:
        st = env.vehicle.state
        return {
            "x": round(st.x, 4), "y": round(st.y, 4), "yaw": round(st.yaw, 5),
            "s": round(env.s, 3), "d": round(env.d, 3),
            "speed": round(st.speed, 3), "vy": round(st.vy, 3), "yaw_rate": round(st.yaw_rate, 4),
            "steer": round(st.steer, 4), "slip": round(st.slip_angle, 4),
            "spin": round(st.rear_slip_ratio, 3),
            "throttle": round(float(env.prev_action[1]), 3), "brake": round(float(env.prev_action[2]), 3),
            "steer_cmd": round(float(env.prev_action[0]), 3),
            "rpm": round(engine.rpm), "limiter": engine.limiter, "gear": engine.gear,
            "lap": env.laps, "lap_time": round(env.t - env.lap_start_time, 2),
            "mu": round(env.surface.friction(env.s, env.d), 3),
        }

    def state_json(self) -> str:
        env = self.env
        moist = float(env.surface.moisture.mean())
        cond = "TACKY" if moist > 0.48 else ("DRYING" if moist > 0.36 else "SLICK")
        out = {
            "type": "state", "t": round(env.t, 3),
            "car": self.car_state(env, self.engine),
            "ghost": self.car_state(self.ghost_env, self.ghost_engine) if self.ghost_on else None,
            "last": self.last_lap and round(self.last_lap, 2),
            "best": self.best_lap and round(self.best_lap, 2),
            "ghost_last": self.ghost_last and round(self.ghost_last, 2),
            "crashes": self.crashes, "banner": self.banner[0] if self.banner[1] > 0 else "",
            "autopilot": self.autopilot, "ghost_on": self.ghost_on, "title": self.title,
            "condition": cond, "moisture": round(moist, 3),
        }
        if self.ghost_on:
            L = env.track.length
            out["gap"] = round((env.laps * L + env.s) - (self.ghost_env.laps * L + self.ghost_env.s), 1)
        return json.dumps(out)


# ----------------------------------------------------------------------
class Server:
    def __init__(self, world: World):
        self.world = world
        self.clients: set = set()
        self.driver_ws = None
        self.inputs: dict = {}

    async def handler(self, ws):
        self.clients.add(ws)
        if self.driver_ws is None:
            self.driver_ws = ws
        try:
            await ws.send(self.world.track_json())
            await ws.send(self.world.surface_bytes())
            async for msg in ws:
                if isinstance(msg, bytes):
                    continue
                data = json.loads(msg)
                if data.get("type") == "input":
                    self.inputs[ws] = data
                elif data.get("type") == "cmd" and ws is self.driver_ws:
                    self.world.command(str(data.get("cmd", "")))
        finally:
            self.clients.discard(ws)
            self.inputs.pop(ws, None)
            if ws is self.driver_ws:
                self.driver_ws = next(iter(self.clients), None)

    async def loop(self):
        period = 1.0 / FPS
        nxt = time.perf_counter()
        while not self.world.quit_requested:
            inp = self.inputs.get(self.driver_ws, {}) if self.driver_ws else {}
            self.world.step(inp)
            if self.clients:
                broadcast(self.clients, self.world.state_json())
                if self.world.tick % SURFACE_EVERY == 0:
                    broadcast(self.clients, self.world.surface_bytes())
            nxt += period
            delay = nxt - time.perf_counter()
            if delay > 0:
                await asyncio.sleep(delay)
            else:                      # fell behind: resync rather than spiral
                nxt = time.perf_counter()
                await asyncio.sleep(0)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D102
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve_static(port: int) -> None:
    handler = functools.partial(QuietHandler, directory=str(STATIC))
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


def load_config(path: str, fast: bool = True) -> dict:
    cfg = yaml.safe_load(Path(path).read_text())
    if fast:
        for section, values in FAST_TUNE.items():
            cfg[section].update(values)
    cfg["sim"]["control_dt"] = 1.0 / FPS
    cfg["sim"]["dt"] = 1.0 / (2 * FPS)
    cfg["sim"]["max_episode_time"] = 1e9
    return cfg


async def main_async(args) -> None:
    cfg = load_config(args.config if Path(args.config).is_absolute() else str(ROOT / args.config), fast=not args.stock)
    seed = args.seed if args.seed is not None else cfg["seed"]
    world = World(cfg, seed, args.mode, ai=None if args.stock else FAST_AI, final_drive=None if args.stock else 6.0)
    server = Server(world)
    serve_static(args.port)
    async with serve(server.handler, "0.0.0.0", args.ws_port, max_queue=4):
        print(f"ADRL 3D: open http://localhost:{args.port}  (ws {args.ws_port})", flush=True)
        await server.loop()
    print("ADRL 3D: quit requested by the driver", flush=True)
    if args.on_quit:
        subprocess.Popen(args.on_quit, shell=True)   # e.g. close the kiosk browser


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/default.yaml")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--mode", choices=["title", "play", "demo", "race"], default="title")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--ws-port", type=int, default=8765)
    ap.add_argument("--stock", action="store_true", help="use the research config as-is (slower, slicker) instead of the fast game tune")
    ap.add_argument("--on-quit", default="", help="shell command to run when the driver presses ESC")
    args = ap.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
