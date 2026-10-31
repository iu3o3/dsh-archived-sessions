// Offline smoke test for the browser bundle: no React, no DOM, just enough
// stubs to exercise apply() and the menu-row component.
import fs from 'node:fs'

let def = null
const styleNodes = []
const fakeDocument = {
  head: { appendChild: (node) => styleNodes.push(node) },
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '' }),
  querySelectorAll: () => [],
  body: {},
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } }, confirm: () => true, alert: () => {} }
globalThis.document = fakeDocument
globalThis.requestAnimationFrame = () => 0
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}

new Function('window', 'document', fs.readFileSync('lib/client.js', 'utf8'))(globalThis.window, fakeDocument)

const registered = []
const ctx = {
  effect: (fn) => fn(),
  slots: {
    inject: (_name, callback) => { callback() },
    register: (options, component) => { registered.push({ options, component }); return () => {} },
  },
  workspaces: {
    list: {
      subscribe: () => () => {},
      getSnapshot: () => ({ archivedSessionIds: ['s1'] }),
    },
  },
  get: () => ({}),
}

const mod = def.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
mod.apply(ctx)

console.log('registrations:', registered.map((r) => `${r.options.name}#${r.options.id}@${r.options.order}`).join(', '))
const menu = registered.find((r) => r.options.id === 'archived-delete')
const row = menu.component({ sessionId: 's1', displayTitle: '被归档的对话' })
const normal = menu.component({ sessionId: 's2', displayTitle: '普通对话' })
console.log('archived row renders:', row && row.type, '| text:', row && row.props.children)
console.log('normal row renders:', normal)
console.log('styles injected:', styleNodes.map((n) => n.id))
