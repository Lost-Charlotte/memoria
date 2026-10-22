#!/usr/bin/env node
/**
 * 改档.mjs —— 改 `DeepSeek档案` 里的行（**唯一的一扇门**）
 *
 * 设计只围绕一句话（用户 2026-09-16 定的）：**先确认"路"是通的，再动手。**
 * 09-14 丢的 8 个文件里，已查明机理的 4 个就是"搬运指向一个不存在的地址"——
 * `Move-Item -Destination 'G:\...\GTS'`（GTS 不存在）→ 源被改名成那个路径 → 再 -Force 覆盖。
 * 所以这里不搞别的花样，只把"路"验三遍：文件在不在、行在不在、路径出没出档案。
 *
 * 用法（三种模式）：
 *   ① 改一行：node 改档.mjs --file "L1-必读\索引.md" --line 5 --set "新的一整行"
 *   ② 加一行：node 改档.mjs --file "L2-数据\01-事件表-我们做过什么.md" --append --set "要追加的一整行"
 *   ③ 一个事务：node 改档.mjs --txn "<事务文件.json>" [--dry-run]
 *   ④ 还原：node 改档.mjs --restore "L6-工具临时\改档快照\<时刻>" [--dry-run]
 *   路径写档案内的相对路径即可。任一检查不过 → 报错退出，一个字都不写。
 *
 * ⚠️ `--append` 是 2026-09-16 深夜为"梅莫莉亚的落笔半"加的（用户批准）：
 *   **一次只追加一行** —— 要写一段（比如一条事件条目），就一行一次调用。
 *
 * ⚠️ `--txn` / `--restore` 是 2026-09-17 凌晨加的（**落笔半的写入内核**）。
 *   为什么不另起一个 `落档.mjs`：**门只能有一扇** —— 多一个脚本就多一条能改档案的路。
 *   事务模式做的事：**全部先验 → 自动快照 → 写 → 逐文件读回比对 → 任一不过全部还原**。
 *   事务文件长这样（`line` 一律是**改动前**的行号）：
 *   {
 *     "note": "为什么改（只写给人看，会存进快照清单）",
 *     "ops": [
 *       { "op": "append",      "file": "...", "text": "...", "expectLast": "改动前的末行" },
 *       { "op": "replace",     "file": "...", "line": 659, "text": "新行", "expect": "原行" },
 *       { "op": "insertAfter", "file": "...", "line": 671, "text": "要插进去的一行" },   // line=0 → 插到最前
 *       { "op": "blankAfter",  "file": "...", "line": 671 }                              // 只插一个空行
 *     ]
 *   }
 *   `expect` / `expectLast` 可以不填，但**填了才有防撞能力**。
 *
 * ⚠️ **2026-09-17 凌晨按一场独立对抗审查的结果加固**（那一轮真找出 11 处问题，这里是逐条修）：
 *   · 快照目录名**精确到毫秒 + 进程号 + 随机尾巴**，且建目录用**非 recursive**（撞了就换名再建）
 *     —— 原来只到秒，同一秒内两个事务会共用同一个快照目录、**前一个的安全网被覆盖**；
 *   · `--restore`：**必须在快照根之下** · **清单必须与该目录内容一致** · **先全量预检再动手**
 *     · **半路失败要把已改的退回去** · **`--dry-run` 也算数**（原来这四条全没有：指错目录＋手写清单
 *     就能覆盖档案里任意文件，半路失败还会说"一个都没还原"）；
 *   · **换行风格逐行保留**（原来"文件里有 CRLF 就整篇 CRLF"→ 混用换行的文件会被整篇改掉，
 *     而体检看不见换行，于是**不回滚**）；
 *   · **写之前把整份文件重读一遍**，跟我读过的那份不一致就停手（原来读→写之间不复核，
 *     整篇内存副本会把**别人的改动覆盖掉**，回滚还声称"已确认都是改之前的原样"）；
 *   · **同一个文件只能用一种写法**（`x.md` 与 `.\x.md` 原来被当成两个文件、两份状态）；
 *   · **同一行不许两条 replace**（原来先写的赢、后写的无声消失）；
 *   · **空文件的行数是 0**（原来 `--append` 到 0 字节文件会"写了却报没动"）；
 *   · 写盘改成**临时文件 + 原子改名**（不会被读到写了一半的文件）。
 *
 * ⚠️ **2026-09-18 凌晨补：快照 / 还原 / 回滚 / 读回比对 一律走「字节」（Buffer），不走 UTF-8 串。**
 *   原来这四处的快照都是 `writeFileSync(p, raw, 'utf8')`：**非 UTF-8 文件在"快照"这一步
 *   就已经被解码成 U+FFFD 再写出去** —— 快照本身不是原样，退路自然也是坏的。
 *   更坏的一处是**读回比对**：按 utf8 串比时，非 UTF-8 文件的盘上内容与内存副本**两边都是
 *   U+FFFD → 判"一致"**，"写得对不对"这件事在那类文件上根本没人看。
 *   现在：快照＝逐字节拷（并从磁盘重读一次，不信内存里那份被解码过的串）· 还原＝写回那些字节 ·
 *   回滚＝从快照目录读回字节 · 读回比对＝`Buffer.equals`。
 *   （出处：《待办》§四「回退时的字节快照」—— 真档案 187 份现在全是合法 UTF-8，所以这是个"万一"。）
 */

import fs from 'node:fs'
import path from 'node:path'
// 🔴 2026-10-16：`activeArchiveDir()` —— **活跃馆解析的唯一来源**（`GAI_DANG_ROOT` → 馆表的
//    `active` → 老兜底）。原来这里写死 `|| 'C:\\Users\\admin\\Desktop\\DeepSeek档案'`：
//    插件调它时总会把 `GAI_DANG_ROOT` 带过来、所以那条路没事，但**人在新馆的命令行里手工跑**它时，
//    默认值会指到旧馆 —— 这正是"脚本不跟随活跃馆"那一族。
import { activeArchiveDir } from '../lib/common.js'

// 档案根目录。⚠️ 允许用环境变量换掉（`GAI_DANG_ROOT`）—— 梅莫莉亚调它时会把**自己那份配置**
// 传进来，这样"插件认哪个档案"与"内核认哪个档案"永远是同一个；测试也靠它指向样本档案。
const ROOT = path.resolve(activeArchiveDir())
const SNAP_ROOT = path.join(ROOT, 'L6-工具临时', '改档快照')
const argv = process.argv.slice(2)
const get = (k) => {
  const i = argv.indexOf(k)
  if (i < 0) return undefined
  const v = argv[i + 1]
  // 漏写值时，下一个开关会被当成内容写进档案（自测时真写进去了一个 "--dummy"）
  return v === undefined || v.startsWith('--') ? undefined : v
}
const file = get('--file')
const line = Number(get('--line'))
const set = get('--set')
const append = argv.includes('--append')
const txnFile = get('--txn')
const restoreDir = get('--restore')
const dryRun = argv.includes('--dry-run')

const fail = (why, extra) => {
  console.error(`❌ ${why}${extra ? `\n${extra}` : ''}`)
  process.exit(1)
}
/** "一个字都没写"的失败（验不过、参数不对）。 */
const die = (why) => fail(`${why} —— 没动任何文件`)

/**
 * 本次事务"新造出来的空文件"的**退出清理**（阶段④）。
 * 判据：**只删空的** —— 万一里面已经写进内容（说明事务走到了后面），绝不删。
 */
function cleanupCreated() {
  let n = 0
  for (const abs of createdOnDisk) {
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).size === 0) { fs.unlinkSync(abs); n++ }
    } catch { /* 清不掉就算了 */ }
  }
  // 🔴 2026-10-16：本次**新建过的目录**也收尾 —— **只删空的**（里面一旦有东西就说明事务走到后面了，绝不删）。
  //    倒着来（深的先删）—— 顺序反过来会先撞上非空而停下。
  for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    } catch { /* 清不掉就算了 */ }
  }
  return n
}
process.on('exit', () => {
  const n = cleanupCreated()
  if (n > 0) console.log(`  ↺ 已清掉本次新造的 ${n} 个空文件（事务没写成）`)
})

/** 快照目录名：**毫秒 + pid + 随机**，保证"一个事务一个独占目录"。 */
const stamp = () => {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const rnd = Math.random().toString(36).slice(2, 6)
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}-${process.pid}-${rnd}`
}

/**
 * 写单条改动（模式 ①/②）**之前**先快照 —— 与事务模式同一套目录与清单格式，
 * 所以事后一样能用 `--restore <快照目录>` 退回来。
 *
 * ⚠️ 2026-09-17 晚补：原来只有 `--txn` 那条路会快照，**单条模式改错了没有任何退路**。
 * 只写**这一条**要动的文件（不是整份事务的文件集）。
 * 建不出快照 → 按 fail-closed 处理：**一个字都不写**。
 */
const snapshotBefore = (absList) => {
  let snapDir = path.join(SNAP_ROOT, stamp())
  try {
    fs.mkdirSync(SNAP_ROOT, { recursive: true })
  } catch (e) {
    die(`建不出快照根目录（${e.message}）—— 一个字都没写`)
  }
  let made = false
  for (let n = 0; n < 50 && !made; n++) {
    try {
      fs.mkdirSync(snapDir)
      made = true
    } catch {
      snapDir = path.join(SNAP_ROOT, `${stamp()}-${n}`)
    }
  }
  if (!made) die('建不出快照目录（磁盘满 / 权限？）—— 一个字都没写')
  const files = []
  for (const abs of absList) {
    const rel = relOf(abs)
    const p = path.join(snapDir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    // ⚠️ **按字节快照**（2026-09-18 改，出处见《待办》§四）：原来写调用方递进来的 `it.raw`
    //    （UTF-8 字符串），非 UTF-8 文件在"快照"这一步就已经被解码成 U+FFFD ——
    //    快照本身不是原样，退路自然是坏的。这里改为**从磁盘重读一次 Buffer**，
    //    不信内存里那份被解码过的字符串。
    const buf = fs.readFileSync(abs)
    fs.writeFileSync(p, buf)
    files.push({ file: rel, bytes: buf.length })
  }
  fs.writeFileSync(
    path.join(snapDir, 'manifest.json'),
    JSON.stringify({ at: new Date().toISOString(), note: '单条改动（模式 ①/②）前快照', files }, null, 2),
  )
  console.log(`📦 快照：${snapDir}（改错了用 --restore 退回来）`)
  return snapDir
}

// ============================================================
// 共用：路径与文件
// ============================================================

/** 档案内相对路径 → 绝对路径；不在档案里或文件不存在，当场停手。
 *  🔴 2026-10-10 加 `allowCreate`（织布机收口 · 阶段④）：事务里写了 `create:true` 时，
 *  **不存在的文件不在这里造** —— 只把它登记进 `pendingCreate`（相对路径 ＋ 绝对路径）；
 *  真造放在"预检全过之后"（本文件靠下那一段）。这样"预检失败 ⇒ 盘上一个文件都没多"。
 *  ⚠️ 造出来的空文件一旦本次事务没写成 ⇒ 由退出钩子 `createdOnDisk` 删掉（只删**空的**）。
 */
const pendingCreate = new Map()   // abs → rel
const createdOnDisk = new Set()   // 已经真造出来的（退出时按需清）
// 🔴 **2026-10-16 加**（用户当天拍板："**让'派生文档'允许首次创建**"，原话在待办 §四）：
//    `create:true` 时若**父目录也不存在**，原来一律拒（`路不通：… 的目录也不存在`）⇒
//    新馆（`L3-知识` 下还没有 `知识\指南\` 这类子目录）**第一份文档永远建不出来**。
//    ⇒ 改成**补建目录链**（就在"造空文件"那一步之前、由文件路径现算），这里记下"本次新建过哪些目录"，
//    退出/失败时**只删空的**（照 `createdOnDisk` 那个口径）。
//    ⚠️ 目录先于预检被建出来 —— 万一预检失败，**空的目录可能留下**（"预检失败 ⇒ 盘上一个文件都没多"
//    这条仍成立：多出来的只是**目录**）。留一个空目录，比"建不出文件"轻。
const createdDirs = new Set()     // 本次新建出来的目录（退出时按需清）
const absOf = (rel, allowCreate = false) => {
  if (typeof rel !== 'string' || rel.length === 0) die('没写文件路径')
  const abs = path.resolve(ROOT, rel)
  if (!abs.startsWith(ROOT + path.sep)) die(`路不通：${rel} 不在档案里`)
  if (!fs.existsSync(abs)) {
    if (!allowCreate) die(`路不通：${rel} 不存在（要新建文件，先确认目录也在）`)
    // 🔴 2026-10-16：父目录不在**不再 die** —— 交给"造空文件"那一步就地 `mkdirSync(recursive)` 补建。
    //    这里只把"父目录在不在档案之内"验掉（越界仍然当场拒）。
    const dir = path.resolve(path.dirname(abs))
    if (!dir.startsWith(ROOT + path.sep)) die(`路不通：${rel} 的目录不在档案里`)
    pendingCreate.set(abs, path.relative(ROOT, abs))
    return abs
  }
  return abs
}

/** 绝对路径 → 统一的相对写法（给消息用；同一文件永远同一个 key）。 */
const relOf = (abs) => path.relative(ROOT, abs)

/**
 * 把一个文件读成"行 + **每一行后面原来是什么换行** + 末尾有没有换行"。
 *
 * ⚠️ 逐行保留换行（2026-09-17 改）：原来只记一个"有没有 CRLF"，渲染时**整篇**用那一种 →
 * 混用换行的文件会被整篇改掉；而体检一律按 `\r?\n` 切，**看不见换行风格**，于是这种改动
 * 既不报错、也不会被"新错才回滚"拦住（审查实测：`A一\nB二\r\nC三\r\nD四\n` 改第 2 行 → 四行全变 CRLF）。
 */
const splitFile = (abs) => {
  // ⚠️ **原始字节一并留着**（2026-09-18 加）：`raw` 是解码后的串，非 UTF-8 文件在这一步
  //    就已经有 U+FFFD 了 —— "盘上还是不是我读到的那串字节"这种判断**必须拿 Buffer 比**。
  const rawBuf = fs.readFileSync(abs)
  const raw = rawBuf.toString('utf8')
  if (raw === '') return { raw, rawBuf, eol: '\n', tail: false, lines: [], ends: [] }
  const parts = raw.split(/(\r\n|\n|\r)/)
  const lines = []
  const ends = []
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i])
    ends.push(parts[i + 1] ?? '')
  }
  // 末尾有换行时，split 会多留一个"空内容 + 空结尾" → 去掉，把那个换行留在上一行
  if (lines.length > 1 && lines[lines.length - 1] === '' && ends[ends.length - 1] === '') {
    lines.pop()
    ends.pop()
  }
  const crlf = (raw.match(/\r\n/g) ?? []).length
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length
  const eol = crlf > lf ? '\r\n' : '\n' // 新插入的行用**多数派**换行；原有行的换行一律不动
  return { raw, rawBuf, eol, tail: /[\r\n]$/.test(raw), lines, ends }
}

/** 行 + 逐行换行 → 文件内容（逐字节还原原有风格）。 */
const render = (lines, ends) => lines.map((l, i) => l + (ends[i] ?? '')).join('')

/** 临时文件 + 原子改名：不会被读到写了一半的文件。`content` 可以是**字符串**（按 UTF-8 编码）或**Buffer**（逐字节写）。 */
const writeAtomic = (abs, content) => {
  const tmp = `${abs}.gai-tmp`
  fs.writeFileSync(tmp, content, typeof content === 'string' ? 'utf8' : undefined)
  fs.renameSync(tmp, abs)
}

// ============================================================
// 模式 ④：从快照还原
// ============================================================
if (restoreDir) {
  const dir = path.resolve(ROOT, restoreDir)
  const snapRootAbs = path.resolve(SNAP_ROOT)
  // ⚠️ 加固 ③：**只认快照根之下的目录**。原来 dir 随便指哪都行 —— 造一个目录 + 手写一份
  // manifest 就能覆盖档案里任意文件，还报"✓ 已还原"。
  if (!dir.startsWith(snapRootAbs + path.sep)) {
    die(`还原只认快照根之下的目录：${dir}`,
      `   快照根是：${snapRootAbs}\n   要把别处的快照拿来还原，先把整个目录拷进快照根下面再试`)
  }
  const manFile = path.join(dir, 'manifest.json')
  if (!fs.existsSync(manFile)) die(`路不通：${manFile} 不存在（还原要那张快照清单）`)
  let man
  try {
    man = JSON.parse(fs.readFileSync(manFile, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    die(`快照清单不是合法 JSON：${e.message}`)
  }
  if (man?.root && path.resolve(man.root) !== ROOT) {
    die(`这份快照不是本档案的（快照记的档案根是 ${man.root}，现在是 ${ROOT}）`)
  }
  const files = Array.isArray(man?.files) ? man.files : []
  if (files.length === 0) die('快照清单里没有文件')

  // ⚠️ 加固 ②：**清单必须与该目录里真实躺着的东西一致**（原来"清单列了 B、目录里没有 B"
  // 会先改了 A 再报"一个都没还原" —— A 已经变了）。
  const inDir = []
  const walkDir = (d, prefix = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const relp = prefix ? `${prefix}\\${e.name}` : e.name
      if (e.isDirectory()) walkDir(p, relp)
      else if (relp !== 'manifest.json') inDir.push(relp)
    }
  }
  walkDir(dir)
  const want = files.map((f) => String(f?.file ?? '').replace(/\//g, '\\')).filter(Boolean)
  const missing = want.filter((w) => !inDir.includes(w))
  const extra = inDir.filter((w) => !want.includes(w))
  if (missing.length > 0 || extra.length > 0) {
    die('快照目录与那份清单**对不上** —— 一个都没还原',
      `   清单里有、目录里没有：${missing.join('、') || '无'}\n   目录里有、清单里没列：${extra.join('、') || '无'}\n   （这种快照不可信；换一份，或人工比对）`)
  }

  // ⚠️ 加固 ②：**先全量预检**（每个目标都在档案里、且能写），再动手。
  const plan = []
  for (const w of want) {
    const src = path.join(dir, w)
    const dst = absOf(w)
    try {
      fs.accessSync(dst, fs.constants.W_OK)
    } catch {
      die(`还原不了：${w} 现在不可写（被别的程序占着？）—— 一个都没还原`)
    }
    plan.push({ rel: w, src, dst, want: fs.readFileSync(src), had: fs.readFileSync(dst) })
  }

  if (dryRun) {
    console.log('【干跑 · 一个字都没写】会把这些文件还原成快照里的样子：')
    for (const p of plan) console.log(`   ${p.rel}（${p.had.length} → ${p.want.length} 字节）`)
    process.exit(0)
  }

  const done = []
  const undoAll = (why) => {
    // 把已经改过的退回"还原之前"的样子
    const bad = []
    for (const d of done) {
      try {
        writeAtomic(d.dst, d.had)
        if (!fs.readFileSync(d.dst).equals(d.had)) bad.push(d.rel)
      } catch {
        bad.push(d.rel)
      }
    }
    fail(`还原失败：${why}`,
      bad.length === 0
        ? `   已把这次还原过的 ${done.length} 个文件**退回还原之前**的样子`
        : `   ⚠️ 这几个退不回去，需要人看一眼：${bad.join('、')}`)
  }
  for (const p of plan) {
    try {
      writeAtomic(p.dst, p.want)
      if (!fs.readFileSync(p.dst).equals(p.want)) throw new Error('读回不一致')
    } catch (e) {
      undoAll(`${p.rel}：${e.message}`)
    }
    done.push(p)
    console.log(`✓ 还原 ${p.rel}`)
  }
  console.log(`✓ 已从快照还原 ${done.length} 个文件（${man.at ?? '?'} 那次）`)
  process.exit(0)
}

// ============================================================
// 模式 ③：一个事务（落笔半用它）
// ============================================================
if (txnFile) {
  const txnAbs = path.resolve(txnFile)
  if (!fs.existsSync(txnAbs)) die(`事务文件不存在：${txnFile}`)
  let txn
  try {
    // 本机 pwsh 的 `Set-Content -Encoding UTF8` 会写 BOM —— BOM 会让 JSON.parse 直接报错，
    // 所以这里顺手剥掉（自测时真踩到：手写的四份事务文件全被 BOM 卡住）
    txn = JSON.parse(fs.readFileSync(txnAbs, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    die(`事务文件不是合法 JSON：${e.message}`)
  }
  const ops = Array.isArray(txn?.ops) ? txn.ops : []
  if (ops.length === 0) die('事务里没有任何操作')

  // ---- 第一步：逐条验（路通不通 / 行号对不对 / 有没有别人先动过 / 有没有自相矛盾的写法）----
  // ⚠️ 加固 ⑥：**一律按绝对路径当 key** —— 原来按用户写的字符串，`x.md` 与 `.\x.md`
  // 会被当成两个文件、两份独立状态（后一个把前一个的结果整篇覆盖）。
  const state = new Map()
  const order = []
  const replaceAt = new Set() // `${abs}:${line}` → 同一行两条 replace 直接拒（原来先写的赢、后写的无声消失）
  // 🔴 2026-10-10（阶段④）：预检里"本文件最后一条 append 的文本" —— 同一文件连着几条 append 时，
  //    后面每条要拿"前面那条刚写进去的文本"当基准；**不能**往 st.lines 里 push（那会让每条写两遍）。
  const previewLast = new Map()
  // 🔴 2026-10-10（阶段④）：`create:true` 时，先把"待新建的空文件"**都造出来**（再逐条验）。
  //    为什么提前：预检是**逐条累积**的（后面每条 append 的 `expectLast` 要拿前面那条的结果），
  //    而"文件不存在"会让第一条 append 之后的状态与盘上对不上。造的是**空文件**，
  //    真要预检失败 ⇒ 退出钩子 `cleanupCreated()` 会把**空的**删掉。
  if (txn?.create === true) {
    // 🔴 2026-10-16：造空文件之前**就地补建父目录**（原来父目录不在就直接 die ⇒ 首建永远建不出来）。
    for (const [abs, rel] of pendingCreate) {
      const dir = path.dirname(abs)
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); createdDirs.add(dir); console.log(`  📁 新建目录：${path.relative(ROOT, dir)}`) }
      if (!fs.existsSync(abs)) { fs.writeFileSync(abs, '', 'utf8'); createdOnDisk.add(abs); console.log(`  🆕 新建空文件：${rel}`) }
    }
  }
  for (const [i, op] of ops.entries()) {
    const at = `第 ${i + 1} 条`
    if (!op || typeof op !== 'object') die(`${at}：不是一个对象`)
    if (op.op !== 'blankAfter' && op.op !== 'deleteLine') {
      // 🔴 2026-10-14：**认 `allowEmpty: true`**（唯一合法用途 ＝ 整份重织时"这一行本来就该是空行"）。
      //    为什么补：`f9-commit.js` 的 `auditOps` 与 `loom-patterns.js` 的 `rebuildOps` **早就按这个口径
      //    写好了**（2026-10-11），**只有这一处没跟上** ⇒ "整份重织撞上空行"这条路一直是断的
      //    （2026-10-14 加索引的时间列，第一次撞上它：`❌ 第 107 条：text 是空的`）。
      //    ⚠️ 这**不是放宽**：没带标记的空文本**照旧拒**（防的仍是 09-16「清空 9 行」那类事故）。
      // ⚠️ 2026-10-14（对抗审查抓到）：**尺子要与 `f9-commit.js` 的 `auditOps` 完全一致** ——
      //    那边判 `trim()`、这边原来判 `length` ⇒ 写"几个空格"能从两道缝里穿过去。
      if (typeof op.text !== 'string' || (op.text.trim().length === 0 && op.allowEmpty !== true)) die(`${at}：text 是空的（不许写空值）`)
      if (/[\r\n]/.test(op.text)) die(`${at}：一条操作只写一行（text 里有换行）`)
    }
    const abs = absOf(op.file, txn?.create === true)
    if (!state.has(abs)) {
      // 🔴 2026-10-10（阶段④）：`create:true` 时文件可能还不存在（本轮才造）——
      //    不能拿 splitFile 去读它（那条路是 readFileSync，会 ENOENT 炸）；给一份"空状态"顶上。
      //    ⚠️ 造文件的动作在"预检全过之后"（见本文件靠下那一段），所以这里只是**借一份空状态**。
      const sp = fs.existsSync(abs)
        ? splitFile(abs)
        : { lines: [], ends: [], eol: '\n', raw: Buffer.alloc(0), rawBuf: Buffer.alloc(0), hadTrailingNl: false }
      state.set(abs, { abs, rel: relOf(abs), ...sp, n0: sp.lines.length, ops: [] })
      order.push(abs)
    }
    const st = state.get(abs)
    const rel = st.rel

    if (op.op === 'append') {
      if (typeof op.expectLast === 'string') {
        // 🔴 2026-10-10（阶段④）：末行要看 **st.lines**（预检逐条累积的结果）——
        //    同一文件连着几条 append 时，后面每条要拿"前面那条刚写进去的文本"当基准；
        //    空/新文件没有"末行" ⇒ 当空串看。
        const last = previewLast.has(abs) ? previewLast.get(abs) : (st.lines.length > 0 ? st.lines[st.lines.length - 1] : '')
        if (last !== op.expectLast) {
          die(`${at}：${rel} 的**末行已经变了**（我读到的是「${last}」）`,
            '   → 我算行号之后有人动过这个文件 —— 停手，重新读一遍再落')
        }
        previewLast.set(abs, op.text)   // 预检基准（下一条 append 拿它比）
      }
    } else if (op.op === 'replace' || op.op === 'insertAfter' || op.op === 'blankAfter' || op.op === 'deleteLine') {
      const n = Number(op.line)
      if (!Number.isInteger(n)) die(`${at}：${op.op} 要给一个整数 line`)
      if (op.op === 'replace' && n === 0) die(`${at}：replace 的行号要从 1 起（0 只给 insertAfter / blankAfter 用）`)
      if (n < 0 || n > st.lines.length) die(`${at}：${rel} 只有 ${st.lines.length} 行，第 ${n} 行不存在`)
      if (op.op === 'deleteLine') {
        // 删行是**破坏性**的：2026-09-17 加它，因为"删一行"以前只能绕过这扇门去干（那正是不许的）。
        // 所以**必须**写 expect —— 不许"凭行号删"，行号一漂就删错行。
        if (n < 1) die(`${at}：deleteLine 的行号要从 1 起`)
        if (typeof op.expect !== 'string') die(`${at}：deleteLine **必须**写 expect（那一行现在是什么）—— 不许凭行号删`)
        if (st.lines[n - 1] !== op.expect) {
          die(`${at}：${rel} 第 ${n} 行**不是我以为的那一行**（删行就更不能猜）—— 停手`,
            `   我读到的是：${st.lines[n - 1]}\n   我以为的是：${op.expect}`)
        }
      }
      if (op.op === 'replace') {
        const key = `${abs}:${n}`
        if (replaceAt.has(key)) die(`${at}：同一个文件的第 ${n} 行有**两条 replace** —— 会有一条无声消失，两条都别写，合成一条`)
        replaceAt.add(key)
      }
      if (typeof op.expect === 'string' && op.op !== 'deleteLine') {
        // ⚠️ 加固 ⑦：line=0 时**没有"那一行"可比** → 填了 expect 就是假的安心，直接拒
        if (n === 0) die(`${at}：insertAfter line=0（插到最前）**没法核对 expect** —— 要么去掉 expect，要么给 1..N 的行号`)
        if (st.lines[n - 1] !== op.expect) {
          die(`${at}：${rel} 第 ${n} 行**不是我以为的那一行** —— 停手`,
            `   我读到的是：${st.lines[n - 1]}\n   我以为的是：${op.expect}`)
        }
      }
    } else {
      die(`${at}：op 只能是 append / replace / insertAfter / blankAfter / deleteLine（收到 ${JSON.stringify(op.op)}）`)
    }
    st.ops.push(op)
  }

  // ---- 第二步：在内存里把结果算出来（行号从大到小动，才不会串位）----
  // ⚠️ **同一行号上的多条插入，落下来要跟事务里的先后顺序一致**。
  // 实现上是**倒着 splice** 的：因为 `splice(at,0,x)` 每插一条就把前面那条挤到右边，
  // 所以"同一行号"的多条要按**事务里从后往前**的顺序应用（自测踩过：不加这个，
  // 新事件条目会**整块上下颠倒**，`# E2｜…` 跑到最后，被体检当成"裸条目"）。
  for (const abs of order) {
    const st = state.get(abs)
    const shifted = st.ops
      .map((o, i) => ({ o, i }))
      .filter((x) => ['replace', 'insertAfter', 'blankAfter', 'deleteLine'].includes(x.o.op))
      .sort((a, b) => Number(b.o.line) - Number(a.o.line) || b.i - a.i)
      .map((x) => x.o)
    for (const o of shifted) {
      const n = Number(o.line)
      if (o.op === 'replace') {
        st.lines[n - 1] = o.text // 换行不动
      } else if (o.op === 'deleteLine') {
        st.lines.splice(n - 1, 1)
        st.ends.splice(n - 1, 1)
      } else {
        st.lines.splice(n, 0, o.op === 'blankAfter' ? '' : o.text)
        st.ends.splice(n, 0, st.eol) // 新插入的行用多数派换行
      }
    }
    const appends = st.ops.filter((o) => o.op === 'append')
    for (const o of appends) {
      // 末尾本来没换行 → 先给上一行补一个，否则会把两行粘成一行
      if (st.ends.length > 0) st.ends[st.ends.length - 1] = st.ends[st.ends.length - 1] || st.eol
      st.lines.push(o.text)
      st.ends.push(st.eol)
    }
    st.after = render(st.lines, st.ends)
    st.countBefore = st.n0
    st.countAfter = st.lines.length
  }

  // ---- 第三步：干跑就到此为止 ----
  if (dryRun) {
    console.log('【干跑 · 一个字都没写】')
    for (const abs of order) {
      const st = state.get(abs)
      console.log(`  ${st.rel}：${st.countBefore} → ${st.countAfter} 行`)
      for (const o of st.ops) {
        if (o.op === 'append') console.log(`    + 末尾追加：${o.text}`)
        if (o.op === 'replace') console.log(`    ~ 第 ${o.line} 行：\n        旧：${st.raw.split(/\r?\n/)[Number(o.line) - 1]}\n        新：${o.text}`)
        if (o.op === 'insertAfter') console.log(`    + 第 ${o.line} 行后插入：${o.text}`)
        if (o.op === 'blankAfter') console.log(`    + 第 ${o.line} 行后插入：空行`)
        if (o.op === 'deleteLine') console.log(`    - 删掉第 ${o.line} 行：${o.expect}`)
      }
    }
    process.exit(0)
  }

  // ---- 第三步半：**预检全过之后**才造"待新建的空文件" ----
  // 🔴 2026-10-10（阶段④）：事务里 `create:true` 时，不存在的文件在上面只"登记"不造；
  //    到这儿才真造 —— 于是"预检失败 ⇒ 盘上一个文件都没多"。
  //    只造**空文件**（内容由后面的 op 写）。
  //    🔴 2026-10-16：**就地补建父目录**（原来 `absOf` 会在"父目录不存在"时直接 die
  //    ⇒ 首建永远建不出来）。选择在**这一处**补，而不是更早：`pendingCreate` 是在下面的
  //    预检循环里、调 `absOf()` 时才被填满的 —— 比这更早的循环全是空转（实测踩过）。
  if (pendingCreate.size > 0) {
    for (const [abs, rel] of pendingCreate) {
      const dir = path.dirname(abs)
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); createdDirs.add(dir); console.log(`  📁 新建目录：${path.relative(ROOT, dir)}`) }
      fs.writeFileSync(abs, '', 'utf8')
      createdOnDisk.add(abs)
      console.log(`  🆕 新建空文件：${rel}`)
    }
    console.log(`（新建 ${pendingCreate.size} 个文件 —— 内容由本次事务写进去）`)
  }

  // ---- 第四步：**写之前把整份文件重读一遍**（加固 ⑤）----
  // 原来读→写之间不复核：整篇内存副本会把"别人在这段窗口里写的改动"覆盖掉，
  // 回滚还声称"已确认都是改之前的原样"（它的"之前"是自己的过期副本）。
  for (const abs of order) {
    const st = state.get(abs)
    let now = null
    try {
      now = fs.readFileSync(abs)
    } catch (e) {
      die(`${st.rel} 读不回来了：${e.message}`)
    }
    // ⚠️ 逐字节比（2026-09-18 改）：按 utf8 串比时，非 UTF-8 文件的前后两份都是 U+FFFD
    //    → **"有人在这段窗口里改过它"会被漏检**。这里比的是**盘上 ≠ 我读进来时的那串字节**
    //    （`splitFile` 当时留下的 `rawBuf`）—— 与"算出来的新内容"无关，所以不会误杀
    //    "本来是非 UTF-8 的文件"。
    if (!now.equals(st.rawBuf)) {
      die(`${st.rel} 在我算完之后**被改过**（不是我读到的那一份）—— 一个字都没写`,
        '   → 可能是另一个会话/脚本同时动了它。重新读一遍、重新算行号再落')
    }
  }

  // ---- 第五步：先快照（**改之前**的原样拷一份，出任何事都能退回来）----
  // ⚠️ 加固 ①：目录名到毫秒 + pid + 随机，且**非 recursive 建目录** —— 撞了就换名，绝不共用。
  let snapDir = path.join(SNAP_ROOT, stamp())
  fs.mkdirSync(SNAP_ROOT, { recursive: true })
  for (let n = 0; n < 50; n++) {
    try {
      fs.mkdirSync(snapDir)
      break
    } catch {
      snapDir = path.join(SNAP_ROOT, `${stamp()}-${n}`)
    }
  }
  if (!fs.existsSync(snapDir)) die('建不出快照目录（磁盘满 / 权限？）—— 一个字都没写')
  for (const abs of order) {
    const st = state.get(abs)
    const p = path.join(snapDir, st.rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    // ⚠️ **按字节快照**（2026-09-18 改）：见 `snapshotBefore` 上那段注释 ——
    //    写 `st.raw` 会把非 UTF-8 文件的字节在快照这一步就换成 U+FFFD。
    const buf = fs.readFileSync(abs)
    fs.writeFileSync(p, buf)
    st.snapBytes = buf.length
  }
  fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify({
    at: new Date().toISOString(),
    root: ROOT,
    note: typeof txn.note === 'string' ? txn.note : '',
    files: order.map((abs) => ({
      file: state.get(abs).rel,
      linesBefore: state.get(abs).countBefore,
      linesAfter: state.get(abs).countAfter,
      bytes: state.get(abs).snapBytes,
    })),
    ops,
  }, null, 2), 'utf8')

  /** 把写过的全部退回快照时的原样；并**如实报告**哪些真的退不回去。 */
  const rollback = (why) => {
    const bad = []
    for (const abs of order) {
      const st = state.get(abs)
      let ok = false
      try {
        // ⚠️ **退回快照里那一份字节**（2026-09-18 改）：原来退回的是内存里的 `st.raw`（UTF-8 串）
        //    —— 非 UTF-8 文件在"读进来"那一步就已经被解成 U+FFFD，退回去的是**坏掉的副本**。
        //    现在认准快照目录里那份**逐字节拷下来的原件**（它就是这份档案的退路）。
        const orig = fs.readFileSync(path.join(snapDir, st.rel))
        // 内容还是原样 → 本来就没改成（比如它根本没轮到被写），无需动作
        if (fs.readFileSync(abs).equals(orig)) ok = true
        else {
          writeAtomic(abs, orig)
          ok = fs.readFileSync(abs).equals(orig)
        }
      } catch {
        ok = false
      }
      if (!ok) bad.push(st.rel)
    }
    fail(`事务失败：${why}`,
      bad.length === 0
        ? `   已确认 ${order.length} 个文件**都是改之前的原样**（没改成的没动，改成的已退回）`
        : `   ⚠️ 这几个**退不回去**，需要人看一眼；快照在 ${snapDir}（还原：--restore 这个路径）\n   ${bad.join(' / ')}`)
  }

  // ---- 第六步：写 + 逐文件读回比对 ----
  try {
    for (const abs of order) writeAtomic(abs, state.get(abs).after)
  } catch (e) {
    rollback(`写到一半出错：${e.message}`)
  }
  const bad = []
  for (const abs of order) {
    const st = state.get(abs)
    // ⚠️ 逐字节比（2026-09-18 改）：按 utf8 串比会**误判相等** —— 非 UTF-8 文件读回来两边
    //    都带 U+FFFD，字节其实不同却报"读回一致"。这里要问的是"盘上是不是我打算写的那些字节"。
    if (!fs.readFileSync(abs).equals(Buffer.from(st.after, 'utf8'))) bad.push(st.rel)
  }
  if (bad.length > 0) rollback(`读回不一致：${bad.join(' / ')}`)

  console.log(`✓ 事务已落（${ops.length} 处改动 / ${order.length} 个文件）`)
  for (const abs of order) {
    const st = state.get(abs)
    console.log(`   ${st.rel}：${st.countBefore} → ${st.countAfter} 行`)
  }
  console.log(`   快照：${path.relative(ROOT, snapDir)}（要退回来：--restore 这个路径）`)
  process.exit(0)
}

// ============================================================
// 模式 ① / ②：单条改动
// ============================================================
if (!file || set === undefined) {
  die('用法：改档.mjs --file <档案内相对路径> --line <行号> --set <新内容>　或　--file <路径> --append --set <新的一行>　或　--txn <事务文件.json>')
}
if (!append && !Number.isInteger(line)) die('用法：要么给 --line <行号>，要么给 --append（追加到文件末尾）')
if (append && line) die('--line 和 --append 只能用一个（改一行、还是加一行？）')
if (append && /[\r\n]/.test(set)) die('--append 一次只追加**一行**（要写一段，就一行一次调用）')

// ---- 路通不通：路径必须在档案内、文件必须存在 ----
const abs = absOf(file)

// ---- 内容不能是空的（09-16 清空 9 行就是这么来的）----
if (set.length === 0) die('新内容是空的')

const { raw, eol, lines, ends } = splitFile(abs)

// ================= 追加一行 =================
if (append) {
  const linesBefore = lines.length // ⚠️ 空文件是 0 行（原来算成 1，于是"写了却报没动"）
  console.log(`文件 ${file}（追加）`)
  console.log(`  加：${set}`)
  // ⚠️ 2026-09-17 晚补：**单条模式原来既没有干跑、也没有快照** ——
  //    而《工具速查》写着"姿态同改档：默认干跑 · 写前快照"。
  //    实测撞上：拿 `--dry-run` 去试单条模式，**它照样真写了一个文件**
  //    （`--dry-run` 当时只在 `--txn` / `--restore` 那两个分支里被认）。
  //    现在：单条模式也认 `--dry-run`（一个字都不写），且**真的写之前先快照**。
  if (dryRun) {
    console.log('【干跑 · 一个字都没写】确认无误后去掉 --dry-run 再来一次')
    process.exit(0)
  }
  snapshotBefore([abs])
  if (ends.length > 0) ends[ends.length - 1] = ends[ends.length - 1] || eol
  lines.push(set)
  ends.push(eol)
  writeAtomic(abs, render(lines, ends))

  // ---- 回读：最后一行必须正好是它，且行数只多了一行 ----
  const back = splitFile(abs)
  if (back.lines[back.lines.length - 1] !== set) {
    die(`写进去了但读回不一致（异常，停下手问我）\n  期望末行：${set}\n  实际末行：${back.lines[back.lines.length - 1]}`)
  }
  if (back.lines.length !== linesBefore + 1) {
    die(`行数不对（异常，停下手问我）：原来 ${linesBefore} 行，现在 ${back.lines.length} 行`)
  }
  console.log(`✓ 已追加（${linesBefore} → ${back.lines.length} 行），读回一致`)
  process.exit(0)
}

// ================= 替换某一行 =================
// ---- 路通不通：那一行必须存在 ----
if (line < 1 || line > lines.length) die(`路不通：${file} 只有 ${lines.length} 行，没有第 ${line} 行`)

console.log(`文件 ${file}:${line}`)
console.log(`  旧：${lines[line - 1]}`)
console.log(`  新：${set}`)
if (dryRun) {
  // 同上：单条模式也要有干跑（"先干跑"这条规矩不该因模式不同而失效）
  console.log('【干跑 · 一个字都没写】确认无误后去掉 --dry-run 再来一次')
  process.exit(0)
}
snapshotBefore([abs])
lines[line - 1] = set // 只换内容，换行照旧
writeAtomic(abs, render(lines, ends))

// ---- 回读一行，确认真的落上去了 ----
if (splitFile(abs).lines[line - 1] !== set) {
  die(`写进去了但读回不一致（异常，停下手问我）\n  期望：${set}\n  实际：${splitFile(abs).lines[line - 1]}`)
}
console.log('✓ 已写入，读回一致')
