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
        'dialog.confirm': '删除',
        'dialog.confirmStop': '停止并删除',
        'dialog.checking': '检查中…',
        'dialog.deleting': '正在删除…',
        'dialog.failed': '删除失败',
        'dialog.running': '这个会话还有未结束的工作：',
        'dialog.runningHint': '确认后会先停掉这些工作，再删除这个会话。',
        'dialog.open': '它当前仍被 Harness 占用（可能开在某个窗口或标签里）。删除后它会立刻从列表消失。',
        'dialog.unknown': '读不到它的当前状态，仍可直接删除。',
        'dialog.descendants': '它派生出的 {n} 个子会话（子智能体）日志会一并删除。',
      },
      en: {
        'menu.delete': 'Delete conversation',
        'dialog.title': 'Delete conversation',
        'dialog.desc': '“{title}” will be deleted permanently: its session log, workspace account and projection cache are removed. This cannot be undone.',
        'dialog.untitled': 'Untitled conversation',
        'dialog.cancel': 'Cancel',
        'dialog.confirm': 'Delete',
        'dialog.confirmStop': 'Stop and delete',
        'dialog.checking': 'Checking…',
        'dialog.deleting': 'Deleting…',
        'dialog.failed': 'Delete failed',
        'dialog.running': 'This conversation still has unfinished work:',
        'dialog.runningHint': 'Confirming stops that work first, then deletes the conversation.',
        'dialog.open': 'The Harness still holds it open (it may be showing in a window or tab). Deleting removes it from the list at once.',
        'dialog.unknown': 'Its current state could not be read; deleting is still possible.',
        'dialog.descendants': 'The {n} subagent conversations it spawned are deleted with it.',
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

    /** Ask the Host half to delete one Session. */
    async function deleteSession(sessionId, stop) {
      const response = await fetch(DELETE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, stop: stop === true }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) throw failureOf(payload, response)
      return payload
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
      const dialog = useRef(null)

      const close = useCallback(() => {
        setState((previous) => {
          if (previous.busy) return previous
          settle()
          return IDLE
        })
      }, [])

      // Every open re-reads the Host's state: the answer is only true for the
      // moment the dialog opened, and a Session can start working in between.
      useEffect(() => {
        if (request === null) {
          setState(IDLE)
          return undefined
        }
        let cancelled = false
        setState({ phase: 'checking', info: null, error: null, stop: false, busy: false })
        inspectSession(request.sessionId).then(
          (info) => {
            if (cancelled) return
            setState({
              phase: 'ready',
              info,
              error: null,
              stop: Array.isArray(info.activity) && info.activity.length > 0,
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

      const confirm = () => {
        if (state.busy || state.phase !== 'ready') return
        setState((previous) => ({ ...previous, busy: true, error: null }))
        deleteSession(request.sessionId, state.stop).then(
          () => {
            settle()
            setState(IDLE)
          },
          (reason) => {
            // A Session that started working between the check and the write
            // answers with its activity, so the next press stops it.
            const activity = Array.isArray(reason?.activity) ? reason.activity : null
            setState((previous) => ({
              ...previous,
              busy: false,
              error: reason instanceof Error ? reason.message : String(reason),
              stop: previous.stop || reason?.code === 'session-active' || activity !== null,
              info: activity === null || previous.info === null
                ? previous.info
                : { ...previous.info, activity },
            }))
          },
        )
      }

      const title = request.title === undefined || request.title === '' ? t('dialog.untitled') : request.title
      const info = state.info
      const activity = info === null || !Array.isArray(info.activity) ? [] : info.activity
      const descendants = info === null || info.descendants === undefined || typeof info.descendants.count !== 'number'
        ? 0
        : info.descendants.count
      const checking = state.phase === 'checking'
      const confirmLabel = state.busy || checking
        ? (checking ? t('dialog.checking') : t('dialog.deleting'))
        : (state.stop ? t('dialog.confirmStop') : t('dialog.confirm'))

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
                const items = Array.isArray(entry.items) ? entry.items : []
                const names = items.map((item) => (item.label === '' ? item.id : item.label)).filter((name) => name !== '')
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
          descendants === 0
            ? null
            : h('p', { className: 'dsd-note dsd-descendants', key: 'descendants', children: t('dialog.descendants', { n: descendants }) }),
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
