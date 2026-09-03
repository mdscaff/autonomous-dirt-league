#!/usr/bin/env bash
# (Re)launch the ADRL 3D driver's-eye game on the DGX Spark's monitor from your Mac.
# Usage: ./play3d_on_dgx.sh [host] [server args...]
#   ./play3d_on_dgx.sh                                  # title screen
#   ./play3d_on_dgx.sh AgentForgeDGX.local --mode demo  # AI drives immediately
#   ./play3d_on_dgx.sh AgentForgeDGX.local stop         # close the kiosk + server (ESC in-game does the same)
set -euo pipefail
HOST="${1:-AgentForgeDGX.local}"; shift || true
if [ "${1:-}" = "stop" ]; then ssh "$HOST" "~/adrl/stop3d.sh"; exit; fi
ssh "$HOST" "~/adrl/play3d.sh $*"
