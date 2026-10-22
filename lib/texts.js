// ============================================================
// 文案表 —— 梅莫莉亚说的话，从代码里搬出来（2026-09-18 建）
// ============================================================
//
// 用户 2026-09-18 要的："**把插件里散落的中文提示收进一个数据文件**"。
// 为什么值得做：原先每句给她/给我看的话都**硬写在 27 个模块里** —— 改一句话就得改代码、
// 跑测试、重启控制台。搬进数据文件以后：
//
//   🔴 **改文案不用改代码、也不用重启** —— 本模块**每次读盘**（带 mtime 缓存），
//      你编辑 `assets/texts.json`、存盘，**下一条注入/下一次工具调用就是新的**。
//
// 规矩：
//   · **只有"面向人的文本"进表**：注入文本 / 面板文案 / 工具描述 / 报告文本 / 错误提示；
//   · **代码注释不进表** —— 注释是写给改代码的人看的，跟着代码走更清楚；
//   · 取值一律走 `t('键')`；**缺键就出声**（返回 `⟪缺文案:键⟫`，不静默 —— "沉默 ≠ 正常"）；
//   · 占位符写 `{名字}`，调用处给同名的值。
//
// ⚠️ **键名约定**：`<模块>.<用途>.<次序>`，例如 `f26.todo.open`。
//    模块名用文件名前缀（`f26` / `f1` / `panel` / `tool`），**别用中文键**（省得编码再出岔子）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(HERE, '..', 'assets', 'texts.json')

/** statSync 的节流：同一条注入里 `t()` 会被调几十次，不必每次都敲盘。 */
const STAT_THROTTLE_MS = 1000

let cache = { mtime: 0, at: 0, data: {}, error: '' }

/** 读盘（mtime 变了才真读）。读不到 → 返回空表 ＋ 记下原因（`t()` 会出声）。 */
function load() {
  const now = Date.now()
  if (now - cache.at < STAT_THROTTLE_MS) return cache
  try {
    const st = fs.statSync(FILE)
    if (st.mtimeMs !== cache.mtime) {
      const raw = fs.readFileSync(FILE, 'utf8')
      const data = JSON.parse(raw)
      cache = { mtime: st.mtimeMs, at: now, data, error: '' }
    } else {
      cache = { ...cache, at: now }
    }
  } catch (e) {
    cache = { mtime: 0, at: now, data: {}, error: e && e.message ? e.message : String(e) }
  }
  return cache
}

/**
 * 取一条文案。
 * @param {string} key 键名（如 `f26.todo.open`）
 * @param {object} [vars] 占位符的值（`{n}` → `vars.n`）
 * @returns {string} 缺键 / 文件读不到时返回**看得见的**占位串，而不是空字符串
 */
export function t(key, vars) {
  const c = load()
  const s = c.data[key]
  if (typeof s !== 'string') {
    return c.error ? `⟪文案表读不到：${c.error}（缺 ${key}）⟫` : `⟪缺文案:${key}⟫`
  }
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m0, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m0))
}
