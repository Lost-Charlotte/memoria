// ============================================================
// F34 · 考勤（各能力"僵了就喊" ＋ 连"心跳自己停没停"一起看）—— 2026-09-26 建
// ============================================================
//
// 起因（用户 2026-09-26 01:14~01:22；原话与四条问答见 `L2-数据/01-事件表-我们做过什么.md`
// 的 E289 / 锚点 T649~T653）：
//   · 01:14〔会话 2026-09-26〕：「**好的时候是隐形的。不好的时候都会主动跳出来。
//     而不是一遍遍的给你发"我正常运作呢"**」
//   · 01:15〔E289〕：「她已经拥有控制台上的形象了……如果她运转不正常，桌面这个东西是不是就不存在了？
//     还是会出现**部分失效**的情况？」
//     → 答：**整体死**看得见（形象没了 ＋ 她也不说话）；**部分失效真的存在，而且那时面板照样在**
//       （两条真账：面板 F16 **依赖 webServer**、等不到就"安静缺席"；**2026-09-21 一道门静默死了三天**）。
//   · 01:17〔E289〕：「给这个心跳加一个能力，机器自检，全部 ok 就不吭声，一部分不 ok 就出声，
//     **或者没出声这个能力也出声**？」← 第三句就是**考勤悖论**（只在异常时说话的哨兵，自己死了没人说话）。
//   · 01:20〔E289〕：用户拍板「**整体死了……人可以肉眼查看**」→ **层 3（体外那层）划掉**，
//     只做两件：① 各能力"僵了就喊" ② **考勤**（含"心跳自己停没停"）。
//
// 🔴 **它只回答三句话**（用户 2026-09-26 19:35 亲自给的验收）：
//   ① 一切正常 → **一个字都不说**　② 有**部分失效** → 出声　③ **它自己失效** → 也出声。
//   （梅莫莉亚**全崩**时它不用出声 —— 那一层交给用户的眼睛。）
//
// ============================================================
// 🔴 判据（**唯一一处** —— 两次修错之后重写，2026-09-26 晚）
// ============================================================
//
// **一句话：问"在它该动的那种步里，它动了吗" —— 不是问"它每一步都动了吗"。**
//
// 为什么原来的判据（"5 个能力每步都该露面，连 3 步没露面＝僵"）**必然误报**：
//   · `F26` 留意栏**只在有真实用户消息的那一步**才算（`f1-onduty.js` 那道早退之后的
//     `backlogText()`）—— 同一个回合后面每一步它都不被调用；
//   · `F30` 门卫**只在有工具调用的时候**才判。
//   ⇒ 拿"每步"量它们，正常跑着也必然攒够 3 步 ⇒ **天天假警**（假警＝告警失效）。
// ⚠️ 0.76.1 修过一次，把"到场就记"补在了 `backlogText()` 里 —— 而它**站在那道早退后面**，
//   补了等于没补。**修对了道理、修错了位置** —— 这就是"修了这么久没修好"的真正原因。
//
// 所以改成**两张脸分开量**，并给每个能力一本 **`owed`（欠它几次露面）**：
//   · `STEP_TICK`（每步都该动）：每走一步 `owed += 1`，它一露面就清零 ⇒ 连欠 `SILENT_ROUNDS` 次＝僵。
//   · `TOOL_TICK`（有工具调用才该动）：`toolCallsTotal()` 涨了才 `owed += 1`，露面清零。
//     🔴 那个时钟**必须独立于 F30 自己的计数**（`common.js` 的 `bumpToolCalls`，挂在
//        `noteToolCall()` 上）—— 拿 F30 的计数当信号就成了**同义反复**，永远测不出"门卫瞎了"。
//   · `F34` 自己：用**外部时钟**（`clockNow()` ＝ F1 的计数，它每步必涨、**且考勤死了它照样涨**）
//     比"它最后一次露面时的时钟" ⇒ **它自己不跑时，这行由还活着的 F26 念出来**（第 ③ 条验收）。
//
// ⚠️ 三条自我约束（写死在代码里，不靠记性 —— 照 `f19-tmpwatch.js` 那份的规矩）：
//   · **只读**：绝不碰档案；`~/.dsh` 里只写自己那一份状态文件；
//   · **绝不抛错**：考勤自己坏掉不许影响主流程（全部 try/catch，读不到状态就重头数）；
//   · **沉默是默认**：全好 → 一个字都不说（出口只有两处：留意栏一行、`dangan_status` 一行）。
//
// ⚠️ **它不判"能力干得对不对"**，只判"这一条链还在不在动"。

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CAP_STATS, HEALTH_DIR, HOME_DIR, capTick, log, toolCallsTotal, writeHealth } from './common.js'

/** 状态文件（她的家 `~/.dsh/memoria/`；原子写：临时文件 + 改名）。 */
export const WATCH_STATE_FILE = join(HOME_DIR, 'memoria-watchdog.json')

/**
 * 🔴 **判据常量（唯一一处）**：连着几步没露面算"僵"。
 * 一步 ＝ 一次 `agent/pre-step`（模型每往前走一步都算一回）。
 */
export const SILENT_ROUNDS = 3

/** 同一份"僵了"的告警最多多久再说一次（**内容变了立刻说**）。 */
export const WATCH_TTL_MS = 60 * 60 * 1000

/**
 * **起步热身**：本进程走满这么多步之前，**一个字都不喊**。
 * 为什么需要它：一步 ＝ 一次 `agent/pre-step`，而"开始用"那一刻能力本来就还没露面；
 *   不给热身，她会在每个新会话的开头喊一次假警（假警＝告警失效）。
 */
export const WARMUP_STEPS = 8

/** **每步都该露面**的能力（`owed` 每步 +1）。 */
export const STEP_TICK = ['F1', 'F5', 'F26']

/** **有工具调用时才该露面**的能力（`owed` 只在工具调用时钟涨时 +1）。 */
export const TOOL_TICK = ['F30']

/** **它自己**（第 ③ 条验收：考勤死了，由还活着的能力念出来）。 */
export const SELF_TICK = ['F34']

/**
 * **被盯的脸**（＝三组之和）。
 * 为什么要列名单：不是所有能力都该露面。`F9`（落档）只在真落档时动、`F20`（建档案）一辈子动一次、
 * `F22`（压缩留底）只在压缩时动 —— 拿它们判"僵了"就是**天天误报**，而误报＝告警失效。
 */
export const MUST_TICK = [...STEP_TICK, ...TOOL_TICK, ...SELF_TICK]

/** 给人看的中文名（只给考勤自己的报告用）。 */
const ZH = { F1: '注入', F5: '体检', F26: '留意栏', F30: '门卫', F34: '考勤' }

/** 内存里的步号（每次 pre-step ＋1）。**只用于显示** —— 判据不看它（见 `clockNow()`）。 */
let stepSeq = 0

/** 上一次真写的节流记录（`{ key, at }`）。**只在内存里**：重启后宁可重说一次，不可漏说。 */
let lastPing = { key: '', at: 0 }

/** 本进程的身份戳（用来判断"状态文件是上一程留下的"）。 */
function runId() {
  return String(process.pid)
}

/**
 * 🔴 **外部时钟**：`F1` 的计数。
 *
 * `F1` 每走一步都自报（`f1-onduty.js` 里 `capTick('F1','到场')` **排在所有早退之前**），
 * 所以它是"她走了多少步"的可靠读数 —— **而且考勤自己死掉时它照样在涨**。
 * 这一点是第 ③ 条验收的关键：拿考勤自己的 `stepSeq` 当时钟，它一停步号就冻住，
 * 谁都算不出"它落后了多少" ⇒ **它静默死掉时反而报不出来**。
 */
function clockNow() {
  try {
    return Number(CAP_STATS.get('F1')?.count) || 0
  } catch {
    return 0
  }
}

/** 读状态（读不到就当空的：**宁可重头数，不可拿旧账误报**）。 */
function readState() {
  try {
    if (!existsSync(WATCH_STATE_FILE)) return null
    const s = JSON.parse(readFileSync(WATCH_STATE_FILE, 'utf8'))
    return s && typeof s === 'object' ? s : null
  } catch {
    return null
  }
}

/** 原子写状态（临时文件 + 改名，与 `f29-verified.js` 同一姿势）。**写不了只记日志。** */
function writeState(next) {
  try {
    const tmp = `${WATCH_STATE_FILE}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(tmp, WATCH_STATE_FILE)
  } catch (e) {
    log(`考勤状态写不进去（不影响跑）: ${e}`, { silent: true })
  }
}

/** 状态文件是不是**本进程**写的（不是就当没写过 —— 上一程的账不许算到这一程头上）。 */
function sameRunOf(st) {
  return st && st.runId === runId() ? st : null
}

/** 一本空账（本进程开头）。 */
function freshState(clock) {
  return {
    runId: runId(),
    baseClock: clock,
    seq: stepSeq,
    clock,
    seen: {},
    owed: {},
    counts: {},
    toolCalls: toolCallsTotal(),
    at: new Date().toISOString(),
  }
}

/**
 * 记一步：**每次 `agent/pre-step` 都该调它**
 * （由 `f1-onduty.js` 调，理由同 F22/F23 —— 脚手架的 `on()` 是"后注册顶掉先注册"，
 *  自己挂钩子会把整条注入链顶掉，踩过两次）。
 *
 * 顺序固定：① 步号 ＋1 → ② **露面检测**（跟**上一步的快照**比）→ ③ 记留意 → ④ 算"谁僵了" → ⑤ 存快照。
 *
 * @param {'pre-step'|'turn-end'} where 在哪个钩子上记的（只影响日志措辞，不改判据）
 * @param {boolean} idle 这一步**整条链都没轮到**（子代理的步 / 非 enter 的步 / 被中止的步）——
 *   那种步"每步都该动"的能力本来就轮不上，**不许算它留意**（否则子代理连跑三步就假报）。
 */
export function watchTick(where = 'pre-step', idle = false) {
  try {
    stepSeq += 1
    const clock = clockNow()
    const prev = readState()
    const st = sameRunOf(prev) ? prev : freshState(clock)
    st.seq = stepSeq
    const seen = st.seen && typeof st.seen === 'object' ? st.seen : {}
    const owed = st.owed && typeof st.owed === 'object' ? { ...st.owed } : {}
    const before = st.counts && typeof st.counts === 'object' ? st.counts : {}
    const tc = toolCallsTotal()
    const tcBefore = Number(st.toolCalls) || 0

    // ② **露面检测**：必须跟"**上一步的快照**"比，不能跟"本进程见没见过"比 ——
    //    `CAP_STATS` 的 count 是**跨重启累计**的，见过一次就永远"见过"，
    //    那样判出来的是"它这一程露过面没有"，而不是"它**这一步**还动没动"。
    for (const [id, s] of CAP_STATS) {
      const cnt = Number(s?.count) || 0
      if (cnt > (Number(before[id]) || 0)) {
        seen[id] = clock
        owed[id] = 0
      }
    }
    // **自己这一步就算动过** —— 这个函数正在这儿跑，这就是"它动了"的直接证据。
    // 真出问题的那一步，是这个函数**根本没被调到**（pre-step 断了）—— 那时 `seen.F34` 停住，
    // 而时钟还在涨，于是"考勤自己僵了"由还活着的能力（F26）念出来。
    seen.F34 = clock

    // ③ **记留意**（只有"该动没动"才欠）：
    // 🔴 `idle` 的步**不许算留意** —— 那一步"每步都该动"的能力本来就没轮到它
    //    （子代理的步 / 非 enter 的步 / 被中止的步，见 `f1-onduty.js` 那几条早退）。
    //    但 `F34` 自己照记（这个函数正在跑），`clock` 也照涨（它数的是 F1 的到场）。
    if (!idle) for (const id of STEP_TICK) owed[id] = (Number(owed[id]) || 0) + 1
    if (tc > tcBefore) for (const id of TOOL_TICK) owed[id] = (Number(owed[id]) || 0) + 1

    st.seen = seen
    st.owed = owed
    st.clock = clock
    st.toolCalls = tc
    // ④ 算"谁僵了"：**直接用内存里这份状态**算（一个来源，没有第二步 ——
    //    原来"写盘 → 再读回来"中间任何一步没对齐就会算出荒谬值，实测出现过"−2 轮"）。
    st.silent = silentRounds(st)
    // 🛡 **2026-10-22（机器闭环 · 第二步）**：把考勤结论写成机读状态给安全总监看。
    //    ⚠️ 只**转写**刚算出的 `st.silent`，不新加扫描；写失败也不许影响考勤本身。
    try {
      const n = Array.isArray(st.silent) ? st.silent.length : 0
      writeHealth('F34', n === 0, n === 0 ? `该露面的 ${MUST_TICK.length} 个都在` : `${n} 个没露面`)
    } catch {
      /* 报不上自己，不影响考勤 */
    }
    // ⑤ **先给自己记一笔，再存快照**：快照记的必须是"**这一步结束时**各能力的计数"。
    //    原来把快照记在"自报之前"，于是下一步永远跟更早的一份比 ⇒ 每步都在动的能力
    //    也被算成"连着 N 步没露面"（实测连报 51 步假警报）。
    capTick('F34', `第 ${stepSeq} 步`)
    st.counts = Object.fromEntries([...CAP_STATS].map(([id, s]) => [id, Number(s?.count) || 0]))
    st.at = new Date().toISOString()
    st.where = where
    writeState(st)
  } catch (e) {
    /* 考勤自己不许影响任何主流程 */
    try {
      log(`考勤 tick 出错（放行）: ${e}`, { silent: true })
    } catch {
      /* 连日志都写不了就算了 */
    }
  }
  return null
}

/**
 * 谁僵了？**空数组 ＝ 全好。**
 *
 * 判据（**唯一一处**，见文件头）：
 *   · `STEP_TICK` / `TOOL_TICK`：看它**欠了几次露面**（`owed`，由 `watchTick` 记）；
 *   · `F34` 自己：看它的**外部时钟**落后了多少步 —— 这样它自己停摆时也算得出来。
 *
 * 上一程留下的账**一律不算**（从本进程起点重数）；热身期内谁都不算僵。
 *
 * @returns {Array<{id:string, zh:string, rounds:number}>} 空数组 ＝ 全好
 */
export function silentRounds(stateIn = null) {
  try {
    const st = stateIn ?? readState()
    if (!sameRunOf(st)) return []
    const clock = clockNow()
    const base = Number(st.baseClock)
    const baseClock = Number.isFinite(base) && base > 0 ? base : clock
    if (clock - baseClock < WARMUP_STEPS) return []
    const seen = st.seen && typeof st.seen === 'object' ? st.seen : {}
    const owed = st.owed && typeof st.owed === 'object' ? st.owed : {}
    const out = []
    for (const id of MUST_TICK) {
      let rounds = 0
      if (SELF_TICK.includes(id)) {
        const at = Number(seen[id])
        const from = Number.isFinite(at) && at > 0 ? at : baseClock
        rounds = clock - from
      } else {
        rounds = Number(owed[id]) || 0
      }
      if (rounds >= SILENT_ROUNDS) out.push({ id, zh: ZH[id] ?? id, rounds })
    }
    out.sort((a, b) => b.rounds - a.rounds)
    return out
  } catch {
    return []
  }
}

/**
 * **安全总监的心跳**（2026-10-22 加 · 用户：「看门狗可以通过这个日志检测总监」）。
 *
 * 判据：读 `health/F38.json` 的 `at` —— 那是总监每步写的心跳。
 *   **超过 `DIRECTOR_STALE_MS` 没更新 ⇒ 它死了**（它自己不吭声时，由考勤来念，与它盯别人同一把尺子）。
 * ⚠️ 为什么不用 `capTick('F38')`：总监的 `capTick` 只在"真有用户消息、真走到注入那一步"才 +1；
 *    用它判"连着几步没露面"会**误报**（那几步它本来就不该跑）。
 *    **心跳文件比计数可靠**：只要它跑了就写，不管有没有话说。
 * 🔴 **2026-10-22 修了一次误报**：原来拿**墙上的钟**判（`at` 超过 10 分钟就算死）——
 *    上午用户回来看到「心跳停了 580 分钟」，而那 580 分钟正是**昨晚到中午没人用**的那段。
 *    **"没跑"被当成了"死了"**。现在改成拿**步数**判：`health/F38.json` 里记着它上次跑时的 `step`，
 *    拿它跟**现在走了几步**比 —— **我走了、它没跟上**才是死；**一步都没走** ⇒ 谁都没动，不判。
 * ⚠️ 读不到文件时返回 `''`（**"还没写过"不等于"死了"** —— 刚重启的第一秒就是这样）。
 */
const DIRECTOR_STALE_STEPS = 3

function directorStale() {
  try {
    const j = JSON.parse(readFileSync(join(HEALTH_DIR, 'F38.json'), 'utf8'))
    const at = Number(j && j.at) || 0
    if (!at) return ''
    const myStep = Number(CAP_STATS.get('F34')?.count) || 0
    const itsStep = Number(j && j.step)
    // 老格式（还没有 step 字段）⇒ 退回墙钟判，但阈值放到 60 分钟，别再把"一晚没人用"当死。
    if (!Number.isFinite(itsStep)) {
      if (Date.now() - at <= 60 * 60 * 1000) return ''
      return `⚠️ **安全总监心跳停了 ${Math.round((Date.now() - at) / 60000)} 分钟** —— 它可能已经死了（这一步的"全部正常"不可信，别拿它当结论）。`
    }
    const gap = myStep - itsStep
    if (gap < DIRECTOR_STALE_STEPS) return ''
    return `⚠️ **安全总监掉队了 ${gap} 步** —— 我走了这么多步它一次都没判（它可能已经死了；这一步的"全部正常"不可信，别拿它当结论）。`
  } catch {
    return ''
  }
}

/**
 * 留意栏那一行（给 F26 用）。**全好 → 返回 `''`**（沉默是默认）。
 *
 * ⚠️ 真说还是不说、隔多久再说，由 F26 自己那套节流决定 —— 这里只把话说清楚。
 */
export function watchdogLine() {
  const list = silentRounds()
  const stale = directorStale()
  if (list.length === 0 && !stale) return ''
  const out = []
  if (list.length > 0) {
    const parts = list.slice(0, 3).map((x) => `${x.id}（${x.zh}）**连着 ${x.rounds} 步没露面**`)
    const more = list.length > 3 ? `，另有 ${list.length - 3} 个` : ''
    out.push(
      `⚠️ **考勤：${parts.join('、')}${more}。**` +
        `这通常就是"她某一部分僵了"—— 它该露面却连着 ${SILENT_ROUNDS} 步一句话都没说（"一步"＝模型往前走一次；` +
        `**它自己不吭声时，这份留意由还活着的能力来念**）。`,
    )
  }
  // 🛡 总监自己的心跳（2026-10-22）：**它是汇总者，它死了"全绿"就是假的** —— 这条必须念出来。
  if (stale) out.push(stale)
  return out.join('\n')
}

/** 节流判据：同一份内容多久可以再说一遍（内容变了立刻说）。给 F26 用。 */
export function watchdogPing(key) {
  const now = Date.now()
  if (key === lastPing.key && now - lastPing.at < WATCH_TTL_MS) return false
  lastPing = { key, at: now }
  return true
}

/** `dangan_status` 那一行。**全好也返回一句** —— "它扫过了"这件事必须看得见。 */
export function watchdogText() {
  try {
    const list = silentRounds()
    const st = readState()
    const where = `本进程第 ${stepSeq} 步`
    if (list.length === 0) {
      return `■ 考勤：全好（${where}）· 该露面的 ${MUST_TICK.length} 个能力都在`
    }
    return (
      `■ 考勤：⚠️ **${list.length} 个僵了** —— ` +
      list.map((x) => `${x.id}（${x.zh}）${x.rounds} 步没露面`).join(' · ') +
      `（${where}${st?.at ? ` · 状态写在 ${st.at}` : ''}）`
    )
  } catch {
    return ''
  }
}

/** 启动自检用的一行（自报工作量 —— "沉默 ≠ 正常"）。 */
export function reportF34() {
  try {
    const list = silentRounds()
    return `考勤 ${list.length === 0 ? '全好' : `${list.length} 个僵`}（盯着 ${MUST_TICK.length} 个）`
  } catch {
    return '考勤 读数失败'
  }
}
