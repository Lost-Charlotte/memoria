// ============================================================
// F22 · 压缩留底（双份落盘 ＋ 删除当扳机）—— 2026-09-17 晚建
// ============================================================
//
// **这一份的判据全部来自用户，不是我发明的。** 原话按顺序摆在这儿（免得将来自己乱改）：
//
//   ① "改在把落档时机改到压缩前，能否预判压缩即将来临是关键因素"
//      → 查证结果：`compaction/start` 确实存在（`memoria.log` 实测 4 次），但它**没有提前量** ——
//        时序是 `start → (25 秒) → summary → end`，中间那 25 秒是 harness 自己在跑摘要，
//        **我没有 step 可动**。所以"压缩前落档"只能靠 pre-step 预判（会反复亮灯）。
//
//   ② "我觉得需要统一抄的节点。不然你已经抄写过了，后面再提醒你抄会让你脱敏。"
//      → 于是节点定在 **压缩刚结束**：必然到来 · 一次压缩只过一次 · 手上正好有刚被压掉的原文。
//        （另有一条查证撑着它：`replace` 操作**不删除原始日志记录**，只是不再进未来输入 ——
//          所以"被揉掉的原文"随时取得回来，`session.eventAt(seq)` 即可。）
//
//   ③ "这个临时文件我觉得可以在两个地方备份，当梅莫莉亚发现你已经处理完了，自动删掉另一份。
//      如果你删了然后梅莫莉亚报错，这另一份也可以给你省不少事。拦活可以在这个地方触发。
//      毕竟这个时候你已经犯错一次了。需要强制让你回归正轨。"
//      → 这就是**双份 + 删除当扳机 + 空删升级**三件事的来源。
//
// ⚠️ **2026-09-29 补注：上面这套『双份 / 删除当扳机 / 空删恢复』已整条拆掉** ——
//    现行流程＝留底**只写一份**、销账**只认提名**（挪进 `verified\`）、骨架与原文**只留最近五份**；
//    下面这些字保留只作史证，别再照它办事（权威见 `lib/f29-verified.js` 与下方那段声明）。
//
//   ④ "一般能让我聊到压缩的会话，不会一压缩就不说话了…实在不行加一个监测机制，
//      比如临时文件堆积超过多少会给你提示。" → 堆到 3 份就在注入里点名，让我念给用户听。
//
// ----
//
// 于是在做什么：
//   ① 压缩**成功落地**那一刻，把「被压掉的那段原文」写**两份**（**两份都在档案外** · 2026-09-17 深夜改）：
//        · **主份** → `~/.dsh/memoria-dumps/pending/压缩留底-<会话>.md`（**我删它 ＝ 销账**）
//        · **备份份** → `~/.dsh/memoria-dumps/backup/压缩留底-<会话>.md`（空删时它必然还在）
//      头一行记「压缩前最后一条 T 号」—— 那是②对账的基准。
//      ⚠️ 主份原来放 `档案\L6-工具临时\`（为了"我看得见"）；用户提议"**临时文件是不是可以换个储藏**"后搬出来：
//         档案是用户的历史与规则，临时留底不该混进去 —— 而"我看得见"靠的是**注入亮灯里那个路径**，不靠它在档案目录里。
//   ② **删除当扳机**：我不需要学任何新动作，**唯一要做的就是"处理完 → 把主份删掉"**（这本就是我的性子）。
//        · 主份消失 ＋ T 号前进 → **销账**：插件自动把它收走
//          ⚠️ **2026-09-23 起口径变了**：销账 ＝ **挪进 `verified\`**（**不是删掉** —— 那里只留最近五份后才真删，
//             见下方 `DUMP_PENDING_DIR` 的注释与 `f29-verified.js`）。本节原来写"插件自动删掉备份份"
//             **已过时**（2026-09-29 修正 —— 属 R26 那一族：改了做法、没同步讲它的地方）。
//        · 主份消失 ＋ T 号没前进 → **空删**：从备份份恢复主份 ＋ 报警 ＋ 交给闸门（拦到补完）
//   ③ 未销账期间，每轮在注入里**亮着**一行（不靠我记性）。
//
// ⚠️ 三条自我约束：
//   · **插件对档案仍然只读** —— 留底写的是 `~/.dsh`，**一个字都不进档案**（L1/L2/L3/L9 全都不进）；
//   · **全程 fail-open** —— 任何一步出错只记日志、放行，绝不打断回合、绝不影响压缩本身；
//   · **不许静默** —— 截断 / 恢复 / 销账 / 空删，每一件都留痕（`memoria.log` ＋ `memoria-dump.log`）。
//
// 📌 为什么 F22 自己**不数 T**：数 T 的活归 `common.countT()`（从 f7 搬过去的那一份，唯一实现）。
//    对账由**闸门**调 `dumpVerdict(当前T)`（它手上有 T）—— 这样既没有第二份计数，也不会有循环 import。

import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CFG, HOME_DIR, capTick, findByName, isDumpName, log, normPath, nowCN, parseDumpName, readTextSafe, shortSid } from './common.js'
import { VERIFIED_KEEP_COUNT, VERIFIED_KEEP_DAYS, moveToVerified, noteJudged, noteNamed } from './f29-verified.js'
import { factLine, isCandidate, reconcileSkeleton } from './reconcile.js'
import { digestFileName, pruneSkeletonDir, skeletonDir, skeletonFileName, writeSkeleton } from './skeleton.js'

/** 留底文件的**总字符安全上限**（3 MB）。写盘不占注入额度，但内存里拼字符串要有个头。超了**截断并明说**。 */
export const MAX_DUMP_CHARS = 3000000

/** 堆到几份就在注入里点名（用户 ④：让我把这句念给他听）。 */
export const DUMP_PILE_LIMIT = 3

export const DUMP_BASE = join(HOME_DIR, 'memoria-dumps')

/**
 * **本馆的标识**（留底的"馆归属"）—— 用规范化后的档案根（`normPath` 是唯一那把尺子）。
 *
 * 🔴 **2026-10-07 加（多馆支持 · 切馆那条路补的最后一块）**：留底/骨架/状态表都在
 *    `~/.dsh/memoria/memoria-dumps\`（**不分馆**，因为留底属于**会话**、而会话 id 本来就唯一），
 *    但**"账"必须分馆数** —— 否则切到新馆后，留意栏会把**旧馆会话的留底**念给新馆的我，
 *    而我在新馆**根本核不了那些账**（那些事不在这个馆的档案里）。
 *
 * ⚠️ **没有 `archive` 字段的老记录**：由 `auditDumpState()` 在启动那一刻**认到当前馆**
 *    （它们在"还没有多馆"的时期产生，就是当前这个馆的）。
 */
export const arcKey = (dir = CFG.archiveDir) => normPath(dir)
/** 留底目录（**销账 ＝ 被挪进 `verified\`**，不是被删 —— 2026-09-23 起）。 */
export const DUMP_PENDING_DIR = join(DUMP_BASE, 'pending')
export const DUMP_STATE = join(HOME_DIR, 'memoria-dump.state.json')
export const DUMP_LOG_FILE = join(HOME_DIR, 'memoria-dump.log')

/**
 * 留底放哪：**两份都放在档案外**（2026-09-17 深夜改 · 用户提议"临时文件是不是可以换个储藏"）。
 *
 * 三条理由：
 *   ① 档案是用户的历史与规则，**临时留底不该混进去** —— 全文留底可能上百 MB，会让"档案该多大"这件事失控；
 *   ② **"我看得见"靠的是注入亮灯里那个路径**，不靠它在档案目录里 —— 搬到 `~/.dsh` 我照样读得到；
 *   ③ `~/.dsh` 本来就是梅莫莉亚自己状态文件的地盘（`memoria-*.json` 全在这儿）。
 *
 * ⚠️ 因此 **L9 里不再有留底** —— 那里只剩"改档工具产生的快照"与用户自己的临时文件（职责更干净）。
 */
/** 文件名按来源分：压缩路 = `压缩留底-<会话>.md`；归档路（F23）= `归档留底-<会话>.md`。 */
export const dumpFileName = (sid, kind = 'compact') =>
  `${kind === 'archive' ? '归档留底' : '压缩留底'}-${shortSid(sid)}.md`
export const mainPath = (sid, kind = 'compact') => join(DUMP_PENDING_DIR, dumpFileName(sid, kind))

/** 留底自己的日志（与 `memoria.log` 同一格式；这一份单独一份，便于回头查"哪次压缩留了什么"）。 */
export function dumpLog(msg) {
  try {
    appendFileSync(DUMP_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* 日志失败不阻塞 */
  }
  log(msg, { silent: true })
}

export function loadDumpState() {
  try {
    const s = JSON.parse(readTextSafe(DUMP_STATE))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

export function saveDumpState(s) {
  const tmp = `${DUMP_STATE}.tmp-${process.pid}`
  try {
    // 🔴 **原子写**（2026-09-23）：原来是"整份 `writeFileSync` 直接盖" —— 写到一半死掉就得到半份 JSON，
    //    而下一次 `loadDumpState()` 解析失败会**静默退回 `{}`** ⇒ 全部留底记录当场消失（那些份再也销不掉）。
    //    改成 **先写临时文件 → 再 `rename` 顶上**：同卷 rename 是原子的，看到的要么是旧的、要么是新的。
    writeFileSync(tmp, JSON.stringify(s, null, 2))
    renameSync(tmp, DUMP_STATE)
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* 清临时文件失败不影响主流程 */
    }
    dumpLog(`F22 状态存不下（对账会退化成"每次重算"）：${e}`)
  }
}

/**
 * **启动核对 `state ↔ 盘上文件`**（2026-09-23 · 讨论稿 v3-6）。
 *
 * 两个方向都查，而且**都要带处理动作**（只报不治 ＝ 死锁）：
 *   · **有记录、文件不在** → 僵尸记录（`state` 里永远清不掉、留意栏永远念它）：
 *       - 带 `verifiedAt`（已被提名销账过）→ 那份在 `verified\` 或已过保留期 ⇒ **直接清掉这条记录**
 *       - 从没销账过 → 原文只剩会话日志 ⇒ **清掉并如实报出来**（别让它烂在表里）
 *   · **有文件、没记录** → 这份永远不会被留意栏看到、也永远销不掉 ⇒ **补一条最小记录**（够留意栏报它）
 *
 * ⚠️ **fail-open**；⚠️ 它**不删任何文件** —— 只动 `state` 里那几条记录。
 * @returns {{zombieCleared:number, adopted:number, notes:string[]}}
 */
export function auditDumpState() {
  const notes = []
  let zombieCleared = 0
  let adopted = 0
  try {
    const st = loadDumpState()
    const dumps = st.dumps && typeof st.dumps === 'object' ? st.dumps : {}
    let changed = false

    // ---- 方向一：有记录、文件不在 ----
    for (const [key, d] of Object.entries(dumps)) {
      if (!d || typeof d !== 'object' || !d.mainAbs) continue
      if (existsSync(d.mainAbs)) continue
      const who = d.kind === 'archive' ? '归档留底' : '压缩留底'
      delete dumps[key]
      changed = true
      zombieCleared += 1
      notes.push(
        `${who} ${d.sidShort ?? '?'}：记录在、盘上没了 —— ` +
          (d.verifiedAt
            ? '已提名销账过（那份在 `verified\\` 或已过保留期）'
            : '**从没销账过**（原文只剩会话日志，需要时用 `dump-skeleton.mjs` 重建）')
      )
    }

    // ---- 方向二：有文件、没记录 ----
    try {
      for (const e of readdirSync(DUMP_PENDING_DIR, { withFileTypes: true })) {
        if (!e.isFile()) continue
        if (!isDumpName(e.name)) continue // 2026-09-28：认名走唯一来源（`lib/common.js`）
        const abs = join(DUMP_PENDING_DIR, e.name)
        if (Object.values(dumps).some((d) => d && d.mainAbs === abs)) continue
        const sidShort = parseDumpName(e.name)?.sidShort ?? '?' // 2026-09-28：走唯一来源（`lib/common.js`）
        const kind = e.name.startsWith('归档') ? 'archive' : 'compact'
        dumps[`${kind}:adopted-${sidShort}`] = {
          kind,
          sidShort,
          mainAbs: abs,
          // ⚠️ 2026-09-28 修：原来这里手写成 `~\.dsh\memoria-dumps\…`（少了 `memoria\` 一层）——
          //    运行数据收拢后根在 `~\.dsh\memoria\`，手写那条**每个新会话都照着它去 grep、扑空**
          //    （2026-09-28 实测：4 次 grep 全废 + 2 次 glob 找回，纯浪费）。指路一律用**现算的绝对路径**。
          relMain: abs,
          preT: NaN, // 认领来的份没有基准 —— **不许编**（何况判据已经不靠它了）
          at: new Date().toISOString(),
          chars: 0,
          items: 0,
          adopted: true,
        }
        changed = true
        adopted += 1
        notes.push(`${kind === 'archive' ? '归档留底' : '压缩留底'} ${sidShort}：盘上有、记录里没有 → 已**认领**（提醒你归账）`)
      }
    } catch {
      /* pending 目录不存在＝没有留底，正常 */
    }

    // ---- 方向三：把"还没有馆归属"的老记录**认到当前馆**（2026-10-07 加 · 多馆支持）----
    //    ⚠️ 这一步得在"**还站在老馆里**"的时候跑 —— 启动核对每次启动都跑，
    //    所以升级之后第一次启动就认对了；之后再切馆，老记录已经带着正确的馆。
    const mine = arcKey()
    for (const d of Object.values(dumps)) {
      if (!d || typeof d !== 'object' || d.archive) continue
      d.archive = mine
      changed = true
      notes.push(`留底 ${d.sidShort ?? '?'}：原来没有"馆归属" → 认到当前馆`)
    }

    if (changed) {
      st.dumps = dumps
      saveDumpState(st)
    }
  } catch (e) {
    dumpLog(`F22 启动核对出错（fail-open）：${e}`)
  }
  if (notes.length > 0) {
    dumpLog(`F22 启动核对：清了 ${zombieCleared} 条僵尸记录 · 认领 ${adopted} 份无主留底\n  · ${notes.join('\n  · ')}`)
  }
  return { zombieCleared, adopted, notes }
}

// ============================================================
// 取原文：把被 shadow 掉的那些事件渲染成可读文本
// ============================================================

/**
 * 块数组 → 正文。**递归**（2026-09-19 修）。
 *
 * 🔴 修的是"**留底里工具结果只有占位符、正文没进**"：真实的 `tool/result` 事件是
 *   `data.message.content[0] = { type:'tool-result', content:[{ type:'text', text:… }] }`
 *   —— **真正文嵌在第二层**（形状取自真会话日志实测，不是照测试样本猜）。
 *   只认顶层 `text` 时，工具结果一律渲染成 `[tool-result]` 一行 → 留底"全文"里工具输出全丢。
 *
 * 占位符规则不变（认不出的块仍留 `[<type>]`），只是**先把里面能读出的文字读出来**。
 */
function blocksText(content) {
  if (!Array.isArray(content)) return ''
  const out = []
  for (const b of content) {
    if (typeof b?.text === 'string') out.push(b.text)
    else if (Array.isArray(b?.content)) {
      const inner = blocksText(b.content)
      if (inner.trim()) out.push(inner)
      else if (b?.type) out.push(`[${b.type}]`)
    } else if (b?.type) out.push(`[${b.type}]`)
  }
  return out.join('\n')
}

/** 单条事件 → 留底片段（**F23 归档路也直接用这个**，所以导出）。 */
export function renderOne(ev) {
  const d = ev?.data ?? {}
  const t = String(ev?.type ?? '')
  const msg = d.message && typeof d.message === 'object' ? d.message : d
  const body = blocksText(msg?.content ?? d.content)
  if (!body.trim()) return ''
  const stamp = ev?.time ? ` · ${String(ev.time).slice(0, 19).replace('T', ' ')}` : ''
  if (t === 'user/message') {
    // 🔴 2026-09-28：**有 kind 且不是 `user` 才算注入**（v4 起 `plugin` 这个包装名不再出现；缺 kind 的不标 —— 宁可少标，不误伤用户的话）
    const k = d?.source?.kind
    const inj = typeof k === 'string' && k !== 'user' ? '（插件注入）' : ''
    return `## 用户${inj}${stamp}\n\n${body}\n`
  }
  if (t === 'assistant/message') return `## 我${stamp}\n\n${body}\n`
  if (t === 'tool/result') return `## 工具结果${d?.name ? `（${d.name}）` : ''}${stamp}\n\n${body}\n`
  // 系统提示词、仅日志事件（attempt / request-header / surface 操作等）不进留底 —— 它们不是"我做过的事"
  return ''
}

/**
 * 把一串事件渲染成留底正文（**压缩路 F22 与归档路 F23 共用**）。
 *
 * 🔴 **附带防静默自检**（2026-09-17 深夜加，来自用户的一个盲点：
 *   "压缩前后提取全文那套自动化，会不会也被'静默只拿到一部分'那个坑了？"）：
 *   **拿到 N 条事件、却一条都没渲染出内容** —— 这**不是"没有内容"，是"读不出来"**，
 *   必须在留底头和日志里同时出声（"沉默 ≠ 正常"）。
 *
 * @param {any[]} evs 事件数组（压缩路从内存取、归档路从日志解出来，结构一样）
 * @param {{who?:string}} [opt] `who` 只用于日志里点名是谁
 */
export function renderEvents(evs, opt = {}) {
  const list = Array.isArray(evs) ? evs : []
  let text = ''
  let truncated = false
  let rendered = 0
  for (const ev of list) {
    const piece = renderOne(ev)
    if (!piece) continue
    rendered += 1
    if (text.length + piece.length > MAX_DUMP_CHARS) {
      truncated = true
      break
    }
    text += `${piece}\n`
  }
  if (truncated) text += `\n\n…（已达 ${MAX_DUMP_CHARS} 字符上限，后面被截断 —— 全文仍在会话日志里）`

  let warn = ''
  if (list.length > 0 && text.trim().length === 0) {
    warn = `**拿到 ${list.length} 条事件、却一条都没渲染出内容**（不是"没有内容"，是"读不出来"）`
    dumpLog(`⚠️ **防静默报警**（${opt.who ?? '留底'}）：拿到 ${list.length} 条事件但渲染为空 —— 原文可能根本没取到`)
  }
  return { text, truncated, count: list.length, rendered, warn }
}

/**
 * 压缩路取原文：按 seq 取被压掉的事件。取不到就**退回全量**（宁可留多了，不可留少了），并留痕。
 * @returns {{text:string, truncated:boolean, count:number, rendered:number, warn:string, usedSeqs:boolean}}
 */
export function renderShadowed(session, seqs) {
  const evs = []
  let usedSeqs = false
  try {
    if (Array.isArray(seqs) && seqs.length > 0 && typeof session?.eventAt === 'function') {
      for (const s of seqs) {
        const ev = session.eventAt(s)
        if (ev) evs.push(ev)
      }
      usedSeqs = evs.length > 0
    }
  } catch (e) {
    dumpLog(`F22 按 seq 取事件失败（退到全量）：${e}`)
  }
  if (evs.length === 0) {
    const all = session?.events
    if (Array.isArray(all)) evs.push(...all)
    if (evs.length > 0) dumpLog(`F22 ⚠️ 没拿到 shadowedSeqs，**退回全量留底**（${evs.length} 条）—— 多留不少留`)
  }
  const r = renderEvents(evs, { who: '压缩留底' })
  // ⚠️ 把**事件本身**也带出去（2026-09-19）：骨架要按"块类型"分流，
  //    光有渲染好的文本切不开 —— `reasoning` 与 `text` 在文本里混成一片（见 `lib/skeleton.js` 头部）。
  return { ...r, usedSeqs, evs }
}

// ============================================================
// 写留底（压缩成功落地时调用）
// ============================================================

/**
 * 写留底 + 登记状态（**压缩路 F22 与归档路 F23 共用**）。
 *
 * ⚠️ 状态表的 key 是 **`<kind>:<会话id>`** —— 同一个会话可能**先压缩、后归档**，
 *    两份留底要各自留、各自销账；拿裸 sid 当 key 会互相覆盖（前一份的主份文件还在，记录却没了 → 永远销不掉）。
 *
 * 🔴 **2026-09-23 起只写一份**（原来写"主份 ＋ 备份份"两份）：备份份是**因为"我会手删留底"**才长出来的
 *    （空删时靠它恢复）。现在销账走**提名**、主份是被**挪进 `verified\`**而不是被删 ——
 *    那个前提没了，备份份就只剩"多一份要维护、还可能跟主份不一致"（讨论稿 §四）。
 */
export function persistDump(sid, body, meta = {}) {
  const kind = meta.kind === 'archive' ? 'archive' : 'compact'
  try {
    const main = mainPath(sid, kind)
    mkdirSync(dirname(main), { recursive: true })

    const st = loadDumpState()
    st.dumps = st.dumps && typeof st.dumps === 'object' ? st.dumps : {}
    const key = `${kind}:${sid}`
    const adoptedKey = `${kind}:adopted-${shortSid(sid)}`
    // 🔴 2026-10-07（对抗审查）：**认领来的那份**（启动核对补的记录，键是 `<kind>:adopted-<短id>`）
    //    只看标准键就等于"看不见它" ⇒ 接写时把它整个盖掉，而它**还没被核过**。两个键都看。
    const prevKey = st.dumps[key] ? key : st.dumps[adoptedKey] ? adoptedKey : key
    const prev = st.dumps[prevKey]

    // 🔴 **2026-10-07（用户点出）：同一个会话里"上一次还没销"的那份，别盖掉它。**
    //    它承载的是"**更早被揉掉 / 被裁掉、而且还没被核过**"的原文 —— 直接盖掉 = 那段没人核
    //    （2026-10-02 实测的洞：`骨架-压缩-d66e47cc` 首条是 13:47，更早的 13:26／13:37／13:40 没了）。
    //    ⇒ 改成"**接着写**"：把旧的原样接在前面（时间顺序读起来自然），一份里就有全部段。
    //
    //    ⚠️ **为什么这不会把"已经核过的段"又拉回来**（用户 2026-10-07 特意确认过）：
    //       销账时主份已被 `moveToVerified()` **挪进 `verified/` 并从 pending 删掉**
    //       ⇒ 已经核过的那份**根本不在 pending** ⇒ 这里读不到它，自然并不进来。
    //    ⚠️ **只并 `compact`**：归档留底（`archive`）天然是"渲染**全部**事件"，同名只会是重跑 ⇒ 照旧覆盖。
    let merged = ''
    let blocked = ''
    if (kind === 'compact' && prev && existsSync(main)) {
      // ⚠️ 用现成的 `readTextSafe`（读不到回空）—— **不再自写 try/catch**：
      //    第一版写成 `readFileSync`，而本文件**没有 import 它** ⇒ ReferenceError 被那个空 `catch {}` 吞掉
      //    ⇒ **静默地不接写**（"看起来在跑、其实已死"那一族，R44 同款）。**空 catch 不许再写。**
      merged = String(readTextSafe(main) ?? '')
      // 🔴 2026-10-07（对抗审查）：文件**在**、却读不出内容（占用 / 权限 / 编码）——
      //    这时"当成没有旧的"就等于**把还没核过的旧段当场盖掉、而且一声不响**（正是 0.79.3 要防的那件事）。
      //    ⇒ **拒写 ＋ 出声**（fail-closed：宁可这一份晚一轮，也不丢段）。
      if (!merged.trim()) blocked = `旧留底在（${main}）却读不出内容 —— 拒绝覆盖（占用 / 权限 / 编码？）`
    }
    if (blocked) {
      dumpLog(`${meta.cap ?? 'F22'} ${kind} 留底**没写**：${shortSid(sid)} · ${blocked}`)
      return { ok: false, why: blocked, main, blocked: true }
    }
    const appended = !!merged.trim()
    // 🔴 2026-10-07（对抗审查）：`'a'` 追加**不幂等** —— 重放同一个压缩事件会把同一段写两遍。
    //    判据：这一段的 `seqs` 已经**全在**旧记录里 ⇒ 它就是写过的那一段 ⇒ 不重复接写（记 no-op）。
    const metaSeqs0 = Array.isArray(meta.seqs) ? meta.seqs : []
    const dup =
      appended &&
      metaSeqs0.length > 0 &&
      Array.isArray(prev?.seqs) &&
      prev.seqs.length > 0 &&
      metaSeqs0.every((s) => prev.seqs.includes(s))
    if (dup) {
      dumpLog(`F22 ${kind} 留底**没重写**（同一段已经写过）：${shortSid(sid)} · ${metaSeqs0.length} 条 seq 全命中`)
      return { ok: true, main, chars: Number(prev?.chars) || 0, kind, appended: false, dup: true, parts: Number(prev?.parts) || 1 }
    }
    const out = appended ? `${merged}\n\n---\n\n${body}` : body
    writeFileSync(main, out, 'utf8')

    const prevSeqs = appended && Array.isArray(prev?.seqs) ? prev.seqs : []
    const metaSeqs = Array.isArray(meta.seqs) && meta.seqs.length > 0 ? meta.seqs : []
    const allSeqs = [...prevSeqs, ...metaSeqs]
    st.dumps[key] = {
      kind,
      sidShort: shortSid(sid),
      // 🔴 2026-10-07 加（**留底的馆归属** · 多馆支持）：切馆之后，留意栏 / 自检只数**本馆**的留底。
      archive: arcKey(),
      mainAbs: main,
      // ⚠️ 2026-09-28 修：同上 —— 认领路与新建路都改成**现算路径**，不许手写（手写过一次，少一层目录）
      relMain: main,
      preT: Number(meta.preT),
      preL3: String(meta.preL3 ?? ''),
      at: new Date().toISOString(),
      chars: out.length,
      // ⚠️ **只在真接写时**累加（这几项描述的是"这一份里总共有多少"）——
      //    原来直接赋值 ⇒ 接写之后计数会退回最后一次的那个数（读数就成了假账）。
      // 🔴 2026-10-07（对抗审查）再收一刀：**归档路是覆盖写**（`appended` 恒 false）却照样累加
      //    ⇒ 归档重跑一次就报"2 段"、条数翻倍（假账）。⇒ 一律以 `appended` 为准。
      items: (appended ? Number(prev?.items) || 0 : 0) + (Number(meta.items) || 0),
      tokenCount: (appended ? Number(prev?.tokenCount) || 0 : 0) + (Number(meta.tokenCount) || 0),
      parts: (appended ? Number(prev?.parts) || (prev ? 1 : 0) : 0) + 1,
      truncated: !!meta.truncated || (appended && !!prev?.truncated),
      appended,
      warn: String(meta.warn ?? ''),
      source: String(meta.source ?? ''),
      // 2026-09-19：把"**哪几条被揉掉了**"存下来 —— 压缩路事后**补骨架**全靠这个坐标。
      // ⚠️ 全文（主份 ＋ 备份份 ＋ 会话日志）一个字都没丢；缺的只是"该捞哪一段"。
      //    块类型（reasoning / text）只活在日志与当时的内存里，`.md` 渲染后两者混成一片。
      // 2026-10-07：接写时**两段坐标都要留**（少一段 ⇒ 补骨架就捞不回那一段）。
      //           ⚠️ **没接写时只留本段的**（别把上一份的坐标粘到覆盖掉的新份上）。
      seqs: appended ? (allSeqs.length > 0 ? allSeqs : undefined) : metaSeqs.length > 0 ? metaSeqs : undefined,
    }
    // ⚠️ 认领那条记录**转正**：同一个文件只许有一条记录（留两条 ⇒ 留意栏会把它算成两份）。
    if (prevKey !== key) delete st.dumps[prevKey]
    st.lastAt = new Date().toISOString()
    saveDumpState(st)

    const joint = st.dumps[key].parts > 1 ? `（**接写**：这一份里现有 ${st.dumps[key].parts} 段）` : ''

    const label = kind === 'archive' ? '归档留底' : '压缩留底'
    capTick(meta.cap ?? 'F22', `${label} ${meta.items ?? 0} 条 / ${out.length} 字符`)
    dumpLog(
      `${meta.cap ?? 'F22'} ${label}已写${joint}：${shortSid(sid)} · ${meta.items ?? 0} 条 / ${out.length} 字符 · 基准 T${meta.preT}` +
        `${meta.source ? ` · 来源 ${meta.source}` : ''} · 主份 ${main}`
    )
    return { ok: true, main, chars: out.length, kind, appended, parts: st.dumps[key].parts }
  } catch (e) {
    const why = String(e && e.message ? e.message : e)
    dumpLog(`${meta.cap ?? 'F22'} 写留底失败（**不影响主流程**）：${why}`)
    return { ok: false, why }
  }
}

/**
 * 把一份留底标成「**无账可销**」—— 2026-10-07（用户拍板）。
 *
 * **它治什么**：裁剪（prune）那批留底里**没有真人对话** ⇒ **没有可核的事实**，
 *   却照旧在留意栏里念、要我读一遍（实测 2026-10-07：prune 留底 224,174 字符，骨架只渲染出 404 字符 / 0 条）。
 *
 * 🔴 **为什么判据仍然必须是机器的**：用户 2026-09-29 给裁剪加销账时的原话是
 *   「看裁剪到底有没有裁剪掉事实，**不能靠自觉**」。所以这一档不是"取消裁剪销账"，
 *   而是「**每批都由机器判**」：
 *     · **含真人对话** ⇒ 照旧走完整销账（读骨架 → 补档 → 提名）—— 口径一字不改；
 *     · **0 条对话** ⇒ 打这个标记：**不进留意栏 · 不算留底的 pending · 不用提名**，但**留痕**
 *       （启动自检里报一句"另有 N 份无账可销" —— "沉默 ≠ 正常"那条规矩）。
 * ⚠️ **不许把"裁剪只裁工具结果"当前提** —— 那是 R22 的错法（拿一次的具体情形当通则）。
 *    这里判的是**这一批**渲染出来有没有对话，不是"裁剪这个动作"的性质。
 */
export function noteNoFacts(sid, kind = 'compact', why = '') {
  try {
    const st = loadDumpState()
    const key = `${kind}:${sid}`
    const d = st.dumps?.[key]
    if (!d) return { ok: false, why: '状态表里没有这一份' }
    d.noFactsAt = new Date().toISOString()
    d.noFactsWhy = String(why || '这一批没有真人对话（用户真事 0 条 / 正式答复 0 条）')
    saveDumpState(st)
    return { ok: true }
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) }
  }
}

/**
 * 压缩路：压缩**成功落地**那一刻写留底。
 * @param {string} sid 会话 id
 * @param {any} session 会话对象（取原文用）
 * @param {{seqs?:number[], tokenCount?:number}} info `compaction/summary` 里记下的东西
 */
export function writeDump(sid, session, info) {
  const seqs = Array.isArray(info?.seqs) ? info.seqs : []
  const r = renderShadowed(session, seqs)
  // 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：**`maxT()` 已作废**（时间轴随 L2 送回收站）——
  //    不再读它，`preT` 直接记 `-1`（历史字段，头里仍写出来，但**销账判据不看它了**）。
  //    现行销账判据 ＝ 下面的 `preL3`（索引里 L3 那一节第一条的时间）。
  const preT = -1
  // 🔴 2026-10-14 加（**用户选 A**）：另记一个基准 —— **生成这一刻，索引里 L3 那一节第一条的时间**。
  //    为什么：销账判据从"T 号跨过基准"改成"**L3 有没有新记录**"（T 号其实跟"补没补完"没关系，
  //    旧判据还逼出过"空落一条档"的浪费 —— `lib/reconcile.js:11` 自己写着这件事）。
  const preL3 = l3LatestFromIndex()
  const head =
    `# 压缩留底（F22）—— 会话 ${shortSid(sid)}\n\n` +
    `- **压缩前档案写到：T${preT}**（最大号 · 历史字段 —— 🔴 **2026-09-23 起不再当销账判据**）\n` +
    `- 生成时间：${nowCN()}\n` +
    `- **基准 L3：${preL3 || '（读不到）'}**（生成这一刻，索引里 L3 那一节第一条的时间 —— 🔴 **2026-10-14 起销账判据看它**）\n` +
    `- 被揉掉：${seqs.length} 条 seq / ${Number(info?.tokenCount) || 0} token（渲染出 ${r.text.length} 字符 / ${r.rendered} 条）\n` +
    `- **怎么销账**（⏱ **先读摘要，别读这份全文** —— 每次留底都会顺带写"摘要 ＋ 骨架"两份）：\n` +
    `  ① 读摘要 \`${join(skeletonDir(), digestFileName(sid, 'compact'))}\`（只有"用户原话 ＋ 我这轮为达成什么"；见到 \`⚠ 无摘要 Lxx-Lyy\` 时**只回读那一段**）\n` +
    `  ② 照它把**还没进档案**的事补上；要查细节再 grep 骨架 \`${join(skeletonDir(), skeletonFileName(sid, 'compact'))}\`\n` +
    `  ③ 🔴 **落档时带一句 \`归账完成: ["${shortSid(sid)}"]\`** —— 事务**真写成**之后，插件自己把主份挪进 \`verified\\\`（保留 最近 ${VERIFIED_KEEP_COUNT} 份）\n` +
    `- 🔴 **不要再手删这份文件**：销账只认**提名**（2026-09-23《留底全自动销账》v3）。删了既不算"补完了"，也**没有"从备份恢复"这回事**了 —— 那条路已整条拆掉\n` +
    (r.truncated ? `- ⚠️ **本次留底被截断**（超 ${MAX_DUMP_CHARS} 字符）—— 全文以会话日志为准\n` : '') +
    (r.warn ? `- 🔴 ${r.warn}\n` : '') +
    (r.usedSeqs ? '' : `- ⚠️ 没拿到精确 seq、退回全量留底\n`) +
    `\n---\n\n`
  const body = head + (r.text.trim() ? r.text : '（⚠️ 没取到原文 —— 见运行数据目录里的 `memoria-dump.log`）')
  const res = persistDump(sid, body, {
    kind: 'compact',
    cap: 'F22',
    preT,
    preL3,
    items: seqs.length,
    tokenCount: Number(info?.tokenCount) || 0,
    truncated: r.truncated,
    warn: r.warn,
    seqs,
  })
  // 顺手写一份**骨架**（销账时读它、不读全文）—— 2026-09-19。
  // 🔴 2026-10-07（对抗审查）：模式**跟着主份的真实行为走**（`res.appended`）——
  //    主份接写了 ⇒ 骨架接写；主份是覆盖写的 ⇒ 骨架也覆盖。
  //    原来写死 `overwrite: true`（＝无条件追加）⇒ 主份覆盖时骨架还往后接＝"主份新、骨架旧"。
  // **fail-open**：骨架写不出来**不影响留底**（留底才是保命的那个），只记一行日志。
  const sk = writeSkeleton(sid, r.evs ?? [], `压缩路 · 内存里的会话（被揉掉 ${seqs.length} 条 seq）`, {
    kind: 'compact',
    mode: res.appended ? 'append' : 'replace',
    dir: skeletonDir(),
  })
  if (sk.ok) {
    dumpLog(
      `F22 骨架已写出：${sk.out}（${sk.chars} 字符 · 用户真事 ${sk.stats.userMsgs} 条 / 我的正式答复 ${sk.stats.textBlocks} 条${sk.overwritten ? ' · 覆盖' : ''}）`
    )
  } else {
    dumpLog(`F22 ⚠️ 骨架没写成（**留底不受影响**）：${sk.why}`)
  }
  // 🔴 2026-10-17：只留最近 10 份（骨架＋摘要成对）—— **还没销账的受保护**（销账要读它）。
  try {
    const st0 = loadDumpState()
    const protect = new Set(
      Object.keys(st0.dumps || {})
        .map((k) => String(k).split(':')[1] || '')
        .filter(Boolean)
        .map((s) => s.replace(/^session-/, '').slice(0, 8))
    )
    const pr = pruneSkeletonDir(skeletonDir(), 10, protect)
    if (pr.ok && pr.removed > 0) dumpLog(`F22 骨架/摘要清理：删了 ${pr.removed} 个旧派生物（保留最近 10 份）`)
  } catch (e) {
    dumpLog(`F22 ⚠️ 骨架/摘要清理没跑（不影响留底）：${e?.message ?? e}`)
  }
  // 🔴 2026-10-07（用户拍板）：骨架判出"**这一批没有真人对话**" ⇒ 给它挂「**无账可销**」标记 ——
  //    不进留意栏 · 不算留底的 pending · 不用提名（**但自检里报一行痕**）。
  //    ⚠️ 判据是**机器给的**（`renderSkeleton` 数出来的），不是"我相信裁剪只裁工具结果"（R22 的错法）。
  if (sk.skipped) {
    const nf = noteNoFacts(sid, 'compact', sk.why)
    dumpLog(`F22 ${nf.ok ? '已标「无账可销」' : '⚠️ 标「无账可销」失败'}：${shortSid(sid)} · ${sk.why}`)
  }
  // 🔴 **2026-09-20 第三代（E165）**：写底这一刻就跑**机器对账**，并定下这份该去哪 ——
  //    0 候选 → 挪 `verified\`（留意栏不再报它，只留最近五份）；有候选 → 留在 `pending\`，留意栏直接列那几条。
  //    ⚠️ 对账跑不成（骨架缺 / 解析可疑）时**一律留在 pending** —— 宁可多报，不可把它当"0 候选"放行。
  const settle = settleDump(sid, 'compact', { skeletonPath: sk.ok ? sk.out : undefined })
  return { ...res, preT, items: seqs.length, skeleton: sk, settle }
}

/**
 * **机器对账 + 定落点**（2026-09-20 第三代 · E165）—— F22（压缩路）与 F23（归档路）共用这一份。
 *
 * 做三件事：① 拿**骨架**跑 `reconcileSkeleton()`（字面比对全档 L1+L2+L3，实测 239ms）；
 * ② **0 候选** → `moveToVerified()` 把主份挪进 `~/.dsh/memoria-dumps/verified\`（只留最近五份，由 F29 清）；
 * ③ **有候选** → 把候选摘要（`factLine`）记进 state，主份**留在 `pending\`**，留意栏直接列那几条。
 *
 * 🔴 **三条一律"留在 pending"的红线**（对账工具只是筛子，不是判官 —— 2026-09-20 两轮对抗审查定的）：
 *   · 骨架缺 / 读不到 → 对账根本没跑；
 *   · `reconcileSkeleton` 返回 `ok:false`（解析出 0 条真事、或与骨架头声明条数不符）→ 这次对账**别信**；
 *   · 挪 verified 失败 → 旧的没删、原文还在，照旧报它。
 *
 * @param {string} sid 会话 id
 * @param {'compact'|'archive'} kind
 * @param {{skeletonPath?:string, archive?:any}} [opts] `archive` 是批量跑时共享的档案文本库（省掉重复扫全档）
 */
export function settleDump(sid, kind, opts = {}) {
  const key = `${kind === 'archive' ? 'archive' : 'compact'}:${sid}`
  try {
    const st = loadDumpState()
    const d = st.dumps && typeof st.dumps === 'object' ? st.dumps[key] : null
    if (!d) return { ok: false, verdict: 'unknown', why: '状态表里没有这一份（不猜）' }
    const skPath = opts.skeletonPath ?? join(skeletonDir(), skeletonFileName(sid, kind))
    const writeBack = (extra) => {
      d.reconcile = extra
      st.dumps[key] = d
      saveDumpState(st)
    }
    if (!existsSync(skPath)) {
      const why = '骨架没写出来 —— 机器对账跑不了，只能照旧读原文'
      writeBack({ at: new Date().toISOString(), ok: false, why })
      dumpLog(`F22/F23 ⚠️ 机器对账没跑（骨架缺）：${shortSid(sid)} —— 该份留在 pending、留意栏照旧报它`)
      return { ok: false, verdict: 'unknown', why }
    }
    const r = reconcileSkeleton(skPath, { archiveDir: CFG.archiveDir, archive: opts.archive })
    if (!r.ok) {
      writeBack({ at: new Date().toISOString(), ok: false, why: r.why })
      dumpLog(`F22/F23 ⚠️ 机器对账没跑成：${shortSid(sid)} —— ${r.why}（**不许当成 0 候选**，该份留在 pending）`)
      return { ok: false, verdict: 'unknown', why: r.why }
    }
    const summary = {
      at: new Date().toISOString(),
      ok: true,
      total: r.summary.total,
      covered: r.summary.ok,
      weak: r.summary.weak,
      miss: r.summary.miss,
      docs: r.scannedDocs,
    }
    const rawCands = r.facts.filter((f) => f.verdict !== 'ok')
    // 候选池过滤（2026-09-23 · v3-7）：短句 / 纯标点 / 与上一条重复 → **不摆给人看**。
    // 🔴 但它**只影响"显示"，一个字都不动"裁决"** —— 下面的 0 候选分支会**把主份挪进 verified**
    //    （＝宣告"机器说都进档了"）。若拿过滤后的数去裁决，一堆短句就会把"有候选"伪装成"0 候选"，
    //    正好踩中讨论稿自己那条红线（"宁可多报，不可当 0 候选放行"）。所以裁决一律用 `rawCands`。
    const cands = []
    let prevFact = null
    for (const f of rawCands) {
      if (isCandidate(f, prevFact)) cands.push(factLine(f))
      prevFact = f
    }
    // 累计"裁决过几份 / 其中 0 候选几份" —— 让"verified 0 份"分得清"真没有"与"机制坏了"
    // （用户 2026-09-23："不要让他静默失效"；详见 `lib/f29-verified.js` 的 `bumpVerifiedCounter`）。
    noteJudged(rawCands.length === 0)
    if (rawCands.length === 0) {
      const mv = moveToVerified({ ...d, _key: key })
      if (mv.ok) {
        d.verifiedAt = new Date().toISOString()
        d.verifiedAbs = mv.to
        d.expiresYmd = mv.expiresYmd
        delete d.candidates
        writeBack(summary)
        dumpLog(
          `F22/F23 ✅ 机器对账 **0 候选**（真事 ${r.summary.total} 条都在档）→ 已挪入 verified（保留至 ${mv.expiresYmd}，最近 ${VERIFIED_KEEP_COUNT} 份）：${shortSid(sid)}`
        )
        return { ok: true, verdict: 'verified', moved: mv.to, summary }
      }
      writeBack({ ...summary, why: `挪 verified 失败：${mv.why}` })
      dumpLog(`F22/F23 ⚠️ 挪 verified 失败（**该份留在 pending**）：${shortSid(sid)} —— ${mv.why}`)
      return { ok: false, verdict: 'pending', why: mv.why, summary }
    }
    // 🔴 2026-10-19（用户点出"缺口 5 条"其实是被截断的）：**全量数另存一份**。
    //    以前 state 只存 `slice(0,5)`，留意栏拿它当"缺口总数" ⇒ 真实 81 条会报成"5 条"，
    //    看的人以为只要核 5 条（当天实测就为此白核了一轮）。**state 里仍只留前 5 条**（省体积），
    //    但"缺口 N 条"一律报全量（`candidatesTotal`）。
    d.candidates = cands.slice(0, 5)
    d.candidatesTotal = cands.length
    writeBack(summary)
    dumpLog(
      `F22/F23 机器对账：${shortSid(sid)} 真事 ${r.summary.total} 条 → ✅${r.summary.ok} / ⚠️${r.summary.weak} / ❌${r.summary.miss}` +
        ` —— **缺口 ${cands.length} 条**（留在 pending，留意栏直接列它们；每条旁边带一句按 W5 的提醒）`
    )
    return { ok: true, verdict: 'pending', candidates: d.candidates, summary }
  } catch (e) {
    dumpLog(`F22/F23 机器对账出错（fail-open，该份照旧留在 pending）：${e}`)
    return { ok: false, verdict: 'unknown', why: String(e?.message ?? e) }
  }
}

/**
 * **提名销账**（2026-09-23 · 《留底全自动销账》讨论稿 v3-3）—— 用户要的「**我只归账，其余全自动**」。
 *
 * 判据两条，**都由机器现算**（我写的那句提名**不进判据**）：
 *   ① **事务真写成** —— 调用点只在落档内核**写完读回确认之后**（`lib/f9-commit.js` 里 `sweepTxn` 之前）；
 *   ② **这个 sid 被点名** —— 落档时 `dangan_log` 的「归账完成」参数里出现它。
 *
 * **两条腿**（v3-3 解掉"主份已丢 ⇒ 永远清不掉 ⇒ 被第 12 关死拦"那个死锁）：
 *   · 主份还在 `pending\` → `moveToVerified()` 挪进 `verified\`（只留最近五份，F29 到期清）；
 *   · 主份已不在 → **只清 state**（原文只在会话日志里，随时能重建）。
 *
 * ⚠️ **fail-open**：挪不动就**不销**（state 留着、留意栏照旧报它）—— 绝不让落档报错、绝不静默放过。
 * ⚠️ 这一批**不动** `backup\` 那套（第二批才砍）；顺手清备份是沿用旧路的做法。
 *
 * @param {string} token 提名里那个：**短 id**，或带 kind 的 `<kind>:<短id>`
 * @returns {{ok:boolean, why?:string, hit?:number, moved?:string}}
 */
export function settleNamed(token) {
  const want = String(token ?? '').trim()
  if (!want) return { ok: false, why: '提名是空的' }
  const byKind = want.includes(':')
  const wantKind = byKind ? want.split(':')[0] : ''
  const wantSid = byKind ? want.split(':').slice(1).join(':') : want
  if (!wantSid) return { ok: false, why: `提名写错了吧（${want}）` }
  try {
    const st = loadDumpState()
    const dumps = st.dumps && typeof st.dumps === 'object' ? st.dumps : {}
    const hits = []
    for (const [key, d] of Object.entries(dumps)) {
      if (!d || typeof d !== 'object') continue
      if (byKind && !key.startsWith(`${wantKind}:`)) continue
      const sidShort = d.sidShort ?? shortSid(key.slice(key.indexOf(':') + 1))
      if (sidShort !== wantSid) continue
      hits.push([key, d])
    }
    if (hits.length === 0) return { ok: false, why: `状态表里没有 ${want} 这一份`, hit: 0 }
    let moved = ''
    let changed = false
    for (const [key, d] of hits) {
      const who = d.kind === 'archive' ? '归档留底' : '压缩留底'
      const mainThere = existsSync(d.mainAbs)
      let expiresYmd = d.expiresYmd ?? ''
      if (mainThere) {
        const mv = moveToVerified({ ...d, _key: key })
        if (!mv.ok) {
          // 挪不动 ⇒ **不销**（宁可多报，不可当"销了"）
          dumpLog(`提名销账 ⚠️ 挪 verified 失败（**这一份不销、留在 pending**）：${d.sidShort ?? '?'} —— ${mv.why}`)
          continue
        }
        moved = mv.to ?? ''
        expiresYmd = mv.expiresYmd ?? ''
        noteNamed() // 累计"我提名销账"这几个 —— 让 verified 的读数自证（见 f29 的 tallyLine）
      }
      delete dumps[key]
      changed = true
      dumpLog(
        `✅ 销账（提名 · ${who}）：${d.sidShort ?? '?'} —— ` +
          (mainThere
            ? `主份已挪入 verified（保留至 ${expiresYmd || '?'}）；备份份已清`
            : `主份早已不在 ⇒ 只清 state（原文在会话日志里，可重建）；备份份已清`)
      )
    }
    if (changed) {
      st.dumps = dumps
      saveDumpState(st)
    }
    return { ok: changed, hit: hits.length, moved, why: changed ? undefined : '一份都没销掉（挪不动？）' }
  } catch (e) {
    return { ok: false, why: `提名销账出错（fail-open）：${e?.message ?? e}` }
  }
}

// ============================================================
// 对账（**只由闸门调用** —— 它手上有当前 T 号）
// ============================================================

/**
 * 走一遍所有留底 —— **2026-09-23 起它只剩一件事：收掉"0 候选已挪进 verified"的 state 条目**。
 *
 * 🔴 **为什么砍掉了两大块**（《留底全自动销账》讨论稿 §四）：
 *   · **「主份没了 ＋ T 前进 → 销账」那条**：它借 `T` 当"补完了没有"的度量，而**落档自己就会让 T 前进**
 *     ⇒ 判据近乎恒真（两轮对抗审查都推翻了它）。现在销账的唯一正路是**提名**（`settleNamed`）。
 *   · **「空删 → 从备份份恢复」那条**：备份份本身就是"**我会手删留底**"才长出来的；现在主份是**被挪进
 *     `verified\`** 而不是被删 ⇒ 前提消失。**连带 `backup\` 整个目录、`recoverFromBackup()` 一起拆掉。**
 *   ⚠️ 于是这一道永远过 —— "没归账还想干别的活"改由**第 12 关 ＋ 留意栏**承担。
 *
 * ⚠️ 仍然 **fail-open**（出错就放行），且**只由闸门调用**。
 * @param {number} currentT 当前时间轴 T 条数（**已不再参与判据**，留参数只为兼容调用方）
 * @returns {{ok:boolean, text:string, pending:number, emptied:number}}
 */
export function dumpVerdict(currentT) {
  void currentT // 已不参与判据（见上面那段：它当"补完了没有"的度量近乎恒真）
  try {
    const st = loadDumpState()
    const dumps = st.dumps && typeof st.dumps === 'object' ? st.dumps : {}
    let changed = false
    for (const [key, d] of Object.entries(dumps)) {
      if (!d || typeof d !== 'object') continue
      // 0 候选的份：主份已被 `settleDump()` 挪进 `verified\`（全文在那儿躺满保留期，F29 到期清）
      // ⇒ 这里只把 state 里那条收掉，留意栏从此不再提它。
      if (d.verifiedAt) {
        const who = d.kind === 'archive' ? '归档留底' : '压缩留底'
        dumpLog(`✅ 清账（${who}·机器报 0 候选）：${d.sidShort} 主份已在 verified（保留至 ${d.expiresYmd ?? '?'}）`)
        delete dumps[key]
        changed = true
      }
    }
    if (changed) {
      st.dumps = dumps
      saveDumpState(st)
    }
    // 🔴 2026-10-07（多馆支持）：`pending` 也**只算本馆的** —— 留底报的数不许把别馆的算进来。
    // 🔴 2026-10-07（用户拍板）：**无账可销**的份也不算进 `pending`（见 `noteNoFacts`）。
    const pending = Object.values(dumps).filter(
      (d) => d && !d.noFactsAt && (!d.archive || d.archive === arcKey()),
    ).length
    return { ok: true, text: '', pending, emptied: 0 }
  } catch (e) {
    dumpLog(`F22 对账出错（**fail-open 放行**）：${e}`)
    return { ok: true, text: '', pending: 0, emptied: 0 }
  }
}

// ============================================================
// 亮灯（给 F1 的注入用）
// ============================================================

/**
 * 每份留底的**对账结论**（2026-09-18 加）——**机器替 agent 把"补完没有"算出来**。
 *
 * 🔴 为什么加：销账判据就是"T 号必须**大于**基准"，所以"当前 T 有没有跨过基准"就是**唯一**那个需要的信号。
 *    在此之前，每轮亮灯只说"基准 T275、去读原文"，agent 得自己读那份 17 万字原文判 ——
 *    那正是"**她每轮要我做的事太多**"里最重的一件（用户 2026-09-18 提的减重）。
 * ⚠️ **跨过基准 ≠ 证明补全**（T 也可能是别的活儿涨的）→ 文案写"**若**…都补上了"，把判断留给人；
 *    这也与留底判定**同一个数**（`countT()`），不另算一套。
 */
/** 索引里 L3 那一节的**第一条时间**（＝ 最新那份 L3 记录）—— **A 方案销账判据看它**。
 *  用户 2026-10-14 原话：「销账检测，或许不该检测 l3 这么大一层，而是检测**索引里 l3 的那个最后时间**」。
 *  ⚠️ 索引是**派生件**：得先重织才反映得出"刚落完的档" —— 那一步 2026-10-14 已并进 `f9-commit` 的落档流程。
 *  读不到就返回 `''`（判据会退回旧路）。 */
export function l3LatestFromIndex() {
  try {
    const p = findByName('索引')
    if (!p) return ''
    const t = readTextSafe(p)
    // ⚠️ 2026-10-14（对抗审查抓到）：**要封节** —— 原来 `[\s\S]*?` 会串到别层，把别层的时间当成"L3 最新"。
    const sec = t.match(/^##\s*L3[^\n]*\n([\s\S]*?)(?=^##\s)/m)
    const mm = (sec ? sec[1] : '').match(/^\|\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*\|/m)
    return mm ? mm[1].trim() : ''
  } catch {
    return ''
  }
}

/**
 * 销账判据（**A 方案**，2026-10-14 · 用户选）。
 *
 * ⚠️ **导出只为测试**（`tests/f22-compact-dump.mjs`「十六」那一节）：这段判据是"会自动读档案、
 *    决定留底该不该销"的那一步，而它 2026-10-14 一夜改了两处（判据换索引 ＋ 只比到日期）——
 *    **没人测过它**。导出它，是为了让"当天刚落的档会不会被误判成没动"这条能**被机器钉住**。
 *    对外行为不变（它原来就是本模块内部的函数）。
 */
export function reconcile(d, nowT) {
  // 🔴 2026-10-14 改（**用户选 A**）：判据 ＝ 「**索引里 L3 那一节第一条的时间**」是否晚于**基准 L3**。
  //    旧判据（`nowT > preT`）的问题：T 号跟"原文补没补完"其实没关系（别的活儿也会涨 T），
  //    而且它逼出过"**为了跨过基准空落一条档**"的浪费（`lib/reconcile.js:11` 自己写着这件事）。
  // ⚠️ 2026-10-14（对抗审查抓到）：**只比到「日期」** —— 索引里那个「时间」对不同文件精度不同
  //   （有时间标记的到分；只有文件名日期的只能到 `00:00`）⇒ 按时刻比会出「同一天刚落的档反而更小」的假阴性。
  //   销账判据本来就宽（"跨过基准 ≠ 证明补全"）⇒ **同一天就算动过**是对的。
  // 🔴 2026-10-14 深夜（**F14 的测试当场抓到**）：上面那句口径**当时并没实现** ——
  //   `b > a` 配上 `slice(0,10)`（只截到日）⇒ **同一天恒为假**，等于"当天补完了也报还没补"，
  //   正好是它要防的那个假阴性。改成 `b >= a` 才真对上那句话。
  const parse = (s) => Date.parse(String(s).replace(' ', 'T').slice(0, 10) + 'T00:00:00+08:00')
  const base = String(d?.preL3 ?? '').trim()
  const cur = l3LatestFromIndex()
  if (base && cur) {
    const a = parse(base)
    const b = parse(cur)
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return b >= a
        ? `L3 最新记录已到 **${cur}**（落底时是 ${base}）—— 若原文里的事都补上了，**删主份即销账**`
        : `L3 最新记录还停在 **${cur}**（落底时是 ${base}）—— 原文里的事**还没补**（L3 没动，删了就是空删）`
    }
  }
  // 兼容：老留底没有「基准 L3」（或索引读不到）⇒ **退回旧的 T 号判据**
  const preT = Number(d?.preT)
  if (!Number.isFinite(preT)) return '基准读不到 → **别删，先人工核**'
  // ⚠️ 2026-10-14（对抗审查 F11）：**退回旧判据要说明白** —— 原来只写"（退回 T 号判据）"，
  //    人看不出"为什么退"（是这份留底没基准？还是索引读不到？），容易以为还在用新判据。
  const why = base ? '索引 L3 节读不到时间行' : '这份留底没有「基准 L3」（老留底）'
  return nowT > preT
    ? `（⚠️ ${why} ⇒ 退回 T 号判据）当前 T${nowT} **已跨过**基准 T${preT} —— 若原文里的事都补上了，**删主份即销账**`
    : `（⚠️ ${why} ⇒ 退回 T 号判据）当前 T${nowT} **还没跨过**基准 T${preT} —— 原文里的事**还没补**`
}

/**
 * 未销账的时候在注入里亮一次。**空字符串＝没有要说的**。
 *
 * ⚠️ **频率不归这里管**（2026-09-18 减重）：原来 F1 按"最后一条真实用户消息的 id"去重 →
 *    等于**每一轮都亮一遍**，一轮一条 user 消息，噪音全落在对话里。现在由 **F26 留意栏**统一节流
 *    （首次说、内容变了说、或超过 TTL 才再说一次）。这里只负责"**内容**是什么"。
 * @returns {{text:string, compact:string, count:number, overdue:boolean, emptied:number}}
 */
/**
 * 这条留底的**骨架**在哪（2026-09-19 加）。
 * ⚠️ **只在骨架真的存在时才报** —— 报一个不存在的路径比不报更坏（还得让我去查"为什么没有"）。
 */
function skeletonPathOf(d) {
  try {
    const sid = String(d?._key ?? '').replace(/^(compact|archive):/, '')
    if (!sid) return ''
    const p = join(skeletonDir(), skeletonFileName(sid, d.kind))
    return existsSync(p) ? p : ''
  } catch {
    return ''
  }
}

/**
 * 这条留底的**摘要**在哪（2026-10-18 加 · 用户当场问"不是读摘要吗？你为什么读骨架"）。
 * 🔴 销账该读的是**摘要**（`摘要-<归档|压缩>-<短id>.md`，只有"用户原话 ＋ 我这轮为达成什么"）；
 *    骨架只在"要查细节"时才 grep —— 骨架 194 KB vs 摘要 32 KB，读错就是 6 倍的字。
 * ⚠️ 摘要缺（老留底）就退回骨架：**别报一个不存在的路径**。
 */
function digestPathOf(d, fallbackSk = '') {
  try {
    const sid = String(d?._key ?? '').replace(/^(compact|archive):/, '')
    if (!sid) return fallbackSk
    const p = join(skeletonDir(), digestFileName(sid, d.kind))
    return existsSync(p) ? p : fallbackSk
  } catch {
    return fallbackSk
  }
}

/**
 * 留意栏里的**候选块**（2026-09-20 第三代 · E165）。
 *
 * 🔴 这就是"**省掉读骨架那一步**"的落点：机器已经把每条用户真事拿去档案字面比对过了，
 *    这里只摆它挑出来的那几条（`factLine`：时间 ＋ 摘要 ＋ 锚点 ＋ 为什么可疑）。
 * ⚠️ **0 候选的份根本走不到这里** —— 它们的主份已被 `settleDump()` 挪进 `verified\``、不进留意栏。
 * ⚠️ 对账**没跑成**的份必须说清楚：那种情况"没有候选"不代表"都进档了"，只代表"**没筛过**"。
 */
function candidateBlock(d) {
  const rec = d?.reconcile
  if (rec && rec.ok === false) {
    return `    ⚠️ **机器对账没跑成**（${String(rec.why ?? '?').slice(0, 60)}）—— 这份只能照旧读骨架\n`
  }
  const cands = Array.isArray(d?.candidates) ? d.candidates : []
  // 🔴 2026-10-15（销账重组 · 判据 1 —— 方案见 `L4-施工\工程-销账重组.md`）：产物改「**缺口清单**」。
  //    以前这里写"机器挑出 N 条要人看一眼"，读起来像"这批都待审"；而按 W5，
  //    **查得到的那批已经当场折掉了**，摆到眼前的只剩"**查不到**"的。
  //    ⚠️ **缺口 0 条是合法且预期的结果** —— 用户 2026-10-14 22:10 那句的解法就是它：
  //      「**你写空。。我感觉是不有点不对**……有闸门判定你必须动过 l3 才算落档成功」
  //      ⇒ **空的是「缺口清单」，不是「核账记录本身」**（记录照写，闸门照样能过）。
  // 🔴 2026-10-19：**报全量**。`candidates` 只存前 5 条（`settleDump` 里截断），
  //    拿它当"缺口总数"会把 81 条报成 5 条（当天真实踩到：白核了一轮）。
  //    老 state 没有 `candidatesTotal` ⇒ 退回 `cands.length`（宁少不编）。
  const total = Number.isFinite(d?.candidatesTotal) ? d.candidatesTotal : cands.length
  if (total === 0) return '    **缺口 0 条**（查得到的都已在档）—— 核账记录照写就行\n'
  if (cands.length === 0) return `    **缺口 ${total} 条**（state 里没留清单 —— 跑 \`reconcile-dump --brief\` 看全量）\n`
  const shown = Math.min(3, cands.length)
  return (
    `    **缺口 ${total} 条**（查不到的那几条 · 其余都已在档）：\n` +
    cands.slice(0, shown).map((c) => `      ${c}\n`).join('') +
    (total > shown ? `      …还有 ${total - shown} 条（state 只留前 ${cands.length} 条清单；全量跑 \`reconcile-dump --brief\`）\n` : '')
  )
}

export function dumpNotice() {
  try {
    const st = loadDumpState()
    // ⚠️ 用 `entries()` 而不是 `values()`：状态表的 key 是 `<kind>:<完整会话id>`，
    //    而骨架的**文件名要完整 sid** 才算得出来（记录里只有 `sidShort` 那 8 位）。
    // 🔴 2026-09-20（E165）：**带 `verifiedAt` 的份不算留意** —— 它们已被机器筛过、主份挪进了
    //    `verified\``（只留最近五份），留意栏对它们**一个字都不说**（用户："0 候选 → 不进留意栏"）。
    const entries = Object.entries(st.dumps ?? {})
      .filter(([, d]) => d && typeof d === 'object' && !d.verifiedAt)
      // 🔴 2026-10-07 加（多馆支持）：**只数本馆的** —— 在新馆里不该念旧馆的账。
      //    ⚠️ 没有 `archive` 字段的老记录**照列**（启动核对会把它认到当前馆；照列 ＝ 宁可多报，不可漏报）。
      .filter(([, d]) => !d.archive || d.archive === arcKey())
      // 🔴 2026-10-07（用户拍板）：**无账可销**的份不进留意栏（判据见 `noteNoFacts`）——
      //    它的那批里**没有真人对话**，念它只会让我去读几十万字的原文。
      .filter(([, d]) => !d.noFactsAt)
      // 🔴 **现查盘**（2026-09-23 · v3-7）：记录在、文件不在的，**不许打印它的路径**（那是幽灵路径，
      //    看的人会去找一个不存在的东西）。启动核对自己会把这号僵尸记录清掉。
      .filter(([, d]) => existsSync(d.mainAbs))
      .map(([key, d]) => ({ ...d, _key: key }))
    if (entries.length === 0) return { text: '', compact: '', count: 0, overdue: false }
    const hasArchive = entries.some((d) => d.kind === 'archive')
    // 🔴 2026-10-15：`maxT()` 随 L2 退役删除 ⇒ 这里**直接写 -1**（与它退役后的返回值完全一致，行为不变）。
    const nowT = -1
    const who = (d) => (d.kind === 'archive' ? '归档留底' : '压缩留底')
    const lines = []
    for (const d of entries.slice(0, 3)) {
      const sk = skeletonPathOf(d)
      lines.push(
        `  · ${who(d)}（会话 ${d.sidShort}）：**基准 T${d.preT}** 之后的事还没补 · ${reconcile(d, nowT)}\n` +
          candidateBlock(d) +
          (sk
            ? `    **先读摘要** \`${digestPathOf(d, sk)}\`（只有"用户原话 ＋ 我这轮为达成什么"；要查细节再 grep 骨架 \`${sk}\`）\n`
            : `    ⚠️ 骨架缺（0.32.0 之前的旧留底，或当时没写成）—— 只能读原文\n`) +
          `    原文 \`${d.mainAbs}\`（${d.items ?? '?'} 条 / ${d.chars ?? '?'} 字符）`
      )
    }
    if (entries.length > 3) lines.push(`  …还有 ${entries.length - 3} 份`)
    const overdue = entries.length >= DUMP_PILE_LIMIT
    const tail = overdue
      ? `\n⚠️ **已堆到 ${entries.length} 份**（≥ ${DUMP_PILE_LIMIT}）—— **把这句念给用户听，让他判断怎么处理。**`
      : ''
    // 精简版（给 F26 留意栏用）：一行一份，**只留判断销账真正需要的三件** —— 基准 / 当前 / 原文在哪。
    const compact = [
      `留底：**${entries.length} 份未销账**（F22/F23）`,
      ...entries
        .slice(0, 3)
        .map((d) => {
          const sk = skeletonPathOf(d)
          return (
            `  · ${who(d)}（${d.sidShort}）：${reconcile(d, nowT)} · ${sk ? `**先读摘要** \`${digestPathOf(d, sk)}\`（细节再 grep 骨架）` : '⚠️ 无骨架'} · 原文 \`${d.mainAbs}\`\n` +
            candidateBlock(d).replace(/\n$/, '')
          )
        }),
      entries.length > 3 ? `  …还有 ${entries.length - 3} 份` : '',
      overdue ? `  ⚠️ 已堆到 ${entries.length} 份（≥ ${DUMP_PILE_LIMIT}）—— **把这句念给用户听**。` : '',
    ]
      .filter(Boolean)
      .join('\n')
    return {
      count: entries.length,
      overdue,
      compact,
      text:
        `〔留底 F22/F23 · **${entries.length} 份未销账**〕${hasArchive ? '有会话被归档或被压缩' : '上一段被揉掉'}的原文留在这儿了，` +
        `**照它把还没进档案的事落档**，然后**落档时带一句 \`归账完成: ["<短id>"]\`** —— 事务真写成之后插件自己把它挪进 \`verified\\\`（销账只认提名，**不要再手删**）：\n` +
        lines.join('\n') +
        tail,
    }
  } catch (e) {
    dumpLog(`亮灯出错（当没有）：${e}`)
    return { text: '', compact: '', count: 0, overdue: false, emptied: 0 }
  }
}

// ============================================================
// 钩子 + 自检
// ============================================================

/** 内存里暂存 summary 的 seq（end 成功落地时才真写盘 —— 压缩失败不留底，免得误报"未补档"）。 */
const pendingSummary = new Map()

/**
 * 🔴 **prune 累积器（2026-10-01 加）** —— 用户当天定："**裁剪这事需要添加到落档销账的这套机制里去，
 *   机制是现成的，只要能捕捉到裁剪的内容的原文，就跟归档销账一样的流程走一遍就能保证不丢内容**"。
 *
 * 为什么不像压缩那样"一触发就写"：**prune 很碎**（实测一次 17 条 / 93K，将来可能几分钟一次）
 *   ⇒ 每来一条就写一份留底 ＝ **堆一堆小文件**（F22 的清理口径是"只留最近 5 份"，小文件会把真留底挤掉）。
 *   ⇒ **攒够一份再写**：累积 ≥20 条 **或** ≥5 万 token ⇒ 落一份留底。
 * ⚠️ 阈值是**我自己定的**（没有人替我判"多小算碎"）——将来嫌碎/嫌少就改这两个数，改这一处。
 */
const pendingPrune = new Map() // sid -> { seqs:number[], tokenCount:number, batches:number }

/**
 * 🔴 **清空某会话尚未攒够的 prune 累积（2026-10-01 · 用户点出的两个漏洞）** ——
 *   用户原话："**还没攒够 20 份就切换了会话，老会话被归档，那会不会这几份就没了归处静默烂掉**"
 *   ＋ "**如果我归档之后在新的会话已经干了好久活了……超过 20 条然后触发一轮裁剪归账，
 *      他就要被迫去读已经好久之前的事情，这样不就中断了他的注意力了吗？**"
 *
 * ⇒ 由 **F23 在"检测到某会话已归档"时调用**（F23 每 60 秒看一次归档集合 ⇒ **最多 1 分钟就清掉**）：
 *   那个会话的零散 prune **不会再挂着**，也**不会等新会话干到一半时拿旧账来触发**。
 *   ⚠️ 为什么不在"归档那一刻"做：用户 2026-09-17 实测过 ——"**我归档的时候，里面的 agent 是没法动的**"。
 *   ⚠️ **内容不会因此丢**：F23 的归档留底是 `readSessionEvents(logFile)` 渲染**全部**事件，
 *      被 prune 掉的那些**本来就在日志里**、本来就会进归档留底 —— 这个清空只是"把没用的零头收掉"。
 * @returns {{seqs:number[], tokenCount:number, batches:number}|null} 清掉的那份（没有就 null）
 */
export function clearPendingPrune(sid) {
  const cur = pendingPrune.get(sid)
  if (!cur) return null
  pendingPrune.delete(sid)
  return cur
}

/**
 * 🔴 **列出某会话"已经写盘、还没销账"的留底**（默认**除归档之外**）—— 2026-10-07，用户拍板走"甲"。
 *
 * **为什么需要它**：同一个会话会攒出**两份**留底 —— `compact:<sid>`（压缩与裁剪**共用这一份**）
 *   与 `archive:<sid>`（整场会话）。而归档留底是 `readSessionEvents()` 渲染**全部**事件
 *   ⇒ **它把 `compact` 那份的内容整个盖住了**。
 *   于是"甲"就是：**归档留底写成之后**，把 `compact` 那份**就地作废**（挪进 `verified\`），
 *   否则同一个会话要被销 **2~3 次**（2026-10-07 实测 `739a1b79` 销了三次）。
 *
 * @param {string} sid 完整会话 id
 * @param {{except?:string}} [opt] `except` ＝ 不列哪种 kind（默认 `'archive'`）
 * @returns {Array<object>} 状态表里那几条（**带 `_key`**，可直接喂 `moveToVerified`）；盘上文件没了的**不列**
 */
export function pendingDumpsOf(sid, opt = {}) {
  const except = opt.except === undefined ? 'archive' : opt.except
  const st = loadDumpState()
  const dumps = st && typeof st.dumps === 'object' && st.dumps ? st.dumps : {}
  const out = []
  for (const [key, d] of Object.entries(dumps)) {
    const i = key.indexOf(':')
    if (i < 0) continue
    const tail = key.slice(i + 1)
    // 🔴 2026-10-07（对抗审查）：**认领来的那份**（启动核对补的记录，键是 `<kind>:adopted-<短id>`）
    //    也要算这个会话的 —— 否则它既不会被归档作废、也不会被接写，只会在留意栏里被反复念。
    if (tail !== sid && tail !== `adopted-${shortSid(sid)}`) continue
    if (except && key.slice(0, i) === except) continue
    if (!d?.mainAbs) continue
    try {
      if (!existsSync(d.mainAbs)) continue // 盘上已经没了 ⇒ 不列（僵尸记录归 auditDumpState 清）
    } catch {
      continue
    }
    out.push({ ...d, _key: key })
  }
  return out
}

export function onSessionEvent(session, event) {
  try {
    const t = String(event?.type ?? '')
    if (!t.startsWith('compaction/')) return
    const sid = typeof session?.id === 'string' ? session.id : null
    if (!sid) return
    // 🔴 **prune（裁剪）—— 接进 F22 这条留底链**：判据、取原文、骨架、留意栏、销账三步门**全都复用**
    //    （取原文那条路是现成的：`session.eventAt(seq)`，见 `seqsOf`/`renderEvents`）。
    if (t === 'compaction/prune') {
      const d = event?.data ?? {}
      const seqs = Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.map(Number) : []
      const tk = Number(d.shadowedTokenCount) || 0
      if (seqs.length === 0) return
      const cur = pendingPrune.get(sid) ?? { seqs: [], tokenCount: 0, batches: 0 }
      cur.seqs.push(...seqs)
      cur.tokenCount += tk
      cur.batches += 1
      if (cur.seqs.length >= 20 || cur.tokenCount >= 50_000) {
        pendingPrune.delete(sid)
        dumpLog(`F22 收到 prune：${shortSid(sid)} · 攒到 ${cur.seqs.length} 条 / ${cur.tokenCount} token（${cur.batches} 批）⇒ **写留底**`)
        writeDump(sid, session, { seqs: cur.seqs, tokenCount: cur.tokenCount })
      } else {
        pendingPrune.set(sid, cur)
        dumpLog(`F22 收到 prune：${shortSid(sid)} · +${seqs.length} 条 / ${tk} token（攒到 ${cur.seqs.length} 条 / ${cur.tokenCount} token，够一份再写）`)
      }
      return
    }
    if (t === 'compaction/summary') {
      const d = event?.data ?? {}
      const seqs = Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.slice() : []
      pendingSummary.set(sid, { seqs, tokenCount: Number(d.shadowedTokenCount) || 0 })
      dumpLog(`F22 收到 summary：${shortSid(sid)} · shadowed ${seqs.length} 条 · ${Number(d.shadowedTokenCount) || 0} token（等 end 落地再写留底）`)
      return
    }
    if (t === 'compaction/end') {
      const err = event?.data?.error
      const ok = err === undefined || err === null || err === ''
      if (!ok) {
        pendingSummary.delete(sid)
        dumpLog(`F22 压缩 end 带 error（${String(err)}）—— 表层没替换，**不留底**`)
        return
      }
      const info = pendingSummary.get(sid)
      pendingSummary.delete(sid)
      writeDump(sid, session, info ?? { seqs: [] })
    }
  } catch (e) {
    dumpLog(`F22 处理压缩事件出错（忽略，不影响压缩本身）：${e}`)
  }
}

/** 启动自检：**沉默 ≠ 正常** —— 有留意就得说出来。 */
export function reportF22() {
  try {
    // 🔴 先**核对 state ↔ 盘**（2026-09-23 · v3-6）：僵尸记录清掉、无主留底认领回来 ——
    //    两件都**带处理动作**（只报不治 ＝ 死锁，讨论稿 §十六 那条）。
    const audit = auditDumpState()
    const st = loadDumpState()
    // ⚠️ 只报"压缩"那一类 —— **归档留底归 F23 的 `reportF23` 报**（各报各的，免得两份自检重复同一批）
    const mine = (d) => d && typeof d === 'object' && d.kind !== 'archive' && (!d.archive || d.archive === arcKey())
    const entries = Object.values(st.dumps ?? {}).filter((d) => mine(d) && !d.noFactsAt)
    // 🔴 2026-10-07（用户拍板）：**无账可销**的那几份要**留痕**（"沉默 ≠ 正常"那条规矩）——
    //    它们是"裁剪那批里没有真人对话"的份：自动过了，但不许悄无声息。
    const noFacts = Object.values(st.dumps ?? {}).filter((d) => mine(d) && d.noFactsAt).length
    const nfNote = noFacts > 0 ? ` · 另有 ${noFacts} 份**无账可销**（那批里没有真人对话，已自动过）` : ''
    const last = st.lastAt ? `（最近一次留底 ${String(st.lastAt).slice(5, 16).replace('T', ' ')}）` : ''
    const fix =
      audit.zombieCleared || audit.adopted ? ` · 🔧 核对：清 ${audit.zombieCleared} 条僵尸 / 认领 ${audit.adopted} 份` : ''
    if (entries.length === 0) return `压缩留底 F22：待销账 **0 份**${last}${fix}${nfNote}`
    const oldest = String(entries.map((d) => d.at).sort()[0] ?? '').slice(5, 16).replace('T', ' ')
    const pile = entries.length >= DUMP_PILE_LIMIT ? ` ⚠️ **堆到 ${entries.length} 份了**` : ''
    return `压缩留底 F22：⚠️ 待销账 **${entries.length} 份** · 最早 ${oldest}${pile}${fix}${nfNote}`
  } catch (e) {
    return `压缩留底 F22：读不到状态（${e && e.message ? e.message : e}）`
  }
}
