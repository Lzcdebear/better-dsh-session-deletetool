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
2. **removes its subagent descendants** — child sessions are sessions of their own with their own
   logs. The whole subtree comes from the durable `subagentCatalog` projection
   (`ctx.subagents.listDescendants`) and is deleted **deepest first**. The subtree is collected
   *before* anything is removed, so a subtree over the 200-session cap aborts with nothing deleted;
3. **drops the workspace account** — the id leaves every Workspace record's `sessionIds`
   (`Workspace.detachSession`) and the registry-global archive and pin sets;
4. **drops the projection checkpoint** — the `session_projcache` domain record and its `<id>.json`
   file;
5. **tells connected pages** — one `api-session/removed` per removed id, the same event the shipped
   Session controller emits when a Session is disposed, so the rows leave the sidebar immediately.

Forked conversations are **not** touched: a fork is an independent session, it is not in the
subagent catalog, so deleting the original never takes a fork with it.

### What blocks a delete, and what does not

**Running work blocks it — being open does not.** The gate is DSH's own archive admission, the
`workspace/session-activity` waterfall: the Agent registry reports a running turn, the job registry
reports background jobs, the Subagent runtime reports running descendants, Schedule reports active
reminders. The dialog names what is still running and offers **Stop and delete**, which dispatches
`workspace/session-stop` first — exactly what `archiveSession(id, { stopActivity: true })` does.

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

1. Open the `⋯` menu on any session row and pick **删除会话**.
2. The dialog asks the Host for the session's real state and states it: what will be deleted,
   whether the Harness still holds it open, what is still running, and how many subagent
   conversations go with it.
3. Confirm. If work is running, the button reads **停止并删除** and stops that work first.
4. The row leaves the sidebar at once, and the data is gone from disk.

## HTTP surface

The Client half reaches the Host over two same-origin `exact` routes on `ctx.webServer`. A
build-free plain-JavaScript bundle cannot declare a typed `ctx.remote` namespace (that needs
generated Typert descriptors), so this uses the same transport the community plugin `dshmarket`
uses.

| Route | Method | Purpose |
|---|---|---|
| `/dsh-session-delete/inspect?sessionId=…` | GET | `stored` / `open` / `agent` / `running` / `activity` / `artifactDirectory` / `descendants` (`{ count, ids }`) |
| `/dsh-session-delete/delete` | POST | body `{ sessionId, stop? }`; returns `removed`, `descendants`, `stoppedActivity`, `runtime`, `activity` |

Both routes carry their own same-origin gate: `Host` must be loopback, `sec-fetch-site` must not be
`cross-site`, and a present `Origin` must match `Host`. Another site's page cannot reach them.

## Layout

| File | Role |
|---|---|
| `host.js` | Host half: the two routes, artifact/accounting/cache removal, subagent subtree |
| `client.js` | Client half: the `sidebar.workspaces.session.menu.item` row (order 500) and the `shell.overlay` confirmation dialog |
| `cordis.patch.yml` | Inserts the Host row into the profile's layer stack |
| `test/host.test.mjs` | Route tests over real temporary directories |
| `icon.svg` | Plugin artwork |

Styles use only host theme tokens (`--dsw-alias-*`), so light and dark both read; the UI is
localized (English / 简体中文) through the Client locale service.

## Development

```sh
node --test test/host.test.mjs
```

The tests drive the real `apply()` registration against fake Host services and real temporary
directories: deletion, the running-work gate and its stop path, the subagent subtree, the inspect
report, and the refusal paths (bad id, bad body, wrong method, cross-site origin).

## License

[MIT](LICENSE)
