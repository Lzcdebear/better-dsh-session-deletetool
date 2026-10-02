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

    const DICT = {
      zh: {
        'menu.delete': '删除会话',
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
        'dialog.group.subagents': '子智能体会话',
        'dialog.group.derived': '派生对话（fork）',
        'dialog.selectAll': '删除全部（共 {n} 个）',
        'dialog.selectPartial': '已选 {m} / {n} 个',
        'dialog.expandHint': '点分组标题可折叠',
        'dialog.truncated': '共 {n} 个，下面只列出前 {shown} 个。',
        'dialog.maxDeletable': '一次最多删除 {max} 个，请分批选择。',
        'dialog.itemRunning': '运行中',
        'dialog.itemActive': '有未结束的工作',
        'dialog.itemOpen': '已打开',
        'dialog.untitledItem': '未命名',
        'dialog.confirmCount': '删除 {n} 个会话',
        'dialog.confirmStopCount': '停止并删除 {n} 个会话',
      },
      en: {
        'menu.delete': 'Delete conversation',
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
        'dialog.group.subagents': 'Subagent conversations',
        'dialog.group.derived': 'Forked conversations',
        'dialog.selectAll': 'Delete all ({n})',
        'dialog.selectPartial': '{m} of {n} selected',
        'dialog.expandHint': 'Click a group title to collapse it',
        'dialog.truncated': 'There are {n}; only the first {shown} are listed.',
        'dialog.maxDeletable': 'At most {max} can be deleted at once — select in batches.',
        'dialog.itemRunning': 'running',
        'dialog.itemActive': 'has unfinished work',
        'dialog.itemOpen': 'open',
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

    /**
     * The dialog's "goes with it" line: which kinds of descendant follow this
     * delete, so deleting a family is never silent. Null when there are none.
     */
    function descendantsText(info) {
      const counts = info === null || info.descendants === undefined ? null : info.descendants
      if (counts === null) return null
      const parts = []
      if (typeof counts.subagents === 'number' && counts.subagents > 0) {
        parts.push(t('dialog.descendants.subagents', { n: counts.subagents }))
      }
      if (typeof counts.derived === 'number' && counts.derived > 0) {
        parts.push(t('dialog.descendants.derived', { n: counts.derived }))
      }
      return parts.length === 0 ? null : parts.join(t('dialog.listSeparator'))
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

      const toggleItem = (id) => {
        setSelected(() => {
          const next = new Set(picked)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
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
      const descendants = descendantsText(info)
      const checking = state.phase === 'checking'
      const deletedCount = selectedCount + 1
      const confirmLabel = state.busy || checking
        ? (checking ? t('dialog.checking') : t('dialog.deleting'))
        : state.stop
          ? t('dialog.confirmStopCount', { n: deletedCount })
          : t('dialog.confirmCount', { n: deletedCount })

      /**
       * One descendant row: a checkbox, its title, and the states that matter
       * before deleting it. Indented by lineage depth so a family reads as one.
       */
      const row = (entry) => {
        const busy = activityOf(entry)
        const hints = []
        if (busy.length > 0) hints.push(busy.map((item) => item.label).join('、'))
        else if (entry.running === true) hints.push(t('dialog.itemRunning'))
        if (entry.open === true) hints.push(t('dialog.itemOpen'))
        const name = entry.title === undefined || entry.title === '' ? t('dialog.untitledItem') : entry.title
        return h('label', {
          className: 'dsd-row',
          key: entry.id,
          style: { paddingInlineStart: `${10 + Math.min(entry.depth ?? 1, 6) * 14}px` },
        }, [
          h('input', {
            type: 'checkbox',
            key: 'box',
            className: 'dsd-check',
            checked: picked.has(entry.id),
            onChange: () => toggleItem(entry.id),
          }),
          h('span', { className: 'dsd-rowText', key: 'text' }, [
            h('span', { className: 'dsd-rowTitle', key: 'name', children: name }),
            h('span', { className: 'dsd-rowId', key: 'id', children: shortId(entry.id) }),
          ]),
          hints.length === 0
            ? null
            : h('span', { className: 'dsd-badge', key: 'badge', children: hints.join(' · ') }),
        ])
      }

      /** The whole selectable family: one master row, then one collapsible group per kind. */
      const tree = () => {
        const allIds = items.map((entry) => entry.id)
        const everything = selectedCount === items.length && items.length > 0
        const groups = [
          { key: 'subagent', label: t('dialog.group.subagents'), members: items.filter((entry) => entry.kind === 'subagent') },
          { key: 'derived', label: t('dialog.group.derived'), members: items.filter((entry) => entry.kind !== 'subagent') },
        ].filter((group) => group.members.length > 0)

        return h('div', { className: 'dsd-tree', key: 'tree' }, [
          h('label', { className: 'dsd-row dsd-master', key: 'master' }, [
            h('input', {
              type: 'checkbox',
              key: 'box',
              className: 'dsd-check',
              checked: everything,
              ref: (node) => {
                if (node !== null) node.indeterminate = selectedCount > 0 && !everything
              },
              onChange: () => toggleMany(allIds, !everything),
            }),
            h('span', { className: 'dsd-rowText', key: 'text' }, [
              h('span', {
                className: 'dsd-rowTitle',
                key: 'name',
                children: everything
                  ? t('dialog.selectAll', { n: items.length })
                  : t('dialog.selectPartial', { m: selectedCount, n: items.length }),
              }),
              h('span', { className: 'dsd-rowId', key: 'hint', children: t('dialog.expandHint') }),
            ]),
          ]),
          ...groups.map((group) => {
            const memberIds = group.members.map((entry) => entry.id)
            const on = memberIds.every((id) => picked.has(id))
            const isCollapsed = collapsed[group.key] === true
            return h('div', { className: 'dsd-group', key: group.key }, [
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
                    onChange: () => toggleMany(memberIds, !on),
                  }),
                  h('span', {
                    className: 'dsd-rowText',
                    key: 'text',
                    children: `${group.label} (${group.members.length})`,
                  }),
                ]),
              ]),
              isCollapsed ? null : h('div', { className: 'dsd-rows', key: 'rows' }, group.members.map(row)),
            ])
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
        ])
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
          items.length === 0
            ? (descendants === null
              ? null
              : h('p', { className: 'dsd-note dsd-descendants', key: 'descendants', children: t('dialog.descendants', { list: descendants }) }))
            : tree(),
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
.dsd-hint{margin:4px 0 0;font-size:12px;line-height:18px}
.dsd-descendants{padding:8px 12px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-state-warn-primary,#d9a03a);color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsd-error{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e5484d);word-break:break-word}
.dsd-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px}
.dsd-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:var(--dsw-radius-md,8px);cursor:pointer;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#e6e6e6);background:transparent}
.dsd-button:disabled{cursor:not-allowed;opacity:.4}
.dsd-outline{border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32))}
.dsd-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-dangerText{color:var(--dsw-alias-state-error-primary,#e5484d)}
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
      },
    }
  },
})
