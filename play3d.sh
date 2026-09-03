#!/usr/bin/env bash
# Run the ADRL 3D game locally: sim server + open the browser.
# Usage: ./play3d.sh [server args]   e.g. ./play3d.sh --mode demo
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
( sleep 2; open http://localhost:8000 2>/dev/null || xdg-open http://localhost:8000 2>/dev/null ) &
exec .venv/bin/python apps/game3d/server.py "$@"
