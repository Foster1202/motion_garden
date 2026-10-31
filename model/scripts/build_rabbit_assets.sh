#!/usr/bin/env bash
set -euo pipefail

MODEL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
SPRITE_VENV="${TMPDIR:-/tmp}/motion-garden-sprites-venv"
SPRITE_PYTHON="${SPRITE_PYTHON:-$SPRITE_VENV/bin/python}"
ACTION=all
SKIP_RENDER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --action) ACTION="${2:?Missing action}"; shift 2 ;;
    --skip-render) SKIP_RENDER=1; shift ;;
    --help|-h)
      echo 'Usage: scripts/build_rabbit_assets.sh [--action all|idle|bend|grab|return|pull|celebrate] [--skip-render]'
      echo 'Set BLENDER_BIN and SPRITE_PYTHON to override local executables.'
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ACTION" in all|idle|bend|grab|return|pull|celebrate) ;; *) echo "Invalid action: $ACTION" >&2; exit 2 ;; esac

if [[ ! -x "$SPRITE_PYTHON" ]]; then
  if [[ "$SPRITE_PYTHON" != "$SPRITE_VENV/bin/python" ]]; then
    echo "SPRITE_PYTHON is not executable: $SPRITE_PYTHON" >&2; exit 1
  fi
  # The project path contains ':', which Python venv cannot accept.
  python3 -m venv "$SPRITE_VENV"
fi
if ! "$SPRITE_PYTHON" -c 'import PIL; assert PIL.__version__ == "11.3.0"' >/dev/null 2>&1; then
  "$SPRITE_PYTHON" -m pip install -r "$MODEL_ROOT/scripts/sprites/requirements.txt"
fi
if [[ "$SKIP_RENDER" == 0 ]]; then
  "$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
    --python "$MODEL_ROOT/scripts/blender/render_rabbit_frames.py" -- --action "$ACTION" --root "$MODEL_ROOT"
fi
"$SPRITE_PYTHON" "$MODEL_ROOT/scripts/sprites/build_rabbit_spritesheets.py" --action "$ACTION" --root "$MODEL_ROOT"
