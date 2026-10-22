// ============================================================
// F5 · dangan_check（档案体检：只查"机械能查"的一致性）
// ============================================================
//
// 为什么有它（2026-09-16）：档案的毛病**几乎全是"六处手写同步"漏的**——
// 编号串位、索引表漏行、正文有索引没有、锚点指向不存在的 T、"见 E25"其实该是 E23、
// 引用的文件改名后引用没跟着改、正文自称作废但状态还留在 ✅。
// 这些**人工审一轮要两个人几个小时**，机器一秒能全查出来。
// ⚠️ 它只报**机械可判**的；语义类（口径冲突、写死数字过时）仍需人判。

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CFG, archiveFingerprint, capTick, findByName, layersWithSubdirs, log, readTextSafe, rel, toolPath, walk, writeHealth } from './common.js'
// 🔴 2026-09-28：`cellsOf` 也从此**只留一份** —— 口径扫（`tools/口径扫.mjs`）当场扫出这里又抄了一份，
//    而 `f10-todo.js` 那句注释早就写着"这四个小函数是唯一实现；各抄一份就是本档案的头号病根再长一个头"。
import { cellsOf, parseTodo, sectionMarkDupes, todoStaleCandidates, findTodoTooLong, todoFile } from './f10-todo.js'
// 工程（F35 · 2026-09-26 加）—— 与待办**分开**的一段（另一份文件：`工程-清单.md`）。
import { projectFile, projectStaleCandidates } from './f35-project.js'
import { scanAnchors } from './f13-anchors.js'
// 🔴 2026-09-27：索引的「范围 ＋ 写法」判据**只留一份**（见 `lib/idx-scope.js`）——
//    这里原来自带一份行正则＋一份范围判断，索引改"两栏 ＋ 光文件名"当天它就整份解析不出，
//    体检当场多报"漏登记"（三份副本同一天各坏一处，所以收成一份）。
import { INDEXED_LAYER, SHOULD_REG, parseIndexRows, registeredIn } from './idx-scope.js'

/** 标准八字段（事件条目）—— 2026-09-17 定的枚举；见下面"字段名像是写岔了"那条检查。 */
export const STD_FIELDS = ['时间跨度', '锚点', '模型', '起因', '做了什么', '结果', '状态', '指引']

// ============================================================
// 🔴 字数判据：「**每一段 ≤120 字**」（2026-10-02 实装 —— 用户 2026-10-01 17:26 当场拍板）
// ============================================================
//
// 用户原话〔E380〕："**…事件表，我想想，也是两行吧。我觉得两行足够说清楚事情了……
//   限制字数只是不想他每一个都说的很详细，实际上步数方面是不做限制的。报错吧。**"
//
// 判据（**下面这一份就是唯一权威** —— 体检与落档口都 import 它，别处不许再抄一遍）：
//   · **"段"** ＝ 字段值被 `<br>` / 换行 / 列表项切开的每一截（列表项序号 `1. ` 不算进长度）
//   · 🔴 **步数不限** —— 它**推翻**了 2026-09-27 定案的"列表项 ≤5"；只判"每一段"，**不判整格总长**
//     （一个字段可以有很多轮、很多条；口径见 `工程-事件写法.md` §六 与用户 2026-10-01 那三条）
//   · 超了 → **报错**
export const SEG_LIMIT = 120

/** 把一个字段值切成"段"：`<br>` / 换行 都算断开（与 `脚本-预演字数上限.mjs` 同口径）。 */
export function segLimitSplit(value) {
  return String(value ?? '')
    .split(/<br\s*\/?>/i)
    .flatMap((x) => x.split(/\r?\n/))
    .map((s) => s.replace(/^\s*\d+\.\s*/, '').trim())
    .filter((s) => s.length > 0)
}

/** 这一个值里**所有超标段**（空数组＝合格）。落档口与体检共用它 —— 判据不许各写一份。 */
export function segLimitOver(value, limit = SEG_LIMIT) {
  return segLimitSplit(value).filter((s) => s.length > limit)
}

/**
 * 按**没转义的**竖线分格。
 * ⚠️ 档案里常拿 `\|` 来"展示表格长什么样"（例如"四列：`\| 等级 \| T编号 \|…`"），
 * 那不是真的分格 —— 2026-09-17 用普通 split 试跑，把两处**正常的说明文字**报成了"破表"。
 */
// ⚠️ `cellsOf` **不在本文件定义**了 —— 见文件头那个从 `./f10-todo.js` 的 import（2026-09-28 收拢）。

/**
 * "两处副本"对照表（权威那份 / 档案内副本相对路径 / 漂了算错还是算提示）。
 *
 * 📦 **2026-09-17 迁移**：权威位置已从 `E:\DeepSeek工具箱\00-清单与脚本\` **挪进插件包**
 * （`<插件>/tools/`，用户指示"所有跟梅莫莉亚相关的、由她管理的，都挪进去"）。
 * 所以这里**不再写死绝对路径**，而是按文件名现找：
 *   · `toolPath()`：**包内优先 → 迁移期兜底工具箱**（两边都在时以包内那份为准）；
 *   · 拿不到就报"权威那份找不到"。
 *
 * ⚠️ **这一节只在"档案里登记了副本清单"的档案上跑**（见下面 `copiesRegistered`）——
 * 别人下载插件新建的档案里没有这个目录，也就不会有这些对照（新档案的权威一律在包内）。
 * 三份副本本机已按用户决定**删掉、只留一行指针**；指针文件在 → 这一节仍会跑，
 * 于是"权威那份在不在"照样有人盯（这是它剩下唯一还有用的那半）。
 */
const COPY_PAIRS = [
  ['改档.mjs', 'L3-知识\\本机实现件备份\\改档.mjs', '错'],
  ['move-verify.ps1', 'L3-知识\\本机实现件备份\\动盘脚本\\move-verify.ps1', '提示'],
  ['recycle-del.ps1', 'L3-知识\\本机实现件备份\\动盘脚本\\recycle-del.ps1', '提示'],
]

// 🔴 2026-10-15：**`timelineLevelStats()` 已整块删除** —— 它读「时间轴」文件的等级列（❗/⭐/○/未定级），
//    而时间轴随 L2 退役 ⇒ `findByName('时间轴')` 恒 null ⇒ 它**恒返回全 0**（喂给面板与 `dangan_check` 的都是空数）。
//    判据本体随 L2 下线（用户："这是结构变化"）。调用点（`f15-status` · `tools` · `index.js` 导出）已同步去掉。


/**
 * 「最近在干什么」—— **从《索引》的 `L3-知识` 那一节读**（2026-10-14 · L2 降级派生 ④ C 轮）。
 *
 * 🔴 为什么换掉旧实现：原来读**时间轴**（`findByName('时间轴')` ＋ T 行正则）——
 *    而时间轴随 L2 一起进了回收站 ⇒ 旧实现**每次都返回「找不到时间轴文件」**（功能整个废掉）。
 * ✅ 为什么读索引就够：那一节由 `f8b-index-doc.js` **现算**，每行的时间取各文件的 `> 🕐` 标记 /
 *    文件名日期 / 创建时刻，而且**已经按「新的在前」排过序** ⇒ 读头几条就对。
 * ⚠️ 不再有「补到累计 N 条 ❗」那套读法 —— 索引里没有等级列（等级是时间轴的东西，随 L2 一起退役）。
 */
export function pickRecent(last = 20) {
  const out = { rows: [], from: null, to: null, note: '' }
  const findIndexDoc = () => {
    const cand = findByName('索引')
    // ⚠️ 只认**就叫「索引」**的那一份 —— `findByName` 是模糊匹配，别把别的「…索引…」撞进来
    return typeof cand === 'string' && /(^|[\\/])索引\.md$/i.test(cand) ? cand : null
  }
  const f = findIndexDoc()
  if (!f) return { ...out, note: '找不到《索引》文件' }
  const lines = readTextSafe(f).split(/\r?\n/)
  const at = lines.findIndex((l) => /^##\s*L3-知识\s*$/.test(l))
  if (at < 0) return { ...out, note: '《索引》里没有 `## L3-知识` 那一节' }
  const rows = []
  for (let i = at + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break // 走到下一节就停
    // 那一节的表是三列：`| 时间 | <文件名> | 一句话 |`
    const m = lines[i].match(/^\|\s*([^|]*?)\s*\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/)
    if (m) rows.push({ date: m[1].trim(), file: m[2].trim(), what: m[3].trim(), raw: lines[i] })
  }
  if (rows.length === 0) return { ...out, note: '`L3-知识` 那一节里一行都没读到（格式变了？）' }
  const picked = rows.slice(0, Math.max(1, Math.min(Number(last) || 20, rows.length)))
  return { rows: picked, from: picked[0].date, to: picked[picked.length - 1].date, note: '' }
}

export function formatRecent(p) {
  if (p.note) return `【dangan_search · recent】${p.note}`
  const head =
    `【dangan_search · recent】最近 ${p.rows.length} 件（${p.from} ~ ${p.to}）\n` +
    '来源＝《索引》的 `L3-知识` 那一节 —— 它**已经是「新的在前」**（时间从各文件的 🕐 标记 / 文件名日期现算）'
  return [head, '', ...p.rows.map((r) => `· ${r.date}｜\`${r.file}\`｜${r.what}`)].join('\n')
}

/**
 * 从"日期那一格"里取出**可比较的日期键**（`YYYY-MM-DD`）。
 *
 * ⚠️ 这个函数是 2026-09-16 那次事故的产物，两条规矩不能丢：
 *   ① **带年份的写法优先**（`2026-09-16 22:11`）——新行从 2026-09-16 深夜起一律带年
 *      （用户原话〔T50〕："不能写今晚几点几分，要写 xx 年 xx 月 xx 日，不然谁知道今晚是那一晚"）；
 *   ② **老写法（只有月日）必须锚在开头**：`09-16 22:11` → `2026-09-16`。
 *      绝不能再写成"在整格里找 `\d{2}-\d{2}`" —— 那样会把 `2026-09-16` 读成 **`26-09`**
 *      （2026-09-16 白天真踩过：闸门因此误报"时间轴已经到 26-09"）。
 */
export function dateKey(cell) {
  const s = String(cell ?? '')
  const full = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (full) return `${full[1]}-${full[2]}-${full[3]}`
  const short = s.match(/^\s*(\d{2})-(\d{2})\b/)
  if (short) {
    let year = '2026'
    try {
      year = String(new Date().getFullYear())
    } catch {
      /* 拿不到年份就退回 2026（本档案的起始年） */
    }
    return `${year}-${short[1]}-${short[2]}`
  }
  return ''
}

export function checkArchive() {
  const issues = []
  const add = (lv, file, line, msg) => issues.push({ lv, file, line, msg })

  // 🔴 2026-10-15：`tRaw` / `fTimeline` / `eRaw` / `fEvents` **四个读数删除** —— 时间轴块与事件表块都已删，
  //    这四个量**一个读者都没有了**（"看起来在跑、其实已死"）。`findByName('时间轴'/'事件表')` 也从这里消失。
  // 🔴 2026-10-15（**同一天第二次踩**）：这份文件**已经改过三次名** ——「AI错误总账」→「AI要修清单」→「**记错本**」，
  //    而这里原来按**名字**找 ⇒ 一改名就"R/A 编号校验整组空转 ＋ '见 Rxx' 全报假死指针"
  //    （这次实测 **6 条**；上一次改名实测 **20 条** —— 老注释里还专门警告过，照样又踩）。
  //    ⇒ 名字只当**线索**：几个历史名都试一遍。⚠️ **它以后若再改名，这里要跟着加一行**；
  //      根治办法＝认 H1 里的"教训与事故"而不是认名字（判据落了待办）。
  const fLedger = findByName('记错本') ?? findByName('要修清单') ?? findByName('错误总账')

  // ---- 时间轴块：**2026-10-15 整块删除** —— 用户："这是结构变化" ----
  // 🔴 原文那 ~90 行（T 号重复 / 等级哨兵 / 断号 / 严格升序 / 未定级）**全部依赖时间轴文件**，
  //    而 `L2-数据\时间轴.md` 已随「L2 降级派生」进回收站 ⇒ 那些分支永远不会执行 ⇒ W8：直接删干净。
  //    📌 保留 `tAt` / `tOrder` 两个**空集合**：事件表那半的"锚点存在性"校验读它们（L2 在时会被填满）。
  // 🔴 2026-10-15：`tAt` / `tOrder` / `eBody` / `eIdx` / `blocks` **五个空集合删除** ——
  //    它们原来由时间轴块 / 事件表块填满，两块都删了 ⇒ 恒空、且已无读者。
  // ---- 事件表块：**2026-10-15 整块删除** —— 用户："这是结构变化" ----
  // 🔴 原文（解析 eIdx/eBody/blocks · E 号缺号 · 索引↔正文对账 · 裸条目 · 自指作废）**全部依赖事件表文件**，
  //    而 `L2-数据\事件表.md` 已随「L2 降级派生」进回收站 ⇒ 那些分支永远不会执行 ⇒ W8：直接删干净。
  //    ⚠️ 同一天先删掉了它内部的两段：**"锚点存在性"校验**（拿恒空的 `tAt` 去比 ⇒ 假报）与**字数判据**。

  // ---- 交叉校验（"时间轴上的 T 行有没有人认领"）：**2026-10-15 整块删除** ----
  // 🔴 它是**时间轴 × 事件表**的交叉判据（两边都得在才有意义）—— 两样都随 L2 退役
  //    ⇒ `fTimeline && fEvents` 恒 false ⇒ 永不执行 ⇒ W8：直接删干净。

  // ---- （批 2）两处副本有没有漂（"改的时候改权威那份、然后回来同步"这件事，从此机器盯着）----
  // ⚠️ 只在**登记了副本清单**的档案里比（`本机实现件备份\_说明-读我.txt` 在＝这份档案认这套规矩）；
  // 样本档案（测试夹具）里当然没有那个目录 —— 否则每个夹具都会多出一条"副本不存在"的假错。
  // 🔴 2026-10-02 修：这里原来是个"开关"—— 它 existsSync 一个**早已不存在**的目录
  //   （L3-知识\本机实现件备份，2026-09-17 副本删掉时那个目录就没了）⇒ 这一整节**从那以后一次都没跑**，
  //   而且**不报错、不吭声**（"沉默 ≠ 正常"的活标本）。现在**无条件跑**：副本不在就 continue，
  //   剩下的那半（盯"权威那份在不在"）照样有人看。
  for (const [name, copyRel, lv] of COPY_PAIRS) {
    const src = toolPath(name) // 包内优先 → 迁移期回退工具箱；不再写死绝对路径
    const copy = join(CFG.archiveDir, copyRel)
    if (!src) {
      add('提示', copyRel, 0, `副本对照：**权威那份（${name}）哪儿都找不到**（包内 tools/ 与工具箱都没有）—— 没法比`)
      continue
    }
    // 2026-09-17：档案里那三份副本已按用户决定**删掉、换成一行指针**（`_说明-读我.txt` 里写着权威在哪）。
    // 所以"副本不存在"不再是错、也不再是漏，只是**已经迁移过**的安静状态。
    if (!existsSync(copy)) continue
    const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex').toUpperCase()
    const a = md5(src)
    const b = md5(copy)
    if (a !== b) {
      add(
        lv,
        copyRel,
        0,
        `**副本漂了**：${name} 两份内容不同（权威 ${a} / 档案内 ${b}）→ 权威那份在插件包 \`tools/\` 里，改它；档案内这份若还留着，就是在指旧路（可删，或回来同步）`
      )
    }
  }

  // ---- （2026-10-02 加）可执行件：**现役** `.ps1` 必须纯 ASCII ----
  // 判据＝《铁律》§一 第 3 条：`.ps1` **必须纯 ASCII，连注释都不能有中文**（PS 5.1 按 ANSI 读脚本
  //   ⇒ 中文会把脚本读崩、或让判断**静默失效**）。以前只靠人手跑 `Select-String`，现在进体检。
  // 🔴 **2026-10-16（用户点头定）**：改成**扫 `L3-知识` 这一层（含子目录）**，不再写死某一个子目录。
  //   · 起因：骨架**不建** `L3-知识\工具\` ⇒ 新馆一开箱就报两条假警（"跑不动" ＋ "一个都没有"）。
  //   · 用户的判据：「**可执行脚本名必须是英文 —— 换谁的机器都该这样**」⇒ **规矩是通用的，
  //     "它住哪个子目录"不是**；把我们的分法写死进代码，别人家的馆就必然报警。
  //   · 现在：**有 `.ps1` 就照规矩检查；一个都没有就沉默**（"这个馆还没放脚本"是正常状态）。
  // ⚠️ **只扫 `L3-知识`**；**不查 `L5-证据\`** —— 那批是**历史物证**
  //   （《铁律》原文就写着"只作证据保留、不要运行"），报成"错"会让 G2 永久锁死（同"字数判据"那次教训）。
  {
    const layer3 = join(CFG.archiveDir, 'L3-知识')
    const ps1s = []
    try {
      const walkPs1 = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name)
          if (e.isDirectory()) walkPs1(p)
          else if (e.isFile() && e.name.toLowerCase().endsWith('.ps1')) ps1s.push({ p, name: e.name })
        }
      }
      walkPs1(layer3)
    } catch (err) {
      // ⚠️ **目录不存在 ＝ 正常**（这个馆还没放脚本）⇒ **沉默**；**别的读错误才出声**
      //   （"沉默 ≠ 正常"要治的是"它瞎了却不吭声"，不是"对象本来就不存在"）。
      if (err?.code !== 'ENOENT') {
        add('提示', 'L3-知识', 0, `可执行件纯 ASCII 判据**跑不动**：${(err && err.stack) || err}`)
      }
    }
    for (const { p, name } of ps1s) {
      if (readFileSync(p).some((b) => b > 0x7f)) {
        add('错', rel(p), 0, `现役 \`.ps1\` **${name}** 里有**非 ASCII 字节** —— 《铁律》§一 第 3 条：\`.ps1\` 必须纯 ASCII、**连注释都不能有中文**（PS 5.1 按 ANSI 读脚本 ⇒ 中文会把它读崩、或让判断静默失效）。中文只许放进"运行时读入"的 UTF-8 数据文件`)
      }
    }
  }
  // ---- （批 2）表格列数：一张表的每一行，格数必须和表头一样 ----
  for (const file of walk(CFG.archiveDir)) {
    const r = rel(file)
    const L = readTextSafe(file).split(/\r?\n/)
    for (let i = 0; i < L.length - 1; i++) {
      if (!/^\s*\|/.test(L[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1])) continue
      const cols = cellsOf(L[i]).length
      let shown = 0
      let bad = 0
      for (let j = i + 2; j < L.length; j++) {
        if (!/^\s*\|/.test(L[j])) break
        const n = cellsOf(L[j]).length
        if (n === cols) continue
        bad += 1
        if (shown < 3) {
          shown += 1
          // 只报"格子里多了竖线"和"格子少了"两种，各给一句能直接动手的话
          add(
            '错',
            r,
            j + 1,
            `表格列数不对：这行 **${n - 2} 格**，表头是 **${cols - 2} 格**${n > cols ? '（多半是格子里写了个没转义的 `|` —— 要么转义成 `\\|`，要么换成顿号）' : '（少写了格子：补齐，或把整行删掉）'}`
          )
        }
      }
      if (bad > shown) add('错', r, i + 1, `上面这张表还有 ${bad - shown} 行列数不对（本文件里同类不逐条列）`)
      i += 1
    }
  }

  // ---- （2026-10-11 加）插件 `lib\` 的**顶层导出名不许撞车**（治《总账》R37：复发 3 次）----
  // 为什么在这里：R37 的判据原话是"**写完先 grep 确认它不存在**"—— **靠自觉 = 没人强制跑**。
  //   撞名的代价（`f30-toolgate.js:1131` 那次）：**整个模块起不来**，而它自己**不吭声**。
  //   这一条把"自觉"换成"每轮体检必跑"，判据从此不靠我记得。
  // ⚠️ **只在本机这座档案上报**（样本档案 / 测试夹具没有 `L3-知识` 这一层，也不该检查本机插件）
  //   —— 与上面"副本对照"同一条纪律：**别让夹具吃到假错**。
  if (existsSync(join(CFG.archiveDir, 'L3-知识'))) {
    const libDir = join(dirname(fileURLToPath(import.meta.url)))
    let nMod = 0
    const byName = new Map()
    try {
      for (const e of readdirSync(libDir, { withFileTypes: true })) {
        if (!e.isFile() || !e.name.endsWith('.js')) continue
        nMod++
        const p = join(libDir, e.name)
        readTextSafe(p)
          .split(/\r?\n/)
          .forEach((s, i) => {
            // 顶层导出（**行首**才算 —— 缩进的那些是块内导出/局部函数，不参与撞名）
            //   `export const X` / `export function X` / `export class X` / `export { a, b }` 都覆盖
            const m = s.match(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/)
            if (m) {
              const list = byName.get(m[1]) ?? []
              list.push({ f: e.name, line: i + 1 })
              byName.set(m[1], list)
              return
            }
            const b = s.match(/^export\s*\{([^}]*)\}/)
            if (!b) return
            for (const part of b[1].split(',')) {
              const raw = part.trim()
              if (!raw) continue
              const nm = (raw.split(/\s+as\s+/).pop() ?? raw).trim()
              if (!/^[A-Za-z_$][\w$]*$/.test(nm)) continue
              const list = byName.get(nm) ?? []
              list.push({ f: e.name, line: i + 1 })
              byName.set(nm, list)
            }
          })
      }
    } catch (err) {
      add('提示', 'lib', 0, `插件「lib」顶层导出名判据**跑不动**：${(err && err.stack) || err}`)
    }
    // 🔴 **2026-10-11 实测把这条判据纠正过来了**：ESM 里**不同文件叫同一个名字是合法的**
    //   （本插件当场就扫出 9 处、而它一直跑得好好的）⇒ 跨文件同名**只报"提示"**，不报错。
    //   真正会"整个模块起不来而且不吭声"的是**同一份文件里同一个名字导出两次**（R37 那次正是这个）
    //   ⇒ 那个才是**错**。
    const bad = []
    const warn = []
    for (const [nm, v] of byName) {
      const files = new Set(v.map((x) => x.f))
      if (files.size === 1 && v.length > 1) {
        bad.push([nm, v])
        continue
      }
      if (files.size > 1) warn.push(nm)
    }
    for (const [nm, v] of bad) {
      add(
        '错',
        'lib',
        0,
        `顶层导出名 **「${nm}」在同一份文件里导出了两次**（《总账》R37）：${v.map((x) => `「${x.f}:${x.line}」`).join(' · ')} —— 这会让**整个模块起不来**、而且**它自己不吭声**。改掉其中一个名`,
      )
    }
    if (warn.length > 0) {
      add(
        '提示',
        'lib',
        0,
        `**有几个函数名在两份文件里都用了**：${warn.slice(0, 8).join(' · ')}${warn.length > 8 ? ' …' : ''} —— **不影响运行**，只是以后容易接错。**这条不用你管**（我在新增同名函数前会先看一眼）`,
      )
    }
    // 🔴 **自报工作量**（《施工手册》第 ③ 问：不许静默失效）
    add('提示', 'lib', 0, `检查了 ${nMod} 个模块的 ${byName.size} 个函数名 —— 没有重名冲突`)
    if (nMod === 0) add('提示', 'lib', 0, '插件 `lib` 顶层导出名判据：**一个 .js 都没扫到** —— 要么目录不对，要么它被挪走了（沉默 ≠ 正常）')
  }

  // ---- （批 2）编号唯一性：总账的 R / A / D / M 号不许撞车 ----
  if (fLedger) {
    const L = readTextSafe(fLedger).split(/\r?\n/)
    for (const k of ['R', 'A', 'D', 'M']) {
      const seen = new Map()
      L.forEach((s, i) => {
        const m = s.match(new RegExp(`^\\|\\s*\\*{0,2}(${k}\\d+)\\*{0,2}\\s*\\|`))
        if (!m) return
        if (seen.has(m[1])) {
          add('错', rel(fLedger), i + 1, `${m[1]} **重复**（第一次在第 ${seen.get(m[1])} 行）—— 编号撞车会让"见 ${m[1]}"指到错的那一条（W5：写完先查一遍它不存在）`)
        } else seen.set(m[1], i + 1)
      })
    }
  }

  // ---- 事件条目的"写法三条"（结果字段存在性 / 字段顺序 / 字段名白名单）：**2026-10-15 整块删除** ----
  // 🔴 它们逐条读**事件表条目**（`blocks`）—— 而事件表随 L2 退役 ⇒ `blocks` 恒空 ⇒ 三条都永不执行
  //    （其中"字段名必须等于白名单"那条曾被 `tests/f5-check.mjs` 钉着，同批删）。
  //    📌 那条口径本身没作废：写法若回到某处（新的"事件"载体），照 `工程-事件写法.md` 重建即可。

  // ---- （批 2）字段名：**只报"像是写岔了"的** ----
  // ⚠️ **2026-10-01 起这一段已被上面那条"必须等于"取代**（用户当天选「甲方案」把 29 种自造名全并进标准字段，
  //    实测残留 **0 处**）⇒ 原来那句"30 种自造标题是叙述性小标题、不报"的口径**作废**：自造名现在一律报错。

  // ---- （批 2 · 2026-09-17）索引清单覆盖：L1/L2/L3 根下的文档，有没有哪个没登记进「索引」 ----
  // 为什么算**错**：索引是全档唯一的"文件级目录"，没登记＝按"先看索引"的读法**根本看不到它**
  // （A 路审查就报过"索引漏了 5 行"）。口径与《档案结构地图.mjs》一致：
  // 🔴 **2026-09-28 · 结构假设对账**（用户点名的第二条哨兵）：**"这一层现在有子目录了"要自己冒出来**。
  //    今天那场病（L3 分 9 个子目录、四个消费方还按"平层"扫它 ⇒ 地图假报 35 条死指针、
  //    索引重生成会掉 35 份正文）的根子就是"**结构变了、没人告诉代码**"。**只提示、不判错。**
  {
    const subs = layersWithSubdirs(CFG.archiveDir)
    if (subs.length > 0) {
      add(
        '提示',
        '（档案结构）',
        0,
        `这几层里还有子文件夹：${subs.map((s) => `${s.layer}（${s.subs.length} 个）`).join(' · ')} —— **这条不用你管**（扫描已经会进子文件夹），列出来只是让你知道结构。`,
      )
    }
  }

  // 🔴 2026-09-28 更新：下面这段的**范围已改成含子目录**（原写"只比各层根下的文档，子目录里的实现件
  //    副本/快照不逐文件登记"）—— L3 现在分了 9 个子目录、**那些就是正文**；旧口径会让"子目录里的
  //    文件漏登记"这件事**查不出来**（与索引生成器、f17、地图生成器三处同口径）。
  // ⚠️ `walk()` 只回 .md/.txt —— 所以这里比的就是**文档**；`.ps1`/`.mjs` 这类要不要登记由人定。
  {
    const idxFile = walk(CFG.archiveDir).find((f) => /索引\.md$/.test(f))
    if (idxFile) {
      // 🔴 2026-09-27：**解析 ＋ "该不该登记"都改用唯一判据** `lib/idx-scope.js`
      //    （这里原来自带一份行正则与一份"范围"判断，索引一改「两栏 ＋ 光文件名」就整份解析不出，
      //      体检当场多报"漏登记"；三份副本同一天各坏一处，所以收成一份）。
      const idx = parseIndexRows(readTextSafe(idxFile))
      // 🔴 **2026-09-28 改：范围含子目录**（原来自带一份 `&& r.split('\\').length === 2`）——
      //    那是"只查各层根下"的旧口径，于是**"子目录里的文件漏登记"这件事查不出来**；
      //    而索引生成器（`tools/档案索引.mjs` 的 `collectFiles`）已改成**递归登记** ⇒ 两边必须同口径。
      //    ⚠️ 这一份是同一口径的**第 4 个消费方**（另三个：索引生成器 · `lib/f17-map.js` · `tools/档案结构地图.mjs`）。
      const actual = walk(CFG.archiveDir)
        .map((f) => rel(f))
        .filter((r) => INDEXED_LAYER.test(r))
      const miss = actual.filter((r) => !registeredIn(idx, r) && SHOULD_REG(r))
      if (miss.length > 0) {
        add(
          '错',
          rel(idxFile),
          0,
          `索引**漏登记**了 ${miss.length} 份文档（L1/L2/L3，**含子目录**）：${miss
            .slice(0, 6)
            .map((x) => `\`${x}\``)
            .join('、')}${miss.length > 6 ? ` …还有 ${miss.length - 6} 份` : ''} → 加进这张表（"哪个文件讲什么、何时读"）；⚠️ 范围＝那三层里的**所有正文**（含子目录），快照类目录不进`
        )
      }
    }
  }

  // ---- （2026-09-17）待办表里的"该消的"（W6 的"出"里唯一能自动化的那部分）----
  // 用户当天："**先做待办相关的自动化吧。不然你老是忘**"。三类机器能判：已标完成还留着 / 上游已结案 / 重复。
  // ⚠️ 一律算**提示**：删不删是判断活；它只保证"别烂在表里没人看见"。
  for (const c of todoStaleCandidates()) add(c.lv, rel(todoFile() ?? '(档案)'), c.line, c.msg) // 2026-09-29：收拢到 `todoFile()`（原来这儿又写了一遍 hint `findByName('待办')`）

  // ---- （2026-09-26）**工程清单**（F35）里"该看的"----
  // 🔴 **单独一段、单独一份文件**（`工程-清单.md`）—— 用户 2026-09-26："**待办是待办，工程是工程**……
  //    **不允许将他们混为一谈**"。三类机器能判：**超字数**（放宽 ≠ 没上限；上限写在文件开头）/
  //    已标完成还挂着（施工层"做完就离开"）/ 重复。
  // ⚠️ 也一律算**提示**。⚠️ 档案里没有这份文件时 `projectStaleCandidates()` 返回空数组（**不是错**）。
  for (const c of projectStaleCandidates()) add(c.lv, rel(projectFile() ?? '(档案)'), c.line, c.msg)

  // ---- 编号型死指针（全档："见 T123 / 见 E45 / 见 R12 / 见 A7"）----
  // 🔴 2026-10-14 加：**豁免标记** —— 这两类死指针原本"只能靠改文案消化"，而档案里有一大批
  //   **历史叙述**（例："来源：`L2-数据\事件表.md` 的 E343 原条目，照录未改" / "T41 已重写为《防丢总则》" /
  //   总账里 R21 那条**本身就是**"我曾写了个指向不存在的号"），按 W8 的口径**恰恰不该改**（改了就是篡改历史）。
  //   而 ⑤ 的验收要求 0 错 ⇒ 没有出口就会逼人改史实。做法与 F25 那条 `<!-- F25-已确认 -->` 一致：
  //   **要豁免，就在那一行里**加 `<!-- F5-已确认 -->` —— 标记跟行走、不按行号；**豁免仍然逐条报（降为提示）**，不许变静默。
  const F5_ACK = '<!-- F5-已确认 -->'
  const rSet = new Set()
  const aSet = new Set()
  if (fLedger) {
    const T = readTextSafe(fLedger)
    // ⚠️ `\*{0,2}`：原来写的是 `\*\*?`（**至少要有一个星号**），于是总账里那些**不加粗**的
    // `| A1 | …` 一条都读不到 —— 死指针检查会拿一个残缺的集合去判"见 A1 是否存在"（**假死报**）。
    // 2026-09-17 量出来：R 26 个号、A 3 个号（A1/A12/A19），其中不加粗的那些原来全漏了。
    for (const m of T.matchAll(/^\|\s*\*{0,2}(R\d+)\*{0,2}\s*\|/gm)) rSet.add(m[1])
    for (const m of T.matchAll(/^\|\s*\*{0,2}(A\d+)\*{0,2}\s*\|/gm)) aSet.add(m[1])
  }
  for (const file of walk(CFG.archiveDir)) {
    const r = rel(file)
    // ⚠️ 原来这里是 `if (r.includes('索引')) continue` —— 把全档唯一那份"文件级目录"从检查里排除了
    //（审查批 2 点名的覆盖面洞）。2026-09-17 量过：索引里"见 X编号"式引用是 **0 处**，
    // 所以去掉这个跳过**不会带来任何新噪音**，只是把洞堵上。
    readTextSafe(file)
      .split(/\r?\n/)
      .forEach((s, i) => {
        if (s.includes(F5_ACK)) return // 已声明的历史叙述 ⇒ 不报（要查就搜标记）
        // 🔴 2026-10-15：**只查 R / A 两类** —— T 与 E 的编号表分别来自时间轴 / 事件表（随 L2 退役 ⇒ 恒空），
        //    继续查它们会把**每一处"见 Txx"都假报成死指针**（对象没了就该下线，不是留着假报）。
        for (const m of s.matchAll(/见[\s*`]*([RA])(\d{1,3})/g)) {
          const k = m[1]
          const d = m[2]
          const ok = k === 'R' ? rSet.has(k + d) : aSet.has(k + d)
          if (!ok) add('错', r, i + 1, `死指针："见 ${k}${d}"，但 ${k}${d} 不存在（查的是总账）`)
        }
      })
  }

  // ---- 文件型死指针（只查 L1~L9 开头的档案内引用）----
  for (const file of walk(CFG.archiveDir)) {
    const r = rel(file)
    readTextSafe(file)
      .split(/\r?\n/)
      .forEach((s, i) => {
        if (s.includes(F5_ACK)) return // 同上：历史叙述豁免
        for (const m of s.matchAll(/`([^`\n]+?\.(?:md|txt|ps1|mjs|cmd|csv|json|png|jpg))`/g)) {
          const p = m[1].trim()
          if (!/^L[1-9]-/.test(p)) continue
          // 通配符 / 占位符 / 变量：那是"将来会生成的文件名格式"，不是在引用一个已存在的文件
          // （2026-09-16 实测踩到：设计文里写 `落档留意-*.txt` 被误报成死指针）
          if (/[*?<>$]/.test(p)) continue
          if (!existsSync(join(CFG.archiveDir, p.replace(/\//g, '\\')))) {
            add('错', r, i + 1, `死指针：引用的 \`${p}\` 在档案里不存在`)
          }
        }
      })
  }

  // ---- 「总览日期 vs 时间轴日期」这条检查 2026-09-16 晚**已删除** ----
  // 原因：总览那时起**不再抄时间线**（改成"读末尾 20 条 + 补 3 条 ❗"的读法，见 L1「00-总览」规矩 1~2），
  // 于是它里面再没有 `| **09-16** |` 这种行 → 一旦保留，这条检查会**永远不触发**（不是通过，是没有对象）。
  // 留着就是"看起来在跑、其实已死"，正是本档案最想避免的那类静默失效。

  // ---- 有效性锚点（F13，2026-09-17 加）：工具类文档里"当路径写"的路径，现在还在不在？----
  // ⚠️ 只报**提示**，不报错 —— 档案里的路径有三种用法（**事实** / **举例** / **记录已删除的东西**），
  //    机器分不清；"错"要留给机器真能判的事。（这条是试跑三次才走通的，教训写在 `f13-anchors.js` 文件头。）
  try {
    const anchors = scanAnchors(CFG.archiveDir)
    for (const m of anchors.missing) {
      add(
        '提示',
        m.file,
        m.line ?? 0,
        `这条路径找不到：\`${m.path}\` —— 可能只是举例、也可能早就删掉了。**你判断一下**：如果它只是举例或已经不用了，就当没这回事。`,
      )
    }
    // ⚠️ **离线盘那条故意不进体检**（2026-09-17 改，上线当天就改的）：
    //    因为盘**长期**不在线时它会**每轮都报** —— 而档案里最忌"**消不掉的告警**"（"等于没有告警"）。
    //    这条信息改由**两处**报：`F13` 的启动自检行 ＋ `dangan_status` 面板（那两处本来就是"读一眼现状"的地方）。
  } catch (e) {
    add('提示', '（盘检查）', 0, `有效性锚点没跑成（不影响其它检查）：${e}`)
  }

  // ---- 待办各节的**语义标记必须唯一**（2026-09-18 深夜加）----
  // 🔴 为什么报"错"而不是"提示"：**整个待办体系都靠标记定位那一节**（W6 明写"按标记找、别认序号"）——
  //    标记一重复，"该落哪一节"就没有确定答案了，而且**症状会出现在别处**
  //    （当天实测：§三 与 §四 都带 `[在办]`，一条"我能自己推"的待办被塞进了 §三「等你点头」；
  //     上一轮还以为"改取哪一端"能修好 —— 根因根本不在那一端）。
  //    机器完全能判（就是数一数），所以按"错"报，别让它靠人记得别写重。
  try {
    const dupes = sectionMarkDupes()
    if (dupes.length > 0) {
      const { file } = parseTodo()
      for (const d of dupes) {
        add(
          '错',
          rel(file),
          d.where[0].line,
          `待办各节的语义标记**重复**："[${d.mark}]" 出现在 ${d.where.map((w) => `第 ${w.line} 行`).join('、')} —— 标记是定位那一节的唯一依据，重复＝"该落哪一节"变成不确定`,
        )
      }
    }
  } catch (e) {
    add('提示', '（待办标记）', 0, `待办标记唯一性没查成（不影响其它检查）：${e}`)
  }

  // ---- 待办"**一条只写一件事**"（2026-09-19 用户点出 F22/F23 那条混装待办后加）----
  // 🔴 为什么落笔半已有闸门、这里还要查：**闸门只管机器写的那条路**，而**手工 `edit` 会绕过它** ——
  //    2026-09-19 那条就是这么进去的（50 多字、捆了两件事）。
  // 🔴 **2026-09-19 过一遍真档案后收窄**：第一版拿"并列信号"当主判据、又只排除了"归档"，
  //    于是把 **`[已决]`（不许再问）与 `[等条件]` 的决定存档也量了**（9 条里 7 条是它们）——
  //    那些"内容格"本来就承担着结论与判据，压短＝丢用户原话。现在**只量真待办那一档**
  //    （`findTodoTooLong` 里判的，与 `openItems()` 同一把尺子）。报"提示"不报"错"、且**只报一条汇总**。
  try {
    const tooLong = findTodoTooLong()
    if (tooLong.length > 0) {
      const { file } = parseTodo()
      const top = tooLong
        .slice(0, 3)
        .map((h) => `第 ${h.line} 行（${h.len} 字）`)
        .join('、')
      const mixed = tooLong.filter((h) => h.twoThings).length
      add(
        '提示',
        rel(file),
        tooLong[0].line,
        `待办里 **${tooLong.length} 条「内容」超过 40 字**（**只数 [自办]/[在办]/[拍板] 那一档** —— [已决]「不许再问」与 [等条件] 是决定存档，**不适用**这条）—— 最长的：${top}${mixed > 0 ? `；其中 ${mixed} 条还带并列信号（更像"两件事混成一条"）` : ''}。这些多半是**把调查数据/出处写进了内容格**：正解是**搬进 L3（或挪到「原因」格）**，内容格只留一句"要做什么"（W6）。🔴 **别为了压字删掉路径与数字**（用户 2026-09-19：不要为了这事丢失信息）。`,
      )
    }
  } catch (e) {
    add('提示', '（待办内容）', 0, `待办"一条只写一件事"没查成（不影响其它检查）：${e}`)
  }

  // 干活计数（2026-09-17）：体检是"机器替我干活"的典型 —— 它每次都说"0 错"，
  // 可**"0 错"和"它压根没跑"在日志里长得一样**。记一笔，才能区分这两件事。
  capTick('F5', `${issues.filter((x) => x.lv === '错').length} 错`)

  return issues
}

// ============================================================
// 带缓存的体检（2026-09-19 加 · 待办"节流提到扫描前；checkArchive 与闸门共用缓存"）
// ============================================================
//
// 病根（已量）：全档可扫 **51 份 / 1.39 MB**，而 `checkArchive()` 每次要把这些正文读好几遍
// （列数、两类死指针、索引对账、F13 路径锚点、F14 凭据各扫一遍）。
// 它被三处调用：**闸门 G2（每回合一次）** · 留意栏（F26，每步） · `dangan_check`（我手动）。
// 于是每回合白读 1~2 MB，只为确认"还是 0 错"。
//
// 原先只有 F26 自己按 5 分钟 TTL 缓存 —— 那是个坏交易：**档案在这 5 分钟里被改坏，没人看得见**。
// 现在缓存挪到体检这一侧（**单点**），判据换成 `archiveFingerprint()`（路径/大小/mtime 的汇总）：
// 档案一动就重算（不漏报），没动就直接复用（不空转）。

/** 体检结论复用上限 —— **主判据是"档案变没变"**，这个 TTL 只是兜底上限。 */
export const CHECK_CACHE_MS = 5 * 60 * 1000

let cachedVerdict = { fp: '', at: 0, issues: null }

/**
 * 带缓存的 `checkArchive()`。**档案没变**（指纹相同）且没过 TTL → 直接给上次那份结论。
 *
 * ⚠️ 指纹算不出来（`''`）时**绝不命中**缓存 —— "读不到"不能被当成"没变化"（"沉默 ≠ 正常"）。
 * ⚠️ 返回的是**同一份数组引用**（不是拷贝）：调用方都只读它（filter / some / map），别去改它。
 */
export function checkArchiveCached(now = Date.now()) {
  const fp = archiveFingerprint()
  if (fp && cachedVerdict.issues && cachedVerdict.fp === fp && now - cachedVerdict.at < CHECK_CACHE_MS) {
    capTick('F5', `缓存命中（${cachedVerdict.issues.filter((x) => x.lv === '错').length} 错）`)
    reportHealth(cachedVerdict.issues)
    return cachedVerdict.issues
  }
  const issues = checkArchive()
  cachedVerdict = { fp, at: now, issues }
  reportHealth(issues)
  return issues
}

/**
 * 🛡 **2026-10-22 加（机器闭环 · 第二步）**：把体检结论写成**机读状态**给安全总监看。
 *
 * ⚠️ **硬纪律：这里只"转写"已经算出来的 `issues`，绝不为了报状态再去扫一遍档案** ——
 *    那样就把"省"变成了"多花"（这一条写死在机器闭环那道关里）。
 * ⚠️ 它在**每次真跑完（或缓存命中）**时被调 —— **不是每轮**：体检本来就贵，按需跑。
 *    所以 `health/F5.json` 的 `at` 可能是几分钟前，**这正常**；"新鲜度"由考勤（F34）按"该每步跑的那几个"判。
 */
function reportHealth(issues) {
  try {
    const errs = issues.filter((x) => x.lv === '错').length
    const tips = issues.length - errs
    writeHealth('F5', errs === 0, `体检 ${errs} 错 · 提示 ${tips}`)
  } catch {
    /* 报不上自己，也不许把体检拖下水 */
  }
}

/**
 * 🔴 **2026-10-21 加（第二路审查报的"顶掉 30 天 122 次手动全档扫描"）**：
 * 把"上次体检是什么时候"露出来 —— `dangan_status` 要显示它，好让我知道那份结论新不新鲜。
 * ⚠️ `at === 0` 的意思是**本进程还没真跑过**（不是"刚跑过"）—— 显示时要说清。
 */
export function checkStamp() {
  return { at: cachedVerdict.at, fp: cachedVerdict.fp }
}

export function formatCheck(issues) {
  const errs = issues.filter((x) => x.lv === '错')
  const tips = issues.filter((x) => x.lv === '提示')
  const head = `【dangan_check】**${errs.length} 条要修** · 提示 ${tips.length} 条（只查机械可判的；口径冲突这类语义问题仍需人判）`
  if (issues.length === 0) {
    return `${head}\n机械项全部通过：T/E 编号连续无重 · 索引表与正文对齐 · 无裸条目 · 锚点都存在 · 引用文件与"见 X"编号都存在。`
  }
  return [head, '', ...issues.map((x) => `  ${x.lv} · ${x.file}${x.line ? `:${x.line}` : ''} · ${x.msg}`)].join('\n')
}

// 🔴 2026-10-15：**`reportF5Levels()` 已整块删除** —— 它是"启动自检"，报的是**时间轴的等级哨兵**
//    （读不到 / 有行没定级 / 全定级 三态）。时间轴随 L2 退役后，它**恒报"读不到时间轴（0 行）—— 异常"**
//    ⇒ 每轮启动都往控制台吐一条**永远为真的假告警**。判据本体随 L2 下线（用户："这是结构变化"）。

