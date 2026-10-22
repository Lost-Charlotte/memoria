// ============================================================
// F2 · 作废哨兵
// ============================================================
//
// 扫档案里「已作废／已撤销」的条款，生成"别按这些办事"清单（供给 F1 的压缩后重注入）。

import { CFG, capTick, log, readTextSafe, rel, walk, writeHealth } from './common.js'

/** 失效口径的措辞。档案里存量数十处，形态不一（见 2026-09-16 全档 grep）。 */
const VOID_MARKERS = [
  '已作废',
  '已撤销',
  '已废弃',
  '已推翻',
  '已被替代',
  '不再适用',
  '此条已过期',
  '已失效',
]

/** 元描述：讲「如何处理作废」的行，不是作废口径本身。 */
const META_PHRASES = [
  '作废标记',
  '标注为作废',
  '标为作废',
  '已改写成',
  '作废哨兵', // 描述本插件 F2 功能时会写到
  'archived', // 讨论它的作废状态（对比文档）
  '状态新增', // "L2 状态新增 🗑 已作废" ＝ 在讲这个标记
  '逐条核查', // "逐条核查有没有已作废" ＝ 在讲怎么查它
  '作废状态', // 讨论标记本身
  '这个状态本身',
  '已作废／已撤销', // 列举"术语本身"，不是在标记某条已废
]

/**
 * 按语义跳过的**文件**：档案"系统自身的说明书"与读我 ——
 * 它们提到"作废"是在讲**这个机制**（状态枚举、定义、核查步骤），不是在标记某条已废。
 * 2026-09-16 实测：F1 的「不要按它们办事」清单里混进了 4 条这类误报。
 */
const SKIP_FILE_HINTS = ['使用说明', '说明-读我']

/**
 * 行内「被引号／反引号裹着的作废词」＝在**谈论**这个词，不是在用它。
 * ⚠️ 必须紧贴：只允许中间隔空格和 🗑。宽松到"引号后 3 个字符内"会把
 * `"用完要删"**已作废**`（真例）误滤掉 —— 2026-09-16 实测踩到过。
 */
const QUOTED_VOID = /["'`“”‘’]\s*(?:🗑\s*)?(?:已作废|已撤销|已废弃|已推翻|已失效)/

/** 扫档案，抽出所有带失效措辞的行。 */
export function scanVoided(root) {
  const hits = []
  for (const file of walk(root)) {
    const r = rel(file)
    // 「索引」是目录：它引用别的文件时会连带带出"已作废"字样，不是口径本身
    if (r.includes('索引')) continue
    // 系统自身的说明书 / 读我：提到"作废"是在讲机制，不是口径本身（2026-09-16 误报 4 条）
    if (SKIP_FILE_HINTS.some((h) => r.includes(h))) continue
    const text = readTextSafe(file)
    if (text.length === 0) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      if (raw === undefined || raw.length === 0) continue
      if (!VOID_MARKERS.some((m) => raw.includes(m))) continue
      if (META_PHRASES.some((p) => raw.includes(p))) continue
      if (QUOTED_VOID.test(raw)) continue
      const t = raw.trim().replace(/^[-*>\s]+/, '')
      if (t.length === 0) continue
      hits.push({ file: r, line: i + 1, text: t.length > 200 ? `${t.slice(0, 200)}…` : t })
    }
  }
  return hits
}

/** 扫描缓存：60 秒内复用，避免每轮都读盘。 */
let voidCache = { stamp: 0, hits: [] }

export function voidedList(force = false) {
  try {
    if (!force && Date.now() - voidCache.stamp < 60_000) return voidCache.hits
    const hits = scanVoided(CFG.archiveDir)
    voidCache = { stamp: Date.now(), hits }
    capTick('F2', `${hits.length} 条作废口径`) // 干活计数：**真扫了盘才算**（缓存命中不算）
    return hits
  } catch (e) {
    log(`F2 扫描失败: ${e}`)
    return voidCache.hits
  }
}

/**
 * 启动自检：**自报工作量**（"读到几条 / 几份文档"）。
 * 为什么必须报：它原来只在出事时才出声，于是"没出声"分不清是"没问题"还是"它瞎了"。
 * 2026-09-17 从 `index.js` 挪进本模块 —— 每个能力自己报自己的，装配表只管"装谁"。
 */
export function reportF2() {
  const hits = voidedList(true)
  // 🛡 **2026-10-22（机器闭环 · 入选名单）**：把结论写成机读状态。
  //    🔴 **`ok` 恒为 `true`，这是刻意的**：扫出多少条"作废口径"是**信息**，不是病（通常一百来条）。
  //    它真正的病是"**扫不出来**"（静默失效），而那**在这里判不出来** —— 0 条也可能真的没有。
  //    ⇒ 这儿只把"我扫到了多少条"记下来，**条数突变**由人察觉（190 条变 0 条，一眼就不对）。
  //    别让后人看到 "ok:true 但 190 条" 就以为该报错。
  try {
    writeHealth('F2', true, `作废口径 ${hits.length} 条`)
  } catch {
    /* 报不上自己，不影响扫描 */
  }
  const byFile = new Map()
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
  log(`作废哨兵：${hits.length} 条 / ${byFile.size} 份文档（逐文件明细见 memoria.log）`)
  for (const [fn, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    log(`    · ${fn} → ${n} 条`, { silent: true })
  }
}
