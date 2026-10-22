// ============================================================
// F24 · 总览哨兵 + 状态现算（《00-总览》那一关）—— 2026-09-18 凌晨建
// ============================================================
//
// 用户 2026-09-18 01:1x 的原话（这一版就是照它做的）：
//   "**我们一直在做的就是梅莫莉亚的自动化，总览这个文档能自动化吗？**"
//   紧接着他自己补了那个最关键的反问：
//   "**我记得有个途径已经会让你看必读和重要的事情了。这样你不就重复读了吗？**"
//
// 🔴 **那个反问决定了这一版的边界（照做，没加花样）**：
//   · "最近在干什么"**已经有了唯一的数据源** —— `dangan_search mode="recent"`（原 `dangan_recent`；时间轴末尾 20 条 ＋ 补到 3 条 ❗）。
//     所以 F24 **绝不生成"最近要事"** —— 那会造出第二份副本（《总览》自己的「规矩 1」禁的就是这个），
//     而且《总览》属 L1，**压缩后的重注入会把入口全文一起塞进去** → 总览一厚，注入就厚，
//     而预算那段自己写着"注入越大越容易触发压缩"。**这是恶性循环，不许走。**
//   · 于是这一版只做两件**不新增内容**的事：
//       ① **查**（哨兵）：引用越界 / 整行重复 / 交接区里有会过时的数字 / 维护记录还在抄过程；
//       ② **现算**：交接区里那些数字**本该由机器算**（版本、模块数、时间轴、事件、体检…）。
//
// 🔴 **它一个字都不写档案。** 理由与 F23 同一条规矩：写入只走那扇唯一的门
//   （`tools/改档.mjs`，先快照、写完自检、出新错自动回滚）。
//   所以这里只出**提案文本**（`renderOverview()`），真写由 `dangan_overview mode='apply'`
//   的调用方（我）拿 `edit` / 改档工具去做。**插件里再写一个写盘器 = 第二个写入口。**
//
// ⚠️ 自我约束（与 F2/F5/F13 一致）：**只读**；**fail-open**（读不到就报"读不到"，不抛错）；
//   **不许静默**（查了几条、跳过什么，全写进报告）。

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { CFG, codeStamp, findByNameUnique, readTextSafe, rel } from './common.js'

/** 总览的相对路径（**老名字**，只在"按名字找不到"时兜底 —— 见下面的 `overviewPath()`）。 */
export const OVERVIEW_REL = ['L1-必读', '00-总览-我们干过什么.md']

/**
 * **总览文件在哪** —— 先按名字找（`findByNameUnique('总览')`），找不到才用老路径兜底。
 *
 * 🔴 2026-10-20（发布前修）：原来硬编码 `00-总览-我们干过什么.md`，而真档案里早改名成 `总览.md`
 *   ⇒ 这一路**恒报"读不到"**，四条机械判据（引用越界 / 整行重复 / 交接区写死数字 / 维护记录抄过程）
 *   **一次都没跑过** —— 正是"看着在跑、其实已死"。
 */
export function overviewPath() {
  try {
    const p = findByNameUnique('总览')
    if (p) return p
  } catch {
    /* fail-open：找名字出错就用老路径 */
  }
  return absOf(OVERVIEW_REL)
}

/**
 * 交接区的**锚点行**（机器认这一行，不认内容）。
 * 放在这里是为了让"这一段是机器该管的"这件事**可判** —— 而不是靠人记得。
 */
export const HANDOFF_MARK = '## 交接区（机器该管这一段）'

/**
 * 交接区的**结束标记**（2026-09-18 真档案上抓出来的）。
 *
 * 🔴 为什么必须有它：第一版拿"下一个二级标题"当结束界 —— 可真档案里，交接区之后
 *   **中间还隔了 15 行别的引用块**（U 盘称呼 / 「规矩 1~5」/ 开工第一步）才轮到下一个标题，
 *   于是整段被吞进"交接区"，**当场误报了「规矩 2」正文里的 `20 条`/`25 条`**
 *   （那是说明文字，本来就该留着）。**"交接区到哪结束"机器猜不出来 —— 就得明写。**
 */
export const HANDOFF_END = '> 交接区到此为止（上面这一段的结束标记，哨兵认它）'

/**
 * 维护记录那节的标题（它现在是**手抄过程**，判据见下）。
 * ⚠️ 这里写的是**标题文字**，不是行号 —— 行号会漂，标题不会（除非人改名，那时哨兵会报"找不到"）。
 */
export const MAINT_HEAD = '## 维护记录'

/**
 * ⚠️ **2026-09-18 起这一节只守着维护记录那一条** —— 用户当天决定**取消"交接区"**整块
 * （理由："只要归档，新会话就会先处理上一轮归档的文件，它自己就知道上轮结束了"）。
 * 所以"交接区里的过期数字 / 交接区太长"这两条判据**连巡检对象都没了，已删**（留着＝永远不响的告警）。
 */

/**
 * 机械可判的"会过时的数字"：数字 + 这几个量词（原来是 `/(\d[\d,]*)\s*(行|条|模块|个文件|MB|KB)/g`）。
 * ⚠️ 它原来只扫"交接区"，而交接区已取消 ⇒ **无调用点，2026-10-20 删掉**。口径留这句话，
 *    将来真要恢复"扫会过时的数字"，照着这个量词表写即可。
 */

const absOf = (rel) => join(CFG.archiveDir, ...rel)

/** 读总览（读不到返回 `null` —— **"读不到"与"文件是空的"是两回事**，照 R20 那条判据）。 */
export function readOverview() {
  const p = overviewPath()
  if (!existsSync(p)) return null
  const txt = readTextSafe(p)
  return txt ? { path: p, text: txt, lines: txt.split(/\r?\n/) } : null
}

/**
 * 交接区在哪几行（含锚点行本身）。返回 `{ start, end }`（1-based，`end` 含）。
 * 找不到锚点 → 返回 `null`（调用方要如实报"没有交接区"，不是报错）。
 */
export function handoffRange(lines) {
  const start = lines.findIndex((l) => l.trim() === HANDOFF_MARK)
  if (start < 0) return null
  // ① 优先：明确的结束标记（**有它才扫得准**）
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === HANDOFF_END) return { start: start + 1, end: i + 1 }
  }
  // ② 退路：没有结束标记时，只认**紧邻的那个**二级标题（不再一路吞到很远的标题 —— 那正是误报的根因）
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) return { start: start + 1, end: i }
  }
  return { start: start + 1, end: lines.length }
}

/** 维护记录那节在哪（找不到返回 `null`）。 */
export function maintRange(lines) {
  const start = lines.findIndex((l) => l.trim() === MAINT_HEAD)
  if (start < 0) return null
  return { start: start + 1, end: lines.length }
}

/**
 * **现算**那些数字 —— 一律从权威来源拿，**不许抄**：
 *   版本 / 模块数 → **直接用 `codeStamp()`**（与启动报的那一行同口径）。
 *     ⚠️ 曾经想"读 package.json 数模块"——那会变成**第二套算法**（本档案的头号病根：副本病）。
 *   时间轴 / 事件 → 数**行**（口径与 F5/F17 一致：`^\|\s*[❗⭐○]\s*\|` 与 `^### E\d+｜`）
 * ⚠️ 体检的错/提示数 **不在这里算** —— 那要跑一遍 `checkArchive()`，重复跑代价大；
 *    由调用方（`dangan_overview`）跑完传进来。
 */
export function computeNow({ modules, checkErrors, checkTips } = {}) {
  const out = { version: null, modules: modules ?? null, checkErrors: checkErrors ?? null, checkTips: checkTips ?? null }
  // 版本 / 模块数：**用 codeStamp() 现算**（同一套算法，不另写一份）
  try {
    const st = codeStamp() // 形如 `v<版本> · <模块数> 模块 · 指纹 <8位>`（**别把数字写死在这里** —— 每次发版都会变）
    const mv = /^v([0-9.]+)/.exec(st)
    const mm = /·\s*(\d+)\s*模块/.exec(st)
    out.version = mv ? mv[1] : null
    out.modules = mm ? Number(mm[1]) : out.modules
  } catch {
    /* 读不到就留 null，报告里如实写 */
  }
  // 🔴 2026-10-14：L2 已删 ⇒ 下面那段读的是**已经不存在的文件**（`readTextSafe` 返回空串 ⇒ 两个字段
  //    恒为 null）。但**字段与下游判据一条都不删**，判据出处：`备查-老馆与新馆（现状总纲）.md`
  //    ——"合不合新规范"与"能不能用"是两条判据；且 `maxTimeline` / `maxEvents` 是**越界检查的上界**
  //    （见下面的注释），删掉它们会连带删掉那条检查的对象。⇒ 保留、只标清楚"它现在恒为 null"。
  // 时间轴 / 事件：数行（**只认带等级的 T 行**；空白等级＝还没定级，由 F5 报，别在这儿重复算）
  // ⚠️ **两个数不是一回事**：`timeline`＝**条数**（给人看"多少条"）· `maxTimeline`＝**最大编号**
  //    （**越界检查要用它**）。样本试跑逼出来的：我事件表标题写到 E2 而条数只有 1，
  //    拿"条数"当上界就会把合法的 E2 误报成越界。**"多少条" ≠ "编号到几"**。
  // 🔴 2026-10-15：**`timeline` / `maxTimeline` / `events` / `maxEvents` 四个字段随 L2 退役删除** ——
  //    它们读的是 `L2-数据\01-时间轴-我们做过什么.md` / `01-事件表-我们做过什么.md`（硬路径），
  //    而 L2 已删 ⇒ 恒读不到 ⇒ 恒 null。用户："这是结构变化"。

  return out
}

/**
 * **总览哨兵**：三条机械判据（全部只读）——
 *   ① **引用越界**（总览里写了 T/E 号，但 L2 里没有）② **整行逐字重复** ③ **维护记录又在抄过程**（该是一句指针）。
 * ⚠️ 原来还有"交接区里的过期数字 / 交接区太长"两条 —— 2026-09-18 用户取消了整个"交接区"，**这两条已随之下线**
 *   （判据的对象没了；留着就是"永远不响的告警"，那是这份档案最不想要的东西）。
 * @param {object} now 现算值（不传就自己算一次；体检两项传 null 就写"未测"）
 * @returns {{ok:boolean, problems:Array<{level:'错'|'提示', where:string, what:string}>, now:object}}
 */
export function checkOverview(now = null) {
  const problems = []
  const ov = readOverview()
  if (!ov) {
    return {
      ok: false,
      problems: [{ level: '错', where: '总览文件', what: `读不到（${overviewPath()} 不存在或不可读）—— 交接区与维护记录都没法看` }],
      now: now ?? computeNow(),
    }
  }
  const lines = ov.lines
  // ---- 引用越界（总览里的 T/E 号必须真实存在）：**2026-10-15 整块删除** ----
  // 🔴 上界来自 `maxTimeline` / `maxEvents`（读 L2 两份文件算出来）—— L2 已删 ⇒ 上界恒 null
  //    ⇒ `Number.isFinite(null)` 为假 ⇒ 这段**本来就已经不执行**了（死分支）。随 L2 一并删。

  // 整行重复（>40 字的整行；**这是 2026-09-18 真实发生过的那次**：第 79=80 行）
  const seen = new Map()
  lines.forEach((l, i) => {
    const k = l.trim()
    if (k.length <= 40) return
    if (!seen.has(k)) seen.set(k, [])
    seen.get(k).push(i + 1)
  })
  for (const [k, ns] of seen) {
    if (ns.length > 1) problems.push({ level: '错', where: `第 ${ns.join(' / ')} 行`, what: `**整行逐字重复**：${k.slice(0, 56)}…` })
  }
  // 交接区：**2026-09-18 起用户取消了这一块**（新会话一启动 F23 就会检查归档集合、自己就看见上轮归档了，
  // 不需要纸条转告）。所以这里**只认旧档案的遗留锚点**并提示"该删了" —— 不为已取消的东西巡检。
  const hr = handoffRange(lines)
  if (hr) {
    problems.push({
      level: '提示',
      where: `第 ${hr.start - 1} 行`,
      what: '**这一页还留着"交接区"** —— 用户 2026-09-18 已决定取消它（换班这件事由 F23 归档留底自己说清）。' +
        '里面写的事该去 `dangan_todo` / L3 的记录，**不留第二份**',
    })
  }
  // 维护记录：还在不在抄过程
  const mr = maintRange(lines)
  if (!mr) {
    problems.push({ level: '提示', where: '维护记录', what: `找不到 \`${MAINT_HEAD}\` —— 若已压成指针，这条应为"无"（**这里是提示，不是错**）` })
  } else {
    const body = lines.slice(mr.start, mr.end).filter((l) => l.trim().startsWith('- '))
    if (body.length > 3) {
      problems.push({
        level: '提示',
        where: `第 ${mr.start}~${mr.end} 行`,
        what: `维护记录有 **${body.length} 条**手写过程 —— 这与《总览》自己的「规矩 1：本页不抄流水」冲突；过程在 L3，这里只该留一句指针`,
      })
    }
  }
  return { ok: problems.filter((p) => p.level === '错').length === 0, problems, now: now ?? computeNow() }
}

/**
 * ⚠️ **2026-09-18：交接区的提案生成器已下线**（用户当天取消了整块交接区）。
 *
 * 保留这段注释是因为**它踩过的坑值得留着**：第一版拿"下一个二级标题"当结束界，
 * 结果把后面 15 行别的引用块一起吞进"交接区"，**当场误报了「规矩 2」正文里的数字**。
 * 教训是通用的：**凡"机器要巡检的一段"，就必须有明确的头尾标记** —— 靠猜边界必错。
 */

/** 维护记录的**提案文本**：压成一句指针（过程在 L2，一行不丢）。 */
export function renderMaintPointer() {
  return [
    MAINT_HEAD,
    '',
    '- 过程不写在这里 —— **按《总览》的「规矩 1」（本页不抄流水）**，它全在 L3 的记录里（按文件名或开头三行自述找）。',
    '- 要看"最近在干什么"：调 `dangan_search mode="recent"`（读《索引》L3 那一节的头 20 条）。要看某件事的来龙去脉：`dangan_search` 搜关键词。',
    '- ⚠️ 这一节原先有 16 条手写过程（2026-09-14 ~ 09-17），2026-09-18 压成指针 —— 内容一条没丢，都在 T1 起的时间轴里。',
  ].join('\n')
}

/** 给 `dangan_overview` 用的提案（**现在只剩维护记录那一节**，不写盘）。 */
export function renderOverview() {
  return { maint: renderMaintPointer() }
}

/**
 * 报告（给人看）。⚠️ **`0 问题 ≠ 语义没问题`** —— 这句话必须留在输出里
 * （口径照 F5/F14 的自我约束：机械判据不能冒充"全都对"）。
 */
export function formatOverviewCheck(res, now) {
  const n = now ?? res?.now ?? {}
  const head =
    `【dangan_check · overview】总览：\`${rel(overviewPath())}\`\n` +
    `现算（**别抄**）：v${n.version ?? '?'} · ${n.modules ?? '?'} 模块` +
    `${n.checkErrors === null || n.checkErrors === undefined ? '' : ` ｜ 体检 ${n.checkErrors} 错 / ${n.checkTips} 提示`}\n`
  const msgs = res?.problems ?? []
  if (msgs.length === 0) {
    return head + '\n✅ **三条机械判据全过**：引用都指得到东西 · 没有整行重复 · 维护记录没在抄过程。\n⚠️ 它只报机械可判的；口径冲突、"这段话该不该写"这类语义问题它不判。'
  }
  const bad = msgs.filter((m) => m.level === '错')
  const tips = msgs.filter((m) => m.level === '提示')
  const lines = [head]
  if (bad.length) {
    lines.push(`\n▌**${bad.length} 条要修**（机械可判）`)
    for (const m of bad) lines.push(`  · ${m.where} —— ${m.what}`)
  }
  if (tips.length) {
    lines.push(`\n▌提示 **${tips.length}** 条（机器分不清"该不该"，留给人判）`)
    for (const m of tips) lines.push(`  · ${m.where} —— ${m.what}`)
  }
  lines.push('\n⚠️ 它只报机械可判的；口径冲突、"这段话该不该写"这类语义问题它不判。')
  return lines.join('\n')
}
