# better-dsh-session-deletetool

**Delete a DeepSeek Harness conversation for real, and manage the whole family around it.**

DSH ships archive only. This plugin adds a real delete — session log, Workspace account, archive/pin
membership and projection-cache record — and surrounds it with the numbers and folders you need to
decide what to remove.

[中文说明](README.zh-CN.md)

---

## What it adds

- **Real delete.** The log directory goes, the Workspace record forgets the session, archive and pin
  membership are cleared, and the projection-cache record is dropped. DSH's own archive only hides.
- **The conversation family, as a tree.** A main conversation, its forked conversations and its
  subagents, nested by `parentSession` — a subagent that spawned its own subagent sits one level
  deeper. Every node has a checkbox; ticking a parent takes its descendants.
- **Usage per conversation.** A node counts only the requests it made itself. A parent also shows
  `own/family`, the family total after a slash.
- **Three-way token bar.** Cache-hit input (green), cache-miss input (blue), output (yellow), with the
  three percentages underneath. Cache hit rate = hit / (hit + miss + write).
- **Fork-aware counting.** A forked conversation's inherited log prefix is skipped, and requests are
  de-duplicated by message id, so a fork never re-counts its parent's past.
- **Local folders.** A folder button on every row opens that node's directory. The Host resolves the
  path through `sessionPersistence.locate`; it is never rebuilt from a conversation title.
- **Bulk management.** One card per family with search, sort by last activity / tokens / hit rate,
  filters by kind and Workspace, paging, per-page select, delete selected, and delete all behind a
  second confirmation.
- **Cache controls.** Open DSH's projection-cache folder, or refresh the plugin's own usage cache.

## Install

All routes go through DSH's plugin manager:

```bash
npm install better-dsh-session-deletetool
```

- GitHub: `plugin_manager { action: "install_bundle", target: "github:Lzcdebear/better-dsh-session-deletetool" }`
- Local copy: `plugin_manager { action: "install_bundle", target: "<absolute path to the unpacked folder>" }`
- Tarball: `https://github.com/Lzcdebear/better-dsh-session-deletetool/archive/refs/heads/main.tar.gz`

Refresh the page after installing. Changes to the Host half need a full restart of DSH.

To remove: `plugin_manager { action: "remove_bundle", target: "better-dsh-session-deletetool" }`.

## Usage

**One conversation.** Open a session's `⋯` menu and pick **Delete conversation**. The dialog shows the
family tree, that conversation's own usage and family total, the cache split, and a folder button on
every row.

**Bulk.** Press the trash control in the Workspace header, left of the search icon. Each family is a
card; tick rows, filter, sort, page, then delete the selection or every conversation.

Before deleting, the Host asks DSH's own activity admission. Running work is reported; it is stopped
only after you confirm.

## HTTP surface

Same-origin routes on `ctx.webServer`:

| Route | Method | Purpose |
|---|---|---|
| `/better-dsh-session-deletetool/inspect?sessionId=…` | GET | state, family rows, usage and folder per node |
| `/better-dsh-session-deletetool/delete` | POST | `{ sessionId, stop?, descendants? }` |
| `/better-dsh-session-deletetool/catalog` | GET | every session with usage and folder, plus a corpus summary |
| `/better-dsh-session-deletetool/delete-batch` | POST | `{ roots: [{ sessionId, descendants? }], stop?, cleanCache? }` |
| `/better-dsh-session-deletetool/open-directory` | POST | `{ sessionId }` — open that session's folder |
| `/better-dsh-session-deletetool/open-cache` | POST | open DSH's projection-cache folder |
| `/better-dsh-session-deletetool/refresh-stats` | POST | drop the plugin's cached usage folds |

Every route carries a loopback and same-origin gate, so another page cannot reach them.

## Layout

| File | Role |
|---|---|
| `host.js` | Host half: the routes, removal, family walk, catalog and corpus totals |
| `session-model.js` | Usage folding, directory resolution, cache invalidation |
| `client.js` | Client half: the menu row, the bulk control, and the two dialogs |
| `cordis.patch.yml` | Inserts the Host row into the profile's layer stack |
| `test/host.test.mjs` | Route tests over real temporary directories |
| `icon.svg` | Plugin artwork |

Styles use host theme tokens (`--dsw-alias-*`) only, so light and dark both read; the UI is localized
(English / 简体中文) through the Client locale service.

## Known limits

- Fork lineage is read from `inheritedEventCount`. This build has no fork sample, so that path follows
  the field's meaning but has not been exercised against real data.
- A session whose folder the backend cannot locate keeps its folder button disabled, with the reason
  in its tooltip.
- Usage is folded from each log on first read; later reads reuse a size + mtime cache. About ninety
  sessions fold in under a second on this machine.

## Development

```sh
node --test test/host.test.mjs
```

## License

[MIT](LICENSE)

## Author

- Bilibili: <https://space.bilibili.com/220996778>
