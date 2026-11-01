/**
 * better-dsh-session-deletetool — Host-side Session data layer.
 *
 * The Client half never reads a Session log, a Workspace record or a file path by
 * itself: every fact it draws comes from this module, through the routes in
 * `host.js`. Three jobs live here.
 *
 * 1. **Usage folding.** A model request's cost is stored on the log's
 *    `assistant/message` event as `data.usage`:
 *    `{ inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, totalTokens }`.
 *    `inputTokens` is the cache-miss prompt, `cacheReadTokens` the cache-hit
 *    prompt, and DSH's own `totalTokens` is their sum plus `outputTokens` —
 *    verified against every log on this machine, where `cacheWriteTokens` is
 *    always 0. The plugin's neutral names are `cacheMissInputTokens` (=
 *    `inputTokens`), `cacheReadInputTokens` (= `cacheReadTokens`) and
 *    `outputTokens`; `cacheWriteTokens` is kept and counted as miss, so the
 *    three-way bar still adds up if a provider ever charges for cache writes.
 *
 * 2. **Ownership.** A Session's own usage is the requests *it* made. A forked
 *    Session can carry an inherited prefix of its parent's log
 *    (`inheritedEventCount`, and `isSeeded: true` on the header); those events
 *    belong to the ancestor and are skipped here rather than counted twice.
 *    Requests are additionally de-duplicated by the assistant message id, the
 *    stable identity DSH writes on every model answer, so a log that repeats a
 *    request under both the ancestor and the fork contributes one cost.
 *
 * 3. **Directories.** The artifact directory is whatever the persistence
 *    backend's own `locate(header)` says, never a path rebuilt from a title.
 *    The result is checked (absolute, inside the Harness data root, exists, is a
 *    directory) before the Client may offer to open it, and the open call takes a
 *    Session id — not a path — so a crafted request cannot launch a shell on an
 *    arbitrary directory.
 *
 * Reads are cached per Session and invalidated by the log file's size and
 * modification time; a Session whose log grew is re-folded on the next request,
 * so the numbers a panel shows are never stale by more than one write.
 */
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'

/**
 * The Harness data root: `DSH_HOME` when the environment sets one, else
 * `%USERPROFILE%\.dsh`. Resolved here so the Client never guesses a path.
 */
export function harnessDataDirectory() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * The projection-cache directory: DSH's own per-Session fold cache, the artifacts
 * `sessionQuery` reads instead of replaying a whole log. It is not this plugin's
 * store — the plugin reads no database of its own, it only offers to open this
 * folder so the user can see or clear what DSH already keeps there.
 */
export function sessionCacheDirectory() {
  return join(harnessDataDirectory(), 'storages', 'session_projcache')
}

/**
 * The projection-cache directory as the Client may act on it: a path only when
 * it exists and is a directory, otherwise the reason, never a guess.
 * @returns {Promise<{ path: string|null, available: boolean, reason: string|null }>}
 */
export async function resolveCacheDirectory() {
  const directory = sessionCacheDirectory()
  try {
    const info = await stat(directory)
    if (!info.isDirectory()) return { path: null, available: false, reason: '缓存路径不是目录。' }
  } catch {
    return { path: null, available: false, reason: '缓存目录不存在。' }
  }
  return { path: directory, available: true, reason: null }
}

/** Stable shape of one node's usage; every field is a number, never undefined. */
export function emptyUsage() {
  return {
    /** Cache-miss prompt tokens, the DSH log's `inputTokens`. */
    cacheMissInputTokens: 0,
    /** Cache-hit prompt tokens, the DSH log's `cacheReadTokens`. */
    cacheReadInputTokens: 0,
    /** Cache-write tokens; 0 on every provider measured here, kept for completeness. */
    cacheWriteTokens: 0,
    /** Completion tokens. */
    outputTokens: 0,
    /** Sum of the three, matching DSH's own `totalTokens` when cacheWrite is 0. */
    totalTokens: 0,
    /** How many model requests contributed. */
    requestCount: 0,
  }
}

/** Add one node's usage into another, in place. */
export function addUsage(target, source) {
  target.cacheMissInputTokens += source.cacheMissInputTokens
  target.cacheReadInputTokens += source.cacheReadInputTokens
  target.cacheWriteTokens += source.cacheWriteTokens
  target.outputTokens += source.outputTokens
  target.totalTokens += source.totalTokens
  target.requestCount += source.requestCount
  return target
}

/** Cache hit rate, 0..1, over prompt tokens only; 0 when nothing was cached. */
export function hitRateOf(usage) {
  const prompt = usage.cacheReadInputTokens + usage.cacheMissInputTokens + usage.cacheWriteTokens
  if (prompt <= 0) return 0
  return usage.cacheReadInputTokens / prompt
}

/** The stable id of the model answer a `assistant/message` event carries. */
function requestIdOf(event) {
  const message = event?.data?.message
  const id = message !== null && typeof message === 'object' ? message.id : undefined
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Fold one Session's own usage out of its raw event log.
 *
 * Inherited events are those before `inheritedEventCount`; they are the
 * ancestor's requests, copied into a fork so its context reads correctly. They
 * are skipped. A repeated request id is counted once. Anything this function
 * cannot attribute is reported through `complete: false` and a readable `note`
 * instead of being guessed at.
 * @param {Array<object>} events - the replay-validated raw event log.
 * @param {number} inheritedEventCount - leading events inherited from an ancestor.
 * @returns {{ usage: object, complete: boolean, note: string|null, inheritedEvents: number, duplicateRequests: number, unattributedRequests: number }}
 */
export function foldUsage(events, inheritedEventCount = 0) {
  const usage = emptyUsage()
  const seen = new Set()
  let duplicateRequests = 0
  let unattributedRequests = 0
  let inheritedEvents = 0
  let complete = true
  let note = null

  const total = Array.isArray(events) ? events.length : 0
  const inherited = Number.isInteger(inheritedEventCount) && inheritedEventCount > 0
    ? Math.min(inheritedEventCount, total)
    : 0
  inheritedEvents = inherited

  if (inherited > 0 && inherited >= total) {
    // The whole log is the ancestor's prefix: this Session made no request of its own yet.
    return { usage, complete: true, note: null, inheritedEvents, duplicateRequests, unattributedRequests }
  }

  for (let index = inherited; index < total; index += 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const raw = event.data?.usage
    if (raw === null || typeof raw !== 'object') continue

    const requestId = requestIdOf(event)
    if (requestId === undefined) unattributedRequests += 1
    else if (seen.has(requestId)) {
      duplicateRequests += 1
      continue
    } else seen.add(requestId)

    const miss = numberOrZero(raw.inputTokens) + numberOrZero(raw.cacheWriteTokens)
    const read = numberOrZero(raw.cacheReadTokens)
    const output = numberOrZero(raw.outputTokens)
    usage.cacheMissInputTokens += miss
    usage.cacheReadInputTokens += read
    usage.cacheWriteTokens += numberOrZero(raw.cacheWriteTokens)
    usage.outputTokens += output
    usage.totalTokens += miss + read + output
    usage.requestCount += 1
  }

  if (unattributedRequests > 0) {
    complete = false
    note = `${unattributedRequests} 条请求没有可用的消息 id，无法去重，已按出现次数计入。`
  }
  if (inherited > 0) {
    const inheritedNote = `已排除 ${inherited} 条从父会话继承的事件，不重复计入。`
    note = note === null ? inheritedNote : `${note}${inheritedNote}`
  }
  return { usage, complete, note, inheritedEvents, duplicateRequests, unattributedRequests }
}

/** Coerce a token field to a non-negative integer. */
function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** One Session's cached statistics. */
const CACHE = new Map()

/** How many Sessions the cache keeps before it is trimmed to the newest half. */
const CACHE_LIMIT = 200

/**
 * Read one Session's log through the Host's own query seam and fold its usage.
 *
 * The query service is asked for the replay-validated snapshot, so this never
 * touches a path the plugin guessed at, and `readSession` does not make the
 * Session live. The cache is keyed by the log file's identity: a grown log is
 * re-read, an unchanged one costs one `stat`.
 * @param {object} ctx - Host Cordis context.
 * @param {string} sessionId - the Session to fold.
 * @returns {Promise<object>} `{ ok, usage, lastActivityAt, inheritedEventCount, logEvents, complete, note }`.
 */
export async function readSessionStats(ctx, sessionId, options = {}) {
  const query = ctx.get('sessionQuery')
  if (query === undefined || typeof query.readSession !== 'function') {
    throw new SessionModelError('query-unavailable', 'sessionQuery is not mounted in this profile')
  }

  const persistence = ctx.get('sessionPersistence')
  const signature = await signatureOf(persistence, sessionId)
  const cached = CACHE.get(sessionId)
  if (options.fresh !== true && cached !== undefined && signature !== null && cached.signature === signature) {
    return cached.stats
  }

  const snapshot = await query.readSession(sessionId)
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []
  const inherited = Number.isInteger(snapshot?.inheritedEventCount) ? snapshot.inheritedEventCount : 0
  const folded = foldUsage(events, inherited)
  const lastActivityAt = lastActivityOf(events, snapshot?.session)
  const stats = {
    ok: true,
    sessionId,
    usage: folded.usage,
    complete: folded.complete,
    note: folded.note,
    inheritedEventCount: folded.inheritedEvents,
    duplicateRequests: folded.duplicateRequests,
    lastActivityAt,
    logEvents: events.length,
  }

  // Without a file signature the cache could never tell a grown log from an
  // unchanged one, so such a Session is simply re-read next time.
  if (signature !== null) remember(sessionId, signature, stats)
  return stats
}

/**
 * Fold several Sessions, bounded concurrency so a large family does not open
 * every log at once.
 * @param {object} ctx - Host Cordis context.
 * @param {string[]} sessionIds - the Sessions to fold.
 * @param {number} concurrency - how many reads may overlap.
 * @returns {Promise<Map<string, object>>} Session id → statistics.
 */
export async function readSessionStatsMany(ctx, sessionIds, concurrency = 4) {
  const unique = [...new Set(sessionIds.filter((id) => typeof id === 'string' && id !== ''))]
  const results = new Map()
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, Math.max(unique.length, 1)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= unique.length) return
      const id = unique[index]
      try {
        results.set(id, await readSessionStats(ctx, id))
      } catch (error) {
        results.set(id, {
          ok: false,
          sessionId: id,
          usage: emptyUsage(),
          complete: false,
          note: `读不到这个会话的日志：${error instanceof Error ? error.message : String(error)}`,
          inheritedEventCount: 0,
          duplicateRequests: 0,
          lastActivityAt: null,
          logEvents: 0,
        })
      }
    }
  })
  await Promise.all(workers)
  return results
}

/** The last event time in a log, or the header's creation time when it is empty. */
function lastActivityOf(events, header) {
  let last = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const time = events[index]?.time
    if (typeof time === 'number' && Number.isFinite(time) && time > 0) {
      last = time
      break
    }
  }
  if (last === 0 && typeof header?.createdAt === 'number') last = header.createdAt
  return last === 0 ? null : last
}

/**
 * An opaque identity for one Session's log file: size and modification time.
 * Undefined when the backend cannot locate the file, which disables the cache.
 */
async function signatureOf(persistence, sessionId) {
  if (persistence === undefined || typeof persistence.stat !== 'function') return null
  try {
    const snapshot = await persistence.stat(sessionId)
    const header = snapshot?.header
    if (header === undefined) return null
    if (typeof persistence.locate !== 'function') return null
    const location = persistence.locate(header)
    if (location === undefined || typeof location.path !== 'string' || location.path === '') return null
    const info = await stat(location.path)
    return `${info.size}:${Math.trunc(info.mtimeMs)}`
  } catch {
    return null
  }
}

/** Store one Session's statistics, trimming the map when it outgrows its limit. */
function remember(sessionId, signature, stats) {
  CACHE.delete(sessionId)
  CACHE.set(sessionId, { signature: signature ?? 'none', stats })
  if (CACHE.size <= CACHE_LIMIT) return
  const overflow = CACHE.size - Math.floor(CACHE_LIMIT / 2)
  let index = 0
  for (const key of CACHE.keys()) {
    if (index >= overflow) break
    CACHE.delete(key)
    index += 1
  }
}

/** Forget every cached fold; exposed for tests and for a forced refresh. */
export function clearSessionStatsCache() {
  CACHE.clear()
}

/** A refusal with a stable code, so the route can answer with a status it owns. */
export class SessionModelError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SessionModelError'
    this.code = code
  }
}

/**
 * Resolve a Session's artifact directory through the persistence backend.
 *
 * The path is whatever `locate(header)` returns; it is normalized and checked
 * before being handed to the Client. A Session whose backend cannot locate it,
 * or whose directory is gone, reports the reason instead of a path.
 * @param {object} ctx - Host Cordis context.
 * @param {object} header - the Session's stored header.
 * @returns {Promise<{ path: string|null, available: boolean, reason: string|null }>}
 */
export async function resolveSessionDirectory(ctx, header) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.locate !== 'function') {
    return { path: null, available: false, reason: '当前持久化后端不提供会话目录。' }
  }
  let located
  try {
    located = persistence.locate(header)
  } catch {
    return { path: null, available: false, reason: '持久化后端拒绝定位这个会话。' }
  }
  const filePath = located?.path
  if (typeof filePath !== 'string' || filePath === '') {
    return { path: null, available: false, reason: '这个会话没有独立的本地目录。' }
  }
  const directory = normalize(dirname(filePath))
  if (!isAbsolute(directory) || directory.includes(`..${sep}`) || directory.endsWith('..')) {
    return { path: null, available: false, reason: '定位到的路径不是合法目录。' }
  }
  try {
    const info = await stat(directory)
    if (!info.isDirectory()) return { path: null, available: false, reason: '定位到的路径不是目录。' }
  } catch {
    return { path: null, available: false, reason: '目录已经不存在。' }
  }
  return { path: directory, available: true, reason: null }
}

/**
 * Open one directory in the platform's file manager.
 *
 * `explorer.exe` is detached and its exit status ignored: on Windows it returns
 * a non-zero code even when the window opened. The caller only ever passes a
 * directory this module resolved from a Session id.
 * @param {string} directory - an absolute, already-validated directory.
 * @returns {Promise<void>} resolves once the launcher was started.
 */
export function openDirectory(directory) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin' ? 'open' : 'xdg-open'
    try {
      const child = execFile(command, [directory], { windowsHide: false }, (error) => {
        if (error !== null && error !== undefined) {
          // explorer.exe exits non-zero on success paths too; only a failure to
          // spawn at all is reported.
          if (error.code === 'ENOENT' || error.code === 'EACCES') {
            reject(new SessionModelError('open-failed', `无法启动文件管理器：${error.message}`))
            return
          }
        }
        resolve()
      })
      child.unref?.()
    } catch (error) {
      reject(new SessionModelError('open-failed', `无法启动文件管理器：${error instanceof Error ? error.message : String(error)}`))
    }
  })
}

/** Names exported only for the unit test. */
export const __model = { requestIdOf, lastActivityOf, numberOrZero, signatureOf }
