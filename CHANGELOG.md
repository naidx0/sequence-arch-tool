## 2026-09-30

Built from `ad70b27f` — first public release, 2810 commits.

### the most recent 60 changes
- Mirror scan: a private folder name counts only as a path segment, so the word model's tests_organized token no longer refuses the release (release-policy test red on the substring check, green after)
- Mirror policy: lab/ never ships; the folded lab notes name this machine's paths (release-policy test red without it, green after). product-mode-coverage finds mlh-adapter under the home directory, not a spelled one
- Bench: product-question-ab defaults the ml-harness repo to ~/Projects/mlh-adapter, not a spelled home directory
- 0.1.3: version bump for the public release (sequence-arch-tool v0.1.3)
- Lab record moves into codeforge: merge naidx0/sequence-lab (495e952) under lab/ with its history
- Tools: bank-paired.mjs, the paired compare used for bank A/Bs
- Handoff: 02:25Z state (three keeps, two discards, short-answer A/B queued)
- Register: short product answer (bank, candidate arm only; baseline keys 72/72 at 8d6a6d51)
- Product turns: SEQUENCE_TEACH_PRODUCT_SHORT=1 asks for about 150 words (off by default, under A/B)
- Log: chart fits its frame width kept (440 byte-identical, 900 full boxes, cut labels 6 to 4); web2 3256/3256
- web2 flow chart fits its frame width by default (440 px byte-identical; 900 px draws full boxes, cut labels 6 to 4); seq.chartFitWidth=0 turns it off
- web2 flow chart: fit to the measured frame width behind seq.chartFitWidth (off by default)
- Log: gate at 649d305e (3134/3137; stale dist of a reverted test, two console-bound terminal tests)
- Log: concept caption never shown (title echo) found and fixed; concept chart v2 kept on screenshots (21-0), on by default at port 649d305e
- Concept chart caption hops on by default (screenshots: 21 of 21 blind judgments, 7 of 7 changed charts; =0 turns it off)
- Concept chart v2: the hop caption opens with 'What travels here' so the canvas does not hide it as a title echo
- Register: concept chart v2 (hops in the caption), judged on screenshots
- Concept chart v2: SEQUENCE_TEACH_CONCEPT_STEPS=caption writes non-import hops into the caption (no labels, no steps on a star); v1 failed the render check
- Log: concept-steps v1 fails the render check (labels clip, steps misread a star), flag stays off; ask-edge-kind seed discarded offline (1 of 54 asks changes)
- Log: concept chart names its hops kept on the pairwise judge (picture 40-0-15, 12 SE); default flip waits on a render check
- Bench: concept-steps-pairs builds offline flag-off/on chart pairs from stored teach turns (control: off rebuild equals stored)
- Register: concept chart names its hops (flag-off vs on, offline pairwise judge)
- Concept chart names its hops: SEQUENCE_TEACH_CONCEPT_STEPS=1 labels arrows with the edge kind and adds in-then-out steps (off by default, under A/B)
- Handoff: v2 kept, bank at 7.8 s, idle lesson; log wording
- Log: no-shape-bounce v2 kept (bank 9.20 s to 7.82 s, 4.1 SE, fastgate ACCEPT); on by default at port 753a2c3d
- No-shape-bounce on by default: a product answer is not sent back for its shape (bank: 9.20 s to 7.82 s, 4.1 SE; =0 turns it off)
- Log: no-shape-bounce v1 discarded (flag rarely fired); v2 registered, candidate arm only against the cached baseline
- No-shape-bounce v2: a product answer need not address the reader to settle (v1 settled almost none on the bank)
- Log: resend diagnosis; unlocked-run incident and fix; drop unpinned cache; register no-shape-bounce bank A/B
- Bench: --cache-only never calls the model on a miss (exit 4, misses listed); --sequence pins the scanned Sequence repo
- Product turns: SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE=1 settles a product draft sent back only for its length or closing question (off by default, under A/B)
- Log: fastgate step 1 verdicts on the bank (UNSURE both); step 2 cached baseline arm built and seeded
- Bench: cached baseline arm (--baseline-cache, --seed-cache): a single-question turn reuses its stored row when the first prompt, tools, model digest, params, run and bench match
- Fast verification kit: fastgate.py (sha256 5ff1e4cc) and bank-to-fastgate; step 1 verdicts on release bank
- Log: release bank v1 at 9f810373 (86%, 9.8 s); half of turns resend; no-shape-bounce discarded offline
- Bench: product A/B records why each call past the first was made
- Bench: product A/B records prompt and output tokens per turn
- Bench: product A/B records provider calls per turn (a bounce or tool round shows as more than 1)
- Log: bare-it kept (47% -> 80%); release bank v1 at 787871ef: 83% full answers, 10.1 s
- Product mode: bare-'it' repo pointer on by default (set 18, 64 pairs: full product answer 47% -> 80%, 5.2 SE)
- Log: lock double-take incident and wx fix; reruns queued serially
- gpu-lock: create the lock with wx so two simultaneous runs cannot both take the card (the 06:39Z double take)
- Register: bare-it repo pointer A/B on set 18
- Bare-'it' repo pointer: off by default until its A/B (SEQUENCE_TEACH_PRODUCT_BARE_IT=1 on)
- Product mode: a bare 'it' points at the repo unless the question names its own subject (SEQUENCE_TEACH_PRODUCT_BARE_IT=0 off; under A/B)
- Log: repo-pointing product mode kept (full answer 43% -> 61%, 4.0 SE)
- Log: product mode missed half of product questions; fix; register set 17 A/B
- Product mode reaches questions that point at the repo ('this', 'the tool') even when the subject check says not-in-repo (sets 15/16: 15/38 -> 37/38, 16/34 -> 32/34)
- Log: lean product turn discarded (no effect on set 16)
- Register: lean product turn (no digest), set 16
- Product turns: SEQUENCE_TEACH_PRODUCT_LEAN_DIGEST=1 drops the structure digest when a README is in hand (off by default, under A/B)
- Log: no chart request kept, on by default (product turn 16.9 s -> 11.9 s)
- Product turns: no chart request by default (set 15, 76 pairs: 16.9 s -> 11.9 s per turn, SE 1.2)
- Register: no chart request in product turns, set 15
- Product turns: SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK=1 leaves the flow chart to the steps fallback (off by default, under A/B)
- Log: skeleton confirmed on set 14 (full answer 33% -> 51%, quality flat, +3.0 s)
- Seal release bank v1 (set 13, 40 product questions) with today's default numbers
- Register: skeleton confirmation on set 14
- Log: product skeleton kept on retry (full answer 31% -> 39%, 2.2 SE), on by default
- Product turns: five-heading skeleton on by default (set 13, 72 pairs: full product answer 31% -> 39%, 2.2 SE)

### and 2750 earlier commits, not listed

Development ran from 2026-04-28 to 2026-09-30. This mirror carries no development
history by design — it is one squashed commit per release — so the 2750 commits
before the list above are summarised by this line rather than reproduced.

