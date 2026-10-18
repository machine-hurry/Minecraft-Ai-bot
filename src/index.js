import mineflayer from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { config } from './config.js'
import { Brain } from './brain.js'
import { createToolExecutor, toolDefinitions } from './tools.js'
import { summarize } from './state.js'

const { pathfinder } = pf
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args)
const fmt = (v) => `(${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)})`

if (!config.deepseek.apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY。')
  console.error('把 .env.example 复制成 .env，填入 https://platform.deepseek.com/api_keys 创建的密钥。')
  process.exit(1)
}

let bot
let brain
let busy = false
let shuttingDown = false
let reconnectAttempts = 0

function connect() {
  log(`连接 ${config.mc.host}:${config.mc.port}（${config.mc.auth}）...`)

  bot = mineflayer.createBot({
    host: config.mc.host,
    port: config.mc.port,
    username: config.mc.username,
    auth: config.mc.auth,
    ...(config.mc.version ? { version: config.mc.version } : {}),
    hideErrors: false,
  })
  bot.loadPlugin(pathfinder)

  const executor = createToolExecutor(bot, { canDig: config.mc.canDig, log })
  brain = new Brain({
    executor,
    definitions: toolDefinitions,
    maxSteps: config.brain.maxSteps,
    historyLimit: config.brain.historyLimit,
    log,
  })

  bot.once('spawn', () => {
    reconnectAttempts = 0
    busy = false
    log(`已进入世界 ${fmt(bot.entity.position)}，版本 ${bot.version}`)
    if (config.mc.prefix.trim()) {
      bot.chat(`AI 玩家已上线，输入 ${config.mc.prefix.trim()}<指令> 让我干活`)
    }
  })

  bot.on('chat', (username, message) => onMessage(username, message, false))
  bot.on('whisper', (username, message) => onMessage(username, message, true))

  bot.on('death', () => {
    busy = false
    log('机器人死了，1 秒后重生')
    setTimeout(() => {
      try {
        if (typeof bot.respawn === 'function') bot.respawn()
        else bot._client.write('client_command', { actionId: 0 })
      } catch (err) {
        log('重生失败：', err.message)
      }
    }, 1000)
  })

  bot.on('kicked', (reason) => log('被踢出：', typeof reason === 'string' ? reason : JSON.stringify(reason)))
  bot.on('error', (err) => log('连接错误：', err.message))
  bot.on('end', (reason) => {
    log('连接断开：', reason ?? '')
    if (!shuttingDown) scheduleReconnect()
  })
}

function scheduleReconnect() {
  if (reconnectAttempts >= 5) {
    log('重连 5 次仍失败，退出。检查游戏是否已“对局域网开放”、端口是否正确。')
    process.exit(1)
  }
  reconnectAttempts += 1
  const delay = 3000 * reconnectAttempts
  log(`${delay / 1000}s 后重连（第 ${reconnectAttempts} 次）`)
  setTimeout(connect, delay)
}

function extractCommand(message) {
  if (typeof message !== 'string') return null
  const prefix = config.mc.prefix
  if (prefix && message.startsWith(prefix)) return message.slice(prefix.length).trim()
  const name = bot.username
  if (message.toLowerCase().startsWith(name.toLowerCase())) {
    return message.slice(name.length).replace(/^[:：,，\s]+/, '').trim()
  }
  return null
}

async function onMessage(username, message, isWhisper) {
  if (username === bot.username) return
  if (config.mc.owner && username !== config.mc.owner) return

  const text = isWhisper ? String(message).trim() : extractCommand(message)
  if (text == null) return

  if (!text) {
    await reply(username, `用法：${config.mc.prefix.trim()}<指令>，例如“${config.mc.prefix.trim()}去砍两棵橡木”`, isWhisper)
    return
  }

  if (busy) {
    await reply(username, '我还在忙上一件事，稍等一下', isWhisper)
    return
  }

  busy = true
  const started = Date.now()
  try {
    const state = JSON.stringify(summarize(bot))
    const answer = await brain.handle(text, state)
    log(`[${username}] ${text} -> ${answer}（${Date.now() - started}ms）`)
    await reply(username, answer, isWhisper)
  } catch (err) {
    log('AI 调用失败：', err.message)
    await reply(username, `我这边出错了：${err.message}`, isWhisper)
  } finally {
    busy = false
  }
}

async function reply(username, text, isWhisper) {
  const chunks = String(text).match(/[\s\S]{1,180}/g) ?? []
  for (let i = 0; i < Math.min(chunks.length, 3); i += 1) {
    const body = i === 0 && !isWhisper ? `${username}：${chunks[i]}` : chunks[i]
    try {
      if (isWhisper) bot.whisper(username, body)
      else bot.chat(body)
    } catch (err) {
      log('发送消息失败：', err.message)
      break
    }
    await sleep(350)
  }
}

process.on('SIGINT', () => {
  shuttingDown = true
  log('收到 Ctrl+C，断开连接')
  try {
    bot?.quit()
  } catch {
    /* ignore */
  }
  // 给 socket 一点关闭时间再强制退出，避免 process.exit 与网络层竞争
  setTimeout(() => process.exit(0), 1500).unref()
})

process.on('unhandledRejection', (err) => {
  log('未处理的 Promise 异常：', err?.stack ?? err)
})

log(`模型 ${config.deepseek.model}，思考模式 ${config.deepseek.thinking ? '开' : '关'}`)
connect()
