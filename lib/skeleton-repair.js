// ============================================================
// skeleton-repair —— 启动兜底：哪份留底缺骨架，就补一份
// ============================================================
//
// 为什么有它（2026-09-19，用户点出"F22 不是双份备份吗"之后想清的）：
//
//   F22/F23 写留底那一刻都会顺手写骨架，但**两种情况下会缺**：
//     ① 骨架那一步 fail-open 失败过（只记一行日志，绝不打断留底）；
//     ② 留底是 0.32.0 之前留的 —— 那时还没有"骨架"这东西。
//
//   骨架**能补**，是因为**块类型还在**：
//     · **归档路（F23）**：会话日志在盘上（留底头一行就写着它的路径）→ 整份重解即可；
//     · **压缩路（F22）**：日志**也在**（DSH 的 `replace` 不删原始日志），
//       但要**知道捞哪一段** —— 靠 state 里存的 `seqs`（2026-09-19 起才开始存）。
//       ⚠️ 更早的压缩留底**没有这个坐标** → 补不了，**如实报出来**，不许假装补过。
//
//   🔴 一个必须说清的点：**留底全文一直没丢**（主份 ＋ 会话日志，两重都在 —— 备份份 2026-09-23 已拆）。
//      缺的从来不是"内容"，而是"**筛选依据**"—— 渲染成 markdown 之后，
//      `reasoning`（我的思考）与 `text`（我对用户说的话）长得一模一样，
//      块类型只活在**日志**与**压缩那一刻的内存**里。
//
// 纪律：
//   · **只读**留底/日志/state，**只写**骨架；不碰档案、不改留底、不删任何东西。
//   · **幂等**：已经有的骨架**一份都不动**（不覆盖、不改写）。
//   · 补不出来就**如实报**（`unrepairable` 列表），**不许静默**。
//   · 补出来的骨架与当场写的**同源**（同一套 `renderSkeleton`），不是另写一份口径。
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { DUMP_PENDING_DIR, dumpLog, loadDumpState } from './f22-compact-dump.js'
import { findSessionLog, readSessionEvents } from './f23-archive-dump.js'
import { skeletonDir, skeletonFileName, writeSkeleton } from './skeleton.js'

const DUMP_RE = /^(归档留底|压缩留底)-(.+)\.md$/

/** 节流：F1 的 pre-step **每轮**都会调它，不能每轮都扫盘重解日志。 */
const REPAIR_INTERVAL_MS = 5 * 60 * 1000
let lastRun = 0

/**
 * **结构性补不了**的那些（例如旧压缩留底压根没有 seq 坐标）—— 记下来，别反复重试。
 * 进程内有效，重启后清空（那时白试一次也便宜）。
 */
const gaveUp = new Set()

/** 从留底主份头部抠出它的会话日志路径（F23 的头部就写着 `日志 \`<路径>\``）。 */
function logPathFromDump(text) {
  const m = /日志\s*`([^`]+)`/.exec(text)
  return m ? m[1] : ''
}

/**
 * 扫 `pending\`，把缺骨架的补出来。**幂等**（已有骨架一份都不动）。
 * @returns {{checked:number, missing:number, repaired:number, skipped:number, unrepairable:string[]}}
 */
export function repairSkeletons() {
  const out = { checked: 0, missing: 0, repaired: 0, skipped: 0, unrepairable: [] }
  let files
  try {
    files = readdirSync(DUMP_PENDING_DIR).filter((f) => DUMP_RE.test(f))
  } catch {
    return out // 目录不在 ＝ 压根没有留底，正常
  }
  if (files.length === 0) return out

  const st = loadDumpState()
  const dumps = Object.entries(st.dumps ?? {})

  for (const f of files) {
    out.checked += 1
    const kind = f.startsWith('归档留底') ? 'archive' : 'compact'
    if (gaveUp.has(f)) {
      out.skipped += 1
      continue // 结构性补不了，别再试
    }
    const shortId = DUMP_RE.exec(f)[2]
    const skPath = join(skeletonDir(), skeletonFileName(shortId, kind))
    if (existsSync(skPath)) {
      out.skipped += 1
      continue // **幂等**：有骨架的一个都不动
    }
    out.missing += 1
    const mainAbs = join(DUMP_PENDING_DIR, f)

    let events = null
    let source = ''
    let seqs = null
    if (kind === 'archive') {
      const log = logPathFromDump(readFileSync(mainAbs, 'utf8').slice(0, 3000))
      if (log && existsSync(log)) {
        events = readSessionEvents(log).events
        source = log
      }
    } else {
      // 压缩路：必须有"捞哪一段"的坐标（`seqs`）＋ 完整 sid（state 的 key 里有）
      const hit = dumps.find(([, d]) => d && d.kind === 'compact' && String(d.sidShort) === shortId)
      seqs = hit && Array.isArray(hit[1].seqs) ? hit[1].seqs : null
      const sid = hit ? hit[0].replace(/^compact:/, '') : ''
      if (seqs && seqs.length > 0 && sid) {
        const log = findSessionLog(sid)
        if (log && existsSync(log)) {
          const want = new Set(seqs)
          const picked = readSessionEvents(log).events.filter((ev) => want.has(ev?.seq))
          if (picked.length > 0) {
            events = picked
            source = `${log}（只取被揉掉的那 ${picked.length} 条 seq）`
          }
        }
      }
    }

    if (!events || events.length === 0) {
      const why = kind === 'archive' ? '日志找不到' : seqs ? '日志找不到' : '没有 seq 坐标（0.32.0 之前的旧压缩留底）'
      out.unrepairable.push(`${f}（${why}）`)
      if (kind === 'compact' && !seqs) gaveUp.add(f) // 结构性缺坐标 → 不再重试
      continue
    }

    const res = writeSkeleton(shortId, events, source, { kind }) // 不传 overwrite：已存在就拒绝，更安全
    if (res.ok) {
      out.repaired += 1
      dumpLog(
        `骨架兜底：补出 ${res.out}（${res.chars} 字符 · ${kind === 'archive' ? '归档' : '压缩'}路 · 源 ${source}）`
      )
    } else {
      out.unrepairable.push(`${f}（${res.why}）`)
    }
  }
  return out
}

/**
 * F1 的 pre-step 每轮都会调它 —— **内部按 5 分钟节流**。
 * @param {boolean} [force] 测试/验收用：跳过节流
 */
export function tickSkeletonRepair(force = false) {
  const now = Date.now()
  if (!force && now - lastRun < REPAIR_INTERVAL_MS) return null
  lastRun = now
  try {
    const r = repairSkeletons()
    if (r.repaired > 0 || r.unrepairable.length > 0) {
      dumpLog(
        `骨架兜底：查 ${r.checked} 份留底 · 已有骨架 ${r.skipped} · **补了 ${r.repaired}**` +
          (r.unrepairable.length ? ` · 补不了 ${r.unrepairable.length}（${r.unrepairable.join('、')}）` : '')
      )
    }
    return r
  } catch (e) {
    dumpLog(`骨架兜底出错（**不影响留底**）：${e}`)
    return null
  }
}
