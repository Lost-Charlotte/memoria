#!/usr/bin/env node
/**
 * 引用改写.mjs —— **批量改「档案里的一处引用」的辅助入口**（2026-09-21 加，用户点的）
 *
 * 用户原话〔会话 2026-09-21〕："**或许他的功能需要再强大一点，不只是点头保留摇头删除。而是可以改动呢？**"
 *
 * 它治什么：合并一个能力代号 / 改一个文件名 / 清一批"第 N 行"指路 ——
 *   这类活的形态是"**同一处引文散在几十个文件里**"，靠手写几百条事务必然出错。
 *
 * 🔴 **它不是写入口**（这条不能破）：
 *   它自己**一个字都不写** —— 只**生成事务**；真落永远走 `改档.mjs --txn`
 *   （快照 → 全量预检 → 写 → 逐文件读回对账 → 任一不过就全部还原）。
 *
 * 三步：
 *   ① 列：`node tools/引用改写.mjs --find "F8" [--out 清单.tsv]`
 *   ② 我分拣：在清单里**逐处**填 `改` / `删` / `留`（每处各定各的，不是一刀切）
 *   ③ 落：`node tools/引用改写.mjs --plan 清单.tsv [--apply]`（**默认干跑**）
 *
 * 清单格式（TSV，前 4 列有效，第 5 列是只读参考）：
 *   文件 <TAB> 行号 <TAB> 动作 <TAB> 新文本 <TAB> 原行
 *   · `留` —— 不动（历史叙述就走这个）
 *   · `改` —— 把**匹配到的那一段**换成「新文本」（要改整行就把整行写进去）
 *   · `删` —— 把**匹配到的那一段**删掉（**不是删整行**）
 *   · `?`  —— 还没定 ⇒ **拒绝执行**（不许"漏看一处也算过"）
 *
 * 边界：
 *   · **扫哪几层是"现算"的**：档案根下所有 `L?-*` 目录，**跳过名字含"证据 / 临时"的**
 *     （和 `dangan_search` 一个口径）—— 加层不用改这份工具；
 *   · 匹配是**字面量**（`F8` 不会误伤别的）；`--find` 不许为空；
 *   · 每处都带 `expect`（原行现读）⇒ 别人先动过，`改档.mjs` 当场停手、一个字不写；
 *   · 行号一律按**改动前**的行（`改档.mjs` 自己会处理偏移）。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CFG, HOME_DIR, findByName, scanLayerDirs, stripTrailingSlash } from '../lib/common.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARCHIVE = CFG.archiveDir
const GAI_DANG = join(HERE, '改档.mjs')
/**
 * 扫哪几层 —— 🔴 **走唯一来源**（`lib/common.js` 的 `scanLayerDirs`，默认就跳"证据 / 临时"，2026-10-11 收拢）。
 *
 * 为什么不再现算：原来这里自抄了一份 `readdirSync + /^L\d+-/ + !/证据|临时/`，
 * 与 `引用去路径.mjs` 那份是**两份复制品**（口径扫点名）；现在只剩一行 ——
 * **加一层 / 改跳过词都只动 `common.js`**。
 */
const SCAN_DIRS = scanLayerDirs(ARCHIVE)
const ACTIONS = new Set(['改', '删', '留'])

/** 上下文截断（清单里只给 60 字，够看语境就行）。 */
const clip = (s) => {
  const t = String(s ?? '')
    .replace(/\t/g, ' ')
    .trim()
  return t.length > 60 ? t.slice(0, 60) + '…' : t
}

/**
 * 把"要找的那一段"包成匹配器 —— **默认按词边界**。
 * 🔴 2026-09-21 实测踩到的坑：`--find F8` 用裸包含时，把铁律里两处 `[Text.Encoding]::UTF8`
 *   也当成引用了（16 处里有 2 处是误伤）。**代号 / 文件名 / 中文短语都是词级的**，
 *   词边界对这三类都成立（`-` `.` 中文旁边都算边界），所以它是更对默认值。
 * `--literal` 退回裸包含（真要匹配"夹在词中间"的片段时才用）。
 */
function matcher(needle, literal) {
  const s = String(needle)
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // ⚠️ 词边界**只对"纯词"有意义**（`F8` 不该误伤 `UTF8`）。
  //    要找的东西一旦带空格 / 斜杠（如 `F8 / `、` / F8` —— 清列表里的代号就得连邻居一起删），
  //    再加 `\b` 反而**永远匹配不上**（`\b` 要求"词字符 ↔ 非词字符"的边界，`/` 后接空格不成立）。
  //    2026-09-21 实测撞到：4 处"填了删但这一行没变"全是这种。所以只在**纯英文数字**时才加。
  const wordish = /^[A-Za-z0-9_-]+$/.test(s)
  return !literal && wordish ? new RegExp(`\\b${esc}\\b`, 'g') : new RegExp(esc, 'g')
}

function die(msg) {
  console.error(`❌ 引用改写：${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--find' || a === '--out' || a === '--plan' || a === '--html' || a === '--from-json' || a === '--ctx' || a === '--replace-all' || a === '--map' || a === '--renumber' || a === '--txn-out')
      out[a.slice(2)] = argv[++i] ?? ''
    else if (a === '--apply') out.apply = true
    else if (a === '--literal') out.literal = true
    else if (a === '--help' || a === '-h') out.help = true
    else out._.push(a)
  }
  return out
}

/** 递归收 `.md` / `.txt`（别的格式不是"引用"住的地方）。 */
function walk(dir, out = []) {
  let ents = []
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(md|txt)$/i.test(e.name)) out.push(p)
  }
  return out
}

const HELP = `引用改写 —— 批量改档案里的一处引用（**自己一个字都不写**，只生成事务）

① 列：  node tools/引用改写.mjs --find "F8" [--out 清单.tsv]        # 🔴 **--out 给了才落成文件**；不给只在终端打印
        node tools/引用改写.mjs --find "F8" --ctx 2 [--out 清单.tsv]   # 上下文各带 2 行（默认 1）
        · 🔴 **扫描范围（现算，加层不用改这份工具）**：档案根下所有「L?-*」目录，**跳过名字含"证据 / 临时"的**；
          即 L1/L2/L3/L4/L8 都在内，L5-证据 与 L6-工具临时 不在内。
        · ⚠️ **关键词要按"档案里实际怎么写"给**：想清掉某套说法时，先 --find 它**可能的各种写法**（2026-10-11 实测：拿一个词去找写成**另一个词**的那处 ⇒ 只报 1 处，容易误判成"工具漏扫"）。
①‴ 映射：node tools/引用改写.mjs --map 「映射.tsv」[--ctx 2] [--out 清单.tsv]   # 同上：不给 --out 只在终端打印
①⁗ 自愈：node tools/引用改写.mjs --renumber "T8,T21,E370" [--out 映射.tsv]
        · 🔴 **删了号之后，让后面的号自动前移**（T9→T8、E371→E370…）并**同步全档引用**
        · 它**只算出映射表**（不删、不改）⇒ 看一眼再跑 --map 那张表 ⇒ 清单 ⇒ --plan
        · ⚠️ **次序**：删行／删条**先做**（走 改档.mjs）⇒ 再跑本命令补号
        · 🔴 **一次换一批**（T／E 号重排、批量改名、代号合并）—— 映射表每行两列：「旧值 <TAB> 新值」
        · 「#」开头是注释；空行忽略；**一次扫全档 ⇒ 一份合并清单**（每行自带"要找什么" ⇒ --plan 照旧）
        · 第 4 列**预填建议**（把该处旧值换成新值）—— 逐处核对；**有冲突会在清单头告警**
①′ 看：  node tools/引用改写.mjs --find "F8" --html 对照.html         # 🔴 生成**左右对照**的单文件页面
        · 左＝现状（命中处高亮）· 右＝逐处选 改 / 删 / 留，填新文本
        · 页面底部「导出」出一个 JSON → 回来跑 ↓
①″ 收：  node tools/引用改写.mjs --from-json 结果.json --out 清单.tsv  # 把导出结果变成清单
② 分拣：编辑清单，逐处填 改 / 删 / 留（改的写新文本）
③ 落：  node tools/引用改写.mjs --plan 清单.tsv          # 干跑（默认）
        node tools/引用改写.mjs --plan 清单.tsv --apply  # 真落（走 改档.mjs --txn）
`

const args = parseArgs(process.argv.slice(2))

if (args.help || (!args.find && !args.plan && !args['from-json'] && !args.map && !args.renumber)) {
  process.stdout.write(HELP)
  process.exit(args.help ? 0 : 1)
}

/** 扫三层，把每一处命中原样收起来（`--find` 与 `--html` 共用这一份）。 */
function scanHits(needle, ctx = 1) {
  const hits = []
  for (const d of SCAN_DIRS) {
    for (const f of walk(join(ARCHIVE, d))) {
      let raw = ''
      try {
        raw = readFileSync(f, 'utf8')
      } catch {
        continue
      }
      const lines = raw.split(/\r?\n/)
      const re = matcher(needle, args.literal)
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        if (re.test(lines[i]))
          hits.push({
            rel: relative(ARCHIVE, f),
            line: i + 1,
            text: lines[i],
            // 🔴 2026-09-21 用户点出："**够不够你下判断**" —— 只给原行判不了"这处是历史叙述、
            //    还是在给读者指路"。所以把**前后各若干行**也带上，分拣时看得见语境。
            //    2026-09-26：默认 1 行，可用 `--ctx N` 加宽（做 HTML 对照时 2~3 行更好判）。
            prev: lines.slice(Math.max(0, i - ctx), i),
            next: lines.slice(i + 1, i + 1 + ctx),
          })
      }
    }
  }
  return hits
}

/**
 * 从命中列表生成清单文本 —— `--find` 与 `--map` 共用（🔴 2026-10-08 提取：加 `--map` 时抽出来的）。
 * @param {{title:string, hits:Array, prefill?:Map<string,string>|null, notes?:string[]}} o
 *   `prefill` 的键是 `` `${rel}\t${line}` `` ⇒ 预填第 4 列（不给就全填 `?` = 还没定）
 */
function buildList({ title, hits, prefill = null, notes = [] }) {
  const out = [
    '# 引用改写清单',
    `# ${title}`,
    '# 改法：「动作」列填 改 / 删 / 留；填「改」的把新文本写进第 4 列',
    '# 🔴 **第 4 列 ＝ 用来替换「`--find` 命中的那一段」的新文本**（**不是**整行）——',
    '#    例：`--find 旧名` 命中 `…\\旧名.md`，想改成 `…\\新名.md` ⇒ 第 4 列只写 **新名**（或 `新目录\\新名`），',
    '#    别把整行抄进去 —— 抄了会变成「整行里再嵌一个整行」（2026-10-15 实测踩过，干跑当场拦下）。',
    '#    确实要换整行 ⇒ 第 5 列写「整行」。',
    '#      · 改 = 把匹配到的那一段换成新文本（要改整行就把整行写进去）',
    '#      · 删 = 把匹配到的那一段删掉（**不是**删整行）',
    '#      · 留 = 不动（历史叙述走这个）· ? = 没定 ⇒ 拒绝执行',
    ...notes,
    '# 文件\t行号\t动作\t新文本\t（要找什么：留空＝用命令行 --find）\t（原行，只读参考）\t（上下文，只读参考）',
    ...hits.map((h) => {
      const pre = prefill ? prefill.get(`${h.rel}\t${h.line}`) : null
      return [
        h.rel,
        h.line,
        pre ? '改' : '?',
        pre ?? '?',
        h.needle ?? '',
        h.text.replace(/\t/g, ' '),
        `↑${clip(h.prev.join(' / '))} ⟶ ↓${clip(h.next.join(' / '))}`,
      ].join('\t')
    }),
  ].join('\n')
  return out + '\n'
}

// ────────────────────────────────────────────
// ①‴ 映射表：**一次换一批**（T／E 号重排 · 批量改名 · 代号合并）—— 2026-10-08 加
// ────────────────────────────────────────────
//
// 为什么要有它：用户 2026-10-08 ——「**T 号……时间表里肯定有无关紧要的事情是需要被删除的。那 T 号就会变。
//   所以我们需要先做一个更全面更 nb 的修改工具**」。`--find` 一次只能找一个值，换一批号要跑几十遍；
//   映射表就是**一次扫全档、出一份合并清单**。
//
// 🔴 三条设计（都是为了让 `--plan` 一个字都不用改）：
//   ① 清单**每行自带"要找什么"**（第 5 列）—— 那一列 `--plan` 本来就会用（`findPer`）；
//   ② 第 4 列**预填"整行新文本"**（把该行的旧值换成新值）⇒ `--plan` 应用后整行就等于它；
//   ③ **同一行只出一条 op**（一行里有多个号时合并着换）—— 两条 op 打同一行，第二条的 `expect`
//      会对不上（`改档.mjs` 当场停手、一个字不写），那是白跑一趟。
if (args.map !== undefined && !args.plan) {
  let rawMap = ''
  try {
    rawMap = readFileSync(args.map, 'utf8')
  } catch (e) {
    die(`读不到映射表：${args.map}（${e && e.message ? e.message : e}）`)
  }
  const pairs = []
  const badRows = []
  for (const r of rawMap.split(/\r?\n/)) {
    if (!r.trim() || r.trim().startsWith('#')) continue
    const c = r.split('\t')
    const oldV = (c[0] ?? '').trim()
    const newV = (c[1] ?? '').trim()
    if (!oldV || c.length < 2) {
      badRows.push(r)
      continue
    }
    pairs.push({ old: oldV, new: newV, prefix: String(c[2] ?? '').trim() })
  }
  if (badRows.length > 0)
    die(`映射表有 ${badRows.length} 行读不出「旧值 <TAB> 新值」：\n  ${badRows.slice(0, 8).join('\n  ')}`)
  if (pairs.length === 0) die('映射表里一条有效映射都没有（格式：`旧值 <TAB> 新值`，一行一对）')

  const ctx = args.ctx === undefined ? 1 : Math.max(0, Math.min(5, Number(args.ctx) || 1))
  // 一次扫全档：每个旧值各扫一遍 ⇒ 汇总
  const all = []
  for (const p of pairs) for (const h of scanHits(p.old, ctx)) all.push({ ...h, needle: p.old, repl: p.new, prefix: p.prefix })
  // 同一行合并（见上面 ③）—— 键是「文件 + 行号」
  const byLine = new Map()
  for (const h of all) {
    const k = `${h.rel}\t${h.line}`
    const cur = byLine.get(k)
    // ⚠️ `prefix` 也一路带上（2026-10-09：少了它，第 4 列的"吃前缀"就无从判断）
    if (cur) cur.pairs.push({ old: h.needle, new: h.repl, prefix: h.prefix })
    else byLine.set(k, { hit: h, pairs: [{ old: h.needle, new: h.repl, prefix: h.prefix }] })
  }
  const olds = pairs.map((p) => p.old)
  const prefill = new Map()
  const conflicts = []
  const multi = []
  const hits = []
  for (const [k, v] of byLine) {
    let text = v.hit.text
    for (const pr of v.pairs) text = text.replace(matcher(pr.old, args.literal), () => pr.new)
    // 🔴 **2026-10-08 修（干跑当场抓出来的）**：第 4 列要填**那一段的新值**，不是整行 ——
    //    `--plan` 的语义是「把**匹配到的那一段**换成第 4 列」⇒ 填整行就会变成"**整行里再嵌一个整行**"
    //    （实测：`搬运 batch-go` 干跑时，总账 R28 与待办 346 行当场露馅）。
    //    一行里只有一个号 ⇒ 预填新值 ✓；**两个以上 ⇒ 留 `?`**（`--plan` 一次只换一个 needle，
    //    没法用"一段"表达）⇒ 让清单**拒绝执行**，逼人来看那几行、手写整行。
    if (v.pairs.length === 1) {
      // 🔴 **2026-10-09 修（沙箱真跑抓出来的"死指针"）**：引用写成**带层前缀的全路径**时
      //    （`` `L4-施工\x（已办完）.md` ``），只换文件名会留下 `L4-施工\L8-施工归档\x.md`。
      //    正解是**把"要找什么"换成带前缀的整段**（`find` 找整段 ⇒ `改` 换成新值）——
      //    即「第 5 列用带前缀的旧值、第 4 列仍填新值」，两条列的语义一个字都不改。
      //    触发条件（**路由判据**，不是字符串）：映射表给了第三列（旧值所在层前缀）**且新旧不同层**。
      //    ⚠️ 改号 / 同层改名（第三列不给）走原路 —— 一行行为都不变。
      //    ⚠️ **前缀不许加词边界**：`L4-施工` 结尾是汉字，`\b` 要求"词字符 ↔ 非词字符"，
      //      后接 `\` 时**永不成立**（同 `matcher()` 那处 2026-09-21 的实测教训）。
      const p0 = v.pairs[0]
      const pre0 = p0.prefix ? stripTrailingSlash(p0.prefix) : ''
      // ⚠️ 看**这一行到底怎么写的**：带前缀（`L4-施工\x.md`）才吃前缀；
      //    纯文件名那处**不许动**（它还得靠词级匹配找到，否则那一处根本扫不出来）
      const esc0 = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const withPrefix = Boolean(pre0) && new RegExp(`${esc0(pre0)}[\\\\/]${esc0(p0.old)}`).test(String(v.hit.text))
      v.hit.needle = withPrefix ? `${pre0}\\${p0.old}` : p0.old
      prefill.set(k, withPrefix ? p0.new : String(p0.new).replace(/^.*[\\/]/, ''))
    } else {
      // 一行多个号 ⇒ 交给「**整行**」表示（见 `--plan` 那处的说明）：第 4 列＝整行新文本、第 5 列＝整行
      prefill.set(k, text)
      multi.push(`${v.hit.rel}:${v.hit.line}（${v.pairs.map((pr) => pr.old).join('、')}）`)
    }
    // 冲突：换完之后这一行里**仍含**另一个待换的旧值 ⇒ 多半是"包含关系 / 顺序"埋的雷，报出来给人看
    for (const o of olds) {
      if (v.pairs.some((pr) => pr.old === o)) continue
      const re = matcher(o, args.literal)
      re.lastIndex = 0
      if (re.test(text)) {
        conflicts.push(
          `${v.hit.rel}:${v.hit.line} —— 换成「${v.pairs.map((pr) => pr.new).join(' / ')}」之后**仍含「${o}」**`,
        )
        break
      }
    }
    // 🔴 2026-10-09：原来这里写的是 `v.pairs[0].old` ⇒ **把上面刚算好的 `needle` 又盖回去了**
    //    （带层前缀那处的"要找什么"因此丢了前缀 ⇒ 死指针照旧）。一个号时用它自己那份。
    hits.push({ ...v.hit, needle: v.pairs.length === 1 ? v.hit.needle : '整行' })
  }
  hits.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)
  const notes = []
  if (multi.length > 0) {
    notes.push(
      `# ⚠️ **${multi.length} 行里有多个号**（第 4 列**故意留空** —— 一段装不下，请**手写整行**再落）：`,
      ...multi.slice(0, 12).map((c) => `#    · ${c}`),
      ...(multi.length > 12 ? [`#    …还有 ${multi.length - 12} 行`] : []),
    )
  }
  if (conflicts.length > 0) {
    notes.push(
      `# ⚠️ **${conflicts.length} 处冲突**（换完之后那一行里还留着另一个待换的旧值 —— 逐个看清再定）：`,
      ...conflicts.slice(0, 12).map((c) => `#    · ${c}`),
      ...(conflicts.length > 12 ? [`#    …还有 ${conflicts.length - 12} 处`] : []),
    )
  }
  // 🔴 **2026-10-11 加（用户点名的待办）**：**文件名里带旧值**时先出声
  //   （实测踩过的 2026-10-10：14 份留底件的**文件名含 `W10`**，而它们**内容里没有** `W10`
  //    ⇒ 一次重排"扫不到、也不会改它们" ⇒ 换完那批文件名里还挂着旧值 = **死指针**）。
  //   它**只出声、不拦**（改名这类活本来就要做），但清单头先把它挑出来 ⇒ 靠清单、不靠我记得。
  const nameWarn = []
  // ① **文件名本身**带旧值（**内容里没有** ⇒ 扫不到、也不会被改）⇒ 这一批换完它就是个死指针。
  //   判据：`old` 至少 2 字符（1 个字符会满屏假警告）＋ 文件名≠纯旧值（那是它自己，正常改名）。
  const allFiles = []
  for (const d of SCAN_DIRS) for (const f of walk(join(ARCHIVE, d))) allFiles.push(relative(ARCHIVE, f))
  const hitRel = new Set(hits.map((h) => h.rel))
  for (const p of pairs) {
    const oldS = String(p.old).trim()
    if (oldS.length < 2) continue
    for (const r of allFiles) {
      if (hitRel.has(r)) continue // 这一份已经被扫到（内容里有 ⇒ 会一起改，不用提醒）
      const bn = basename(r)
      if (bn === oldS || bn.includes(oldS)) {
        nameWarn.push(`#       · 「${r}」—— **文件名里有「${oldS}」，内容里没有**（这批换完它不会被改到 ⇒ 先决定"这一份要不要一起改名"）`)
      }
    }
  }
  for (const p of pairs) {
    const oldN = String(p.old).replace(/^.*[\\/]/, '')
    const newN = String(p.new).replace(/^.*[\\/]/, '')
    if (!oldN || oldN === newN) continue
    for (const h of hits) {
      if (h.rel === oldN) continue // 正在给**它自己**改名 ⇒ 正常
      if (h.rel === newN) {
        nameWarn.push(`#       · 「${h.rel}」这一份**本来就叫新名** —— 别把"它自己的名字"当成要改的引用`)
      } else if (newN && h.rel.includes(newN)) {
        nameWarn.push(`#       · 「${h.rel}」（文件名里含新值「${newN}」）`)
      }
    }
  }
  if (nameWarn.length > 0) {
    const uniq = [...new Set(nameWarn)]
    notes.push(
      `# ⚠️ **${uniq.length} 处"文件名里带旧值 / 新值"**（名单里那些**扫不到、也不会被改** ⇒ 先决定"这一份要不要一起改名"）：`,
      ...uniq.slice(0, 12),
      ...(uniq.length > 12 ? [`#    …还有 ${uniq.length - 12} 处`] : []),
    )
  }
  const body = buildList({
    title: `映射 ${pairs.length} 对（${pairs
      .map((p) => `${p.old}→${p.new}`)
      .slice(0, 6)
      .join(' · ')}${pairs.length > 6 ? ' …' : ''}）—— 命中 ${hits.length} 行 / ${all.length} 处`,
    hits,
    prefill,
    notes,
  })
  if (args.out) {
    writeFileSync(args.out, body, 'utf8')
    console.log(
      `✅ 清单已写：${args.out}（映射 ${pairs.length} 对 · 命中 ${hits.length} 行${
        conflicts.length > 0 ? ` · ⚠️ 冲突 ${conflicts.length} 处` : ''
      }）`,
    )
    console.log(`   下一步：逐处核对第 4 列 ⇒ node tools/引用改写.mjs --plan ${args.out}`)
    console.log('   ℹ️ 扫描范围：档案根下所有 L?-* 目录，跳过名字含"证据 / 临时"的')
  } else {
    process.stdout.write(body)
  }
  process.exit(0)
}

// ────────────────────────────────────────────
// ①⁗ 自愈：**重编号**（`--renumber`）—— 2026-10-08 加（用户拍板）
// ────────────────────────────────────────────
//
// 用户原话〔会话 2026-10-08〕：「**我觉得还是不能允许断号。我希望 t 号和 e 号能自愈，比如 t7，t8，t9。
//   我们删掉 t8，t9 自动前进变成 t8，后面依次往前。配合指纹自愈的双重自愈，是不是就不需要你挨个
//   盯着看了**」
//
// 它干什么：我说一句「删了 T8、T21、E370」（`--renumber "T8,T21,E370"`）⇒ 它**现算现有的号**
//   ⇒ 输出一张 **「旧号 → 新号」映射表**（只列真要动的）⇒ 交给 `--map` 出清单、`--plan` 落。
// 🔴 **它不删任何东西**：删 T 行 / 删 E 条是**另一个动作**（走 `改档.mjs`）—— 它只管"号与引用"。
//    正确次序：**先砍掉要删的行/条 ⇒ 再跑本命令**（砍完号就缺了，本命令把它补齐并同步全档引用）。
//    ⚠️ **历史叙述里的旧号**（"当时是 T8"这种）由 `--map` 的清单逐处核（填 `留`）—— 机器不替你判。
if (args.renumber !== undefined && !args.plan) {
  const dels = String(args.renumber || '')
    .split(/[,，、\s]+/)
    .filter(Boolean)
  if (dels.length === 0) die('--renumber 后面要给"删了哪些号"，例：--renumber "T8,T21,E370"')
  const KINDS = [
    { k: 'T', name: '时间轴', re: /^\|\s*[^|]*\|\s*\*\*T(\d+)\*\*\s*\|/gm },
    { k: 'E', name: '事件表', re: /^### E(\d+)｜/gm },
  ]
  const lines = []
  const notes = []
  let total = 0
  for (const { k, name, re } of KINDS) {
    const wantDel = dels
      .filter((d) => d.toUpperCase().startsWith(k))
      .map((d) => Number(String(d).slice(1)))
      .filter((n) => Number.isInteger(n) && n > 0)
    if (wantDel.length === 0) continue
    const p = findByName(name)
    if (!p) {
      notes.push(`⚠️ 找不到《${name}》—— ${k} 号这一段跳过（一个字都没写）`)
      continue
    }
    const have = [...readFileSync(p, 'utf8').matchAll(re)].map((m) => Number(m[1])).sort((a, b) => a - b)
    const inFile = new Set(have)
    const delSet = new Set(wantDel.filter((n) => inFile.has(n)))
    const ghost = wantDel.filter((n) => !inFile.has(n))
    if (ghost.length > 0) notes.push(`⚠️ ${k} 号里有 ${ghost.length} 个**在档案里本来就不存在**（跳过）：${ghost.map((n) => `${k}${n}`).join('、')}`)
    if (delSet.size === 0) {
      notes.push(`⚠️ ${k} 号：给的那些号一个都不在档案里 ⇒ 这一段没有可重排的`)
      continue
    }
    const delList = [...delSet].sort((a, b) => a - b)
    let moved = 0
    for (const n of have) {
      if (delSet.has(n)) continue
      const shift = delList.filter((d) => d < n).length
      if (shift > 0) {
        lines.push(`${k}${n}\t${k}${n - shift}`)
        moved++
      }
    }
    total += moved
    notes.push(`· ${k} 号：档案里现有 ${have.length} 个 · 你点名删 ${delList.length} 个（${delList.map((n) => `${k}${n}`).join('、')}）⇒ **要改号的 ${moved} 个**`)
  }
  const body =
    ['# 重编号映射表（--renumber 生成 —— 交给 --map 用）', ...notes.map((n) => `# ${n}`), '# 旧值\t新值', ...lines].join('\n') + '\n'
  if (args.out) {
    writeFileSync(args.out, body, 'utf8')
    console.log(`✅ 映射表已写：${args.out}（要改号 ${total} 个）`)
    console.log(`   看一眼 ⇒ node tools/引用改写.mjs --map ${args.out} --out 清单.tsv`)
  } else {
    process.stdout.write(body)
  }
  process.exit(0)
}

// ────────────────────────────────────────────
// ① 列：扫三层，把每一处命中原样摆出来
// ────────────────────────────────────────────
if (args.find !== undefined && !args.plan) {
  const needle = String(args.find)
  if (!needle.trim()) die('--find 不许是空的')
  const ctx = args.ctx === undefined ? 1 : Math.max(0, Math.min(5, Number(args.ctx) || 1))
  const hits = scanHits(needle, ctx)
  // 🔴 ①′ **生成"左右对照"的单文件页面**（2026-09-26 用户要的："**在一个界面左右对比**"）
  if (args.html) {
    writeFileSync(args.html, renderHtml(needle, hits, ctx), 'utf8')
    const bytes = readFileSync(args.html).length
    console.log(`✅ 对照页已写：${args.html}（命中 ${hits.length} 处 · ${(bytes / 1024).toFixed(0)} KB · 单文件、不联网）`)
    console.log('   用法：浏览器打开 → 逐处选 改/删/留 ＋ 填新文本 → 点「导出结果」→ 回来跑：')
    console.log(`   node tools/引用改写.mjs --from-json <导出的.json> --out 清单.tsv`)
    process.exit(0)
  }
  // 🔴 2026-09-26 加 `--replace-all "<新文本>"`：**把命中的每一处都预填成「改 → 新文本」**。
  //    为什么要有它：改名 / 换写法这类活，46 处往往是**同一个替换**（实测：搬一份文件牵出 46 处引用），
  //    逐处点头纯属浪费。⚠️ 它只**预填清单** —— 清单照样要人过一眼、`--plan` 照样默认干跑、落笔照样走那扇门。
  const repl = args['replace-all'] === undefined ? null : String(args['replace-all'])
  // 🔴 2026-10-08：清单构建**提取成 `buildList()`**（与 `--map` 共用同一份，免得两处各写一遍）。
  const prefill = repl === null ? null : new Map(hits.map((h) => [`${h.rel}\t${h.line}`, repl]))
  const body = buildList({
    title: `找的是：${needle} —— 命中 ${hits.length} 处`,
    hits,
    prefill,
    notes:
      repl === null
        ? []
        : [`# 🔴 本清单由 --replace-all 生成：**${hits.length} 处全部预填「改」→「${repl}」**（请逐处核对后再落）`],
  })
  if (args.out) {
    writeFileSync(args.out, body, 'utf8')
    console.log(`✅ 清单已写：${args.out}（命中 ${hits.length} 处）`)
    console.log('   ⏭ 下一步：编辑清单，把「动作」列填成 改 / 删 / 留（改的写新文本）')
    console.log(`   ⏭ 再跑：node tools/引用改写.mjs --plan "${args.out}"          # 干跑`)
    console.log(`   ⏭ 真落：node tools/引用改写.mjs --plan "${args.out}" --apply`)
    console.log('   ℹ️ 扫描范围：档案根下所有 L?-* 目录，跳过名字含"证据 / 临时"的；清单**只按你给的写法找** —— 档案里同一件事有几种写法时，换一种再跑一遍')
  } else {
    process.stdout.write(body)
    console.log('   ⏭ 下一步：这份清单只有终端里有 —— 要落成文件请加 `--out 清单.tsv`，否则它一个字都不会留下')
  }
  process.exit(0)
}

// ────────────────────────────────────────────
// ①′ 对照页：单文件 HTML（左＝现状，右＝逐处定 改/删/留）—— 2026-09-26 用户要的
// ────────────────────────────────────────────
//
// 用户 2026-09-26 原话〔会话 2026-09-26〕："**如果能完成批量修改，那不就不用担心这方面的费用了吗？
//   工具会把被指引的地方连带前后一部分都挖给你。这样你只需要在一个界面左右对比，全部修改完成之后
//   工具再批量替换回去？你觉得有戏吗？**"
//
// 设计（照他那句话来）：
//   · **挖上下文** → 每处带上前后 `--ctx` 行（默认 1）；
//   · **左右对比** → 左栏现状（命中处高亮）、右栏定夺（改/删/留 ＋ 新文本）；
//   · **导出 → 批量替换回去** → 页面导出 JSON，`--from-json` 变成清单，`--plan` 生成事务，`改档.mjs` 落。
// 🔴 **省钱的地方就在这儿**：那些字**只在浏览器里**，进不了我的上下文；我只读回**你改过的那几处**。
function renderHtml(needle, hits, ctx) {
  const reSrc = matcher(needle, args.literal).source
  const data = JSON.stringify(
    hits.map((h) => ({
      rel: h.rel,
      line: h.line,
      find: needle,
      text: h.text,
      prev: h.prev,
      next: h.next,
    })),
  )
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>引用改写 · 左右对照（${needle}）</title>
<style>
  :root { --bd:#d8d8d8; --hi:#ffe9a8; --ink:#222; --dim:#777; --ok:#1a7f37; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.6 "Microsoft YaHei",system-ui,sans-serif; color:var(--ink); background:#fafafa; }
  header { position:sticky; top:0; z-index:9; background:#fff; border-bottom:2px solid var(--bd); padding:10px 14px; }
  header h1 { margin:0 0 6px; font-size:16px; }
  header .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  button { font:inherit; padding:4px 12px; border:1px solid var(--bd); background:#fff; border-radius:6px; cursor:pointer; }
  button:hover { background:#f0f0f0; }
  button.primary { background:#1a7f37; color:#fff; border-color:#1a7f37; }
  #stat { color:var(--dim); }
  main { padding:10px 14px 80px; }
  .item { background:#fff; border:1px solid var(--bd); border-radius:8px; margin:10px 0; overflow:hidden; }
  .item .head { display:flex; gap:8px; align-items:baseline; padding:6px 10px; background:#f4f4f4; border-bottom:1px solid var(--bd); font-size:13px; }
  .item .head code { color:#444; }
  .item .head .idx { color:var(--dim); }
  .split { display:grid; grid-template-columns:1fr 1fr; }
  .pane { padding:10px 12px; }
  .pane.left { border-right:1px dashed var(--bd); }
  .pane .cap { font-size:12px; color:var(--dim); margin-bottom:6px; }
  pre { margin:0; white-space:pre-wrap; word-break:break-word; font:13px/1.7 Consolas,"Courier New",monospace; }
  .hit { background:var(--hi); font-weight:700; }
  .acts { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
  .acts button.on { outline:2px solid var(--ok); font-weight:700; }
  textarea { width:100%; min-height:64px; font:13px/1.7 Consolas,"Courier New",monospace; border:1px solid var(--bd); border-radius:6px; padding:6px; }
  .done { opacity:.55; }
  footer { position:fixed; left:0; right:0; bottom:0; background:#fff; border-top:2px solid var(--bd); padding:8px 14px; display:flex; gap:10px; align-items:center; }
</style>
<header>
  <h1>引用改写 · 左右对照 —— 找「${needle}」（命中 ${hits.length} 处）</h1>
  <div class="row">
    <button onclick="setAll('留')">全部标「留」</button>
    <button onclick="setAll('?')">全部清空</button>
    <span id="stat"></span>
  </div>
  <div class="row" style="margin-top:6px;color:#777;font-size:12px">
    右栏每处选一个：<b>改</b>（把命中的那一段换成新文本）· <b>删</b>（把那一段删掉，不是删整行）· <b>留</b>（不动）。
    「改」写完新文本，页面会自动记住（浏览器本地），刷新不丢。
  </div>
</header>
<main id="list"></main>
<footer>
  <button class="primary" onclick="exportJson()">导出结果（JSON）</button>
  <button onclick="document.getElementById('imp').click()">导入之前的结果</button>
  <input id="imp" type="file" accept=".json" style="display:none" onchange="importJson(this)">
  <span id="stat2" style="color:#777"></span>
</footer>
<script>
const NEEDLE = ${JSON.stringify(needle)};
const RE_SRC = ${JSON.stringify(reSrc)};
const ITEMS = ${data};
const KEY = 'yinyong-gaixie::' + NEEDLE + '::' + ITEMS.length;

function esc(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function hi(s){
  const re = new RegExp('(' + RE_SRC + ')', 'gi');
  return esc(s).replace(re, '<span class="hit">$1</span>');
}
const state = JSON.parse(localStorage.getItem(KEY) || '{}');

function render(){
  const list = document.getElementById('list');
  list.innerHTML = ITEMS.map((it, i) => {
    const s = state[i] || { act: '?', text: '' };
    const ctxL = [...it.prev.map((x,j)=>'  '+esc(x)), hi(it.text), ...it.next.map(x=>'  '+esc(x))].join('\\n');
    const acts = ['改','删','留'].map(a => '<button class="'+(s.act===a?'on':'')+'" onclick="setAct('+i+',\\''+a+'\\')">'+a+'</button>').join('');
    return '<div class="item'+(s.act==='留'?' done':'')+'" id="it'+i+'">'
      + '<div class="head"><span class="idx">#'+(i+1)+'</span><code>'+esc(it.rel)+':'+it.line+'</code>'
      + '<span style="margin-left:auto">'+(s.act==='?'?'<span style="color:#b00">未定</span>':s.act)+'</span></div>'
      + '<div class="split">'
      +   '<div class="pane left"><div class="cap">现状（上下文 '+(it.prev.length+it.next.length)+' 行，命中处高亮）</div><pre>'+ctxL+'</pre></div>'
      +   '<div class="pane right"><div class="cap">定夺</div><div class="acts">'+acts+'</div>'
      +     (s.act==='改'
              ? '<textarea id="ta'+i+'" placeholder="把命中那一段换成什么（要改整行就把整行写进去）" oninput="setText('+i+',this.value)">'+esc(s.text||'')+'</textarea>'
              : '<div style="color:#777;font-size:12px">'+(s.act==='删'?'删掉命中的那一段':(s.act==='留'?'不动它':'请先选一个动作'))+'</div>')
      +   '</div>'
      + '</div></div>';
  }).join('');
  updateStat();
}
function setAct(i, a){ state[i] = Object.assign({ act:'?', text:'' }, state[i]||{}, { act:a }); save(); render(); }
function setText(i, v){ state[i] = Object.assign({ act:'改', text:'' }, state[i]||{}, { text:v }); save(); updateStat(); }
function setAll(a){ ITEMS.forEach((_,i)=>{ state[i] = Object.assign({ act:'?', text:'' }, state[i]||{}, { act:a }); }); save(); render(); }
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }
function updateStat(){
  const done = ITEMS.filter((_,i)=> (state[i]||{}).act && state[i].act !== '?').length;
  const chg = ITEMS.filter((_,i)=> (state[i]||{}).act === '改' || (state[i]||{}).act === '删').length;
  document.getElementById('stat').textContent = '已定 ' + done + ' / ' + ITEMS.length + '（其中要动 ' + chg + ' 处）';
  document.getElementById('stat2').textContent = done < ITEMS.length ? '⚠️ 还有 ' + (ITEMS.length-done) + ' 处没定（留 ? 会拒绝执行）' : '✅ 都定完了，点「导出结果」';
}
function exportJson(){
  const out = { needle: NEEDLE, exportedAt: new Date().toISOString(), rows: ITEMS.map((it,i)=>({
    rel: it.rel, line: it.line, find: it.find, act: (state[i]||{}).act || '?', text: (state[i]||{}).text || '', original: it.text,
  }))};
  const name = '引用改写结果-' + NEEDLE.replace(/[\\\\/:*?"<>|]/g,'_') + '-' + ITEMS.length + '处.json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out,null,2)], {type:'application/json'}));
  a.download = name; a.click();
}
function importJson(inp){
  const f = inp.files && inp.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => { try {
    const j = JSON.parse(r.result);
    (j.rows||[]).forEach(row => {
      const i = ITEMS.findIndex(it => it.rel===row.rel && it.line===row.line);
      if (i>=0) state[i] = { act: row.act || '?', text: row.text || '' };
    });
    save(); render();
  } catch(e){ alert('这个文件读不了：'+e.message); } };
  r.readAsText(f);
}
render();
</script>
</html>
`
}

// ────────────────────────────────────────────
// ①″ 收：把对照页导出的 JSON 变回清单（喂给 --plan）—— 2026-09-26 加
// ────────────────────────────────────────────
if (args['from-json']) {
  let j = null
  try {
    // ⚠️ **先剥 BOM**：本机 pwsh 的 `Set-Content -Encoding utf8` / 记事本存盘都会带 BOM，
    //    而 `JSON.parse` 见到 `\uFEFF` 直接报 `Unexpected token`（2026-09-26 实测踩到）。
    j = JSON.parse(readFileSync(args['from-json'], 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    die(`读不到 / 解析不了那个 JSON：${args['from-json']}（${e && e.message ? e.message : e}）`)
  }
  const rowsIn = Array.isArray(j?.rows) ? j.rows : []
  if (rowsIn.length === 0) die('那份 JSON 里没有 rows —— 是不是没点「导出结果」？')
  const needle0 = String(j.needle ?? '').trim()
  const undecided = rowsIn.filter((r) => !ACTIONS.has(r.act))
  const out = [
    '# 引用改写清单（由对照页导出的 JSON 转来）',
    `# 找的是：${needle0} —— 共 ${rowsIn.length} 处${undecided.length ? `（⚠️ 还有 ${undecided.length} 处没定）` : ''}`,
    '# 🔴 第 4 列 ＝ 替换「`--find` 命中的那一段」的新文本（**不是**整行；要整行见第 5 列）',
    '# 文件\t行号\t动作\t新文本\t（要找什么）\t（原行，只读参考）',
    ...rowsIn.map((r) =>
      [r.rel, r.line, r.act || '?', r.text || '', r.find || needle0, String(r.original ?? '').replace(/\t/g, ' ')].join('\t'),
    ),
  ].join('\n')
  const body = out + '\n'
  if (args.out) {
    writeFileSync(args.out, body, 'utf8')
    console.log(`✅ 清单已写：${args.out}（${rowsIn.length} 处${undecided.length ? ` · 还有 ${undecided.length} 处没定` : ''}）`)
  } else {
    process.stdout.write(body)
  }
  process.exit(0)
}

// ────────────────────────────────────────────
// ② 分拣 + ③ 落：读清单 → 生成事务 → 交给 改档.mjs
// ────────────────────────────────────────────
const rows = []
let raw = ''
try {
  raw = readFileSync(args.plan, 'utf8')
} catch (e) {
  die(`读不到清单：${args.plan}（${e && e.message ? e.message : e}）`)
}

const undecided = []
const badAction = []
for (const r of raw.split(/\r?\n/)) {
  if (!r.trim() || r.startsWith('#')) continue
  const c = r.split('\t')
  if (c.length < 4) continue
  const [rel, lineStr, act, newText, findPer] = c
  const line = Number(lineStr)
  if (!rel || !Number.isInteger(line) || line < 1) continue
  if (act === '?') {
    undecided.push(`${rel}:${line}`)
    continue
  }
  if (!ACTIONS.has(act)) {
    badAction.push(`${rel}:${line} → 「${act}」`)
    continue
  }
  rows.push({ rel: rel.trim(), line, act, newText, findPer })
}

if (undecided.length > 0) {
  die(`还有 ${undecided.length} 处**没定动作**（留 ? 就是没定）—— 先把清单填完：\n  ${undecided.slice(0, 12).join('\n  ')}${undecided.length > 12 ? `\n  …还有 ${undecided.length - 12} 处` : ''}`)
}
if (badAction.length > 0) {
  die(`有 ${badAction.length} 处的「动作」不是 改 / 删 / 留：\n  ${badAction.slice(0, 12).join('\n  ')}`)
}

// 「要找的那一段」：命令行给了就用它；没给就**从清单头那条注释里读**（清单是自己生成的，带着它）——
// ⚠️ 清单本身只记「行号 + 新文本」，不记"要找什么"；没有它就没法算新行。
let needle = typeof args.find === 'string' ? args.find : ''
if (!needle) {
  // ⚠️ 2026-09-21：原来只认 `找的是：X —— …`（**生成时**那个格式），手写清单写成
  //    `找的是：R1（能力代号）` 就解析不出来。改成**取到第一个空白 / 左括号之前**，两种写法都认。
  const m = raw.match(/^#\s*找的是：\s*([^\s（(]+)/m)
  if (m) needle = m[1].trim()
}
// ⚠️ 2026-09-22：**不在这里就死** —— 每行可以自带"要找什么"，那就用不着头部那一行。
//    真缺的时候在下面逐行处理时报（报"哪一行缺"，比"整个清单缺"有用得多）。
//    （`needle` 上面已经声明过，这里只是不再 die。）

const live = rows.filter((r) => r.act === '改' || r.act === '删')
if (live.length === 0) {
  console.log('清单里没有一处要动（全是"留"）—— 没什么可落的。')
  process.exit(0)
}

// 逐处现读原行：算出新行 + 抄下 expect（**防撞**就靠它）
const ops = []
const problems = []
for (const r of live) {
  const abs = join(ARCHIVE, r.rel)
  let lines = null
  try {
    lines = readFileSync(abs, 'utf8').split(/\r?\n/)
  } catch {
    problems.push(`${r.rel}:${r.line} —— 读不到这个文件`)
    continue
  }
  const oldLine = lines[r.line - 1]
  if (typeof oldLine !== 'string') {
    problems.push(`${r.rel}:${r.line} —— 这个文件只有 ${lines.length} 行`)
    continue
  }
  // ⚠️ 用函数形式替换：新文本里若出现 `$&` / `$1` 这类，字符串形式会被**当成替换模式**解释。
  // 🔴 2026-09-21 加：**每一行可以自带"要找什么"** —— 因为同一个代号在不同地方要**连不同邻居一起删**
  //    （列表里是 `F8 / `、句末是 ` / F8`、夹在中间是 ` F8`）。留空＝用命令行 `--find`。
  const useFind = r.findPer && r.findPer.trim() && r.findPer.trim() !== '?' ? r.findPer.trim() : needle
  if (!useFind) {
    problems.push(`${r.rel}:${r.line} —— 这一行没自带"要找什么"，命令行也没给 --find`)
    continue
  }
  // 🔴 2026-10-08 加：第 5 列写「**整行**」＝ **整行替换**（第 4 列直接就是那一行的新文本）。
  //    为什么要有它：一行里**有两个以上**待换的值时，"换一段"表达不了（`matcher` 一次只认一个 needle）
  //    ⇒ 由 `--map` 把那几行标成「整行」并算好整行新文本。⚠️ 它仍走同一条门、照样先验 `expect`。
  const wholeLine = useFind === '整行'
  const re = wholeLine ? null : matcher(useFind, args.literal)
  const newLine = wholeLine ? (r.act === '改' ? r.newText : '') : oldLine.replace(re, () => (r.act === '改' ? r.newText : ''))
  if (newLine === oldLine) {
    problems.push(`${r.rel}:${r.line} —— 填了「${r.act}」但这一行没变（原行里还有要找的那段吗？）`)
    continue
  }
  ops.push({ op: 'replace', file: r.rel, line: r.line, text: newLine, expect: oldLine })
}

if (problems.length > 0) {
  die(`有 ${problems.length} 处对不上（**一个字都没写**）：\n  ${problems.slice(0, 12).join('\n  ')}`)
}

// 🔴 **2026-10-11 改**：事务文件**不再往 `memoria-txn/` 里丢**。
//    原来 `txnDir = join(HOME_DIR, 'memoria-txn')` —— 那是**落档内核的事务残件目录**（`sweepTxn` 按
//    `memoria-txn-*.json|log` 认它自己的残件）。本工具往那儿写 `引用改写-<时间戳>.json`，**自己又不清理**
//    ⇒ 实测一个月堆了 **434 个 / 5 MB**，还把 `reportF9Txn()` 的计数**污染成"事务残件 167 个"**。
//    ⇒ 改成**自己的子目录** `txn-out/`（同 `行号加固.mjs` 早就写 `%TEMP%` 的做法：**工具自己的临时件，
//    不混进内核的地盘**）。
const txnDir = join(HOME_DIR, 'txn-out')
mkdirSync(txnDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
// 🔴 2026-10-10 加 `--txn-out <文件>`（织布机收口 · 阶段⑤）：把事务写到**指定文件**、
//    并且**不调 `改档.mjs`** —— 落盘交给调用方（织布机就是这么接的）。
//    ⚠️ 没给这个参数 ⇒ 行为与以前**一个字不差**。
const txnOutEnv = process.env.MEMORIA_TXN_OUT || ''
const txnPath = args['txn-out'] ? String(args['txn-out']) : txnOutEnv || join(txnDir, `引用改写-${stamp}.json`)
if (args['txn-out']) mkdirSync(dirname(txnPath), { recursive: true })
writeFileSync(txnPath, JSON.stringify({ ops }, null, 2), 'utf8')

console.log(`📄 事务已备：${txnPath}`)
console.log(`   改动 ${ops.length} 处 / ${new Set(ops.map((o) => o.file)).size} 个文件 · 跳过"留" ${rows.length - live.length} 处`)

if (args['txn-out'] || txnOutEnv) {
  console.log('▶ 只出事务（--txn-out / MEMORIA_TXN_OUT）—— 一个字都没写；落盘交给调用方。')
  process.exit(0)
}

console.log(args.apply ? '▶ 真落（走 改档.mjs --txn）：' : '▶ 干跑（走 改档.mjs --txn --dry-run）：')

const r = spawnSync(process.execPath, [GAI_DANG, '--txn', txnPath, ...(args.apply ? [] : ['--dry-run'])], {
  stdio: 'inherit',
})
process.exit(r.status ?? 1)
