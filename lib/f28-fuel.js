// ============================================================
// F28 · 会话油表（"这一段会话烧到哪儿了"）—— 2026-09-19 加
// ============================================================
// 起因（用户原话）："**油表做出来吧。其实现在右下角就有一个记录消费的插件。估计能给你省不少事。
//   但不要依赖这个插件，它会更新或者删除。**"
//
// 为什么要有它（今晚量出来的）：**会话的账在"长度"，不在"某条输出"** ——
//   实测（2026-09-19）那个会话每帧历史平均 **224,786 token**，而窗口是 **1,000,000**，
//   占用才 22.5% → **压缩从来没触发过**，历史一路涨到 42 万。
//   而"这一段烧到哪儿了"这件事，此前**只能靠我感觉** —— 感觉不可靠，所以要有表。
//   🔴 2026-09-20 口径（用户拍板）：它**只报"还剩多少"**、**不再劝切会话**（详见下面 `FUEL` 那段注释）。
//
// 口径从哪来：`assistant/message` 事件的 `data.usage`（**每帧都有**）——
//   这条取数方式与本机右下角那个余额挂件（`dsh-whale-widget`，它"监听本机会话事件、每轮弹精确 usage"）
//   一致，也印证了取数路径可行；但**刻意不依赖它**（它会被更新或删掉）。
//   阈值依据（🔴 2026-09-20 用户实测并拍板）：**窗口 1M 才触发压缩**（≈100%），
//   此前那个"62% 就该切"是猜的 —— 事实是**只有到 1M 才压**。所以提醒落在 **80%（＝80 万）**，留 200K 余量。
//   ⚠️ 同日另一句定死原话："**今后油表仅作用于告诉你上下文还剩多少。**"
//      ⇒ 它**只报数、不给行动建议**（"该切了 / 该落档了"一律不写）—— 见《铁律》§四"不许替读者下判断"。
//
// ⚠️ **只报用得准的东西**：token 是 `usage` 里给的**精确值**。
//   **钱不报** —— 单价会变、还有峰谷（工作日 9-12 / 14-18），**报一个算错的数字比不报更坏**。
//   （要报钱，先把可靠的最新单价表落进配置，并写明取自哪天。）
// ============================================================

import { t } from './texts.js'

/**
 * 每个会话的最近一次读数 —— **只是"按会话历史现算出来的那张快照"**。
 *
 * 🔴 2026-09-20 修（病根：**把"进程"当成了"会话"**）：它原先是个**累加器**
 *    （`frames: prev.frames + 1`），而**进程内存重启即清、会话历史却是恢复的** ——
 *    于是重启后用户看到的是"**已 1 帧**"，可那个会话其实已经跑了几十帧（界面上亲眼可见）。
 *    现在**以历史为准**：每收到一条事件就用 `session.events` 全量重算一遍（见 `noteFuel`），
 *    这个 Map 只存快照 —— 重启后第一条事件一到，读数立刻与历史一致。
 */
const readings = new Map()

/** 存一份读数（顺手防无限长；清掉只是可能重说一次，无害）。 */
function saveReading(sid, r) {
  readings.set(sid, r)
  if (readings.size > 200) readings.clear()
}

/**
 * 油表阈值。
 * · `historyTokens`：**当前历史**（这一帧的 input ＋ 命中缓存）到多少 → 报一次"还剩多少"
 *   （默认 **80 万 ＝ 窗口 1M 的 80%**：**窗口 1M 才触发压缩；80% 提醒，留 200K 余量 ——
 *    用户 2026-09-20 实测并拍板**。旧值 20 万是拿"感觉重了"当依据的猜，已作废。）
 * · `billedTokens`：**本会话累计喂进去**的 input＋cache 到多少 → 也点
 *   （默认 3000 万：按命中价 0.1 元/百万 ≈ 3 元量级）
 */
export const FUEL = { historyTokens: 800_000, billedTokens: 30_000_000, historyStepPct: 0.1, billedStep: 5_000_000 }

/**
 * 记一帧用量 —— **只记，不判断**（判断在 `fuelNotice()` 里做一次）。
 * @param {string} sid 会话 id
 * @param {object} usage `assistant/message` 的 `data.usage`
 * @param {number} [contextWindow] 从 `request/context` 事件里拿到的窗口大小
 */
export function noteUsage(sid, usage, contextWindow) {
  if (!sid || !usage) return
  const prev = readings.get(sid) ?? { frames: 0, billed: 0, output: 0, reasoning: 0, history: 0, window: 0, at: 0 }
  const input = Number(usage.inputTokens) || 0
  const cache = Number(usage.cacheReadTokens) || 0
  // 🔴 2026-10-20 删掉"水位倒转检测"（`drops` / `lastDrop`）—— 它只为 `fuelNotice` 服务，而那个出口当天一起删了：
  //    用户原话「**裁剪已经被管住了，当初判定这个是因为我们在摸索裁剪时候下的论据，现在已经不成立。**」
  //    ⇒ 这里只留记账：`history` 取最新那一帧，**不判断、不计数**。
  const historyNow = input + cache
  const winNow = Number(contextWindow) || prev.window || 0
  saveReading(sid, {
    frames: prev.frames + 1,
    billed: prev.billed + input + cache,
    output: prev.output + (Number(usage.outputTokens) || 0),
    reasoning: prev.reasoning + (Number(usage.reasoningTokens) || 0),
    // ⚠️ "当前历史" ＝ 这一帧的 **未命中 input ＋ 命中缓存**（缓存那部分也是历史，只是打折）
    history: historyNow,
    window: winNow,
    at: Date.now(),
  })
}

/**
 * 🔴 **从会话历史现算读数** —— 这是现在唯一权威的算法（重启不怕、重放不怕、漏一条也不怕）。
 *
 * 扫 `session.events`（形状是**实测的**，见下），口径与增量路径**逐字一致**：
 *   · `assistant/message` 且带 `data.usage` → **算一帧**：
 *     累计 `billed += input ＋ cache`、`output`、`reasoning` 各自累加；
 *   · `history` **取最新那一帧**的"未命中 input ＋ 命中缓存"
 *     （⚠️ 2026-09-19 用户亲自纠正过的口径：**不是均值**，别改）；
 *   · `request/context` 只记窗口、**不算一帧**（取最后一条）。
 *
 * 实测形状（2026-09-20 从本机会话日志逐帧解压核对：
 * `~/.dsh/sessions/<工作区>/<sid>/session.v3.jsonl.zstd`，469 帧 / 897 事件）：
 *   `{"type":"assistant/message","data":{"turn":1,"step":1,"message":{…},
 *     "usage":{"inputTokens":2281,"outputTokens":321,"totalTokens":13738,
 *              "cacheReadTokens":11136,"reasoningTokens":224}}}`
 *   `{"type":"request/context","data":{"provider":"deepseek-official","model":"deepseek-flash",
 *     "contextWindow":1000000,"systemPromptUpdate":"in-history"}}`
 *
 * @param {any[]} events `session.events`
 * @returns {object|null} 历史里一帧都没有 → null（宁可不说话，也不报个假的 0 帧）
 */
export function fuelFromHistory(events) {
  if (!Array.isArray(events)) return null
  let frames = 0
  let billed = 0
  let output = 0
  let reasoning = 0
  let history = 0
  let window = 0
  for (const ev of events) {
    const t = String(ev?.type ?? '')
    if (t === 'request/context') {
      const w = Number(ev?.data?.contextWindow)
      if (w > 0) window = w
      continue
    }
    if (t !== 'assistant/message') continue
    const u = ev?.data?.usage
    if (!u) continue
    const input = Number(u.inputTokens) || 0
    const cache = Number(u.cacheReadTokens) || 0
    frames += 1
    billed += input + cache
    output += Number(u.outputTokens) || 0
    reasoning += Number(u.reasoningTokens) || 0
    history = input + cache
  }
  if (frames === 0 && !(window > 0)) return null
  return { frames, billed, output, reasoning, history, window, at: Date.now() }
}

/**
 * 从一条会话事件里取用量并记账（**F1 每收到一条 `session/event` 就调它**）。
 * 只认两种事件：`assistant/message`（带 `usage`）与 `request/context`（带 `contextWindow`）。
 * ⚠️ 取数逻辑放在这里，是为了让 F1 那边只多一行（它已经够长）。
 */
export function noteFuel(session, event) {
  const sid = typeof session?.id === 'string' ? session.id : null
  if (!sid) return
  // 🔴 2026-09-20 **以历史为准**（病根：把"进程"当成了"会话"）——
  //    `session.events` 是会话恢复时重放回来的，内存不是；所以**每来一条事件就用全量历史重算一次**。
  //    重启后第一条事件一到，帧数就与历史一致，不再出现"界面上几十帧、油表说已 1 帧"。
  //    拿不到 events（测试里的假 session / 老宿主）才退回下面的增量记账。
  const fromHist = fuelFromHistory(session?.events)
  if (fromHist) {
    saveReading(sid, fromHist)
    return
  }
  const type = String(event?.type ?? '')
  if (type === 'request/context') {
    const w = Number(event?.data?.contextWindow)
    if (!(w > 0)) return
    const prev = readings.get(sid)
    readings.set(
      sid,
      prev ? { ...prev, window: w } : { frames: 0, billed: 0, output: 0, reasoning: 0, history: 0, window: w, at: Date.now() },
    )
    return
  }
  if (type !== 'assistant/message') return
  const usage = event?.data?.usage
  if (usage) noteUsage(sid, usage)
}

/**
 * 当前读数（不给 sid 就取最近活跃的那个会话）—— 给 `dangan_status` / 测试用。
 * ⚠️ 这里**只读快照**；快照由 `noteFuel` 按会话历史现算（见 `fuelFromHistory`）。
 */
export function fuelReading(sid = null) {
  // ⚠️ **给了 sid 就必须严格按它查** —— 原先写成"查不到就回退到最近活跃的会话"，
  //    于是 `fuelNotice('不存在的会话')` 会把**别人**的读数报出来（正是"张冠李戴"那一族）。
  //    2026-09-19 被测试当场抓住。只有**不给 sid** 时才取最近活跃的。
  if (sid) return readings.get(sid) ?? null
  const all = [...readings.values()].sort((a, b) => b.at - a.at)
  return all[0] ?? null
}

export function resetFuel() {
  readings.clear()
}

// 🔴 2026-10-20：`fuelSaid`（油表档位）随 `fuelNotice` 一起删了 —— 这里不再需要节流状态。
// ⚠️ 这两个 import 放在这儿（不在文件头）是为了少动一处 —— ESM 的 `import` 允许出现在模块顶层任意位置。
import { join } from 'node:path'
import { DSH_HOME, readTextSafe } from './common.js'

/**
 * 🔴 2026-09-20：**"今日花销"从"报警"改成"纯读数"**（用户原话：
 *   **"既然目前每轮工作都会被'计价门卫'或者闸门所控制。那十五块总量的那个表已经没有存在意义了。
 *     我觉得只单纯方便你知道用了多少钱就行了。不用报警或者警告了。"**）
 *
 * 所以这里**没有**上限、**没有**百分比、**没有**"还剩多少"、**没有**分档节流 ——
 * 只有一个事实：**今天花了多少钱**（读 `~/.dsh/.dshw-usage.json` 的 `todayUsage` 一个字段；
 * 那个文件是右下角余额挂件写的，本插件**只读不写**）。
 *
 * ⚠️ **拿不到文件 / 数字不对 → 返回空串**（"探测不到 ≠ 不存在"，也**不许编**）。
 * ⚠️ 它**不主动说话**：出口是 `dangan_status`（我**要看才查**）—— 每轮注入那边是"报警位"，不放它。
 */
const SPEND_USAGE_FILE = join(DSH_HOME, '.dshw-usage.json')

/** @returns {string} 形如 `💰 今天花了 ¥15.10`；读不到就空串（**不编**）。 */
export function spendLine() {
  try {
    const j = JSON.parse(readTextSafe(SPEND_USAGE_FILE) || '{}')
    const today = j.todayUsage
    if (typeof today !== 'number' || !Number.isFinite(today) || today < 0) return ''
    return '💰 今天花了 ¥' + today.toFixed(2)
  } catch {
    return ''
  }
}


// 🔴 2026-10-20 删净：`fuelNotice()` 与它的"水位倒转"分档提醒（`fuelSaid` / `drops` / `lastDrop`）
//    一起删了。用户当天拍板：「**删了，裁剪已经被管住了，当初判定这个是因为我们在摸索裁剪时候下的论据，现在已经不成立。**」
//    ⇒ 想复活它：先读 CHANGELOG 0.40.0 与 `noteUsage` 的历史注释，再想清楚"窗口现在拿得到没"。

