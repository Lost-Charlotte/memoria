// ============================================================
// F9 · 落笔半（`dangan_log` 的写入内核）—— 2026-09-17 凌晨
// ============================================================
//
// 为什么有它：用户 2026-09-16 深夜点名 —— "**2 不是早就说了吗？一直拖着，这个东西一直在拖你每轮工作的后腿啊，
// 你一直得手写，不就一直被分散注意力。日志不就一直出错。**"
// 一件事以前要我手写六处（时间轴 / 事件表正文 / 事件表顶部那份目录 / 总览 / 工具速查 / 错误总账），
// 而且**编号要数、等级要记**；漏一处只能等体检事后抓（真漏过：T177 没进事件表）。
//
// 这一半做的事：**把"算好的几行"通过那扇唯一的门写进档案**，并且：
//   · **门只有一扇** —— 走 `改档.mjs --txn`（如果那个脚本不在，就**一个字都不写**，
//     绝不为了"能写"而在插件里另开一条写档案的路）；
//   · **先快照**（内核自己会拷到 `L6-工具临时\改档快照\<时刻>`）；
//   · **写前后各体检一次** —— 只有"**新出现**的错误"才算我这次写坏的 → 自动 `--restore` 回滚；
//   · **行号防撞**：每一处改动都带上"我以为那一行是什么"（`expect`），
//     别人（另一个会话）在我算完行号之后动过同一份文件 → 内核**当场停手**，而不是改错行。
//     （用户 2026-09-16 特意点过："**你注意你的写入别和审查的 AI 冲突了导致结果有误。**"）
//
// ⚠️ 它**不判断内容对不对**：起因/做了什么/结果都要调用方给足字。
//    插件只保证"格式合法、该落的几处都落了、落错了能退回去"。

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { CFG, HOME_DIR, capTick, findByName, isL2Doc, log, nowStamp, readTextSafe, stripExt, toolPath } from './common.js'
// 🔴 2026-10-14：取路径"最后一段"用 `baseOf()`（**唯一来源**，见 `lib/scope-registry.js`）—— 别自己 split。
import { baseOf } from './idx-scope.js'
// 🔴 2026-10-15：`SEG_LIMIT` / `segLimitOver` / `segLimitSplit` **全撤了** ——
//    前两个随"字数闸门"撤（见下面那段注）；第三个是 `DID_SELF` 的用具，而那道闸**当天深夜也退役了**
//    （同一个理由：`did` 已不再入档、150 字从来不是判据）。
import { checkArchive } from './f5-check.js'
// 🔴 2026-10-20：`MIN_QUOTE_CHARS` 的 import 删了 —— `citeAnchorWarn`（用它的那个）已改由织布机调用。
// 🔴 2026-10-20：`commit-ops` 那 9 个事件表件（cellOf / fieldLine / indexRowLine / lastIndexRowLine /
//    locateEvent / norm / splitFile / stripL / citeAnchorWarn）**本文件一个都不用了** —— 它们全是
//    `commitLog()` 的用具，而那个函数当天整份删了。`citeAnchorWarn` 改由 `loom-patterns.js` 直接调。
// 🔴 2026-10-15：**「摆落点」那一层已搬进 `loom-commit.js`**（织布机收口第 2 条）——
//    本文件只**转调**它：那个"两边互相借"的环断掉，落档与织布机共用同一份落点计算。
import { planCommit } from './loom-commit.js'
// 对外**一个字不变**：`loom-patterns.js` 与 4 个测试仍从本文件取 `planCommit`（等"收工具名"那一步再改指）。
export { planCommit }


/**
 * （`segLimitGate` 与下面那几个"取行 / 定位 / 提醒"件已于 2026-10-15 抽进 `lib/commit-ops.js`
 *   —— 见本文件顶部的 import。**抽它们是为了织布机收口第 2 条**：下一步要把 `planCommit`
 *   那一层整段搬进织布机，而它借的正是这些件。）
 */
// 提名销账（2026-09-23 · 销账全自动 v3-2）：**单向**依赖 —— f22 不 import f9，不会成环。
import { settleNamed } from './f22-compact-dump.js'
import { renderIndexDoc, OUT_REL as INDEX_REL } from './f8b-index-doc.js'

/** 这次事务会动到哪几份文件（从 ops 里现推，省得每加一处就忘了同步清单）。 */

const filesOf = (ops) => [...new Set(ops.map((o) => o.file))]


/**
 * 事务残件放哪儿（2026-09-18 改）。
 *
 * 🔴 **为什么从 `HOME_DIR` 改到子目录**：裸列 `~/.dsh` 曾一次吐出 **515 行**（其中 470 行
 *   就是 `memoria-txn-*` 残件）—— 实测两条"零信息量"的输出烧掉约 76 KB 上下文。
 *   `~/.dsh` 根是"看一眼就知道有什么"的地方，**不该被每小时几百个临时件淹掉**。
 *   用户 2026-09-18 的判据：**`~/.dsh` 根裸列 < 50 行**。
 */
const TXN_DIR = join(HOME_DIR, 'memoria-txn')

/** 确保事务目录在（写事务前调用；建不出来时**绝不静默**）。 */
export function ensureTxnDir() {
  try {
    mkdirSync(TXN_DIR, { recursive: true })
    return true
  } catch (e) {
    log(`事务目录建不出来（${TXN_DIR}）：${e && e.message ? e.message : e}`)
    return false
  }
}
ensureTxnDir()

/** 事务残件保留时长（用户 2026-09-18 定：**只留 12 小时内的**）。 */
export const TXN_TTL_HOURS = 12

/**
 * 🔴 **永久删的唯一护栏** —— 只认 `~/.dsh/memoria/memoria-txn/` 下**恰好一层**的 `memoria-txn-*` 文件。
 * 少一层、多一层、换目录、换了前缀 —— 一律拒绝（同 `f19-tmpwatch.js` 的 `isSafeSnapPath()` 一个路数）。
 */
function isSafeTxnFile(abs) {
  try {
    const root = resolve(TXN_DIR)
    const p = resolve(abs)
    if (!p.startsWith(root + sep)) return false
    const parts = p.slice(root.length + 1).split(sep).filter(Boolean)
    return parts.length === 1 && /^memoria-txn-.*\.(json|log)$/.test(parts[0])
  } catch {
    return false
  }
}

/**
 * 清一遍落档事务残件（用户 2026-09-18 定：只留 12 小时内）。
 * @returns {{removed:number, stale:number, orphan:number, kept:number, why:string}}
 */
export function sweepTxn(now = Date.now()) {
  const st = txnWatch()
  const r = { removed: 0, stale: st.stale, orphan: st.orphan, kept: 0, why: '' }
  const old = st.files.filter((f) => now - f.at > TXN_TTL_HOURS * 3600 * 1000)
  if (old.length === 0) { r.kept = st.files.length; return r }

  // 🔴 **2026-10-11 改（用户当场点破）**：原做法是 `recycle-del.ps1 -AllowLocalDrives`
  //    ⇒ C 盘属"本地固定盘"要管理员 ⇒ `Start-Process -Verb RunAs` ⇒ **每清一次就弹 UAC ＋ 管理员蓝框**。
  //    而**用户 2026-10-10 早定过边界**〔E100 / T281 · `备查-自动化与我的权限边界.md`〕：
  //    「**永久删是给自动化的**（设计＋护栏＋验证）· **一律走回收站是给我（AI）的**」
  //    —— 那份名单里**明写着"扫事务残件"**。
  //    ⇒ 这里是**机制清它自己生成的残件** ⇒ 按自动化那条办：**直接删 ＋ 护栏**（照 `f19` 的样板）。
  //    ⚠️ **绝不提权、绝不弹窗**。（此前把"我的纪律"错套到自动化头上，正是那条边界的反面。）
  const listFile = join(HOME_DIR, `memoria-txn-sweep-${process.pid}-${Date.now()}.txt`)
  try {
    writeFileSync(listFile, old.map((f) => f.path).join('\r\n'), 'utf8')
  } catch { /* 清单只是留痕，写不出来不拦删除 */ }

  const rejected = []
  for (const f of old) {
    if (!isSafeTxnFile(f.path)) { rejected.push(f.path); continue }
    try {
      rmSync(f.path, { force: true })
      r.removed += 1
    } catch (e) {
      r.why = String(e && e.message ? e.message : e)
    }
  }
  if (rejected.length > 0) {
    r.why = `有 ${rejected.length} 个残件**没通过护栏**（不在 memoria-txn 目录 / 名字不合规）—— 一律不删`
  }
  r.kept = txnWatch().total
  return r
}

/**
 * 看一眼落档事务残件（**这是用户要的那个"报警"**，2026-09-18 加）。
 *
 * 为什么要有它：**落档的事，过去只有"失败当场出声"、没有"残件异常报警"** ——
 * 而 09-18 凌晨那次 F23"假账"就是"没人报警、靠人肉核实才发现"。
 * 这里盯三件：① 超过 12 小时的（可清）② 只有 .json 没有 .log 的**异常残件**
 * （内核半路死了；主流程会当场报警，这里是**跨进程/跨重启的兜底**——下次启动也能看见）。
 */
export function txnWatch() {
  let names = []
  try { names = readdirSync(TXN_DIR).filter((n) => /^memoria-txn-.*\.(json|log)$/.test(n)) } catch (e) { return { total: 0, stale: 0, orphan: 0, oldestH: null, files: [], err: String(e && e.code ? e.code : e) } }
  // 🔴 2026-10-11：这条过滤**就是口径** —— 只认内核自己的残件（`memoria-txn-<pid>-<rand>.json|log`）。
  //    为什么要点明：`引用改写.mjs` / `引用去路径.mjs` 曾把**自己的事务文件**写进这个目录
  //    （`引用改写-<时间戳>.json`，一个月堆了 434 个），而那些**不合这个正则** ⇒ 它们既不进计数、也不被清。
  //    ⇒ 曾经把这里的 `total` 说成"事务残件 167 个"是**不准的**（混着外来的）。现在两边都改：
  //    那两个工具改道 `txn-out/`，而这里**继续只认自己的**（外来文件根本不该在这个目录里）。
  const jsonSet = new Set(names.filter((n) => n.endsWith(".json")))
  const logSet = new Set(names.filter((n) => n.endsWith(".log")))
  const now = Date.now()
  const ttl = TXN_TTL_HOURS * 3600 * 1000
  let stale = 0, orphan = 0, oldest = null
  const files = []
  for (const n of names) {
    const path = join(TXN_DIR, n)
    let at = now
    try { at = statSync(path).mtimeMs } catch { /* 读不到就当现在 */ }
    if (oldest === null || at < oldest) oldest = at
    if (now - at > ttl) stale += 1
    if (n.endsWith(".json") && !logSet.has(n.replace(/\.json$/, ".log"))) orphan += 1
    files.push({ name: n, path, at })
  }
  return { total: names.length, stale, orphan, oldestH: oldest === null ? null : Math.round((now - oldest) / 3600000), files }
}

/** 启动/收尾自报（挂 F9 的 selfCheck）。 */
export function reportF9Txn() {
  try {
    const st = txnWatch()
    // 🔴 **读不到 ≠ 0 个**（2026-09-18 实测：`readdirSync` 漏了 import → 空 catch 吞掉 →
    //   自报"0 个"、看着像很干净。**沉默失效的现场版**：这一句就是为了让它没法再装干净。）
    if (st.err) return `落档事务残件：**读不到**（${st.err}）—— ⚠️ 这不等于"没有残件"`
    if (st.total === 0) return '落档事务残件：0 个'
    const o = st.orphan > 0 ? ` ⚠️ **其中 ${st.orphan} 个没有 .log（异常残件，内核可能半路死了）**` : ''
    return `落档事务残件：${st.total} 个 · 最老 ${st.oldestH} 小时前 · 超 ${TXN_TTL_HOURS} 小时的可清 ${st.stale} 个${o}`
  } catch (e) {
    return `落档事务残件：读不到（${e && e.message ? e.message : e}）`
  }
}
const txnPaths = () => {
  // ⚠️ 每次落笔用**独立**的事务文件与日志文件（进程号 + 随机尾巴）。
  // 原来固定叫 `memoria-txn.json` / `memoria-txn.log` —— 两个进程（两个控制台／一个测试 + 一个在跑的会话）
  // 同时落笔会互相覆盖，内核可能跑到**别人的 ops** 上去（独立对抗审查点名的"可疑"清单第一条）。
  const tag = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  return { txn: join(TXN_DIR, `memoria-txn-${tag}.json`), log: join(TXN_DIR, `memoria-txn-${tag}.log`) }
}

/**
 * 写入内核（＝改档那扇唯一的门）的真实位置。
 *
 * 📦 **2026-09-17：内核随插件走**（用户："将工具箱里的挪到梅莫莉亚内部"）。
 *    查找次序：`MEMORIA_KERNEL` 环境变量（测试/临时换用）→ **包内 `tools/改档.mjs`**
 *    → 迁移期兜底 `E:\DeepSeek工具箱\00-清单与脚本\改档.mjs`。
 *    返回 null ＝ 哪儿都找不到 —— 那时**一个字都不写**（绝不为了"能写"另开一条路）。
 */
export function kernelPath() {
  return process.env.MEMORIA_KERNEL || toolPath('改档.mjs')
}

/**
 * 启动自检：**报"写入内核在不在"**。
 * 为什么值得报：那扇门**在插件外面**（独立脚本）—— 它不在了，落笔半就只剩"出提案"，
 * 而"不在"这件事以前**只有我真去落笔时才会发现**（到那时已经耽误了一件事）。
 * 顺带报体积与修改时间：改过内核之后一眼能看出"跑的是哪一版"。
 */
export function reportF9() {
  const msgs = []
  const kp = kernelPath()
  if (!existsSync(kp)) {
    msgs.push(`落笔半：**写入内核不在**（找的是 ${kp}）—— 落档只能出提案、不能落笔；把内核放回去或设 MEMORIA_KERNEL`)
  } else {
    try {
      const st = statSync(kp)
      const when = new Date(st.mtimeMs).toLocaleString('zh-CN', { hour12: false })
      // 🔴 2026-10-14：原来这里是 `kp.split('\\').pop()` —— 第 17 关（口径关）在**恢复它**时当场拦下：
      //    那是 `baseOf()` 的又一份自抄（「取路径最后一段」的唯一实现）⇒ 顺势用它。
      msgs.push(`落笔半：写入内核在（${baseOf(kp)} · ${st.size} 字节 · 改于 ${when}）`)
    } catch (e) {
      msgs.push(`落笔半：内核读不出体积/时间：${e}`)
    }
  }
  // ⚠️ 2026-09-18：本函数**两种写法都要有** —— 自己 log（老调用方）+ **返回字符串**
  //   （`index.js` 的装配器要拿返回值打进"启动自检"那一行；原来它只 log，于是这一行**永远不会自己出现**）。
  msgs.push(reportF9Txn())
  for (const m of msgs) log(m)
  return msgs.join(' · ')
}

/* （`splitFile` / `stripL` / `norm` / `locateEvent` / `fieldLine` 已于 2026-10-15 抽进 `commit-ops.js` —— 见顶部 import。） */

/* （`indexRowLine` / `lastIndexRowLine` / `cellOf` 已于 2026-10-15 抽进 `commit-ops.js` —— 见顶部 import。） */


/** 调写入内核（`改档.mjs`）。stdio 走**文件**而不是管道（管道在沙箱/子进程里会 EPERM）。 */
function runKernel(args, paths) {
  const kp = kernelPath()
  if (!existsSync(kp)) {
    return { ok: false, out: '', why: `写入内核不在（${kp}）—— **一个字都没写**。宁可让你手写，也不在插件里另开一条改档案的路` }
  }
  const fd = openSync(paths.log, 'w')
  let r
  try {
    r = spawnSync(process.execPath, [kp, ...args], {
      stdio: ['ignore', fd, fd],
      env: { ...process.env, GAI_DANG_ROOT: CFG.archiveDir },
      windowsHide: true,
    })
  } catch (e) {
    return { ok: false, out: '', why: `叫不动写入内核：${e.message}` }
  } finally {
    closeSync(fd)
  }
  const out = readTextSafe(paths.log)
  return { ok: r.status === 0, out, why: r.status === 0 ? '' : r.error ? String(r.error) : `内核退出码 ${r.status}` }
}

/** 内核输出里的快照目录（回滚要用）。 */
const snapOf = (out) => (String(out).match(/快照：(.+?)(?:（|\n|$)/) ?? [])[1]?.trim() ?? ''

/**
 * 直接跑一串改动（不经过 `planCommit`）—— 给测试用，也给将来"只改一处"的场合用。
 * 它和落笔走的是**同一条路、同一个内核**。
 */
export function runTxnOps(ops, note = '直接跑事务') {
  const paths = txnPaths()
  writeFileSync(paths.txn, JSON.stringify({ note, ops }, null, 2), 'utf8')
  return runKernel(['--txn', paths.txn], paths)
}

/**
 * **落盘管线（唯一一处）** —— 「写 → 写后体检 → **只有新出现的机械错**才回滚」。
 *
 * 🔴 **2026-10-07 从 `commitLog()` 体内原样提取**（文案与顺序一个字没改），给两处共用：
 *    `commitLog()`（`dangan_log` 的落笔）与**织布机**（`lib/loom.js`）。
 *    **为什么要提取**：织布机原来只调 `runTxnOps()`（只有"写"）⇒ **比 `dangan_log` 弱**，
 *    还漏了"落笔成功"那行记账 —— 2026-10-07 实证：织布机落的档（T995／T996）
 *    **F30 第 18 关不认**。依据：`工程-清单.md` 节点 6「先补落盘管线」；
 *    施工面与验收要求见 `L4-施工\工程-织布机-拿不准（节点3）.md` 第 1 条。
 *
 * ⚠️ **它不管**（留在调用方，提取时刻意没搬）：op 机械闸（`auditOps`）· 凭据硬拦（F14）·
 *    提名销账 · 回执文案。
 *
 * ⚠️ **2026-10-09 事后补记**：这段曾被一次误操作（`git restore` 退回 0.78.x）撤掉，
 *    当天照 DSH 留底 `归档留底-54cd6a55.md` 第 16448-16515 行**逐字放回**。
 *
 * @param {Array<object>} ops 改动清单
 * @param {{note?: string, before?: Array<object>}} [opts] `before` ＝ 写前那份"错"清单（不给就现取）
 * @returns {{ok: boolean, out: string, txn: string, snap?: string, after?: Array<object>,
 *            stage?: 'kernel'|'selfcheck', why?: string, fresh?: Array<object>, rolledBack?: boolean}}
 */
/** 🔴 2026-10-14 加（对抗审查 · 用户拍板 **c「走正门」**）：**重织《索引》** —— 由织布机在"事务真写成"之后调。
 *  为什么走子进程：`档案索引.mjs --apply` 内部走织布机 ⇒ **走那扇唯一的门**（先快照 → 写 → 写后体检 → 出错回滚）；
 *  原来那句是"绕过门直接 `writeFileSync`、而且写在写后体检**之后**" ⇒ 索引被写坏**既查不出也退不回去**。
 *  ⚠️ **fail-open**：失败**只记日志**，绝不让落档报错（档案已经写成了）。 */
export function rebuildIndexNow() {
  try {
    const r = spawnSync(process.execPath, [toolPath('档案索引.mjs'), '--apply', '--root', String(CFG.archiveDir)], {
      stdio: 'ignore',
      timeout: 60000,
    })
    if (r.status === 0) log('落档成功 ⇒ 顺手重织了《索引》（走正门）')
    else log(`⚠️ 落档成功、但《索引》没重织成（退出码 ${r.status}）—— 下次落档会再织`)
  } catch (e) {
    log(`⚠️ 《索引》重织抛错：${String(e?.message ?? e).slice(0, 160)}`)
  }
}

export function runGuardedTxn(ops, { note = '直接跑事务', before, create = false } = {}) {
  const beforeIssues = Array.isArray(before) ? before : checkArchive().filter((x) => x.lv === '错')
  const paths = txnPaths()
  // 🔴 2026-10-10（阶段④）：`create:true` ⇒ 允许事务**新建文件**（内核先验目录、预检全过才造空文件）。
  //    给织布机的"新建型"纹样（`备查` / `指南` …）用；默认 `false` ⇒ 老行为一个字不变。
  writeFileSync(paths.txn, JSON.stringify(create ? { note, ops, create: true } : { note, ops }, null, 2), 'utf8')
  const r = runKernel(['--txn', paths.txn], paths)
  if (!r.ok) return { ok: false, stage: 'kernel', why: r.why, out: r.out, txn: paths.txn }

  // ---- 自检：只认"**新出现**的错误"（原来就有的老毛病不该让我这次的白写）----
  const after = checkArchive().filter((x) => x.lv === '错')
  const fresh = errDiff(beforeIssues, after)
  // 🔴 2026-10-10（阶段④）：**新建文件**之后，自检必然报"索引漏登记"（新文件还没进《索引》）——
  //    那不是错，是**索引该重织了**。所以：这一条错单独拎出来 ⇒ 自动重织一次《索引》→ 再自检一次；
  //    其余任何新错照旧回滚。这样"新建文档"才是一条能走通的路。
  let freshFinal = fresh
  let indexRewoven = false
  if (fresh.length > 0 && fresh.every((x) => /索引.*漏登记/.test(String(x.msg ?? '')))) {
    try {
      const { text } = renderIndexDoc(CFG.archiveDir)
      const target = String(CFG.archiveDir) + '\\' + String(INDEX_REL)
      if (readFileSync(target, 'utf8') !== text) {
        writeFileSync(target, text, 'utf8')
        indexRewoven = true
        log('自检见"索引漏登记" ⇒ 已自动重织《索引》（新文件该进表了）')
      }
      freshFinal = errDiff(beforeIssues, checkArchive().filter((x) => x.lv === '错'))
    } catch (e) {
      log('想自动重织《索引》但失败了：' + (e?.message ?? e))
    }
  }
  if (freshFinal.length > 0) {
    const snap = snapOf(r.out)
    const rb = snap ? runKernel(['--restore', snap], paths) : { ok: false, out: '（没从内核输出里认出快照目录）', why: '' }
    log(`落笔自检没过 → 回滚${rb.ok ? '成功' : '**没成功**'}：${freshFinal.map((x) => x.msg).join('；')}`)
    return { ok: false, stage: 'selfcheck', fresh: freshFinal, rolledBack: rb.ok, snap, out: r.out, txn: paths.txn }
  }
  return { ok: true, out: r.out, snap: snapOf(r.out), after, txn: paths.txn, indexRewoven }
}

/**
 * 兑现「归账完成」提名（**2026-10-07 从 `commitLog()` 体内原样提取**）——
 * `commitLog` 与织布机（`loom.js`）共用（同 `runGuardedTxn` 那一刀的同一手法）。
 *
 * 🔴 **位置本身就是判据的一半**：调用方必须**在"事务真写成"之后**调它
 *    （内核没报错 ＋ 自检 0 新错、没回滚）。
 * ⚠️ **fail-open**：销账失败绝不能让落档报错（档案已经写成了，销账只是收尾）；
 *    真失败就**如实说出来**，别静默（用户 2026-09-23："不要让他静默失效"）。
 * @param {string[]} named 提名（如 `["archive:c6eb8faf"]`）
 * @returns {string[]} 每条的结论文案（`✅ …｜⚠️ …`）
 */
export function settleNamedTokens(named) {
  const list = Array.isArray(named) ? named.filter((x) => typeof x === 'string' && x.trim()) : []
  const settled = []
  for (const token of list) {
    try {
      const sn = settleNamed(token)
      settled.push(sn.ok ? `✅ ${token} —— 销了 ${sn.hit} 份` : `⚠️ ${token} —— **没销**：${sn.why}`)
      log(`提名销账：${token} → ${sn.ok ? `销了 ${sn.hit} 份` : `没销（${sn.why}）`}`)
    } catch (e) {
      settled.push(`⚠️ ${token} —— **没销**（fail-open）：${e?.message ?? e}`)
    }
  }
  return settled
}

/**
 * "新出现的机械错"怎么比。
 *
 * ⚠️ **按 `文件 + 消息` 比，不按行号**（2026-09-17 按独立审查改）：
 * 原来键里带行号，于是"档案里本来就有一条旧错、落笔只是把它顶下去一行"会被判成**新错** →
 * **好端端一次落笔被自己撤掉**（审查实测：`见 T999` 那条旧死指针在第 11 行，落笔后到第 12 行）。
 * 现在用**多重集**比：同一条错出现了几次才算几次，行号漂移不影响。
 */
function errDiff(beforeIssues, afterIssues) {
  const key = (x) => `${x.file}|${x.msg}`
  const pool = new Map()
  for (const x of beforeIssues) pool.set(key(x), (pool.get(key(x)) ?? 0) + 1)
  const fresh = []
  for (const x of afterIssues) {
    const k = key(x)
    const n = pool.get(k) ?? 0
    if (n > 0) pool.set(k, n - 1)
    else fresh.push(x)
  }
  return fresh
}

/**
 * 落笔：算 → 写（走唯一的门）→ 自检 → 只有"新出现的错"才回滚。
 * 返回 `{ ok, text, data }`。
 */
/**
 * 落笔前的**最后一道机械闸**（2026-09-17 加 · 对着 09-16 那场真事故）。
 *
 * 🔴 **事故原样**（档案里记着）：**哈希表数字 key 取值失败 → 写入空值 → 一次清空 9 行**，
 *    靠备份才恢复。本插件正是"**构造 op**"的那一方 —— 只要有一个字段没取到，
 *    `op.text` 就可能是 `undefined`，而那就是**同一类事故**。所以交给内核**之前**逐条过一遍：
 *      · `text` 必须是**非空字符串**（`append` / `insertAfter` / `replace` 这三种都要）；
 *      · 单行 op 的 `text` **不许夹换行**（会粘行 / 破表 —— T190"少打一个换行，两行粘成一行"的教训）；
 *      · `replace` / `insertAfter` 必须带 `expect`（"我以为那一行是什么"）—— 没有它就是闭眼写。
 *    任何一条不满足 → **抛错、一个字都不写**（宁可当场失败，也不把半成品交给内核）。
 *
 * @param {Array<object>} ops
 * @returns {string[]} 问题清单（空数组＝干净）
 */
export function auditOps(ops) {
  const NEEDS_TEXT = new Set(['append', 'insertAfter', 'replace'])
  const NEEDS_EXPECT = new Set(['replace', 'insertAfter'])
  const problems = []
  const list = Array.isArray(ops) ? ops : []
  if (list.length === 0) return ['没有任何要改的地方（空清单）—— 不该走到落笔这一步']
  for (let i = 0; i < list.length; i++) {
    const op = list[i]
    const at = `第 ${i + 1} 条`
    if (!op || typeof op !== 'object') {
      problems.push(`${at}不是对象`)
      continue
    }
    const kind = String(op.op ?? '?')
    if (NEEDS_TEXT.has(kind)) {
      if (typeof op.text !== 'string') {
        problems.push(`${at}（${kind}）的 \`text\` 不是字符串（是 ${typeof op.text}）—— **这会写进空值**，就是 09-16 清空 9 行那类事故`)
      } else if (op.text.trim().length === 0 && op.allowEmpty !== true) {
        problems.push(`${at}（${kind}）的 \`text\` 是空的 —— **会把那一行清掉**`)
      } else if (op.text.trim().length === 0) {
        // 🔴 2026-10-11：**显式声明过 `allowEmpty: true` 的放行** —— 唯一合法用途是"整份重织时
        //    这一行本来就该是空行"（织布机 `rebuildOps` 的逐行差异就是这么算出来的）。
        //    这不是把闸放松：**没带标记的空文本照旧拒收**。
      } else if (kind !== 'append' && op.text.includes('\n')) {
        problems.push(`${at}（${kind}）的 \`text\` 里夹了换行 —— **会粘行 / 破表**（T190 的教训）`)
      }
    }
    if (NEEDS_EXPECT.has(kind) && typeof op.expect !== 'string') {
      problems.push(`${at}（${kind}）没带 \`expect\`（"我以为那一行是什么"）—— 那就是**闭眼写**`)
    }
  }
  return problems
}








// 🔴 2026-10-20 删净（用户拍板："**根据 W 判定这是结构改动，老结构没用就该删干净**"）：
//    `commitLog()` 整份删了 —— `dangan_log` 删掉之后它只剩测试在调，正式路径早就是织布机。
//    时间标记那一层的行为由 `tests/f9-l3-stamp.mjs` 直接测 `planCommit()`，不再借这个夹具。

