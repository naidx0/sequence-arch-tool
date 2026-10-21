#!/usr/bin/env python3
"""Ghost check for demo videos: a region that changes and changes back within a few frames.

flicker-check.py catches a single frame that differs from both neighbours. What a viewer sees as "flickering in and out" is wider:
a dissolve between unrelated screens, a sheet half drawn, a region that blinks for several frames. This reads each video at 640x360 gray, splits
every frame into 20 px blocks, and flags a frame when at least MIN_BLOCKS blocks jump by more than JUMP and return to within 30% of
their old value inside WINDOW frames. A moving cursor touches at most two or three blocks, so it does not trip the check.

  python3 -I tools/demo/ghost-check.py clip.mp4 [more.mp4 ...]      exit 1 if any video has a ghost
"""
import subprocess, sys
import numpy as np

W, H, B = 640, 360, 20
JUMP, WINDOW, MIN_BLOCKS = 14.0, 10, 5


def blocks(path):
    cmd = ['ffmpeg', '-threads', '1', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(raw) // (W * H)
    f = np.frombuffer(raw[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.float32)
    return f.reshape(n, H // B, B, W // B, B).mean(axis=(2, 4))


def ghosts(path):
    b = blocks(path)
    out = []
    for i in range(1, len(b) - 1):
        jump = np.abs(b[i] - b[i - 1])
        ys, xs = np.where(jump > JUMP)
        if len(ys) < MIN_BLOCKS:
            continue
        back = 0
        for y, x in zip(ys, xs):
            for j in range(1, WINDOW):
                if i + j >= len(b):
                    break
                if abs(b[i + j][y, x] - b[i - 1][y, x]) < 0.3 * jump[y, x]:
                    back += 1
                    break
        if back >= MIN_BLOCKS:
            out.append((i, back))
    return out


bad = 0
for p in sys.argv[1:]:
    g = ghosts(p)
    print(f'{p.split("/")[-1].split(chr(92))[-1]}: ghost_frames={len(g)}' + (' at ' + ', '.join(f'{i / 60:.2f}s({n} blocks)' for i, n in g[:8]) if g else ''))
    bad += bool(g)
sys.exit(1 if bad else 0)
