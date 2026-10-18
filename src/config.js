import { fileURLToPath } from 'node:url'

// 读取项目根目录的 .env（Node >= 21 内置，不存在时静默跳过）
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {
  // .env 是可选的，没有就走默认值 / 系统环境变量
}

const env = process.env

function num(value, fallback) {
  if (value == null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function bool(value, fallback) {
  if (value == null || value === '') return fallback
  return /^(1|true|yes|on)$/i.test(value)
}

export const config = {
  deepseek: {
    apiKey: env.DEEPSEEK_API_KEY ?? '',
    baseUrl: (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: env.DEEPSEEK_MODEL ?? 'deepseek-flash',
    thinking: bool(env.THINKING, false),
    reasoningEffort: env.REASONING_EFFORT ?? 'high',
    temperature: num(env.TEMPERATURE, 0.7),
    timeoutMs: num(env.API_TIMEOUT_MS, 60_000),
  },
  mc: {
    host: env.MC_HOST ?? '127.0.0.1',
    port: num(env.MC_PORT, 25565),
    username: env.MC_USERNAME ?? 'DeepBot',
    auth: env.MC_AUTH ?? 'offline',
    version: env.MC_VERSION || false,
    prefix: env.CHAT_PREFIX ?? '!ai ',
    owner: env.OWNER ?? '',
    canDig: bool(env.CAN_DIG, true),
  },
  brain: {
    maxSteps: num(env.MAX_STEPS, 10),
    historyLimit: num(env.HISTORY_LIMIT, 12),
  },
}
