# dsh-session-delete

**Delete a conversation from DeepSeek Harness — DSH ships archive only.**

[中文说明](README.zh-CN.md)

---

## Why this exists

DSH can only *archive* a conversation. Archiving hides the row from the sidebar and keeps every
artifact: the log, the workspace account, the projection checkpoint all stay on disk, and the
conversation can be restored at any time. The persistence seam has no deletion API at all —
`@deepseek-ai/dsh-session-persistence-jsonl` states it plainly:

> **Nothing deletes session files** — logs accumulate under `root` until removed externally; the
> seam has no deletion API.

So a long-lived profile accumulates conversations forever. This plugin adds the missing step: a
**Delete conversation** row in each session's `⋯` menu that really removes the data.

## What it deletes

For the chosen session, the Host half:

1. **removes the session's artifact directory** — the current log, every retained historical format
   generation, and any session-local file in it (`ctx.sessionPersistence.locate(header)` gives the
   path);
2. **removes the descendants you selected** — child sessions are sessions of their own with their own
   logs. DSH records every child in its parent's header (`SessionHeader.parentSession`), and writes
   that field for every relation it creates: the Subagent runtime sets it with `origin: 'subagent'`,
   a fork sets it with `isSeeded`, and Agent Teams resolves its roster through the same field. The
   plugin walks that lineage breadth-first and unions it with the durable `subagentCatalog`
   projection (`ctx.subagents.listDescendants`), so a child whose own header no longer reads is still
   named. Descendants are deleted **deepest first**, gathered *before* anything is removed, and only
   the ticked ones go — up to 200 per request;
3. **drops the workspace account** — the id leaves every Workspace record's `sessionIds`
   (`Workspace.detachSession`) and the registry-global archive and pin sets;
4. **drops the projection checkpoint** — the `session_projcache` domain record and its `<id>.json`
   file;
5. **closes the shells the session owned** — `ctx.terminals` are part of no admission family, and the
   service only reaps them when the Agent is released, which can be long after the log is gone;
6. **tells connected pages** — one `api-session/removed` per removed id, the same event the shipped
   Session controller emits when a Session is disposed, so the rows leave the sidebar immediately.

### Choosing what goes with it

The dialog draws the session's whole family as **one tree**:

- row 1 is this conversation, carrying the whole family's checkbox and named as the sidebar names it;
- row 2 is one collapsible **Subagents (n)** branch holding the subagents this conversation spawned;
- row 3 is one collapsible **Forked conversations (n)** branch, and each fork inside it keeps *its own*
  Subagents branch — so a fork of a fork is drawn inside its parent's block, one step further in,
  instead of being listed beside it. A subagent that spawned a conversation keeps that conversation
  inside the subagent's own block for the same reason;
- every row has a checkbox, its name and the tail of its id, and is badged when it is open or has
  unfinished work. Names follow the sidebar's own rule — the durable title, else the final segment of
  the project directory, else the id — so nothing reads as *untitled*;
- the nesting is the **indentation** alone, one step per level: a parent is followed immediately by the
  children it draws, so a level-3 row reads as hanging off the level-2 row above it rather than merely
  as "somewhere deeper".

A row's checkbox covers **its own subtree**: ticked when everything below it is ticked, mixed when only
part of it is, and pressing it takes or clears that whole subtree. A block's checkbox covers the rows
the block lists. The delete set is one set of ids, with no second "excluded rows" state beside it, so
the picture and the footer's count cannot drift apart.

Leads that could not be read are reported above the list (a branch whose directory would not open, for
example) instead of quietly costing rows: a missing row and a conversation that genuinely has no
children used to look exactly alike.

Confirming posts exactly the ticked ids and the button states how many conversations will go.
Unticked descendants survive as conversation roots. The selection is validated against the Host's own
walk, so a request can only ever name Sessions in that lineage. A fork is a conversation in its own
right, which is exactly why it is listed with a checkbox instead of being taken silently.

### Deleting in bulk

A trash control sits in the workspace section header, immediately **left of the search icon** (it
draws the `deleting icon.svg` glyph). It opens one dialog over every conversation the Host knows:

- **Sectioned by Workspace**, in the registry's own order, each headed by the Workspace title and its
  conversation count; conversations no Workspace owns land in a final **Ungrouped** section.
- **Each conversation is drawn as the same tree the single-session dialog draws**: under a row come its
  collapsible **Subagents (n)** and **Forked conversations (n)** blocks, and a derived conversation
  carries its own level inside its own block, so the hierarchy is the indentation alone.
- **Names follow the sidebar's own rule**: the durable title when the log carries one, else the final
  segment of the project directory (for example `Project_lzc`), else the id. A conversation that was
  never renamed therefore reads as its directory rather than as *untitled*.
- **Selection follows the subtree, and a child can be deleted on its own.** Ticking a parent takes the
  ticked rows below it; ticking one subagent without its parent sends that subagent as a delete root of
  its own and leaves the parent alone. The footer button always states how many conversations the press
  will delete.

The dialog carries the same **stop unfinished work first** switch as the single-session one, on by
default. Confirming runs the delete above once per ticked root; a root that fails is listed and the
rest still go.

### What blocks a delete, and what does not

**Running work blocks it — being open does not.** The gate is DSH's own archive admission, the
`workspace/session-activity` waterfall: the Agent registry reports a running turn, the job registry
reports background jobs, the Subagent runtime reports running descendants, Schedule reports active
reminders. The question is asked **once per Session in the delete set**, because the admission answers
per Session: a descendant's running turn or background job is not reported when only the target is
asked. The dialog names what is still running — on each row and in the summary — and offers
**Stop and delete**, which dispatches `workspace/session-stop` for every busy Session first, exactly
what `archiveSession(id, { stopActivity: true })` does.

A session the Host still holds open (`ctx.sessions` / `ctx.agents`) is deleted anyway. Measured on
Windows: `rm` succeeds while the append handle is open, the directory entry disappears at once, and
later appends land in the unlinked file instead of resurrecting it. An earlier version refused such
sessions with "switch away first", which wrongly blocked conversations that were not on screen.

### Known limits

- **Attachment blobs are not removed.** Uploaded images and files live in
  `~/.dsh/attachments/v1/objects/<hash>`, a content-addressed store shared by sessions, and the
  service has no reference counting, so those blobs stay.
- **The search index looks after itself.** `dsh-session-query-sqlite` is a derived index that
  reconciles against persistence on every search, so a deleted source stops being returned from the
  next search on.
- **A held-open session may leave one inert cache record.** If the Host still owns the session when
  it is deleted, its disposal can write one more projection checkpoint. That record is never read
  (no log means no session) — a few tens of KB of dead file.
- **Plugin code changes need a DSH restart.** In a profile whose HMR does not watch module files,
  replacing the code of an installed bundle requires a restart. The client half only needs a page
  refresh.

## Install

Everything below goes through DSH's own plugin manager, which accepts an install spec
(`@deepseek-ai/dsh-plugin-manager`): a registry name, a git host shorthand, a repository URL, a
tarball, or an absolute local path. Pick whichever route your network allows.

### 1. Straight from GitHub (needs github.com reachable)

Spec:

```
github:Lzcdebear/dsh-delete-session
```

or, equivalently:

```
https://github.com/Lzcdebear/dsh-delete-session
```

Give it to DSH:

- **In the app:** Settings → Plugins → the install entry, paste the spec. (The Plugin Manager UI and
  the `plugin_manager` tool take exactly the same spec string.)
- **Through an agent session:** ask the agent to install it — the tool call is `plugin_manager` with
  `action: "install_bundle"` and `target: "github:Lzcdebear/dsh-delete-session"`.

Pin a ref with `#`: `github:Lzcdebear/dsh-delete-session#v0.1.0`.

If the connection check fails, DSH reports a bounded log path. On a network where github.com is not
reachable, use route 2 or 3 — or point git at your proxy first
(`git config --global http.proxy http://127.0.0.1:7890`).

### 2. From a local copy (works offline)

Download the repository (ZIP or `git clone`), unpack it anywhere, then install the **absolute
directory**:

```
plugin_manager { action: "install_bundle", target: "D:\\plugins\\dsh-delete-session" }
```

DSH records a `link:` dependency and reloads the profile. This is the route used to develop the
plugin, and the one to use behind a restrictive network.

### 3. From the release tarball

```
https://github.com/Lzcdebear/dsh-delete-session/archive/refs/heads/main.tar.gz
```

Same install entry as route 1; useful when git is unavailable but HTTPS is not.

### After installing

The Host half loads with the profile. The Client half appears after the page is refreshed. The row
shows up in the session `⋯` menu as **删除会话 / Delete conversation**.

To remove the plugin again, use the same manager:
`plugin_manager { action: "remove_bundle", target: "dsh-session-delete" }` (the bundle key is the
package name).

## Usage

1. Open the `⋯` menu on any session row and pick **Delete conversation**.
2. The dialog asks the Host for the session's real state and states it: what will be deleted,
   whether the Harness still holds it open, and what is still running.
3. It then draws the whole family as a tree to choose from: this conversation on its own row, then its
   **Subagents (n)** and **Forked conversations (n)** blocks, each derived conversation carrying its own
   level inside its block, and a checkbox on every row (title, id tail, state badge). Untick whatever
   you want to keep.
4. Confirm. The button states how many conversations will go; if work is running it reads
   **Stop and delete** and stops that work first.
5. The rows leave the sidebar at once, and the data is gone from disk.

For bulk: press the trash control in the workspace section header, **left of the search icon**, tick
conversations in the Workspace-sectioned list (ticking a parent brings its children, a child can be
ticked or unticked on its own), then confirm.

## HTTP surface

The Client half reaches the Host over four same-origin `exact` routes on `ctx.webServer`. A
build-free plain-JavaScript bundle cannot declare a typed `ctx.remote` namespace (that needs
generated Typert descriptors), so this uses the same transport the community plugin `dshmarket`
uses.

| Route | Method | Purpose |
|---|---|---|
| `/dsh-session-delete/inspect?sessionId=…` | GET | `stored` / `open` / `agent` / `running` / `activity` / `artifactDirectory` / `warnings` (the leads that could not be read, so a missing branch is never mistaken for a childless one), and `descendants` = `{ count, subagents, derived, truncated, maxDeletable, items[] }` where each item carries `id`, `kind`, `depth`, `parentId`, `title`, `open`, `agent`, `running` and its own `activity` |
| `/dsh-session-delete/delete` | POST | body `{ sessionId, stop?, descendants? }` — `descendants` omitted means the whole family, an empty array means the session alone; returns `removed`, `descendants` (each with its `kind`), `kept`, `stoppedActivity`, `terminalsKilled`, `warnings`, `runtime`, `activity`. A name outside the family is refused with `400 unknown-descendant` before anything is removed |
| `/dsh-session-delete/catalog` | GET | `{ ok, workspaces: [{ key, workspaceId, title, path, sessions[] }], totals }`; each session row carries `id`, `kind` (`root` / `subagent` / `derived`), `depth`, `parentId`, `hasChildren`, `family`, `subagents`, `derived`, `title`, `cwd`, `open`, `agent`, `running`, `activity`. Section order is the registry's own Workspace order, and the section whose `workspaceId` is `null` is Ungrouped |
| `/dsh-session-delete/delete-batch` | POST | body `{ roots: [{ sessionId, descendants? }], stop? }`, each root running the single-session delete once; returns `{ ok, roots, removed[], failed[] }`. A failing root is reported as one `failed` entry and the rest are still attempted. At most 200 roots per request |

All four routes carry their own same-origin gate: `Host` must be loopback, `sec-fetch-site` must not
be `cross-site`, and a present `Origin` must match `Host`. Another site's page cannot reach them.

## Layout

| File | Role |
|---|---|
| `host.js` | Host half: the four routes, artifact/accounting/cache removal, the subagent subtree, and the Workspace-sectioned catalog |
| `client.js` | Client half: the `sidebar.workspaces.session.menu.item` row (order 500), the bulk control, and the two `shell.overlay` dialogs |
| `cordis.patch.yml` | Inserts the Host row into the profile's layer stack |
| `test/host.test.mjs` | Route tests over real temporary directories |
| `icon.svg` | Plugin artwork (the bulk control draws `deleting icon.svg`) |

Styles use only host theme tokens (`--dsw-alias-*`), so light and dark both read; the UI is
localized (English / 简体中文) through the Client locale service.

Why the bulk entry is not a slot registration of its own: `sidebar.workspaces` is a `single` slot, so
a second registrant would **shadow** the shipped session browser instead of sitting beside it. The
Client half therefore registers in `sidebar.footer.action` (rendering nothing there) and mounts its
control into the browser's own search cell through a portal and one `MutationObserver`, which
re-creates the control when React re-renders that header. That insertion carries no authority beyond
opening the dialog; the two Host routes do the work. If a future harness renames that cell's CSS
class, the control stops appearing and nothing else changes.

## Development

```sh
node --test test/host.test.mjs
```

The tests drive the real `apply()` registration against fake Host services and real temporary
directories: deletion, the running-work gate and its stop path, the subagent subtree, the inspect
report, and the refusal paths (bad id, bad body, wrong method, cross-site origin).

## License

[MIT](LICENSE)

## Author

- Bilibili: <https://space.bilibili.com/220996778>
