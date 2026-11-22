/**
 * Standalone smoke test for the pure Host modules (no DSH context involved).
 *
 *   node scripts/smoke.mjs [routerBaseURL]
 *
 * It reads the real GGUF headers, llama.app files and router table on this machine
 * and prints the numbers the Settings page will show, so the estimator can be
 * checked against a known-good load before the bundle is installed.
 */
import { architectureView, readGgufMeta } from '../lib/gguf.js'
import {
  buildCandidates, contextLabel, estimateVramMiB, formatGiB, formatMiB, kvFootprint,
} from '../lib/estimate.js'
import { parseGpuLine } from '../lib/gpu.js'
import * as llama from '../lib/llama-app.js'
import fs from 'node:fs'

const origin = process.argv[2] ?? 'http://127.0.0.1:9931'

const settingsPath = llama.discoverSettingsPath()
const presetsPath = llama.discoverPresetsPath()
console.log('settings.json :', settingsPath)
console.log('presets INI   :', presetsPath)
let settings
try {
  settings = llama.readAppSettings(settingsPath)
  console.log('app contexts  :', JSON.stringify(settings.ModelContextLengths))
  console.log('app caches    :', settings.CacheTypeK, settings.CacheTypeV, 'port', settings.ServerPort)
} catch (error) {
  console.log('settings read failed:', error.message)
}

console.log('')
const rows = await llama.fetchRouterModels(origin)
console.log(`router ${origin}: ${rows.length} model(s)`)
// The agent shell is sandboxed against piped child stdio, so read a captured
// `nvidia-smi` line instead: LMC_GPU_CSV names a file holding the CSV output.
let gpu
if (process.env.LMC_GPU_CSV !== undefined) {
  gpu = parseGpuLine(fs.readFileSync(process.env.LMC_GPU_CSV, 'utf8'))
}
const budget = gpu === undefined ? undefined : gpu.totalMiB - 1536
console.log('gpu           :', gpu, 'budget MiB', budget)

// The rewrite must be lossless for the file llama.app wrote.
{
  const text = fs.existsSync(presetsPath) ? fs.readFileSync(presetsPath, 'utf8') : ''
  const roundTrip = llama.serializePresets(llama.parsePresets(text).sections)
  console.log('INI round-trip:', roundTrip === text ? 'identical' : `DIFFERS\n--- original ---\n${text}\n--- rewrite ---\n${roundTrip}`)
}

for (const row of rows) {
  const preset = llama.parsePresetText(row.preset)
  const args = llama.parseRouterArgs(row.status?.args)
  const modelPath = preset.modelPath ?? args.get('--model')
  const mmprojPath = preset.mmprojPath ?? args.get('--mmproj')
  const weightsBytes = modelPath === undefined ? undefined : llama.sizeOf(modelPath)
  const mmprojBytes = mmprojPath === undefined ? undefined : llama.sizeOf(mmprojPath)
  let arch = {}
  try {
    arch = architectureView(readGgufMeta(modelPath).kv)
  } catch (error) {
    console.log(`  ${row.id}: GGUF read failed: ${error.message}`)
  }
  const { kvLayers, bytesPerToken } = kvFootprint(arch, args.get('--cache-type-k'), args.get('--cache-type-v'))
  const trainedMax = arch.contextTrain ?? row.context_length
  const routerContext = Number(args.get('--ctx-size')) || preset.ctxSize
  console.log('')
  console.log(`${row.id} [${row.status?.value}]`)
  console.log(`  arch=${arch.arch} layers=${arch.blockCount} kvLayers=${kvLayers} ctxTrain=${trainedMax}`)
  console.log(`  weights=${formatGiB(weightsBytes)} mmproj=${mmprojPath === undefined ? '—' : formatGiB(mmprojBytes)}`)
  console.log(`  router ctx=${routerContext} caches=${args.get('--cache-type-k')}/${args.get('--cache-type-v')}`)
  console.log(`  kv/token=${(bytesPerToken / 1024).toFixed(1)} KiB`)
  const candidates = buildCandidates({ trainedMax, routerContext, dshContext: settings?.ModelContextLengths?.[row.id] })
  console.log(`  candidates: ${candidates.map((value) => {
    const estimate = Math.round(estimateVramMiB({
      weightsBytes,
      mmprojBytes,
      arch,
      cacheTypeK: args.get('--cache-type-k'),
      cacheTypeV: args.get('--cache-type-v'),
      context: value,
    }))
    return `${contextLabel(value)}=${formatMiB(estimate)}`
  }).join(' ')}`)
}
