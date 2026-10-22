#!/usr/bin/env node
/**
 * ⚠️ **别把它当"一次性脚本"** —— 它是《索引》的**唯一生成器**（哪份文件改完开头自述，就该重跑它）。
 *
 * 档案索引.mjs —— 从**每份文件开头的自述**派生 `L1-必读\索引.md`
 *
 * 为什么要它（用户 2026-09-26 的想法，原话）：
 *   「**L1的索引或许需要减重。不要把它当时间线或者事件线来写。他只负责最基础的"告诉你需要什么
 *     去什么地方找"一句话，一个地址，就可以了。甚至索引都可以自动化，前面那句话你自己写，
 *     后面的地址直接自动化，搜索档案馆里这个文件的名字，自动生成路径。这不就永久解决了指针
 *     因为时间原因空掉的问题。我觉得这个甚至可以用在全档案所有指的地方。**」
 *
 * 做法（与"事件表顶部目录从正文派生"**同一套**）：
 *   · **我写的**：每份文件开头那三行自述（`🏷 是什么 / 🕐 什么时候用 / ✍️ 谁写它`）
 *     ——《层与命名》§三 早就定了它，**素材本来就存在**，不必为索引另写一个字；
 *   · **它算的**：文件名 ＋ 表格拼装。
 *   ⇒ 索引从此**不会漂、不会空**：文件搬家只影响地图（路径由地图现算），索引里写的是**文件名**。
 *   · 🔴 **不是每份文件都该有三行自述**（2026-09-27 修）：`L1-必读` 层 · `L2` 两张表 · 入口类
 *     （`_说明-读我.txt` / `从这开始读.txt`）**按《层与命名》§三 ③ 各有自己的表达方式** ——
 *     它们以前被误报成"缺自述"，会把人支使去补**不该补**的文件。现在它们**不进缺自述名单**，
 *     索引那一格退回用"文件自己第一行有内容的字"。
 *
 * 姿态照 `档案结构地图.mjs`：**默认干跑** · `--apply` 才写 · 写前**快照** · 写完**读回对账** · 幂等。
 *
 * 用法：
 *   node 档案索引.mjs            # 干跑：打印将生成的表 ＋ "缺自述"清单（谁缺、缺哪一行）＋ 被豁免的那几类
 *   node 档案索引.mjs --apply    # 真写 `L1-必读\索引.md`
 */

import fs from 'node:fs'
import path from 'node:path'

// 🔴 2026-09-28：**"哪几份不进索引"用索引自己的唯一判据**（原来这里自抄了一份同样的正则）。
import { IDX_SKIP, NEED_INTRO, cell, INDEX_REGEN_HINT, INDEX_HEAD_LINE } from '../lib/idx-scope.js'
// 🔴 2026-10-15：层的「列表 ＋ 每节那句话」收回**唯一来源**（原来本文件自抄一份、还停在 `L2-数据`）。
import { LAYERS as INDEX_LAYERS, renderIndexDoc } from '../lib/f8b-index-doc.js'
// 🔴 2026-10-16：默认根改走 `activeArchiveDir()`（活跃馆解析的唯一来源 —— `GAI_DANG_ROOT` →
//    馆表的 `active` → 老兜底）。原来写死旧馆绝对路径 ⇒ 换馆后直接跑本脚本会去写**旧馆**的索引。
import { activeArchiveDir } from '../lib/common.js'

/** `--root <档案根>`：**跨馆 / 临时目录**用（原来只能靠 `GAI_DANG_ROOT` 环境变量，跨馆很难用）。 */
function argOf(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}
const ROOT = path.resolve(argOf('--root') || activeArchiveDir())
const OUT_REL = path.join('L1-必读', '索引.md')
// 🔴 2026-10-10：`SNAP_DIR`（本脚本自带的快照目录）**已拆** —— 落盘改走织布机 ⇒ 统一用**改档快照**。
//    原来那行声明删了（`L6-工具临时\档案索引快照\` 里剩的是历史件，不再新增）。
const APPLY = process.argv.includes('--apply')
/** `--out <路径>`：**只算不写档案**，把渲染结果写到别处（与 `档案结构地图.mjs` 同名同义）。 */
const OUT_TO = argOf('--out')

/**
 * 逐文件登记的层 —— 与体检"索引漏登记"的口径**完全一致**。
 * 🔴 **2026-09-28 改：含子目录**（原文写的是"只比各层**根下**、不逐文件登记子目录"）——
 *    L3 已分 9 个子目录、**那些就是正文**；两边口径**必须一起改**
 *    （消费方：`lib/f17-map.js` 与 `tools/档案结构地图.mjs` 里那两个 `covered`）。
 * ⚠️ 层名要跟着层重建走：新馆是 `L2-数据` / `L3-知识`，这里写成"**现算**"就是为了那一天不用改代码。
 */
// 🔴 **2026-10-15：这份 `LAYERS` 原来是本文件自抄的第二份** —— 它一直写着 `L2-数据`（那层早删了）、
//    而且**没有 `L2-用户`**（新 L2）⇒ 本脚本渲染出来的表会**丢掉整整一节**，于是"干跑 diff"
//    天天报假差异（实测：同一个索引，这里报"不同 132 行"，而织布机那边判"已经逐字一致、无需重织"
//    —— **两个来源打架**，看的人只能自己去 diff 两份 160 行文本）。
//    ⇒ 按《施工手册》§三「收拢判据」收回唯一来源：`lib/f8b-index-doc.js` 的 `LAYERS`（上面已 import）。
const LAYERS = INDEX_LAYERS

/** 🔴 这几份按规矩不进"逐文件登记"（地图是机器生成的、索引是它自己）。 */
const SKIP = IDX_SKIP // 2026-09-28：走唯一来源（`lib/idx-scope.js`），不再自抄一份同样的正则

// 🔴 2026-10-11 收拢：`NEED_INTRO`（"这一份该不该有三行自述"）与 `cell`（表格单元格转义）
//    原来在本文件各有一份**逐字相同**的实现，而 `lib/f8b-index-doc.js` 那边也各有一份 ——
//    已收进 `lib/idx-scope.js`，本文件从上面 import 用（加一行 `import`，删两段自抄）。

/** 抓一行自述的值：`> 🏷 **这份是什么**：xxx` / `> 🕐 **什么时候用**：xxx`。 */
function grabLine(text, emoji) {
  const re = new RegExp(`^>\\s*${emoji}\\s*\\*\\*[^*]+\\*\\*\\s*[：:]\\s*(.+)$`, 'm')
  const m = text.match(re)
  return m ? m[1].trim() : ''
}

/** 读一份文件的开头（只看前 40 行，够抓那三行）。 */
function introOf(abs) {
  let text = ''
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    return { what: '', when: '', who: '' }
  }
  const head = text.split(/\r?\n/).slice(0, 40).join('\n')
  return { what: grabLine(head, '🏷'), when: grabLine(head, '🕐'), who: grabLine(head, '✍️') }
}

/**
 * 兜底：文件没有三行自述时，**拿它自己第一行有内容的字**当"讲什么"
 * （去掉 markdown 的 `#` / `>` / 强调符；太长截断）。—— 只给被豁免那几类用，别拿它当自述的替代品。
 */
function firstLineOf(abs) {
  const lines = []
  try {
    for (const raw of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      // ⚠️ 可执行件的前几行是 `#!…` / `param(` / `using …` / `import …` 这类"壳"，不是"这份是什么"。
      if (/^\s*(#!|param\s*\(|using\s|\[CmdletBinding|import\s|const\s|let\s|var\s|require\s*\()/.test(raw)) continue
      // ⚠️ 表格行（`| … |`）也不是"这份是什么"（L2 那张表开头就是表头）—— 跳过。
      if (/^\s*\|/.test(raw)) continue
      const s = raw.replace(/^[#>\s]+/, '').replace(/\*\*/g, '').trim()
      if (s) lines.push(s)
    }
  } catch {
    /* 读不到就算了 */
  }
  // 🔴 **优先挑开头的说明行里含中文的那一条**（`# 说明：…` 这种最像"这份是什么"）；
  //    挑不到才退回第一条有内容的 —— 只在前 15 行里找，免得把正文里随手一句中文当自述。
  // 🔴 **显式自述优先**：文件里写了 `ABOUT: …` 就用它 —— 这是给**可执行件**定的口径
  //    （`.ps1` / `.cmd` 必须纯 ASCII，写不了 `> 🏷` 那种中文块引用，所以它们用注释声明自己）。
  const head = lines.slice(0, 15)
  const about = lines.find((s) => /^(?:\/\/|rem\s+|#)?\s*about\s*[:：]/i.test(s))
  const pick = about
    ? about.replace(/^(?:\/\/|rem\s+|#)?\s*about\s*[:：]\s*/i, '')
    : head.find((s) => /[\u4e00-\u9fff]/.test(s)) || head[0] || ''
  return pick.length > 60 ? `${pick.slice(0, 60)}…` : pick
}

const rows = []
const missing = []
const exempt = []

/** 递归收一层下的文件（**含子目录**），只收这几种扩展名、跳过 SKIP。返回**文件名**（索引只写文件名）。 */
// 🔴 **2026-09-28 修（必须递归）**：L3 已在 T714 分进 9 个子目录（事故 / 参考 / 记录 / 指南 / 日志 / 清单 /
//    经验 / 脚本 / …），**那些就是正文**。只扫"层根下"会让 **35 份 L3 正文从索引里掉光** ——
//    实测干跑只收 **12 份**（＝L1 8 ＋ L2 2 ＋ L3 2），而现存的《索引》里**有那 35 份** ⇒ **一重生成就掉**。
//    ⚠️ 快照类子目录不进（它们不是"档案的正文"）。
function collectFiles(dir, rel = '') {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (/快照/.test(e.name)) continue
      out.push(...collectFiles(path.join(dir, e.name), rel ? `${rel}\\${e.name}` : e.name))
      continue
    }
    if (!e.isFile()) continue
    // 🔴 2026-09-27：**档案自己的可执行件也进索引**（`.ps1` / `.mjs` / `.cmd` ——《层与命名》规定它们
    //    长期住在 L3、前缀 `脚本-`）—— 它们也该有一句"这是什么"。二进制（图片/压缩包）不进。
    if (!/\.(md|txt|ps1|mjs|cmd)$/i.test(e.name)) continue
    if (SKIP.test(e.name)) continue
    // 🔴 返回**相对这一层的路径**（`子目录\文件`），不是光文件名 —— 下面还要 `path.join(dir, name)` 去**读**它；
    //    只回 basename 会让读文件扑空、把 33 份正文误报成"缺自述"（2026-09-28 实测正是这么发现的）。
    //    索引表里最终仍只写**文件名**（渲染那一步取 basename）。
    out.push(rel ? `${rel}\\${e.name}` : e.name)
  }
  return out
}

// 🔴 2026-10-14：每层的「文件 → 排序用时间」（只 L3 会填）—— 它同时要**输出到表里**：
//    销账判据（A 方案）读的就是「索引里 L3 那一节第一条的时间」。
const layerTime = new Map()
for (const [layer, note] of LAYERS) {
  const dir = path.join(ROOT, layer)
  if (!fs.existsSync(dir)) {
    missing.push({ layer, file: '(整层读不到)', why: '目录不存在' })
    continue
  }
  let files = collectFiles(dir)
  if (layer.startsWith('L3')) {
    // 🔴 2026-10-14 加：**L3 层按时间排（新的在前）** —— 用户定：「索引大体按层排序，但 **L3 内部按时间排序**」。
    //    时间**优先读文件里的时间标记**（`> 🕐 YYYY-MM-DD HH:MM`，将来到落档口自动写）；
    //    **没有就退回文件的创建时刻**（birthtime）⇒ **存量 L3 不改格式也立刻能用**。
    //    ⚠️ 照《施工手册》「动手三问」③：**不许静默失效** ⇒ 下面自报"三种来源各多少份"。
    let nMark = 0
    let nName = 0
    let nBirth = 0
    let nZero = 0
    const keyed = files.map((f) => {
      const abs = path.join(dir, f)
      let t = 0
      // ① 文件里的时间标记（最准 —— 将来到落档口自动写）
      try {
        const head = fs.readFileSync(abs, 'utf8').slice(0, 800)
        const m = head.match(/^>\s*🕐\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/m)
        if (m) {
          t = Date.parse(`${m[1]}T${m[2] ?? '00:00'}:00+08:00`) || 0
          if (t) nMark++
        }
      } catch {}
      // ② 文件名里的日期 —— 🔴 老文件的 birthtime **不可靠**（实测：9 月那批记录的创建时刻全是 2026-09-28，
      //    那是搬运那天、不是事件那天）⇒ 文件名里的日期比它准。
      if (!t) {
        const fd = f.match(/(20\d{2})-(\d{2})-(\d{2})/)
        if (fd) {
          t = Date.parse(`${fd[1]}-${fd[2]}-${fd[3]}T00:00:00+08:00`) || 0
          if (t) nName++
        }
      }
      // ③ 文件创建时刻（**只能兜底**）
      if (!t) {
        try {
          t = fs.statSync(abs).birthtimeMs || 0
          if (t) nBirth++
        } catch {}
      }
      if (!t) nZero++
      return { f, t }
    })
    keyed.sort((a, b) => b.t - a.t)
    for (const x of keyed) layerTime.set(x.f, x.t)
    files = keyed.map((x) => x.f)
    console.log(`  · ${layer} 按时间排（新在前）：时间标记 ${nMark} 份 · 文件名日期 ${nName} 份 · 退回创建时刻 ${nBirth} 份${nZero ? ` · ⚠️ 取不到 ${nZero} 份` : ''}`)
  } else {
    files.sort((a, b) => a.localeCompare(b, 'zh'))
  }

  for (const name of files) {
    const abs = path.join(dir, name)
    // ⚠️ 索引表里只写**文件名**（`子目录\文件` 取最后一段）—— 路径由地图现算。
    //    判"要不要三行自述"也要看**文件名**（否则 `子目录\_说明-读我.txt` 会被误判成该有自述）。
    const base = name.split('\\').pop()
    const g = introOf(abs)
    if (NEED_INTRO(layer, base)) {
      const lack = []
      if (!g.what) lack.push('🏷 是什么')
      if (!g.when) lack.push('🕐 什么时候用')
      if (lack.length > 0) missing.push({ layer, file: name, why: `缺 ${lack.join(' / ')}` })
    } else if (!g.what) {
      exempt.push({ layer, file: name })
    }
    rows.push({
      layer,
      note,
      name: base,
      what: g.what || firstLineOf(abs) || '（无自述）',
      when: g.when || note,
      t: layerTime.get(name) ?? 0,
    })
  }
}

/**
 * 渲染整份 `索引.md` —— 🔴 **2026-10-20 起：不再自己渲染，直接调 `lib/f8b-index-doc.js`。**
 *
 * 为什么改：本文件原来**自己另写了一份**（`collectFiles` + 主循环 + 这段渲染，约 167 行），
 * 与 `lib/f8b-index-doc.js` 的 `renderIndexDoc()` **逐字重复**；靠注释"两边必须一起改"拴着。
 * 更要命的是**真写走的是织布机**（`weave('索引')` → lib 那份），**干跑预览走的却是本地这份**
 * ⇒ 两份一旦有一点差异，就会出现「干跑说一致、真写却改了」这种没人能解释的事。
 * ⇒ 现在**预览与真写同源**。本地那段主循环只留作"统计与自报"（份数 / 缺自述 / 时间来源）。
 */
function render() {
  return renderIndexDoc(ROOT).text
}

const next = render()
const target = path.join(ROOT, OUT_REL)
const now = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''

console.log(`层：${LAYERS.map(([l]) => l).join(' / ')}`)
console.log(`文件：${rows.length} 份 · 渲染 ${next.split('\n').length} 行 / ${Buffer.byteLength(next, 'utf8')} 字节`)
if (missing.length > 0) {
  console.log(`\n⚠️ **缺自述的 ${missing.length} 份**（索引要它，否则那一格只能写"（缺自述）"）：`)
  for (const m of missing) console.log(`   · ${m.layer}\\${m.file} —— ${m.why}`)
}
if (exempt.length > 0) {
  console.log(
    `\nℹ️ **按规范不用三行自述的 ${exempt.length} 份**（` +
      `L1-必读层 · L2 两张表由表头表达 · 入口类）—— **这不是"缺"**，别去补：`,
  )
  for (const e of exempt) console.log(`   · ${e.layer}\\${e.file}`)
}
// 🔴 2026-10-11 改（治"报不同却不给差异"，我为此白查了 4 轮）：
//    原来只打印一句「与现文件不同」，**连 diffIndexDoc 已经算好的 `same` 都没用上** ⇒
//    看到的人只能自己去 diff 两份 52 行文本。现在**逐行把不同摆出来**（最多 12 行），并直接指出是哪几份文件。
const same = now.trim() === next.trim()
if (same) {
  console.log('\n✅ 与现文件一致（幂等）')
} else {
  const aL = now.split('\n'), bL = next.split('\n')
  const diffs = []
  for (let i = 0; i < Math.max(aL.length, bL.length); i++) if (aL[i] !== bL[i]) diffs.push(i)
  console.log(`\n📝 与现文件不同（line diff：现 ${aL.length} 行 / 新 ${bL.length} 行 · **不同 ${diffs.length} 行**）`)
  for (const i of diffs.slice(0, 12)) {
    console.log(`   L${i + 1}`)
    console.log(`     现：${String(aL[i] ?? '(无)').slice(0, 100)}`)
    console.log(`     新：${String(bL[i] ?? '(无)').slice(0, 100)}`)
  }
  if (diffs.length > 12) console.log(`   …还有 ${diffs.length - 12} 行（用 --out 写出新版本、自己 diff 全文）`)
}

// `--out`：**只算不写档案**（跨馆 / 诊断用；与 `档案结构地图.mjs` 的 `--out` 同名同义）
if (OUT_TO) {
  const dir = path.dirname(OUT_TO)
  if (dir) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(OUT_TO, next, 'utf8')
  console.log(`\n（--out）已把渲染结果写到 ${OUT_TO}（${next.split('\n').length} 行）—— 档案一个字没动`)
  process.exit(0)
}

if (!APPLY) {
  console.log('\n（干跑。要真写：加 --apply）')
  process.exit(0)
}

// 🔴 2026-10-10（织布机收口 · 阶段② 收尾）：**拆掉自带快照** —— 落盘改走织布机
//    （`weave('索引')` ⇒ 走 `改档.mjs` 那扇门 ⇒ 统一用**改档快照**，不再往 `L6` 里堆一份自己的）。
//    ⚠️ 算仍然用本脚本刚算出来的 `next`（与织布机同一个来源 `lib/f8b-index-doc.js`），
//       所以"干跑看到的差异"与"真织的结果"是同一件事。
const { weave } = await import('../lib/loom.js')
const r = await weave('索引', [{}], { commit: true })
console.log(String(r?.text ?? '').trim())
process.exit(String(r?.text ?? '').includes('【已织完】') ? 0 : 1)
