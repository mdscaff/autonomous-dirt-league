#!/usr/bin/env bash
# Deploy the ADRL simulator to the DGX Spark and run the Phase 1 acceptance test.
# Usage: ./deploy_to_dgx.sh [host]   (default: AgentForgeDGX.local)
set -euo pipefail

HOST="${1:-AgentForgeDGX.local}"
REMOTE_DIR="adrl/autonomous-dirt-league"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Syncing repo to $HOST:~/$REMOTE_DIR"
ssh "$HOST" "mkdir -p ~/$REMOTE_DIR"
rsync -az --delete \
  --exclude .git --exclude .venv --exclude runs --exclude __pycache__ \
  --exclude '*.zip' --exclude 'artifacts/*.parquet' \
  "$HERE/" "$HOST:~/$REMOTE_DIR/"

echo "==> Remote setup"
ssh "$HOST" bash -s "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
cd ~/"$1"

# Isolated env (DGX OS python3 is system-managed)
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo "--- unit tests ---"
python -m pytest tests/ -q

echo "--- Phase 1 acceptance (20 laps, replay-verified) ---"
python apps/simulator/run_baseline.py --laps 20 --verify-replay

# Launcher for the playable demo on the DGX's own monitor (GNOME/Xorg on :1).
cat > ~/adrl/play.sh <<'EOF'
#!/usr/bin/env bash
cd ~/adrl/autonomous-dirt-league
source .venv/bin/activate
export DISPLAY=:1 XAUTHORITY=/run/user/1000/gdm/Xauthority
exec python apps/game/play.py "$@"
EOF
chmod +x ~/adrl/play.sh

# 3D game: sim server + Firefox kiosk (own profile so it coexists with a
# desktop Firefox). Port 8420 because 8000 is taken on this box.
mkdir -p ~/adrl/ffprofile
cat > ~/adrl/ffprofile/user.js <<'EOF'
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("webgl.force-enabled", true);
user_pref("layers.acceleration.force-enabled", true);
user_pref("gfx.webrender.all", true);
user_pref("full-screen-api.warning.timeout", 0);
EOF
cat > ~/adrl/play3d.sh <<'EOF'
#!/usr/bin/env bash
# ADRL 3D on the DGX monitor: sim server + Firefox kiosk on display :1.
# Usage: ~/adrl/play3d.sh [server args]   e.g. --mode demo
cd ~/adrl/autonomous-dirt-league
source .venv/bin/activate
export DISPLAY=:1 XAUTHORITY=/run/user/1000/gdm/Xauthority XDG_RUNTIME_DIR=/run/user/1000
xset s off -dpms 2>/dev/null                            # keep the monitor awake for this session
pkill -f "[p]ython apps/game/play.py" 2>/dev/null      # 2D game would sit on top of the kiosk
pkill -f "[a]pps/game3d/server.py" 2>/dev/null
setsid nohup python apps/game3d/server.py --port 8420 --on-quit 'pkill -f "[f]irefox.*ffprofile"' "$@" > ~/adrl/game3d.log 2>&1 < /dev/null &
sleep 2
if ! pgrep -f "[f]irefox.*ffprofile" >/dev/null; then
  setsid nohup firefox --new-instance --profile ~/adrl/ffprofile --kiosk http://localhost:8420 > ~/adrl/firefox.log 2>&1 < /dev/null &
fi
sleep 3
pgrep -f "[a]pps/game3d/server.py" >/dev/null && echo "sim server running" || { echo "server failed:"; cat ~/adrl/game3d.log; }
pgrep -f "[f]irefox.*ffprofile" >/dev/null && echo "firefox kiosk running" || { echo "firefox failed:"; tail -20 ~/adrl/firefox.log; }
EOF
chmod +x ~/adrl/play3d.sh
cat > ~/adrl/stop3d.sh <<'STOP'
#!/usr/bin/env bash
# Stop the ADRL 3D kiosk and sim server.
pkill -f "[f]irefox.*ffprofile" 2>/dev/null; pkill -f "[a]pps/game3d/server.py" 2>/dev/null
sleep 1; echo "ADRL 3D stopped"
STOP
chmod +x ~/adrl/stop3d.sh

echo
echo "Core install OK. Arch: $(uname -m)  Python: $(python --version)"
REMOTE

echo
echo "==> Done."
echo "    Play on the DGX monitor:   ./play_on_dgx.sh"
echo "    RL training (on the DGX):"
echo "      ssh $HOST"
echo "      cd ~/$REMOTE_DIR && source .venv/bin/activate"
echo "      pip install --pre torch --index-url https://download.pytorch.org/whl/nightly/cu130"
echo "      pip install stable-baselines3 tensorboard"
echo "      python -c 'import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))'"
echo "      python apps/trainer/train_ppo.py --steps 5_000_000 --envs 16"
