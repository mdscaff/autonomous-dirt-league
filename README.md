# Autonomous Dirt Racing League — Phase 1 Simulator

Headless physics + RL environment for a single autonomous dirt late model on a
procedural 3/8-mile dirt oval. This is the research core described in the
Phase 1 handover (docs/HANDOVER.md); Isaac Sim rendering is Milestone 8 and
bolts on later without touching anything here.

## Status

Phase 1 acceptance **passes** with the classical baseline driver:

```
laps=20  wall_contacts=0  realtime_factor≈32x (single core)
lap times drift 34.6s → 40.2s as the surface dries — adaptation is required
replay determinism verified: True
```

## Quickstart

```bash
pip install -r requirements.txt
python -m pytest tests/ -q                       # 12 physics/determinism tests
python apps/simulator/run_baseline.py --laps 20 --verify-replay
```

### Playable demo

`apps/game/play.py` is a pygame front end on the Phase 1 physics: top-down
oval with the live surface grid drawn as a grip heatmap, keyboard/gamepad
driving, the baseline controller as autopilot, and an AI ghost to race.

```bash
python apps/game/play.py               # fullscreen; --windowed for a window
python apps/game/play.py --mode demo   # AI drives immediately
python apps/game/play.py --selftest    # headless smoke test, no display needed
```

Title screen: **ENTER** drive · **SPACE** watch the AI · **G** race the ghost.
In game: arrows/WASD drive · **TAB** autopilot · **G** ghost · **H** cycle
overlay (grip / moisture / compaction / loose) · **R** fresh surface ·
**F** fullscreen · **ESC** quit.

### 3D driver's-eye demo

`apps/game3d/` is the 3D version: `server.py` steps the same physics at 60 Hz
and streams state over a WebSocket; the three.js client (`static/`, vendored,
no internet needed) renders a dusk dirt oval under the lights with a
procedural #99 blue-and-white late model, driver's-eye / chase / infield TV
cameras, a working dash (tach with shift lights, water, oil, fuel, volts,
lap readout), procedural V8 engine + tire + wind audio via Web Audio, roost
particles, and the live surface grid as a dirt heatmap on the track mesh.
Engine speed comes from `adrl/vehicle/engine.py` (2-speed, quick-change
final drive, wheelspin overspeed, rev limiter) and is presentational only.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
./play3d.sh                             # server + opens http://localhost:8000
.venv/bin/python apps/game3d/server.py --mode demo --port 8420
```

The 3D game runs a **fast tune** on top of the research config (tacky surface,
22° banking, more downforce and power; AI plans with downforce and braking
distance): about 15 s laps and ~125 mph versus 35 s and 65 mph stock. Pass
`--stock` to `server.py` for the unmodified research physics. `configs/default.yaml`
is never changed by the game.

**Racing:** a 10-lap race against five AI cars (fictional drivers, each with
their own livery, home lane and pace). Two-wide standing start with a
countdown, you start 6th. The AI holds lanes, pulls out to pass, tucks in
behind slower cars and won't chop across a car alongside; car-to-car contact
is modelled (push-out plus impulse). Live positions, gaps and a finish result.

Title: **ENTER** race the field · **SPACE** ride along in the race · **G** solo practice.
In game: arrows/WASD or a gamepad · **1/2/3** cameras · **TAB** autopilot ·
**G** field on/off · **R** restart · **M** mute · **F** fullscreen · **ESC** quit
(on the DGX kiosk this also closes the browser). The first browser to
connect drives; others spectate.

### DGX Spark

```bash
./deploy_to_dgx.sh          # rsync + venv + tests + acceptance run on AgentForgeDGX.local
./play_on_dgx.sh            # 2D game on the DGX's own monitor
./play3d_on_dgx.sh          # 3D game: sim server + Firefox kiosk on the DGX monitor
./play3d_on_dgx.sh AgentForgeDGX.local stop   # or press ESC in the game
```

RL training (Stages 1–4, needs torch + SB3):

```bash
pip install stable-baselines3 torch tensorboard
python apps/trainer/train_ppo.py --steps 5_000_000 --envs 16
tensorboard --logdir runs/ppo/tb
```

## What's implemented (Milestones 1–7)

| Milestone | Module | Notes |
|---|---|---|
| 1 Procedural oval | `adrl/environment/track.py` | Frenet-frame stadium oval, optional procedural roughness, exact arc-length parameterization |
| 2 Vehicle dynamics | `adrl/vehicle/dynamics.py` | 3-DOF dynamic bicycle, dirt-tuned Pacejka (broad peak @ ~14° slip), friction ellipse, weight transfer, aero, banking, wheelspin → surface tearing |
| 3 Dynamic dirt surface | `adrl/environment/dirt_surface.py` | Per-cell moisture/compaction/loose/temperature; every tire pass packs the groove and migrates loose material to the cushion; global drying drives tacky→slick |
| 4 Baseline controller | `adrl/agents/baseline.py` | Curvature FF + Stanley feedback + slip damping + worst-mu-ahead speed planning. The lap-time floor RL must beat. |
| 5 RL environment | `adrl/environment/race_env.py` | Gymnasium API (check_env clean), privileged obs per handover, curriculum via reward config |
| 6 Telemetry | `adrl/telemetry/recorder.py` | Per-substep samples → Parquet |
| 7 Replay | same | (config, seed, actions) → bit-exact reproduction, `verify_replay()` proves it |

## Design decisions worth knowing

- **Frenet grid, not world grid, for the surface.** Cells indexed (s, d)
  means the groove, cushion, and grip queries are one lookup, and the
  observation "local grip ahead on my line" is trivial.
- **mu(moisture, compaction, loose)** peaks at mid-moisture (tacky), gains
  from compaction (rubbered groove), loses to loose material. Wheelspin and
  big slip angles *tear* the surface instead of packing it — so an
  over-aggressive agent literally ruins its own racing line. That feedback
  loop is the sport.
- **Determinism is enforced, not hoped for.** All randomness flows from the
  seeded env RNG; `test_env_api_and_determinism` asserts bit-identical
  trajectories, and the replay file only stores (config, seed, actions).
- **The curriculum lives in config.** Stages 1–4 are reward/surface parameter
  presets, not code branches.

## DGX Spark deployment notes

- The core is pure NumPy — runs anywhere, including the Spark's ARM64 cores,
  no CUDA required. `SubprocVecEnv` with 16–20 workers will feed PPO well.
- For torch on the Spark (GB10 / SM121): use the CUDA 13 nightly wheels, same
  constraint you hit with vLLM. SB3 sits on top of whatever torch works.
- Isaac Sim (Milestone 8): verify the ARM64 build for your Isaac Sim 6.x
  target via NGC before planning on local rendering — historically Isaac Sim
  was x86-only and the DGX Spark playbooks are recent. If the ARM build lags,
  render remotely: the replay files are the interchange format (deterministic
  state reconstruction → USD animation), so visualization never blocks
  training.
- Vectorization headroom: when single-env NumPy becomes the bottleneck, the
  clean next step is porting `Vehicle.step` + surface lookups to batched
  torch on the GPU (thousands of parallel envs, Isaac Lab-style). The module
  boundaries were drawn for exactly that swap.

## Known Phase 1 simplifications (intentional)

Single-track (bicycle) model — no per-wheel states, no suspension kinematics,
no left-side weight offset yet. Banking is constant in turns. No reverse
gear. These live behind the `Vehicle` interface; raising fidelity does not
touch env, agents, telemetry, or replay.
