#!/usr/bin/env node
/**
 * 档案结构地图.mjs —— 生成 `L1-必读\地图-档案结构（机器生成）.md`
 *
 * 为什么要它（用户 2026-09-16 深夜原话）：
 *   "**日志、梅莫莉亚，需要一份树状图。制作一份一一对应的"地图"……否则现在只能层层跳转无法总览全局，
 *    你始终会顾此失彼。尤其是在建造档案和梅莫莉亚这件事上。这也是我一直要求的，模块化**"
 *
 * 设计（为什么**不手写**）：
 *   · **结构 = 现算**：走一遍文件系统（哪几层、哪些文件、多少行/字节）
 *   · **职责 = 现取**：从 `L1-必读\索引.md` 那张表里取（它是"哪个文件讲什么"的权威）
 *   · **两下一对**：对不上的当场列出来 —— 这就是"**索引漏了哪几行 / 索引指向不存在的文件**"
 *     （四路审查点名的最该自动化的一条：索引那份文件清单被两道检查同时排除，漏了 5 行没人管）
 *   · **梅莫莉亚 ↔ 档案 的对应**：这一段是**唯一手写**的部分（判断类，不可派生），就写在下面 CORRESPONDENCE 里，
 *     保证"只有这一处"，不会四处漂。
 *
 * 姿态照 `时间轴加年份.mjs`：**默认干跑** · 写前**快照** · 写完**读回对账** · 幂等（可反复跑）。
 *
 * 用法：
 *   node 档案结构地图.mjs            # 干跑（打印将要写的内容 + 差异）
 *   node 档案结构地图.mjs --apply    # 真写
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 🔴 2026-10-16：默认根改走 `activeArchiveDir()`（活跃馆解析的唯一来源：`GAI_DANG_ROOT` →
//    馆表的 `active` → 老兜底）。原来写死 `|| 'C:\\Users\\admin\\Desktop\\DeepSeek档案'`：
//    换馆后直接跑本脚本会去算**旧馆**的结构（"脚本不跟随活跃馆"那一族）。
import { activeArchiveDir } from '../lib/common.js'

// 档案根目录：⚠️ 一律走环境变量 `GAI_DANG_ROOT`（与插件、写入内核同一个口径）；
// 没给才由 `activeArchiveDir()` 定 —— 它第一件事也是看 `GAI_DANG_ROOT`。
const ROOT = path.resolve(activeArchiveDir())
const OUT_REL = 'L1-必读\\地图-档案结构（机器生成）.md'
// 🔴 2026-10-10：`SNAP_DIR`（本脚本自带的快照目录）**已拆** —— 落盘改走织布机 ⇒ 统一用**改档快照**。
const APPLY = process.argv.includes('--apply')
// 🔴 2026-10-10 加（织布机收口 · 阶段②）：`--out <文件>` ＝ **只算不写档案**，把渲染结果写到那个文件。
//    给织布机用：它要拿"生成器算出来的那一份"去跟现文件比对（生成器本身仍照旧跑干跑/--apply）。
const outFlagIdx = process.argv.indexOf('--out')
const OUT_TO = outFlagIdx > -1 ? process.argv[outFlagIdx + 1] : null

/** 每层一句话（写不出的留空）。⚠️ 这是**说明**，不是层清单 —— 清单现算，见下。 */
const LAYER_NOTES = {
  'L1-必读': '每次接手先读的几份短文件（读序写在 `从这开始读.txt`）',
  'L2-数据': '两份数据：按时间（时间轴）、按事件（事件表）',
  'L3-知识': '已经知道的事（事故 / 记录 / 参考 / 指南 / 清单 / 经验 / 总账）',
  'L4-施工': '还没做完的事：讨论稿 / 待办 / 工程（接手先读 `L4-施工\\工程-总览.md`）',
  'L5-证据': '原始证据与备份（脚本 / 日志 / CSV / 目录树）',
  'L6-工具临时': '干活时产生的临时文件（快照 / 清单 / 日志）',
  'L8-施工归档': '已完成 / 已废弃的施工文件',
}

/**
 * 🔴 **层清单（现算）** —— 与 `lib/f17-map.js` 的 `layersOf()` 同一套口径。
 * 为什么现算：写死的话，加一层要改**两处**（这里 ＋ 插件里那份），必然漂 ——
 * 2026-09-26 加 `L4-施工` 就是这么撞上的（档案里有、地图上不显示）。
 */
const LAYERS = (() => {
  try {
    return fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^L\d+-/.test(e.name)) // 口径-已确认：这里要**所有**层（同 `lib/f17-map.js` 那份；与"引用去路径/引用改写"形似意不同）
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
})()

/**
 * ⚠️ **本文件唯一手写的部分**：梅莫莉亚 ↔ 档案 的一一对应。
 * 理由：这是**判断**（谁管哪一块），派生不出来；放在这一处，就不再四处漂。
 */
const CORRESPONDENCE = [
  ['在岗标记（F1）', '每轮在开头报一句「梅莫莉亚在岗 ＋ 时间」', '只读'],
  ['作废哨兵（F2）', '扫 L1~L3 的"已作废/撤销/推翻"条款', '只读'],
  ['读档案（`dangan_search`）', '两种读法：**`mode="search"`** 全档关键词检索（回 文件:行号 + T/E 锚点）· **`mode="recent"`** 按总览规矩取"该读的那几行"（末尾 20 条 + 补到累计 3 条 ❗ —— 原 R1「读法」，2026-09-18 工具合并并进来）', '只读'],
  ['查档案（`dangan_check`）', '一个工具四种 scope：**`all`**（默认）机械体检（时间轴编号/等级 · 事件表正文与顶部目录对齐 · 锚点与死指针 · 引用文件）· **`index`** 事件表**顶部那份目录**（从正文派生 + 逐字段比对；原 F8）· **`overview`**《00-总览》那一页（原 F24）· **`map`** 档案结构地图（原 F21）', '只读（只有 `scope="map"` ＋ `mode="apply"` 会真写那份地图）'],
  ['落档（`dangan_log`）', '算下一个 T/E 号 · 按 W5 摆出该落哪几处 · 拟好文本；**给 `commit:true` 就真落笔**（时间轴那一行 ＋ 事件条目 ＋ 顶部目录那一行）', '⚠️ **只有 `commit:true` 时才写档案**'],
  ['落档闸门（F7）', '收工那刻**逐道**算 **G2 对不对得上 / G5 警示强制**（判据只在 `lib/f7-gate.js` 顶部的「闸门定义表」里定义一次），没过把回合拽回来', '只读（只写自己的日志）'],
  ['**落笔半（F9 · 2026-09-17 建成）**', '把算好的改动交给 `改档.mjs --txn` 去写 —— **先快照 · 写前后各体检一次 · 只有"新出现的机械错"才自动回滚**', '⚠️ **唯一被允许写档案的零件**（它自己不写，只调门：内核不在就一个字都不写）'],
]

/**
 * 模型**看得到的 6 个工具** ↔ 它背后的能力模块。
 * 用户 2026-09-18 原话："**梅莫莉亚的工具不再每轮报给我、进入她的档案馆内部、仅在地图旁备注**" ——
 * 于是工具的对照落在这里，不再散在每轮的注入/面板里。
 * ⚠️ 与 CORRESPONDENCE 同性质：**是判断，派生不出来**（工具名在 `lib/tools.js`，
 * 但"它背后是哪几个内核"要人判）→ 加/改工具时**回来同步这一处**（施工手册"加一个新功能的固定六步"）。
 */
const TOOL_MAP = [
  ['**`dangan_search`**', 'F4（并 R1）', '`lib/tools.js`', '全档关键词检索（回 `文件:行号` ＋ T/E 锚点）· 读"最近在干什么"（末尾 20 条 ＋ 补到累计 3 条 ❗）'],
  ['**`dangan_check`**', 'F5（并 F8 / F21 / F24）', '`lib/f5-check.js` ＋ `lib/f8-index.js` · `lib/f17-map.js` · `lib/f24-overview.js`', '一次查完全档机械毛病（四种 scope：`all` · `index` · `overview` · `map`）＋ 口径巡检 F25'],
  ['**`dangan_log`**', 'F6 ＋ F9', '`lib/tools.js` ＋ `lib/f9-commit.js`', '算下一个 T/E 号 · 摆出"该落哪几处" · 拟好文本；`commit:true` 时走唯一的门真落笔'],
  ['**`dangan_status`**', 'F15', '`lib/f15-status.js`', '一屏看"现在什么状态"：在跑吗（版本＋指纹）· 体检 · 闸门 · 各能力这一程动过几次 · 哨兵 · 预算 · 待办'],
  ['**`dangan_todo`**', 'F10', '`lib/f10-todo.js`', '列"还有什么要留意"（`list`）· 挑"该消的"（`check`）· 移出归档（`clean`，默认干跑）'],
  ['**`dangan_init`**', 'F20', '`lib/f20-init.js`', '从 0 建档案骨架（**只补缺、绝不覆盖**；默认干跑，`apply:true` 才写）'],
]

const say = (s) => console.log(s)

// ---------- 走文件系统 ----------
function walkRel(rel, out = []) {
  const dir = path.join(ROOT, rel)
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const r = `${rel}\\${e.name}`
    if (e.isDirectory()) walkRel(r, out)
    else out.push(r)
  }
  return out
}

const SKIP = ['\\L6-工具临时\\', '\\L5-证据\\'] // 明细进"附录"，不塞进地图正文
const all = walkRel('').map((x) => x.replace(/^\\/, ''))

function statOf(rel) {
  try {
    const abs = path.join(ROOT, rel)
    const st = fs.statSync(abs)
    let lines = null
    if (/\.(md|txt)$/i.test(rel)) {
      try {
        lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/).length
      } catch {
        /* 读不到就算了 */
      }
    }
    return { lines, bytes: st.size }
  } catch {
    return { lines: null, bytes: 0 }
  }
}

// ---------- 从索引取"职责" ----------
const idxRel = all.find((f) => f === 'L1-必读\\索引.md')
let idxText = ''
try {
  idxText = fs.readFileSync(path.join(ROOT, idxRel), 'utf8')
} catch {
  /* 索引读不到 → 后面会报 */
}
// 🔴 2026-09-27：索引的**解析**与**范围**判据**只留一份** —— `lib/idx-scope.js`。
//    这份脚本原来自带一份副本（与 `lib/f17-map.js`、`lib/f5-check.js` 三份），当天索引改成
//    "两栏 ＋ 光文件名"时**三份各坏一处**、全都一声不吭。⇒ 收成一份，这里 import。
import { SHOULD_REG, baseOf, parseIndexRows } from '../lib/idx-scope.js'

/** 职责：索引表里"这份是什么"那一格（`duty` 的键＝带层的与光文件名的都存一份）。 */
const duty = new Map([...parseIndexRows(idxText)].map(([k, v]) => [k, v.what]))
/** 某个"层\文件"在索引里登记过没有 —— 两种写法都认。 */
const registered = (f) => duty.has(f) || duty.has(baseOf(f))

// ---------- 生成地图 ----------
const L = []
L.push('# 地图 · 档案结构（**机器生成，别手改**）')
L.push('')
L.push('> 生成方式：结构**现算**（走文件系统）＋ 职责**现取**（从 `L1-必读/索引.md` 那张表现取）。')
L.push('> 所以：**索引漏登记了哪个文件 / 索引指向了不存在的文件，下面第二节会当场列出来**（不用人去比对）。')
L.push('> 要改这份地图，**改内容来源**（加文件 → 登记进索引），不要手改本文件。')
L.push('')

const ledger = []
let totalLines = 0
let totalFiles = 0

for (const [layer, desc] of LAYERS) {
  const files = all.filter((f) => f.startsWith(`${layer}\\`) && !f.slice(layer.length + 1).includes('\\'))
  const subdirs = [
    ...new Set(
      all
        .filter((f) => f.startsWith(`${layer}\\`) && f.slice(layer.length + 1).includes('\\'))
        .map((f) => f.slice(layer.length + 1).split('\\')[0])
    ),
  ]
  const detail = all.filter((f) => f.startsWith(`${layer}\\`)).length
  L.push(`## ${layer}${layer === 'L6-工具临时' ? '（含子目录）' : ''}　—　${desc}`)
  L.push('')
  if (files.length === 0 && subdirs.length === 0) L.push('（空）')
  else {
    L.push('```text')
    files.sort().forEach((f, i) => {
      const { lines, bytes } = statOf(f)
      const last = i === files.length - 1 && subdirs.length === 0
      const branch = last ? '└─' : '├─'
      const name = f.slice(layer.length + 1)
      // 🔴 2026-10-11 用户定：「**那就不显示行了吧**」—— 每份文件后面**不再写 `(N 行)`**，
      //    一律给体积（`2 KB` / `15 KB`）：行数既不代表分量，也容易把"表格长"误读成"这份重"。
      const size = bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`
      totalFiles += 1
      if (lines !== null) totalLines += lines
      const reg = registered(f) || !/^L[123]-/.test(f) || !SHOULD_REG(f) ? '' : '　⚠️**索引未登记**'
      L.push(`${branch} ${name}　(${size})${reg}`)
      ledger.push({ f, size, reg: duty.has(f) })
    })
    subdirs.sort().forEach((d, i) => {
      const n = all.filter((x) => x.startsWith(`${layer}\\${d}\\`)).length
      const branch = i === subdirs.length - 1 ? '└─' : '├─'
      L.push(`${branch} ${d}\\　（${n} 个文件，此处不展开）`)
    })
    L.push('```')
  }
  L.push('')
  // ⚠️ 只有 L1/L2/L3 **该**被索引逐文件登记；L4 证据层与 L9 临时层不登记，别对它们喊"漏登记"
  const un = /^L[123]-/.test(layer) ? files.filter((f) => !registered(f) && SHOULD_REG(f)).length : 0
  L.push(`> ${layer}：**${files.length} 份**在根下，另有 ${subdirs.length} 个子目录、共 ${detail} 个文件。${un > 0 ? ` ⚠️ **其中 ${un} 份没在索引里登记**` : /^L[123]-/.test(layer) ? '（都已登记）' : '（这层按规矩不逐文件登记）'}`)
  L.push('')
}

// ---------- 一一对应 ----------
L.push('---')
L.push('')
L.push('## 梅莫莉亚 ↔ 档案：一一对应')
L.push('')
L.push('| 梅莫莉亚的部件 | 它管档案的哪一块 | 对档案的权限 |')
L.push('|---|---|---|')
for (const [a, b, c] of CORRESPONDENCE) L.push(`| ${a} | ${b} | ${c} |`)
L.push('')
L.push('> ⚠️ **这张表是这份地图里唯一手写的部分**（"谁管哪块"是判断，派生不出来）；改它只在这一处改。')
L.push('')
L.push('## 模型看得到的工具 ↔ 能力模块')
L.push('')
L.push('| 工具 | 能力 | 实现 / 判定内核 | 一句话 |')
L.push('|---|---|---|---|')
for (const [t, cap, mod, what] of TOOL_MAP) L.push(`| ${t} | ${cap} | ${mod} | ${what} |`)
L.push('')
L.push('> 这 6 个是**模型实际能调**的工具（运行数据目录里 `memoria.log` 的"工具已注册"逐条对得上）。')
L.push('> ⚠️ 表里的"内核"也是**手写判断**（工具名在 `lib/tools.js`，但"背后是哪几个内核"派生不出来）—— 加/改工具时回来同步这一处。')
L.push('')

// ---------- 能力一览（**从 lib/manifest.js 现算**） ----------
// 用户 2026-09-18："**现在我们梅莫莉亚的各种自动化越来越多……我觉得需要讲这些东西也规整起来。不要散乱一团。**"
// 所以这张图不只画"档案长什么样"，也画"**她身上现在有哪些自动化、各自什么时候跑、有没有自检**"。
// ⚠️ 这张表**不手写**：从 `lib/manifest.js` 现取（加能力只需在 manifest 加一行，这里自动出现）。
//    路径用 `import.meta.url` 自己定位 —— **跟着插件包走**，换机器也对。
const KIND_WHEN = {
  hook: '事件驱动（会话事件）',
  guard: '拦截（工具调用前后把它拦住）',
  sensor: '启动自检 ＋ 体检/注入时',
  tool: '我调它的时候',
}
let CAPS = []
let ROOMS = []
try {
  const libDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib')
  const mod = await import(pathToFileURL(path.join(libDir, 'manifest.js')).href)
  CAPS = mod.CAPS ?? []
  ROOMS = mod.ROOMS ?? []
} catch (e) {
  L.push('## 能力一览（**从 `lib/manifest.js` 现算**）')
  L.push('')
  L.push(`> ⚠️ **读不到 manifest**（${e && e.message ? e.message : e}）—— 这张表这一次是空的，**不代表她没有能力**。`)
  L.push('')
}
if (CAPS.length > 0) {
  L.push('## 能力一览（**从 `lib/manifest.js` 现算**）')
  L.push('')
  L.push('| 代号 | 能力 | 类型 | 什么时候跑 | 自报工作量 | 分室 |')
  L.push('|---|---|---|---|---|---|')
  const roomOf = (id) => (ROOMS.find(([, ids]) => ids.includes(id)) ?? ['—'])[0]
  for (const c of CAPS) {
    const merged = c.mergedInto ? `（工具面并入 ${c.mergedInto}）` : ''
    L.push(`| **${c.id}** | ${c.title}${merged} | ${c.kind} | ${KIND_WHEN[c.kind] ?? '—'} | ${c.selfCheck ? '✅' : '—'} | ${roomOf(c.id)} |`)
  }
  L.push('')
  L.push(`> 共 **${CAPS.length}** 个能力。⚠️ 整张表**从 manifest 现算**；加能力只要在 manifest 加一行，这里自动出现。`)
  L.push('')
}

// ---------- 对账 ----------
// ⚠️ 只比"索引本来就该管的那几层"（L1/L2/L3）—— L4 证据层与 L9 临时层**不该**被索引逐文件登记，
// 把它们算进来会虚报几百个"漏登记"（第一版就这样，干跑时当场发现）。
// ⚠️ 2026-09-17 再加一条口径：**只比各层根下的文件，子目录里的不逐文件登记**（`f.split('\\').length === 2`）。
//    理由与 L4/L9 同例 —— 子目录装的是实现件副本（`本机实现件备份\` 与它下面的 `动盘脚本\`）、
//    历史快照（`会话上下文备份\` 等）、样本与备份；它们各自的目录说明写在同目录 `_说明-读我.txt` 里，
//    而**结构树里已经报了每个子目录的文件数**（不藏东西）。否则"漏登记 16 个"里有 9 个是备份副本，
//    会逼着人去登记"另一份 move-verify.ps1"，纯属自找同步点。
// 🔴 **2026-09-28 改：含子目录**（原末尾还有 `&& f.split('\\').length === 2`）—— L3 已分 9 个子目录、
//    **那些就是正文**；只算层根下会让"漏登记"**查不到子目录里的文件**（索引生成器那边已改成递归登记，两边必须同口径）。
//    ⚠️ 同一口径的三处：**这里** · `lib/f17-map.js` 的 `covered` · `tools/档案索引.mjs` 的 `collectFiles`。
const COVERED = (f) => /^L[123]-/.test(f) && !f.includes('\\L9-') && !f.includes('\\L4-')
const actual = all.filter(COVERED)
// 🔴 2026-09-27：**光文件名与"层\文件"两种写法都要认** —— 索引现在只写文件名（重名才带层）。
//    只按带层的算，会把整层误报成"漏登记"（今天真发生过：L1 八份全报未登记）。
//    ⚠️ 这段与 `lib/f17-map.js` 那份是**同一判据的两份副本**（副本病）：改一处要改两处。
// 🔴 **2026-09-28 修（存在性判断要扫子目录）**：L3 已在 T714 分进 9 个子目录（事故 / 参考 / 记录 / …），
//    而那些**就是正文**（不再是 2026-09-17 立下面这条时说的"副本 / 快照 / 样本"）⇒ 只在层根下找 basename，
//    会把 35 份正文误报成"索引指向但实际不存在"（**地图上真发生了**）。
//    ⚠️ **只改存在性这一路**（`allNames`）；"漏登记"用的 `actual` 仍按老口径（层根下）算 —— 免得两套统计一起动。
//    ⚠️ 本段与 `lib/f17-map.js` 那份是**同一判据的两份副本**（副本病）：改一处要改两处。
const allNames = new Set(all.map(baseOf))
const hitOf = (k) => (COVERED(k) ? (actual.includes(k) ? k : '') : allNames.has(baseOf(k)) ? k : '')
const idxPaths = [...new Set([...duty.keys()].map(hitOf).filter(Boolean))]
const missingInIdx = actual.filter((f) => !registered(f) && SHOULD_REG(f))
// ⚠️ `duty` 里同一份可能存了两个键（带层的 ＋ 光文件名的）—— 死指针按 basename 去重，别数两遍。
const deadInIdx = [...duty.keys()]
  .filter((k) => !hitOf(k) && (COVERED(k) || !k.includes('\\')))
  .filter((k, i, arr) => arr.findIndex((x) => baseOf(x) === baseOf(k)) === i)

L.push('## 对账（机器算的，不用人比对）')
L.push('')
L.push(`- 实际文件（**L1/L2/L3** —— 索引本来就该管的三层）：**${actual.length} 个**`)
L.push(`- 索引里登记了：**${idxPaths.length} 条**`)
if (missingInIdx.length > 0) {
  L.push(`- ⚠️ **索引漏登记的（${missingInIdx.length} 个）**：`)
  for (const f of missingInIdx.slice(0, 40)) L.push(`  - \`${f}\``)
  if (missingInIdx.length > 40) L.push(`  - …还有 ${missingInIdx.length - 40} 个`)
} else L.push('- ✅ 没有漏登记的')
if (deadInIdx.length > 0) {
  L.push(`- ⚠️ **索引指向但实际不存在的（${deadInIdx.length} 条）**：`)
  for (const f of deadInIdx.slice(0, 30)) L.push(`  - \`${f}\``)
} else L.push('- ✅ 没有指向不存在文件的')
L.push('')
L.push(`> L1~L9 正文文件共 **${totalFiles} 个**（不含子目录内），其中 md/txt **${totalLines} 行**。`)
L.push('')

const out = L.join('\n')
// 🔴 2026-10-10：`outAbs` 那行删了 —— 落盘改走织布机（`weave('地图')`），本脚本不再自己写档案。

// ---------- 干跑 ----------
if (OUT_TO) {                                   // 织布机模式：只算不写档案
  const dir = path.dirname(OUT_TO)
  if (dir) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(OUT_TO, out, 'utf8')
  say(`（--out）已把渲染结果写到 ${OUT_TO}（${out.split('\n').length} 行）—— 档案一个字没动`)
  process.exit(0)
}
say(`将写入：${OUT_REL}`)
say(`  层：${LAYERS.length} · 根下文件 ${totalFiles} 个 · 索引漏登记 ${missingInIdx.length} 个 · 索引死指针 ${deadInIdx.length} 条`)
if (!APPLY) {
  say('')
  say(out.split('\n').slice(0, 40).join('\n'))
  say('…（干跑：一个字都没写。要真写，加 --apply）')
  process.exit(0)
}

// 🔴 2026-10-10（织布机收口 · 阶段② 收尾）：**拆掉自带快照** —— 落盘改走织布机
//    （`weave('地图')` ⇒ 走 `改档.mjs` 那扇门 ⇒ 统一用**改档快照**）。
//    ⚠️ 织布机的「地图」纹样会 spawn 本脚本的 `--out`（那一条**只算不写**、在 APPLY 之前就退出）
//       ⇒ 不会转圈。
const { weave } = await import('../lib/loom.js')
const r = await weave('地图', [{}], { commit: true })
say(String(r?.text ?? '').trim())
process.exit(String(r?.text ?? '').includes('【已织完】') ? 0 : 1)
