/**
 * Model-facing companion of the Settings page: the same read and apply
 * operations, exposed as one tool so an agent can report the current windows and
 * apply a width the user asked for.
 */
import { contextLabel } from './estimate.js'

const TOOL_NAME = 'local_model_context'

function joinWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return ''
  return `\nWarnings:\n${warnings.map((warning) => `- ${warning}`).join('\n')}`
}

function describeGpu(gpu) {
  if (gpu === null || gpu === undefined) return 'GPU memory: nvidia-smi unavailable'
  return `GPU: ${gpu.name} · ${gpu.totalMiB} MiB total · ${gpu.usedMiB} MiB used · ${gpu.freeMiB} MiB free`
}

/** Render the full snapshot as compact markdown text. */
export function formatState(snapshot) {
  const lines = []
  lines.push('Local models configured in DSH (llm-pi-ai providers on this machine)')
  lines.push(describeGpu(snapshot.gpu))
  if (snapshot.error !== undefined) lines.push(`DSH config error: ${snapshot.error}`)
  for (const model of snapshot.models ?? []) {
    const flags = [
      model.state,
      model.architecture,
      model.weightsText === undefined ? undefined : `weights ${model.weightsText}`,
      model.mmprojText === undefined ? undefined : `vision ${model.mmprojText}`,
      model.trainedMax === undefined ? undefined : `trained max ${model.trainedMax}`,
      `cache ${model.cacheTypeK}/${model.cacheTypeV}`,
    ].filter((flag) => flag !== undefined)
    lines.push('')
    lines.push(`### ${model.id} — provider ${model.provider} (${flags.join(' · ')})`)
    lines.push(`current: router ${contextLabel(model.routerContext)} · llama.app ${contextLabel(model.appContext)} · DSH ${contextLabel(model.dshContext)}`)
    if (model.routerError !== undefined) lines.push(`router: unavailable (${model.routerError})`)
    const options = (model.candidates ?? []).map((candidate) => {
      const marks = [candidate.isRouterCurrent ? 'router' : '', candidate.isDshDeclared ? 'dsh' : '']
        .filter((mark) => mark.length > 0)
        .join('+')
      return `${candidate.label} (≈${candidate.estimateText}${candidate.overBudget ? ', over budget' : ''}${marks.length > 0 ? `, ${marks}` : ''})`
    })
    lines.push(`supported context sizes: ${options.join(' · ') || '—'}`)
    if (model.ggufError !== undefined) lines.push(`GGUF metadata: ${model.ggufError}`)
  }
  lines.push('')
  lines.push('`≈` sizes are estimates: mapped weights + KV cache for that window + a fixed runtime allowance.')
  return lines.join('\n') + joinWarnings(snapshot.warnings)
}

/** Render one apply result and the state it produced. */
export function formatApply(result) {
  const lines = [`Applied context ${result.context} to ${result.model}: ${result.ok ? 'ok' : 'incomplete'}`]
  for (const step of result.steps ?? []) {
    lines.push(`- ${step.ok ? 'ok' : 'failed'} · ${step.id}: ${step.detail}`)
  }
  lines.push('')
  lines.push(formatState(result.state))
  return lines.join('\n')
}

/**
 * Build the registry-ready tool definition for `ctx.tools.register`.
 * @param {ReturnType<import('./service.js').createService>} service
 */
export function buildToolSpec(service) {
  return {
    name: TOOL_NAME,
    description: 'Read the local models DSH is configured against, each model\'s supported context '
      + 'sizes with their estimated VRAM cost and the window currently in effect on the local server '
      + '(llama.app router) and in DSH. With action "apply", set one model\'s context window: it '
      + 'rewrites llama.app\'s context presets, hot-reloads the router, unloads that model so the next '
      + 'request reloads it with the new window, and updates DSH\'s own contextWindow for the model. '
      + 'Use "list" first; only apply a size the user asked for.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'apply'],
          description: 'list: report models and windows. apply: change one model\'s context window.',
        },
        model: {
          type: 'string',
          description: 'Model id exactly as reported by list, e.g. Qwen3.5-9B. Required for apply.',
        },
        provider: {
          type: 'string',
          description: 'Provider id when several local providers define the same model id.',
        },
        context: {
          type: 'number',
          description: 'Target context window in tokens, one of the reported supported sizes. Required for apply.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      render: (args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    async execute(args) {
      const action = String(args?.action ?? '')
      if (action === 'list') {
        return { text: formatState(await service.state()) }
      }
      if (action === 'apply') {
        if (typeof args?.model !== 'string' || args.model.length === 0) {
          throw new Error('model is required for action "apply"')
        }
        if (!Number.isFinite(Number(args?.context))) {
          throw new Error('context is required for action "apply"')
        }
        const result = await service.apply({
          model: args.model,
          provider: typeof args.provider === 'string' ? args.provider : undefined,
          context: Number(args.context),
        })
        return { text: formatApply(result) }
      }
      throw new Error('action must be "list" or "apply"')
    },
  }
}
