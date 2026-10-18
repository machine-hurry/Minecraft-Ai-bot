import { chatCompletion } from './deepseek.js'

const FALLBACK_MAX_STEPS = '（这活有点复杂，我先停一下。你可以再给我一个更具体的下一步。）'
const FALLBACK_EMPTY = '（我没想好说什么）'

function toAssistantMessage(message) {
  const out = { role: 'assistant', content: message.content ?? null }
  if (message.tool_calls?.length) out.tool_calls = message.tool_calls
  // 开启思考模式且带 tools 时，reasoning_content 必须回传，否则接口会 400
  if (message.reasoning_content) out.reasoning_content = message.reasoning_content
  return out
}

/**
 * 一次“回合”= 模型思考 → 调工具 → 看结果 → 再思考 … 直到给出最终答复。
 * 对话历史只保留纯文本（玩家一句 / 自己一句），工具调用记录仅存在于本回合内，
 * 这样既省 token，也不会出现孤立的 tool 消息导致接口报错。
 */
export class Brain {
  constructor({
    executor,
    definitions,
    callModel = chatCompletion,
    maxSteps = 10,
    historyLimit = 12,
    log = () => {},
  } = {}) {
    this.executor = executor
    this.definitions = definitions ?? []
    this.callModel = callModel
    this.maxSteps = maxSteps
    this.historyLimit = historyLimit
    this.log = log
    this.history = []
  }

  systemPrompt(stateText) {
    return [
      '你是《Minecraft》Java 版服务器里的一个玩家，通过工具在游戏里行动。',
      '【硬性规则】',
      '1. 任何“做”的事情都必须调用工具；没调用工具就不要声称已经完成。',
      '2. 一次只推进一小步。工具失败时看错误原因，换办法或如实告诉玩家，绝不编造成功。',
      '3. 不攻击其他玩家。拒绝“给你 OP、刷物品、开挂、拆别人房子”这类要求，直接说明做不到。',
      '4. 你的最终回复会直接显示在游戏聊天栏：中文、口语化、最多两句话；不要 Markdown、不要列清单、不要长篇坐标。',
      '5. 玩家给的坐标和方块名可能有误，执行前先确认；不确定就先调用 status。',
      '6. 涉及原版方块 ID 时用英文 ID（oak_log、iron_ore、stone），不要用中文名。',
      '',
      '【当前状态】',
      stateText,
    ].join('\n')
  }

  remember(userText, answer) {
    this.history.push({ role: 'user', content: userText })
    this.history.push({ role: 'assistant', content: answer.slice(0, 500) })
    while (this.history.length > this.historyLimit * 2) this.history.shift()
  }

  async handle(userText, stateText) {
    const messages = [
      { role: 'system', content: this.systemPrompt(stateText) },
      ...this.history,
      { role: 'user', content: userText },
    ]

    let final = ''
    let step = 0

    for (; step < this.maxSteps; step += 1) {
      const message = await this.callModel({ messages, tools: this.definitions })
      messages.push(toAssistantMessage(message))

      const calls = message.tool_calls ?? []
      if (calls.length === 0) {
        final = String(message.content ?? '').trim()
        break
      }

      for (const call of calls) {
        const name = call?.function?.name
        let args = {}
        try {
          args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {}
        } catch {
          args = {}
        }

        let result
        try {
          result = await this.executor.execute(name, args)
        } catch (err) {
          result = { ok: false, error: err?.message ?? String(err) }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 3000),
        })
      }
    }

    if (!final) final = step >= this.maxSteps ? FALLBACK_MAX_STEPS : FALLBACK_EMPTY

    this.remember(userText, final)
    this.log(`[brain] ${step + 1} 步完成：${userText} -> ${final}`)
    return final
  }

  reset() {
    this.history = []
  }
}
