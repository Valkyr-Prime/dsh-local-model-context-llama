/**
 * Offline render test for the Client half.
 *
 * The agent shell has no browser, so `client.js` is executed against a tiny
 * stand-in for React that runs hooks, executes effects and re-renders on state
 * changes. It is not React: it exists to catch render-time crashes, wrong prop
 * shapes and hook-order mistakes before the bundle is installed.
 *
 *   node scripts/client-render.test.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/** The client module id must equal the package name (the graph row id). */
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

// ---------------------------------------------------------------- fake React
let hookOwner = undefined
let dirty = false
let lastCard
const hookStore = new Map()

function nextHook(init) {
  const index = hookOwner.index++
  if (!(index in hookOwner.slots)) hookOwner.slots[index] = typeof init === 'function' ? init() : init
  return index
}

const React = {
  createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { __el: true, type, props: merged }
  },
  useState(init) {
    const owner = hookOwner
    const index = nextHook(init)
    const set = (next) => {
      const value = typeof next === 'function' ? next(owner.slots[index]) : next
      if (value !== owner.slots[index]) {
        owner.slots[index] = value
        dirty = true
      }
    }
    return [owner.slots[index], set]
  },
  useRef(init) {
    const index = nextHook(undefined)
    if (hookOwner.slots[index] === undefined) hookOwner.slots[index] = { current: init }
    return hookOwner.slots[index]
  },
  useCallback(fn) {
    nextHook(undefined)
    return fn
  },
  useEffect(fn) {
    nextHook(undefined)
    hookOwner.effects.push(fn)
    return undefined
  },
}

/** Turn an element tree into a DOM-less description while running components. */
function renderTree(node, path, out) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    node.forEach((child, index) => renderTree(child, `${path}[${index}]`, out))
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node))
    return
  }
  if (typeof node !== 'object' || node.__el !== true) return
  const { type, props } = node
  if (typeof type === 'string') {
    out.classes.push(typeof props.className === 'string' ? props.className : '')
    out.tags.push(type)
    out.props.push(props)
    renderTree(props.children, `${path}/${type}`, out)
    return
  }
  if (typeof type === 'function') {
    if (type.name === 'ModelCard') lastCard = node
    const key = `${path}/${type.name || 'anonymous'}`
    let owner = hookStore.get(key)
    if (owner === undefined) {
      owner = { index: 0, slots: [], effects: [] }
      hookStore.set(key, owner)
    }
    owner.index = 0
    const previous = hookOwner
    hookOwner = owner
    let rendered
    try {
      rendered = type(props)
    } finally {
      hookOwner = previous
    }
    out.components.push(type.name)
    renderTree(rendered, key, out)
    return
  }
  throw new Error(`unexpected element type: ${String(type)}`)
}

function newOut() {
  return { text: [], classes: [], tags: [], props: [], components: [] }
}

const cleanups = []

/** Run every effect once, then flush microtasks. */
async function flushEffects() {
  for (let round = 0; round < 4; round++) {
    for (const owner of hookStore.values()) {
      const effects = owner.effects
      owner.effects = []
      for (const effect of effects) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// ---------------------------------------------------------------- fake Host
const snapshot = {
  ok: true,
  at: '2026-11-22T00:00:00.000Z',
  gpu: { name: 'Test GPU', totalMiB: 16303, usedMiB: 1634, freeMiB: 14362 },
  budgetMiB: 14767,
  reserveMiB: 1536,
  app: {
    settingsPath: 'C:\\Users\\me\\.dsh\\settings.json',
    presetsPath: 'C:\\Users\\me\\.llama\\model-context-presets.ini',
    settingsFound: true,
    presetsFound: true,
    cacheTypeK: 'q8_0',
    cacheTypeV: 'q8_0',
    serverPort: 9931,
  },
  providerCount: 1,
  models: [{
    provider: 'llama-local',
    providerName: 'Llama (local GPU)',
    id: 'Qwen3.5-9B',
    origin: 'http://127.0.0.1:9931',
    displayName: 'Qwen3.5 9B (local, vision)',
    declaredMaxTokens: 8192,
    input: ['text', 'image'],
    state: 'sleeping',
    trainedMax: 262144,
    routerContext: 131072,
    dshContext: 131072,
    appContext: 65536,
    architecture: 'qwen35',
    kvLayers: 8,
    kvPerTokenKiB: 17,
    weightsBytes: 5629109120,
    weightsText: '5.2 GiB',
    mmprojBytes: 921704832,
    mmprojText: '0.9 GiB',
    cacheTypeK: 'q8_0',
    cacheTypeV: 'q8_0',
    candidates: [16384, 32768, 65536, 131072, 262144].map((context) => ({
      context,
      label: `${context / 1024}K`,
      estimateMiB: 6000 + Math.round(context / 40),
      estimateText: `${(6 + context / 220000).toFixed(1)} GB`,
      overBudget: context > 200000,
      isRouterCurrent: context === 131072,
      isDshDeclared: context === 131072,
    })),
    capabilities: {
      presetsPath: 'C:\\Users\\me\\.llama\\model-context-presets.ini',
      presetsFound: true,
      settingsFound: true,
      settingsPath: 'C:\\Users\\me\\.dsh\\settings.json',
      portMatches: true,
    },
    drift: { routerVsApp: true, routerVsDsh: false },
  }],
  warnings: ['Qwen3.5-9B：llama.app 设置 64K 与路由生效 128K 不一致；重启 llama.app 可让它的界面同步。'],
  reachable: true,
}

let applyCalls = 0
const applyResult = {
  ok: true,
  model: 'Qwen3.5-9B',
  context: 65536,
  steps: [
    { id: 'presets', ok: true, detail: '已写入 C:\\Users\\me\\.llama\\model-context-presets.ini' },
    { id: 'reload', ok: true, detail: 'router 已重读 preset' },
    { id: 'dsh', ok: true, detail: 'DSH 模型表已更新 contextWindow' },
  ],
  warnings: [],
  state: { ...snapshot, warnings: [] },
}

globalThis.fetch = async (url, init) => {
  if (String(url).includes('/apply')) {
    applyCalls++
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'Qwen3.5-9B')
    assert.equal(body.context, 65536)
    return { ok: true, status: 200, json: async () => applyResult }
  }
  return { ok: true, status: 200, json: async () => snapshot }
}

// ---------------------------------------------------------------- run client
const registered = []
const localeDictionaries = {}
let applyModule

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      assert.equal(definition.id, pkg.name)
      applyModule = definition.factory((specifier) => {
        if (specifier === 'react') return React
        throw new Error(`unexpected require: ${specifier}`)
      })
    },
  },
}

await import('../client.js')
assert.ok(applyModule, 'client module did not register')
assert.deepEqual(applyModule.inject, ['slots', 'locale'])
applyModule.apply({
  effect(fn, label) {
    const dispose = fn()
    return () => { if (typeof dispose === 'function') dispose(); void label }
  },
  locale: {
    register(ns, dictionaries) {
      localeDictionaries[ns] = dictionaries
      return () => {}
    },
    bind(ns) {
      return (key) => localeDictionaries[ns]?.zh?.[key] ?? key
    },
  },
  slots: {
    inject(key, callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    },
  },
})

assert.equal(registered.length, 2, 'expected a section and an icon registration')
const section = registered.find((entry) => entry.options.name === 'settings.section')
const icon = registered.find((entry) => entry.options.name === 'settings.section.icon')
assert.ok(section, 'settings.section not registered')
assert.equal(section.options.id, 'local-models')
assert.equal(section.options.order, 12)
assert.equal(section.options.label(), '本地模型')
assert.equal(icon.options.id, 'local-models', 'icon id must equal the section id')
assert.deepEqual(Object.keys(localeDictionaries), ['local-model-context'])

const t = (key) => localeDictionaries['local-model-context'].zh[key] ?? key

// First render: no snapshot yet.
let out = newOut()
renderTree({ __el: true, type: section.component, props: { t, close() {} } }, 'root', out)
assert.ok(out.text.includes('本地模型'), `title missing: ${out.text.join('|')}`)
await flushEffects()

// Second render: the snapshot arrived.
out = newOut()
renderTree({ __el: true, type: section.component, props: { t, close() {} } }, 'root', out)
const text = out.text.join('\n')
if (!text.includes('Qwen3.5 9B (local, vision)')) console.log('--- rendered ---\n' + text + '\n---------------')
assert.ok(text.includes('Qwen3.5 9B (local, vision)'), 'model card missing')
assert.ok(text.includes('路由 128K'), 'router window missing')
assert.ok(text.includes('llama.app 64K'), 'app window missing')
assert.ok(text.includes('三处不一致'), 'drift badge missing')
assert.ok(text.includes('超预算'), 'over-budget badge missing')
assert.ok(text.includes('应用'), 'apply button missing')
assert.ok(text.includes('16,303') === false && text.includes('15.9 GB'), 'gpu line missing')
console.log('render 1 ok — cards:', out.components.filter((name) => name === 'ModelCard').length)

// The card's apply callback is the button handler; the last ModelCard element the
// render pass produced carries the props the page passed it.
const cardTree = lastCard
assert.ok(cardTree, 'ModelCard element not found')
assert.equal(typeof cardTree.props.onApply, 'function')

cardTree.props.onSelect(65536)
cardTree.props.onApply(65536)
await flushEffects()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(applyCalls, 1, 'apply route was not called')

out = newOut()
renderTree({ __el: true, type: section.component, props: { t, close() {} } }, 'root', out)
const afterApply = out.text.join('\n')
assert.ok(afterApply.includes('已应用 64K'), `apply result missing: ${afterApply.slice(0, 400)}`)
assert.ok(afterApply.includes('全部步骤成功'), 'apply outcome line missing')
console.log('render 2 ok — apply flow rendered')

// The icon renders at both rail and wide sizes.
for (const size of [16, 18]) {
  const iconOut = newOut()
  renderTree({ __el: true, type: icon.component, props: { size, active: false } }, 'icon', iconOut)
  assert.ok(iconOut.tags.includes('svg'), 'icon is not an svg')
}

// Both dictionaries must expose exactly the same keys.
const zhKeys = Object.keys(localeDictionaries['local-model-context'].zh).sort()
const enKeys = Object.keys(localeDictionaries['local-model-context'].en).sort()
assert.deepEqual(zhKeys, enKeys, 'zh/en dictionaries disagree')

console.log('client render test passed')
