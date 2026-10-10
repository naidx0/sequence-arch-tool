# Third-party notices

Licences that require a notice to travel with what Sequence ships. This file is
that notice. It is gated by `tools/ci/third-party-notices.test.mjs`, which fails
the build if the board hides a renderer's attribution badge without the entry
below being present.

Separate from [`TLDRAW_LICENSE.md`](TLDRAW_LICENSE.md), which records a
*decision* about a source-available SDK. This file records *obligations* under
permissive licences, which are unconditional and not a matter of judgement.

---

## @xyflow/react (React Flow) — MIT

The architecture board renders with `@xyflow/react` 12.11.2.

**Why the on-canvas badge is off.** React Flow paints a "React Flow" link in a
corner of every canvas by default, and the package ships
`proOptions={{ hideAttribution: true }}` to turn it off. MIT's one condition is
that the copyright and permission notice "be included in all copies or
substantial portions of the Software" — a condition on what is DISTRIBUTED, not
on what is drawn in the interface. Hiding the badge is therefore permitted, and
carrying the notice is not optional. That is the trade this file completes.

Read from `packages/web2/node_modules/@xyflow/react/LICENSE`, verbatim:

```
MIT License

Copyright (c) 2019-2025 webkid GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**A note on their ask, which is not a condition.** xyflow maintain React Flow for
free, and the library embeds its own request in the markup it renders — verified
verbatim in `dist/esm/index.js`:

> Please only hide this attribution when you are subscribed to React Flow Pro

That is a request, not a term of the MIT licence, and Sequence has no React Flow
Pro subscription. The badge was deliberately left ON for exactly this reason
until the owner decided otherwise; he asked for it removed on 2026-08-21. The ask
is recorded here rather than discarded, so that anyone revisiting the question —
including whoever decides whether to subscribe — meets it rather than having to
rediscover it.

---

## DiDi, the Digital Ink Diagram data (Google) — CC BY 4.0

The whiteboard's shape recognizer (`packages/ink`, `shapeModelWeights.ts`) is a
small gradient-boosted-tree model **trained on** the DiDi dataset: about 22,000
flowcharts that people copied by hand on a tablet, with the prompt diagram each
one was copying. The data is not shipped; only numbers derived from it (the
trained trees) are.

- **Material:** "Digital Ink Diagram data" (DiDi), Google LLC, released in 2020.
  Philippe Gervais, Thomas Deselaers, Emre Aksan and Otmar Hilliges, "The DIDI
  dataset: Digital Ink Diagram data", arXiv:2002.09303.
  Dataset page: <https://github.com/google-research/google-research/tree/master/didi_dataset>
  Files used: `diagrams_20200131.ndjson` and the per-drawing prompt files
  (`xdot/`, `png/` headers) from
  <https://storage.googleapis.com/digital_ink_diagram_data/>.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/>. The licence's disclaimer of
  warranties applies: <https://creativecommons.org/licenses/by/4.0/legalcode#s5>.
- **Changes made:** every stroke was labelled by geometry against its prompt
  diagram (rect, ellipse, diamond, connector, or ink), features were computed from
  the stroke points, and a model was fitted to those features. The model's weights
  are an adaptation of the material and are offered under the same attribution; no
  endorsement by Google or the authors is implied.
- **Where it travels:** the weights are the only part that ships, in
  `packages/ink/dist/shapeModelWeights.js` and in the web app's lazily loaded
  recognizer chunk, which is why this notice sits with the other shipped-code notices.
  The benchmark scripts that read the dataset are in `tools/bench/ink-*.mjs`; the
  data itself is never committed or bundled.
