#!/usr/bin/env node
/**
 * 引用去路径.mjs —— **把"带层路径的引用"统一改成"只写文件名"**（2026-09-26 加）
 *
 * 用户当天拍板〔会话 2026-09-26 · 原文在 `L4-施工\引用与索引-讨论稿.md`〕：
 *   「**甚至索引都可以自动化，前面那句话你自己写，后面的地址直接自动化，搜索档案馆里这个文件的名字，
 *     自动生成路径。这不就永久解决了指针因为时间原因空掉的问题。我觉得这个甚至可以用在全档案所有指的地方。**」
 * ⇒ **写法**：只写文件名；**重名才加层**；路径由《地图》现算。
 * ⇒ **为什么必须先做这一步**：全馆要**原地改成六层**（层名改 / 搬文件 / 改文件名），
 *    引用里那些 `L3-知识\xxx.md` **会一条不剩地全断**；先统成光文件名，之后搬层改名引用一个字都不用动。
 *
 * 它治的病（讨论稿里的原话）：把 `批量改造文档-讨论稿.md` 挪了个位置，**61 处引用当场变成死指针**，
 *   落档连吃三次回滚 —— 而那 61 处写的全是**同一个路径字符串**。
 *
 * 🔴 **它不是写入口**（这条和 `引用改写.mjs` 一样不能破）：
 *   它自己**一个字都不写** —— 只生成事务（`~/.dsh/memoria/txn-out/`），真落永远走
 *   `改档.mjs --txn`（全量预检 → 快照 → 逐文件读回对账 → 任一不过就全部还原）。
 *
 * 用法（**默认干跑**，只打印"将改 / 拒"，打印完把事务交给 `改档.mjs --dry-run` 再验一遍）：
 *   node tools/引用去路径.mjs                        # 干跑 + 汇总
 *   node tools/引用去路径.mjs --list-refused 拒.tsv  # 另把"拒"的逐行落成 TSV（要细看就走它）
 *   node tools/引用去路径.mjs --apply                # 真落（走 改档.mjs --txn）
 *   node tools/引用去路径.mjs --include-history      # 连"历史叙述"一起改（默认不改，见下）
 *
 * 🔴 **三条不许碰（都实现成"拒"，逐行列出来，不静默跳过）**：
 *   ① **历史叙述不动** —— 事件表 / 时间轴里"**当时**这件事指引去哪"的路径是**记录**、不是指针
 *      （《引用与索引-讨论稿》§三：「❌ 不动事件表的历史条目……改它＝改写历史」）。
 *      判据（机械可判，见 `looksHistorical()`）：**表格行 + 第一格是等级符号**（`| ❗ | **T123** | …`）。
 *      ⚠️ **边界**：事件表正文里那条 `> **指引**：L3-知识\xxx.md` **不是**历史条目的行 ⇒ 照改
 *      （它是**活指针**，正是搬层会弄断的那一类）。要连历史一起改就显式加 `--include-history`。
 *   ② **只认"档案里真实存在的文件名"** —— 名字集合**只收"进了地图的那几层"**（＝ `SCAN_DIRS`）：
 *      `L5-证据` / `L6-工具临时` **一份都不收** —— 那两层几乎全是**副本**，
 *      收进来会造**假重名**（唯一的一份被判"重名"⇒ 该去路径的引用被白白拒掉）。
 *      🔴 **判据与理由只在 `buildNameIndex()` 那一处写全，这里不重述**（重述必漂 —— 本行在 2026-09-26
 *      之前还写着"**先扫全档**收一份文件名集合"，而这个工具自己就栽在它上面一回：那正是它的漂移现场）。
 *      集合里没有的名字（举例 / 已删的东西 / 盘上的 `E:\…` / **证据·临时层的副本**）**一处都不动**。
 *   ③ **重名的一律拒** —— 光文件名指不到唯一一份（`_说明-读我.txt` 各层各一份；L3 原件 vs L8 减重版各一对）。
 *      等层重建把重复消掉之后再单独处理；**这里不许自己拍**。
 *
 * 另一类也进"拒"（**不是错，是边界**，如实报数）：
 *   · `空层名`：`L3-知识\` 后面**直接没了**（半句话 / 指向目录本身），替换会留下一个孤零零的反斜杠。
 * ⚠️ 原来单列的 `指向被跳过的层`（目标在证据 / 临时层）**已并进上面 ② 那条拒因**
 *   （2026-09-26 改口径后，那类引用必然"不在名字集合里"，同一件事不再两套说法）。
 *
 * 边界：
 *   · 扫哪几层＝**现算**（档案根下 `L?-*`，跳过名字含"证据 / 临时"的）—— 和 `引用改写.mjs`、`dangan_search` 同一口径；
 *   · 认哪几种写法：`L3-知识\x.md` · `L3-知识/x.md` · `L3-知识\x.md`（带引号也行）· `L1-必读\x.md:12`（行号留着）；
 *     ✅ **多一层 / 多层子目录也算**（`L3-知识\参考\x.md`）—— 2026-09-28 加。**判据与教训只在
 *     `lib/refs-to-name.js` 那一个文件里写全**（这里不重述 —— 重述必漂）：认得出什么、为什么这么加，
 *     连同"层名段不许含点""别把字符类放宽"两段踩坑记录，都在那一份里。
 *   · `.md` / `.txt` 引用**必须是带层的**（光文件名本来就合规）；
 *     可执行件（`.ps1` / `.mjs` / `.cmd`）**一样只认带层的** —— 试跑第一版认过**裸文件名**，
 *     把插件包里的入口（`…\dsh-memoria\tools\改档.mjs`）咬进来 100+ 处**假命中**，**已收窄**；
 *   · 每处都带 `expect`（原行现读）⇒ 别人先动过，`改档.mjs` 当场停手、一个字不写；
 *   · **幂等**：跑第二遍必须是 0 处改动（改完就是光文件名，匹配器再也咬不上它）。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CFG, HOME_DIR, SKIPPED_LAYER_RE, scanLayerDirs } from '../lib/common.js'
import { findRefs, looksHistorical } from '../lib/refs-to-name.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARCHIVE = CFG.archiveDir
const GAI_DANG = join(HERE, '改档.mjs')

/**
 * 扫哪几层 —— 🔴 **走唯一来源**（`lib/common.js` 的 `scanLayerDirs`，2026-10-11 收拢）。
 * 原来这里自抄了一份 `readdirSync + /^L\d+-/ + !/证据|临时/`；口径扫把它标成"第二份"，
 * 现在只剩一行：加一层 / 改跳过词都只动 `common.js`。
 */
const SCAN_DIRS = scanLayerDirs(ARCHIVE)

/** "证据 / 临时"层：不扫、也不许当改写的目标（读者查地图找不到它们）。 */
const SKIPPED_RE = SKIPPED_LAYER_RE // 2026-09-28：走唯一来源（`lib/common.js`），不再自抄一份正则

const HELP = `引用去路径 —— 把"带层路径的引用"统一改成"只写文件名"（**自己一个字都不写**，只生成事务）

  node tools/引用去路径.mjs [选项]

  --apply             真落（走 改档.mjs --txn）；默认**干跑**
  --include-history   连"历史叙述"（事件表 / 时间轴里的等级行）一起改；默认**不改**
  --list-refused <f>  把"拒"的逐行落成 TSV（文件/行号/原因/文件名/那一行）
  --json <f>          把汇总写成 JSON（给机器读）
  --archive <dir>     换档案根（默认取插件配置那份）
  --help              这份说明

🔴 三条不许碰：历史叙述 / 认不出的名字 / 重名 —— 一律进"拒"名单，逐行列出来。
`

function die(msg) {
  console.error(`❌ 引用去路径：${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list-refused' || a === '--json' || a === '--archive') out[a.slice(2)] = argv[++i] ?? ''
    else if (a === '--apply') out.apply = true
    else if (a === '--include-history') out.includeHistory = true
    else if (a === '--help' || a === '-h') out.help = true
    else out._.push(a)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  process.stdout.write(HELP)
  process.exit(0)
}
const ROOT = args.archive ? String(args.archive) : ARCHIVE

/** 收文件（带扩展名过滤）。`skipSnapshots` 时跳过改档快照（那是副本，不是"存在的那一份"）。 */
function walkFiles(dir, { exts = null, skipSnapshots = true, out = [] } = {}) {
  let ents = []
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (skipSnapshots && (e.name === '改档快照' || e.name === '.git' || e.name === 'node_modules')) continue
      walkFiles(p, { exts, skipSnapshots, out })
    } else if (!exts || exts.test(e.name)) out.push(p)
  }
  return out
}

/**
 * ① 文件名集合（"只认档案里真实存在的文件名"就靠它）＋ 重名表。
 *
 * 🔴 **只收"进了地图的那几层"**（＝ `SCAN_DIRS`；2026-09-26 用户判的）：
 *   `L5-证据` / `L6-工具临时` **一份都不进这个集合**。理由两条：
 *   · 那两层里几乎全是**副本**（`改档快照\` 1,884 份 · `档案结构地图快照\` 237 份 · 各期备份…）
 *     —— 混进来会造出**假重名**：实测 `01-事件表` / `01-时间轴` 在档案里**各只有一份**，
 *     只因快照里有副本就被判成"重名"，**白白拒掉 13 + 9 处**（另 `待办-未完成事项.md` 同理）；
 *   · 那两层**不在《地图》的层表里** —— 就算把引用改成光文件名，读者查地图也找不到它
 *     ⇒ 本来就不该去路径（引用它们的走"**指向被跳过的层**"那条拒）。
 * ⇒ 一句话：**名字集合 ＝ 规范要管的那个命名空间**，不等于"盘上出现过的所有名字"。
 */
function buildNameIndex() {
  const seen = new Map() // 文件名 → Set(相对路径)
  let files = 0
  for (const d of SCAN_DIRS) {
    for (const abs of walkFiles(join(ROOT, d))) {
      const name = abs.slice(abs.lastIndexOf('\\') + 1)
      const rel = relative(ROOT, abs)
      if (!seen.has(name)) seen.set(name, new Set())
      seen.get(name).add(rel)
      files++
    }
  }
  const names = new Set(seen.keys())
  const dups = new Map()
  for (const [n, rels] of seen) if (rels.size > 1) dups.set(n, [...rels].sort())
  return { names, dups, total: seen.size, files }
}

const EXT_TEXT = /\.(md|txt)$/i
const EXT_EXEC = /\.(ps1|mjs|cmd|bat|csv|json|png|jpg|jpeg|webp|gif|html?)$/i

// `findRefs()`（认哪几种写法 · **层数不限**）与 `looksHistorical()`（历史叙述判据）—— 都在
// `../lib/refs-to-name.js`（**全档唯一一份**；判据与那两段踩坑记录也写在它的头部）。

/** ② 逐档扫，把每一处命中原样收起来（带分类）。 */
function scan(index) {
  const rows = []
  let scannedFiles = 0
  let scannedLines = 0
  for (const d of SCAN_DIRS) {
    for (const abs of walkFiles(join(ROOT, d), { exts: EXT_TEXT })) {
      let raw = ''
      try {
        raw = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      scannedFiles++
      const rel = relative(ROOT, abs)
      const lines = raw.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        scannedLines++
        const line = lines[i]
        if (!line || !/[\\/]|\.(?:ps1|mjs|cmd|bat)\b/i.test(line)) continue
        const hits = findRefs(line)
        if (hits.length === 0) continue
        const historical = looksHistorical(line)
        for (const h of hits) {
          const layer = (h.text.match(/^(L\d+-[^\\/]+)/) || [])[1] || ''
          // ⚠️ **拒因的判序**（2026-09-26 用户改口径后调整）：名字集合现在**只收进了地图的那几层**
          //    ⇒ 引用"证据 / 临时"层的东西**必然不在集合里**，若先判"在不在集合"就会被标成
          //    语义不对的"认不出"。所以**先判层**：跳过层 / 快照副本 → 说清是"层不在名字集合里"。
          const outOfScope = layer && SKIPPED_RE.test(layer)
          const where = index.dups.get(h.name)
            ? '重名'
            : outOfScope || !index.names.has(h.name)
              ? '不在名字集合里（证据 / 临时层的副本、或档案里没这名字）'
              : null
          let skip = null
          if (!layer && /\.[\\/]\s*$|L\d+-[^\\/]*[\\/]\s*$/.test(h.text)) skip = '空层名'
          rows.push({
            file: rel,
            line: i + 1,
            text: line,
            start: h.start,
            end: h.end,
            found: h.text,
            name: h.name,
            kind: h.kind,
            historical,
            reason: where || skip,
          })
        }
      }
    }
  }
  return { rows, scannedFiles, scannedLines }
}

/** 一行上所有可改的命中 → 新行 + 实际改了几处。 */
function applyToLine(line, hits) {
  const sorted = [...hits].sort((a, b) => b.start - a.start)
  let s = line
  let n = 0
  for (const h of sorted) {
    // 🔴 2026-10-15 修（**绝对路径 bug**）：原来只把 `h.text` 换成裸文件名，
    //    而 `h.text` 是从**层名**那儿切起的（例 `L2-用户\记录-x.md`）⇒ 前面那半
    //    `C:\Users\…\DeepSeek档案\` 会**留在原地** ⇒ 结果 `C:\…\档案\记录-x.md`（**死路径**）。
    //    （实测：113 处改动里混着 **29 处**这种雷，靠干跑拦住、没 apply。）
    //    ⇒ 现在把"**紧贴在它前面的那段路径前缀**"（盘符 · 目录 · 斜杠，不含空白与引号括号）
    //      **一起吃掉**，只留裸文件名。
    let st = h.start
    while (st > 0 && /[\w\u4e00-\u9fa5.\-:\\/]/.test(s[st - 1])) st--
    s = s.slice(0, st) + h.name + s.slice(h.end)
    n++
  }
  return { text: s, n }
}

// ────────────────────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────────────────────
if (SCAN_DIRS.length === 0) die(`档案根下没扫到任何 "L?-*" 层：${ROOT}`)

const index = buildNameIndex()
const { rows, scannedFiles, scannedLines } = scan(index)

// 按行归组：一行一处改动（`改档.mjs` 的同一行只许一条 replace）
const byLine = new Map()
for (const r of rows) {
  const key = `${r.file}\u0000${r.line}`
  if (!byLine.has(key)) byLine.set(key, [])
  byLine.get(key).push(r)
}

const changes = [] // {file,line,old,new,count,names}
const refused = [] // {file,line,reason,found,name,text}
for (const [, hits] of byLine) {
  const first = hits[0]
  const okHits = hits.filter((h) => (h.historical && !args.includeHistory) || h.reason ? false : true)
  const badHits = hits.filter((h) => !okHits.includes(h))
  for (const b of badHits) {
    const why = b.historical && !args.includeHistory ? '历史叙述' : b.reason || '历史叙述'
    refused.push({ file: b.file, line: b.line, reason: why, found: b.found, name: b.name, text: b.text })
  }
  if (okHits.length === 0) continue
  const { text, n } = applyToLine(first.text, okHits)
  if (text === first.text) continue
  changes.push({
    file: first.file,
    line: first.line,
    old: first.text,
    new: text,
    count: n,
    names: okHits.map((h) => h.name),
  })
}

// ---- 汇总 ----
const reasonCount = new Map()
for (const r of refused) reasonCount.set(r.reason, (reasonCount.get(r.reason) || 0) + 1)
const changedPlaces = changes.reduce((a, c) => a + c.count, 0)
const changedFiles = new Set(changes.map((c) => c.file)).size
const perLayer = new Map()
for (const c of changes) {
  const layer = c.file.split('\\')[0]
  perLayer.set(layer, (perLayer.get(layer) || 0) + c.count)
}

console.log(`【引用去路径】${args.apply ? '真落' : '干跑'} · 档案 ${ROOT}`)
console.log(`  扫了 ${SCAN_DIRS.join(' / ')}（跳过含"证据 / 临时"的层）`)
console.log(`  ${scannedFiles} 份文档 / ${scannedLines} 行 · 文件名集合 ${index.total} 个（只收上面那几层 / ${index.files} 份；重名 ${index.dups.size} 个）`)
console.log(`  ✅ 将改 ${changedPlaces} 处 / ${changedFiles} 个文件`)
console.log(`  ⛔ 拒 ${refused.length} 处` + (reasonCount.size ? `（${[...reasonCount].map(([k, v]) => `${k} ${v}`).join(' · ')}）` : ''))
if (perLayer.size) {
  console.log('  按层：' + [...perLayer].map(([k, v]) => `${k} ${v}`).join(' · '))
}
{
  const perFile = new Map()
  for (const c of changes) perFile.set(c.file, (perFile.get(c.file) || 0) + c.count)
  const top = [...perFile].sort((a, b) => b[1] - a[1])
  console.log(`  按文件（前 ${Math.min(15, top.length)}）：`)
  for (const [f, n] of top.slice(0, 15)) console.log(`     ${String(n).padStart(4)}  ${f}`)
  if (top.length > 15) console.log(`     …还有 ${top.length - 15} 个文件`)
}

// ---- 拒的逐行列出来（默认全列；只列前若干条由 --max-print 控制）----
{
  const maxPrint = Number((process.argv.find((a) => a.startsWith('--max-print=')) || '').split('=')[1] || 0)
  const grouped = new Map()
  for (const r of refused) {
    if (!grouped.has(r.reason)) grouped.set(r.reason, [])
    grouped.get(r.reason).push(r)
  }
  // 重名那一类另给"是哪些名字"（层重建要先把重复消掉，这份名单就是待办）
  if (grouped.has('重名')) {
    const byName = new Map()
    for (const r of grouped.get('重名')) byName.set(r.name, (byName.get(r.name) || 0) + 1)
    console.log(`\n  重名涉及 ${byName.size} 个文件名（被引用处数）：`)
    for (const [n, c] of [...byName].sort((a, b) => b[1] - a[1])) console.log(`     ${String(c).padStart(4)} 处  ${n}`)
  }
  // 🔴 **重名名单**（＝名字集合里同名几份的那些；层重建要先消掉它们，这份就是待办）
  //    ⚠️ 这里报的是"**文件几份**"，不是"被引用几处" —— 初版混着看容易误会（用户 2026-09-26 点过）。
  console.log(`\n  🔴 真重名 ${index.dups.size} 个文件名（层重建要把重复消掉才谈得上"只写文件名"）：`)
  for (const [n, rels] of [...index.dups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${rels.length} 份  ${n}`)
    for (const r of rels) console.log(`           ${r}`)
  }
  for (const [reason, list] of grouped) {
    console.log(`\n  ⛔ ${reason}（${list.length} 处）` + (maxPrint && list.length > maxPrint ? ` —— 只印前 ${maxPrint} 条，全量看 --list-refused` : ''))
    for (const r of maxPrint ? list.slice(0, maxPrint) : list) {
      console.log(`     ${r.file}:${r.line}  「${r.found}」`)
    }
  }
}

// ---- 将改的清单（前若干条，够核就行）----
{
  const maxPrint = 40
  console.log(`\n  ✅ 将改（前 ${Math.min(maxPrint, changes.length)} 条）：`)
  for (const c of changes.slice(0, maxPrint)) {
    console.log(`     ${c.file}:${c.line}`)
    console.log(`        旧：${c.old.trim().slice(0, 200)}`)
    console.log(`        新：${c.new.trim().slice(0, 200)}`)
  }
  if (changes.length > maxPrint) console.log(`     …还有 ${changes.length - maxPrint} 个文件的行，全量看 --json`)
}

// ---- 落文件（拒名单 / 汇总）----
if (args['list-refused']) {
  const head = ['# 引用去路径 · 拒名单', `# 共 ${refused.length} 处`, '# 文件\t行号\t原因\t命中的那段\t文件名\t（那一行，只读参考）']
  const body =
    head.join('\n') +
    '\n' +
    refused
      .map((r) => [r.file, r.line, r.reason, r.found, r.name, r.text.replace(/\t/g, ' ')].join('\t'))
      .join('\n') +
    '\n'
  writeFileSync(args['list-refused'], body, 'utf8')
  console.log(`\n📄 拒名单已写：${args['list-refused']}（${refused.length} 处）`)
}
if (args.json) {
  writeFileSync(
    args.json,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        root: ROOT,
        scanDirs: SCAN_DIRS,
        scannedFiles,
        scannedLines,
        nameIndex: { names: index.total, files: index.files, dupNames: index.dups.size },
        willChange: { places: changedPlaces, files: changedFiles, ops: changes },
        refused,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(`📄 汇总已写：${args.json}`)
}

if (changes.length === 0) {
  console.log(
    `\n✅ 一处都不用改 —— 幂等：这 ${scannedFiles} 份文档里**没有**还带层路径的引用了` +
      `${refused.length ? `（另 ${refused.length} 处按规矩拒：${[...reasonCount].map(([k, v]) => `${k} ${v}`).join(' · ')}）` : ''}。`,
  )
  process.exit(0)
}

// ---- 生成事务 → 交给唯一那扇门 ----
const ops = changes.map((c) => ({ op: 'replace', file: c.file, line: c.line, text: c.new, expect: c.old }))
// 🔴 **2026-10-11 改**：同 `引用改写.mjs` —— 事务文件**不再往 `memoria-txn/` 里丢**
//    （那是落档内核的残件目录；本工具往里写又从不清理，实测堆了 434 个 / 5 MB）。
const txnDir = join(HOME_DIR, 'txn-out')
mkdirSync(txnDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
// 🔴 2026-10-10 加（织布机收口 · 阶段⑤）：环境变量 `MEMORIA_TXN_OUT` 指了就把事务写到那儿、
//    **并且不调 `改档.mjs`**（落盘交给调用方 —— 织布机就是这么接的）。
//    ⚠️ 没指 ⇒ 行为与以前**一个字不差**。
const txnOutEnv = process.env.MEMORIA_TXN_OUT || ''
const txnPath = txnOutEnv || join(txnDir, `引用去路径-${stamp}.json`)
writeFileSync(
  txnPath,
  JSON.stringify({ note: `引用去路径：${changedPlaces} 处带层路径 → 光文件名（${changedFiles} 个文件）`, ops }, null, 2),
  'utf8',
)

console.log(`\n📄 事务已备：${txnPath}`)
console.log(`   ${ops.length} 行替换（${changedPlaces} 处引用）`)

if (txnOutEnv) {
  console.log('▶ 只出事务（MEMORIA_TXN_OUT）—— 一个字都没写；落盘交给调用方。')
  process.exit(0)
}

console.log(`   交给 改档.mjs --txn ${args.apply ? '' : '--dry-run'}`)
const r = spawnSync(process.execPath, [GAI_DANG, '--txn', txnPath, ...(args.apply ? [] : ['--dry-run'])], {
  stdio: 'inherit',
})
process.exit(r.status ?? 1)
