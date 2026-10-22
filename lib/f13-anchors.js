// ============================================================
// F13 · 有效性锚点（2026-09-17 建 · 事件 E64 / 锚点 T201）
// ============================================================
//
// **抄谁**：`@max-null/dsh-memory` 的 `anchors.js` / `engine.js`（生态调研文档 §5.2 第 6 条，
//   B 路评为"对梅莫莉亚性价比最高"的一条）。它把"关键结论"绑到**可探测的环境事实**上，
//   值不符就标 stale；而且有一条**必须照抄的判据**：
//     🔴 **探测不到 ＝ 未校验，绝不判失效**（`anchors.js:34-44`）。
//
// **为什么需要**：档案里"**这个工具在哪 / 这个脚本怎么调**"这类结论，**环境一变就静默变错**
//   —— 而这是最难发现的失效方式（没人会去重读一份"工具速查"）。
//
// ---------------------------------------------------------------------------
// ⚠️ 这一条的路是**试跑三次才走通的**，过程必须留着（免得以后有人又按第一版去做）：
//
//   ① **全档案抽路径**（`[A-Za-z]:\\…`）→ 命中 **1,915 行 / 1,243 条不同路径 / 231 条探测不到**。
//      → 不可用：其中 **180 条**来自 `清单-2026-09-13-三盘全量扫描.txt` —— 那份**自己标着
//      "快照·非现状"**，里面的路径本来就该是旧的；剩下的大半是**叙述里的引用**，不是"事实"。
//   ② **只查"工具类文档"**（名字含 工具/速查/索引，排除 快照/全量扫描）→ 76 条 / 15 条不存在。
//      → 还是不行：15 条里 **9 条是抽取噪音** —— `C:\Program`（原文是 `C:\Program Files\…`
//      被空格截断）、`D:\某目录`（占位符）、`C:\…\Edge\User`（截断）。
//   ③ **只认反引号里当路径写的**（`` `C:\…` ``）→ **61 条 / 9 条不存在**，逐条可读、可判。
//      ✅ 这一版能用。
//
// 📌 **教训（写在这儿，免得重犯）**：**"能抽出来"不等于"是事实"**。
//    档案里的路径有三种用法 —— ① **事实**（工具在哪）② **举例** ③ **记录已删除/已退役的东西**；
//    机器分不清，所以：
//      · **只查 L1（"现行"层）＋ 只认反引号里当路径写的**；
//      · 探测不到只报**提示**、不报错（错要留给机器真能判的事）；
//      · 行里写明"举例 / 已删除 / 已退役 / 当时 / 原 xxx"的，**跳过**（照 F2 作废哨兵那套
//        "谈论它 ≠ 使用它"的过滤）。
//
//    ⚠️ 这一条是**试跑四次才走通的**，四版都在真档案上量过（**过程留着，免得以后有人按前几版去做**）：
//    ① 全档案抽路径 → 1,915 行 / 1,243 条 / **231 条"探测不到"**；其中 **180 条**来自一份**自己标着
//       "快照·非现状"**的文件，剩下大半是"叙述里的引用" → **不可用**。
//    ② 只查"工具类文档"（含 L3 的 `工具-*.md`）→ 76 条 / 15 条，其中 **9 条是抽取噪音**
//       （`C:\Program`＝`C:\Program Files\…` 被空格截断 / `D:\某目录`＝占位符 / 被截断的片段）。
//    ③ 只认反引号里的路径 → 61 条 / **9 条**；逐条看 **7 条是误报**（"**原** `E:\Tools`"、
//       "已于 09-15 **删除**"、"该目录**已不存在**"），**只有 1 条真过期**。
//       → 关键教训：**档案里的路径八成是"历史 / 记录"性质**，直接当"事实"查，噪音率极高。
//    ④ **只查 L1** ＋ 补两轮过滤词 → 真档案 **26 条路径 / 只剩 1 条真问题**
//       （`工具速查.md` 那条 WizTree 已不在工具箱 —— **发现当天就改了档案**）。✅ **这一版能用。**
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs'

import { CFG, baseOf, findByNameUnique, readTextSafe, rel, walk, writeHealth } from './common.js'

/**
 * **只查 L1（"现行"层）** —— 理由比"按文件名猜"硬：**L1 是现行的**（规则 / 总目录 / 工具速查 /
 * 总览里的"我的东西在哪"），里面的路径**本来就该是准的**；**L3 是记录 / 历史层**（事故、当时的实测、
 * 卸载记录），里面出现旧路径是**正常的** —— 拿它当"过期"来报，只会得到一堆永远消不掉的告警。
 * （四版口径的完整过程见文件头。）
 */
const ONLY_CURRENT_LAYER = /^L1-/
/** 排除：历史快照（里面的路径本来就该是旧的；它自己就标着"快照·非现状"）。 */
const SNAPSHOT_HINT = ['快照', '全量扫描']

/**
 * 🔴 **派生件 —— 不当"现行事实"查**（2026-10-20 加）。
 *
 * 《索引》的内容来自**每一份文件自己的开头自述**，《地图》来自磁盘结构 —— 它们都是**转抄**，
 * 里面的路径不是"L1 的现行事实"，而是"某份文件自述里提到的那条路径"。
 *
 * 实测真事（这条提示在体检里挂了很久，一直消不掉）：L3 那份 `记录-2026-09-14晚-私盘整理与工具箱.md`
 * 的自述里写着「建立本地工具箱（`E:\Tools` → `E:\DeepSeek工具箱\`）」—— 那是**09-14 的史实**，
 * 被《索引》转抄进 L1 ⇒ f13 天天报"`E:\Tools` 找不到"。
 * ⇒ **消不掉的告警等于没有告警**（档案里的老教训），所以派生件直接跳过。
 */
const DERIVED_DOCS = /^(索引|地图-档案结构（机器生成）)\.md$/

/**
 * 行内出现这些词 → **跳过**：这句话是在"举例 / 记录它没了 / 说当时"，不是在宣告一条现行事实。
 * （与 F2 作废哨兵的 `META_PHRASES` 同一个思路：**谈论它 ≠ 使用它**。）
 *
 * ⚠️ 2026-09-17 真档案试跑后**补过一轮**：第一版漏了两种写法，各造出一条误报 ——
 *   · `已于 09-15 前**删除**，`local-plugins\` 现为**空**` → 补 `已删` / `删除` / `为空`
 *   · `**原** \`E:\Tools\` → 现 \`E:\DeepSeek工具箱\`` → 行首那种"原 <盘符>:\"由下面的正则挡
 *   **宁可漏报，不可误报** —— "消不掉的告警等于没有告警"（档案里的老教训）。
 */
const ANCHOR_META = [
  '举例',
  '示例',
  '例如',
  '比如',
  '已删除',
  '已删',
  '删除记录',
  '已卸',
  '已退役',
  '已停用',
  '曾经',
  '当时',
  '原先',
  '快照',
  '不再',
  '已经没了',
  '找不到原图',
  '为空',
  '改名',
  '改为',
  '旧路径',
  '卸载',
  '清除',
  '移除',
  '删除',
  '已不存在',
]

/** "原 `E:\Tools`" 这种**历史引用**（不是现行事实）——行里出现就跳过。 */
const HISTORICAL_REF = /原\s*.{0,3}[A-Za-z]:\\/

/** 占位符 / 通配 / 省略号 —— 不是真路径。 */
const PLACEHOLDER = /[*?<>]|…|\.\.\.|某目录|某某/

/** 反引号里、形如 `C:\…` 的路径。 */
const CODE_PATH = /`([A-Za-z]:\\[^`]+?)`/g

/**
 * **行指纹**（2026-09-22 加 · **用户设计**）：跳过 markdown 标记与空白后，取第 **1 / 4 / 7** 个可见字符。
 *
 * 用途：引用写成「`` `铁律` 第 29 行〔4行用〕 ``」—— 行号漂了也能按指纹找到；
 * 这一节拿它**对账**：去读目标那一行、重算指纹，**对不上就是行号漂了** —— 把"静默指错"变成"当场出声"。
 * 为什么是 1/4/7 而不是"前三个字"（用户原话）：**改动落在中间也能发现**。
 *
 * 🔴 **判据只在这里一份** —— `lib/tools.js`（`dangan_search` 吐指纹）与 `tools/行号加固.mjs`（补指纹）都从这儿取。
 */
export function lineFingerprint(line) {
  // 🔴 顺序要紧：**先剔 emoji，再剔标点空白，最后才取样**。
  //
  // ① 2026-09-22 深夜（**真事故，会话 3caa6313 因此报废**）：不剔 emoji 就会取到**半个 emoji** ——
  //    `🚨` 在 UTF-16 里是**两个码元**，按码元取样只拿到一半（孤立代理项），
  //    序列化成 `"\ud83d"` → API 判**请求本身不合法（400）**。
  //    致命的是：那条坏消息**一进历史就删不掉**（会话日志是压缩二进制、没有合法写入入口），
  //    **之后每一轮请求都带着它重发** → 会话永久哑掉、只能归档。
  // ② 剔的范围：增补平面（`\u{10000}-\u{10FFFF}`，emoji 绝大多数在这儿）
  //    ＋ 变体选择符（`FE00-FE0F`）＋ ZWJ（`200D`）＋ 键帽（`20E3`）。
  //    剔完剩下的全是**单码元**字符 —— 取样怎么取都切不坏。
  // ③ 底线：**指纹只认文字**。emoji 不参与取样（用户 2026-09-22 定："**你只要让这个指纹不取 emoji**"）。
  // ⚠️ 全角标点也得去掉 —— 2026-09-22 实测：漏了 `（）`，`| **git（档案回滚点）** |` 的指纹成了「g（回」。
  const vis = String(line ?? '')
    .replace(EMOJI_LIKE, '')
    .replace(/[|*`>#\-[\]()~\s:：、，。；！？（）【】「」《》…—]/g, '')
  // ④ 保险（"原本的那个"）：按**码点**取样 ＋ 末尾剃掉任何**孤立**代理项 ——
  //    源行里若本来就脏（别的工具按码元切过、或从别处粘进来的坏字节），也不许从指纹这条路流出去。
  const cps = Array.from(vis)
  return [0, 3, 6]
    .map((i) => cps[i] ?? '')
    .filter(Boolean)
    .join('')
    .replace(LONE_SURROGATE, '')
}

/** emoji / 增补平面字符 —— **不许参与指纹取样**（原因见 `lineFingerprint` 的事故注）。 */
const EMOJI_LIKE = /[\u{10000}-\u{10FFFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu

/**
 * **孤立代理项**（半个 emoji / 半个增补平面字符）—— 进 JSON 就是非法序列（`"\ud83d"`），API 当场 400。
 * ⚠️ 配对的高低位（真 emoji）**不在射程里**，只剃"落单的那一半"。
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * 引用里那些"人话简称" → **文件名**（**不含层、不含子目录** —— 路径由 `findByNameUnique()` 现算）。
 *
 * 🔴 **2026-09-29 改**：原来这里写的是**完整相对路径**（`L3-知识/记录/…`）⇒ 每次搬层 / 分间都要回来改它
 *    （`T714` 那次就是一条条跟的）。改成**只写文件名**之后，**层怎么变都不用动这里**。
 *    ⚠️ 解析走"**唯一命中才认**"那一档：命中 2 个 ⇒ 报"认不出"，**不猜**（`T688` 的教训）。
 */
export const FP_ALIAS = {
  // 🔴 **2026-10-01 修（真 bug）**：下面这几条原来写的是**改名前的旧名字**
  //    （`00-必读-铁律` / `00-总览-我们干过什么` / `01-时间轴-我们做过什么` / `01-事件表-我们做过什么` / `待办-未完成事项`）——
  //    全馆重建把文件改短了（`铁律.md` / `总览.md` / `时间轴.md` / `事件表.md` / `工程-待办.md`），
  //    可这张表**没跟着改** ⇒ `findByNameUnique('00-必读-铁律')` 永远返回 null
  //    ⇒ **引用里写「铁律」「总览」「时间轴」的一律"认不出"**（实测：扫描报告里 14 处"认不出目标"，
  //    其中「铁律」占 2 处、`AGENTS.md` 那类**档案外的**才是不该认的）。
  //    ⚠️ 这正是本文件头部那条"只写文件名、不写路径"的初衷 —— 可惜当时填的是**过期文件名**。
  铁律: '铁律',
  总览: '总览',
  工具速查: '工具速查',
  索引: '索引',
  使用说明: '使用说明',
  '日志系统-使用说明': '使用说明',
  总账: '记错本',
  'AI错误总账': '记错本',
  要修清单: '记错本',
  'AI要修清单': '记错本',
  记错本: '记错本',
  待办: '工程-待办',
  '待办-未完成事项': '工程-待办',
  // 🔴 **2026-10-18 修**：这条原来写的是旧名 `记录-梅莫莉亚-施工手册`（文件早已改名 `指南-梅莫莉亚-施工手册.md`）
  //    ⇒ `findByNameUnique` 永远 null ⇒ 引用里写「施工手册」的一律"认不出"——与上方 2026-10-01 那批**同一个病**。
  施工手册: '指南-梅莫莉亚-施工手册',
  防丢总则: '防丢失总则',
  '防丢失总则': '防丢失总则',
  时间轴: '时间轴',
  事件表: '事件表',
}

/** 把引用里写的目标认成"档案内相对路径"（认不出返回 null ⇒ 如 `AGENTS.md`、别的项目的文件）。 */
export function resolveFpTarget(raw, root = CFG.archiveDir) {
  const s = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!s) return null
  if (FP_ALIAS[s]) {
    const p = findByNameUnique(FP_ALIAS[s]) // 现算路径；命中不唯一 ⇒ null（认不出，不猜）
    return p ? rel(p) : null
  }
  if (/\.(md|txt)$/i.test(s)) {
    const hits = []
    try {
      for (const f of walk(root)) {
        const r = f.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
        if (r.endsWith(s)) hits.push(r)
      }
    } catch {
      /* 读不到就当认不出 */
    }
    if (hits.length === 1) return hits[0]
  }
  return null
}

/** 「`` `文件` 第 N 行〔指纹〕 ``」 */
const FP_RE = /`([^`]+)`\s*第\s*(\d+)\s*行〔([^〕]+)〕/g

/**
 * **行号指纹对账**（2026-09-22 加 · 用户那套指纹的最后一环）：
 * 扫「`` `文件` 第 N 行〔指纹〕 ``」→ 读目标那一行 → 重算指纹 → **对不上就是行号漂了**。
 *
 * ⚠️ 只查**现行层（L1）** —— 与 `scanAnchors` 同一条口径：L3 是记录层，那里面的旧行号属正常。
 * ⚠️ **0 处也出**（证明"扫过了"，不是"没扫"）—— 同 F25 / F27 那条规矩。
 */
export function scanFingerprints(root = CFG.archiveDir) {
  const out = { files: 0, checked: 0, drifted: [], unresolved: [] }
  let docs = []
  try {
    docs = walk(root)
  } catch {
    docs = []
  }
  for (const f of docs) {
    const r = f.slice(root.length).replace(/^[\\/]+/, '')
    if (!ONLY_CURRENT_LAYER.test(r)) continue
    const text = readTextSafe(f)
    if (text.length === 0) continue
    out.files += 1
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      FP_RE.lastIndex = 0
      let m
      while ((m = FP_RE.exec(lines[i])) !== null) {
        const [, what, nStr, want] = m
        out.checked += 1
        const rel2 = resolveFpTarget(what, root)
        if (!rel2) {
          out.unresolved.push({ at: `${r}:${i + 1}`, what })
          continue
        }
        const abs = /[\\/]$/.test(root) ? root + rel2 : `${root}\\${rel2}`
        let target = null
        try {
          target = readTextSafe(abs).split(/\r?\n/)[Number(nStr) - 1] ?? null
        } catch {
          target = null
        }
        if (target === null) {
          out.drifted.push({ at: `${r}:${i + 1}`, what, n: nStr, want, now: '（读不到/行号越界）' })
          continue
        }
        const now = lineFingerprint(target)
        if (now !== want) {
          out.drifted.push({ at: `${r}:${i + 1}`, what, n: nStr, want, now, target: target.trim().slice(0, 50) })
        }
      }
    }
  }
  return out
}

/**
 * 从一段文本里抽"当路径写"的路径（**只认反引号里的**，见文件头第 ③ 版口径）。
 * @param {string} text
 * @returns {string[]}
 */
export function extractPaths(text) {
  const out = []
  const s = String(text ?? '')
  for (const m of s.matchAll(CODE_PATH)) {
    const p = m[1].trim().replace(/\\+$/, '')
    if (p.length < 5) continue
    if (PLACEHOLDER.test(p)) continue
    out.push(p)
  }
  return out
}

/** 盘符根（`C:\`）现在能不能访问 —— 用来区分"路径没了"和"盘根本没插"。 */
export function driveOnline(path) {
  const d = String(path ?? '').slice(0, 2)
  if (!/^[A-Za-z]:$/.test(d)) return false
  try {
    return existsSync(`${d.toUpperCase()}\\`)
  } catch {
    return false
  }
}

/**
 * 探测一批路径，**分成三类**（这三类必须分开，不许混成一个"不存在"）：
 *   · `exists`  在
 *   · `missing` **盘在线、但路径没了** → 这才是"可能是过期事实"
 *   · `offline` **盘不在线** → 照 max-null 那条：**探测不到＝未校验，不判失效**
 *
 * @param {Array<{path: string, file?: string, line?: number}>} items
 * @returns {{exists: number, missing: Array<{path:string,file?:string,line?:number}>, offlineDrives: string[], offlineCount: number}}
 */
export function probePaths(items) {
  let exists = 0
  const missing = []
  const offlineMap = new Map()
  for (const it of items ?? []) {
    const p = it?.path
    if (typeof p !== 'string' || p.length === 0) continue
    if (!driveOnline(p)) {
      const d = p.slice(0, 2).toUpperCase()
      offlineMap.set(d, (offlineMap.get(d) ?? 0) + 1)
      continue
    }
    let ok = false
    try {
      ok = existsSync(p)
    } catch {
      ok = false
    }
    if (ok) exists += 1
    else missing.push({ path: p, file: it.file, line: it.line })
  }
  return {
    exists,
    missing,
    offlineDrives: [...offlineMap.keys()].sort(),
    offlineCount: [...offlineMap.values()].reduce((a, b) => a + b, 0),
  }
}

/**
 * 扫"工具类文档"，抽出路径并探测。
 * @param {string} root 档案根
 * @returns {{files: number, found: number, exists: number, missing: Array<any>, offlineDrives: string[], offlineCount: number}}
 */
export function scanAnchors(root = CFG.archiveDir) {
  const items = []
  let files = 0
  let docs = []
  try {
    docs = walk(root)
  } catch {
    docs = []
  }
  // ⚠️ **相对 root 算路径，不要用全局 `rel()`** —— `rel()` 是以 `CFG.archiveDir` 为基准的，
  //    传进来的 `root` 跟它不一致时（比如测试传样本档案）会算出乱七八糟的字符串，
  //    于是"按层匹配"全部落空、**一条都扫不到**（2026-09-17 改成按层匹配时，被单测当场抓到）。
  const relTo = (p) => (root && p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, '') : rel(p))
  for (const f of docs) {
    const r = relTo(f)
    const base = baseOf(r) // 2026-09-28：改走唯一来源（`lib/common.js`），别再手写 split + pop
    // **只查"现行层"（L1）**：见文件头第 ④ 版口径 —— L3 是记录层，里面的旧路径是正常的。
    if (!ONLY_CURRENT_LAYER.test(r)) continue
    if (SNAPSHOT_HINT.some((h) => base.includes(h))) continue
    // 🔴 2026-10-20：**派生件不查**（理由见 `DERIVED_DOCS` 那段）—— 它们是转抄，不是现行事实。
    if (DERIVED_DOCS.test(base)) continue
    files += 1
    const text = readTextSafe(f)
    if (text.length === 0) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (ANCHOR_META.some((w) => line.includes(w))) continue
      if (HISTORICAL_REF.test(line)) continue
      for (const p of extractPaths(line)) items.push({ path: p, file: r, line: i + 1 })
    }
  }
  // 去重（同一路径出现多次：只报第一处，免得刷屏）
  const seen = new Set()
  const uniq = []
  for (const it of items) {
    if (seen.has(it.path)) continue
    seen.add(it.path)
    uniq.push(it)
  }
  const probed = probePaths(uniq)
  const out = { files, found: uniq.length, ...probed }
  // 🛡 **2026-10-22（机器闭环 · 入选名单）**：把结论写成机读状态。
  //    为什么它进名单：**这是最典型的"不用就看不见"** —— 它一整月可以触发 0 次，
  //    坏了的话，直到某天按旧路径找东西才发现。⚠️ 只转写已算出的 `probed`，不新加扫描。
  try {
    const miss = Array.isArray(out.missing) ? out.missing.length : 0
    writeHealth('F13', miss === 0, `锚点 ${out.found} 条 · 探测不到 ${miss} 条`)
  } catch {
    /* 报不上自己，不影响锚点扫描 */
  }
  return out
}

/** 启动自检：**自报工作量**（查了几份文档、几条路径、跳过几条）。 */
export function reportF13() {
  const r = scanAnchors(CFG.archiveDir)
  const skip =
    r.offlineCount > 0
      ? `；另有 ${r.offlineCount} 条在离线的盘上（${r.offlineDrives.join(' / ')}）→ **跳过，不算错**`
      : ''
  // 🔴 2026-09-22：**0 处也出**（"沉默 ≠ 正常"）—— 行号指纹对账（用户那套指纹的最后一环）。
  const fp = scanFingerprints(CFG.archiveDir)
  const fpLine =
    fp.checked === 0
      ? '· 行号指纹：L1 里还没有带指纹的引用（核了 0 处）'
      : `· 行号指纹：核了 ${fp.checked} 处` +
        (fp.drifted.length > 0
          ? ` —— 🔴 **${fp.drifted.length} 处漂了**（那几行已经不是当初指的内容）：\n` +
            fp.drifted
              .map((d) => `    · ${d.at} → \`${d.what}\` 第 ${d.n} 行：以为「${d.want}」，现在是「${d.now}」`)
              .join('\n')
          : '，**全对得上**') +
        (fp.unresolved.length > 0 ? `（另有 ${fp.unresolved.length} 处目标不在档案里，跳过）` : '')
  return (
    `有效性锚点 F13：查了 L1（现行层）${r.files} 份文档里的 ${r.found} 条路径 —— ` +
    `在 ${r.exists} 条 · **探测不到 ${r.missing.length} 条**${skip}（"探测不到"只报提示：它可能是举例、也可能真过期，机器分不清）\n  ${fpLine}`
  )
}
