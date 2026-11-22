/**
 * The read/plan/apply core shared by the Settings page route and the agent tool.
 *
 * `state()` answers "which local models does DSH use, what context sizes do they
 * support, what does each one cost in VRAM, and is llama.app / DSH in sync?".
 * `apply()` changes one model's context size on both sides of the wire.
 */
import fs from 'node:fs'

import { architectureView, readGgufMeta } from './gguf.js'
import {
  buildCandidates, contextLabel, estimateVramMiB, formatGiB, formatMiB, kvFootprint,
} from './estimate.js'
import { readGpu } from './gpu.js'
import * as llama from './llama-app.js'

const DSH_LLM_ROW = '@deepseek-ai/dsh-llm-pi-ai'
const DEFAULT_RESERVE_MIB = 1536

function option(config, key, fallback) {
  const value = config?.[key]
  return value === undefined || value === null ? fallback : value
}

/** Normalize the plugin's raw config into the few knobs this service honours. */
export function normalizeOptions(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  return {
    settingsPath: typeof raw.llamaAppSettingsPath === 'string' ? raw.llamaAppSettingsPath : undefined,
    presetsPath: typeof raw.llamaAppPresetsPath === 'string' ? raw.llamaAppPresetsPath : undefined,
    reserveMiB: Number.isFinite(Number(raw.gpuReserveMiB)) ? Number(raw.gpuReserveMiB) : DEFAULT_RESERVE_MIB,
  }
}

/** Read one Host service without trusting it to exist. */
function serviceOf(ctx, key) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(key) : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] - the plugin row's raw config.
 */
export function createService(ctx, config) {
  const options = normalizeOptions(config)

  /** The llm-pi-ai row: its Loader entry (for edits) and its effective config. */
  function llmRow() {
    const editor = serviceOf(ctx, 'configEditor')
    if (editor === undefined) {
      throw new Error('configEditor 服务不可用：当前 profile 无法读写模型配置')
    }
    const rows = editor.configuration()
    const row = rows.find((candidate) => candidate.entry?.options?.name === DSH_LLM_ROW)
    if (row === undefined) throw new Error(`profile 中没有 ${DSH_LLM_ROW} 这一行`)
    const current = row.entry?.options?.config
    const raw = current !== null && typeof current === 'object' && current.providers !== undefined
      ? current
      : (Object.keys(row.override ?? {}).length > 0 ? { ...row.inherited, ...row.override } : row.inherited)
    const providers = raw?.providers
    if (providers === null || typeof providers !== 'object') {
      throw new Error('llm-pi-ai 配置里没有 providers')
    }
    return { editor, entry: row.entry, providers }
  }

  /** Configured providers whose endpoint is on this machine. */
  function localProviders() {
    const { providers } = llmRow()
    return Object.entries(providers)
      .filter(([, profile]) => profile !== null && typeof profile === 'object' && llama.isLoopbackURL(profile.baseURL))
      .map(([id, profile]) => ({
        id,
        displayName: typeof profile.displayName === 'string' && profile.displayName.length > 0
          ? profile.displayName
          : id,
        baseURL: profile.baseURL,
        origin: llama.routerOrigin(profile.baseURL),
        models: Array.isArray(profile.models) ? profile.models : [],
      }))
  }

  function appFiles() {
    const settingsPath = llama.discoverSettingsPath(options.settingsPath)
    const presetsPath = llama.discoverPresetsPath(options.presetsPath)
    let settings
    let settingsError
    if (settingsPath !== undefined) {
      try {
        settings = llama.readAppSettings(settingsPath)
      } catch (error) {
        settingsError = error.message
      }
    }
    const presets = llama.readPresets(presetsPath)
    return { settingsPath, presetsPath, settings, settingsError, presets }
  }

  /** Build one model row from the DSH config, the router table and the GGUF header. */
  function buildModel(input) {
    const {
      providerId, providerName, origin, configured, routerRow, routerError, app, budgetMiB,
    } = input
    const id = String(configured.id)
    const preset = llama.parsePresetText(routerRow?.preset)
    const args = llama.parseRouterArgs(routerRow?.status?.args)
    const modelPath = preset.modelPath ?? args.get('--model')
    const mmprojPath = preset.mmprojPath ?? args.get('--mmproj')
    const weightsBytes = modelPath === undefined ? undefined : llama.sizeOf(modelPath)
    const mmprojBytes = mmprojPath === undefined ? undefined : llama.sizeOf(mmprojPath)

    let arch = { arch: undefined }
    let ggufError
    if (modelPath !== undefined) {
      try {
        arch = architectureView(readGgufMeta(modelPath).kv)
      } catch (error) {
        ggufError = error.message
      }
    }

    const trainedMax = Number(arch.contextTrain) > 0 ? Number(arch.contextTrain) : Number(routerRow?.context_length)
    const routerContext = Number(args.get('--ctx-size')) || preset.ctxSize
    const dshContext = Number(configured.contextWindow)
    const appContext = Number(app.settings?.ModelContextLengths?.[id]) || undefined
    const cacheTypeK = args.get('--cache-type-k') ?? preset.cacheTypeK ?? app.settings?.CacheTypeK ?? 'f16'
    const cacheTypeV = args.get('--cache-type-v') ?? preset.cacheTypeV ?? app.settings?.CacheTypeV ?? 'f16'
    const { kvLayers, bytesPerToken } = kvFootprint(arch, cacheTypeK, cacheTypeV)

    const candidates = buildCandidates({
      trainedMax,
      routerContext,
      dshContext,
      minContext: Number(configured.maxTokens) > 0 ? Number(configured.maxTokens) + 2048 : 0,
    }).map((value) => {
      const estimate = Math.round(estimateVramMiB({
        weightsBytes, mmprojBytes, arch, cacheTypeK, cacheTypeV, context: value,
      }))
      return {
        context: value,
        label: contextLabel(value),
        estimateMiB: estimate,
        estimateText: formatMiB(estimate),
        overBudget: budgetMiB === undefined ? false : estimate > budgetMiB,
        isRouterCurrent: routerContext !== undefined && Number(routerContext) === value,
        isDshDeclared: Number(dshContext) === value,
      }
    })

    const settingsPort = Number(app.settings?.ServerPort)
    const originPort = origin === undefined ? undefined : Number(new URL(origin).port)

    return {
      provider: providerId,
      providerName,
      id,
      origin: origin ?? null,
      displayName: typeof configured.name === 'string' && configured.name.length > 0 ? configured.name : id,
      declaredMaxTokens: Number(configured.maxTokens) || undefined,
      input: Array.isArray(configured.input) ? configured.input : ['text'],
      state: routerRow?.status?.value ?? 'unknown',
      routerError,
      trainedMax: Number.isFinite(trainedMax) ? trainedMax : undefined,
      routerContext,
      dshContext: Number.isFinite(dshContext) ? dshContext : undefined,
      appContext,
      architecture: arch.arch,
      kvLayers,
      kvPerTokenKiB: bytesPerToken / 1024,
      weightsBytes,
      weightsText: weightsBytes === undefined ? undefined : formatGiB(weightsBytes),
      mmprojBytes,
      mmprojText: mmprojBytes === undefined || mmprojBytes === 0 ? undefined : formatGiB(mmprojBytes),
      cacheTypeK,
      cacheTypeV,
      modelPath,
      mmprojPath,
      ggufError,
      candidates,
      capabilities: {
        presetsPath: app.presetsPath,
        presetsFound: app.presets.missing !== true,
        settingsFound: app.settings !== undefined,
        settingsPath: app.settingsPath,
        portMatches: Number.isFinite(settingsPort) && Number.isFinite(originPort) && settingsPort === originPort,
      },
      drift: {
        routerVsApp: routerContext !== undefined && appContext !== undefined ? Number(routerContext) !== Number(appContext) : undefined,
        routerVsDsh: routerContext !== undefined && Number.isFinite(dshContext) ? Number(routerContext) !== dshContext : undefined,
      },
    }
  }

  /** Assemble the full snapshot the page and the tool render. */
  async function state() {
    const warnings = []
    const at = new Date().toISOString()
    let providers = []
    let dshError
    try {
      providers = localProviders()
    } catch (error) {
      dshError = error.message
    }
    if (providers.length === 0 && dshError === undefined) {
      warnings.push('DSH 的 llm-pi-ai 里没有指向本机的 provider，因此没有可展示的本地模型。')
    }
    const gpu = await readGpu({ subprocess: serviceOf(ctx, 'subprocess') })
    const app = appFiles()
    if (app.settingsPath === undefined) {
      warnings.push('没有找到 llama.app 的 settings.json；插件不会改它的上下文设置（只改 preset INI）。')
    } else if (app.settingsError !== undefined) {
      warnings.push(`llama.app settings.json 读取失败：${app.settingsError}`)
    }
    if (app.presets.missing === true) {
      warnings.push(`没有找到 llama.app 的上下文 preset 文件：${app.presetsPath}`)
    }
    const budgetMiB = gpu === undefined ? undefined : Math.max(0, Number(gpu.totalMiB) - options.reserveMiB)

    const models = []
    if (dshError === undefined) {
      for (const provider of providers) {
        let routerRows = []
        let routerError
        if (provider.origin === undefined) {
          routerError = `baseURL 无法解析：${String(provider.baseURL)}`
        } else {
          try {
            routerRows = await llama.fetchRouterModels(provider.origin)
          } catch (error) {
            routerError = error.message
          }
        }
        for (const configured of provider.models) {
          const id = String(configured.id)
          const routerRow = routerRows.find((row) => row?.id === id) ?? routerRows.find((row) => row?.aliases?.includes?.(id))
          models.push(buildModel({
            providerId: provider.id,
            providerName: provider.displayName,
            origin: provider.origin,
            configured,
            routerRow,
            routerError,
            app,
            budgetMiB,
          }))
        }
      }
    }

    for (const model of models) {
      if (model.drift.routerVsApp === true) {
        warnings.push(`${model.id}：llama.app 设置 ${contextLabel(model.appContext)} 与路由生效 ${contextLabel(model.routerContext)} 不一致；重启 llama.app 可让它的界面同步。`)
      }
      if (model.drift.routerVsDsh === true) {
        warnings.push(`${model.id}：DSH 声明 ${contextLabel(model.dshContext)} 与路由生效 ${contextLabel(model.routerContext)} 不一致。`)
      }
    }

    const reachable = models.some((model) => model.routerError === undefined && model.state !== 'unknown')
    return {
      ok: dshError === undefined,
      at,
      error: dshError,
      gpu: gpu ?? null,
      budgetMiB: budgetMiB ?? null,
      reserveMiB: options.reserveMiB,
      app: {
        settingsPath: app.settingsPath ?? null,
        presetsPath: app.presetsPath ?? null,
        settingsFound: app.settings !== undefined,
        presetsFound: app.presets.missing !== true,
        cacheTypeK: app.settings?.CacheTypeK ?? null,
        cacheTypeV: app.settings?.CacheTypeV ?? null,
        serverPort: Number(app.settings?.ServerPort) || null,
      },
      providerCount: providers.length,
      models,
      warnings,
      reachable,
    }
  }

  /** Locate one model row in a snapshot. */
  function findModel(snapshot, modelId, providerId) {
    const match = snapshot.models.find((candidate) => candidate.id === modelId
      && (providerId === undefined || candidate.provider === providerId))
    if (match === undefined) throw new Error(`未知的本地模型：${modelId}`)
    return match
  }

  /** Validate the requested window against what the model and DSH can actually use. */
  function validate(model, context) {
    if (!Number.isInteger(context)) throw new Error('context 必须是整数')
    if (context < 2048) throw new Error('context 至少要 2048')
    if (context % 256 !== 0) throw new Error('context 必须是 256 的整数倍')
    if (model.trainedMax !== undefined && context > model.trainedMax) {
      throw new Error(`${model.id} 的训练上限是 ${model.trainedMax}，不能设成 ${context}`)
    }
    const maxTokens = model.declaredMaxTokens
    if (maxTokens !== undefined && context <= maxTokens + 1024) {
      throw new Error(`${model.id} 还需要为输出保留 ${maxTokens} token，窗口不能小于 ${maxTokens + 2048}`)
    }
  }

  /** Push the new window into DSH's own model table. */
  async function writeDshContext(providerId, modelId, context) {
    const { editor, entry } = llmRow()
    await editor.edit(entry, (current, inherited) => {
      const base = current !== null && typeof current === 'object' && current.providers !== undefined
        ? current
        : { ...(inherited ?? {}), ...(current ?? {}) }
      const next = structuredClone(base)
      const profile = next.providers?.[providerId]
      if (profile === null || typeof profile !== 'object') {
        throw new Error(`DSH 配置里找不到 provider ${providerId}`)
      }
      const list = Array.isArray(profile.models) ? profile.models : []
      const index = list.findIndex((candidate) => String(candidate?.id) === modelId)
      if (index < 0) throw new Error(`provider ${providerId} 里找不到模型 ${modelId}`)
      list[index] = { ...list[index], contextWindow: context }
      return next
    })
    return true
  }

  /**
   * Apply one context size to llama.app and to DSH.
   * @param {{ model: string, provider?: string, context: number }} input
   * @returns the steps taken plus a fresh snapshot.
   */
  async function apply(input) {
    const snapshot = await state()
    const model = findModel(snapshot, String(input?.model ?? ''), input?.provider)
    const context = Number(input?.context)
    validate(model, context)

    const steps = []
    const warnings = []
    const finish = async (ok) => ({ ok, model: model.id, context, steps, warnings, state: await state() })

    // 1. llama.app preset INI — the only channel the router honours for ctx-size.
    if (model.capabilities.presetsFound !== true) {
      steps.push({
        id: 'presets',
        ok: false,
        detail: `找不到 llama.app 的 preset 文件（${model.capabilities.presetsPath}），无法切换上下文`,
      })
      return finish(false)
    }
    try {
      const presets = llama.readPresets(model.capabilities.presetsPath)
      const changed = llama.setPresetContext(presets, model.id, context)
      if (changed) {
        fs.writeFileSync(model.capabilities.presetsPath, llama.serializePresets(presets.sections), 'utf8')
        steps.push({ id: 'presets', ok: true, detail: `已写入 ${model.capabilities.presetsPath}` })
      } else {
        steps.push({ id: 'presets', ok: true, detail: 'preset 里已经是这个值' })
      }
    } catch (error) {
      steps.push({ id: 'presets', ok: false, detail: `写入 preset 失败：${error.message}` })
      return finish(false)
    }

    // 2. llama.app's own settings, so the choice survives an app restart.
    if (model.capabilities.settingsFound === true && model.capabilities.portMatches === true) {
      try {
        const changed = llama.updateAppSettings(model.capabilities.settingsPath, (settings) => {
          const lengths = settings.ModelContextLengths !== null && typeof settings.ModelContextLengths === 'object'
            ? settings.ModelContextLengths
            : {}
          lengths[model.id] = context
          settings.ModelContextLengths = lengths
          return settings
        })
        steps.push({
          id: 'settings',
          ok: true,
          detail: changed ? '已写入 llama.app settings.json' : 'settings.json 里已经是这个值',
        })
      } catch (error) {
        warnings.push(`llama.app settings.json 写入失败（下次重启 app 可能回退）：${error.message}`)
        steps.push({ id: 'settings', ok: false, detail: `settings.json 写入失败：${error.message}` })
      }
    } else {
      steps.push({
        id: 'settings',
        ok: true,
        detail: '跳过 llama.app settings.json（未启用或端口不匹配）',
      })
    }

    // 3. Reload the router's presets, then drop the loaded model so it respawns.
    const origin = model.origin ?? undefined
    if (origin === undefined) {
      steps.push({ id: 'reload', ok: false, detail: '无法确定 router 地址' })
      return finish(false)
    }
    try {
      await llama.reloadRouterPresets(origin)
      steps.push({ id: 'reload', ok: true, detail: 'router 已重读 preset' })
    } catch (error) {
      steps.push({ id: 'reload', ok: false, detail: `router 重读失败：${error.message}` })
      return finish(false)
    }
    try {
      const unloaded = await llama.unloadRouterModel(origin, model.id)
      steps.push({
        id: 'unload',
        ok: true,
        detail: unloaded ? '模型已卸载，下次请求按新窗口重载' : '模型当前没有加载，无需卸载',
      })
    } catch (error) {
      warnings.push(`卸载模型失败，旧窗口会一直生效到下次重载：${error.message}`)
      steps.push({ id: 'unload', ok: false, detail: `卸载失败：${error.message}` })
    }

    // 4. DSH's declaration last: the router is already live, so a failure here
    //    leaves DSH conservative (smaller window than the server really has).
    try {
      await writeDshContext(model.provider, model.id, context)
      steps.push({ id: 'dsh', ok: true, detail: 'DSH 模型表已更新 contextWindow' })
    } catch (error) {
      steps.push({ id: 'dsh', ok: false, detail: `DSH 模型表更新失败：${error.message}` })
      warnings.push('DSH 侧没有更新成功：DSH 仍按旧窗口裁剪/压缩。')
    }

    const dshStep = steps.find((step) => step.id === 'dsh')
    const essential = steps.filter((step) => step.id === 'presets' || step.id === 'reload')
    const ok = essential.every((step) => step.ok) && dshStep?.ok === true
    return finish(ok)
  }

  return { state, apply, options }
}
