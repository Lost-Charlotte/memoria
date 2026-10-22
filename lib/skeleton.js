// ============================================================
// skeleton —— 给 F22/F23 的留底生成"骨架"（**销账时读它，不读全文**）
// ============================================================
//
// 为什么有它（2026-09-19 凌晨，用户点出的老大难：
//   "每次新会话，老会话的归档问题就是个老大难，总不能每次都读那么大的上下文"）：
//
//   实测一份留底（会话 3a93da5b，660 KB / 358,107 字符 / 244 帧）——
//     · reasoning（**我的思考链**）212 块 / **302,618 字符（84.5%）**
//     · text（**我对用户说的正式答复**）138 条 /  12,550 字符（3.5%）
//     · 工具结果                      354 段 /  13,902 字符（3.9%）
//     · 用户真事（滤掉机器注入后）      4 条 /   4,062 字符（1.1%）
//     · 机器注入（插件 ＋ system-reminder）    /  12,727 字符（3.6%）
//   → 销账真正需要的 ＝ 用户真事 ＋ 我的正式答复 ≈ **16.6K（4.6%）**；
//     其余 95% 是"我的内心独白 ＋ 工具输出 ＋ 我自己注入的入口"。
//   **实测产出：358,107 → 21,116 字符（5.9%，17 倍）。**
//
// 规则（**按块类型分流**，不是截断、也不是取首取尾）：
//   · user/message（排除 `source.kind==='plugin'` 与**以 XML 标签开头**的机器注入）→ 逐字全留
//   · assistant/message 的 `text` 块      → **逐字全留**（这才是"我对用户说的话"）
//   · assistant/message 的 `reasoning` 块 → 丢（思考链，销账不需要）
//   · tool-call / tool-result             → 丢（那是证据，不是信息源）
//
// 🔴 为什么从**会话日志**取而不是从留底 `.md` 里切：日志里有块类型（`reasoning`/`text`），
//   `.md` 渲染后两者混成一片、切不开。留底全文**一个字都没删**，要查细节回它 `grep`。
//
// ✅ **2026-09-28 起插件自己会清它**：销账那一刻（主份挪进 `verified` 时）与 verified 到期清理时，
//   都把这份骨架一并删掉 —— 见 `lib/f29-verified.js` 的 `moveToVerified()` / `cleanVerified()`。
// ============================================================

import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
// 🔴 2026-10-10 加（用户当天点"**确实需要分馆**"）：骨架头里要写明"属于哪个馆" ——
//    留底/骨架目录**不分馆**（按会话 id 存），不写这一行就认不出是哪座馆的。
import { CFG, activeArchiveDir } from './common.js'

import { HOME_DIR } from './common.js'

// ⚠️ 必须从 common.js 的 HOME_DIR 拿（它认 `DSH_HOME`）——
//    用 `os.homedir()` 会让测试写进**真实** `~/.dsh`，违反"测试不碰 ~/.dsh"。
export const SKELETON_DIR = join(HOME_DIR, 'memoria-dumps', 'skeleton')

/**
 * 骨架/摘要目录 —— **2026-10-17 起跟着馆走**：`<馆>\L6-工具临时\留底\`。
 *
 * 用户当天："别到处乱放了…那骨架为什么没放 l6。都放 l6。"
 * ⇒ 派生物随馆走（换馆/删馆都不会串），`~/.dsh` 只留旧版兼容。
 * ⚠️ `activeArchiveDir()` 拿不到时**回落旧目录**（fail-open，绝不拦销账）。
 */
export function skeletonDir() {
  // 🔴 测试/沙箱（显式 DSH_HOME）⇒ 留在 HOME_DIR 下：**绝不写真实档案**。
  if (process.env.DSH_HOME) return SKELETON_DIR
  try {
    const root = activeArchiveDir()
    if (root) return join(root, 'L6-工具临时', '留底')
  } catch {
    /* 回落 */
  }
  return SKELETON_DIR
}

/**
 * 只留最近 N 份（骨架 ＋ 摘要**成对**）。
 *
 * 用户 2026-10-17："能不能只留最近十份。"
 * ⚠️ **保护还没销账的**：`protect` 里有该会话短 id ⇒ 那份**不删** ——
 *    否则销账时摘要/骨架被清掉，第 18 关就读无可读（宁可多留，不许让销账断粮）。
 * 只删派生物（R32：插件自己的东西插件自己清）；失败 fail-open。
 */
export function pruneSkeletonDir(dir = skeletonDir(), keep = 10, protect = new Set()) {
  try {
    const names = readdirSync(dir)
    const groups = new Map()
    for (const n of names) {
      const m = n.match(/^(骨架|摘要)-(归档|压缩)-([0-9a-f]{8})\.md$/i)
      if (!m) continue
      const key = `${m[2]}-${m[3]}`
      if (!groups.has(key)) groups.set(key, { sid: m[3].toLowerCase(), files: [] })
      groups.get(key).files.push(n)
    }
    const list = [...groups.entries()]
      .map(([key, g]) => ({ key, ...g, mtime: Math.max(...g.files.map((f) => statSync(join(dir, f)).mtimeMs)) }))
      .sort((a, b) => b.mtime - a.mtime)
    let removed = 0
    for (const g of list.slice(keep)) {
      if (protect.has(g.sid)) continue
      for (const f of g.files) {
        try {
          unlinkSync(join(dir, f))
          removed += 1
        } catch {
          /* fail-open */
        }
      }
    }
    return { ok: true, removed, kept: Math.min(keep, list.length) }
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e) }
  }
}

/** 毫秒时间戳 → 北京时间 `YYYY-MM-DD HH:MM`（销账要按时间对账）。 */
export function fmtTime(ms) {
  try {
    const d = new Date(Number(ms))
    if (Number.isNaN(d.getTime())) return String(ms)
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d)
  } catch {
    return String(ms)
  }
}

const blocksOf = (ev) => {
  const d = ev?.data ?? {}
  const msg = d.message && typeof d.message === 'object' ? d.message : d
  return Array.isArray(msg?.content) ? msg.content : []
}

/**
 * 事件数组 → 骨架文本。**纯函数**（F23 与 `tools/dump-skeleton.mjs` 共用这一份规则）。
 * @param {any[]} events 会话事件（`readSessionEvents` 的输出）
 * @param {{shortSid?:string, source?:string}} [meta]
 */
export function renderSkeleton(events, meta = {}) {
  const list = Array.isArray(events) ? events : []
  const stats = {
    events: list.length,
    userMsgs: 0, userChars: 0,
    textBlocks: 0, textChars: 0,
    reasoningBlocks: 0, reasoningChars: 0,
    injected: 0, injectedChars: 0,
    toolChars: 0, toolBlocks: 0,
    dropped: 0,
  }
  const body = []

  for (const ev of list) {
    const t = String(ev?.type ?? '')
    const time = fmtTime(ev?.time)
    if (t === 'user/message') {
      const d = ev?.data ?? {}
      // 🔴 2026-09-28 改（**DSH 0.1.7 会话格式 v4**）：判据从「`kind === 'plugin'`」改成「**有 kind 且不是 `user`**」——
      //    v4 明确拒收 `kind:'plugin'` 这个包装名：官方插件与压缩摘要改用**各自的自有名**
      //    （`@deepseek-ai/dsh-system-prompt` → `runtime-context` · 压缩摘要 → `compact-basic` …），
      //    连梅莫莉亚自己的注入也改成了 `dsh-memoria` —— 再按旧名判，**自己的注入会被当"用户真事"混进骨架**。
      //    ⚠️ **缺 kind 的不算注入**（不是每条历史消息都带 `source`）：宁可多算一条用户的话，
      //       也**不许静默丢掉**用户的真话 —— f29 的回归测试就是靠这条把"判太严"当场抓出来的。
      const srcKind = d?.source?.kind
      const isPlugin = typeof srcKind === 'string' && srcKind !== 'user'
      const text = blocksOf(ev)
        .map((b) => (typeof b?.text === 'string' ? b.text : ''))
        .join('\n')
        .trim()
      if (!text) continue
      // 机器注入有两条路进 user/message：**`source.kind !== 'user'`**（梅莫莉亚的、官方摘要…），
      // 与**以 XML 标签开头的**（`<system-reminder>` 那类 AGENTS.md / 工作区指令重发）。
      // 🔴 实测踩过：不滤后者 → 一条 6.7K 的 AGENTS.md 全文混进"用户真事"。
      const looksInjected = /^<[a-z][a-z0-9_-]*>/i.test(text)
      if (isPlugin || looksInjected) {
        stats.injected += 1
        stats.injectedChars += text.length
        stats.dropped += text.length
        // **不静默丢**：原位留一行占位，让"丢了多少"看得见
        if (looksInjected && !isPlugin) body.push(`> 〔已省略机器注入 ${text.length} 字符 · ${text.slice(0, 40).replace(/\n/g, ' ')}…〕`, '')
        continue
      }
      stats.userMsgs += 1
      stats.userChars += text.length
      body.push(`## 用户 · ${time}`, '', text, '')
      continue
    }
    if (t === 'assistant/message') {
      for (const b of blocksOf(ev)) {
        const kind = String(b?.type ?? '')
        const text = typeof b?.text === 'string' ? b.text : ''
        if (kind === 'reasoning') {
          stats.reasoningBlocks += 1
          stats.reasoningChars += text.length
          stats.dropped += text.length
          continue
        }
        if (kind === 'text') {
          const s = text.trim()
          if (!s) continue
          stats.textBlocks += 1
          stats.textChars += s.length
          body.push(`## 我 · ${time}`, '', s, '')
          continue
        }
        stats.toolBlocks += 1
        stats.dropped += text.length
      }
      continue
    }
    if (t === 'tool/result') {
      const len = blocksOf(ev).reduce((n, b) => n + (typeof b?.text === 'string' ? b.text.length : 0), 0)
      stats.toolChars += len
      stats.dropped += len
    }
  }

  const head =
    `# 骨架（销账用）—— 会话 ${meta.shortSid ?? '?'}\n\n` +
    `> 这是**派生物**，只为销账时读：**只有真人对话 ＋ 我发给你的正式答复**，逐字未改。\n` +
    `> 没进来的：**我的思考链**（${stats.reasoningChars} 字符）· 工具结果（${stats.toolChars}）· 机器注入（${stats.injected} 段/${stats.injectedChars}）。\n` +
    `> 用户真事 ${stats.userMsgs} 条 · 我的正式答复 ${stats.textBlocks} 条 ← **对账工具拿这两个数的"各份之和"交叉校验"切分有没有漏"**（2026-09-20 加 · 2026-10-10 改成按份求和 —— 叠份时不再误报）\n` +
    `> 🏛 **属于哪个馆**：\`${CFG.archiveDir}\` —— ⚠️ 留底/骨架**目录不分馆**（按会话 id 存），所以靠这一行才认得出。\n` +
    `> 全文一个字没删，要查细节回留底主份 \`grep\`。来源：\`${meta.source ?? '?'}\`\n` +
    `> ✅ **销账不用你手动删任何东西**：落档时带一句 \`归账完成: ["${meta.shortSid ?? '?'}"]\` —— 事务**真写成**之后，插件自己把**留底主份**挪进 \`verified\\\`（**骨架保留三天** —— 2026-09-29 用户定：「骨架保留三天，不要当场就删除」；手动删既不算"补完了"，也没有"从备份恢复"那回事）。\n\n---\n`

  const skeleton = `${head}\n${body.join('\n').trimEnd()}\n`
  return { skeleton, stats }
}

/**
 * 骨架文件名 —— **与留底文件名同构**（`压缩留底-<会话>.md` ↔ `骨架-压缩-<会话>.md`）。
 *
 * ⚠️ **必须按来源分开**：同一个会话**可能先压缩、后归档**，两条路各出一份骨架；
 *    拿裸 sid 命名会**撞名** —— 后写的那份被"拒绝覆盖"挡掉，销账时就没有骨架可读。
 */
export const skeletonFileName = (sid, kind = 'compact') =>
  `骨架-${kind === 'archive' ? '归档' : '压缩'}-${String(sid).replace(/^session-/, '').slice(0, 8)}.md`

/** 摘要文件名 —— 与骨架同前缀、一一对应（销账时先读它，不读骨架）。 */
export const digestFileName = (sid, kind = 'compact') =>
  skeletonFileName(sid, kind).replace(/^骨架-/, '摘要-')

/**
 * 骨架文本 → 销账摘要（**纯函数，不用模型**）。
 *
 * 只抽两样：用户整段 ＋ 我每轮的「这轮为达成什么」行。
 * 某轮没有那行 ⇒ 打 `⚠ 无摘要：Lxx-Lyy`，销账时只回读这一段（不重读全文）。
 *
 * 为什么是这两样：用户原话是"意图"，我的每轮结论是"落点"；其余全是我自己的铺陈。
 */
export function renderDigest(skeletonText, meta = {}) {
  const lines = String(skeletonText ?? '').split(/\r?\n/)
  const out = []
  let role = null
  let userLines = []
  let mineLines = []
  let userStart = 0
  let turn = 0
  let missing = 0

  const flush = (endLine) => {
    if (userLines.length === 0 && mineLines.length === 0) return
    const u = userLines.join('\n').trim()
    if (u) {
      turn += 1
      out.push(`## 用户 · L${userStart}`)
      out.push(u)
      const summary = mineLines.find((t) => /这轮为达成什么/.test(t))
      if (summary) out.push(`→ ${summary.trim()}`)
      else {
        missing += 1
        out.push(`⚠ 无摘要：L${userStart}-L${endLine || userStart}（必要时只读这一段）`)
      }
      out.push('')
    }
    userLines = []
    mineLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^##\s*用户/.test(line)) { flush(i); role = 'user'; userStart = i + 1; continue }
    if (/^##\s*我/.test(line)) { role = 'mine'; continue }
    if (line.startsWith('# 骨架') || line.startsWith('> ')) continue
    if (role === 'user') userLines.push(line)
    else if (role === 'mine') mineLines.push(line)
  }
  flush(lines.length)

  const body = out.join('\n').trimEnd()
  const head = [
    `# 摘要（销账用）${meta.name ? ` · ${meta.name}` : ''}`,
    `轮次 ${turn} · 摘要 ${body.length} 字符 / 骨架 ${meta.totalChars ?? lines.join('\n').length} 字符 · 缺摘要 ${missing} 轮`,
    '',
  ].join('\n')
  return { text: `${head}${body}\n`, chars: body.length, turns: turn, missing }
}

/**
 * 写骨架文件。
 *
 * 🔴 **默认"已存在就拒绝"**（`wx` 标志）—— 骨架是派生物，宁可报错也不许静默改写。
 * ⚠️ **2026-10-07 改口径**：压缩路（`kind:'compact'`）仍传 `overwrite: true`，
 *    但它的含义从"**覆盖**"变成了"**接着写**"（`'a'` 追加）——
 *    因为主份（`f22.persistDump`）也改成接写了：同一个会话里上一次**还没销**的那份，
 *    承载的是"更早被揉掉／裁掉、**还没核过**"的原文；盖掉它 ＝ 那段**没人核**。
 *    ⇒ **两边同步接写** ⇒ 原来担心的"主份是新的、骨架还是旧的"不会出现。
 *    ⚠️ **已经核过的那份不在这里**（销账时主份已被挪进 `verified/`）⇒ append 到的永远是"还没核的"那份。
 *
 * @param {string} sid 会话 id
 * @param {any[]} events
 * @param {string} source 原文来源（写进骨架头，便于回查）
 * @param {{kind?:'compact'|'archive', out?:string, overwrite?:boolean}} [opts]
 */
export function writeSkeleton(sid, events, source, opts = {}) {
  const kind = opts.kind === 'archive' ? 'archive' : 'compact'
  const short = String(sid).replace(/^session-/, '').slice(0, 8)
  const dir = opts.dir ?? skeletonDir()
  const out = opts.out ?? join(dir, skeletonFileName(sid, kind))
  // 🔴 2026-10-07（对抗审查）：模式**必须由调用方按"主份刚才到底干了什么"给** ——
  //    原来是"只要 `overwrite` 就无条件追加" ⇒ 主份覆盖、骨架却接写 ⇒ "**主份新、骨架旧**"又回来了。
  //    三档：`append` 接写（主份接写了）· `replace` 覆盖（主份是覆盖写的）·
  //    `create` 只在不存在时写（拿不准主份干了什么时用 —— 宁可不写，也不写坏）。
  //    ⚠️ 旧参数 `overwrite` 仍认：`true` ⇒ `append`、不给 ⇒ `create`（老调用点行为不变）。
  const mode = opts.mode ?? (opts.overwrite ? 'append' : 'create')
  const flag = mode === 'append' ? 'a' : mode === 'replace' ? 'w' : 'wx'
  const { skeleton, stats } = renderSkeleton(events, { shortSid: short, source })
  // 🔴 2026-10-07 加（**别写空骨架**）：没有可渲染的对话 ⇒ **不写**。
  //    实证（当天新馆那次 · 20:46）：prune 路攒够 10 条写留底 —— 留底 **224,174 字符**是有内容的，
  //    而骨架只渲染出 **404 字符 / 用户真事 0 条 / 正式答复 0 条**：那批被裁掉的**本来就没有可渲染的对话块**
  //    （prune 裁的是旧工具结果）。空壳**没用**，还会让销账时的"必读骨架"变成读一份空文件
  //    （第 18 关要求提名前**必须先读摘要**，摘要拿不准才读骨架 —— 2026-10-22 用户把优先级改成"摘要首选"）。⇒ **宁可不写** ——
  //    销账那边已有"⚠️ 骨架缺 → 只能读原文"那条路（`dumpNotice` 与 `f18` 都认）。
  if (stats.userMsgs === 0 && stats.textBlocks === 0) {
    return {
      ok: false,
      out,
      skipped: true,
      stats,
      why: '这一批**没有可渲染的对话**（用户真事 0 条 / 正式答复 0 条）—— 不写空骨架',
    }
  }
  try {
    mkdirSync(dirname(out), { recursive: true })
    // 🔴 接写（`'a'`）：分隔符写在**每段末尾** —— 首段开头不会多一个空 `---`；末段后会多一个，无害。
    writeFileSync(out, mode === 'append' ? `${skeleton}\n\n---\n\n` : skeleton, {
      encoding: 'utf8',
      flag,
    })
    // 🔴 2026-10-17 加：**同一刻写摘要**（销账只读它，不读骨架）。失败只记着，不拦销账。
    let digest = { ok: false, why: '未生成' }
    try {
      const merged = mode === 'append' ? readFileSync(out, 'utf8') : skeleton
      const d = renderDigest(merged, { name: skeletonFileName(sid, kind), totalChars: merged.length })
      const dpath = join(dirname(out), digestFileName(sid, kind))
      writeFileSync(dpath, d.text, { encoding: 'utf8', flag: mode === 'create' ? 'wx' : 'w' })
      digest = { ok: true, out: dpath, chars: d.chars, turns: d.turns, missing: d.missing }
    } catch (e) {
      digest = { ok: false, why: String(e?.message ?? e) }
    }
    return { ok: true, out, chars: skeleton.length, stats, mode, overwritten: mode === 'append', digest }
  } catch (e) {
    return { ok: false, out, why: e?.code === 'EEXIST' ? '骨架已存在（不覆盖）' : String(e?.message ?? e) }
  }
}
