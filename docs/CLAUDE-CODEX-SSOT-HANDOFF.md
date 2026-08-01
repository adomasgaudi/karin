# Claude–Codex SSOT handoff

Karin has one product pipeline:

```text
source JSONL → source indexer → lazy body → UnifiedSession → shared cycles → shared UI
```

## Contract

- `SessionDetail`, `Cycle`, `CycleBands`, `EventEntry`, `RecordRow`, `DiffView`, `JsonView`, and raw/JSON controls are shared.
- Claude/Codex differences belong in an indexer or a small source adapter branch: schema shape, measured versus estimated usage, encrypted versus plaintext reasoning, structured tool results, and source-only subagents.
- Never add a second Claude page or Codex page for a visual feature.
- Every normalized entry keeps its exact decorated source record in `UnifiedEntry.raw` when a source line exists. Raw views use that record, not the normalized projection.
- Every physical transcript stream has a unique feed `id` and body filename. A repeated provider id is retained as `logical_id`; it must never overwrite another stream.
- Every valid source line is rendered, merged/reclassified with a reason, explicitly unhandled with line numbers, or unavailable at provider level. The compact info-button audit is the ledger.
- Lazy-body fields must stay identical in `bin/karin.py`, `bin/karin_claude.py`, and `src/lib/hydrate.ts`.

## Agent rule

Before any new agent edits or reviews Karin, the parent must tell it to read this file and the SSOT section in `CLAUDE.md`. The agent must state which source parity path it is checking, preserve the shared pipeline, and report legitimate source-only exceptions separately from parity gaps. No agent may add a source-specific component when the shared path can carry the behavior.

## Repair milestones

- `93c47c1` fixed raw step/cycle fidelity, Codex duplicate edits, apply_patch diffs, line-level coverage auditing, Codex stream collisions, parse-error lines, and the Claude session cap.
- `bbd7d07` centered navigation freshness and made menu overflow source-neutral.
- `tools/verify_source_parity.py` checks unique feed ids, one-to-one body joins, and lazy-body field parity.

## Final verification

Run `pnpm typecheck`, Python compilation, `python tools/verify_source_parity.py`, then `./karin.ps1 -NoOpen`. Verify `http://localhost:4173/` is HTTP 200, the served bundle contains the current `v.N`, and Codex plus Claude watchers remain alive. Warp is intentionally out of scope for this repair.
