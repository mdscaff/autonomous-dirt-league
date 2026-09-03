#!/usr/bin/env bash
# (Re)launch the ADRL game on the DGX Spark's attached monitor from your Mac.
# Usage: ./play_on_dgx.sh [host] [game args...]
#   ./play_on_dgx.sh                                  # title screen, fullscreen
#   ./play_on_dgx.sh AgentForgeDGX.local --mode demo  # AI drives immediately
set -euo pipefail
HOST="${1:-AgentForgeDGX.local}"; shift || true
# "[p]ython" keeps pkill/pgrep from matching this ssh shell's own command line.
ssh "$HOST" "pkill -f '[p]ython apps/game/play.py' 2>/dev/null; setsid nohup ~/adrl/play.sh $* > ~/adrl/game.log 2>&1 < /dev/null & sleep 3; pgrep -af '[p]ython apps/game/play.py' >/dev/null && echo 'ADRL running on the DGX monitor' || { echo 'failed:'; cat ~/adrl/game.log; }"
