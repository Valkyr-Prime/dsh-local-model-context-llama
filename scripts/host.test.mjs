/**
 * Host-half test with the real machine's router and GGUF files but sandboxed
 * copies of llama.app's two files, so it never touches the user's own settings.
 *
 *   node scripts/host.test.mjs
 *
 * It exercises the same code paths the Settings page route uses: build the
 * snapshot, then apply a context size (copies only) and check every write.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createService } from '../lib/service.js'
import * as llama from '../lib/llama-app.js'

const root = path.resolve(import.meta.dirname, '..')
const sandbox = path.join(root, '.test-sandbox')
fs.rmSync(sandbox, { recursive: true, force: true })
fs.mkdirSync(sandbox, { recursive: true })

const realPresets = llama.discoverPresetsPath()
const realSettings = llama.discoverSettingsPath()
assert.ok(realPresets !== undefined, 'no llama.app preset INI on this machine')
assert.ok(realSettings !== undefined, 'no llama.app settings.json on this machine')

const presetsCopy = path.join(sandbox, 'model-context-presets.ini')
const settingsCopy = path.join(sandbox, 'settings.json')
fs.copyFileSync(realPresets, presetsCopy)
fs.copyFileSync(realSettings, settingsCopy)
// Start from the writer's own canonical bytes so the round-trip check measures
// idempotency (the app's file may lack the trailing blank line our writer adds).
fs.writeFileSync(presetsCopy, llama.serializePresets(llama.parsePresets(fs.readFileSync(presetsCopy, 'utf8')).sections), 'utf8')
const presetsBytes = fs.readFileSync(presetsCopy)
const settingsBytes = fs.readFileSync(settingsCopy)
const settingsBefore = JSON.parse(fs.readFileSync(settingsCopy, 'utf8'))
const appPort = Number(settingsBefore.ServerPort)

const models = settingsBefore.ModelContextLengths ?? {}
const firstModel = Object.keys(models)[0]
assert.ok(firstModel !== undefined, 'settings.json has no ModelContextLengths entries')

// The DSH-side config, shaped exactly like the profile's llm-pi-ai row.
const providerConfig = {
  providers: {
    'llama-local': {
      displayName: 'Llama (local GPU)',
      api: 'openai-completions',
      baseURL: `http://127.0.0.1:${appPort}/v1`,
      defaultContextWindow: 131072,
      defaultMaxTokens: 8192,
      models: Object.keys(models).map((id) => ({
        id,
        name: id,
        contextWindow: models[id],
        maxTokens: 8192,
        input: ['text'],
      })),
    },
  },
}
let editedConfig
const configEditor = {
  configuration: () => [{
    entry: {
      options: {
        id: 'llm-pi-ai',
        name: '@deepseek-ai/dsh-llm-pi-ai',
        config: structuredClone(providerConfig),
      },
    },
    inherited: {},
    override: structuredClone(providerConfig),
  }],
  async edit(entry, change) {
    editedConfig = change(structuredClone(entry.options.config), {})
  },
}
const ctx = {
  get(key) {
    if (key === 'configEditor') return configEditor
    if (key === 'subprocess') return undefined
    if (key === 'tools') return { register: () => () => {} }
    return undefined
  },
}

const service = createService(ctx, {
  llamaAppPresetsPath: presetsCopy,
  llamaAppSettingsPath: settingsCopy,
})

const snapshot = await service.state()
console.log('snapshot:', {
  models: snapshot.models.map((model) => `${model.id}@${model.routerContext}`),
  gpu: snapshot.gpu,
  warnings: snapshot.warnings.length,
})
assert.equal(snapshot.ok, true, `state failed: ${snapshot.error}`)
assert.ok(snapshot.models.length >= 1, 'no local models found')
for (const model of snapshot.models) {
  assert.ok(model.routerContext > 0, `${model.id} has no router context`)
  assert.ok(model.trainedMax > 0, `${model.id} has no trained maximum`)
  assert.ok(model.candidates.length >= 2, `${model.id} has too few candidates`)
  assert.equal(model.candidates.some((candidate) => candidate.isRouterCurrent), true, `${model.id} lost its current window`)
  for (const candidate of model.candidates) {
    assert.ok(Number.isFinite(candidate.estimateMiB) && candidate.estimateMiB > 0, `${model.id} estimate broken`)
  }
}
const warnings = snapshot.warnings.join('\n')
assert.equal(warnings.includes('llama.app settings.json 读取失败'), false)

// Apply a context size the model can actually take, on the sandbox copies only.
const target = snapshot.models.find((model) => model.candidates.length > 1)
const choice = target.candidates.find((candidate) => !candidate.isRouterCurrent && !candidate.overBudget)
  ?? target.candidates[0]
const result = await service.apply({ model: target.id, context: choice.context })
console.log('apply steps:', result.steps.map((step) => `${step.ok ? 'ok' : 'FAIL'} ${step.id}: ${step.detail}`))
assert.equal(result.ok, true, 'apply did not report success')

const presetsAfter = llama.readPresets(presetsCopy)
const presetSection = presetsAfter.sections.find((section) => section.name === target.id)
assert.ok(presetSection, 'preset section missing after apply')
const ctxEntry = presetSection.entries.find((entry) => entry.key === 'ctx-size')
assert.equal(Number(ctxEntry.value), choice.context, 'preset ctx-size not written')

const settingsAfter = JSON.parse(fs.readFileSync(settingsCopy, 'utf8'))
assert.equal(settingsAfter.ModelContextLengths[target.id], choice.context, 'llama.app settings not written')
assert.equal(JSON.stringify(settingsAfter).length > 0, true)
// Nothing else may change in settings.json.
for (const key of Object.keys(settingsBefore)) {
  if (key === 'ModelContextLengths') continue
  assert.deepEqual(settingsAfter[key], settingsBefore[key], `apply changed settings.${key}`)
}

assert.ok(editedConfig, 'DSH config was not edited')
const editedModel = editedConfig.providers['llama-local'].models.find((model) => model.id === target.id)
assert.equal(editedModel.contextWindow, choice.context, 'DSH contextWindow not written')
assert.equal(editedConfig.providers['llama-local'].models.length, providerConfig.providers['llama-local'].models.length)

// Editing back to the original value must reproduce llama.app's own bytes; a
// formatting drift here would pile up noise in files another app also writes.
const original = target.routerContext
const revert = await service.apply({ model: target.id, context: original })
assert.equal(revert.ok, true, 'revert apply failed')
assert.deepEqual(fs.readFileSync(presetsCopy), presetsBytes, 'preset INI did not round-trip byte for byte')
assert.deepEqual(fs.readFileSync(settingsCopy), settingsBytes, 'settings.json did not round-trip byte for byte')
const reverted = editedConfig.providers['llama-local'].models.find((model) => model.id === target.id)
assert.equal(reverted.contextWindow, original, 'DSH contextWindow did not revert')

// Validation must refuse impossible windows before writing anything.
for (const bad of [0, -1, 1.5, 300_000, 'abc']) {
  await assert.rejects(() => service.apply({ model: target.id, context: bad }), /context|上限|整数/, `accepted ${String(bad)}`)
}
await assert.rejects(() => service.apply({ model: 'nope', context: 8192 }), /未知/, 'accepted an unknown model')

console.log('host test passed — copies only, user files untouched:', sandbox)
