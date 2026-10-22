/**
 * F28 会话油表 —— "这一段会话烧到哪儿了"。
 *
 * 起因（用户原话）："**油表做出来吧。其实现在右下角就有一个记录消费的插件……但不要依赖这个插件，
 *   它会更新或者删除。**"
 *
 * 钉三件事：
 *   ① **账记得准**：当前历史 ＝ 未命中 input ＋ 命中缓存（缓存那部分也是历史，只是打折）；
 *   ② **以历史为准**：重启后帧数从 `session.events` 现算，不是内存里那个累加器；
 *   ③ **只认该认的事件**：`assistant/message` 记账、`request/context` 记窗口，别的事件不碰。
 *
 * 🔴 **2026-10-20 删掉的那一半**：`fuelNotice()` 与"水位倒转"分档提醒（`fuelSaid` / `drops` / `lastDrop`）
 *   全删了 —— 用户原话「**删了，裁剪已经被管住了，当初判定这个是因为我们在摸索裁剪时候下的论据，
 *   现在已经不成立。**」⇒ 本文件现在只负责**记账与读数**，不再判断要不要提醒。
 *   ⚠️ 反向断言照旧（仓库纪律 1）：没读数 / 会话不存在 → **不许报假数**。
 */
import { check, done, sandboxHome } from './harness.mjs'

sandboxHome()

const f28 = await import('../lib/f28-fuel.js')
f28.resetFuel()

console.log('')

// ============================================================
// 一、记账
// ============================================================
f28.noteUsage('s1', { inputTokens: 1000, cacheReadTokens: 9000, outputTokens: 500, reasoningTokens: 400 })
let r = f28.fuelReading('s1')
check('帧数 +1', r.frames === 1)
check('**当前历史 = 未命中 input ＋ 命中缓存**', r.history === 10000)
check('累计喂进 = input ＋ cache', r.billed === 10000)
check('output 与思考分别累计', r.output === 500 && r.reasoning === 400)

f28.noteUsage('s1', { inputTokens: 500, cacheReadTokens: 2000, outputTokens: 100, reasoningTokens: 80 })
r = f28.fuelReading('s1')
check('第二帧：帧数累计', r.frames === 2)
check('第二帧：历史取**最新那一帧**（不是累加）', r.history === 2500)
check('第二帧：累计喂进**是累加**', r.billed === 12500)
check('第二帧：output 累加', r.output === 600 && r.reasoning === 480)

// ============================================================
// 二、记账只记事实：不再产出"水位倒转"这类派生字段（2026-10-20 删净）
// ============================================================
check('读数里没有 drops / lastDrop 了（那套判据已删）', !('drops' in r) && !('lastDrop' in r))
f28.noteUsage('s1', { inputTokens: 100, cacheReadTokens: 100 })
check('水位掉下去也只是照实记数（不再自动判成"被裁了"）', f28.fuelReading('s1').history === 200)

// ============================================================
// 三、noteFuel 从事件取数：只认那两种
// ============================================================
f28.noteFuel({ id: 's2' }, { type: 'assistant/message', data: { usage: { inputTokens: 10, cacheReadTokens: 90 } } })
f28.noteFuel({ id: 's2' }, { type: 'request/context', data: { contextWindow: 1000000 } })
f28.noteFuel({ id: 's2' }, { type: 'tool/result', data: { name: 'pwsh' } })
f28.noteFuel({ id: 's2' }, { type: 'assistant/message', data: {} }) // 没 usage 的帧不算
r = f28.fuelReading('s2')
check('request/context **只记窗口、不算一帧**', r.frames === 1)
check('窗口拿到了（1,000,000）', r.window === 1000000)
check('tool/result 与无 usage 的帧都不影响记账', r.billed === 100)
check('没有 session.id 的事件被忽略（不炸）', (f28.noteFuel({}, { type: 'assistant/message', data: { usage: {} } }), true))

// ============================================================
// 四、反向：没有读数 / 空会话 → 不报假数
// ============================================================
check('没有读数的会话 → null（不报假 0 帧）', f28.fuelReading('根本不存在') === null)
check('resetFuel 之后 → 全清（不给 sid 也取不到）', (f28.resetFuel(), f28.fuelReading() === null))

// ============================================================
// 五、重启后**以历史为准**：帧数从 `session.events` 现算（2026-09-20 修）
// ============================================================
// 病根：内存是**累加器**（`frames: prev.frames + 1`）而**重启即清**，会话历史却是**恢复**的
//   → 界面上明明已经几十帧，油表却说"已 1 帧"。现在读数的唯一算法 = 扫全量历史。
// 形状取自真会话日志实测（`assistant/message.data.usage` / `request/context.data.contextWindow`）。
const hist = [
  { type: 'request/context', data: { contextWindow: 1000000 } },
  { type: 'assistant/message', data: { usage: { inputTokens: 1000, cacheReadTokens: 9000, outputTokens: 10, reasoningTokens: 5 } } },
  { type: 'tool/result', data: { name: 'pwsh' } },
  { type: 'assistant/message', data: { usage: { inputTokens: 200, cacheReadTokens: 1800, outputTokens: 20, reasoningTokens: 7 } } },
]
f28.noteFuel({ id: 's4', events: hist }, { type: 'session/start' })
r = f28.fuelReading('s4')
check('重启后：帧数**来自历史**（2 帧，不是"已 1 帧"）', r.frames === 2)
check('历史现算：当前历史取**最新那一帧**（口径不变）', r.history === 2000)
check('历史现算：累计喂进＝历史里所有帧之和', r.billed === 12000)
check('历史现算：output / 思考都是历史之和', r.output === 30 && r.reasoning === 12)
check('历史现算：窗口也来自历史', r.window === 1000000)

// 再来一条事件（哪怕它不在历史里）→ **仍以全量历史为准，不是 +1 累加**
f28.noteFuel({ id: 's4', events: hist }, { type: 'assistant/message', data: { usage: { inputTokens: 999999, cacheReadTokens: 0 } } })
check('再收到事件 → 仍按全量历史现算（不是 +1 累加）', f28.fuelReading('s4').frames === 2)
check('...累计喂进也没被那条事件污染', f28.fuelReading('s4').billed === 12000)

// 反向：历史里一帧都没有 → 没有读数（别报个假的 0 帧）
f28.noteFuel({ id: 's5', events: [{ type: 'user/message', data: {} }] }, { type: 'user/message' })
check('历史里没有 usage 帧 → 没有读数（不报假数）', f28.fuelReading('s5') === null)

// 拿不到 events → 退回老的增量记账（老宿主 / 假 session 仍能用）
f28.noteFuel({ id: 's6' }, { type: 'assistant/message', data: { usage: { inputTokens: 5, cacheReadTokens: 5 } } })
check('拿不到 events → 退回增量记账（帧数 1）', f28.fuelReading('s6').frames === 1)

// ============================================================
// 六、💰 今日花销**读数**（2026-09-20：原来是"预警"，用户当天改成纯读数 ——
//     "既然每轮工作都会被'计价门卫'或者闸门所控制…那十五块总量的那个表已经没有存在意义了…
//      我觉得只单纯方便你知道用了多少钱就行了。不用报警或者警告了。"）
// ============================================================
console.log('')
console.log('— 六、💰 今日花销读数（只给事实，不报警）—')
const { writeFileSync } = await import('node:fs')
const { join } = await import('node:path')
const { HOME_DIR } = await import('../lib/common.js')
const UF = join(HOME_DIR, '.dshw-usage.json')
const put = (today) => writeFileSync(UF, JSON.stringify({ date: '2026-09-20', todayUsage: today }), 'utf8')

check('读不到那个文件 → 空串（**不许编**）', f28.spendLine() === '')
put(1)
check('花得少也照样给数（**没有阈值、不再沉默**）', /今天花了 ¥1\.00/.test(f28.spendLine()), f28.spendLine())
put(9)
check('给的是实数（¥9.00）', /今天花了 ¥9\.00/.test(f28.spendLine()), f28.spendLine())
check('**没有**百分比 / **没有**"还剩多少" / **没有**上限', !/还剩|%|15/.test(f28.spendLine()), f28.spendLine())
check('同样的数再来一次 → **照样给**（不是报警，没有节流）', /今天花了 ¥9\.00/.test(f28.spendLine()))
put(16)
check('超了也只是一个数（不报"超了/还剩 0"）', /今天花了 ¥16\.00/.test(f28.spendLine()) && !/还剩/.test(f28.spendLine()), f28.spendLine())
writeFileSync(UF, '{坏 JSON', 'utf8')
check('文件坏掉 → 空串、不抛（fail-open）', f28.spendLine() === '')

done()
