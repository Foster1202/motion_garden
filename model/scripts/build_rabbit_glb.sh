#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RABBIT_VERSION=v2
EXPORT_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) RABBIT_VERSION="${2:?Missing rabbit version}"; shift 2 ;;
    --version=*) RABBIT_VERSION="${1#*=}"; shift ;;
    --help|-h)
      echo 'Usage: build_rabbit_glb.sh [--version v2|v3] [exporter options]'
      echo 'The default v2 build retains its existing generator and output names.'
      echo 'The v3 build derives a separate source from saved V2 and exports rabbit_realtime_v3.'
      exit 0 ;;
    *) EXPORT_ARGS+=("$1"); shift ;;
  esac
done
case "$RABBIT_VERSION" in
  v2|v3) ;;
  *) echo "Unsupported rabbit version: $RABBIT_VERSION" >&2; exit 2 ;;
esac
BLENDER_BIN="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [[ ! -x "$BLENDER_BIN" ]]; then
  BLENDER_BIN="$(command -v blender || true)"
fi
if [[ -z "$BLENDER_BIN" || ! -x "$BLENDER_BIN" ]]; then
  echo "Blender was not found. Set BLENDER_BIN to its executable path." >&2
  exit 1
fi
if [[ "$RABBIT_VERSION" == v3 ]]; then
  "$BLENDER_BIN" --background --factory-startup --python-exit-code 1 --python "$SCRIPT_DIR/blender/improve_rabbit_rig_v3.py"
  # Guard empty arrays for macOS Bash 3.2 with nounset enabled.
  exec "$BLENDER_BIN" --background --factory-startup --python-exit-code 1 --python "$SCRIPT_DIR/blender/export_rabbit_glb.py" -- \
    --source "$MODEL_ROOT/assets/blender/rabbit/rabbit_realtime_v3.blend" --output-name rabbit_realtime_v3 ${EXPORT_ARGS[@]+"${EXPORT_ARGS[@]}"}
fi
"$BLENDER_BIN" --background --factory-startup --python-exit-code 1 --python "$SCRIPT_DIR/blender/proportion_rabbit_v2.py"
exec "$BLENDER_BIN" --background --factory-startup --python-exit-code 1 --python "$SCRIPT_DIR/blender/export_rabbit_glb.py" -- ${EXPORT_ARGS[@]+"${EXPORT_ARGS[@]}"}
