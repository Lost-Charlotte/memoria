// ============================================================
// F35 · 工程（读 + 挑该消的）—— 2026-09-26 建 · 2026-09-28 改成「工程 → 节点」两级
// ============================================================
//
// 为什么有它（用户原话〔会话 2026-09-26〕，**照录**）：
//   「**待办是待办，工程是工程，这两个不是一回事**，或许可以融合在梅莫莉亚的同一个界面，或者一层，
//     但他俩的定位是不太一样的。待办通常**三轮以内可以完成并且工作量相对较小**。工程，你也见到了，
//     工程一般**跨度很大并且工程量爆表**。我允许可以在目前梅莫莉亚待办的这个界面分类"短期，自己能做"
//     "短期，需要拍板""长期，不急着做"**下面加入"工程"**。但不允许将他们**混为一谈**。而且顺着这件事，
//     我觉得**工程也是需要我在面板上能直接看到的**。他的书写格式应该跟待办一样，但因为它的体量更大，
//     **或许可以放宽字数要求**让你可以叙述工程的相关内容。」
//
// 🔴 2026-09-28 改成两级（用户当天原话，**照录**）：
//   「**待办是一个小事情，基本一轮两轮就能搞定，而工程是要很多轮的，并且一个工程里包含了很多小的待办**……
//     我希望**工程展开之后可以像截图二里地图那样按照先后完成顺序组成一个个小节点**。或许可以改颜色，
//     这样我可以明确的知道**我们现在这个工程做到哪一步了。下一步是什么**。**外部只放一个总体说明，
//     为什么要做这个，做这个要达成什么目的。每个小点打开也是，为什么要做什么，做这个要达成什么目的**……
//     **不会出现做着做着原本的目的地就忘记了的情况**。一环扣一环就很紧致。」
//   同轮补三条：「**有颜色表示就不要多加字了。保持界面的整洁性**」·
//   「**半自动化最好，可以做类似待办那种**」·「**蓝色都不必要**，毕竟在做也就是一轮会话，几轮对话的事情，
//   不用来回改。**所有绿色的下一个，第一个灰色，就是我们现在的位置**。」
//
// 所以这里只做**机器能干**的四件事（判断仍然留给人）：
//   ① **读**：把工程 ＋ 它的节点一次读清 —— `parseProject()` / `openProjects()` / `formatProjectList()`
//   ② **挑**：机器能判的几类 —— 超字数 / 已标完成还挂着 / 同一条重复 / 颜色不合规 / 节点没写判据 → `projectStaleCandidates()`
//   ③ **送面板**：`projectSummary()` —— F16 的 `/memoria/todo` 与 F15 的状态面板读它（带 `nodes` 与 `progress`）
//   ④ **判位置**：`currentNodeIndex()` —— "所有绿之后的第一灰"就是当前位置（**不另写"我在这"**）
//
// 🔴 **它绝不与待办混为一谈**（用户明说"不允许"）—— 三条硬边界，一条都不许并：
//   · **单开一份文件**（`工程-清单.md`）—— 不并进待办表、不共用章节；
//   · **单开一节面板**（待办那三节下面那节「工程」）；
//   · **字数放宽**（`PROJECT_LIMITS`：120 / 300 / 300，待办是 40 / 60 / 60）。
//
// ⚠️ **它默认只读、现在也没有自动写入** —— 工程是**手写**的（《工程与待办-讨论稿》写的"谁写它：我手写"）。
//    落档那条路（`kind='待办'` 顺手写一行）**只对待办生效**，不许伸到这儿来。
// ⚠️ 它**只报不改**：几类都是提示，"该不该消"是人判（照 W6「出」的姿态）。
//
// 📐 **书写形态**（2026-09-28 起）：
//   ```
//   ## 一、在推 [在推]                       ← 节（动作标记仍是 [自办]/[拍板]/[长期]/[归档] 那套语义标记）
//   ### 全馆重建                              ← 一件工程（三级标题）
//   > **为什么要做**：…                        ← 外层总说明：为什么做
//   > **要达成什么**：…                        ← 外层总说明：要达成什么
//   | # | 节点 | 完成判据 | 色 |               ← 节点表（4 列写死）
//   |---|---|---|---|
//   | 1 | 六层就位 | 八个层目录都在、体检认 | 🟢 |
//   ```
//   ⚠️ **旧形态仍认**（一行一件工程、三格表）—— 免得旧数据一改就断。

import { capTick, findByName, readTextSafe, rel } from './common.js'
// 🔴 **复用待办那把尺子**（`cellsOf` / `isSep` / `isActionable` / `isClosed`）——
//    这四个是「表怎么分格 / 哪一节算在办 / 一格算不算关掉」的**唯一实现**。
//    在这儿再抄一份就是**副本病**（本档案的头号病根：两处各写一套判据，改一处必漂）——
//    2026-09-19 那次"待办长期条目写进去查不到"就是读写两把尺子造成的。
// ⚠️ 方向是**单向**的：f35 依赖 f10，f10 **不认识** f35（不回头 import，免得成环）。
// ⚠️ 一并借它那把**"两句话像不像"的尺子**（`isSameTodo`：二元组 Dice ＋ 覆盖率 ＋ 同开头）——
//    那三个阈值是**拿一组正/负样本试出来的**（`tests/f10-todo.mjs` 钉住了），另写一套＝把校准白扔。
import { cellsOf, isActionable, isClosed, isSameTodo, isSep } from './f10-todo.js'

/** 工程清单的**找法**（按名字找，**别硬编码路径**）：名字里含这五个字的，就是它。 */
export const PROJECT_HINT = '工程-清单'

/**
 * 字数上限（**比待办放宽** —— 用户原话："因为它的体量更大，或许可以放宽字数要求让你可以叙述工程的相关内容"）。
 *
 * 待办是 **40 / 60 / 60**（"约束一下字数不要太长"）；工程放到 **120 / 300 / 300** ——
 * 判据：**够叙述一件大活的来龙去脉（为什么立它 / 卡在哪 / 做完什么样），又不至于变成一篇文章**。
 * ⚠️ 这三行是**唯一真值**：工程清单文件开头那段说明、`findProjectTooLong()`、面板文案都按它说话 ——
 *    别在别处再抄一份数字（抄了就会漂，漂了就是"面板对用户撒谎"）。
 * 📐 2026-09-28：**节点那一行不受这三条管**（"名称 ＋ 完成判据"本来就是短句；写清判据反而更好）。
 */
export const PROJECT_LIMITS = { 事项: 120, 原因: 300, 目的: 300 }

/** 一段紧凑的"上限"说法（给面板 / 工具回执用；**从 `PROJECT_LIMITS` 现拼**）。 */
export const PROJECT_LIMIT_TEXT = `${PROJECT_LIMITS.事项} / ${PROJECT_LIMITS.原因} / ${PROJECT_LIMITS.目的}`

/**
 * 🔴 **节点的三档颜色**（用户 2026-09-28 定）—— **没有"蓝色（在做）"**：
 * "在做"就是一轮会话的事，不用来回改；**"所有绿之后的第一灰"就是当前位置**，不用另标"我在这"。
 * ⚠️ 唯一真值就这一处；面板文案、体检提示都从它拼。
 */
export const NODE_COLOR_DONE = '🟢'
export const NODE_COLOR_TODO = '⚪'
export const NODE_COLOR_BLOCKED = '🔴'
export const NODE_COLORS = [NODE_COLOR_DONE, NODE_COLOR_TODO, NODE_COLOR_BLOCKED]
export const NODE_COLOR_MEANING = {
  [NODE_COLOR_DONE]: '已完成',
  [NODE_COLOR_TODO]: '未开始',
  [NODE_COLOR_BLOCKED]: '卡住 / 等拍板 / 等前置',
}

/**
 * 空表里的**占位行**（`| （还没有） | | |`）—— 它**不是一件工程**。
 *
 * 🔴 为什么单列一条判据（待办那边就没有，代价已经看见了）：待办骨架的 8 个空节各写一行占位符，
 *    而解析器把它们**当成了 8 条真待办**（`f10-todo.js` 里 `todoStaleCandidates()` 只好专门给
 *    占位符开一个豁免，否则永远报"8 条重复"）。工程这边**从第一步就不让它们进来** ——
 *    不然面板会显示"还开着 2 项"，而那 2 项是"（还没有）"。
 */
const PLACEHOLDER_RE = /^[（(]\s*(还?没有|暂无|空|待填)\s*[)）]$/

/** 工程清单在哪（按名字找；**找不到返回 null** —— 没有这份文件不是异常）。 */
export function projectFile() {
  return findByName(PROJECT_HINT)
}

/**
 * 解析工程清单 → `{ file, sections: [{ title, line, actionable, projects: [...] }] }`。
 *
 * **两级**（2026-09-28 起）：
 *   · `## 标题` → **节**（动作标记照旧：`[自办]` / `[拍板]` / `[长期]` / `[归档]`）
 *   · `### 名字` → **一件工程**（它下面可以有"为什么做 / 要达成什么"两行说明 ＋ 一张节点表）
 *   · `| # | 节点 | 完成判据 | 色 |` → **节点**
 * ⚠️ **旧形态仍认**：节里没有 `###` 时，表行（第一格是事项/工程）仍按"一行一件工程"读（`legacy: true`）。
 * @returns {{file:string|null, sections:Array<object>}}
 */
export function parseProject() {
  const f = projectFile()
  if (!f) return { file: null, sections: [] }
  const L = readTextSafe(f).split(/\r?\n/)
  const sections = []
  let cur = null // 当前节
  let proj = null // 当前工程（`###` 开的）
  for (let i = 0; i < L.length; i++) {
    const s = L[i]
    // ① 二级标题 ＝ 节
    const h2 = s.match(/^##\s+(.*)$/)
    if (h2) {
      const title = h2[1].trim()
      cur = { title, line: i + 1, actionable: isActionable(title), projects: [] }
      sections.push(cur)
      proj = null
      continue
    }
    if (!cur) continue
    // ② 三级标题 ＝ 一件工程
    const h3 = s.match(/^###\s+(.*)$/)
    if (h3) {
      proj = { line: i + 1, item: h3[1].trim(), why: '', goal: '', nodes: [], legacy: false, closed: false }
      cur.projects.push(proj)
      continue
    }
    // ③ 引用块 ＝ 工程的外层总说明（为什么做 / 要达成什么）
    if (proj && /^>/.test(s)) {
      const t = s.replace(/^>\s?/, '')
      const a = t.match(/为什么要做\**\s*[：:]\s*(.+)$/)
      const b = t.match(/要达成什么\**\s*[：:]\s*(.+)$/)
      if (a) proj.why = a[1].trim()
      else if (b) proj.goal = b[1].trim()
      continue
    }
    if (!/^\|/.test(s)) continue // 顶格才算
    if (isSep(s)) continue
    const c = cellsOf(s)
    if (c.length < 3) continue
    const head = (c[1] ?? '').trim()
    // 表头识别：节点表（`| # | 节点 | …`）或旧的工程表（`| 事项 | …`）
    if (/^(#|序号|编号)$/.test(head.replace(/\s/g, '')) && /节点/.test(c[2] ?? '')) continue
    if (/^(内容|事项|事情|工程)/.test(head)) continue
    if (PLACEHOLDER_RE.test(head)) continue // 空表占位行：**不是一件工程**
    if (proj) {
      // 新形态：这台表是**节点表** —— `| # | 节点 | 为什么要做 | 完成判据 | 色 |`
      // ⚠️ **按格数自适应**（"为什么要做"那一格可省）：末格永远是"色"，往前是"完成判据"，
      //    再往前（凑够 4 格时）才是"为什么要做"。这样 4 列 / 5 列两种写法都认。
      // ⚠️ `cellsOf` 切出来的**首尾各有一个空段**（表格行是 `| a | b |`）—— 先剥掉，
      //    不然"从末尾数"会把末尾那个空段当成"色"，颜色永远读成空（2026-09-28 真踩过，测试当场抓住）。
      const cc = c.map((x) => String(x ?? '').trim())
      while (cc.length && cc[0] === '') cc.shift()
      while (cc.length && cc[cc.length - 1] === '') cc.pop()
      const rest = cc.slice(1)
      // ⚠️ 色格**只该放一个色**（用户："有颜色表示就不要多加字了"）；但手写时容易多写字（如"🔴 等拍板"）——
      //    这里**取第一个认得出的三档色**当色（认不出就原样留着，交给体检去报"颜色不合规"）。
      const rawColor = (rest[rest.length - 1] ?? '').trim()
      const color = NODE_COLORS.find((x) => rawColor.includes(x)) ?? rawColor
      const judge = rest.length >= 2 ? rest[rest.length - 2] : ''
      const why = rest.length >= 4 ? rest[rest.length - 3] : ''
      proj.nodes.push({
        line: i + 1,
        n: head,
        name: rest[0] ?? '',
        why,
        judge,
        color,
        done: color === NODE_COLOR_DONE,
      })
    } else {
      // 旧形态：一行一件工程（三格表）
      const closed = c.some((cell) => isClosed(cell))
      cur.projects.push({
        line: i + 1,
        item: head,
        why: c[2] ?? '',
        goal: c[3] ?? '',
        nodes: [],
        legacy: true,
        closed,
      })
    }
  }
  // 新形态的"这件工程算不算完"：显式标了 ✅/🔚 **或** 节点全绿（且至少有一个节点）
  for (const sec of sections) {
    for (const p of sec.projects) {
      if (!p.legacy) {
        const all = p.nodes.length > 0 && p.nodes.every((n) => n.done)
        p.closed = p.closed || all
      }
    }
  }
  capTick('F35', `读到 ${sections.reduce((a, s) => a + s.projects.length, 0)} 项工程`)
  return { file: f, sections }
}

/** 从一份**已经解析好的**结果里取"还开着的"（省掉重复解析 —— 一次调用只读一遍文件）。 */
function openFrom(parsed) {
  const out = []
  for (const s of parsed.sections) {
    if (!s.actionable) continue // `[归档]` / `[已决]` 那些不算"还开着"
    for (const p of s.projects) if (!p.closed) out.push({ ...p, section: s.title })
  }
  return out
}

/**
 * "**当前位置**"＝**所有绿之后的第一灰**（用户 2026-09-28 的原话判据）。
 * ⚠️ 返回的是**下标**（0 起）；全都是绿或空则返回 `-1`；遇到 🔴 也算"停在这儿"。
 */
export function currentNodeIndex(project) {
  const ns = project?.nodes ?? []
  for (let i = 0; i < ns.length; i++) {
    if (ns[i].color !== NODE_COLOR_DONE) return i
  }
  return -1
}

/**
 * 所有**还在做 / 还没开工**的工程（＝在 `[自办]` / `[拍板]` / `[长期]` 那几节里、且没算完）。
 * @returns {{file:string|null, items:Array<object>}}
 */
export function openProjects() {
  const parsed = parseProject()
  return { file: parsed.file, items: openFrom(parsed) }
}

/** 一件工程的进度（`{done,total,current}`；没有节点则为 `null`）。 */
function progressOf(p) {
  const ns = p.nodes ?? []
  if (ns.length === 0) return null
  return { done: ns.filter((n) => n.done).length, total: ns.length, current: currentNodeIndex(p) }
}

/**
 * 机器能判的几类"该看的"（`dangan_check` 与 `dangan_todo check` 会带上它）。
 * ⚠️ 全是**提示**，不是错 —— "这件工程算不算完"是判断，机器只负责别让它烂在表里。
 * @returns {Array<{lv:string,line:number,msg:string}>}
 */
export function projectStaleCandidates(parsed = parseProject()) {
  const { file, sections } = parsed
  if (!file) return []
  const out = []
  for (const s of sections) {
    if (!s.actionable) continue
    for (const p of s.projects) {
      if (p.closed && !/\[归档\]/.test(s.title)) {
        out.push({ lv: '提示', line: p.line, msg: `工程清单里这条已经做完了，却还留在「${s.title}」里 —— 可以把它挪到 [归档] 那一节（不挪也不影响用）：${p.item.slice(0, 40)}` })
      }
      // 🔴 **2026-10-16 加（用户当天："能不能拒绝没有链条的工程落笔，或者在一开始就告诉你必须要有链条？"）**
      //    工程**必须有节点链** —— 没有节点表的工程，面板画不出进度、`currentNodeIndex()` 也算不出"下一步是哪个节点"。
      //    报**「错」**（不是提示）：它会挡 G2 门 ⇒ 逼我当场补链，而不是让它烂在表里。
      if (!Array.isArray(p.nodes) || p.nodes.length === 0) {
        out.push({
          lv: '错',
          line: p.line,
          msg: `工程「${p.item.slice(0, 30)}」**没有节点链** —— 工程必须带一张节点表（\`| # | 节点 | 为什么要做 | 完成判据 | 色 |\`）：没有它，面板画不出进度、"下一步是哪个节点"也算不出来。补链，或把它并进别的工程。`,
        })
      }
      // 节点颜色写得不合规（只认三档）／没写完成判据
      for (const n of p.nodes ?? []) {
        if (n.color && !NODE_COLORS.includes(n.color)) {
          out.push({ lv: '提示', line: n.line, msg: `节点「${n.name.slice(0, 24)}」的"色"格写的是「${n.color}」—— 只认三档：🟢 已完成 · ⚪ 未开始 · 🔴 卡住/等拍板（**没有蓝色**）` })
        }
        if (!n.judge) {
          out.push({ lv: '提示', line: n.line, msg: `节点「${n.name.slice(0, 24)}」没写**完成判据** —— 没判据，颜色就只是主观；判据一句话、能机器判最好` })
        }
      }
    }
  }
  // 超字数（"放宽"不等于"没上限"—— 上限就写在文件开头，机器盯着它）
  for (const h of findProjectTooLong(parsed)) {
    out.push({
      lv: '提示',
      line: h.line,
      msg: `工程的「${h.field}」**${h.len} 字 > 上限 ${h.limit} 字**（上限写在文件开头，权威是「f35-project.js」的 PROJECT_LIMITS）—— 超了多半是把调查数据/过程写进来了：正解是**把过程搬进 L3**，这一格只留"这是一件什么活 / 为什么 / 做完什么样"：${h.item}`,
    })
  }
  // 同一条重复（**复用待办那把相似度尺子**：措辞不同也算同一条）
  const items = openFrom(parsed)
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const r = isSameTodo(items[i].item, items[j].item)
      if (r.same) {
        out.push({
          lv: '提示',
          line: items[j].line,
          msg: `工程第 ${items[j].line} 行与第 ${items[i].line} 行**重复（是同一件事）**（${r.exact ? '措辞完全相同' : '措辞高度接近'}）—— 只留一处：${items[j].item.slice(0, 40)}`,
        })
      }
    }
  }
  return out
}

/**
 * 「一条工程只写一件事」＋ 字数上限 —— 体检用。
 *
 * 为什么必须有机器闸门：**工程是手写的**（没有落笔半那道闸门），所以"超了上限"这件事
 *   **完全没人管** —— 而用户放宽字数的前提是"够叙述工程的相关内容"，不是"想写多长写多长"。
 * ⚠️ 与待办同一条底线：**别为了压字删掉路径与数字**（用户 2026-09-19："不要为了这事丢失信息"）——
 *    超了该做的是"把过程搬进 L3"，不是缩写掉出处。
 * @returns {Array<{line:number,field:string,len:number,limit:number,item:string}>}
 */
export function findProjectTooLong(parsed = parseProject()) {
  const { sections } = parsed
  const hits = []
  const fields = [['item', '事项'], ['why', '原因'], ['goal', '目的']]
  for (const s of sections) {
    if (!s.actionable) continue
    for (const p of s.projects) {
      if (p.closed) continue
      for (const [key, label] of fields) {
        const t = String(p[key] ?? '')
          .replace(/\*\*/g, '')
          .replace(/[✅🔚]/g, '')
          .trim()
        if (!t || t.length <= PROJECT_LIMITS[label]) continue
        hits.push({ line: p.line, field: label, len: t.length, limit: PROJECT_LIMITS[label], item: t.slice(0, 44) })
      }
    }
  }
  // 超得越多越靠前
  return hits.sort((a, b) => b.len - a.len)
}

/** 给模型看的紧凑清单（`dangan_todo list` 与面板之外的那条路）。 */
export function formatProjectList(parsed = parseProject()) {
  const { file } = parsed
  if (!file) return '【工程】档案里找不到工程清单（名字里含「工程-清单」的那份）'
  const items = openFrom(parsed)
  const head = `【工程】还开着 **${items.length}** 项（${rel(file)}）`
  const note = `　·　**它不是待办**：跨很多轮、工程量爆表的那种活；字数上限 ${PROJECT_LIMIT_TEXT} 字`
  if (items.length === 0) return `${head}${note}\n  没有还开着的工程 —— 干净`
  const bySec = new Map()
  for (const it of items) {
    if (!bySec.has(it.section)) bySec.set(it.section, [])
    bySec.get(it.section).push(it)
  }
  const L = [head + note]
  for (const [sec, rows] of bySec) {
    L.push(`▌${sec}`)
    for (const r of rows) {
      const pr = progressOf(r)
      L.push(
        `  · ${r.item}` +
          (pr ? `　（${pr.done}/${pr.total} 节点${pr.current >= 0 ? `，下一步 ＝ 第 ${pr.current + 1} 个` : ''}）` : '') +
          (r.why && r.why !== '—' ? `\n      为什么要做：${r.why.slice(0, 400)}` : '') +
          (r.goal && r.goal !== '—' ? `\n      要达成什么：${r.goal.slice(0, 400)}` : '') +
          ((r.nodes ?? []).length
            ? '\n' + r.nodes.map((n, k) => `      ${n.color || '⚪'} ${n.n}. ${n.name}${pr && k === pr.current ? '  ← 当前位置' : ''}`).join('\n')
            : '') +
          `\n      （${rel(file)}:${r.line}）`,
      )
    }
  }
  return L.join('\n')
}

/**
 * 面板 / 状态面板读的那一份（**结构化**，不渲染）—— F16 的 `/memoria/todo` 与 F15 共用它。
 * ⚠️ 面板是**纯文本渲染**（`**` 会原样显示），所以这里只给原文，剥标记那一步在 `client.js`。
 * 🔴 2026-09-28 起多带 `nodes` / `progress`（面板要画那条**节点链**）。
 * @returns {{file:string, count:number, limits:object, colors:object, items:Array<object>}}
 */
/** **暂缓的工程**（"等拍板 / 等前置"那一节）—— 2026-10-01 加。
 *  与 `openFrom()` / `openProjects()` 的区别：那些收"在推 ＋ 等拍板/等前置"（面板现在显示的就是它们），
 *  这个**只收等着的**，给面板那条二级菜单用（用户当天："暂缓的工程和待办……做一个二级菜单放进去"）。
 *  ⚠️ **不收 `[归档]` / `[已决]`** —— 用户当天："**做完的不要显示了**……现在已经这么多了，今后还会变多，放在这里面太夸张了"。 */
export function pausedProjects(parsed = parseProject()) {
  const out = []
  for (const s of parsed.sections) {
    if (/\[归档\]/.test(s.title) || /\[已决\]/.test(s.title)) continue
    // 🔴 **别拿 `actionable` 当判据**（2026-10-01 亲测栽过）：**工程的「等拍板 / 等前置」那一节是 `actionable=true`**
    //    （它确实要人点头 ⇒ 算"该动的活"），而**待办的「等条件」是 `actionable=false`** —— 两边**同名不同义**。
    //    所以这里**按语义标记认节**：「在推」＝正在做的、不算暂缓；其余非归档的就都是"等着的"。
    if (/\[自办\]/.test(s.title)) continue // 「在推」—— 它已经在面板的「工程」那一节里了
    for (const p of s.projects) if (!p.closed) out.push({ ...p, section: s.title })
  }
  return out
}

/**
 * 工程摘要（面板那一条数据）—— 原来的样子。
 * ⚠️ 面板是**纯文本渲染**（`**` 会原样显示），所以这里只给原文，剥标记那一步在 `client.js`。
 * 🔴 2026-09-28 起多带 `nodes` / `progress`（面板要画那条**节点链**）。
 * @returns {{file:string, count:number, limits:object, colors:object, items:Array<object>}}
 */
export function projectSummary(parsed = parseProject()) {
  const { file } = parsed
  const items = file ? openFrom(parsed) : []
  return {
    file: file ? String(file).replace(/\\/g, '/') : '',
    count: items.length,
    limits: { ...PROJECT_LIMITS },
    colors: { ...NODE_COLOR_MEANING },
    items: items.map((it) => ({
      section: it.section,
      line: it.line,
      item: it.item,
      why: it.why,
      goal: it.goal,
      progress: progressOf(it),
      nodes: (it.nodes ?? []).map((n) => ({ n: n.n, name: n.name, judge: n.judge, color: n.color })),
    })),
  }
}

/**
 * 启动自检（**沉默 ≠ 正常**）：说清"读到几项工程、还开着几项、文件在哪"。
 * ⚠️ **读不到也要出声**（"没有这份文件" 与 "它瞎了" 必须分得开）。
 */
export function reportF35() {
  try {
    const parsed = parseProject()
    if (!parsed.file) return '工程 F35：档案里没有工程清单（名字里含「工程-清单」的那份）—— 0 项'
    const all = parsed.sections.flatMap((s) => s.projects)
    const open = openFrom(parsed).length
    const nodes = all.reduce((a, p) => a + (p.nodes?.length ?? 0), 0)
    return `工程 F35：读到 ${all.length} 项工程（还开着 ${open} 项 · 节点 ${nodes} 个）· 文件 ${rel(parsed.file)}`
  } catch (e) {
    return `工程 F35 自检失败（fail-open）：${e}`
  }
}
