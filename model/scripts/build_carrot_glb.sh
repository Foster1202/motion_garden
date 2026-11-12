#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [[ ! -x "$BLENDER_BIN" ]]; then
  BLENDER_BIN="$(command -v blender || true)"
fi
if [[ -z "$BLENDER_BIN" || ! -x "$BLENDER_BIN" ]]; then
  echo 'Blender was not found. Set BLENDER_BIN to its executable path.' >&2
  exit 1
fi
exec "$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
  --python "$SCRIPT_DIR/blender/export_carrot_glb.py" -- "$@"
