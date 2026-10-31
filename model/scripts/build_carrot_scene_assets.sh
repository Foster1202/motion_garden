#!/usr/bin/env bash
set -euo pipefail
MODEL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
SCENE_VENV="/tmp/motion-garden-sprites-venv"
SCENE_PYTHON="${SCENE_PYTHON:-$SCENE_VENV/bin/python}"
LAYER=all
REBUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --layer) LAYER="${2:?Missing layer}"; shift 2 ;;
    --render-only) REBUILD=0; shift ;;
    --help|-h)
      echo 'Usage: scripts/build_carrot_scene_assets.sh [--render-only] [--layer all|background_far|background_mid|platform|foreground|soil_patch|carrot|basket]'
      echo 'Set BLENDER_BIN and SCENE_PYTHON to override local executables. Python requires Pillow.'
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$LAYER" in all|background_far|background_mid|platform|foreground|soil_patch|carrot|basket) ;; *) echo "Invalid layer: $LAYER" >&2; exit 2 ;; esac
if [[ ! -x "$SCENE_PYTHON" ]]; then
  if [[ "$SCENE_PYTHON" != "$SCENE_VENV/bin/python" ]]; then
    echo "SCENE_PYTHON is not executable: $SCENE_PYTHON" >&2; exit 1
  fi
  # Keep the environment outside the project path, which contains a colon.
  python3 -m venv "$SCENE_VENV"
fi
if ! "$SCENE_PYTHON" -c 'import PIL; assert PIL.__version__ == "11.3.0"' >/dev/null 2>&1; then
  "$SCENE_PYTHON" -m pip install -r "$MODEL_ROOT/scripts/sprites/requirements.txt"
fi
if [[ "$REBUILD" == 1 ]]; then
  "$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
    --python "$MODEL_ROOT/scripts/blender/create_carrot_scene.py" -- --root "$MODEL_ROOT"
fi
"$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
  --python "$MODEL_ROOT/scripts/blender/render_carrot_scene_assets.py" -- --root "$MODEL_ROOT" --layer "$LAYER"
"$BLENDER_BIN" --background --factory-startup --python-exit-code 1 \
  --python "$MODEL_ROOT/scripts/blender/validate_carrot_scene.py" -- --root "$MODEL_ROOT"
"$SCENE_PYTHON" "$MODEL_ROOT/scripts/sprites/qa_carrot_scene_assets.py" --root "$MODEL_ROOT"
