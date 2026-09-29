/**
 * dsh-session-delete — Host half.
 *
 * DSH can only archive a conversation: `ctx.workspaceRegistry.archiveSession()`
 * hides a Session from the sidebar and keeps every artifact. The persistence
 * seam has no deletion API either — `@deepseek-ai/dsh-session-persistence-jsonl`
 * documents "Nothing deletes session files — logs accumulate under `root` until
 * removed externally; the seam has no deletion API".
 *
 * This plugin adds the missing delete. For one session id it removes:
 *   1. the Session's own artifact directory (every format generation in it),
 *   2. its account in every Workspace record, plus archive and pin membership,
 *   3. its projection-cache checkpoint record,
 * then emits `api-session/removed` so connected Clients drop the row — the same
 * event the shipped Session controller emits when a Session is disposed.
 *
 * Subagent descendants go with it: they are Sessions of their own with their own
 * logs, and the durable `subagentCatalog` projection (`ctx.subagents
 * .listDescendants`) names the whole subtree. They are removed deepest first,
 * and the subtree is collected before anything is deleted, so an over-cap
 * subtree aborts with nothing done.
 *
 * What may block a delete is RUNNING WORK, never mere residency. A Session the
 * Host still holds open (`ctx.sessions` / `ctx.agents`) is deleted anyway:
 * measured on this platform, `rm` succeeds while the append handle is open, the
 * directory entry disappears at once, and later appends land in the unlinked
 * file instead of resurrecting it. The one real gate is DSH's own archive
 * admission — the `workspace/session-activity` waterfall the shipped archive
 * uses, answered by the Agent registry (a running turn), the job registry, the
 * Subagent runtime, and Schedule. Pass `stop: true` to stop that work first,
 * exactly as `archiveSession(id, { stopActivity: true })` does.
 *
 * The Client half reaches this half over two same-origin HTTP routes on
 * `ctx.webServer`, the transport the installed community plugin `dshmarket`
 * uses for its own UI→Host calls: a build-free plain-JavaScript bundle cannot
 * declare a typed `ctx.remote` namespace, because those need generated Typert
 * descriptors. `GET /inspect` lets the dialog state a Session's real state
 * before the user commits.
 */
import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Services activation waits for; everything else is looked up per request. */
export const inject = ['webServer']

const DELETE_PATH = '/dsh-session-delete/delete'
const INSPECT_PATH = '/dsh-session-delete/inspect'

/** Session ids are opaque strings, but never paths: keep them to safe segments. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

const MAX_BODY_BYTES = 4096

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

/** The families `workspace/session-activity` can report, in the reader's words. */
const ACTIVITY_LABELS = {
  turn: '进行中的回合',
  subagent: '运行中的子智能体',
  job: '运行中的后台任务',
  schedule: '生效中的定时提醒',
}

/** How many subagent descendants one delete may take with it before it aborts. */
const MAX_DESCENDANTS = 200

/** A refusal carrying the HTTP status, stable code, and details the Client reports. */
class DeleteRefusal extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'DeleteRefusal'
    this.status = status
    this.code = code
    this.details = details ?? {}
  }
}

/**
 * Register the delete and inspect routes.
 * @param {object} ctx - Host Cordis context.
 */
export function apply(ctx) {
  const onDelete = (request, response) => {
    void serveDelete(ctx, request, response).catch((error) => {
      ctx.logger?.warn?.(`[session-delete] route failure: ${messageOf(error)}`)
      send(response, 500, { ok: false, code: 'internal', message: messageOf(error) })
    })
  }
  const onInspect = (request, response) => {
    void serveInspect(ctx, request, response).catch((error) => {
      ctx.logger?.warn?.(`[session-delete] route failure: ${messageOf(error)}`)
      send(response, 500, { ok: false, code: 'internal', message: messageOf(error) })
    })
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: DELETE_PATH, handler: onDelete }),
    'session-delete: delete route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: INSPECT_PATH, handler: onInspect }),
    'session-delete: inspect route',
  )
  ctx.logger?.info?.(`[session-delete] routes mounted at ${DELETE_PATH} and ${INSPECT_PATH}`)
}

/**
 * Own one delete request end to end.
 * @param {object} ctx - Host Cordis context.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @param {import('node:http').ServerResponse} response - the response.
 */
async function serveDelete(ctx, request, response) {
  if (request.method !== 'POST') {
    send(response, 405, { ok: false, code: 'method-not-allowed', message: 'only POST is accepted' })
    return
  }
  if (!sameOrigin(request)) {
    send(response, 403, { ok: false, code: 'untrusted-origin', message: 'the request did not come from this Harness page' })
    return
  }
  let body
  try {
    body = JSON.parse(await readBody(request))
  } catch (error) {
    send(response, 400, { ok: false, code: 'bad-request', message: messageOf(error) })
    return
  }
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!SESSION_ID.test(sessionId)) {
    send(response, 400, { ok: false, code: 'bad-request', message: 'sessionId is missing or malformed' })
    return
  }
  try {
    send(response, 200, await deleteSession(ctx, sessionId, { stop: body?.stop === true }))
  } catch (error) {
    answer(ctx, response, error, sessionId)
  }
}

/**
 * Own one inspect request: report what the page cannot see by itself.
 * @param {object} ctx - Host Cordis context.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @param {import('node:http').ServerResponse} response - the response.
 */
async function serveInspect(ctx, request, response) {
  if (request.method !== 'GET') {
    send(response, 405, { ok: false, code: 'method-not-allowed', message: 'only GET is accepted' })
    return
  }
  if (!sameOrigin(request)) {
    send(response, 403, { ok: false, code: 'untrusted-origin', message: 'the request did not come from this Harness page' })
    return
  }
  let sessionId = ''
  try {
    sessionId = (new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId') ?? '').trim()
  } catch {
    // A malformed request URL is reported as a malformed id below.
  }
  if (!SESSION_ID.test(sessionId)) {
    send(response, 400, { ok: false, code: 'bad-request', message: 'sessionId is missing or malformed' })
    return
  }
  try {
    send(response, 200, await inspectSession(ctx, sessionId))
  } catch (error) {
    answer(ctx, response, error, sessionId)
  }
}

/**
 * Delete one stored Session and everything keyed by its id.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session to delete.
 * @param {{ stop: boolean }} options - whether to stop running work first.
 * @returns {Promise<object>} the removal report.
 */
async function deleteSession(ctx, sessionId, options) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.stat !== 'function') {
    throw new DeleteRefusal(503, 'persistence-unavailable', 'sessionPersistence is not mounted in this profile')
  }

  const snapshot = await persistence.stat(sessionId)
  const header = snapshot?.header
  if (header === undefined) {
    throw new DeleteRefusal(404, 'session-not-found', `找不到会话 ${sessionId} 的持久化记录。`)
  }

  const artifactDirectory = locateDirectory(persistence, header)
  if (artifactDirectory === undefined) {
    throw new DeleteRefusal(501, 'no-artifact', '当前持久化后端不提供会话工件路径，无法删除文件。')
  }

  const runtime = runtimeOf(ctx, sessionId)
  const activity = describeActivity(await sessionActivity(ctx, sessionId))
  if (activity.length > 0 && options.stop !== true) {
    throw new DeleteRefusal(
      409,
      'session-active',
      `这个会话还有未结束的工作（${activity.map((entry) => entry.label).join('、')}）。确认后会先停掉它们再删除。`,
      { activity },
    )
  }

  const removal = { stoppedActivity: false, warnings: [] }

  // Running work goes first, the way the shipped archive's stopActivity does.
  if (activity.length > 0) {
    await stopSessionActivity(ctx, sessionId, removal)
    removal.stoppedActivity = true
  }

  // Subagent descendants are Sessions of their own with their own logs, so the
  // durable subagent catalog decides which ones go with this delete. Collected
  // before anything is removed, so an over-cap subtree aborts with nothing done.
  const descendants = await collectDescendants(ctx, sessionId, removal)
  const removedDescendants = []
  for (const child of descendants) {
    removedDescendants.push(await removeSession(ctx, child.id))
  }

  const removed = await removeSession(ctx, sessionId, { artifactDirectory })

  return {
    ok: true,
    sessionId,
    removed,
    descendants: removedDescendants,
    stoppedActivity: removal.stoppedActivity,
    runtime,
    activity,
  }
}

/**
 * Remove one Session's artifacts, workspace account and projection checkpoint,
 * then tell connected Clients to drop its row.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session to remove.
 * @param {{ artifactDirectory?: string }} known - an already-resolved artifact path.
 * @returns {Promise<object>} the per-Session removal report.
 */
async function removeSession(ctx, sessionId, known = {}) {
  const report = {
    sessionId,
    artifactDirectory: null,
    removed: false,
    workspaces: 0,
    projectionCheckpoint: false,
    warnings: [],
  }

  let directory = known.artifactDirectory
  if (directory === undefined) {
    const persistence = ctx.get('sessionPersistence')
    const snapshot = persistence === undefined || typeof persistence.stat !== 'function'
      ? undefined
      : await persistence.stat(sessionId)
    const header = snapshot?.header
    if (header === undefined) report.warnings.push('没有持久化记录，可能已经被删除')
    else directory = locateDirectory(persistence, header)
  }

  // The Session's own directory: the current log, every retained historical
  // generation, and any future session-local artifact live in it.
  if (directory !== undefined) {
    report.artifactDirectory = directory
    await rm(directory, { recursive: true, force: true })
    report.removed = true
  }

  // Workspace accounting: the sidebar groups Sessions by Workspace records, and
  // the registry-global archive/pin sets are Session id arrays.
  await detachFromWorkspaces(ctx, sessionId, report)

  // The projection checkpoint is a fold shortcut and disposable; leaving it
  // would keep a record for a Session that no longer exists.
  report.projectionCheckpoint = await dropProjectionCheckpoint(ctx, sessionId, report)

  // Connected Clients drop the row from their session list, exactly as they do
  // when the Session controller reports a disposed Session.
  ctx.emit('api-session/removed', sessionId)

  return report
}

/**
 * Collect this Session's subagent descendants from the durable subagent catalog,
 * deepest first so no child outlives its parent.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session whose descendants are wanted.
 * @param {object} removal - report being filled in.
 * @returns {Promise<Array<{ id: string, depth: number }>>} the descendants.
 */
async function collectDescendants(ctx, sessionId, removal) {
  const subagents = ctx.get('subagents')
  if (subagents === undefined || typeof subagents.listDescendants !== 'function') {
    removal.warnings.push('subagents 服务不可用，子会话日志没有一并清理')
    return []
  }
  let entries
  try {
    entries = await subagents.listDescendants(sessionId)
  } catch (error) {
    removal.warnings.push(`读取子会话列表失败，子会话日志没有清理：${messageOf(error)}`)
    return []
  }
  if (!Array.isArray(entries)) return []

  const seen = new Set([sessionId])
  const collected = []
  for (const entry of entries) {
    const id = typeof entry?.id === 'string' ? entry.id : ''
    if (id === '' || seen.has(id) || !SESSION_ID.test(id)) continue
    seen.add(id)
    collected.push({ id, depth: typeof entry?.depth === 'number' ? entry.depth : 1 })
  }
  if (collected.length > MAX_DESCENDANTS) {
    throw new DeleteRefusal(
      409,
      'too-many-descendants',
      `这个会话派生了 ${collected.length} 个子会话，超过一次删除上限 ${MAX_DESCENDANTS} 个，已中止，没有删除任何东西。`,
    )
  }
  collected.sort((left, right) => right.depth - left.depth)
  return collected
}

/**
 * Read one Session's state without changing anything.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session to inspect.
 * @returns {Promise<object>} the state the Client dialog reports.
 */
async function inspectSession(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence')
  const snapshot = persistence === undefined || typeof persistence.stat !== 'function'
    ? undefined
    : await persistence.stat(sessionId)
  const header = snapshot?.header
  const descendantIds = await descendantIdsOf(ctx, sessionId)
  return {
    ok: true,
    sessionId,
    stored: header !== undefined,
    artifactDirectory: header === undefined ? undefined : locateDirectory(persistence, header),
    ...runtimeOf(ctx, sessionId),
    activity: describeActivity(await sessionActivity(ctx, sessionId)),
    descendants: { count: descendantIds.length, ids: descendantIds.slice(0, 20) },
  }
}

/**
 * The ids that would go with this Session, for the dialog's warning. Read-only:
 * an absent catalog or a failed read reports none rather than blocking a delete.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session whose descendants are wanted.
 * @returns {Promise<string[]>} descendant Session ids.
 */
async function descendantIdsOf(ctx, sessionId) {
  const subagents = ctx.get('subagents')
  if (subagents === undefined || typeof subagents.listDescendants !== 'function') return []
  try {
    const entries = await subagents.listDescendants(sessionId)
    if (!Array.isArray(entries)) return []
    const seen = new Set()
    for (const entry of entries) {
      const id = typeof entry?.id === 'string' ? entry.id : ''
      if (id !== '' && id !== sessionId && SESSION_ID.test(id)) seen.add(id)
    }
    return [...seen]
  } catch {
    return []
  }
}

/**
 * Whether the Host still holds the Session open, and whether its Agent runs.
 * Residency never blocks a delete; it is reported so the dialog can say so.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session to describe.
 * @returns {{ open: boolean, agent: boolean, running: boolean }} the runtime facts.
 */
function runtimeOf(ctx, sessionId) {
  let open = false
  let agent = false
  let running = false
  try {
    const sessions = ctx.get('sessions')
    if (typeof sessions?.get === 'function') open = sessions.get(sessionId) !== undefined
  } catch {
    // A service that cannot answer leaves the fact false.
  }
  try {
    const agents = ctx.get('agents')
    if (typeof agents?.get === 'function') {
      const live = agents.get(sessionId)
      agent = live !== undefined
      running = live?.status === 'running'
    }
  } catch {
    // Same here.
  }
  return { open, agent, running }
}

/**
 * Ask the composed providers what still runs for this Session, through DSH's own
 * archive-admission waterfall.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session to ask about.
 * @returns {Promise<object[]>} the reported families, in listener order.
 */
async function sessionActivity(ctx, sessionId) {
  if (typeof ctx.waterfall !== 'function') return []
  const value = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
  return Array.isArray(value) ? value : []
}

/**
 * Stop this Session's running work the way the user's own stop actions do.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session whose work stops.
 * @param {object} removal - report being filled in.
 * @returns {Promise<void>} resolution once every provider was asked.
 */
async function stopSessionActivity(ctx, sessionId, removal) {
  if (typeof ctx.parallel !== 'function') {
    removal.warnings.push('ctx.parallel is unavailable; running work was not stopped')
    return
  }
  try {
    await ctx.parallel('workspace/session-stop', { sessionId })
  } catch (error) {
    removal.warnings.push(`stopping running work failed: ${messageOf(error)}`)
  }
}

/**
 * Project the activity entries into lossless JSON for the Client.
 * @param {object[]} entries - raw `workspace/session-activity` entries.
 * @returns {object[]} `{ kind, label, items }` rows.
 */
function describeActivity(entries) {
  return entries.map((entry) => {
    const kind = typeof entry?.kind === 'string' && entry.kind !== '' ? entry.kind : 'unknown'
    const items = Array.isArray(entry?.items) ? entry.items : []
    return {
      kind,
      label: ACTIVITY_LABELS[kind] ?? kind,
      items: items.slice(0, 20).map((item) => ({
        id: item?.id === undefined ? '' : String(item.id),
        label: typeof item?.label === 'string' ? item.label : '',
      })),
    }
  })
}

/**
 * The Session's own directory, through the persistence backend's artifact hook.
 * @param {object} persistence - the mounted sessionPersistence service.
 * @param {object} header - the stored Session header.
 * @returns {string|undefined} the directory, or undefined without that hook.
 */
function locateDirectory(persistence, header) {
  if (typeof persistence.locate !== 'function') return undefined
  try {
    const location = persistence.locate(header)
    if (location !== undefined && typeof location.path === 'string' && location.path !== '') {
      return dirname(location.path)
    }
  } catch {
    // A backend that refuses to locate is a backend whose files stay untouched.
  }
  return undefined
}

/**
 * Drop the id from every Workspace account and from the registry-wide sets.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session to forget.
 * @param {object} removal - report being filled in.
 * @returns {Promise<void>} resolution after the durable writes.
 */
async function detachFromWorkspaces(ctx, sessionId, removal) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) {
    removal.warnings.push('workspaceRegistry is not mounted; the Workspace record was left untouched')
    return
  }
  try {
    if (typeof registry.list === 'function') {
      for (const workspace of registry.list()) {
        if (typeof workspace?.detachSession !== 'function') continue
        await workspace.detachSession(sessionId)
        removal.workspaces += 1
      }
    }
    if (typeof registry.unarchiveSession === 'function') await registry.unarchiveSession(sessionId)
    if (typeof registry.unpinSession === 'function') await registry.unpinSession(sessionId)
  } catch (error) {
    removal.warnings.push(`workspace cleanup failed: ${messageOf(error)}`)
  }
}

/**
 * Delete the projection-cache record for one Session.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session whose checkpoint goes away.
 * @param {object} removal - report being filled in.
 * @returns {Promise<boolean>} whether a record was dropped.
 */
async function dropProjectionCheckpoint(ctx, sessionId, removal) {
  const storageDomain = ctx.get('storageDomain')
  if (typeof storageDomain?.get !== 'function') {
    removal.warnings.push('storageDomain is not mounted; the projection checkpoint was left untouched')
    return false
  }
  try {
    const domain = storageDomain.get('session_projcache')
    const table = typeof domain?.table === 'function' ? domain.table('sessions') : undefined
    if (typeof table?.delete !== 'function') return false
    return (await table.delete(sessionId)) === true
  } catch (error) {
    removal.warnings.push(`projection-cache cleanup failed: ${messageOf(error)}`)
    return false
  }
}

/**
 * Report one failure with its status, code, and details.
 * @param {object} ctx - Host Cordis context.
 * @param {import('node:http').ServerResponse} response - the response.
 * @param {unknown} error - the caught value.
 * @param {string} sessionId - the Session the request named.
 */
function answer(ctx, response, error, sessionId) {
  const refusal = error instanceof DeleteRefusal
    ? error
    : new DeleteRefusal(500, 'delete-failed', messageOf(error))
  ctx.logger?.warn?.(`[session-delete] ${sessionId}: ${refusal.code}: ${refusal.message}`)
  send(response, refusal.status, { ok: false, code: refusal.code, message: refusal.message, ...refusal.details })
}

/**
 * Whether the request came from this Harness page rather than another site.
 *
 * The rebinding defence is the `Host` header: a page on `evil.com` aimed at
 * 127.0.0.1 sends a matching Origin/Host pair, so only `Host` can tell the
 * attack apart. An absent `Host` or `Origin` is not a cross-site request — the
 * Desktop build's proxy strips both, and only a non-page client omits them.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @returns {boolean} whether the request may proceed.
 */
function sameOrigin(request) {
  const host = request.headers.host
  if (host !== undefined && !loopbackAuthority(host)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Whether a `Host` header names a loopback authority.
 * @param {string} host - the request's Host header.
 * @returns {boolean} whether it is loopback.
 */
function loopbackAuthority(host) {
  const lower = host.toLowerCase()
  const name = lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

/**
 * Read a size-capped JSON request body.
 * @param {import('node:http').IncomingMessage} request - the request.
 * @returns {Promise<string>} the decoded body.
 */
async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} response - the response.
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON body.
 */
function send(response, status, payload) {
  if (response.headersSent || response.writableEnded) return
  const body = JSON.stringify(payload)
  response.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

/**
 * Read one error's text.
 * @param {unknown} error - the caught value.
 * @returns {string} its message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
