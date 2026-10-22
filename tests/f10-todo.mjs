/**
 * F10 待办自动化（`dangan_todo` ＋ 落档时的"顺手写一行"）—— 2026-09-17 凌晨建。
 * 跑法：node tests/f10-todo.mjs
 *
 * 用户当天两句："**你的待办全丢了。去找回来**" ＋ "**先做待办相关的自动化吧。不然你老是忘**"。
 * 所以这个测试钉三件事：
 *   ① **读得对**：只认"待办表"（表头第一格是 事项/事情/待办），**事故章节里那些缩进小表不能当待办**（试跑当场误报过）；
 *   ② **写得对**：`kind='待办'` 落档时，那一行要**真进待办文件最新的那一节**；
 *   ③ **挑得对**：已标完成还留着 / 上游已结案 / 重复 —— 三类都要挑得出，且**不误报**。
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const TODO = [
  '# 待办',
  '',
  '## 二、等用户点头就能做的 [在办]',
  '',
  '| 事项 | 卡在哪 | 怎么算结 |',
  '|---|---|---|',
  '| **甲** | 等一句话 | 做了就结 |',
  '',
  '## 四之九、最新那一节 [自办]',
  '',
  '| 事项 | 卡在哪 | 怎么算结 |',
  '|---|---|---|',
  '| **乙** | 卡在乙 | 乙做完 |',
  '| ✅ **丙** | **已完成** | 已结 |',
  '| **丁（点名 E1）** | 卡在丁 | 看 E1 |',
  '| **乙** | 卡在乙 | 乙做完 |',
  '',
  '## 四之三、事故（这里的小表**不是待办**）',
  '',
  '  | 文件 | 原大小 |',
  '  | --- | --- |',
  '  | 丢了的甲.mp4 | 1 MB |',
  '  | 文件 | 1 MB |',
  '',
  '## 五、已经解决并归档的 [归档]',
  '',
  '| 事情 | 结论 | 归档处 |',
  '|---|---|---|',
  '| 旧事 | 早结了 | 某处 |',
  '',
].join('\n')

const root = makeArchive('f10', {
  'L2-数据/01-时间轴-我们做过什么.md': ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', '| ○ | **T1** | 09-10 01:00 | 甲 |', ''].join('\n'),
  'L2-数据/01-事件表-我们做过什么.md': [
    '| E号 | 名称 | 时间 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    '| E1 | 甲（已结） | 09-10 | ✅ 完成 | T1 |',
    '',
    '### E1｜甲（已结）',
    '- **时间跨度**：09-10',
    '- **锚点**：T1',
    '- **结果**：甲做完了（夹具补：2026-10-01 起「结果」是必备字段）',
    '- **状态**：✅ 完成',
    '',
  ].join('\n'),
  'L3-知识/AI错误总账.md': ['| 编号 | 说明 |', '|---|---|', '| **R1** | 甲 |', ''].join('\n'),
  'L3-知识/工程-待办.md': TODO,
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })
const todoPath = `${root}\\L3-知识\\工程-待办.md`
const read = () => readFileSync(todoPath, 'utf8')

const f10 = await import('../lib/f10-todo.js')

console.log('— ① 读得对 —')
const { items } = f10.openItems()
const names = items.map((i) => i.item.replace(/\*/g, ''))
check(`还开着的条数是 4（甲/乙/丁/E1 / 不含已完成的丙）—— 实得 ${items.length}：${names.join('、')}`, items.length === 4)
check('已标 ✅ 的丙**不在**"还开着"里', !names.some((n) => n.includes('丙')))
check('**缩进小表（事故章节的"文件/原大小"）没被当成待办**', !names.includes('文件') && !names.includes('丢了的甲.mp4'))
check('§五（已解决）那节也没被算成待办', !names.includes('旧事'))

console.log('')
console.log('— ③ 挑得对 —')
const stale = f10.todoStaleCandidates()
const sAll = stale.map((x) => x.msg).join('\n')
check('挑出"已标完成还留着"（丙）', /已经标了完成/.test(sAll) && /丙/.test(sAll))
// 🔴 2026-10-15：**「上游已结案」这条随 L2 退役删除** —— 它要读事件表里那条 E 的状态（事件表已不在档案里）。
//    「该消的」从三类收到**两类**（① 已标完成却还留着 · ③ 同一条出现两次），下面那条数随之改。
check('挑出"重复"（乙 出现两次）', /重复/.test(sAll))
check(`一共 2 类，不许多报（实得 ${stale.length} 条）`, stale.length === 2)

console.log('')
console.log('— ② 写得对（kind=待办 → 落笔半顺手写一行）—')
// 🔴 2026-10-15：改走**织布机**（落档收进 `dangan_weave` 的 `pattern:'落档'`）—— 老入口已删。
const r = await ctx.registered.find((t) => t.name === 'dangan_weave').execute({
  pattern: '落档',
  items: [
    {
      what: '这条是个待办',
      level: '○',
      kind: '待办',
      event: 'E1',
      todoItem: '**新欠的事**',
      todoWhy: '因为新',
      todoGoal: '为了新',
      when: '2026-09-17 05:00',
    },
  ],
  commit: true,
})
check('落笔报成功', r.ok === true, String(r.text).slice(0, 300))
check('摘要里点出"加一行到待办"', /待办：加一行到/.test(r.text))
const after = read()
check('待办文件里真的有那一行了（三段：内容/原因/目的）', after.includes('| **新欠的事** | 因为新 | 为了新 |'))
check('新行插在**最新那一节**（四之九）的表尾', after.indexOf('新欠的事') > after.indexOf('## 四之九') && after.indexOf('新欠的事') < after.indexOf('## 四之三'))
check('落完机械体检 0 错 0 提示（不改坏别处）', mod.__internals.checkArchive().filter((x) => x.lv === '错').length === 0)

console.log('')
console.log('— ②b 待办文件的"写入点"找不到时不猜 —')
const rootBad = makeArchive('f10-bad', {
  'L3-知识/工程-待办.md': ['# 待办', '', '## 一、随便什么', '', '| 事项 | 卡在哪 | 怎么算结 |', '|---|---|---|', ''].join('\n'),
})
mod.__internals.CFG.archiveDir = rootBad
let threw = ''
try {
  f10.planTodoAdd({ item: '试试' })
} catch (e) {
  threw = e.message
}
check('没有"四之N"那种节 → 抛错（不插到错的节里）', /找不到/.test(threw), threw)
mod.__internals.CFG.archiveDir = root

// ============================================================
// ③ 「查重」—— 2026-09-17 晚加
//    用户原话："**我觉得需要一个脚本来查重。每次都让你手动查重算什么。
//    我们要的是梅莫莉亚高度自动化。减少你在文档上分的心。不然要梅莫莉亚干嘛**"
//
//    ⚠️ 这一节的重点**不是"算法跑得动"，而是"分界在哪"**：
//      查重最怕 **误报**（把该记的事挡住）与 **漏报**（措辞一变就查不出）。
//      所以下面钉了一组**正样本**（同一件事的不同措辞，必须判出来）
//      与一组**硬负样本**（看起来像、其实是两件事，一条都不许判重）。
//      **改 `TODO_DUP` 里任何一个阈值，都会在这里立刻现形。**
// ============================================================
console.log('')
console.log('— ③ 查重的分界：正样本（改措辞也算同一件事）—')

const POS = [
  ['重启一次控制台 —— 让 0.23.0（F20/F21 ＋ 内核加固）真正生效', '重启一次控制台（这一版改完还没重启）'],
  ['把工具箱里最后两个脚本（改档.mjs / 档案结构地图.mjs）也挪走', '工具箱里最后两个脚本要删'],
  ['① 指纹信号可疑：那个"代码指纹"可能读错', '① 指纹信号可疑："指纹变了没有"可能不可靠'],
  ['门反复拦的时候要写"停"', '❗ 判据过时、门反复拦 → 明写"停"，别改数据，别改判据'],
]
for (const [a, b] of POS) {
  const r = f10.isSameTodo(a, b)
  check(`判出同一件事（${r.why || '-'}）｜ ${a.slice(0, 14)}…`, r.same, `dice ${(r.dice * 100).toFixed(0)}% cover ${(r.cover * 100).toFixed(0)}%`)
}

console.log('')
console.log('— ③b 查重的分界：硬负样本（像，但不是一回事）—')
const NEG = [
  ['① 指纹信号可疑："指纹变了没有"可能不可靠', '③ 新能力的"落地验收"还没走'],
  ['② 我误用了 Remove-Item（自己的违规）', '③ 新能力的"落地验收"还没走'],
  ['重启一次控制台（0.23.0 生效）', '重启之后要把工具箱那两个原件删掉'],
  ['④ 文案外置', '⑤ 配置声明成 schema'],
  ['GTS 件数有四个口径，互相打架', 'U 盘在线时才可测的其它数字'],
  ['① 批 2 余下："元数字"现算', '③ 批 2 余下："第 N 行"式引用'],
  ['④ 批 3 余下：记录-U盘布局与角色的数字块只留指针', '⑤ 批 4：记录类的"数字/进度"块改成脚本生成＋日期戳'],
  ['给档案加一份"每月一次的自检报告"', '⑤ 待办文件自己的 §四之N 在涨'],
  // 🔴 2026-09-19：**真档案里正在并排存在的那两条**（都带 `⏰ 9/19 16:00`）——
  //    用户当天定"查重不检查闹钟这一栏"，可 `stripDue` 只认带年份的写法、
  //    认不出待办里真用的短写法 `⏰ 9/19 16:00` → 这两条一直被体检报成"重复"。
  //    两条都要能并排存在（一条讲 **B 裁剪有没有丢信息**，一条讲 **体检明细伤没伤功能**）。
  [
    '**⏰ 9/19 16:00 后自查三档裁剪有没有丢信息（拿原文逐条对比）**',
    '**⏰ 9/19 16:00 复查：体检明细改按需后有没有伤到实际功能**',
  ],
  // 同一对，但这次写成**带年份的全写法** —— 两种写法都不许判重（回归钉住剥离器的两种形状）
  [
    '**⏰ 2026-09-19 16:00 后自查三档裁剪有没有丢信息（拿原文逐条对比）**',
    '**⏰ 2026/9/19 16:00 复查：体检明细改按需后有没有伤到实际功能**',
  ],
]
for (const [a, b] of NEG) {
  const r = f10.isSameTodo(a, b)
  check(`没有误判｜ ${a.slice(0, 14)}…`, !r.same, `dice ${(r.dice * 100).toFixed(0)}% cover ${(r.cover * 100).toFixed(0)}%`)
}
check('同一句话判"完全相同"', f10.isSameTodo('把工具箱那两个原件删掉', '把工具箱那两个原件删掉').exact)
check('空串不炸', f10.findTodoDuplicates('').length === 0)

console.log('')
console.log('— ③c 落笔时的行为：已记过就不写 · force 才写 —')
const dupRoot = makeArchive('f10-dup', {
  'L3-知识/工程-待办.md': [
    '# 待办',
    '',
    '## 四之七、最新那一节 [在办]',
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **重启一次控制台 —— 让 0.23.0 真正生效** | 没重启 | 重启 |',
    '| **重启一次控制台（这一版改完还没重启）** | 没重启 | 重启 |',
    '| **给档案加一份每月的自检报告** | 没有 | 加上 |',
  ].join('\n'),
})
mod.__internals.CFG.archiveDir = dupRoot

const self = f10.todoSelfDuplicates()
check('表内两条"重启控制台"被判为同一件事', self.length === 1 && self[0].line !== self[0].otherLine, JSON.stringify(self[0] ?? {}))
const stale2 = f10.todoStaleCandidates()
check('"该消的"里带上这条重复', stale2.some((s) => String(s.msg).includes('是同一件事')), JSON.stringify(stale2.map((s) => s.msg).slice(0, 2)))

const planDup = f10.planTodoAdd({ item: '重启一次控制台（这一版改完还没重启）', stuck: 'x', done: 'y' })
check('已记过的 → skip，且不产生任何 op', planDup.skip === true && planDup.op === undefined, JSON.stringify(planDup).slice(0, 200))
const planNew2 = f10.planTodoAdd({ item: '给工具箱加一个批量重命名的小工具', stuck: 'x', done: 'y' })
check('全新的一条 → 正常出 op', !planNew2.skip && planNew2.op?.op === 'insertAfter', JSON.stringify(planNew2).slice(0, 160))
const planForce = f10.planTodoAdd({ item: '重启一次控制台（这一版改完还没重启）', stuck: 'x', done: 'y', force: true })
check('force:true → 照写（确实要重复登记的口子）', !planForce.skip && planForce.op?.op === 'insertAfter')
mod.__internals.CFG.archiveDir = root

// ============================================================
// ③d 「已完成」写在**哪一格都算** —— 2026-09-18 加
//   出处是当天在真档案上撞到的：§四 那条办完的待办，我把说明写进**第 4 格**，
//   而 `closed` 当时只认 `head`/`c[2]`/`c[3]` → `clean` 报"**没有已标完成却还留着的条目**"。
//   ⚠️ 那句话是**假的**：不是"不用清"，是**看不见**。
//   真档案里每张待办表**都只有 3 列**，所以 `c[3]`＝"怎么算结" —— 而"把 ✅ 写进怎么算结"
//   正是真档案里的写法（我 2026-09-18 就是这么写的）。这一组把两件事都钉住：
//     ① 3 列表里 ✅ 写在**第 3 格**要认；② 表**多一列**时 ✅ 写在**第 4 格**也要认。
// ============================================================
console.log('')
console.log('— ③d 已完成写在哪一格都算（3 列与 4 列）—')
const colRoot = makeArchive('f10-cols', {
  'L2-数据/01-时间轴-我们做过什么.md': ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', ''].join('\n'),
  'L2-数据/01-事件表-我们做过什么.md': ['| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |', '|---|---|---|---|---|', ''].join('\n'),
  'L3-知识/工程-待办.md': [
    '# 待办',
    '',
    '## 四、短期 · 我能自己推 [自办]',
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **甲** | 卡在甲 | 甲做完 |',
    '| **乙** | 卡在乙 | ✅ 2026-09-18 已办：乙做完了 |',
    '',
    '## 三、短期 · 等你点头 [在办]',
    '',
    '| # | 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|---|',
    '| 1 | **丙** | 卡在丙 | 丙做完 |',
    '| 2 | **丁** | 卡在丁 | 丁做完 | ✅ 2026-09-18 已办 |',
  ].join('\n'),
})
mod.__internals.CFG.archiveDir = colRoot
const colItems = f10.openItems().items
const colNames = colItems.map((i) => i.item.replace(/\*/g, ''))
// ⚠️ 4 列那张表是**序号列打头**（`| # | 事项 | … |`）—— 解析器认的是 `cell[1]`，于是
//    `item` 是序号本身（"1"）。这条断言因此看**行号**（丙＝第 10 行、丁＝第 11 行），
//    看名字会把"序号打头"这件事误读成"丙丢了"。
const colLines = colItems.map((i) => i.line)
check(`3 列：✅ 写在"怎么算结"那格 → 认（乙 不算还开着）｜ 实得：${colNames.join('、')}`, colNames.includes('甲') && !colNames.includes('乙'))
check(`4 列（序号打头）：事项取第 2 格 ＋ ✅ 写在**第 4 格** → 也认（丙在、丁不在）｜ 实得：${colNames.join('、')}｜行号：${colLines.join('、')}`, colNames.includes('丙') && !colNames.includes('丁'))
mod.__internals.CFG.archiveDir = root

// ============================================================
// ③e §长期 的条目也要算"还开着" —— 2026-09-19 加
//   真机踩的坑（**用户 2026-09-19 看面板当场抓出来的**）：写入侧 `planTodoAdd` 早就认
//   "**长期（不论谁）→ `[长期]`**"，而读取侧 `isActionable` 的正则里**没有 `[长期]`**
//   → 长期待办**写进去就查不到**：面板一条都不显示、`dangan_todo` 不报、留意栏不计。
//   典型的"**读写两把尺子**"（同族：待办超长判据漏了 `s.actionable` 那次）。
//   两条断言：① `[长期]` 要进 openItems；② `[已决]`（不许再问）**仍然不算** ——
//   别为了补长期，把"决定存档"也一起放进来（那是 2026-09-19 上一版判据栽过的坑）。
// ============================================================
console.log('')
console.log('— ③e §长期 也算"还开着"（读写同一把尺子）—')
const longRoot = makeArchive('f10-long', {
  'L2-数据/01-时间轴-我们做过什么.md': ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', ''].join('\n'),
  'L2-数据/01-事件表-我们做过什么.md': ['| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |', '|---|---|---|---|---|', ''].join('\n'),
  'L3-知识/工程-待办.md': [
    '# 待办',
    '',
    '## 一、不许再问（用户已拍板）[已决]',
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **别问了** | 已拍板 | 不动 |',
    '',
    '## 四、短期 · 我能自己推 [自办]',
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **甲** | 卡在甲 | 甲做完 |',
    '',
    '## 长期 · 不急（想做时再说）[长期]',
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **慢慢来** | 不急 | 想做时做 |',
  ].join('\n'),
})
mod.__internals.CFG.archiveDir = longRoot
const longNames = f10.openItems().items.map((i) => i.item.replace(/\*/g, ''))
check(`§长期 的条目要进 openItems（否则"写进去等于没写"）｜ 实得：${longNames.join('、')}`, longNames.includes('慢慢来'))
check(`反向：\`[已决]\`（不许再问）**仍不算**还开着 —— 别把决定存档也放进来｜ 实得：${longNames.join('、')}`, !longNames.includes('别问了'))
mod.__internals.CFG.archiveDir = root

// ============================================================
// ④ 节标记必须唯一 ＋ **空表也写得进去** —— 2026-09-18 深夜加
//   真机踩的坑：§三（等你点头）与 §四（我能自己推）**都带 `[在办]`**，而 §四 当时刚被清空
//   （表里一行数据都没有）→ 选节判据里的 `rows.length > 0` 把它跳过 →
//   一条"我能自己推"的待办**被塞进了 §三**（而 T266 那次还以为"改取哪一端"就能修好）。
//   两处根因，下面几条各钉一个：
//     ① 两节标记不同 → 默认落 `[自办]`；② `[自办]` 那节是**空表** → 照样写得进去；
//     ③ 两节都写 `[在办]` → `sectionMarkDupes` 判得出来，且**体检按"错"报**。
// ============================================================
console.log('')
console.log('— ④ 节标记唯一 ＋ 空表也写得进去 —')
const DUP_TODO = (mark) =>
  [
    '# 待办',
    '',
    '## 三、短期 · 等你点头 [在办]',
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **甲** | 卡在甲 | 甲做完 |',
    '',
    `## 四、短期 · 我能自己推 [${mark}]`,
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **乙** | 卡在乙 | 乙做完 |',
    '',
  ].join('\n')
const dupeRoot = makeArchive('f10-dupe', {
  'L2-数据/01-时间轴-我们做过什么.md': ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', ''].join('\n'),
  'L2-数据/01-事件表-我们做过什么.md': ['| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |', '|---|---|---|---|---|', ''].join('\n'),
  'L3-知识/工程-待办.md': DUP_TODO('自办'),
})
const dupeFile = `${dupeRoot}\\L3-知识\\工程-待办.md`
mod.__internals.CFG.archiveDir = dupeRoot

check('标记各不相同时：不报重复', f10.sectionMarkDupes().length === 0)
const okPlan = f10.planTodoAdd({ item: '一条我自己能推的', stuck: 'x', done: 'y' })
check('🔴 落档写待办**默认进 `[自办]` 那一节**（不是 `[在办]`）', okPlan.where.includes('我能自己推'), okPlan.where)

// ② 空表（表里一行数据都没有，只剩表头与分隔行）→ 仍应写得进去
writeFileSync(
  dupeFile,
  ['# 待办', '', '## 三、短期 · 等你点头 [在办]', '', '| 事项 | 卡在哪 | 怎么算结 |', '|---|---|---|', '| **甲** | 卡在甲 | 甲做完 |', '', '## 四、短期 · 我能自己推 [自办]', '', '| 事项 | 卡在哪 | 怎么算结 |', '|---|---|---|', ''].join('\n'),
  'utf8',
)
const emptyPlan = f10.planTodoAdd({ item: '往空表里落一条', stuck: 'x', done: 'y' })
check(
  '🔴 **空表也写得进去**（锚点用分隔行；原来会退到别的节去）',
  emptyPlan.where.includes('我能自己推') && emptyPlan.op?.op === 'insertAfter' && /-{2,}/.test(String(emptyPlan.op.expect)),
  `${emptyPlan.where} ｜ expect=${String(emptyPlan.op?.expect).slice(0, 20)}`,
)

// ③ 两节都写 `[在办]` → 机器判得出来，且体检按"错"报
writeFileSync(dupeFile, DUP_TODO('在办'), 'utf8')
const dup = f10.sectionMarkDupes()
check('🔴 两节都写 `[在办]` → 判出重复（数一数就知道，不靠人记得）', dup.length === 1 && dup[0].mark === '在办', JSON.stringify(dup).slice(0, 160))
const { checkArchive } = await import('../lib/f5-check.js')
const dupIssues = checkArchive()
check(
  '🔴 并且**体检按"错"报出来**（标记是"定位那一节"的唯一依据，重复＝不确定）',
  dupIssues.some((x) => x.lv === '错' && /语义标记\*\*重复\*\*/.test(x.msg)),
  dupIssues.map((x) => `${x.lv}:${x.msg.slice(0, 36)}`).join(' ｜ '),
)
mod.__internals.CFG.archiveDir = root

// ④ 🔴 **一条待办只写一件事**（2026-09-19 用户点出那条 F22/F23 混装待办）
//   强信号 → 拒收；弱信号 → 放行，但回执里点一句。**闸门不许误伤单一件事**。
const throwOf = (fn) => {
  try {
    fn()
    return ''
  } catch (e) {
    return String(e?.message ?? e)
  }
}
const twoA = throwOf(() => f10.planTodoAdd({ item: '重启后确认 F22/F23 两条留底路都自动写骨架', stuck: 'x', done: 'y' }))
check('🔴 混装（编号斜杠 F22/F23）→ **拒收**，不写进待办', /一条只写一件事/.test(twoA), twoA.slice(0, 80))
const twoB = throwOf(() => f10.planTodoAdd({ item: '确认 F23 写骨架 ＋ 顺手验 F22', stuck: 'x', done: 'y' }))
check('🔴 混装（加号 ＋）→ 也拒收', /一条只写一件事/.test(twoB), twoB.slice(0, 80))
const twoC = throwOf(() => f10.planTodoAdd({ item: '验 F22 以及 F23 的骨架', stuck: 'x', done: 'y' }))
check('🔴 混装（"以及"）→ 也拒收', /一条只写一件事/.test(twoC), twoC.slice(0, 80))
const oneOk = f10.planTodoAdd({ item: '重启后确认 F22 会自动写骨架', stuck: 'x', done: 'y' })
check(
  '✅ **单一件事照样写得进去**（闸门不误伤）',
  oneOk.op?.op === 'insertAfter' && !oneOk.warn,
  `${oneOk.where} ｜ warn=${oneOk.warn ?? '—'}`,
)
const weak = f10.planTodoAdd({ item: '把快照、回滚都改成逐字节', stuck: 'x', done: 'y' })
check(
  '⚠️ 弱信号（顿号）→ **放行**，但回执里点一句"若其实是两件事就拆"',
  typeof weak.warn === 'string' && /一条只写一件事/.test(weak.warn),
  String(weak.warn ?? '（没有 warn）').slice(0, 80),
)

// ⑤ 🔴 **体检也要抓"手工绕过闸门"的**（2026-09-19）—— 闸门只管机器写的那条路
//    ⚠️ 这一段读的是 dupeRoot 那份待办，而 ④ 之前 `CFG.archiveDir` 已被指回 root —— 先指回来
mod.__internals.CFG.archiveDir = dupeRoot
writeFileSync(
  dupeFile,
  [
    '# 待办',
    '',
    '## 四、短期 · 我能自己推 [自办]',
    '',
    '| 事项 | 原因 | 目的 |',
    '|---|---|---|',
    '| **重启后确认 F22/F23 两条留底路都自动写骨架（日志出现「F22 骨架已写出」或「F23 骨架已写出」）** | 骨架没验 | 读骨架 |',
    '| **重启后确认 F22 会自动写骨架** | 骨架没验 | 读骨架 |',
    '',
    '## 一、不许再问（用户已拍板）[已决]',
    '',
    '| 事项 | 原因 | 目的 |',
    '|---|---|---|',
    '| **1 备案表：`考试文件\\` 根目录那份 `教育部学历证书电子注册备案表_陈辰.pdf`（481,144 B）要不要移进兰科芯根目录的 `个人资料\\`** | **不动** | **留在原地，两份都要留、不许删（用户原话）** |',
    '',
  ].join('\n'),
  'utf8',
)
const tooLong = f10.findTodoTooLong()
check(
  '🔴 体检只量**真待办**那一档：`[已决]`（不许再问）的长条目**不报**，`[自办]` 的超长条目才报',
  tooLong.length === 1 && tooLong[0].twoThings === true && tooLong[0].len > 40,
  JSON.stringify(tooLong).slice(0, 130),
)
const twoIssues = checkArchive()
check(
  '🔴 并且**体检按"提示"汇总报出来**（该不该拆是判断，但不许静默）',
  twoIssues.some(
    (x) =>
      x.lv === '提示' &&
      /超过 40 字/.test(x.msg) &&
      /决定存档/.test(x.msg) &&
      /不要为了这事丢失信息/.test(x.msg),
  ),
  twoIssues
    .filter((x) => x.lv === '提示')
    .map((x) => x.msg.slice(0, 40))
    .join(' ｜ ')
    .slice(0, 130),
)

done()
