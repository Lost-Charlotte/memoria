// ============================================================
// F36 · 织布机（loom）—— **把"所有文档编写"收进一条路**
// ============================================================
//
// 它从哪来：用户 2026-09-29 晚定（原话）：「**我们先做织布机**，做好之后**测试**，测试通过，
//   今后所有的文件都由织布机接管，之前的**改档或者什么乱七八糟的其他写入就都可以被织布机代替了**。」
//   ⇒ 目标**不是"再加一条路"**，而是**把路收敛成一条**（讨论稿 §一）。
//
// 四层（讨论稿 §二）：输入端口（我给线）→ 格式端口（只准选）→ 织布机（机器）→ 文档。
// 两条机制：**① 格式锁定**（改已有文档时由目标文档反推格式，我没得选）
//           **② 命名接手**（前缀不用我记：我给的只有主题名）。
//
// 🔴 三条硬约束（缺一条这台机器就变成"第二条路"）：
//   · **写盘复用唯一那扇门** —— 本文件**不 spawn 内核**，只调 `f9-commit.js` 导出的
//     `runTxnOps()`（内核位置 / 子进程 stdio 不走管道 / `GAI_DANG_ROOT` 三件全在 f9 手里）；
//   · **组装逻辑不重写** —— 事件表摆落点＝`planCommit()`，待办落哪一节＝`planTodoAdd()`
//     （都从纹样册的 `assemble` 借来）。**本文件里没有一句"哪个字段放第几行"**；
//   · **"换门面"之前，现有入口一个字都不改** —— 本文件是**新增**，关掉它即回到现状。
//
// 📌 **诚实说明（一处，会在自检里出声，绝不静默）**：
//   ① ✅ **落盘管线已补齐（2026-10-07）**：以前只调 `runTxnOps()`（只有"写"）⇒ **比 `dangan_log` 弱**、
//      还漏了"落笔成功"那行记账（实证：织布机落的档 F30 第 18 关不认）。现在改调
//      `f9-commit.js` 的 **`runGuardedTxn()`** —— 与 `dangan_log` **同一条管线**
//      （写 → 写后体检 → **只有新出现的机械错**才 `--restore` 回滚）。那段是从 `commitLog()`
//      体内**原样提取**的；依据 `工程-清单.md` 节点 6，施工面见《拿不准》第 1 条。
//   ② **`parallel:true` 物理上仍是顺序**：落盘口是 `spawnSync`（阻塞）。
//      用户要的"并行"主要是"**一次调用织 N 份**"（省的是重复往来；ⓘ 计费现行口径见《备查-计费口径》）—— 那件事已经做到了。
//
// ⚠️ **别 import `lib/tools.js`**（它要 import 本文件来注册 `dangan_weave`）—— 会成环。
//    字段表的唯一来源仍是 `tools.js` 的 `danganLogTool.parameters`，由 `tests/f36-loom.mjs` 钉住。

// 🔴 2026-10-16：`findByName` 也进来 —— `openPattern()` 那句"点名了、档案里到底有没有"用它
//    判**存在性**（本文件原只用 `findByNameUnique`，那是"定位"用的、撞名返回 null）。
import { log, findByName, findByNameUnique } from './common.js'
import { SEG_LIMIT, segLimitOver } from './f5-check.js'
import { auditOps, kernelPath, rebuildIndexNow, runGuardedTxn, settleNamedTokens, sweepTxn } from './f9-commit.js'
import { baseNameOf, newDocName, patternByDoc, patternById, patternIds } from './loom-patterns.js'

// ============================================================
// 0. 错误类型 —— "织之前"的错一律抛它（**一个字都不写**）
// ============================================================

/**
 * 拒收（**参数 / 格式**这一类）。门面（`tools.js`）catch 它转成 `{ok:false,text}`。
 * @property {string} kind 机械可判的错类（见设计 §5.1 那张表）
 * @property {number} [index] 第几梭（0 起）
 * @property {string} [doc] 目标文档
 * @property {string} [hint] "机械可行的出路"（照 f9 的口气：说清 ＋ 给出路，绝不静默丢）
 */
export class LoomReject extends Error {
  constructor(kind, message, extra = {}) {
    super(message)
    this.name = 'LoomReject'
    this.kind = kind
    Object.assign(this, extra)
  }
}

// ============================================================
// 1. 格式端口 —— 只认纹样册（**判据在 `loom-patterns.js`，本文件不定义任何纹样**）
// ============================================================

/** 现有纹样 id（报错文案与自检都用它现算，别在别处抄份数）。 */
export function patternList() {
  return patternIds()
}

/** 目标文档必须**全档唯一命中**（撞名读错文件是最贵的一类错）。 */
function locateDoc(p, explicit) {
  const name = explicit ? baseNameOf(explicit) : p.docHint
  if (!name) {
    throw new LoomReject('ambiguous-doc', `「${p.id}」这一类**说不出要织进哪份文档** —— 停手。`, { hint: '纹样册里 `docHint` 是空的。' })
  }
  const hit = findByNameUnique(name)
  if (!hit) {
    throw new LoomReject('ambiguous-doc', `档案里找不到（或不止一份叫）\`${name}\` 的文档 —— 织布机停手。`, {
      hint: '撞名读错文件是最贵的一类错（`记录-…-待办重排.md` 撞 `工程-待办` 那个案子）。',
    })
  }
  return hit
}

/**
 * **格式锁定**：把 `pattern` 参数（字符串 / 对象）解析成一份确定的纹样。
 * 改已有文档时：目标文档的名字 → 纹样（**锁定**，与 `id` 冲突就拒）。
 * @param {string|{id:string,doc?:string,mode?:'append'|'new'}} input
 */
export function resolvePattern(input) {
  const list = patternList()
  const menu = `现有 ${list.length} 类：${list.join(' / ')}`
  if (input === undefined || input === null || input === '') {
    throw new LoomReject('unknown-pattern', `织布机要知道**织哪一种格式**。${menu}`)
  }

  if (typeof input === 'string') {
    const p = patternById(input)
    if (!p) {
      throw new LoomReject('unknown-pattern', `织布机不认 \`${input}\` 这种格式。${menu}`, {
        hint: '🔴 **要新增格式得先经用户允许** —— 别自己造一种（讨论稿 §二 第二层）。',
      })
    }
    return openPattern(p, list)
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new LoomReject('unknown-pattern', '`pattern` 要么是**纹样名**（字符串），要么是 `{ id, doc }` —— 收到别的形状。')
  }
  const byId = patternById(input.id)
  if (!byId) {
    throw new LoomReject('unknown-pattern', `织布机不认 \`${input.id}\` 这种格式。${menu}`, {
      hint: '🔴 **要新增格式得先经用户允许** —— 别自己造一种。',
    })
  }

  // ---- 没给目标文档 ⇒ 用"就地那一份" ----
  if (!input.doc) return openPattern(byId, list, input.mode)

  // ---- 给了目标文档 ⇒ **格式锁定：名字说了算** ----
  const target = String(input.doc).trim()
  if (target.includes('..') || /^[A-Za-z]:/.test(target) || target.startsWith('\\\\')) {
    throw new LoomReject('out-of-archive', `写入只认**档案内的相对路径**，收到 \`${target}\`。`, { doc: target })
  }
  const name = baseNameOf(target)
  if (!name) throw new LoomReject('bad-doc', `\`doc\` 说不出文件名：\`${target}\`。`, { doc: target })

  const onDisk = findByNameUnique(name)
  if (!onDisk) {
    // 用户 09-29 第 2 条：**检测不出格式的那一瞬 ＝ 你在新建**（不是异常）——
    // 但"新建"只允许由纹样册点头（落哪层、前缀怎么写全由 `newDocName` 说了算）。
    // 🔴 **2026-10-16**：原来这里无视 `byId.canCreate`，**一律**要求调用方显式传 `mode:'new'`
    //    ⇒ 首建型的纹样（`备查` / `指南` / **`地图`**）只要调用方没写 `mode`，就走不过去。
    //    ⇒ 纹样册既然已经点头（`canCreate`），这里就**按新建办**（名字由织布机接手）。
    if (input.mode !== 'new' && byId.canCreate !== true) {
      throw new LoomReject(
        'pattern-locked',
        `档案里没有叫 \`${name}\` 的文档 —— 所以锁不出格式。\n` +
          `   两条出路：① 你其实在**新建** ⇒ 传 \`{ id:'${byId.id}', mode:'new' }\`（名字由织布机接手）；\n` +
          `             ② 名字打错了 ⇒ 这一类"就地那一份"是 \`${byId.docHint ?? '（纹样册没写）'}\`。`,
        { doc: target },
      )
    }
    return { ...byId, doc: newDocName(byId, input), mode: 'new' }
  }

  const guess = patternByDoc(name)
  if (!guess) {
    throw new LoomReject(
      'pattern-locked',
      `\`${name}\` 在纹样册里**没有对应的格式行** —— 织布机锁不出它是哪一类，所以不动它。\n` +
        `   ⇒ 这属于"类目录盖不满实物"（《拿不准》第 12 条）：要织它，先把它补进类目录（**那要经用户允许**）。`,
      { doc: target },
    )
  }
  if (guess.id !== byId.id) {
    throw new LoomReject(
      'pattern-locked',
      `\`${name}\` 的格式是 **\`${guess.id}\`**，你给的是 **\`${byId.id}\`** ——\n` +
        `   🔴 **改已有文档时格式没得选**（织布机锁死它，讨论稿 §二 机制①）。要换格式请先改名 / 搬层。`,
      { doc: target },
    )
  }
  return { ...guess, doc: onDisk, mode: input.mode ?? 'append' }
}

/** 没点名文档时的开法：用纹样册的 `docHint` 定位"就地那一份"。 */
function openPattern(p, list, mode) {
  if (!p.defined || !p.assemble) {
    throw new LoomReject(
      'pattern-undefined',
      `「${p.id}」这一类**格式还没定**（现只剩《工程-各类文件格式》§3.6 元类 🔴 —— §3.2 时间轴已于 2026-10-11 补写成文）——\n` +
        `   织布机现在对它**只拒不动**。要织它：先请用户把那一类的写法定下来。`,
      { hint: '已登记的格式：' + list.filter((id) => patternById(id)?.defined).join(' / ') },
    )
  }
  // ⚠️ `docFree` 的纹样（目标跨多文件）也走这条路 —— 它同样"说不出点名哪一份"（阶段⑤）。
  if (p.canCreate === false && !p.docHint && p.docFree !== true) {
    throw new LoomReject('reserved-name', `「${p.id}」是**专用名**（专用名本身当格式标识）—— 要动它请点名那一份。`)
  }
  // 🔴 2026-10-10（阶段④）：**"新建型"纹样没有"就地那一份"** —— 目标文档还不存在，
  //    所以不定位；分组键用"那一梭的主题"（同一个主题归一组，`assemble` 自己算路径）。
  // 🔴 **2026-10-16 补上"首建"这一支**（真账：新馆**头一次**生成《地图》必死 ——
  //    `docHint` 有、`canCreate` 也允许建，可偏偏那份文档还不存在 ⇒ 原判据只放行"**没有 `docHint`**"
  //    的新建型，于是这一支照样掉到 `locateDoc()`、抛 `ambiguous-doc` ⇒ **目标文件永远长不出来，死锁**）。
  //    ⇒ 判据改成两条并列：**① 说不出点名哪一份（没有 `docHint`）** 或 **② 点名了、档案里确实还没有**。
  //    `locateDoc()` 从此只管"存在但撞名"与"档里没有、又不许建"这两件真正该拦的事。
  if (p.canCreate === true && !p.docHint) {
    return { ...p, doc: null, mode: mode ?? 'append' }
  }
  if (p.canCreate === true && !findByName(p.docHint)) {
    return { ...p, doc: null, mode: mode ?? 'append' }
  }
  // 🔴 2026-10-10（阶段⑤）：**"目标跨多份文件"的纹样**（`docFree`）—— 例如「引用改写」，
  //    一梭会散在几十份文件里，开纹样时**说不出"就地那一份"** ⇒ 不定位，交给 `assemble` 自己算。
  if (p.docFree === true && !p.docHint) {
    return { ...p, doc: null, mode: mode ?? 'append' }
  }
  return { ...p, doc: locateDoc(p), mode: mode ?? 'append' }
}

// ============================================================
// 2. 输入端口 —— 校验（**这一层只认字段表，不判内容对不对**）
// ============================================================

const BAD_NEWLINE = /[\r\n]/
const isBlank = (s) => typeof s !== 'string' || s.trim().length === 0

/** 🔴 一次最多织几梭（《拿不准》第 13 条）：落盘口是 `spawnSync`（阻塞），一次几十梭会把控制台堵住。 */
export const MAX_ITEMS = 20

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    throw new LoomReject('bad-items', `\`items\` 要一个**非空数组**（哪怕只织一条）。收到 ${items === null ? 'null' : typeof items}。`)
  }
  if (items.length === 0) throw new LoomReject('bad-items', '`items` 是空数组 —— 没有线，织不出东西。')
  if (items.length > MAX_ITEMS) {
    throw new LoomReject(
      'too-many-items',
      `一次最多织 **${MAX_ITEMS}** 梭（这批 ${items.length} 梭）—— 落盘口是阻塞 spawn，一次织太多会把控制台堵住。分两批发。`,
    )
  }
  return items
}

/**
 * 校验一梭。判据**全部借用现成的**：
 *   · 字段名 → 纹样册的 `fields`（唯一来源＝现有入口的参数表，由测试钉住）；
 *   · 字数 → `f5-check.js` 的 `SEG_LIMIT` / `segLimitOver`（体检那侧用的是同一份）；
 *   · 竖线 / 真换行 → 表格类文档一律禁（《使用说明》W6 ＋ T190 的教训：少打一个换行，两行粘成一行）；
 *   · 待办的强并列 / 查重 → `planTodoAdd` 自己会拒 / 会 skip（**本文件不重写**）。
 */
function validateItem(p, item, index) {
  const at = `第 ${index + 1} 梭`
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new LoomReject('bad-items', `${at}不是对象 —— 一梭 ＝ 一条内容（字段见「${p.id}」这一类）。`, { index })
  }
  const allowed = new Set(p.fields ?? [])
  const extra = Object.keys(item).filter((k) => !allowed.has(k))
  if (extra.length > 0) {
    throw new LoomReject(
      'unknown-field',
      `${at}里有「${p.id}」不认识的字段：\`${extra.join(' ／ ')}\` —— **它会被静默丢掉，所以我不织**。\n` +
        `   这一梭要的是：必填 ${(p.required ?? []).join(' / ') || '（无）'}；选填 ${(p.fields ?? []).filter((f) => !(p.required ?? []).includes(f)).join(' / ')}`,
      { index },
    )
  }
  const missing = (p.required ?? []).filter((k) => isBlank(item[k]))
  if (missing.length > 0) {
    throw new LoomReject('missing-field', `${at}缺必填：**${missing.join(' / ')}** —— 「${p.id}」这一类落笔前必须有它们。`, { index })
  }
  for (const [k, v] of Object.entries(item)) {
    if (typeof v !== 'string' || v.length === 0) continue
    if (BAD_NEWLINE.test(v)) {
      throw new LoomReject('bad-char', `${at}的 \`${k}\` 里有**真换行** —— 会粘行 / 破表（T190 的教训）：要分行用 \`<br>\`。`, { index })
    }
    if (p.noPipe !== false && v.includes('|')) {
      throw new LoomReject('bad-char', `${at}的 \`${k}\` 里有**竖线** \`|\` —— 会切断表格：改用 \`／\` 或全角 \`｜\`。`, { index })
    }
    if (p.segLimit) {
      const over = segLimitOver(v)
      if (over.length > 0) {
        throw new LoomReject(
          'too-long',
          `${at}的 \`${k}\` 里有一段 **${over[0].length} 字**（上限 ${SEG_LIMIT}）—— 口径是"**两行足够说清楚事情**"，` +
            `但 🔴 **步数不限**：拆成多段（\`<br>\`）或多条列表项都行。\n   那一段开头："${over[0].slice(0, 46)}…"`,
          { index },
        )
      }
    }
  }
  return item
}

// ============================================================
// 3. 织布机本体 —— 分组 → 组装（借现成件）→ 落盘（借唯一那扇门）
// ============================================================

/** 按**目标文档**分组。一批只能是一种纹样（混装 ⇒ 拒），但同一纹样可以跨多份文档。 */
function groupByDoc(p, items) {
  const groups = new Map()
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const doc = (typeof p.docOf === 'function' ? p.docOf(it) : null) ?? p.doc ?? (p.canCreate ? `（新建）${String(it?.主题 ?? it?.topic ?? '').trim() || '未命名'}` : p.docFree ? '（多文件）' : null)
    if (!doc) throw new LoomReject('ambiguous-doc', `第 ${i + 1} 梭说不出要织进哪份文档 —— 停手。`, { index: i })
    if (!groups.has(doc)) groups.set(doc, [])
    groups.get(doc).push({ item: it, index: i })
  }
  return groups
}

/**
 * 组装一梭 → `{ ops, files, summary, note }`。**判据全在别处**（`assemble` 借来的）。
 * ⚠️ 一梭 ＝ **一个事务**：op 里的行号是"**改动前**"的语义，两梭合成一个事务要重算行号
 *    ＝ 在本文件里再写一份组装逻辑（再造一条路）。**"同文档多梭合成一个事务"列为 v2。**
 */
function assembleOne(p, item, index) {
  if (typeof p.assemble !== 'function') {
    throw new LoomReject('pattern-undefined', `「${p.id}」这一类还没有组装件（它这一类的 assemble 是空的）—— 只拒不动。`, { index })
  }
  let built
  try {
    built = p.assemble(item)
  } catch (e) {
    // 组装件（`planCommit` / `planTodoAdd`）抛的错都是"参数不合法"那一类 ⇒ 原话照贴
    throw new LoomReject('rejected-by-planner', `第 ${index + 1} 梭被组装件拒了：${e?.message ?? e}`, { index })
  }
  if (built?.skip) return { skip: true, why: built.why ?? '组装件说不用写' }
  if (!Array.isArray(built?.ops) || built.ops.length === 0) {
    throw new LoomReject('empty-plan', `第 ${index + 1} 梭算下来**一处都不用改** —— 那就不该走到落盘这一步。`, { index })
  }
  return built
}

const snapOf = (out) => (String(out ?? '').match(/快照：(.+?)(?:（|\n|$)/) ?? [])[1]?.trim() ?? ''

/** **只算不写**（＝干跑 / 出提案）。给"我要先看一眼"和测试用。 */
export function weavePlan(pattern, items, opts = {}) {
  const p = resolvePattern(pattern)
  const list = normalizeItems(items)
  list.forEach((it, i) => validateItem(p, it, i))
  const groups = groupByDoc(p, list)
  const plans = []
  for (const [doc, group] of groups) {
    for (const { item, index } of group) {
      const built = assembleOne(p, item, index)
      if (built.skip) plans.push({ doc, index, skip: true, why: built.why })
      else plans.push({ doc, index, skip: false, ops: built.ops.length, summary: built.summary ?? [], note: built.note ?? '' })
    }
  }
  return {
    ok: true,
    text: [
      `【织布机 · 干跑】纹样「${p.id}」· ${list.length} 梭 · ${groups.size} 份文档`,
      ...plans.map((x) => (x.skip ? `  · ${x.doc}：**没写**（${x.why}）` : `  · ${x.doc}：${x.ops} 处改动 —— ${x.summary.join('；')}`)),
      '',
      '（干跑：**一个字都没写**。要真织请带 `commit:true`。）',
    ].join('\n'),
    data: { pattern: p.id, docCount: groups.size, itemCount: list.length, commit: false, plans },
  }
}

/**
 * **一次调用织多份**（这就是用户要的那个"并行"：一次调用办 N 件事，少几个来回）。
 * @param {string|{id:string,doc?:string,mode?:'append'|'new'}} pattern
 * @param {Array<object>} items
 * @param {{parallel?:boolean, commit?:boolean, before?:Array<object>, auditDone?:boolean,
 *          secretChecked?:boolean}} [opts]
 *   🔴 **2026-10-12（阶段⑥ 换门面 · 走 B）**：后三个是**换门面专用的让路参数** ——
 *   `commitLog()` 在把这一梭**交给织布机之前**已经替它做过同样两件事（`auditOps` 机械闸 ·
 *   F14 凭据硬拦），所以带上它们 ⇒ 织布机**不重复做**（原来会写两遍 `memoria-secrets.log`）。
 *   ⚠️ **默认全 `false` ＝ 老行为一个字不变**：直接调 `dangan_weave` 的那条路照旧自己全做一遍。
 *   `before` ＝ 写前那份"错"清单（`runGuardedTxn` 用它判"新出现的错"），省一次全档体检。
 */
export async function weave(pattern, items, opts = {}) {
  const { parallel = false, commit = false, before = null, auditDone = false, secretChecked = false } = opts
  if (!commit) return weavePlan(pattern, items, opts)

  const p = resolvePattern(pattern)
  const list = normalizeItems(items)
  list.forEach((it, i) => validateItem(p, it, i))
  const groups = groupByDoc(p, list)

  const t0 = Date.now() // ⏱ 报"这一趟花了多久"（《拿不准》第 13 条）
  // 🔴 2026-10-12（阶段⑥ 换门面 · 走 B）：**按纹样**织（原来按"目标文档"分组 ⇒ 一组一个事务）。
  //    为什么必须改：有一类纹样**一梭本来就跨好几份文档**（`事件表` 一梭 ＝ 时间轴那一行 ＋
  //    事件表正文 ＋ 顶部目录 —— 三者是**一件事**）。按文档切开 ⇒ 那一梭会被**撕成三个事务**：
  //    实测（`tests/f10-todo.mjs`）时间轴那一行与待办那一行**根本没写进去**，而回执说"落档成功"
  //    —— **假回执 ＋ 静默丢改动**，正是最贵的那类错。
  //    ⚠️ 原来的担心（"两梭合成一个事务要重算行号"）在本函数里**不存在**：`assembleOne()` 是
  //      **逐梭当场算**的（算完立刻落，见下面那个 for），几梭的行号本来就各自对同一份现行文件算。
  //    ⚠️ 对**单一文档**的纹样（待办 / 时间轴 / 目录 / 引用族…）这一改**一个字都没动**：
  //      它们本来就是"一梭一事务"，只是结果行里点名的文档仍取 `built.files`。
  const jobs = [() => weaveOneGroup(p, [...groups.keys()], [...groups.values()].flat(), { before, auditDone, secretChecked })]
  const settled = parallel
    ? // ⚠️ 包一层 `async` —— 否则 `j()` **同步**抛错会掀翻整批（`allSettled` 接不到，
      //    而前面已经写进去的组就没人报 ⇒ 整批报"没织"，档案却动过）
      await Promise.allSettled(jobs.map(async (j) => j()))
    : await Promise.all(
        jobs.map(async (j) => {
          try {
            return await j()
          } catch (e) {
            return { doc: '（未命名）', results: [], rolledBack: 0, why: String(e?.message ?? e) }
          }
        }),
      )
  // 🔴 2026-10-07 修：`parallel` 那条路原来直接把 `Promise.allSettled` 的**包装壳**
  //    （`{status, value}`）当成 `{doc, results, …}` 用 ⇒ `results` 永远是 undefined ⇒
  //    回执说「成 0 / 败 0」，而档案**其实写进去了**（真跑抓到：织 2 条待办，回执空、表里真多 1 条）。
  //    假回执比报错更危险 —— 它是"**看起来没写、其实写了**"。
  // 🔴 2026-10-07（对抗审查）再补：**整组没跑成**也必须变成一条 `ok:false` 的**结果** ——
  //    原来只把它挂在 `why` 上、没人打印 ⇒ `flat` 空 ⇒ `ok:true` ⇒ 报「已织完 成 0 / 败 0」，
  //    而档案一个字没写（`runGuardedTxn` 的 `checkArchive` / `writeFileSync` / `openSync` 都会抛）。
  const groupResults = settled.map((s, i) => {
    const doc = [...groups.keys()][i]
    const failed = (why) => ({
      doc,
      results: [{ index: null, doc, ok: false, why: `这一组整个没跑成（只影响本组）：${why}` }],
      rolledBack: 0,
    })
    if (parallel) return s.status === 'fulfilled' ? s.value : failed(s.reason?.message ?? s.reason)
    if (s && s.status === 'rejected') return failed(s.reason?.message ?? s.reason)
    if (s && Array.isArray(s.results) && s.results.length === 0 && s.why) return failed(s.why)
    return s
  })

  const flat = groupResults.flatMap((g) => g.results ?? [])
  const okCount = flat.filter((x) => x.ok).length
  const failCount = flat.filter((x) => !x.ok).length
  const rolledBack = groupResults.reduce((a, g) => a + (g.rolledBack ?? 0), 0)
  const ok = failCount === 0

  // 🔴 2026-10-15：**返回前把 `data` 洗干净** —— 这棵树里会夹着 `undefined`（例：某一梭没有 `ops`
  //    字段，上面那句 `改动 ${x.ops} 处` 就得写 `??` 兜底），而 harness 对工具返回值判
  //    「**value is not lossless JSON**」⇒ **整个回执作废**（实测 2026-10-15：待办那一行**其实已经
  //    写进去了**，我这边却只看到一条错误 —— 与《施工手册》坑 15 记的 `dangan_log` 那次同一个病，
  //    而那次只是"某些分支带 `data`、`output.schema` 没声明它"，这次是"声明了、但里面不干净"）。
  //    ⇒ 过一次 `JSON.parse(JSON.stringify())`：`undefined` 键落掉、其余原样。
  const data = JSON.parse(
    JSON.stringify({
      pattern: p.id,
      parallel,
      commit: true,
      itemCount: list.length,
      groupCount: groups.size,
      okCount,
      failCount,
      groups: groupResults,
    }),
  )

  return {
    ok,
    text: [
      `${ok ? '【已织完】' : '【织布机 · 有没织成的】'}纹样「${p.id}」· ${list.length} 梭 / ${groups.size} 份文档`,
      ...groupResults.flatMap((g) =>
        (g.results ?? []).map((x) => `  · ${x.doc}：${x.ok ? (x.text ?? `改动 ${x.ops} 处`) : `**没织成** —— ${x.why ?? ''}`}`),
      ),
      ...(rolledBack > 0 ? ['', `⚠️ 有 **${rolledBack}** 梭写完自检没过 → **已按快照退回**（只退那一梭，别的没动）。`] : []),
      ...(parallel ? ['', '📌 `parallel:true` 已按"同文档串行、跨文档一起发"执行（⚠️ 落盘口是阻塞 spawn ⇒ **物理上仍是顺序**，见文件头）。'] : []),
      '',
      `合计：成 ${okCount} / 败 ${failCount} · ⏱ ${((Date.now() - t0) / 1000).toFixed(1)} 秒。`,
    ].join('\n'),
    data,
  }
}

/**
 * 织**一批**：逐梭算（串行）→ 走那条唯一管线落盘。
 *
 * 🔴 **2026-10-12（阶段⑥ 换门面 · 走 B）改签名**：原先是"织**一组**（同一份文档）"，
 *    组内串行、**一组一个事务**。理由与代价见上面 `weave()` 里那一段注释 —— 一句话：
 *    **一梭本身可能跨多份文档**（事件表那一类），按文档切开会把它撕成几个事务、静默丢改动。
 * @param {object} p 纹样
 * @param {string[]} docs 这一批涉及的目标文档（只用来给回执点名；落点以 `built.files` 为准）
 * @param {Array<{item:object,index:number}>} items 全部梭（**顺序＝调用方给的顺序**）
 */
function weaveOneGroup(p, docs, items, { before = null, auditDone = false, secretChecked = false } = {}) {
  const doc = docs.length === 1 ? docs[0] : docs.join('、')
  const results = []
  let rolledBack = 0
  for (const { item, index } of items) {
    // ⚠️ 结果行点名的文档：**以这一梭真正要改的文件为准**（`built.files`），
    //    不是分组时那个"就地那一份" —— 事件表那一梭要改三份，回执得说三份。
    let at = doc
    let built
    try {
      built = assembleOne(p, item, index)
      if (Array.isArray(built?.files) && built.files.length > 0) at = built.files.join('、')
    } catch (e) {
      results.push({ index, doc: at, ok: false, why: e?.message ?? String(e) })
      continue
    }
    if (built.skip) {
      results.push({ index, doc: at, ok: true, skipped: true, why: built.why, text: `**没写**（${built.why}）` })
      continue
    }
    // ---- 落盘前的最后一道机械闸（f9 那道，逐条过："绝不让空值/换行/闭眼写进去"）----
    // 🔴 2026-10-12（阶段⑥ 走 B）：调用方（`commitLog`）已经过过这一道 ⇒ 不重复过（`auditDone`）。
    const problems = auditDone ? [] : auditOps(built.ops)
    if (problems.length > 0) {
      results.push({ index, doc: at, ok: false, why: `改动清单没过最后一道机械闸：${problems[0]}` })
      continue
    }
    // ---- 🔴 2026-10-15：凭据硬拦（F14）**从"写入闸"撤出**（用户当天拍板）----
    //    原来这里扫的是"**将要写进档案的那几行**"（`built.ops` 的 `op.text`）；L2 删后落档的 ops
    //    只剩「L3 时间标记」与「待办一行」⇒ **凭据根本不入 ops**（它在 `did` 或 L3 正文里）
    //    ⇒ 这道闸**已经扫不到东西**了。⇒ F14 改成**巡检哨兵**（`scanArchiveForSecrets()` 扫**整座档案**，
    //    不管凭据从哪条路进去的，见 `f14-secrets.js` 的 `reportF14()`）。
    // ---- 落盘：走 f9 那条**完整管线**（写 → 写后体检 → 只有新出现的机械错才回滚）----
    //      2026-10-07 前这里只调 `runTxnOps()`（只有"写"）⇒ 比 `dangan_log` 弱、且漏了记账。
    const g = runGuardedTxn(built.ops, {
      note: built.note ?? `织布机：${p.id} ×1`,
      create: built.create === true,
      ...(Array.isArray(before) ? { before } : {}),
    })
    const snapshot = g.snap ?? snapOf(g.out)
    if (g.ok) {
      // 🔴 2026-10-14 加（对抗审查抓到 · 用户拍板 **c**）：**顺手重织《索引》** ——
      //    为什么放这一层：`dangan_log`（commitLog）与 `dangan_weave` **两条路都过这里**；
      //    原来只挂在 `commitLog` 上 ⇒ 走织布机落的档**完全绕过重织**，销账判据永远读旧索引。
      //    ⚠️ 它走 `档案索引.mjs --apply`（**正门**：内部走织布机 ⇒ 先快照、写后体检、可回滚）；
      //    ⚠️ **fail-open**：失败只记日志，绝不让落档报错（档案已经写成了）。
      rebuildIndexNow()
      // 🔴 2026-10-07（换门面 · 第一步）：把 `dangan_log` 落笔后那三件**补齐** ——
      //    以前织布机"写进去"就完事，比落笔少三样：① 兑现「归账完成」提名 ② 清事务残件 ③ 落一行记账。
      //    ⚠️ 位置有判据：**只能在"事务真写成"之后**（就在 `g.ok` 这一支里）—— 没写成就销账 ＝ 空销。
      const settled = settleNamedTokens(item?.归账完成)
      const sweep = sweepTxn()
      log(`织布机落笔成功：${built.note ?? `织布机：${p.id} ×1`}（${built.ops.length} 处改动）`)
      results.push({
        index,
        doc: at,
        ok: true,
        ops: built.ops.length,
        files: built.files ?? [],
        snapshot,
        // 🔴 2026-10-12（阶段⑥ 走 B）：把"快照目录"与"写后那份错清单"**显式带出来** ——
        //    调用方（`commitLog`）要用它们**逐字重拼**原来的回执（`快照 …` / `机械错 N 条`）。
        //    ⚠️ 只**新增**字段，原有字段一个字没动。
        snap: snapshot,
        after: g.after ?? [],
        ...(settled.length > 0 ? { settled } : {}),
        ...(sweep?.orphan > 0 ? { orphanTxn: sweep.orphan } : {}),
        // 🔴 2026-10-12（阶段⑥ 换门面 · 走 B）：把 `planCommit` 算好的那几样**一并带出来** ——
        //    换门面之后调用方（`dangan_log` 的落笔半）要**重拼出与从前逐字相同的回执**
        //    （`【已落笔】…` ＋ 快照 ＋ 机械错 N 条），而原文案要用到这几个字段。
        //    ⚠️ 只**新增**字段，原有字段（ops/files/snapshot/settled/text）一个字没动。
        nextT: built.nextT,
        nextE: built.nextE,
        note: built.note,
        mode: built.mode,
        summary: built.summary ?? [],
        afterCount: (g.after ?? []).length,
        text:
          `改动 ${built.ops.length} 处${built.summary?.length ? `（${built.summary.join('；')}）` : ''}` +
          (settled.length > 0 ? `\n      **归账完成（销账）**：${settled.join(' · ')}` : ''),
      })
    } else {
      const selfcheck = g.stage === 'selfcheck'
      // 🔴 2026-10-07（对抗审查）：这个计数原来**声明了却从没自增** ⇒ 整批那条
      //    「⚠️ 有 N 梭已按快照退回」永远不出现（真回滚了也不报 —— 假沉默）。
      if (selfcheck && g.rolledBack) rolledBack += 1
      const why = selfcheck
        ? `写完自检没过 → ${g.rolledBack ? '**已回滚**（档案等于没动）' : '⚠️ **回滚没成功**'}：${(g.fresh ?? []).map((x) => x.msg).join('；')}`
        : g.why || '内核说没写成'
      // 🔴 2026-10-12（阶段⑥ 走 B）：内核自己的话**照旧进日志** —— 从前 `commitLog()` 会把
      //    `g.out` 原文拼进给用户的回执；换门面之后落盘归织布机，那句话改由这里说出来
      //    （不然"内核说没写"就成了一句没有下文的话）。
      if (!selfcheck && String(g.out ?? '').trim()) log(`织布机落盘没成：${String(g.out).trim()}`)
      results.push({
        index,
        doc: at,
        ok: false,
        // 🔴 2026-10-12（阶段⑥ 走 B）：**把"倒在哪一段"显式带出来** —— 调用方（`commitLog`）
        //    靠它把回执分成"没写成"与"写完自检没过 → 已回滚"两条**与从前逐字相同**的话。
        //    判据与上面那句 `why` 用的是同一个 `selfcheck`，不是新判据。
        stage: selfcheck ? 'selfcheck' : 'kernel',
        ops: built.ops.length,
        why,
        snapshot,
        snap: snapshot,
        ...(selfcheck ? { fresh: (g.fresh ?? []).map((x) => x.msg), rolledBack: !!g.rolledBack } : {}),
      })
    }
  }
  return { doc, results, rolledBack }
}

// ============================================================
// 4. 自检（**沉默 ≠ 正常**）—— 启动时报工作量，两处降级都出声
// ============================================================

export function loomSelfCheck() {
  const msgs = []
  try {
    const ids = patternList()
    const ok = ids.filter((id) => patternById(id)?.defined)
    const undef = ids.filter((id) => patternById(id)?.defined === false)
    msgs.push(`织布机：纹样册 **${ids.length} 类**（可织 ${ok.length}：${ok.join(' / ')}${undef.length ? ` ；格式未定 ${undef.length}：${undef.join(' / ')}` : ''}）`)
    // 🔴 **"读不到" ≠ "0 类"**（`reportF9Txn` 那条教训的同一族）
    // 🔴 2026-10-10 修（收口期间发现）：原来拿**全部可织纹样**当分母 ⇒ 老报"能定位到 4/11"，
    //    读起来像"7 类出问题了"；其实那几类**本来就没有"就地那一份"** ——
    //    新建型（`备查` / `指南`：目标文档还不存在）· 跨多文件（引用族三个：一梭散在几十份文件里）。
    //    ⇒ 分母改成**"该有就地文档的那几类"**，另把"没有就地那一份"的单独报一行（**沉默 ≠ 正常**照旧）。
    const needLocate = ok.filter((id) => {
      const p = patternById(id)
      return !!p?.docHint && p.canCreate !== true && p.docFree !== true
    })
    const noDoc = ok.filter((id) => !needLocate.includes(id))
    const located = needLocate.filter((id) => {
      try {
        return !!findByNameUnique(patternById(id)?.docHint ?? '')
      } catch {
        return false
      }
    })
    msgs.push(`织布机：能定位到 **${located.length}/${needLocate.length}** 份"就地文档"${located.length < needLocate.length ? '（⚠️ 有定位不到的 —— 那是"读不到"，不是"没有"）' : ''}`)
    if (noDoc.length > 0) {
      msgs.push(`织布机：另有 **${noDoc.length} 类**没有"就地那一份"（新建型 / 跨多文件 / 现算派生，**这不是毛病**）：${noDoc.join(' / ')}`)
    }
  } catch (e) {
    msgs.push(`织布机：纹样册**读不到**（${e?.message ?? e}）—— ⚠️ 这不等于"没有纹样"`)
  }
  const kp = kernelPath()
  msgs.push(`织布机：写入内核${existsSyncLite(kp) ? '在' : '**不在**（' + kp + '）'}`)
  msgs.push('织布机：落盘管线＝**完整版**（`runGuardedTxn` —— 写 → 写后体检 → **只有新出现的机械错**才回滚；与 `dangan_log` **同一条**）')
  for (const m of msgs) log(m)
  return msgs.join(' · ')
}

/** 单独包一层，免得为 `existsSync` 拉一整个 `node:fs` 的具名 import 面（本文件只用它一次）。 */
function existsSyncLite(p) {
  try {
    return process.getBuiltinModule('node:fs').existsSync(p)
  } catch {
    return false
  }
}
