/**
 * GPU memory probe.
 *
 * The Host half prefers DSH's own `subprocess` service (the sanctioned seam for
 * spawning anything); a plain `child_process.execFile` covers profiles where that
 * service is absent. Either way a missing driver or `nvidia-smi` degrades to
 * `undefined` — the page then hides the map/budget lines instead of failing.
 */
import os from 'node:os'

const QUERY = ['--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits']

/** Parse one `nvidia-smi --format=csv,noheader,nounits` line. */
export function parseGpuLine(line) {
  const first = String(line ?? '').trim().split(/\r?\n/)[0]
  if (first === undefined || first.length === 0) return undefined
  const [name, total, used, free] = first.split(',').map((part) => part.trim())
  const totalMiB = Number(total)
  const usedMiB = Number(used)
  const freeMiB = Number(free)
  if (!Number.isFinite(totalMiB)) return undefined
  return { name, totalMiB, usedMiB, freeMiB }
}

async function viaSubprocess(subprocess) {
  const handle = subprocess.spawn({
    argv: ['nvidia-smi', ...QUERY],
    cwd: os.tmpdir(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64 * 1024 },
      stderr: { maxBytes: 8 * 1024 },
    },
    graceMs: 5000,
    signal: AbortSignal.timeout(8000),
  })
  await handle.done
  const text = handle.collected?.stdout?.readFrom(0)?.text ?? ''
  return parseGpuLine(text)
}

async function viaExecFile() {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const { stdout } = await run('nvidia-smi', QUERY, {
    timeout: 6000,
    windowsHide: true,
    maxBuffer: 64 * 1024,
  })
  return parseGpuLine(stdout)
}

/**
 * Read the first GPU's memory figures.
 * @param {{ subprocess?: object }} [seams] - DSH's subprocess service, when present.
 * @returns {Promise<{name: string, totalMiB: number, usedMiB: number, freeMiB: number} | undefined>}
 */
export async function readGpu(seams = {}) {
  if (seams.subprocess !== undefined && typeof seams.subprocess.spawn === 'function') {
    try {
      const value = await viaSubprocess(seams.subprocess)
      if (value !== undefined) return value
    } catch {
      // Fall through to the direct spawn below.
    }
  }
  try {
    return await viaExecFile()
  } catch {
    return undefined
  }
}
