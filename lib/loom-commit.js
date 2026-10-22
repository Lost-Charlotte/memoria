// ============================================================
// loom-commit · 「落档落点」那一层（2026-10-15 从 `f9-commit.js` 搬来；同日**削掉 L2 那半**）
// ============================================================
//
// 为什么有它：**织布机收口第 2 条** —— 「落档」这条路的入口收进织布机（`dangan_weave` 的
//   `pattern:'落档'`），而"摆落点"这一层从 `f9-commit.js` 搬到这里（f9 只**转调**它 ⇒ 那个
//   "两边互相借"的环断掉）。
//
// 🔴 **2026-10-15 深夜 再削一刀（「编号体系退役」）**：用户当天逐条判完 ——
//   `nextT` / `nextE` / `eventList` / `timelineRows` / `buildTimelineLine` /
//   `findEventCandidates` / `findContinuationCandidates` / `buildLogProposal` **全删**
//   （它们的服务对象是时间轴与事件表，**那两张表早删了**）。
//   ⇒ 本文件从此**只做两件事**：① 给 `detailIn` 那份 L3 写 / 推**时间标记** ② `kind='待办'` 时
//     顺手写一行待办（自带查重）。
//   🔴 **2026-10-15 深夜（用户拍板）：`DID_SELF` 也退役了** —— 见 `planCommit` 上面的说明。

import { findByName, nowStamp, stripExt } from './common.js'
// 取路径"最后一段"用 `baseOf()`（**唯一来源**，见 `lib/scope-registry.js`）—— 别自己 split。
import { baseOf } from './idx-scope.js'
import { planTodoAdd, todoCleanOps, todoPlanClean } from './f10-todo.js'
import { splitFile, stripL } from './commit-ops.js'

/** 这次事务会动到哪几份文件（从 ops 里现推，省得每加一处就忘了同步清单）。 */
export const filesOf = (ops) => [...new Set(ops.map((o) => o.file))]

/**
 * 把一次落档算成"一串改动"（**不写字**）。
 * 返回 `{ ops, note, files, summary }`；算不出来就 `throw`。
 * ⚠️ L2（时间轴 / 事件表）已删 ⇒ **不再有** `tNext` / `eNext` / `mode:'new'|'update'` 那套编号语义。
 * 🔴 **2026-10-15 深夜（用户拍板）：`DID_SELF`（「做了什么」> 150 字必须给 `detailIn`）已退役** ——
 *    它当初治的是"`did` 挤爆时间轴那一格"，而 L2 删后 `did` **不再入档**（只剩"数数字数"这一个用途）；
 *    "该不该写 L3"归 **W5 判据**（那是判据，150 字从来不是）。
 *    ⇒ 本层**再没有前置闸**：剩下的机械校验全在织布机（字段表 · 空梭 · 必填）。
 */
export function planCommit(args = {}) {
  const a = args ?? {}

  const ops = []
  const summary = []

  // ---- ② 给 `detailIn` 那份 L3 写 / 更新时间标记（`> 🕐 开始 ~ 结束`）----
  //   为什么：L2 删了之后，"这件事发生在什么时候"要由 **L3 自己带**：
  //     · 没有标记 ⇒ 在**开头三行自述之后**插一行；
  //     · 已有标记 ⇒ **只把末值推到「现在」**（起点不动）。
  {
    const l3ref = String(a.detailIn ?? '').trim()
    if (l3ref && /\.md$/i.test(l3ref)) {
      const lp = findByName(stripExt(l3ref))
      if (!lp) {
        // 🔴 2026-10-20（发布前修）：**新用户第一次落档必撞这里** —— 骨架的 `L3-知识` 里只有
        //    `记错本.md`，没有可写的记录文档 ⇒ 原来静默算成"一处都不用改"（`empty-plan`），
        //    用户以为插件坏了。现在把下一步直接说出来。
        throw new Error(
          `落档要写进「${l3ref}」，但档案里找不到这份 L3 文档 —— 先用 pattern:'备查'（或 '指南'）建一份，再落档。`,
        )
      }
      if (lp) {
        const relL = stripL(lp)
        const L = splitFile(lp)
        // ⚠️ 时间统一走北京时区（索引解析侧硬写 `+08:00`）—— 别用 `new Date()` 的本地字段拼。
        // 🔴 也不能用 `nowCN().slice(0,16)`（它是 `toLocaleString('zh-CN')`，返回 `2026/10/14 02:0…`
        //    ⇒ **索引根本认不出**）—— 正解 ＝ `nowStamp()`（`ymd` ＋ `hm` 的唯一来源）。
        const st = nowStamp()
        const stamp = `${st.ymd} ${st.hm}`
        const short = baseOf(relL)
        // ⚠️ **只在「开头自述区」（前 40 行）认标记** —— 扫全文会把正文里演示写法的那句改掉。
        let at = -1
        for (let i = 0; i < Math.min(40, L.lines.length); i++) {
          if (/^>\s*🕐\s*\d{4}-\d{2}-\d{2}/.test(L.lines[i])) {
            at = i
            break
          }
        }
        if (at >= 0) {
          const old = L.lines[at]
          // ⚠️ 起点取「🕐 后面第一个日期(可选时分)」—— **不能要求必须有 `~`**（否则只有起点的旧标记
          //    匹配不到，会把**真实起点覆盖成现在**）。
          // ⚠️ **别整行换掉** —— 标记后面若有尾巴（如「（起）」）会被静默吃掉。改成：已有
          //    「起点 ~ 末值」就**只换末值**；只有起点就在那一串**之后**插 ` ~ 末值`。
          let text
          if (/~\s*\d{4}-\d{2}-\d{2}/.test(old)) {
            text = old.replace(/(~\s*)\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/, `$1${stamp}`)
          } else {
            const m0 = old.match(/^>\s*🕐\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/)
            text = m0 ? old.slice(0, m0[0].length) + ` ~ ${stamp}` + old.slice(m0[0].length) : `> 🕐 ${stamp}`
          }
          if (text !== old) {
            ops.push({ op: 'replace', file: relL, line: at + 1, expect: old, text })
            summary.push(`L3 时间标记：${short} 末值 → ${stamp}`)
          }
        } else {
          let lastIntro = -1
          for (let i = 0; i < Math.min(40, L.lines.length); i++) if (/^>\s*(🏷|🕐|✍️)/.test(L.lines[i])) lastIntro = i
          if (lastIntro >= 0) {
            ops.push({ op: 'insertAfter', file: relL, line: lastIntro + 1, expect: L.lines[lastIntro], text: `> 🕐 ${stamp}` })
            summary.push(`L3 时间标记：${short} 加一行（${stamp}）`)
          }
        }
      }
    }
  }

  // ---- ③ W5 的"条件项"里最后一条：这是"待办"就顺手写进待办文件（**自带查重**）----
  // 为什么必须自动：用户当天点破"你的待办全丢了" —— 我整轮把"还有什么要留意"只写在聊天里。
  // **只要我说出口了，就该当场落一次档**（《记错本》R27）。
  if (a.kind === '待办') {
    const t = planTodoAdd({ item: a.todoItem ?? a.what, why: a.todoWhy, goal: a.todoGoal, term: a.todoTerm, owner: a.todoOwner, force: a.todoForce === true })
    if (t.skip) {
      summary.push(`待办：**没有重复写** —— ${t.why}${t.hits.length > 1 ? `（另有 ${t.hits.length - 1} 条也像）` : ''}`)
    } else {
      ops.push(t.op)
      summary.push(`待办：加一行到 ${t.where}`)
      if (t.warn) summary.push(t.warn)
    }
  }

  // ---- ④（2026-10-20 加）**顺手把"已经标了 ✅/🔚"的待办移出去** ----
  //   用户当天拍板：「**我们已经有那么多自动化了。或许可以并入**」⇒ 并入**落档那一刻**：
  //   落档本来就要写档案，同一个事务里把"作者已经判定完成"的条目搬进 `L8-施工归档\待办归档\`。
  //   🔴 **只动已标 ✅/🔚 的那类**（判据在 `f10-todo.todoPlanClean()`）；**移出去不是删**（归档行带着原文进 L8）。
  //   ⚠️ 清不了（归档件没建好 / 读不到待办）**不许让落档失败** —— 整段 catch 掉，理由与销账那层一样。
  {
    try {
      const cl = todoCleanOps({ plan: todoPlanClean() })
      if (cl && Array.isArray(cl.ops) && cl.ops.length > 0) {
        // ⚠️ **放在最前面**：这些是 `deleteLine`，行号按"读那一刻"算的 ——
        //    若排在后面（前面先 insert 了新行），行号就偏（虽然每行都带 `expect` 会当场停手，但会白失败一次）。
        ops.splice(0, 0, ...cl.ops)
        summary.push(`待办：${cl.note}`)
      }
    } catch {
      /* 清不了就算了 —— 落档本身不该因此失败 */
    }
  }

  return {
    ops,
    note: `落档：${ops.length} 处改动`,
    files: filesOf(ops),
    summary,
  }
}
