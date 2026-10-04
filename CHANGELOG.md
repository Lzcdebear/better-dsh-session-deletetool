# Changelog

## 0.4.0

**The package is `better-dsh-session-deletetool` now.** Every name that pointed at the old identity was
renamed in one pass, so nothing resolves the old spelling any more:

- the npm package name, the GitHub repository (`Lzcdebear/better-dsh-session-deletetool`), and the
  `repository` / `homepage` / `bugs` URLs plus every install target in the READMEs;
- the four Host routes: `/better-dsh-session-deletetool/inspect`, `/delete`, `/catalog` and
  `/delete-batch`;
- the client module id, the locale namespace, the sidebar menu row, both `shell.overlay` seats and the
  bulk anchor's registration ids, the `data-dsh-plugin` marker, and the React display name;
- the Host loader row in `cordis.patch.yml` — both the row `id` and the module `name` the profile
  imports;
- the Host's `[better-dsh-session-deletetool]` log prefix and its effect labels.

**The family view is written down now.** The dialogs have drawn a conversation's subagents and derived
conversations as one tree for several releases, but neither README said so out loud. Both now open that
section by saying that the sidebar cannot show the relation and the dialog is the one place it is
drawn, and the npm description says it too.

A profile that had the old name linked has to link the new one: the bundle key in
`dsh.profile.bundles` and the dependency key in the profile's own `package.json` both change.

## 0.3.9

**Both dialogs now draw the same family tree.** The single conversation's dialog and the bulk one share
one renderer: a row per Session, and under every row a collapsible **子智能体 (n)** block followed by
a collapsible **派生对话 (n)** block holding that row's own direct children. A derived conversation
keeps its own subagents *and* its own derived conversations inside its own block, one step further in,
so a fork of a fork is nested where it belongs instead of appearing in a second list that only shares
a heading with its parent.

**The duplicated rows are gone.** 0.3.7 drew each family twice over, once per relation, each pass
walking the whole forest: a subagent hanging under a fork was listed both flat in the root's 子智能体
branch and again inside its real parent. One forest is now built once (`buildForest`) and drawn once
(`FamilyTree`), so every row is drawn by exactly one parent — which is what makes the shape readable.

**Every row's checkbox means its own subtree.** A row is ticked when everything below it is ticked,
mixed when only part of it is, and pressing it takes or clears that whole subtree; a block's checkbox
covers the rows the block lists. The old "selected roots plus excluded children" pair is gone: the
delete set is one set of ids, so the picture and the count can no longer drift apart.

**In the bulk dialog a child can now be ticked on its own.** Every ticked row whose parent is not
ticked is sent as a delete root of its own, carrying the ticked rows below it — so ticking a single
subagent deletes just that subagent, and ticking a parent takes its selected family with it.

**Each row carries its kind's glyph**: a document for a conversation, a robot head for the 子智能体
block and a person for a subagent, a chain for the 派生对话 block and a chat bubble for a derived
conversation — 16px outline paths, `fill: none`, `stroke: currentColor`, matching the icon set they
sit beside. Nothing else changed: the nesting is still the indentation alone, one step per level, with
no connectors and no guide lines.

## 0.3.7

**The connector lines are gone.** The tree's nesting is the indentation alone: one step per level, the
same reading the rest of the sidebar uses. A drawn guide line under every parent added nothing the
indent did not already say, and it made the rows busier than the list they sit in.

Everything else from 0.3.6 stands: row 1 is this conversation, row 2 is its own subagent branch, row 3
is the forked conversations with each fork's subagents inside it and a fork of a fork nested in its
parent's block.

## 0.3.6

**The picker is the family tree now, drawn as one.** 0.2.1's two flat lists could not say what the
reference layout says, so the dialog is drawn that way from the top down:

- row 1 is this conversation, carrying the whole family's checkbox and named as the sidebar names it;
- row 2 is one collapsible **子智能体 (n)** branch holding this conversation's own subagents;
- row 3 is one collapsible **派生对话 (n)** branch, and each fork inside it keeps *its own* subagent
  branch — so a fork of a fork is drawn inside its parent's block, indented one more step, instead of
  being listed beside it. A subagent that spawned a conversation keeps that conversation inside the
  subagent's own block for the same reason.
- Guide lines drop from each parent to the children it draws, and indent tracks the tree, so a level-3
  row reads as hanging off the level-2 row above it and not merely as "somewhere deeper".

**The layout came from the sketch, not the data model.** The Host still answers one deepest-first
list; the client arranges it into a tree and draws each branch as a *view* of that tree, indented from
the nearest ancestor the branch actually draws. Nothing is ever indented under a row that is not on
screen.

**Ticks are derived, not stored twice.** A row is in the delete set when it is a selected root or sits
beneath one. A subagent is a Session of its own, so a fork's checkbox reports the subagents under it
without claiming them for a second delete — which is what kept the footer's count honest.

## 0.3.5

**A group now shows its own nesting.** 0.3.4 arranged the family as one tree but then filtered it into
the two groups, and filtering flattened the tree: a level-2 child stayed indented under a level-1
parent the group did not draw, so nothing on screen said which level-1 child it belonged to.
`groupNodes` walks the arranged family in pre-order and counts each group's indent from the nearest
ancestor *that group draws*, so a parent is followed by its own children, one step in, and the next
family starts at the top of the column again. A group's checkbox, its root rows and the delete payload
are unchanged: a picked row still answers to the same root it did before.

**The family's read failures are reported, not swallowed.** The descendant list comes from two durable
sources, and either one failing used to be invisible — the dialog simply drew fewer rows, which is
indistinguishable from a conversation that genuinely has no children. `/inspect` now carries the
warnings it collected (a catalog that would not open, a branch that could not be read), and the
per-Session dialog prints them above the list.

## 0.3.4

**The per-Session picker is 0.2.1's layout again, with the lineage fixed.** 0.3.2 removed the two
collapsible groups to fix a nesting bug; that threw away a shape that was doing its job, so the groups
are back: one master row, then *subagent conversations* and *forked conversations*, each with its own
count, its own checkbox and its own disclosure caret, and every row keeps its title, its id tail and
its state badges.

**What actually changed is where a row's position comes from.** Both 0.2.1 and 0.3.2 drew rows in the
order the Host sent them, and the Host sends the family deepest-first because that is the order its
own delete walk wants. Splitting that into groups put a grandchild in one group and its parent in
another, where the grandchild became a top-level row and drew indented above the row it hangs under.
The whole family is now arranged once — every row follows the row it hangs under, with the depth
counted from the nearest row the picker actually draws — and only then split by relation, so each
group keeps its own order without ever inverting a parent and its child.

**Indentation is one step per level.** Rows are indented by the arranged depth alone (16px a level, the
same step the bulk dialog uses), where 0.2.1 added a fixed extra level for every row: a
one-level-deep child read as though it hung off something that was not there.

## 0.3.3

**Missing subagents in the per-Session dialog, fixed at the source.** The family was read from two
places, and the subagent half leaned on `ctx.subagents.listDescendants`, which walks that service's
own session store: when that lookup is unavailable, the call throws and *every* subagent disappears
from the dialog at once, leaving only the forked conversations the header lineage names. The catalog
is now read the way the Subagent runtime itself reads it — per parent, from that parent's own
`subagentCatalog` projection through `sessionQuery.observeSession` — and walked from the target
downwards. The service call is still made, merged by closest depth, so neither source is a single
point of failure. Observation leases are freed through `Symbol.dispose` in a `finally`: the lease has
no `release()`, and a walk that never disposed would pin every parent it read in the query cache.

**Nesting now comes from the right parent.** Because the walk descends through each parent's own
catalog, a subagent a *child conversation* spawned is listed under that child rather than under the
target, and the header lineage now descends through children the catalog did not produce too. So the
dialog draws one family per level:

```
母会话
  子代理
  子会话
    子会话 1 的子代理
  子会话 2
    子会话 2 的子代理
```

## 0.3.2

**The 子 / 母 label is gone.** The nesting reads from indentation alone, as it does in the rest of the
sidebar. A family shows its shape: one step of indent per level, parents above their own children.
The catalog still reports `hasChildren` and the family counts, so nothing else had to change.

**The per-Session picker draws the family as one tree.** It used to split the descendants into two
collapsible groups by relation — *subagent conversations* and *forked conversations* — and arrange
each group on its own. A grandchild whose parent landed in the other group was therefore drawn as a
top-level row, indented, above the row it actually hangs under. The family is now arranged as a whole
with the same rule the bulk view uses, so every row follows the row it hangs under and the
indentation is the nesting. The per-kind groups and their collapse controls went with it: the list is
one tree, and the master checkbox still clears or takes the whole family.

## 0.3.1

Four fixes to the bulk view, three of them visible on first use.

**The glyph's colour now matches its neighbours.** The control was drawn as the source SVG is
authored — a filled glyph — while the shipped product icon set is outline-only (`fill: none`,
`stroke: currentColor`, `strokeWidth: 1` on a 16px box). A filled path painting a 32-unit outline
shape rendered as a blob at 16px, so the button looked empty beside the search icon. The glyph is now
stroked in the icon set's own convention, with the stroke scaled for the halved viewBox.

**Every row carries its 子 / 母 mark.** A conversation with no children of its own in the list left
the mark blank. A row that is not a child now reads as 母 by default, so the three states are 母,
子, and 子母 for a child that has children of its own. The mark's cell is sized for two characters, so
子母 no longer shifts the title along.

**Names come from the Session, not from "untitled".** The title read was wrong: the folded snapshot
is `{ session, title: { title, … } }`, and the code read `value.title` — an object, which failed its
own string check, so every Session reported no title and both dialogs fell back to *untitled*. Rows
now resolve a display name the way the sidebar does: the durable title when the log carries one, else
the final segment of the project directory, else the id. That fixes the bulk list and the 0.2.1
per-Session dialog together, the latter including its subagent and forked children, which now read as
the project directory rather than *untitled* when they were never renamed.

**Lineage children can carry their own directory.** The descendant walk now passes each child's
`cwd` from its header, so a descendant that was never named falls back to its project directory
before falling back to its id.

## 0.3.0

One control beside the workspace search icon deletes many conversations at once.

**A bulk entry beside the search icon.** The sidebar's workspace header gains a trash control, drawn
from `deleting icon.svg`, immediately left of the search icon. It opens one dialog for every
conversation the Host knows.

**The list is grouped by Workspace and keeps lineages together.** Rows are sectioned by the Workspace
that owns the conversation's directory, in the registry's own order, with one "未归类" section for
conversations no Workspace owns. Inside a section, parents lead their children, indented by lineage
depth. Every row leads with the blue **子** / **母** mark: `母` for a conversation with children in
this list, `子` for one spawned as a subagent or forked off another, `子母` for both.

**Selection follows the family, per row.** Ticking a parent takes its whole family with it; ticking a
child selects it on its own. A child can be taken back off a ticked family without untick-ing the
parent, and the footer always states how many conversations the press will delete. The dialog carries
the same "stop unfinished work first" choice the single-Session dialog offers.

**API.** `GET /catalog` answers
`{ ok, workspaces: [{ key, workspaceId, title, path, sessions[] }], totals }`, and each session row
carries `id`, `kind` (`root` / `subagent` / `derived`), `depth`, `parentId`, `hasChildren`, `family`,
`subagents`, `derived`, `title`, `cwd`, `open`, `agent`, `running` and `activity`.
`POST /delete-batch` takes `{ roots: [{ sessionId, descendants? }], stop? }` and answers
`{ ok, roots, removed[], failed[] }` — one entry per root, so a failing root is reported without
aborting the rest.

**Where the control is mounted, and why.** `sidebar.workspaces` is a `single` slot, so a second
registrant would shadow the shipped browser instead of sitting beside it. The plugin therefore
registers in `sidebar.footer.action` (which renders nothing itself) and mounts its control into the
browsing region's own search slot through a portal and one `MutationObserver`, re-creating the
control whenever React re-renders that header. The insertion carries no authority: it only opens the
dialog, and the two Host routes above do all the work. If a future harness renames that slot's CSS
class, the control stops appearing and nothing else changes.

**Unchanged.** The per-Session "⋯" menu entry and its descendant picker behave exactly as in 0.2.1;
the bulk path calls the same delete for each selected conversation.

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
