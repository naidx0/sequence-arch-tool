# Sealed task set

sha256: `371049f0b1a0f7e03907b209ba757db01acf3d82edc785a6b95d74eabe2fce54`

32 tasks. The hash covers every file under tasks/ except this one: sorted lines of
`relative path <tab> sha256 of the file with CRLF normalised to LF`, joined by LF with a final LF, hashed with sha256.
task.json carries `editable` (the only paths an agent may change) and `expect.pass` (the number of passing tests the reference
solution produces; the scorer requires exactly that count, so exit code 0 with no tests run does not score).
Recompute with `node tools/bench/agent-ab/seal.mjs`. `taskset.test.mjs` fails if the set no longer matches this hash.
Written before any agent arm ran. Changing a task means a new set, a new hash, and re-running both arms.
