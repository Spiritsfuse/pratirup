# Commit ID map

On 21 Oct 2026 the team rewrote this repository's history, with every team member's explicit approval. The rewrite:

- standardised co-author trailers to the three team members;
- removed a team-internal video script that had been committed by mistake.

**What did not change:** the files and code of every commit, apart from that one script. You can check this with `git diff` between the trees.

**Why IDs changed:** a rewrite gives every commit a new ID. The locked result files were deliberately **not edited**, so they still cite the original IDs. This table resolves each original ID to its rewritten commit.

| Original ID (cited in results) | Current ID | Commit | Cited by |
|---|---|---|---|
| `c758556` | `d0717ce` | ci: Dependabot opens security, minor and patch updates only |  |
| `274c4b0` | `5c97698` | ci: put the repo root on the pytest path; move to Node 24 actions |  |
| `8b549a8` | `5a29053` | feat(web): v2 UI with AGP report, consolidated alerts, evidence for v1 to v2 |  |
| `2ad4d50` | `b0874cc` | docs: README restructured to the submission checklist, v2 docs, deployment |  |
| `712edbc` | `c73be9a` | results: v2 bundle, v2 test re-evaluation (reason logged), v1 archived |  |
| `aac9b42` | `7fc51c5` | feat(model): v2 noise-robust training, consolidated alerts, AGP API |  |
| `28cbcc6` | `56aa368` | docs: presentation (PPTX and PDF), screenshots, tighter architecture diagram | v2 dev and test stages (results/dev_cv.json, results/test.json, results/runs.jsonl, models/bundle.json) |
| `aca384a` | `676f8e8` | fix(api): data quality, FHIR R4 shape, startup and live sessions |  |
| `317b0ff` | `ad3ef47` | feat(web): clinician app for the glucose twin |  |
| `424de6c` | `cd1d553` | docs: README, model and data cards, video script, device simulator |  |
| `1086dfd` | `d43a839` | results: one-time test evaluation and CGMacros external validation |  |
| `0b5c075` | `1f8d05b` | feat(model): tuned GRU comparison, frozen dev-stage bundle | v1 test stage (results/v1/TEST_LOCK.json, results/v1/test.json, results/v1/runs.jsonl, results/runs.jsonl) |
| `156823d` | `5ebce4c` | build: self-contained Docker image | v1 dev stage (results/v1/dev_cv.json, results/v1/benchmark.json) |
| `87713da` | `a2cd402` | feat(api): twin engine, SQLite store and FastAPI service |  |
| `d878b56` | `7cd7d85` | feat(model): benchmark protocol, LightGBM twin models and baselines |  |
| `1cd137a` | `40d4a79` | feat(twin): causal feature builder and Kalman glycaemic state |  |
| `fc321a2` | `e8a576b` | feat(data): ShanghaiT2DM ingestion, FHIR record and patient split |  |

**Note on v2.** The v2 development and test runs recorded `28cbcc6` because they ran on v2 code that was not yet committed, on top of that commit. That code was committed immediately afterwards as `aac9b42` (now `7fc51c5`), together with its results in `712edbc` (now `c73be9a`).
