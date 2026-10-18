import test from 'node:test'
import assert from 'node:assert/strict'
import { Brain } from '../src/brain.js'

function reply(content, toolCalls) {
  return { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }
}

function call(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

function makeBrain(responses, { executed = [], maxSteps = 5, historyLimit = 4 } = {}) {
  const queue = [...responses]
  const executor = {
    execute: async (name, args) => {
      executed.push({ name, args })
      return { ok: true, mined: 2 }
    },
  }
  const brain = new Brain({
    executor,
    definitions: [],
    callModel: async () => queue.shift(),
    maxSteps,
    historyLimit,
  })
  return { brain, executed }
}

test('先调用工具，再给出最终答复', async () => {
  const executed = []
  const { brain } = makeBrain(
    [
      reply(null, [call('c1', 'mine_block', { block: 'oak_log', count: 2 })]),
      reply('砍好了，两根橡木在背包里'),
    ],
    { executed },
  )

  const answer = await brain.handle('砍两根橡木', '{}')

  assert.equal(answer, '砍好了，两根橡木在背包里')
  assert.deepEqual(executed, [{ name: 'mine_block', args: { block: 'oak_log', count: 2 } }])
  assert.equal(brain.history.length, 2)
  assert.equal(brain.history[0].role, 'user')
  assert.equal(brain.history[1].role, 'assistant')
})

test('工具报错会回传给模型，流程不中断', async () => {
  const executor = {
    execute: async () => {
      throw new Error('附近没有橡木')
    },
  }
  const messages = []
  const queue = [
    reply(null, [call('c1', 'mine_block', { block: 'oak_log' })]),
    reply('附近没有橡木，我换个地方找'),
  ]
  const brain = new Brain({
    executor,
    definitions: [],
    callModel: async (payload) => {
      messages.push(structuredClone(payload.messages))
      return queue.shift()
    },
    maxSteps: 5,
  })

  const answer = await brain.handle('砍树', '{}')

  assert.equal(answer, '附近没有橡木，我换个地方找')
  const toolMessage = messages[1].find((m) => m.role === 'tool')
  assert.ok(toolMessage)
  assert.match(toolMessage.content, /附近没有橡木/)
})

test('参数不是合法 JSON 时按空对象执行', async () => {
  const executed = []
  const executor = {
    execute: async (name, args) => {
      executed.push({ name, args })
      return { ok: true }
    },
  }
  const queue = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'status', arguments: '{bad json' } }],
    },
    reply('好的'),
  ]
  const brain = new Brain({ executor, definitions: [], callModel: async () => queue.shift() })

  await brain.handle('看看状态', '{}')

  assert.deepEqual(executed, [{ name: 'status', args: {} }])
})

test('步数用尽会兜底收尾，不会无限循环', async () => {
  const executor = { execute: async () => ({ ok: true }) }
  const brain = new Brain({
    executor,
    definitions: [],
    callModel: async () => reply(null, [call('c', 'status', {})]),
    maxSteps: 3,
  })

  const answer = await brain.handle('一直干', '{}')

  assert.match(answer, /停一下/)
  assert.equal(brain.history.length, 2)
})

test('历史只保留最近 N 轮且不含工具消息', async () => {
  const { brain } = makeBrain(
    [reply('一'), reply('二'), reply('三')],
    { historyLimit: 2 },
  )

  await brain.handle('第一句', '{}')
  await brain.handle('第二句', '{}')
  await brain.handle('第三句', '{}')

  assert.equal(brain.history.length, 4)
  assert.equal(brain.history[0].content, '第二句')
  assert.equal(brain.history[3].content, '三')
  assert.ok(brain.history.every((m) => m.role !== 'tool'))
})
