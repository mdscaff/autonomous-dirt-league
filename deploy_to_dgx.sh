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
