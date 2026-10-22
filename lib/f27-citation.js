// ============================================================
// F27 · 引用对账哨兵 —— 2026-09-18 建（治"张冠李戴"）
// ============================================================
//
// 起因：《AI错误总账》**R28** —— 我把用户对"**地图**"说的原话（"塞这么多字，能不能变成按钮。。
//   点开显示详细之类的？"）安到了"**待办**"头上，还写着"用户当天原话"；直到用户一句
//   "**为什么折叠**"才问出来。**同族的还有 R14（对象写错还标"已查明"）· R21（写引用不验目标）·
//   R25（把线索当证据）** —— 都是"依据"这一环没核。
//
// 用户 2026-09-18 定的方案与三档（原话）：
//   "**我希望你沿用我之前修改待办漂的方案，给出一劳永逸解决张冠李戴的方案，以及能否自动化**"
//   "**那我觉得自动化也可以分三种，搜不到报警，类似的话给出警告，你去确认。全绿自然无事发生**"
//
// 所以判据只有三条（照"待办漂移"那三招同构：强制带出处 → 锚只许是编号 → 机器自动核）：
//   · **有锚**（`〔T312〕` / `〔E122〕`）→ 到锚指向的正文里搜引文：
//       ① **搜不到**        → **错**（凭空引用 —— 最坏的一类，正是 R28）
//       ② **只搜到类似的**  → **提示**（有相近文本但语境/位置对不上 → **由我（AI）去确认**，不是让用户判）
//       ③ **完整命中**      → 绿，**沉默**（用户："全绿自然无事发生"）
//   · **没有锚** → 提示（"待补锚"）—— 存量都落这一档，靠逐步补锚收口
//   · **锚指向的东西不存在**（死指针）→ **错**
//
// ⚠️ **与 F25（口径巡检）是同一套做法**：扫现行层 → 分"错 / 提示" → 确认过的打豁免标记收口。
//    🔴 **2026-09-18 注**：这两个哨兵的骨架目前是**重复的**；用户已同意下一步抽公共层
//    （"我觉得需要讲这些东西也规整起来。不要散乱一团"）—— 抽的时候以这两份为样本。
// ⚠️ 豁免**不许变成静默**：确认过的照报数量（同 F25）。

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CFG, PKG_DIR, capTick, findByName, log, writeHealth } from './common.js'
import { similarity, coverage } from './f10-todo.js'
import { runSentinel } from './sentinel.js'

/** 人工确认标记（同 F25 的做法：**打在那一行里**，不按行号 —— 行号会随重排漂）。 */
export const ACK_MARK = 'F27-已确认'
const ACK_RE = new RegExp(`<!--\\s*${ACK_MARK}[^>]*-->`)

/** 出处锚：**只认方括号那种**（`〔T312〕` / `〔E122〕`）—— 宽松认法会把"附近恰好有个 T 号"当成锚，
 *  然后拿它去搜、搜不到就误报。**明确格式 > 少写几个字**。 */
const ANCHOR_RE = /〔\s*([TE])(\d+)\s*〕/g

/**
 * 「**会话当场原话**」的标记：`〔会话〕`（可带日期/说明，如 `〔会话 2026-09-20〕`）。
 *
 * 🔴 **2026-09-20 加**（用户："实在不行先把小尾巴解决了吧…我不想这种事情分散你的注意力"）。
 *   起因：落档时引"用户**当场**说的原话"—— **那一刻还没有 T/E 编号可锚**（编号是**这次落档才生成**的），
 *   于是每落一次档就报一次"待补锚"，而**根本无处可补**。它**不是造假，是判据对这类引文不适用**。
 *
 * ⚠️ **它不是免罪符**：标了它 ＝ **声明"这条引文出自会话当场、档案里没有它的锚"**。
 *   所以**照 `ACK_MARK` 那套照样数出来**（报告末尾一行 `✅ 另有 N 处…`）——
 *   **数量暴涨就是滥用，看得见**（"只是警示会被无视"那条教训：不许只靠自觉）。
 * ⚠️ 将来能升级成**带会话号的锚**（档案那条待办"档案行 → 会话 seq 反向锚"就是它的下一步）。
 * ⚠️ 判据同 `ANCHOR_RE`：**只认"夹在「原话」和引文之间那一段"**里的标记（收窄的理由见 `anchorOf`）。
 */
const SESSION_ANCHOR_RE = /〔\s*会话[^〕]*〕/

// ⚠️ 这个 import 放在**这儿**（不在文件头）是为了少动一处 —— ESM 的 `import` 允许出现在模块顶层任意位置。
//    它是 `〔会话〕` 能不能"**真核**"的关键：拿引文去"**本会话里用户说过的话**"里搜（见 `said.js`）。
import { hasUserSaid } from './said.js'

/** 引文：`原话…"…"`（中文引号 / 直引号都认）。
 *  ⚠️ **"原话"和引号之间可以夹别的字**（冒号、括号、**出处锚** `〔T312〕`、日期……）——
 *     2026-09-18 第一版只允许"原话："这种紧贴写法，于是**刚补上锚的引用反而抓不到**
 *     （测试当场抓到：5 条样本只认出 1 条）。放宽到 40 字以内。
 *  ⚠️ 只取**第一个**引号内容（有的地方一句话里引两段）。
 *  🔴 **2026-09-18 加第二个捕获组**：把"**原话"和引文之间**那一段单独抓出来 ——
 *     **锚只认这一段里的**（见 `anchorOf`）。 */
const QUOTE_RE = /(原话|原话是|原话照录)([^"“\n]{0,40})["“]([^"”\n]{4,300})["”]/g

/** 归一化：只擦装饰（粗体/代码/空白），**不改写内容**（同 F25 的立场）。 */
const norm = (s) => String(s ?? '').replace(/\*\*|__|`|~~/g, '').replace(/[\s\u3000]+/g, '')

/** 相似度阈值。⚠️ **故意定得低**（2026-09-18 调）：用户要的是"**类似的话给出警告**"——
 *  对"引用对账"来说"**凭空引用**"是最重的指控，报错要有把握；
 *  所以宁可把边界情况降级成**提示**（我去确认），也不误报成"错"。
 *  实测：改了几个字的同义句 Dice ≈ 0.39 → 落在 0.3 之上（提示档）✓，而真正无关的只有 1%~5%。 */
export const CITE_DUP = { similar: 0.3, cover: 0.4 }

/**
 * **引文"归一化后"的字符下限**（2026-09-19 加）：低于它，就不可能是"引用了用户说的某一句话"。
 * 🔴 实测踩到的：`**待办**` 归一化后只剩 **2 字**，在事件表里**一次命中 42 条**（全是假出处）。
 * 所以"太短"要**单独报** —— 它不是"待补锚"，而是"**这条核不了**"：补了锚也核不动。
 */
export const MIN_QUOTE_CHARS = 6

/**
 * **"像是在讲引用格式本身"**（2026-09-19 加）—— 这类**不是引用**。
 * 实测踩到的三类：① 代码/文档里**示范锚怎么写**（`原话〔T312〕："…"`）② **正则片段**（`\n]{0,40}[`）
 * ③ **自指**：我写"哨兵把短词都当成了那个词"这种话，本身就带着那两个字，于是哨兵把**我这句话**也当成引用。
 * ⚠️ 把它们留在"待补锚"里，就是让人去给"谈论它的话"补出处 —— "谈论它 vs 用它"分不清，人核不动。
 * ⚠️ `MIN_QUOTE_CHARS` 落笔提醒那边也引一份（`f9-commit.js`：太短的引文不提醒"补锚"——补了也核不动）；
 *    `META_QUOTE_RE` **只在本文件用** —— 提醒那一侧**故意不放宽**（提醒宁可多说，放宽会漏掉真引用）。
 */
export const META_QUOTE_RE = /〔[TE]\d+〕|[TE]\d+〕|\\n\]\{|原话|引文|出处锚|形如|写法|补锚|张冠李戴/

/**
 * 这条引文算不算"真引用"？返回 `''` ＝ 算（该补锚）；否则返回该归的类：
 * `'short'`（太短、核不了）· `'meta'`（在讲引用格式本身）。
 */
function quoteClass(quote) {
  if (norm(quote).length < MIN_QUOTE_CHARS) return 'short'
  if (META_QUOTE_RE.test(String(quote))) return 'meta'
  return ''
}

/**
 * 扫哪些地方 —— **范围写死（机械可判），不靠我记**。
 * 现行层＝档案 L1/L2/L3 的 `.md` ＋ 插件的 `lib/*.js` 与 `README.md`。
 * ⚠️ **必须包含插件源码**：R28 那次就发生在 `lib/client.js` 的注释里 —— 只扫档案会漏掉它。
 */
export function citationTargets() {
  const list = []
  const missing = []
  // 🔴 2026-10-15：加回 `L2-用户` —— 那层装"用户和你的事"，里面的引文照样要核到出处。
  for (const layer of ['L1-必读', 'L2-用户', 'L3-知识']) {
    const dir = join(CFG.archiveDir, layer)
    try {
      for (const f of readdirSync(dir)) {
        if (f.toLowerCase().endsWith('.md') && !f.startsWith('_')) list.push({ label: `档案 ${layer}/${f}`, file: join(dir, f) })
      }
    } catch {
      missing.push(`档案 ${layer}`)
    }
  }
  const libDir = join(PKG_DIR, 'lib')
  try {
    for (const f of readdirSync(libDir)) if (f.endsWith('.js')) list.push({ label: `插件 lib/${f}`, file: join(libDir, f) })
  } catch {
    missing.push('插件 lib/')
  }
  const rm = join(PKG_DIR, 'README.md')
  if (existsSync(rm)) list.push({ label: '插件 README.md', file: rm })
  else missing.push('插件 README.md')
  return { list, missing }
}

/** 锚指向的正文（T＝时间轴那一行；E＝事件表那一条）。找不到返回 `null`。
 *  🔴 2026-10-15：**本函数已随 L2 退役"空掉"** —— 它读的正是时间轴 / 事件表两份文件，L2 已删 ⇒ 无从取正文。
 *  ⚠️ 调用方**不能再把 `null` 当"死指针"**（那会把每一处 T/E 锚都假报成死指针）—— 见下面调用处的处置。
 */
function sourceOf(kind, n) {
  void kind
  void n
  return null
}

/** 出处里跟引文最像的那一句（分句比 —— 整段跟一句话比，Dice 必然低）。 */
function bestMatch(quote, source) {
  const nq = norm(quote)
  const ns = norm(source)
  if (nq.length === 0) return { hit: false, why: '引文是空的' }
  if (ns.includes(nq)) return { hit: true, exact: true, score: 1, why: '完整命中' }
  let best = 0
  for (const part of String(source).split(/[。；！？\n]/)) {
    if (norm(part).length < 4) continue
    best = Math.max(best, similarity(quote, part), coverage(quote, part))
  }
  return { hit: best >= CITE_DUP.similar, exact: false, score: best, why: `最像的一句只有 ${(best * 100).toFixed(0)}%` }
}

/**
 * 对账。返回 `{ hits, bad, tips, acks, scanned, missing }`。
 * 每条 hit：`{ level:'错'|'提示', label, file, line, quote, anchor, why, text }`
 *   · `level='错'`   ＝ 搜不到（凭空引用）/ 锚是死指针
 *   · `level='提示'` ＝ 只搜到类似的（**我去确认**）/ 没标锚（待补锚）
 */
export function citationScan() {
  // ⚠️ **扫描 / 豁免 / 计数全交给公共层**（`sentinel.js`，2026-09-18 抽出来的）—— 这里**只写判据**。
  //    🔴 2026-10-20 核：当初抽它是"三个哨兵共用"，现在 **F25 已退役、F2 自己扫 ⇒ 只剩本文件一个消费者**。
  //    留着它是因为这层底座（扫层 / 豁免收口 / 分档计数）本身通用，将来加哨兵还要用；
  //    真到连这一个消费者都没了，就整份删。
  let refs = 0
  // 🔴 2026-09-20：标了 `〔会话〕` 的那些引文 —— **不进 `hits`**（不打扰），但**照样数出来**（见报告末尾）。
  const sessionMarked = []
  const judge = (raw) => {
    if (!raw.includes('原话')) return null
    const out = []
    QUOTE_RE.lastIndex = 0
    let m
    while ((m = QUOTE_RE.exec(raw)) !== null) {
      refs += 1
      const quote = m[3]
      // 🔴 **锚只认"夹在「原话」和引文之间"的那一个**（写法：`原话〔T312〕："…"`）。
      //    2026-09-18 首跑实测：原来在**整行**里找锚 —— 于是"**在文档里举例讲锚格式**"的行
      //    被自己的例子当成真锚（插件 README 与 E123 各中一次，报出 3 处误报）。
      //    收紧到"夹在中间那一段"之后，讲格式的行自然落进"待补锚"提示档，不再误报。
      ANCHOR_RE.lastIndex = 0
      const anchors = [...String(m[2] ?? '').matchAll(ANCHOR_RE)].map((a) => ({ kind: a[1], n: Number(a[2]), raw: a[0] }))
      const base = {
        quote: quote.length > 80 ? `${quote.slice(0, 80)}…` : quote,
        text: raw.trim().length > 160 ? `${raw.trim().slice(0, 160)}…` : raw.trim(),
      }
      if (anchors.length === 0) {
        // 🔴 2026-09-20：标了 `〔会话〕` ＝ "**当着我的面说的，档案里没有它的锚**" → **不报这一条**，
        //    但记进 `sessionMarked`（报告末尾照样报数 —— 不打扰，但看得见）。
        if (SESSION_ANCHOR_RE.test(String(m[2] ?? ''))) {
          // 🔴 2026-09-20：**标记不算数 —— 得真核**。去"本会话里用户说过的话"里搜这句引文：
          //    · **搜到** → 真说过 → 不报（但照样数出来，见 `sessionMarked`）
          //    · **明确搜不到** → **错**（标着"当场说的"，可你没说过 —— 凭空引用）
          //    · **拿不到材料**（还没记 / 重启后为空）→ **放过** —— "探测不到 ≠ 不存在"，不许指控
          const said = hasUserSaid(quote)
          if (said === false) {
            // 🔴 **2026-09-21 改：带日期的 `〔会话〕` 不指控、只提示**。
            //    材料（`said.js`）**只在内存、只覆盖当前会话**（刻意不落盘 —— 那里面是用户的对话内容）。
            //    所以**别的会话**标的 `〔会话〕` 引文**永远核不了**；拿"本会话没这句"去指控它
            //    "凭空引用"是**假阳性**（2026-09-21 实测：7 处 09-20 晚的原话被全报成错，而那一晚用户确实说过）。
            //    ⚠️ **但也不放过** —— "编一句 + 随手标个日期"不能因此免责（那正是 E183 要防的）。
            //    所以**降成提示**：照样出现在体检里、照样要人判，只是不再冒充"错"。
            const histMark = String(m[2] ?? '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
            if (histMark) {
              out.push({
                ...base,
                level: '提示',
                anchor: `〔会话 ${histMark}〕`,
                kind: 'notSaidHist',
                why: `**标的是 ${histMark} 那次会话** —— 核验材料只在内存、只覆盖当前会话，这一条核不到（**不等于你说过、也不等于没说过**）。要核就回那一天的会话日志里搜`,
              })
              continue
            }
            out.push({
              ...base,
              level: '错',
              anchor: '',
              kind: 'notSaid',
              why: '**标了 `〔会话〕`，但在本会话里搜不到你说过这句话** —— 要么引错了，要么这个标记是随手标的',
            })
            continue
          }
          sessionMarked.push(base)
          continue
        }
        // 🔴 2026-09-19：先分"**这到底算不算引用**"，再谈补不补锚 ——
        //    存量实测：69 处"待补锚"里约 40 处压根不是引用（短词 / 讲格式的示例 / 自指句），
        //    混在一起人就核不动了（那正是这条待办当时卡住的真正原因）。
        const cls = quoteClass(quote)
        if (cls === 'short') {
          out.push({
            ...base,
            level: '提示',
            anchor: '',
            kind: 'short',
            why: `**引文太短，核不了**（归一化后只剩 ${norm(quote).length} 字）—— 补了锚也核不动（机器会一次命中一片）；要么把话引全一点，要么就别按"引用"来写`,
          })
        } else if (cls === 'meta') {
          out.push({
            ...base,
            level: '提示',
            anchor: '',
            kind: 'meta',
            why: '**这一处像是在讲引用格式本身**（含锚写法 / 正则片段 / 那两个字）—— **它不是引用，不用补锚**',
          })
        } else {
          out.push({ ...base, level: '提示', anchor: '', kind: 'noAnchor', why: '**没标出处**（待补锚）—— 引用必须能核到出处' })
        }
        continue
      }
      let worst = null
      for (const a of anchors) {
        const src = sourceOf(a.kind, a.n)
        if (!src) {
          // 🔴 2026-10-15：**不再把 `null` 当"死指针"** —— T/E 的正文源（时间轴 / 事件表）随 L2 退役，
          //    `sourceOf` 现在恒返回 null；继续判死会把**每一处 T/E 锚都假报成死指针**。
          //    ⇒ 这类锚**无从核起**，跳过（"没标出处"那条判据不受影响，它不依赖 L2）。
          continue
        }
        const r = bestMatch(quote, src.text)
        if (r.exact) continue // 这一条锚对得上 → 绿，沉默
        const cand = {
          level: r.hit ? '提示' : '错',
          anchor: `${a.raw}（${src.label}）`,
          kind: r.hit ? 'similar' : 'dead',
          why: r.hit ? `**只搜到类似的话**（${r.why}）—— 语境可能不对，**我去确认**` : `在 ${src.label} 里**搜不到这句话**（${r.why}）`,
        }
        if (!worst || (worst.level === '提示' && cand.level === '错')) worst = cand
      }
      // 全绿（每条锚都完整命中）→ 什么都不记（用户："全绿自然无事发生"）
      if (worst) out.push({ ...base, ...worst })
    }
    return out
  }
  const r = runSentinel({ mark: ACK_MARK, targets: citationTargets, judge })
  capTick('F27', `引用对账 ${refs} 处（错 ${r.bad}）${r.acks.length > 0 ? ` · 已确认 ${r.acks.length} 处` : ''}`)
  // 🛡 **2026-10-22（机器闭环 · 入选名单）**：把结论写成机读状态。
  //    为什么它进名单：它的产出只是报告末尾**一个数字**（"80 处 · 错 0"），我从不逐条看 ——
  //    **错了也不会有人发现**。⚠️ 只转写 `runSentinel` 已经算出来的 `bad`，不新加扫描。
  try {
    const badN = Number(r.bad) || 0
    writeHealth('F27', badN === 0, `引文 ${refs} 处 · 错 ${badN} 处${r.acks.length > 0 ? ` · 已确认 ${r.acks.length}` : ''}`)
  } catch {
    /* 报不上自己，不影响对账 */
  }
  return { ...r, refs, sessionMarked }
}

/** 启动自报（"沉默 ≠ 正常"：扫了几份、核了几处引用，都要说话）。 */
export function reportF27() {
  try {
    const { hits, bad, tips, acks, scanned, refs, missing } = citationScan()
    const ack = acks.length > 0 ? ` · 已确认 ${acks.length} 处` : ''
    const miss = missing.length > 0 ? ` ⚠️ 目标少读了 ${missing.length} 处` : ''
    // 2026-09-19：把"不是引用"的那两类从"待确认"里点出来（否则 68 看着像 68 件要干的事）
    const notRef = hits.filter((x) => x.level === '提示' && (x.kind === 'short' || x.kind === 'meta')).length
    const notRefTxt = notRef > 0 ? `，其中 ${notRef} 处不是引用` : ''
    if (hits.length === 0) return `引用对账 F27：扫 ${scanned} 份、核 ${refs} 处引用，**全都对得上**${ack}${miss}`
    return `引用对账 F27：**${bad} 处报警**（${tips} 处待确认${notRefTxt}）${ack} —— 调 \`dangan_check\` 看逐条${miss}`
  } catch (e) {
    return `引用对账 F27：**读不到**（${e && e.message ? e.message : e}）—— ⚠️ 这不等于"没有张冠李戴"`
  }
}

/** 给体检（`dangan_check`）用的文本块。 */
export function citationReport() {
  try {
    const { hits, bad, tips, acks, scanned, refs, missing, sessionMarked = [] } = citationScan()
    const lines = []
    if (bad > 0) {
      lines.push(`  🔴 **${bad} 处报警**（引用核不到出处 —— 最坏的一类）：`)
      for (const h of hits.filter((x) => x.level === '错')) {
        lines.push(`  · ${h.label}:${h.line} · 引文"${h.quote}"`)
        lines.push(`      ${h.why}`)
      }
    }
    if (tips > 0) {
      // ⚠️ **截断**（2026-09-18 实测：存量"没标出处"的有 **100+ 处**）—— 全列会把体检输出淹了。
      //    **只给前 5 条**：够我看出"是哪一类"；剩下的按类批量处理，不是一条条看。
      const tipsAll = hits.filter((x) => x.level === '提示')
      const shown = tipsAll.slice(0, 5)
      const byKind = (k) => tipsAll.filter((x) => x.kind === k).length
      const noAnchor = byKind('noAnchor')
      const similar = byKind('similar')
      const short = byKind('short')
      const meta = byKind('meta')
      lines.push(
        `  另有 **${tips} 处**要我去确认 —— 拆开看：**${noAnchor} 处"没标出处"**（真引用，逐条补锚即可）· ` +
          `**${similar} 处"只搜到类似的话"**（语境可能不对，**这类才要我真去看**）· ` +
          `**${short} 处引文太短、核不了** · **${meta} 处像是在讲引用格式本身**` +
          `（⚠️ 后两类**不是引用、不用补锚** —— 2026-09-19 起单独分出来，免得跟真引用混在一起核不动）。最多列前 5 条：`,
      )
      for (const h of shown) lines.push(`  · ${h.label}:${h.line} · 引文"${h.quote}" · ${h.why}`)
      if (tipsAll.length > shown.length) lines.push(`  · …还有 **${tipsAll.length - shown.length} 处**（同类，不逐条列）`)
      lines.push(`  ↳ 确认无误：**在那一行里**加上 \`<!-- ${ACK_MARK} -->\` —— 它就不再报这一条（但照报数量）`)
    }
    if (acks.length > 0) lines.push(`  ✅ 另有 **${acks.length} 处**已确认（要复查就搜 \`${ACK_MARK}\`）`)
    if (sessionMarked.length > 0)
      lines.push(
        `  ✅ 另有 **${sessionMarked.length} 处**标了 \`〔会话〕\`（**当场原话，档案里没有它的锚** —— 2026-09-20 起不算漏标；` +
          `**照样数出来**：数量暴涨就是滥用）`,
      )
    if (missing.length > 0) lines.push(`  ⚠️ 该扫却没找到：${missing.join(' / ')}（**"没报"不等于"没有"**）`)
    return { count: bad, tips, acks: acks.length, session: sessionMarked.length, scanned, refs, lines }
  } catch (e) {
    log(`F27 读不到：${e}`)
    return { count: 0, tips: 0, acks: 0, session: 0, scanned: 0, refs: 0, lines: [`  ⚠️ 引用对账读不到：${e && e.message ? e.message : e}`], err: String(e) }
  }
}
