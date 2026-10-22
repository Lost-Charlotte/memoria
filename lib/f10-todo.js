// ============================================================
// F10 · 待办（`dangan_todo`）—— 2026-09-17 凌晨建
// ============================================================
//
// 为什么有它（用户当天两句话）：
//   · "**你的待办全丢了。去找回来**" —— 我整轮把"还有什么要留意"只写在聊天里，一项都没进待办文件；
//   · "**先做待办相关的自动化吧。不然你老王（老是忘）**" —— 那就别靠我记。
//
// 所以这里做三件**机器能干**的事（判断仍然留给人）：
//   ① **读**：把待办文件里"还开着的"条目一次列清（不用我翻、不用我数）——`openItems()` / `formatTodoList()`
//   ② **写**：落档时给 `kind='待办'`，就**顺手把一行写进待办文件**（这是 W5 早就写着、却一直只"提醒"没实现的条件项）
//      —— `planTodoAdd()` 出改动，交给落笔半走那扇唯一的门
//   ③ **挑该消的**：机器能判的三类 → `todoStaleCandidates()`
//      · 已经打了 ✅ / 🔚 却还留在表里
//      · 条目里点名的那件事（T/E 号）**上游已经结案**，它自己还写着"欠着"
//      · 同一条待办出现两次
//
// ⚠️ **它不删行、不替你判断"这事算不算完了"**：它只把"看起来可以消的"挑出来摆到你眼前。
//    真消（移走/归档）还是判断活 —— 但**"忘了消"这件事从此有机器盯着**（这条是 W6 的"出"里唯一能自动化的部分）。

import { CFG, findByName, readTextSafe, rel } from './common.js'
import { TODO_PASS_ALERT, countTodoPasses, overPassedTodos, todoPassKey } from './f18-closing.js'

/** 待办文件（按名字找，别硬编码路径）。 */
export function todoFile() {
  // 🔴 2026-09-29：hint 从 `'待办'` 改成 `'工程-待办'` —— 改名后踩过的真坑：
  //    旧名 `待办-未完成事项.md` 靠"**前缀**"匹配命中（稳）；新名 `工程-待办.md` 不以"待办"开头
  //    ⇒ 前缀失效 ⇒ 退化成"**含**" ⇒ 撞上 `记录-2026-09-25-桌面规整与待办重排.md`（在 L3，排序在前）
  //    ⇒ `dangan_status` 报"读不到待办表"、落档报"找不到 [自办] 那一节" —— 实际是**读到了错的文件**。
  //    ⚠️ 名字就是接口（见 `f20-init.js` 的 `F` 表注释），所以 hint 必须跟着文件名走。
  return findByName('工程-待办')
}

/** 没转义的竖线才算分格（与体检同一套口径）。 */
// 🔴 **2026-09-26 起导出给 `f35-project.js` 用**（工程清单用的是同一套表格式）——
//    这四个小函数是「表怎么分格 / 哪一节算在办 / 一格算不算关掉」的**唯一实现**；
//    F35 要是各抄一份，就是本档案的头号病根（副本病）再长一个头。
export const cellsOf = (row) => row.split(/(?<!\\)\|/).map((s) => s.trim())
export const isSep = (s) => /^\|[\s:|-]+\|$/.test(s.trim())

/**
 * 「算不算"在办"的章节」。
 *
 * 🔴 **2026-09-18 起改用"标题末尾的语义标记"**（`[自办]` / `[在办]` / `[拍板]` / `[等条件]` / `[归档]` / `[已决]`…）——
 *   不再靠章节序号：**序号会随重排漂，标记不会**。
 *   旧口径（`§二/§三/§四之N` 才是在办）已随重排作废，只留兼容分支给老档案。
 */
export const isActionable = (title) =>
  // 🔴 **只认"标题末尾方括号里的标记"**（`[自办]` / `[在办]` / `[拍板]`）。
  //   ⚠️ **2026-09-18 深夜补 `[自办]`**：原来 §三（等你点头）与 §四（我能自己推）**都带 `[在办]`** ——
  //     标记不唯一，"最新那一节"就只能退化成"谁的最后一个恰好有行"这种副判据，
  //     于是 §四 一旦是空表就被跳过（当天实测：一条"我能自己推"的待办被塞进了 §三）。
  //     现在 §四 用**专属标记** `[自办]`，并加了"**各节标记必须唯一**"的体检判据（重复就报）。
  //   ⚠️ 2026-09-18 连栽两次，两次都是"关键词没钉在位置上"：
  //   ① 写 `/\[在办\]|\ ... /` 那种裸找 —— 说明文字里的同名二字也会命中；
  //   ② 留了个"兼容旧结构"的分支 `/^(二|三)、/` —— 它**救不了旧文件**（旧文件里 §二 本来就是在办，
  //      可 §三 也一样，判据并不更准），却**专门误伤新结构的 §二「等条件」**（标题也以"二、"打头）。
  //   → **留着一条不会响、只会误伤的判据，是负资产。** 已删（档案 2026-09-18 已重排完，不存在老文件）。
  //   🔴 **2026-09-19 补 `[长期]`**：写入侧 `planTodoAdd` 早就认"**长期（不论谁）→ `[长期]`**"（§长期 那一节），
  //     而这里**不认** → **长期待办写进去就查不到**（面板一条都不显示、`dangan_todo` 不报、留意栏不计）。
  //     又一个"**读写两把尺子**"（同族：2026-09-19 那次待办超长判据漏了 `s.actionable`）——
  //     写的时候落了 §长期，读的时候当它不存在，**写进去等于没写**。用户 2026-09-19 看面板当场抓出来的。
  /\[(在办|自办|拍板|长期)\]\s*$/.test(title)

/**
 * 一格内容算不算"已经关掉"（✅ / 🔚 / 删除线）。
 *
 * ⚠️ **2026-09-17 深夜放宽**（`clean` 在真档案上第二次验收时抓到的真 bug）：
 *   原来只认 `^✅`（**✅ 必须在这一格的最开头**）。而真档案里两条已办的是这样写的：
 *   `**① 指纹信号可疑** —— ✅ **…已查明并修好**` —— **✅ 在中间** → 被判成"还开着"，
 *   于是"已标完成却还挂着"这一整类**机器根本看不出来**（clean 报"没有该移出的"）。
 *   现在：`✅` / `🔚` **出现在这一格任何位置**都算（删除线仍是"以 `~~` 开头"）。
 *   🔴 **2026-09-18 又补一格（真机抓的）**：原来只查 `head`（事项）与 `c[2]`（卡在哪）**两格**，
 *     而把 ✅ 写在 **`c[3]`（怎么算结）** 里的就漏了 —— 当天实测：我给两条待办写了
 *     `…三步走完）。**✅ 2026-09-18 已完成**：11 份全部销账…`，`clean` **当场认不出**、它们继续赖在在办表里。
 *     判据是"**这一行是不是办完了**"，那就该看**整行**，不该挑格子。
 *   ⚠️ 代价（知道就好）：如果有条目**本身在讨论 ✅ 这种符号**，会被误判成已完成 ——
 *   实际待办里没这种写法；真出现时，把它写进"卡在哪"那一格（那格不参与判定）。
 */
export const isClosed = (cell) => /✅/.test(cell) || /🔚/.test(cell) || /^~~/.test(cell)

/**
 * 解析待办文件 → `{ file, sections: [{ title, line, rows: [...] }] }`。
 *
 * ⚠️ **只认"待办表"**，两层判据（2026-09-17 试跑当场抓到误报）：
 *   ① **必须是顶格的表**（待办表都顶格）—— 事故章节里那些"丢失文件清单"是**缩进表**（`  | 文件 | 原大小 |`），
 *      原来一律当待办收，于是报了"这条和第 145 行重复：文件"这种胡话；
 *   ② **表头的第一格必须是「事项 / 事情 / 待办」** —— 这样缩进与否都不重要，**看的是这张表是干什么的**。
 */
export function parseTodo() {
  const f = todoFile()
  if (!f) return { file: null, sections: [] }
  const L = readTextSafe(f).split(/\r?\n/)
  const sections = []
  let cur = null
  for (let i = 0; i < L.length; i++) {
    // ⚠️ 2026-09-18：**三级标题也要当章节边界** —— 原来只认 `## `，于是 `### 三之一、明细小表`
    //   底下的表被**并进了上一节**（当天的真档案实测：明细表的两行混进了"还开着"）。
    const h = L[i].match(/^(##|###)\s+(.*)$/)
    if (h) {
      // 🔴 **2026-09-18 修**：`isTodoTable` **必须每节重置** —— 原来它是跨节留着的，
      //   于是"前一节有表头、后一节只有一张没表头的表"时，后者会被误当成待办表解析
      //   （当天实测：§二 的"等条件"表被当成待办报出来，而它根本不是）。
      cur = { title: (h[2] ?? '').trim(), line: i + 1, actionable: isActionable((h[2] ?? '').trim()), isTodoTable: false, seqLed: false, rows: [] }
      sections.push(cur)
      continue
    }
    if (!cur) continue
    // ⚠️ 2026-09-17 晚修：**所有章节的表都要解析**（原来只解析"在办"章节，
    //    于是 §五「已解决并归档」那张表根本读不到 → 待办清理**找不到归档位置**，
    //    自动化就断在这一步）。"是不是在办"由 `actionable` 标记，由调用方决定要不要用。
    const s = L[i]
    if (!/^\|/.test(s)) continue // 顶格才算（缩进表不是待办表）
    if (isSep(s)) {
      // ⚠️ **2026-09-18 深夜记下分隔行**：表里**一行数据都没有**时（例如 §四 刚被清空），
      //    `insertAfter` 没有锚点可用 —— 只能用这一行。原来只存 `rows`，于是"目标节是空表"
      //    就等于"写不进去"，落档只好退到别的节去（当天实测：一条"我能自己推"的待办被塞进了 §三）。
      if (cur.isTodoTable && cur.sepLine == null) {
        cur.sepLine = i + 1
        cur.sepRaw = s
      }
      continue
    }
    const c = cellsOf(s)
    if (c.length < 4) continue
    const head = c[1]
    // 表头这一行：记住"这张表是不是待办表"，然后跳过它。
    // ⚠️ 2026-09-18：**也要认"序号列打头"的表**（`| # | 事项 | … |`）——
    //   当天重排后 §三 就是这种，判据只认"第一格是事项/事情/待办"时它整节被漏掉（真档案实测）。
    if (/^(内容|事项|事情|待办)/.test(head) || (/^(#|序号|编号)/.test(head) && /^(内容|事项|事情|待办)/.test(c[2] ?? ''))) {
      cur.isTodoTable = true
      // ⚠️ **"这张表是不是序号列打头"由表头说了算**（2026-09-18）——
      //   不能逐行去验"第一格长得像不像序号"：表头那一格写的是 `#`，而**数据行的第一格
      //   是 `1` / `2`**（阿拉伯数字）→ 逐行验必然认不出，于是 `item` 会变成"1"（当天实测踩到）。
      cur.seqLed = !/^(内容|事项|事情|待办)/.test(head)
      continue
    }
    if (!cur.isTodoTable) continue
    if (/^-+$/.test(head) || head === '') continue
    // ⚠️ **序号列打头时，"事项"在第 2 格**（`| # | 事项 | … |`）——
    //   直接拿 `head`（＝序号）当 item，会让查重去比"1 vs 2"、让报错说"这条重复：1"。
    const seqLed = cur.seqLed === true
    cur.rows.push({
      line: i + 1,
      // 🔴 **2026-09-18 用户定的三段**（当天傍晚原话〔E28〕："**待办内部分，"原因"写这件待办出现的原因
      //    "目的"写这个待办是为了达成什么目的。"内容"写具体需要修改什么。约束一下字数不要太长。**"）：
      //    ① `item` ＝ **内容** —— 具体要改什么（面板**折叠**时显示这一格）
      //    ② `why`  ＝ **原因** —— 这件事**怎么来的 / 为什么会出现**（含原始出处；面板**点开**时显示）
      //    ③ `goal` ＝ **目的** —— 做成之后**达成什么**（面板**点开**时显示）
      //    🔴 **"原因"为什么必须有**：2026-09-18 实测 —— 缺了它，"文案外置"从施工手册的
      //       "注入的协议文本与中文说明"一路漂成"全插件 1140 处中文"，**下一个人只能靠猜**。
      //    ⚠️ 字数上限由 `planTodoAdd()` 强制（内容 40 / 原因 60 / 目的 60）——"不要太长"是用户原话。
      //    ⚠️ 字段名 `why`/`goal` 是 **2026-09-18 从 `stuck`/`done` 改过来的**：旧名（"卡在哪 / 怎么算结"）
      //       与新语义完全不符，留着就是给下一个我埋雷。
      item: seqLed ? (c[2] ?? head) : head,
      why: c[seqLed ? 3 : 2] ?? '',
      goal: c[seqLed ? 4 : 3] ?? '',
      // ⚠️ **2026-09-18 修**：`closed` 原来只认 `head` / `c[2]` / `c[3]` 这三格 ——
      //   而真档案里每张待办表**都只有 3 列**（事项｜卡在哪｜怎么算结），所以其实只覆盖到
      //   `c[3]`（"怎么算结"）为止；当天实测：我把"已完成"写进**第 4 格**，`clean` 当场
      //   报"没有已标完成却还留着的条目"（**不是"不用清"，是"看不见"**）。
      //   改成**逐格看**（`c` 里每一格都查）—— 以后加列、或把 ✅ 挪到哪一列都认得。
      //   ⚠️ 代价（知道就好）：某个条目**本身在讨论 ✅ 这个符号**时会被误判成已完成；
      //   这正是原来只认前三格的原因，但它换来的是"真实写法全都漏掉"，两害相权取此。
      closed: c.some((cell) => isClosed(cell)),
      raw: s,
    })
  }
  return { file: f, sections }
}

/**
 * 🔴 **各节的语义标记必须唯一**（2026-09-18 深夜加）。
 *
 * 为什么单立一条：**整个待办体系都靠"标题末尾的标记"定位那一节**（W6 明写"按标记找、别认序号"）——
 *   标记一旦重复，"找哪一节"就变成不确定的事，而**错误会表现成别处的症状**
 *   （当天实测：§三 与 §四 都带 `[在办]`，一条"我能自己推"的待办被塞进了 §三「等你点头」；
 *   而 T266 那次还以为"改取哪一端"就能修好 —— 根因根本不在那一端）。
 * **机器能判**（就是数一数），所以交给体检，而不是靠我记得别写重。
 * @returns {Array<{mark:string, where:Array<{title:string,line:number}>}>}
 */
export function sectionMarkDupes() {
  const { sections } = parseTodo()
  const byMark = new Map()
  for (const s of sections) {
    const m = s.title.match(/\[([^\]]+)\]\s*$/)
    if (!m) continue
    const key = m[1]
    if (!byMark.has(key)) byMark.set(key, [])
    byMark.get(key).push({ title: s.title, line: s.line })
  }
  return [...byMark.entries()].filter(([, v]) => v.length > 1).map(([mark, where]) => ({ mark, where }))
}

/**
 * 🔴 **一条待办只写一件事** —— 体检用（2026-09-19 加）。
 *
 * 为什么落笔半已经有闸门，这里还要再查一遍：**闸门只管"机器写"那条路**
 *   （`planTodoAdd` 只被 `kind='待办'` 的落档调用），而**手工 `edit` 待办表会绕过它** ——
 *   2026-09-19 那条混装待办就是这么进去的：50 多字，把"确认 F23 写骨架"和"确认 F22 写骨架"
 *   捆成一行，结果 F23 验完了、整行却只能挂着（`clean` 判不了"半条完成"）。
 * 所以这里扫**已经躺在表里**的行（只看还开着的、非归档节），报出两类：
 *   · 事项格 **超 40 字** ＝ 绕过了落笔半的字数闸门
 *   · 事项格里出现**强并列信号**（编号斜杠 / 加号 / 以及·并且）＝ 像混装
 * 只报不改 —— "该不该拆"是判断，机器只负责"别让它烂在表里没人看见"（照 W6「出」的姿态）。
 * @returns {Array<{line:number, item:string, reason:string}>}
 */
export function findTodoTooLong() {
  const { sections } = parseTodo()
  // ⚠️ 并列信号只当**附注**，不当主判据 —— 2026-09-19 拿真档案试跑过：
  //    单靠信号会把 `（G2/G5 与 W0~W8）`（两套编号）、`(F22/F23)`（两条路都有这毛病）、
  //    `A ＋ B`（"含"的意思）全报成混装，14 条里大半是误报 —— 那就是"狼来了"（F25 的老账）。
  //    所以主判据用**"> 40 字"**：它既是 W6 定的硬规矩，也正是"混装"最常见的征兆
  //    （真混装那条 54 字）；信号只用来把"更像混装"的那几条挑出来说一句。
  const STRONG = [
    [/[A-Za-z]{1,3}\d+\s*\/\s*[A-Za-z]{0,3}\d+/, '编号斜杠并列（如 F22/F23）'],
    [/[＋+]/, '加号并列'],
    [/以及|并且/, '并列连接词（以及 / 并且）'],
  ]
  const hits = []
  for (const s of sections) {
    if (!s.isTodoTable) continue
    // 🔴 **只量"真待办"那一档**（`[自办]` / `[在办]` / `[拍板]`）—— 2026-09-19 过一遍真档案才发现的错：
    //    第一版只排除了"归档"，于是 **`[已决]`（不许再问）与 `[等条件]` 也被一起量了** —— 9 条里 7 条是它们。
    //    而那些**根本不是待办，是决定/禁令存档**："原因"格写的是结论（*不动* / *不做了* / *不锁，保持自动更新*），
    //    "目的"格写的是**用户原话** —— 要求它们"内容 ≤40 字"，就是逼着把用户原话和判据缩写掉，**那正是丢信息**。
    //    判据从此与 `openItems()` 用**同一把尺子**（`s.actionable`），不自己另立一套。
    if (!s.actionable) continue
    for (const r of s.rows) {
      if (r.closed) continue
      const it = String(r.item ?? '')
        .replace(/\*\*/g, '')
        .replace(/[✅🔚]/g, '')
        .trim()
      if (!it || it.length <= 40) continue // 主判据：> 40 字 ＝ 大概率绕过了落笔半的闸门
      const sig = STRONG.find(([re]) => re.test(it))
      hits.push({ line: r.line, item: it.slice(0, 44), len: it.length, twoThings: !!sig, signal: sig ? sig[1] : '' })
    }
  }
  return hits.sort((a, b) => b.len - a.len)
}

/** 所有"还开着"的条目（**只在"在办"章节里**，按文件里出现的顺序）。 */
/** **暂缓的待办**（`[等条件]` / `[搁置]` 那类）—— 2026-10-01 加。
 *  用户当天："**暂缓的工程和待办都不在梅洛莉亚的面板里显示，我需要他们能被显示。或许不用显示在第一级，可以做一个二级菜单放进去。**"
 *  ⇒ 面板那个"待办"窗格里原来只有 `openItems()`（还开着的三条），**"等条件·不催"那一档整个看不见**。
 *  ⚠️ **只收 `[等条件]` 一节**，且**不收已完成的**（用户当天第二条："**做完的不要显示了**"）。
 *  判据用**语义标记**（`[等条件]`），不认"§二"这种序号 —— 序号会随重排漂（W6 那条老规矩）。 */
export function pausedTodoItems() {
  const { file, sections } = parseTodo()
  const out = []
  for (const s of sections) {
    if (!/\[等条件\]/.test(s.title)) continue
    for (const r of s.rows) if (!r.closed) out.push({ ...r, section: s.title })
  }
  return { file, items: out }
}

export function openItems() {
  const { file, sections } = parseTodo()
  const out = []
  for (const s of sections) {
    if (!s.actionable) continue // ⚠️ §五（已归档）/ §〇（不许再问）那些不算"还开着"
    for (const r of s.rows) if (!r.closed) out.push({ ...r, section: s.title })
  }
  return { file, items: out }
}

// ============================================================
// 「⏰ 到点提醒」—— 2026-09-19 加
// ============================================================
// 起因（用户原话）："**如果最后这东西真的上线了。我需要你在待办里加一条，现实时间 9 月 19 日
//   下午 4 点过后提醒我让你自查**……因为咱们的上下文原文是始终没有被动过的，所以你一对比
//   就知道到底丢没丢信息了。"
//
// 为什么要机器来管：**在待办里写一行字，是靠不住的** —— 它躺在那儿，我每轮未必看得见"现在几点了"；
//   而"到点该提醒"这件事**本身完全可机械判**（读待办时顺手比一下时间，成本 ≈ 0）。
//
// 判据：条目文本里带 `⏰ <日期 时间>` 的 → **到点了由 F26 留意栏点名念一句**；
//       **没到点、或压根没带 ⏰ 的，一个字都不说**（照 F26 那条"干净就沉默"的纪律）。
// 写法：`⏰ 9/19 16:00`（当年默认）或 `⏰ 2026-09-19 16:00`（跨年时写全）。**本地时间**。

/**
 * 从一条待办文本里抠出 `⏰ <日期 时间>`；没有就返回 `null`。
 * @param {string} text
 * @param {Date} [now] 「没写年份」时用它补年
 * @returns {number|null} 毫秒时间戳（本地时间）
 */
export function parseDueAt(text, now = new Date()) {
  const m = /⏰\s*(?:(\d{4})\s*[-/])?(\d{1,2})\s*[-/]\s*(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(String(text ?? ''))
  if (!m) return null
  const y = m[1] ? Number(m[1]) : now.getFullYear()
  const t = new Date(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * 「到点该提醒」的待办：**带 ⏰ 且已经过了那个时刻**的、还开着的条目。
 * ⚠️ 只报"**已经到期**"，不报"还有多久到点" —— 留意栏只说留意，不说日程。
 * @returns {{file:string|null, items:Array<object>}}
 */
export function dueTodoItems(now = Date.now()) {
  const { file, items } = openItems()
  const out = []
  for (const r of items) {
    const text = String(r.item ?? '')
    const dueAt = parseDueAt(text, new Date(now))
    if (dueAt !== null && dueAt <= now) out.push({ ...r, dueAt, text })
  }
  return { file, items: out }
}

// ============================================================
// 「查重」—— 2026-09-17 晚加（用户："我觉得需要一个脚本来查重。每次都让你手动查重算什么。
//          我们要的是梅莫莉亚高度自动化。减少你在文档上分的心。不然要梅莫莉亚干嘛"）
// ============================================================
//
// 为什么原来的查重不够：它只是 `item.replace(/\s+/g,'')` 之后**字符串相等**才算重复。
// 而真实撞上的是**措辞不同**的同一条 —— 例如
//   `重启一次控制台 —— 让 0.23.0 真正生效`  vs  `重启一次控制台（0.23.0 生效）`
// 归一化之后仍不相等 → 漏判。**人工查重这种事本来就不该存在**（用户原话）。
//
// 所以这里换成**两把尺子**（保守：只报高置信的）：
//   ① 归一化之后**完全相同** → 必然重复（`exact`）
//   ② **同一开头**，或**一条几乎被另一条包含** → 同一件事（下面 `isSameTodo`）
//
// ⚠️ **2026-09-17 晚当场校准过两次，第一次的算法是错的、被样本打回来了**：
//   · 初版：二元组 **Jaccard ≥0.86** —— 对"一句话包住另一句话"太严，实体那两条"同一件事"
//     只算到 **14% / 29%**，照它判＝**永远查不出重复**（等于没做）。
//   · 二版：**Dice** ＋ "整段中文关键词覆盖" —— 关键词那步是错的：整段片段当关键词，
//     措辞一变（`代码指纹` vs `指纹信号`）匹配率就是 **0.00**。
//   · 定版：**二元组 Dice ＋ 单向覆盖率 ＋ 同开头**，其中后两个是**分情况的**：
//     **长句**比"Dice 或覆盖率高"，**短句**（"重启一次控制台"这种）比"前 N 字相同" ——
//     因为短句无论怎么算字面相似度都上不去，而**同一件事开头往往就是同一个对象**。
//   实测分界（详见 `tests/f10-todo.mjs` 里钉住的那组样本）：
//     正样本（同一件事） **38~82%** ｜ 负样本（不是一回事） **0~42%** —— 中间那段空地就是拿来分长短句的。

/** 判"同一件事"的几个数（都是**拿一组正/负样本试出来的**，不是拍的）。
 *  `tests/f10-todo.mjs` 里把那组样本钉住了 —— 改这里的任何一个数，那里会立刻说话。 */
export const TODO_DUP = {
  /** 长句：Dice（`2|A∩B|/(|A|+|B|)`，只算二元组）到多少算重复 */
  dice: 0.55,
  /** 覆盖（单字∪二元组，取两向大的那个）到多少算重复 */
  cover: 0.6,
  /** 覆盖到这个数、且**两条都够长**（≥12 字）→ 也算重复（"一句几乎被另一句包住"的情形） */
  coverLong: 0.5,
  /** 短句（<24 字）额外给一条路：前多少个字相同就算"同一个对象"（6 个字：`重启一次控制台` 够，`重启之后要…` 不够） */
  prefix: 6,
}

/**
 * 归一化：把"同一句话的不同写法"拉到同一形态。
 * ⚠️ **只做无语义的清洗**，绝不改写内容 —— 查重不能靠"翻译"，只能靠"擦掉装饰"。
 */
export function normalizeItem(s) {
  return String(s ?? '')
    .replace(/\*\*/g, '') // 粗体标记
    .replace(/[`*_~]/g, '') // 其它行内标记
    .replace(/^[\s\-—–·•]+/, '') // 行首的列表符号 / 破折号
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/：/g, ':')
    .replace(/[，。；！？、]["'“”‘’]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase()
}

/** 二元字组（中文按 2 字滑窗；单字串退化为它自己）。 */
export function bigrams(s) {
  const t = String(s ?? '')
  if (t.length <= 1) return new Set(t ? [t] : [])
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}

/** 剥掉 `⏰ …` 那一小段（**只用于判重**）—— 2026-09-19 用户定：
 *  闹钟本身一定是他要我设的，时间与前因后果都经他亲手交办，**等于每一条都经他亲自批准**；
 *  而且他随时能在控制台里看到。所以"两条都带 `⏰ 9/19 16:00`"**不算重复** ——
 *  曾因此把"体检明细按需 复查"误判成"三档裁剪丢没丢信息 自查"的重复
 *  （两条只差开头那 13 个字，`samePrefix` 直接命中，Dice 才 37%）。
 *
 * 🔴 **2026-09-19 03:42 修**：原来这一天里"日"的分隔符写成**必填**（`\d{1,2}[-/]\d{1,2}`），
 *  于是**认不出短写法 `⏰ 9/19 16:00`**（只有一个斜杠）—— 而待办里真在用的**正是短写法**
 *  （`parseDueAt` 靠正则回溯歪打正着能认，这个剥离器认不出）→ 用户那条"查重不管闹钟"**实际没生效**，
 *  体检一直把 119/120 两行报成重复。现在分隔符改成**可选**，两种写法都认：
 *  `⏰ 9/19 16:00` · `⏰ 2026-09-19 16:00` · `⏰ 2026/9/19 16:00`。 */
const stripDue = (s) => String(s ?? '').replace(/⏰\s*\d{1,4}[-/]\d{1,2}(?:[-/]\d{1,2})?(?:\s+\d{1,2}:\d{2})?/g, '')

/** Dice 系数（`2|A∩B| / (|A|+|B|)`）：对"一句话包住另一句话"比 Jaccard 宽容得多，正是这里要的。 */
export function similarity(a, b) {
  a = stripDue(a)
  b = stripDue(b)
  const A = bigrams(normalizeItem(a))
  const B = bigrams(normalizeItem(b))
  if (A.size === 0 && B.size === 0) return 1
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return (2 * inter) / (A.size + B.size)
}

/**
 * 关键词 token 集合：**单字 ∪ 二元组**。
 * 为什么要加单字：中文短句（"重启一次控制台"这种）**把后半句改掉**以后，二元组重合度会掉到 25% 上下，
 * 只按二元组判＝**永远漏判**；而单字层看得出"这条讲的是同一个对象"。
 * ⚠️ 加单字会抬高**所有**中文条目的基线分 → 阈值必须跟着抬（见 `TODO_DUP.cover`，实测负样本封顶 0.43）。
 */
export function tokensOf(s) {
  const n = normalizeItem(s)
  const out = new Set(bigrams(n))
  for (const ch of n) out.add(ch)
  return out
}

/** 单向覆盖：A 的 token 有多大比例出现在 B 里（取两向大的那个在调用处做）。 */
export function coverage(a, b) {
  const A = tokensOf(a)
  if (A.size === 0) return 0
  const B = tokensOf(b)
  let hit = 0
  for (const x of A) if (B.has(x)) hit += 1
  return hit / A.size
}

/**
 * 判两条是不是"同一件事"——**三条路，命中一条就算**（阈值全是拿正/负样本试出来的）：
 *   ① `exact`：归一化后完全相同
 *   ② 覆盖：`cover ≥ 0.6`，或"两条都够长且覆盖 ≥ 0.5"
 *   ③ **短句专线**：两条都 ≥8 字、**前 6 字相同** —— 同一件事开头往往就是**同一个对象**
 *      （"重启一次控制台……" 无论后半句怎么写，都是同一件事）
 * ⚠️ 只报高置信的：**宁可漏报**（多一条待办不致命），**不可误报**（会把该记的事挡住）。
 */
export function isSameTodo(a, b) {
  // 🔴 2026-09-19 03:43 修：这里原来**没剥闹钟**（只有 `similarity` 剥了）——
  //    于是"两条都带 `⏰ 9/19 16:00`"照样被 `samePrefix`（前 6 字相同）判成重复，
  //    用户那条"查重不检查闹钟"在这条主干上等于没生效。现在**三个入口一个判据**。
  const na = normalizeItem(stripDue(a))
  const nb = normalizeItem(stripDue(b))
  if (na === nb) return { same: true, exact: true, score: 1, dice: 1, cover: 1, why: '完全相同' }
  const A = bigrams(na)
  const B = bigrams(nb)
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  const dice = A.size + B.size === 0 ? 0 : (2 * inter) / (A.size + B.size)
  const cover = Math.max(coverage(a, b), coverage(b, a))
  const pre = TODO_DUP.prefix
  const samePrefix = na.length >= pre && nb.length >= pre && na.slice(0, pre) === nb.slice(0, pre)
  const long = Math.min(na.length, nb.length) >= 12
  const byCover = cover >= TODO_DUP.cover || (long && cover >= TODO_DUP.coverLong)
  const same = samePrefix || dice >= TODO_DUP.dice || byCover
  const why = !same ? '' : samePrefix && !byCover && dice < TODO_DUP.dice ? `前 ${pre} 字相同（同一个对象）` : byCover && dice < TODO_DUP.dice ? '一句几乎被另一句包住' : '措辞高度接近'
  return { same, exact: false, score: Math.max(dice, cover, samePrefix ? 0.75 : 0), dice, cover, samePrefix, why }
}

/**
 * 这条"新待办"是不是表里已经有了？
 * ⚠️ **只跟"还开着"的条目比** —— 已经打 ✅ / 🔚 归档的那条不算（那正是"做完了又记一遍"）。
 * @returns {Array<{line:number,item:string,score:number,dice:number,cover:number,exact:boolean}>} 按分数降序
 */
export function findTodoDuplicates(item) {
  const { items } = openItems()
  if (normalizeItem(item).length === 0) return []
  const hits = []
  for (const it of items) {
    const r = isSameTodo(item, it.item)
    if (r.same) hits.push({ line: it.line, item: it.item, score: r.score, dice: r.dice, cover: r.cover, exact: r.exact, section: it.section })
  }
  return hits.sort((x, y) => y.score - x.score)
}

/**
 * 表内**互查重**（`dangan_todo check` 用）：两两比，只报每一对一次。
 * ⚠️ 取代原来那条"归一化后字符串相等"的弱判据（措辞不同的重复它看不见）。
 */
export function todoSelfDuplicates() {
  const { items } = openItems()
  const out = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const r = isSameTodo(items[i].item, items[j].item)
      if (r.same) out.push({ line: items[j].line, otherLine: items[i].line, score: r.score, dice: r.dice, cover: r.cover, exact: r.exact, item: items[j].item })
    }
  }
  return out
}

/** 给模型看的紧凑清单。 */
export function formatTodoList() {
  const { file, items } = openItems()
  if (!file) return '【dangan_todo】找不到"待办"文件（名字里含「待办」的那份）'
  if (items.length === 0) return `【dangan_todo】待办文件里**没有还开着的条目**（${rel(file)}）—— 干净`
  // ⚠️ 2026-09-17 下午加（用户点的）：**真给我看清单这一刻，就是"过了一遍"** —— 给每条记一笔
  //    （同一天只记一次，免得一个会话里刷成几十遍）。过了 5 遍仍开着的，下面会点名。
  const passes = countTodoPasses(items)
  const over = (it) => (passes.get(todoPassKey(it.item)) ?? 0) >= TODO_PASS_ALERT
  const bySec = new Map()
  for (const it of items) {
    if (!bySec.has(it.section)) bySec.set(it.section, [])
    bySec.get(it.section).push(it)
  }
  const L = [`【dangan_todo】还开着 **${items.length} 条**（${rel(file)}；按章节列，行号可去对原文）`]
  for (const [sec, rows] of bySec) {
    L.push('')
    L.push(`▌${sec}`)
    for (const r of rows) {
      const mark = over(r) ? `　⏳ **已经过了 ${passes.get(todoPassKey(r.item))} 遍仍未动 —— 该主动问用户"做不做/还做吗"**` : ''
      L.push(
        `  · ${r.item}${mark}` +
          (r.why && r.why !== '—' ? `\n      原因：${r.why.slice(0, 160)}` : '') +
          (r.goal && r.goal !== '—' ? `\n      目的：${r.goal.slice(0, 160)}` : ''),
      )
    }
  }
  // 🔴 2026-09-25 修（第二处）：这里原来传的是 `passes.keys()` —— 那是**整本账**的键
  //    （`countTodoPasses` 返回 `s.todos` 的**全部**键，含早已销掉的），等于没过滤。
  //    实测症状：`dangan_status` 说"5 条过了 5 遍"，而 `dangan_todo` 说"12 条" —— 两处对不上。
  //    要传的是**这一次列出来的**（＝当前还开着的）。
  const n = overPassedTodos(TODO_PASS_ALERT, items.map((x) => todoPassKey(x.item))).length
  if (n > 0) L.push('', `⚠️ 其中 **${n} 条**已经过了 ${TODO_PASS_ALERT} 遍仍未动 —— 按用户 2026-09-17 的话："**你老批也会烦啊，或许你就会主动问了呢**"。`)
  // 🔴 **2026-09-28 加（用户当天定"加吧"）：`[等条件]` 那一档也要看得见。**
  //    它一直不在 `isActionable` 里 —— 那是**有意**的（免得被"过 N 遍就催"和字数检查量进去：
  //    2026-09-19 实测「`[已决]` 与 `[等条件]` 也被一起量了 —— 9 条里 7 条是它们」）。
  //    但结果成了**它在面板 / list 里永远不出现**，用户原话：「我记忆里待办里还有不少这种有前置条件的，
  //    但最后好像都被你挪到我在面板上看不到的地方去了。你查查。」
  //    ⇒ 这里**单开一档**：**看得见、但不催**（不参与 passes 计数，也不计入上面那句"还开着 N 条"）。
  {
    const { sections } = parseTodo()
    for (const s of sections.filter((x) => /\[等条件\]/.test(x.title) && x.rows.length > 0)) {
      const head = s.title.replace(/\s*\[等条件\]\s*$/, '')
      L.push('')
      L.push(`▌${head}　【等条件 · **不催**】${s.rows.length} 条 —— 条件一到我主动来办；**不计入**上面那句"还开着"`)
      for (const r of s.rows) {
        L.push(
          `  · ${r.item}` +
            (r.why && r.why !== '—' ? `\n      原因：${r.why.slice(0, 160)}` : '') +
            (r.goal && r.goal !== '—' ? `\n      目的：${r.goal.slice(0, 160)}` : ''),
        )
      }
    }
  }
  return L.join('\n')
}

/**
 * 机器能判的三类"该消的"，`dangan_check` 会带上它。
 * ⚠️ 全是**提示**，不是错 —— "算不算完"是判断，机器只负责别让它烂在表里。
 */
/** 时间轴那一行的日期（`| ⭐ | **T1044** | 2026-10-08 22:16 | 摘掉 索引 与 地图 |`）。 */
const TIMELINE_DATE_RE = /\|\s*\*{0,2}T\d+\*{0,2}\s*\|\s*(\d{4}-\d{2}-\d{2})/

/** 别拿模板话当特征（「用户」「拍板」「待办」… 哪条都带）。 */
/**
 * 待办这条**是不是已经在时间轴里留了"做完"的痕**。
 *
 * 🔴 **为什么要它（2026-10-09 实测的真缺陷）**：本函数原来只有两条反查路 ——
 *    ① 表里自己标了 `✅`／`🔚`；② 条目里**点名了 `E`／`T` 号**、且那个号上游已结案。
 *    而真档案里躺着一条「定「索引 / 地图」要不要摘出必读读序」—— **10-08 22:16 就办完了**
 *    （读序改成 ①→⑥ · 落 T1044），**条目里一个号都没写** ⇒ 两条路都够不着
 *    ⇒ `check` 报"干净"，它**挂到第二天**，是用户看留意栏当场问出来的。
 *
 * ⚠️ **判据的姿态（写给未来的我）**：它只出**提示**，永远不替人判"算不算完"（W6 边界）。
 *    为了别把噪声刷满，要求：**≥3 个特征词** 且 **覆盖率 ≥ 60%**，
 *    且那一行**日期不早于**待办落笔处之前那一行的日期（防把"还没办时写的计划"当证据）。
 */
// 🔴 2026-10-15：**`timelineDoneHint()` 已整块删除** —— 它拿待办的特征词去**时间轴**反查"这件事办过没有"，
//    而时间轴随 L2 退役 ⇒ `findByName('时间轴')` 恒 null ⇒ 恒返回 null。
//    （那条"该消的"判据随之从 `todoStaleCandidates()` 里去掉，见下。）


export function todoStaleCandidates() {
  const { file, sections } = parseTodo()
  if (!file) return []
  const out = []
  // 🔴 2026-10-15：`ev` / `anchorsOf` 两个索引随 L2 退役删除 —— 它们建自 `eventList()`（读**事件表**），
  //    而事件表已不在档案里 ⇒ 两个 Map 恒空 ⇒ 下面②④两条判据本来就已经够不着东西。

  for (const s of sections) {
    if (!s.actionable) continue // ⚠️ 只查"在办"章节（§五 里那些已经归档的不算问题）
    for (const r of s.rows) {
      // ① 已经关了却还在表里
      if (r.closed) {
        out.push({ lv: '提示', line: r.line, msg: `待办里这行已经标了完成（✅/🔚）却还留在表里 —— 按 W6 的"出"，该移走或归档：${r.item.slice(0, 40)}` })
      }
      // 🔴 2026-10-15：「② 上游已经结案」与「④ 拿特征词去时间轴反查」**两条判据随 L2 退役删除** ——
      //    ② 要读事件表里那条 E 的状态、④ 要读时间轴（两者都不在了）。
      //    留下的两条**不依赖 L2**：① 「已标完成却还留着」· ③ 「同一条出现两次」（见下）。

    }
  }
  // ③ 同一条出现两次 —— ⚠️ 2026-09-17 晚换成**相似度判据**（原来只是"归一化后字符串相等"，
  //    于是"措辞不同"的同一条漏判；而人工查重本来就不该存在）。
  for (const d of todoSelfDuplicates()) {
    // 🔴 **2026-09-23：占位符不算"同一件事"** —— 骨架建出来的待办表有 8 个空节，每节都写一行
    //    `| （还没有） | | |`，于是这条判据把"**8 个空表的占位符**"报成"重复"。
    //    那不是"同一件事出现了两次"，是"**这些节都还空着**" ⇒ 跳过。
    //    （`dangan_init` 开箱验收实测撞上：明明 0 错，却挂着一条永远消不掉的提示。）
    if (/^[（(]\s*(还?没有|暂无|空|待填)\s*[)）]$/.test(String(d.item ?? '').trim())) continue
    out.push({
      lv: '提示',
      line: d.line,
      msg: `待办第 ${d.line} 行与第 ${d.otherLine} 行**重复（是同一件事）**（${d.exact ? '措辞完全相同' : `Dice ${(d.dice * 100).toFixed(0)}% / 覆盖 ${(d.cover * 100).toFixed(0)}%`}）—— 按 W6 只留一处：${d.item.slice(0, 40)}`,
    })
  }
  return out
}

/**
 * 出一行待办要落的改动（**插到最新的那一节「四之N」的表尾**）。
 *
 * 为什么插那里：这份文件是按"第几批"分节的（四之四 / 四之五 / 四之六…），
 * **最新那一节就是"现在还欠着的"**；新条目跟着它走，不用另起结构、也不用我记插哪。
 * ⚠️ 找不到那种节 → 直接抛错（**不猜**：宁可让我手写一行，也不插到错的节里）。
 *
 * 🔁 **2026-09-17 晚起自带查重**（用户："每次都让你手动查重算什么……不然要梅莫莉亚干嘛"）：
 *   写之前先跟"还开着的"条目比一遍（**完全相同** 或 **Dice/覆盖/同开头** 命中）——
 *   命中就**不写**，返回 `{ skip:true, hits }`。为什么是"不写"而不是"抛错"：
 *   落档是一次调用一个事务，抛错会把整次落档（时间轴那一行、事件条目）一起毁掉；
 *   而"这件事已经欠着了"的正确语义就是 **幂等** —— 已经记过，不需要再记一遍。
 *   确实要重复登记时，调用方给 `force:true`（对应 `dangan_log todoForce:true`）。
 */
export function planTodoAdd({ item, why, goal, term, owner, force = false } = {}) {
  // 归一化：去掉调用方可能已经带上的 `**`，再统一加一次 —— 否则会写出 `****新欠的事****`
  const it = String(item ?? '').replace(/\*\*/g, '').trim()
  if (!it) throw new Error('待办：事项不能为空')
  if (it.includes('|')) throw new Error('待办：事项里不能有竖线（会把表切断）')
  const { file, sections } = parseTodo()
  if (!file) throw new Error('待办：档案里找不到"待办"文件（名字里含「待办」的那份）')

  // ① 查重（机器做掉，不靠人）
  if (!force) {
    const hits = findTodoDuplicates(it)
    if (hits.length > 0) {
      return {
        skip: true,
        hits,
        where: `已有：第 ${hits.map((h) => h.line).join('、')} 行`,
        why: hits[0].exact
          ? `待办里**已经有这一条**（第 ${hits[0].line} 行，措辞完全相同）—— 不重复写`
          : `待办里**已经有这一条**了（第 ${hits[0].line} 行：Dice ${(hits[0].dice * 100).toFixed(0)}% / 关键词覆盖 ${(hits[0].cover * 100).toFixed(0)}%）—— 不重复写`,
      }
    }
  }

  // ⚠️ 挑"那一节"的判据要**同时**满足：**是能收待办的那一档** 且那节里**真有待办表**。
  //   只按标题挑会踩坑：旧结构里 §四之三（事故那节）的表是"丢失文件清单"（不是待办表）→
  //   选中它就等于把新待办插进事故清单里。**所以判据用 `isTodoTable`**（那节里出现过"事项"表头）。
  // 🔴 **不用 `rows.length > 0`**（2026-09-18 深夜修）：那判的是"表里恰好还有行"，
  //   会把**刚被清空的节**排除掉 —— 真机实测：§四（我能自己推）刚清空 → 被跳过 →
  //   一条"我自己能推"的待办被塞进了 §三（等你点头）。空表现在靠 `sepLine`（分隔行）当锚点，
  //   "写不进去"这个理由不存在了。
  // 🔴 **分档取**：`[自办]`（我能自己推，**默认**）→ `[在办]` → `[拍板]`。
  //   ⚠️ 为什么要有 `[自办]` 这个**专属**标记：原来 §三 与 §四 **都带 `[在办]`** —— 标记一重复，
  //   "最新那一节"就只剩"谁的最后一个恰好有行"这种副判据，定位不确定。
  //   现在每节标记唯一，`dangan_check` 也会查这一条（`sectionMarkDupes`）。
  // 🔴 **2026-09-18 用户定的"半自动化落点"**（原话："**或许只需要你选择是否短期，需要我决定还是你可以自己推进。
  //    然后自动化会将这件待办自动放入它该去的地方。**"）：
  //    · `term` ∈ {短期, 长期} · `owner` ∈ {我, 用户}
  //    · 落点：**短期＋我 → `[自办]`** · **短期＋用户 → `[拍板]`** · **长期（不论谁）→ `[长期]`**
  //    ⚠️ 选节**只认标题末尾的语义标记**（序号会随重排漂）；标记不在、或那节里没有待办表 → **报错，不猜**。
  const termTxt = String(term ?? '短期').trim()
  const ownerTxt = String(owner ?? '我').trim()
  const isLong = /长期|不急|以后/.test(termTxt)
  const needUser = /用户|他|你/.test(ownerTxt)
  // ⚠️ `[在办]` 是**老档案的通用在办节**（§三「短期 · 等你点头」）—— 按用户的"两问"它不再是独立落点，
  //    但它还躺在真档案里；所以**只把它当兜底**（优先 `[自办]`／`[拍板]`，那两节不在时才退它）。
  const prefer = isLong ? ['[长期]'] : needUser ? ['[拍板]', '[在办]'] : ['[自办]', '[在办]']
  let target = null
  for (const mk of prefer) {
    const hit = sections.filter((s) => s.isTodoTable && s.title.includes(mk))
    if (hit.length > 0) {
      target = hit[hit.length - 1]
      break
    }
  }
  if (!target) {
    throw new Error(
      `待办：找不到能收它的那一节（想要 \`${prefer[0]}\`；term=${termTxt} · owner=${ownerTxt}）—— 不猜，先建那一节、或手工加一行`,
    )
  }
  // 锚点：优先表尾那一行；**空表（一行数据都没有）用分隔行** —— 否则 insertAfter 没有落点。
  const lastRow =
    target.rows.length > 0 ? target.rows[target.rows.length - 1] : { line: target.sepLine, raw: target.sepRaw }
  if (!lastRow || !lastRow.line) {
    throw new Error('待办：目标那一节是**空表**、连分隔行都没读到 —— 不猜，手工加一行吧')
  }
  // 🔴 **三段 ＋ 字数上限**（用户 2026-09-18："内容"写具体需要修改什么 · "原因"写这件待办出现的原因 ·
  //    "目的"写为了达成什么目的 · **约束一下字数不要太长**）。
  //    ⚠️ 格子里**不许有真换行**（会把整行切断）—— 要分行就写 `<br>`；**不许有竖线**（会把表切断）。
  const LIMIT = { 内容: 40, 原因: 60, 目的: 60 }
  const bad = []
  const chk = (label, v) => {
    const s = String(v ?? '')
    if (s.length > LIMIT[label]) bad.push(`${label} ${s.length} 字 > ${LIMIT[label]}`)
    if (s.includes('|')) bad.push(`${label}里有竖线`)
    if (/[\r\n]/.test(s)) bad.push(`${label}里有真换行（要分行请用 <br>）`)
  }
  chk('内容', it)
  chk('原因', why)
  chk('目的', goal)
  if (bad.length > 0) throw new Error(`待办：写法不合规（${bad.join(' · ')}）—— 用户要求"字数不要太长"，请压缩后重写`)

  // 🔴 **一条待办只写一件事**（2026-09-19 用户点出来的：那条 F22/F23 混装待办）
  //   为什么必须有机器闸门：混装的下场是"**完成一半却整条挂着**" —— 而 `dangan_todo clean`
  //   只看"这一行自己标没标完成"，半条完成它判不了；人一顺手就把整条销掉，另一半跟着没了。
  //   两档（**只对"内容"判** —— 原因/目的里出现并列词是正常叙述）：
  //     · **强信号**（几乎必然是混装）→ **拒收**（与字数超限同一档"写法不合规"）
  //     · **弱信号**（很可能只是一件事的名字里带"和/、/与"）→ **放行，但在回执里点一句**
  const STRONG_TWO_THINGS = [
    [/[A-Za-z]{1,3}\d+\s*\/\s*[A-Za-z]{0,3}\d+/, '编号斜杠并列（如 F22/F23、T391/T392）'],
    [/[＋+]/, '加号并列（如 F23＋测试）'],
    [/以及|并且/, '并列连接词（以及 / 并且）'],
  ]
  for (const [re, label] of STRONG_TWO_THINGS) {
    if (re.test(it)) {
      throw new Error(
        `待办：**一条只写一件事** —— 内容里出现${label}，像是把多件事混成了一行。请拆成几条各写（用户 2026-09-19 定，见《使用说明》W6）`,
      )
    }
  }
  const WEAK_TWO_THINGS = [
    [/、/, '顿号并列'],
    [/[和与]/, '"和 / 与"'],
    [/同时|顺便/, '"同时 / 顺便"'],
  ]
  const weakHits = WEAK_TWO_THINGS.filter(([re]) => re.test(it)).map(([, label]) => label)

  const text = `| **${it}** | ${String(why ?? '').trim() || '（待补：原因）'} | ${String(goal ?? '').trim() || '（待补：目的）'} |`
  return {
    op: { op: 'insertAfter', file: rel(file), line: lastRow.line, text, expect: lastRow.raw },
    where: `§${target.title.slice(0, 28)}（第 ${lastRow.line} 行之后）`,
    text,
    ...(weakHits.length > 0
      ? { warn: `待办：内容里有${weakHits.join(' / ')} —— 若其实是两件事，请拆成两条（"一条只写一件事"，W6）` }
      : {}),
  }
}

// ============================================================
// 「出」—— 把该消的**自动移出在办表 + 归档**（2026-09-17 晚补的最后一公里）
// ============================================================
//
// 用户当天问得很准："**待办我记得不是已经自动化了吗？我要的不是你老去自己看那些地方，
// 要的是能自动化，你看看是什么原因导致自动化没成功。**"
//
// 🔴 **诊断结论（原来为什么没成）**：`list` / `check` **两个都是只读的** ——
//    W6 写的是"**打 ✅ 后把那一行移进 §五**"，而**"移出"那一步我留给了人**：
//    机器能挑出"已标完成还挂着"，但它只**报**，不动手 → 于是我每次还得自己去看、自己去删。
//    **这就是"半自动化"掉回"人肉"的那个缺口。**
//
// 现在：**判得准的那一类（已标 ✅/🔚）由机器直接移出并归档**。
//   · 判据保守：**只动 `closed` 的行**（作者自己打了完成标记）—— 这是唯一"机器能确定"的一类；
//     "重复""上游已结案"只报**不自动删**（那两种会误伤：重复可能是两件事、上游结案不等于这事了结）；
//   · 动作＝**删那一行 + 往 §五 追加一行归档**（信息不丢：原样搬进 §五）；
//   · 走的是**同一扇门**（内核 `改档.mjs --txn`，由 `f9-commit.runTxnOps` 调），先快照、可回滚；
//   · **幂等**：归档行里带 `[清 <日期>]` 标记，第二次跑不会重复归档。

const CLEAN_MARK = (d) => `[清 ${d}]`

/** 🔴 2026-10-16：已了结条目的归档件 —— 从 `工程-待办.md` 的 `[归档]` 节搬出来（用户定"L4 只留没做完的"）。 */
export const TODO_ARCHIVE_FILE = 'L8-施工归档\\待办归档\\待办归档.md'

/** 归档件里**表尾那一行**的行号（`|` 开头的最后一行）；读不到 / 没有表格 ⇒ null。 */
function todoArchiveTailLine() {
  const text = readTextSafe(`${CFG.archiveDir}\\${TODO_ARCHIVE_FILE}`)
  if (text.length === 0) return null
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) if (/^\|/.test(lines[i] ?? '')) return i + 1
  return null
}

/**
 * 算"该移出哪些行"（**纯计划，不落笔**）。
 * @returns {{file:string|null, moves:Array<{line:number,item:string,raw:string,note:string}>, archiveLine:number|null, archiveSection:string|null}}
 */
export function todoPlanClean() {
  const { file, sections } = parseTodo()
  if (!file) return { file: null, moves: [], archiveLine: null, archiveSection: null }
  // `[归档]` 标记认归档区（**2026-09-18 起改用语义标记**）。
  //   🔴 原来还有个 `/^五、/` 的兜底 —— **它在新结构里会咬人**：§五 现在是"需要你拍板"，
  //   于是 `clean` 差点把归档行追加到"需要你拍板"那一节去（当天在测试样本上抓到）。
  //   **旧结构的兜底一律删掉**：档案已重排完，留着就是给新结构埋雷。
  const archiveSec = sections.find((s) => /\[归档\]/.test(s.title) && s.rows.length > 0)
  const moves = []
  for (const s of sections) {
    // 🔴 **2026-09-28 改（用户当天定"加吧"＋"ab 销了吧"）：`[等条件]` 那一档也要能销。**
    //    原来这里只认 `actionable`（`[自办]` / `[在办]` / `[拍板]` / `[长期]`），而 `[等条件]` 天生不在其中
    //    ⇒ **它既不出现在 `list`、也永远清不掉** —— 用户原话：「我记忆里待办里还有不少这种有前置条件的，
    //    但最后好像都被你挪到我在面板上看不到的地方去了。你查查。」
    //    ⚠️ 只**多加这一档**；`[归档]` / `[已决]` 仍然不是"该移出的"。
    if (!s.actionable && !/\[等条件\]/.test(s.title)) continue
    for (const r of s.rows) {
      // ⚠️ **只动"作者自己标了完成"的那类**（唯一机器能确定的一类）
      if (r.closed) moves.push({ line: r.line, item: r.item, raw: r.raw, note: r.why?.slice(0, 60) ?? '', section: s.title })
    }
  }
  // 归档区找表尾（往里追加）—— 用上面那个 `archiveSec`，**不再另算一遍**（两处判据会漂）
  return {
    file,
    moves,
    archiveLine: archiveSec ? archiveSec.rows[archiveSec.rows.length - 1].line : null,
    archiveSection: archiveSec ? archiveSec.title : null,
  }
}

/**
 * 把清理计划做成**事务 ops**（交给 `f9-commit.runTxnOps` 去落 —— 不在这儿自己写档案）。
 * @param {{date?:string, plan?:object}} opt
 */
export function todoCleanOps({ date, plan } = {}) {
  const p = plan ?? todoPlanClean()
  if (!p.file) throw new Error('待办：找不到待办文件')
  if (p.moves.length === 0) return { ops: [], plan: p, note: '没有"已标完成还挂着"的，不用清' }
  // 🔴 **2026-10-16**：归档行**不再往 `工程-待办.md` 的 `[归档]` 节追加**（用户当天定：「已经办完的不该留在待办里，
  //   否则你读到会混乱。**L4 仅保留还没做完的**」）⇒ 改往 `L8-施工归档\待办归档\待办归档.md` 的**表尾**追加。
  const arcLine = todoArchiveTailLine()
  if (arcLine == null) {
    throw new Error(`待办：归档件读不到或没有表格 —— \`${TODO_ARCHIVE_FILE}\` 不猜，先建好它（带表头）再清`)
  }
  const d = date ?? new Date().toISOString().slice(0, 10)
  const mark = CLEAN_MARK(d)
  const ops = []
  // ① 删那几行（每行都带 expect＝原样那一行，别人动过就停手）
  for (const m of p.moves) ops.push({ op: 'deleteLine', file: rel(p.file), line: m.line, expect: m.raw })
  // ② 往**归档件**表尾追加归档行（原样搬进去，信息不丢）
  for (const m of p.moves) {
    const it = m.item.replace(/\s*[✅🔚]+\s*/g, '').replace(/\*\*/g, '').trim()
    const doneTxt = `✅ 已办（${mark} 自动移出）：原表里标着完成${m.note && m.note !== '—' ? `；卡点原记：${m.note}` : ''}`
    ops.push({ op: 'insertAfter', file: TODO_ARCHIVE_FILE, line: arcLine, text: `| ${it} | ${doneTxt} | L4-施工\\工程-待办.md · 自动移出 ${mark} |`, expect: undefined })
  }
  return { ops, plan: p, note: `移出 ${p.moves.length} 条到 ${TODO_ARCHIVE_FILE}（${mark}）`, mark }
}

/** 给模型看的清理预览。 */
export function formatCleanPlan(p = todoPlanClean(), opts = {}) {
  if (!p.file) return '【dangan_todo · clean】找不到待办文件'
  if (p.moves.length === 0) return '【dangan_todo · clean】没有"已标完成（✅/🔚）却还留在在办表里"的条目 —— 不用清'
  const L = [`【dangan_todo · clean】${opts.applied ? '✅ 已移出' : '🔎 干跑（一个字都没写）'} —— ${p.moves.length} 条：`]
  for (const m of p.moves) L.push(`  · 第 ${m.line} 行 → 归档区：${m.item.replace(/\*/g, '').slice(0, 60)}`)
  L.push('', `归档到：${TODO_ARCHIVE_FILE}（**表尾之后** —— 🔴 2026-10-16 起 L4 只留没做完的）`)
  if (!opts.applied) L.push('', '这是干跑。要真移出：`dangan_todo mode="clean" apply=true`。')
  return L.join('\n')
}
