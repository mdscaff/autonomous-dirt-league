#!/usr/bin/env bash
# (Re)launch the ADRL 3D driver's-eye game on the DGX Spark's monitor from your Mac.
# Usage: ./play3d_on_dgx.sh [host] [server args...]
#   ./play3d_on_dgx.sh                                  # title screen
#   ./play3d_on_dgx.sh AgentForgeDGX.local --mode demo  # AI drives immediately
set -euo pipefail
HOST="${1:-AgentForgeDGX.local}"; shift || true
ssh "$HOST" "~/adrl/play3d.sh $*"
