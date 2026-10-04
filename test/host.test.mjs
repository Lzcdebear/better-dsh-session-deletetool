/**
 * Host-half route test: exercises the real `apply()` registration against fake
 * Host services and a temporary artifact directory. Nothing here touches the
 * live profile; run it with the bundled Node:
 *
 *   node --test test/host.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../host.js'

/** One fake Host context carrying only what the routes touch. */
function fakeContext({ services = {}, activity = null } = {}) {
  const state = { routes: new Map(), emitted: [], stopped: [], logs: [] }
  const ctx = {
    logger: {
      info: (message) => state.logs.push(message),
      warn: (message) => state.logs.push(message),
    },
    effect: (factory) => {
      factory()
      return () => {}
    },
    emit: (event, ...args) => state.emitted.push([event, ...args]),
    get: (name) => services[name],
    waterfall: async (name, payload, fallback) => {
      assert.equal(name, 'workspace/session-activity')
      if (activity === null) return fallback()
      return activity(payload.sessionId)
    },
    parallel: async (name, payload) => {
      assert.equal(name, 'workspace/session-stop')
      state.stopped.push(payload.sessionId)
    },
    webServer: {
      register: (route) => {
        state.routes.set(route.path, route)
        return () => state.routes.delete(route.path)
      },
    },
  }
  apply(ctx)
  return { state }
}

/** One fake request: an async iterable body plus headers. */
function fakeRequest({ method = 'POST', url = '/', headers = {}, body = '' }) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:19387', 'sec-fetch-site': 'same-origin', ...headers },
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield Buffer.from(body, 'utf8')
    },
  }
}

/** One fake response capturing status and JSON payload. */
function fakeResponse() {
  return {
    status: 0,
    payload: null,
    headersSent: false,
    writableEnded: false,
    writeHead(status) {
      this.status = status
      this.headersSent = true
    },
    end(text) {
      this.writableEnded = true
      this.payload = JSON.parse(text)
    },
  }
}

/**
 * Call one registered route as the web server would, then wait for it.
 *
 * The wait is deadline-based, not tick-based: the route deletes real
 * directories, and a slow `rm` (a fresh file being scanned, a busy threadpool)
 * can outlast any fixed number of event-loop turns.
 */
async function call(state, path, request) {
  const route = state.routes.get(path)
  assert.ok(route !== undefined, `route ${path} is registered`)
  const response = fakeResponse()
  route.handler(request, response)
  const deadline = Date.now() + 15_000
  while (!response.writableEnded && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.equal(response.writableEnded, true, `the route answered; logs=${JSON.stringify(state.logs)}`)
  return response
}

const DELETE = '/dsh-session-delete/delete'
const INSPECT = '/dsh-session-delete/inspect'
const CATALOG = '/dsh-session-delete/catalog'
const BATCH = '/dsh-session-delete/delete-batch'

/** Build a temporary Session artifact directory that looks like the real one. */
async function fakeArtifact(sessionId) {
  const root = await mkdtemp(join(tmpdir(), 'dsd-test-'))
  const directory = join(root, '--F-OneDrive-Project_lzc--', sessionId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'session.v4.jsonl.zstd'), 'log')
  await writeFile(join(directory, 'session.v3.jsonl.zstd'), 'older')
  return directory
}

/**
 * Host fakes for one existing Session, optionally with descendants.
 *
 * `children` feeds the `subagents.listDescendants` roster. `lineage` feeds the
 * observed Session corpus (`sessionQuery.listSessions`), whose headers carry
 * `parentSession` / `origin` exactly as DSH writes them; the same corpus answers
 * `observeSession` per Session, so each parent's `subagentCatalog` is derived from
 * the spawnee's own header and the two sources cannot disagree. `lineage: null`
 * models a profile without the query service at all. `extraDirectories` gives
 * artifact paths to descendants that only the corpus names.
 */
function servicesFor({
  sessionId,
  directory,
  open = false,
  agent = undefined,
  children = [],
  lineage = [],
  extraDirectories = {},
  untitled = [],
  /** Per-parent `subagentCatalog` overrides: `{ [parentId]: [childId, …] }`. */
  catalog = {},
}) {
  const calls = { detached: 0, unarchived: 0, unpinned: 0, deleted: [], killedTerminals: [] }
  const directories = new Map([
    [sessionId, directory],
    ...children.map((child) => [child.id, child.directory]),
    ...Object.entries(extraDirectories),
  ])
  const terminals = new Map()
  return {
    calls,
    terminals: {
      list: (owner) => [...(terminals.get(owner) ?? [])].map((id) => ({ sessionId: id, type: 'shell', status: 'running' })),
      async kill(owner, id) {
        calls.killedTerminals.push(id)
        terminals.get(owner)?.delete(id)
        return true
      },
      hasTerminal(owner, id) {
        const set = terminals.get(owner) ?? new Set()
        set.add(id)
        terminals.set(owner, set)
      },
    },
    sessionPersistence: {
      async stat(id) {
        return directories.has(id) ? { header: { id, cwd: 'F:\\OneDrive\\Project_lzc' } } : undefined
      },
      locate(header) {
        return { kind: 'jsonl', path: join(directories.get(header.id), 'session.v4.jsonl.zstd') }
      },
    },
    sessions: { get: (id) => (open && id === sessionId ? { id } : undefined) },
    agents: { get: (id) => (agent !== undefined && id === sessionId ? agent : undefined) },
    ...(lineage === null ? {} : {
      sessionQuery: {
        async listSessions() { return lineage },
        // The shipped shape: the folded title snapshot is `{ session, title }`
        // where the nested title is the observation, not a string. A Session
        // whose log carries no title event is fulfilled without it.
        async readTitleSnapshots(ids) {
          return ids.map((id) => ({
            status: 'fulfilled',
            value: untitled.includes(id)
              ? { session: { id } }
              : { session: { id }, title: { title: `标题 ${id.slice(-4)}`, messageSeqs: [], source: { kind: 'fallback' } } },
          }))
        },
        // Each Session's own `subagentCatalog`: the parent-owned record of the
        // children it spawned, derived here from the spawnee's own header so the
        // fixture cannot disagree with itself. A Session with no spawned children
        // still answers, with an empty catalog — that is what makes a leaf a leaf.
        async observeSession(id) {
          // An explicit override stands in for a catalog the spawnee's header
          // cannot express (a grandchild whose own header is not on the corpus).
          const override = catalog[id]
          const spawned = (override ?? lineage
            .filter((record) => record?.header?.parentSession === id && record.header.origin === 'subagent')
            .map((record) => record.header.id))
            .map((childId) => ({ id: childId, createdAt: 0, mode: 'one-shot' }))
          // The lease's own shape: `retain()` plus `Symbol.dispose`, and no
          // `release()` — the walk must free what it read.
          return {
            header: { id },
            projections: { values: { subagentCatalog: spawned } },
            retain() { return this },
            [Symbol.dispose]() {},
          }
        },
      },
    }),
    subagents: {
      async listDescendants(id) {
        if (id !== sessionId) return []
        return children.map((child, index) => ({ kind: 'child', id: child.id, parentId: id, depth: child.depth ?? index + 1 }))
      },
    },
    workspaceRegistry: {
      list: () => [{ detachSession: async () => { calls.detached += 1 } }],
      unarchiveSession: async () => { calls.unarchived += 1 },
      unpinSession: async () => { calls.unpinned += 1 },
    },
    storageDomain: {
      get: (name) => (name === 'session_projcache'
        ? { table: () => ({ delete: async (id) => { calls.deleted.push(id); return true } }) }
        : undefined),
    },
  }
}

test('registers the delete, inspect, catalog and batch routes', () => {
  const { state } = fakeContext()
  assert.deepEqual([...state.routes.keys()].sort(), [DELETE, INSPECT, CATALOG, BATCH].sort())
  assert.equal(state.routes.get(DELETE).kind, 'exact')
  assert.equal(state.routes.get(CATALOG).kind, 'exact')
})

test('deletes the artifact directory, the accounting and the checkpoint', async () => {
  const sessionId = 'session-11111111-2222-3333-4444-555555555555'
  const directory = await fakeArtifact(sessionId)
  const services = servicesFor({ sessionId, directory })
  const { state } = fakeContext({ services })

  const response = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId }) }))

  assert.equal(response.status, 200)
  assert.equal(response.payload.ok, true)
  assert.equal(response.payload.removed.artifactDirectory, directory)
  assert.deepEqual(services.calls.deleted, [sessionId])
  assert.equal(services.calls.detached, 1)
  assert.equal(services.calls.unarchived, 1)
  assert.equal(services.calls.unpinned, 1)
  assert.deepEqual(state.emitted, [['api-session/removed', sessionId]])
  await assert.rejects(stat(directory), /ENOENT/)
})

test('deletes a Session the Host still holds open, and reports that fact', async () => {
  const sessionId = 'session-22222222-3333-4444-5555-666666666666'
  const directory = await fakeArtifact(sessionId)
  const services = servicesFor({ sessionId, directory, open: true, agent: { status: 'inactive' } })
  const { state } = fakeContext({ services })

  const response = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId }) }))

  assert.equal(response.status, 200)
  assert.deepEqual(response.payload.runtime, { open: true, agent: true, running: false })
  await assert.rejects(stat(directory), /ENOENT/)
})

test('refuses while work runs, then stops it and deletes on request', async () => {
  const sessionId = 'session-33333333-4444-5555-6666-777777777777'
  const directory = await fakeArtifact(sessionId)
  const services = servicesFor({ sessionId, directory, agent: { status: 'running' } })
  const { state } = fakeContext({
    services,
    activity: () => [{ kind: 'turn' }, { kind: 'job', items: [{ id: 'job-1', label: 'build' }] }],
  })

  const refused = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId }) }))
  assert.equal(refused.status, 409)
  assert.equal(refused.payload.code, 'session-active')
  assert.deepEqual(refused.payload.activity.map((entry) => entry.kind), ['turn', 'job'])
  assert.equal(refused.payload.activity[1].label, '运行中的后台任务')
  assert.equal((await stat(directory)).isDirectory(), true)
  assert.deepEqual(state.stopped, [])

  const accepted = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId, stop: true }) }))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.payload.stoppedActivity, true)
  assert.deepEqual(state.stopped, [sessionId])
  await assert.rejects(stat(directory), /ENOENT/)
})

test('takes the subagent descendants with it, deepest first', async () => {
  const sessionId = 'session-55555555-6666-7777-8888-999999999999'
  const childId = 'session-child1-0000-0000-0000-000000000001'
  const grandChildId = 'session-child2-0000-0000-0000-000000000002'
  const directory = await fakeArtifact(sessionId)
  const childDirectory = await fakeArtifact(childId)
  const grandChildDirectory = await fakeArtifact(grandChildId)
  const services = servicesFor({
    sessionId,
    directory,
    children: [
      { id: childId, directory: childDirectory, depth: 1 },
      { id: grandChildId, directory: grandChildDirectory, depth: 2 },
    ],
  })
  const { state } = fakeContext({ services })

  const response = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId }) }))

  assert.equal(response.status, 200)
  assert.deepEqual(response.payload.descendants.map((entry) => entry.sessionId), [grandChildId, childId])
  assert.equal(response.payload.descendants.every((entry) => entry.removed), true)
  assert.equal(response.payload.removed.sessionId, sessionId)
  assert.deepEqual(services.calls.deleted, [grandChildId, childId, sessionId])
  assert.deepEqual(state.emitted, [
    ['api-session/removed', grandChildId],
    ['api-session/removed', childId],
    ['api-session/removed', sessionId],
  ])
  await assert.rejects(stat(grandChildDirectory), /ENOENT/)
  await assert.rejects(stat(childDirectory), /ENOENT/)
  await assert.rejects(stat(directory), /ENOENT/)
})

test('inspect reports the state the page cannot see', async () => {
  const sessionId = 'session-44444444-5555-6666-7777-888888888888'
  const directory = await fakeArtifact(sessionId)
  const services = servicesFor({ sessionId, directory, open: true, agent: { status: 'running' } })
  const { state } = fakeContext({ services, activity: () => [{ kind: 'subagent', items: [] }] })

  const response = await call(state, INSPECT, fakeRequest({
    method: 'GET',
    url: `${INSPECT}?sessionId=${sessionId}`,
  }))

  assert.equal(response.status, 200)
  assert.equal(response.payload.stored, true)
  assert.equal(response.payload.open, true)
  assert.equal(response.payload.running, true)
  assert.equal(response.payload.artifactDirectory, directory)
  assert.deepEqual(response.payload.activity.map((entry) => entry.label), ['运行中的子智能体'])
  assert.deepEqual(response.payload.descendants, {
    count: 0, subagents: 0, derived: 0, truncated: false, maxDeletable: 200, items: [],
  })
})

test('takes forked conversations with it, from the header lineage', async () => {
  const sessionId = 'session-77777777-8888-9999-aaaa-bbbbbbbbbbbb'
  const forkId = 'session-fork01-0000-0000-0000-00000000000f'
  const nestedForkId = 'session-fork02-0000-0000-0000-0000000000ff'
  const directory = await fakeArtifact(sessionId)
  const forkDirectory = await fakeArtifact(forkId)
  const nestedForkDirectory = await fakeArtifact(nestedForkId)
  const services = servicesFor({
    sessionId,
    directory,
    extraDirectories: { [forkId]: forkDirectory, [nestedForkId]: nestedForkDirectory },
    // A fork writes parentSession plus isSeeded and leaves origin unset — the
    // shape that makes it invisible to the subagent catalog.
    lineage: [
      { header: { id: forkId, parentSession: sessionId, isSeeded: true, createdAt: 1 } },
      { header: { id: nestedForkId, parentSession: forkId, isSeeded: true, createdAt: 2 } },
      { header: { id: 'session-unrelated-0000-0000-0000-000000000000', cwd: 'x', createdAt: 3 } },
    ],
  })
  const { state } = fakeContext({ services })

  const response = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId }) }))

  assert.equal(response.status, 200)
  assert.deepEqual(response.payload.descendants.map((entry) => [entry.sessionId, entry.kind]), [
    [nestedForkId, 'derived'],
    [forkId, 'derived'],
  ])
  await assert.rejects(stat(nestedForkDirectory), /ENOENT/)
  await assert.rejects(stat(forkDirectory), /ENOENT/)
  await assert.rejects(stat(directory), /ENOENT/)
})

test('labels both relations in the state report', async () => {
  const sessionId = 'session-88888888-9999-aaaa-bbbb-cccccccccccc'
  const subagentId = 'session-subag1-0000-0000-0000-0000000000a1'
  const forkId = 'session-fork03-0000-0000-0000-0000000000f3'
  const directory = await fakeArtifact(sessionId)
  const subagentDirectory = await fakeArtifact(subagentId)
  const forkDirectory = await fakeArtifact(forkId)
  const services = servicesFor({
    sessionId,
    directory,
    children: [{ id: subagentId, directory: subagentDirectory }],
    extraDirectories: { [forkId]: forkDirectory },
    lineage: [
      { header: { id: subagentId, parentSession: sessionId, origin: 'subagent', createdAt: 1 } },
      { header: { id: forkId, parentSession: sessionId, isSeeded: true, createdAt: 2 } },
    ],
  })
  const { state } = fakeContext({ services })

  const response = await call(state, INSPECT, fakeRequest({
    method: 'GET',
    url: `${INSPECT}?sessionId=${sessionId}`,
  }))

  assert.equal(response.status, 200)
  assert.equal(response.payload.descendants.count, 2)
  assert.equal(response.payload.descendants.subagents, 1)
  assert.equal(response.payload.descendants.derived, 1)
  assert.equal(response.payload.descendants.truncated, false)
  assert.equal(response.payload.descendants.maxDeletable, 200)
  assert.deepEqual(
    response.payload.descendants.items.map((entry) => [entry.id, entry.kind, entry.parentId]).sort(),
    [[subagentId, 'subagent', sessionId], [forkId, 'derived', sessionId]].sort(),
  )
  // Each row carries what the dialog shows beside the checkbox.
  assert.deepEqual(response.payload.descendants.items.map((entry) => typeof entry.title), ['string', 'string'])
})

test('inspect nests a subagent under the child conversation that spawned it', async () => {
  const sessionId = 'session-99999999-aaaa-bbbb-cccc-dddddddddddd'
  const forkId = 'session-fork04-0000-0000-0000-0000000000f4'
  const nestedSubagentId = 'session-subag2-0000-0000-0000-0000000000a2'
  const directory = await fakeArtifact(sessionId)
  const forkDirectory = await fakeArtifact(forkId)
  const nestedDirectory = await fakeArtifact(nestedSubagentId)
  const services = servicesFor({
    sessionId,
    directory,
    extraDirectories: { [forkId]: forkDirectory, [nestedSubagentId]: nestedDirectory },
    // The shape the user hit: a forked conversation, and a subagent the FORK
    // spawned — a subagent that appears in no catalog hanging off the target.
    lineage: [
      { header: { id: forkId, parentSession: sessionId, isSeeded: true, createdAt: 2 } },
      { header: { id: nestedSubagentId, parentSession: forkId, origin: 'subagent', createdAt: 3 } },
    ],
  })
  const { state } = fakeContext({ services })

  const response = await call(state, INSPECT, fakeRequest({
    method: 'GET',
    url: `${INSPECT}?sessionId=${sessionId}`,
  }))

  assert.equal(response.status, 200)
  // Deepest first is the delete order; the dialog re-arranges it for display.
  assert.deepEqual(
    response.payload.descendants.items.map((entry) => [entry.id, entry.kind, entry.depth, entry.parentId]),
    [
      [nestedSubagentId, 'subagent', 2, forkId],
      [forkId, 'derived', 1, sessionId],
    ],
  )
  assert.equal(response.payload.descendants.count, 2)
  assert.equal(response.payload.descendants.subagents, 1)
  assert.equal(response.payload.descendants.derived, 1)
})

test('inspect finds a grandchild subagent the catalog knows and the lineage does not', async () => {
  const sessionId = 'session-12121212-3434-5656-7878-909090909090'
  const childId = 'session-child5-0000-0000-0000-000000000005'
  const grandchildId = 'session-subag3-0000-0000-0000-0000000000a3'
  const directory = await fakeArtifact(sessionId)
  const childDirectory = await fakeArtifact(childId)
  const grandchildDirectory = await fakeArtifact(grandchildId)
  const services = servicesFor({
    sessionId,
    directory,
    extraDirectories: { [childId]: childDirectory, [grandchildId]: grandchildDirectory },
    // Only the child's header is on the corpus: the grandchild is reachable
    // through the child's own catalog alone, which is the case the walk exists
    // for. `subagents.listDescendants` answers with the target's DIRECT children
    // only, exactly as a service that could not descend would.
    lineage: [{ header: { id: childId, parentSession: sessionId, origin: 'subagent', createdAt: 2 } }],
    children: [{ id: childId, directory: childDirectory }],
    catalog: { [childId]: [grandchildId] },
  })
  const { state } = fakeContext({ services })

  const response = await call(state, INSPECT, fakeRequest({
    method: 'GET',
    url: `${INSPECT}?sessionId=${sessionId}`,
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(
    response.payload.descendants.items.map((entry) => [entry.id, entry.kind, entry.depth, entry.parentId]),
    [
      [grandchildId, 'subagent', 2, childId],
      [childId, 'subagent', 1, sessionId],
    ],
  )
})

test('inspect names the descendants a delete would take with it', async () => {
  const sessionId = 'session-66666666-7777-8888-9999-aaaaaaaaaaaa'
  const childId = 'session-child3-0000-0000-0000-000000000003'
  const directory = await fakeArtifact(sessionId)
  const childDirectory = await fakeArtifact(childId)
  const services = servicesFor({ sessionId, directory, children: [{ id: childId, directory: childDirectory }] })
  const { state } = fakeContext({ services })

  const response = await call(state, INSPECT, fakeRequest({
    method: 'GET',
    url: `${INSPECT}?sessionId=${sessionId}`,
  }))

  assert.equal(response.status, 200)
  assert.deepEqual(response.payload.descendants, {
    count: 1,
    subagents: 1,
    derived: 0,
    truncated: false,
    maxDeletable: 200,
    items: [{
      id: childId,
      kind: 'subagent',
      depth: 1,
      parentId: sessionId,
      title: `标题 ${childId.slice(-4)}`,
      open: false,
      agent: false,
      running: false,
      activity: [],
    }],
  })
})

test('reports an unknown Session', async () => {
  const { state } = fakeContext({ services: servicesFor({ sessionId: 'session-other', directory: tmpdir() }) })
  const response = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId: 'session-missing' }) }))
  assert.equal(response.status, 404)
  assert.equal(response.payload.code, 'session-not-found')
})

test('rejects a malformed id, a bad body, another method and another origin', async () => {
  const services = servicesFor({ sessionId: 'session-x', directory: tmpdir() })
  const { state } = fakeContext({ services })

  const malformed = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId: '../etc' }) }))
  assert.equal(malformed.status, 400)

  const noBody = await call(state, DELETE, fakeRequest({ body: 'not json' }))
  assert.equal(noBody.status, 400)

  const wrongMethod = await call(state, DELETE, fakeRequest({ method: 'GET' }))
  assert.equal(wrongMethod.status, 405)

  const wrongInspectMethod = await call(state, INSPECT, fakeRequest({ method: 'POST', body: '{}' }))
  assert.equal(wrongInspectMethod.status, 405)

  const crossSite = await call(state, DELETE, fakeRequest({
    headers: { 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ sessionId: 'session-x' }),
  }))
  assert.equal(crossSite.status, 403)

  const rebound = await call(state, DELETE, fakeRequest({
    headers: { host: 'evil.com', origin: 'http://evil.com' },
    body: JSON.stringify({ sessionId: 'session-x' }),
  }))
  assert.equal(rebound.status, 403)
  assert.deepEqual(services.calls.deleted, [])
})

test('deletes only the descendants the Client selected', async () => {
  const sessionId = 'session-99999999-aaaa-bbbb-cccc-dddddddddddd'
  const keptId = 'session-keep01-0000-0000-0000-0000000000aa'
  const takenId = 'session-take01-0000-0000-0000-0000000000bb'
  const directory = await fakeArtifact(sessionId)
  const keptDirectory = await fakeArtifact(keptId)
  const takenDirectory = await fakeArtifact(takenId)
  const services = servicesFor({
    sessionId,
    directory,
    children: [
      { id: keptId, directory: keptDirectory },
      { id: takenId, directory: takenDirectory },
    ],
  })
  const { state } = fakeContext({ services })

  const response = await call(state, DELETE, fakeRequest({
    body: JSON.stringify({ sessionId, descendants: [takenId] }),
  }))

  assert.equal(response.status, 200)
  assert.equal(response.payload.kept, 1)
  assert.deepEqual(response.payload.descendants.map((entry) => entry.sessionId), [takenId])
  await assert.rejects(stat(takenDirectory), /ENOENT/)
  await assert.rejects(stat(directory), /ENOENT/)
  // The one the user left ticked-off is untouched, log and all.
  assert.equal((await stat(keptDirectory)).isDirectory(), true)
  assert.deepEqual(state.emitted, [
    ['api-session/removed', takenId],
    ['api-session/removed', sessionId],
  ])
})

test('refuses a descendant id that is not in the family', async () => {
  const sessionId = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const childId = 'session-child4-0000-0000-0000-000000000004'
  const outsiderId = 'session-outsid-0000-0000-0000-00000000000f'
  const directory = await fakeArtifact(sessionId)
  const childDirectory = await fakeArtifact(childId)
  const outsiderDirectory = await fakeArtifact(outsiderId)
  const services = servicesFor({
    sessionId,
    directory,
    children: [{ id: childId, directory: childDirectory }],
    extraDirectories: { [outsiderId]: outsiderDirectory },
  })
  const { state } = fakeContext({ services })

  const response = await call(state, DELETE, fakeRequest({
    body: JSON.stringify({ sessionId, descendants: [childId, outsiderId] }),
  }))

  assert.equal(response.status, 400)
  assert.equal(response.payload.code, 'unknown-descendant')
  assert.equal(response.payload.sessionId, outsiderId)
  // Nothing at all was removed, including the target.
  assert.equal((await stat(directory)).isDirectory(), true)
  assert.equal((await stat(childDirectory)).isDirectory(), true)
  assert.equal((await stat(outsiderDirectory)).isDirectory(), true)
  assert.deepEqual(state.emitted, [])
})

test('asks every Session in the set about its own work', async () => {
  const sessionId = 'session-bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
  const busyChildId = 'session-busy01-0000-0000-0000-0000000000c1'
  const idleChildId = 'session-idle01-0000-0000-0000-0000000000c2'
  const directory = await fakeArtifact(sessionId)
  const busyDirectory = await fakeArtifact(busyChildId)
  const idleDirectory = await fakeArtifact(idleChildId)
  const services = servicesFor({
    sessionId,
    directory,
    children: [
      { id: busyChildId, directory: busyDirectory },
      { id: idleChildId, directory: idleDirectory },
    ],
  })
  // Only the descendant is working: asking just the target would miss it.
  const { state } = fakeContext({
    services,
    activity: (id) => (id === busyChildId ? [{ kind: 'job', items: [{ id: 'job-9', label: '长任务' }] }] : []),
  })

  const refused = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId }) }))
  assert.equal(refused.status, 409)
  assert.equal(refused.payload.code, 'session-active')
  assert.deepEqual(refused.payload.activeSessions.map((entry) => entry.sessionId), [busyChildId])
  // The message names the families; the per-item labels ride along in the details.
  assert.match(refused.payload.message, /运行中的后台任务/)
  assert.equal(refused.payload.activeSessions[0].activity[0].items[0].label, '长任务')
  assert.equal((await stat(busyDirectory)).isDirectory(), true)

  const accepted = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId, stop: true }) }))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.payload.stoppedActivity, true)
  assert.deepEqual(state.stopped, [busyChildId])
  await assert.rejects(stat(busyDirectory), /ENOENT/)
  await assert.rejects(stat(idleDirectory), /ENOENT/)
})

test('closes the shells a deleted Session owned', async () => {
  const sessionId = 'session-cccccccc-dddd-eeee-ffff-000000000000'
  const directory = await fakeArtifact(sessionId)
  const agent = { status: 'inactive' }
  const services = servicesFor({ sessionId, directory, agent })
  services.terminals.hasTerminal(agent, 'term-1')
  services.terminals.hasTerminal(agent, 'term-2')
  const { state } = fakeContext({ services })

  const response = await call(state, DELETE, fakeRequest({ body: JSON.stringify({ sessionId }) }))

  assert.equal(response.status, 200)
  assert.equal(response.payload.terminalsKilled, 2)
  assert.deepEqual(services.calls.killedTerminals.sort(), ['term-1', 'term-2'])
  assert.deepEqual(services.terminals.list(agent), [])
})

test('catalog groups sessions by workspace and names each row\'s place in its family', async () => {
  const parentId = 'session-aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee'
  const forkedId = 'session-bbbb2222-cccc-dddd-eeee-ffffffffffff'
  const spawnedId = 'session-cccc3333-dddd-eeee-ffff-000000000000'
  const lonelyId = 'session-dddd4444-eeee-ffff-0000-111111111111'
  const orphanId = 'session-eeee5555-ffff-0000-1111-222222222222'
  const homelessId = 'session-ffff6666-0000-1111-2222-333333333333'
  const directory = await fakeArtifact(parentId)
  const services = servicesFor({
    sessionId: parentId,
    directory,
    lineage: [
      { header: { id: parentId, createdAt: 400, cwd: 'F:\\OneDrive\\Project_lzc' } },
      { header: { id: forkedId, createdAt: 300, cwd: 'F:\\OneDrive\\Project_lzc', parentSession: parentId, isSeeded: true } },
      { header: { id: spawnedId, createdAt: 200, cwd: 'F:\\OneDrive\\Project_lzc', parentSession: parentId, origin: 'subagent' } },
      { header: { id: lonelyId, createdAt: 100, cwd: 'F:\\Elsewhere' } },
      { header: { id: orphanId, createdAt: 50, parentSession: 'session-gone', cwd: 'F:\\Nowhere' } },
      // No cwd and no Workspace account: the only way into the ungrouped section.
      { header: { id: homelessId, createdAt: 10 } },
    ],
    // Sessions whose log carries no title event: with no durable title, the row
    // has to fall back to its project directory rather than read as untitled.
    untitled: [parentId, spawnedId],
  })
  // The Workspace owns only the first three; the rest fall back to their directory
  // and then to the ungrouped section.
  services.workspaceRegistry.list = () => [{
    id: 'ws-1',
    title: 'Project_lzc',
    path: 'F:\\OneDrive\\Project_lzc',
    sessionIds: [parentId, forkedId, spawnedId],
    detachSession: async () => {},
  }]
  const { state } = fakeContext({ services })

  const response = await call(state, CATALOG, fakeRequest({ method: 'GET' }))

  assert.equal(response.status, 200)
  assert.deepEqual(response.payload.workspaces.map((group) => group.title), ['Project_lzc', 'Elsewhere', 'Nowhere', '未归类'])
  const owned = response.payload.workspaces[0]
  assert.equal(owned.workspaceId, 'ws-1')
  // Parents lead their children, and each row says whether it has children.
  assert.deepEqual(owned.sessions.map((row) => row.id), [parentId, forkedId, spawnedId])
  assert.deepEqual(owned.sessions.map((row) => row.depth), [0, 1, 1])
  const parent = owned.sessions[0]
  assert.equal(parent.hasChildren, true)
  assert.equal(parent.family, 2)
  assert.equal(parent.subagents, 1)
  assert.equal(parent.derived, 1)
  // A Session with no title event still reads as its project directory; one with
  // a durable title reads as that title.
  assert.equal(parent.title, 'Project_lzc')
  assert.equal(owned.sessions[1].title, `标题 ${forkedId.slice(-4)}`)
  assert.equal(owned.sessions[2].title, 'Project_lzc')
  assert.equal(owned.sessions[1].kind, 'derived')
  assert.equal(owned.sessions[1].parentId, parentId)
  assert.equal(owned.sessions[2].kind, 'subagent')
  // A directory no Workspace owns still groups; a Session with no directory at
  // all is the one case the ungrouped section exists for.
  assert.equal(response.payload.workspaces[1].workspaceId, null)
  assert.deepEqual(response.payload.workspaces[1].sessions.map((row) => row.id), [lonelyId])
  assert.deepEqual(response.payload.workspaces[2].sessions.map((row) => row.id), [orphanId])
  assert.equal(response.payload.workspaces[2].sessions[0].parentId, undefined)
  assert.equal(response.payload.workspaces[3].title, '未归类')
  assert.deepEqual(response.payload.workspaces[3].sessions.map((row) => row.id), [homelessId])
  assert.deepEqual(response.payload.totals, { workspaces: 4, sessions: 6, ungrouped: 1 })
})

test('batch delete runs each root and reports only the failures', async () => {
  const okId = 'session-11112222-3333-4444-5555-666666666666'
  const missingId = 'session-77778888-9999-aaaa-bbbb-cccccccccccc'
  const childId = 'session-dddd9999-eeee-ffff-0000-111111111111'
  const directory = await fakeArtifact(okId)
  const childDirectory = await fakeArtifact(childId)
  const services = servicesFor({
    sessionId: okId,
    directory,
    extraDirectories: { [childId]: childDirectory },
    lineage: [{ header: { id: childId, createdAt: 10, cwd: 'F:\\OneDrive\\Project_lzc', parentSession: okId, origin: 'subagent' } }],
  })
  const { state } = fakeContext({ services })

  const response = await call(state, BATCH, fakeRequest({
    body: JSON.stringify({
      roots: [
        { sessionId: okId, descendants: [childId] },
        { sessionId: missingId, descendants: [] },
      ],
    }),
  }))

  assert.equal(response.status, 200)
  assert.equal(response.payload.ok, false)
  assert.deepEqual(response.payload.roots, [okId, missingId])
  assert.deepEqual(response.payload.removed.map((report) => report.sessionId), [okId])
  assert.deepEqual(response.payload.failed.map((entry) => [entry.sessionId, entry.code]), [[missingId, 'session-not-found']])
  // The failing root did not stop the successful one from being removed.
  await assert.rejects(stat(directory), /ENOENT/)
  await assert.rejects(stat(childDirectory), /ENOENT/)
})

test('batch delete refuses a body with no usable root', async () => {
  const { state } = fakeContext({ services: servicesFor({ sessionId: 'session-x', directory: undefined }) })
  const empty = await call(state, BATCH, fakeRequest({ body: JSON.stringify({ roots: [] }) }))
  assert.equal(empty.status, 400)
  assert.equal(empty.payload.code, 'bad-request')
  const malformed = await call(state, BATCH, fakeRequest({ body: JSON.stringify({ roots: [{ sessionId: '../etc' }] }) }))
  assert.equal(malformed.status, 400)
  const wrongMethod = await call(state, BATCH, fakeRequest({ method: 'GET' }))
  assert.equal(wrongMethod.status, 405)
})
