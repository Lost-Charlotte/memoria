/**
 * F12 · 预算（**现在只剩"工具输出"那一半**）。跑法：node tests/f12-budget.mjs
 *
 * 🔴 2026-09-30 注：原来前半测的「**压缩后重注入的注入预算**」随那套机制一起砍了（用户 2026-09-29 拍板「砍 1」）——
 *   那一段断言已就地作废（下面被注释掉的那块，原文保留只作史证，照 W8）；
 *   `fitSections` / `BUDGET` 仍被留意栏那条路用着，所以下面第一、二段照留。
 *
 * 这一套的重点不是"函数能跑"，而是三条**原则**不许被绕过（见 `lib/f12-budget.js` 顶部）：
 *   ① **默认档不许砍正常内容**（上限按真档案实测体积留了余量）；
 *   ② **砍了就报出来 + 带引流后缀**（截断是引流不是损失）；
 *   ③ **用量到 80% 必须自报**（"接近上限"不能等被砍了才知道）。
 * ⚠️ 一个"永不触发"的机制等于死代码 —— 所以这里既要测"正常不触发"，也要测"超了就真动手"。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'
import { BUDGET, TOOL_OUTPUT, capToolOutput, fitSections, truncateLine, TRUNCATION_SUFFIX } from '../lib/f12-budget.js'

sandboxHome()

/** 把体积撑到指定字符数（中文按 UTF-16 一单元算，不会劈字）。 */
const filler = (n, tag = '内容') => {
  let s = ''
  while (s.length < n) s += `${tag}：这是一行用来把体积撑到指定长度的文字。\n`
  return s.slice(0, n)
}

// ============================================================
// 一、纯函数：截断本身（照 layered 那份的三条做法）
// ============================================================
console.log('')

check('不超限 → 原样返回（一个字符都不动）', truncateLine('短行', 100) === '短行')
check('超限 → 截断并**带上引流后缀**（告诉模型全文在哪）', truncateLine(filler(300), 100).endsWith(TRUNCATION_SUFFIX))
check('截断后**总长不超过上限**（后缀也算在内）', Array.from(truncateLine(filler(300), 100)).length <= 100)
check('非正的上限 / 没给上限 → 不截断（当成"没预算"）', truncateLine('abc', 0) === 'abc' && truncateLine('abc', undefined) === 'abc')

// 按 code point 截断：代理对（emoji / 生僻字）不许被劈成半个
const emoji = '🐳'.repeat(50) // 每个 emoji 是 2 个 UTF-16 单元
const cutEmoji = truncateLine(emoji, 21)
check('按 code point 截断：**不劈开代理对**（否则会留下半个字符）', !/[\uD800-\uDBFF]$/.test(cutEmoji.replace(TRUNCATION_SUFFIX, '')))
check('截断 emoji 串：留下的鲸鱼是完整的', (cutEmoji.match(/🐳/g) ?? []).length >= 1)

// 上限比后缀还短：干脆不贴后缀（截出比后缀还短的行没有意义）
const tiny = truncateLine(filler(200), 10)
check('上限比后缀还短 → 不贴后缀（截出比后缀还短的行没意义）', tiny.length === 10 && !tiny.includes(TRUNCATION_SUFFIX))

// ============================================================
// 二、纯函数：装配（单块上限 / 总量上限 / 报警）
// ============================================================
const budget = { ...BUDGET, maxTotalChars: 1000, maxEntryChars: 4000, maxTieChars: 8000, maxVoidChars: 500, maxVoidItemChars: 50, warnRatio: 0.5 }

const okFit = fitSections([{ label: 'A', text: filler(300, 'A') }], budget)
check('装得下 → 不砍、不报', okFit.cut.length === 0 && okFit.warn === false)

const bigFit = fitSections([{ label: '大块', text: filler(5000), max: 400 }], budget)
check('单块超上限 → 截断，并且**被记进 cut**（不许静默）', bigFit.cut.some((c) => c.includes('大块')))
check('被截断的那块带引流后缀', bigFit.parts.join('').includes(TRUNCATION_SUFFIX))

const overFit = fitSections(
  [
    { label: '甲', text: filler(600, '甲') },
    { label: '乙', text: filler(600, '乙') },
  ],
  budget,
)
check('总量装不下 → **整块丢弃**（尾部先丢），并记进 cut', overFit.cut.some((c) => c.includes('装不下')))
check('丢弃后总量不超上限', overFit.used <= budget.maxTotalChars)

const perLineFit = fitSections([{ label: '清单', text: `${filler(200, '一')}\n${filler(200, '二')}`, perLine: 50 }], budget)
check('逐行上限生效（作废清单：一条一行，长的先截）', perLineFit.parts.join('').split('\n').every((l) => Array.from(l).length <= 50))

const warnFit = fitSections([{ label: '甲', text: filler(900, '甲') }], budget)
check('用量超过 warnRatio → warn=true（要自报）', warnFit.warn === true)

// ============================================================
// 三、接进 F1：真档案量级**不许被动**，超了才动
// ============================================================
const root = makeArchive('f12', {
  // 照真档案的实测量级：入口 2,107 字符 / 铁律 11,169 字符
  '从这开始读.txt': filler(2107, '入口'),
  'L1-必读/00-必读-铁律.md': filler(11169, '铁律'),
  'L3-知识/某记录.md': ['- 这条口径**已作废**，别再用。', '- 那条也**已撤销**了。', ''].join('\n'),
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root, entryFile: '从这开始读.txt', tieDir: 'L1-必读', tieNameHint: '铁律' })

const INF = mod.__internals

/* 🔴 2026-09-30：以下这一整段测的是「压缩后重注入」的注入预算 —— 那套机制 2026-09-29 已整条砍掉，
   断言的标的（`INF.buildReinjection()` / `INF.lastBudgetInfo()` / `CFG.budget`）**一个都不存在了**
   ⇒ 就地作废，原文保留只作史证（照 W8）。现在还成立的是「工具输出」那一半（下面第四段）。
const text1 = INF.buildReinjection()
const info1 = INF.lastBudgetInfo()
check('默认档：真档案量级（入口 2,107 + 铁律 11,169）**一个字都不砍**', info1.cut.length === 0)
check('默认档：used 与真实体积相符（不虚报也不漏报）', info1.used > 13000 && info1.used < 14000)
check('默认档：没到 80% → 注入正文里**不出现**预算警告（不制造噪音）', !text1.includes('已用掉预算的'))
check('默认档：注入正文里**不出现**"有内容被截断"', !text1.includes('有内容被截断'))
check('入口与铁律都还在（预算没把正常内容吃掉）', text1.includes('入口：这是一行') && text1.includes('铁律：这是一行'))
check('注入体积 / 上限都被记下来了（干活统计要带上限一起看）', info1.limit === BUDGET.maxTotalChars)

// ---- 把预算调小（顺便验证"可配置"）：超了就必须真动手、真报出来 ----
// 注意 `maxTotalChars: 2000` + `warnRatio: 0.5` → 阈值 1000；砍完仍有 ~1400（入口 500 + 铁律 800 + 清单），
// 所以这条同时压住"warn 会亮"与"两块单块上限都真的生效"。
INF.CFG.budget = { maxTotalChars: 2000, maxEntryChars: 500, maxTieChars: 800, maxVoidChars: 400, maxVoidItemChars: 60, warnRatio: 0.5 }
const text2 = INF.buildReinjection()
const info2 = INF.lastBudgetInfo()
check('调小预算后：**真的动手了**（有内容被砍）', info2.cut.length > 0)
check('被砍的事实**写进了注入正文**（模型自己也能看见）', text2.includes('有内容被截断'))
check('被砍的每一处都点名了原因', info2.cut.every((c) => /单块超|装不下/.test(c)))
check('截断处带引流后缀（指向 dangan_search）', text2.includes(TRUNCATION_SUFFIX))
check('用量过半 → 注入正文里**自报百分比**', text2.includes('已用掉预算的'))
check('自报里同时给出"用了多少 / 上限多少"', /（\d+\/\d+ 字符）/.test(text2))

// 收尾：把预算还原，别影响别的测试（同一进程内 CFG 是共享的）
INF.CFG.budget = null
check('预算可还原（改成 null 就回到默认档）', INF.buildReinjection().length > 0 && INF.lastBudgetInfo().limit === BUDGET.maxTotalChars) */
check('🔴 「压缩后重注入」那套注入预算已整条砍掉（模块不再导出它）', INF.buildReinjection === undefined && INF.lastBudgetInfo === undefined)

// ============================================================
// 四、工具输出的预算（F12 的第二半）—— 重中之重：**别把最要紧的截掉**
// ============================================================
const many = Array.from({ length: 10 }, (_, i) => `第 ${i} 行`).join('\n')

const okOut = capToolOutput(many, { maxLines: 50 })
check('工具输出不超限 → **原样返回**（一个字都不加工）', okOut.cut === false && okOut.text === many)

const headCut = capToolOutput(many, { label: '甲工具', maxLines: 4 })
check('超行数 → 默认只留**前** N 行', headCut.text.includes('第 0 行') && !headCut.text.includes('第 9 行'))
check('截断了**必须明说**（全文共几行 / 省掉几行）', headCut.text.includes('共 10 行') && headCut.text.includes('省掉'))
check('明说"被截断"**不是**"没有命中"（否则会误读）', headCut.text.includes('不是'))

const tailCut = capToolOutput(many, { label: 'dangan_recent', keep: 'tail', maxLines: 4 })
check('🔴 keep=tail → 留的是**最后** N 行（dangan_recent 全靠这个：最近才重要）', tailCut.text.includes('第 9 行') && !tailCut.text.includes('第 0 行'))
check('tail 口径的说明写"只显示最后 N 行 / 前面被省掉"', tailCut.text.includes('最后') && tailCut.text.includes('前面'))

const charCut = capToolOutput('X'.repeat(500), { maxChars: 100 })
check('字符超限（行数没超）也会截断 —— 两道闸都要有', charCut.cut === true && charCut.text.length < 500)
check('上限可配（传参优先）', capToolOutput(many, { maxLines: 2 }).shownLines === 2)
check('默认上限与实测相称（真档案最大 7,405 字符 / 82 行 → 留约 3 倍余量）', TOOL_OUTPUT.maxChars >= 20000 && TOOL_OUTPUT.maxLines >= 300)

// ---- 接进真工具：验证"谁走哪条口径"没搞错（用调小的上限逼出截断）----
const { danganCheckTool, danganSearchTool } = await import('../lib/tools.js')
const root2 = makeArchive('f12-tools', {
  '01-时间轴-我们做过什么.md': [
    '| 等级 | 编号 | 时间 | 发生了什么 |',
    '|---|---|---|---|',
    ...Array.from({ length: 60 }, (_, i) => `| ○ | **T${i + 1}** | 2026-09-17 00:${String(i % 60).padStart(2, '0')} | 第 ${i + 1} 件事的说明，故意写长一点好让它占地方 |`),
    '',
  ].join('\n'),
  '01-事件表-我们做过什么.md': [
    '| E 号 | 事件 | 时间跨度 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    ...Array.from({ length: 40 }, (_, i) => `| E${i + 1} | **第 ${i + 1} 件事** | 2026-09-17 | ✅ 完成 | T${i + 1} |`),
    '',
    ...Array.from({ length: 40 }, (_, i) => `### E${i + 1}｜第 ${i + 1} 件事\n- **时间跨度**：2026-09-17\n- **锚点**：T${i + 1}\n- **状态**：✅ 完成\n`),
  ].join('\n'),
  // 🔴 2026-10-14 · ④ C 轮：`mode="recent"` 的数据源＝《索引》的 L3 节（时间轴已随 L2 退役）
  '索引.md': [
    '# 索引',
    '',
    '## L3-知识',
    '',
    '| 时间 | 文件 | 一句话 |',
    '|---|---|---|',
    ...Array.from({ length: 10 }, (_, i) => `| 2026-09-17 0${i}:00 | \`记录-${i + 1}.md\` | 第 ${i + 1} 件事，故意写长一点占地方 |`),
    '',
  ].join('\n'),
})

INF.CFG.archiveDir = root2
INF.CFG.toolOutput = { maxLines: 5 }

const recentOut = await danganSearchTool.execute({ mode: 'recent' })
check('真工具：`dangan_search mode="recent"` 走的是 **tail** 口径（截断时保住最近的）', recentOut.text.includes('最后'))

// 🔴 2026-10-15：原来这里测「`dangan_check scope="index" mode="render"` 不套预算」——
//    `index` 已随事件表退役（用户拍板「没用就删了」），整段删除。

INF.CFG.toolOutput = null
INF.CFG.archiveDir = root
check('工具输出预算可还原（null → 回到默认档）', capToolOutput('短文本').cut === false)

done()
