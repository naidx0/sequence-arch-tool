---
name: remotion-video
description: Make a short programmatic video inside the user's project with Remotion (React). Use when the user wants an animated explainer, a title card, a product clip, or a rendered MP4 made from code. Installs Remotion next to the app, builds a composition whose motion is a function of the frame number, previews it in Studio and renders the file into the workspace.
---

# Remotion video

Remotion renders React components one frame at a time. A video is a composition: a component that receives the current frame, plus a duration, a frame rate and a size. Everything that moves is computed from the frame number, so the same code gives the same output every render.

## Two ways to move on a Space

- **A native scene** for motion that lives in the app: `draw` with `type: "scene"` puts a stage on a Space and plays keyframes over the items already there, with no render step and no install. Prefer it for a flow animating, a box moving, a label changing, a short walkthrough the user will edit. Give it `duration` (ms) and `keyframes: [{t, target, x, y, scale, opacity, text}]`, where `target` is the id of another item on the same Space. The user scrubs, pauses and edits it on the Space.
- **A real Remotion render** for an exported video: a file the user keeps, shares or uploads. Everything below is for that case.

## When to use

- The user asks for an animated clip, a title sequence, an explainer, or an MP4/WebM/GIF made from code. For in-app motion on a Space, use a native scene (above) instead.
- The project uses React, or the user accepts a small Remotion setup beside the app.
- Not for a static image, and not for a change to a live UI screen.

## Set up in the user's project

1. Look for a `package.json`. If the video should stay apart from the app, create a folder such as `video/` with its own `package.json`, so the app's dependencies are not touched.
2. Install: `npm install remotion @remotion/cli`. Add `@remotion/player` only when the video will play inside the app.
3. Confirm with `npx remotion --version`.

## Build the composition

- The `Root` file in the source folder registers each video: `<Composition id="Intro" component={Intro} durationInFrames={150} fps={30} width={1920} height={1080} />`.
- The entry file, `index.ts` in the source folder, calls `registerRoot(Root)`. Pass it as `<entry>` to every CLI command below.
- Inside a component, `useCurrentFrame()` gives the frame and `useVideoConfig()` gives fps and size.
- Ramp a value with `interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" })`. Use `spring({ frame, fps, config: { damping: 200 } })` for motion that settles without bounce.
- Split the timeline with `<Sequence from={30} durationInFrames={60}>`. Inside a Sequence, `useCurrentFrame()` counts from that Sequence's start.
- Keyframes are `interpolate` or `spring` over the frame number: `interpolate(frame, [0, 30, 90], [0, 1, 1])` rises over the first second and holds. To hold a still, wrap the rest in `<Freeze frame={90}>` or clamp the interpolation so the value stops changing. Use `<Sequence from={..} durationInFrames={..}>` to start and stop each element on its beat.
- Every visual value must come from the frame. Do not use `Date`, unseeded randomness, timers, or CSS transitions and animations: each frame is rendered separately, so they will not match.

## Preview

- `npx remotion studio <entry>` opens Studio for scrubbing. If you cannot open it, check the frames with stills (below) and say so.

## Render into the workspace

- `npx remotion render <entry> Intro .sequence/media/intro.mp4`. Use `--frames=0-59` for a short test range. `.mp4`, `.webm` and `.gif` are the formats a Space shows.
- Render to `.sequence/media/<name>.mp4` inside the project, not to a system temp folder. The file must sit in the workspace so the user can open it and Spaces can show it.
- Place it on a Space: `draw` with `ops: [{op: "add", type: "video", src: ".sequence/media/intro.mp4", w: 480, h: 270, text: "Intro cut"}]` (`text` is the label). `src` is a path inside the project and the file must exist, or the call is refused.
- The `draw` result names `{board, group}` and an inline preview address. The chat shows a poster box with the label inline; the user clicks open on the Space to play it, seek and move it.
- Report the relative path, the duration in seconds, and the size.

## Check before you call it done

- The render exited 0, and the output file exists and is not empty.
- Look at the first, middle and last frames: `npx remotion still <entry> Intro <still-path> --frame=0`, where `<still-path>` is a PNG in `out/`. Repeat for other frames and read the images.
- Text fits its box at the chosen size, and nothing is cut off at the frame edge.

## Common mistakes

- Animating with CSS or `setTimeout`: the frames are not drawn in real time, so the motion will not appear in the render.
- Leaving `durationInFrames` at a guess: the render length then does not match the timeline.
- Rendering at a size that differs from the composition's `width` and `height`.
