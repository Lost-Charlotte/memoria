// ============================================================
// f37-timeline · 「时间轴」两个读法（2026-10-15 立 · 用户当天的设想）
// ============================================================
//
// 🔴 为什么有它：L2（时间轴 / 事件表）删掉之后，"按时间排一排、看事情怎么走"没有对象了；
//   但 **L3 正文里散着大量具体时间**（每份记录都照录了"用户 2026-10-14 18:35 说…"）——
//   把它们抽出来、归一化、排序、**以锚取前后 k 条**，就能**临时拼一条短而实用的时间轴**。
//   第二半配套：拿着这个时间去 **L6 / L5 / L8** 找"那一刻的原始件"（`mode="window"`）。
//
// ⚠️ **不骗人的地方**：正文里也有**历史时间**（例："2026-09-14 丢的 8 个文件"）——
//   那不是"这件事发生的时间"，正则照样抽得到 ⇒ **全抽、把那一行原文一起给**，由读的人判。
//
// 📌 口径：时间点**只从正文抽**（不读文件名、不读 mtime —— 那是 `window` 那一半的事）；
//   扫描面与 `searchArchive` 走同一条路（`walk()`：跳过证据 / 临时 / 备份那些目录）。

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { CFG, readTextSafe, scanLayerDirs, walk } from './common.js'

// ------------------------------------------------------------
// 一、认时间
// ------------------------------------------------------------

/** 中文时段词 → 当天的代表时刻（**只用于排序，显示仍是原词**）。 */
const PART_OF_DAY = { 深夜: 23, 凌晨: 1, 早上: 7, 上午: 9, 中午: 12, 下午: 15, 傍晚: 18, 晚上: 20 }

const DATE_RE = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/g
/** `18:35` ＋ 含糊写法 `22:5x`（分钟只写一位 ＋ x）—— 两种都认。 */
const TIME_RE = /(\d{1,2}):(\d{2}|[0-9][xX])/g
const PART_RE = /(深夜|凌晨|早上|上午|中午|下午|傍晚|晚上)/g

/** 分钟归一化：`5x` → 50（排序用）；`35` → 35；非法（>59）→ null。 */
function normMinute(raw) {
  const s = String(raw)
  if (/^[0-9][xX]$/.test(s)) return Number(s[0]) * 10
  const n = Number(s)
  return n >= 0 && n <= 59 ? n : null
}

const pad2 = (n) => String(n).padStart(2, '0')
const clip = (s, n = 140) => {
  const t = String(s ?? '').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** 排序键：`YYYYMMDDHHMM`（**只有日期** ⇒ 时分记 00:00，排当天最前）。 */
export const sortKey = (y, mo, d, h = 0, mi = 0) => y * 1e8 + mo * 1e6 + d * 1e4 + h * 100 + mi

/**
 * 抽一份文本里所有时间点。
 * 规则：**一行一行扫**；行内「日期」与「时刻」按出现顺序配对 —— 时刻**跟它前面最近的那个日期**走；
 *   行内没日期（只有 `22:34` 这种）⇒ **继承上文最近的日期**（`lastDate`）。
 * @returns {Array<{date:string,time:string,shown:string,key:number,line:number,text:string}>}
 */
export function extractTimes(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const out = []
  let lastDate = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const marks = []
    for (const m of line.matchAll(DATE_RE)) {
      const y = +m[1]
      const mo = +m[2]
      const d = +m[3]
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
      marks.push({ at: m.index, kind: 'date', y, mo, d })
    }
    for (const m of line.matchAll(TIME_RE)) {
      const h = +m[1]
      const mi = normMinute(m[2])
      if (mi === null || h > 23) continue
      marks.push({ at: m.index, kind: 'time', h, mi, shown: m[0] })
    }
    for (const m of line.matchAll(PART_RE)) marks.push({ at: m.index, kind: 'time', h: PART_OF_DAY[m[1]], mi: 0, shown: m[1] })
    if (marks.length === 0) continue
    marks.sort((a, b) => a.at - b.at)
    let cur = lastDate
    const seen = new Set()
    for (const mk of marks) {
      if (mk.kind === 'date') {
        cur = `${mk.y}-${pad2(mk.mo)}-${pad2(mk.d)}`
        lastDate = cur
        const k = sortKey(mk.y, mk.mo, mk.d)
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ date: cur, time: '', shown: cur, key: k, line: i + 1, text: clip(line) })
        continue
      }
      if (!cur) continue
      const [y, mo, d] = cur.split('-').map(Number)
      const k = sortKey(y, mo, d, mk.h, mk.mi)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ date: cur, time: `${pad2(mk.h)}:${pad2(mk.mi)}`, shown: `${cur} ${mk.shown}`, key: k, line: i + 1, text: clip(line) })
    }
  }
  return out
}

/**
 * 扫指定几层的正文，收全时间点（**升序**）。
 * @param layers 层前缀（默认只 `L3-知识`；要连 L1 / L4 一起看就给多个）
 */
export function timelineOf(layers = ['L3-知识'], archiveDir = CFG.archiveDir) {
  const pts = []
  let files = 0
  for (const file of walk(archiveDir)) {
    // ⚠️ 这里**不用 `rel()`** —— 它按 `CFG.archiveDir` 切，而本函数允许注入别的根（测试要造样本档案）
    const r = String(file).slice(archiveDir.length + 1)
    if (!/\.(md|txt)$/i.test(r)) continue
    if (!layers.some((L) => r.startsWith(L))) continue
    const text = readTextSafe(file)
    if (text.length === 0) continue
    files += 1
    for (const p of extractTimes(text)) pts.push({ ...p, file: r })
  }
  pts.sort((a, b) => a.key - b.key || a.file.localeCompare(b.file))
  return { points: pts, files }
}

// ------------------------------------------------------------
// 二、以锚取窗口
// ------------------------------------------------------------

/** 锚写成时间就给排序键；给不了（不是时间形状）就返回 null ⇒ 调用方按关键词处理。 */
export function parseAnchorTime(anchor) {
  const s = String(anchor ?? '').trim()
  const m = s.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!m) return null
  const mi = m[5] === undefined ? 0 : Number(m[5])
  if (mi > 59 || Number(m[4] ?? 0) > 23) return null
  return sortKey(+m[1], +m[2], +m[3], m[4] === undefined ? 0 : +m[4], mi)
}

/**
 * **以锚取窗口**：锚可以是时间（`2026-10-14 22:30`）或关键词（`三头六臂`）。
 * 时间锚 ⇒ 取第一个 ≥ 它的点；关键词锚 ⇒ **文件名命中优先于正文命中** —— 文件名带它的才是
 *   "这件事的正主"，正文里只是"提到过它"（实测：「三头六臂」正文命中 70 处，以最早命中为锚
 *   会把窗口带到 10-13 去，而那几天是别的事）。
 * 默认**只取"有时刻"的点**（`opts.withTime=false` 才带上"只有日期"那些）—— 否则日期档淹没时间轴。
 * 锚查不到 ⇒ `missing:true` ＋ 退回**最近**几条（不空手、不假装）。
 */
export function sliceAround(points, anchor, k = 8, opts = {}) {
  const a = String(anchor ?? '').trim()
  if (a.length === 0) throw new Error('锚不能是空的：给一个时间（`2026-10-14 22:30`）或一个关键词')
  const kk = Number.isInteger(k) && k > 0 ? Math.min(k, 200) : 8
  const wantTime = opts.withTime !== false
  let pool = wantTime ? points.filter((p) => p.time) : points
  let pooled = wantTime && pool.length > 0
  if (pool.length === 0) {
    pool = points
    pooled = false
  }
  if (pool.length === 0) return { mode: 'time', anchor: a, hits: [], center: -1, points: [], total: 0, missing: true, hint: '档案里一个时间点都没有' }
  const t = parseAnchorTime(a)
  const hits = []
  let center = -1
  let mode = 'time'
  if (t !== null) {
    center = pool.findIndex((p) => p.key >= t)
    if (center < 0) center = pool.length - 1
  } else {
    mode = 'keyword'
    const fileHits = []
    const textHits = []
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i]
      if (p.file.includes(a)) fileHits.push(i)
      else if (p.text.includes(a)) textHits.push(i)
    }
    hits.push(...fileHits, ...textHits)
    hits.sort((x, y) => x - y)
    if (hits.length === 0) {
      const tail = pool.slice(Math.max(0, pool.length - (kk * 2 + 1)))
      return { mode, anchor: a, hits, center: -1, points: tail, total: pool.length, missing: true, hint: '最近这几条', pooled }
    }
    center = (fileHits.length > 0 ? fileHits : textHits)[0]
  }
  const lo = Math.max(0, center - kk)
  const hi = Math.min(pool.length - 1, center + kk)
  return { mode, anchor: a, hits, center, lo, hi, points: pool.slice(lo, hi + 1), total: pool.length, missing: false, pooled }
}

/** 把窗口渲染成给人看的一小段（一行一条：时间 ｜ 文件 ｜ 那一行原文）。 */
export function formatTimeline(r) {
  if (r.points.length === 0) return `【时间轴】锚「${r.anchor}」—— 档案里**一个时间点都没有**（共 ${r.total} 条）`
  const head = r.missing
    ? `【时间轴】锚「${r.anchor}」**没找到** —— 下面是${r.hint ?? '最近'} ${r.points.length} 条（全档共 ${r.total} 个时间点）`
    : `【时间轴】锚「${r.anchor}」（${r.mode === 'keyword' ? `关键词 · 命中 ${r.hits.length} 处` : '时间'}）—— 窗口 ${r.points[0].shown} ~ ${r.points[r.points.length - 1].shown}（全档共 ${r.total} 个时间点）`
  const rows = r.points.map((p, i) => {
    const idx = (r.lo ?? 0) + i
    const isAnchor = !r.missing && idx === r.center
    const mark = isAnchor ? '▲' : r.hits.includes(idx) ? '◀' : '·'
    return `${mark} ${p.shown}  ${String(p.file).replace(/^L3-知识\\/, '')}:${p.line}  | ${clip(p.text, 90)}`
  })
  return `${head}\n${rows.join('\n')}`
}

// ------------------------------------------------------------
// 三、跨层时间窗（`mode="window"`）—— 拿时间去 L6 / L5 / L8 找"那一刻的原始件"
// ------------------------------------------------------------

/** 快照目录名里的秒级时间：`20261015-231040-874-…`（住在 `L6-工具临时\<家族>\` 下）。 */
const SNAP_DIR_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/

const safeDirs = (p) => {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

/** 递归收**所有**文件（不只是 md/txt —— L5 里有 .ps1/.csv/.json）。⚠️ 不按语义跳目录：调用方点名的层就该全进。 */
function walkAllFiles(dir, out = []) {
  let ents = []
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkAllFiles(p, out)
    else out.push(p)
  }
  return out
}

/** 数一份目录下有多少文件 / 共多少字节（只 stat，不读正文）。 */
function dirSize(dir) {
  let files = 0
  let bytes = 0
  for (const f of walkAllFiles(dir)) {
    files += 1
    try {
      bytes += statSync(f).size
    } catch {
      /* 读不到就算了 */
    }
  }
  return { files, bytes }
}

/**
 * **给一个时间窗，找出那一刻的原始件。** 两条路：
 *   ① **目录名里带秒级时间**的（`L6-工具临时\改档快照\yyyymmdd-hhmmss-…`）—— 最精确，只 `readdir` 两层；
 *   ② **文件 mtime** 落在窗里的（`L5-证据` / `L8-施工归档`）—— 那两层没有时间目录名，只能看 mtime。
 * `scopes` 收**层号前缀**（`L6` / `L5` / `L8`），层目录全名由 `scanLayerDirs` 现算（口径唯一来源）。
 * @returns {Array<{at:string,key:number,rel:string,kind:string,files:number,bytes:number}>} 升序
 */
export function windowOf(from, to, scopes = ['L6', 'L5', 'L8'], archiveDir = CFG.archiveDir) {
  const lo = parseAnchorTime(from)
  const hi = parseAnchorTime(to)
  if (lo === null || hi === null) throw new Error('`from` / `to` 都要写成时间（例 `2026-10-14 22:30` 或 `2026-10-14`）')
  const all = scanLayerDirs(archiveDir, { skipEvidence: false })
  const layers = scopes.flatMap((s) => all.filter((n) => n.startsWith(s)))
  const out = []
  for (const layer of layers) {
    const base = join(archiveDir, layer)
    // ① 目录名带时间的（只有"临时"那一族这么存；其余层家族深一层也不认）
    for (const fam of safeDirs(base)) {
      for (const name of safeDirs(join(base, fam))) {
        const m = name.match(SNAP_DIR_RE)
        if (!m) continue
        const key = sortKey(+m[1], +m[2], +m[3], +m[4], +m[5])
        if (key < lo || key > hi) continue
        const { files, bytes } = dirSize(join(base, fam, name))
        out.push({ at: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`, key, rel: `${layer}\\${fam}\\${name}`, kind: '目录名', files, bytes })
      }
    }
    // ② 按 mtime 的（L5 / L8；L6 里那些散件也顺带收）
    for (const f of walkAllFiles(base)) {
      let st
      try {
        st = statSync(f)
      } catch {
        continue
      }
      const d = st.mtime
      const key = sortKey(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes())
      if (key < lo || key > hi) continue
      // 已经在 ① 里收过的快照目录内容不重复收（按路径前缀去重）
      const rel = `${layer}\\${String(f).slice(base.length + 1)}`
      if (out.some((x) => rel.startsWith(`${x.rel}\\`))) continue
      out.push({
        at: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
        key,
        rel,
        kind: 'mtime',
        files: 1,
        bytes: st.size,
      })
    }
  }
  out.sort((a, b) => a.key - b.key || a.rel.localeCompare(b.rel))
  return out
}

/** 把时间窗结果渲染成清单（一行一件：秒级时间 ｜ 档案内路径 ｜ 大小）。 */
export function formatWindow(from, to, rows) {
  if (rows.length === 0) return `【时间窗】${from} ~ ${to} —— 那一刻**一件原始件都没有**（窗户里是空的）`
  const head = `【时间窗】${from} ~ ${to} —— 命中 **${rows.length}** 项`
  const lines = rows.map((x) => {
    const kb = x.bytes >= 1048576 ? `${(x.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(x.bytes / 1024))} KB`
    return `· ${x.at}  ${x.rel}  （${x.kind} · ${x.files} 文件 / ${kb}）`
  })
  return `${head}\n${lines.join('\n')}`
}
