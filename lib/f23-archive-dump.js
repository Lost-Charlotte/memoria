// ============================================================
// F23 · 归档留底 —— 2026-09-17 深夜建（**用户点出的一个漏洞**）
// ============================================================
//
// 用户原话："**我发现一个漏洞，如果我没触发上下文压缩就再不输出新内容，会导致档案丢失内容。
//   我需要梅莫莉亚拥有新功能，在我在控制台选择归档会话的时候，能让被归档的会话里的内容
//   进行一次全面的、对咱们档案的归档。你觉得能自动化吗？**"
//   → F22 只认"压缩"这一个扳机：**没压缩就归档 ＝ 留底永远不会触发**，那段时间做过的事就真没了。
//
// 用户给的方案（我照做，没加自己的花样）："**就是还记得我们之前做的压缩归档功能么？
//   梅莫莉亚只要检测到一个会话被归档了。那么他同样触发这一套，留两个副本。
//   这样也不怕我归档的多，毕竟超过三个他就会强制你。**"
//   → **F23 = F22 那一套，换个扳机**：检测到归档 → 全文留底两份 → 亮灯 → 我补档 → 删主份销账 → 堆到 3 份点名。
//
// 🔴 **为什么不做"归档前叫醒它"**（我原本想的路）——用户实测否掉了：
//   "**我归档的时候，里面的 agent 是没法动的。因为我没输出任何内容。**"
//   所以改成：**由别的会话、或下次启动时，替那个已经睡着的会话留底**。它不需要醒着。
//
// 🔴 **原文从哪来**：归档的会话我手里没有对象，**只能读会话日志**
//   （`~/.dsh/sessions/<工作区目录>/<目录名=sid 去掉 session- 前缀>/session.v<N>.jsonl.zstd`）。
//   ⚠️ 那文件是**独立 zstd 帧拼接**的，实测 `zstdDecompressSync(整份)` **只解第一帧、还返回成功**
//      （26 MB 的文件给你 205 字节，不报错）—— 必须**按帧头逐帧解压**。
//      帧扫描算法**照抄 `read-session.mjs` 的 `scanZstdFrames`**（那份逐字段读帧头算长度，是权威；
//      我第一版"搜魔数"虽然也能切，但那是碰运气，不如解析帧头稳）。
//
// 🔴 **归档这个动作的事实在哪**：`workspaceRegistry.archiveSession()` → 写
//   `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`。
//   ⚠️ 它**不在会话事件流里**（36 种 `SessionEventMap` 事件里没有任何 archive）→ **没有事件可挂**，
//      只能**轮询那个文件**。时机：① 每次 `agent/pre-step`（节流 60 秒）② 每次启动。
//   ⚠️ 官方注释说归档只是 "Hide one known Session from Workspace grouping surfaces" ——
//      **只从界面隐藏，日志一个字不删**，所以原文永远读得回来。
//
// ⚠️ 自我约束（与 F22 一致）：**插件对档案只读**（留底写 `~/.dsh`，一个字都不进档案）；
//   **全程 fail-open**（出错只记日志）；**不许静默**（找到几个、留了几份、读不读得到，全留痕）。

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { CFG, DSH_HOME, HOME_DIR, capTick, isSubagent, log, nowCN, readTextSafe, shortSid } from './common.js'
import {
  DUMP_PILE_LIMIT,
  arcKey,
  auditDumpState,
  clearPendingPrune,
  dumpFileName,
  loadDumpState,
  mainPath,
  pendingDumpsOf,
  persistDump,
  renderOne,
  settleDump,
} from './f22-compact-dump.js'
// 🔴 2026-10-07（用户拍板"甲"）：归档留底**写成之后**，把同会话**已被它覆盖**的旧留底挪进 verified。
//    ⚠️ `f29` 只 import `common.js`（不回头 import 本文件）⇒ **不成环**。
import { moveToVerified } from './f29-verified.js'
import { loadArchive } from './reconcile.js'
import { digestFileName, pruneSkeletonDir, skeletonDir, skeletonFileName, writeSkeleton } from './skeleton.js'

/**
 * 归档留底的字符上限。**默认 `0` ＝ 不截断（全文都留）** —— 用户 2026-09-17 深夜明确要求：
 * "**全文都留**……**即便是几个 G 也是临时的**"（留底销账时两份一起删，空间他给得起）。
 * 想加个保险：给个数字即可（超了就截断并在留底里明说）。
 */
export const ARCHIVE_MAX_CHARS = 0

/** 检查节流：`pre-step` 每步都到，但归档集合不必每步看（60 秒一次够了）。 */
export const CHECK_INTERVAL_MS = 60000

export const ARCHIVE_STATE = join(HOME_DIR, 'memoria-archive.state.json')
export const ARCHIVE_LOG_FILE = join(HOME_DIR, 'memoria-archive.log')
export const sessionsRoot = () => join(DSH_HOME, 'sessions')
export const workspaceJson = () => join(DSH_HOME, 'storages', 'workspace.json')

let lastCheckAt = 0

export function archiveLog(msg) {
  try {
    appendFileSync(ARCHIVE_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* 日志失败不阻塞 */
  }
  log(msg, { silent: true })
}

export function loadArchiveState() {
  try {
    const s = JSON.parse(readTextSafe(ARCHIVE_STATE))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

export function saveArchiveState(s) {
  try {
    writeFileSync(ARCHIVE_STATE, JSON.stringify(s, null, 2))
  } catch (e) {
    archiveLog(`F23 状态存不下（下次会把已处理过的再看一遍，无害）：${e}`)
  }
}

/**
 * 读"归档集合"。
 * ⚠️ **读不到返回 `null`，不是空数组** —— "读不到"与"一个都没归档"是两回事（照 R20 那条判据：
 * 探测不到 ≠ 不存在）。调用方必须区分。
 */
export function readArchivedIds() {
  try {
    const j = JSON.parse(readTextSafe(workspaceJson()))
    const ids = j?.global?.archivedSessionIds
    return Array.isArray(ids) ? ids.map(String) : null
  } catch {
    return null
  }
}

/** 会话 id → 它在 `sessions/` 下的目录名（**剥掉 `session-` 前缀**：目录名不带，`workspace.json` 里带）。 */
export const dirNameOf = (sid) => String(sid).replace(/^session-/, '')

/**
 * 在**一个会话目录**里挑日志：带版本号的优先（多个取版本号最大），没有就退到不带版本号的旧名。
 * 口径照 `read-session.mjs` 修好后的那一版 —— **带版本号的才是权威**。
 */
function pickNewestLog(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  let best = null
  let bestV = -1
  let fallback = null
  for (const e of entries) {
    if (!e.isFile()) continue
    const m = /^session(\.v(\d+))?\.jsonl\.zstd$/.exec(e.name)
    if (!m) continue
    const p = join(dir, e.name)
    if (m[1] !== undefined) {
      const v = Number(m[2])
      if (Number.isFinite(v) && v > bestV) {
        bestV = v
        best = p
      }
    } else if (!fallback) {
      fallback = p
    }
  }
  return best ?? fallback
}

/**
 * 找某个会话的日志文件。
 *
 * 🔴 **2026-09-17 深夜真机修** —— **第一次真跑就撞出来的假阴性**：原来只试
 *   `sessions/<sid 去掉前缀>/` **一层**；而真实布局是 **`sessions/<工作区目录>/<会话目录>/<日志>`（两层）**，
 *   **并且会话目录名有的带 `session-` 前缀、有的不带**（本机两种都存在）。
 *   实测后果：**11 个归档会话全被报"找不到日志"** —— 明明有。**"探测不到 ≠ 不存在"的现场版。**
 *   现在：**两层都扫、两种目录名都认**，末尾再留一条"万一布局退回一层"的兜底。
 */
export function findSessionLog(sid) {
  const wanted = new Set([String(sid), dirNameOf(sid)])
  const root = sessionsRoot()
  let level1
  try {
    level1 = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  // ---- 两层：sessions/<工作区>/<会话目录> ----
  for (const ws of level1) {
    if (!ws.isDirectory()) continue
    const wsDir = join(root, ws.name)
    let kids
    try {
      kids = readdirSync(wsDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const k of kids) {
      if (!k.isDirectory() || !wanted.has(k.name)) continue
      const hit = pickNewestLog(join(wsDir, k.name))
      if (hit) return hit
    }
  }
  // ---- 兜底：万一哪天布局退回"一层"（sessions/<会话目录>）----
  for (const name of wanted) {
    const hit = pickNewestLog(join(root, name))
    if (hit) return hit
  }
  return null
}

const ZSTD_MAGIC = 4247762216

/**
 * 扫描 zstd 帧边界（**照抄 `read-session.mjs` 的 `scanZstdFrames`** —— 逐字段读帧头算长度，
 * 不是"搜魔数"那种碰运气的切法）。返回 `{ frames, tornStart }`：
 * `tornStart` 有值 ＝ **尾帧正在被写入**（撕裂），已忽略并如实报出来。
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** 把会话日志解成"事件数组"（逐帧解压 → 逐行 JSON）。返回统计，便于如实报账。 */
export function readSessionEvents(logFile) {
  const buf = readFileSync(logFile)
  const { frames, tornStart } = scanZstdFrames(buf)
  const events = []
  let badLines = 0
  let failedFrames = 0
  for (const f of frames) {
    let text
    try {
      text = zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8')
    } catch {
      failedFrames += 1
      continue
    }
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        events.push(JSON.parse(s))
      } catch {
        badLines += 1
      }
    }
  }
  return { events, frames: frames.length, tornStart, badLines, failedFrames, bytes: buf.length }
}

/**
 * 给一个归档的会话写留底（**全文**，两份，复用 F22 的写盘与登记）。
 * @param {string} sid 会话 id
 * @param {string} logFile 它的会话日志路径
 * @param {{archive?:any}} [opts] `archive` ＝ 调用方加载好的档案文本库（批量时几份共用，省掉重复扫全档）
 */
export function dumpArchivedSession(sid, logFile, opts = {}) {
  try {
    // 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：**`maxT()` 已作废**（时间轴随 L2 送回收站）——
    //    不再读它，基准直接记 `-1`；销账判据走 A 方案（索引里 L3 那一节第一条的时间）。
    const preT = -1
    const r = readSessionEvents(logFile)
    const parts = []
    let chars = 0
    let rendered = 0
    let truncated = false
    for (const ev of r.events) {
      const piece = renderOne(ev)
      if (!piece) continue
      rendered += 1
      if (ARCHIVE_MAX_CHARS > 0 && chars + piece.length > ARCHIVE_MAX_CHARS) {
        truncated = true
        break
      }
      chars += piece.length
      parts.push(piece)
    }
    const sizeMb = Math.round((r.bytes / 1048576) * 100) / 100
    // 🔴 2026-10-07（用户拍板"甲"）：本会话此前那份 `compact:<sid>`（**压缩与裁剪共用一份**）的内容，
    //    已经被本份归档留底整个盖住 ⇒ ① 头注里写明"那一段不必再核" ② 本份**写成功之后**把它就地作废。
    const prevCompact = pendingDumpsOf(sid, { except: 'archive' })[0] ?? null
    const head =
      `# 归档留底（F23）—— 会话 ${shortSid(sid)}\n\n` +
      // 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：L2 已删 ⇒ 这里**不再拼 `T-1`**（那既难看又误导），
      //    直接写"（已删）"；销账判据已改走 A 方案（《索引》L3 节第一条时间）。
      `- **归档时刻档案写到：**（已删 —— L2 随 2026-10-14 的 L2 降级派生送回收站。它只是"那一刻写到哪儿"的记录，**不是判据**：销账认**提名**（落档带「归账完成」）\n` +
      (prevCompact
        ? `- 🔴 **本份盖住了本会话此前那份压缩/裁剪留底**（基准 **T${Number(prevCompact.preT) || '?'}**）：它的内容**就在本份里**（同一段），按用户 2026-10-07 拍板的"**甲**"，本份写成后那份会被**就地作废**（挪进 \`verified\\\`）⇒ **销账只销本份这一份**（不必为它再走一遍流程）。⚠️ **那一段此前没有被单独核过** —— 它算在本份的账上。\n`
        : '') +
      `- 生成时间：${nowCN()}\n` +
      `- 来源：**这个会话被归档了**（"没压缩就结束"那种）—— 日志 \`${logFile}\`（${sizeMb} MB / ${r.frames} 帧）\n` +
      `- 解出：${r.events.length} 条事件（渲染 ${rendered} 条 / ${chars} 字符）` +
      `${r.tornStart !== undefined ? `\n- ⚠️ **尾帧正在写入**（撕裂，已忽略）—— 最后那一小段可能没进来` : ''}` +
      `${r.failedFrames ? `\n- ⚠️ **有 ${r.failedFrames} 帧没解开**（原文可能不完整）` : ''}` +
      `${r.badLines ? `\n- ⚠️ **有 ${r.badLines} 行不是合法 JSON**（已跳过）` : ''}` +
      `${truncated ? `\n- ⚠️ **本次留底被截断**（超 ${ARCHIVE_MAX_CHARS} 字符上限）—— 全文以会话日志为准` : ''}\n` +
      `- **怎么销账**（⏱ **先读摘要，别读这份全文** —— 每次留底都会顺带写"摘要 ＋ 骨架"两份）：\n` +
      `  ① 读摘要 \`${join(skeletonDir(), digestFileName(sid, 'archive'))}\`（只有"用户原话 ＋ 我这轮为达成什么"；见到 \`⚠ 无摘要 Lxx-Lyy\` 时**只回读那一段**）\n` +
      `  ② 照它把**还没进档案**的事补上 → **先落一次档**；要查细节再 grep 骨架 \`${join(skeletonDir(), skeletonFileName(sid, 'archive'))}\`\n` +
      `  ③ 🔴 **落档时带一句「归账完成」**（填这份的**会话短 id**）—— 事务**真写成**之后，插件自己把主份挪进 \`verified\\\`\n` +
      `- 🔴 **不要再手删这份文件**：销账只认**提名**（2026-09-23 起）\n` +
      `\n---\n\n`
    let body = head + (parts.length ? parts.join('\n\n') : '（⚠️ **没渲染出任何内容** —— 见运行数据目录里的 `memoria-archive.log`）')
    if (truncated) body += `\n\n…（已达 ${ARCHIVE_MAX_CHARS} 字符上限，后面被截断 —— 全文仍在 \`${logFile}\`）`

    const res = persistDump(sid, body, {
      kind: 'archive',
      cap: 'F23',
      preT,
      items: r.events.length,
      source: `归档 · ${r.frames} 帧/${sizeMb}MB`,
    })
    // 🔴 2026-10-07（用户拍板"甲"）：**只有本份真写成**，才作废同会话的旧留底。
    //    顺序是硬的 —— 反了就有"内容只存在于已作废那份里"的窗口（所以放在 `res.ok` 里，不放外面）。
    if (res.ok) {
      try {
        const olds = pendingDumpsOf(sid, { except: 'archive' })
        let moved = 0
        for (const d of olds) {
          const mv = moveToVerified({ ...d, coveredByArchive: true })
          if (mv.ok) moved += 1
          else archiveLog(`F23 ⚠️ ${shortSid(sid)} 的旧留底没作废成（${mv.why}）—— 照旧留在 pending，留意栏还会报它`)
        }
        // 🔴 **只挪文件不够**：状态表里那几条记录也要清 —— 否则留意栏会继续报一个"盘上已经不存在"的留底
        //    （那正是 `auditDumpState()` 治的"僵尸记录"，但它只在启动时跑一次 ⇒ 这里主动叫一次）。
        if (moved > 0) auditDumpState()
        if (moved > 0) {
          archiveLog(
            `F23 ${shortSid(sid)}：归档留底已写成 ⇒ 顺手作废它此前的 **${moved}** 份留底（**被归档覆盖**，` +
              `不再单独销账 —— 用户 2026-10-07 拍板"甲"：同一个会话别重复销）`
          )
        }
      } catch (e) {
        archiveLog(`F23 作废旧留底出错（**不影响归档留底本身**）：${e}`)
      }
    }
    // 顺手写一份**骨架**（销账时读它、不读全文）—— 2026-09-19。
    // **fail-open**：骨架写不出来**不影响留底**（留底才是保命的那个），只记一行日志。
    // 🔴 2026-10-07（对抗审查）：归档主份是**覆盖写** ⇒ 骨架也必须**跟着覆盖** ——
    //    原来不传 `overwrite`（＝`'wx'` 独占创建）⇒ 归档重跑时骨架**写不进去**，
    //    留下的还是上一次那份 ⇒ 又成"主份新、骨架旧"（销账读骨架时会看漏新内容）。
    const sk = writeSkeleton(sid, r.events, logFile, { kind: 'archive', mode: 'replace', dir: skeletonDir() })
    if (sk.ok) {
      archiveLog(`F23 骨架已写出：${sk.out}（${sk.chars} 字符 · 用户真事 ${sk.stats.userMsgs} 条 / 我的正式答复 ${sk.stats.textBlocks} 条）`)
    } else {
      archiveLog(`F23 ⚠️ 骨架没写成（**留底不受影响**）：${sk.why}`)
    }
    // 🔴 2026-10-17：只留最近 10 份（归档与压缩**共用一个容器**；还没销账的受保护）。
    try {
      const st0 = loadDumpState()
      const protect = new Set(
        Object.keys(st0.dumps || {})
          .map((k) => String(k).split(':')[1] || '')
          .filter(Boolean)
          .map((s) => s.replace(/^session-/, '').slice(0, 8))
      )
      const pr = pruneSkeletonDir(skeletonDir(), 10, protect)
      if (pr.ok && pr.removed > 0) archiveLog(`F23 骨架/摘要清理：删了 ${pr.removed} 个旧派生物（保留最近 10 份）`)
    } catch (e) {
      archiveLog(`F23 ⚠️ 骨架/摘要清理没跑（不影响留底）：${e?.message ?? e}`)
    }
    // 🔴 **2026-09-20 第三代（E165）**：归档这一刻就跑机器对账、定落点（与压缩路共用 `settleDump`）——
    //    0 候选 → 挪 `verified\`（留意栏不再报它）；有候选 → 留在 `pending\`，留意栏直接列那几条。
    const settle = settleDump(sid, 'archive', { skeletonPath: sk.ok ? sk.out : undefined, archive: opts.archive })
    return { ...res, preT, items: r.events.length, rendered, chars, frames: r.frames, truncated, skeleton: sk, settle }
  } catch (e) {
    const why = String(e && e.message ? e.message : e)
    archiveLog(`F23 给 ${shortSid(sid)} 写留底失败（**不影响别的会话**）：${why}`)
    return { ok: false, why }
  }
}

/**
 * 主入口：看一眼归档集合，**给新出现的归档会话各留一份底**。
 * @returns {{ok:boolean, fresh:number, dumped:number, archived:number|null, why?:string}}
 */
export function checkArchivedSessions() {
  lastCheckAt = Date.now()
  let ids
  try {
    ids = readArchivedIds()
  } catch (e) {
    return { ok: false, fresh: 0, dumped: 0, archived: null, why: String(e) }
  }
  if (ids === null) {
    archiveLog('F23 ⚠️ 读不到 `workspace.json` 的归档集合 —— **"读不到"不等于"没有归档"**，本轮跳过')
    return { ok: false, fresh: 0, dumped: 0, archived: null, why: '读不到归档集合' }
  }

  const st = loadArchiveState()
  st.handled = st.handled && typeof st.handled === 'object' ? st.handled : {}

  // 🔴 **不给"历史归档会话"记基线跳过** —— 用户 2026-09-17 深夜纠正（我原本加了这段，被否掉了）：
  //    "**历史上所有已经归档的会话并非每一个都完成了日志的归档。需要这一步**"
  //    也就是：**"已归档" ≠ "内容已落进档案"** —— 有些会话归档的时候，内容还没落完。
  //    跳过它们 ＝ 把那些没落完的内容丢了，而那**正是 F23 存在的理由**。所以历史归档会话**一样要补底**。
  //    ⚠️ 代价（明说）：F23 第一次跑会给"当前归档集合里所有会话"各留一份底（本机 11 个，可能几百 MB），
  //    并触发"堆到 3 份"的点名 —— **那是该看见的信息，不是故障**。

  // ⚠️ **`no-log` 不是"确定没有"，是"当时没找到"** —— 真机第一跑就因为查找逻辑的 bug 把 11 个会话
  //    全判成 no-log（明明有日志）。所以它**允许有限重试**（最多 3 次）：一次假阴性不会把那个会话永久跳过。
  const fresh = ids.filter((id) => {
    const h = st.handled[id]
    if (!h) return true
    return h.why === 'no-log' && (Number(h.tries) || 0) < 3
  })
  if (fresh.length === 0) {
    saveArchiveState({ ...st, lastCheckAt: new Date().toISOString(), archivedCount: ids.length })
    return { ok: true, fresh: 0, dumped: 0, archived: ids.length }
  }

  capTick('F23', `发现 ${fresh.length} 个新归档会话`)
  archiveLog(
    `F23：发现 **${fresh.length} 个新归档**的会话（归档集合共 ${ids.length} 个）—— ${fresh.map(shortSid).join(' / ')}`
  )
  // 🔴 2026-09-20（E165）：归档路**一次可能处理好几份** —— 对账用的档案文本库（扫 L1+L2+L3）只加载一次，
  //    几份共用；加载不了就**不跑对账**（那几份留在 pending，照旧人工读骨架，绝不因此被当"0 候选"）。
  let archiveCache = null
  try {
    archiveCache = loadArchive(CFG.archiveDir)
  } catch (e) {
    archiveLog(`F23 ⚠️ 对账用的档案文本库没加载成（${e?.message ?? e}）—— 本次几份都留在 pending`)
  }
  let dumped = 0
  for (const id of fresh) {
    try {
      // 🔴 **2026-10-01（用户点出的漏洞）**：这个会话归档了 ⇒ **把它还没攒够的 prune 累积清掉**
      //    （用户原话："**还没攒够 20 份就切换了会话，老会话被归档，那会不会这几份就没了归处静默烂掉**"
      //     ＋ "**……超过 20 条然后触发一轮裁剪归账，他就要被迫去读已经好久之前的事情，这样不就中断了他的注意力了吗？**"）。
      //    ⚠️ **内容不会因此丢**：F23 的归档留底是 `readSessionEvents(logFile)` 渲染**全部**事件，
      //       被 prune 掉的那些本来就在日志里、本来就会进归档留底；这里清的只是"没用的零头"。
      const leftover = clearPendingPrune(id)
      if (leftover) {
        archiveLog(
          `F23 顺手清掉 ${shortSid(id)} 尚未攒够的 prune 累积（${leftover.seqs.length} 条 / ${leftover.tokenCount} token）` +
            `—— **不留孤儿**（用户 2026-10-01 点出的漏洞）`,
        )
      }
      const logFile = findSessionLog(id)
      if (!logFile) {
        const tries = (Number(st.handled[id]?.tries) || 0) + 1
        archiveLog(
          `F23 ⚠️ 找不到 ${shortSid(id)} 的会话日志（第 ${tries} 次）—— 跳过；` +
            (tries >= 3 ? '**试满 3 次，往后不再找它**' : '**还会再试**（"找不到"不等于"没有"）')
        )
        st.handled[id] = { at: new Date().toISOString(), ok: false, why: 'no-log', tries }
        continue
      }
      const r = dumpArchivedSession(id, logFile, { archive: archiveCache })
      st.handled[id] = {
        at: new Date().toISOString(),
        ok: !!r.ok,
        chars: r.chars ?? 0,
        why: r.why ?? '',
        settle: r.settle?.verdict ?? '',
      }
      if (r.ok) dumped += 1
    } catch (e) {
      archiveLog(`F23 处理 ${shortSid(id)} 出错（跳过，不影响别的）：${e}`)
      st.handled[id] = { at: new Date().toISOString(), ok: false, why: String(e) }
    }
  }
  saveArchiveState({ ...st, lastCheckAt: new Date().toISOString(), archivedCount: ids.length })
  return { ok: true, fresh: fresh.length, dumped, archived: ids.length }
}

/**
 * 每次 `pre-step` 顺手看一眼归档集合（节流 60 秒）。**由 F1 转交调用。**
 *
 * 🔴 为什么 F23 **不自己挂 `agent/pre-step`**：测试脚手架 `mockCtx` 的 `on()` 是"**后注册顶掉先注册**"，
 *    F23 一挂上去，**F1 的"压缩后重注入"整条链路就没了**（`f1-reinject` 与 `capstats` 当场红）。
 *    ⚠️ 这是**第二次**踩同一个形状（第一次是 F22 挂 `session/event`）—— 所以这条注释必须留着：
 *    **凡是要"每步/每次事件都跑一下"的新能力，一律走 F1 转交，不许自己挂第二个监听器。**
 */
export function tickArchiveCheck() {
  try {
    if (Date.now() - lastCheckAt > CHECK_INTERVAL_MS) return checkArchivedSessions()
  } catch (e) {
    archiveLog(`F23 检查出错（fail-open）：${e}`)
  }
  return null
}

/** 注册 F23：**只在启动时检查一次**（之后由 F1 的 pre-step 转交 `tickArchiveCheck`）。 */
export function registerF23() {
  try {
    const r = checkArchivedSessions()
    archiveLog(`F23 启动检查：归档集合 ${r.archived ?? '读不到'} 个 · 新发现 ${r.fresh} 个 · 留底 ${r.dumped} 份`)
    log('F23 归档留底已装配（检查由 F1 的 pre-step 转交 · 节流 60 秒）', { silent: true })
  } catch (e) {
    log(`注册 F23 失败（fail-open）: ${e}`)
  }
}

/** 启动自检：**沉默 ≠ 正常** —— 有留意就要说出来（只报"归档"那一类，压缩那类归 F22 报）。 */
export function reportF23() {
  try {
    const st = loadArchiveState()
    const mineA = (d) => d && d.kind === 'archive' && (!d.archive || d.archive === arcKey())
    const dumps = Object.values(loadDumpState().dumps ?? {}).filter((d) => mineA(d) && !d.noFactsAt)
    // 🔴 2026-10-07（用户拍板）：**无账可销**的份**留痕**（自动过了，但不悄无声息）—— 判据见 `f22` 的 `noteNoFacts`。
    const noFactsA = Object.values(loadDumpState().dumps ?? {}).filter((d) => mineA(d) && d.noFactsAt).length
    const nfNoteA = noFactsA > 0 ? ` · 另有 ${noFactsA} 份**无账可销**` : ''
    const ids = readArchivedIds()
    const arch = ids === null ? '**读不到归档集合**' : `${ids.length} 个`
    const handled = Object.keys(st.handled ?? {}).length
    if (dumps.length === 0) return `归档留底 F23：归档 ${arch} · 已处理过 ${handled} 个 · 待销账 **0 份**${nfNoteA}`
    const oldest = String(dumps.map((d) => d.at).sort()[0] ?? '').slice(5, 16).replace('T', ' ')
    const pile = dumps.length >= DUMP_PILE_LIMIT ? ` ⚠️ **堆到 ${dumps.length} 份了**` : ''
    return `归档留底 F23：归档 ${arch} · ⚠️ 待销账 **${dumps.length} 份** · 最早 ${oldest}${pile}${nfNoteA}`
  } catch (e) {
    return `归档留底 F23：读不到状态（${e && e.message ? e.message : e}）`
  }
}

/** 供测试用：主份/备份份路径（默认走归档那一档）。 */
export function archivePaths(sid) {
  return { main: mainPath(sid, 'archive'), name: dumpFileName(sid, 'archive') }
}

/** 供测试用：文件在不在。 */
export function __exists(p) {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}
