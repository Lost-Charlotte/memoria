// ============================================================
// F29 · verified（**销账后留底的中转站** ＋ 保留期清理）—— 2026-09-20 建（用户设计 · E165）
// ============================================================
//
// 三代演进（前两代都留着，别删）：
//   一代：销账 ＝ 读**留底全文**（几百 K 原文）→ 人眼逐条对档案。
//   二代：销账 ＝ 读**骨架**（只有真人对话，≈全文 6%；`lib/skeleton.js`）。
//   三代（本模块）：**机器先对账**（`lib/reconcile.js`），人只看它挑出来的那几条 ——
//     ① 归档 / 压缩那一刻就跑对账（239ms）；
//     ② **0 候选 → 主份从 `pending\` 挪到 `verified\`**，留意栏一个字都不说；
//     ③ 有候选 → 照旧留在 `pending\`，留意栏**直接列那几条候选原文**；
//     ④ `verified\` 保留 **最近 5 份**，多出来的由本模块清理（留痕 ＋ 清单）。
//
// 🔴 **为什么是"挪"而不是"删"**（用户 2026-09-20 的顾虑，也是这一版的前提）：
//   对账工具**会假阴性** —— 档案里把用户原话改写成别的措辞，它就报"未覆盖"；
//   而"0 候选"是它说"都进档了"，**不等于真进档**。所以**全文一个字都不删**，
//   只是换个地方躺 3 天：漏了随时捞得回来，而且**不必先信机器**。
//
// 🔴 用户定的两个数（原话，2026-09-20）：
//   · 00:47 "**先做，然后这东西不是留档三十天么。但三十天太长。而且检查这个的代价太大**"
//   · 00:54 "**我说实话，3天吧，甚至可以更短，然后在待办定个闹钟。三天后提醒我复查。**"
//   → 保留口径 `VERIFIED_KEEP_COUNT = 5`；复查口径见 `RECHECK_LINE`（**只抽 1 份**，
//     目的是校准"**我提名销账时补干净了没有**"，**不是重读全部**；`verified\` 里没东西就是成本 0）。
//
// ⚠️ 三条自我约束：
//   · 只动 `~/.dsh/memoria/memoria-dumps/` 里**自己写的那一份**（主份 → verified；**2026-09-23 起不再有备份份**）；
//   · 全程 **fail-open**（挪不动、清不掉 → 只记日志，绝不影响压缩/归档/回合）；
//   · **不许静默**：挪入、到期清理、清理失败，全部留痕（`memoria.log` ＋ 清理清单文件）。
//
// 📌 命名与 F22 的 `dumpFileName()` **同构**（`归档留底-<8位>.md` / `压缩留底-<8位>.md`）——
//    这里不再 import f22（f22 要 import 本模块，反向 import 会成环），
//    同一口径由 `tests/f29-verified.mjs` 断言"两边算出来的文件名一模一样"。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { HOME_DIR, capTick, isDumpName, log, nowCN, parseDumpName, shortSid } from './common.js'
// 🔴 2026-10-21 加：骨架目录**跟着馆走**（`<馆>\L6-工具临时\留底\`，见 `skeleton.js` 的 `skeletonDir()`）。
//    下面清骨架时必须走它 —— 手拼 `~/.dsh/memoria-dumps/skeleton` 是**旧路径**，会找错地方。
import { skeletonDir } from './skeleton.js'

/** 留底总目录（与 `f22-compact-dump.js` 的 `DUMP_BASE` 同源，口径见文件头）。 */
export const DUMP_BASE_DIR = join(HOME_DIR, 'memoria-dumps')
/** **销账后**留底躺的地方（不进留意栏；保留期到了由本模块清）。 */
export const VERIFIED_DIR = join(DUMP_BASE_DIR, 'verified')
/** 保留几天。⚠️ **只改这一处** —— 面板/工具描述都从这里取。 */
export const VERIFIED_KEEP_DAYS = 3 // ⚠️ 2026-09-29 起不再当保留口径用（用户改成「只留最近 5 份」）；留着只为读旧 dump 头里的「保留至」字样
/** 🔴 保留口径（2026-09-29 用户定）：`verified\` 里**只留最近 5 份**，排在最新 5 份之外的一律算到期。 */
export const VERIFIED_KEEP_COUNT = 5
export const VERIFIED_STATE = join(HOME_DIR, 'memoria-verified.state.json')

/** 复查口径的标记（用来判断"这股留底头里有没有这段话"，幂等用）。 */
export const RECHECK_MARK = '🔎 **复查口径**'
/**
 * 复查口径正文 —— **钉在两处**（用户 2026-09-20："你把复查方法写在复查的时候一定会看到的地方"）：
 *   ① `verified\` 里每份留底的头部（抽检必然打开它 → 就在这里）；
 *   ② 待办那条闹钟的「目的」格（提醒一响，必然去查那一条）。
 * ⚠️ **不写在"到点那句话"里** —— 实测到点提醒只念内容格**前 30 字**，闹钟标记自己就占 19 字。
 */
export const RECHECK_LINE =
  `- ${RECHECK_MARK}（**销账后挪进 verified 的份**）：保留 **最近 ${VERIFIED_KEEP_COUNT} 份**（含到期日，之后由 F29 清理）。` +
  `到期时**只抽 1 份**打开核一遍（一份骨架 ≈3.5K token）—— 校准"****我提名销账时补干净了没有****"，**不是重读全部**；` +
  `\`verified\\\` 里没有东西就是成本 0。抽检连过两轮 → 保留期再压短或取消。\n`

/** 留底文件名（与 F22 的 `dumpFileName()` 同构）。 */
export const verifiedFileName = (sid, kind = 'compact') =>
  `${kind === 'archive' ? '归档留底' : '压缩留底'}-${shortSid(sid)}.md`

export const verifiedPath = (sid, kind = 'compact') => join(VERIFIED_DIR, verifiedFileName(sid, kind))

function verifiedLog(msg) {
  log(`F29 ${msg}`, { silent: true })
}

/** 北京时间"今天 + n 天"的 `YYYY-MM-DD`（**含到期日全天保留**）。 */
function expiresYmdOf(days) {
  const ms = Date.now() + 8 * 3600000 + days * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` → 那一天结束（北京时间 23:59:59）的时刻。解析不出返回 0（＝"永远没过期"，宁可留着）。 */
function endOfDayMs(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? '').trim())
  if (!m) return 0
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T23:59:59+08:00`)
  return Number.isFinite(t) ? t : 0
}

/**
 * 把复查口径**幂等地**插进留底头部（有标记就原样返回）。
 * 插在第一道 `\n---\n` 之前（那后面才是正文），没有分隔线就追加在末尾。
 * ⚠️ 用"行"的方式插 —— 不重排既有内容一个字。
 */
export function withRecheckLine(body) {
  const s = String(body ?? '')
  if (s.includes(RECHECK_MARK)) return s
  const cut = s.indexOf('\n---\n')
  if (cut >= 0) return `${s.slice(0, cut)}\n${RECHECK_LINE}${s.slice(cut)}`
  return `${s}${s.endsWith('\n') ? '' : '\n'}${RECHECK_LINE}`
}

/**
 * 把一份留底的**主份挪进 `verified\`**（0 候选的处置）。
 *
 * 顺序照《防丢总则》那一条（**绝不"搬＝改名＋覆盖"**）：
 *   读旧 → 补口径 → **写新** → **核对写进去的字节数** → 才删旧。
 * 任一步失败：**旧的原样留着**（留在 pending，留意栏照旧报它），并把原因说清。
 *
 * @param {{mainAbs:string, sidShort?:string, kind?:string}} d 状态表里的那一条
 * @returns {{ok:boolean, to?:string, why?:string, chars?:number, expiresYmd?:string}}
 */
export function moveToVerified(d) {
  const from = d?.mainAbs
  if (!from) return { ok: false, why: '状态里没有主份路径' }
  let body = ''
  try {
    body = readFileSync(from, 'utf8')
  } catch (e) {
    return { ok: false, why: `读不到主份（${e?.message ?? e}）` }
  }
  if (!body.trim()) return { ok: false, why: '主份是空的（不挪，免得把空文件当档案）' }
  const expiresYmd = expiresYmdOf(VERIFIED_KEEP_DAYS)
  // 🔴 2026-10-07（用户拍板"甲"）：挪进来的来路有**两种** ——
  //    ① **人工销账**（读骨架 → 补档 → 提名）② **被归档留底覆盖**（同一会话别重复销：归档留底已含本份内容）。
  //    两者都不进留意栏，但**性质完全不同** ⇒ 戳记必须分开写，否则将来会把"覆盖"读成"核过了"。
  const stampLine = d?.coveredByArchive
    ? `- **挪入 verified**：${nowCN()}（**被归档留底覆盖** → 不进留意栏；⚠️ **不是**人工核过 —— 本份内容已包含在同会话的归档留底里）· **保留至 ${expiresYmd}**（真正口径＝只留最近 5 份）\n`
    : `- **挪入 verified**：${nowCN()}（**销账后挪入** → 不进留意栏）· **保留至 ${expiresYmd}**（含当天；⚠️ 2026-09-29 起真正的口径是"只留最近 5 份"，这个日期只作参考）\n`
  let out = withRecheckLine(body)
  // 挪入时刻写进行里（清理时优先读它；读不到就退到文件 mtime）
  if (!out.includes('**挪入 verified**')) {
    const cut = out.indexOf('\n---\n')
    out = cut >= 0 ? `${out.slice(0, cut)}\n${stampLine}${out.slice(cut)}` : `${out}${stampLine}`
  }
  const to = verifiedPath(sidOfKey(d), d?.kind === 'archive' ? 'archive' : 'compact')
  try {
    mkdirSync(VERIFIED_DIR, { recursive: true })
    writeFileSync(to, out, 'utf8')
    // **核对**：写进去的大小必须与内容一致（对不上就不删旧的）
    const wrote = statSync(to).size
    const want = Buffer.byteLength(out, 'utf8')
    if (wrote !== want) return { ok: false, why: `新份大小对不上（写了 ${wrote} / 应 ${want}）—— 旧的没删`, to }
    unlinkSync(from)
    // 🔴 **2026-09-29 改回去：销账时【不删骨架】**（用户当天定："**骨架保留三天，不要当场就删除**"）。
    //    2026-09-28 曾在这里加过"挪进 verified ⇒ 顺手清骨架"，理由写的是"骨架只是销账前少读的派生物"。
    //    **那个理由是错的**，两条反证：
    //      ① 本文件头部的复查口径写着"到期时**只抽 1 份打开核一遍（一份骨架 ≈3.5K token）**"
    //         —— 复查要读的**正是骨架**，可它在这步就被删了 ⇒ **复查时无物可读**（自相矛盾）；
    //      ② 骨架是"**被揉掉那段对话的精华**"（只有真人对话 ＋ 我的正式答复 ≈ 全文 6%）。
    //         2026-09-29 实测：压缩前推进的工程（织布机 / 改名）**只能靠它快速回溯**，读 597K 全文不可行。
    //    ⇒ 现在：骨架**跟着留底一起到期**（由 `cleanVerified` 那份删除一并清），3 天。
  } catch (e) {
    return { ok: false, why: `挪动失败（${e?.message ?? e}）—— 旧的没删`, to }
  }
  capTick('F29', `0 候选挪入 verified · ${d?.sidShort ?? '?'}`)
  bumpVerifiedCounter('movedTotal')
  verifiedLog(`0 候选 → 挪入 verified：${d?.sidShort ?? '?'}（${d?.kind === 'archive' ? '归档' : '压缩'}留底）· ${out.length} 字符 · 保留至 ${expiresYmd}`)
  return { ok: true, to, chars: out.length, expiresYmd }
}

/** 状态表的 key 是 `<kind>:<完整会话id>`（见 `persistDump`）——这里把 sid 取回来。 */
function sidOfKey(d) {
  const k = String(d?._key ?? '')
  const i = k.indexOf(':')
  if (i >= 0) return k.slice(i + 1)
  // 兜底：状态条目自己不带 key 时，从主份路径的文件名里取那 8 位
  try {
    const m = /(?:归档留底|压缩留底)-([0-9A-Za-z]{8})\.md$/.exec(String(d?.mainAbs ?? ''))
    return m ? m[1] : '?'
  } catch {
    return '?'
  }
}

/**
 * 列出 `verified\` 里现存的留底（**只认那两种文件名**，别的一律不碰）。
 * 到期时刻**优先读头里的「保留至」**（解析不出就退到文件 mtime + 保留期）。
 */
export function listVerified(now = Date.now()) {
  const out = []
  let entries
  try {
    entries = readdirSync(VERIFIED_DIR, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    if (!isDumpName(e.name)) continue // 2026-09-28：认名走唯一来源（`lib/common.js`）
    const abs = join(VERIFIED_DIR, e.name)
    let bytes = 0
    let mtime = 0
    let head = ''
    try {
      const st = statSync(abs)
      bytes = st.size
      mtime = st.mtimeMs
      head = readFileSync(abs, 'utf8').slice(0, 4096)
    } catch {
      continue
    }
    const ymd = /保留至\s*(\d{4}-\d{2}-\d{2})/.exec(head)?.[1] ?? ''
    const expiresAt = ymd ? endOfDayMs(ymd) : mtime + VERIFIED_KEEP_DAYS * 86400000
    out.push({
      file: e.name,
      abs,
      sidShort: parseDumpName(e.name)?.sidShort ?? '?', // 2026-09-28：走唯一来源（`lib/common.js`）
      kind: e.name.startsWith('归档') ? 'archive' : 'compact',
      bytes,
      at: mtime,
      expiresYmd: ymd,
      expiresAt,
      expired: expiresAt > 0 && now > expiresAt,
    })
  }
  return out.sort((a, b) => a.at - b.at)
}

export function loadVerifiedState() {
  try {
    const s = JSON.parse(readFileSync(VERIFIED_STATE, 'utf8'))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

function saveVerifiedState(s) {
  try {
    writeFileSync(VERIFIED_STATE, JSON.stringify(s, null, 2))
  } catch {
    /* 存不下只影响"下次又清一遍"，无害 */
  }
}

/**
 * 清理到期份（**真实删除，走 unlink**）—— 这是本模块唯一的删除动作，护栏三条：
 *   ① 只删 `VERIFIED_DIR` 下**名字合那两种格式**的**普通文件**（不递归、不碰目录）；
 *   ② 只删 `expired === true` 的（保留期没到的一个都不动）；
 *   ③ 删之前先把清单写进 `~/.dsh/memoria-verified-drop-<时刻>.txt`（删了也有据可查）。
 * @param {{now?:number, dryRun?:boolean}} opt
 */
export function cleanVerified(opt = {}) {
  const now = Number(opt.now) || Date.now()
  const all = listVerified(now)
  // 🔴 2026-09-29（用户定）：保留口径＝**只留最近 5 份** —— listVerified 按 mtime 升序，
  //    排在最新 5 份之外的一律清掉（连同骨架，见下面循环）
  const extra = all.length > VERIFIED_KEEP_COUNT ? all.slice(0, all.length - VERIFIED_KEEP_COUNT) : []
  const drop = all.filter((x) => x.expired || extra.includes(x))
  if (opt.dryRun) return { ok: true, dryRun: true, dropped: drop.length, kept: all.length - drop.length, files: drop.map((x) => x.file) }
  if (drop.length === 0) {
    saveVerifiedState({ ...loadVerifiedState(), at: new Date().toISOString(), ok: true, dropped: 0, kept: all.length })
    return { ok: true, dropped: 0, kept: all.length, why: '没有到期的' }
  }
  const listFile = join(HOME_DIR, `memoria-verified-drop-${Date.now()}.txt`)
  try {
    writeFileSync(listFile, drop.map((x) => `${x.file}\t${x.bytes} B\t保留至 ${x.expiresYmd || '(mtime 推算)'}`).join('\n'), 'utf8')
  } catch (e) {
    return { ok: false, dropped: 0, kept: all.length, why: `写清单失败：${e?.message ?? e}` }
  }
  let removed = 0
  const refused = []
  for (const x of drop) {
    try {
      unlinkSync(x.abs)
      // 🔴 2026-09-28 加：**连它的骨架一起清** —— 骨架只是"销账前少读"的派生物，销账之后没有用了；
      //    此前**全 lib 没有一处删骨架**，于是它只进不出、越堆越多（2026-09-28 实测堆了 3 份、被用户点到）。
      //    文件名与路径从 `x.file` 现算（不手写整串）；认不出格式就不动。
      const mm = parseDumpName(x.file) // 2026-09-28：走唯一来源（`lib/common.js` 的 parseDumpName）
      if (mm) {
        // 🔴 2026-10-21 修（第一路审查报的"绕过自己的常量手拼"）：**原来这里是旧路径**
        //    `join(HOME_DIR, 'memoria-dumps', 'skeleton', ...)` —— 而骨架自 2026-10-17 起
        //    **跟着馆走**（`<馆>\L6-工具临时\留底\`）⇒ 手拼那条永远扑空、骨架只进不出。
        //    现在走 `skeletonDir()`（它自己处理"测试沙箱回落旧目录"与"拿不到馆就回退"）。
        const sk = join(skeletonDir(), `骨架-${mm.kind === 'archive' ? '归档' : '压缩'}-${mm.sidShort}.md`)
        try {
          if (existsSync(sk)) unlinkSync(sk)
        } catch {
          /* fail-open：骨架没删掉不影响留底本身的清理 */
        }
      }
      removed += 1
    } catch (e) {
      refused.push(`${x.file}（${e?.message ?? e}）`)
    }
  }
  const prevSt = loadVerifiedState()
  saveVerifiedState({
    ...prevSt,
    at: new Date().toISOString(),
    ok: refused.length === 0,
    dropped: removed,
    kept: all.length - removed,
    refused,
    listFile,
    droppedTotal: (Number(prevSt.droppedTotal) || 0) + removed,
  })
  verifiedLog(
    `保留期到 → 清理 **${removed} 份** 销账暂存留底（保留期 最近 ${VERIFIED_KEEP_COUNT} 份）` +
      `${refused.length ? ` · ⚠️ ${refused.length} 份没删掉（${refused.slice(0, 2).join(' / ')}）` : ''} · 清单 ${listFile}`
  )
  return { ok: refused.length === 0, dropped: removed, kept: all.length - removed, refused, listFile }
}

/** 一天最多清一次（收尾/启动都会调）。 */
export function maybeCleanVerified(minHours = 6) {
  const st = loadVerifiedState()
  const last = Date.parse(st.at ?? '') || 0
  if (Date.now() - last < minHours * 3600000) return { ok: true, dropped: 0, skipped: true, why: `距上次清理不到 ${minHours} 小时` }
  return cleanVerified()
}

/** 一行读数（状态面板 / 启动自检用）。**0 份也说** —— "它到底扫没扫"要看得见。 */
export function reportF29() {
  try {
    const all = listVerified()
    const tally = tallyLine()
    if (all.length === 0) return `销账暂存 F29：verified **0 份**（${tally}；保留期 最近 ${VERIFIED_KEEP_COUNT} 份，到期自动清）`
    const done = all.filter((x) => x.expired).length
    const next = all[0]
    const nextDay = next.expiresYmd || new Date(next.at + VERIFIED_KEEP_DAYS * 86400000).toISOString().slice(0, 10)
    return (
      `销账暂存 F29：verified **${all.length} 份**（最早 ${String(next.file).slice(0, 16)}… 保留至 ${nextDay}）` +
      `${done ? ` · ⚠️ **${done} 份已到期待清**` : ''} · ${tally}`
    )
  } catch (e) {
    return `销账暂存 F29：读不到（${e?.message ?? e}）`
  }
}

/**
 * 累计计数（`judgedTotal` / `zeroTotal` / `movedTotal` / `droppedTotal`）。
 *
 * 🔴 **为什么有它**（用户 2026-09-23 原话〔会话 2026-09-23〕：「**这个闹钟的意思是让你查一下，
 *    这个零到底对不对。不要让他静默失效。或者有问题但没报**」）：
 *    光报「当前几份」**分不清**两种情形 ——
 *      · 甲：真的从来没有 0 候选留底进来过（`movedTotal` 0，但 `judgedTotal` 是 6）；
 *      · 乙：对账**根本没跑** / 挪入机制坏了（**`judgedTotal` 也是 0**）。
 *    两种读出来**一模一样** —— 这就是"静默失效"的形状（《施工手册》三问第 ③ 问：沉默 ≠ 正常）。
 *    加上"一共裁决过几份、其中 0 候选几份"，机器才**自证得了**。
 */
function bumpVerifiedCounter(field, by = 1) {
  try {
    const st = loadVerifiedState()
    saveVerifiedState({ ...st, [field]: (Number(st[field]) || 0) + by, lastBumpAt: new Date().toISOString() })
  } catch {
    /* fail-open：记不上不影响压缩 / 归档 / 清理 */
  }
}

/** 累计读数那一小段（给 `reportF29()` 用）。 */
function tallyLine() {
  const st = loadVerifiedState()
  const n = (k) => Number(st[k]) || 0
  // ⚠️ `movedTotal` 是**两条路合起来**的：机器筛的（0 候选）＋ **我提名的** ——
  //    所以要单列"我提名"那几个，否则读数会**自相矛盾**（"裁决过 0 份 · 却挪入 1"，2026-09-23 实测撞上）。
  return (
    `累计：裁决过 ${n('judgedTotal')} 份 · 其中 0 候选 ${n('zeroTotal')} 份` +
    ` · 挪入 ${n('movedTotal')}（其中我提名 ${n('namedTotal')}）· 清掉 ${n('droppedTotal')}`
  )
}

/**
 * F22/F23 每次**跑完对账、准备裁决**时调一次（`isZero` ＝ 机器报 0 候选）。
 * ⚠️ 它**只记账**，不参与裁决 —— 裁决仍然是 `settleDump` 那几行。
 */
export function noteJudged(isZero) {
  bumpVerifiedCounter('judgedTotal')
  if (isZero) bumpVerifiedCounter('zeroTotal')
}

/**
 * **我提名销账**时调一次（`lib/f22-compact-dump.js` 的 `settleNamed()`）。
 * ⚠️ 它跟 `noteJudged` 是**两条路**：那条是"**机器对账筛出来的**"，这条是"**我核完了点名的**"。
 *    分开记，读数才自证得了 —— 否则"裁决过 0 份 · 挪入 1"看着就像坏账。
 */
export function noteNamed() {
  bumpVerifiedCounter('namedTotal')
}

/** 给留意栏用的一行（**只在"到期还没清掉"时出声**；平时一个字都不说 = E165 的"0 候选不进留意栏"）。 */
export function verifiedBacklogLine() {
  try {
    const all = listVerified()
    const done = all.filter((x) => x.expired)
    if (done.length === 0) return ''
    return (
      `  · ⏳ verified 里 **${done.length} 份销账暂存留底已过保留期**（保留期 最近 ${VERIFIED_KEEP_COUNT} 份）—— ` +
      `最近 ${VERIFIED_KEEP_COUNT} 份后**只抽 1 份**核（校准"**我提名销账时补干净了没有**"），核完这批就清；` +
      `清单在 \`~/.dsh\\memoria-verified.state.json\``
    )
  } catch {
    return ''
  }
}

/** 注册 F29：**启动时**清一次到期的（之后由闸门收尾那一刻调 `maybeCleanVerified`）。 */
export function registerF29() {
  try {
    const r = maybeCleanVerified()
    if (!r.skipped && r.dropped > 0) verifiedLog(`启动时清理到期的 0 候选留底：${r.dropped} 份`)
    verifiedLog(reportF29())
  } catch (e) {
    verifiedLog(`启动自检失败（不影响其它能力）：${e?.message ?? e}`)
  }
}

/** 供测试用。 */
export function __exists(p) {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

/** 供测试用：把"到期"这件事直接造出来（改头里的「保留至」）。 */
export function __forceExpire(abs, ymd) {
  const s = readFileSync(abs, 'utf8')
  const next = s.replace(/保留至\s*\d{4}-\d{2}-\d{2}/, `保留至 ${ymd}`)
  writeFileSync(abs, next, 'utf8')
}

/** 供测试/CLI 用：把清理记录追加进一份小日志（便于人工查）。 */
export function appendVerifiedTrace(line) {
  try {
    appendFileSync(join(HOME_DIR, 'memoria-verified.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* 失败不阻塞 */
  }
}
