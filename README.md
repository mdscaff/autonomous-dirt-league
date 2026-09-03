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

### DGX Spark

```bash
./deploy_to_dgx.sh          # rsync + venv + tests + acceptance run on AgentForgeDGX.local
./play_on_dgx.sh            # launch the game on the DGX's own monitor
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
