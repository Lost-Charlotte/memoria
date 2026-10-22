// ============================================================
// F7 · 落档闸门（turn-stopping + steer）
// ============================================================
//
// 2026-09-16 真机验通：agent.steer() 收得下插件手写的消息对象，agent/turn-stopping
// 真能在回合结束那一刻把回合拽回来多走一步。这是"不答完不让停"唯一的着力点。
//
// 设计（见 `L3-知识\记录-2026-09-16-日志半自动化设计.md`）：
// - **门由机器算**：判据是档案的物理状态（T/E 计数 + 机械体检 + 总览日期），
//   我说"完成"不起任何作用 —— 唯一出路是真的去改档案。
// - **只报第一个没过的**：这就是用户要的"1 答完跳 2"。
// - **有界**：同一会话连续拦 3 次就放行，并把没过项记进 `memoria-gate.log`（防死循环）。
// - **让位于用户**：最后一条真实用户消息里出现"先别记 / 不用了 / 就这样…"就放行，并留痕。
// - **插件对档案仍然只读**：留意只写 `~/.dsh`，绝不在档案里拉屎。
// - 模式从**文件**读（`memoria-gate.mode`）：`off` / `observe`（只记日志、不拦）/ `enforce`。
//   ⚠️ 用文件而不是环境变量，是为了**不用重启就能从 observe 切到 enforce**。
//
// ============================================================
// 闸门定义表（**唯一权威定义处** —— 2026-09-19 立 · 待办「给闸门与判据编号建定义表」）
// ============================================================
//
// 🔴 为什么单独立这一块：档案文档里到处在说"G1 / G2 / G3"，**却没有一处定义它们** ——
//    真值只散在本文件的代码里；更糟的是**"G3"先后有过两个含义**（旧的＝"总览跟没跟上"，2026-09-16 晚删；
//    新的＝"事件收尾"），而那个被删的旧 G3 还留在好几份 L3 记录的嘴里（见本块末尾）。
//    所以：**判据只在这里定义一次**；档案文档**只许引用编号**，不许重述判据（重述必漂）。
//
// **四个门共用的三件事**（不再逐条重复）：
//   · 触发点：`agent/turn-stopping`（**回合即将结束那一刻**；子代理不参与）
//   · 处置：`agent.steer()` 把回合**拽回来多走一步**；**只报第一个没过的门**（＝"1 答完跳 2"）
//   · 上限与让位：同一会话**连续拦 3 次就放行**（防死循环）；最后一条**真实用户**消息里出现
//     `GATE_STOP_WORDS`（"先别记 / 不用了 / 就这样…"）→ 放行并留痕
//   · 模式：读文件 `memoria-gate.mode` → `off` / `observe`（只记日志、不拦）/ `enforce`（真拦）
//
// **G1 落没落** —— 判据：时间轴涨了（`countT() > state.lastT`）**且**事件表**内容指纹一个字没动**
//   （`eventTableHash() === state.lastEHash`）。防的是"新发生的事只加了 T、没建/更新 E"（W5 第一行）。
//   ⚠️ 比的是**内容指纹**、不是条数 —— **更新**一条已有的 E 也算落档（2026-09-16 深夜修）。
//   ⚠️ 没有指纹基线（老 state / 首次运行）时**放过一轮**并顺手把基线写下去 —— 否则会把自己锁死。
//
// **G2 对不对得上** —— 判据：机械体检（`f5-check.js`）的"错"数 > 0，报**第一条**。
//   ⚠️ 走 `checkArchiveCached()`（2026-09-19 起）：缓存判据是**档案变没变**（路径/大小/mtime 指纹），
//      所以"我刚把档案改坏"**下一回合就拦**；省掉的只是"档案没动时的空转"（原先 449ms/回合 → 24ms）。
//
// **~~G3 事件收尾~~** —— 🔴 **2026-10-15 退役删除**（它读的「事件表」随 L2 一起删了 ⇒ 恒空、永不触发）。
//
// ⚠️ `dumpVerdict()` 在收工那一刻会被调用 —— **它不是闸门**，只为那个副作用
//   （收掉"0 候选已挪 verified"的 state）；`observe` 模式下也照做。
//   "没归账还想干别的活"归 **f30 第 18 关「销账三步门」＋ F26 留意栏**，不在这里。
//
// **G5 警示强制** —— 判据：`dumpNotice().count > 0` **且上一轮亮着的份数与这一轮相同** ＝
//   "**上一轮就亮过、这一轮还没动**"。⚠️ **第一轮只亮灯（放行），第二轮起才拦** ——
//   用户 2026-09-20 原话："**提醒之后第二轮发现你没做，用闸门强制你必须做。**"
//   治的是当天实测那件事：留意栏那 2 条候选**从会话开始挂了几十分钟没人动**，直到用户自己提出来。
//   ⚠️ **为什么不复用 F26 的节流**：F26 的节流是"**同一内容不重复说**"（那是减重），
//      而这里要的恰恰相反 —— "**说过、还没动，就得拦**"。两者不是一回事，判据必须独立。
//   ⚠️ 计数**只在内存**（重启后第一轮只亮灯 —— 新进程不知道上一轮亮过什么，这是对的）；
//      也**不许写进 gate state**：那份 state 只在"通过"时才保存，写进去会变成坑 4 那种死锁。
//
// ⚠️ **旧 G3 已删除**（2026-09-16 晚）：它原来是"总览跟没跟上"，而总览那天起**不再抄时间线** →
//    那个门**永远不会触发**（"看起来在跑、其实已死"）。档案里写"删掉 G3"的记录，说的都是**那个旧 G3**。
//
// 📖 **W0~W8（档案写作判据）** 定义不在这里 —— 在 `L1-必读/日志系统-使用说明.md` 各节标题里
//    （W0 最重要原则 / W1 时间轴 / W2 事件表 / W3 模型标注 / W4 收尾 / W5 落档清单 / W6 待办进出 /
//     W7 判据过时时写"停" / W8 旧做法就地标作废）。⚠️ 这份清单**不是定义**，只是一个"去哪找"的索引。

import { appendFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { HOME_DIR, capReport, capTick, createPluginMessage, findByName, isSubagent, log, readTextSafe, sessionIdOf } from './common.js'
// 🔴 2026-10-15：`STALE_DAYS` / `pendingClosing` / `waiterOf` / `markNotified` 随 G3 退役，import 删除。
// 🔴 2026-09-28：**"等前置"的事件不按时间催**（前置没结时一个字不说；前置一结提醒一次）——
//    用户当天点的判定：「等理由的那种不要改成永不过期，**能不能改为检测前置**……其他时候就安安静静。」
// 🔴 2026-10-15：`notBlockedPending` / `blockersResolved` 随 G3 退役，import 删除。
import { regenMapIfStale } from './f17-map.js'
import { maybeCleanL9 } from './f19-tmpwatch.js'
import { checkArchiveCached } from './f5-check.js'
import { dumpNotice, dumpVerdict } from './f22-compact-dump.js'
import { resetToolCalls, toolCallsThisTurn, turnKeyNow, wroteThisTurn } from './f30-toolgate.js'
import { maybeCleanVerified } from './f29-verified.js'
import { isLabArchive } from './f32-archives.js'

export const GATE_STATE = join(HOME_DIR, 'memoria-gate.state.json')
export const GATE_MODE_FILE = join(HOME_DIR, 'memoria-gate.mode')
export const GATE_LOG_FILE = join(HOME_DIR, 'memoria-gate.log')
export const GATE_STOP_WORDS = ['先别记', '不用记', '别记了', '先不落', '先停', '停一下', '不用了', '就这样', '算了', '待会再说', '回头再说']

/** 上一次写进日志的那行"干活统计"（**只在变化时才写**，免得日志每回合长一行废话）。 */
let lastCapLine = ''

/** G5 用的：上一轮亮着几份留底（**只在内存** —— 重启后第一轮只亮灯，合理）。 */
let warnedDumpCount = 0

/**
 * G5 的判据（**抽成纯函数，好测** —— 否则要造整套留底 state 才能测它）。
 *
 * 判据：**上一轮亮着几份、这一轮还是几份** ＝ "上一轮就亮过、这一轮还没动"。
 * 第一轮（上次是别的数 / 刚复位）只亮灯、放行；**第二轮起拦**。
 *
 * @param {number} count 现在还有几份留底没销账（`dumpNotice().count`）
 * @param {string} detail 拦的时候附上的明细（`dumpNotice().compact`）
 * @returns {string|null} 该拦 → 返回话术；放行 → null
 */
export function dumpWarnVerdict(count, detail = '') {
  const n = Number(count) || 0
  if (n <= 0) {
    warnedDumpCount = 0
    return null
  }
  if (warnedDumpCount === n) {
    return (
      `G5 未过：**${n} 份留底上一轮就亮着、这一轮还没动** —— 先把它处理掉（销账，或明确交代为什么先不动）。\n` +
      String(detail ?? '')
    )
  }
  warnedDumpCount = n
  return null
}

export function gateLog(msg) {
  try {
    appendFileSync(GATE_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* 日志失败不阻塞 */
  }
  log(msg)
}

export function gateMode() {
  return (readTextSafe(GATE_MODE_FILE).trim() || 'off').toLowerCase()
}

export function loadGateState() {
  try {
    const s = JSON.parse(readTextSafe(GATE_STATE))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

export function saveGateState(s) {
  try {
    writeFileSync(GATE_STATE, JSON.stringify(s, null, 2))
  } catch {
    /* 存不下就算了，门退化成"每次都查" */
  }
}

/**
 * ⚠️ **2026-09-17 晚：`countT` / `countE` 的实现搬到 `common.js` 了**（口径一个字没改）。
 * 为什么搬：F22（压缩留底）写留底时要在头一行记下"压缩前最后一条 T 号"，跟闸门 G1 用的是**同一个数** ——
 * 两个模块各写一份必然漂（本档案的头号病根就是副本）。
 * 这里**原样 re-export**，老的 import 路径（`index.js` / `tests/`）一个字都不用改。
 */
// 🔴 2026-10-15：`countT` / `countE` 的**转发已撤**（它们随 L2 退役删除 —— 时间轴/事件表都不在档案里）。

/**
 * 事件表**内容**的指纹（2026-09-16 深夜加）。
 *
 * 为什么需要它：G1 原来只比 **E 的条数**，而"**更新一条已有的 E**"根本不改条数 ——
 * 于是"时间轴加了一行 T、同时把对应 E 条更新了"这种**完全合规**的收尾，
 * 会被 G1 判成"事件表没跟上"（**假拦**）。实测就踩到了：T174 那轮我更新了 E55，
 * 条数 58 没变 → 按老规则必拦。
 * 现在改成比**内容指纹**：内容动过就不算"没跟上"。
 */
// 🔴 2026-10-15：**`eventTableHash()` 已整块删除** —— 它读「事件表」算 sha1 指纹（给 G1 当基线），
//    而事件表随 L2 退役 ⇒ `findByName('事件表')` 恒 null ⇒ 恒返回空串。G1 已退役，它**没有读者**了。


// ⚠️ `maxDateIn()` **已于 2026-09-16 晚删除**（随 G3 一起删：G3 没有检查对象了，它也就没人用）。

/** 机器算出来的判定：返回**第一个**没过的门。 */
export function gateVerdict(state) {
  const v = gateVerdictRaw(state)
  // 🏗 **工地馆（F32）：只提醒、不拦** —— 2026-09-24 用户定的工作流：他在老馆讨论好结构、
  //    切到新馆改结构；新馆是**工地**，半成品是常态，闸门照旧严就会"疯狂报错"。
  //    口径出处：实验馆那条既定口径"**闸门不做拦截，仅提醒。不然自动化怎么完成**"。
  //    ⚠️ **只降"拦"、不降"说"** —— 没过就写一行日志（沉默 ≠ 正常）；**判据一个字没动**。
  if (v && isLabArchive()) {
    try {
      gateLog(`🏗 工地馆 · 闸门只提醒不拦：${v.id} ${String(v.text || '').slice(0, 140)}`)
    } catch {
      /* 记不上日志也照样放行 */
    }
    return null
  }
  return v
}

/** 判据本体（**一个字没动**）—— 上面那个 `gateVerdict` 只是在工地馆上把它降成"只提醒"。 */
function gateVerdictRaw(state) {
  // 🔴 2026-10-15：`t` / `e` 两个读数**删除** —— `countT()` / `countE()` 随 L2 退役（它们恒 -1，函数本体也删了）。
  //    下面 `dumpVerdict()` 的参数**早已不参与判据**（`void currentT`，只为兼容），传常量 -1 即可。

  // G2 对不对得上：机械体检必须零错
  // ⚠️ **2026-09-19 改：走 `checkArchiveCached()`**（原先每回合自己整扫一遍全档 1.39 MB）。
  //    缓存判据是"**档案变没变**"的指纹，所以这一改**不会**让 G2 看不见我刚写坏的东西：
  //    档案一动指纹就变 → 立刻重算。省的是"档案没动时的空转"。
  const errs = checkArchiveCached().filter((x) => x.lv === '错')
  if (errs.length > 0) {
    const x = errs[0]
    const more = errs.length > 1 ? `（共 ${errs.length} 条，先修这条）` : ''
    return { id: 'G2', ok: false, text: `G2 未过${more}：${x.file}${x.line ? `:${x.line}` : ''} · ${x.msg}` }
  }

  // ---- 「G3 总览跟没跟上」2026-09-16 晚**已删除** ----
  // 原因：总览那时起**不再抄时间线**（改成读法，见 L1「00-总览」规矩 1~2），里面再没有 `| **09-16** |` 这种行，
  // 这条门会**永远不触发**——留着就是"看起来在跑、其实已死"。
  // 于是**当时**闸门只剩两道：**G1 落没落（T/E 同步）** 与 **G2 对不对得上（机械体检查错）**。
  // ⚠️ **2026-09-19 补注：「只有两道」这句已过时** —— 同一天起本文件顶部立了「闸门定义表」，
  //    （现行：**G2 / G5** —— 以顶部定义表为准）。
  //    判据一律以头部那一块为准（这里只是留个历史痕迹，免得读到旧话又被误导）。

  // ---- G3 事件收尾：🔴 **2026-10-15 已退役删除** ----
  // 它读「事件表」（`notBlockedPending()` → `pendingClosing()` → `staleOpenEvents()`），
  // 而事件表随 L2 一起删了 ⇒ 这条链**恒空、永不触发**（与已删的旧 G3 / G1 同一条理由："看着在跑、其实已死"）。
  // 用户当天拍板「没用就删了」。现役闸门见文件顶部「闸门定义表」。

  // ---- `dumpVerdict()`：**不是闸门**，只为那个副作用（把"0 候选已挪 verified"的 state 收掉）----
  // 那跟"拦不拦"是两回事，`observe` 模式下也照做。
  const dv = dumpVerdict(-1)
  void dv // 它现在永远 `ok:true`；留着这次调用只为那个副作用

  // ---- G5 警示强制（2026-09-20 加 · 用户点的）----
  // 判据与来由见文件顶部「闸门定义表」里的 G5 那一段（那里是唯一权威）。
  const dn = dumpNotice()
  const g5 = dumpWarnVerdict(dn.count, dn.compact)
  if (g5) return { id: 'G5', ok: false, text: g5 }

  // 🔴 **2026-10-16 修**：原来这里写 `id: 'G1'` —— 而 **G1（"落没落"：时间轴涨没涨）2026-10-14 已随 L2 退役**
  //    （见文件顶部闸门定义表）。这一句的 `text` 说的是"机械体检 0 错"，那是 **G2** 的判据 ⇒ **id 改成 G2**。
  return { id: 'G2', ok: true, text: `机械体检 0 错` }
}

/** 最后一条**真实用户**消息的文本（插件注入的不算）。用于"让位于用户"。 */
export function lastRealUserText(agent) {
  try {
    const evs = agent?.session?.events
    if (!Array.isArray(evs)) return ''
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i]
      if (ev?.type !== 'user/message') continue
      const d = ev?.data ?? {}
      // 🔴 2026-09-28：**有 kind 且不是 `user` 才算注入**（DSH 0.1.7 v4 不再用 `plugin` 这个包装名；缺 kind 的不当注入 —— 宁可多算用户的话，不静默丢）
      const k = d?.source?.kind
      if (typeof k === 'string' && k !== 'user') continue
      const c = d?.content
      if (!Array.isArray(c)) continue
      const t = c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('')
      if (t.trim().length > 0) return t
    }
  } catch {
    /* 拿不到就当没叫停 */
  }
  return ''
}

export function userSaidStop(agent) {
  const t = lastRealUserText(agent)
  if (!t) return ''
  for (const w of GATE_STOP_WORDS) if (t.includes(w)) return w
  return ''
}

// ============================================================
// F31 · 输出端的门：宣称"已做"要有凭据（**第一版只 observe：只出声、不拦**）
// ============================================================
//
// 为什么有它 ——《AI错误总账》**R23**：我在回复里写"脚本也按你说的写了（桌面 `安装梅莫莉亚.cmd`）"，
//   **但全程没调用过任何写文件的动作** —— 用户重启完去桌面找，**找不到**。
//   这类"把自己的状态说错"与 R14 / R20 同族。
//
// 🔴 **第一版绝对不拦人**（只 `log` ＋ `capTick('F31', …)`）：这是**关键词启发式**，误报一定会有
//    （我完全可能在说别的事，比如引述别人的话）。等它跑一阵、看清误报率再说。
//
// ⚠️ 判据表（`gateVerdict`）**一个字没碰** —— F31 不参与"拦不拦"，它只挂在收工那一刻观测。

/**
 * "宣称完成"的词 —— **两族**（2026-09-23 扩了一次，起因见下）：
 *   · **完成族**：已完成 / 已写好 / 已经写好 / 已提交 / 已装好 / 已落地 / 搞定
 *   · **动作 ＋"了"族**：写好了 / 已经写了 / 改好了 / 修好了 / 做好了 / 都写了 / 按你说的写
 *
 * 🔴 **为什么扩**：R23 的原句是「**脚本也按你说的写了**（桌面 `安装梅莫莉亚.cmd`）」——
 *    它**一个完成族的词都不含**，于是 F31 当场漏掉（档案待办里那条"词表抓不到 R23 原话"就是它）。
 * ⚠️ **仍然不收光秃秃的「写了」**：那太宽（"文档里写了"、"这里写了"全会命中），
 *    误报一多这个哨兵就没人看了。所以只收**带完成意味的搭配**。
 */
export const CLAIM_WORDS = [
  '已完成',
  '已写好',
  '已经写好',
  '已提交',
  '已装好',
  '已落地',
  '搞定',
  '写好了',
  '已经写了',
  '改好了',
  '修好了',
  '做好了',
  '都写了',
  '按你说的写',
]

/**
 * F31 的判据（**抽成纯函数，好测** —— 不用造整套会话事件就能钉住语义）。
 *
 * 判据：**回复里出现"宣称完成"的词** ∧ **本回合没有任何写动作** ⇒ 出声（返回话术）；
 *       其余一律沉默（`null`）：没宣称 → 沉默；写了东西 → 沉默；空文本 → 沉默。
 *
 * @param {string} replyText 本回合最后一条 `assistant/message` 的文本（拼起来的）
 * @param {boolean} wroteSomething 本回合有没有写动作（`f30-toolgate.js` 的 `wroteThisTurn()`）
 * @returns {string|null} 该出声 → 话术；沉默 → null
 */
export function claimVerdict(replyText, wroteSomething) {
  const t = typeof replyText === 'string' ? replyText : ''
  if (!t.trim()) return null
  const hit = CLAIM_WORDS.find((w) => t.includes(w))
  if (!hit) return null
  if (wroteSomething) return null
  return (
    `F31 提醒（只出声、不拦）：你说了"${hit}"，但**本回合没有任何写操作** —— ` +
    '拿不出凭据就别写"已做"（《AI错误总账》R23：写了"已写好"，其实一次写文件的动作都没调用过）。'
  )
}

/**
 * 最后一条**带正文的** `assistant/message` 的文本（F31 用它拿"我这一轮对用户说了什么"）。
 *
 * 写法照 `lastRealUserText()`：**倒着扫 `agent.session.events`**。
 * 字段形状是**实测的**（2026-09-20 用本插件自己的 `readSessionEvents()` 逐帧解压核对：
 * `~/.dsh/sessions/<工作区>/<sid>/session.v3.jsonl.zstd`，50 帧 / 92 事件里 `assistant/message` 13 条）：
 *   {"type":"assistant/message","seq":…,"time":…,
 *    "data":{"turn":1,"step":1,
 *            "message":{"role":"assistant","content":[{"type":"reasoning"|"tool-call"|"text","text":…}],"source":…,"id":…},
 *            "usage":{…},"stream":…}}
 *   → 🔴 正文在 **`data.message.content[]`** 里、只认 `type==='text'` 的块；
 *     `reasoning`（思考链）与 `tool-call` **不算**"我说的话"。
 *     （`data.content` 那层是**兜底**：`skeleton.js` 的 `blocksOf()` 两种都认，这里照抄同一把尺子。）
 *
 * ⚠️ 实测里**有些 `assistant/message` 一个 `text` 块都没有**（只有 reasoning ＋ tool-call）——
 *    所以不是"取最后一条"，而是**倒着找最后一条有正文的**；一条都没有 → 返回 `''`（沉默）。
 */
export function lastAssistantText(agent) {
  try {
    const evs = agent?.session?.events
    if (!Array.isArray(evs)) return ''
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i]
      if (ev?.type !== 'assistant/message') continue
      const d = ev?.data ?? {}
      const msg = d.message && typeof d.message === 'object' ? d.message : d
      const c = Array.isArray(msg?.content) ? msg.content : []
      const t = c
        .filter((b) => String(b?.type ?? '') === 'text')
        .map((b) => (typeof b?.text === 'string' ? b.text : ''))
        .join('')
      if (t.trim().length > 0) return t
    }
  } catch {
    /* 拿不到就当没宣称 */
  }
  return ''
}

export function closeGate(state, agent) {
  state.closedAt = Date.now()
  // 🔴 2026-10-15：`lastT` / `lastE` 两个基线**删除** —— 只有退役的 G1 读它们（`countT()` 恒 -1）。
  // 🔴 2026-10-15：`lastEHash` 这个基线删除 —— 只有退役的 G1 读它（`eventTableHash()` 也删了）。
  delete state.deny
  saveGateState(state)
  // ---- 「这一轮伸了几次手」（2026-09-20 加 · 判据见《总账》R30）----
  // 为什么挂在收工这一刻：这里是**每回合必到的那个点**（与上面那条"干活统计"同一个理由）。
  // 只观测、不拦人：拦人是那几道门的事；这里只让"次数"在日志里现形（≥8 次才吱声，免得成废话）。
  try {
    const n = toolCallsThisTurn()
    if (n >= 8) {
      // 「伸了几次手」= 这一轮把整个上下文重发了几遍。见《总账》R30。
      log(`本轮工具调用 ${n} 次（≈ 整个上下文重发 ${n} 遍）—— 下次能并行的别串行`)
      capTick('F30', `本轮 ${n} 次调用`)
    }
    // ---- F31 输出端的门（2026-09-20 加 · **第一版只出声、不拦**）----
    // 判据与来由见本文件上面 F31 那一段（`claimVerdict`）。这里是**唯一的调用点**：
    // 收工通过那一刻 —— 与"数工具调用次数"同一个点（都是每回合必到）。
    // 🔴 必须在 `resetToolCalls()` **之前**读 —— 清零会把"这一轮调过哪些工具"一起抹掉。
    try {
      const warn = claimVerdict(lastAssistantText(agent), wroteThisTurn())
      if (warn) {
        log(warn)
        capTick('F31', '声称已做但本回合无写操作')
      }
    } catch (e) {
      // fail-open：这是启发式判据，坏了绝不许影响收工（它本来就不拦人）
      log(`F31 判据出错（放行，只出声）: ${e}`)
    }
  } catch {
    /* 计数坏了不许影响闸门 */
  } finally {
    // 🔴🔴 2026-09-20 深夜（第二版）：**不再在这里无条件清零**。
    //    真机实测 `agent/turn-stopping` **在回合中途就会触发**（21:53:36 那次我正干到一半），
    //    一触发就清零 → "每回合 10 次"变成"每两步 10 次"，**形同虚设**。
    //    清零改挂到**用户消息边界**上（`lib/f30-toolgate.js` 的 `noteToolCall()` → `maybeNewTurn()`）。
    //    兜底：**只有看不见用户消息时**才退回旧做法 —— 宁可额度形同虚设，也绝不把自己锁死。
    try {
      if (!turnKeyNow()) resetToolCalls()
    } catch {
      /* 同上 */
    }
  }
}

/** 注册 F7 的钩子：agent/turn-stopping。 */
export function registerF7(ctx) {
  // 自测（2026-09-16 18:17）已验通 steer 这条路，自测钩子已完成使命、这里换成正式闸门。
  try {
    ctx.on('agent/turn-stopping', ({ agent }) => {
      try {
        if (isSubagent(agent)) return

        // ---- 干活统计（2026-09-17 加）----
        // 为什么挂在这儿：**这是每回合必到的那个点**，而且我本来就在看这个日志。
        // 为什么只写"变化了的"：否则每回合长一行废话，日志会淹掉真正的事件。
        // 判据（照 C 路调研）：**`kind==='hook'` 的能力若整场日志里从没出现过它 → 装了等于没装**
        //   —— 与"G3 已删除"是同一条理由：看起来在跑、其实已死。
        // 注意它**不受闸门模式影响**（模式 `off` 时也照写）—— 统计是"她还活着吗"的证据。
        const capLine = capReport()
        if (capLine && capLine !== lastCapLine) {
          lastCapLine = capLine
          try {
            appendFileSync(GATE_LOG_FILE, `[${new Date().toISOString()}] [干活统计] ${capLine}\n`)
          } catch {
            /* 日志写不了不阻塞 */
          }
          log(`[干活统计] ${capLine}`, { silent: true })
        }

        // ---- L9 看门（2026-09-17 晚加 · 用户："L9 岂不是真的堆得很大 / 我不想造成污染"）----
        // 挂在收尾这个点上：**一天最多清一次**（`f19-tmpwatch.js` 里自己按 12 小时节流），
        // 只回收 L9 里那几种"快照目录"，且**走回收站**（可复原）；失败只记日志、继续堆着。
        try {
          const r = maybeCleanL9()
          if (!r.skipped && r.dropped > 0) gateLog(`L9 看门：回收 ${r.dropped} 个快照（${r.droppedMb} MB）→ 回收站`)
        } catch (e) {
          gateLog(`L9 看门出错（放行）：${e}`)
        }

        // ---- verified 清理（2026-09-20 · E165）----
        // 0 候选留底在 `~/.dsh/memoria/memoria-dumps/verified\` 躺满保留期（默认 3 天）后，在这里被清掉
        // （**6 小时最多一次**，由 F29 自己节流）。到期前**一个都不动** —— 那几天正是"漏了还能捞"的窗口。
        try {
          const r = maybeCleanVerified()
          if (!r.skipped && r.dropped > 0) gateLog(`verified 清理：${r.dropped} 份 0 候选留底已过保留期 → 清掉（清单在 ~/.dsh）`)
        } catch (e) {
          gateLog(`verified 清理出错（放行）：${e}`)
        }

        const mode = gateMode()
        if (mode !== 'observe' && mode !== 'enforce') return // 'off' / 空 → 不工作
        const st = loadGateState()
        const v = gateVerdict(st)

        // 🔴 **2026-10-16**：`gateVerdict()` 在**工地馆 / 别馆**里会**故意返回 `null`**（"只提醒、不给判定"，
        //   日志它自己那段已经记过了）⇒ 这里**必须当场收口**，不能裸读 `v.ok` / `v.text` / `v.id`。
        //   ⚠️ 2026-10-12 那次**只修了半边**（顶层 `v.ok` → `v?.ok`）：`v?.ok` 是 undefined ⇒ 不 return
        //   ⇒ 继续往下走，后面几处裸读 `v.text` 的照样炸。实测症状：
        //   `TypeError: Cannot read properties of null (reading 'id')`，**紧跟在 `🏗 工地馆 · 闸门只提醒不拦` 之后**。
        //   危害不是"漏拦"（那种 mode 本来就不拦），而是**护栏报错被当成正常放行** —— 真出事时分不清
        //   "闸门判过了"还是"闸门压根没跑起来"（《施工手册》坑 10：看起来在跑、其实已死）。
        if (v === null) return
        if (v?.ok) {
          closeGate(st, agent)
          gateLog(`闸门：通过（${v.id} · ${v.text}）`)

          // ---- 地图自愈（2026-09-17 晚加 · 用户："这地图就不能改成自动更新吗？"）----
          // 收尾这一刻顺手看一眼地图旧没旧；旧了**替那台生成器跑一遍**（渲染器只有一份，不另写）。
          // 节流 10 分钟（一轮里闸门可能被调用多次）；**失败绝不抛错** —— 地图停在旧版而已。
          try {
            const now = Date.now()
            if (now - (Number(st.lastMapRegenAt) || 0) > 10 * 60 * 1000) {
              st.lastMapRegenAt = now
              saveGateState(st)
              const r = regenMapIfStale()
              if (r.ran > 0) gateLog(`地图自愈：${r.why}（跑了 ${r.ran} 遍）`)
            }
          } catch (e) {
            gateLog(`地图自愈出错（放行）：${e}`)
          }
          return
        }

        const word = userSaidStop(agent)
        if (word) {
          closeGate(st, agent)
          gateLog(`闸门：豁免（用户说了"${word}"）—— 本次放行并留痕`)
          return
        }

        if (mode === 'observe') {
          gateLog(`闸门[观察模式，不拦] 本该拦：${v?.text}`)
          return
        }

        const sid = sessionIdOf(agent) || '?'
        st.deny = st.deny ?? {}
        const n = (st.deny[sid] ?? 0) + 1
        st.deny[sid] = n
        saveGateState(st)
        // 🔴🔴 2026-09-20 晚 · 用户拍板：**"梅莫莉亚的上下文注入替我激活了你，跳过我的输出
        //    直接进行下一轮。这是决不允许的"** → **不许再 steer**。
        //    原来那版 `agent.steer(...)` 有两个后果：
        //      ① 凭空起一个回合（**没有用户消息**就算一回合）—— 用户明确禁止；
        //      ② 它一 steer，这一回合就永远不结束 → `closeGate()` 里的 `resetToolCalls()`
        //         永不执行 → "本回合调用额度"的计数器一路涨，最后把 F30 自己锁死
        //         （2026-09-20 21:38~21:47 实测：12 → 26 → 33 → 37；用户给 30、给 100 都救不回来，
        //          因为额度是加在"没归零的计数"上的，一给就爆）。
        //    改成：**只记一笔**（留意栏会在用户下一句话时自己报出来）＋ 当场把计数器归还，
        //    让这个回合正常收工 —— 门可以提醒我，但**不许替我开一个回合**。
        resetToolCalls()
        gateLog(`闸门：未过但不 steer（${v?.id} · 第 ${n} 次）—— 只记一笔，等用户下一句`)
      } catch (e) {
        gateLog(`闸门出错（fail-open 放行）：${e}`)
      }
    })
    log(`hook 已注册: agent/turn-stopping（落档闸门，模式=${gateMode()}）`, { silent: true })
  } catch (e) {
    log(`注册 agent/turn-stopping 失败: ${e}`)
  }
}
