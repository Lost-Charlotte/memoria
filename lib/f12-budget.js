// ============================================================
// F12 · 注入预算（2026-09-17 建 · 事件 E63 / 锚点 T200）
// ============================================================
//
// **抄谁**：`dsh-layered-memory/dist/util/recall-budget.js`（85 行、零依赖；见
//   `L3-知识/参考-防压缩失忆与跨会话记忆-插件调研.md` §4.7）。三条做法照搬：
//   ① **按 code point 截断**（不劈开代理对 —— emoji / 生僻字不会被切成半个）；
//   ② **截断处加引流后缀**，明确告诉模型"全文在哪、怎么拿"——**截断是引流，不是损失**；
//   ③ **"被截断"与"本来就没有"语义分开**（照它"超时 ≠ 零命中"那条）。
//
// **为什么需要**：真档案一次注入实测 **18,432 字符**（`memoria.log` 2026-09-16 16:17）。
//   注入越大，上下文越容易被推过压缩阈值 → **压缩越勤 → 越容易失忆**。所以预算是**对症**的，
//   不是"为了优雅"。
//
// **三条设计原则**（写下来，免得以后自己乱改）：
//   1. **默认不砍正常内容**：上限按实测体积留约 1.6 倍余量（30,000）→ 正常使用**永不触发**；
//   2. **不许静默**：每次注入都报"用了多少 / 上限多少"（接 F1 的干活统计）；用量超过
//      `warnRatio`（80%）就在**注入正文里自报一行** —— "接近上限"必须被看见，
//      不能等被砍了才知道（"沉默 ≠ 正常"）；
//   3. **可配置**：上限走 `CFG.budget`（cordis patch 可覆盖），改数字不用碰代码。
//
// ⚠️ **"永不触发的机制"＝死代码**，所以这里的每一条都有断言钉着（`tests/f12-budget.mjs`）：
//   默认档不许动正常内容 · 超限档必须截断且带引流后缀 · 超 80% 必须自报 · 被砍的块必须被报出来。

// 注入正文里的话一律从文案表取（2026-09-19 · 待办"文案外置补全"）。
import { t } from './texts.js'

/**
 * 截断后缀（引流）：告诉模型全文在哪、用什么拿。
 * 📌 **2026-09-19 起从文案表现取**（`assets/texts.json` 的 `f12.truncSuffix`）—— 改那句话不用改代码、不用重启。
 */
export const truncationSuffix = () => t('f12.truncSuffix')

/** ⚠️ **兼容保留**：这是**模块装载那一刻**的值（老引用与测试还在用）。新代码请调 `truncationSuffix()`。 */
export const TRUNCATION_SUFFIX = truncationSuffix()

/** 默认预算。⚠️ 数字来源：`memoria.log` 里的**实测**注入体积。改之前先重新量一遍。 */
export const BUDGET = {
  /** 整份重注入的总上限（实测 18,432 → 留约 1.6 倍余量）。 */
  maxTotalChars: 30000,
  /** 单块上限：档案入口。 */
  maxEntryChars: 8000,
  /** 单块上限：铁律（真档案现在是 11,169 字符，所以这里必须留得比它宽）。 */
  maxTieChars: 20000,
  /** 单块上限：作废清单（整块）。 */
  maxVoidChars: 6000,
  /** 作废清单里**每一条**的上限（一条通常是一行；真档案里的条目远短于此）。 */
  maxVoidItemChars: 200,
  /** 用量到这个比例，就在注入正文里自报一行。 */
  warnRatio: 0.8,
}

/**
 * 按 **code point** 截断（不劈开代理对），带引流后缀。
 *
 * @param {string} line 原文
 * @param {number} maxChars 上限（字符数，不是字节）
 * @returns {string} 未超限时原样返回
 */
export function truncateLine(line, maxChars) {
  const s = String(line ?? '')
  if (!Number.isFinite(maxChars) || maxChars <= 0) return s
  const cps = Array.from(s)
  if (cps.length <= maxChars) return s
  // 上限连后缀都装不下时，干脆不贴后缀（截出比后缀还短的行没有意义）
  const suffix = truncationSuffix()
  if (maxChars <= Array.from(suffix).length) return cps.slice(0, maxChars).join('')
  const keep = maxChars - Array.from(suffix).length
  return `${cps.slice(0, keep).join('').trimEnd()}${suffix}`
}

/**
 * 按预算装配若干"块"。
 *
 * 规则：**逐块先按各自上限截断** → **再按顺序装填总量上限**（装不下的**整块丢弃**，尾部先丢）。
 * ⚠️ 任何"砍掉 / 截断"都必须出现在返回值的 `cut` 里 —— **不许静默**。
 *
 * @param {Array<{label: string, text: string, max?: number, perLine?: number}>} sections
 * @param {typeof BUDGET} budget
 * @returns {{ parts: string[], used: number, limit: number, cut: string[], warn: boolean }}
 */
export function fitSections(sections, budget = BUDGET) {
  const b = { ...BUDGET, ...(budget ?? {}) }
  const parts = []
  const cut = []
  let used = 0

  for (const sec of sections ?? []) {
    let body = String(sec?.text ?? '')
    if (body.length === 0) continue

    // ① 行内上限（作废清单：一行一条，长条目先截）
    const perLine = Number(sec?.perLine)
    if (Number.isFinite(perLine) && perLine > 0) {
      body = body
        .split('\n')
        .map((l) => truncateLine(l, perLine))
        .join('\n')
    }

    // ② 单块上限
    const max = Number(sec?.max)
    if (Number.isFinite(max) && max > 0 && Array.from(body).length > max) {
      body = truncateLine(body, max)
      cut.push(t('f12.cutBlock', { label: sec.label, max }))
    }

    // ③ 总量上限（装不下整块丢弃 —— 按顺序，尾部先丢）
    const sep = parts.length > 0 ? 1 : 0
    if (used + sep + body.length > b.maxTotalChars) {
      cut.push(t('f12.cutDrop', { label: sec.label }))
      continue
    }
    parts.push(body)
    used += sep + body.length
  }

  const warn = b.maxTotalChars > 0 && used >= b.maxTotalChars * b.warnRatio
  return { parts, used, limit: b.maxTotalChars, cut, warn }
}

/** 启动自检：**自报工作量**（这一档的上限是多少、以及"正常不会触发"这句话的依据）。 */
export function reportF12(budget = BUDGET) {
  const b = { ...BUDGET, ...(budget ?? {}) }
  return (
    `注入预算 F12：总量 ${b.maxTotalChars} 字符 · 入口 ${b.maxEntryChars} · 铁律 ${b.maxTieChars} · ` +
    `作废清单 ${b.maxVoidChars}（每行 ${b.maxVoidItemChars}）· 用量到 ${Math.round(b.warnRatio * 100)}% 会在注入正文里自报` +
    `（上限按真档案**实测**注入体积留了约 1.6 倍余量 —— 正常使用不会触发）`
  )
}

// ============================================================
// F12 的第二半：**工具输出**的预算（2026-09-17 加）
// ============================================================
//
// **为什么要**：工具输出以前**没有任何上限** —— 档案一大，`dangan_check` / `dangan_search`
//   一次就能把上下文塞满（尤其体检刚加了"有效性锚点"的提示项之后）。
//
// **数字来源（先量后开）**：真档案上实测 —— `dangan_check` 372 字符 / 7 行 ·
//   `dangan_search mode="recent"`（原 `dangan_recent`）**7,405 字符 / 27 行** · `dangan_search` 约 5,200 / 82 行 ·
//   `dangan_check scope="index" mode="render"`（原 `dangan_index`）5,425 / 68 行 · `dangan_todo(list)` 4,032 / 61 行。
//   → 上限取 **24,000 字符 / 400 行**（约 3 倍余量）：**正常使用不会触发**。
//
// 🔴 **`keep` 是本模块最要紧的一个参数**：
//   · `dangan_search mode="recent"` **必须保尾部** —— 它按时间**正序**取"末尾 20 条"，**"最近"才是有用的**；
//     丢尾部等于把最该看的丢掉（那就比不截还糟）。
//   · 其余出口（search / index / todo / check）按**头部**保留（它们按文件 / 行号排，前面的更相关）。
//
// 两条纪律照 `recall-budget.js`：**不静默**（截断了必须写明"显示 X/Y 行、还有多少、怎么拿到"）；
//   **"没有命中"与"被截断"在文本上必须长得完全不同**（否则会把后者误读成前者）。

/** 工具输出的默认预算（数字来源见上）。 */
export const TOOL_OUTPUT = { maxChars: 24000, maxLines: 400 }

/**
 * 给**工具输出**套预算。
 * @param {string} text 工具原本要吐的全文
 * @param {{label?: string, keep?: 'head'|'tail', maxChars?: number, maxLines?: number}} [opt]
 * @returns {{ text: string, cut: boolean, shownLines: number, totalLines: number }}
 */
export function capToolOutput(text, opt = {}) {
  const maxChars = Number.isFinite(opt.maxChars) && opt.maxChars > 0 ? opt.maxChars : TOOL_OUTPUT.maxChars
  const maxLines = Number.isFinite(opt.maxLines) && opt.maxLines > 0 ? opt.maxLines : TOOL_OUTPUT.maxLines
  const keep = opt.keep === 'tail' ? 'tail' : 'head'
  const label = opt.label ?? '工具输出'
  const s = String(text ?? '')
  const lines = s.split('\n')
  if (lines.length <= maxLines && s.length <= maxChars) {
    return { text: s, cut: false, shownLines: lines.length, totalLines: lines.length }
  }

  let kept = lines
  let omitted = 0
  if (lines.length > maxLines) {
    omitted = lines.length - maxLines
    kept = keep === 'tail' ? lines.slice(-maxLines) : lines.slice(0, maxLines)
  }
  let body = kept.join('\n')
  if (body.length > maxChars) {
    const room = Math.max(0, maxChars - 1)
    body = keep === 'tail' ? `…${body.slice(body.length - room)}` : `${body.slice(0, room)}…`
  }

  const head =
    keep === 'tail'
      ? `【${label} · ⚠️ 只显示了**最后** ${kept.length} 行（全文共 ${lines.length} 行；**前面 ${omitted} 行被省掉了**）】`
      : `【${label} · ⚠️ 只显示了**前** ${kept.length} 行（全文共 ${lines.length} 行；**后面 ${omitted} 行被省掉了**）】`
  const tail = '（被省掉的内容没丢 —— 用更精确的关键词、把 `scope` 收窄，或直接读那个文件；**"被截断"不是"没有命中"**。）'
  return { text: [head, body, tail].join('\n'), cut: true, shownLines: kept.length, totalLines: lines.length }
}
