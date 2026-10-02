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
 * `children` feeds the durable subagent catalog. `lineage` feeds the observed
 * Session corpus (`sessionQuery.listSessions`), whose headers carry
 * `parentSession` / `origin` exactly as DSH writes them; `lineage: null` models a
 * profile without the query service. `extraDirectories` gives artifact paths to
 * descendants that only the lineage names.
 */
function servicesFor({
  sessionId,
  directory,
  open = false,
  agent = undefined,
  children = [],
  lineage = [],
  extraDirectories = {},
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
        async readTitleSnapshots(ids) {
          return ids.map((id) => ({
            status: 'fulfilled',
            value: { session: { id }, title: `标题 ${id.slice(-4)}` },
          }))
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

test('registers the delete and inspect routes', () => {
  const { state } = fakeContext()
  assert.deepEqual([...state.routes.keys()].sort(), [DELETE, INSPECT].sort())
  assert.equal(state.routes.get(DELETE).kind, 'exact')
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
