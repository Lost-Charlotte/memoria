// ============================================================
// F26 · 留意栏（"现在有什么要留意"，**每轮最多说一次；干净就不说话**）—— 2026-09-18 建
// ============================================================
//
// 起因（用户 2026-09-18 原话）：
//   "**我需要你给梅莫莉亚减重。现在她每轮需要你做的事情太多了。我希望大部分可以实现自动化的都自动化，
//    减少打扰你的次数。**"
//
// 病根**不是**"门拦得太狠"——实测：历史上闸门只真拦过 **4 次，全是 G2**，G3（事件收尾）一次都没拦过。
// 真正的重是**搜集成本**：每轮都要 agent **主动**去查/去记同样是那几件事
// （读入口 · 列待办 · 跑体检 · 对留底 · 扫事件收尾），散在 6 个工具与 4 处注入里。
// 判断（"这件事算不算完"）本来就该留给人 —— 但"**去把它们找出来**"这一半，机器能干。
//
// 所以这一份把"现在有什么要留意"**汇总成一段**，由 F1 的 `agent/pre-step` 随注入送到眼前：
//   · **干净 → 一个字都不说**（这是唯一允许沉默的情形："干净"本身就是答案，说了只是噪音）
//   · **有留意 → 说一次**；同一内容**不重复说**（指纹不变就不说），超过 TTL 才再说一遍
//   · **压缩后重注入时清空节流** —— 上下文被揉掉了，留意栏必须重说一遍（否则等于没提醒）
//
// ⚠️ **只读**：报告全部现取（留底状态 / 体检 / 待办 / 事件收尾），**不写档案、也不写 `~/.dsh`** ——
//    节流状态只在内存里（重启就重说一次，**宁可多说，不可漏说**）。
// ⚠️ **不代替闸门**：G2/G5 照旧（用户 2026-09-18 拍板"**拦活底线不动**"）。
//    分工：**这里是"把留意摆在眼前"，那里是"真漏档了把回合拽回来"**。
// ⚠️ 不搬 F13（路径锚点）/ F14（凭据）进每轮 —— 那两件要探盘/扫全文，代价高；
//    它们仍旧只在**启动自检**与 `dangan_check` 里出声，够用。

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { CFG, L4_ARCHIVE_MARKS, capTick, log, nowCN, stampDrift, writeHealth } from './common.js'
// 🔴 F34 考勤（2026-09-26）：各能力"僵了就喊"那一行由这里出声 ——
//    理由：它自己不吭声时**必须由还活着的能力来念**（用户说的"没出声这个能力也出声"）。
import { watchdogLine, watchdogPing } from './f34-watchdog.js'
import { checkArchiveCached } from './f5-check.js'
import { t } from './texts.js'
import { dueTodoItems, openItems, todoStaleCandidates } from './f10-todo.js'
import { TODO_PASS_ALERT, overPassedTodos, todoPassKey } from './f18-closing.js'
// 🔴 2026-10-15：`blockersResolved` / `notBlockedPending` 随 G3 事件收尾一起退役（事件表随 L2 删了）。
import { dumpNotice } from './f22-compact-dump.js'
import { verifiedBacklogLine } from './f29-verified.js'
import { projectStaleCandidates } from './f35-project.js'
// ⚠️ 2026-09-20：**油表与"今日花销预警"都从留意栏撤了** —— 花销现在只是个读数，出口在 `dangan_status`
//    （见本文件 ⑥ 那段注释；F28 里那两个函数留在原地：油表待窗口能拿到时复活、`spendLine` 给状态面板用）。

/** 同一份留意栏多久可以**再说一遍**（内容没变的时候）。 */
export const BACKLOG_TTL_MS = 30 * 60 * 1000

/**
 * 体检缓存时长 —— **实现与常量都已搬到 `f5-check.js`**（2026-09-19）。
 * 为什么搬：缓存属于"体检"这件事，而**闸门 G2 与这里必须共用同一份** ——
 * 原先闸门每回合自己整扫一遍 1.39 MB，留意栏又另存一份 5 分钟 TTL，
 * 两边判据还不一样（那边只看时间，**档案被改坏要等最多 5 分钟才出声**）。
 * 这里保留这个 export 只为不打断老的引用路径（与 `countT`/`countE` 从 f7 搬走时同一处理）。
 */
export { CHECK_CACHE_MS } from './f5-check.js'

/** 每个会话的节流状态：sid → {key, at}。**只在内存里**。 */
const spoken = new Map()

/**
 * 节流指纹用的归一化：**算指纹前先把数字抹成 `N`**（2026-09-19，治"每步刷屏"的兜底那一层）。
 *
 * 🔴 为什么：节流的判据是"**同一内容不重复说**"，可留意栏里天然夹着**每步都在变的数字**
 *   （油表读数、体检计数、待办条数、日期）。原来拿原文直接 `sha1` → 每步都算出"新指纹"
 *   → **节流形同虚设**（实测一个会话刷了 **39 次 / 19503 字符**，每个 step 一条 300 字符）。
 *   抹掉数字后，"① 条数/读数变了 ② 陈述本身变了"仍会换指纹 → 照样立刻说；
 *   只有**纯数字抖动**不再进对话。
 * ⚠️ 这一层**与 F28 的分档是两件事，都要留**：
 *   · `f28-fuel.js` 治**源头**（同一档位内不再返回那一行，因为"又说又什么都不说"做不到）；
 *   · 这里治**兜底**（别的留意项以后也可能长出会变的数字）。
 *   别看到 F28 改好了就把这层删掉 —— 那正是"修了一处、静默失效换一处复活"的老路。
 */
function normalizeForThrottle(body) {
  return String(body).replace(/\d+/g, 'N')
}

export function resetBacklogThrottle(sid = null) {
  if (sid === null) spoken.clear()
  else spoken.delete(sid)
  // ⚠️ 到点提醒的"念过没"也一起清 —— 压缩后上下文真被甩掉了，该重念一遍（宁可多说）。
  //    这里**整份清**而不是按 sid：Set 的 key 是 `sid｜条目文本`，按 sid 建索引不值当，
  //    而它本来就小（每条到期项一个）。
  dueSpoken.clear()
}

/**
 * 体检错/提示数 —— 与 `dangan_check` / 闸门 G2 **同一个 `checkArchiveCached()`**，不另算一套。
 * ⚠️ 缓存判据是"**档案变没变**"（指纹）而不是"过了几分钟"，所以"我刚把档案改坏"**下一轮就报**。
 */
export function checkCounts(now = Date.now()) {
  let list
  try {
    const r = checkArchiveCached(now)
    list = Array.isArray(r) ? r : (r?.problems ?? [])
  } catch (e) {
    // 读不到就说读不到 —— 别把"没查成"说成"0 条"（"沉默 ≠ 正常"）
    return { at: now, errs: -1, tips: -1, first: `读不到（${e && e.message ? e.message : e}）` }
  }
  const errs = list.filter((x) => x && x.lv === '错')
  const tips = list.filter((x) => x && x.lv === '提示')
  const f = errs[0]
  return {
    at: now,
    errs: errs.length,
    tips: tips.length,
    first: f ? `${f.file}${f.line ? `:${f.line}` : ''} · ${f.msg}` : '',
  }
}

/**
 * 已经念过的「到点提醒」项（`sid｜条目文本`）。**只在内存里**。
 *
 * 🔴 **2026-09-19 深夜加，治一个把用户点着的事**：到点提醒是**一次性**的东西，可它原来
 *   **没有任何"说过就不再念"的记忆** —— 而留意栏的节流是按**整段正文**算指纹的，
 *   别处一变（油表读数、体检计数、待办条数）整段指纹就变，它又跟着重念一遍。
 *   实测后果：用户看到的是"**它在每一轮把同一件事重新推给我**"，一晚上 166 条注入。
 *   现在**每条到期项每个会话只念一次**；清空节流（压缩后）会连它一起清掉 —— 那时上下文
 *   真被甩掉了，重念一次是对的（"宁可多说，不可漏说"）。
 */
const dueSpoken = new Set()

/**
 * 🗂 **L4 里标了"可以归档"、但还没归档的份数**（2026-10-20 加）。
 * 判据**只有一处**：`common.js` 的 `L4_ARCHIVE_MARKS`（`tools/施工层归档.mjs` 用同一份）。
 * ⚠️ **只数、不搬** —— 归档要改全档引用，那是 `施工层归档.mjs` 的活，`--apply` 仍要人点头。
 * 为什么要它：从前"改了文件名却忘了跑脚本"**没有任何东西会告诉你漏了**。
 */
function stagedPendingCount() {
  try {
    const l4 = join(CFG.archiveDir, 'L4-施工')
    if (!existsSync(l4)) return 0
    let n = 0
    for (const f of readdirSync(l4)) {
      if (L4_ARCHIVE_MARKS.some((m) => String(f).includes(m))) n += 1
    }
    return n
  } catch {
    return 0
  }
}

/**
 * 现在有什么要留意 —— 每一类一行，**没有的那类不出现**。
 * @param {number} now
 * @param {string|null} sid 会话（到点提醒的"只念一次"按会话记；不传就退化成不记）
 * @returns {string[]} 空数组 ＝ 干净
 */
export function backlogLines(now = Date.now(), sid = null, dry = false) {
  // ⚠️ `dry=true` ＝ **只算不记**（2026-09-20）：只跳过下面那处 `dueSpoken.add`（到点提醒的"念过没"），
  //    其余一模一样。给 F1 的探针用 —— 见 `peekBacklog()`。
  //    🔴 漏了它，"探一下本来会不会说话"就会把那条 ⏰ 到点提醒**静默吞掉**（探针必须无副作用）。
  const lines = []
  const safe = (fn, label) => {
    try {
      return fn()
    } catch (e) {
      lines.push(t('f26.readFail', { label, msg: e && e.message ? e.message : e }))
      return null
    }
  }

  // ① 留底（F22/F23）—— 含"补完没有"的**机器对账**（这是原先最重的一件：要读 17 万字原文）
  const dn = safe(() => dumpNotice(), '留底')
  if (dn && dn.count > 0 && dn.compact) lines.push(`  ${dn.compact}`)

  // ①之二 ⏳ **0 候选留底到了保留期还没抽检**（2026-09-20 第三代 · F29 / E165）
  //     ⚠️ 平时**一个字都不说** —— E165 定的是"0 候选不进留意栏"；这里只在"**保留期到了、
  //     它还在**"那一刻出声，因为那正是该抽 1 份核一核的时候（说完这一次，清理就把它带走了）。
  const vf = safe(() => verifiedBacklogLine(), 'verified 抽检提醒')
  if (vf) lines.push(vf)

  // ② 体检（F5）
  const cc = safe(() => checkCounts(now), '体检')
  if (cc && cc.errs !== 0) {
    lines.push(
      cc.errs < 0
        ? t('f26.check.noRead')
        : t('f26.check.errs', { errs: cc.errs, first: cc.first }) + (cc.tips > 0 ? t('f26.check.tips', { tips: cc.tips }) : ''),
    )
  }

  // ③ 待办（F10/F18）—— 只报"还开着几条"与"过了几遍仍未动"，不把整张表塞进每轮注入
  // ⚠️ `openItems()` 返回的是 `{file, items}`（**不是数组**）—— 2026-09-18 第一版就写错了，
  //    于是待办这一类**永远不出现在留意栏里**（还静默）：真档案一跑，"待办那行没了"才看出来。
  //    这里改成取出 `.items`，并且**文件找不到时也如实报**（"找不到待办文件" ≠ "没有欠办"）。
  const oi = safe(() => openItems(), '待办')
  const items = oi && Array.isArray(oi.items) ? oi.items : []
  if (oi && !oi.file) {
    lines.push(t('f26.todo.noFile'))
  } else if (items.length > 0) {
    // 🔴 2026-09-25：把「当前表里还开着的键」一并传进去 —— 销掉的条目不再被留意栏念
    //    （用户实测：已归档的「第 N 行」「本机实现件备份改名」还在被念）。**只过滤、不动账本**。
    const over =
      safe(() => overPassedTodos(TODO_PASS_ALERT, openItems().items.map((x) => todoPassKey(x.item))), '待办过遍计数') ?? []
    lines.push(
      t('f26.todo.open', { n: items.length }) +
        (over.length > 0
          ? t('f26.todo.over', {
              n: over.length,
              pass: TODO_PASS_ALERT,
              items: over.slice(0, 3).map((x) => `「${String(x.item).slice(0, 24)}」`).join(' '),
            })
          : ''),
    )
  }

  // ③·五 ⚠️ **装载的代码不是磁盘那份**（2026-10-20 加）—— 改完代码没重启时最常见的一句话。
  //     判据用现成的 `stampDrift()`（`dangan_status` 里那条"磁盘与装载不一致"同源），内容不变就不说。
  const drift = safe(() => stampDrift(), '装载指纹')
  if (drift) {
    lines.push(`  ⚠️ **装载的代码不是磁盘那份** —— 装载 ${drift.loaded} · 磁盘 ${drift.disk} ⇒ 改的还没生效，要重启控制台`)
  }

  // ③·六 🧹 **机器挑出的"该消的"**（2026-10-20 加）—— 只报数，**不删**。
  //     判据是现成的（`dangan_todo check` 那四路），这里只是让它别等人主动去查。
  const stTodo = safe(() => todoStaleCandidates().length, '待办该消的') ?? 0
  const stProj = safe(() => projectStaleCandidates().length, '工程该消的') ?? 0
  if (stTodo + stProj > 0) {
    lines.push(
      `  🧹 机器挑出 **${stTodo + stProj}** 条"该消的"（待办 ${stTodo} / 工程 ${stProj}）—— ` +
        '清不清你定；`dangan_todo clean` 只移"你自己标了 ✅/🔚"的那些（有快照可回滚）',
    )
  }

  // ④ 事件收尾（F18）：🔴 2026-10-15 退役删除（它读的事件表随 L2 删了 ⇒ 恒空，这条留意永远不会有）。

  // ③·七 🗂 **L4 里标了"已办完／已作废"但还没归档**（2026-10-20 加）——
  //     从前这里只有"我记得跑那个脚本"一个扳机：忘了改名＝永远不归档；改了名忘了跑＝烂在 L4、没人说。
  const staged = safe(() => stagedPendingCount(), '施工件归档') ?? 0
  if (staged > 0) {
    lines.push(
      `  🗂 **L4 有 ${staged} 份标了「已办完／已作废」但还没归档** —— 跑 \`node tools/施工层归档.mjs\`（默认只出提案，\`--apply\` 才真搬）`,
    )
  }

  // ⑤ ⏰ **到点提醒**（2026-09-19 加，用户要求："9/19 下午 4 点过后提醒我让你自查"）
  //    待办文本里带 `⏰ <日期 时间>` 的条目，**到点了就点名念一句**；没到点、没带标记的，
  //    一个字都不说（同"干净就沉默"）。⚠️ 判据**只有一处**：`f10-todo.js` 的 `parseDueAt()`。
  const due = safe(() => dueTodoItems(now), '到点提醒')
  const dueItems = due && Array.isArray(due.items) ? due.items : []
  // 🔴 **只念没念过的**（每条每个会话一次）—— 理由见 `dueSpoken` 那段注释。
  //    `sid` 拿不到时就退化成"照旧每轮都说"（宁可吵，不可把该提醒的吞掉）。
  const dueFresh = sid
    ? dueItems.filter((x) => !dueSpoken.has(`${sid}｜${String(x.item ?? '')}`))
    : dueItems
  if (dueFresh.length > 0) {
    if (sid && !dry) for (const x of dueFresh) dueSpoken.add(`${sid}｜${String(x.item ?? '')}`)
    lines.push(
      t('f26.todo.due', {
        n: dueFresh.length,
        items: dueFresh
          .slice(0, 3)
          .map((x) => `「${String(x.item).slice(0, 30)}」`)
          .join(' '),
      }),
    )
  }

  // ⑥ ⛽/💰 **这里原来挂"会话油表"、后来改挂"今日花销预警"** —— 2026-09-20 用户定**两条都撤**：
  //    · 油表：窗口取不到（`window = 0`），算不出"离压缩线还剩多少"，没用了；
  //    · 今日花销：用户要的是"**只单纯方便你知道用了多少钱**"—— **不报警、不警告**
  //      （原话："那十五块总量的那个表已经没有存在意义了…不用报警或者警告了"）。
  //      ⚠️ 2026-09-20 深夜补注：当年写的理由是"每轮工作已经被计价门卫（第 9 关）管着"——
  //      **那个理由已作废**（第 9 关取消拦人，见 E208）；**理由变了，结论没变**：
  //    → 它仍然只是**一个读数**，出口在 `dangan_status`（要看才查），**不进每轮注入**。

  // ⑦ 🐕 **考勤**（F34 · 2026-09-26 加）：哪个"该每步露面"的能力连着几步没露面。
  //    · **全好 → `watchdogLine()` 返回空串，一个字都不说**（沉默是默认）；
  //    · 真僵了 → 出一行；同一份内容**这小时只念一次**（`watchdogPing`，内容变了立刻再念）。
  //    ⚠️ 它**不写档案**、也不新增注入点 —— 就是留意栏里的一行（用户要的"异常才出声"）。
  try {
    const wl = watchdogLine()
    if (wl && watchdogPing(wl)) lines.push(wl)
  } catch (e) {
    log(`考勤（F34）出账失败（不影响留意栏）: ${e}`, { silent: true })
  }

  return lines
}

/**
 * 该不该现在说、说什么。**空字符串＝不说**（干净，或同一内容刚刚说过）。
 *
 * 节流**按会话**记（`sid`）：换个会话、或重启进程，都会重说一遍 —— 宁可多说，不可漏说。
 */
export function backlogText(sid = null, now = Date.now()) {
  try {
    // 🔴 2026-09-26 修：**算过就记一笔**（哪怕结论是"干净、一个字不说"）—— 与 F1 同一条道理。
    //    考勤问"这一轮它还动没动"，原来只在"真说了"那一步自报，于是"干净"被算成"僵"。
    capTick('F26', '算过')
    const lines = backlogLines(now, sid)
    // 🛡 **2026-10-22（机器闭环 · 第二步）**：把"欠不欠"写成机读状态给安全总监看。
    //    ⚠️ 只**转写**已经算出来的 `lines`，不新加扫描；写失败也不许影响留意栏本身。
    try {
      writeHealth('F26', lines.length === 0, lines.length === 0 ? '没有要留意的事' : `${lines.length} 类要留意`)
    } catch {
      /* 报不上自己，不影响留意栏 */
    }
    const key0 = sid ?? 'nosid'
    if (lines.length === 0) {
      // 干净：把节流也清掉 —— 下一件留意出现时**立刻**说，不让它等 TTL
      spoken.delete(key0)
      return ''
    }
    const body = lines.join('\n')
    // 🔴 指纹按**归一化后**的正文算（数字抹成 `N`）—— 理由见 `normalizeForThrottle` 的注释。
    const key = createHash('sha1').update(normalizeForThrottle(body)).digest('hex')
    const prev = spoken.get(key0)
    if (prev && prev.key === key && now - prev.at < BACKLOG_TTL_MS) return ''
    spoken.set(key0, { key, at: now })
    if (spoken.size > 200) spoken.clear() // 防无限长；清掉只是可能重复说一次，无害
    capTick('F26', `留意栏 ${lines.length} 类`)
    return t('f26.frame', { time: nowCN(), body })
  } catch (e) {
    log(t('f26.log.buildFail', { msg: e }))
    return ''
  }
}

/**
 * **不带副作用的探针**（2026-09-20 加）—— 只回答"这一步本来会不会说话"，
 * `spoken` / `dueSpoken` / `fuelSaid` **一个都不记**。
 *
 * 给谁用：F1 在"**这一步没有真实用户消息 → 跳过注入**"那条路上自报（手册坑 5 / 三问 ③「沉默 ≠ 正常」）。
 * 姿态：**正常时一个字都不写**；只有"本该说却没说"才留一行 —— 否则它自己就变成刷屏源。
 *
 * 🔴 为什么不能直接调 `backlogText()`：它一算完就把节流指纹写进 `spoken` ——
 *    **先算后跳 ＝ 那条留意被静默吞掉**（下次得等 TTL 才说）。
 *
 * @returns {{ n: number, key: string, wouldSay: boolean }} `n`＝留意类数；`wouldSay`＝按现有节流这一步会不会说
 */
export function peekBacklog(sid = null, now = Date.now()) {
  try {
    // 🔴 2026-09-26 第二次修（**到场就记** —— 与 F1 同一条道理）：
    //    没有真实用户消息的步走的是**这条探针路**（`f1-reinject.js` 那道早退），
    //    而它**真的算了留意**、只是不写节流指纹、不刷日志。原来这种步一步都不自报，
    //    于是"每步都在动的 F26"被考勤算成"连着 N 步没露面"（假警报的真正来源）。
    capTick('F26', '探过')
    const lines = backlogLines(now, sid, true)
    if (lines.length === 0) return { n: 0, key: '', wouldSay: false }
    const key = createHash('sha1').update(normalizeForThrottle(lines.join('\n'))).digest('hex')
    const prev = spoken.get(sid ?? 'nosid')
    return { n: lines.length, key, wouldSay: !(prev && prev.key === key && now - prev.at < BACKLOG_TTL_MS) }
  } catch (e) {
    log(t('f26.log.buildFail', { msg: e }))
    return { n: 0, key: '', wouldSay: false }
  }
}

/** 启动自检：**沉默 ≠ 正常** —— 启动这一刻就把"有什么要留意"报出来（一行）。 */
export function reportF26() {
  try {
    const cc = checkCounts()
    const n = (f) => {
      try {
        const x = f()
        if (Array.isArray(x)) return x.length
        if (x && Array.isArray(x.items)) return x.items.length // `openItems()` 返回 `{file, items}`
        return 0
      } catch {
        return '?'
      }
    }
    let dumps = 0
    try {
      dumps = dumpNotice().count
    } catch {
      dumps = '?'
    }
    // 🔴 2026-10-15：事件那一路随 G3 退役删除（它读的事件表随 L2 删了 ⇒ 恒 0，每轮白算一遍）。
    const todo = n(openItems)
    const errs = cc.errs < 0 ? '读不到' : cc.errs
    const clean = dumps === 0 && cc.errs === 0 && todo === 0
    return clean ? t('f26.start.clean') : t('f26.start.dirty', { dumps, errs, todo })
  } catch (e) {
    return t('f26.start.fail', { msg: e && e.message ? e.message : e })
  }
}
