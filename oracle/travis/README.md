# Travis county modules

The Travis County adapter lives on branch `travis` of a `soofi-xyz-team-kit` checkout pinned at
`99c7bff` (decisions.md section 3). The adapter sources, evidence, replay fixture and apply scripts
are **not inlined here** (they are ~180 files). They live in a public repo, pinned by SHA:

- Mirror: https://github.com/xucian/travis-county-oracle-kit
- Pin: `MIRROR_COMMIT` (`29b46379aef7a7e3f72cc4aa6d61e23928df411b`)
- Kit pin the mirror was taken from: `KIT_COMMIT`

That split keeps this assignment PR under CodeRabbit's 300-file cap. Nothing was dropped: the
mirror has the full `oracle/travis/` git history. Clone that SHA, not `main`.

This directory still holds the pin files, `kit-files.txt` (the path list), `kit-core.patch` (the
two-line kit registration), and `apply-to-kit.sh` (clones the pin, then copies into a kit checkout).

Rerun from a clean clone:

```bash
git clone https://github.com/soofi-xyz/soofi-xyz-team-kit kit && git -C kit checkout 99c7bff
oracle/travis/apply-to-kit.sh ./kit
(cd kit/skills/use-oracle/runtime && npm ci && TZ=America/Chicago npm test)
(cd kit/skills/use-oracle/runtime && node bin/elephant-county.mjs replay --county travis --fixture fixtures/travis-replay --output "$(mktemp -d)")
```

Never mirrored: seed CSVs, captures, run directories, CARs, Parquet, `.env`.
