# Changelog

## 0.2.0

- **Forked conversations are deleted with their source.** A descendant is now read from the header
  lineage every Session carries (`SessionHeader.parentSession`), which DSH writes for both
  relations: the Subagent runtime sets it with `origin: 'subagent'`, and a fork sets it with
  `isSeeded`. 0.1.0 walked only the subagent catalog, so a conversation forked off the deleted one
  survived.
- The confirmation dialog names what goes with the delete by kind — *N subagent conversations* and
  *N conversations forked off it* — so deleting a family is never silent.
- `/inspect` reports `descendants: { count, subagents, derived, ids, capped }`.
- Each descendant report in the delete response carries its `kind` (`subagent` / `derived`).
- The lineage walk is breadth-first with a visited set and a depth cap: DSH's own lineage traversal
  has no guard against a hand-edited `parentSession` cycle.

## 0.1.0

First release.

- Adds a **Delete conversation** row (order 500) to every session's `⋯` menu, with a confirmation
  dialog that states the session's real state before committing.
- Removes the session's artifact directory (every retained format generation), its workspace
  account, its archive/pin membership, and its projection-cache record, then emits
  `api-session/removed` so connected pages drop the row at once.
- Removes subagent descendants too, deepest first, collected before anything is deleted and capped
  at 200 sessions per delete.
- Gates on running work only (DSH's own `workspace/session-activity` admission), with a
  **Stop and delete** path that dispatches `workspace/session-stop` first.
- Deletes sessions the Host still holds open, instead of refusing them: measured on Windows, `rm`
  succeeds with the append handle open and later appends do not resurrect the file.
