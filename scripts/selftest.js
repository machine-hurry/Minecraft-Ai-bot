/**
 * 集成自测：连上一个真实的 Minecraft 服务器，依次调用几个工具，验证协议/寻路/挖掘链路。
 * 用法：node scripts/selftest.js [host] [port]
 * 需要服务器是离线验证（online-mode=false），例如单人存档“对局域网开放”。
 */
import mineflayer from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { summarize } from '../src/state.js'
import { createToolExecutor } from '../src/tools.js'

const host = process.argv[2] ?? process.env.MC_HOST ?? '127.0.0.1'
const port = Number(process.argv[3] ?? process.env.MC_PORT ?? 25565)

const bot = mineflayer.createBot({
  host,
  port,
  username: process.env.MC_USERNAME ?? 'DeepBotTest',
  auth: 'offline',
})
bot.loadPlugin(pf.pathfinder)

const globalTimer = setTimeout(() => {
  console.error('自测超时（120s）')
  process.exit(1)
}, 120_000)

bot.once('spawn', async () => {
  try {
    console.log(`已连接 ${host}:${port}，版本 ${bot.version}`)
    await bot.waitForChunksToLoad()
    const executor = createToolExecutor(bot, { canDig: true, log: console.log })

    const state = summarize(bot)
    console.log('状态摘要:', JSON.stringify(state))
    if (!state.position) throw new Error('状态摘要里没有坐标')

    const status = await executor.execute('status')
    console.log('status:', JSON.stringify(status))

    const said = await executor.execute('say', { text: '自测：工具链路正常' })
    console.log('say:', JSON.stringify(said))

    const missing = await executor.execute('place_block', { block: 'cobblestone', x: 0, y: 0, z: 0 })
    console.log('place_block(空背包):', JSON.stringify(missing))
    if (missing.ok !== false) throw new Error('空背包放方块应该失败')

    const p = bot.entity.position
    const moved = await executor.execute('goto', { x: p.x + 3, y: p.y + 1, z: p.z })
    console.log('goto:', JSON.stringify(moved))

    const mined = await executor.execute('mine_block', { block: 'dirt', count: 1 })
    console.log('mine_block(dirt):', JSON.stringify(mined))
    if (!mined.ok) throw new Error(`挖泥土失败：${mined.problems?.join('; ')}`)

    const looked = await executor.execute('look_at', { x: 0, y: 64, z: 0 })
    console.log('look_at:', JSON.stringify(looked))

    console.log('SELFTEST OK')
    clearTimeout(globalTimer)
    bot.quit()
    setTimeout(() => process.exit(0), 500)
  } catch (err) {
    console.error('SELFTEST FAIL:', err.stack ?? err)
    clearTimeout(globalTimer)
    process.exit(1)
  }
})

bot.on('error', (err) => {
  console.error('连接错误:', err.message)
  clearTimeout(globalTimer)
  process.exit(1)
})
