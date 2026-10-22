// ============================================================
// F18 · 待办"过了几遍"计数 —— 2026-09-17 建 · 2026-10-15 只剩这一半
// ============================================================
//
// 🔴 **2026-10-15：原来的另一半（事件收尾哨兵 ＋ 闸门 G3 的判据）已整块退役删除** ——
//    它读的是「事件表」与「时间轴」，而这两份随 L2 一起从档案里删了 ⇒ 那一半**恒空、永不触发**
//    （与已删的旧 G3 / G1 同一条理由："看着在跑、其实已死"）。用户当天拍板「没用就删了」。
//    随之退役的还有：`lib/blockers.js`（整份 · 前置检测）· `dangan_log` 的 `keepOpen` / `blockedBy` 两个参数 ·
//    状态面板 / 留意栏 / 面板卡里那三处显示。
//
// 留下的这一半做什么（用户当天原话）：
//   "**某个待办被你连续标记多少次未完成，你需要提醒我一下**？"
//   ⇒ 每次真给我看清单（`dangan_todo list`）时，给当时还开着的条目**记一遍**
//     （同一天只记一次，免得一个会话里刷成几十遍）；**过了 5 遍仍未动** → 点名，我就主动去问用户。
//
// ⚠️ 纪律没变：**只读档案、只写 `~/.dsh`**（插件对档案仍然只读）。

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { HOME_DIR, log, nowStamp, readTextSafe } from './common.js'

export const CLOSING_STATE = join(HOME_DIR, 'memoria-closing.json')
export const CLOSING_LOG = join(HOME_DIR, 'memoria-closing.log')

/** 同一条待办"过了几遍仍开着"到这个数 → 点名（用户定的 5 遍）。 */
export const TODO_PASS_ALERT = 5

/** 今天（北京时间）的 `YYYY-MM-DD`。 */
export function today() {
  return nowStamp().ymd
}

// ---------------- 本地状态（只写 ~/.dsh） ----------------

export function loadClosing() {
  try {
    const s = JSON.parse(readTextSafe(CLOSING_STATE))
    return s && typeof s === 'object' ? { events: {}, todos: {}, ...s } : { events: {}, todos: {} }
  } catch {
    return { events: {}, todos: {} }
  }
}

export function saveClosing(s) {
  try {
    writeFileSync(CLOSING_STATE, JSON.stringify(s, null, 2))
  } catch {
    /* 存不下就算了：计数退化成"每次都当第一遍" */
  }
}

// ---------------- 待办侧：过了几遍 ----------------

/** 待办条目的稳定键（去掉加粗、压掉空白、截断）—— 计数与点名都用它，**两处必须同一个函数**。 */
export const todoPassKey = (text) => String(text ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * 给"这次真给我看的"那批还开着的待办各记一遍（**同一天只记一次**）。
 * @returns {Map<string, number>} 事项 → 累计过了几遍
 */
export function countTodoPasses(items) {
  const s = loadClosing()
  const t0 = today()
  for (const it of items ?? []) {
    const k = todoPassKey(it.item)
    if (!k) continue
    const rec = s.todos[k] ?? { passes: 0, lastAt: '' }
    if (rec.lastAt !== t0) {
      rec.passes += 1
      rec.lastAt = t0
    }
    s.todos[k] = rec
  }
  saveClosing(s)
  const out = new Map()
  for (const [k, v] of Object.entries(s.todos)) out.set(k, v.passes)
  return out
}

/**
 * 过了 `TODO_PASS_ALERT` 遍仍未动的（点名用；顺序＝过得最多在前）。
 *
 * @param {number} [threshold]
 * @param {Iterable<string>|null} [liveKeys] **当前待办表里还开着的键**（用 `todoPassKey` 算出来的）。
 *   传了它 → 只报「**表里还在**」的那些；不传 → 照旧只读账本（兼容老调用）。
 *
 * 🔴 为什么要有第二个参数（2026-09-25 · 用户实测出来的）：
 *   账本**只进不出** —— 把一条待办从表里销掉之后，账本上那行还留着，
 *   于是留意栏**每轮还在念**"这条念过 8 遍了"，而表里早就没有它了
 *   （实测：「第 N 行」与「本机实现件备份改名」两条已归档，却仍在被念）。
 *   修法是**念的时候跟表核对**，而**不是**去改账本 —— 改账本会掉进两个坑：
 *   ① 表读不到时会把账本一把擦光（计数归零 → 该提醒的提醒不出来）；
 *   ② 表真的清空时又**不该**擦，而这两种情况从"清单空不空"根本分不出来。
 *   所以这里**只过滤、不写入**：账本一个字不动，判错了也没有破坏性后果。
 */
export function overPassedTodos(threshold = TODO_PASS_ALERT, liveKeys = null) {
  const s = loadClosing()
  const live = liveKeys ? new Set(liveKeys) : null
  return Object.entries(s.todos)
    .map(([k, v]) => ({ item: k, passes: v.passes, lastAt: v.lastAt }))
    .filter((x) => (live ? live.has(x.item) : true))
    .filter((x) => x.passes >= threshold)
    .sort((a, b) => b.passes - a.passes)
}

// ---------------- 自检 ----------------

/** 启动自检：**这件事本身也得出声**（"沉默 ≠ 正常"）。 */
export function reportF18() {
  try {
    const over = overPassedTodos()
    return over.length > 0
      ? `待办过遍计数 F18：⚠️ 过了 ${TODO_PASS_ALERT} 遍仍未动 ${over.length} 条（该主动问用户）`
      : `待办过遍计数 F18：没有"过了 ${TODO_PASS_ALERT} 遍仍未动"的`
  } catch (e) {
    log(`待办过遍计数 F18 自检出错: ${e}`, { silent: true })
    return `待办过遍计数 F18：**没跑起来**（${e && e.message ? e.message : e}）`
  }
}
