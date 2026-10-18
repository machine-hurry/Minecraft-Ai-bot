import { config } from './config.js'

export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function snippet(text) {
  return String(text ?? '').replace(/\s+/g, ' ').slice(0, 300)
}

function explain(status, body) {
  switch (status) {
    case 400:
      return `请求参数错误（400）：${snippet(body)}`
    case 401:
      return 'API Key 无效或已失效（401），请检查 .env 里的 DEEPSEEK_API_KEY'
    case 402:
      return '账户余额不足（402），请到平台充值'
    case 429:
      return '请求太频繁或额度用尽（429），稍后再试'
    default:
      return status >= 500
        ? `DeepSeek 服务暂时不可用（${status}）`
        : `接口返回 ${status}：${snippet(body)}`
  }
}

/**
 * 调用 DeepSeek 对话补全（OpenAI 兼容格式）。
 * 返回 assistant message；usage 以不可枚举属性附在 message 上，不会被再次序列化进请求。
 */
export async function chatCompletion({ messages, tools, signal } = {}) {
  const { apiKey, baseUrl, model, thinking, reasoningEffort, temperature, timeoutMs } =
    config.deepseek

  if (!apiKey) {
    throw new ApiError('没有配置 DEEPSEEK_API_KEY：复制 .env.example 为 .env 并填入密钥')
  }

  const body = { model, messages, stream: false }
  if (thinking) {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = reasoningEffort
  } else {
    body.thinking = { type: 'disabled' }
    body.temperature = temperature
  }
  if (tools?.length) body.tools = tools

  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res
    let text
    try {
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combined,
      })
      text = await res.text()
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      lastError = new ApiError(
        timedOut ? `请求超时（${timeoutMs}ms），模型或网络太慢` : `网络错误：${err?.message ?? err}`,
      )
      if (attempt === 2) throw lastError
      await sleep(800 * 2 ** attempt + Math.random() * 300)
      continue
    }

    if (!res.ok) {
      const err = new ApiError(explain(res.status, text), { status: res.status, body: text })
      if (!RETRYABLE.has(res.status) || attempt === 2) throw err
      lastError = err
      await sleep(800 * 2 ** attempt + Math.random() * 300)
      continue
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new ApiError(`接口返回的 JSON 无法解析：${snippet(text)}`)
    }

    const message = data?.choices?.[0]?.message
    if (!message) {
      throw new ApiError(`接口返回里没有 choices[0].message：${snippet(text)}`)
    }

    message.role = 'assistant'
    Object.defineProperty(message, 'usage', { value: data.usage, enumerable: false })
    return message
  }

  throw lastError ?? new ApiError('未知错误')
}
