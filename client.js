/**
 * Client half of the Local model context bundle.
 *
 * Adds one Settings page ("本地模型" / "Local models"). The page reads a snapshot
 * from `GET /api/local-model-context/state` and writes a choice through
 * `POST /api/local-model-context/apply`; both routes are owned by this bundle's
 * Host half. Everything visible is localized through the Client locale service and
 * styled with `--dsw-alias-*` theme tokens (Harness Client packages are not
 * imported as modules — the controls are plain elements styled after the Model
 * settings rows).
 */
window.__ModuleLoader__.load({
  id: 'dsh-local-model-context-llama',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'local-model-context'
    /** Settings section id; the nav icon registration reuses it. */
    const SECTION_ID = 'local-models'
    /** Host routes provided by `index.js`. */
    const STATE_PATH = '/api/local-model-context/state'
    const APPLY_PATH = '/api/local-model-context/apply'

    const zh = {
      'nav': '本地模型',
      'title': '本地模型',
      'intro': '列出 DSH 正在使用的本机模型（llama.app 路由），显示每个模型支持的上下文大小、对应的显存估算，以及路由 / llama.app / DSH 三处当前生效的窗口。选中一档后点「应用」：插件会改写 llama.app 的上下文预设并热重载路由、卸载该模型（下次请求按新窗口重载），同时更新 DSH 模型表里的 contextWindow。',
      'refresh': '刷新',
      'loading': '读取中…',
      'retry': '重试',
      'empty': '没有找到指向本机的 provider。请在「设置 → 模型」里为本地推理服务添加一个 baseURL 为本机地址（如 http://127.0.0.1:9931/v1）的提供商。',
      'gpu.line': '显存：{name} · 共 {total} · 已用 {used} · 空闲 {free}',
      'gpu.budget': '建议预算 {budget}（预留 {reserve} 给桌面/其他程序）',
      'gpu.missing': '读不到 nvidia-smi，显存数字只显示估算值。',
      'state.loaded': '已加载',
      'state.sleeping': '休眠',
      'state.unloaded': '未加载',
      'state.unknown': '未知',
      'meta': '{arch} · 权重 {weights}{vision} · 训练上限 {max} · KV {kv}/token',
      'meta.vision': ' · 视觉投影 {size}',
      'meta.minimal': '{arch}',
      'current.router': '路由 {value}',
      'current.app': 'llama.app {value}',
      'current.dsh': 'DSH {value}',
      'current.na': '—',
      'drift': '三处不一致',
      'groups.label': '上下文大小',
      'option.estimate': '≈{size}',
      'option.over': '超预算',
      'option.current': '当前',
      'apply': '应用',
      'applying': '应用中…',
      'apply.hint': '当前选择无效：请选一个不超过训练上限、且大于输出预留的档位。',
      'apply.unchanged': '路由与 DSH 都已经是这个窗口，无需应用。',
      'apply.sameAsRouter': '路由已是该窗口；应用会同步 DSH 声明。',
      'apply.willUnload': '应用会卸载{loaded}，下次请求按新窗口重载。',
      'apply.done': '已应用 {value}',
      'apply.oknote': '全部步骤成功。',
      'apply.partialnote': '{count} 个步骤未成功，见下方明细。',
      'step.ok': '✓ {id}：{detail}',
      'step.failed': '✕ {id}：{detail}',
      'warn.title': '注意',
      'foot': '显存是估算值：已映射权重 + 该窗口的 KV cache + 固定运行开销（约 0.3 GB，含视觉投影再加 0.1 GB）。真实占用随驱动、批大小和上下文内容浮动。',
      'foot.app': 'llama.app 的应用内设置要重启一次才会显示新值；本插件直接改文件并热重载路由，所以立刻生效。若之后在 llama.app 里改任何设置，它可能用内存里的旧值覆盖回来，重新点一次「应用」即可。',
      'error.http': '请求失败：HTTP {status}',
      'error.network': '无法连接 Host：{message}',
    }

    const en = {
      'nav': 'Local models',
      'title': 'Local models',
      'intro': 'The local models DSH is configured against (the llama.app router), each model\'s supported context sizes with their estimated VRAM cost, and the window currently in effect on the router, in llama.app and in DSH. Pick a size and press Apply: the plugin rewrites llama.app\'s context presets, hot-reloads the router, unloads that model so the next request reloads it with the new window, and updates the contextWindow in DSH\'s model table.',
      'refresh': 'Refresh',
      'loading': 'Loading…',
      'retry': 'Retry',
      'empty': 'No provider points at this machine. Add one in Settings → Models with a local baseURL (for example http://127.0.0.1:9931/v1).',
      'gpu.line': 'GPU: {name} · {total} total · {used} used · {free} free',
      'gpu.budget': 'Suggested budget {budget} (reserving {reserve} for the desktop and other apps)',
      'gpu.missing': 'nvidia-smi is unavailable, so only the estimates are shown.',
      'state.loaded': 'loaded',
      'state.sleeping': 'sleeping',
      'state.unloaded': 'unloaded',
      'state.unknown': 'unknown',
      'meta': '{arch} · weights {weights}{vision} · trained max {max} · KV {kv}/token',
      'meta.vision': ' · vision {size}',
      'meta.minimal': '{arch}',
      'current.router': 'router {value}',
      'current.app': 'llama.app {value}',
      'current.dsh': 'DSH {value}',
      'current.na': '—',
      'drift': 'out of sync',
      'groups.label': 'Context size',
      'option.estimate': '≈{size}',
      'option.over': 'over budget',
      'option.current': 'current',
      'apply': 'Apply',
      'applying': 'Applying…',
      'apply.hint': 'This choice is invalid: pick a size at or below the trained maximum and above the output reserve.',
      'apply.unchanged': 'Router and DSH already use this window.',
      'apply.sameAsRouter': 'The router already uses this window; applying updates the DSH declaration.',
      'apply.willUnload': 'Applying unloads {loaded}; the next request reloads it with the new window.',
      'apply.done': 'Applied {value}',
      'apply.oknote': 'All steps succeeded.',
      'apply.partialnote': '{count} step(s) did not succeed — see the details below.',
      'step.ok': '✓ {id}: {detail}',
      'step.failed': '✕ {id}: {detail}',
      'warn.title': 'Notices',
      'foot': 'VRAM is an estimate: mapped weights + the KV cache for that window + a fixed runtime allowance (about 0.3 GB, plus 0.1 GB when a vision projector is loaded). Real usage varies with drivers, batch size and the content of the context.',
      'foot.app': 'llama.app shows the new value only after a restart: this plugin edits its files and hot-reloads the router, so the change is live immediately. If you later change anything inside llama.app it may write its in-memory values back — press Apply here once more.',
      'error.http': 'Request failed: HTTP {status}',
      'error.network': 'Cannot reach the Host: {message}',
    }

    const CSS = [
      '.lmc-page{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;',
      'max-width:760px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}',
      '.lmc-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;',
      'gap:12px 16px}',
      '.lmc-head-main{min-width:0;flex:1}',
      '.lmc-title{margin:0;font-size:16px;line-height:24px;font-weight:500}',
      '.lmc-intro{margin:6px 0 0;font-size:13px;line-height:20px;',
      'color:var(--dsw-alias-label-tertiary)}',
      '.lmc-actions{display:flex;align-items:center;gap:8px;flex:none}',
      '.lmc-btn{font:inherit;font-size:13px;line-height:20px;height:30px;padding:0 14px;',
      'border-radius:15px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;',
      'transition:background .15s,color .15s,border-color .15s}',
      '.lmc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);',
      'color:var(--dsw-alias-label-primary)}',
      '.lmc-btn:disabled{opacity:.45;cursor:default}',
      '.lmc-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));',
      'outline-offset:1px}',
      '.lmc-btn.is-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);',
      'color:var(--dsw-alias-label-inverse,var(--dsw-alias-bg-base));font-weight:500}',
      '.lmc-btn.is-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);',
      'filter:brightness(1.06);color:var(--dsw-alias-label-inverse,var(--dsw-alias-bg-base))}',
      '.lmc-gpu{display:flex;flex-wrap:wrap;gap:4px 16px;padding:10px 14px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);',
      'color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:20px}',
      '.lmc-alert{display:flex;gap:8px;padding:10px 14px;border-radius:10px;font-size:13px;',
      'line-height:20px;border:.5px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}',
      '.lmc-alert.is-warn{border-color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-border-l3))}',
      '.lmc-alert.is-error{border-color:var(--dsw-alias-state-error-primary);',
      'color:var(--dsw-alias-state-error-primary)}',
      '.lmc-alert-title{flex:none;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.lmc-alerts{display:flex;flex-direction:column;gap:8px}',
      '.lmc-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:12px;',
      'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.lmc-card-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:space-between}',
      '.lmc-card-title{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}',
      '.lmc-name{font-size:14px;line-height:22px;font-weight:500}',
      '.lmc-id{font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;',
      'color:var(--dsw-alias-label-tertiary)}',
      '.lmc-state{flex:none;font-size:12px;line-height:18px;padding:1px 8px;border-radius:9px;',
      'border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.lmc-state.is-loaded{border-color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary));',
      'color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}',
      '.lmc-meta{font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.lmc-current{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;line-height:18px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.lmc-current.is-drift{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}',
      '.lmc-drift{font-size:11.5px;line-height:16px;padding:0 6px;border-radius:8px;',
      'border:.5px solid currentColor}',
      '.lmc-options{display:flex;flex-wrap:wrap;gap:8px}',
      '.lmc-opt{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:74px;',
      'padding:6px 10px;border-radius:9px;border:.5px solid var(--dsw-alias-border-l2);',
      'background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;',
      'font:inherit;text-align:left;transition:border-color .15s,background .15s,color .15s}',
      '.lmc-opt:hover{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}',
      '.lmc-opt:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));',
      'outline-offset:1px}',
      '.lmc-opt[aria-checked="true"]{border-color:var(--dsw-alias-brand-primary);',
      'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.lmc-opt-ctx{font-size:13px;line-height:18px;font-weight:500}',
      '.lmc-opt-size{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.lmc-opt-marks{display:flex;gap:4px;font-size:10.5px;line-height:14px}',
      '.lmc-mark{color:var(--dsw-alias-brand-primary)}',
      '.lmc-opt.is-over .lmc-opt-size{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-tertiary))}',
      '.lmc-card-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;',
      'gap:8px 12px;padding-top:2px}',
      '.lmc-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:0}',
      '.lmc-result{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;',
      'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
      'font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}',
      '.lmc-result.is-ok{border-color:var(--dsw-alias-state-success-primary,var(--dsw-alias-border-l2))}',
      '.lmc-result.is-fail{border-color:var(--dsw-alias-state-error-primary);',
      'color:var(--dsw-alias-label-primary)}',
      '.lmc-step{white-space:pre-wrap;word-break:break-word}',
      '.lmc-foot{margin:0;padding:0;display:flex;flex-direction:column;gap:6px;',
      'font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.lmc-empty{padding:16px;text-align:center;color:var(--dsw-alias-label-tertiary)}',
    ].join('')

    /** Route a locale key through `t`, interpolating `{name}` placeholders. */
    function msg(t, key, vars) {
      const template = t(key)
      if (vars === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match))
    }

    /** Fetch one Host route as JSON (undefined when the body is not JSON). */
    async function request(path, init) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...init,
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (!response.ok) {
        const detail = payload?.error ?? ''
        const error = new Error(`HTTP ${response.status}${detail.length > 0 ? ` — ${detail}` : ''}`)
        error.status = response.status
        throw error
      }
      return payload
    }

    /** Context label matching the Host's `contextLabel` (4K, 32K, 256K). */
    function contextText(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      return number >= 1024 && number % 1024 === 0 ? `${Math.round(number / 1024)}K` : String(number)
    }

    function gpuSize(mib) {
      const value = Number(mib)
      if (!Number.isFinite(value)) return '—'
      return `${(value / 1024).toFixed(1)} GB`
    }

    function stateText(t, state) {
      const key = `state.${state}`
      const text = t(key)
      return typeof text === 'string' && text.length > 0 ? text : String(state)
    }

    /** A single model card with its context ladder. */
    function ModelCard(props) {
      const { t, model, selected, onSelect, onApply, busy, result } = props
      const candidates = Array.isArray(model.candidates) ? model.candidates : []
      const selection = selected ?? model.routerContext ?? model.dshContext ?? candidates[0]?.context
      const currentOption = candidates.find((candidate) => candidate.context === selection)
      const valid = currentOption !== undefined
        && (model.trainedMax === undefined || selection <= model.trainedMax)
        && (model.declaredMaxTokens === undefined || selection > model.declaredMaxTokens + 1024)
      const unchanged = model.routerContext === selection && model.dshContext === selection
      const drift = model.drift?.routerVsApp === true || model.drift?.routerVsDsh === true
      const loaded = model.state === 'loaded' || model.state === 'sleeping'

      const metaParts = []
      if (model.architecture !== undefined) metaParts.push(model.architecture)
      if (model.weightsText !== undefined) metaParts.push(model.weightsText)
      const vision = model.mmprojText === undefined ? '' : msg(t, 'meta.vision', { size: model.mmprojText })
      const maxText = model.trainedMax === undefined ? '—' : contextText(model.trainedMax)
      const kvText = Number.isFinite(model.kvPerTokenKiB) ? `${model.kvPerTokenKiB.toFixed(1)} KiB` : '—'
      const metaLine = model.architecture === undefined
        ? undefined
        : msg(t, 'meta', {
          arch: model.architecture,
          weights: model.weightsText ?? '—',
          vision,
          max: maxText,
          kv: kvText,
        })

      const hint = (() => {
        if (!valid) return t('apply.hint')
        if (unchanged) return t('apply.unchanged')
        if (model.routerContext === selection) return t('apply.sameAsRouter')
        if (loaded) return msg(t, 'apply.willUnload', { loaded: model.displayName })
        return ''
      })()

      return h('article', { className: 'lmc-card' },
        h('div', { className: 'lmc-card-head' },
          h('div', { className: 'lmc-card-title' },
            h('span', { className: 'lmc-name' }, model.displayName),
            h('code', { className: 'lmc-id' }, model.id)),
          h('span', { className: `lmc-state is-${model.state}` }, stateText(t, model.state))),
        metaLine === undefined ? null : h('div', { className: 'lmc-meta' }, metaLine),
        h('div', { className: `lmc-current${drift ? ' is-drift' : ''}` },
          h('span', null, msg(t, 'current.router', {
            value: model.routerContext === undefined ? t('current.na') : contextText(model.routerContext),
          })),
          h('span', null, msg(t, 'current.app', {
            value: model.appContext === undefined ? t('current.na') : contextText(model.appContext),
          })),
          h('span', null, msg(t, 'current.dsh', {
            value: model.dshContext === undefined ? t('current.na') : contextText(model.dshContext),
          })),
          drift ? h('span', { className: 'lmc-drift' }, t('drift')) : null),
        h('div', { className: 'lmc-options', role: 'radiogroup', 'aria-label': t('groups.label') },
          candidates.map((candidate) => h('button', {
            key: candidate.context,
            type: 'button',
            role: 'radio',
            'aria-checked': candidate.context === selection,
            className: `lmc-opt${candidate.overBudget ? ' is-over' : ''}`,
            disabled: busy,
            onClick: () => onSelect(candidate.context),
          },
          h('span', { className: 'lmc-opt-ctx' }, candidate.label),
          h('span', { className: 'lmc-opt-size' }, msg(t, 'option.estimate', { size: candidate.estimateText })),
          h('span', { className: 'lmc-opt-marks' },
            candidate.isRouterCurrent ? h('span', { className: 'lmc-mark' }, t('option.current')) : null,
            candidate.overBudget ? h('span', { className: 'lmc-mark' }, t('option.over')) : null)))),
        h('div', { className: 'lmc-card-foot' },
          h('span', { className: 'lmc-hint' }, hint),
          h('button', {
            type: 'button',
            className: 'lmc-btn is-primary',
            disabled: busy || !valid || unchanged,
            onClick: () => onApply(selection),
          }, busy ? t('applying') : t('apply'))),
        result === undefined ? null : h('div', {
          className: `lmc-result${result.ok ? ' is-ok' : ' is-fail'}`,
          role: 'status',
        },
        h('div', null, msg(t, 'apply.done', { value: contextText(result.context) })),
        h('div', null, result.ok
          ? t('apply.oknote')
          : msg(t, 'apply.partialnote', { count: (result.steps ?? []).filter((step) => !step.ok).length })),
        (result.steps ?? []).map((step) => h('div', {
          key: step.id,
          className: 'lmc-step',
        }, msg(t, step.ok ? 'step.ok' : 'step.failed', { id: step.id, detail: step.detail }))),
        (result.warnings ?? []).map((warning) => h('div', { key: warning, className: 'lmc-step' }, `⚠ ${warning}`))))
    }

    /** The Settings page. */
    function LocalModelsPage(props) {
      const t = props.t
      // `t` is re-created on locale changes; the readers below stay stable and
      // read the current translate through this ref (no refetch loop).
      const tRef = React.useRef(t)
      tRef.current = t
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [selected, setSelected] = React.useState({})
      const [busyModel, setBusyModel] = React.useState(undefined)
      const [results, setResults] = React.useState({})
      const alive = React.useRef(true)

      React.useEffect(() => () => { alive.current = false }, [])

      const load = React.useCallback(async () => {
        const translate = tRef.current
        setLoading(true)
        try {
          const next = await request(STATE_PATH)
          if (!alive.current) return
          if (next?.ok === false && typeof next.error === 'string') setError(next.error)
          else setError('')
          setSnapshot(next)
        } catch (caught) {
          if (!alive.current) return
          const message = caught?.status === undefined
            ? msg(translate, 'error.network', { message: caught?.message ?? '' })
            : msg(translate, 'error.http', { status: caught.status })
          setError(message)
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [])

      React.useEffect(() => { void load() }, [load])

      const models = snapshot?.models ?? []

      const apply = React.useCallback(async (model, context) => {
        const translate = tRef.current
        setBusyModel(model.id)
        try {
          const result = await request(APPLY_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: model.id, provider: model.provider, context }),
          })
          if (!alive.current) return
          setResults((previous) => ({ ...previous, [model.id]: result }))
          if (result?.state !== undefined) setSnapshot(result.state)
        } catch (caught) {
          if (!alive.current) return
          const message = caught?.status === undefined
            ? msg(translate, 'error.network', { message: caught?.message ?? '' })
            : msg(translate, 'error.http', { status: caught.status })
          setResults((previous) => ({
            ...previous,
            [model.id]: { ok: false, context, steps: [], warnings: [message] },
          }))
        } finally {
          if (alive.current) setBusyModel(undefined)
        }
      }, [])

      const warnings = snapshot?.warnings ?? []
      const gpu = snapshot?.gpu

      return h('div', { className: 'lmc-page' },
        h('style', null, CSS),
        h('div', { className: 'lmc-head' },
          h('div', { className: 'lmc-head-main' },
            h('h2', { className: 'lmc-title' }, t('title')),
            h('p', { className: 'lmc-intro' }, t('intro'))),
          h('div', { className: 'lmc-actions' },
            h('button', {
              type: 'button',
              className: 'lmc-btn',
              disabled: loading,
              onClick: () => { void load() },
            }, loading ? t('loading') : t('refresh')))),
        gpu === null || gpu === undefined
          ? h('div', { className: 'lmc-gpu' }, t('gpu.missing'))
          : h('div', { className: 'lmc-gpu' },
            h('span', null, msg(t, 'gpu.line', {
              name: gpu.name,
              total: gpuSize(gpu.totalMiB),
              used: gpuSize(gpu.usedMiB),
              free: gpuSize(gpu.freeMiB),
            })),
            snapshot?.budgetMiB === null || snapshot?.budgetMiB === undefined
              ? null
              : h('span', null, msg(t, 'gpu.budget', {
                budget: gpuSize(snapshot.budgetMiB),
                reserve: gpuSize(snapshot.reserveMiB),
              }))),
        error.length > 0
          ? h('div', { className: 'lmc-alert is-error', role: 'alert' },
            h('span', { className: 'lmc-alert-title' }, t('warn.title')),
            h('span', null, error),
            h('button', { type: 'button', className: 'lmc-btn', onClick: () => { void load() } }, t('retry')))
          : null,
        warnings.length > 0
          ? h('div', { className: 'lmc-alerts' }, warnings.map((warning) => h('div', {
            key: warning,
            className: 'lmc-alert is-warn',
          }, h('span', { className: 'lmc-alert-title' }, t('warn.title')), h('span', null, warning))))
          : null,
        models.length === 0
          ? h('div', { className: 'lmc-empty' }, loading ? t('loading') : t('empty'))
          : models.map((model) => h(ModelCard, {
            key: `${model.provider}/${model.id}`,
            t,
            model,
            selected: selected[model.id],
            busy: busyModel === model.id,
            result: results[model.id],
            onSelect: (context) => setSelected((previous) => ({ ...previous, [model.id]: context })),
            onApply: (context) => { void apply(model, context) },
          })),
        h('footer', { className: 'lmc-foot' },
          h('span', null, t('foot')),
          h('span', null, t('foot.app'))))
    }

    /** Navigation glyph for the section (the shell renders the row and label). */
    function LocalModelsIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block' },
      },
      h('rect', { x: 3.75, y: 4.75, width: 16.5, height: 6.5, rx: 2 }),
      h('rect', { x: 3.75, y: 13.75, width: 16.5, height: 5.5, rx: 2 }),
      h('path', { d: 'M7 8h.01M7 16.5h.01M10.5 8h6M10.5 16.5h6' }))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-model-context: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: 12,
        label: () => t('nav'),
        locale: NS,
      }, LocalModelsPage)), 'local-model-context: settings page')
      ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: SECTION_ID,
      }, LocalModelsIcon)), 'local-model-context: settings icon')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
