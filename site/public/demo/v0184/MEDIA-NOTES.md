# Sequence 0.1.8.4 demo media: what is real and what is not

Recorded on 2026-10-19 on a Linux container (CPU only, headless Chromium) from this tree's build.

**Real:** the app (`packages/analyzer/dist/cli.js app` serving `packages/web2/dist`), the scan, the architecture board and its layout, every control clicked in the clips and stills, the streaming of the answer through the app's real chat pipeline.

**Not real:** the model. The chat is connected to `tools/measure/fake-openai.mjs`, a local stand-in that streams an answer written by hand (see `tools/demo/record-0184-scenarios.mjs`). The answer is not output of a model, and the token counts under it are the stand-in's. The project is a neutral copy of `packages/analyzer/test/fixtures/shopfront`.

## Files

- `ask-live`, `surfaces`, `rail-and-settings`, `board-tour` (`.mp4` and a first-frame `.jpg` poster): the four clips. `tour` (22 s) and `tour-full` (30 s) join them with hard cuts.
- `stills/*.webp`: 34 stills, dark and light, desktop (1440x900 at 2x) and phone (390x844 at 2x). `stills/STILLS.json` lists them.
- `hero-dark`, `hero-light` (`.webp`, `-1080.webp`, `-og.png`): a real screenshot over an ASCII mosaic of the Bastion photograph and a Bayer-dithered glyph field (`tools/demo/ascii-hero.mjs`). The screenshot is untouched; only the surround is processed. `-og.png` is the 1200x630 share-card crop.

## How it was made

`node tools/demo/record-014.mjs --set 0184 --all --live-model --no-stills --port 4291 --vw 1280 --vh 720 --dsf 1 --cam-max 1.5`, then `node tools/demo/stills-0184.mjs`, then `node tools/demo/ascii-hero.mjs --in <still> --out <hero> --theme dark|light`. CDP `Page.startScreencast` (every painted frame, timestamped), idle stretches cut, H.264 CRF 21 (tours 25), no audio.

Tours are hard cuts. The 0.1.4 tours dissolved between clips, and a dissolve between two unrelated screens reads as a ghosted flicker.

## Gates (both must read 0 for every clip and tour; the recorder fails the run otherwise)

- `tools/demo/flicker-check.py`: no one-frame flicker, and every poster is its video's first frame. Result on these files: `flicker_frames=0` for all eight videos.
- `tools/demo/ghost-check.py`: no 20 px block that changes and changes back within ten frames. Result: `ghost_frames=0` for all eight.

Frame rate: this machine captured about 28 to 34 ms per frame in motion at 1280x720; the 0.1.4 clips were 1920x1080 at 2x on a faster machine. These are smaller and a little less smooth.
