/**
 * dsh-session-delete — Client half.
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
  id: 'dsh-session-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'session-delete'
    const DELETE_PATH = '/dsh-session-delete/delete'
    const INSPECT_PATH = '/dsh-session-delete/inspect'
    const CATALOG_PATH = '/dsh-session-delete/catalog'
    const BATCH_PATH = '/dsh-session-delete/delete-batch'

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
      },
    }

    /** Fill one `{name}` placeholder set in a dictionary string. */
    function interpolate(text, params) {
      if (params === undefined) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /** Translate through the registered locale when there is one, else the zh table. */
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
      const fallback = DICT.zh[key]
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

    /** One failed Host answer, carrying its stable code and details. */
    function failureOf(payload, response) {
      const error = new Error(payload?.message ?? `HTTP ${response.status}`)
      error.code = payload?.code
      error.activity = Array.isArray(payload?.activity) ? payload.activity : null
      return error
    }

    /** Ask the Host what this Session's state is before committing to anything. */
    async function inspectSession(sessionId) {
      const response = await fetch(`${INSPECT_PATH}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
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

    /** Read the whole corpus, grouped by Workspace, for the bulk dialog. */
    async function fetchCatalog() {
      const response = await fetch(CATALOG_PATH, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
    }

    /**
     * Ask the Host half to delete one root and the descendants it was left with.
     * @param roots - the ticked roots, each with its own descendant selection.
     * @param stop - whether running work may be stopped first.
     */
    async function deleteBatch(roots, stop) {
      const response = await fetch(BATCH_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roots, stop: stop === true }),
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

    /** One 14px trash glyph, drawn in the menu icon's colour. */
    function trashIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M3 4.5h10M6.5 4.5V3.25A.75.75 0 0 1 7.25 2.5h1.5a.75.75 0 0 1 .75.75V4.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * The bulk-delete drawing, in the source SVG's own coordinates.
     *
     * The paths are identity transforms, so mapping the viewBox onto the icon box
     * needs no geometry change. The drawing is authored as a filled glyph, but
     * the shipped product icon set is outline-only — `fill: none`,
     * `stroke: currentColor`, `strokeWidth: 1` on a 16px box — so it is stroked
     * here to match the search and view-option icons it sits beside. At a 16px
     * box the 32-unit viewBox halves every coordinate, so the shipped 1px stroke
     * is `2` in these units.
     */
    const BULK_ICON_SHAPES = [
      'M20,29H12a5,5,0,0,1-5-5V12a1,1,0,0,1,2,0V24a3,3,0,0,0,3,3h8a3,3,0,0,0,3-3V12a1,1,0,0,1,2,0V24A5,5,0,0,1,20,29Z',
      'M26,9H6A1,1,0,0,1,6,7H26a1,1,0,0,1,0,2Z',
      'M20,9H12a1,1,0,0,1-1-1V6a3,3,0,0,1,3-3h4a3,3,0,0,1,3,3V8A1,1,0,0,1,20,9ZM13,7h6V6a1,1,0,0,0-1-1H14a1,1,0,0,0-1,1Z',
      'M14,23a1,1,0,0,1-1-1V15a1,1,0,0,1,2,0v7A1,1,0,0,1,14,23Z',
      'M18,23a1,1,0,0,1-1-1V15a1,1,0,0,1,2,0v7A1,1,0,0,1,18,23Z',
    ]

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
        + ` aria-hidden="true" focusable="false" style="display:block">${paths}</svg>`
    }

    /**
     * The bulk-delete entry point, placed to the left of the workspace search icon.
     *
     * The browsing region is a `single` slot, so a second registrant would shadow
     * the shipped WorkspaceBrowser rather than sit beside it. This entry therefore
     * registers in the sidebar footer, renders only a hidden placeholder, and
     * mounts one element into the region's own search slot. The insertion is
     * additive and reversible: a mutation observer re-creates the element when
     * React re-renders the header, and the element and the observer both go away
     * with this registration.
     */
    function BulkDeleteAnchor() {
      useEffect(() => {
        const node = document.createElement('button')
        node.type = 'button'
        node.className = 'dsd-anchor'
        node.setAttribute('data-dsh-plugin', 'session-delete')
        node.title = t('icon.batch')
        node.setAttribute('aria-label', t('icon.batch'))
        // The button is a plain DOM node, so the glyph goes in as markup; it is
        // written from the same path set the React side draws, and carries no
        // user text, so this is not a sink for anything but our own constant.
        node.innerHTML = bulkIconMarkup(16)
        const onClick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          setBulkOpen(true)
        }
        node.addEventListener('click', onClick)

        /**
         * Put the button where the search control's own flex row starts.
         *
         * The class names are the shipped build's CSS-module output and the
         * `aria-label` is its localized search label, so each lookup carries a
         * second signal; with neither present the button stays unmounted instead
         * of landing somewhere arbitrary.
         */
        const mount = () => {
          const slot = document.querySelector('[class*="_searchSlot"]')
          if (slot !== null) {
            if (node.parentElement !== slot) slot.insertBefore(node, slot.firstChild)
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

      const close = useCallback(() => {
        setState((previous) => {
          if (previous.busy) return previous
          settle()
          return IDLE
        })
        setSelected(null)
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
        inspectSession(request.sessionId).then(
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
      }, [request])

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
          h('h2', { className: 'dsd-title', key: 'title', children: t('dialog.title') }),
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
              className: 'dsd-button dsd-outline dsd-dangerText',
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
        let on = ids.length > 0
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
       * One collapsible block: the direct children of one row that share one kind.
       * @param {string} collapseKey - unique to this parent and kind.
       * @param {string} label - the block's text, already counted.
       * @param {string} glyphName - the glyph the heading carries.
       * @param {object[]} members - the child nodes the block lists.
       * @param {number} depth - the indent the heading sits at; members sit one deeper.
       */
      const drawBlock = (collapseKey, label, glyphName, members, depth) => {
        const isCollapsed = collapsed[collapseKey] === true
        const ids = members.flatMap((member) => subtreeIds(member))
        return h('div', { className: 'dsd-block', key: collapseKey }, [
          h('div', {
            className: 'dsd-node dsd-nodeBranch',
            key: 'head',
            style: { paddingInlineStart: (depth * INDENT) + 'px' },
          }, [
            caret(collapseKey, true, isCollapsed),
            h('label', { className: 'dsd-nodeLabel', key: 'label' }, [
              box(ids),
              h('span', { className: 'dsd-rowIcon', key: 'glyph', children: treeGlyph(glyphName, 14) }),
              h('span', { className: 'dsd-rowText', key: 'text' }, [
                h('span', { className: 'dsd-blockTitle', key: 'name', children: label }),
              ]),
            ]),
          ]),
          isCollapsed
            ? null
            : h('div', { className: 'dsd-children', key: 'rows' }, members.map((member) => drawNode(member, depth + 1, member.id))),
        ])
      }

      /** One Session row, then the blocks holding its own direct children. */
      const drawNode = (node, depth, key) => {
        const entry = node.entry
        const isCollapsed = collapsed[node.id] === true
        const subagents = node.children.filter((child) => child.entry.kind === 'subagent')
        const forks = node.children.filter((child) => child.entry.kind !== 'subagent')
        const hints = badgesOf(entry)
        const glyphName = entry.kind === 'subagent' ? 'member' : entry.kind === 'root' ? 'session' : 'chat'
        return h('div', { className: 'dsd-branch', key }, [
          h('div', {
            className: 'dsd-node',
            key: 'row',
            style: { paddingInlineStart: (depth * INDENT) + 'px' },
          }, [
            caret(node.id, node.children.length > 0, isCollapsed),
            h('label', { className: 'dsd-nodeLabel', key: 'label' }, [
              box(subtreeIds(node)),
              h('span', { className: 'dsd-rowIcon', key: 'glyph', children: treeGlyph(glyphName, 14) }),
              h('span', { className: 'dsd-rowText', key: 'text' }, [
                h('span', {
                  className: 'dsd-rowTitle',
                  key: 'name',
                  children: entry.title === undefined || entry.title === '' ? leafName : entry.title,
                }),
                h('span', { className: 'dsd-rowId', key: 'id', children: shortId(entry.id) }),
              ]),
            ]),
            hints.length === 0
              ? null
              : h('span', { className: 'dsd-badge', key: 'badge', children: hints.join(' · ') }),
          ]),
          isCollapsed || node.children.length === 0
            ? null
            : h('div', { className: 'dsd-children', key: 'children' }, [
              subagents.length === 0
                ? null
                : drawBlock('sub:' + node.id, t('dialog.group.subagentsCount', { n: subagents.length }), 'subagent', subagents, depth + 1),
              forks.length === 0
                ? null
                : drawBlock('fork:' + node.id, t('dialog.group.derivedCount', { n: forks.length }), 'linked', forks, depth + 1),
            ]),
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
          ])
          : null,
        hasMain && mainCollapsed
          ? null
          : forest.map((node) => drawNode(node, hasMain ? 1 : 0, node.id)),
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
    function BulkDeleteDialog() {
      const open = useSyncExternalStore(subscribeBulk, getBulkOpen)
      const [state, setState] = useState({ phase: 'idle', catalog: null, error: null, busy: false })
      const [selected, setSelected] = useState(null)
      const [collapsed, setCollapsed] = useState({})
      const [stop, setStop] = useState(true)
      const dialog = useRef(null)

      const close = useCallback(() => {
        setState((previous) => (previous.busy
          ? previous
          : { phase: 'idle', catalog: null, error: null, busy: false }))
        setSelected(null)
        setBulkOpen(false)
      }, [])

      // The list is re-read on every open: a batch view is only true for the
      // moment it was read, and the sidebar may have changed in between.
      useEffect(() => {
        if (!open) return undefined
        let cancelled = false
        setState({ phase: 'loading', catalog: null, error: null, busy: false })
        setSelected(new Set())
        setCollapsed({})
        setStop(true)
        fetchCatalog().then(
          (catalog) => {
            if (cancelled) return
            const next = {}
            for (const group of catalog?.workspaces ?? []) next[group.key] = false
            setState({ phase: 'ready', catalog, error: null, busy: false })
            setCollapsed(next)
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
      }, [open])

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

      if (!open) return null

      const catalog = state.catalog
      const groups = (catalog?.workspaces ?? []).map((group) => ({
        ...group,
        items: Array.isArray(group.sessions) ? group.sessions : [],
      }))
      const allIds = groups.flatMap((group) => group.items.map((entry) => entry.id))
      const picked = selected ?? new Set()
      const busy = state.busy
      const chosenCount = allIds.filter((id) => picked.has(id)).length
      const allChosen = allIds.length > 0 && chosenCount === allIds.length

      const toggle = (ids, on) => {
        setSelected(() => {
          const next = new Set(picked)
          for (const id of ids) {
            if (on) next.add(id)
            else next.delete(id)
          }
          return next
        })
      }

      /**
       * The batch to send: every ticked row whose parent is not ticked becomes a
       * delete root of its own, carrying the ticked rows below it. Ticking a
       * subagent on its own therefore deletes just that subagent, and ticking a
       * parent takes its selected family with it — the same choice the single
       * dialog offers, with no second "exclusion" state to keep in step.
       */
      const confirm = () => {
        if (busy || state.phase !== 'ready') return
        const roots = []
        const collect = (node, underChosen) => {
          const on = picked.has(node.id)
          if (on && !underChosen) {
            roots.push({
              sessionId: node.id,
              descendants: subtreeIds(node).filter((id) => id !== node.id && picked.has(id)),
            })
          }
          for (const child of node.children) collect(child, underChosen || on)
        }
        for (const group of groups) for (const root of buildForest(group.items, null)) collect(root, false)
        if (roots.length === 0) return
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
            // A partial batch stays open with the survivors ticked: what was
            // deleted is gone, and the rest can be retried by hand.
            const failedIds = new Set(failed.map((entry) => entry.sessionId))
            setSelected(() => new Set(allIds.filter((id) => failedIds.has(id))))
            setState((previous) => ({
              ...previous,
              busy: false,
              error: t('batch.deletePartial', { n: failed.length }) + ' ' + failed.map((entry) => entry.message).join(' / '),
            }))
          },
          (reason) => {
            setState((previous) => ({
              ...previous,
              busy: false,
              error: reason instanceof Error ? reason.message : String(reason),
            }))
          },
        )
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
          className: 'dsd-dialog dsd-dialogWide',
          key: 'dialog',
          ref: dialog,
          tabIndex: -1,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('batch.title'),
        }, [
          h('h2', { className: 'dsd-title', key: 'title', children: t('batch.title') }),
          h('p', { className: 'dsd-desc', key: 'desc', children: t('batch.desc') }),
          state.phase === 'loading'
            ? h('p', { className: 'dsd-note', key: 'loading', children: t('batch.loading') })
            : null,
          state.error === null
            ? null
            : h('p', { className: 'dsd-error', key: 'error', children: `${t('batch.failed')}：${state.error}` }),
          state.phase === 'ready' && catalog === null && state.error === null
            ? h('p', { className: 'dsd-note', key: 'unknown', children: t('batch.unknown') })
            : null,
          state.phase === 'ready' && groups.length === 0
            ? h('p', { className: 'dsd-note', key: 'empty', children: t('batch.empty') })
            : h('div', {
              className: 'dsd-scroll',
              key: 'list',
              role: 'group',
              'aria-label': t('batch.region'),
            }, [
              h('div', { className: 'dsd-toolbar', key: 'toolbar' }, [
                h('label', { className: 'dsd-row dsd-toolbarCell', key: 'master' }, [
                  h('input', {
                    type: 'checkbox',
                    key: 'box',
                    className: 'dsd-check',
                    checked: allChosen,
                    disabled: busy,
                    ref: (node) => {
                      if (node !== null) node.indeterminate = chosenCount > 0 && !allChosen
                    },
                    onChange: () => toggle(allIds, !allChosen),
                  }),
                  h('span', {
                    className: 'dsd-rowText',
                    key: 'text',
                    children: allChosen
                      ? t('batch.selectAll', { n: chosenCount })
                      : t('batch.partial', { m: chosenCount, n: allIds.length }),
                  }),
                ]),
                h('button', {
                  type: 'button',
                  key: 'expand',
                  className: 'dsd-button dsd-link',
                  onClick: () => setCollapsed({}),
                  children: t('batch.expandAll'),
                }),
                h('button', {
                  type: 'button',
                  key: 'collapse',
                  className: 'dsd-button dsd-link',
                  onClick: () => {
                    const next = {}
                    for (const group of groups) next[group.key] = true
                    setCollapsed(next)
                  },
                  children: t('batch.collapseAll'),
                }),
              ]),
              ...groups.map((group) => {
                const groupIds = group.items.map((entry) => entry.id)
                const on = groupIds.length > 0 && groupIds.every((id) => picked.has(id))
                const isCollapsed = collapsed[group.key] === true
                return h('section', { className: 'dsd-group', key: group.key }, [
                  h('div', { className: 'dsd-groupHead', key: 'head' }, [
                    h('button', {
                      type: 'button',
                      key: 'caret',
                      className: 'dsd-caret',
                      'aria-expanded': !isCollapsed,
                      onClick: () => setCollapsed((previous) => ({ ...previous, [group.key]: !isCollapsed })),
                      children: isCollapsed ? '▸' : '▾',
                    }),
                    h('label', { className: 'dsd-row dsd-groupRow', key: 'label' }, [
                      h('input', {
                        type: 'checkbox',
                        key: 'box',
                        className: 'dsd-check',
                        checked: on,
                        disabled: busy,
                        title: t('batch.workspaceAll'),
                        ref: (node) => {
                          if (node !== null) node.indeterminate = !on && groupIds.some((id) => picked.has(id))
                        },
                        onChange: () => toggle(groupIds, !on),
                      }),
                      h('span', { className: 'dsd-rowText', key: 'text' }, [
                        h('span', {
                          className: 'dsd-wsTitle',
                          key: 'title',
                          children: group.title === '' ? t('batch.ungrouped') : group.title,
                        }),
                        h('span', {
                          className: 'dsd-wsCount',
                          key: 'count',
                          children: t('batch.workspaceCount', { n: group.items.length }),
                        }),
                      ]),
                    ]),
                  ]),
                  isCollapsed ? null : h('div', { className: 'dsd-rows dsd-groupRows', key: 'rows' }, [
                    h(FamilyTree, {
                      key: 'tree',
                      items: group.items,
                      implicitParent: null,
                      main: null,
                      selected: picked,
                      onToggle: toggle,
                      collapsed,
                      setCollapsed,
                      disabled: busy,
                      leafName: t('batch.untitled'),
                    }),
                  ]),
                ])
              }),
            ]),
          h('div', { className: 'dsd-footer', key: 'footer' }, [
            h('label', { className: 'dsd-row dsd-stopRow', key: 'stop' }, [
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
              className: 'dsd-button dsd-outline dsd-dangerText',
              key: 'confirm',
              disabled: busy || chosenCount === 0,
              onClick: confirm,
              children: busy
                ? t('batch.deleting')
                : chosenCount === 0
                  ? t('batch.confirmNone')
                  : stop
                    ? t('batch.confirmStop', { n: chosenCount })
                    : t('batch.confirm', { n: chosenCount }),
            }),
          ]),
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
/* The bulk entry point, mounted into the workspace header's own search slot: a
   28px control in the search icon's cell, ahead of that icon. */
.dsd-anchor{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#a8adb7);cursor:pointer}
.dsd-anchor:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-anchor:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4a8cff));outline-offset:-2px}
/* The shipped search cell is exactly one icon wide; the bulk control joins its
   flex row, so the cell is widened by that one control and the icon slides
   right. The shipped rules are CSS-module hashes, hence the attribute match and
   the !important that keeps the two stylesheets' order irrelevant. */
[class*="_searchSlot"]:has(> .dsd-anchor){max-width:56px !important}
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
`

    /** Mount the plugin's stylesheet with its components. */
    function Styles() {
      return h('style', { 'data-dsh-plugin': 'session-delete', children: CSS })
    }

    /** The menu row and its dialog, wrapped so the stylesheet travels with them. */
    function WithStyles(Component) {
      function StyledComponent(props) {
        return h(React.Fragment, null, h(Styles, { key: 'style' }), h(Component, { ...props, key: 'body' }))
      }
      StyledComponent.displayName = `SessionDelete(${Component.name})`
      return StyledComponent
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          ctx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'session-delete: locale')
          translate = locale.bind(NS)
        }
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'session-delete', order: 500, locale: NS },
            WithStyles(DeleteSessionMenuItem),
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'session-delete-dialog', order: 60, locale: NS },
            WithStyles(DeleteSessionDialog),
          ),
        )
        // The bulk entry lives in the sidebar foot: it renders only a hidden
        // placeholder and mounts the real control into the browsing region's own
        // search slot, which is what puts it beside the search icon without
        // shadowing the shipped WorkspaceBrowser that owns that `single` slot.
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'session-delete-bulk', order: 40, locale: NS },
            WithStyles(BulkDeleteAnchor),
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'session-delete-bulk-dialog', order: 61, locale: NS },
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
