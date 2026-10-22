// ============================================================
// F19 · L9 看门（快照保留 ＋ 体积哨兵）—— 2026-09-17 晚建
// ============================================================
//
// 为什么有它（用户当天原话）：
//   "**是不是现在所有的工具都记录在 L9。如果真按你所说，那岂不是真的堆得很大。
//    话说 L9 还有其他内容吗？我不想造成污染**"
//
// 实测（2026-09-17 20:45）：L9 = **110 个文件 / 5.55 MB**，其中 **改档快照占 4.56 MB（82%）** ——
//   24 个快照**全是当天**的（00:11 → 20:43），一个 ≈258 KB（它把**整份旧文件**拷一份：事件表 160 KB ＋ 时间轴 93 KB）。
//   照这个速度 **≈4.6 MB/天**，一个月 ≈140 MB。**无上限增长**。
//
// 🔴 病根不只是"大"，还有一条更阴的：**L4/L9 按规矩不逐文件登记进索引**（故意的）→
//   **没人盯着它长**；而 L9 里那两个 `.bak-before-rebuild` 自己就写着"T 号是旧编号、别引用"——
//   **旧副本堆在档案里，本身就是"读到旧东西"那类坑的温床**。
//
// 这一份做两件事（**只碰 L9 里那几种"快照目录"，别的一律不碰**）：
//   ① **保留策略**：快照只留「**最近 3 天**」∪「**最新 20 个**」∪「**每种家族各留最新的 1 个**」；
//      其余进**回收站**（可复原）—— 删之前先把清单写进 `~/.dsh` 留档。
//   ② **体积哨兵**：L9 超过阈值（默认 50 MB）就出声（体检 + 面板），不再"悄悄长"。
//
// ⚠️ 三条自我约束（写死在代码里，不靠记性）：
//   · **绝不 `Remove-Item`** —— 一律走 `recycle-del.ps1`（唯一入口、可复原）；
//   · **只删"快照家族"目录**，且只删 `L6-工具临时\<家族>\<一个快照>` 这一层（不递归乱扫）；
//   · 回收工具不在 / 跑不动 → **只记日志、绝不抛错**（顶多继续堆着）。

import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, sep } from 'node:path'

import { CFG, HOME_DIR, log, readTextSafe, toolPath, writeHealth } from './common.js'

/** L9 里"快照家族"的目录名（**只认这几个**；别的目录一个都不碰）。 */
export const SNAP_FAMILIES = [
  '改档快照',
  '档案结构地图快照',

]

/**
 * 保留策略。
 * 📌 2026-09-18 用户改档：**最近 3 天**（原为 7 天）＋ **最新 20 个**。
 */
export const RETAIN = { days: 3, newest: 20 }
// 🔴 **要改保留策略，只改上面这一行**（2026-09-19 统一）：面板文案（F15）、前端卡片（client.js）
// 与工具描述（manifest.js）都从这里取。别在别处再写一遍"最近 3 天 / 最新 20 个"。

/**
 * L9 体积警戒线（MB）。
 *
 * 🔴 **2026-09-17 深夜起默认 `null` ＝ 不报警**（用户原话："**即便是几个 G 也是临时的**"）。
 *    理由：L9 里的东西**全是临时的** —— 改档快照有保留策略兜着，压缩/归档留底**销账时两份一起删**，
 *    而这点空间用户给得起。**体积数字照旧显示**（面板里看得见堆了多少），只是不再"报警"。
 * 想开回来：给个数字即可（判据仍是 `mb > 这个数`）。
 */
export const L9_WARN_MB = null

export const L9_DIR = () => join(CFG.archiveDir, 'L6-工具临时')
export const L9_STATE = join(HOME_DIR, 'memoria-l9.json')

/** 目录名的时刻：`20260917-204333-229-…` 或 `2026-09-16T15-56-48-773Z`；认不出就用 mtime。 */
function dirTime(name, abs) {
  const a = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/)
  if (a) return Date.parse(`${a[1]}-${a[2]}-${a[3]}T${a[4]}:${a[5]}:${a[6]}`)
  const b = name.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/)
  if (b) return Date.parse(`${b[1]}-${b[2]}-${b[3]}T${b[4]}:${b[5]}:${b[6]}Z`)
  try {
    return statSync(abs).mtimeMs
  } catch {
    return 0
  }
}

function dirSize(abs) {
  let bytes = 0
  let files = 0
  try {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const p = join(abs, e.name)
      if (e.isDirectory()) {
        const sub = dirSize(p)
        bytes += sub.bytes
        files += sub.files
      } else {
        try {
          bytes += statSync(p).size
          files += 1
        } catch {
          /* 读不到就当 0 */
        }
      }
    }
  } catch {
    /* 同上 */
  }
  return { bytes, files }
}

/** 所有快照目录（只认那几个家族、只取一层）。 */
export function snapshotDirs() {
  const out = []
  for (const family of SNAP_FAMILIES) {
    const famAbs = join(L9_DIR(), family)
    let entries
    try {
      entries = readdirSync(famAbs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const abs = join(famAbs, e.name)
      const { bytes, files } = dirSize(abs)
      out.push({
        family,
        name: e.name,
        rel: `L6-工具临时\\${family}\\${e.name}`,
        abs,
        at: dirTime(e.name, abs),
        bytes,
        files,
      })
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

/** L9 全量统计（含非快照的文件 —— 体积哨兵要看的是全部）。`warnMB` 可传（测试用）。 */
export function l9Stats(warnMB = L9_WARN_MB) {
  const root = L9_DIR()
  let bytes = 0
  let files = 0
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      const p = join(root, e.name)
      const s = e.isDirectory() ? dirSize(p) : (() => {
        try {
          return { bytes: statSync(p).size, files: 1 }
        } catch {
          return { bytes: 0, files: 0 }
        }
      })()
      bytes += s.bytes
      files += s.files
    }
  } catch {
    /* 目录不在就当 0 */
  }
  const snaps = snapshotDirs()
  return {
    files,
    mb: Math.round((bytes / 1048576) * 100) / 100,
    snapshotCount: snaps.length,
    snapshotMb: Math.round((snaps.reduce((s, d) => s + d.bytes, 0) / 1048576) * 100) / 100,
    warnMB: Number.isFinite(warnMB) ? warnMB : null,
    // ⚠️ 没设警戒线（null）时**永远是 false** —— 不是"0 MB 也算超"
    over: Number.isFinite(warnMB) && bytes / 1048576 > warnMB,
  }
}

/**
 * 算出"该留谁、该扔谁"。**三条保命规则**（顺序即优先级）：
 *   ① 比 `days` 天新的 —— 一律留；
 *   ② 全体最新的 `newest` 个 —— 一律留；
 *   ③ 每个家族最新的 1 个 —— 一律留（哪怕它是两个月前那次"加列"的唯一退路）。
 * @returns {{keep:Array, drop:Array}}
 */
export function planRetention(dirs = snapshotDirs(), opt = RETAIN) {
  const now = Date.now()
  const keep = new Set()
  const byNewest = [...dirs].sort((a, b) => b.at - a.at)
  byNewest.slice(0, opt.newest).forEach((d) => keep.add(d.rel))
  const seenFamily = new Set()
  for (const d of byNewest) {
    if (!seenFamily.has(d.family)) {
      seenFamily.add(d.family)
      keep.add(d.rel)
    }
  }
  for (const d of dirs) if (now - d.at < opt.days * 86400000) keep.add(d.rel)

  const keepList = dirs.filter((d) => keep.has(d.rel))
  const dropList = dirs.filter((d) => !keep.has(d.rel))
  return { keep: keepList, drop: dropList }
}

export function loadL9State() {
  try {
    const s = JSON.parse(readTextSafe(L9_STATE))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

function saveL9State(s) {
  try {
    writeFileSync(L9_STATE, JSON.stringify(s, null, 2))
  } catch {
    /* 存不下就算了 */
  }
}

/**
 * 🔴 **永久删的唯一护栏**：路径必须**恰好**是 `L6-工具临时\<家族>\<一个快照>`。
 * 少一层、多一层、换一个家族、跑到 L9 外面 —— **一律拒绝并留下告警**。
 * （用户 2026-09-17 授权"彻底删除"，但授权的是"这些快照"，不是"随便什么路径"。）
 */
export function isSafeSnapPath(abs) {
  try {
    const root = resolve(L9_DIR())
    const p = resolve(abs)
    if (!p.startsWith(root + sep)) return false
    const parts = p.slice(root.length + 1).split(sep).filter(Boolean)
    return parts.length === 2 && SNAP_FAMILIES.includes(parts[0])
  } catch {
    return false
  }
}

/**
 * 按保留策略回收（默认**永久删**，可切回回收站；清单先落到 `~/.dsh` 留档）。
 * @param {{dryRun?:boolean, dirs?:Array}} opt
 */
export function applyRetention(opt = {}) {
  const { keep, drop } = planRetention(opt.dirs ?? snapshotDirs())
  const droppedMb = Math.round((drop.reduce((s, d) => s + d.bytes, 0) / 1048576) * 100) / 100
  if (drop.length === 0) {
    saveL9State({ ...loadL9State(), lastPlanAt: new Date().toISOString(), wouldDrop: 0 })
    return { ok: true, dropped: 0, droppedMb: 0, kept: keep.length, why: '没有该回收的' }
  }
  if (opt.dryRun) return { ok: true, dropped: drop.length, droppedMb, kept: keep.length, why: '干跑：只算不动' }

  // 删之前先把清单落一份（**删了也要有据可查**）
  const listFile = join(HOME_DIR, `memoria-l9-drop-${Date.now()}.txt`)
  try {
    writeFileSync(listFile, drop.map((d) => `${d.rel}\t${d.bytes} B`).join('\n'), 'utf8')
  } catch (e) {
    return { ok: false, dropped: 0, droppedMb: 0, kept: keep.length, why: `写清单失败：${e && e.message ? e.message : e}` }
  }

  // ---- 永久删（用户 2026-09-17 授权：不进回收站，免得回收站也堆）----
  if (CFG.l9PermanentDelete === true) {
    const refused = []
    let removed = 0
    for (const d of drop) {
      if (!isSafeSnapPath(d.abs)) {
        refused.push(d.rel)
        continue
      }
      try {
        rmSync(d.abs, { recursive: true, force: true })
        removed += 1
      } catch (e) {
        refused.push(`${d.rel}（${e && e.message ? e.message : e}）`)
      }
    }
    if (refused.length > 0) log(`L9 看门 F19：⚠️ **有 ${refused.length} 个路径没通过护栏、没删** —— ${refused.slice(0, 3).join(' / ')}`, { silent: true })
    const after = l9Stats()
    saveL9State({
      at: new Date().toISOString(),
      ok: refused.length === 0,
      mode: '永久删',
      dropped: removed,
      droppedMb,
      kept: keep.length,
      refused,
      listFile,
      mbAfter: after.mb,
      snapshotsAfter: after.snapshotCount,
    })
    log(`L9 看门 F19：**永久删** ${removed} 个快照（${droppedMb} MB）｜留 ${keep.length} 个（策略：最近 ${RETAIN.days} 天 ＋ 最新 ${RETAIN.newest} 个）｜清单 ${listFile}`, { silent: true })
    return { ok: refused.length === 0, dropped: removed, droppedMb, kept: keep.length, refused, listFile, why: refused.length === 0 ? '已永久删除（清单在 ~/.dsh）' : `删了 ${removed} 个，${refused.length} 个没通过护栏` }
  }

  // ---- 走回收站（原来那条路，留着可切回来）----
  // 回收工具：**包内优先**（随插件走），迁移期回退工具箱；两处都没有就只记日志、继续堆着。
  const tool = CFG.recycleTool || toolPath('recycle-del.ps1')
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tool, '-ListFile', listFile, '-AllowLocalDrives'], {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
      // 三条都显式给：**儿子的 stderr 要收进我们这儿**（好写进日志），不要漏到控制台去刷屏
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const why = String(e && e.message ? e.message : e)
    log(`L9 看门 F19：**回收没跑成**（${why}）—— 快照继续堆着，别的能力不受影响`, { silent: true })
    saveL9State({ ...loadL9State(), at: new Date().toISOString(), ok: false, mode: '回收站', why, wouldDrop: drop.length })
    return { ok: false, dropped: 0, droppedMb: 0, kept: keep.length, why: `回收工具没跑成：${why}` }
  }
  const after = l9Stats()
  saveL9State({
    at: new Date().toISOString(),
    ok: true,
    mode: '回收站',
    dropped: drop.length,
    droppedMb,
    kept: keep.length,
    listFile,
    mbAfter: after.mb,
    snapshotsAfter: after.snapshotCount,
  })
  log(`L9 看门 F19：回收 **${drop.length} 个快照**（${droppedMb} MB）→ 回收站；留 ${keep.length} 个（策略：最近 ${RETAIN.days} 天 ＋ 最新 ${RETAIN.newest} 个）`, { silent: true })
  return { ok: true, dropped: drop.length, droppedMb, kept: keep.length, why: '已回收（清单在 ~/.dsh）' }
}

/** 启动/收尾时调用：**每天最多清一次**（免得一回合清一遍）。 */
export function maybeCleanL9(minHours = 12) {
  const st = loadL9State()
  const last = Date.parse(st.at ?? '') || 0
  if (Date.now() - last < minHours * 3600000) return { ok: true, dropped: 0, skipped: true, why: `距上次清理不到 ${minHours} 小时` }
  const { drop } = planRetention()
  if (drop.length === 0) {
    saveL9State({ ...st, lastPlanAt: new Date().toISOString() })
    return { ok: true, dropped: 0, why: '没有该回收的' }
  }
  return applyRetention()
}

/**
 * 🗂 **插件自己家目录（`~/.dsh/memoria/`）里没人扫的遗留**（2026-10-20 加，对应审查②-9）。
 *
 * 两类：
 *   · `待删-*` / `搬移清单-*.txt` —— 用完就没人管；**清单里列出的目标全都不存在** ⇒ 这份清单已经办完、可以进 `archived/`；
 *   · `memoria-txn.old-*` —— 事务备份，只增不减（实测从 10-08 一路堆到 10-15）。
 *
 * ⚠️ **只报不删**：这两类都不在"快照家族"里，本能力**一个都不碰**（要真清仍要人点头）。
 *   判据为什么能用"目标全不存在"：清单是"要删/要搬的那一批"，东西都没了 ⇒ 清单只剩个念想。
 */
export function memoriaJunk(now = Date.now()) {
  const out = { lists: 0, listDone: 0, olds: 0, oldStale: 0 }
  try {
    for (const e of readdirSync(HOME_DIR, { withFileTypes: true })) {
      const n = e.name
      if (e.isFile() && /^(待删-|搬移清单-).+\.txt$/i.test(n)) {
        out.lists += 1
        try {
          const targets = readTextSafe(join(HOME_DIR, n))
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => /^[A-Za-z]:[\\/]/.test(s))
          if (targets.length > 0 && targets.every((p) => !existsSync(p))) out.listDone += 1
        } catch {
          /* 读不到就不算"办完" —— 宁可少报 */
        }
      } else if (e.isDirectory() && /^memoria-txn\.old-/.test(n)) {
        out.olds += 1
        try {
          if (now - statSync(join(HOME_DIR, n)).mtimeMs > 7 * 86400_000) out.oldStale += 1
        } catch {
          /* 读不到 mtime 就不算超期 */
        }
      }
    }
  } catch {
    /* 整个扫不成 → 报 0（宁可少报，不编） */
  }
  return out
}

/** 自检 + 哨兵：说出 L9 现在多大、上次清了什么；**超阈值就出声**。 */
export function reportF19() {
  try {
    const s = l9Stats()
    const st = loadL9State()
    const last =
      st.at && st.ok
        ? `上次回收 ${st.dropped} 个 / ${st.droppedMb} MB（${String(st.at).slice(5, 16).replace('T', ' ')}）`
        : st.at
          ? `上次回收没跑成（${st.why ?? '?'}）`
          : '还没回收过'
    const warn = s.over ? ` ⚠️ **超过 ${s.warnMB} MB 警戒线**` : ''
    // 🔴 2026-10-20：顺手把"自家遗留"也报出来（只报不删）—— 从前这些清单与 `.old-*` 没有任何人管。
    let junk = ''
    try {
      const j = memoriaJunk()
      if (j.lists + j.olds > 0) {
        junk = ` · **自家遗留**：清单 ${j.lists} 份（里面目标全没了的有 ${j.listDone} 份，可归档）· \`.old-*\` ${j.olds} 个（超 7 天 ${j.oldStale} 个）`
      }
    } catch {
      /* 报不出来就算了，不影响 L9 那一行 */
    }
    // 🛡 **2026-10-22（机器闭环 · 入选名单）**：把结论写成机读状态。
    //    为什么它进名单：它**后台跑**，坏了要等磁盘涨起来或回收没跑成才知道 —— "眼睛看不到"。
    //    判据只有两条：**上次回收没跑成**（`st.ok === false`）· **超警戒线**（`s.over`）。
    //    ⚠️ 只转写 `l9Stats()` / `loadL9State()` 已经读出来的东西，不新加扫描。
    try {
      const bad = st.ok === false || s.over
      const why = [st.ok === false ? '上次回收没跑成' : '', s.over ? '超警戒线' : ''].filter(Boolean).join(' · ')
      writeHealth('F19', !bad, `L6 ${s.files} 个 / ${s.mb} MB${why ? ` · ${why}` : ''}`)
    } catch {
      /* 报不上自己，不影响那一行报告 */
    }
    return `L9 看门 F19：${s.files} 个文件 / **${s.mb} MB**（其中快照 ${s.snapshotCount} 个 / ${s.snapshotMb} MB）· ${last}${warn}${junk}`
  } catch (e) {
    return `L9 看门 F19：**没跑起来**（${e && e.message ? e.message : e}）`
  }
}

/** 注册 F19：**启动时**看一眼 + 顺手按策略回收（一天最多一次）。 */
export function registerF19() {
  try {
    const r = maybeCleanL9()
    if (!r.skipped && r.dropped > 0) log(`L9 看门 F19：启动时回收 —— ${r.why}`, { silent: true })
  } catch (e) {
    log(`L9 看门 F19：启动自检失败（不影响其它能力）：${e && e.message ? e.message : e}`, { silent: true })
  }
}
