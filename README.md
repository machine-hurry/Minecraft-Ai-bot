# DeepSeek AI 玩家（Minecraft Java 版）

让 DeepSeek 操纵一个**真实的玩家账号**加入你的世界：会走、会挖、会打怪、会聊天。
你的 Fabric 存档不用改任何东西——不需要装模组，也不需要改 `mods` 文件夹。

```
玩家在游戏里打字  ─┐
                   ├─→ Node 进程（mineflayer，协议层）─→ DeepSeek API
游戏世界状态 ──────┘        │                              │
                            └──── 执行 goto / mine / attack ←┘
```

- 协议层：[mineflayer](https://github.com/PrismarineJS/mineflayer)（支持 1.21.x，自动识别版本）
- 决策层：DeepSeek 的 Tool Calls（模型输出“动作”，脚本负责执行并回报结果）
- 安全层：动作白名单、参数校验、单回合步数上限、不会攻击玩家、不会执行任意命令

---

## 1. 五分钟跑起来

### ① 装 Node.js

需要 **Node.js 20+**（本项目在 24 上验证过）。官网下载 LTS 版一路下一步即可：

```powershell
node --version   # 应输出 v20 或更高
```

### ② 装依赖

在项目目录（本文件夹）打开 PowerShell：

```powershell
npm install
```

### ③ 申请 DeepSeek Key

1. 打开 <https://platform.deepseek.com/api_keys>
2. 创建 API Key（`sk-` 开头，**只显示一次**，复制下来）
3. 充值几块钱即可（flash 模型聊天很便宜）

把 `.env.example` 复制成 `.env`，填入密钥：

```powershell
Copy-Item .env.example .env
notepad .env        # 修改 DEEPSEEK_API_KEY 和下面的 MC_PORT
```

先验证 Key 能不能用：

```powershell
npm run ping
```

看到“回复：连接成功”就说明 API 通了。

### ④ 在游戏里开放局域网

1. 用 Fabric 启动器进入你的存档
2. 按 `Esc` → **对局域网开放** → 允许作弊可以打开（方便 `/op`）→ 创建局域网世界
3. 聊天栏会显示：`本地游戏已在端口 54321 上开放`（端口每次可能不同）
4. 把这个端口填进 `.env` 的 `MC_PORT`

> 单人存档开放到局域网后是**离线验证**模式，所以 `MC_AUTH=offline` 即可，不需要正版账号。
> 主机不能退出游戏，但可以最小化——开放局域网后世界会继续运行。

### ⑤ 启动 AI 玩家

```powershell
npm start
```

看到 `已进入世界 (x, y, z)` 就成功了。游戏里 Tab 列表会出现 `DeepBot`。

---

## 2. 游戏里怎么用

在聊天栏输入（默认前缀 `!ai `）：

| 你说 | 它会 |
|---|---|
| `!ai 你好，介绍一下自己` | 纯聊天，不行动 |
| `!ai 去砍 3 个橡木` | 找树 → 寻路 → 挖 3 个 → 汇报 |
| `!ai 挖 10 个铁矿石` | 找矿 → 挖（需要先有镐，否则会很慢/失败） |
| `!ai 跟着我` | 持续跟随，直到 `!ai 停` |
| `!ai 把这只僵尸打了` | 走近 → 攻击 → 汇报 |
| `!ai 捡一下地上的东西` | 走到掉落物旁边 |
| `!ai 我现在在哪` | 调 `status` 读坐标 |
| `!ai 停` | 立刻停止寻路/挖掘 |
| `!ai 用圆石在我脚下搭个 3x3 平台` | 连续放置（需要背包里有圆石） |

也可以私聊它（`/msg DeepBot ...`），私聊不需要前缀。

想让它听话只听你的：`.env` 里填 `OWNER=你的游戏ID`。

---

## 3. 配置项（.env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | 必填 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 想更聪明可换 `deepseek-v4-pro`（贵一些） |
| `THINKING` | `off` | 开思考模式会让它“想”很久，游戏里一般关掉 |
| `MC_HOST` / `MC_PORT` | `127.0.0.1` / `25565` | 局域网存档填 `127.0.0.1` + 聊天栏显示的端口 |
| `MC_USERNAME` | `DeepBot` | 游戏内名字，≤16 字符，不能和你重复 |
| `MC_AUTH` | `offline` | 正版验证服务器改成 `microsoft`（首次会提示设备码登录） |
| `MC_VERSION` | 自动 | 识别失败时手填，如 `1.21.8` |
| `CHAT_PREFIX` | `!ai ` | 指令前缀，注意末尾空格 |
| `OWNER` | 空 | 只响应该玩家，留空 = 所有人 |
| `CAN_DIG` | `on` | 寻路时允许挖开挡路方块；怕拆家改 `off` |
| `MAX_STEPS` | `10` | 单条指令最多“思考 + 执行”多少轮 |
| `HISTORY_LIMIT` | `12` | 记住最近多少轮对话 |

---

## 4. AI 能调用的动作（工具白名单）

| 工具 | 作用 | 关键限制 |
|---|---|---|
| `status` | 读坐标/血量/背包/附近生物 | 只读 |
| `goto` | 寻路到坐标 | 90 秒超时 |
| `follow_player` | 跟随玩家 | 只跟随，不攻击 |
| `mine_block` | 挖原版方块 | 只认原版方块 ID，单次 ≤32 个 |
| `place_block` | 放置背包里的方块 | 目标必须是空气且旁边有依附 |
| `attack_nearest` | 打敌对生物 | **只打 mob，永不攻击玩家** |
| `collect_items` | 捡掉落物 | 最多 8 趟 |
| `eat` | 吃背包里的食物 | 需要背包有食物 |
| `look_at` | 转头看坐标 | — |
| `say` | 公屏说话 | ≤200 字 |
| `stop` | 停止一切动作 | — |

模型只能从这个清单里选，参数还要过一遍类型校验，**它无法执行任意命令、无法给自己 OP、无法刷物品**。

---

## 5. 能力边界（先看这里，少踩坑）

- **它是“原版客户端”**：只装 Fabric API、Sodium、Lithium 这类不改注册表的模组没问题；如果整合包加了大量新方块/新物品/新维度，原版协议可能进不去或看到错位方块。先跑 `npm start` 试试，进得去就没事。
- **不认识模组方块**：`mine_block` 只接受原版 ID（`iron_ore`、`oak_log`…）。模组矿石挖不了。
- **不会合成、不会用工作台、不会睡觉**：目前没做这些工具（可以自己加，见第 8 节）。
- **会被服务器当成普通玩家**：需要白名单的服务器要先把 `DeepBot` 加白名单；反作弊严格的服可能误判。
- **它只看得见 16 格内的实体和 48 格内的方块**，走远了要重新下指令。
- **LAN 世界的端口每次重开都可能变**，记得改 `.env`。

---

## 6. 安全与成本

- **Key 只在本地 `.env`**，不会发给游戏服务器，也不会写进日志。
- `.env` 已被 `.gitignore` 忽略，别把它传到 GitHub。
- **防提示注入**：其他玩家在公屏说的话也会进入模型上下文，但模型能做的只有上面 11 个动作，最坏情况是它跑去挖个坑，不会执行系统命令。
- **成本**：一次“砍树”大约 3~6 次模型调用，每次几千 token；`deepseek-flash` 下大约 **几分钱**。挂一天不停说话也就几块钱。建议在平台设置消费提醒。

---

## 7. 常见问题

**连不上 / `ECONNREFUSED`**
游戏里没开局域网，或端口填错。确认聊天栏的端口，且主机没退出世界。

**`不支持的游戏版本`**
在 `.env` 里写死 `MC_VERSION=1.21.8`。本项目实测 mineflayer 4.39 支持到 1.21.11。

**正版服务器进不去**
`MC_AUTH=microsoft`，首次运行会在控制台打印一个链接和设备码，浏览器登录一次即可（凭据缓存在本地）。

**它站着不动 / 一直“我还在忙”**
上一件事卡住了，输入 `!ai 停`；或者地形太复杂（寻路 90 秒超时）。也可以把 `CAN_DIG=on` 打开让它挖路。

**它说挖到了但背包里没有**
模型在吹牛。本项目已强制“没调工具不许说完成”，但如果工具返回失败它仍可能嘴硬——看控制台 `[tool]` 日志最准。

**401 / 402 / 429**
分别是 Key 错、余额不足、请求太频繁。`npm run ping` 可以快速定位。

**机器人名字冲突**
改 `MC_USERNAME`。

---

## 8. 进阶：加一个自己的动作

1. 在 `src/tools.js` 的 `toolDefinitions` 里加一条 JSON Schema；
2. 在 `handlers` 里实现它（参数校验用 `needNumber` / `needString`）；
3. 重启即可，模型会自动学会用。

例如加“合成木板”：

```js
// toolDefinitions
{ type: 'function', function: { name: 'craft', description: '合成物品',
  parameters: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] } } }

// handlers
craft: async (args) => {
  const item = bot.registry.itemsByName[needString(args, 'item')]
  const recipe = bot.recipesFor(item.id, null, 1, null)[0]
  if (!recipe) return { ok: false, error: '没有可用的配方' }
  await bot.craft(recipe, Number(args.count ?? 1), null)
  return { ok: true, crafted: args.item }
},
```

---

## 9. 目录结构

```
mc/
├─ .env.example        配置模板（复制成 .env）
├─ src/
│  ├─ index.js         入口：连接、聊天指令、重连
│  ├─ brain.js         “思考 → 调工具 → 再思考”循环 + 对话记忆
│  ├─ tools.js         11 个动作的实现与 JSON Schema
│  ├─ state.js         把世界压缩成模型看得懂的 JSON
│  ├─ deepseek.js      API 客户端（重试/超时/思考开关）
│  └─ config.js        读取 .env
├─ scripts/
│  ├─ ping.js          验证 API Key
│  └─ selftest.js      连真实服务器跑一遍工具链
└─ test/brain.test.js  工具循环单元测试
```

## 10. 自测

```powershell
npm test                      # 单元测试（不需要游戏和 Key）
npm run ping                  # 验证 API Key
node scripts/selftest.js      # 连本地服务器跑一遍 goto/mine/say（可选）
```
