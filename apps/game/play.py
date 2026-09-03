"""ADRL playable demo: top-down dirt oval on the Phase 1 physics.

Renders the live Frenet surface grid (you watch the groove rubber in and
the track go slick), lets a human drive the late model from the keyboard
or a gamepad, and can run the baseline controller as an autopilot or as a
ghost car to race against.

Usage:
    python apps/game/play.py                  # fullscreen on the current display
    python apps/game/play.py --windowed       # 1600x900 window
    python apps/game/play.py --mode demo      # skip title screen, AI drives
    python apps/game/play.py --selftest       # headless smoke test, no display

Keys:
    Arrows / WASD   steer, throttle, brake
    TAB             toggle autopilot (baseline driver) on your car
    G               toggle the AI ghost car
    H               cycle surface overlay: grip / moisture / compaction / loose
    R               restart with a fresh surface
    F               toggle fullscreen
    ESC             quit
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path

# No sound in Phase 1; stop SDL stalling on a missing audio device.
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

import numpy as np
import pygame
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from adrl.agents.baseline import BaselineDriver
from adrl.agents.human import HumanInput
from adrl.environment.race_env import DirtOvalEnv

FPS = 60
MPH = 2.23694
SURFACE_REFRESH_FRAMES = 8          # heatmap redraw cadence (~7.5 Hz)
HUD_H = 150
OVERLAYS = ("grip", "moisture", "compaction", "loose")

C_BG = (14, 16, 12)
C_INFIELD = (62, 88, 44)
C_EDGE = (245, 245, 235)
C_WALL = (150, 150, 160)
C_PLAYER = (255, 212, 0)
C_GHOST = (70, 170, 255)
C_TEXT = (240, 240, 235)
C_DIM = (150, 150, 145)
C_SLICK = (222, 200, 158)     # dry, dusty, low grip
C_TACKY = (128, 76, 38)       # moist, rubbered-in, high grip
C_LOOSE = (214, 128, 64)      # loose material (the cushion)
CAR_DRAW_SCALE = 1.6          # sprite enlargement so cars read at full-track zoom


# ----------------------------------------------------------------------
class KeyboardModel:
    """pygame keys/joystick -> HumanInput (shared with the 3D game)."""

    def __init__(self):
        self.model = HumanInput()
        self.joy = None
        if pygame.joystick.get_count() > 0:
            self.joy = pygame.joystick.Joystick(0)
            self.joy.init()

    @property
    def steer(self) -> float:
        return self.model.steer

    def reset(self):
        self.model.reset()

    def update(self, keys, dt: float, speed: float) -> np.ndarray:
        steer_axis = thr_axis = brk_axis = None
        if self.joy is not None:
            steer_axis = -self.joy.get_axis(0)
            # Common layouts: right trigger axis 5, left trigger axis 2 (rest at -1).
            if self.joy.get_numaxes() >= 6:
                thr_axis = (self.joy.get_axis(5) + 1) / 2
                brk_axis = (self.joy.get_axis(2) + 1) / 2
            if self.joy.get_numbuttons() > 1:
                if self.joy.get_button(0):
                    thr_axis = 1.0
                if self.joy.get_button(1):
                    brk_axis = 1.0
        return self.model.update(
            dt, speed,
            left=bool(keys[pygame.K_LEFT] or keys[pygame.K_a]),
            right=bool(keys[pygame.K_RIGHT] or keys[pygame.K_d]),
            gas=bool(keys[pygame.K_UP] or keys[pygame.K_w]),
            brake=bool(keys[pygame.K_DOWN] or keys[pygame.K_s]),
            steer_axis=steer_axis, throttle_axis=thr_axis, brake_axis=brk_axis,
        )


# ----------------------------------------------------------------------
class TrackView:
    """World<->screen transform plus cached geometry for the oval."""

    def __init__(self, env: DirtOvalEnv, size: tuple[int, int]):
        self.env = env
        tr = env.track
        w, h = size
        cl = tr.centerline
        pad = tr.wall_distance + 6.0
        xmin, xmax = cl[:, 0].min() - pad, cl[:, 0].max() + pad
        ymin, ymax = cl[:, 1].min() - pad, cl[:, 1].max() + pad
        avail_h = h - HUD_H
        self.scale = min(w / (xmax - xmin), avail_h / (ymax - ymin))
        self.ox = w / 2 - (xmin + xmax) / 2 * self.scale
        self.oy = avail_h / 2 + (ymin + ymax) / 2 * self.scale

        # Frenet normal (+d) is left of travel, which is the inside of this CCW oval.
        normals = np.stack([-np.sin(tr.headings), np.cos(tr.headings)], axis=1)
        self.inner = self.to_screen_many(cl + normals * tr.half_width)
        self.outer = self.to_screen_many(cl - normals * tr.half_width)
        self.inner_wall = self.to_screen_many(cl + normals * tr.wall_distance)
        self.outer_wall = self.to_screen_many(cl - normals * tr.wall_distance)
        p0, h0, _ = tr.sample(0.0)
        n0 = np.array([-math.sin(h0), math.cos(h0)])
        self.start_line = (
            self.to_screen(*(p0 - n0 * tr.half_width)),
            self.to_screen(*(p0 + n0 * tr.half_width)),
        )

        # Surface cell polygons, in the same (i, j) order as the grid arrays.
        sf = env.surface
        s_edges = np.arange(sf.n_s + 1) * tr.length / sf.n_s
        d_edges = -tr.half_width + np.arange(sf.n_l + 1) * tr.width / sf.n_l
        corners = np.zeros((sf.n_s + 1, sf.n_l + 1, 2))
        for i, s in enumerate(s_edges):
            c, hd, _ = tr.sample(s)
            n = np.array([-math.sin(hd), math.cos(hd)])
            corners[i] = c[None, :] + d_edges[:, None] * n[None, :]
        sc = corners.copy()
        sc[..., 0] = self.ox + corners[..., 0] * self.scale
        sc[..., 1] = self.oy - corners[..., 1] * self.scale
        self.cell_polys = []
        for i in range(sf.n_s):
            for j in range(sf.n_l):
                self.cell_polys.append(
                    [tuple(sc[i, j]), tuple(sc[i + 1, j]), tuple(sc[i + 1, j + 1]), tuple(sc[i, j + 1])]
                )
        self.bg = pygame.Surface((w, avail_h))
        self.overlay = 0

    def to_screen(self, x: float, y: float) -> tuple[float, float]:
        return (self.ox + x * self.scale, self.oy - y * self.scale)

    def to_screen_many(self, pts: np.ndarray) -> list[tuple[float, float]]:
        out = np.empty_like(pts)
        out[:, 0] = self.ox + pts[:, 0] * self.scale
        out[:, 1] = self.oy - pts[:, 1] * self.scale
        return [tuple(p) for p in out]

    # ------------------------------------------------------------------
    def cell_colors(self) -> np.ndarray:
        sf, c = self.env.surface, self.env.surface.cfg
        mode = OVERLAYS[self.overlay]
        if mode == "grip":
            moist = c.moisture_friction_gain * (1.0 - 4.0 * (sf.moisture - 0.5) ** 2)
            mu = c.base_friction + moist + c.compaction_friction_gain * sf.compaction \
                - c.loose_friction_penalty * sf.loose
            mu = np.clip(mu, c.min_friction, c.max_friction)
            t = (mu - c.min_friction) / (c.max_friction - c.min_friction)
            col = np.array(C_SLICK) + (np.array(C_TACKY) - np.array(C_SLICK)) * t[..., None]
            k = np.clip(sf.loose * 1.6, 0, 1)[..., None]
            col = col + (np.array(C_LOOSE) - col) * k * 0.7
        elif mode == "moisture":
            t = np.clip(sf.moisture, 0, 1)[..., None]
            col = np.array((205, 190, 160)) + (np.array((40, 60, 120)) - np.array((205, 190, 160))) * t
        elif mode == "compaction":
            t = np.clip(sf.compaction, 0, 1)[..., None]
            col = np.array((190, 170, 140)) + (np.array((30, 30, 30)) - np.array((190, 170, 140))) * t
        else:
            t = np.clip(sf.loose * 2.0, 0, 1)[..., None]
            col = np.array((90, 70, 50)) + (np.array((240, 150, 70)) - np.array((90, 70, 50))) * t
        return np.clip(col, 0, 255).astype(np.uint8)

    def refresh_background(self) -> None:
        bg = self.bg
        bg.fill(C_BG)
        cols = self.cell_colors().reshape(-1, 3).tolist()
        draw = pygame.draw.polygon
        for poly, col in zip(self.cell_polys, cols):
            draw(bg, col, poly)
        pygame.draw.polygon(bg, C_INFIELD, self.inner_wall)
        pygame.draw.lines(bg, C_WALL, True, self.outer_wall, 4)
        pygame.draw.lines(bg, C_WALL, True, self.inner_wall, 2)
        pygame.draw.lines(bg, C_EDGE, True, self.outer, 1)
        pygame.draw.lines(bg, C_EDGE, True, self.inner, 1)
        a, b = self.start_line
        pygame.draw.line(bg, (255, 255, 255), a, b, 3)
        pygame.draw.line(bg, (20, 20, 20), a, b, 1)


# ----------------------------------------------------------------------
def draw_car(screen, view: TrackView, st, color, ghost: bool = False) -> None:
    L, W = 4.6 * CAR_DRAW_SCALE, 2.0 * CAR_DRAW_SCALE
    c, s = math.cos(st.yaw), math.sin(st.yaw)
    def pt(lx, ly):
        return view.to_screen(st.x + lx * c - ly * s, st.y + lx * s + ly * c)
    body = [pt(L / 2, W / 2), pt(L / 2, -W / 2), pt(-L / 2, -W / 2), pt(-L / 2, W / 2)]
    if ghost:
        xs = [p[0] for p in body]; ys = [p[1] for p in body]
        x0, y0 = int(min(xs)) - 2, int(min(ys)) - 2
        surf = pygame.Surface((int(max(xs)) - x0 + 4, int(max(ys)) - y0 + 4), pygame.SRCALPHA)
        local = [(px - x0, py - y0) for px, py in body]
        pygame.draw.polygon(surf, (*color, 110), local)
        pygame.draw.polygon(surf, (255, 255, 255, 140), local, 1)
        screen.blit(surf, (x0, y0))
        return
    pygame.draw.polygon(screen, color, body)
    pygame.draw.polygon(screen, (20, 20, 20), body, 1)
    # Roof/windshield block toward the nose, spoiler at the tail.
    roof = [pt(L * 0.25, W * 0.35), pt(L * 0.25, -W * 0.35), pt(-L * 0.15, -W * 0.35), pt(-L * 0.15, W * 0.35)]
    pygame.draw.polygon(screen, (30, 30, 30), roof)
    pygame.draw.line(screen, (30, 30, 30), pt(-L / 2, W * 0.55), pt(-L / 2, -W * 0.55), 3)
    # Front wheels show steering angle.
    for side in (1, -1):
        wc, ws = math.cos(st.yaw + st.steer), math.sin(st.yaw + st.steer)
        hx, hy = st.x + (L * 0.32) * c - (side * W * 0.55) * s, st.y + (L * 0.32) * s + (side * W * 0.55) * c
        r = 0.45 * CAR_DRAW_SCALE
        a = view.to_screen(hx + r * wc, hy + r * ws)
        b = view.to_screen(hx - r * wc, hy - r * ws)
        pygame.draw.line(screen, (10, 10, 10), a, b, 4)


class Dust:
    def __init__(self):
        self.p: list[list[float]] = []      # x, y, vx, vy, life

    def emit(self, st, rng: np.random.Generator, intensity: float, cg_to_rear: float):
        n = int(min(6, intensity * 6))
        for _ in range(n):
            rx = st.x - cg_to_rear * math.cos(st.yaw)
            ry = st.y - cg_to_rear * math.sin(st.yaw)
            ang = st.yaw + math.pi + rng.uniform(-0.9, 0.9)
            spd = rng.uniform(2.0, 7.0)
            self.p.append([rx, ry, spd * math.cos(ang), spd * math.sin(ang), rng.uniform(0.5, 1.0)])
        if len(self.p) > 400:
            self.p = self.p[-400:]

    def step(self, dt: float):
        for q in self.p:
            q[0] += q[2] * dt
            q[1] += q[3] * dt
            q[4] -= dt
        self.p = [q for q in self.p if q[4] > 0]

    def draw(self, screen, view: TrackView):
        for x, y, _, _, life in self.p:
            k = max(0.0, min(1.0, life))
            col = (int(120 + 80 * k), int(100 + 70 * k), int(70 + 60 * k))
            pygame.draw.circle(screen, col, view.to_screen(x, y), max(1, int(2 + 4 * (1 - k))))


# ----------------------------------------------------------------------
class Game:
    def __init__(self, cfg: dict, seed: int, size: tuple[int, int], fullscreen: bool, start_mode: str):
        self.cfg = cfg
        self.seed = seed
        self.fullscreen = fullscreen
        flags = pygame.FULLSCREEN if fullscreen else 0
        self.screen = pygame.display.set_mode(size, flags)
        pygame.display.set_caption("ADRL - Autonomous Dirt Racing League")
        self.size = self.screen.get_size()
        self.font = pygame.font.SysFont("dejavusansmono,menlo,consolas,monospace", 22)
        self.font_big = pygame.font.SysFont("dejavusansmono,menlo,consolas,monospace", 54, bold=True)
        self.font_title = pygame.font.SysFont("dejavusans,arial,sans", 72, bold=True)
        self.clock = pygame.time.Clock()
        self.input = KeyboardModel()
        self.rng = np.random.default_rng(0)
        self.dust = Dust()
        self.title = start_mode == "title"
        self.autopilot = start_mode != "play"
        self.ghost_on = start_mode == "race"
        self.frame = 0
        self.banner = ("", 0.0)
        self.fps_smoothed = 0.0
        self.sleep_total = 0.0
        self.crashes = 0
        self.reset_world()

    # ------------------------------------------------------------------
    def reset_world(self):
        self.env = DirtOvalEnv(self.cfg)
        self.env.reset(seed=self.seed)
        self.driver = BaselineDriver(self.env)
        self.ghost_env = DirtOvalEnv(self.cfg)
        self.ghost_env.reset(seed=self.seed)
        self.ghost_driver = BaselineDriver(self.ghost_env)
        self.view = TrackView(self.env, self.size)
        self.view.refresh_background()
        self.input.reset()
        self.dust = Dust()
        self.crashes = 0
        self.best_lap = None
        self.last_lap = None
        self.ghost_last_lap = None
        self.sim_dt = self.env.control_dt

    def respawn(self, env: DirtOvalEnv, why: str):
        pt, heading, _ = env.track.sample(env.s)
        env.vehicle.reset(float(pt[0]), float(pt[1]), heading, speed=6.0)
        env.s, env.d = env.track.frenet(pt[0], pt[1])
        env.prev_action[:] = 0
        if env is self.env:
            self.input.reset()
            self.driver._i_speed = 0.0
            self.crashes += 1
            self.banner = ("WALL!" if why == "wall_contact" else "SPIN!", 1.5)

    # ------------------------------------------------------------------
    def step_sim(self, keys, dt: float):
        env = self.env
        if self.autopilot:
            action = self.driver.act()
        else:
            action = self.input.update(keys, dt, env.vehicle.state.speed)
        _, _, term, _, info = env.step(action)
        if "lap_time" in info:
            self.last_lap = info["lap_time"]
            # Lap 1 starts from pit exit mid-track, so it is an out-lap.
            if env.laps >= 2:
                self.best_lap = min(self.best_lap or 1e9, self.last_lap)
        if term:
            self.respawn(env, info.get("termination", ""))

        st = env.vehicle.state
        slide = max(st.rear_slip_ratio, (abs(math.degrees(st.slip_angle)) - 6.0) / 20.0)
        if slide > 0.05 and st.speed > 4.0:
            self.dust.emit(st, self.rng, slide, env.vehicle_params.cg_to_rear)
        self.dust.step(dt)

        if self.ghost_on:
            g = self.ghost_env
            _, _, gterm, _, ginfo = g.step(self.ghost_driver.act())
            if "lap_time" in ginfo:
                self.ghost_last_lap = ginfo["lap_time"]
            if gterm:
                self.respawn(g, ginfo.get("termination", ""))

    # ------------------------------------------------------------------
    def draw(self):
        scr = self.screen
        env = self.env
        st = env.vehicle.state
        if self.frame % SURFACE_REFRESH_FRAMES == 0:
            self.view.refresh_background()
        scr.blit(self.view.bg, (0, 0))
        self.dust.draw(scr, self.view)
        if self.ghost_on:
            draw_car(scr, self.view, self.ghost_env.vehicle.state, C_GHOST, ghost=True)
        draw_car(scr, self.view, st, C_PLAYER)
        self.draw_hud()
        if self.banner[1] > 0:
            self.center_text(self.banner[0], self.font_big, (255, 80, 60), self.size[1] * 0.42)
        if self.title:
            self.draw_title()

    def text(self, s, x, y, color=C_TEXT, font=None):
        surf = (font or self.font).render(s, True, color)
        self.screen.blit(surf, (x, y))
        return surf.get_width()

    def center_text(self, s, font, color, y):
        surf = font.render(s, True, color)
        self.screen.blit(surf, (self.size[0] / 2 - surf.get_width() / 2, y))

    def bar(self, x, y, w, h, frac, color):
        pygame.draw.rect(self.screen, (40, 40, 40), (x, y, w, h))
        pygame.draw.rect(self.screen, color, (x, y, int(w * max(0.0, min(1.0, frac))), h))
        pygame.draw.rect(self.screen, (90, 90, 90), (x, y, w, h), 1)

    def draw_hud(self):
        env, st = self.env, self.env.vehicle.state
        W, H = self.size
        y0 = H - HUD_H
        pygame.draw.rect(self.screen, (12, 12, 12), (0, y0, W, HUD_H))
        pygame.draw.line(self.screen, (60, 60, 60), (0, y0), (W, y0), 1)

        # Speed block
        w = self.text(f"{st.speed * MPH:3.0f}", 30, y0 + 18, C_PLAYER, self.font_big)
        self.text("MPH", 30 + w + 12, y0 + 44, C_DIM)
        self.text(f"slip {math.degrees(st.slip_angle):+5.1f} deg", 30, y0 + 90, C_TEXT)
        self.text(f"wheelspin {st.rear_slip_ratio * 100:3.0f}%", 30, y0 + 116, C_TEXT)

        # Pedals / steering
        x = 330
        self.text("THR", x, y0 + 20, C_DIM); self.bar(x + 50, y0 + 24, 160, 16, env.prev_action[1], (70, 200, 80))
        self.text("BRK", x, y0 + 48, C_DIM); self.bar(x + 50, y0 + 52, 160, 16, env.prev_action[2], (220, 60, 50))
        self.text("STR", x, y0 + 76, C_DIM)
        pygame.draw.rect(self.screen, (40, 40, 40), (x + 50, y0 + 80, 160, 16))
        cx = x + 50 + 80 - int(80 * env.prev_action[0])
        pygame.draw.rect(self.screen, (230, 230, 230), (cx - 3, y0 + 78, 6, 20))
        self.text("AUTOPILOT" if self.autopilot else "MANUAL", x, y0 + 112,
                  (90, 200, 255) if self.autopilot else C_PLAYER)

        # Laps
        x = 600
        cur = env.t - env.lap_start_time
        self.text(f"LAP {env.laps + 1}", x, y0 + 18, C_TEXT, self.font_big)
        self.text(f"time {cur:6.2f}", x, y0 + 90, C_TEXT)
        self.text(f"last {self.last_lap:6.2f}" if self.last_lap else "last   --.--", x + 160, y0 + 90, C_TEXT)
        self.text(f"best {self.best_lap:6.2f}" if self.best_lap else "best   --.--", x + 160, y0 + 116,
                  (120, 255, 140) if self.best_lap else C_TEXT)
        self.text(f"crashes {self.crashes}", x, y0 + 116, (255, 120, 100) if self.crashes else C_DIM)

        # Surface
        x = 960
        mu_here = env.surface.friction(env.s, env.d)
        moist = float(env.surface.moisture.mean())
        cond = "TACKY" if moist > 0.48 else ("DRYING" if moist > 0.36 else "SLICK")
        ccol = (120, 255, 140) if cond == "TACKY" else ((255, 200, 80) if cond == "DRYING" else (255, 110, 90))
        self.text("TRACK", x, y0 + 20, C_DIM); self.text(cond, x + 80, y0 + 20, ccol)
        self.text(f"grip under car  mu={mu_here:.2f}", x, y0 + 48, C_TEXT)
        self.text(f"moisture {moist:.2f}   overlay: {OVERLAYS[self.view.overlay]}", x, y0 + 76, C_TEXT)
        if self.ghost_on:
            gap = (env.laps * env.track.length + env.s) - (
                self.ghost_env.laps * env.track.length + self.ghost_env.s)
            gl = f"{self.ghost_last_lap:5.2f}" if self.ghost_last_lap else "--.--"
            self.text(f"GHOST lap {self.ghost_env.laps + 1}  last {gl}  gap {gap:+6.1f} m", x, y0 + 112, C_GHOST)

        # Help + fps
        help1 = "ARROWS/WASD drive  TAB autopilot  G ghost  H overlay  R restart  F fullscreen  ESC quit"
        self.text(help1, 20, 8, C_DIM)
        self.text(f"{self.fps_smoothed:4.0f} fps  sim t={env.t:6.1f}s", W - 300, 8, C_DIM)

    def draw_title(self):
        W, H = self.size
        shade = pygame.Surface((W, H - HUD_H), pygame.SRCALPHA)
        shade.fill((0, 0, 0, 120))
        self.screen.blit(shade, (0, 0))
        self.center_text("AUTONOMOUS DIRT RACING LEAGUE", self.font_title, C_PLAYER, H * 0.16)
        self.center_text("Phase 1 simulator  -  3/8 mile dirt oval  -  live surface model", self.font, C_TEXT, H * 0.16 + 90)
        y = H * 0.40
        for line, col in (
            ("ENTER    drive the late model yourself", C_TEXT),
            ("SPACE    watch the baseline AI driver", C_TEXT),
            ("G        race the AI ghost", C_TEXT),
            ("", C_TEXT),
            ("Up = throttle   Down = brake   Left/Right = steer", C_DIM),
            ("Dirt rewards slip: throw it in, catch the slide, feed the throttle.", C_DIM),
            ("Wheelspin tears the surface. Your own line goes slick if you abuse it.", C_DIM),
        ):
            surf = self.font.render(line, True, col)
            if line:
                pad = pygame.Rect(0, 0, surf.get_width() + 24, surf.get_height() + 6)
                pad.center = (W / 2, y + surf.get_height() / 2)
                pygame.draw.rect(self.screen, (0, 0, 0), pad, border_radius=6)
            self.screen.blit(surf, (W / 2 - surf.get_width() / 2, y))
            y += 34

    # ------------------------------------------------------------------
    def handle_key(self, key):
        if key == pygame.K_ESCAPE:
            return False
        if self.title:
            if key == pygame.K_RETURN:
                self.title = False; self.autopilot = False; self.ghost_on = False; self.reset_world()
            elif key == pygame.K_SPACE:
                self.title = False; self.autopilot = True
            elif key == pygame.K_g:
                self.title = False; self.autopilot = False; self.ghost_on = True; self.reset_world()
            return True
        if key == pygame.K_TAB:
            self.autopilot = not self.autopilot
            self.driver._i_speed = 0.0
            self.input.reset()
        elif key == pygame.K_g:
            self.ghost_on = not self.ghost_on
        elif key == pygame.K_h:
            self.view.overlay = (self.view.overlay + 1) % len(OVERLAYS)
            self.view.refresh_background()
        elif key == pygame.K_r:
            self.reset_world()
        elif key == pygame.K_f:
            self.fullscreen = not self.fullscreen
            pygame.display.toggle_fullscreen()
        return True

    def run(self, max_frames: int | None = None):
        running = True
        while running:
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    running = False
                elif ev.type == pygame.KEYDOWN:
                    running = self.handle_key(ev.key)
            keys = pygame.key.get_pressed()
            self.step_sim(keys, self.sim_dt)
            if self.banner[1] > 0:
                self.banner = (self.banner[0], self.banner[1] - self.sim_dt)
            self.draw()
            pygame.display.flip()
            self.frame += 1
            t_sleep = time.perf_counter()
            self.clock.tick(FPS)
            self.sleep_total += time.perf_counter() - t_sleep
            fps = self.clock.get_fps()
            self.fps_smoothed = fps if self.fps_smoothed == 0 else 0.95 * self.fps_smoothed + 0.05 * fps
            if max_frames is not None and self.frame >= max_frames:
                running = False


# ----------------------------------------------------------------------
def load_config(path: str) -> dict:
    cfg = yaml.safe_load(Path(path).read_text())
    # Lock the sim to the display: one control step per frame, two physics
    # substeps each. Episodes never truncate in the game.
    cfg["sim"]["control_dt"] = 1.0 / FPS
    cfg["sim"]["dt"] = 1.0 / (2 * FPS)
    cfg["sim"]["max_episode_time"] = 1e9
    return cfg


def selftest(cfg: dict, seed: int, seconds: float) -> int:
    """Headless: drive with autopilot + ghost, then with a bang-bang keyboard
    emulation of the baseline, and report laps/fps. Exit 1 if it can't lap."""
    os.environ["SDL_VIDEODRIVER"] = "dummy"
    pygame.init()
    game = Game(cfg, seed, (1280, 720), False, "race")
    n = int(seconds * FPS)
    t0 = time.perf_counter()
    game.run(max_frames=n)
    wall = time.perf_counter() - t0
    laps_ai = game.env.laps
    busy = wall - game.sleep_total
    print(f"[selftest] autopilot+ghost: {n} frames in {wall:.1f}s, "
          f"{busy / n * 1000:.1f} ms/frame of work (~{n / busy:.0f} fps possible), "
          f"laps={laps_ai}, crashes={game.crashes}, best={game.best_lap}")

    # Keyboard emulation: press keys toward what the baseline wants.
    game.autopilot = False
    game.ghost_on = False
    game.reset_world()
    ok_laps = 0

    class Keys(dict):
        def __getitem__(self, k):
            return self.get(k, False)

    for _ in range(n):
        want = game.driver.act()
        cur = game.input.steer
        keys = Keys()
        if want[0] > cur + 0.03:
            keys[pygame.K_LEFT] = True
        elif want[0] < cur - 0.03:
            keys[pygame.K_RIGHT] = True
        keys[pygame.K_UP] = bool(want[1] > 0.25)
        keys[pygame.K_DOWN] = bool(want[2] > 0.1)
        game.step_sim(keys, game.sim_dt)
        game.frame += 1
    ok_laps = game.env.laps
    print(f"[selftest] keyboard-emulated: laps={ok_laps}, crashes={game.crashes}, best={game.best_lap}")
    pygame.quit()
    return 0 if laps_ai >= 1 and ok_laps >= 1 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/default.yaml")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--mode", choices=["title", "play", "demo", "race"], default="title")
    ap.add_argument("--windowed", action="store_true")
    ap.add_argument("--size", default="1600x900", help="window size when --windowed")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--selftest-seconds", type=float, default=90.0)
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[2]
    cfg_path = args.config if os.path.isabs(args.config) else str(root / args.config)
    cfg = load_config(cfg_path)
    seed = args.seed if args.seed is not None else cfg["seed"]
    if args.selftest:
        return selftest(cfg, seed, args.selftest_seconds)

    pygame.init()
    if args.windowed:
        w, h = (int(v) for v in args.size.lower().split("x"))
        size, fs = (w, h), False
    else:
        info = pygame.display.Info()
        size, fs = (info.current_w, info.current_h), True
    game = Game(cfg, seed, size, fs, args.mode)
    game.run()
    pygame.quit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
