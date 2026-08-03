# docs/seed — the migration's Phase 0 distillation

Written 2026-08-02 at `d6848c9` (357/357 tests, tsc clean). This
directory is the deliberate seed for the successor monorepo
(custody-protocol kernel + thin React binding + registry), per the
Phase 0–5 plan. Knowledge moves as **contracts** — tests and distilled
rules — and code moves only after its contract lands. Once Phase 1
begins, this repo freezes as the runnable **oracle**: checked out
side-by-side for diffing and probing, never vendored.

Three documents:

- **[manifest.md](manifest.md)** — all 62 decisions triaged
  (test / rule / hist), organized by kernel layer in Path-1 landing
  order (mapping → paint → door → transfer → chrome → physics), with
  the suites that carry each contract, the new tests owed, and the
  debts carried forward. The new decisions ledger starts at #1 and
  cites back here as `archive#N` (= this repo at `d6848c9`,
  docs/decisions.md entry N).
- **[platform-reaudit.md](platform-reaudit.md)** — platform.md
  converted to a dated checklist. No platform claim is trusted in the
  new repo until this runs on current Chrome (the Phase 2 gate); every
  flip becomes a ledger entry before code adapts.
- **[instruments.md](instruments.md)** — what measures this system and
  what ports. Headline finding: the capture recipes were never
  committed as code; in the new repo `instruments/` is maintained
  infrastructure.

What these do **not** replace: [decisions.md](../decisions.md) (the
evidence), [platform.md](../platform.md) (the observations),
[focus.md](../focus.md) (the focus behavior's own contract), and the
README's lab journal (the narrative). Those stay here, in the archive,
at full length — the seed is the index that makes them citable.
