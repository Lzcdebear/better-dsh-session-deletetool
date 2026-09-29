# Changelog

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
