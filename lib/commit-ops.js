// ============================================================
// commit-ops · 「落档落点」这一层的共用件（2026-10-15 从 `f9-commit.js` 抽出）
// ============================================================
//
// 为什么抽它：**织布机收口第 2 条**（`L4-施工\工程-织布机-总纲.md` §七之二）——
//   要把"摆落点"（`planCommit`）从 `f9-commit.js` **搬进织布机**，而它借了 f9 一串私有件。
//   ⇒ **先把这些件抽成独立模块**（f9 原地 `import` 回来、对外一个字不变），下一步再搬那一层。
//
// ⚠️ **本模块只搬家、不改语义**：下面每个函数的实现**逐字照搬**自 `f9-commit.js`。
//   判据的**唯一权威**仍在各自主人那里：字数＝`f5-check.js` 的 `SEG_LIMIT`/`segLimitOver`；
//   引文＝`f27-citation.js` 的 `MIN_QUOTE_CHARS` —— 这里只是这一层用到的**取行 / 定位 / 提醒**件。

import { CFG, readTextSafe } from './common.js'
// 🗑 2026-10-15：`SEG_LIMIT` / `segLimitOver` 的 import 已随"字数闸门"一起撤（见下面那段注）。
import { MIN_QUOTE_CHARS } from './f27-citation.js'

/* 🗑 这里原来有一个 `segLimitGate()`（"每段 ≤120 字"的字数闸）—— **2026-10-15 撤**。
   为什么撤：它治的是"**事件表被追成流水账**"（E91 那条），而 **L2 整层已删** ⇒ 它拦的
   `why` / `did` / `result` **一个字都不写进档案**（落档只写 L3 时间标记 ＋ 待办）
   ⇒ **没有对象了**，却还在真拦（用户当天点破：「现在都没这俩表了，怎么还在限制长度」）。
   📌 那道 `DID_SELF`（>150 字要给 `detailIn`）**也在 2026-10-15 深夜退役了** —— 同一个理由：
      `did` 已不再入档（剩"数数字数"一个用途），而 150 字**从来不是判据**（判据是 W5）。
      ⇒ **落档口现在一道前置闸都没有**（剩下的机械校验全在织布机：字段表 · 空梭 · 必填）。 */

/** 读成行数组（与内核同一套口径：记住换行风格和末尾有没有换行）。 */
export function splitFile(p) {
  const raw = readTextSafe(p)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const tail = raw.endsWith('\n')
  const lines = raw.split(/\r?\n/)
  if (tail) lines.pop()
  return { raw, eol, tail, lines }
}

export const stripL = (p) => p.slice(CFG.archiveDir.length + 1)

// 🔴 2026-10-20 删净：`norm()` 与 `shortStatus()`（原本只为"事件表顶部目录里那一格状态要短"服务）。
//    事件表随 L2 删了、`commitLog()` 当天也删了 ⇒ **两个都零调用**。判据/实现需要时再看 CHANGELOG 0.80.3。

// 🔴 2026-10-20 删净：`locateEvent()` / `fieldLine()` / `indexRowLine()` / `lastIndexRowLine()` / `cellOf()`
//    —— 五件全是"事件表 / 时间轴"的取行工具，而**那两张表随 L2 早删了**。`commitLog()` 删掉之后
//    它们连最后一个调用方都没了（织布机走的是 `loom-commit.js`，不用这五件）。

/**
 * 🔴 **F27 落笔前的提醒**（2026-09-18）：正文里引了"**用户原话**"，却没标**出处锚**
 *   （形如 `〔T312〕` / `〔E122〕`）—— 这正是《记错本》**R28**"张冠李戴"的入口。
 *   ⚠️ **只提醒、不拒写**：落档是**整次事务**（时间轴 ＋ 事件条目 ＋ 目录一起写），
 *      拒写会把整次都毁掉；事后还有 **F27 哨兵**兜底（它会拿引文去那个出处里核，见 `f27-citation.js`）。
 */
export function citeAnchorWarn(a) {
  const text = [a.what, a.why, a.did, a.result, a.title].filter(Boolean).join('\n')
  const m = /(原话|原话是)([^"“\n]{0,40})["“]([^"”\n]{4,300})["”]/.exec(text)
  if (!m) return ''
  if (/〔\s*[TE]\d+\s*〕/.test(text)) return ''
  // 🔴 2026-09-20 加：`〔会话〕` ＝ "**当场原话，档案里没有它的锚**"（编号是**这次落档才生成**的，无处可补）
  //    → 不提醒。⚠️ 口径的**唯一权威在 `f27-citation.js`**（那边**照样把它数出来** `✅ 另有 N 处`），
  //    所以这条不是"放水"：不打扰，但看得见。
  if (/〔\s*会话[^〕]*〕/.test(text)) return ''
  // 🔴 **2026-09-19 加：太短的引文不提醒"补锚"** —— 补了也核不动（归一化后 < 6 字时机器会一次命中一片）。
  //    ⚠️ **只借这一条**：**不因为"像是在谈论引用格式"就放宽提醒** —— 提醒是"宁可多说"的那一侧，
  //       放宽就会漏掉真该提醒的引用。分档（短 / 讲格式 / 真引用）是**哨兵**那边的事，见 `f27-citation.js`。
  const plain = m[3].replace(/\*\*|__|`|~~/g, '').replace(/[\s\u3000]+/g, '')
  if (plain.length < MIN_QUOTE_CHARS) return ''
  return '⚠️ 这条落档里引了"**用户原话**"但**没标出处锚** —— 按 F27 的规矩补一个（形如"T 号 / E 号加方括号"），否则哨兵核不上（《记错本》R28）'
}
