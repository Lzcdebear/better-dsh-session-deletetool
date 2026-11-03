/**
 * better-dsh-session-deletetool — Client half.
 *
 * Adds one row, "删除会话", to a Session's "⋯" menu at order 500 (after the
 * shipped pin 100 / rename 200 / fork 300 / archive 400), plus the confirmation
 * dialog that row opens. Confirming POSTs to the Host half and waits: the row
 * leaves the sidebar when the Host's `api-session/removed` event arrives, the
 * same event the shipped Session controller emits for a disposed Session.
 *
 * Opening the dialog first asks the Host what the Session's state actually is,
 * because the page cannot see it: behind a row that is not the one on screen
 * there can still be a held-open Session, or a running turn, subagent,
 * background job or reminder. The dialog says so in words instead of refusing
 * blindly — being open never blocks the delete, and running work is stopped on
 * the user's confirmation.
 *
 * The package imports no Harness Client package: the menu row and the dialog
 * are local markup styled from theme tokens, matching the shipped rows' shape
 * (`role="menuitem"` button inside the list, errors in
 * `--dsw-alias-state-error-primary`) so the menu's own keyboard walk and focus
 * return keep working over the added row.
 */
window.__ModuleLoader__.load({
  id: 'better-dsh-session-deletetool',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'better-dsh-session-deletetool'
    const DELETE_PATH = '/better-dsh-session-deletetool/delete'
    const INSPECT_PATH = '/better-dsh-session-deletetool/inspect'
    const CATALOG_PATH = '/better-dsh-session-deletetool/catalog'
    const BATCH_PATH = '/better-dsh-session-deletetool/delete-batch'
    const OPEN_DIRECTORY_PATH = '/better-dsh-session-deletetool/open-directory'
    const OPEN_CACHE_PATH = '/better-dsh-session-deletetool/open-cache'


    const DICT = {
      zh: {
        'menu.delete': '删除会话',
        'icon.batch': '批量删除会话',
        'batch.title': '批量删除会话',
        'batch.desc': '按工作区分组列出每个会话的家族树：一行下面是它的子智能体与派生对话，可以逐层展开。勾选一行会连同它下面的一切一起删除；只勾某个子智能体，就只删它。删除不可撤销。',
        'batch.loading': '正在读取会话列表…',
        'batch.failed': '读取失败',
        'batch.empty': '没有读到任何会话。',
        'batch.cancel': '取消',
        'batch.expandAll': '展开全部',
        'batch.collapseAll': '收起全部',
        'batch.partial': '已选 {m} / {n} 个会话',
        'batch.selectAll': '全选（{n} 个会话）',
        'batch.workspaceCount': '{n} 个会话',
        'batch.untitled': '未命名会话',
        'batch.ungrouped': '未归类',
        'batch.region': '会话列表',
        'batch.workspaces': '工作区列表',
        'batch.confirmNone': '请选择要删除的会话',
        'batch.confirm': '删除 {n} 个会话',
        'batch.confirmStop': '停止并删除 {n} 个会话',
        'batch.workspaceAll': '选中这个工作区的全部会话',
        'batch.deleting': '正在删除…',
        'batch.deletePartial': '{n} 个删除失败，其余已删除。',
        'batch.stoppingNote': '确认后会先停掉这些会话里未结束的工作，再删除。',
        'batch.unknown': '读不到整个会话列表，仍可直接删除。',
        'batch.totalSessions': '会话总数',
        'batch.search': '按名称搜索',
        'batch.sort': '排序方式',
        'batch.sortRecent': '按最后活跃时间',
        'batch.sortTokens': '按 Token 消耗',
        'batch.sortHit': '按缓存命中率',
        'batch.filterKind': '按类型筛选',
        'batch.filterAllKinds': '全部类型',
        'batch.kindRoot': '主会话',
        'batch.kindDerived': 'Fork 子会话',
        'batch.kindSubagent': '子智能体',
        'batch.filterWorkspace': '按工作区筛选',
        'batch.filterAllWorkspaces': '全部工作区',
        'batch.selectPage': '全选本页（{n}）',
        'batch.prevPage': '上一页',
        'batch.nextPage': '下一页',
        'batch.pageInfo': '第 {page} / {pages} 页',
        'batch.openCache': '打开会话缓存目录',
        'batch.refresh': '刷新缓存',
        'batch.cleanCache': '同时清理投影缓存',
        'batch.deleteAll': '删除全部会话',
        'batch.deleteFailed': '删除失败',
        'batch.stale': '记录已不存在，无法删除',
        'batch.staleHint': '这个会话的日志已经不在磁盘上，删除会失败；要让它从列表消失，请从侧栏移除。',
        'batch.allFailed': '{n} 个会话删除失败（{codes}）',
        'batch.staleCount': '其中 {n} 个会话只剩列表记录，日志已不在磁盘上，无法删除。',
        'usage.toggle': '显示用量',
        'usage.off': '已关闭',
        'usage.offHint': '用量统计已关闭，不再读取会话日志。',
        'usage.cacheNote': '会话缓存：DSH 为每个会话保存的解析结果（在 DSH 数据目录的 storages/session_projcache 下），用来避免每次重放日志。删除会话时只清理该会话对应的缓存记录，不影响其他会话。',
        'batch.confirmAll': '确认删除全部 {n} 个？',
        'batch.rowOwn': '本会话自身',
        'batch.rowFamily': '会话家族',
        'dialog.title': '删除会话',
        'dialog.desc': '将永久删除“{title}”：会话日志、工程记录与投影缓存都会被移除，无法撤销。',
        'dialog.untitled': '未命名会话',
        'dialog.cancel': '取消',
        'dialog.checking': '检查中…',
        'dialog.deleting': '正在删除…',
        'dialog.failed': '删除失败',
        'dialog.running': '这个会话还有未结束的工作：',
        'dialog.runningHint': '确认后会先停掉这些工作，再删除这个会话。',
        'dialog.open': '它当前仍被 Harness 占用（可能开在某个窗口或标签里）。删除后它会立刻从列表消失。',
        'dialog.unknown': '读不到它的当前状态，仍可直接删除。',
        'dialog.descendants': '会连同它一起删除：{list}。',
        'dialog.descendants.subagents': '{n} 个子智能体会话',
        'dialog.descendants.derived': '{n} 个由它派生（fork）出来的对话',
        'dialog.listSeparator': '、',
        'dialog.group.subagents': '子智能体',
        'dialog.group.derived': '派生对话',
        'dialog.group.subagentsCount': '子智能体（{n}）',
        'dialog.group.derivedCount': '派生对话（{n}）',
        'dialog.header.subagents': '子智能体',
        'dialog.mainRow': '本对话：{title}',
        'dialog.selectAll': '删除全部（共 {n} 个）',
        'dialog.selectPartial': '已选 {m} / {n} 个',
        'dialog.expandHint': '点分组标题可折叠',
        'dialog.truncated': '共 {n} 个，下面只列出前 {shown} 个。',
        'dialog.maxDeletable': '一次最多删除 {max} 个，请分批选择。',
        'dialog.itemRunning': '运行中',
        'dialog.itemActive': '有未结束的工作',
        'dialog.itemOpen': '已打开',
        'dialog.warnings': '下面这些线索没读到，家族可能不完整：',
        'dialog.untitledItem': '未命名',
        'dialog.confirmCount': '删除 {n} 个会话',
        'dialog.confirmStopCount': '停止并删除 {n} 个会话',
        'dialog.openMainDirectory': '打开主会话目录',
        'dialog.openDirectory': '打开目录',
        'dialog.folder': '打开这个节点对应的本地目录',
        'dialog.folderNone': '这个节点没有独立的本地目录',
        'dialog.lastActive': '最后活跃：{time}',
        'dialog.totalTokens': '总计消耗',
        'dialog.hitRate': '缓存命中率',
        'dialog.cacheHit': '缓存输入命中',
        'dialog.cacheMiss': '缓存输入未命中',
        'dialog.cacheOutput': '缓存输出',
        'dialog.lastActiveLabel': '最后活跃',
        'dialog.selfTotal': '本会话自身',
        'dialog.familyTotal': '主会话分支总量',
        'dialog.noUsage': '还没有模型请求记录',
        'dialog.incomplete': '统计不完整：{note}',
        'dialog.openFailed': '打开目录失败：{message}',
        'dialog.opened': '已在文件管理器中打开',
        'dialog.usageCard': '会话用量',
        'dialog.familyCard': '会话家族',
        'dialog.tokensUnit': 'Tokens',
        'dialog.siblingsNote': '该会话包含 {subagents} 个子会话和 {derived} 个派生会话。',
      },
      en: {
        'menu.delete': 'Delete conversation',
        'icon.batch': 'Delete conversations in bulk',
        'batch.title': 'Delete conversations in bulk',
        'batch.desc': 'Every conversation, grouped by Workspace. Under each row sit its subagents and its forked conversations, expandable level by level. Ticking a row takes everything below it; ticking a subagent alone deletes only that subagent. This cannot be undone.',
        'batch.loading': 'Reading the conversation list…',
        'batch.failed': 'Could not read the list',
        'batch.empty': 'No conversation was found.',
        'batch.cancel': 'Cancel',
        'batch.expandAll': 'Expand all',
        'batch.collapseAll': 'Collapse all',
        'batch.partial': '{m} of {n} selected',
        'batch.selectAll': 'Select all ({n})',
        'batch.workspaceCount': '{n} conversation(s)',
        'batch.untitled': 'Untitled conversation',
        'batch.ungrouped': 'Ungrouped',
        'batch.region': 'Conversation list',
        'batch.workspaces': 'Workspaces',
        'batch.confirmNone': 'Select the conversations to delete',
        'batch.confirm': 'Delete {n} conversation(s)',
        'batch.confirmStop': 'Stop and delete {n} conversation(s)',
        'batch.workspaceAll': 'Select every conversation in this Workspace',
        'batch.deleting': 'Deleting…',
        'batch.deletePartial': '{n} failed; the rest were deleted.',
        'batch.stoppingNote': 'Confirming stops the unfinished work in these conversations first, then deletes them.',
        'batch.unknown': 'The whole conversation list could not be read; deleting is still possible.',
        'batch.totalSessions': 'Conversations',
        'batch.search': 'Search by name',
        'batch.sort': 'Sort by',
        'batch.sortRecent': 'Last active',
        'batch.sortTokens': 'Token usage',
        'batch.sortHit': 'Cache hit rate',
        'batch.filterKind': 'Filter by kind',
        'batch.filterAllKinds': 'All kinds',
        'batch.kindRoot': 'Main conversation',
        'batch.kindDerived': 'Forked conversation',
        'batch.kindSubagent': 'Subagent',
        'batch.filterWorkspace': 'Filter by Workspace',
        'batch.filterAllWorkspaces': 'All Workspaces',
        'batch.selectPage': 'Select this page ({n})',
        'batch.prevPage': 'Previous',
        'batch.nextPage': 'Next',
        'batch.pageInfo': 'Page {page} of {pages}',
        'batch.openCache': 'Open cache folder',
        'batch.refresh': 'Refresh cache',
        'batch.cleanCache': 'Also clear projection cache',
        'batch.deleteAll': 'Delete every conversation',
        'batch.deleteFailed': 'Delete failed',
        'batch.stale': 'Record is gone; cannot delete',
        'batch.staleHint': 'This conversation has no log left on disk, so deleting it would fail; remove it from the sidebar instead.',
        'batch.allFailed': '{n} conversation(s) failed ({codes})',
        'batch.staleCount': '{n} of them have no log left on disk and cannot be deleted.',
        'usage.toggle': 'Show usage',
        'usage.off': 'Off',
        'usage.offHint': 'Usage is off; session logs are not read.',
        'usage.cacheNote': 'Session cache: the parsed result DSH keeps per conversation (under storages/session_projcache in the DSH data directory), so logs are not replayed every time. Deleting a conversation removes only its own cache record.',
        'batch.confirmAll': 'Confirm deleting all {n}?',
        'batch.rowOwn': 'This conversation',
        'batch.rowFamily': 'Whole family',
        'dialog.title': 'Delete conversation',
        'dialog.desc': '“{title}” will be deleted permanently: its session log, workspace account and projection cache are removed. This cannot be undone.',
        'dialog.untitled': 'Untitled conversation',
        'dialog.cancel': 'Cancel',
        'dialog.checking': 'Checking…',
        'dialog.deleting': 'Deleting…',
        'dialog.failed': 'Delete failed',
        'dialog.running': 'This conversation still has unfinished work:',
        'dialog.runningHint': 'Confirming stops that work first, then deletes the conversation.',
        'dialog.open': 'The Harness still holds it open (it may be showing in a window or tab). Deleting removes it from the list at once.',
        'dialog.unknown': 'Its current state could not be read; deleting is still possible.',
        'dialog.descendants': 'Deleted together with it: {list}.',
        'dialog.descendants.subagents': '{n} subagent conversation(s)',
        'dialog.descendants.derived': '{n} conversation(s) forked off it',
        'dialog.listSeparator': ', ',
        'dialog.group.subagents': 'Subagents',
        'dialog.group.derived': 'Forked conversations',
        'dialog.group.subagentsCount': 'Subagents ({n})',
        'dialog.group.derivedCount': 'Forked conversations ({n})',
        'dialog.header.subagents': 'Subagents',
        'dialog.mainRow': 'This conversation: {title}',
        'dialog.selectAll': 'Delete all ({n})',
        'dialog.selectPartial': '{m} of {n} selected',
        'dialog.expandHint': 'Click a group title to collapse it',
        'dialog.truncated': 'There are {n}; only the first {shown} are listed.',
        'dialog.maxDeletable': 'At most {max} can be deleted at once — select in batches.',
        'dialog.itemRunning': 'running',
        'dialog.itemActive': 'has unfinished work',
        'dialog.itemOpen': 'open',
        'dialog.warnings': 'These leads could not be read, so the family may be incomplete:',
        'dialog.untitledItem': 'Untitled',
        'dialog.confirmCount': 'Delete {n} conversations',
        'dialog.confirmStopCount': 'Stop and delete {n} conversations',
        'dialog.openMainDirectory': 'Open conversation folder',
        'dialog.openDirectory': 'Open folder',
        'dialog.folder': 'Open this node’s folder',
        'dialog.folderNone': 'This node has no folder of its own',
        'dialog.lastActive': 'Last active: {time}',
        'dialog.totalTokens': 'Total tokens',
        'dialog.hitRate': 'Cache hit rate',
        'dialog.cacheHit': 'Cache-hit input',
        'dialog.cacheMiss': 'Cache-miss input',
        'dialog.cacheOutput': 'Output',
        'dialog.lastActiveLabel': 'Last active',
        'dialog.selfTotal': 'This conversation',
        'dialog.familyTotal': 'Whole branch',
        'dialog.noUsage': 'No model request recorded yet',
        'dialog.incomplete': 'Count incomplete: {note}',
        'dialog.openFailed': 'Could not open the folder: {message}',
        'dialog.opened': 'Opened in the file manager',
        'dialog.usageCard': 'Usage',
        'dialog.familyCard': 'Conversation family',
        'dialog.tokensUnit': 'tokens',
        'dialog.siblingsNote': 'This conversation contains {subagents} subagent and {derived} forked conversation(s).',
      },
    }

    /** Fill one `{name}` placeholder set in a dictionary string. */
    function interpolate(text, params) {
      if (params === undefined) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /**
     * Translate through the registered locale when there is one. The fallback
     * is English, the package's primary copy: if the locale service never
     * arrives, a reader who does not read Chinese must not get Chinese.
     */
    let translate = null
    function t(key, params) {
      if (translate !== null) {
        try {
          const value = translate(key, params)
          if (typeof value === 'string' && value !== '') return value
        } catch {
          // A missing key falls through to the local table below.
        }
      }
      const fallback = DICT.en[key] ?? DICT.zh[key]
      return typeof fallback === 'string' ? interpolate(fallback, params) : key
    }

    // ---- the pending confirmation, shared by the row and the dialog ----------
    let pending = null
    const listeners = new Set()
    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    function getPending() {
      return pending
    }
    function openConfirm(request) {
      pending = request
      for (const listener of [...listeners]) listener()
    }
    function settle() {
      pending = null
      for (const listener of [...listeners]) listener()
    }

    // ---- the bulk view, opened from the icon beside the workspace search ----
    let bulkOpen = false
    const bulkListeners = new Set()
    function subscribeBulk(listener) {
      bulkListeners.add(listener)
      return () => bulkListeners.delete(listener)
    }
    function getBulkOpen() {
      return bulkOpen
    }
    function setBulkOpen(next) {
      if (bulkOpen === next) return
      bulkOpen = next
      for (const listener of [...bulkListeners]) listener()
    }

    // ---- whether usage is read at all ----------------------------------
    // Off means the Host never folds a log: the requests carry `usage=0`, and
    // the answers come back with `usage: { disabled: true }`.
    const USAGE_KEY = 'better-dsh-session-deletetool:usage'
    function readUsageEnabled() {
      try {
        return window.localStorage.getItem(USAGE_KEY) !== '0'
      } catch {
        return true
      }
    }
    let usageEnabled = readUsageEnabled()
    const usageListeners = new Set()
    function subscribeUsage(listener) {
      usageListeners.add(listener)
      return () => usageListeners.delete(listener)
    }
    function getUsageEnabled() {
      return usageEnabled
    }
    function setUsageEnabled(next) {
      if (usageEnabled === next) return
      usageEnabled = next
      try {
        window.localStorage.setItem(USAGE_KEY, next ? '1' : '0')
      } catch {
        // A storage-less shell still honours the switch for this page.
      }
      for (const listener of [...usageListeners]) listener()
    }

    /** One failed Host answer, carrying its stable code and details. */
    function failureOf(payload, response) {
      const failed = Array.isArray(payload?.failed) ? payload.failed : []
      const reasons = failed
        .map((entry) => (typeof entry?.message === 'string' ? entry.message : ''))
        .filter((message) => message !== '')
      // A batch always answers 200 and carries its reason in failed[], never at
      // the top level; without this the refusal surfaced as a bare status code.
      const summary = reasons.length > 0
        ? reasons.join('；')
        : failed.length > 0
          ? t('batch.allFailed', { n: failed.length, codes: failed.map((entry) => entry?.code ?? 'unknown').join('、') })
          : `HTTP ${response.status}`
      const error = new Error(payload?.message ?? summary)
      error.code = payload?.code ?? failed[0]?.code
      error.activity = Array.isArray(payload?.activity) ? payload.activity : null
      error.failed = failed
      error.removed = Array.isArray(payload?.removed) ? payload.removed : null
      return error
    }

    /** The usage switch both dialogs share. */
    function UsageSwitch(props) {
      const on = useSyncExternalStore(subscribeUsage, getUsageEnabled)
      return h('label', { className: `dsd-usageSwitch${props.compact === true ? ' dsd-usageSwitchSm' : ''}` }, [
        h('input', {
          type: 'checkbox',
          className: 'dsd-check',
          checked: on,
          onChange: () => setUsageEnabled(!on),
        }),
        h('span', { children: t('usage.toggle') }),
      ])
    }

    /** Ask the Host what this Session's state is before committing to anything. */
    async function inspectSession(sessionId, usage = true) {
      const suffix = usage === false ? '&usage=0' : ''
      const response = await fetch(`${INSPECT_PATH}?sessionId=${encodeURIComponent(sessionId)}${suffix}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
    }

    /**
     * Ask the Host to open one Session's local directory in the file manager.
     *
     * The body names a Session, never a path: the Host resolves and validates the
     * directory itself, so the Client cannot be tricked into launching a shell on
     * an arbitrary folder.
     * @param sessionId - the Session whose folder should open.
     * @returns {Promise<object>} the Host's answer, carrying the opened path.
     */
    async function openSessionDirectory(sessionId) {
      const response = await fetch(OPEN_DIRECTORY_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
    }

    /**
     * Ask the Host half to delete one Session.
     * @param sessionId - the Session the user acted on.
     * @param stop - whether running work may be stopped first.
     * @param descendants - the descendant ids the user ticked; always sent, so
     *   the Host deletes exactly what the dialog showed.
     */
    async function deleteSession(sessionId, stop, descendants) {
      const response = await fetch(DELETE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, stop: stop === true, descendants }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
    }

    /** Ask the Host to open DSH's projection-cache folder. */
    async function openCacheDirectory() {
      const response = await fetch(OPEN_CACHE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
    }


    /** Read the whole corpus, grouped by Workspace, for the bulk dialog. */
    async function fetchCatalog(usage = true) {
      const suffix = usage === false ? '?usage=0' : ''
      const response = await fetch(`${CATALOG_PATH}${suffix}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
    }

    /**
     * Ask the Host half to delete one root and the descendants it was left with.
     * @param roots - the ticked roots, each with its own descendant selection.
     * @param stop - whether running work may be stopped first.
     * @param cleanCache - whether the projection cache goes with each Session.
     */
    async function deleteBatch(roots, stop, cleanCache) {
      const response = await fetch(BATCH_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roots, stop: stop === true, cleanCache: cleanCache !== false }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
    }

    /** The activity families reported for one Session, or an empty list. */
    function activityOf(entity) {
      return Array.isArray(entity?.activity) ? entity.activity : []
    }

    /** The tail of an id, so two same-titled Sessions stay distinguishable. */
    function shortId(id) {
      return typeof id === 'string' && id.length > 6 ? `…${id.slice(-6)}` : id
    }

    /**
     * Fold the per-Session activity a refusal reported back into the state the
     * dialog is showing, so the rows that are busy say so on the next render.
     */
    function mergeActivity(info, activeSessions) {
      if (info === null || info === undefined) return info
      const byId = new Map()
      for (const entry of activeSessions) {
        if (typeof entry?.sessionId !== 'string') continue
        byId.set(entry.sessionId, Array.isArray(entry.activity) ? entry.activity : [])
      }
      const descendants = info.descendants === undefined
        ? undefined
        : {
          ...info.descendants,
          items: Array.isArray(info.descendants.items)
            ? info.descendants.items.map((item) => (byId.has(item.id) ? { ...item, activity: byId.get(item.id) } : item))
            : info.descendants.items,
        }
      return {
        ...info,
        activity: byId.get(info.sessionId) ?? activityOf(info),
        ...(descendants === undefined ? {} : { descendants }),
      }
    }

    // ---- the menu row -------------------------------------------------------
    /** One "⋯" menu row (order 500): ask to delete this Session. */
    function DeleteSessionMenuItem(props) {
      const { sessionId, displayTitle, useMenuOpenState } = props
      const menuOpenState = typeof useMenuOpenState === 'function' ? useMenuOpenState : null
      const setMenuOpen = menuOpenState === null ? null : menuOpenState()[1]
      const onSelect = useCallback(() => {
        if (setMenuOpen !== null) setMenuOpen(false)
        openConfirm({ sessionId, title: displayTitle })
      }, [sessionId, displayTitle, setMenuOpen])
      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dsd-item dsd-danger',
        onClick: onSelect,
        children: [
          h('span', { className: 'dsd-itemIcon', key: 'icon', children: trashIcon() }),
          h('span', { className: 'dsd-itemLabel', key: 'label', children: t('menu.delete') }),
        ],
      })
    }

    /** One 17px trash glyph with a centre bar, drawn in the menu icon's colour. */
    function trashIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 17,
          height: 17,
          fill: 'none',
          shapeRendering: 'geometricPrecision',
          'aria-hidden': true,
        },
        h('path', {
          // The can keeps a shallow taper (`l0.25 8.1` per wall) so the lower
          // half stays wide at this size, and one centre bar gives the small
          // glyph something to read as a bin rather than an empty box.
          d: 'M3 4.5h10M6.5 4.5V3.25A.75.75 0 0 1 7.25 2.5h1.5a.75.75 0 0 1 .75.75V4.5M4.5 4.5l0.25 8.1a0.85 0.85 0 0 0 0.85 0.8h4.8a0.85 0.85 0 0 0 0.85-0.8L11.5 4.5M8 7.75v3.9',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * The bulk-delete drawing: five stroked paths on a 32-unit box.
     *
     * The walls are stroked, not filled. The earlier drawing outlined every
     * wall as a closed filled shape, so each wall rendered as a hairline band
     * with two anti-aliased edges and went soft — and looked washed out — on
     * fractional-DPI (4K-scaled) screens; one stroked contour per wall keeps
     * the glyph crisp. The stroke width, caps and joins come from the svg
     * element, and `strokeWidth: 2` on the 32-unit box is the shipped icon
     * set's 1px at 16px, and just over that at the 18px this control draws.
     *
     * The can keeps its taper shallow on purpose (`l0.4 15.7` per wall): a
     * steeper one leaves the lower half too narrow to read beside the host's
     * own straight-sided icons.
     */
    const BULK_ICON_SHAPES = [
      'M6 9.5h20',
      'M13 9.5V7.6A1.6 1.6 0 0 1 14.6 6h2.8A1.6 1.6 0 0 1 19 7.6v1.9',
      'M9.25 9.5l0.4 15.7a1.8 1.8 0 0 0 1.8 1.75h9.1a1.8 1.8 0 0 0 1.8-1.75L22.75 9.5',
      'M14 14.5v7.5',
      'M18 14.5v7.5',
    ]

    /**
     * The rendered box of the bulk glyph, in CSS pixels. One step above the
     * shipped 16px icon set: the trash drawing reads small beside the host's
     * own icons, and the extra pixels also give the 1px stroke more to sit on.
     */
    const BULK_ICON_SIZE = 18

    /**
     * The bulk-delete glyph, drawn in the icon set's own outline convention.
     * @param {number} size - the rendered box, in CSS pixels.
     * @returns {object} the SVG element.
     */
    function bulkIcon(size) {
      return h(
        'svg',
        {
          viewBox: '0 0 32 32',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          shapeRendering: 'geometricPrecision',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        BULK_ICON_SHAPES.map((d, index) => h('path', { key: index, d })),
      )
    }

    /**
     * The same glyph as markup, for the plain DOM button the anchor mounts.
     *
     * The button lives outside React, so the drawing is serialised here instead
     * of rendered: one source of truth for the geometry (`BULK_ICON_SHAPES`), two
     * ways of emitting it. Nothing but this module's own constants reaches the
     * string.
     * @param {number} size - the rendered box, in CSS pixels.
     * @returns {string} the SVG markup.
     */
    function bulkIconMarkup(size) {
      const paths = BULK_ICON_SHAPES.map((d) => `<path d="${d}"/>`).join('')
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"`
        + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
        + ' shape-rendering="geometricPrecision"'
        + ` aria-hidden="true" focusable="false" style="display:block">${paths}</svg>`
    }

    /**
     * The bulk-delete entry point, placed to the left of the workspace search icon.
     *
     * The browsing region is a `single` slot, so a second registrant would shadow
     * the shipped WorkspaceBrowser rather than sit beside it. This entry therefore
     * registers in the sidebar footer, renders only a hidden placeholder, and
     * mounts one element just ahead of the region's own search slot — a sibling
     * of the slot, never a child of it, so a themed build that visually hides
     * the slot (dsh-claude-style collapses it in its non-icon search styles)
     * hides the slot alone and leaves this control standing. The insertion is
     * additive and reversible: a mutation observer re-creates the element when
     * React re-renders the header, and the element and the observer both go away
     * with this registration.
     */
    function BulkDeleteAnchor() {
      useEffect(() => {
        const node = document.createElement('button')
        node.type = 'button'
        node.className = 'dsd-anchor'
        node.setAttribute('data-dsh-plugin', 'better-dsh-session-deletetool')
        node.title = t('icon.batch')
        node.setAttribute('aria-label', t('icon.batch'))
        // The button is a plain DOM node, so the glyph goes in as markup; it is
        // written from the same path set the React side draws, and carries no
        // user text, so this is not a sink for anything but our own constant.
        node.innerHTML = bulkIconMarkup(BULK_ICON_SIZE)
        const onClick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          setBulkOpen(true)
        }
        node.addEventListener('click', onClick)

        /**
         * Put the button immediately ahead of the search slot, as its previous
         * sibling in the header row — not inside the slot, which a themed build
         * may hide wholesale. The class names are the shipped build's CSS-module
         * output and the `aria-label` is its localized search label, so each
         * lookup carries a second signal; with neither present the button stays
         * unmounted instead of landing somewhere arbitrary.
         */
        const mount = () => {
          const slot = document.querySelector('[class*="_searchSlot"]')
          if (slot !== null && slot.parentElement !== null) {
            if (node.parentElement !== slot.parentElement || node.nextElementSibling !== slot) {
              slot.parentElement.insertBefore(node, slot)
            }
            return true
          }
          if (!node.isConnected) {
            const search = document.querySelector('[class*="_searchButton"]')
            if (search !== null && search.parentElement !== null) {
              search.parentElement.insertBefore(node, search)
              return true
            }
          }
          return false
        }

        // The region is mounted by its own entry, which may come after this one.
        const observer = new MutationObserver(() => {
          if (!node.isConnected) mount()
        })
        observer.observe(document.body, { childList: true, subtree: true })
        mount()

        return () => {
          observer.disconnect()
          node.removeEventListener('click', onClick)
          node.remove()
        }
      }, [])

      // Nothing is rendered in the footer itself: the control lives in the search
      // slot, and an empty list entry leaves the shipped footer row untouched.
      return null
    }

    // ---- the confirmation dialog -------------------------------------------
    const IDLE = { phase: 'idle', info: null, error: null, stop: false, busy: false }

    /** The `shell.overlay` seat: one confirmation while a delete is pending. */
    function DeleteSessionDialog() {
      const request = useSyncExternalStore(subscribe, getPending)
      const [state, setState] = useState(IDLE)
      const [selected, setSelected] = useState(null)
      const [collapsed, setCollapsed] = useState({})
      const dialog = useRef(null)
      /** The Session whose folder is opening right now, and the last failure. */
      const [openingFolder, setOpeningFolder] = useState(null)
      const [folderError, setFolderError] = useState(null)
      /** The shared switch: when off, the Host is asked not to read any log. */
      const usageOn = useSyncExternalStore(subscribeUsage, getUsageEnabled)

      const close = useCallback(() => {
        setState((previous) => {
          if (previous.busy) return previous
          settle()
          return IDLE
        })
        setSelected(null)
      }, [])

      /**
       * Open one row's folder through the Host. The Host owns the path, so this
       * only says which Session; a refusal (no directory, backend without the
       * hook) comes back as a readable message on the summary card.
       */
      const openFolder = useCallback((sessionId) => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        setOpeningFolder(sessionId)
        setFolderError(null)
        openSessionDirectory(sessionId).then(
          () => setOpeningFolder(null),
          (reason) => {
            setOpeningFolder(null)
            setFolderError(reason instanceof Error ? reason.message : String(reason))
          },
        )
      }, [])

      // Every open re-reads the Host's state: the answer is only true for the
      // moment the dialog opened, and a Session can start working in between.
      // Nobody is selected until that answer arrives, so a Session whose family
      // is still being walked can never be deleted by accident.
      useEffect(() => {
        if (request === null) {
          setState(IDLE)
          setSelected(null)
          return undefined
        }
        let cancelled = false
        setState({ phase: 'checking', info: null, error: null, stop: false, busy: false })
        setSelected(null)
        inspectSession(request.sessionId, usageOn).then(
          (info) => {
            if (cancelled) return
            const items = Array.isArray(info?.descendants?.items) ? info.descendants.items : []
            setSelected(new Set(items.map((item) => item.id)))
            setState({
              phase: 'ready',
              info,
              error: null,
              // Default to stopping work, but only when something is running.
              stop: activityOf(info).length > 0 || items.some((item) => activityOf(item).length > 0),
              busy: false,
            })
          },
          () => {
            if (!cancelled) setState({ phase: 'ready', info: null, error: null, stop: false, busy: false })
          },
        )
        return () => {
          cancelled = true
        }
      }, [request, usageOn])

      useEffect(() => {
        if (request === null) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close()
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
      }, [request, close])

      useEffect(() => {
        if (request !== null) dialog.current?.focus()
      }, [request])

      if (request === null) return null

      const info = state.info
      const items = Array.isArray(info?.descendants?.items) ? info.descendants.items : []
      const picked = selected ?? new Set(items.map((item) => item.id))
      const selectedCount = items.filter((item) => picked.has(item.id)).length

      const toggleMany = (ids, on) => {
        setSelected(() => {
          const next = new Set(picked)
          for (const id of ids) {
            if (on) next.add(id)
            else next.delete(id)
          }
          return next
        })
      }

      const confirm = () => {
        if (state.busy || state.phase !== 'ready') return
        const chosen = items.filter((item) => picked.has(item.id)).map((item) => item.id)
        setState((previous) => ({ ...previous, busy: true, error: null }))
        deleteSession(request.sessionId, state.stop, chosen).then(
          () => {
            settle()
            setSelected(null)
            setState(IDLE)
          },
          (reason) => {
            // A Session that started working between the check and the write
            // answers with its activity, so the next press stops it and the rows
            // that are busy say so.
            const active = Array.isArray(reason?.activeSessions) ? reason.activeSessions : null
            setState((previous) => ({
              ...previous,
              busy: false,
              error: reason instanceof Error ? reason.message : String(reason),
              stop: previous.stop || reason?.code === 'session-active' || active !== null,
              info: active === null ? previous.info : mergeActivity(previous.info, active),
            }))
          },
        )
      }

      const title = request.title === undefined || request.title === '' ? t('dialog.untitled') : request.title
      const activity = activityOf(info)
      const checking = state.phase === 'checking'
      const deletedCount = selectedCount + 1
      const confirmLabel = state.busy || checking
        ? (checking ? t('dialog.checking') : t('dialog.deleting'))
        : state.stop
          ? t('dialog.confirmStopCount', { n: deletedCount })
          : t('dialog.confirmCount', { n: deletedCount })

      return h('div', {
        className: 'dsd-overlay',
        role: 'presentation',
        onKeyDownCapture: (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        },
      }, [
        h('div', { className: 'dsd-mask', key: 'mask', 'aria-hidden': true, onClick: close }),
        h('div', {
          className: 'dsd-dialog',
          key: 'dialog',
          ref: dialog,
          tabIndex: -1,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('dialog.title'),
        }, [
          h('div', { className: 'dsd-head', key: 'head' }, [
            h('span', { className: 'dsd-headIcon', key: 'icon', 'aria-hidden': true, children: treeGlyph('trash', 18) }),
            h('h2', { className: 'dsd-title', key: 'title', children: t('dialog.title') }),
            h(UsageSwitch, { key: 'usage', compact: true }),
            h('button', {
              type: 'button',
              className: 'dsd-close',
              key: 'close',
              'aria-label': t('dialog.cancel'),
              onClick: close,
              children: '×',
            }),
          ]),
          info === null
            ? null
            : h(SessionSummary, {
              key: 'summary',
              title,
              usage: info.usage?.self,
              familyUsage: info.usage?.family,
              usageDisabled: info.usage?.disabled === true,
              directory: info.directory,
              onOpen: () => openFolder(request.sessionId),
              opening: openingFolder === request.sessionId,
              openError: folderError,
            }),
          h('p', { className: 'dsd-desc', key: 'desc', children: t('dialog.desc', { title }) }),
          activity.length === 0
            ? null
            : h('div', { className: 'dsd-note dsd-warn', key: 'running' }, [
              h('p', { className: 'dsd-noteTitle', key: 'head', children: t('dialog.running') }),
              h('ul', { className: 'dsd-list', key: 'list' }, activity.map((entry, index) => {
                const names = Array.isArray(entry.items)
                  ? entry.items.map((item) => (item.label === '' ? item.id : item.label)).filter((name) => name !== '')
                  : []
                return h('li', { key: `${entry.kind}-${index}` }, names.length === 0 ? entry.label : `${entry.label}：${names.join('、')}`)
              })),
              h('p', { className: 'dsd-noteHint', key: 'hint', children: t('dialog.runningHint') }),
            ]),
          info !== null && info.open === true && activity.length === 0
            ? h('p', { className: 'dsd-note', key: 'open', children: t('dialog.open') })
            : null,
          state.phase === 'ready' && info === null
            ? h('p', { className: 'dsd-note', key: 'unknown', children: t('dialog.unknown') })
            : null,
          h(FamilyTree, {
            key: 'tree',
            items,
            implicitParent: request.sessionId,
            main: title,
            selected: picked,
            onToggle: toggleMany,
            collapsed,
            setCollapsed,
            disabled: state.busy,
            onOpenDirectory: openFolder,
            mainUsage: info?.usage?.self,
            mainFamilyUsage: info?.usage?.family,
            mainDirectory: info?.directory,
            mainSessionId: request.sessionId,
            usageDisabled: info?.usage?.disabled === true,
            leafName: t('dialog.untitledItem'),
          }),
          info?.descendants?.truncated === true
            ? h('p', {
              className: 'dsd-note dsd-hint',
              key: 'truncated',
              children: t('dialog.truncated', { n: info.descendants.count, shown: items.length }),
            })
            : null,
          typeof info?.descendants?.maxDeletable === 'number' && info.descendants.count > info.descendants.maxDeletable
            ? h('p', {
              className: 'dsd-note dsd-hint',
              key: 'cap',
              children: t('dialog.maxDeletable', { max: info.descendants.maxDeletable }),
            })
            : null,
          // A source that failed leaves rows missing, which no row can say for
          // itself: this is where the family's own report of that lands.
          ...(Array.isArray(info?.warnings) && info.warnings.length > 0
            ? [h('div', { className: 'dsd-note dsd-warn', key: 'warnings' }, [
              h('p', { className: 'dsd-noteTitle', key: 'head', children: t('dialog.warnings') }),
              h('ul', { className: 'dsd-list', key: 'list' }, info.warnings.map((warning, index) => h('li', { key: index }, String(warning)))),
            ])]
            : []),
          state.error === null
            ? null
            : h('p', { className: 'dsd-error', key: 'error', children: `${t('dialog.failed')}：${state.error}` }),
          h('div', { className: 'dsd-footer', key: 'footer' }, [
            h('button', {
              type: 'button',
              className: 'dsd-button dsd-outline',
              key: 'cancel',
              disabled: state.busy,
              onClick: close,
              children: t('dialog.cancel'),
            }),
            h('button', {
              type: 'button',
              className: 'dsd-button dsd-solid dsd-danger',
              key: 'confirm',
              disabled: state.busy || checking,
              onClick: confirm,
              children: confirmLabel,
            }),
          ]),
        ]),
      ])
    }

    /** The indent one tree level adds, in CSS pixels. */
    const INDENT = 18

    /**
     * The 16px outline glyphs the family tree draws, each as [tag, attributes]
     * pairs in the shipped icon set's own convention: fill none, stroke
     * currentColor, round joins, on a 16px box.
     */
    const TREE_GLYPHS = {
      // The conversation itself: a document with a folded corner.
      session: [
        ['path', { d: 'M3.5 2.5H9L12.5 6v7.5h-9z' }],
        ['path', { d: 'M9 2.5V6h3.5' }],
        ['path', { d: 'M5.75 8.75h4.5' }],
        ['path', { d: 'M5.75 11.25h2.75' }],
      ],
      // A spawned Session: a robot head. Marks the 子智能体 block.
      subagent: [
        ['path', { d: 'M4.5 6.5h7A1.5 1.5 0 0 1 13 8v3.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5V8a1.5 1.5 0 0 1 1.5-1.5z' }],
        ['path', { d: 'M8 6.5V3.75' }],
        ['path', { d: 'M6.5 3.75h3' }],
        ['circle', { cx: 6.35, cy: 9.3, r: 0.7 }],
        ['circle', { cx: 9.65, cy: 9.3, r: 0.7 }],
      ],
      // One subagent Session's own row.
      member: [
        ['path', { d: 'M8 7.75A2.125 2.125 0 1 0 8 3.5a2.125 2.125 0 0 0 0 4.25z' }],
        ['path', { d: 'M3.75 13.5c0-2.35 1.9-3.75 4.25-3.75s4.25 1.4 4.25 3.75' }],
      ],
      // A derived conversation: a chat bubble. Marks the 派生对话 block.
      chat: [
        ['path', { d: 'M14 10a1.33 1.33 0 0 1-1.33 1.33H4.67L2 14V3.33A1.33 1.33 0 0 1 3.33 2h9.34A1.33 1.33 0 0 1 14 3.33z' }],
      ],
      // The relation a fork is: two links.
      linked: [
        ['path', { d: 'M6.67 8.67a3.33 3.33 0 0 0 5.03.36l2-2a3.33 3.33 0 0 0-4.71-4.71l-1.15 1.14' }],
        ['path', { d: 'M9.33 7.33a3.33 3.33 0 0 0-5.03-.36l-2 2a3.33 3.33 0 0 0 4.71 4.71l1.14-1.14' }],
      ],
      // The delete icon the dialog header and the menu row share: a bin.
      trash: [
        ['path', { d: 'M3 4.6h10' }],
        ['path', { d: 'M6.2 4.6V3.4a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.2' }],
        ['path', { d: 'M4.2 4.6l.6 8.1a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.1' }],
        ['path', { d: 'M6.9 7.1v4.2M9.1 7.1v4.2' }],
      ],
    }

    /** One outline glyph, drawn at the given box size. */
    function treeGlyph(name, size) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block' },
      }, TREE_GLYPHS[name].map((entry, index) => h(entry[0], { key: index, ...entry[1] })))
    }

    /**
     * Compact token count: 872, 48.7K, 1.2M. One decimal at most, a bare zero
     * for a Session that has not run yet, so a metric row never changes width
     * with a locale's own digit grouping.
     */
    function formatTokens(value) {
      const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
      if (n <= 0) return '0'
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
      return String(Math.round(n))
    }

    /** A 0..1 rate as a one-decimal percentage; never a bare NaN. */
    function formatPercent(rate) {
      const value = typeof rate === 'number' && Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0
      return `${(value * 100).toFixed(1)}%`
    }

    /** A log timestamp as `YYYY-MM-DD HH:mm`, in the viewer's own time zone. */
    function formatMoment(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
      const at = new Date(value)
      const pad = (n) => String(n).padStart(2, '0')
      return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
    }

    /**
     * The three shares the bar and the legend report.
     *
     * The denominator is every token shown in the bar, so the three percentages
     * always add up to 100 and neither the bar nor the legend can silently drop a
     * bucket. `cacheWriteTokens` is folded into the miss share for the same
     * reason: it is prompt the provider did not serve from cache.
     */
    function sharesOf(usage) {
      const read = Math.max(0, usage?.cacheReadInputTokens ?? 0)
      const miss = Math.max(0, usage?.cacheMissInputTokens ?? 0) + Math.max(0, usage?.cacheWriteTokens ?? 0)
      const output = Math.max(0, usage?.outputTokens ?? 0)
      const total = read + miss + output
      if (total <= 0) return { read: 0, miss: 0, output: 0, total: 0 }
      return { read: read / total, miss: miss / total, output: output / total, total }
    }

    /** One 16px outline glyph from a list of [tag, attributes] pairs. */
    function strokeGlyph(paths, size) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block' },
      }, paths.map((entry, index) => h(entry[0], { key: index, ...entry[1] })))
    }

    /** The folder a row's open button draws. */
    function folderGlyph(size) {
      return strokeGlyph([
        ['path', { key: 'body', d: 'M2 4.6A1.6 1.6 0 0 1 3.6 3h2.5l1.4 1.7h5A1.5 1.5 0 0 1 14 6.2v5.2a1.6 1.6 0 0 1-1.6 1.6h-8.8A1.6 1.6 0 0 1 2 11.4z' }],
      ])
    }

    /** The clock the metric row draws before the last-activity time. */
    function clockGlyph(size) {
      return strokeGlyph([
        ['circle', { key: 'c', cx: 8, cy: 8, r: 5.75 }],
        ['path', { key: 'h', d: 'M8 4.9V8l2.2 1.4' }],
      ])
    }

    /** The stacked coins the total-token metric draws. */
    function tokensGlyph(size) {
      return strokeGlyph([
        ['ellipse', { key: 't', cx: 8, cy: 4.6, rx: 4.9, ry: 1.9 }],
        ['path', { key: 'b', d: 'M3.1 4.6v3.1c0 1.05 2.19 1.9 4.9 1.9s4.9-.85 4.9-1.9V4.6' }],
        ['path', { key: 'b2', d: 'M3.1 7.7v3.1c0 1.05 2.19 1.9 4.9 1.9s4.9-.85 4.9-1.9V7.7' }],
      ])
    }

    /** The shield the cache-hit metric draws. */
    function cacheGlyph(size) {
      return strokeGlyph([
        ['path', { key: 's', d: 'M8 2.2 12.6 4v4.1c0 2.6-1.9 4.6-4.6 5.7-2.7-1.1-4.6-3.1-4.6-5.7V4z' }],
        ['path', { key: 't', d: 'M5.9 8.1 7.4 9.6l2.9-3' }],
      ])
    }

    /**
     * The horizontal three-way bar: cache-hit input, cache-miss input, output.
     *
     * Rendered from flex-grow shares rather than pixel widths, so it fits any
     * dialog width, stays crisp on a HiDPI screen and never overflows when one
     * bucket dominates. An empty Session draws a track with no segments.
     */
    function UsageBar(props) {
      const shares = sharesOf(props.usage)
      if (shares.total <= 0) {
        return h('div', { className: 'dsd-bar dsd-barEmpty', key: 'bar', 'aria-hidden': true })
      }
      const segment = (share, className, key) => (share > 0
        ? h('span', { key, className: `dsd-barSeg ${className}`, style: { flexGrow: share } })
        : null)
      return h('div', {
        className: 'dsd-bar',
        key: 'bar',
        role: 'img',
        'aria-label': `${t('dialog.cacheHit')} ${formatPercent(shares.read)}，${t('dialog.cacheMiss')} ${formatPercent(shares.miss)}，${t('dialog.cacheOutput')} ${formatPercent(shares.output)}`,
      }, [
        segment(shares.read, 'dsd-hit', 'hit'),
        segment(shares.miss, 'dsd-miss', 'miss'),
        segment(shares.output, 'dsd-out', 'output'),
      ])
    }

    /** The three labelled percentages under a bar. */
    function UsageLegend(props) {
      const usage = props.usage ?? {}
      const shares = sharesOf(usage)
      const rows = [
        ['dsd-hit', t('dialog.cacheHit'), usage.cacheReadInputTokens ?? 0],
        ['dsd-miss', t('dialog.cacheMiss'), (usage.cacheMissInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0)],
        ['dsd-out', t('dialog.cacheOutput'), usage.outputTokens ?? 0],
      ]
      return h('div', { className: 'dsd-legend' }, rows.map(([className, label, value]) => {
        const share = shares.total <= 0 ? 0 : value / shares.total
        return h('span', { className: 'dsd-legendItem', key: className }, [
          h('span', { className: `dsd-dot ${className}`, key: 'dot', 'aria-hidden': true }),
          h('span', { className: 'dsd-legendLabel', key: 'label', children: `${label}：` }),
          h('span', { className: 'dsd-legendValue', key: 'value', children: `${formatTokens(value)} · ${formatPercent(share)}` }),
        ])
      }))
    }

    /**
     * One metric cell: a glyph, a caption and a value.
     * @param {object} props - the glyph, label and text.
     */
    function Metric(props) {
      return h('span', { className: 'dsd-metric', title: props.title }, [
        h('span', { className: `dsd-metricGlyph ${props.tone ?? ''}`, key: 'glyph', 'aria-hidden': true, children: props.glyph }),
        h('span', { className: 'dsd-metricBody', key: 'body' }, [
          h('span', { className: 'dsd-metricLabel', key: 'label', children: props.label }),
          h('span', { className: 'dsd-metricValue', key: 'value', children: props.value }),
        ]),
      ])
    }

    /**
     * The summary card at the top of the single-Session dialog (reference
     * layout A): who the conversation is, when it last ran, what it cost, how
     * much of that was served from cache, and the one action that opens its
     * folder.
     * @param {object} props - title, usage, directory, open state and the open callback.
     */
    function SessionSummary(props) {
      const { title, usage, familyUsage, directory, onOpen, opening, openError, usageDisabled } = props
      const usageOff = usageDisabled === true
      const available = directory?.available === true
      const lastActive = formatMoment(usage?.lastActivityAt)
      const hitRate = typeof usage?.hitRate === 'number' ? usage.hitRate : 0
      const familyTotal = familyUsage?.totalTokens ?? 0
      return h('section', { className: 'dsd-card dsd-cardSummary' }, [
        h('div', { className: 'dsd-cardHead', key: 'head' }, [
          h('span', { className: 'dsd-avatar', key: 'avatar', 'aria-hidden': true, children: treeGlyph('session', 18) }),
          h('h3', { className: 'dsd-cardTitle', key: 'title', title: title, children: title }),
          h('button', {
            type: 'button',
            className: 'dsd-ghost',
            key: 'open',
            disabled: !available || opening === true,
            title: available ? (directory.path ?? '') : (directory?.reason ?? t('dialog.folderNone')),
            onClick: () => onOpen(),
            children: [
              h('span', { className: 'dsd-ghostIcon', key: 'icon', children: folderGlyph(14) }),
              t('dialog.openDirectory'),
            ],
          }),
        ]),
        h('div', { className: 'dsd-metrics', key: 'metrics' }, [
          h(Metric, {
            key: 'last',
            glyph: clockGlyph(12),
            label: t('dialog.lastActiveLabel'),
            value: lastActive === '' ? '—' : lastActive,
          }),
          h(Metric, {
            key: 'tokens',
            glyph: tokensGlyph(12),
            tone: 'dsd-toneBlue',
            label: t('dialog.totalTokens'),
            value: usageOff ? t('usage.off') : `${formatTokens(usage?.totalTokens ?? 0)} ${t('dialog.tokensUnit')}`,
          }),
          h(Metric, {
            key: 'family',
            glyph: tokensGlyph(12),
            tone: 'dsd-toneBlue',
            label: t('dialog.familyTotal'),
            value: usageOff ? t('usage.off') : `${formatTokens(familyTotal)} ${t('dialog.tokensUnit')}`,
          }),
          h(Metric, {
            key: 'hit',
            glyph: cacheGlyph(12),
            tone: 'dsd-toneGreen',
            label: t('dialog.hitRate'),
            value: usageOff ? t('usage.off') : formatPercent(hitRate),
          }),
        ]),
        usageOff
          ? h('p', { className: 'dsd-noteHint', key: 'usageOff', children: t('usage.offHint') })
          : h(UsageBar, { key: 'bar', usage }),
        usageOff ? null : h(UsageLegend, { key: 'legend', usage }),
        usage?.note ? h('p', { className: 'dsd-noteHint', key: 'note', children: t('dialog.incomplete', { note: usage.note }) }) : null,
        familyUsage?.note ? h('p', { className: 'dsd-noteHint', key: 'familyNote', children: t('dialog.incomplete', { note: familyUsage.note }) }) : null,
        openError ? h('p', { className: 'dsd-error', key: 'openError', children: t('dialog.openFailed', { message: openError }) }) : null,
      ])
    }

    /**
     * The family as a forest: one node per Session, its children hanging under it.
     *
     * A row whose parentId names another listed row hangs under that row. A row
     * whose parent is not listed — because it is the Session the single dialog is
     * about, because it belongs to another Workspace, or because its parent simply
     * is not in this list — is a root. A hand-edited header cycle is cut rather
     * than followed, so the drawing can never recurse forever.
     * @param {object[]} entries - the family rows, in the Host's order.
     * @param {string|null} implicitParent - the id whose children are the roots.
     * @returns {object[]} the roots, each { id, entry, children }.
     */
    function buildForest(entries, implicitParent) {
      const nodes = new Map()
      for (const entry of entries) {
        const id = entry === null || typeof entry !== 'object' ? null : entry.id
        if (typeof id !== 'string' || id === '' || nodes.has(id)) continue
        nodes.set(id, { id, entry, children: [] })
      }
      const parentOf = (node) => {
        const parentId = typeof node.entry.parentId === 'string' ? node.entry.parentId : null
        if (parentId === null || parentId === node.id) return undefined
        return nodes.get(parentId)
      }
      /** Whether hanging one node under another would close a loop. */
      const loops = (node, candidate) => {
        const guard = new Set([node.id])
        let current = candidate
        while (current !== undefined) {
          if (guard.has(current.id)) return true
          guard.add(current.id)
          current = parentOf(current)
        }
        return false
      }
      const roots = []
      for (const node of nodes.values()) {
        const parentId = typeof node.entry.parentId === 'string' ? node.entry.parentId : null
        const parent = parentId === implicitParent ? undefined : parentOf(node)
        if (parent === undefined || loops(node, parent)) roots.push(node)
        else parent.children.push(node)
      }
      return roots
    }

    /**
     * One node's whole subtree, itself first.
     * @param {object} node - a forest node.
     * @returns {string[]} the ids.
     */
    function subtreeIds(node) {
      const ids = []
      const walk = (current) => {
        ids.push(current.id)
        for (const child of current.children) walk(child)
      }
      walk(node)
      return ids
    }

    /**
     * The family tree both dialogs draw.
     *
     * One row per Session, and under every row two collapsible blocks: its direct
     * 子智能体, then its direct 派生对话. A derived conversation therefore holds
     * its own subagents, and its own derived conversations, inside its own block
     * one step further in, instead of in a second list that only shares a heading
     * with it. The nesting is expressed by the indentation alone: no connectors,
     * no guide lines, so a row's place is read from its indent.
     *
     * A row's checkbox covers that row's whole subtree, and a block's covers every
     * row the block lists. Both report the same two states: ticked when everything
     * below them is ticked, mixed when only part of it is.
     * @param {object} props - the family, the selection, and the drawing callbacks.
     */
    function FamilyTree(props) {
      const { items, implicitParent, main, selected, onToggle, collapsed, setCollapsed, disabled, leafName } = props
      const forest = buildForest(items, implicitParent === undefined ? null : implicitParent)

      /** A set of ids read as a checkbox state. */
      const stateOf = (ids) => {
        // An empty set is a row that covers nothing beyond itself: a main
        // conversation with no children at all. It is still deleted with the
        // row, so it reads as ticked instead of as an impossible choice.
        let on = true
        let some = false
        for (const id of ids) {
          if (selected.has(id)) some = true
          else on = false
        }
        return { on, partial: some && !on }
      }

      /** One checkbox: ticked when every id it covers is ticked, mixed when only some are. */
      const box = (ids) => {
        const state = stateOf(ids)
        return h('input', {
          type: 'checkbox',
          key: 'box',
          className: 'dsd-check',
          checked: state.on,
          disabled: disabled === true,
          ref: (input) => {
            if (input !== null) input.indeterminate = state.partial
          },
          onChange: () => onToggle(ids, !state.on),
        })
      }

      /** The caret of one row or block, or the empty column a leaf keeps. */
      const caret = (collapseKey, hasChildren, isCollapsed) => (hasChildren
        ? h('button', {
          type: 'button',
          key: 'caret',
          className: 'dsd-caret',
          'aria-expanded': !isCollapsed,
          onClick: () => setCollapsed((previous) => ({ ...previous, [collapseKey]: !isCollapsed })),
          children: isCollapsed ? '▸' : '▾',
        })
        : h('span', { className: 'dsd-caret dsd-caretLeaf', key: 'caret', 'aria-hidden': true }))

      /** The badges one row carries: what that Session is doing right now. */
      const badgesOf = (entry) => {
        const busy = activityOf(entry)
        return [
          ...busy.map((item) => item.label),
          ...(busy.length === 0 && entry.running === true ? [t('dialog.itemRunning')] : []),
          ...(entry.open === true ? [t('dialog.itemOpen')] : []),
        ]
      }

      /**
       * One row's right-hand figures: the token total it owns, when it last ran,
       * and the folder button that opens its own directory.
       *
       * The button sits outside the row's <label>, so pressing it opens the
       * folder instead of toggling the row's checkbox. A node the Host could not
       * locate keeps the button disabled, with the reason as its tooltip, rather
       * than offering an action that would fail.
       */
      const figuresOf = (usage, directory, sessionId, familyUsage) => {
        // The bulk dialog draws the same tree without usage or directories: a row
        // that has neither keeps the plain shape instead of a column of zeros and
        // a dead button.
        if ((usage === null || usage === undefined) && (directory === null || directory === undefined)) return null
        const available = directory?.available === true
        const own = usage?.totalTokens ?? 0
        const branch = familyUsage?.totalTokens ?? 0
        const hasBranch = familyUsage !== null && familyUsage !== undefined
        const usageOff = usage?.disabled === true || props.usageDisabled === true
        // The root row carries `own/branch`, so the two quantities can never be
        // read as one; every child row carries its own count alone.
        const tokenText = usageOff ? t('usage.off') : hasBranch ? `${formatTokens(own)}/${formatTokens(branch)}` : formatTokens(own)
        return h('span', { className: 'dsd-figures', key: 'figures' }, [
          usage === null || usage === undefined
            ? null
            : h('span', {
              className: 'dsd-nodeTokens',
              key: 'tokens',
              title: usageOff
                ? t('usage.offHint')
                : hasBranch
                  ? `${t('dialog.selfTotal')}：${formatTokens(own)}\n${t('dialog.familyTotal')}：${formatTokens(branch)}`
                  : `${t('dialog.selfTotal')}：${formatTokens(own)}`,
              children: tokenText,
            }),
          usage?.lastActivityAt
            ? h('span', { className: 'dsd-nodeTime', key: 'time', children: formatMoment(usage.lastActivityAt) })
            : null,
          h('button', {
            type: 'button',
            className: 'dsd-folder',
            key: 'folder',
            disabled: !available,
            title: available ? (directory.path ?? '') : (directory?.reason ?? t('dialog.folderNone')),
            'aria-label': available ? t('dialog.folder') : t('dialog.folderNone'),
            onClick: (event) => {
              event.preventDefault()
              event.stopPropagation()
              if (available && typeof props.onOpenDirectory === 'function') props.onOpenDirectory(sessionId)
            },
          }, folderGlyph(14)),
        ])
      }

      /**
       * One Session row and, under it, its own children as a real nested
       * subtree: a subagent that spawned its own subagent sits one level deeper,
       * a fork's children hang under the fork. The level comes from the Host's
       * `parentId` chain alone, never from a fixed order of kinds.
       */
      const drawNode = (node, key) => {
        const entry = node.entry
        const isCollapsed = collapsed[node.id] === true
        const hasChildren = node.children.length > 0
        const hints = badgesOf(entry)
        const glyphName = entry.kind === 'subagent' ? 'subagent' : entry.kind === 'root' ? 'session' : 'chat'
        return h('div', { className: 'dsd-branch', key }, [
          h('div', { className: 'dsd-node', key: 'row' }, [
            caret(node.id, hasChildren, isCollapsed),
            h('label', { className: 'dsd-nodeLabel', key: 'label' }, [
              box(subtreeIds(node)),
              h('span', { className: 'dsd-rowIcon', key: 'glyph', children: treeGlyph(glyphName, 14) }),
              h('span', { className: 'dsd-rowText', key: 'text' }, [
                h('span', {
                  className: 'dsd-rowTitle',
                  key: 'name',
                  children: entry.title === undefined || entry.title === '' ? leafName : entry.title,
                }),
              ]),
            ]),
            hints.length === 0
              ? null
              : h('span', { className: 'dsd-badge', key: 'badge', children: hints.join(' · ') }),
            figuresOf(entry.usage, entry.directory, entry.id),
          ]),
          isCollapsed || !hasChildren
            ? null
            : h('div', { className: 'dsd-children', key: 'children' }, node.children.map((child) => drawNode(child, child.id))),
        ])
      }

      const mainIds = items.map((entry) => entry.id)
      const hasMain = main !== null && main !== undefined
      const mainCollapsed = collapsed['__main__'] === true
      return h('div', { className: 'dsd-tree' }, [
        hasMain
          ? h('div', { className: 'dsd-node dsd-nodeMain', key: 'main' }, [
            caret('__main__', forest.length > 0, mainCollapsed),
            h('label', { className: 'dsd-nodeLabel', key: 'label' }, [
              box(mainIds),
              h('span', { className: 'dsd-rowIcon', key: 'glyph', children: treeGlyph('session', 14) }),
              h('span', { className: 'dsd-rowText', key: 'text' }, [
                h('span', {
                  className: 'dsd-rowTitle dsd-mainTitle',
                  key: 'name',
                  children: t('dialog.mainRow', { title: main }),
                }),
              ]),
            ]),
            figuresOf(props.mainUsage, props.mainDirectory, props.mainSessionId, props.mainFamilyUsage),
          ])
          : null,
        // The first level is a child list too, so the connector line starts
        // under the root row the way the reference layout draws it.
        hasMain && mainCollapsed
          ? null
          : h('div', { className: 'dsd-children dsd-childrenRoot', key: 'roots' }, forest.map((node) => drawNode(node, node.id))),
      ])
    }

    /**
     * The `shell.overlay` seat: the bulk dialog, opened from the search-adjacent icon.
     *
     * Rows are grouped by Workspace and listed flat inside each group, the way the
     * sidebar shows them, with parents before their children. The nesting is read
     * from the indentation alone: a row sits one step deeper for each ancestor
     * between it and the top of its family, so a mixed list still shows which row
     * is a child and which is a parent. Ticking a parent takes its whole family
     * with it, and a child can be taken back off that family, which is the same
     * choice the single Session dialog offers.
     */
    /** How many top-level family rows one page renders. */
    const BULK_PAGE_SIZE = 40

    /**
     * The batch management surface.
     *
     * Layout follows the reference: a corpus card (Session count, total tokens,
     * global hit rate, three-way bar), then a searchable and sortable list, then
     * a fixed action bar. Every number comes from the Host; this component only
     * groups, sorts and draws.
     *
     * A row shows its own usage. A row that has children shows `own/branch`,
     * the family total after a slash, so the two quantities never read as one.
     * Forked conversations are roots of their own with the parent named under
     * them; subagents stay folded into their parent's row until it is expanded.
     */
    function BulkDeleteDialog() {
      const open = useSyncExternalStore(subscribeBulk, getBulkOpen)
      const [state, setState] = useState({ phase: 'idle', catalog: null, error: null, busy: false })
      const [selected, setSelected] = useState(null)
      const [expanded, setExpanded] = useState({})
      const [query, setQuery] = useState('')
      const [sort, setSort] = useState('recent')
      const [kindFilter, setKindFilter] = useState('all')
      const [workspaceFilter, setWorkspaceFilter] = useState('all')
      const [page, setPage] = useState(0)
      const [stop, setStop] = useState(true)
      const [confirmAll, setConfirmAll] = useState(false)
      const [cacheError, setCacheError] = useState(null)
      const [openingCache, setOpeningCache] = useState(false)
      const usageOn = useSyncExternalStore(subscribeUsage, getUsageEnabled)
      const dialog = useRef(null)

      const close = useCallback(() => {
        setState((previous) => (previous.busy
          ? previous
          : { phase: 'idle', catalog: null, error: null, busy: false }))
        setSelected(null)
        setExpanded({})
        setQuery('')
        setSort('recent')
        setKindFilter('all')
        setWorkspaceFilter('all')
        setPage(0)
        setConfirmAll(false)
        setBulkOpen(false)
      }, [])


      // The list is re-read on every open: a batch view is only true for the
      // moment it was read, and the sidebar may have changed in between.
      useEffect(() => {
        if (!open) return undefined
        let cancelled = false
        setState({ phase: 'loading', catalog: null, error: null, busy: false })
        setSelected(new Set())
        setExpanded({})
        setPage(0)
        setConfirmAll(false)
        setCacheError(null)
        fetchCatalog(usageOn).then(
          (catalog) => {
            if (cancelled) return
            setState({ phase: 'ready', catalog, error: null, busy: false })
          },
          (reason) => {
            if (cancelled) return
            setState({
              phase: 'ready',
              catalog: null,
              error: reason instanceof Error ? reason.message : String(reason),
              busy: false,
            })
          },
        )
        return () => {
          cancelled = true
        }
      }, [open, usageOn])

      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close()
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
      }, [open, close])

      useEffect(() => {
        if (open) dialog.current?.focus()
      }, [open])

      const catalog = state.catalog
      const summary = catalog?.summary ?? null
      const busy = state.busy
      const picked = selected ?? new Set()

      const flatRows = React.useMemo(() => {
        const out = []
        for (const group of catalog?.workspaces ?? []) {
          for (const entry of group.sessions ?? []) {
            out.push({
              ...entry,
              workspaceKey: group.key,
              workspaceId: group.workspaceId ?? null,
              workspaceTitle: group.title ?? '',
            })
          }
        }
        return out
      }, [catalog])

      // The family forest used for drawing: a fork is a root of its own, a
      // subagent hangs under whatever spawned it.
      const forest = React.useMemo(() => {
        const byId = new Map(flatRows.map((entry) => [entry.id, { entry, children: [] }]))
        const roots = []
        for (const node of byId.values()) {
          const parentId = node.entry.parentId
          const parent = typeof parentId === 'string' && parentId !== node.entry.id ? byId.get(parentId) : undefined
          if (parent === undefined) roots.push(node)
          else parent.children.push(node)
        }
        // A hand-edited header cycle would otherwise leave a whole family
        // unreachable; anything the walk cannot reach becomes a root.
        const reached = new Set()
        const mark = (node) => {
          if (reached.has(node.entry.id)) return
          reached.add(node.entry.id)
          for (const child of node.children) mark(child)
        }
        for (const root of roots) mark(root)
        for (const node of byId.values()) {
          if (reached.has(node.entry.id)) continue
          roots.push(node)
          mark(node)
        }
        return { byId, roots }
      }, [flatRows])

      if (!open) return null

      /** Every descendant node of one node, depth first. */
      const descendantsOf = (node) => {
        const out = []
        const walk = (current) => {
          for (const child of current.children) {
            out.push(child)
            walk(child)
          }
        }
        walk(node)
        return out
      }

      const needle = query.trim().toLowerCase()
      const kindOk = (entry) => kindFilter === 'all' || entry.kind === kindFilter
      const workspaceOk = (entry) => workspaceFilter === 'all' || String(entry.workspaceId ?? '') === workspaceFilter
      const textOk = (entry) => needle === '' || String(entry.title ?? '').toLowerCase().includes(needle)
      const selfOk = (entry) => kindOk(entry) && workspaceOk(entry) && textOk(entry)

      const matchMemo = new Map()
      const hasMatch = (node) => {
        const id = node.entry.id
        if (matchMemo.has(id)) return matchMemo.get(id)
        let matched = selfOk(node.entry)
        if (!matched) for (const child of node.children) if (hasMatch(child)) { matched = true; break }
        matchMemo.set(id, matched)
        return matched
      }

      const compare = (left, right) => {
        const a = left.entry
        const b = right.entry
        const deletedA = a.deleted === true ? 1 : 0
        const deletedB = b.deleted === true ? 1 : 0
        if (deletedA !== deletedB) return deletedB - deletedA
        if (sort === 'tokens') return (b.usage?.totalTokens ?? 0) - (a.usage?.totalTokens ?? 0)
        if (sort === 'hit') return (b.usage?.hitRate ?? 0) - (a.usage?.hitRate ?? 0)
        return (b.usage?.lastActivityAt ?? 0) - (a.usage?.lastActivityAt ?? 0)
      }

      const matchedRoots = [...forest.roots].filter(hasMatch).sort(compare)
      const totalPages = Math.max(1, Math.ceil(matchedRoots.length / BULK_PAGE_SIZE))
      const currentPage = Math.min(page, totalPages - 1)
      const pageRoots = matchedRoots.slice(currentPage * BULK_PAGE_SIZE, currentPage * BULK_PAGE_SIZE + BULK_PAGE_SIZE)

      // A page is a family slice: a root is followed by the children the user
      // expanded, so an expanded family is never cut in half by a page boundary.
      const visible = []
      const walk = (node, depth) => {
        if (!hasMatch(node)) return
        visible.push({ node, depth })
        const isOpen = depth <= 1 || expanded[node.entry.id] === true
        if (!isOpen) return
        for (const child of [...node.children].sort(compare)) walk(child, depth + 1)
      }
      for (const root of pageRoots) walk(root, 0)

      /** One nested family branch, drawn as the same tree the single dialog uses. */
      const drawBranch = (node, depth) => {
        const isOpen = depth <= 1 || expanded[node.entry.id] === true
        const children = [...node.children].sort(compare).filter(hasMatch)
        return h('div', { className: 'dsd-branch', key: node.entry.id }, [
          row({ node, depth }),
          isOpen && children.length > 0
            ? h('div', { className: 'dsd-children dsd-bulkChildren', key: 'children' },
              children.map((child) => drawBranch(child, depth + 1)))
            : null,
        ])
      }

      // A stale row has no persisted Session left: it cannot be deleted, so it
      // is never part of a selection.
      const selectableIds = visible
        .filter((entry) => entry.node.entry.stale !== true && entry.node.entry.deleted !== true)
        .map((entry) => entry.node.entry.id)
      const chosenVisible = selectableIds.filter((id) => picked.has(id)).length
      const allVisibleChosen = selectableIds.length > 0 && chosenVisible === selectableIds.length

      const setMany = (ids, on) => {
        setSelected(() => {
          const next = new Set(picked)
          for (const id of ids) {
            if (on) next.add(id)
            else next.delete(id)
          }
          return next
        })
      }

      const toggleNode = (node, on) => {
        if (node.entry.stale === true || node.entry.deleted === true) return
        const ids = [node.entry.id, ...descendantsOf(node).map((child) => child.entry.id)]
        setMany(ids, on)
      }

      const toggleExpand = (id) => {
        setExpanded((previous) => ({ ...previous, [id]: previous[id] !== true }))
      }

      /** The batch body: each ticked root carries the descendants also ticked. */
      const buildRoots = () => {
        const roots = []
        const collect = (node, underChosen) => {
          const on = picked.has(node.entry.id) && node.entry.stale !== true
          if (on && !underChosen) {
            roots.push({
              sessionId: node.entry.id,
              descendants: descendantsOf(node).map((child) => child.entry.id).filter((id) => picked.has(id)),
            })
          }
          for (const child of node.children) collect(child, underChosen || on)
        }
        for (const root of forest.roots) collect(root, false)
        return roots
      }

      const runDelete = (roots) => {
        if (busy || roots.length === 0) return
        setState((previous) => ({ ...previous, busy: true, error: null }))
        deleteBatch(roots, stop).then(
          (payload) => {
            const failed = Array.isArray(payload?.failed) ? payload.failed : []
            if (failed.length === 0) {
              setSelected(null)
              setState({ phase: 'idle', catalog: null, error: null, busy: false })
              setBulkOpen(false)
              return
            }
            const failedIds = new Set(failed.map((entry) => entry.sessionId))
            setSelected(() => new Set(flatRows.filter((entry) => failedIds.has(entry.id)).map((entry) => entry.id)))
            setState((previous) => ({
              ...previous,
              busy: false,
              error: `${t('batch.deletePartial', { n: failed.length })} ${failed.map((entry) => entry.message).join(' / ')}`,
            }))
          },
          (reason) => {
            const failed = Array.isArray(reason?.failed) ? reason.failed : []
            const removed = Array.isArray(reason?.removed) ? reason.removed : null
            setState((previous) => ({
              ...previous,
              busy: false,
              errorKind: 'delete',
              error: reason instanceof Error ? reason.message : String(reason),
            }))
            if (removed !== null && removed.length > 0) {
              // Some roots went through: re-read so the gone rows leave the
              // tree, and keep only the failures ticked.
              fetchCatalog().then(
                (catalog) => {
                  setState((previous) => ({ ...previous, catalog }))
                  setSelected(() => new Set(failed.map((entry) => entry.sessionId)))
                },
                () => setSelected(() => new Set(failed.map((entry) => entry.sessionId))),
              )
            } else if (failed.length > 0) {
              setSelected(() => new Set(failed.map((entry) => entry.sessionId)))
            }
          },
        )
      }

      const openCache = () => {
        setOpeningCache(true)
        setCacheError(null)
        openCacheDirectory().then(
          () => setOpeningCache(false),
          (reason) => {
            setOpeningCache(false)
            setCacheError(reason instanceof Error ? reason.message : String(reason))
          },
        )
      }

      const workspaceChoices = [...new Map(flatRows.map((entry) => [String(entry.workspaceId ?? 'none'), entry])).entries()]
        .map(([key, entry]) => ({ key, title: entry.workspaceTitle === '' ? t('batch.ungrouped') : entry.workspaceTitle }))

      const row = ({ node, depth }) => {
        const entry = node.entry
        const id = entry.id
        const isCollapsed = expanded[id] !== true
        const hasChildren = node.children.length > 0
        const usage = entry.usage
        const usageOff = usage?.disabled === true
        const own = usage?.totalTokens ?? 0
        const branch = entry.familyUsage?.totalTokens ?? 0
        const hasBranch = entry.kind === 'root' && entry.familyUsage !== null && entry.familyUsage !== undefined
        const parent = typeof entry.parentId === 'string' ? forest.byId.get(entry.parentId) : undefined
        const glyphName = entry.deleted === true ? 'trash' : entry.kind === 'subagent' ? 'subagent' : entry.kind === 'derived' ? 'chat' : 'session'
        const available = entry.directory?.available === true
        const stale = entry.stale === true
        const deleted = entry.deleted === true
        return h('div', {
          className: `dsd-bulkRow${depth > 0 ? ' dsd-bulkRowChild' : ''}${deleted ? ' dsd-bulkRowDeleted' : ''}`,
          key: id,
        }, [
          h('button', {
            type: 'button',
            className: `dsd-caret${hasChildren ? '' : ' dsd-caretLeaf'}`,
            key: 'caret',
            disabled: !hasChildren,
            'aria-expanded': hasChildren ? !isCollapsed : undefined,
            'aria-label': isCollapsed ? '展开' : '收起',
            onClick: () => toggleExpand(id),
            children: hasChildren ? (isCollapsed ? '▸' : '▾') : '',
          }),
          h('input', {
            type: 'checkbox',
            key: 'box',
            className: 'dsd-check',
            checked: picked.has(id) && !stale && !deleted,
            disabled: busy || stale || deleted,
            title: deleted ? '这个父会话已经被删除，只作为结构显示，不能选择。' : stale ? t('batch.staleHint') : undefined,
            onChange: () => toggleNode(node, !picked.has(id)),
          }),
          h('span', { className: 'dsd-rowIcon', key: 'icon', children: treeGlyph(glyphName, 14) }),
          h('div', { className: 'dsd-bulkName', key: 'name' }, [
            h('span', {
              className: 'dsd-bulkTitle',
              key: 'title',
              title: entry.title ?? '',
              children: entry.title === undefined || entry.title === '' ? t('batch.untitled') : entry.title,
            }),
            deleted
              ? null
              : stale
                ? h('span', { className: 'dsd-bulkOwner dsd-stale', key: 'stale', children: t('batch.stale') })
                : entry.kind === 'derived' && parent !== undefined
                  ? h('span', { className: 'dsd-bulkOwner', key: 'owner', children: `所属：${parent.entry.title ?? t('batch.untitled')}` })
                  : null,
          ]),
          h('span', {
            className: 'dsd-bulkTokens',
            key: 'tokens',
            title: usageOff
              ? t('usage.offHint')
              : hasBranch ? `本会话自身：${formatTokens(own)}\n会话家族：${formatTokens(branch)}` : `本会话自身：${formatTokens(own)}`,
            children: usageOff
              ? t('usage.off')
              : hasBranch ? `${formatTokens(own)}/${formatTokens(branch)}` : formatTokens(own),
          }),
          h('span', {
            className: 'dsd-bulkTime',
            key: 'time',
            children: usage?.lastActivityAt ? formatMoment(usage.lastActivityAt) : '',
          }),
          h('button', {
            type: 'button',
            className: 'dsd-folder',
            key: 'folder',
            disabled: !available,
            title: available ? (entry.directory.path ?? '') : (entry.directory?.reason ?? t('dialog.folderNone')),
            'aria-label': t('dialog.folder'),
            onClick: () => {
              if (!available) return
              openSessionDirectory(id).catch((reason) => {
                setCacheError(reason instanceof Error ? reason.message : String(reason))
              })
            },
          }, folderGlyph(14)),
        ])
      }

      const cacheUsage = {
        cacheReadInputTokens: summary?.cacheReadInputTokens ?? 0,
        cacheMissInputTokens: summary?.cacheMissInputTokens ?? 0,
        cacheWriteTokens: summary?.cacheWriteTokens ?? 0,
        outputTokens: summary?.outputTokens ?? 0,
        totalTokens: summary?.tokens ?? 0,
      }

      return h('div', {
        className: 'dsd-overlay',
        role: 'presentation',
        onKeyDownCapture: (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        },
      }, [
        h('div', { className: 'dsd-mask', key: 'mask', 'aria-hidden': true, onClick: close }),
        h('div', {
          className: 'dsd-dialog dsd-dialogWide dsd-dialogBulk',
          key: 'dialog',
          ref: dialog,
          tabIndex: -1,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('batch.title'),
        }, [
          h('div', { className: 'dsd-head', key: 'head' }, [
            h('span', { className: 'dsd-headIcon', key: 'icon', 'aria-hidden': true, children: treeGlyph('trash', 18) }),
            h('h2', { className: 'dsd-title', key: 'title', children: t('batch.title') }),
            h('button', {
              type: 'button',
              className: 'dsd-close',
              key: 'close',
              'aria-label': t('batch.cancel'),
              onClick: close,
              children: '×',
            }),
          ]),

          // The corpus card: one fold per Session, summed once.
          summary === null
            ? null
            : h('section', { className: 'dsd-card dsd-cardSummary', key: 'corpus' }, [
              h('div', { className: 'dsd-metrics', key: 'metrics' }, [
                h(Metric, {
                  key: 'count',
                  glyph: treeGlyph('session', 12),
                  label: t('batch.totalSessions'),
                  value: String(summary.sessions ?? 0),
                }),
                h(Metric, {
                  key: 'tokens',
                  glyph: tokensGlyph(12),
                  tone: 'dsd-toneBlue',
                  label: t('dialog.totalTokens'),
                  value: summary.usageDisabled === true ? t('usage.off') : `${formatTokens(summary.tokens ?? 0)} ${t('dialog.tokensUnit')}`,
                }),
                h(Metric, {
                  key: 'hit',
                  glyph: cacheGlyph(12),
                  tone: 'dsd-toneGreen',
                  label: t('dialog.hitRate'),
                  value: summary.usageDisabled === true ? t('usage.off') : formatPercent(summary.hitRate ?? 0),
                }),
              ]),
              summary.usageDisabled === true
                ? h('p', { className: 'dsd-noteHint', key: 'usageOff', children: t('usage.offHint') })
                : h(UsageBar, { key: 'bar', usage: cacheUsage }),
              summary.usageDisabled === true ? null : h(UsageLegend, { key: 'legend', usage: cacheUsage }),
            ]),

          h('p', { className: 'dsd-desc', key: 'desc', children: t('batch.desc') }),
          summary !== null && (summary.stale ?? 0) > 0
            ? h('p', { className: 'dsd-noteHint', key: 'staleNote', children: t('batch.staleCount', { n: summary.stale }) })
            : null,

          // Toolbar: search, sort, filters, select-all.
          h('div', { className: 'dsd-bulkTools', key: 'tools' }, [
            h('input', {
              type: 'search',
              className: 'dsd-input',
              key: 'search',
              value: query,
              placeholder: t('batch.search'),
              'aria-label': t('batch.search'),
              onChange: (event) => { setQuery(event.target.value); setPage(0) },
            }),
            h('select', {
              className: 'dsd-select',
              key: 'sort',
              value: sort,
              'aria-label': t('batch.sort'),
              onChange: (event) => { setSort(event.target.value); setPage(0) },
            }, [
              h('option', { key: 'recent', value: 'recent', children: t('batch.sortRecent') }),
              h('option', { key: 'tokens', value: 'tokens', children: t('batch.sortTokens') }),
              h('option', { key: 'hit', value: 'hit', children: t('batch.sortHit') }),
            ]),
            h('select', {
              className: 'dsd-select',
              key: 'kind',
              value: kindFilter,
              'aria-label': t('batch.filterKind'),
              onChange: (event) => { setKindFilter(event.target.value); setPage(0) },
            }, [
              h('option', { key: 'all', value: 'all', children: t('batch.filterAllKinds') }),
              h('option', { key: 'root', value: 'root', children: t('batch.kindRoot') }),
              h('option', { key: 'derived', value: 'derived', children: t('batch.kindDerived') }),
              h('option', { key: 'subagent', value: 'subagent', children: t('batch.kindSubagent') }),
            ]),
            h('select', {
              className: 'dsd-select',
              key: 'ws',
              value: workspaceFilter,
              'aria-label': t('batch.filterWorkspace'),
              onChange: (event) => { setWorkspaceFilter(event.target.value); setPage(0) },
            }, [
              h('option', { key: 'all', value: 'all', children: t('batch.filterAllWorkspaces') }),
              ...workspaceChoices.map((choice) => h('option', {
                key: choice.key,
                value: choice.key,
                children: choice.title,
              })),
            ]),
            h('label', { className: 'dsd-bulkMaster', key: 'master' }, [
              h('input', {
                type: 'checkbox',
                className: 'dsd-check',
                checked: allVisibleChosen,
                disabled: busy || selectableIds.length === 0,
                ref: (node) => { if (node !== null) node.indeterminate = chosenVisible > 0 && !allVisibleChosen },
                onChange: () => setMany(selectableIds, !allVisibleChosen),
              }),
              h('span', { children: t('batch.selectPage', { n: selectableIds.length }) }),
            ]),

          ]),

          state.phase === 'loading'
            ? h('p', { className: 'dsd-note', key: 'loading', children: t('batch.loading') })
            : null,
          state.error === null
            ? null
            : h('p', { className: 'dsd-error', key: 'error', children: `${t(state.errorKind === 'delete' ? 'batch.deleteFailed' : 'batch.failed')}：${state.error}` }),
          state.phase === 'ready' && catalog === null && state.error === null
            ? h('p', { className: 'dsd-note', key: 'unknown', children: t('batch.unknown') })
            : null,
          state.phase === 'ready' && catalog !== null && visible.length === 0
            ? h('p', { className: 'dsd-note', key: 'empty', children: t('batch.empty') })
            : null,

          h('div', { className: 'dsd-bulkList', key: 'list', role: 'group', 'aria-label': t('batch.region') },
            pageRoots.map((root) => h('div', { className: 'dsd-bulkBlock', key: `block-${root.entry.id}` }, [
              drawBranch(root, 0),
            ]))),

          totalPages > 1
            ? h('div', { className: 'dsd-bulkPager', key: 'pager' }, [
              h('button', {
                type: 'button',
                className: 'dsd-button dsd-link',
                key: 'prev',
                disabled: currentPage === 0,
                onClick: () => setPage(Math.max(0, currentPage - 1)),
                children: t('batch.prevPage'),
              }),
              h('span', { key: 'info', children: t('batch.pageInfo', { page: currentPage + 1, pages: totalPages }) }),
              h('button', {
                type: 'button',
                className: 'dsd-button dsd-link',
                key: 'next',
                disabled: currentPage >= totalPages - 1,
                onClick: () => setPage(Math.min(totalPages - 1, currentPage + 1)),
                children: t('batch.nextPage'),
              }),
            ])
            : null,

          cacheError === null
            ? null
            : h('p', { className: 'dsd-error', key: 'cacheError', children: cacheError }),

          // The fixed action bar.
          h('div', { className: 'dsd-footer dsd-bulkFooter', key: 'footer' }, [
            h('div', { className: 'dsd-bulkLeft', key: 'left' }, [
              h('button', {
                type: 'button',
                className: 'dsd-button dsd-outline dsd-btnSm',
                key: 'openCache',
                disabled: busy || openingCache,
                onClick: openCache,
                children: [
                  h('span', { className: 'dsd-ghostIcon', key: 'icon', children: folderGlyph(13) }),
                  t('batch.openCache'),
                ],
              }),
              h(UsageSwitch, { key: 'usage', compact: true }),
            ]),
            h('div', { className: 'dsd-bulkRight', key: 'right' }, [
              h('label', { className: 'dsd-row dsd-stopRow dsd-bulkStop', key: 'stop' }, [
                h('input', {
                  type: 'checkbox',
                  key: 'box',
                  className: 'dsd-check',
                  checked: stop,
                  disabled: busy,
                  onChange: () => setStop((previous) => !previous),
                }),
                h('span', { className: 'dsd-rowText', key: 'text', children: t('batch.stoppingNote') }),
              ]),
              h('button', {
                type: 'button',
                className: 'dsd-button dsd-outline',
                key: 'cancel',
                disabled: busy,
                onClick: close,
                children: t('batch.cancel'),
              }),
              h('button', {
                type: 'button',
                className: 'dsd-button dsd-solid dsd-danger',
                key: 'confirm',
                disabled: busy || picked.size === 0,
                onClick: () => runDelete(buildRoots()),
                children: busy
                  ? t('batch.deleting')
                  : picked.size === 0
                    ? t('batch.confirmNone')
                    : stop
                      ? t('batch.confirmStop', { n: picked.size })
                      : t('batch.confirm', { n: picked.size }),
              }),
              h('button', {
                type: 'button',
                className: `dsd-button ${confirmAll ? 'dsd-solid dsd-danger' : 'dsd-outline dsd-dangerText'}`,
                key: 'all',
                disabled: busy || flatRows.length === 0,
                onClick: () => {
                  if (!confirmAll) {
                    setConfirmAll(true)
                    return
                  }
                  const roots = forest.roots.map((root) => ({
                    sessionId: root.entry.id,
                    descendants: descendantsOf(root).map((child) => child.entry.id),
                  }))
                  runDelete(roots)
                },
                children: confirmAll
                  ? t('batch.confirmAll', { n: flatRows.length })
                  : t('batch.deleteAll'),
              }),
            ]),
          ]),
          h('p', { className: 'dsd-bulkNote', key: 'cacheNote', children: t('usage.cacheNote') }),
        ]),
      ])
    }

    /** The plugin's own styles: host tokens only, so light and dark both read. */
    const CSS = `
.dsd-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;cursor:pointer;font:inherit;font-size:13px;line-height:20px;text-align:left;color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsd-item:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12))}
.dsd-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12));outline:none}
.dsd-itemIcon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center}
.dsd-itemLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}
.dsd-mask{position:absolute;inset:0;background:rgba(0,0,0,.45)}
.dsd-dialog{position:relative;z-index:1;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:min(420px,100%);max-height:100%;overflow:auto;padding:22px 24px 20px;border-radius:var(--dsw-radius-panel,12px);background:var(--dsw-alias-bg-layer-2,#1b1d21);box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.34))}
.dsd-dialog:focus{outline:none}
.dsd-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-desc{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#a8adb7);word-break:break-word}
.dsd-note{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#a8adb7);word-break:break-word}
.dsd-warn{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-state-warn-primary,#d9a03a);color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-noteTitle{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-state-warn-primary,#d9a03a)}
.dsd-noteHint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-list{margin:0;padding-inline-start:18px;font-size:13px;line-height:20px}
.dsd-tree{display:flex;flex-direction:column;gap:2px;padding:6px 0;border-block:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.dsd-row{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}
.dsd-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-check{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-state-error-primary,#e5484d);cursor:pointer}
.dsd-rowText{flex:1;min-width:0;display:flex;align-items:baseline;gap:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-rowTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-rowId{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-badge{flex:none;font-size:11px;line-height:16px;padding:1px 6px;border-radius:999px;border:.5px solid var(--dsw-alias-state-warn-primary,#d9a03a);color:var(--dsw-alias-state-warn-primary,#d9a03a)}
.dsd-master{font-weight:500}
.dsd-group{display:flex;flex-direction:column}
.dsd-groupHead{display:flex;align-items:center;gap:2px}
.dsd-groupRow{flex:1;min-width:0;font-weight:500}
.dsd-caret{flex:none;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#a8adb7);cursor:pointer;font:inherit;font-size:11px;line-height:1}
.dsd-caret:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-rows{display:flex;flex-direction:column}
.dsd-groupRows{padding-inline-start:12px}
/* The family tree: one row per Session, its children in collapsible blocks under
   it. The nesting is the indentation alone — no connectors, no guide lines. */
.dsd-branch{display:flex;flex-direction:column}
.dsd-node{position:relative;box-sizing:border-box;display:flex;align-items:center;gap:2px;min-height:28px}
.dsd-nodeLabel{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}
.dsd-nodeLabel:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-nodeMain>.dsd-nodeLabel{font-weight:500}
.dsd-nodeBranch>.dsd-nodeLabel{color:var(--dsw-alias-label-secondary,#a8adb7);font-weight:500}
.dsd-rowIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-tertiary,#8b909a)}
.dsd-nodeMain .dsd-rowIcon{color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-mainTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-blockTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-caretLeaf{cursor:default}
.dsd-caretLeaf:hover{background:transparent}
.dsd-children{display:flex;flex-direction:column}
.dsd-hint{margin:4px 0 0;font-size:12px;line-height:18px}
.dsd-descendants{padding:8px 12px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-state-warn-primary,#d9a03a);color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-error{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e5484d);word-break:break-word}
.dsd-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px}
.dsd-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:var(--dsw-radius-md,8px);cursor:pointer;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#e6e6e6);background:transparent}
.dsd-button:disabled{cursor:not-allowed;opacity:.4}
.dsd-outline{border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32))}
.dsd-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-dangerText{color:var(--dsw-alias-state-error-primary,#e5484d)}
/* The bulk entry point, mounted beside the workspace header's own search slot:
   a 28px control sitting immediately ahead of that slot in the header row, so
   it stays visible whatever a theme does to the slot itself. The auto margin
   that pushes the icon cluster to the row's right edge lives on this control —
   the slot it precedes is the row's flex filler (flex:1, margin-left:auto), and
   a filler sitting between the label and this control is what once drove the
   two apart. The colour is inherited from the workspace section header itself —
   the same computed colour the “工作区” label text carries — so no theme can
   tint the icon and the label differently, and hover only adds the shared hover
   background the way the shipped icon buttons behave. */
.dsd-anchor{box-sizing:border-box;flex:none;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;cursor:pointer}
.dsd-anchor:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-anchor:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4a8cff));outline-offset:-2px}
/* Parked ahead of the slot, the control takes over the slot's pushing duty: the
   slot falls back to its shipped 28px cell, so the header row reads as one
   evenly spaced icon cluster. While the search is expanded the slot must grow
   again to hold the input, so the override stops at the collapsed state. */
.dsd-anchor + [class*="_searchSlot"]:not([class*="searchSlotExpanded"]){flex:0 0 auto !important;margin-left:0 !important}
/* The bulk dialog is wider than the single-Session one: it lists every Workspace. */
.dsd-dialogWide{width:min(660px,100%)}
.dsd-scroll{display:flex;flex-direction:column;gap:2px;padding:6px 0;max-height:min(58vh,520px);overflow:auto;border-block:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.dsd-toolbar{display:flex;align-items:center;gap:8px;padding:2px 4px 6px;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2,#1b1d21)}
.dsd-toolbarCell{flex:1;min-width:0}
.dsd-link{height:26px;padding:0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-business-primary,#4a8cff)}
.dsd-link:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}

.dsd-wsTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-wsCount{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b909a)}
.dsd-stopRow{flex:1;min-width:0;margin-right:4px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-stopRow .dsd-rowText{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#a8adb7)}
/* ===== 0.6.0 单会话管理面板 =====
   Reference layout A: a wide rounded dialog, a summary card with the three-way
   token bar, then the family tree with a folder button per row. Every colour is
   a theme token where one exists (surface, border, label, business accent,
   danger), so light and dark follow the Harness automatically; the three token
   colours are fixed hues because they are a data encoding, not decoration, and
   they are picked to stay legible on both surfaces. */
.dsd-dialog{width:min(640px,100%);border-radius:18px;gap:14px;padding:20px 22px 18px}
.dsd-dialogWide{width:min(700px,100%)}
.dsd-head{display:flex;align-items:center;gap:10px}
.dsd-headIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;background:var(--dsw-alias-state-error-bg,rgba(229,72,77,.12));color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsd-head .dsd-title{flex:1;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#a8adb7);cursor:pointer;font:inherit;font-size:20px;line-height:1}
.dsd-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-close:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4a8cff));outline-offset:-2px}
.dsd-card{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:16px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,#f7f8fa)}
.dsd-cardSummary{gap:12px}
.dsd-cardHead{display:flex;align-items:center;gap:10px;min-width:0}
.dsd-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;background:var(--dsw-alias-state-business-bg,rgba(74,140,255,.12));color:var(--dsw-alias-state-business-primary,#4a8cff)}
.dsd-cardTitle{margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-ghost{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;font:inherit;font-size:12.5px;line-height:18px;white-space:nowrap}
.dsd-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-ghost:disabled{cursor:not-allowed;opacity:.45}
.dsd-ghostIcon{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-metrics{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:flex-start}
.dsd-metric{display:inline-flex;align-items:center;gap:7px;min-width:0}
.dsd-metricGlyph{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,#1b1d21);color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-toneBlue{color:#3b82f6}
.dsd-toneGreen{color:#22c55e}
.dsd-metricBody{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.dsd-metricLabel{font-size:11.5px;color:var(--dsw-alias-label-secondary,#a8adb7);white-space:nowrap}
.dsd-metricValue{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6);white-space:nowrap;font-variant-numeric:tabular-nums}
.dsd-bar{display:flex;gap:2px;height:10px;width:100%;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16))}
.dsd-barEmpty{opacity:.6}
.dsd-barSeg{display:block;height:100%;border-radius:999px;min-width:2px;transition:flex-grow .18s ease}
.dsd-hit{background:#22c55e}
.dsd-miss{background:#3b82f6}
.dsd-out{background:#eab308}
.dsd-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-legendItem{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsd-dot{flex:none;width:8px;height:8px;border-radius:999px}
.dsd-legendLabel{color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-legendValue{color:var(--dsw-alias-label-primary,#e6e6e6);font-variant-numeric:tabular-nums}
.dsd-desc{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-figures{flex:none;display:inline-flex;align-items:center;gap:8px;padding-inline-start:6px}
.dsd-nodeTokens{font-size:12px;color:var(--dsw-alias-label-secondary,#a8adb7);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsd-nodeTime{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b909a);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsd-folder{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#a8adb7);cursor:pointer}
.dsd-folder:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-state-business-primary,#4a8cff)}
.dsd-folder:disabled{opacity:.35;cursor:not-allowed}
.dsd-folder:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4a8cff));outline-offset:-2px}
.dsd-footerLeft{margin-inline-end:auto}
.dsd-solid{border:none;background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff}
.dsd-solid:hover:not(:disabled){filter:brightness(1.06)}
.dsd-solid.dsd-danger:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-error-primary,#e5484d));outline-offset:2px}
/* ===== 树状层级（参考图 A 的第二版）：连接线由每一层子列表自己的左边框
   画出，容器高度恰好等于该层子行的高度，所以竖线自然止于最后一个子行；
   每行再用 ::before 画一段横线接到那根竖线上。层级完全来自 parentId 链，
   子智能体的子智能体会自然再深一层。缩进与连接线都在嵌套容器上，因此行内
   不再需要 inline padding。 */
.dsd-tree{display:flex;flex-direction:column;gap:1px;padding:10px 12px;border-radius:14px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,#f7f8fa)}
.dsd-children{display:flex;flex-direction:column;gap:1px;margin-inline-start:11px;padding-inline-start:15px;border-inline-start:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22))}
.dsd-childrenRoot{margin-inline-start:11px;padding-inline-start:15px}
.dsd-children > .dsd-branch > .dsd-node::before{content:'';position:absolute;left:-15px;top:50%;width:15px;height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.22))}
.dsd-node{min-height:24px;gap:1px}
.dsd-nodeLabel{padding:2px 6px;gap:7px}
.dsd-nodeMain > .dsd-nodeLabel{font-weight:600}
.dsd-rowIcon{width:15px;height:15px}
.dsd-rowText{font-size:12.5px;line-height:19px}
.dsd-nodeTokens{font-size:11.5px}
.dsd-nodeTime{font-size:11px}
.dsd-figures{gap:7px;padding-inline-start:4px}
.dsd-folder{width:22px;height:22px}
.dsd-caret{width:18px;height:18px;font-size:10px}
.dsd-check{width:13px;height:13px}
/* 概览卡收紧：图标 12px、指标一行放下四格，卡片与对话框间距同步缩小 */
.dsd-card{padding:12px 14px;gap:8px;border-radius:14px}
.dsd-cardSummary{gap:10px}
.dsd-avatar{width:30px;height:30px;border-radius:9px}
.dsd-cardTitle{font-size:14px;line-height:20px}
.dsd-ghost{height:28px;padding:0 9px;font-size:12px}
.dsd-metrics{gap:6px 14px}
.dsd-metric{gap:6px}
.dsd-metricGlyph{width:18px;height:18px;border-radius:6px}
.dsd-metricLabel{font-size:11px}
.dsd-metricValue{font-size:13px}
.dsd-bar{height:8px}
.dsd-legend{font-size:11.5px;line-height:17px;gap:4px 14px}
.dsd-dot{width:7px;height:7px}
.dsd-desc{font-size:12px;line-height:18px}
.dsd-headIcon{width:30px;height:30px;border-radius:9px}
.dsd-dialog{gap:12px}
.dsd-dialogBulk{width:min(780px,100%);height:min(88vh,920px)}
.dsd-bulkTools{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dsd-input{flex:1 1 180px;min-width:150px;height:30px;padding:0 10px;box-sizing:border-box;border-radius:9px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:12.5px}
.dsd-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4a8cff)}
.dsd-select{height:30px;padding:0 6px;border-radius:9px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:12.5px}
.dsd-bulkMaster{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-bulkList{flex:1;min-height:120px;display:flex;flex-direction:column;gap:1px;overflow:auto;padding:6px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,#f7f8fa)}
.dsd-bulkRow{display:flex;align-items:center;gap:8px;min-height:30px;padding:2px 8px;border-radius:8px}
.dsd-bulkRow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-bulkRowDeleted .dsd-bulkTitle{opacity:.62}
.dsd-bulkRowDeleted .dsd-rowIcon{opacity:.62}
.dsd-bulkName{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.dsd-bulkTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-bulkOwner{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b909a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-bulkTokens{flex:none;font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#a8adb7);white-space:nowrap}
.dsd-bulkTime{flex:none;width:112px;text-align:right;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b909a);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsd-bulkPager{display:flex;align-items:center;justify-content:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary,#a8adb7)}
.dsd-bulkFooter{flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.dsd-bulkLeft{display:flex;align-items:center;gap:8px;margin-inline-end:auto}
.dsd-bulkRight{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dsd-bulkFooter .dsd-stopRow{flex:0 1 auto}
.dsd-bulkStop .dsd-rowText{font-size:11.5px}
.dsd-btnSm{height:28px;padding:0 9px;font-size:12px;line-height:18px;gap:5px}
.dsd-usageSwitch{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a8adb7);cursor:pointer;user-select:none;white-space:nowrap}
.dsd-usageSwitch .dsd-check{width:13px;height:13px}
.dsd-usageSwitchSm{font-size:11.5px}
.dsd-bulkNote{margin:6px 2px 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b909a)}
/* Nested tree: a deeper indent per level, a visible guide line down the left
   of every child list, and a short connector from that line into each row. */
/* One family per card: the block sits on its own surface, one step off the
   dialog background, with air between blocks so two families never run
   together. The nested guide lines live inside the card. */
.dsd-bulkList{gap:0;padding:0 2px;border:none;background:transparent}
.dsd-bulkBlock{padding:6px 8px 4px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,#f4f5f7);margin-bottom:10px}
.dsd-bulkBlock:last-child{margin-bottom:0}
.dsd-bulkBlock > .dsd-branch > .dsd-bulkRow{min-height:34px}
.dsd-bulkBlock > .dsd-branch > .dsd-bulkRow .dsd-bulkTitle{font-weight:600}
.dsd-bulkChildren{display:flex;flex-direction:column;gap:2px;margin-inline-start:13px;padding-inline-start:19px;border-inline-start:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.dsd-bulkRow{position:relative}
.dsd-bulkChildren > .dsd-branch > .dsd-bulkRow::before{content:'';position:absolute;left:-19px;top:50%;width:19px;height:1px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
`

    /** Mount the plugin's stylesheet with its components. */
    function Styles() {
      return h('style', { 'data-dsh-plugin': 'better-dsh-session-deletetool', children: CSS })
    }

    /** The menu row and its dialog, wrapped so the stylesheet travels with them. */
    function WithStyles(Component) {
      function StyledComponent(props) {
        return h(React.Fragment, null, h(Styles, { key: 'style' }), h(Component, { ...props, key: 'body' }))
      }
      StyledComponent.displayName = `BetterSessionDeletetool(${Component.name})`
      return StyledComponent
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          ctx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'better-dsh-session-deletetool: locale')
          translate = locale.bind(NS)
        }
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'better-dsh-session-deletetool', order: 500, locale: NS },
            WithStyles(DeleteSessionMenuItem),
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'better-dsh-session-deletetool-dialog', order: 60, locale: NS },
            WithStyles(DeleteSessionDialog),
          ),
        )
        // The bulk entry lives in the sidebar foot: it renders only a hidden
        // placeholder and mounts the real control just ahead of the browsing
        // region's own search slot, which is what puts it beside the search
        // icon without shadowing the shipped WorkspaceBrowser that owns that
        // `single` slot — and keeps it visible when a themed build hides the
        // slot itself.
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'better-dsh-session-deletetool-bulk', order: 40, locale: NS },
            WithStyles(BulkDeleteAnchor),
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'better-dsh-session-deletetool-bulk-dialog', order: 61, locale: NS },
            WithStyles(BulkDeleteDialog),
          ),
        )
      },
      /**
       * The pure halves of the bulk dialog, reachable only from a test run.
       *
       * The harness loads this file in the page; nothing else can see these
       * functions, and the property costs one boolean check at load.
       */
      ...(globalThis.__DSD_TEST__ === true
        ? {
          __test: {
            buildForest,
            subtreeIds,
            setBulkOpen,
            failureOf,
          },
        }
        : {}),
    }
  },
})
