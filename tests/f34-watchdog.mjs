/**
 * F34 · 考勤 —— 用户 2026-09-26 19:35 给的三条验收，这份测试就照这三条钉：
 *   ① 一切正常 → **一个字都不说**
 *   ② 有**部分失效** → 出声
 *   ③ **它自己失效** → 也出声（考勤不 tick 时，由还活着的 F26 照样算得出来）
 *   （梅莫莉亚**全崩**那一层不归它管 —— 交给用户的眼睛，所以这里不测。）
 * 另加三条护栏：重启不诬告 · 节流一小时 · 快照必须记在"这一步结束时"（0.76.1 那个 bug 的不变量）。
 *
 * ⚠️ 这份测试与旧版的根本区别：**它按"该动的那种步"造现场** ——
 *   没有工具调用的步，门卫本来就不该露面（拿"每步"量它就是天天假警）。
 *
 * 跑法：`node tests/f34-watchdog.mjs`（`node test.mjs` 会自动带上它）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { check, done, sandboxHome } from './harness.mjs'

// 🔴 先压沙箱再 import —— `WATCH_STATE_FILE` 在模块顶层就算定了（照别的测试的规矩）
const home = sandboxHome()

const W = await import('../lib/f34-watchdog.js')
// 用**真的**那两个记账口模拟生产：`capTick` ＝ 某能力露面，`bumpToolCalls` ＝ 真的发生了一次工具调用
const { CAP_STATS, bumpToolCalls, capTick } = await import('../lib/common.js')

const STATE = join(home, 'memoria-watchdog.json')
const wipe = () => {
  try {
    rmSync(STATE)
  } catch {
    /* 本来就没有 */
  }
}
const seed = (obj) => {
  mkdirSync(dirname(STATE), { recursive: true })
  writeFileSync(STATE, `${JSON.stringify(obj, null, 2)}\n`)
}
const read = () => JSON.parse(readFileSync(STATE, 'utf8'))

/**
 * 走一步（与生产同构）：
 *   · `ids` ＝ 这一步露面的能力（生产里 F26 每步都算：`backlogText` 或 `peekBacklog`；F5 由闸门每步问）；
 *   · `tool` ＝ 这一步**真的发生了一次工具调用**（独立时钟 +1，于是门卫该判、F30 该露面）；
 *   · `judge` ＝ 门卫这一步**判没判**（`false` 就是"它瞎了"）。
 */
const stepOne = ({ tool = false, ids = ['F26', 'F5'], judge = true } = {}) => {
  for (const id of ids) capTick(id, '测试：现身')
  if (tool) {
    bumpToolCalls()
    if (judge) capTick('F30', '测试：判过')
  }
  capTick('F1', '测试：到场')
  W.watchTick('pre-step')
}
/** 推过热身期（默认按生产常态：每步都有工具调用、都在判）。 */
const warm = (n = W.WARMUP_STEPS + 2) => {
  for (let i = 0; i < n; i++) stepOne({ tool: true })
}

console.log('— ① 一切正常 ＝ 一个字都不说（验收第 1 条）—')
wipe()
warm()
check('每步都在动 → 零告警', W.silentRounds().length === 0)
check('留意栏那行是空串（沉默是默认）', W.watchdogLine() === '')
check('状态面板那行**照样出**（"它扫过了"必须看得见）', W.watchdogText().includes('全好'))

console.log('')
console.log('— ② 部分失效 → 出声（验收第 2 条）—')
// (a) 留意栏（F26）停了 3 步，其余照常 —— **还在干活的不许被冤枉**
for (let i = 0; i < W.SILENT_ROUNDS; i++) stepOne({ tool: true, ids: ['F5'] })
let list = W.silentRounds()
check('F26（留意栏）连着 3 步没露面 → 被点名', list.some((x) => x.id === 'F26'))
check('**还在干活的 F1 / F5 不在名单里**（不冤枉）', !list.some((x) => x.id === 'F1' || x.id === 'F5'))
check(
  '点名的条目带着"几步没露面"',
  list.every((x) => typeof x.rounds === 'number' && x.rounds >= W.SILENT_ROUNDS)
)
const line = W.watchdogLine()
check('留意栏那行非空、写清了判据（连着几步）', line.length > 0 && line.includes(String(W.SILENT_ROUNDS)))
check('那行说的是人话（点名中文名，不是光一个代号）', line.includes('留意栏'))
check('状态面板那行跟着变红', W.watchdogText().includes('僵'))
stepOne({ tool: true })
check('它一露面就恢复沉默', W.silentRounds().length === 0)

// (b) 门卫（F30）瞎了：**工具调用真的在发生**（独立时钟在涨），但门卫一次都不判
for (let i = 0; i < W.SILENT_ROUNDS; i++) stepOne({ tool: true, judge: false })
check(
  '工具调用在发生、门卫却不判 → 点名 F30（这条测的正是"它瞎了"）',
  W.silentRounds().some((x) => x.id === 'F30')
)

// (c) 防假警：**没有工具调用的步，不许算门卫留意**（"按需"不等于"每步"）
wipe()
for (let i = 0; i < W.WARMUP_STEPS + 6; i++) stepOne({ tool: false })
check(
  '连着 6 步都没有工具调用 → 门卫**不许**被点名',
  !W.silentRounds().some((x) => x.id === 'F30')
)

console.log('')
console.log('— ③ 它自己失效 → 也出声（验收第 3 条）—')
wipe()
warm()
// 从此**只让时间往前走**（F1 每步照常自报 ＝ 她还在干活），考勤自己一步都不再跑
for (let i = 0; i < W.SILENT_ROUNDS; i++) capTick('F1', '测试：她还在干活')
check(
  '考勤自己停摆 → 照样被点名（靠的是外面那个时钟，不是它自己的步号）',
  W.silentRounds().some((x) => x.id === 'F34')
)
check('它被点名时，留意栏那行照旧写得出来（由还活着的能力念）', W.watchdogLine().includes('考勤'))

console.log('')
console.log('— ④ 重启不许诬告：上一程的状态 → 从本进程起点重数 —')
wipe()
seed({
  runId: '上一程的-pid',
  baseClock: 1,
  seq: 100,
  clock: 1,
  seen: { F1: 1 },
  owed: { F26: 99, F30: 99 },
  counts: {},
  toolCalls: 0,
  at: '2026-09-26T00:00:00.000Z',
})
W.watchTick()
check('刚重启第 1 步：上一程那笔旧账**不许**算到这一程头上', W.silentRounds().length === 0)

console.log('')
console.log('— ⑤ 节流：同一份告警这小时只念一次，内容变了立刻念 —')
check('第一次：放行', W.watchdogPing('同一份') === true)
check('紧接着再来一次：压住', W.watchdogPing('同一份') === false)
check('内容变了：立刻放行', W.watchdogPing('换了一份') === true)

console.log('')
console.log('— ⑥ 回归：快照必须记在"这一步结束时"（0.76.1 那个 bug 的不变量）—')
// 0.76.1 的病：快照记在**自报之前** ⇒ 下一步永远跟更早那份比 ⇒ 每步都在动的也被算成"僵"（真档案连报 51 步）。
wipe()
warm(W.WARMUP_STEPS + 2)
const st6 = read()
check(
  '① 快照＝这一步结束时的真实计数（记早了下一步就永远跟更早那份比）',
  Number(st6.counts.F1) === Number(CAP_STATS.get('F1')?.count) &&
    Number(st6.counts.F34) === Number(CAP_STATS.get('F34')?.count)
)
check('② 一整段里一个告警都没有', W.silentRounds().length === 0)
// 反证：真停了照样点名 —— 证明上面那条不是把判据改哑了
for (let i = 0; i < W.SILENT_ROUNDS; i++) stepOne({ tool: true, ids: ['F5'] })
check('③ 反证：F26 真停了 3 步 → 照样点名', W.silentRounds().some((x) => x.id === 'F26'))

console.log('')
console.log('— ⑦ idle 的步（子代理 / 非 enter）→ 不许算"每步能力"的留意 —')
// 子代理的**每一步**都从 `f1-reinject.js` 的 `isSubagent` 那儿 return —— 那一步留意栏/体检本来就轮不上。
// 少了这条护栏，派一次子代理连跑三步就会假报一次"留意栏僵了"。
wipe()
warm(W.WARMUP_STEPS + 2)
for (let i = 0; i < W.SILENT_ROUNDS + 2; i++) {
  capTick('F1', '测试：链还在跑')
  W.watchTick('pre-step', true)
}
check('连着 4 个 idle 步 → 注入/体检/留意栏**一个都不许被点名**', W.silentRounds().length === 0)
// 反证：同样几步、**不标 idle**（能力却不露面）→ 照样点名，证明护栏没把判据改哑
for (let i = 0; i < W.SILENT_ROUNDS; i++) {
  capTick('F1', '测试：链还在跑')
  W.watchTick('pre-step')
}
check('反证：不标 idle 就照样点名（护栏没把判据改哑）', W.silentRounds().some((x) => x.id === 'F26'))

wipe()
done()
