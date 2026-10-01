"""The Windows icon: small frames drawn at size, large frames Lanczos-smoothed.

    py -3 packages/desktop/scripts/make-icon.mjs   # writes the PNGs first
    py -3 packages/desktop/scripts/make-ico.py

Writes `packages/desktop/build/icon.ico`. Frames: 16, 20, 24, 30, 32, 36, 48,
64, 128, 256.

Decision 28 (2026-09-17): depth — node shadows, bevel, plate sheen — is painted
into the 1024 master, and the LARGE frames (64/128/256) are Lanczos downscales
of it. That is what Chrome, Cursor and Obsidian ship at those sizes.

Decision 28 addendum (same day, owner on the installed app: the taskbar icon
"reads as a soft blob"): below 64px a Lanczos of that master is the problem,
not the answer. A 6-unit route is 0.9 of a pixel at 16px, so it resolves as a
grey smear, and the ambient + contact shadows resolve as a halo round a white
lozenge. So `make-icon.mjs` now rasterises 16/20/24/30/32/36/48 STRAIGHT FROM
THE VECTOR at the target pixel size — small variant of the mark below 33px,
flat ink, no shadow, no rim — and this script simply packs those PNGs. It falls
back to a Lanczos of the master for any frame whose PNG is missing, so the ICO
is still buildable from `icon.png` alone.

No unsharp mask any more: it existed to claw back detail Lanczos had lost, and
a directly-rendered frame has not lost any. Sharpening one only puts a bright
fringe on the plate edge.
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
BUILD = HERE.parent / "build"
# Rendered at size by make-icon.mjs (DIRECT_FRAMES there — keep in step).
DIRECT = (16, 20, 24, 30, 32, 36, 48)
# Lanczos from the shaded 1024 master, where the depth reads.
FROM_MASTER = (64, 128, 256)


def frame(master: Image.Image, size: int) -> tuple[Image.Image, str]:
    """The per-size PNG when it exists, else a Lanczos of the master."""
    direct = BUILD / f"icon-{size}.png"
    if size in DIRECT and direct.exists():
        im = Image.open(direct).convert("RGBA")
        if im.size != (size, size):
            raise SystemExit(f"{direct} is {im.size}, expected {(size, size)}")
        return im, "vector"
    return master.resize((size, size), Image.LANCZOS), "lanczos"


def main() -> None:
    master = Image.open(BUILD / "icon.png").convert("RGBA")
    sizes = sorted((*DIRECT, *FROM_MASTER))
    built = {s: frame(master, s) for s in sizes}
    frames = {s: im for s, (im, _) in built.items()}
    frames[256].save(
        BUILD / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=[frames[s] for s in sizes if s != 256],
    )
    how = ", ".join(f"{s}:{built[s][1]}" for s in sizes)
    print("wrote", BUILD / "icon.ico", "frames", how)


if __name__ == "__main__":
    main()
