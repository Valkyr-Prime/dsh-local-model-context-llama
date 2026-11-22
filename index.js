/**
 * Host half of the Local model context bundle.
 *
 * It registers three things and owns nothing else:
 *  - `GET  /api/local-model-context/state` — the snapshot the Settings page renders.
 *  - `POST /api/local-model-context/apply` — apply one context size on both sides.
 *  - the `local_model_context` agent tool — the same two operations for the agent.
 *
 * The page itself lives in `client.js`; it reaches this half through the routes,
 * which the web server admits only for this profile's authenticated browser.
 */
import { createService } from './lib/service.js'
import { buildToolSpec } from './lib/tool.js'

export const name = 'local-model-context'
export const inject = ['connection']

const STATE_PATH = '/api/local-model-context/state'
const APPLY_PATH = '/api/local-model-context/apply'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register the routes and the tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] - optional `llamaAppSettingsPath`, `llamaAppPresetsPath`, `gpuReserveMiB`.
 */
export function apply(ctx, config) {
  const service = createService(ctx, config)

  ctx.effect(() => ctx.connection.fetch.register({
    path: STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return jsonResponse(await service.state())
      } catch (error) {
        return jsonResponse({ ok: false, error: messageOf(error) }, 500)
      }
    },
  }), 'local-model-context: state route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: APPLY_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return jsonResponse({ ok: false, error: '请求体不是合法 JSON' }, 400)
      }
      try {
        return jsonResponse(await service.apply(body))
      } catch (error) {
        return jsonResponse({ ok: false, error: messageOf(error) }, 400)
      }
    },
  }), 'local-model-context: apply route')

  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  if (tools !== undefined && typeof tools.register === 'function') {
    ctx.effect(() => tools.register(buildToolSpec(service)), 'local-model-context: agent tool')
  }
}
