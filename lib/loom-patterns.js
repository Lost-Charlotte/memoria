// ============================================================
// F36 · 织布机 · **纹样册**（＝格式端口的机器读口）
// ============================================================
//
// 它是什么：把《工程-各类文件格式》§二「类目录」里"每一类文档长什么样、落哪层、一梭有哪些字段"
//   变成代码能读的**一张表**。⚠️ **它不是第二份格式规范** —— 人看的那份仍是档案里的 md
//   （用户 2026-10-03 定案②：格式定义先在 `L4-施工\统一度量衡\`，全部装载完成后放 `L3`）。
//
// 🔴 三条硬规矩（缺一条它就从"读口"变成"第二条路"）：
//   · **新增格式 ⇒ 先经用户允许**（讨论稿 §二 第二层原话："只准选、不准自己改"）——
//     代码里的表现是"表里没有 ⇒ 拒 ＋ 让调用方去问用户"，**绝不允许顺手加一种**；
//   · **字段名的唯一来源是现有入口** —— 事件表＝`tools.js` 的 `danganLogTool.parameters`、
//     待办＝`f10-todo.js` 的 `planTodoAdd`；本表那份由 `tests/f36-loom.mjs` 断言"每个字段都真存在"钉住；
//   · **"怎么织"的判据一个字都不许搬进来** —— 摆落点归 `loom-commit.js`（原 `f9-commit.js` 已收进织布机），
//     待办落哪一节归 `f10-todo.js`。本文件只回答"这一类长什么样 / 有哪些字段 / 谁能新建这个动作"。
//
// ⚠️ **本文件不 import `tools.js`**（会成环：`tools.js` 要 import `loom.js`）。字段表靠测试对齐。

// 🔴 2026-10-15：**改指 `loom-commit.js`** —— "摆落点"那一层从 `f9-commit.js` 搬进织布机了
//    （织布机收口第 2 条）。原来这里从 f9 借它，是"f9 ↔ 织布机两边互相借"那个环的一半。
import { planCommit } from './loom-commit.js'
// 🔴 2026-10-20 接回：**落档前提醒"引了用户原话却没标出处锚"**（F27 / 《记错本》R28 那一族）。
//    它原来挂在已删的 `f6-log.js`（落档提案）里，跟着一起成了孤儿（全仓零调用）——
//    接在织布机这一梭上：**只提醒、不拒写**（拒写会毁掉整次事务；事后还有 F27 哨兵核）。
import { citeAnchorWarn } from './commit-ops.js'
import { planTodoAdd } from './f10-todo.js'
// 🔴 2026-10-15：`f8-index.js` 的 import 删除 —— 那两个函数（`renderIndexTable` / `diffIndexTable`）
//    在这里**一个都没有被调用**（只剩注释里提到名字）；「索引」纹样走的是 `f8b-index-doc.js` 那条路。
import { diffIndexDoc, OUT_REL as INDEX_REL } from './f8b-index-doc.js'
import { findByName, readTextSafe, CFG, stripExt, DSH_HOME } from './common.js'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'

/**
 * 一梭（＝一条内容）的字段表 —— **只列"内容字段"**，不列调度用的开关。
 *
 * ⚠️ 有意排除的三类（都不是"线"，是"怎么织"）：
 *   · `commit` —— 由织布机的 `opts.commit` 管（跟 `dangan_log` 一样：默认只出提案）；
 *   · `keepOpen` / `blockedBy` —— 那是 `dangan_log` 的「事件收尾回话口」，**只写 `~/.dsh`、不落档**，
 *     不属于"写入文档"这件事（织布机管的是文档）；
 *   · `todo*` —— 那是事件表纹样里"顺手写一条待办"的配套，归**待办纹样**自己那一路
 *     （那边用 `planTodoAdd` 的参数名：`item` / `why` / `goal` / `term` / `owner` / `force`）。
 */
export const EVENT_FIELDS = [
  'what',
  'level',
  'kind',
  'when',
  'event',
  'title',
  'why',
  'did',
  'result',
  'status',
  'ref',
  'model',
  'whyNew',
  // 🔴 2026-10-12（阶段⑥ 换门面 · 走 B）：这三个是 `dangan_log` 一直在用的字段，原来漏在字段表外 ⇒
  //    走织布机时会被判 `unknown-field`，而落笔链上 `planCommit` 的三道闸（>150 字要 detailIn ·
  //    「做了什么」到 3 条要 whyMany ＋ detailIn · `what` 像过程要 whyNotStep）**没有出口**。
  'detailIn',
  'whyMany',
  'whyNotStep',
  '归账完成',
  // 🔴 2026-10-12（阶段⑥ 换门面 · 走 B）**第二批补进来的**：`dangan_log` 的 `kind:'待办'` 那一条路
  //    —— `planCommit()` 会拿这几个键**顺手多算一条"写进待办文件"的 op**（见 `f9-commit.js`
  //    里 `p.data.kind === '待办'` 那一支）。原来它们漏在字段表外 ⇒ 走织布机时会被判
  //    `unknown-field` 整梭拒收；而**只放行前三个**又会把 `todoItem/why/goal` 静默丢掉
  //    ⇒ 实测落进去的是"**（待补：原因）（待补：目的）**"占位符（`tests/f10-todo.mjs` 抓到的）。
  //    ⚠️ 它们**不是事件表自己的内容字段**，是"同一梭顺手要落的另一处" —— 与 `归账完成` 同一类。
  //    ⚠️ 表义的唯一来源仍是 `tools.js` 的 `danganLogTool.parameters`（本表只是它的机器读口）。
  'todoItem',
  'todoWhy',
  'todoGoal',
  'todoTerm',
  'todoOwner',
  'todoForce',
]

export const TODO_FIELDS = ['item', 'why', 'goal', 'term', 'owner', 'force']

// 🔴 2026-10-15（织布机收口第 2 条）：**「记录」纹样的字段表** —— 即 `planCommit()` 认的那些键。
//    ⚠️ `validateItem()` 只认这张表：**多一个键就整梭拒收**（`unknown-field`）⇒ 所以它必须列全。
//    怎么定的：从 `lib/loom-commit.js` 的 `planCommit()` 里把 `a.xxx` / `a['xxx']` 全抓出来
//    （`candidates`/`continuation`/`nextT`/`timelineLine` 是**它自己算出来的**、不是入参，故不列）。
//    📌 **调度开关**（`commit` 等）不进这张表 —— 它们由 `tools.js` 那层消化，不到纹样里来。
export const LOG_FIELDS = [
  'what',
  'level',
  'why',
  'did',
  'result',
  'event',
  'title',
  'detailIn',
  'kind',
  'status',
  'ref',
  'model',
  'when',
  'whyNew',
  'whyMany',
  'whyNotStep',
  'todoItem',
  'todoWhy',
  'todoGoal',
  'todoTerm',
  'todoOwner',
  'todoForce',
  '归账完成',
]

/**
 * 「引用族」三个工具的**共用组装件**：调脚本（带 `MEMORIA_TXN_OUT` ⇒ 它只出事务）→ 读那份事务 →
 * 交给织布机**统一落盘**。**算一个字没搬**（仍在原脚本里），落盘从此只有一条路。
 * 🔴 2026-10-10 抽（阶段⑤）：`引用改写` / `引用去路径` / `行号加固` 三个同构 —— 别各写一份。
 */
function citeToolDoc(script, label, argv) {
  const tmp = path.join(tmpdir(), `memoria-cite-${process.pid}-${Date.now()}.json`)
  const r = spawnSync(process.execPath, [script, ...argv], {
    cwd: path.join(DSH_HOME, 'plugins', 'dsh-memoria', 'tools'),
    env: { ...process.env, GAI_DANG_ROOT: CFG.archiveDir, MEMORIA_TXN_OUT: tmp },
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    const t = new Error(`${label} 退出码 ${r.status} —— ${String(r.stderr || r.stdout || '').slice(0, 300)}`)
    t.kind = 'rejected-by-planner'
    throw t
  }
  let txn = { ops: [] }
  try { txn = JSON.parse(fs.readFileSync(tmp, 'utf8').replace(/^\uFEFF/, '')) } catch { /* 下面会报"一条都没有" */ }
  try { fs.rmSync(tmp, { force: true }) } catch { /* 清不掉就算了 */ }
  const ops = Array.isArray(txn?.ops) ? txn.ops : []
  if (ops.length === 0) {
    const t = new Error(`${label}：按现在的档案算下来**一处要改的都没有**。`)
    t.kind = 'rejected-by-planner'
    throw t
  }
  const files = [...new Set(ops.map((o) => o.file))]
  return { ops, files, summary: [`${label}：${ops.length} 处 / ${files.length} 份文件`], note: `织布机：${label}（${ops.length} 处）` }
}

/**
 * **整份重织**：把一份文件的现行行换成 `newLines`。
 *
 * 🔴 **2026-10-11 重写**（真账：那份《地图》"旧快照"永久黄、每次启动白跑 2 遍重出）：
 *    旧版有三个洞，凑在一起就**永远收敛不了**：
 *      ① 新内容是**空行**时 `continue` 跳过 ⇒ **旧行永远删不掉**（实测 23 处就这样活了一个月）；
 *      ② 尾部多出来的旧行，删除**没倒序**（删一行就换一次行号）⇒ 第 2 条 op 的 `expect` 对不上；
 *      ③ 挂在同一行的多条 `insertAfter` **没倒序** ⇒ 落出来是反的（实测构造用例：c、d 变 d、c）。
 *    ⇒ 现在**逐行倒着生成**（删/换/插都在虚拟行号上做，倒序执行时前面的行号天然不动），
 *      并且**空行也参与比较** —— 需要"删一行"时用 `replace` 成空行；需要"填空行"时删掉旧行。
 *    ⚠️ 判据不变：`replace` / `insertAfter` 都不收空 `text`（见下面每一处的注释）。
 */
export function rebuildOps(relOut, lines, newLines) {
  const A = [...lines]
  const B = [...newLines]
  if (A.length && A[A.length - 1] === '') A.pop()
  if (B.length && B[B.length - 1] === '') B.pop()
  const N = A.length
  const M = B.length
  const ops = []
  if (N === 0) {
    // 旧文件是空的（或本轮才建）⇒ 只能用 `append` 逐行长出来
    let prev = ''
    for (const want of B) {
      if (want === '') continue
      ops.push({ op: 'append', file: relOut, text: want, expectLast: prev })
      prev = want
    }
    return ops
  }
  const common = Math.min(N, M)
  // ① 重叠区：**倒着**逐行比（j 是虚拟行号 —— 倒序执行时它上面那些行的行号不动）
  for (let j = common - 1; j >= 0; j--) {
    const a = A[j]
    const b = B[j]
    if (a === b) continue
    if (b === '') {
      // 新内容这里是空行、旧的有内容 ⇒ **把那一行清成空行**（不删行！）。
      // 🔴 2026-10-11 血账：这里曾经发 `deleteLine` —— 行被删掉、后面整段**上移 23 行**，
      //    那份《地图》当场被织坏（靠生成器输出整份重写才救回来）。
      //    语义要对：目标是"这一行变成空行"，**不是"这一行消失"**。
      // ⚠️ 空 `text` 本来被 `f9-commit.js` 的 `auditOps` 拒收（防 09-16「清空 9 行」那类事故）——
      //    所以带 `allowEmpty: true` 显式声明"这是有意的空行"，由审计放行这一种。
      ops.push({ op: 'replace', file: relOut, line: j + 1, text: '', expect: a, allowEmpty: true })
    } else if (a === '') {
      // 旧的是空行、新的有内容 ⇒ 一样用 `replace`（不能 insertAfter 一个空行参照）
      ops.push({ op: 'replace', file: relOut, line: j + 1, text: b, expect: a })
    } else {
      ops.push({ op: 'replace', file: relOut, line: j + 1, text: b, expect: a })
    }
  }
  // ② 新的更长：多出来的行**倒着插在共同段末尾之后**（倒序 ⇒ 落出来才是顺的）
  for (let j = M - 1; j >= common; j--) {
    const want = B[j]
    if (want === '') continue
    ops.push({ op: 'insertAfter', file: relOut, line: common, text: want, expect: common > 0 ? A[common - 1] : '' })
  }
  // ③ 旧的更长：尾部多出来的行**倒着删**（删一行就换一次行号 ⇒ 正序删第 2 条 expect 必对不上）
  for (let j = N - 1; j >= common; j--) {
    ops.push({ op: 'deleteLine', file: relOut, line: j + 1, expect: A[j] })
  }
  return ops
}

/**
 * **新建一份 L3 文档**（阶段④ · 用户 2026-10-10 拍板"新建文档让织布机取代"）。
 * 🔴 H1 与开头三行自述**由织布机补**（这样"每份文件都有自述"这件事不再靠我记）；
 *    我只需给"主题 / 是什么 / 什么时候用 / 正文"。正文里**空行请写 `\n\n`**（真换行会被 auditOps 拒）。
 * 命名照《工程-各类文件格式》：`<前缀><主题>.md`，不带日期。
 */
function newArchiveDoc(dirRel, prefix, item) {
  const topic = String(item.主题 ?? '').trim()
  const what = String(item.what ?? '').trim()
  const when = String(item.when ?? '').trim()
  const body = String(item.body ?? '').trim()
  if (!topic) { const t = new Error('新建文档要给 `主题`（文件名＝前缀＋主题）。'); t.kind = 'missing-field'; throw t }
  if (/[|\\/]/.test(topic)) { const t = new Error('`主题` 里不能有竖线或路径分隔符。'); t.kind = 'bad-char'; throw t }
  const lines = []
  lines.push('# ' + prefix.replace(/-$/, '：') + topic)
  lines.push('')
  lines.push('> 🏷 **这份是什么**：' + what)
  lines.push('> 🕐 **什么时候用**：' + when)
  lines.push('> ✍️ **谁写的 / 什么时候**：梅莫莉亚（织布机新建）。')
  lines.push('---')
  lines.push('')
  for (const seg of body.split('\n\n')) {
    for (const l of seg.split('\n')) lines.push(l)
    lines.push('')
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const file = dirRel + '\\' + prefix + topic + '.md'
  const abs = path.join(CFG.archiveDir, file)
  if (fs.existsSync(abs)) {
    const oldLines = fs.readFileSync(abs, 'utf8').split(/\r?\n/)
    // 🔴 2026-10-10（阶段④）：**空行两边一律不看** ——
    //    新建那一梭走 `append`（内核不许 append 空 text）⇒ 写出来的文件**没有空行**；
    //    而"期望内容"里是有空行的。若逐行硬比，第二次织就会拿空行当差异、反复改写
    //    （**幂等性就没了**）。⇒ 这里按"去掉空行后逐行相同"判 skip。
    const oldNE = oldLines.filter((l) => l !== '')
    const newNE = lines.filter((l) => l !== '')
    if (oldNE.length === newNE.length && oldNE.every((l, i) => l === newNE[i])) {
      return { skip: true, why: '这一份已经与要写的内容一致（空行不计）—— 无需重写' }
    }
    if (oldLines.length && oldLines[oldLines.length - 1] === '') oldLines.pop()
    const N = oldLines.length
    const ops = []
    for (let j = lines.length - 1; j >= 0; j--) {
      const want = lines[j]
      if (oldLines[j] === want) continue
      if (want === '') continue
      if (j < N) ops.push({ op: 'replace', file, line: j + 1, text: want, expect: oldLines[j] })
      else if (j > 0 && oldLines[j - 1] !== undefined) ops.push({ op: 'insertAfter', file, line: j, text: want, expect: oldLines[j - 1] })
    }
    ops.reverse()
    if (ops.length === 0) return { skip: true, why: '这一份已经与要写的内容逐字一致 —— 无需重写' }
    return { ops, files: [file], summary: ['改写 ' + prefix + topic + '.md（' + ops.length + ' 处）'], note: '织布机：改写 ' + prefix + topic }
  }
  // 🔴 2026-10-10（阶段④）：**空文件/新文件** ⇒ 从第 0 行起逐行插；
  //    ⚠️ `line=0` 那一条**不带 expect**（内核规矩："插到最前"没有"那一行"可比）。
  // 🔴 2026-10-10（阶段④）：**新文件（此刻是空的）** ⇒ 用 `append` 逐行追加 ——
  //    空文件的"上一行"就是空串，而 `append` 天然带 `expectLast` 防撞；
  //    这样绕开了"两道闸打架"（织布机要求 insertAfter 带 expect vs 内核禁 line=0 带 expect）。
  const ops = []
  let prev = ''
  for (const want of lines) {
    if (want === '') continue
    ops.push({ op: 'append', file, text: want, expectLast: prev })
    prev = want
  }
  // ⚠️ `append` 按数组顺序依次追加 ⇒ **不要 reverse**（2026-10-10 修：原来 reverse 了，正文全被倒着追加）
  // 🔴 `create: true` ⇒ 内核允许**新建文件**（先验目录、预检全过才造空文件；见 `改档.mjs` 的 pendingCreate）
  return { ops, files: [file], create: true, summary: ['新建 ' + prefix + topic + '.md（' + lines.length + ' 行）'], note: '织布机：新建 ' + prefix + topic }
}

/**
 * 纹样册。**每个 id 就是"格式标识"**（用户 2026-10-02 拍板：L1/L2 那几份**专用名本身当格式标识**）。
 *
 * 一项有哪些格：
 *   · `id` / `title` —— 纹样名（＝格式名）；
 *   · `layer` —— 落哪一层（第四层由格式定，讨论稿 §二）；
 *   · `docHint` —— "就地那一份"文档的**光文件名**（定位用；必须全档唯一命中）；
 *   · `docNames` —— 允许当作本纹样的**文件名集合**（格式锁定靠它：改已有文档时名字说了算）；
 *   · `fields` / `required` —— 一梭的字段（唯一来源见文件头）；
 *   · `segLimit` —— 走不走 `f5-check.js` 的"每段 ≤120 字"（事件表走；待办的字数判据在 `f10` 自己那儿，是 40/60/60）；
 *   · `noPipe` —— 值里禁不禁竖线 / 真换行（表格类文档都禁）；
 *   · `canCreate` —— 允不允许"新建"（v1 这两类都是**专用名、只许追加**，不自动新建）；
 *   · `defined` —— 格式**定没定**（`false` ＝ 《工程-各类文件格式》里还标着 🔴 未定 ⇒ 织布机**只拒不动**）；
 *   · `assemble(item)` —— 借现成的组装件（**本文件不写组装逻辑**）。
 *       ⚠️ **组装件里还带着"累积约束"** —— 它看的是**档案里已有的那条**，不是这一梭的值，
 *       所以没法写成"字段校验"（`segLimit` / `noPipe` 那种）。例如「「做了什么」
 *       「**做了什么 ≤3 条**」那道闸 **2026-10-15 已退役**（`did` 现在不入档）—— 这类"累积约束"的例子留着，
 *       但它已经不在 `planCommit()` 里执行了。写新纹样时别忘了这一类约束。
 */
export const PATTERNS = {

  // ---- 主力纹样：**落档**（一件事）—— 2026-10-15 加（织布机收口第 2 条）----
  // 🔴 为什么有它：`dangan_log` 那条路的入口要收进织布机 ⇒ 「落档」成为**织布机的一种纹样**，
  //    用户 2026-10-15 定：「**要改肯定要改的干干净净啊，这是类似 l2 平推的活。结构性调整。**
  //    **所有老指向该删除的全删除。接口接入新的替代地方。**」
  // ⚠️ 它**只组装、不重写**：摆落点全在 `lib/loom-commit.js` 的 `planCommit()` 里（2026-10-15 从
  //    `f9-commit.js` 原样搬来）—— 这一条与「待办」纹样同一个路子（那条调 `planTodoAdd()`）。
  落档: {
    id: '落档',
    title: '落档（一件事：算编号 · 摆落点 · 拟文本）',
    layer: 'L3-知识',
    docHint: null,
    docNames: [],
    scarf: '完成型',
    defined: true,
    canCreate: false,
    // 🔴 **`docFree: true` 是必需的**：这条路的落点**跨多份文件**（`detailIn` 指的那份 L3 ＋ 待办），
    //    路径由 `planCommit()` 自己算 ⇒ 开纹样时"说不出点名哪一份"。
    //    ⚠️ 少了它，`loom.js` 的 `openPattern()` 会当成"专用名"拒掉（实测踩过：
    //    「「落档」是**专用名**……要动它请点名那一份」）。
    docFree: true,
    prefix: null,
    dateInName: false,
    required: ['what', 'level'],
    fields: LOG_FIELDS,
    segLimit: false,
    noPipe: true,
    assemble: (item) => {
      const p = planCommit(item)
      const summary = [...(p.summary ?? [])]
      // 🔴 2026-10-20：落档前提醒补出处锚（与 F6 时代同一判据，函数在 `commit-ops.js`）。
      const warn = citeAnchorWarn(item)
      if (warn) summary.push(warn)
      return {
        ops: p.ops,
        files: p.files ?? [],
        summary,
        note: p.note ?? '织布机：落档',
      }
    },
  },

  待办: {
    id: '待办',
    title: '待办（工程-待办）',
    layer: 'L4-施工',
    docHint: '工程-待办',
    docNames: ['工程-待办'],
    scarf: '做完型',
    defined: true,
    canCreate: false,
    prefix: null,
    dateInName: false,
    required: ['item'],
    fields: TODO_FIELDS,
    segLimit: false,
    noPipe: true,
    assemble: (item) => {
      const t = planTodoAdd({
        item: item.item,
        why: item.why,
        goal: item.goal,
        term: item.term,
        owner: item.owner,
        force: item.force === true,
      })
      if (t.skip) return { skip: true, why: t.why }
      return {
        ops: [t.op],
        files: [t.op.file],
        summary: [`待办：加一行到 ${t.where}`, ...(t.warn ? [t.warn] : [])],
        note: `织布机：待办 +1（${t.where}）`,
      }
    },
  },

  // ---- 派生件：事件表顶部那份目录（**它本来就是从正文派生的**，最适合当第一个试刀件）----
  // 🔴 2026-10-10 加（织布机收口 · 阶段①）：生成逻辑**一个字都不搬** —— 仍调 `f8-index.js` 的
  //    `renderIndexTable()` / `diffIndexTable()`（"谁生成的"永远只有一处）。
  // ⚠️ 它**不动 `docNames`**（那份文档的格式标识仍是「事件表」—— 专用名当标识）；

  // ---- 派生件 2：《索引》（`L1-必读\索引.md`）—— 整份由"每份文件开头三行自述"派生 ----
  // 🔴 2026-10-10 加（收口 · 阶段②）：生成逻辑住 `lib/f8b-index-doc.js`（与 `tools/档案索引.mjs` 共用同一份）。
  索引: {
    id: '索引',
    title: '《索引》（整份从各文件开头三行派生）',
    layer: 'L1-必读',
    docHint: '索引',
    docNames: ['索引'],
    scarf: '重织型',
    defined: true,
    canCreate: false,
    prefix: null,
    dateInName: false,
    required: [],
    fields: [],
    segLimit: false,
    noPipe: false,
    assemble: () => {
      // ⚠️ 必须用 **CFG.archiveDir**（当前档案），**不许**用 `process.env.GAI_DANG_ROOT || 真档案` ——
      //    后者在"多档案馆 / 沙箱测试"里会算到**另一个馆**上（2026-10-10 由 `tests/f36-loom.mjs`
      //    那条"索引干跑"断言当场抓出来的：沙箱里 apply 之后它还在算真档案）。
      const root = CFG.archiveDir
      const d = diffIndexDoc(root)
      if (d.same) return { skip: true, why: '《索引》已经与各文件开头逐字一致 —— 无需重织' }
      const relOut = String(INDEX_REL).replace(/\//g, '\\')
      const lines = readTextSafe(d.target).split(/\r?\n/)
      const newLines = d.next.split(/\r?\n/)
      const ops = rebuildOps(relOut, lines, newLines)
      return {
        ops,
        files: [relOut],
        summary: [`《索引》：${lines.length} 行 → ${newLines.length} 行（登记 ${d.rows.length} 份）`],
        note: `织布机：索引重织（${ops.length} 处改动）`,
      }
    },
  },

  // ---- 派生件 3：《地图》（`L1-必读\地图-档案结构（机器生成）.md`）----
  // 🔴 2026-10-10 加（收口 · 阶段②）：**复用现成渲染** —— 调 `tools/档案结构地图.mjs` 的干跑到一个
  //    **%TEMP% 副本**（脚本本就有干跑，零改动），再与现文件逐行比对、只推出必要的 replace。
  // ⚠️ 为什么不像「索引」那样抽 lib：那份渲染 ~200 行、还依赖工具映射表等一堆常量，
  //    抽出来要动的面太大；而这条"干跑一支 → 比对 → 只改必要的行"的路子**风险最低**。
  地图: {
    id: '地图',
    title: '《地图-档案结构》（现算结构 ＋ 从索引取职责）',
    layer: 'L1-必读',
    docHint: '地图-档案结构（机器生成）',
    docNames: ['地图-档案结构（机器生成）'],
    scarf: '重织型',
    defined: true,
    // 🔴 **2026-10-16 改 `false → true`**（真账：新馆**头一次**生成地图必死 —— 那份《地图》还不存在，
    //    于是 `locateDoc()`：`findByNameUnique()` 找不到 ⇒ 抛 `ambiguous-doc`；而"按名字锁格式"
    //    那条路同样被 `pattern-locked` 拦下 ⇒ 目标文件永远长不出来，**死锁**）。
    //    ✅ 允许首建是**安全**的：`assemble()` **本来就是现算**（新文件并不需要"上一版"——
    //    它 `spawnSync` 干跑拿新内容，现文件缺失时 `now` 取 `''`，走 `rebuildOps` 的 `N===0`
    //    分支用 `append` 逐行长出来）；**幂等性一个字没动**（现文件存在且逐字相同时照旧 `skip`）。
    //    ⚠️ 单靠这一句还不够：`openPattern()` 里原先只放行"**没有 `docHint`**"的新建型，
    //    所以同日**也改了 `lib/loom.js` 的两处**（`openPattern()` 补"点名了但档案里还没有 ⇒ 放行"、
    //    `resolvePattern()` 认 `canCreate` 即可按新建办）—— 三处合起来才通，少一处仍是死锁。
    canCreate: true,
    prefix: null,
    dateInName: false,
    required: [],
    fields: [],
    segLimit: false,
    noPipe: false,
    assemble: () => {
      // ⚠️ 必须用 **CFG.archiveDir**（当前档案），**不许**用 `process.env.GAI_DANG_ROOT || 真档案` ——
      //    后者在"多档案馆 / 沙箱测试"里会算到**另一个馆**上（2026-10-10 由 `tests/f36-loom.mjs`
      //    那条"索引干跑"断言当场抓出来的：沙箱里 apply 之后它还在算真档案）。
      const root = CFG.archiveDir
      const relOut = 'L1-必读\\地图-档案结构（机器生成）.md'
      const tmp = path.join(tmpdir(), `memoria-map-${process.pid}-${Date.now()}.md`)
      const r = spawnSync(
        process.execPath,
        ['档案结构地图.mjs', '--out', tmp],
        { cwd: path.join(DSH_HOME, 'plugins', 'dsh-memoria', 'tools'), env: { ...process.env, GAI_DANG_ROOT: root }, encoding: 'utf8' },
      )
      if (r.status !== 0) {
        const t = new Error(`地图生成器退出码 ${r.status} —— ${String(r.stderr ?? '').slice(0, 200)}`)
        t.kind = 'rejected-by-planner'
        throw t
      }
      const next = fs.readFileSync(tmp, 'utf8')   // 生成器读**真档案**、只把结果写到 --out
      const target = path.join(root, relOut)
      const now = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
      try { fs.rmSync(tmp, { force: true }) } catch { /* 清不掉就算了 */ }
      if (now === next) return { skip: true, why: '《地图》已经与现算结构逐字一致 —— 无需重织' }
      const lines = now.split(/\r?\n/)
      const newLines = next.split(/\r?\n/)
      const ops = rebuildOps(relOut, lines, newLines)
      return {
        ops,
        files: [relOut],
        summary: [`《地图》：${lines.length} 行 → ${newLines.length} 行`],
        note: `织布机：地图重织（${ops.length} 处改动）`,
      }
    },
  },


  备查: {
    id: '备查',
    title: '新建一份 `备查-<主题>.md`（L3-知识\\知识\\备查\\）',
    layer: 'L3-知识',
    docHint: null,
    docNames: [],
    scarf: '新建型',
    defined: true,
    canCreate: true,
    prefix: '备查-',
    dateInName: false,
    required: ['主题', 'what', 'when', 'body'],
    fields: ['主题', 'what', 'when', 'body'],
    segLimit: false,
    noPipe: false,
    assemble: (item) => newArchiveDoc('L3-知识\\知识\\备查', '备查-', item),
  },
  指南: {
    id: '指南',
    title: '新建一份 `指南-<名>.md`（L3-知识\\知识\\指南\\）',
    layer: 'L3-知识',
    docHint: null,
    docNames: [],
    scarf: '新建型',
    defined: true,
    canCreate: true,
    prefix: '指南-',
    dateInName: false,
    required: ['主题', 'what', 'when', 'body'],
    fields: ['主题', 'what', 'when', 'body'],
    segLimit: false,
    noPipe: false,
    assemble: (item) => newArchiveDoc('L3-知识\\知识\\指南', '指南-', item),
  },

  // ---- 批量改引用（阶段⑤）：**算**借 `tools/引用改写.mjs`，**落**走织布机 ----
  // 🔴 2026-10-10 加：那一族工具本来只"生成事务"、落盘另走 `改档.mjs`；从这儿起**落盘也归织布机**。
  //    输入是一条**分拣好的清单**（TSV：文件 / 行号 / 动作 / 新文本 / 原行）——
  //    分拣（逐处填 改|删|留）仍由我做，这里只管"照清单算 → 走门落"。
  引用改写: {
    id: '引用改写',
    title: '批量改档案里的一处引用（算借 tools/引用改写.mjs，落走织布机）',
    layer: '—',
    docHint: null,
    docNames: [],
    docFree: true,
    scarf: '批量改型',
    defined: true,
    canCreate: false,
    prefix: null,
    dateInName: false,
    required: ['清单'],
    fields: ['清单'],
    segLimit: false,
    noPipe: false,
    assemble: (item) => {
      const list = String(item.清单 ?? '').trim()
      if (!list) { const t = new Error('要给 `清单`（分拣好的 TSV 路径：文件/行号/动作/新文本/原行，制表符分隔）。'); t.kind = 'missing-field'; throw t }
      return citeToolDoc('引用改写.mjs', '引用改写', ['--plan', list])
    },
  },

  // ---- 引用族 · 另两个（阶段⑤ 补全：方案里 ⑤ 列的是**三个**）----
  // 它们本来**就已经"只出事务"**（落盘另走 `改档.mjs`／只打印命令）—— 这里做的只是把**落盘也归织布机**。
  引用去路径: {
    id: '引用去路径',
    title: '把带层路径的引用统一改成「只写文件名」（算借 tools/引用去路径.mjs）',
    layer: '—',
    docHint: null,
    docNames: [],
    docFree: true,
    scarf: '批量改型',
    defined: true,
    canCreate: false,
    prefix: null,
    dateInName: false,
    required: [],
    fields: [],
    segLimit: false,
    noPipe: false,
    assemble: () => citeToolDoc('引用去路径.mjs', '引用去路径', []),
  },
  行号加固: {
    id: '行号加固',
    title: '给「第 N 行」式引用补行指纹 / 把漂了的行号找回来（算借 tools/行号加固.mjs）',
    layer: '—',
    docHint: null,
    docNames: [],
    docFree: true,
    scarf: '批量改型',
    defined: true,
    canCreate: false,
    prefix: null,
    dateInName: false,
    required: [],
    fields: [],
    segLimit: false,
    noPipe: false,
    // ⚠️ `--fix` 只是**预览**（它先摆出来给人核）；**`--fix --apply` 才出事务** —— 织布机要的是后者。
    assemble: () => citeToolDoc('行号加固.mjs', '行号加固', ['--fix', '--apply']),
  },

  // ---- 格式还没定的：登记在册（这样"织布机不认它"与"它格式没定"能分开说）----
  // 《工程-各类文件格式》§3.2 时间轴 已于 **2026-10-11 补写成文**（格式判据＝四列一行 / 新增行 ≤120 字 / 只约束新增行；
  // 🔴 **T 号语义仍待拍板** —— 那是改结构、不是写法）—— 见上面的「时间轴」纹样；§3.6 元类仍未定。
  元类: {
    id: '元类',
    title: '元类（§3.6 —— 格式未定）',
    layer: '—',
    docHint: null,
    docNames: [],
    scarf: '—',
    defined: false,
    canCreate: false,
    prefix: null,
    dateInName: false,
    required: [],
    fields: [],
    segLimit: false,
    noPipe: true,
    assemble: null,
  },
}

/** 纹样册里所有 id（自检与报错文案都用它现算，别在别处抄份数）。 */
export function patternIds() {
  return Object.keys(PATTERNS)
}

/** 按 id 取纹样；没有 ⇒ `null`（**不抛** —— 调用方要按"是没这类格式"和"名字打错"分开说）。 */
export function patternById(id) {
  const key = typeof id === 'string' ? id.trim() : ''
  return Object.prototype.hasOwnProperty.call(PATTERNS, key) ? PATTERNS[key] : null
}

/** 光文件名（去目录、去 `.md`／`.txt`）。 */
export function baseNameOf(p) {
  const s = String(p ?? '').replace(/\\/g, '/')
  const last = s.slice(s.lastIndexOf('/') + 1)
  return stripExt(last) // 2026-10-11：去扩展名走唯一来源（`lib/common.js` 的 stripExt）
}

/**
 * **格式锁定**：文件名 → 纹样。
 * 🔴 只认**光文件名精确相等**（不做"包含"匹配 —— 那会把 `工程-事件表合并-工作流程` 认成事件表）。
 * @returns {object|null} 命中的纹样；不命中 ⇒ `null`（＝"这一瞬你在新建"，由调用方处置）
 */
export function patternByDoc(doc) {
  const name = baseNameOf(doc)
  if (!name) return null
  for (const p of Object.values(PATTERNS)) {
    if ((p.docNames ?? []).some((n) => n === name)) return p
  }
  return null
}

/**
 * **命名接手**：新文档叫什么（前缀由纹样册给，我只需给主题名）。
 *
 * ⚠️ v1 的诚实说明：`事件表` / `待办` 都是**专用名**（`canCreate:false`）⇒ 这一步目前**用不上**。
 *   ✅ **日期写法已定案**（用户 2026-10-07〔E403〕：**日期带不带、怎么写，由每一类自己定死**，
 *   同一个类里绝不许两种写法并存 —— 逐类规则见《工程-各类文件格式》§3.8~§3.13）。
 *   ⇒ 等"能新建的纹样"进来时，本函数按**那一类自己的**日期规则补日期
 *   （纹样册里已留 `dateInName` 字段；`记录-` 那种"一个前缀两种形态"要照 §3.10 判）。
 */
export function newDocName(p, item = {}) {
  if (!p?.canCreate) {
    const t = new Error(
      `「${p?.id ?? '?'}」是**专用名**（用户 2026-10-02 拍板：专用名本身当格式标识）—— **不改名、也不自动新建**。要动它请点名那一份。`,
    )
    t.kind = 'reserved-name'
    throw t
  }
  const topic = String(item.主题名 ?? item.topic ?? '').trim()
  if (!topic) {
    const t = new Error(`新建「${p.id}」要给**主题名**（前缀由织布机接手，日期等 A 组定案）。`)
    t.kind = 'missing-field'
    throw t
  }
  return p.prefix ? `${p.prefix}-${topic}.md` : `${topic}.md`
}
