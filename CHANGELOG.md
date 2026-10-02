# Changelog

## 0.2.1

Deleting a conversation is a choice now, not a take-it-all.

**Pick what goes with it.** The confirmation dialog lists the session's whole family and lets you
choose:

- one **delete all** checkbox, with an indeterminate state when the selection is partial;
- one collapsible group per relation — *subagent conversations* and *forked conversations*;
- one checkbox per descendant, indented by lineage depth, labelled with its title and the tail of its
  id, and badged when it is open or still has work running.

Confirming posts exactly the ticked ids, and the button states how many conversations will go.
Unticked descendants survive as conversation roots.

**The family is complete and the selection is validated.** Descendants come from the header lineage
every Session carries (`SessionHeader.parentSession`) — which covers subagent sessions, forked
conversations, and the child Sessions Agent Teams provisions — unioned with the durable
`subagentCatalog` projection for children whose own header no longer reads. The Host validates the
client's selection against its own walk, so a request can only ever name Sessions in that lineage
(`400 unknown-descendant` otherwise). Omitting the field still means "all of them".

**A gate bug, fixed.** Running work was only checked for the target Session, but DSH's archive
admission answers per Session: a descendant's running turn or background job was invisible, so a child
could be deleted mid-run. Every Session in the delete set is now asked, the refusal names each busy
Session (`activeSessions` in the details, badges on the rows), and `stop: true` dispatches
`workspace/session-stop` for all of them.

**Shells no longer outlive their conversation.** Terminals belong to no admission family, and the
service only reaps them when the Agent is released — which can be long after the log is gone. Each
deleted Session's terminals are now closed, reported as `terminalsKilled`.

**API.** `GET /inspect` answers with `descendants: { count, subagents, derived, truncated,
maxDeletable, items[] }`, each item carrying `id`, `kind`, `depth`, `parentId`, `title`, `open`,
`agent`, `running` and its own `activity`. `POST /delete` takes `{ sessionId, stop?, descendants? }`
and answers with `kept`, `terminalsKilled` and `warnings` beside the per-Session reports. The
request-body ceiling is 64 KiB so a few hundred ids fit, and the 200-per-request cap applies to the
selection rather than to the whole family.

**Audited, deliberately unchanged.** Attachment blobs stay (content-addressed and shared; the service
has no reference counting), and the derived search index keeps reconciling itself.

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
