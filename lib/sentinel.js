// ============================================================
// 哨兵公共层（sentinel）—— 2026-09-18 建
// ============================================================
//
// 起因（用户 2026-09-18 原话）："**现在我们梅莫莉亚的各种自动化越来越多……我觉得需要讲这些东西
//   也规整起来。不要散乱一团。**"
//
// 当时已经有 **8 个哨兵**（F2 作废 · F5 等级 · F12 预算 · F13 锚点 · F14 凭据 · F18 事件收尾 ·
//   F19 L9 · F22/F23 留底 · F24 总览 · F25 口径 · F26 留意栏），而其中
//   **F25（口径巡检）与 F27（引用对账）的骨架几乎逐段重复**：
//   都是"**扫现行层 → 逐行判 → 分"错 / 提示" → 人工豁免 → 统一报告 → 自报工作量**"。
//
// 所以抽这一层：**哨兵只写"判据"，扫描 / 豁免 / 分类计数 / 自报全共用**。
//   一个哨兵 ＝ `{ id, mark, targets(), judge(line, ctx) }` —— 加第九个哨兵**只写判据**。
//
// ⚠️ **不做过度抽象**：**报告文案**仍归各哨兵自己（F25 讲"旧说法"、F27 讲"引用"，硬套一个模板
//    只会让两边都难懂）。这里只抽**机械部分**（读文件、逐行、豁免、计数）。
// ⚠️ **豁免不许变成静默**（这套系统一贯的规矩）：命中豁免标记的行**不报**，但**照报数量**。

import { readFileSync } from 'node:fs'

/**
 * 豁免标记的正则。**标记打在那一行里**（不按行号 —— 行号会随重排漂，这份档案几天里重排过好几回）。
 * 用法：确认某条命中是"在谈论它 / 已核过"，就在那一行加 `<!-- F27-已确认 2026-09-18 -->`。
 */
export function ackRe(mark) {
  return new RegExp(`<!--\\s*${mark}[^>]*-->`)
}

/**
 * 跑一个哨兵（**所有哨兵共用这一段**）。
 *
 * @param {object} spec
 * @param {string} spec.id        代号（如 `F27`）—— 只用于自报工作量
 * @param {string} spec.mark      豁免标记名（如 `F27-已确认`）
 * @param {() => {list: Array<{label:string,file:string}>, missing: string[]}} spec.targets 扫哪些地方
 * @param {(line:string, ctx:{label:string,file:string,line:number}) => Array<object>|null} spec.judge
 *        **判据**：返回"这一行有哪些问题"（`null` / 空数组 ＝ 这行干净）；每条**至少**要 `{ level, why }`。
 *        ⚠️ 判据自己抛错**不会毁掉整场扫描** —— 会被记成一条"提示"（"判据自己出错了"）。
 * @returns {{hits:Array, bad:number, tips:number, acks:Array, scanned:number, missing:string[]}}
 */
export function runSentinel({ mark, targets, judge }) {
  const { list, missing } = targets()
  const ACK = ackRe(mark)
  const hits = []
  const acks = []
  let scanned = 0
  for (const t of list) {
    let text = ''
    try {
      text = readFileSync(t.file, 'utf8')
    } catch {
      continue
    }
    if (text.length === 0) continue
    scanned += 1
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? ''
      if (raw.length === 0) continue
      let found = null
      try {
        found = judge(raw, { label: t.label, file: t.file, line: i + 1 })
      } catch (e) {
        found = [{ level: '提示', why: `**判据自己出错了**（${e && e.message ? e.message : e}）—— 这一行的检查没做成` }]
      }
      if (!found || found.length === 0) continue
      for (const f of found) {
        const item = { label: t.label, file: t.file, line: i + 1, ...f }
        if (ACK.test(raw)) acks.push({ ...item, mark: (raw.match(ACK) ?? [''])[0] })
        else hits.push({ ...item, level: f.level ?? '提示' })
      }
    }
  }
  const bad = hits.filter((h) => h.level === '错').length
  return { hits, bad, tips: hits.length - bad, acks, scanned, missing }
}
