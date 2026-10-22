// ============================================================
// reconcile —— 留底"补完没有"的**机械对账**（销账时不必人读骨架）
// ============================================================
//
// 为什么有它（2026-09-20 凌晨，用户第三次提同一件事：
//   "我归档了两个会话……但之前这样几次都大概会用掉百分之十的上下文"）：
//
//   骨架法（`lib/skeleton.js`）已经把"读的东西"从 358K 压到 21K（5.9%），
//   但**销账仍然要人做的事**没变：读骨架 → 拿眼睛逐条对着档案找 → 落一条档 →
//   删主份。实测两份留底 9 条用户真事 **全部早已进档**（0 真缺口），
//   却仍要走完这一整轮 —— 而且为了让 T 跨过基准，还要**空落一条档**。
//
//   → 真正该机械化的不是"压小"，是"**比对**"：档案是文本库，用户真事是游标，
//     这件事机器全能做。人只该看机器挑出来的那几条"疑似没进档"。
//
// 🔴 **它的定位（2026-09-20 两轮独立对抗审查之后定死）：只当"筛子"，不当"判官"。**
//    审查抓到 4 类它挡不住/曾判错的情形（`%TEMP%\recon-verify\` 有可复现样本）：
//      · **静默丢事实**（已修，最重）：原来按 `/^## /m` 切骨架，用户正文里有一行
//        `## ` 开头就会把其后原文整段丢掉 → 真事数变 0 → CLI **exit 0 空过**。
//        现在只认真正的段边界（`## 用户 · ` / `## 我 · `），且"真事 0 条"一律报错。
//      · **语义反转**（只能缓解）：正文 `千万别把镜像装法补进去` vs 档案 `把镜像装法补进去`
//        —— 字面连续匹配一模一样，语义相反。现在靠"否定词落在匹配段之外就降级"兜。
//      · **凭空造**（已修）：拿档案里的高频词拼句子也能凑分 → 改成"最长连续匹配"后失效。
//      · **碎片合谋**（已修）：见下面判据③。
//    → 所以**永远不许**拿它的"0 缺口"直接放行销账；⚠️/❌ 也只是"要人看一眼"。
//
// 判据（**保守**：宁可多报"可疑"，绝不轻判"已覆盖"）：
//
//   ① 归一化真事与档案每一行（只留汉字/字母/数字，**连标点一起去掉** —— 档案引用
//      用户原话时标点常被改写）。真事每个位置取一个探测窗口（5 字优先，退化到 4 字）。
//   ② 窗口在档案里找，命中行数 **> MAXHIT 的窗口不算证据**（太常见＝没区分度）。
//   ③ 🔴 **主判据是"最长连续匹配"（LCC），不是"命中窗口的个数"**。这一点被两次实测逼出来：
//      · 第一版按"∑命中窗口数"打分 → **碎片合谋**：虚构真事
//        「另一个会话正在装插件内容一模一样备份还原一致」，四个互不相干的条目
//        （会话救援 / 文档减重 / 重复注入 / 到点提醒）各贡献几个窗口，隔着几百行也能凑够分 → 误判 ✅。
//      · 第二版改"按行聚合再分块" → **还是没堵住**：档案里一行是很长的段落，
//        **同一行内**照样能塞下几个语义无关的词。
//      · 所以只有"**连续**"才算证据：真覆盖时用户原话会**整段连续**出现在某一行里。
//   ④ 判"已覆盖"：`lcc ≥ LCC_STRONG`（连续 10 字＝铁证）**或**
//      （`lcc ≥ LCC_OK` **且** `lcc / 真事长度 ≥ COV_OK`），**且**不触发语义反转。
//      · 覆盖率挡"半真半假"（前半句在档案里、后半句全新）；但它**不能单独用** ——
//        长真事常被档案只引一段，只按比例判会把"连续 11 字"这种铁证罚成"可疑"。
//      · **短句（归一化后 < 8 字）一律不判"已覆盖"**（最高只到"可疑"）：7 个字里换一个
//        词就换意思（`不要重启控制台` vs 档案 `要重启控制台`），字面判据分不出来。
//   ⑤ 有匹配但不够 → ⚠️ 可疑；一点没匹配上 → ❌ 未覆盖（后两档**都要人看一眼**）。
//
//   🔴 **它只认字面**：档案里若把用户原话改写成了完全不同的措辞，它会报"未覆盖"
//      （假阴性）。报错了只是多看一眼，漏报才是空删 —— 所以判据一律往保守那边偏。
//   🔴 **必须扫 L3**（2026-09-20 实测踩到）："镜像装法补进去"这种活，落点是
//      `L3-知识\工具-装插件的方法.md` 而**不是** L2 —— 只扫 L2 会把它误报成 ❌。
//
// ⚠️ L5-证据 / L6-工具临时 **不扫**（与全档检索同一口径：那是原始证据与临时件）。
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 一个窗口在档案里命中超过这么多行 → 视为"没区分度"，不计证据。 */
const MAXHIT = 30
/** 判"已覆盖"要求的**最长连续匹配**长度（归一化字符）。 */
const LCC_OK = 6
/**
 * **连续这么长就直接算硬证据**（不再看覆盖率）。
 * 🔴 为什么需要这一档（2026-09-20 回归实测）：用户真事常常很长（50+ 字），而档案只引用
 *    其中一段 —— 只按覆盖率判，会把"连续命中 11 字"这种**铁证**判成"可疑"。
 *    覆盖率是用来挡"半真半假"的，不该反过来罚"档案引用得短"。
 */
const LCC_STRONG = 10
/** 判"已覆盖"要求的**覆盖率**（连续匹配长度 ÷ 真事长度）—— 挡"半真半假"。 */
const COV_OK = 0.4
const COV_OK_SHORT = 0.8
/** 真事归一化后短于这个长度 → 按短句算。 */
const SHORT = 8
/**
 * 否定/反转词（**语义反转防线**）。
 * 规则：真事里出现这类词、而它落在**匹配段之外** → 说明真事比"档案里那句"多了限定
 * （"**千万别**把X补进去" vs 档案"把X补进去"）→ 一律降级为"可疑"，让人看一眼。
 * ⚠️ 它只往保守方向偏（只会把 ✅ 降成 ⚠️），所以宁可写宽一点。
 */
const NEG_RE = /(不要|不能|不用|无需|不可以|取消|撤销|卸载|回滚|删掉|删除|算了|千万别|别把|别再|不是)/
/** 扫哪些顶层目录（**不含** L4/L9）。 */
// 🔴 2026-10-15：加回 `L2-用户` —— 那层装"用户和你的事"，**也是正文**，留底核账当然要扫它。
export const SCAN_ROOTS = ['L1-必读', 'L2-用户', 'L3-知识']
/** 单份文档超过这个字节数就跳过（防某天有人往里塞个大备份把对账拖死）。 */
const MAX_FILE_BYTES = 4 * 1024 * 1024

const CJK_RE = /[\u4e00-\u9fff]/g
const cjkCount = (s) => (s.match(CJK_RE) ?? []).length

/**
 * 归一化：只留汉字/字母/数字。
 * ⚠️ **故意连标点一起去掉** —— 档案里引用用户原话时标点常被改写（"，"→"："）。
 *    去掉之后"疯狂给你灌水"这种连续片段才对得上。
 */
export const normalize = (s) => String(s ?? '').toLowerCase().replace(/[^\u4e00-\u9fffa-z0-9]+/g, '')

/**
 * 归一化串 → **逐个位置**的探测窗口（5 字优先，退化到 4 字；含 ≥3 汉字才算数）。
 * ⚠️ 按"位置"取而不是按"窗口集合"取：同一串里同一个词可能出现在不同位置，
 *    连续匹配要靠位置算，丢了位置就算不出 LCC。
 */
export function probesOf(norm) {
  const out = []
  for (let i = 0; i + 4 <= norm.length; i++) {
    const a5 = i + 5 <= norm.length ? norm.slice(i, i + 5) : ''
    const w = a5 && cjkCount(a5) >= 3 ? a5 : norm.slice(i, i + 4)
    if (cjkCount(w) < 3) continue
    out.push({ i, w })
  }
  return out
}

/**
 * 骨架文本 → 用户真事清单。
 *
 * 🔴 **切分只认真正的段边界**（`## 用户 · <时间>` / `## 我 · <时间>`）。
 *    2026-09-20 独立对抗审查抓到的**静默丢事实**就是这样来的：原来按 `/^## /m` 切，
 *    用户正文里只要有一行以 `## ` 开头（贴 Markdown 很常见），那行之后的原文就被当成
 *    "新段"、因不以"用户 · "开头而**整段丢掉** —— 真事数还会变 0，CLI 于是 exit 0 空过。
 *    **这是最危险的一类：不是判错，是根本没看。**
 */
export function extractUserFacts(skeletonText) {
  const text = String(skeletonText ?? '')
  const facts = []
  // ⚠️ 段里**不含** `## ` —— lookahead 是零宽的，分隔符不落进任何一段。
  const parts = text.split(/^## (?=(?:用户|我) · )/m)
  for (const p of parts) {
    if (!p.startsWith('用户 · ')) continue
    const nl = p.indexOf('\n')
    // ⚠️ 段里**不含** `## `（lookahead 是零宽的）→ 别拿 `'## 用户 · '.length` 去切，
    //    那会多吃 3 个字符（2026-09-20 实测：时间显示成 `6-09-20`）。用正则最稳。
    const time = /^用户 · (.+)$/.exec(nl < 0 ? p : p.slice(0, nl))?.[1]?.trim() ?? ''
    const body = (nl < 0 ? '' : p.slice(nl + 1))
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('> 〔已省略机器注入')) // 占位行不是真事
      .join('\n')
      .trim()
    if (!body) continue
    facts.push({ time, text: body })
  }
  return facts
}

/** 递归收集要扫的 `.md`（**带刹车**：只走白名单根、跳过超大的单份）。 */
function collectDocs(archiveDir) {
  const out = []
  const walkDir = (dir) => {
    let ents = []
    try {
      ents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walkDir(p)
        continue
      }
      if (!e.name.toLowerCase().endsWith('.md')) continue
      try {
        if (statSync(p).size > MAX_FILE_BYTES) continue
      } catch {
        continue
      }
      out.push(p)
    }
  }
  for (const r of SCAN_ROOTS) {
    const d = join(archiveDir, r)
    if (existsSync(d)) walkDir(d)
  }
  return out
}

/**
 * 档案文本库：把要扫的文档逐行拼成一个大串
 * （大串上一次 `indexOf` 比"每个窗口 × 每行"快两个数量级），并记下每行在大串里的起点。
 */
export function loadArchive(archiveDir) {
  const docs = collectDocs(archiveDir)
  if (docs.length === 0) return { text: '', lines: [], starts: [], files: [], err: `档案里没扫到任何 .md（${archiveDir}）` }
  const lines = []
  const files = []
  for (const p of docs) {
    let raw = ''
    try {
      raw = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    const relPath = p.slice(archiveDir.length + 1)
    files.push(relPath)
    const arr = raw.split(/\r?\n/)
    for (let i = 0; i < arr.length; i++) lines.push({ file: relPath, no: i + 1, raw: arr[i], norm: normalize(arr[i]) })
  }
  let text = ''
  const starts = new Array(lines.length)
  for (let i = 0; i < lines.length; i++) {
    starts[i] = text.length
    text += lines[i].norm + '\n'
  }
  return { text, lines, starts, files }
}

/** 大串偏移 → 行下标（二分）。 */
function lineAt(starts, off) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= off) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 命中行 → 最近的 `T<n>` / `E<n>` 锚点（先看本行，再向上找，最多 250 行）。 */
function anchorsNear(lines, idx) {
  const pick = (s) => {
    const t = /\*\*T(\d+)\*\*/.exec(s) ?? /\bT(\d+)\b/.exec(s)
    const e = /(?:^|\|\s*)E(\d+)\s*[｜|]/.exec(s) ?? /\bE(\d+)\b/.exec(s)
    return { t: t ? `T${t[1]}` : '', e: e ? `E${e[1]}` : '' }
  }
  const self = lines[idx] ? pick(lines[idx].raw) : { t: '', e: '' }
  if (self.t || self.e) return self
  for (let i = idx - 1; i >= 0 && i > idx - 250; i--) {
    const a = pick(lines[i].raw)
    if (a.e || a.t) return a
  }
  return { t: '', e: '' }
}

/**
 * 对账一份骨架。**纯读**（不写任何东西）。
 *
 * ⚠️ **返回 `ok:false` 的三种情形都是"别信这次对账"**，调用方一律不许当成"0 缺口"：
 *    读不到骨架 / 档案扫不到 / **解析出 0 条真事**或与骨架头声明的条数不符。
 *
 * @param {string} skeletonPath
 * @param {{archiveDir:string}} opts
 */
export function reconcileSkeleton(skeletonPath, opts = {}) {
  const archiveDir = opts.archiveDir
  let skText = ''
  try {
    skText = readFileSync(skeletonPath, 'utf8')
  } catch (e) {
    return { ok: false, why: `读不到骨架：${e?.message ?? e}`, facts: [] }
  }
  // ⚠️ `opts.archive` ＝ 调用方**已经加载好的档案文本库**（2026-09-20：归档路一次可能处理好几份留底，
  //    共享一份就不必每份都重扫 1.4 MB）。没给就自己加载 —— 单份调用照旧。
  const arc = opts.archive ?? loadArchive(archiveDir)
  if (arc.err) return { ok: false, why: arc.err, facts: [] }

  const facts0 = extractUserFacts(skText)
  // **交叉校验**：骨架头（2026-09-20 起）会写明"用户真事 N 条" —— 解析数与它不符就停手。
  // 🔴 2026-10-10 修（用户问"为什么销账老漏内容"时抓出来的）：**骨架可能叠了好几份** ——
  //    留底被压缩两次 ⇒ 骨架跟着**接写**两次（`skeleton.js` 的 `mode='append'`，那是有意的设计），
  //    于是文件里会有**两个 `# 骨架（销账用）` 与两个"用户真事 N 条"**。
  //    原来只读**文件开头 20 行**那一个声明 ⇒ 一遇叠份就报"切分可疑，这次对账别信" ⇒
  //    **整条销账路被堵死**（实测 2026-10-10 卡了 3 轮，最后只能人肉读 3191 行）。
  //    ⇒ 现在把**每一份的声明都抓出来**、拿**它们之和**跟解析数比（`29 + 25 = 54` ✅ 才算对）。
  const declaredAll = [...skText.matchAll(/^>\s*用户真事\s*(\d+)\s*条/gm)].map((m) => Number(m[1]))
  const declared = declaredAll.length > 0 ? declaredAll.reduce((a, b) => a + b, 0) : NaN
  if (facts0.length === 0) {
    return { ok: false, why: '这份骨架解析出 **0 条用户真事** —— 切分或格式有问题，**不许当成"0 缺口"**', facts: [] }
  }
  if (Number.isFinite(declared) && declared !== facts0.length) {
    const detail = declaredAll.length > 1 ? `（骨架里有 **${declaredAll.length} 份**，各份声明 ${declaredAll.join(' + ')}）` : ''
    return { ok: false, why: `骨架头声明"用户真事 ${declared} 条"${detail}，却只解析出 ${facts0.length} 条 —— **切分可疑，这次对账别信**`, facts: [] }
  }

  const sid = /骨架-\S*?-([0-9a-f]{8})/.exec(skeletonPath)?.[1] ?? ''
  const facts = facts0.map((f) => {
    const norm = normalize(f.text)
    const short = norm.length < SHORT
    const probes = probesOf(norm)

    /** 窗口在档案里命中哪些**行内位置**；命中行数 > MAXHIT 的窗口＝没区分度，返回 null。 */
    const hitsOf = (w) => {
      let from = 0
      const at = []
      for (;;) {
        const i = arc.text.indexOf(w, from)
        if (i < 0) return at
        const row = lineAt(arc.starts, i)
        at.push({ row, pos: i - arc.starts[row] })
        if (at.length > MAXHIT) return null
        from = i + 1
      }
    }

    // 每行能**连续**匹配真事多长 —— 这才是证据。以每个探测窗口为锚点向左右扩。
    // 存 `{ span, l }`：span＝连续长度，l＝匹配段在真事里的起点（语义反转判据要用）。
    const rowBest = new Map()
    for (const { i, w } of probes) {
      const hits = hitsOf(w)
      if (!hits) continue
      for (const { row, pos } of hits) {
        const line = arc.lines[row].norm
        let l = i
        let pl = pos
        let r = i + w.length
        let pr = pos + w.length
        while (l > 0 && pl > 0 && norm[l - 1] === line[pl - 1]) {
          l--
          pl--
        }
        while (r < norm.length && pr < line.length && norm[r] === line[pr]) {
          r++
          pr++
        }
        const span = r - l
        const prev = rowBest.get(row)
        if (!prev || span > prev.span) rowBest.set(row, { span, l })
      }
    }
    let lcc = 0
    let best = null
    let bestRow = -1
    for (const [row, v] of rowBest) {
      if (v.span > lcc) {
        lcc = v.span
        best = v
        bestRow = row
      }
    }
    const cov = norm.length > 0 ? lcc / norm.length : 0
    // 🔴 **短句（归一化后 < 8 字）一律不判"已覆盖"**（2026-09-20 对抗审查）：
    //    7 个字里换一个词就换意思 —— "**不要**重启控制台" 与档案里的"要重启控制台"
    //    字面几乎一样，判据分不出来。短句本来就该人看一眼，代价只有一行。
    // **语义反转防线**：否定词落在匹配段**之外** → 真事比档案那句多了限定 → 降级
    let flip = false
    if (best) {
      const seg = norm.slice(best.l, best.l + best.span)
      const outside = norm.slice(0, best.l) + norm.slice(best.l + best.span)
      flip = NEG_RE.test(outside) && !NEG_RE.test(seg)
    }
    const strong = !short && (lcc >= LCC_STRONG || (lcc >= LCC_OK && cov >= COV_OK))
    const verdict = strong && !flip ? 'ok' : rowBest.size > 0 ? 'weak' : 'miss'
    // 锚点取**连续匹配最长**的那两行
    const idxs = [...rowBest.entries()].sort((a, b) => b[1].span - a[1].span || a[0] - b[0]).slice(0, 2).map(([i]) => i)
    const anchors = idxs.map((i) => ({ ...anchorsNear(arc.lines, i), file: arc.lines[i].file, no: arc.lines[i].no, span: rowBest.get(i).span }))
    const uniq = [...new Set(anchors.map((a) => `${a.t}${a.e ? '/' + a.e : ''}`).filter(Boolean))]
    // 🔴 2026-09-28 加：把**命中那几行的原文**一并带出来 —— 用户当天定："**工具直接把这些东西融合给你，
    //    让你不用一次次调用**，确实可行"。销账里最贵的一步是"我 grep/read 一轮轮去捞档案那边的原文"，
    //    而命中在哪**本来就是这里算出来的** —— 端上来就省掉那十几轮。只截断给我一眼看够，不追全文。
    const EV_CHARS = 240
    const evidence = idxs.map((i) => ({
      file: arc.lines[i].file,
      no: arc.lines[i].no,
      raw: String(arc.lines[i].raw ?? '').slice(0, EV_CHARS),
    }))
    return { ...f, norm, short, lcc, cov, flip, hits: lcc, need: LCC_OK, verdict, anchors, ids: uniq, at: idxs, bestRow, evidence }
  })

  return {
    ok: true,
    sid,
    skeletonPath,
    archiveDir,
    scannedDocs: arc.files.length,
    facts,
    summary: {
      total: facts.length,
      ok: facts.filter((f) => f.verdict === 'ok').length,
      weak: facts.filter((f) => f.verdict === 'weak').length,
      miss: facts.filter((f) => f.verdict === 'miss').length,
      flip: facts.filter((f) => f.flip).length,
    },
  }
}

/**
 * **候选池过滤**（2026-09-23 · 《留底全自动销账》v3-7）—— 这几类**不进候选池**：
 *   · 归一化后 **少于 6 字**（`嗯？` / `.` 这种，摆出来也判断不出什么）
 *   · **一个字母数字都没有**（纯标点 / 纯符号）
 *   · 与**上一条事实**归一化后完全相同（同一句念叨两遍）
 *
 * ⚠️ **它只影响"摆给人看的那几行"，一个字都不动判据**（`verdict` / 覆盖率 / 锚点照旧）——
 *    所以被滤掉的份**仍然留在 `pending\`、留意栏仍报它**，只是不再拿一句废话占人的注意力。
 * 📌 用户口径（讨论稿 §六）："候选池：`开工` · `。。` · `我已重启` 不入池；长句真事入池"。
 *
 * @param {object} f 一条 fact（来自 `reconcileSkeleton()`）
 * @param {object|null} [prev] 上一条 fact
 */
export function isCandidate(f, prev = null) {
  const s = String(f?.norm ?? '').trim()
  if (s.length < 6) return false
  if (!/[\p{L}\p{N}]/u.test(s)) return false
  if (prev && String(prev.norm ?? '').trim() === s) return false
  return true
}

/** 一行摘要（给 CLI 与将来的留意栏共用）。 */
export const factLine = (f) => {
  const head = f.text.length > 46 ? `${f.text.slice(0, 46)}…` : f.text
  const icon = f.verdict === 'ok' ? '✅' : f.verdict === 'weak' ? '⚠️' : '❌'
  const at = f.ids.length ? ` → ${f.ids.join(' ')}` : ''
  const why = f.verdict === 'ok' ? '' : `（连${f.lcc}字 · 覆盖${Math.round((f.cov ?? 0) * 100)}%${f.flip ? ' · 疑似语义反转' : ''}）`
  return `${icon} ${f.time} ${head.replace(/\n/g, ' ')}${at}${why}${f.short ? '（短句）' : ''}`
}
