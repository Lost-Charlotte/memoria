// ============================================================
// F4 · dangan_search（档案检索）
// ============================================================
//
// 🔴 **加新参数时的纪律（2026-09-28 立 · 用户点的那件事）**：**每个新参数都要能回答一句 ——
//    "它在哪个岔口被提示？"** 用户原话：「这个……也落入自动化了吧。**别换个会话没了上下文你就不记得用这些工具了。**」
//    ⇒ 光把参数写进 schema **不够**（那要"我特意去查它"才有用 ＝ 靠记性）；**要挂在"我正站在那个岔口上"的那一刻**：
//      · **缺了这事就办不成** ⇒ **当场拒**（例：新建事件必给 `title` · `dangan_search` 缺 `query`）
//      · **有它更好、没它也能过** ⇒ **在回执里当头一问**（例：`dangan_log` 的 `did` 超过 150 字却没给 `detailIn` 时，
//        回执第一句就把"完整经过落在哪份 L3"问清）
//    ⚠️ **不许只写在描述里** —— 描述只有"我特意查它"时才被读到，那就是靠记性。
//
// **6 个工具**（2026-09-18 由 10 个合并；2026-10-15「落档」门面并进织布机，`dangan_log` 已删）：
//   dangan_search（读：关键词 / 读法）· dangan_check（查：体检 / 总览 / 地图）
//   dangan_weave（写：`pattern` 选纹样 —— 落档 / 待办 / 索引 / 地图 …）· dangan_todo（待办）
//   dangan_status（状态）· dangan_init（从 0 建档案）
// 判定内核不在本文件（`checkArchive` 在 f5-check.js、`weave` 在 loom.js、`runTxnOps` 在 f9-commit.js），
// 这里只放给模型看的 ToolDefinition 与 execute 包装。

import { execFileSync } from 'node:child_process'

import { CFG, log, readTextSafe, rel, scanLayerDirs, toolPath, walk } from './common.js'
import { checkArchive, formatCheck, formatRecent, pickRecent } from './f5-check.js'
// 🔴 2026-10-15：**F14 从"写入闸"改成"巡检哨兵"**（用户当天拍板）—— 它原来扫的是"落档将要写进
//    档案的那几行"，L2 删后凭据根本不入 ops ⇒ 已成空转。现在它扫**整座档案**，像 F27 一样在体检里出。
import { reportF14 } from './f14-secrets.js'
import { citationReport } from './f27-citation.js'
// 🔴 2026-10-15：`f8-index.js` 的 import 已随 `scope="index"` 退役删除（那份模块暂留给落档侧）。
// 🔴 2026-10-16（织布机收口）：`commitLog` 的 import 拿掉了 —— `dangan_log` 删净之后，它在**正式路径上
//    没有调用方**（只剩测试在调，见 `f9-commit.js` 顶部那段定位）⇒ 这里只留 `runTxnOps`（待办清理那条路要用）。
import { runTxnOps } from './f9-commit.js'
import { formatCleanPlan, formatTodoList, todoCleanOps, todoPlanClean, todoStaleCandidates } from './f10-todo.js'
// 工程（F35 · 2026-09-26 加）—— **挂在同一条通道上，不新开工具**（用户要的是"同一个界面、下面加一节"）。
import { formatProjectList, projectStaleCandidates } from './f35-project.js'
// 织布机（F36 · 2026-10-07）：**只 import 内核那一个入口** —— 编排 / 校验 / 分组的逻辑全在 `lib/loom.js`，
// 本文件只放"给模型看的 ToolDefinition ＋ execute 包装"（与既有 6 个工具同一个姿态）。
import { weave } from './loom.js'
// 🔴 2026-10-15：`ANSWER_TTL_HOURS` / `markChecked` 随 G3 事件收尾退役删除（`f18-closing.js` 只留待办侧）。
import { capToolOutput } from './f12-budget.js'
import { buildStatus } from './f15-status.js'
// FastCtx（F37 · 2026-10-11）：**只给文件清单**那一种读法 —— 实测输出是 `rg` 的 1/32。
// ⚠️ 它**只调只读工具**（`grep`）；写（`replace`）不进这条路，要改文件仍走 `改档.mjs`。
import { filesMode } from './f37-fastctx.js'
// 时间轴（F37 家族第二件 · 2026-10-15 · 用户当天的设想）：抽 **L3 正文**里的时间 → 归一化 → 排序
//   → **以锚取前后 k 条**。为什么抽正文而不是外层 🕐：外层只说明"最后一次动它"，跨天的事被压成一个点。
import { formatTimeline, formatWindow, sliceAround, timelineOf, windowOf } from './f37-timeline.js'
import { archiveState, bootstrap, formatBootstrap } from './f20-init.js'
import { checkOverview, computeNow, formatOverviewCheck, MAINT_HEAD, renderOverview } from './f24-overview.js'

/**
 * 给**工具输出**套预算（F12 的第二半，2026-09-17 加）。
 * 实测（真档案）：`dangan_search mode="recent"` 7,405 字符 / 82 行是最大的一档，其余 4–5 千字符 → 上限 24,000 / 400 行，
 * **正常不会触发**；真触发时会**明说被截断了**（"被截断" ≠ "没有命中"）。
 * ⚠️ `keep='tail'` **只给 `dangan_search mode="recent"`** —— 它按时间正序、**"最近"才是有用的**，
 *    丢尾部等于把最该看的丢掉（那比不截还糟）。
 */
const out = (text, label, keep = 'head') => capToolOutput(text, { label, keep, ...(CFG.toolOutput ?? {}) }).text

/** 从一行里抽出 T/E/R/A/D 编号锚点（拿到 T 号就能去 L2 时间轴对时间）。 */
export function extractAnchors(line) {
  const out = new Set()
  for (const m of line.matchAll(/\b([TEARD]\d{1,3})\b/g)) out.add(m[1])
  return [...out]
}

/**
 * 在档案里按关键词检索。
 * query 用空格分隔多个词 → **全部满足**才算命中（AND 语义，避免噪音）。
 * scope 限定层级：L1 / L2 / L3 / all。
 */
export function searchArchive(query, scope = 'all', limit = 40) {
  const terms = String(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return { hits: [], total: 0, scanned: 0 }
  // 🔴 2026-10-15：`scope` 点名某一层时，**把那层加进"强制扫"白名单**（`CFG.scanForcedDirs` 是现成机制）——
  //    否则 `walk()` 会按语义跳过 `L5-证据` / `L6-工具临时`（那是"平时别扫"的口径），
  //    于是"点了名却搜不到" ＝ 静默失效。扫完（含异常）立刻恢复，不留全局副作用。
  const prevForced = CFG.scanForcedDirs
  if (scope !== 'all') {
    // ⚠️ `scope` 允许写**层号**（`L6`），但"强制扫"白名单要的是**层目录全名**（`L6-工具临时`）——
    //    `isForcedScan()` 是**全等**比对，塞 `L6` 进去等于没塞（2026-10-15 实测：扫 0 份）⇒ 现算一次。
    const dirs = scanLayerDirs(CFG.archiveDir, { skipEvidence: false }).filter((n) => n.startsWith(scope))
    CFG.scanForcedDirs = [...new Set([...(Array.isArray(prevForced) ? prevForced : []), ...dirs])]
  }
  try {
    const hits = []
    let scanned = 0
    for (const file of walk(CFG.archiveDir)) {
      const r = rel(file)
      if (scope !== 'all' && !r.startsWith(scope)) continue
      const text = readTextSafe(file)
      if (text.length === 0) continue
      scanned += 1
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line === undefined || line.length === 0) continue
        if (!terms.every((t) => line.includes(t))) continue
        const t = line.trim()
        hits.push({
          file: r,
          line: i + 1,
          anchors: extractAnchors(line),
          text: t.length > 220 ? `${t.slice(0, 220)}…` : t,
        })
      }
    }
    return { hits: hits.slice(0, limit), total: hits.length, scanned }
  } finally {
    CFG.scanForcedDirs = prevForced
  }
}

/**
 * **C「上下 k 行」**（用户 2026-10-09 拍板要新增的那一条 · 织布机收口阶段③）：给一个
 * `文件:行号`（`dangan_check` / `dangan_search` 报出来的都是这个形状），回它**上下各 k 行**。
 * 为什么要有它：拿到 `文件:行号` 之后想看一眼"那处前后是什么"，原先只能 `read` 定点读、
 * 或反复 grep —— 这个能力把"看完命中还得自己拼上下文"那一步省掉。
 */
export function aroundArchive(at, k = 6) {
  const m = String(at ?? '').trim().match(/^(.*?):(\d+)$/)
  if (!m) throw new Error('`at` 要写成 `文件:行号`（例 `L3-知识\\记录-xxx.md:12`）')
  const relPath = m[1].trim().replace(/\//g, '\\')
  const n = Number(m[2])
  const abs = `${CFG.archiveDir}\\${relPath}`
  const lines = readTextSafe(abs).split(/\r?\n/)
  if (lines.length <= 1 && (lines[0] ?? '') === '') {
    throw new Error(`读不到 ${relPath}（路径按档案根写，例 L1-必读\\铁律.md）`)
  }
  if (n < 1 || n > lines.length) throw new Error(`${relPath} 只有 ${lines.length} 行 —— 第 ${n} 行不存在`)
  const lo = Math.max(1, n - k)
  const hi = Math.min(lines.length, n + k)
  const body = []
  for (let i = lo; i <= hi; i++) body.push(`${i === n ? '▶' : ' '} ${String(i).padStart(5)} | ${lines[i - 1] ?? ''}`)
  return { relPath, n, lo, hi, total: lines.length, text: body.join('\n') }
}

/**
 * **0 命中时的反查**（2026-09-22 加 · 用户点的"空命中反查"）：
 * 把每个词**砍掉末尾 1~2 个字**再搜一遍 —— 打错字 / 多打一个字 / 记错尾字，都能被它接住。
 * ⚠️ 只在 `formatHits` 的 0 命中分支里跑（档案 66 份、实测全扫约 200ms），**不许放进正常路径**。
 */
export function reverseLookup(terms, limit = 4) {
  const out = []
  for (const t of terms) {
    const s = String(t)
    if (s.length < 3) continue
    for (const cut of [1, 2]) {
      const shorter = s.slice(0, s.length - cut)
      if (shorter.length < 2) continue
      const r = searchArchive(shorter, 'all', 2)
      if (r.total > 0) {
        out.push({ tried: shorter, total: r.total, sample: r.hits[0] })
        break
      }
    }
    if (out.length >= limit) break
  }
  return out
}

// 🔴 判据**只有一份**：`lineFingerprint` 在 `lib/f13-anchors.js`（F13「有效性锚点」那一族，
//    跟"引用还有效吗"是同一件事）。这里**只转发**，不另写一份 —— 免得两处判据各自漂。
import { lineFingerprint } from './f13-anchors.js'
export { lineFingerprint }

/** 把命中格式化成给模型看的文本（自带文件:行号 + 锚点 + 行指纹）。 */
export function formatHits(query, res, scope = 'all') {
  if (res.hits.length === 0) {
    // 🔴 2026-09-22：0 命中不再"只说一句换短词" —— **当场反查**（砍短词再搜），
    //    并把这次空查询**记进日志**（`~/.dsh/memoria.log`），好让"我老搜不到什么"看得见。
    const near = reverseLookup(String(query).split(/\s+/).filter(Boolean))
    // 🔴 2026-10-21 加（第二路审查报的：R49 2 次 + R20 4 次 都是"搜不到、但其实别处有"）：
    //    `dangan_search` **只认当前馆**。反查也没找着时，最该提示的不是"换个词"，是**换个地方找**。
    const elsewhere =
      '\n🔴 **也可能是"不在这座馆里"** —— `dangan_search` 只查当前馆。试试：' +
      '\n  · `es.exe <词>`（`E:\\DeepSeek工具箱\\01-搜索\\es\\es.exe`，按**文件名**全盘搜，要先开着 Everything）' +
      '\n  · `rg.exe <词>`（同目录 `01-搜索\\ripgrep\\`，搜**代码 / 日志 / 另一个馆**）'
    const hint =
      near.length > 0
        ? '\n**反查**（把词砍短再试，命中的有）：' +
          near.map((h) => `\n  · \`${h.tried}\` —— ${h.total} 条（例：${h.sample.file}:${h.sample.line}）`).join('')
        : '\n（**反查也没找到更短的词** —— 可能这个词压根不在档案里，或者写法不同）' + elsewhere
    try {
      log(
        `dangan_search 空命中：「${query}」(scope=${scope} · 扫 ${res.scanned} 份)` +
          (near.length > 0 ? ` → 反查中：${near.map((h) => h.tried).join(' / ')}` : ' → 反查也无'),
      )
    } catch {
      /* 日志写不了不影响返回 */
    }
    return `【dangan_search「${query}」】扫了 ${res.scanned} 份文档，0 条命中。\n（多个关键词是"全部要满足"；可以换更短的词，或把 scope 设成 all）${hint}`
  }
  const head = `【dangan_search「${query}」】命中 ${res.total} 条，显示前 ${res.hits.length} 条（扫了 ${res.scanned} 份文档）`
  const rows = res.hits.map((h, i) => {
    const a = h.anchors.length > 0 ? `  [${h.anchors.join(' ')}]` : ''
    // 🔴 2026-09-22：**顺带吐行指纹** —— 我新写"见 X 第 N 行"时直接抄这个，
    //    以后行号漂了还能按指纹找到（用户点的"让排行号的工具不只排行号"）。
    const fp = lineFingerprint(h.text)
    return `${i + 1}. ${h.file}:${h.line}${a}${fp ? `  指纹「${fp}」` : ''}\n   ${h.text}`
  })
  return [head, '', ...rows].join('\n')
}

/** ToolDefinition —— 结构照 `@deepseek-ai/dsh-tools`：name / description / parameters / output / execute。 */
export const danganSearchTool = {
  name: 'dangan_search',
  description:
    '**读档案**（只读，五种读法；`timeline` ＝ **临时拼一条时间轴** —— 抽 L3 正文里的时间、以锚取前后 k 条）。`search`（默认）＝关键词检索，回 `文件:行号` ＋ T/E/R/A 锚点 · `recent`＝"最近在干什么"（🔴 2026-10-14 起＝读《索引》的 `L3-知识` 那一节的头 N 条 —— 那一节**已经是"新的在前"**，时间从各文件的 🕐 标记 / 文件名日期现算）· `around`＝**给一个 `文件:行号`，回它上下 k 行**（`at` ＋ `k`）· `files`＝**只要文件清单**（走 FastCtx，**只给路径、不给行号与原文** —— 实测同一次搜索输出是 `rg` 的 **1/32**）。详细用法与口径见 `L1-必读/工具速查.md`。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      mode: {
        type: 'string',
        enum: ['search', 'recent', 'around', 'files', 'timeline', 'window'],
        default: 'search',
        description: 'search=关键词检索（默认，配 `query`）· recent="最近在干什么"那几行（配 `last`）· around=看某处上下文（配 `at`/`k`）· files=**只要文件清单**（配 `query` ＋ 可选 `dir`；输出最省）· timeline=**临时拼一条时间轴**（配 `anchor` ＋ 可选 `k`：抽正文里的时间 → 排序 → 以锚取前后 k 条）· window=**拿时间去 L6/L5/L8 找那一刻的原始件**（配 `from`/`to` ＋ 可选 `scope`）',
      },
      query: { type: 'string', description: '**`search` / `files` 必填**：关键词；空格分隔多个词＝**全部都要满足**' },
      at: { type: 'string', description: '**`around` 必填**：`文件:行号`（例 `L1-必读\\铁律.md:29`）—— 体检与检索报出来的都是这个形状，直接粘' },
      anchor: { type: 'string', description: '**`timeline` 必填**：锚 —— 给时间（`2026-10-14 22:30`）或关键词（`三头六臂`）；关键词时**文件名命中优先**（文件名带它的才是"这件事的正主"）' },
      from: { type: 'string', description: '**`window` 必填**：时间窗起点（例 `2026-10-14 22:30`）' },
      to: { type: 'string', description: '**`window` 必填**：时间窗终点（例 `2026-10-14 23:40`）' },
      withTime: { type: 'boolean', default: true, description: '（timeline）默认只取"有时刻"的点；`false` ＝ 连"只有日期"那些也带上（会让时间轴变糊）' },
      k: { type: 'integer', default: 8, description: '（around）上下各几行；（timeline）前后各几条（默认 8，上限 200）' },
      dir: { type: 'string', description: '（files）**档案内的相对目录**（例 `L3-知识`）；不填＝整个档案根' },
      scope: {
        type: 'string',
        enum: ['all', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L8'],
        default: 'all',
        description: '（search / timeline）限定层：`L1`=必读/红线 · `L2`=你我之间 · `L3`=一件事一份 · `L4`=还没做完的 · `L5`=原始证据 · `L6`=工具临时 · `L8`=施工归档；`all`（默认）＝**现行层全扫** —— `L5`/`L6` 平时按语义跳过，**点名才进**；`timeline` 只认现行层（L1~L4）',
      },
      limit: { type: 'integer', default: 40, description: '（search）最多几条命中（默认 40，上限 200）' },
      last: { type: 'integer', default: 20, description: '（recent）末尾读几条（默认 20）' },

    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'text'],
      properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  },
  async execute(args) {
    const a = args ?? {}
    if (a.mode === 'recent') {
      try {
        const last = Number.isInteger(a.last) && a.last > 0 ? Math.min(a.last, 500) : 20
        // 🔴 2026-10-14 · ④ C 轮：`important`（补到累计 N 条 ❗）随 L2 退役 —— 索引里没有等级列
        return { ok: true, text: out(formatRecent(pickRecent(last)), 'dangan_search', 'tail') }
      } catch (e) {
        log(`dangan_search(recent) 出错: ${e}`)
        return { ok: false, text: `dangan_search（recent）出错：${e}` }
      }
    }
    if (a.mode === 'window') {
      const from = typeof a.from === 'string' ? a.from.trim() : ''
      const to = typeof a.to === 'string' ? a.to.trim() : ''
      if (from.length === 0 || to.length === 0) {
        throw new Error('dangan_search: `mode="window"` 要配 `from` 与 `to` —— 各写一个时间（例 `from:"2026-10-14 22:30"` `to:"2026-10-14 23:40"`）')
      }
      try {
        const sc = typeof a.scope === 'string' && a.scope !== 'all' && /^L\d/.test(a.scope) ? [a.scope] : undefined
        const rows = windowOf(from, to, sc)
        return { ok: true, text: out(formatWindow(from, to, rows), 'dangan_search') }
      } catch (e) {
        log(`dangan_search(window) 出错: ${e}`)
        return { ok: false, text: `dangan_search（window）出错：${e?.message ?? e}` }
      }
    }
    if (a.mode === 'timeline') {
      const anchor = typeof a.anchor === 'string' ? a.anchor.trim() : ''
      if (anchor.length === 0) {
        throw new Error('dangan_search: `mode="timeline"` 要配 `anchor` —— 给一个时间（`2026-10-14 22:30`）或一个关键词（`三头六臂`）')
      }
      const k = Number.isInteger(a.k) && a.k > 0 ? Math.min(a.k, 200) : 8
      try {
        // 时间轴只认**现行层**（L1~L4）—— `L5`/`L6` 那里的时间是"文件时间"，那是 `mode="window"` 那一半的事
        const sc = typeof a.scope === 'string' && ['L1', 'L2', 'L3', 'L4'].includes(a.scope) ? a.scope : ''
        const { points, files } = timelineOf(sc ? [sc] : ['L1', 'L2', 'L3', 'L4'])
        const r = sliceAround(points, anchor, k, { withTime: a.withTime !== false })
        // 自检（《施工手册》六步第 4 步）：**每次都自报工作量** —— "扫了几份 / 抽出几个时间点"（沉默 ≠ 正常）
        const withT = points.filter((p) => p.time).length
        const head = `【dangan_search · timeline】扫 ${files} 份 · 抽出 ${points.length} 个时间点（其中 ${withT} 个带时刻）`
        return { ok: true, text: out(`${head}\n${formatTimeline(r)}`, 'dangan_search') }
      } catch (e) {
        log(`dangan_search(timeline) 出错: ${e}`)
        return { ok: false, text: `dangan_search（timeline）出错：${e?.message ?? e}` }
      }
    }
    if (a.mode === 'around') {
      const at = typeof a.at === 'string' ? a.at.trim() : ''
      if (at.length === 0) throw new Error('dangan_search: `mode="around"` 要配 `at`（写成 `文件:行号`）—— 体检与检索报出来的行号可以直接粘')
      const k = Number.isInteger(a.k) && a.k > 0 ? Math.min(a.k, 200) : 6
      try {
        const r = aroundArchive(at, k)
        const head = `【上下文】${r.relPath} 第 ${r.n} 行（这份共 ${r.total} 行 · 上面 ${r.n - r.lo} 行 / 下面 ${r.hi - r.n} 行）`
        return { ok: true, text: out(`${head}\n${r.text}`, 'dangan_search', 'around') }
      } catch (e) {
        return { ok: false, text: `dangan_search（around）出错：${e?.message ?? e}` }
      }
    }
    if (a.mode === 'files') {
      const query = typeof a.query === 'string' ? a.query.trim() : ''
      if (query.length === 0) throw new Error('dangan_search: `mode="files"` 要配 `query`（它是"只要文件清单"那一种读法）')
      try {
        const r = filesMode(query, typeof a.dir === 'string' ? a.dir : '')
        if (!r.ok) return { ok: false, text: `dangan_search（files）没成：${r.why}` }
        return { ok: true, text: out(r.text, 'dangan_search') }
      } catch (e) {
        log(`dangan_search(files) 出错: ${e}`)
        return { ok: false, text: `dangan_search（files）出错：${e?.message ?? e}` }
      }
    }
    const query = typeof a.query === 'string' ? a.query.trim() : ''
    if (query.length === 0) {
      throw new Error('dangan_search: `mode="search"` 要配 `query`（给一个或几个关键词）；想看"最近在干什么"用 `mode="recent"`')
    }
    // 🔴 2026-10-16：这道白名单必须与 schema 的 enum **一起长** —— schema 放行了 `L5`/`L6`，
    //    而这里不认 ⇒ **静默降级成 `all`**（点了名却扫全档，还不报）。⚠️ `tests/tools.mjs` 抓到的真 bug。
    const scope = ['all', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L8'].includes(a.scope) ? a.scope : 'all'
    const limit = Number.isInteger(a.limit) && a.limit > 0 ? Math.min(a.limit, 200) : 40
    try {
      const res = searchArchive(query, scope, limit)
      return { ok: true, text: out(formatHits(query, res), 'dangan_search') }
    } catch (e) {
      log(`dangan_search 出错: ${e}`)
      return { ok: false, text: `dangan_search 出错：${e}` }
    }
  },
}

export const danganCheckTool = {
  name: 'dangan_check',
  description:
    '**查档案**（只读为主）。`all`＝机械一致性体检（编号/对齐/锚点/引用/列数/副本漂移 ＋ 口径巡检 F25）· `overview`＝《00-总览》哨兵 · `map`＝档案结构地图。⚠️ 除 `map`＋`mode="apply"` 外全只读。📖 详细清单与"0 处也报 / F25 收口"规则见 `L1-必读/工具速查.md` 与《地图》。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      scope: {
        type: 'string',
        enum: ['all', 'overview', 'map'],
        default: 'all',
        description: 'all=全档机械体检（默认）· overview=《00-总览》这一页 · map=档案结构地图',
      },
      mode: {
        type: 'string',
        enum: ['check', 'render', 'apply', 'detail'],
        default: 'check',
        description:
          'check=只报差异（默认，三种 scope 都支持）· render=吐出可直接替换的产物（overview 用）· apply=真写（只有 map 支持）',
      },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'text'],
      properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  },
  async execute(args) {
    const a = args ?? {}
    const scope = ['overview', 'map'].includes(a.scope) ? a.scope : 'all'
    // ⚠️ **`detail` 原来会被吃成 `check`** —— 下面（F5/F2 那两段）拿 `mode === 'detail'` 判"要不要展开明细"，
    //    而 `mode` 永远到不了 `detail` ⇒ 打 `mode="detail"` 等于没打（档案待办里那条"归一化"就是它）。🔧 2026-09-23 修。
    const mode = ['render', 'apply', 'detail'].includes(a.mode) ? a.mode : 'check'
    if (scope === 'overview') return runOverviewScope(mode === 'render' ? 'render' : 'check')
    if (scope === 'map') return runMapScope(mode === 'apply' ? 'apply' : 'check')
    try {
      // 🔴 **F27 引用对账**（2026-09-18 加，治"张冠李戴"＝《总账》R28）——
      //    与 F25 同一条规矩：**0 处也出这一段**（证明"扫了几份、核了几处引用"，不是没查）。
      const ci = citationReport()
      const cite = `\n\n【引用对账 F27】${
        ci.err
          ? '**读不到**（⚠️ 这不等于"没有张冠李戴"）：'
          : ci.count > 0
            ? `**${ci.count} 处报警** —— 引文**核不到出处**（最坏的一类，见《总账》R28）：`
            : `扫 ${ci.scanned} 份、核 ${ci.refs} 处"原话"，**0 处报警**${ci.tips > 0 ? `（另有 ${ci.tips} 处要我去确认，见下 —— **只降级不隐藏**）` : ''}：`
      }${ci.lines.length > 0 ? (mode === 'detail' ? `\n${ci.lines.join('\n')}` : `\n（${ci.lines.length} 行明细已省 —— 要看打 \`mode="detail"\`：这一段默认只报计数，2026-09-19 起）`) : ''}`
      // 🔴 **F14 凭据巡检**（2026-10-15 加：它从"写入闸"晋级成"巡检哨兵"）——
      //    与 F25/F27 同一条规矩：**0 处也出这一段**（"0 处"至少证明"扫了整座档案"）。
      //    ⚠️ 口径：只报**文件与类别**，**绝不回显内容**（见 `scanArchiveForSecrets()`）；
      //    `off` 模式下它自己会说"已关闭"（不是沉默）。
      const sec = `\n\n${reportF14()}`
      return { ok: true, text: out(formatCheck(checkArchive()) + cite + sec, 'dangan_check') }
    } catch (e) {
      log(`dangan_check 出错: ${e}`)
      return { ok: false, text: `dangan_check 出错：${e}` }
    }
  },
}

// ------------------------------------------------------------
// 并进来的三个 scope（**原来各自是独立工具**，2026-09-18 折进来）
// ⚠️ 判定内核一行没改：`checkOverview` / `档案结构地图.mjs` 仍是各自那份权威，
//    这里只负责"按 scope 路由 + 打包成 ToolDefinition 的输出"。**不另写第二份判定**。
// ------------------------------------------------------------

// 🔴 **2026-10-15：`scope="index"` 已退役**（它读「事件表」，而事件表随 L2 删了 ⇒ 恒报 0 条 / 0 行）。
//    用户当天拍板「没用就删了」。
// 🔴 **2026-10-20：那份内核 `f8-index.js` 已经**整份删掉** —— 里面只剩 `shortStatus` 还有人要
//    （`f9-commit.js` 用），它已经挪进 `lib/commit-ops.js`。

/** `scope="overview"` —— 《00-总览》这一页（F24）。 */
function runOverviewScope(mode) {
  try {
    // 体检数：跑一遍 checkArchive 拿错/提示数（**与 `scope="all"` 同口径**，不另算一套）
    let checkErrors = null
    let checkTips = null
    try {
      const r = checkArchive()
      const list = Array.isArray(r) ? r : (r?.problems ?? [])
      checkErrors = list.filter((p) => p && p.level === '错').length
      checkTips = list.filter((p) => p && p.level === '提示').length
    } catch {
      /* 体检跑不动不影响总览检查 */
    }
    const now = computeNow({ checkErrors, checkTips })
    const res = checkOverview(now)
    if (mode === 'check') return { ok: res.ok, text: out(formatOverviewCheck(res, now), 'dangan_check(overview)') }
    const blocks = renderOverview()
    const text =
      `【dangan_check · overview · render】以下是**提案文本** —— 一个字都没写进档案。\n` +
      `要落地：走唯一的门（\`tools/改档.mjs\`，先快照、写完自检），或用 \`edit\` 工具替换对应段落。\n` +
      `⚠️ 替换时**节标题**（\`${MAINT_HEAD}\`）必须原样保留 —— 哨兵认它。\n\n` +
      `────────── 维护记录（替换旧的那一节） ──────────\n${blocks.maint}\n`
    return { ok: true, text: out(text, 'dangan_check(overview)') }
  } catch (e) {
    log(`dangan_check(overview) 出错: ${e}`)
    return { ok: false, text: `dangan_check（scope=overview）出错：${e}` }
  }
}

/**
 * `scope="map"` —— 档案结构地图（F21）。
 *
 * ⚠️ **它不自己渲染** —— 只负责"在需要的时候调那台生成器"（`tools/档案结构地图.mjs`）。
 *    插件里再写一份渲染器就是**第二个渲染器**，两处必漂（这份档案的头号病根：副本病）。
 *    生成器不在 / 跑不动 → **只报出来，不抛错**。
 */
function runMapScope(mode) {
  const gen = CFG.mapGenerator || toolPath('档案结构地图.mjs')
  if (!gen) {
    return {
      ok: false,
      text: '【dangan_check · map】**地图生成器不在**（包内 `tools/档案结构地图.mjs` 与迁移期兜底位置都没有）—— 地图没法重出。其余能力不受影响。',
    }
  }
  try {
    const argv = [gen]
    if (mode === 'apply') argv.push('--apply')
    const outText = execFileSync(process.execPath, argv, {
      cwd: gen.replace(/[\\/][^\\/]+$/, ''),
      timeout: 60000,
      encoding: 'utf8',
      windowsHide: true,
      // 把**插件认的那个档案根**传给生成器（否则它会按自己的默认值去改另一个档案）
      env: { ...process.env, GAI_DANG_ROOT: CFG.archiveDir },
    })
    return { ok: true, text: out(`【dangan_check · map · ${mode}】生成器：\`${gen}\`\n\n${String(outText ?? '').trim()}`, 'dangan_check(map)') }
  } catch (e) {
    const why = String(e && e.message ? e.message : e)
    const child = String(e?.stdout ?? '').trim()
    log(`dangan_check(map) 出错: ${why}`)
    return { ok: false, text: `【dangan_check · map · ${mode}】**生成器没跑成**：${why}${child ? `\n\n子进程输出：\n${child}` : ''}` }
  }
}

// ⚠️ **原先独立的 `dangan_recent` 已并进 `dangan_search`（`mode="recent"`）** —— 2026-09-18 工具合并。<!-- F25-已确认 2026-09-18 -->
//    判定内核一行没改：仍是 `f5-check` 的 `pickRecent` / `formatRecent`，且仍走 `keep='tail'` 预算
//    （"最近"才是有用的，丢尾部比不截更糟）。


/**
 * 「状态面板」—— 2026-09-17 建（README §九 那个"控制台面板"的**只读文本版**）。
 *
 * 回答一个问题：**"梅莫莉亚现在到底在干嘛？"**
 * 一屏给出：在跑吗（版本 + 指纹）· 体检红几条 · 闸门模式与最近一次判定 · **各能力这一程动过几次**
 * （干活统计）· 哨兵读数（作废口径 / 路径锚点 / 凭据）· 预算用量 · 待办还开着几条 · 最近一次注入。
 *
 * ⚠️ **只读聚合**：不改任何东西；缺哪一段就写"读不到"，不会整屏失败。
 * 它替代不了深挖 —— 末尾会点明"想深挖就走哪个工具 / 看哪个日志"。
 */
export const danganStatusTool = {
  name: 'dangan_status',
  description:
    '一屏看清"**梅莫莉亚现在什么状态**"：在跑吗（版本＋代码指纹）· 体检错/提示各几条 · 闸门模式与最近判定 · ' +
    '**各能力这一程动过几次**（没出现的 ＝ 一次都没动过）· 哨兵读数（作废口径/路径锚点/凭据）· 预算 · 待办还开着几条 · 最近一次注入。' +
    '⚠️ **只读聚合**；想深挖，它末尾会指明该用哪个工具 / 看哪个日志。',
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'text'],
      properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  },
  async execute() {
    try {
      return { ok: true, text: out(buildStatus(), 'dangan_status') }
    } catch (e) {
      return { ok: false, text: `dangan_status 出错：${e}` }
    }
  },
}

/**
 * 「待办」—— 2026-09-17 凌晨建（用户当天两句：**"你的待办全丢了。去找回来"** ＋
 * **"先做待办相关的自动化吧。不然你老是忘"**）。
 *
 * 只读的两个模式（**写待办**那半不在这儿：它挂在一个 `kind='待办'` 的落档里，由落笔半一起写）：
 *   · `list`（默认）：把待办文件里"**还开着的**"条目一次列清（不用我翻、不用我数）
 *   · `check`：机器能判的三类"该消的"（已标完成还留着 / 上游已结案 / 重复）
 *
 * 🔴 **2026-09-26 加「工程」（F35）** —— 挂在**同一条通道**上（**不新开工具**）：
 *   用户当天定的口径是"**待办是待办，工程是工程，这两个不是一回事**……**不允许将他们混为一谈**"
 *   ＋"**工程也是需要我在面板上能直接看到的**"。
 *   · `list` 的输出末尾多一段【工程】（**另一份文件** `工程-清单.md`：跨很多轮、工程量爆表的那种活）；
 *   · `check` 也把工程那三类"该看的"带上（超字数 / 已标完成还挂着 / 重复）；
 *   · ⚠️ `clean` **只动待办** —— 工程是**手写**的（"做完就离开"那一步由人做，机器不替它归档）。
 */
export const danganTodoTool = {
  name: 'dangan_todo',
  description:
    '待办三件事：`list`＝把待办文件里**还开着的**按章节列清（**末尾另附一段【工程】—— 另一份文件，跨很多轮、工程量爆表的那种活，与待办不是一回事**）；`check`＝机器能判的三类"该消的"（已标 ✅/🔚 却还留着 · 上游 T/E 已结案 · 同一条重复 —— 四路判据）；`clean`＝**把该消的移出**。\n' +
    '🔴 `clean` 只是**移出**（删行 ＋ 往 **`L8-施工归档\\待办归档\\待办归档.md`** 的表尾追加一行，信息不丢），**默认干跑**（`apply:true` 才真动）；**只动"作者自己标了 ✅/🔚"那一类**（"重复""上游已结案"只报不自动删，会误伤）。走改档那扇唯一的门（先快照、可回滚），且**幂等**。⚠️ **`clean` 只管待办，不碰工程**。\n' +
    '⚠️ 它**不判断"算不算完"**（那是人的判断）；**写待办**挂在落档里：`dangan_weave pattern:\'落档\'` 带 `kind=\'待办\'` 时顺手写一行、**已记过的不重复写**（**工程不走这条路** —— 它是手写的）。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      mode: { type: 'string', enum: ['list', 'check', 'clean'], default: 'list', description: 'list=列还开着的（默认）· check=列出"该消的" · clean=把"已标完成还挂着"的**移出并归档**（默认干跑）' },
      apply: { type: 'boolean', default: false, description: '**只在 `clean` 时用**：true＝真移出（走改档那扇门、先快照）；默认 false＝干跑' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'text'],
      properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  },
  async execute(args) {
    try {
      const mode = args?.mode === 'check' ? 'check' : args?.mode === 'clean' ? 'clean' : 'list'
      if (mode === 'check') {
        const c = todoStaleCandidates()
        // 🔴 2026-09-26：**工程那三类也一起挑**（超字数 / 已标完成还挂着 / 重复）——
        //    但**分开报**（用户："不允许将他们混为一谈"），而且行号各自回各自那份文件去对。
        const pc = projectStaleCandidates()
        const head =
          c.length === 0
            ? '【dangan_todo · check】没有"看起来该消"的**待办** —— 待办表干净'
            : '【dangan_todo · check】机器挑出 ' + c.length + ' 条"该消的"（都是提示；"算不算完"仍由人判）：'
        const headP =
          pc.length === 0
            ? '【工程】没有"该看的" —— 工程清单干净'
            : '【工程】机器挑出 ' + pc.length + ' 条"该看的"（都是提示）：'
        const lines = [head]
        for (const x of c) lines.push(`  · ${x.line ? `第 ${x.line} 行 · ` : ''}${x.msg}`)
        lines.push('', headP)
        for (const x of pc) lines.push(`  · ${x.line ? `第 ${x.line} 行 · ` : ''}${x.msg}`)
        return { ok: true, text: out(lines.join('\n'), 'dangan_todo') }
      }
      if (mode === 'clean') {
        const p = todoPlanClean()
        if (p.moves.length === 0) return { ok: true, text: formatCleanPlan(p, { applied: false }) }
        if (args?.apply !== true) return { ok: true, text: out(formatCleanPlan(p, { applied: false }), 'dangan_todo') }
        // 真移出：交给落笔半那条路（同一个内核、同一扇门）
        const built = todoCleanOps({ plan: p })
        const r = runTxnOps(built.ops, `待办清理：${built.note}`)
        if (!r.ok) {
          return { ok: false, text: `【dangan_todo · clean】❌ **没落成**（一个字没改）：${r.why}\n${String(r.out ?? '').slice(-800)}` }
        }
        return { ok: true, text: out(`${formatCleanPlan(p, { applied: true })}\n\n${String(r.out ?? '').trim().slice(-600)}`, 'dangan_todo') }
      }
      return { ok: true, text: out(formatTodoList() + '\n\n' + formatProjectList(), 'dangan_todo') }
    } catch (e) {
      log(`dangan_todo 出错: ${e}`)
      return { ok: false, text: `dangan_todo 出错：${e}` }
    }
  },
}

// 🔴 **原先独立的 `dangan_index` 并进 `dangan_check` 的 `scope="index"`（2026-09-18 工具合并），
//    那个 scope 又于 2026-10-15 随事件表退役删除**（用户拍板「没用就删了」）。 <!-- F25-已确认 2026-10-15 -->

/**
 * 「从 0 建档案」—— 2026-09-17 晚建（F20）。
 *
 * 用户当天定的标准：**插件包会被上传，但档案不能被上传** ——
 * 所以"别人下载插件后，能在**全新环境**里从 0 建出一座能用的档案馆"必须是一条能力。
 *
 * 🔴 **默认干跑**（`apply` 不给就一个字都不写）；**只补缺、绝不覆盖**（已有内容一个字都不动）。
 *    这是"会动用户磁盘"的动作，所以照《防丢失流程》：**先出方案、再动手**。
 */
/**
 * 「织布机」—— **统一写入入口**（F36 · 2026-10-07 建 · 织布机工程节点 3）。
 *
 * 它是什么：用户 2026-09-29 定的那条路 —— **把"所有文档编写"收进一条**：
 * 输入端口（我给线）→ 格式端口（只准选）→ 织布机（机器）→ 文档。
 *
 * 🔴 **2026-10-16 更新**：它当年是与 `dangan_log` **并联**（接管三步的第 1 步）；**后来 `dangan_log` 已删**
 *    （落档收进织布机）⇒ 现在织布机就是那条路本身，走的是**同一段组装件**（`planCommit` / `planTodoAdd`）
 *    与**同一扇门**（`f9-commit.js` 的 `runTxnOps` → `改档.mjs --txn`）。
 * ⚠️ 施工手册 §六 最后一条：`output.schema` **必须声明 `data`** —— 少声明一个字段，
 *    harness 就判"工具输出非法"，而"报错 ≠ 没写"这件事从错误信息里看不出来。
 */
export const danganWeaveTool = {
  name: 'dangan_weave',
  description:
    '**织布机**（统一写入入口 · **默认只出提案**，`commit:true` 才真写）：一次调用把 N 条内容按**格式（纹样）**织进文档。\n' +
    '· 现有纹样：`待办` · `索引`（从各文件开头三行派生）· `地图`（现算结构）· `备查` / `指南`（**新建一份 L3 文档**，H1 ＋ 三行自述由织布机补）· `引用改写`（照一条分拣好的清单批量改引用）；⚠️ `元类` 格式未定 ⇒ **只拒不动**。\n' +
    '· **格式锁定**：`pattern` 给了 `doc`（目标文档）⇒ 按那份文档的**名字**锁死它的格式，与 `id` 冲突就拒（改已有文档时格式没得选）。\n' +
    '· `items` 是**数组**（哪怕只织一条）—— **一次织多份**就是它的省钱点（少几个来回；ⓘ 钱的大头是"新塞进去的字"，历史走缓存命中、几乎白送 —— 见 `备查-计费口径.md`）。\n' +
    '📖 四层、拒收边界、接管三步见 `L4-施工/工程-织布机-总纲.md`（⚠️ 原来指的 `工程-织布机-设计（节点3）.md` 已随融合删除，2026-10-15 改指）。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['pattern', 'items'],
    properties: {
      // ⚠️ 不写 `type` —— 它允许两种形状（字符串 / 对象），写死一种会把另一种挡在门外
      pattern: {
        description: '纹样名（`待办` / `索引` / `地图` / `备查` / `指南` / `引用改写`），或 `{ id, doc?, mode? }` —— **给了 `doc` 就锁死那份文档的格式**。',
      },
      items: {
        type: 'array',
        items: { type: 'object' },
        description:
          '线：一次织几梭（**永远给数组**，哪怕只织一条）。' +
          '⚠️ **字段名按纹样不同**：`待办` 用 item/why/goal/term/owner · ' +
          '`备查`/`指南` 用 主题/what/when/body · ' +
          '`引用改写` 用 清单 · 目录/索引/地图/引用去路径/行号加固 **给空对象 `{}` 就行**（它们自己从档案现算）。',
      },
      parallel: {
        type: 'boolean',
        default: false,
        description: 'true＝允许把这一批摊到多份文档上（⚠️ 落盘口是阻塞 spawn ⇒ **物理上仍是顺序**，回执里会写明）。',
      },
      commit: {
        type: 'boolean',
        default: false,
        description: 'true＝真织进档案（走唯一那扇门 ＋ 快照 ＋ 读回比对）；默认 false＝只出提案（与落档那条路一致）。',
      },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'text'],
      properties: {
        ok: { type: 'boolean' },
        text: { type: 'string' },
        data: { type: 'object' },
        // 🔴 2026-10-15 补：`weave()` 的回执顶层还带这两个（实测 `tests/f9-commit.mjs` 的
        //    "凡返回值的字段必须在 output.schema 里声明过"当场抓到）——
        //    漏了它们＝harness 判「工具输出非法」⇒ **整条回执作废**（《施工手册》那个"会吞掉报告"的病）。
        out: { type: 'string' },
        why: { type: 'string' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  },
  async execute(args) {
    const a = args ?? {}
    try {
      return await weave(a.pattern, a.items, { parallel: a.parallel === true, commit: a.commit === true })
    } catch (e) {
      // 「织之前」的错（参数 / 格式）⇒ 转成 {ok:false}（**说清 ＋ 给机械可行的出路**）；
      // ⚠️ **别的错不吞** —— 参数不合法要刺眼地失败（照落档那条路的姿态）。
      if (e && e.name === 'LoomReject') {
        return {
          ok: false,
          text: `【织布机 · 没织】${e.message}${e.hint ? `\n   💡 ${e.hint}` : ''}`,
          data: { rejected: true, kind: e.kind ?? '', index: e.index ?? null, doc: e.doc ?? null },
        }
      }
      throw e
    }
  },
}

export const danganInitTool = {
  name: 'dangan_init',
  description:
    '**从 0 建一座《DeepSeek档案》**（新环境第一次用、或档案根指向了一个还不存在的地方时用它）。' +
    '先看清状态（缺什么），再按内置骨架建出：`L1-必读` / `L3-知识` / `L4-施工` / `L5-证据` / `L6-工具临时` / `L8-施工归档` 六个目录 ＋ 入口 `从这开始读.txt` ＋ 铁律 ＋ 使用说明（W0~W6 全套判据）＋ 总览 ＋ 索引 ＋ 工具速查 ＋ 错误总账 ＋ 待办 ＋ 工程清单 ＋ 防丢失流程。' +
    '🔴 **默认干跑**（只回"将要建哪些"）；给 `apply:true` 才真写。**只补缺、绝不覆盖**：已存在的文件一个都不动、只跳过并报出来。' +
    '⚠️ 建完还要**照 W4 收尾**把这件事落进 L3（用 `dangan_weave pattern:\'落档\'`，判据见 W5）；骨架文件里的「（还没有）」这类占位行，贴完真内容就删掉。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      apply: { type: 'boolean', default: false, description: 'false（默认）=干跑，一个字都不写；true=真建' },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'text'],
      properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  },
  async execute(args) {
    try {
      const st = archiveState()
      const r = bootstrap({ apply: args?.apply === true })
      const head = `【现状】档案根 \`${st.dir}\`：${STATE_TEXT[st.kind] ?? st.kind}${st.missing.length > 0 && st.kind !== 'ok' ? `（缺：${st.missing.join('、')}）` : ''}\n`
      return { ok: r.ok, text: out(head + '\n' + formatBootstrap(r), 'dangan_init') }
    } catch (e) {
      log(`dangan_init 出错: ${e}`)
      return { ok: false, text: `dangan_init 出错：${e}` }
    }
  },
}

const STATE_TEXT = {
  missing: '**不存在**（全新环境）',
  empty: '在，但**关键件一份都没有**',
  partial: '在，但**缺关键件**',
  ok: '关键件齐全',
}

// ⚠️ **原先独立的 `dangan_map` 已并进 `dangan_check`（`scope="map"`）** —— 2026-09-18 工具合并，<!-- F25-已确认 2026-09-18 -->
//    实现见上面的 `runMapScope()`（仍旧**只调那台生成器**，不自己渲染 —— 第二个渲染器必漂）。

// ⚠️ **原先独立的 `dangan_overview` 已并进 `dangan_check`（`scope="overview"`）** —— 2026-09-18 工具合并，<!-- F25-已确认 2026-09-18 -->
//    实现见上面的 `runOverviewScope()`。
//    🔴 两条纪律一个字没改：**它绝不写档案**（写入只走那扇唯一的门）；**它也不生成"最近要事"**
//    （那件事的唯一数据源是 `dangan_search mode="recent"`；再造一份＝副本，而且《总览》属 L1，
//     2026-09-29 前那套压缩后重注入会把入口全文一起塞进去 → 总览一厚、注入就厚；那条机制已砍，但「总览要薄」这条判据不变）。
