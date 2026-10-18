export const HOSTILE = new Set([
  'zombie',
  'husk',
  'drowned',
  'skeleton',
  'stray',
  'bogged',
  'wither_skeleton',
  'creeper',
  'spider',
  'cave_spider',
  'enderman',
  'witch',
  'slime',
  'magma_cube',
  'pillager',
  'vindicator',
  'evoker',
  'ravager',
  'phantom',
  'blaze',
  'ghast',
  'silverfish',
  'zombified_piglin',
  'piglin',
  'piglin_brute',
  'hoglin',
  'zoglin',
  'warden',
  'breeze',
])

const round = (n) => Math.round(n * 10) / 10

/**
 * 把机器人当前能看到的世界压缩成一小段 JSON，塞进 system prompt。
 * 只保留决策需要的信息，避免每轮烧掉大量 token。
 */
export function summarize(bot) {
  const pos = bot.entity?.position
  if (!pos) return { note: '尚未进入世界' }

  const inventory = {}
  for (const item of bot.inventory.items()) {
    inventory[item.name] = (inventory[item.name] ?? 0) + item.count
  }
  const items = Object.entries(inventory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([name, count]) => ({ name, count }))

  const players = []
  const mobs = []
  let itemDrops = 0

  for (const entity of Object.values(bot.entities ?? {})) {
    if (!entity || entity === bot.entity || !entity.position) continue
    const distance = entity.position.distanceTo(pos)
    if (distance > 16) continue

    if (entity.type === 'player') {
      players.push({ name: entity.username, distance: round(distance) })
    } else if (entity.type === 'mob') {
      mobs.push({
        name: entity.name,
        distance: round(distance),
        hostile: HOSTILE.has(entity.name),
      })
    } else if (entity.name === 'item' || entity.displayName === 'Item') {
      itemDrops += 1
    }
  }

  mobs.sort((a, b) => a.distance - b.distance)

  return {
    name: bot.username,
    position: { x: round(pos.x), y: round(pos.y), z: round(pos.z) },
    dimension: bot.game?.dimension,
    health: round(bot.health ?? 20),
    food: round(bot.food ?? 20),
    time: {
      ticks: bot.time?.timeOfDay,
      day: bot.time?.isDay,
    },
    standingOn: bot.blockAt(pos.offset(0, -1, 0))?.name ?? null,
    feetBlock: bot.blockAt(pos)?.name ?? null,
    lookingAt: bot.blockAtCursor?.(4)?.name ?? null,
    inventory: items,
    nearbyPlayers: players.slice(0, 6),
    nearbyMobs: mobs.slice(0, 8),
    itemDrops,
  }
}
