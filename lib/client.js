/**
 * dsh-archived-sessions — browser half.
 *
 * Hand-written module-loader bundle (no build step): it registers a
 * `settings.section` page that lists the Host's archived sessions and deletes
 * them through this plugin's own fenced routes (`/dsh-archived-sessions/*`).
 *
 * Why a settings page: the Settings shell is a stable, documented extension
 * point (`settings.section`), so the plugin needs no sidebar/panel surgery and
 * survives the workspace UI changing.
 */
window.__ModuleLoader__.load({
  id: 'dsh-archived-sessions',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    /** The client Context, kept for session metadata lookups. */
    var pluginCtx = null
    var API = 'dsh-archived-sessions/'
    /** The settings section label — also how the nav row is identified. */
    var SECTION_LABEL = '归档会话'
    var NAV_ATTR = 'data-dsh-archived-sessions-nav'
    var NAV_STYLE_ID = 'dsh-archived-sessions-nav-style'

    /**
     * Archive box with an × inside it (the Lucide `archive-x` shape).
     * Stroke-only, drawn in `black`: it becomes a CSS mask, so the visible
     * colour is the nav button's own `currentColor` in either theme.
     */
    var NAV_ICON_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="2" y="3" width="20" height="5" rx="1"/>' +
      '<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>' +
      '<path d="m9.5 17 5-5"/>' +
      '<path d="m9.5 12 5 5"/>' +
      '</svg>'

    var NAV_ICON_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(NAV_ICON_SVG)

    /** Stable empty array: a fresh one per `getSnapshot()` would loop React. */
    var EMPTY_ARCHIVED = []
    /** The delete row appended to the archived session's "..." menu. */
    var MENU_ITEM_CLASS = 'dsh-archived-delete-item'
    var MENU_ICON_CLASS = 'dsh-archived-delete-icon'
    var MENU_STYLE_ID = 'dsh-archived-sessions-menu-style'

    /**
     * The settings shell projects only `id`, `order` and `label` from a
     * `settings.section` registration and picks its glyph from a closed list of
     * built-in ids, so a third-party section gets the fallback gear. Until that
     * contract grows an icon field, mark our own row after mount and paint the
     * glyph with CSS: the shell's `<svg>` is hidden and a `::before` mask
     * supplies ours. Nothing is replaced inside React's tree, so re-renders and
     * HMR stay safe; the disposer removes both the marker and the style node.
     */
    function installNavIcon(label) {
      var style = document.getElementById(NAV_STYLE_ID)
      if (!style) {
        style = document.createElement('style')
        style.id = NAV_STYLE_ID
        style.textContent = [
          '[' + NAV_ATTR + '] > svg:first-child{display:none}',
          '[' + NAV_ATTR + ']::before{',
          'content:"";flex:none;width:16px;height:16px;',
          'background:currentColor;',
          '-webkit-mask:url("' + NAV_ICON_URL + '") center/contain no-repeat;',
          'mask:url("' + NAV_ICON_URL + '") center/contain no-repeat;',
          '}',
        ].join('')
        document.head.appendChild(style)
      }

      var disposed = false
      var frame = null
      var wanted = label.trim()

      var sync = function () {
        if (disposed) return
        var buttons = document.querySelectorAll('[role="dialog"] nav button')
        for (var index = 0; index < buttons.length; index += 1) {
          var button = buttons[index]
          if (wanted && button.textContent && button.textContent.trim() === wanted) {
            button.setAttribute(NAV_ATTR, '')
          } else {
            button.removeAttribute(NAV_ATTR)
          }
        }
      }

      var schedule = function () {
        if (disposed || frame !== null) return
        frame = requestAnimationFrame(function () {
          frame = null
          sync()
        })
      }

      sync()
      var observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })

      return function cleanup() {
        disposed = true
        observer.disconnect()
        if (frame !== null) {
          cancelAnimationFrame(frame)
          frame = null
        }
        var marked = document.querySelectorAll('[' + NAV_ATTR + ']')
        for (var index = 0; index < marked.length; index += 1) marked[index].removeAttribute(NAV_ATTR)
        var node = document.getElementById(NAV_STYLE_ID)
        if (node && node.parentNode) node.parentNode.removeChild(node)
      }
    }

    function request(route, payload) {
      return fetch(API + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      }).then(function (res) {
        return res.json().catch(function () { return null }).then(function (data) {
          if (!res.ok || !data || data.ok !== true) {
            var message = data && data.error && data.error.message ? data.error.message : 'HTTP ' + res.status
            throw new Error(message)
          }
          return data.value
        })
      })
    }

    function sessionMeta(id) {
      try {
        var sessions = pluginCtx.get('sessions')
        var snapshot = sessions && sessions.list && sessions.list.getSnapshot()
        return (snapshot && snapshot.byId && snapshot.byId[id]) || null
      } catch (error) {
        return null
      }
    }

    function titleOf(row) {
      if (row.title) return row.title
      var meta = sessionMeta(row.id)
      if (meta && meta.title) return meta.title
      return String(row.id).slice(0, 8)
    }

    function cwdOf(row) {
      if (row.cwd) return row.cwd
      var meta = sessionMeta(row.id)
      return (meta && meta.cwd) || ''
    }

    function formatTime(value) {
      if (value === null || value === undefined) return ''
      var date = new Date(value)
      if (isNaN(date.getTime())) return ''
      return date.toLocaleString()
    }

    var COLORS = {
      text: 'var(--dsh-text-primary, #1f2328)',
      muted: 'var(--dsh-text-tertiary, #6b7280)',
      border: 'var(--dsh-border, rgba(0,0,0,.1))',
      surface: 'var(--dsh-surface-secondary, rgba(127,127,127,.06))',
      danger: '#d1242f',
      accent: 'var(--dsh-accent, #4d6bfe)',
    }

    function buttonStyle(kind, disabled) {
      var base = {
        appearance: 'none',
        border: '1px solid ' + COLORS.border,
        background: 'transparent',
        color: kind === 'danger' ? COLORS.danger : COLORS.text,
        borderRadius: 6,
        padding: '4px 10px',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }
      if (kind === 'primary') {
        base.borderColor = 'transparent'
        base.background = COLORS.danger
        base.color = '#fff'
      }
      return base
    }

    function Section() {
      var state = React.useState(null)
      var rows = state[0]
      var setRows = state[1]
      var errorState = React.useState(null)
      var error = errorState[0]
      var setError = errorState[1]
      var busyState = React.useState(null)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var noticeState = React.useState(null)
      var notice = noticeState[0]
      var setNotice = noticeState[1]

      var refresh = React.useCallback(function () {
        setError(null)
        request('list')
          .then(function (value) { setRows((value && value.sessions) || []) })
          .catch(function (failure) {
            setRows([])
            setError(failure.message || String(failure))
          })
      }, [])

      React.useEffect(function () { refresh() }, [refresh])

      var remove = React.useCallback(function (ids) {
        if (!ids.length) return
        var label = ids.length === 1 ? '这条归档会话' : '全部 ' + ids.length + ' 条归档会话'
        if (!window.confirm('确定永久删除' + label + '吗？删除后无法恢复。')) return
        setBusy(ids.length > 1 ? 'all' : ids[0])
        setNotice(null)
        request('delete', { ids: ids })
          .then(function (value) {
            var failed = (value && value.failed) || []
            if (failed.length) {
              setNotice('有 ' + failed.length + ' 条删除失败：' + failed.map(function (f) { return f.message }).join('; '))
            } else {
              setNotice('已删除 ' + ((value && value.deleted) || []).length + ' 条归档会话（侧边栏列表刷新页面后更新）。')
            }
            setRows(function (previous) {
              var gone = new Set((value && value.deleted) || [])
              return (previous || []).filter(function (row) { return !gone.has(row.id) })
            })
          })
          .catch(function (failure) {
            setNotice('删除失败：' + (failure.message || String(failure)))
          })
          .then(function () { setBusy(null) })
      }, [])

      var list = rows || []
      var count = list.length

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0 24px', color: COLORS.text } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('div', { style: { fontSize: 14, fontWeight: 600 } }, '归档会话'),
          h('span', { style: { color: COLORS.muted, fontSize: 12 } }, count > 0 ? count + ' 条' : ''),
          h('div', { style: { flex: 1 } }),
          h(
            'button',
            { type: 'button', style: buttonStyle('plain', busy !== null), disabled: busy !== null, onClick: refresh, title: '重新读取归档列表' },
            '刷新',
          ),
          h(
            'button',
            {
              type: 'button',
              style: buttonStyle('primary', busy !== null || count === 0),
              disabled: busy !== null || count === 0,
              onClick: function () { remove(list.map(function (row) { return row.id })) },
            },
            '全部删除',
          ),
        ),
        h(
          'div',
          { style: { color: COLORS.muted, fontSize: 12, lineHeight: '18px' } },
          '这里列出所有已归档的对话。删除会先取消归档，再移除会话文件，操作不可恢复。',
        ),
        error
          ? h('div', { style: { color: COLORS.danger, fontSize: 12 } }, '读取失败：' + error)
          : null,
        notice
          ? h('div', { style: { color: COLORS.muted, fontSize: 12 } }, notice)
          : null,
        rows === null
          ? h('div', { style: { color: COLORS.muted, fontSize: 12, padding: '12px 0' } }, '读取中…')
          : count === 0
            ? h(
                'div',
                { style: { color: COLORS.muted, fontSize: 12, padding: '16px 0', textAlign: 'center' } },
                '没有已归档的会话。',
              )
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                list.map(function (row) {
                  var cwd = cwdOf(row)
                  var time = formatTime(row.updatedAt)
                  return h(
                    'div',
                    {
                      key: row.id,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        border: '1px solid ' + COLORS.border,
                        background: COLORS.surface,
                        borderRadius: 8,
                        padding: '8px 10px',
                      },
                    },
                    h(
                      'div',
                      { style: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 } },
                      h(
                        'div',
                        { style: { fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: titleOf(row) },
                        titleOf(row),
                      ),
                      h(
                        'div',
                        { style: { fontSize: 11, color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: cwd },
                        [cwd, time].filter(Boolean).join('  ·  '),
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        style: buttonStyle('danger', busy !== null),
                        disabled: busy !== null,
                        onClick: function () { remove([row.id]) },
                      },
                      busy === row.id ? '删除中…' : '删除',
                    ),
                  )
                }),
              ),
      )
    }

    /** Inject the menu-row stylesheet once; returns a disposer. */
    function installMenuStyles() {
      var style = document.getElementById(MENU_STYLE_ID)
      if (!style) {
        style = document.createElement('style')
        style.id = MENU_STYLE_ID
        style.textContent = [
          '.' + MENU_ITEM_CLASS + '{',
          'display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
          'height:28px;padding:0 10px;border:0;border-radius:6px;background:transparent;',
          'color:#d1242f;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;',
          '}',
          '.' + MENU_ITEM_CLASS + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(127,127,127,.12))}',
          '.' + MENU_ITEM_CLASS + ':disabled{opacity:.55;cursor:default;background:transparent}',
          // The same archive-x glyph as the Settings nav row: a mask so the
          // icon follows the row's danger colour instead of shipping its own.
          '.' + MENU_ICON_CLASS + '{',
          'flex:none;width:14px;height:14px;background:currentColor;',
          '-webkit-mask:url("' + NAV_ICON_URL + '") center/contain no-repeat;',
          'mask:url("' + NAV_ICON_URL + '") center/contain no-repeat;',
          '}',
        ].join('')
        document.head.appendChild(style)
      }
      return function cleanup() {
        var node = document.getElementById(MENU_STYLE_ID)
        if (node && node.parentNode) node.parentNode.removeChild(node)
      }
    }

    /** The host's archive set, subscribed the same way the sidebar subscribes. */
    function useArchivedIds() {
      return React.useSyncExternalStore(
        function (callback) {
          try {
            var subscription = pluginCtx.workspaces.list.subscribe(callback)
            return typeof subscription === 'function' ? subscription : function () {}
          } catch (error) {
            return function () {}
          }
        },
        function () {
          try {
            var snapshot = pluginCtx.workspaces.list.getSnapshot()
            return (snapshot && snapshot.archivedSessionIds) || EMPTY_ARCHIVED
          } catch (error) {
            return EMPTY_ARCHIVED
          }
        },
      )
    }

    /**
     * `<li>`-less menu row appended to `sidebar.workspaces.session.menu.item`
     * (order 410, right after the archive/unarchive row). It renders only while
     * the target session is in the archive set, so ordinary rows never see it.
     *
     * The shell's own `MenuItemButton` comes from a primitives module this
     * plugin does not resolve, so the row is a plain button styled to match —
     * same height/radius/hover token, danger colour.
     */
    function DeleteArchivedMenuItem(props) {
      var sessionId = props.sessionId
      var archivedIds = useArchivedIds()
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      var archived = false
      for (var index = 0; index < archivedIds.length; index += 1) {
        if (archivedIds[index] === sessionId) {
          archived = true
          break
        }
      }
      if (!archived) return null

      var run = function () {
        var title = props.displayTitle || '这条归档会话'
        if (!window.confirm('永久删除「' + title + '」？删除后无法恢复。')) return
        setBusy(true)
        request('delete', { ids: [sessionId] })
          .then(function (value) {
            var failed = (value && value.failed) || []
            if (failed.length) {
              setBusy(false)
              window.alert('删除失败：' + (failed[0].message || '未知错误'))
              return
            }
            // The Host dropped the log and re-indexed; the sidebar still holds
            // its own copy of the session list, so reload to rebuild it.
            window.location.reload()
          })
          .catch(function (failure) {
            setBusy(false)
            window.alert('删除失败：' + (failure && failure.message ? failure.message : String(failure)))
          })
      }

      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: MENU_ITEM_CLASS,
          disabled: busy,
          onClick: run,
        },
        h('span', { className: MENU_ICON_CLASS, 'aria-hidden': 'true' }),
        busy ? '删除中…' : '删除归档会话',
      )
    }

    function apply(ctx) {
      pluginCtx = ctx
      ctx.effect(function () { return installNavIcon(SECTION_LABEL) }, 'dsh-archived-sessions: settings nav icon')
      ctx.effect(function () { return installMenuStyles() }, 'dsh-archived-sessions: menu styles')
      ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'archived-delete',
            order: 410,
            inject: function () { return {} },
          },
          DeleteArchivedMenuItem,
        )
      })
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-archived-sessions',
            order: 120,
            label: function () { return SECTION_LABEL },
            inject: function () { return {} },
          },
          Section,
        )
      })
    }

    var inject = ['slots', 'sessions', 'workspaces']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
