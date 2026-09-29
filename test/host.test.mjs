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

/** Host fakes for one existing Session, optionally with subagent descendants. */
function servicesFor({ sessionId, directory, open = false, agent = undefined, children = [] }) {
  const calls = { detached: 0, unarchived: 0, unpinned: 0, deleted: [] }
  const directories = new Map([[sessionId, directory], ...children.map((child) => [child.id, child.directory])])
  return {
    calls,
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
  assert.deepEqual(response.payload.descendants, { count: 0, ids: [] })
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
  assert.deepEqual(response.payload.descendants, { count: 1, ids: [childId] })
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
