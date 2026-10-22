#!/usr/bin/env node
// ============================================================
// 施工层归档（自动）—— 2026-10-09 建（用户当天原话：
//   「这个地方，能不能做个自动化啊。比如说你在 l4 改后缀，然后剩下的自动化弄到 l8 去。
//     你只改后缀，其他的全自动。」）
// ============================================================
//
// 它做什么（一句话）：**我只在 `L4-施工` 的文件名末尾加一个标记**，
// 剩下的「列引用 → 分拣 → 搬进 L8 → 改全档引用 → 体检」**全部自动**。
//
// 标记（写在文件名末尾、扩展名之前）：
//   · `（已办完）` ⇒ 归档进 `L8-施工归档\`，**存档名去掉这个标记**
//   · `（已作废）` ⇒ 同上
//
// 🔴 三条硬约束（照《施工手册》与既有唯一入口，一条都不绕）：
//   ① 搬 = `tools\move-verify.ps1`（复制 → 逐文件 MD5 → 才动源；源进回收站）—— 不许裸 Move
//   ② 改引用 = `tools\搬运.mjs` 的 `batch-plan` / `batch-go`（它内部走 `引用改写.mjs` → `改档.mjs --txn`）
//   ③ 归档 = 写件**不进 L4**，全在 `%TEMP%`；档案里只留 `L6-工具临时\` 的正常事务快照
//
// 分拣规则（自动，不靠我逐处点）：
//   · **历史层**（`L3-知识\` 详录 · `L8-施工归档\` 旧稿）⇒ 填「留」 —— 那时它确实叫旧名，是史实
//   · **其余现行层**（L1 地图／索引 · L2 数据 · L4 施工）⇒ 填「改」 —— 它们指哪打哪，不能留死指针
//   ※ 这是 2026-10-09 手工做那 7 份时逐处核过、写进档的口径（见 T1058）。
//
// 用法：
//   node tools/施工层归档.mjs             # 提案（只报"哪几份、会改几处"，一个字不写）
//   node tools/施工层归档.mjs --apply     # 真办（搬 ＋ 改引用 ＋ 体检）
// ============================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
// 🔴 取"路径最后一段"用**唯一实现**（第 17 关当场拦下我自己写的那份 split —— 别再造副本）
import { baseOf } from '../lib/idx-scope.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARCHIVE = resolve(process.env.GAI_DANG_ROOT ?? join(process.env.USERPROFILE ?? '', 'Desktop', 'DeepSeek档案'))
const L4 = join(ARCHIVE, 'L4-施工')
const L8 = join(ARCHIVE, 'L8-施工归档')
const TMP = process.env.TEMP ?? process.env.TMP ?? HERE

/** 文件名末尾的"可以归档了"标记 —— 🔴 **唯一来源在 `lib/common.js`**（留意栏也用同一份判据）。 */
import { L4_ARCHIVE_MARKS as MARKS } from '../lib/common.js'
/** 这些层里出现旧名 ＝ 史实 ⇒ 引用改写填「留」。 */
const HISTORY_LAYERS = ['L3-知识', 'L8-施工归档', 'L6-工具临时', 'L5-证据']

const APPLY = process.argv.includes('--apply')

const relTo = (p) => p.slice(ARCHIVE.length + 1)
const die = (m, code = 1) => {
  console.log(`✗ ${m}`)
  process.exit(code)
}
const run = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd: HERE })

// ---------- ① 扫：L4 里哪些文件被标了"可以归档" ----------
function scanMarked() {
  if (!existsSync(L4)) die(`找不到 L4-施工：${L4}`)
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!e.name.endsWith('.md')) continue
      const mark = MARKS.find((m) => e.name.includes(m))
      if (!mark) continue
      const cleanName = e.name.replace(mark, '') // 存档名去掉标记
      const rel = p.slice(L4.length + 1) // 例：统一度量衡\工程-x.md
      const dirPart = dirname(rel) === '.' ? '' : dirname(rel) + sep
      out.push({
        mark,
        from: join(L4, rel),
        to: join(L8, dirPart + cleanName),
        fromRel: `L4-施工\\${rel}`,
        toRel: `L8-施工归档\\${dirPart}${cleanName}`,
      })
    }
  }
  walk(L4)
  return out
}

// ---------- ② 生成"改名表"（旧<TAB>新，档案内相对路径）----------
function writeFromList(items) {
  const f = join(TMP, `施工归档-改名表-${Date.now()}.tsv`)
  // 三列：旧路径 <TAB> 新路径 <TAB> **旧值所在位置**（第 3 列给 `引用改写.mjs` 判"要不要连层前缀一起换"）
  const rows = items.map((x) => {
    const dir = x.fromRel.replace(/[\\/][^\\/]*$/, '')
    return `${x.fromRel}\t${x.toRel}\t${dir === x.fromRel ? '.' : dir}`
  })
  writeFileSync(f, rows.join('\n') + '\n', 'utf8')
  return f
}

// ---------- ③ 自动分拣：一律「改」，第 4 列按这一行**有没有层前缀**决定填什么 ----------
// 🔴 2026-10-09 改（沙箱 4 端到端抓出来的）：原来把历史层（L3／L8）填「留」—— 可**搬走之后
//   那处旧路径就成了死指针**（体检当场报）。而 10-09 手工做那 7 份的真实口径是：
//   **历史层也改成"只写文件名"**（去掉层前缀 —— 事实不变、指针不死，还正合《工程-事件写法》
//   §六 那条"引用优先只写文件名"）。所以现在**不分层**：统一「改」。
function autoSort(listFile, byOldName) {
  const lines = readFileSync(listFile, 'utf8').split(/\r?\n/)
  const stat = { 改: 0, 留: 0 }
  const out = lines.map((l) => {
    if (l.startsWith('#') || !l.trim()) return l
    const c = l.split('\t')
    if (c.length < 4) return l
    const act = '改'
    const newName = String(c[3]).trim() // 预填的是新文件名（`batch-plan` 给）
    const line = String(c[5] ?? '') // 原行（只读参考列）
    const full = byOldName.get(newName) // 新位置（档案内相对路径，例 `L8-施工归档\x.md`）
    if (full) {
      const inLine = new RegExp(`[\\\\/]${newName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(line)
      c[3] = inLine ? full : newName
    }
    c[2] = act
    stat[act] += 1
    return c.join('\t')
  })
  writeFileSync(listFile, out.join('\n'), 'utf8')
  return stat
}

// ---------- 主流程 ----------
// `--mark <档案内相对路径>`：**只改后缀**这一步也交给它（走 `move-verify.ps1` 改名，源进回收站）
//   —— 这样用户真正只需说一句"这份办完了"，标记与归档都是机器的事。
const markIdx = process.argv.indexOf('--mark')
if (markIdx >= 0) {
  const rel = process.argv[markIdx + 1]
  if (!rel) die('--mark 后面要给档案内相对路径，例：--mark "L4-施工\\工程-x-讨论稿.md"')
  const src = join(ARCHIVE, rel)
  if (!existsSync(src)) die(`找不到这份文件：${rel}`)
  if (MARKS.some((m) => src.includes(m))) die(`它已经带标记了：${rel}`)
  const marked = src.replace(/\.md$/, `${MARKS[0]}.md`)   // 加标记（去扩展名那一步走 stripExt，见上）
  if (existsSync(marked)) die(`目标已存在：${relTo(marked)}`)
  const lst = join(TMP, `施工归档-改名-${Date.now()}.txt`)
  writeFileSync(lst, `${src}|${marked}|move\n`, 'utf8')
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'move-verify.ps1'), '-ListFile', lst],
    { encoding: 'utf8' },
  )
  process.stdout.write(r.stdout ?? '')
  if (r.status !== 0) {
    process.stderr.write(r.stderr ?? '')
    die('改名没成（见上面的输出）', r.status ?? 1)
  }
  console.log(`✅ 已标记：${relTo(marked)}`)
  console.log('   接着跑一次归档（不加 --mark）：node tools/施工层归档.mjs --apply\n')
  process.exit(0)
}

const items = scanMarked()
if (items.length === 0) {
  console.log('施工层归档：L4-施工 里没有带标记的文件（（已办完）／（已作废））—— 无事可做。')
  process.exit(0)
}

console.log(`施工层归档：L4-施工 里发现 **${items.length}** 份标了"可以归档"的：`)
for (const x of items) console.log(`  · ${x.mark} ${relTo(x.from)}  ⇒  ${x.toRel}`)

// 目标冲突先拦（move-verify 也会拦，这里提前说清）
for (const x of items) {
  if (existsSync(x.to)) die(`目标已存在，先处理它：${x.toRel}`)
  if (!existsSync(x.from)) die(`源不在：${x.fromRel}`)
}

// 干跑引用清单（batch-plan 只读、不改档）
const fromList = writeFromList(items)
const planOut = run([join(HERE, '搬运.mjs'), 'batch-plan', '--from-list', fromList])
// ⚠️ `batch-plan` 正常跑完的退出码是 **2** —— 它的语义是"列完引用、停下等人分拣"（不是错）。
//   2026-10-09 样本试跑当场踩到：把 2 当失败 ⇒ 明明清单已经出了，脚本却报"没跑成"。
if (planOut.status !== 0 && planOut.status !== 2) {
  process.stdout.write(planOut.stdout ?? '')
  process.stderr.write(planOut.stderr ?? '')
  die('batch-plan 没跑成（引用清单没出）', planOut.status ?? 1)
}
const m = String(planOut.stdout).match(/清单已写：(.+?\.tsv)/)
if (!m) die('没能从 batch-plan 的输出里认出清单路径')
const listFile = m[1].trim()

const stat = autoSort(
  listFile,
  // 键 = `batch-plan` 预填的那个名字 —— 它是**去掉标记后**的新文件名
  //   （2026-10-09 沙箱 2 当场踩到：拿"带标记的旧名"当键 ⇒ 一个都命中不了、第 4 列原样留着旧值）
  new Map(items.map((x) => [baseOf(x.from).replace(x.mark, ''), x.toRel])),
)
console.log(`引用清单：${relTo(listFile)} —— 自动分拣：**改 ${stat.改} 处 · 留 ${stat.留} 处**`)
console.log('  （历史层 L3／L8 填「留」＝那时它确实叫旧名；现行层填「改」＝不能留死指针）')

if (!APPLY) {
  console.log('\n【提案】一个字都没写。要真办：')
  console.log(`  node tools/施工层归档.mjs --apply\n`)
  process.exit(0)
}

// 真办：batch-go（内部 = 引用改写 --plan --apply → move-verify.ps1 → 体检）
console.log('\n真落：搬 ＋ 改引用 ＋ 体检…')
const goOut = run([join(HERE, '搬运.mjs'), 'batch-go', '--apply', '--plan', listFile, '--from-list', fromList])
process.stdout.write(goOut.stdout ?? '')
process.stderr.write(goOut.stderr ?? '')
if (goOut.status !== 0) die('batch-go 失败（档案状态见上面的输出与快照）', goOut.status ?? 1)

// 收尾：L4 里那几份应当已不在
const left = items.filter((x) => existsSync(x.from))
console.log(`\n${left.length === 0 ? '✅ 全部归档完成' : `⚠️ 还剩 ${left.length} 份没搬走`}（L4-施工 里应已无标记件）`)
process.exit(left.length === 0 ? 0 : 1)
