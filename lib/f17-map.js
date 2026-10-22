// ============================================================
// F17 · 档案地图（网页面板的**主区**数据源）—— 2026-09-17 下午建
// ============================================================
//
// 为什么有它（用户当天原话）：
//   "**我主要要看的是整个「档案馆」的结构**，打开控制台之后重点显示的应该是「档案馆」的「地图」，
//    以及相应的「哨兵」或者「插件」具体负责档案的什么地方；档案馆里**先按照本来的架构分层**，
//    再按照**功能或者插件的负责分室**。"
//
// ⚠️ **它不是新造一份地图**，而是把档案里那份《地图-档案结构（机器生成）.md》的**同一套口径**
//    搬到面板上：**结构现算**（走文件系统）＋ **职责现取**（从 `L1-必读/索引.md` 那张表）＋ **对账机器算**。
//    两处必须同口径，否则必然漂 —— 所以连"怎么数行数"都跟生成器一字不差（`split(/\r?\n/).length`）。
//    另外多做一件事：**比一下那份 .md 是不是旧快照**（`snapshot.stale`），这样"两份各说各话"能当场看见。
//
// 🔴 **"谁管哪块"（唯一手写的那张表）只从 .md 里读，不在这儿再抄一份** —— 抄了就有第二处要同步。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CAP_STATS, CFG, HOME_DIR, baseOf, log, readTextSafe, toolPath } from './common.js'
import { CAPS, ROOMS } from './manifest.js'

/**
 * 每层**一句话说明**（写不出的层留空，地图照样把它列出来）。
 *
 * 🔴 **层清单本身不写死** —— 见 `layersOf()`：它从档案根**现算** `L?-*` 目录。
 *   写死的老毛病：加一层要改**两处**（这里 ＋ `tools/档案结构地图.mjs`），必然漂；
 *   2026-09-26 加 `L4-施工` 时就撞上了 —— 档案里明明有，面板上死活不显示。
 */
export const LAYER_NOTES = {
  'L1-必读': '每次接手先读的几份短文件（读序写在 `从这开始读.txt`）',
  'L3-知识': '已经知道的事（事故 / 记录 / 参考 / 指南 / 清单 / 经验 / 总账）',
  'L4-施工': '还没做完的事：讨论稿 / 待办 / 工程（接手先读 `L4-施工\\工程-总览.md`）',
  'L5-证据': '原始证据与备份（脚本 / 日志 / CSV / 目录树）',
  'L6-工具临时': '干活时产生的临时文件（快照 / 清单 / 日志）',
  'L8-施工归档': '已完成 / 已废弃的施工文件',
}

/**
 * 🔴 **层清单（现算）**：档案根下所有 `L<数字>-*` 目录，按**数字**排（L1 < L2 < … < L8 < L9）。
 * 写死会漂（见 `LAYER_NOTES` 那段注释），所以一律现算 —— **加层 / 改层名不用改代码**。
 */
export function layersOf(root = CFG.archiveDir) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^L\d+-/.test(e.name)) // 口径-已确认：这里要**所有**层（含证据/临时）—— 与"引用去路径/引用改写"那两份**形似意不同**（那两份跳过证据/临时、只扫该管的层）
      .map((e) => e.name)
      .sort((a, b) => {
        const na = Number((a.match(/^L(\d+)/) || [])[1]) || 0
        const nb = Number((b.match(/^L(\d+)/) || [])[1]) || 0
        return na - nb || a.localeCompare(b)
      })
      .map((name) => [name, LAYER_NOTES[name] ?? ''])
  } catch {
    return []
  }
}

// 🔴 2026-09-27：索引的「范围 ＋ 写法」判据**只留一份** —— 见 `lib/idx-scope.js`。
//    这份文件原来自带一份副本，当天索引改"两栏 ＋ 光文件名"时它单独坏掉（L1 八份全被误报"未登记"）。
import { INDEXED_LAYER, SHOULD_REG, parseIndexRows } from './idx-scope.js'

/** 地图那份 .md（离线快照，用来读"谁管哪块"＋对一下它过时没有）。 */
export const MAP_REL = ['L1-必读', '地图-档案结构（机器生成）.md']

/** 一份职责在面板里能放下多少字（索引那个"内容"列有的能写几百字，面板放不下）。 */
const DUTY_MAX = 140

/** "何时读"那一列的上限（详情卡里显示，够了）。 */
const WHEN_MAX = 120

/** 走一遍文件系统，拿**相对档案根**的路径（分隔符统一成 `\`，与索引表口径一致）。 */
function listAll(prefix = '', out = []) {
  let entries
  try {
    entries = readdirSync(join(CFG.archiveDir, prefix), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const r = prefix ? `${prefix}\\${e.name}` : e.name
    if (e.isDirectory()) listAll(r, out)
    else out.push(r)
  }
  return out
}

/** 行数 / 字节（数行数的方法**必须**与生成器一致，否则快照对比天天报"过时"）。 */
function statOf(p) {
  try {
    const abs = join(CFG.archiveDir, p)
    const st = statSync(abs)
    let lines = null
    if (/\.(md|txt)$/i.test(p)) {
      try {
        lines = readFileSync(abs, 'utf8').split(/\r?\n/).length
      } catch {
        /* 读不到就当没有行数 */
      }
    }
    return { lines, bytes: st.size }
  } catch {
    return { lines: null, bytes: 0 }
  }
}

/**
 * 从 `索引.md` 那张表取"哪份文件讲什么 ＋ （旧写法里的）什么时候该读它"。
 * ⚠️ 2026-09-27 起索引是**两栏**（文件 ＋ 一句话＝`what`）—— 所以 `when` 常常是空的，这是**正常**的
 * （旧写法那三栏里才有"何时读"），别当解析失败。
 * 🔴 **解析只有一处实现**：`lib/idx-scope.js` 的 `parseIndexRows()` —— 两栏/三栏、带层/光文件名都认。
 */
export function indexDuty() {
  const f = join(CFG.archiveDir, 'L1-必读', '索引.md')
  return parseIndexRows(readTextSafe(f))
}

/**
 * 读那份 .md 快照：解析**唯一手写**的"梅莫莉亚 ↔ 档案"对应表，并取它自称的总数。
 * 对应表里有些行带 `（F1）` 这样的代号、有些不带（`dangan_search` 那种）—— 只收带代号的。
 */
export function readSnapshot() {
  const abs = join(CFG.archiveDir, ...MAP_REL)
  const text = readTextSafe(abs)
  const out = {
    path: MAP_REL.join('/'),
    exists: text.length > 0,
    files: null,
    lines: null,
    corr: new Map(),
  }
  if (!out.exists) return out

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(.+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/)
    if (!m) continue
    const part = m[1]
    const code = (part.match(/\b(F\d+)\b/) || [])[1]
    if (!code) continue
    if (!out.corr.has(code)) out.corr.set(code, { part, scope: m[2], perm: m[3] })
  }

  // 末尾那行：`> L1~L9 正文文件共 **63 个**（不含子目录内），其中 md/txt **9843 行**。`
  const tail = text.match(/正文文件共\s*\*\*(\d+)\s*个\*\*[\s\S]*?md\/txt\s*\*\*(\d+)\s*行\*\*/)
  if (tail) {
    out.files = Number(tail[1])
    out.lines = Number(tail[2])
  }
  // 🔴 2026-10-11 加：各层"另有 N 个子目录、共 M 个文件"里那些 **M 的总和** ——
  //    给 `stale` 判据用：**只看"增长量是否落在 L6 子目录那一段"**（那一层自己是会长大的）。
  let subs = 0
  for (const m of text.matchAll(/另有 \d+ 个子目录、共 (\d+) 个文件/g)) subs += Number(m[1])
  out.subFiles = subs
  return out
}

/** ⚠️ "分室"那张表在 `manifest.js` 的 `ROOMS` 里（**唯一一处**）—— 见 `manifestProblems()` 会查漏分/重分。 */
function buildRooms(corr) {
  const byId = new Map(CAPS.map((c) => [c.id, c]))
  return ROOMS.map(([room, ids]) => ({
    room,
    items: ids
      .filter((id) => byId.has(id))
      .map((id) => {
        const c = byId.get(id)
        const t = CAP_STATS.get(id)
        const c2 = corr.get(id)
        return {
          code: id,
          title: c.title,
          kind: c.kind,
          what: c.what,
          scope: c2 ? c2.scope : '',
          perm: c2 ? c2.perm : '',
          ticks: t ? t.count : 0,
          lastAt: t ? t.lastAt : null,
        }
      }),
  }))
}

/**
 * 一张图要的全部数据（面板直接渲染它）。
 * ⚠️ **只读**：不写任何东西；哪段读不到就记进 `problems`，不让整张图失败。
 */
export function buildMapData() {
  const problems = []
  const all = listAll()
  const duty = indexDuty()
  if (duty.size === 0) problems.push('`L1-必读/索引.md` 那张表没读到 —— 职责一栏只能留空')

  const layers = []
  let totalFiles = 0
  let totalLines = 0

  for (const [name, note] of layersOf()) {
    const inLayer = all.filter((f) => f.startsWith(`${name}\\`))
    const files = inLayer.filter((f) => !f.slice(name.length + 1).includes('\\'))
    const dirNames = [
      ...new Set(
        inLayer.filter((f) => f.slice(name.length + 1).includes('\\')).map((f) => f.slice(name.length + 1).split('\\')[0]),
      ),
    ]

    const list = files.sort().map((f) => {
      const { lines, bytes } = statOf(f)
      totalFiles += 1
      if (lines !== null) totalLines += lines
      // 🔴 2026-09-27：索引那一格现在**只写文件名**（重名才带层）—— 取职责必须**两种写法都认**
      //    （带层的 `L1-必读\工具速查.md` 与光文件名的 `工具速查.md`）。只认一种＝静默失效。
      const rec = duty.get(f) || duty.get(baseOf(f))
      const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '')
      return {
        name: f.slice(name.length + 1),
        path: f.replace(/\\/g, '/'),
        lines,
        bytes,
        duty: cut(rec && rec.what, DUTY_MAX),
        when: cut(rec && rec.when, WHEN_MAX),
        // 索引**故意不登记**的那两份（索引自己 · 机器生成的地图）与二进制件不算"漏登记"。
        registered: Boolean(rec) || !SHOULD_REG(f),
      }
    })

    // 🔴 2026-09-27：子目录**也带上文件清单**。原来只算数量 ⇒ 面板上只写「（N 个文件，不展开）」，
    //    于是 `L4-施工\统一度量衡\` 那两份**在面板上根本看不见** —— 用户当天〔会话 2026-09-27〕：
    //    「**地图面板只显示 md 不显示文件夹**……不然确实我没法在地图上认出导致描述出现偏差」。
    //    口径与上面的 `list` 一致：只取该子目录**下一层**的文件（多级不递归）、职责两种写法都认。
    const cutD = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '')
    const dirs = dirNames.sort().map((d) => {
      const pref = `${name}\\${d}\\`
      const sub = inLayer.filter((x) => x.startsWith(pref))
      return {
        name: d,
        files: sub.length,
        list: sub.sort().map((f) => {
          const { lines, bytes } = statOf(f)
          const rec = duty.get(f) || duty.get(baseOf(f))
          return {
            name: f.slice(pref.length),
            path: f.replace(/\\/g, '/'),
            lines,
            bytes,
            duty: cutD(rec && rec.what, DUTY_MAX),
            when: cutD(rec && rec.when, WHEN_MAX),
            registered: Boolean(rec) || !SHOULD_REG(f),
          }
        }),
      }
    })

    layers.push({
      name,
      note,
      files: list,
      dirs,
      fileCount: list.length,
      dirCount: dirs.length,
      total: inLayer.length,
      /** 这一层**根下**正文一共多少行（面板已不显示行数 —— 2026-10-11 用户定"不显示行"）。 */
      linesTotal: list.reduce((s, x) => s + (x.lines || 0), 0),
      /** 这一层**根下**正文字节数（2026-09-25 加 · 用户 09-22 要的"各层体积"）。 */
      bytesTotal: list.reduce((s, x) => s + (x.bytes || 0), 0),
      /**
       * 🔴 2026-09-27 加：这一层**含子目录**的字节数。
       *    用户当天问「**L5 证据 0mb 这正常吗？**」—— 根下只有 2 份小文件所以显示 0.00 MB，
       *    可它下面还有 16 个目录、305 份证据，**一个字节都没算进去** ⇒ 那个数在误导。
       *    ⚠️ 子目录的字节直接累计 `dirs[].list`（不重扫盘）。
       */
      bytesAll:
        list.reduce((s, x) => s + (x.bytes || 0), 0) +
        dirs.reduce((s, d) => s + (d.list || []).reduce((t, f) => t + (f.bytes || 0), 0), 0),
      indexed: INDEXED_LAYER.test(name),
      unregistered: INDEXED_LAYER.test(name) ? list.filter((x) => !x.registered).map((x) => x.name) : [],
    })
  }

  // ---- 对账：只比"索引本来就该管的那几层"，且只比**各层根下**的文件（子目录不逐文件登记）----
  // 🔴 **2026-09-28 改：含子目录**（原写 `&& f.split('\\').length === 2`）—— L3 已分 9 个子目录、
  //    **那些就是正文**；只算层根下会让"漏登记"**查不到子目录里的文件**（而索引生成器已改成递归登记）。
  //    ⚠️ 同一口径的三处：**这里** · `tools/档案结构地图.mjs` 的 `COVERED` · `tools/档案索引.mjs` 的 `collectFiles`。
  const covered = (f) => INDEXED_LAYER.test(f)
  const actual = all.filter(covered)
  // 🔴 2026-09-27：**光文件名与"层\文件"两种写法都要认** —— 索引现在只写文件名（重名才带层）。
  //    只按带层的算，会把整层都误报成"漏登记"（今天真发生过：L1 八份全报未登记）。
  // 🔴 2026-09-29：本地那份 `baseOf` **已删** —— 它只按反斜杠分，而这里处理的是**索引表的键**
  //    （可能是 `层\文件`、也可能只是光文件名，甚至正斜杠形态）⇒ 它正是"**正斜杠路径静默返回整串**"
  //    那个 bug 的副本（当年口径扫漏了它）。改用唯一来源 `common.js` 的 `baseOf()`（两种分隔符都认）。
  const hasRec = (f) => duty.has(f) || duty.has(baseOf(f))
  // 🔴 **2026-09-28 修（存在性判断要扫子目录）**：理由与实况见 `tools/档案结构地图.mjs` 同一处 ——
  //    L3 已在 T714 分进 9 个子目录（事故 / 参考 / 记录 / …），**那些就是正文**；只在层根下找 basename
  //    会把 35 份正文误报成"索引指向了不存在的文件"（实测：改完 0 条）。
  //    ⚠️ 只改存在性这一路；`actual`（漏登记用）仍按老口径。**这份与工具那份是同一判据的两份副本。**
  const allNames = new Set(all.map(baseOf))
  const hitOf = (k) => (covered(k) ? (actual.includes(k) ? k : '') : allNames.has(baseOf(k)) ? k : '')
  const idxPaths = [...new Set([...duty.keys()].map(hitOf).filter(Boolean))]
  const missingInIdx = actual.filter((f) => !hasRec(f) && SHOULD_REG(f))
  // ⚠️ `duty` 里**同一份可能存了两个键**（带层的 ＋ 光文件名的）—— 死指针要按 basename 去重，
  //    否则一条死指针会被数成两条。
  const deadInIdx = [...duty.keys()]
    .filter((k) => !hitOf(k) && (covered(k) || !/[\\/]/.test(k))) // 2026-09-29：光文件名＝**不含任何分隔符**（原来只判反斜杠）
    .filter((k, i, arr) => arr.findIndex((x) => baseOf(x) === baseOf(k)) === i)
  if (missingInIdx.length > 0) problems.push(`索引漏登记 ${missingInIdx.length} 个文件`)
  if (deadInIdx.length > 0) problems.push(`索引指向了 ${deadInIdx.length} 个不存在的文件`)

  // ---- 快照：那份 .md 是不是旧了 ----
  const snap = readSnapshot()
  if (!snap.exists) problems.push(`地图快照读不到（${snap.path}）—— "谁管哪块"这张表没了`)
  // 🔴 2026-10-11（用户拍板走 A）：**别让 `L6-工具临时` 的数字把快照判成"旧"** ——
  //    那一层天生一直在长（`改档快照\` 每次都多一份），而《地图》**每织一次自己又写一份快照**
  //    ⇒ "文件数必须逐字相等"这条判据**结构性不可能收敛**：
  //    刚织完它的数字就再次过期 ⇒ 面板永远「⚠️ .md 是旧快照」、每次启动白跑 2 遍重出。
  //    判据改成：快照自称的数 ≤ 现算数，且**差额由 `L6-工具临时` 的子目录增长造成** ⇒ 不算旧。
  //    ⚠️ 行数那半边维持精确比较（内容真变了才该重织）。
  const l6SubFiles = all.filter((f) => {
    const s = f.slice(3)
    return f.startsWith('L6-工具临时\\') && s.includes('\\') && /\.(md|txt)$/i.test(f)
  }).length
  // 差额是否"只落在 L6-工具临时 的子目录那一段"（它自己会长：每织一次地图就多一份快照）。
  // ⚠️ 只在**快照里确实登记了子目录结构**时才放宽（`snap.subFiles > 0`）—— 沙箱/极简档案
  //    （没写那一行）仍走**精确比较**，否则"加一份文件也算旧"那条判据会被整条放行（测试当场红）。
  const growOk =
    snap.files !== null &&
    snap.subFiles > 0 &&
    totalFiles >= snap.files &&
    totalFiles - snap.files <= Math.max(0, l6SubFiles - snap.subFiles)
  const stale =
    snap.exists &&
    snap.files !== null &&
    (snap.files !== totalFiles || (snap.lines !== null && snap.lines !== totalLines)) &&
    !growOk

  return {
    at: new Date().toISOString(),
    archive: CFG.archiveDir,
    layers,
    totals: {
      files: totalFiles,
      lines: totalLines,
      all: all.length,
      /** 整档体积（各层根下正文字节合计 · 2026-09-25 加 · 用户 09-22 要的"各层与整档体积"） */
      bytes: layers.reduce((s, L) => s + (L.bytesTotal || 0), 0),
    },
    index: {
      file: 'L1-必读/索引.md',
      covered: actual.length,
      registered: idxPaths.length,
      missing: missingInIdx,
      dead: deadInIdx,
    },
    snapshot: {
      path: snap.path,
      exists: snap.exists,
      files: snap.files,
      lines: snap.lines,
      stale,
      /** 快照里那张"谁管哪块"表读出来几条（0 ＝ 没读到，面板会说清） */
      corr: snap.corr.size,
      /** 上一次"自动重出"发生在什么时候、成没成（**它自己动过了，这件事也得有据可查**） */
      auto: mapRegenState(),
    },
    rooms: buildRooms(snap.corr),
    problems,
  }
}

/** 启动自检：**地图也得出声**（"沉默 ≠ 正常" —— 一个有输出的能力才看得出它活着）。 */
export function reportF17() {
  try {
    const m = buildMapData()
    const idx = m.index.missing.length + m.index.dead.length
    const snap = !m.snapshot.exists ? '快照读不到' : m.snapshot.stale ? '⚠️ 快照是旧的（与现算对不上）' : '快照与现算一致'
    return (
      `档案地图 F17：${m.layers.length} 层 · ${m.totals.files} 份（${m.totals.lines} 行）· ` +
      `索引漏登记 ${m.index.missing.length} / 死指针 ${m.index.dead.length}${idx > 0 ? ' ⚠️' : ''} · ${snap} · ` +
      `分室 ${m.rooms.length} 间`
    )
  } catch (e) {
    return `档案地图 F17：**没跑起来**（${e && e.message ? e.message : e}）`
  }
}

// ============================================================
// 自动重出地图（2026-09-17 晚加 · 用户原话："**这地图就不能改成自动更新吗？
// 总得自己跑是不有点。。。**"）
// ============================================================
//
// 病：那份 .md 是**机器生成的**，却要**人记得生成** —— 于是它天天是旧的，
//     而 F17 只能一遍遍报"⚠️ 快照是旧的"。**"机器生成的手册，却要人记得生成"本身就是缺陷。**
//
// 做法（只做一件事：**在它该跑的时候替它跑**）：
//   · **不另写渲染器** —— 调的仍是工具箱里那台生成器（它自带快照 + 读回对账），
//     否则就是第二个渲染器，两处必漂（这份档案的头号病根：副本病）；
//   · **只在"真的旧了"时才跑** —— 不然每跑一次就往 `L6-工具临时\档案结构地图快照\` 堆一个快照目录；
//   · **跑两次直到收敛** —— 那台生成器**把自己也数进去**（写完自己变长 → 自称的数永远差一代），
//     实测第一遍写完还会差几行，第二遍才对上（它的幂等设计正好兜住，L9 里那两个快照是这么来的）；
//   · 🔴 **失败只记日志、绝不抛错** —— 地图停在旧版而已，其它能力一点不受影响。

export const MAP_STATE = join(HOME_DIR, 'memoria-map.json')

/** 上一次"自动重出"的时间/结果（面板与状态面板要显示它 —— "它自己动过了"这件事也得有据可查）。 */
export function mapRegenState() {
  try {
    const s = JSON.parse(readTextSafe(MAP_STATE))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

function saveMapRegenState(s) {
  try {
    writeFileSync(MAP_STATE, JSON.stringify(s, null, 2))
  } catch {
    /* 存不下就算了：大不了下次再重出一遍 */
  }
}

/**
 * 地图旧了就重出一遍（最多 `maxRuns` 遍，直到与现算一致）。
 * @returns {{ok:boolean, ran:number, why:string, before?:string, after?:string}}
 */
export function regenMapIfStale(maxRuns = 2) {
  let m
  try {
    m = buildMapData()
  } catch (e) {
    return { ok: false, ran: 0, why: `读不出地图：${e && e.message ? e.message : e}` }
  }
  if (m.snapshot.exists && !m.snapshot.stale) return { ok: true, ran: 0, why: '与现算一致，没跑' }
  const before = m.snapshot.exists ? '旧' : '缺'

  // 生成器：**包内优先**（随插件走），迁移期回退工具箱；两处都没有就只记日志。
  const gen = CFG.mapGenerator || toolPath('档案结构地图.mjs')
  if (!gen || !existsSync(gen)) {
    log(`档案地图 F17：**想自动重出，但生成器不在**（${gen || '（没配）'}）—— 地图停在旧版`, { silent: true })
    return { ok: false, ran: 0, why: `生成器不在：${gen || '（没配）'}` }
  }

  let ran = 0
  let stale = m.snapshot.stale
  for (let i = 0; i < maxRuns && stale; i++) {
    try {
      const out = execFileSync(process.execPath, [gen, '--apply'], {
        cwd: dirname(gen),
        timeout: 30000,
        encoding: 'utf8',
        windowsHide: true,
        // ⚠️ 必须把**插件认的那个档案根**传给生成器 —— 否则换机器/换档案位置时，
        // 生成器会按它自己的默认值去改**另一个档案**（"两处各认一个根"是最难查的那类错）。
        env: { ...process.env, GAI_DANG_ROOT: CFG.archiveDir },
      })
      ran += 1
      const tail = String(out ?? '').trim().split(/\r?\n/).slice(-1)[0] ?? ''
      log(`档案地图 F17：自动重出第 ${ran} 遍 —— ${tail}`, { silent: true })
    } catch (e) {
      const why = String(e && e.message ? e.message : e)
      log(`档案地图 F17：**自动重出没跑成**（${why}）—— 地图停在旧版，其它能力不受影响`, { silent: true })
      saveMapRegenState({ at: new Date().toISOString(), ok: false, ran, before, after: '没跑成', why })
      return { ok: false, ran, why }
    }
    try {
      stale = buildMapData().snapshot.stale
    } catch {
      stale = true
    }
  }
  saveMapRegenState({ at: new Date().toISOString(), ok: !stale, ran, before, after: stale ? '仍旧' : '一致' })
  return { ok: !stale, ran, why: stale ? `跑了 ${ran} 遍仍对不上（大概率是它"把自己也数进去"那一代，值得看一眼）` : '已重出并与现算一致', before, after: stale ? '仍旧' : '一致' }
}

/** 注册 F17：**启动时**自愈一次（收尾那一次由 F7 的闸门顺手做，见 `f7-gate.js`）。 */
export function registerF17() {
  try {
    const r = regenMapIfStale()
    if (r.ran > 0) log(`档案地图 F17：启动自愈 —— ${r.why}（跑了 ${r.ran} 遍）`, { silent: true })
  } catch (e) {
    log(`档案地图 F17：启动自愈失败（不影响其它能力）：${e && e.message ? e.message : e}`, { silent: true })
  }
}
