/**
 * The external system this plugin talks to: the llama.app router that serves the
 * local models, plus the two files llama.app itself keeps its context settings in.
 *
 *   router            http://127.0.0.1:<port>/models   (load / unload / reload)
 *   settings.json     %LOCALAPPDATA%\Packages\HuggingFaceInc.LlamaApp_*\LocalCache\Local\Llama\settings.json
 *   presets INI       %USERPROFILE%\.llama\model-context-presets.ini
 *
 * The router reads the INI on `GET /models?reload=1` and spawns each model's child
 * process from it, so a context change is: rewrite the INI (and the app's own
 * settings so the choice survives a restart), reload, then unload the model so the
 * next request reloads it with the new window.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_TIMEOUT_MS = 6000

function timeout(ms = DEFAULT_TIMEOUT_MS) {
  return AbortSignal.timeout(ms)
}

/** Strip a router base URL (possibly `鈥?v1`) down to its origin. */
export function routerOrigin(baseURL) {
  try {
    const url = new URL(String(baseURL))
    return `${url.protocol}//${url.host}`
  } catch {
    return undefined
  }
}

/** True for a loopback endpoint, which is what "local model" means here. */
export function isLoopbackURL(baseURL) {
  try {
    const host = new URL(String(baseURL)).hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/** File size in bytes, or undefined when the file cannot be stat'ed. */
export function sizeOf(file) {
  try {
    const stat = fs.statSync(file)
    return stat.isFile() ? stat.size : undefined
  } catch {
    return undefined
  }
}

/**
 * Locate llama.app's settings.json. An explicit path wins; otherwise the packaged
 * app's per-user package directory is scanned for a Llama settings file.
 */
export function discoverSettingsPath(override) {
  const candidates = []
  if (typeof override === 'string' && override.length > 0) candidates.push(override)
  const packages = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Packages')
  try {
    for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/llama/i.test(entry.name)) continue
      candidates.push(path.join(packages, entry.name, 'LocalCache', 'Local', 'Llama', 'settings.json'))
    }
  } catch {
    // No packaged-app directory: the override (if any) is the only candidate.
  }
  const home = os.homedir()
  candidates.push(path.join(home, '.llama', 'settings.json'))
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/** Default preset INI path, plus a shallow scan of ~/.llama for a renamed one. */
export function discoverPresetsPath(override) {
  if (typeof override === 'string' && override.length > 0) return override
  const dir = path.join(os.homedir(), '.llama')
  const direct = path.join(dir, 'model-context-presets.ini')
  try {
    if (fs.existsSync(direct)) return direct
    const found = fs.readdirSync(dir).find((name) => /preset/i.test(name) && name.endsWith('.ini'))
    if (found !== undefined) return path.join(dir, found)
  } catch {
    // No ~/.llama directory: report the conventional path so the error names it.
  }
  return direct
}

/** Read and parse settings.json. */
export function readAppSettings(file) {
  const text = fs.readFileSync(file, 'utf8')
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} is not a JSON object`)
  }
  return value
}

/** Atomically write settings.json, letting the caller mutate the parsed object. */
export function updateAppSettings(file, mutate) {
  const text = fs.readFileSync(file, 'utf8')
  const settings = JSON.parse(text)
  const before = JSON.stringify(settings)
  const next = mutate(settings) ?? settings
  if (JSON.stringify(next) === before) return false
  // llama.app (a .NET app) writes CRLF, a two-space indent and no trailing
  // newline; keep its own formatting so an edit only changes the value.
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const indentMatch = /^([ \t]+)"/m.exec(text)
  const indent = indentMatch === null ? '  ' : indentMatch[1]
  let body = JSON.stringify(next, null, indent)
  if (eol !== '\n') body = body.replace(/\n/g, eol)
  if (/(\r?\n)$/.test(text) && !body.endsWith(eol)) body += eol
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, body, 'utf8')
  fs.renameSync(tmp, file)
  return true
}

/**
 * Parse the llama.app context preset INI, preserving section order and every
 * key the app may add later.
 * @returns {{ sections: Array<{ name: string, entries: Array<{ key: string, value: string }> }> }}
 */
export function parsePresets(text) {
  const sections = []
  let current
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header !== null) {
      current = { name: header[1].trim(), entries: [] }
      sections.push(current)
      continue
    }
    const assignment = /^([^=]+?)\s*=\s*(.*)$/.exec(line)
    if (assignment === null) continue
    if (current === undefined) {
      current = { name: '', entries: [] }
      sections.push(current)
    }
    current.entries.push({ key: assignment[1].trim(), value: assignment[2].trim() })
  }
  return { sections }
}

/** Serialize preset sections back to the INI dialect llama.app writes. */
export function serializePresets(sections) {
  const blocks = []
  for (const section of sections) {
    const lines = [`[${section.name}]`]
    for (const entry of section.entries) lines.push(`${entry.key} = ${entry.value}`)
    blocks.push(lines.join('\n'))
  }
  if (blocks.length === 0) return ''
  // llama.app writes LF lines and one blank line after the last section.
  return `${blocks.join('\n\n')}\n\n`
}

/** Read the INI; a missing file yields no sections. */
export function readPresets(file) {
  try {
    return parsePresets(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { sections: [], missing: true }
    throw error
  }
}

/**
 * Set `ctx-size` for one model section, adding the section when the app never
 * wrote one. Returns whether anything changed.
 */
export function setPresetContext(presets, model, context) {
  const value = String(context)
  let section = presets.sections.find((candidate) => candidate.name === model)
  if (section === undefined) {
    section = { name: model, entries: [] }
    presets.sections.push(section)
  }
  let entry = section.entries.find((candidate) => candidate.key.toLowerCase() === 'ctx-size')
  if (entry === undefined) {
    entry = { key: 'ctx-size', value }
    section.entries.push(entry)
    return true
  }
  if (entry.value === value) return false
  entry.value = value
  return true
}

/** What the router remembers about one model: paths, window and cache types. */
export function parsePresetText(presetText) {
  const text = String(presetText ?? '')
  const sections = parsePresets(text).sections
  const entries = sections[0]?.entries ?? []
  const get = (key) => entries.find((entry) => entry.key.toLowerCase() === key)?.value
  return {
    modelPath: get('model'),
    mmprojPath: get('mmproj'),
    ctxSize: Number(get('ctx-size')) || undefined,
    cacheTypeK: get('cache-type-k'),
    cacheTypeV: get('cache-type-v'),
  }
}

/** Map `--flag value` pairs out of a router child-process argv. */
export function parseRouterArgs(args) {
  const map = new Map()
  const list = Array.isArray(args) ? args : []
  const flags = new Set([
    '--ctx-size', '--cache-type-k', '--cache-type-v', '--model', '--mmproj', '--alias', '--port',
  ])
  for (let i = 0; i < list.length; i++) {
    if (flags.has(list[i]) && i + 1 < list.length) {
      map.set(list[i], list[i + 1])
      i++
    }
  }
  return map
}

/** GET /models 鈥?the router's model table. */
export async function fetchRouterModels(origin) {
  const response = await fetch(new URL('/models', origin), { signal: timeout() })
  if (!response.ok) throw new Error(`GET /models answered HTTP ${response.status}`)
  const payload = await response.json()
  const data = Array.isArray(payload?.data) ? payload.data : []
  return data
}

/** GET /models?reload=1 鈥?make the router re-read the preset INI. */
export async function reloadRouterPresets(origin) {
  const url = new URL('/models', origin)
  url.searchParams.set('reload', '1')
  const response = await fetch(url, { signal: timeout(15000) })
  if (!response.ok) throw new Error(`GET /models?reload=1 answered HTTP ${response.status}`)
  return true
}

/** POST /models/unload 鈥?drop a loaded model so the next request respawns it. */
export async function unloadRouterModel(origin, model) {
  const response = await fetch(new URL('/models/unload', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: timeout(20000),
  })
  if (response.ok) return true
  // "not loaded" is a 400 on this router build; treat it as already unloaded.
  if (response.status === 400 || response.status === 404) return false
  throw new Error(`POST /models/unload answered HTTP ${response.status}`)
}
