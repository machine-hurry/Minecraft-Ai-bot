import pf from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { summarize, HOSTILE } from './state.js'

const { goals, Movements } = pf

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round = (n) => Math.round(n * 10) / 10
const fmt = (v) => `(${round(v.x)}, ${round(v.y)}, ${round(v.z)})`

function withTimeout(promise, ms, label, onTimeout) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.()
      } catch {
        /* 清理失败不影响报错 */
      }
      reject(new Error(label))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function needNumber(args, key) {
  const value = Number(args?.[key])
  if (!Number.isFinite(value)) throw new Error(`参数 ${key} 必须是数字`)
  return value
}

function needString(args, key, label = key) {
  const value = args?.[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${label} 必须是非空字符串`)
  return value.trim()
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'status',
      description: '查看自己当前的状态：坐标、血量、饥饿度、背包、附近玩家/怪物。不确定环境时先调用它。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'goto',
      description: '走到指定坐标（自动寻路，途中可能挖开挡路的方块）。到达后返回实际位置。',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '目标 X' },
          y: { type: 'number', description: '目标 Y' },
          z: { type: 'number', description: '目标 Z' },
          range: { type: 'number', description: '到达半径，默认 1，范围 0.5~8' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'follow_player',
      description: '持续跟随指定玩家，直到收到 stop 或新指令。',
      parameters: {
        type: 'object',
        properties: {
          player: { type: 'string', description: '玩家名（区分大小写尽量写对）' },
          distance: { type: 'number', description: '保持的距离，默认 3' },
        },
        required: ['player'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mine_block',
      description:
        '挖掉附近指定方块，最多一次挖 count 个。block 必须是原版方块 ID，如 iron_ore、oak_log、stone、coal_ore、deepslate_iron_ore。挖不到会返回失败原因。',
      parameters: {
        type: 'object',
        properties: {
          block: { type: 'string', description: '方块 ID，例如 oak_log' },
          count: { type: 'number', description: '数量，默认 1，最大 32' },
        },
        required: ['block'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'place_block',
      description: '把背包里的方块放到指定坐标（旁边必须有可依附的方块）。',
      parameters: {
        type: 'object',
        properties: {
          block: { type: 'string', description: '方块 ID，例如 cobblestone' },
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        required: ['block', 'x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attack_nearest',
      description: '攻击附近的敌对生物（不会攻击玩家）。不填 mob 时自动选最近的僵尸/骷髅/苦力怕等。',
      parameters: {
        type: 'object',
        properties: {
          mob: { type: 'string', description: '生物名，例如 zombie；不填则打最近的敌对生物' },
          radius: { type: 'number', description: '搜索半径，默认 12' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'collect_items',
      description: '走过去捡起附近掉落的物品。',
      parameters: {
        type: 'object',
        properties: {
          radius: { type: 'number', description: '搜索半径，默认 12' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eat',
      description: '吃掉背包里的一种食物（饥饿度不满时用）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'look_at',
      description: '把视线转向某个坐标（挖矿/放置前对准用）。',
      parameters: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'say',
      description: '在公屏说一句话（给其他玩家看）。正常回复玩家不需要用它。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '内容，最长 200 字' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop',
      description: '立刻停止当前动作（寻路、跟随、挖掘）。',
      parameters: { type: 'object', properties: {} },
    },
  },
]

export function createToolExecutor(bot, { canDig = true, log = () => {} } = {}) {
  let movements = null

  function getMovements() {
    if (!movements) {
      movements = new Movements(bot)
      movements.canDig = canDig
      movements.allow1by1towers = false
      movements.allowParkour = true
      movements.maxDropDown = 4
      movements.dontCreateFlow = true
      movements.dontMineUnderFallingBlock = true
    }
    return movements
  }

  function countItem(name) {
    return bot.inventory
      .items()
      .filter((i) => i.name === name)
      .reduce((sum, i) => sum + i.count, 0)
  }

  async function gotoNear(target, range = 1) {
    if (!bot.entity) throw new Error('机器人还没进入世界')
    if (bot.entity.position.distanceTo(target) <= range + 0.75) return
    bot.pathfinder.setMovements(getMovements())
    await withTimeout(
      bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, range)),
      90_000,
      `走到 ${fmt(target)} 超时（被挡住或地形太复杂）`,
      () => bot.pathfinder.stop(),
    )
  }

  async function mineBlock(blockName, count) {
    const info = bot.registry.blocksByName[blockName]
    if (!info) {
      return {
        ok: false,
        error: `未知方块 "${blockName}"。只能用原版方块 ID（如 iron_ore、oak_log、stone）`,
      }
    }

    let mined = 0
    const problems = []

    for (let i = 0; i < count; i += 1) {
      const block = bot.findBlock({ matching: info.id, maxDistance: 48 })
      if (!block) {
        problems.push(`附近 48 格内找不到 ${blockName}`)
        break
      }

      try {
        await gotoNear(block.position, 2)
        const fresh = bot.blockAt(block.position)
        if (!fresh || fresh.name !== blockName) continue
        if (fresh.hardness < 0) {
          problems.push(`${blockName} 无法被破坏`)
          break
        }

        const tool = bot.pathfinder.bestHarvestTool(fresh)
        if (tool) await bot.equip(tool, 'hand').catch(() => {})
        await withTimeout(bot.dig(fresh, true), 60_000, `挖 ${blockName} 超时`, () =>
          bot.stopDigging(),
        )
        mined += 1
      } catch (err) {
        problems.push(err.message)
        break
      }

      await sleep(250)
    }

    return { ok: mined > 0, mined, requested: count, problems }
  }

  async function placeBlock(blockName, x, y, z) {
    const item = bot.inventory.items().find((i) => i.name === blockName)
    if (!item) return { ok: false, error: `背包里没有 ${blockName}` }

    const target = new Vec3(x, y, z)
    const existing = bot.blockAt(target)
    if (!existing) return { ok: false, error: '目标位置的区块还没加载' }
    if (existing.boundingBox === 'block') return { ok: false, error: '目标位置已经有方块了' }

    const offsets = [
      [0, -1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
    ]

    let reference = null
    let face = null
    for (const [dx, dy, dz] of offsets) {
      const neighbour = bot.blockAt(target.offset(dx, dy, dz))
      if (neighbour && neighbour.boundingBox === 'block') {
        reference = neighbour
        face = new Vec3(-dx, -dy, -dz)
        break
      }
    }
    if (!reference) return { ok: false, error: '附近没有可依附的方块，放不了' }

    await gotoNear(reference.position, 3)
    await bot.equip(item, 'hand')
    await withTimeout(bot.placeBlock(reference, face), 15_000, '放置方块超时')
    return { ok: true, placed: blockName, at: { x, y, z } }
  }

  async function attackNearest(mobName, radius) {
    const me = bot.entity?.position
    if (!me) return { ok: false, error: '机器人还没进入世界' }

    const candidates = Object.values(bot.entities)
      .filter(
        (e) =>
          e &&
          e !== bot.entity &&
          e.type === 'mob' &&
          e.position &&
          e.position.distanceTo(me) <= radius,
      )
      .filter((e) => (mobName ? e.name === mobName : HOSTILE.has(e.name)))
      .sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))

    const target = candidates[0]
    if (!target) return { ok: false, error: '附近没有目标怪物' }

    let hits = 0
    for (let i = 0; i < 30 && target.isValid; i += 1) {
      if (target.position.distanceTo(bot.entity.position) > 3) {
        await gotoNear(target.position, 2)
      }
      if (!target.isValid) break
      bot.attack(target)
      hits += 1
      await sleep(620)
    }

    return { ok: true, hits, killed: !target.isValid, mob: target.name }
  }

  async function collectItems(radius) {
    let trips = 0
    for (let i = 0; i < 8; i += 1) {
      const me = bot.entity?.position
      if (!me) break
      const drop = Object.values(bot.entities).find(
        (e) =>
          e &&
          e !== bot.entity &&
          (e.name === 'item' || e.displayName === 'Item') &&
          e.position &&
          e.position.distanceTo(me) <= radius,
      )
      if (!drop) break
      await gotoNear(drop.position, 1)
      await sleep(450)
      trips += 1
    }
    return { ok: trips > 0, trips }
  }

  async function eat() {
    const food = bot.inventory.items().find((i) => bot.registry.foodsByName?.[i.name])
    if (!food) return { ok: false, error: '背包里没有食物' }
    await bot.equip(food, 'hand')
    await withTimeout(bot.consume(), 15_000, '吃东西超时')
    return { ok: true, ate: food.name, food: bot.food }
  }

  async function followPlayer(playerName, distance) {
    const key = Object.keys(bot.players).find(
      (name) => name === playerName || name.toLowerCase() === playerName.toLowerCase(),
    )
    const entity = key ? bot.players[key]?.entity : null
    if (!entity) return { ok: false, error: `看不到玩家 ${playerName}` }

    bot.pathfinder.setMovements(getMovements())
    bot.pathfinder.setGoal(new goals.GoalFollow(entity, distance), true)
    return { ok: true, following: key, distance }
  }

  const handlers = {
    status: async () => ({ ok: true, state: summarize(bot) }),

    goto: async (args) => {
      const target = new Vec3(needNumber(args, 'x'), needNumber(args, 'y'), needNumber(args, 'z'))
      const range = clamp(Number(args?.range ?? 1) || 1, 0.5, 8)
      await gotoNear(target, range)
      return { ok: true, at: { x: round(bot.entity.position.x), y: round(bot.entity.position.y), z: round(bot.entity.position.z) } }
    },

    follow_player: async (args) =>
      followPlayer(needString(args, 'player'), clamp(Number(args?.distance ?? 3) || 3, 1, 16)),

    mine_block: async (args) =>
      mineBlock(needString(args, 'block'), clamp(Math.floor(Number(args?.count ?? 1) || 1), 1, 32)),

    place_block: async (args) =>
      placeBlock(
        needString(args, 'block'),
        needNumber(args, 'x'),
        needNumber(args, 'y'),
        needNumber(args, 'z'),
      ),

    attack_nearest: async (args) =>
      attackNearest(
        args?.mob ? String(args.mob) : null,
        clamp(Number(args?.radius ?? 12) || 12, 2, 24),
      ),

    collect_items: async (args) => collectItems(clamp(Number(args?.radius ?? 12) || 12, 2, 32)),

    eat: async () => eat(),

    look_at: async (args) => {
      await bot.lookAt(new Vec3(needNumber(args, 'x'), needNumber(args, 'y'), needNumber(args, 'z')), true)
      return { ok: true }
    },

    say: async (args) => {
      const text = needString(args, 'text').slice(0, 200)
      bot.chat(text)
      return { ok: true, said: text }
    },

    stop: async () => {
      bot.pathfinder.setGoal(null)
      bot.clearControlStates()
      try {
        bot.stopDigging()
      } catch {
        /* 没在挖就算了 */
      }
      return { ok: true }
    },
  }

  async function execute(name, args = {}) {
    const handler = handlers[name]
    if (!handler) return { ok: false, error: `未知工具 ${name}` }

    const started = Date.now()
    try {
      const result = await handler(args ?? {})
      log(`[tool] ${name} ${JSON.stringify(args)} -> ${JSON.stringify(result).slice(0, 200)} (${Date.now() - started}ms)`)
      return result
    } catch (err) {
      const result = { ok: false, error: err?.message ?? String(err) }
      log(`[tool] ${name} ${JSON.stringify(args)} -> ERROR ${result.error}`)
      return result
    }
  }

  return { execute, countItem }
}
