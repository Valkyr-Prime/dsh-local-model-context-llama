/**
 * Context-preset candidates and a KV-cache / VRAM estimate derived from GGUF
 * metadata.
 *
 * The estimate is deliberately simple and honest: weights are the mapped tensor
 * bytes (the .gguf file size), the KV cache is linear in the context length and
 * follows the model's own head geometry and the server's cache types, and a fixed
 * allowance covers compute buffers. It is labelled "≈" everywhere it is shown.
 */

/** Context lengths offered per model; the trained maximum is appended when absent. */
export const CONTEXT_STEPS = [4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288]

/** Fixed allowance for compute buffers, CUDA context and graph scratch (MiB). */
const RUNTIME_OVERHEAD_MIB = 256
/** Extra allowance when a multimodal projector is loaded beside the model (MiB). */
const VISION_OVERHEAD_MIB = 128

/** Bytes per cached element for one llama.cpp KV cache type. */
export function cacheBytesPerElement(type) {
  switch (String(type ?? '').toLowerCase()) {
    case 'f32': return 4
    case 'f16':
    case 'bf16': return 2
    case 'q8_0': return 34 / 32
    case 'q5_1': return 24 / 32
    case 'q5_0': return 22 / 32
    case 'q4_1': return 20 / 32
    case 'q4_0':
    case 'iq4_nl': return 18 / 32
    default: return 2
  }
}

/**
 * How many transformer layers keep a KV cache. Hybrid models (recurrent / linear
 * attention layers) cache only the full-attention ones; plain stacks cache all.
 */
export function kvLayerCount(arch) {
  const layers = Number(arch.blockCount)
  if (!Number.isFinite(layers) || layers <= 0) return 0
  if (Array.isArray(arch.recurrentLayers)) {
    const recurrent = arch.recurrentLayers.filter((flag) => flag === true).length
    return Math.max(0, layers - recurrent)
  }
  const interval = Number(arch.fullAttentionInterval)
  if (Number.isFinite(interval) && interval > 1) return Math.ceil(layers / interval)
  return layers
}

/**
 * Bytes the KV cache needs per cached token.
 * @returns {{ kvLayers: number, bytesPerToken: number }}
 */
export function kvFootprint(arch, cacheTypeK, cacheTypeV) {
  const layers = kvLayerCount(arch)
  const heads = Number(arch.headCountKv) || Number(arch.headCount) || 0
  let keyDim = Number(arch.keyLength)
  let valueDim = Number(arch.valueLength)
  if (!Number.isFinite(keyDim) || keyDim <= 0) {
    const embd = Number(arch.embeddingLength)
    const headCount = Number(arch.headCount)
    keyDim = Number.isFinite(embd) && Number.isFinite(headCount) && headCount > 0 ? embd / headCount : 128
  }
  if (!Number.isFinite(valueDim) || valueDim <= 0) valueDim = keyDim
  const keyBytes = cacheBytesPerElement(cacheTypeK)
  const valueBytes = cacheBytesPerElement(cacheTypeV)
  const perToken = layers * (heads * keyDim * keyBytes + heads * valueDim * valueBytes)
  return { kvLayers: layers, bytesPerToken: perToken }
}

/** Human label for one context length: 4K, 32K, 256K, … */
export function contextLabel(context) {
  const value = Number(context)
  if (!Number.isFinite(value)) return '—'
  if (value >= 1024 && value % 1024 === 0) return `${Math.round(value / 1024)}K`
  return String(value)
}

/**
 * Candidate context sizes for one model: the standard ladder up to the trained
 * maximum, the trained maximum itself, and whatever the router currently uses
 * (a hand-picked value would otherwise vanish from the list).
 *
 * Sizes below `minContext` are dropped: a window that barely covers DSH's own
 * output reserve cannot be used for a conversation.
 */
export function buildCandidates({ trainedMax, routerContext, dshContext, minContext = 0 }) {
  const max = Number(trainedMax) > 0 ? Number(trainedMax) : undefined
  const floor = Number(minContext) > 0 ? Number(minContext) : 0
  const values = new Set()
  for (const step of CONTEXT_STEPS) {
    if ((max === undefined || step <= max) && step >= floor) values.add(step)
  }
  if (max !== undefined && max >= floor) values.add(max)
  for (const extra of [routerContext, dshContext]) {
    const value = Number(extra)
    if (!Number.isFinite(value) || value < 256) continue
    if (max === undefined || value <= max) values.add(value)
  }
  return [...values].sort((a, b) => a - b)
}

/**
 * Estimated resident VRAM for one context length, in MiB.
 * @param {object} input
 * @param {number} input.weightsBytes - mapped model bytes (the .gguf file size).
 * @param {number} [input.mmprojBytes] - vision projector bytes, when present.
 * @param {object} input.arch - {@link import('./gguf.js').architectureView} result.
 * @param {string} [input.cacheTypeK]
 * @param {string} [input.cacheTypeV]
 * @param {number} input.context
 */
export function estimateVramMiB(input) {
  const { weightsBytes, mmprojBytes = 0, arch, cacheTypeK, cacheTypeV, context } = input
  const { bytesPerToken } = kvFootprint(arch, cacheTypeK, cacheTypeV)
  const weights = Number(weightsBytes) || 0
  const projector = Number(mmprojBytes) || 0
  const kv = bytesPerToken * Number(context)
  const overhead = (RUNTIME_OVERHEAD_MIB + (projector > 0 ? VISION_OVERHEAD_MIB : 0)) * 1024 * 1024
  return (weights + projector + kv + overhead) / (1024 * 1024)
}

/** Format a byte count as GiB with one decimal. */
export function formatGiB(bytes) {
  const value = Number(bytes) / (1024 ** 3)
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} GiB`
}

/** Format MiB as GB with one decimal (display only, binary units). */
export function formatMiB(mib) {
  const value = Number(mib) / 1024
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)} GB`
}
