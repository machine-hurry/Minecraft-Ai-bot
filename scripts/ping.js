import { chatCompletion } from '../src/deepseek.js'
import { config } from '../src/config.js'

const started = Date.now()

try {
  const message = await chatCompletion({
    messages: [
      { role: 'system', content: '用一句简短的中文回答。' },
      { role: 'user', content: '你好，请回复“连接成功”。' },
    ],
  })

  console.log('模型：', config.deepseek.model)
  console.log('回复：', message.content)
  console.log('耗时：', `${Date.now() - started} ms`)
  if (message.usage) {
    console.log('用量：', JSON.stringify(message.usage))
  }
} catch (err) {
  console.error('调用失败：', err.message)
  // 不用 process.exit：立即退出会和 undici 关闭连接竞争，在 Windows 上触发 libuv 断言
  process.exitCode = 1
}
