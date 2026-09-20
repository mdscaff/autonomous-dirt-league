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
    "track": {"banking_deg": 22.0},                                   # Eldora-style high banks
    "surface": {"base_friction": 1.32, "min_friction": 0.90, "max_friction": 1.85},
    "vehicle": {"max_engine_force": 22000.0, "max_brake_force": 25000.0, "downforce_coeff": 9.0, "drag_coeff": 1.0},
}
# AI planner settings. "aggression" is the fraction of the *computed* limit; throttle
# unloads the front axle, so ~0.96 is the real limit and 1.0 understeers into the wall.
# The field's paces below were raced headless: 10 laps, no crashes, ~15.3 s laps.
FAST_AI = {"aggression": 0.917, "v_max": 75.0, "throttle_max": 0.9, "aero_aware": True, "brake_decel": 11.0}
FAST_FINAL_DRIVE = 5.1      # keeps ~135 mph under the 8000 rpm limiter
SURFACE_EVERY = 12          # surface grid broadcast cadence (5 Hz)
STATIC = Path(__file__).resolve().parent / "static"


RACE_LAPS = 10
COUNTDOWN = 4.0
# Steering gains for racing: firmer lane tracking, less slip damping (the research
# defaults sit ~4 m outside their lane at these speeds).
RACE_GAINS = {"k_crosstrack": 1.5, "k_slip": 0.3, "ff_gain": 2.4, "traction_circle": True}
LANE_MIN, LANE_MAX = 0.5, 6.5     # lanes the AI will aim for (+d = inside); entry overshoot uses the rest
# The field, pole first: fictional drivers. "pace" is the fraction of the computed limit.
FIELD = [
    {"name": "Hollis", "num": "7", "livery": "red", "home": 5.0, "pace": 0.931},
    {"name": "Reyes", "num": "24", "livery": "orange", "home": 3.0, "pace": 0.922},
    {"name": "Kowalski", "num": "18", "livery": "yellow", "home": 1.0, "pace": 0.912},
    {"name": "Tanner", "num": "5", "livery": "green", "home": 4.0, "pace": 0.902},
    {"name": "Boudreaux", "num": "44", "livery": "purple", "home": 0.0, "pace": 0.888},
]
PLAYER = {"name": "Moran", "num": "99", "livery": "moran99", "home": 2.0, "pace": 0.917}


class Racer:
    def __init__(self, cfg: dict, seed: int, meta: dict, ai: dict, final_drive: float | None, is_player: bool = False):
        self.meta, self.is_player = meta, is_player
        self.env = DirtOvalEnv(cfg)
        self.env.reset(seed=seed)
        kw = {**ai, **RACE_GAINS}
        if ai:                                   # stock mode keeps the research driver untouched
            kw["aggression"] = meta["pace"]
        else:
            kw = {}
        self.driver = BaselineDriver(self.env, **kw)
        self.driver.line_offset = meta["home"] if ai else 0.0
        self.engine = Engine()
        if final_drive:
            self.engine.p.final_drive = final_drive
        self.progress = 0.0
        self.finish_time: float | None = None
        self.pos = 1

    def place(self, s: float, d: float, speed: float, restart_lap: bool = False) -> None:
        env, tr = self.env, self.env.track
        pt, h, _ = tr.sample(s)
        env.vehicle.reset(float(pt[0] - math.sin(h) * d), float(pt[1] + math.cos(h) * d), h, speed=speed)
        env.s, env.d = s % tr.length, d
        env.prev_action[:] = 0
        if restart_lap:
            env.lap_start_time = env.t
        self.driver._i_speed = 0.0


class World:
    """A race: the player's car plus an AI field, or a solo practice session."""

    def __init__(self, cfg: dict, seed: int, mode: str, ai: dict | None = None, final_drive: float | None = None):
        self.cfg, self.seed = cfg, seed
        self.ai = ai or {}
        self.final_drive = final_drive
        self.title = mode == "title"
        self.autopilot = mode in ("title", "demo")
        self.racing = mode != "play"             # False = solo practice
        self.human = HumanInput()
        self.banner = ("", 0.0)
        self.tick = 0
        self.hit = 0.0
        self.quit_requested = False
        self.reset()

    # The player's env/engine under their old names (HUD, surface stream, tools).
    @property
    def env(self) -> DirtOvalEnv:
        return self.player.env

    @property
    def engine(self) -> Engine:
        return self.player.engine

    def reset(self) -> None:
        self.player = Racer(self.cfg, self.seed, PLAYER, self.ai, self.final_drive, is_player=True)
        self.racers = [self.player]
        L = self.player.env.track.length
        if self.racing:
            for i, meta in enumerate(FIELD):
                self.racers.append(Racer(self.cfg, self.seed + 1 + i, meta, self.ai, self.final_drive))
            grid = self.racers[1:] + [self.player]          # player starts at the back
            for k, r in enumerate(grid):
                # Two-wide on the front straight, just past the line (the line is where the
                # straight begins, so lap 1 is a few car lengths short).
                s0, d0 = 46.0 - (k // 2) * 9.0, (3.0 if k % 2 == 0 else -2.5)
                r.place(s0, d0, 0.0, restart_lap=True)
                r.progress = s0
            # Title/demo have nobody waiting on a countdown.
            self.phase, self.countdown = ("countdown", COUNTDOWN) if not self.title else ("green", 0.0)
        else:
            self.phase, self.countdown = "green", 0.0
        self.race_time = 0.0
        self._rank()
        self.human.reset()
        self.crashes = 0
        self.best_lap = None
        self.last_lap = None
        self.dt = self.env.control_dt

    def respawn(self, r: Racer, why: str) -> None:
        lane = 0.0 if r.is_player else float(np.clip(r.driver.line_offset, LANE_MIN, LANE_MAX))
        r.place(r.env.s, lane, 12.0)
        if r.is_player:
            self.human.reset()
            self.crashes += 1
            self.banner = ("WALL!" if why == "wall_contact" else "SPIN!", 1.5)

    def command(self, cmd: str) -> None:
        if cmd == "start":            # ENTER on the title screen: race the field
            self.title = False; self.autopilot = False; self.racing = True; self.reset()
        elif cmd == "watch":          # SPACE: watch the race from the #99
            self.title = False; self.autopilot = True; self.racing = True; self.reset()
        elif cmd == "race":           # G on the title screen: solo practice
            self.title = False; self.autopilot = False; self.racing = False; self.reset()
        elif cmd == "autopilot":
            self.autopilot = not self.autopilot
            self.player.driver._i_speed = 0.0
            self.human.reset()
        elif cmd == "ghost":          # G in game: field on/off
            self.racing = not self.racing
            self.reset()
        elif cmd == "reset":
            self.reset()
        elif cmd == "quit":
            self.quit_requested = True

    def _rank(self) -> None:
        order = sorted(self.racers, key=lambda r: (r.finish_time is None, r.finish_time or 0.0, -r.progress))
        for k, r in enumerate(order):
            r.pos = k + 1

    # ------------------------------------------------------------------
    def _traffic(self, r: Racer) -> None:
        """Pick a lane and a speed cap for an AI driver from the cars around it."""
        env, tr, drv = r.env, r.env.track, r.driver
        ahead, gap = None, 1e9
        blocked_in = blocked_out = False
        for o in self.racers:
            if o is r:
                continue
            ds = tr.progress_delta(env.s, o.env.s)          # > 0: o is ahead
            dd = o.env.d - env.d                            # > 0: o is inside of me
            if 0.0 < ds < 18.0 and abs(dd) < 2.6 and ds < gap:
                ahead, gap = o, ds
            if abs(ds) < 5.5 and abs(dd) < 4.5:             # alongside: don't chop across them
                blocked_in |= dd > 0
                blocked_out |= dd < 0
        target, drv.v_cap = r.meta["home"], None
        if ahead is not None:
            od = ahead.env.d
            options = [x for x in (od + 3.0, od - 3.0) if LANE_MIN <= x <= LANE_MAX] or [float(np.clip(od + 3.0, LANE_MIN, LANE_MAX))]
            target = min(options, key=lambda x: abs(x - env.d))
            if gap < 9.0 and abs(od - env.d) < 2.1:
                drv.v_cap = ahead.env.vehicle.state.speed + 1.0
        if r.finish_time is not None:
            drv.v_cap = 22.0                                 # cool-down lap
        step = 3.0 * self.dt
        new = drv.line_offset + float(np.clip(target - drv.line_offset, -step, step))
        if (new > drv.line_offset and blocked_in) or (new < drv.line_offset and blocked_out):
            new = drv.line_offset
        drv.line_offset = new

    def _collide(self) -> None:
        """Car-to-car contact: two circles per car, positional push-out plus a normal impulse."""
        R, OFF, REST = 1.0, 1.2, 0.15
        rs = self.racers
        for i in range(len(rs)):
            a = rs[i].env.vehicle.state
            for j in range(i + 1, len(rs)):
                b = rs[j].env.vehicle.state
                if (a.x - b.x) ** 2 + (a.y - b.y) ** 2 > (2 * (R + OFF)) ** 2:
                    continue
                for sa in (-OFF, OFF):
                    for sb in (-OFF, OFF):
                        rax, ray = sa * math.cos(a.yaw), sa * math.sin(a.yaw)
                        rbx, rby = sb * math.cos(b.yaw), sb * math.sin(b.yaw)
                        dx, dy = (a.x + rax) - (b.x + rbx), (a.y + ray) - (b.y + rby)
                        dist = math.hypot(dx, dy)
                        if dist >= 2 * R or dist < 1e-6:
                            continue
                        nx, ny, pen = dx / dist, dy / dist, 2 * R - dist
                        a.x += nx * pen / 2; a.y += ny * pen / 2
                        b.x -= nx * pen / 2; b.y -= ny * pen / 2
                        vax, vay = self._world_vel(a); vbx, vby = self._world_vel(b)
                        vn = (vax - vbx) * nx + (vay - vby) * ny
                        if vn >= 0:
                            continue
                        jimp = -(1 + REST) * vn / 2
                        self._set_world_vel(a, vax + jimp * nx, vay + jimp * ny)
                        self._set_world_vel(b, vbx - jimp * nx, vby - jimp * ny)
                        a.yaw_rate += 0.35 * jimp * (rax * ny - ray * nx)
                        b.yaw_rate -= 0.35 * jimp * (rbx * ny - rby * nx)
                        if rs[i].is_player or rs[j].is_player:
                            self.hit = max(self.hit, min(1.0, jimp / 3.0))

    @staticmethod
    def _world_vel(st) -> tuple[float, float]:
        c, s = math.cos(st.yaw), math.sin(st.yaw)
        return st.vx * c - st.vy * s, st.vx * s + st.vy * c

    @staticmethod
    def _set_world_vel(st, wx: float, wy: float) -> None:
        c, s = math.cos(st.yaw), math.sin(st.yaw)
        st.vx, st.vy = max(wx * c + wy * s, 0.0), -wx * s + wy * c

    # ------------------------------------------------------------------
    def step(self, inp: dict) -> None:
        self.hit *= 0.9
        if self.phase == "countdown":
            self.countdown -= self.dt
            n = math.ceil(self.countdown)
            self.banner = (str(n) if n >= 1 and self.countdown < 3.0 else "", 0.2)
            thr = 1.0 if (inp.get("gas") and not self.autopilot) else 0.0
            for r in self.racers:                           # revving on the grid
                r.engine.update(0.0, thr if r.is_player else 0.35 + 0.3 * math.sin(self.tick * 0.2 + r.meta["home"]), 0.0, self.dt)
            if self.countdown <= 0:
                self.phase, self.banner = "green", ("GREEN!", 1.5)
            self.tick += 1
            return

        self.race_time += self.dt
        L = self.env.track.length
        for r in self.racers:
            env = r.env
            if r.is_player and not self.autopilot:
                action = self.human.update(
                    self.dt, env.vehicle.state.speed,
                    left=bool(inp.get("left")), right=bool(inp.get("right")),
                    gas=bool(inp.get("gas")), brake=bool(inp.get("brake")),
                    steer_axis=inp.get("steer"), throttle_axis=inp.get("thr"), brake_axis=inp.get("brk"),
                )
            else:
                if self.racing and self.ai:
                    self._traffic(r)
                action = r.driver.act()
                if self.ai:
                    v = env.vehicle.state.speed
                    action[1] = min(action[1], 0.22 + 0.022 * v)               # feed it in off the line
                    if env.d < -6.0:                                           # lift as the wall comes up
                        action[1] *= max(0.0, (9.0 + env.d) / 3.0)
            s_before = env.s
            _, _, term, _, info = env.step(action)
            r.progress += env.track.progress_delta(s_before, env.s)
            if r.is_player and "lap_time" in info and info["lap_time"] > 8.0:
                self.last_lap = info["lap_time"]
                if self.racing or env.laps >= 2:             # solo: lap 1 is the out-lap from pit exit
                    self.best_lap = min(self.best_lap or 1e9, self.last_lap)
            if term:
                self.respawn(r, info.get("termination", ""))
            st = env.vehicle.state
            r.engine.update(st.speed, float(action[1]), st.rear_slip_ratio, self.dt)
            if self.racing and r.finish_time is None and r.progress >= RACE_LAPS * L:
                r.finish_time = self.race_time
        if self.racing:
            self._collide()
            self._rank()
            if self.player.finish_time is not None and self.phase != "finished":
                self.phase = "finished"
                self.autopilot = True
                self.banner = (f"FINISHED P{self.player.pos}", 6.0)
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
            "cars": [
                {**self.car_state(r.env, r.engine), "id": i, "num": r.meta["num"], "livery": r.meta["livery"]}
                for i, r in enumerate(self.racers) if not r.is_player
            ],
            "last": self.last_lap and round(self.last_lap, 2),
            "best": self.best_lap and round(self.best_lap, 2),
            "crashes": self.crashes, "banner": self.banner[0] if self.banner[1] > 0 else "",
            "autopilot": self.autopilot, "title": self.title, "hit": round(self.hit, 2),
            "condition": cond, "moisture": round(moist, 3),
        }
        if self.racing:
            L = env.track.length
            order = sorted(self.racers, key=lambda r: r.pos)
            lead = order[0]
            out["race"] = {
                "phase": self.phase, "laps": RACE_LAPS, "pos": self.player.pos, "n": len(self.racers),
                "lap": int(min(max(self.player.progress // L + 1, 1), RACE_LAPS)),
                "time": round(self.race_time, 1),
                "order": [{
                    "num": r.meta["num"], "name": r.meta["name"], "me": r.is_player,
                    "done": r.finish_time is not None,
                    "gap": round(max(lead.progress - r.progress, 0.0) / max(lead.env.vehicle.state.speed, 15.0), 1),
                } for r in order],
            }
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
    world = World(cfg, seed, args.mode, ai=None if args.stock else FAST_AI, final_drive=None if args.stock else FAST_FINAL_DRIVE)
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
