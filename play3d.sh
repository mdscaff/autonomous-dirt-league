#!/usr/bin/env bash
# Run the ADRL 3D game locally: sim server + open the browser.
# Usage: ./play3d.sh [server args]   e.g. ./play3d.sh --mode demo   or   ./play3d.sh --port 9000
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
PORT=""; prev=""
for a in "$@"; do [ "$prev" = "--port" ] && PORT="$a"; prev="$a"; done
busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
if [ -z "$PORT" ]; then
  PORT=8000
  if busy "$PORT"; then PORT=8420; echo "port 8000 is in use by something else - using $PORT"; set -- "$@" --port "$PORT"; fi
fi
WS=8765; prev=""
for a in "$@"; do [ "$prev" = "--ws-port" ] && WS="$a"; prev="$a"; done
if busy "$WS"; then WS=8766; echo "websocket port 8765 is in use - using $WS"; set -- "$@" --ws-port "$WS"; fi
URL="http://localhost:$PORT/"; [ "$WS" != 8765 ] && URL="$URL?ws=$WS"
( sleep 2; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null ) &
exec .venv/bin/python apps/game3d/server.py "$@"
