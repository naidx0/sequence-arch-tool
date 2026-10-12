"""Gate for the demo clips: no one-frame flicker, and the poster is the clip's first frame.

  python -I tools/demo/flicker-check.py [--moves DIR] site/public/demo/v014/*.mp4

Flicker: frame i differs from both neighbours while the neighbours match each other (a hover that lights up for
one frame as the cursor crosses a row). Works on 480x270 gray frames; reports per clip the count and the worst
instances (time, pixels changed, box in 1920x1080 coordinates).

Camera moves: when the virtual camera pans or zooms, thin lines and text strokes legitimately jump away and back
between three frames, so the test cannot tell them from flicker (measured: a constant-speed pan of a still frame,
with plain whole-pixel crop, is flagged on 118 of 120 frames). The recorder writes the exact move intervals of each
clip and tour to DIR/<name>.moves.json; frames inside a move (plus one frame either side) are skipped and counted in
camera_frames. Known limit: a blink during a camera move is not checked. Hover blinks are prevented at the source
(no hover while the cursor is in transit, record-014.mjs), and a clip with no moves is checked on every frame.

Poster: when <clip>.jpg sits beside <clip>.mp4, its mean absolute difference from frame 0 (same 480x270 gray) must
stay under POSTER_MAD, so the site's poster-to-video swap does not jump.
Exit 1 when any clip has a flicker frame or a poster that does not match.
"""
import json, subprocess, sys, os
import numpy as np

FF = os.environ.get('FFMPEG') or os.path.expanduser('~/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe')
W, H = 480, 270
FPS = 60
POSTER_MAD = 3.0

args = sys.argv[1:]
moves_dir = None
if args[:1] == ['--moves']:
    moves_dir, args = args[1], args[2:]


def frames(f):
    raw = subprocess.run([FF, '-v', 'error', '-i', f, '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', '-'],
                         capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.int16)


def moves_of(f):
    if not moves_dir:
        return []
    p = os.path.join(moves_dir, os.path.basename(f)[:-4] + '.moves.json')
    return json.load(open(p)) if os.path.exists(p) else []


bad = 0
for f in args:
    fr = frames(f)
    mv = moves_of(f)
    hits = []
    skipped = 0
    for i in range(1, len(fr) - 1):
        t = i / FPS
        if any(a - 1.5 / FPS <= t <= b + 1.5 / FPS for a, b in mv):
            skipped += 1
            continue
        a, b, c = fr[i - 1], fr[i], fr[i + 1]
        both = (np.abs(b - a) > 24) & (np.abs(b - c) > 24) & ~(np.abs(a - c) > 24)  # pixels that jump away and back
        n = int(both.sum())
        if n > 40:
            ys, xs = np.nonzero(both)
            hits.append((round(t, 2), n, (int(xs.min() * 4), int(ys.min() * 4), int(xs.max() * 4), int(ys.max() * 4))))
    hits.sort(key=lambda h: -h[1])
    line = f'{os.path.basename(f)}: frames={len(fr)} flicker_frames={len(hits)} camera_frames={skipped} worst={hits[:5]}'
    jpg = f[:-4] + '.jpg'
    if os.path.exists(jpg):
        mad = float(np.abs(frames(jpg)[0] - fr[0]).mean())
        line += f' poster_vs_first_frame_mad={mad:.2f}'
        if mad >= POSTER_MAD:
            bad += 1
            line += ' POSTER_MISMATCH'
    if hits:
        bad += 1
    print(line)
sys.exit(1 if bad else 0)
