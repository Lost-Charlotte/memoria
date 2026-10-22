/**
 * 能力「干活计数」——回答一个问题：**它到底动过没有？**
 *
 * 为什么要有这套断言（2026-09-17，事件 E62 / 锚点 T199）：
 *   档案里反复吃过"沉默 ≠ 正常"的亏（《总账》R26）：哨兵只在出事时出声，于是"没出声"
 *   分不清是"没问题"还是"它瞎了"。启动自检只能报"读到了什么"，**报不出"这一程动过几次"**。
 *
 * 跑法：node tests/capstats.mjs（全程 mock，不碰真档案 / 不碰 ~/.dsh）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('cap', {
  '从这开始读.txt': ['DeepSeek 档案 —— 从这开始读', 'L1-必读 ... 先读这一层', ''].join('\n'),
  'L1-必读/00-必读-铁律.md': ['# 必读铁律', '1. 凡批量、凡写脚本，先在样本上试跑。', ''].join('\n'),
  'L3-知识/某记录.md': ['- 这条口径**已作废**，别再用。', ''].join('\n'),
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root, entryFile: '从这开始读.txt', tieDir: 'L1-必读', tieNameHint: '铁律' })

const S = mod.__internals.CAP_STATS
const report = mod.__internals.capReport
const countOf = (id) => S.get(id)?.count ?? 0

const gateLogText = () => {
  try {
    return readFileSync(join(process.env.DSH_HOME, 'memoria-gate.log'), 'utf8')
  } catch {
    return ''
  }
}
const capLineCount = () => gateLogText().split('[干活统计]').length - 1

console.log('')

// --- 一、起点：谁动过、谁没动过，必须分得清 ---------------------------------
check('启动自检扫了作废口径 → F2 自己记了一笔（"自报工作量"的机械版）', countOf('F2') >= 1)
check('F2 那一笔带**它扫到了几条**', /条作废口径/.test(S.get('F2')?.note ?? ''))
check('F1 在没有任何压缩之前**一次都没动过**（这就是"没动"的证据）', countOf('F1') === 0)
check('没动过的能力**不出现在** capReport 里（没动 ≠ 出错，但必须看得出来）', !report().includes('F1='))
check('capReport 非空（F2 动过了）', report().length > 0)

// --- 二、真干活就记一笔，而且带"干了多少" -----------------------------------
const compact = ctx.handlers['session/event']
const preStep = ctx.handlers['agent/pre-step']
const userMsg = { role: 'user', id: 'u1', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }

compact({ id: 'S1' }, { type: 'compaction/end', data: {} })
check('压缩落地本身也算 F1 的干活（否则"它没动"会被误读成"没压缩"）', countOf('F1') === 1)
check('那一笔写明是「压缩后清留意栏节流」（重注入砍了，保住的就是这条能力）', (S.get('F1')?.note ?? '').includes('压缩后清留意栏节流'))

// ⚠️ 2026-09-26 改（与下面 F5 那条**同一个理由**）：F1 现在**每步都"到场就记一笔"**
//    （`capTick('F1','到场')` —— 修的是"它每步都在跑、却只在真注入时才自报，于是被考勤判成僵"）。
//    所以这里不能再写"等于 2"，只能问"**比刚才多了没有**"。**F1 每步那一笔**（`到场`）照旧要有。
const f1BeforeInject = countOf('F1')
await preStep({ agent: { session: { id: 'S1', header: {} } }, messages: [], signal: {} }, async () => ({
  kind: 'enter',
  messages: [userMsg],
}))
check(`走一步 pre-step → F1 记一笔（${f1BeforeInject} → ${countOf('F1')}）`, countOf('F1') > f1BeforeInject)
check(`走动一步，F1 那一笔写的是「在岗标记」（重注入砍了，每步注入的就是它；实得：${S.get('F1')?.note ?? '（无）'}）`, /在岗标记|到场/.test(S.get('F1')?.note ?? ''))

// ⚠️ 2026-09-18 改"记一笔"的判据：**从"等于 1"改成"比刚才多 1"**。
//    起因是 F26（留意栏）在启动自检里也要看一眼体检错数 → 它在 apply 阶段就调过一次
//    `checkArchive()`，于是 F5 的计数**开局就不是 0**。断言写成"等于 1"会把
//    "**别的东西也真跑了一次体检**"错报成缺陷 —— 那正是"把正常运行当成 bug"的形状。
const f5Before = countOf('F5')
mod.__internals.checkArchive()
check(`体检跑一次 → F5 记一笔（${f5Before} → ${countOf('F5')}）`, countOf('F5') === f5Before + 1)
check('F5 那一笔带**错数**（"0 错"和"它没跑"必须能分开）', /^\d+ 错$/.test(S.get('F5')?.note ?? ''))

check('capReport 现在含 F1 与 F5', report().includes('F1=') && report().includes('F5='))

// --- 三、回合结束写一行，但**只在有变化时**写（防日志噪音） -------------------
const turnStop = ctx.handlers['agent/turn-stopping']
check('闸门钩子挂上了（统计行就写在这个日志里）', typeof turnStop === 'function')

turnStop({ agent: { session: { id: 'S1', header: {} } } })
const n1 = capLineCount()
check('回合结束把"干活统计"写进了闸门日志', n1 >= 1)
check('那一行里有 F1 与 F5 的计数', /F1=\d+/.test(gateLogText()) && /F5=\d+/.test(gateLogText()))

turnStop({ agent: { session: { id: 'S1', header: {} } } })
const n2 = capLineCount()
check('统计没变化时**不再重复写**（否则每回合长一行废话、把真事件淹掉）', n2 === n1)

// 再干一次活 → 有变化 → 必须再写一行
mod.__internals.checkArchive()
turnStop({ agent: { session: { id: 'S1', header: {} } } })
check('活儿变了 → 又写一行（证明"不重复写"不等于"写一次就死"）', capLineCount() === n1 + 1)

// --- 四、子代理不参与（免得拿子代理的回合冒充主线的证据） ---------------------
const n3 = capLineCount()
turnStop({ agent: { session: { id: 'SX', header: { origin: 'subagent' } } } })
check('子代理回合不写统计行', capLineCount() === n3)

// --- 五、机器判据本身：hook 型能力"装了等于没装"能被看出来 -------------------
// 判据（照 C 路调研）：`kind === 'hook'` 却整场没出现过 → 装了等于没装。
// 这里只验"清单里 hook 型有哪些、以及它们的计数是可读的"，不去断言"必须非 0"
// —— 因为样本环境本来就不会触发所有钩子（那种断言只会变成永久假告警）。
const ids = [...S.keys()]
check('计数表里只有短代号（F/R + 数字），没有脏数据', ids.length > 0 && ids.every((i) => /^[FR]\d+$/.test(i)))
check('同一个代号只占一格（Map 天然保证，这里钉住它）', new Set(ids).size === ids.length)

done()
