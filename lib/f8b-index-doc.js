// ============================================================
// F8b · 《索引》这一份文档的**生成与对账**（与「事件表顶部目录」F8 并列）
// ============================================================
//
// 它是什么：把 `L1-必读\索引.md` 的**渲染**从 `tools/档案索引.mjs` 里搬进 lib —— 这样
//   **落盘的脚本**与**织布机的纹样**调的是同一份生成逻辑（"谁生成的"永远只有一处）。
// 🔴 2026-10-10 建（织布机收口 · 阶段②）：原逻辑整段住在 `tools/档案索引.mjs` 里，
//   织布机要织它就得再写一份（那是"第二条路"）—— 所以先抽到这里。
//
// ⚠️ 本模块**只算不写**：返回文本与差异，落盘由调用方走那扇唯一的门。

import fs from 'node:fs'
import path from 'node:path'
import { IDX_SKIP, baseOf, NEED_INTRO, cell, INDEX_REGEN_HINT, INDEX_HEAD_LINE } from './idx-scope.js'

/** 逐文件登记的层 —— 与体检"索引漏登记"的口径完全一致。 */
export const LAYERS = [
  ['L1-必读', '每次接手**先读**的判据 —— 不读它就可能办错事'],
  ['L2-用户', '**我记着你**：用户的画像 ＋ 你我的事（**按方面平铺 · 用哪方面读哪一份**）'],
  ['L3-知识', '**已经知道的事**：事故 / 记录 / 参考 / 指南 / 清单 / 经验 / 总账'],
]

export const OUT_REL = path.join('L1-必读', '索引.md')

const SKIP = IDX_SKIP

// 🔴 2026-10-11 收拢：`NEED_INTRO` 与 `cell` 原来在本文件与 `tools/档案索引.mjs` **各有一份逐字相同**的实现
//    ⇒ 已收进 `lib/idx-scope.js`（唯一来源，上面 import 进来）。这里**转发**它，
//    保住别处 `import { NEED_INTRO } from './f8b-index-doc.js'` 的老写法。
export { NEED_INTRO, cell }

function grabLine(text, emoji) {
  const re = new RegExp(`^>\\s*${emoji}\\s*\\*\\*[^*]+\\*\\*\\s*[：:]\\s*(.+)$`, 'm')
  const m = text.match(re)
  return m ? m[1].trim() : ''
}

function introOf(abs) {
  let text = ''
  try { text = fs.readFileSync(abs, 'utf8') } catch { return { what: '', when: '', who: '' } }
  const head = text.split(/\r?\n/).slice(0, 40).join('\n')
  return { what: grabLine(head, '🏷'), when: grabLine(head, '🕐'), who: grabLine(head, '✍️') }
}

function firstLineOf(abs) {
  const lines = []
  try {
    for (const raw of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      if (/^\s*(#!|param\s*\(|using\s|\[CmdletBinding|import\s|const\s|let\s|var\s|require\s*\()/.test(raw)) continue
      if (/^\s*\|/.test(raw)) continue
      const s = raw.replace(/^[#>\s]+/, '').replace(/\*\*/g, '').trim()
      if (s) lines.push(s)
    }
  } catch { /* 读不到就算了 */ }
  const head = lines.slice(0, 15)
  const about = lines.find((s) => /^(?:\/\/|rem\s+|#)?\s*about\s*[:：]/i.test(s))
  const pick = about
    ? about.replace(/^(?:\/\/|rem\s+|#)?\s*about\s*[:：]\s*/i, '')
    : head.find((s) => /[\u4e00-\u9fff]/.test(s)) || head[0] || ''
  return pick.length > 60 ? `${pick.slice(0, 60)}…` : pick
}

function collectFiles(dir, rel = '') {
  const out = []
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (/快照/.test(e.name)) continue
      out.push(...collectFiles(path.join(dir, e.name), rel ? `${rel}\\${e.name}` : e.name))
      continue
    }
    if (!e.isFile()) continue
    if (!/\.(md|txt|ps1|mjs|cmd)$/i.test(e.name)) continue
    if (SKIP.test(e.name)) continue
    out.push(rel ? `${rel}\\${e.name}` : e.name)
  }
  return out
}

/** 渲染整份《索引》：表按层分节；**只写文件名、不写路径**。 */
export function renderIndexDoc(root) {
  const rows = [], missing = [], exempt = []
  // 🔴 2026-10-14：每层的「文件 → 排序用时间」（只 L3 会填）—— 它同时要**输出到表里**：
  //    销账判据（A 方案）读的就是「索引里 L3 那一节第一条的时间」。
  const layerTime = new Map()
  for (const [layer, note] of LAYERS) {
    const dir = path.join(root, layer)
    if (!fs.existsSync(dir)) continue
    let files = collectFiles(dir)
    if (layer.startsWith('L3')) {
      // 🔴 2026-10-14 加：**L3 层按时间排（新的在前）** —— 与 `tools/档案索引.mjs` **同一口径**
      //    （《施工手册》§二：改"被别处读的格式/顺序"时，两边必须一起改）。
      //    时间优先读文件里的时间标记（`> 🕐 YYYY-MM-DD HH:MM`，将来到落档口自动写）；
      //    没有就退回文件创建时刻（birthtime）。⚠️ 本模块「只算不写、不打印」⇒ 自报由调用方负责。
      const tkey = (f) => {
        const abs = path.join(dir, f)
        // ① 文件里的时间标记（最准 —— 将来到落档口自动写）
        try {
          const head = fs.readFileSync(abs, 'utf8').slice(0, 800)
          const m = head.match(/^>\s*🕐\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/m)
          if (m) {
            const t = Date.parse(`${m[1]}T${m[2] ?? '00:00'}:00+08:00`) || 0
            if (t) return t
          }
        } catch {}
        // ② 文件名里的日期 —— 🔴 老文件的 birthtime **不可靠**（9 月那批创建时刻全是搬运那天）⇒ 这一档比它准。
        const fd = f.match(/(20\d{2})-(\d{2})-(\d{2})/)
        if (fd) {
          const t = Date.parse(`${fd[1]}-${fd[2]}-${fd[3]}T00:00:00+08:00`) || 0
          if (t) return t
        }
        // ③ 文件创建时刻（**只能兜底**）
        try { return fs.statSync(abs).birthtimeMs || 0 } catch {}
        return 0
      }
      const keyed = files.map((f) => ({ f, t: tkey(f) }))
      keyed.sort((a, b) => b.t - a.t)
      for (const x of keyed) layerTime.set(x.f, x.t)
      files = keyed.map((x) => x.f)
    } else {
      files.sort((a, b) => a.localeCompare(b, 'zh'))
    }
    for (const name of files) {
      const abs = path.join(dir, name)
      const base = baseOf(name)
      const g = introOf(abs)
      if (NEED_INTRO(layer, base)) {
        const lack = []
        if (!g.what) lack.push('🏷 是什么')
        if (!g.when) lack.push('🕐 什么时候用')
        if (lack.length > 0) missing.push({ layer, file: name, why: `缺 ${lack.join(' / ')}` })
      } else if (!g.what) exempt.push({ layer, file: name })
      rows.push({ layer, note, name: base, what: g.what || firstLineOf(abs) || '（无自述）', when: g.when || note, t: layerTime.get(name) ?? 0 })
    }
  }

  const out = []
  out.push('# 索引（哪个文件讲什么、什么时候该读）')
  out.push('')
  out.push(INDEX_HEAD_LINE)
  out.push('> 🔴 **不要手写它**：手写必漂（实测它漏登记过 5 行、34 处状态过期）。要改一句话 → 改**那份文件的开头**。')
  out.push('> 📍 本表**只写文件名、不写路径** —— 路径去 `地图-档案结构（机器生成）.md` 现查（文件搬家不会让本表失效）。')
  out.push(INDEX_REGEN_HINT)
  out.push('')
  let last = ''
  const baseCount = new Map()
  for (const r of rows) baseCount.set(r.name, (baseCount.get(r.name) ?? 0) + 1)
  for (const r of rows) {
    const isL3 = r.layer.startsWith('L3')
    if (r.layer !== last) {
      last = r.layer
      out.push('')
      out.push(`## ${r.layer}`)
      out.push('')
      out.push(`> ${r.note}`)
      out.push('')
      if (isL3) {
        // 🔴 2026-10-14：**L3 节多一列「时间」** —— 它就是排序依据（时间标记 → 文件名日期 → 创建时刻）现算出来的。
        //    为什么加：销账判据（A 方案 · 用户 2026-10-14 选）读的是「**索引里 L3 那一节第一条的时间**」。
        out.push('> ⏱ **时间列口径**：优先取该文件里的 `> 🕐` 时间标记；没有就用**文件名里的日期**；再没有才用**文件创建时刻**（⚠️ 老文件那个值可能只是"搬运那天"）。')
        out.push('')
        out.push('| 时间 | 文件 | 一句话：它是做什么的 |')
        out.push('|---|---|---|')
      } else {
        out.push('| 文件 | 一句话：它是做什么的 |')
        out.push('|---|---|')
      }
    }
    const key = (baseCount.get(r.name) ?? 0) > 1 ? `${r.layer}\\${r.name}` : r.name
    if (isL3) {
      const z = (n) => String(n).padStart(2, '0')
      const d = r.t ? new Date(r.t) : null
      const stamp = d && !Number.isNaN(d.getTime())
        ? `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`
        : '—'
      out.push(`| ${stamp} | \`${cell(key)}\` | ${cell(r.what)} |`)
    } else {
      out.push(`| \`${cell(key)}\` | ${cell(r.what)} |`)
    }
  }
  out.push('')
  return { text: out.join('\n'), rows, missing, exempt }
}

/** 与现文件比对（发现"漏登记 / 过期"用）。 */
export function diffIndexDoc(root) {
  const { text, rows, missing, exempt } = renderIndexDoc(root)
  const target = path.join(root, OUT_REL)
  const now = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  return { next: text, now, same: now.trim() === text.trim(), rows, missing, exempt, target }
}
