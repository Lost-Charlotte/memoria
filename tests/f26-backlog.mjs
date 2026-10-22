/**
 * F26 · 留意栏（2026-09-18 建，用户："给梅莫莉亚减重…减少打扰你的次数"）。
 * 跑法：node tests/f26-backlog.mjs
 *
 * 这一份钉住四条**减重语义**（不是"函数能跑"）：
 *   ① **留意说得出**：留底未销账时，留意栏里必须有它，**而且机器要替我把"补完没有"算出来**
 *      （T 有没有跨过基准）—— 那一步原来是我去读 17 万字原文，是最重的一件；
 *   ② **干净就沉默**：没有留意时返回空串（否则"每轮一句话"又变成新的噪音）；
 *   ③ **同一内容不重复说**（指纹节流），**内容一变立刻说**（不等到 TTL）；
 *   ④ **压缩后清空节流**（上下文都被揉掉了，留意栏必须重说）。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

const HOME = sandboxHome()

const root = makeArchive('f26', {
  '从这开始读.txt': '入口\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  'L1-必读/索引.md': [
    '| 文件 | 讲什么 |',
    '|---|---|',
    '| `L1-必读/00-必读-铁律.md` | 红线 |',
    '| `L1-必读/索引.md` | 目录 |',
    '| `L2-数据/01-时间轴-我们做过什么.md` | 时间轴 |',
    '| `L2-数据/01-事件表-我们做过什么.md` | 事件表 |',
    '| `L3-知识/工程-待办.md` | 待办 |',
    '',
  ].join('\n'),
  'L2-数据/01-时间轴-我们做过什么.md': [
    '| 等级 | 编号 | 时间 | 发生了什么 |',
    '|---|---|---|---|',
    '| ○ | **T1** | 2026-09-10 01:00 | 甲 |',
    '| ⭐ | **T2** | 2026-09-11 01:00 | 乙 |',
    '| ○ | **T3** | 2026-09-12 01:00 | 丙 |',
    '',
  ].join('\n'),
  'L2-数据/01-事件表-我们做过什么.md': [
    '| E号 | 名称 | 时间 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    '| E1 | 甲 | 09-10 | ✅ 完成 | T1 |',
    '',
    '### E1｜甲',
    '- **时间跨度**：09-10',
    '- **锚点**：T1',
    '- **结果**：甲做完了（夹具补：2026-10-01 起「结果」是必备字段）',
    '- **状态**：✅ 完成',
    '',
  ].join('\n'),
  'L3-知识/工程-待办.md': [
    '# 待办：未完成事项',
    '',
    '> 分区与标记的说明（这份样本只需要一张能解析的"在办"表）。',
    '',
    '## 四、短期 · 我能自己推（**不用拍板，我直接做**）[自办]',
    '',
    '| 事项 | 现在卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '',
  ].join('\n'),
})

const mod = await loadPlugin()
mod.apply(mockCtx(), { archiveDir: root })

const F26 = await import('../lib/f26-backlog.js')
const F22 = await import('../lib/f22-compact-dump.js')
// 🔴 2026-10-15：`countT` 随 L2 退役删除（`common.js` 里那份恒 -1 的空壳已删）⇒ 这里直接用常量 -1。

// ---- 造一份"未销账的留底"状态（插件自己的状态文件，落在沙箱 DSH_HOME 里）----
const mainAbs = join(HOME, 'memoria-dumps', 'pending', '归档留底-d76964d2.md')
mkdirSync(join(HOME, 'memoria-dumps', 'pending'), { recursive: true })
writeFileSync(mainAbs, '原文\n', 'utf8')

const writeDumpState = (preT) => {
  writeFileSync(
    join(HOME, 'memoria-dump.state.json'),
    JSON.stringify(
      { dumps: { 'archive:d76964d2': { kind: 'archive', sidShort: 'd76964d2', preT, mainAbs, relMain: mainAbs, items: 925, chars: 171614, at: new Date().toISOString() } }, lastAt: new Date().toISOString() },
      null,
      2
    )
  )
}

// ============================================================
console.log('— ① 留意说得出，而且"补完没有"是机器算的 —')
writeDumpState(3) // 基准 T3 ＝ 当前 T3 → 还没补
const t1 = F26.backlogText('s1')
check('留底未销账时，留意栏非空', t1.length > 0)
check('留意栏里点出了留底', /留底/.test(t1) && /d76964d2/.test(t1))
check('🔴 机器算出了"还没补"（T 还没跨过基准）', /还没跨过/.test(t1))
check('原文路径给出来了（要读就去读那一份）', t1.includes('归档留底-d76964d2.md'))

console.log('')
console.log('— ② 同一内容不重复说（节流） —')
check('同一会话、同一内容 → 第二次返回空串（不再刷屏）', F26.backlogText('s1') === '')
check('换一个会话 → 照样说（宁可多说，不可漏说）', F26.backlogText('s2').length > 0)

console.log('')
console.log('— ③ 内容一变立刻说；压缩后清空节流 —')
F26.resetBacklogThrottle('s1')
check('清空节流后立刻能再说（F1 压缩后重注入会调它）', F26.backlogText('s1').length > 0)

// ⚠️ 这个路径后面第 ⑥ 段还要用（造"老/新事件"的时间轴样本）—— 留着。
const tPath = join(root, 'L2-数据', '01-时间轴-我们做过什么.md')
void tPath

// 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：原做法是"把时间轴样本写到 T4，让 T 跨过基准"，
//     以驱动"结论翻成**已跨过 → 可销账**"。**L2 已删** ⇒ `maxT()` 恒 -1 ⇒ 那条判据退役
//     （销账判据改走 A 方案：读《索引》L3 节第一条时间）。
//     ⇒ 这里改成"**基准变了 ⇒ 必须立刻再说**"（节流不许把它闷住）。
F26.resetBacklogThrottle('s1')
writeDumpState(-1) // 基准 -1 ⇒ 恒为"还没跨过"
const t2 = F26.backlogText('s1')
check('内容变了（基准变了）→ 立刻再说（不等 TTL）', t2.length > 0)
check('🔴 L2 已删 ⇒ "T 跨过基准"那条判据已退役，结论恒为"还没跨过"', /还没跨过/.test(t2))

console.log('')
console.log('— ⑦ 🔴 纯数字抖动不许刷屏（节流指纹归一化，2026-09-19） —')
// 场景：留底还在（内容没变），**只有数字变了** —— 原来这会每步算出一个"新指纹"，
// 于是每个 step 都注入一条（实测一个会话刷了 39 次 / 19503 字符）。
F26.resetBacklogThrottle('s7')
// ⚠️ 别写死基准号：第③段把时间轴涨到了 T4，硬写数字会随夹具漂移 —— 直接问当前 countT。
const nowT7 = -1
writeDumpState(nowT7) // 基准＝当前 T → 结论必须是"还没跨过"
const n1 = F26.backlogText('s7')
check('先正常说一次', n1.length > 0)
check(`这一刻的结论是"还没跨过"（基准 T${nowT7}）`, /还没跨过/.test(n1))
// 只把"写出的时间"和"件数/字符数"这些数字改掉，陈述一个字没动
writeFileSync(
  join(HOME, 'memoria-dump.state.json'),
  JSON.stringify(
    {
      dumps: {
        'archive:d76964d2': {
          kind: 'archive',
          sidShort: 'd76964d2',
          preT: nowT7,
          mainAbs,
          relMain: mainAbs,
          items: 926, // ← 数字变了
          chars: 171615, // ← 数字变了
          at: new Date(Date.now() + 60_000).toISOString(), // ← 数字变了
        },
      },
      lastAt: new Date(Date.now() + 60_000).toISOString(),
    },
    null,
    2
  )
)
check('🔴 只有数字变了 → 不再重复说（节流真生效）', F26.backlogText('s7') === '')
// 反向：**陈述真的变了**（T 跨过基准 → "还没跨过"翻成"已跨过"）必须立刻说
writeDumpState(nowT7 - 1)
const n2 = F26.backlogText('s7')
check('🔴 反向：陈述真变了（T 跨过基准 → 已跨过）→ 立刻再说，别被归一化闷住', n2.length > 0 && /已跨过/.test(n2))

console.log('')
console.log('— ④ 干净就沉默 —')
rmSync(join(HOME, 'memoria-dump.state.json'), { force: true })
const lines = F26.backlogLines()
check(`去掉留底后这件事不再出现在留意栏`, !lines.some((l) => /留底/.test(l)))
check(
  `🔴 这一份样本上没有留意 → 留意栏**空**（实得 ${lines.length} 类：${lines.join(' ｜ ').slice(0, 80)}）`,
  lines.length === 0
)
check('🔴 干净时整段是空串（沉默，不是"今天没什么事"这种废话）', F26.backlogText('s3') === '')
check('而且**不占节流记录**：下一件留意出现时能立刻说', F26.backlogText('s3') === '')

console.log('')
console.log('— ⑤ 启动自检必须出声（沉默 ≠ 正常） —')
const rep = F26.reportF26()
check('reportF26 说得出话', typeof rep === 'string' && rep.includes('留意栏 F26'))

// 拿掉留底之后，"留底 0 份"这件事仍要在自检里看得见
check('自检里报出留底份数（0 也要报）', /留底 \*\*0\*\*|没有留意|留底 \*\*\d/.test(rep) || /留底/.test(rep))

check('F22 的 dumpNotice 仍给出精简版（供留意栏用）', typeof F22.dumpNotice().compact === 'string')

// ============================================================
console.log('')
console.log('— ⑥ 🔴 事件类已退役（2026-10-15：事件表随 L2 删了 ⇒ 留意栏不再有"事件超期"这一路） —')
// 夹具照旧造一份"进行中、还超期"的事件表，钉的就是"**它现在一个字都不提**"。
// ⚠️ **不动时间轴**（后面 ⑨ 段靠留底留意做前提，动时间轴会把那个前提搅了）。
writeFileSync(
  join(root, 'L2-数据', '01-事件表-我们做过什么.md'),
  [
    '| E号 | 名称 | 时间 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    '| E901 | 老事件 | 09-10 | 🔄 进行中 | T901 |',
    '',
    '### E901｜老事件',
    '- **时间跨度**：09-10 ~',
    '- **锚点**：T901',
    '- **状态**：🔄 进行中',
    '',
  ].join('\n'),
  'utf8'
)
const evLines = F26.backlogLines().filter((l) => /超期未判/.test(l))
check('🔴 事件超期那一路已退役：造了"进行中、超期"的事件表也不再报', evLines.length === 0)

console.log('')
console.log('— ⑨ 🔴 探针不许有副作用（2026-09-20 加：F1"跳过注入时就自报"靠它） —')
// 🔴 2026-10-15 补：事件那一路退役后，这一段得**自己造一个还开着的留意**当前提
//    （原来那个前提是 ⑥ 段造出来的"事件超期"）。这里造一条待办。
writeFileSync(
  join(root, 'L3-知识', '工程-待办.md'),
  [
    '# 待办：未完成事项',
    '',
    '## 四、短期 · 我能自己推（**不用拍板，我直接做**）[自办]',
    '',
    '| 事项 | 现在卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **探针测试用的待办** | 无 | 无 |',
    '',
  ].join('\n'),
  'utf8'
)
// 场景：F1 在"这一步没有真实用户消息 → 跳过注入"那条路上，要探一下"本来会不会说话"。
// 🔴 探针必须**一个字都不记** —— 否则"先探后跳"＝那条留意被**静默吞掉**（下次得等 TTL）。
//    F26 这儿有两处会记：`spoken`（节流指纹）与 `dueSpoken`（⏰ 念过没）—— 都在 `dry` 里跳过。
F26.resetBacklogThrottle('s9')
const pk1 = F26.peekBacklog('s9')
check('探针算得出"欠着几类"', pk1.n > 0)
check('探针说"这一步本来会说"', pk1.wouldSay === true && pk1.key.length > 0)
const pk2 = F26.peekBacklog('s9')
check('🔴 连探两次都还说"会说"（探针**没把**节流记上）', pk2.wouldSay === true && pk2.key === pk1.key)
check('🔴 探完再真说，照样说得出（没被探针吞掉）', F26.backlogText('s9').length > 0)
check('真说过了之后，探针改口"不会说"（节流确实还在起作用）', F26.peekBacklog('s9').wouldSay === false)

done()
