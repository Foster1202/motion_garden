"""Shared, deterministic sampling contract for Task 2C."""
from functools import lru_cache
import struct

SPECS = {
    'idle': dict(end=48, count=12, fps=6, repeat=-1, critical=(1, 13, 25, 36, 48)),
    'bend': dict(end=16, count=8, fps=10, repeat=0, critical=(1, 16)),
    'grab': dict(end=16, count=8, fps=10, repeat=0, critical=(1, 16)),
    'return': dict(end=16, count=8, fps=10, repeat=0, critical=(1, 16)),
    'pull': dict(end=20, count=12, fps=12, repeat=0, critical=(1, 5, 14, 20)),
    'celebrate': dict(end=32, count=16, fps=10, repeat=0,
                      critical=(1, 12, 14, 16, 18, 20, 32)),
}


def sample_frames(action_name, start, end, target_count):
    """Fit an integer grid while retaining endpoints and action extrema."""
    name = action_name.removeprefix('Rabbit_').lower()
    if name not in SPECS or start != 1 or end != SPECS[name]['end']:
        raise ValueError('Sampling requires the documented Task 2B action range')
    required = set(SPECS[name]['critical']) | {start, end}
    # Keep both hold boundaries, but omit redundant Pull hold interior poses.
    candidates = tuple(f for f in range(start, end + 1)
                       if name != 'pull' or f not in (2, 3, 4))
    if not len(required) <= target_count <= len(candidates):
        raise ValueError('Target count cannot preserve the mandatory frames')
    targets = [start + i * (end - start) / (target_count - 1)
               for i in range(target_count)]

    @lru_cache(None)
    def solve(position, selected):
        if position == len(candidates):
            return (0.0, ()) if selected == target_count else (float('inf'), ())
        frame = candidates[position]
        options = []
        if frame not in required:
            options.append(solve(position + 1, selected))
        if selected < target_count:
            cost, tail = solve(position + 1, selected + 1)
            options.append((cost + (frame - targets[selected]) ** 2, (frame,) + tail))
        return min(options, default=(float('inf'), ()))

    cost, frames = solve(0, 0)
    if cost == float('inf') or not required.issubset(frames):
        raise ValueError('No valid frame sampling exists')
    return list(frames)


def normalize_png_metadata(path):
    """Remove volatile PNG text/time chunks without touching encoded pixels."""
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Render is not a PNG: ' + str(path))
    result = bytearray(data[:8])
    offset = 8
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        chunk_type = data[offset + 4:offset + 8]
        end = offset + length + 12
        if end > len(data):
            raise ValueError('Truncated PNG: ' + str(path))
        if chunk_type not in {b'tEXt', b'zTXt', b'iTXt', b'tIME'}:
            result.extend(data[offset:end])
        offset = end
    path.write_bytes(result)
