#!/usr/bin/env node
// ============================================================
// 搬运（编排器）—— 2026-09-23 建（用户：「那就做一套搬运流程」）
// ============================================================
//
// 它是什么：把"档案内的一份文档 搬层 / 改名 / 转化"这件事，**按写死的顺序**走完五步。
//
// 🔴 它自己**不新增任何写能力** —— 三件写动作全部交给已有的唯一入口：
//     · 扫引用 / 生成事务 → `tools/引用改写.mjs`（它自己也不写，只生成事务）
//     · 真落引用          → 由 `引用改写.mjs --plan --apply` 内部调 `改档.mjs --txn`
//     · 搬 ＋ 改名        → `tools/move-verify.ps1`（复制 → 逐文件 MD5 校验 → 才删源）
//
// 为什么要有它（用户 2026-09-23 原话）：
//   「那就做一套**搬运流程**，1 是**避免你跳过某些程序**，2 是希望这个能**更加自动化**，
//     **让你的注意力不要都放在这个上面**。」
//   —— 五步里跳掉 ① 会留死引用，跳掉 ⑤ 会不知道自己没搬干净。
//
// 两相（中间那一相只有人能填 —— 判断不自动化）：
//   plan：列引用 → 写一份"待分拣"的清单到 L9 → **停**，退出码 2
//   go  ：校验清单填完了 → 落引用 → 搬 ＋ 改名 → 体检
//
// 用法：
//   node tools/搬运.mjs plan --from <档案内相对路径> --to <档案内相对路径>
//   node tools/搬运.mjs go   --plan <清单.tsv> [--apply]
//     · go 默认**干跑**（只算不写）；`--apply` 才真落
//     · `--from/--to` 都是**档案根之下的相对路径**（越界当场拒）
// ============================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = HERE // 本文件就在 tools/ 里
const ARCHIVE = resolve(process.env.GAI_DANG_ROOT ?? join(process.env.USERPROFILE ?? '', 'Desktop', 'DeepSeek档案'))

// ---------- 小工具 ----------

const die = (msg, code = 1) => {
  console.error(`✗ ${msg}`)
  process.exit(code)
}

const parseArgs = (argv) => {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // 🔴 **2026-10-08 修**：**末尾的裸开关**以前会解析成 `undefined` —— `argv[i+1]?.startsWith('--')`
    //    在 `i+1` 越界时是 `undefined`（falsy）⇒ 走 `argv[++i]` ⇒ 取到 undefined。
    //    实测后果：`batch-go --plan X --from-list Y --apply`（`--apply` 在最后）**静默按干跑跑** ——
    //    单份版没露馅，只因它的用法里 `--apply` 后面总跟着 `--from`。
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      out[a.slice(2)] = next === undefined || next.startsWith('--') ? true : argv[++i]
    }
  }
  return out
}

/** 档案根之下的相对路径 → 绝对路径；越界/不存在/被占 一律当场拒。 */
function resolveInside(rel, { mustExist, what }) {
  if (!rel || typeof rel !== 'string') die(`${what} 没给`)
  const abs = resolve(ARCHIVE, rel)
  const r = relative(ARCHIVE, abs)
  if (!r || r.startsWith('..') || r.includes(`..${sep}`)) die(`${what} 越出档案根：${rel}`)
  if (mustExist && !existsSync(abs)) die(`${what} 不存在：${rel}`)
  return abs
}

/** 跑一个子进程，输出**重定向到文件**再读（施工手册坑 11：管道 stdio 在本机沙箱会 EPERM）。 */
function runToFile(cmd, args, logFile) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  try {
    writeFileSync(logFile, text, 'utf8')
  } catch {
    /* 写不下不影响结果判断 */
  }
  return { code: r.status ?? -1, text }
}

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

// ---------- ①′ 批量：一次搬一批（2026-10-08 加） ----------
//
// 为什么加：`plan` 一次只搬一份 ⇒ 17 份详录改名要跑 34 趟。用户 2026-10-08 拍板"**文件名去号段**"
//   之后，这种"同一批、同一个动作"的活必须能一次做完（他一直在说的：别把注意力耗在来回折腾上）。
// 🔴 它仍然**一个字都不写**：只生成清单（真落走 引用改写 --plan --apply → 改档.mjs --txn；
//    搬＋改名走 move-verify.ps1）。
// 📌 与单份版的唯一区别：`--map` 一次列出**整批**的引用（不是一份一份找）。

/** 读改名表（两列 TSV：旧相对路径 <TAB> 新相对路径）。 */
function readFromList(file) {
  if (!file || file === true) die('--from-list <改名表.tsv> 没给')
  const abs = resolve(file)
  if (!existsSync(abs)) die(`改名表不存在：${file}`)
  const pairs = []
  const bad = []
  for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const c = line.split('\t')
    if (c.length < 2 || !c[0].trim() || !c[1].trim()) {
      bad.push(line)
      continue
    }
    pairs.push({ from: c[0].trim(), to: c[1].trim() })
  }
  if (bad.length > 0) die(`改名表有 ${bad.length} 行读不出「旧 <TAB> 新」：\n  ${bad.slice(0, 8).join('\n  ')}`)
  if (pairs.length === 0) die('改名表里一条有效行都没有')
  return pairs
}

/** ①′ 批量列引用：整批一次列全 ⇒ 停下等人分拣（与单份版同一个姿势）。 */
function doBatchPlan(a) {
  const pairs = readFromList(a['from-list'])
  for (const p of pairs) {
    resolveInside(p.from, { mustExist: true, what: `改名表的旧路径（${p.from}）` })
    const to = resolveInside(p.to, { mustExist: false, what: `改名表的新路径（${p.to}）` })
    if (existsSync(to)) die(`目标已存在（本工具不覆盖）：${p.to}`)
  }
  const l9 = join(ARCHIVE, 'L6-工具临时')
  mkdirSync(l9, { recursive: true })
  // 引用**只写文件名**（2026-09-28 起）⇒ 映射也用文件名
  // 🔴 **2026-10-09 加第 3 列＝"旧值所在位置"**：引用也可能写成**带层前缀的全名**
  //    （`` `L4-施工\x.md` ``）—— 只给文件名的话，`引用改写.mjs` 换完会留下旧前缀 ⇒ **死指针**
  //    （沙箱真跑抓到的）。给了这一列，它才判得出"这处该连前缀一起换"，而**纯文件名那处照旧只换名字**。
  const mapFile = join(l9, `搬运-批量映射-${stamp()}.tsv`)
  writeFileSync(mapFile, pairs.map((p) => `${p.from.split(sep).pop()}\t${p.to.split(sep).pop()}\t${dirname(p.from)}`).join('\n') + '\n', 'utf8')
  const listFile = join(l9, `搬运-批量清单-${stamp()}.tsv`)
  console.log(`① 列引用：**${pairs.length} 份一起列**（按文件名 —— 引用只写文件名）…`)
  const r = runToFile(process.execPath, [join(TOOLS, '引用改写.mjs'), '--map', mapFile, '--out', listFile], join(l9, '搬运-引用改写.log'))
  console.log(r.text.trim().split('\n').slice(-6).join('\n'))
  if (r.code !== 0) die(`引用改写.mjs 退出码 ${r.code}（清单没生成，一个字都没写）`, r.code)

  console.log('')
  console.log('=========== ② 该你了：分拣 ============')
  console.log('打开这份清单，逐处把「动作」列填成 改 / 删 / 留（不许留 ? 或空）：')
  console.log(`  ${listFile}`)
  console.log('（历史叙述里提到旧名字的地方 ⇒ 填「留」）')
  console.log('填完跑：')
  console.log(`  node "${join(TOOLS, '搬运.mjs')}" batch-go --plan "${listFile}" --from-list "${a['from-list']}"`)
  process.exit(2) // 2 = "停下等人分拣"，不是错
}

// ---------- ① plan：列引用 ----------

function doPlan(a) {
  const fromAbs = resolveInside(a.from, { mustExist: true, what: '--from' })
  const toAbs = resolveInside(a.to, { mustExist: false, what: '--to' })
  if (existsSync(toAbs)) die(`--to 已经存在（本工具不覆盖）：${a.to}`)
  // 🔴 **2026-09-28 改：`--find` 从"整条相对路径"改成"文件名"**。
  //    起因：全档引用从今天起**只写文件名**（工程「引用与索引」）⇒ 再按整条路径找，**命中恒为 0**
  //    （实测：`plan` 报"命中 0 处"）—— 那不是"没人引用它"，而是**找法过时了**；
  //    照它改名就会**静默断掉所有引用**（正是这套流程当初要防的事）。
  //    ⇒ 现在按**文件名**列引用（`--literal` 裸包含，不做词边界）：它会连"只是提到这个名字"的
  //      地方一起列出来 —— **那正是 ② 分拣要人判的原因**（该改的改、该留的留）。
  //    ⚠️ 分拣时："改"那一行的第 4 列填**新文件名**（不含层路径）。
  const fromName = fromAbs.split(sep).pop() // 文件名（含扩展名）

  const l9 = join(ARCHIVE, 'L6-工具临时')
  try {
    mkdirSync(l9, { recursive: true })
  } catch {
    /* 已存在 */
  }
  const stem = fromName.replace(/\.[^.]+$/, '')
  const listFile = join(l9, `搬运-${stamp()}-${stem}.tsv`)

  console.log(`① 列引用：在档案里找「${fromName}」（**按文件名** —— 2026-09-28 起引用只写文件名）…`)
  const r = runToFile(
    process.execPath,
    [join(TOOLS, '引用改写.mjs'), '--find', fromName, '--literal', '--out', listFile],
    join(l9, '搬运-引用改写.log'),
  )
  console.log(r.text.trim().split('\n').slice(-6).join('\n'))
  if (r.code !== 0) die(`引用改写.mjs 退出码 ${r.code}（清单没生成，一个字都没写）`, r.code)

  console.log('')
  console.log('=========== ② 该你了：分拣 ===========')
  console.log('上面找的是**文件名**（不是整条路径）—— 所以「改」那一行的第 4 列填**新文件名**；')
  console.log('填整行会把整行塞进那个位置（试跑实测过这个坑）。')
  console.log(`打开这份清单，逐处把「动作」列填成 改 / 删 / 留（不许留 ? 或空）：`)
  console.log(`  ${listFile}`)
  console.log('填完跑：')
  console.log(`  node "${join(TOOLS, '搬运.mjs')}" go --plan "${listFile}"           # 干跑`)
  console.log(`  node "${join(TOOLS, '搬运.mjs')}" go --plan "${listFile}" --apply  # 真落`)
  process.exit(2) // 2 = "停下等人分拣"，不是错
}

/**
 * ⑤ 体检（单份与批量共用）—— **直接调内核**，不再 spawn 一个 node：
 *   试跑实测两个坑：① Windows 上 `import()` 绝对路径必须是 `file://`（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）
 *   ② 子进程崩了、我没查退出码 ⇒ **静默通过**。另外 `checkArchive()` 回的是**对象数组**（直接 join 会打出 `[object Object]`）。
 */
async function runCheck() {
  console.log('⑤ 体检…')
  try {
    const { CFG } = await import('../lib/common.js')
    CFG.archiveDir = ARCHIVE
    const { checkArchive } = await import('../lib/f5-check.js')
    const errs = checkArchive()
    if (errs.length) {
      console.log(`⚠️ 体检有 **${errs.length}** 条：`)
      console.log(
        errs
          .slice(0, 10)
          .map((e) => (typeof e === 'string' ? e : (e?.text ?? e?.msg ?? JSON.stringify(e))))
          .join('\n'),
      )
    } else {
      console.log('✅ 体检 0 错')
    }
  } catch (e) {
    console.log(`⚠️ 体检**没跑成**（${e?.message ?? e}）—— **别当成"0 错"**`)
  }
}

/** ③④⑤′ 批量：落引用 → **一次搬完 ＋ 改名** → 体检。 */
async function doBatchGo(a) {
  const planFile = a.plan
  if (!planFile || planFile === true) die('--plan <清单.tsv> 没给')
  const planAbs = resolve(planFile)
  if (!existsSync(planAbs)) die(`清单不存在：${planFile}`)
  const pairs = readFromList(a['from-list'])
  const apply = a.apply === true || a.apply === 'true'
  console.log(apply ? '模式：**真落**' : '模式：干跑（只算不写）')

  // ④ 落引用
  console.log('④ 落引用…')
  const args = [join(TOOLS, '引用改写.mjs'), '--plan', planAbs]
  if (apply) args.push('--apply')
  const l9 = join(ARCHIVE, 'L6-工具临时')
  const r = runToFile(process.execPath, args, join(l9, '搬运-落引用.log'))
  console.log(r.text.trim().split('\n').slice(-8).join('\n'))
  if (r.code !== 0) die(`引用改写.mjs 退出码 ${r.code}（清单没填完？—— 一个字都没写）`, r.code)

  if (!apply) {
    console.log('')
    console.log('干跑通过。加 --apply 才真落（真落会把 ③ 一次搬 ＋ 改名 接着做完）。')
    process.exit(0)
  }

  // ③ 一次搬完 ＋ 改名（move-verify.ps1 的清单是 3 列：`src|dst|mode`；多一列会让 mode 变空）
  const lines = []
  for (const p of pairs) {
    const fromAbs = resolveInside(p.from, { mustExist: true, what: `旧路径（${p.from}）` })
    const toAbs = resolveInside(p.to, { mustExist: false, what: `新路径（${p.to}）` })
    lines.push(`${fromAbs}|${toAbs}|move`)
  }
  const moveList = join(l9, `搬运-批量搬迁-${stamp()}.txt`)
  writeFileSync(moveList, lines.join('\n') + '\n', 'utf8')
  console.log(`③ 一次搬 ＋ 改名（**${pairs.length} 份** · 复制 → 逐文件 MD5 校验 → 才删源）…`)
  const mv = runToFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'move-verify.ps1'), '-ListFile', moveList, '-UserApprovedBannedDriveWrite'],
    join(l9, '搬运-move-verify.log'),
  )
  console.log(mv.text.trim().split('\n').slice(-10).join('\n'))
  if (mv.code !== 0) die(`move-verify.ps1 退出码 ${mv.code} —— **源没动**（复制没校验过就不会删源）`, mv.code)

  await runCheck()
  console.log('')
  console.log('✅ 五步走完（批量）。剩下两件手动的：索引那一行 · 地图重生成')
}

// ---------- ③④⑤ go：落引用 → 搬 → 体检 ----------

async function doGo(a) {
  const planFile = a.plan
  if (!planFile || planFile === true) die('--plan <清单.tsv> 没给')
  const planAbs = resolve(planFile)
  if (!existsSync(planAbs)) die(`清单不存在：${planFile}`)

  const apply = a.apply === true || a.apply === 'true'
  console.log(apply ? '模式：**真落**' : '模式：干跑（只算不写）')

  // ④ 落引用（引用改写.mjs 自己会拒"没填完"的清单）
  console.log('④ 落引用…')
  const args = [join(TOOLS, '引用改写.mjs'), '--plan', planAbs]
  if (apply) args.push('--apply')
  const lg = join(ARCHIVE, 'L6-工具临时', '搬运-落引用.log')
  const r = runToFile(process.execPath, args, lg)
  console.log(r.text.trim().split('\n').slice(-8).join('\n'))
  if (r.code !== 0) die(`引用改写.mjs 退出码 ${r.code}（清单没填完？—— 一个字都没写）`, r.code)

  if (!apply) {
    console.log('')
    console.log('干跑通过。加 --apply 才真落。')
    console.log('⚠️ 真落请在**同一条命令**里给 --from/--to，本工具会把 ③ 搬 ＋ 改名 接着做完：')
    console.log('   node tools/搬运.mjs go --plan <清单> --apply --from <旧> --to <新>')
    process.exit(0)
  }

  // ③ 搬 ＋ 改名（写一行清单 → move-verify.ps1）
  const fromRel = a.from
  const toRel = a.to
  if (!fromRel || !toRel) die('--apply 必须同时给 --from 与 --to（否则引用落了、文件没搬）')
  const fromAbs = resolveInside(fromRel, { mustExist: true, what: '--from' })
  const toAbs = resolveInside(toRel, { mustExist: false, what: '--to' })

  const l9 = join(ARCHIVE, 'L6-工具临时')
  const moveList = join(l9, `搬运-清单-${stamp()}.txt`)
  // move-verify.ps1 的清单是 **3 列**：`src|dst|mode`（试跑实测：多一个字段会让第 3 列变空 → "unknown mode ''"）
  writeFileSync(moveList, `${fromAbs}|${toAbs}|move\n`, 'utf8')

  console.log('③ 搬 ＋ 改名（复制 → 逐文件 MD5 校验 → 才删源）…')
  const mv = runToFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'move-verify.ps1'), '-ListFile', moveList, '-UserApprovedBannedDriveWrite'],
    join(l9, '搬运-move-verify.log'),
  )
  console.log(mv.text.trim().split('\n').slice(-8).join('\n'))
  if (mv.code !== 0) die(`move-verify.ps1 退出码 ${mv.code} —— 源没动（复制没校验过就不会删源）`, mv.code)

  // ⑤ 体检
  await runCheck()

  console.log('')
  console.log('✅ 五步走完。剩下两件手动的：')
  console.log('  · 索引那一行要改成新路径（`L1-必读/索引.md`）')
  console.log('  · 地图重生成（`dangan_check scope="map" mode="apply"`）')
}

// ---------- 入口 ----------

const [phase, ...rest] = process.argv.slice(2)
const a = parseArgs(rest)
if (phase === 'plan') doPlan(a)
else if (phase === 'go') await doGo(a)
else if (phase === 'batch-plan') doBatchPlan(a)
else if (phase === 'batch-go') await doBatchGo(a)
else {
  console.log('搬运（编排器）—— 走死那五步：列引用 → 你分拣 → 搬+改名 → 落引用 → 体检')
  console.log('')
  console.log('  node tools/搬运.mjs plan --from <档案内旧路径> --to <档案内新路径>')
  console.log('  node tools/搬运.mjs go   --plan <清单.tsv> [--apply --from <旧> --to <新>]')
  console.log('')
  console.log('批量（2026-10-08 加 · 一次搬一批）：')
  console.log('  node tools/搬运.mjs batch-plan --from-list <改名表.tsv>        # 旧<TAB>新，一次列全 ⇒ 停')
  console.log('  node tools/搬运.mjs batch-go --plan <清单.tsv> --from-list <改名表.tsv> [--apply]')
  process.exit(0)
}
