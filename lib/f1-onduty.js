// ============================================================
// F1 · 在岗标记 ＋ 钩子转交（2026-09-29 砍掉"压缩后重注入"之后）
// ============================================================
//
// 它现在只干三件事：
//   ① **在岗标记**：每个新会话首轮给一行 —— 插件掉出组合树时它会消失，
//      这是「它没在跑」最早的信号（见 `buildOnDuty`）。
//   ② **钩子转交**：`session/event` 与 `agent/pre-step` 这两个钩子**只挂在这一处**
//      —— `ctx.on()` 是"后注册的顶掉先注册"（实测：别处一挂，这里整条链就哑）。
//      所以 F22 压缩留底、F28 油表、F23 归档留底、骨架兜底、F34 考勤、记用户原话
//      **全由这里转交**，它们自己不许再挂。
//   ③ **留意栏（F26）的注入点**：把"现在有什么要留意"挂到用户那条消息上。
//
// ⚠️ **原「压缩后重注入」已于 2026-09-29 整条删除**（用户拍板："砍 1"）。理由（当时查实的）：
//    · 它只**往上下文塞文本**，**不进"已读"记账** —— 而 A 关认的是"`read` 过没有"
//      （`f30-toolgate.js`：读类工具是唯一算数"读过某份文件"的东西）⇒ **注入不算读过**
//      ⇒ **压缩后 A 关照旧拦**。
//    · 而 A 关要的是读齐**整个 `L1-必读`**（实测 80.7K 字符），重注入只给两份（入口＋铁律，
//      ≈15.5K）⇒ **覆盖不全**、**两套机制管同一件事 ⇒ 必然漂**（它已经漂了：2 份 vs 8 份）。
//    · 更要命：**它会给我"我已经读过"的错觉**（用户当晚原话："为什么你会觉得需要呢？"）。
//    ⇒ 结论：**它的目的已被 A 关完全覆盖**（A 关更全、按需花、还兜住了真正危险的"动手"那一半）
//      ⇒ 机制删净、痕迹清光（**史书除外**：`AI错误总账` 里 A17/A19 那两段事故记录留着）。
//
// ⚠️ 一条**保留下来的能力**（原来挂在重注入上，但那能力与它无关，删了会白丢）：
//    **压缩成功 ⇒ 清掉留意栏节流，让"现在有什么要留意"重说一遍** —— 上下文都被揉掉了，
//    不说等于没提醒。现在挂在一个独立的小集合上（钩子 ① 记、钩子 ② 消费）。

import {
  CFG,
  capTick,
  createPluginMessage,
  isSubagent,
  log,
  nowCN,
  realUserMessages,
  sessionIdOf,
  shortSid,
} from './common.js'
import { onSessionEvent } from './f22-compact-dump.js'
import { noteFuel } from './f28-fuel.js'
// 🔴 2026-10-01：**prune 感知** —— 裁剪把"必读内容"剪掉时，重置它的"已读"（A 关下一轮会逼我重读）。
//    用户当天的判断："**这是绕过，不是没漏。已经漏的干干净净一点不剩了。**"
import { onPruneEvent, resetAllReads } from './f30-toolgate.js'
import { tickArchiveCheck } from './f23-archive-dump.js'
import { tickSkeletonRepair } from './skeleton-repair.js'
import { backlogText, peekBacklog, resetBacklogThrottle } from './f26-backlog.js'
// 🔴 F34 考勤（2026-09-26）：每步记一笔"谁动过"。挂在这儿同上 —— 它自己挂 pre-step 会把整条链顶掉。
import { watchTick } from './f34-watchdog.js'
// 🛡 F38 安全总监（2026-10-21）：每步判一遍全场（同时写它的心跳），**只在状态变化时**给一句。
//    挂在这儿同上 —— 钩子只许 F1 挂一处（`on()` 是后注册顶掉先注册，F23 踩过两次）。
import { directorBeat, directorLine } from './f38-director.js'
// 🔴 2026-09-20：每轮顺手把"用户说过的话"记一份（给 `〔会话〕` 锚核验 ＋ 子会话预算闸门共用，见 `said.js`）。
import { noteUserSaid } from './said.js'
// 🔴 注入文本一律从文案表取（2026-09-19 · 待办"文案外置补全"）—— 改一句话不用改代码、不用重启。
import { t } from './texts.js'

/** 本进程内已做过首轮「在岗标记」的会话。 */
export const scannedSessions = new Set()

/**
 * 每条会话**上次报在岗标记时的档案根**（sid → 路径）。**只在内存里**。
 * 🔴 2026-10-22 加：这一行带着"档案根在哪"，切馆后必须**重报一次**，否则上下文里那条还指着旧馆
 *    （用户原话：「**档案根这个得动态。不然挪了位置就成了死指针了**」）。
 */
const lastRootOf = new Map()

/**
 * 已**自报过跳过**的留意内容指纹（sid → key）。**只在内存里**。
 * 为什么按指纹去重：一个回合里"没有真实用户消息"的步**很多**，不去重的话那行自报会每步来一条
 * —— 那正是 F26 留意栏当初被用户抓出来的刷屏毛病（实测 39 次 / 19503 字符）。
 * 同一份留意只报一次；内容真变了（指纹变了）才再报一次。
 */
const skippedNoted = new Map()

/**
 * 压缩成功 ⇒ **下一个 pre-step 清一次留意栏节流**（见文件头那条"保留下来的能力"）。
 * 只在内存里 —— 进程重启后留意栏本来就该重新说一遍，不需要跨重启记。
 */
const throttleResetFor = new Set()

/**
 * 每个新会话首轮的一行"在岗标记"。
 * 插件掉出组合树时，这一行会消失 —— 这是「它没在跑」最早的信号。
 *
 * 🔴 **2026-09-19 晚改回"只给这一行"**（用户当场点破）：原来是"首轮连档案入口全文一起给"
 *   （理由：`AGENTS.md` 要求"接活前先读 `从这开始读.txt`"，顺手给掉省一次 read）。
 *   但**宿主每轮都会自己注入 `~/.dsh/AGENTS.md`**，而那份里已经写着"接活前先读…"这条规矩
 *   —— 于是同一个新会话里，**同一件事被说两遍**（用户原话："**他俩内容一模一样**"）：
 *   一份是宿主的 AGENTS.md，一份是这里塞的入口全文。实测首轮多花 ~2.9K 字符（约 0.6K token）。
 *   现在只留**短标记**（`AGENTS.md` 的自检判据认它），入口交给"照 AGENTS.md 去读"那一步。
 */
export function buildOnDuty() {
  // 🔴 **2026-10-22 加"档案根在哪"**（用户当天实测撞出来的）：
  //    只给一行在岗标记时，**新会话不知道档案在哪** —— 因为 `AGENTS.md` 只说"接活前先读 `从这开始读.txt`"，
  //    **从没说它在哪** ⇒ 每个新会话都得 `glob` 全盘找一遍（用户原话：「**不行这样太慢了**」）。
  //    ⇒ 这一行补上路径：**50 字符换掉一次全盘搜索**。
  //    ⚠️ 仍然**不注入入口全文** —— 2026-09-19 用户点破过"入口和 AGENTS.md 内容一模一样，同一件事说两遍"，
  //       那条结论依然成立；这里只补"在哪"，不补"内容"。
  return t('f1.onduty.marker', { time: nowCN(), root: CFG.archiveDir })
}

/** 注册 F1 的两个钩子：会话事件（转交）与每轮 step 之前的注入点（agent/pre-step）。 */
export function registerF1(ctx) {
  // ---- 钩子 1：会话事件 ----
  try {
    ctx.on('session/event', (session, event) => {
      // ⚠️ F22 压缩留底也吃这个事件 —— **由这里转交**（它不自己挂第二个监听器：
      //    脚手架 mockCtx 的 on() 是"后注册的顶掉先注册的"，实测一挂上去 F1 就整条哑掉）。
      onSessionEvent(session, event)
      // F28 会话油表：**只记不看**（记账在这儿，判断与说话在 F26 留意栏）。
      // 数据源：`assistant/message` 的 `data.usage` ＋ `request/context` 的 `contextWindow`。
      try {
        noteFuel(session, event)
      } catch (e) {
        log(`油表记账出错（忽略）: ${e}`)
      }
      try {
        const evt = String(event?.type ?? '')
        if (!evt.startsWith('compaction/')) return
        const sid = typeof session?.id === 'string' ? session.id : null
        const err = event?.data?.error
        const ok = err === undefined || err === null || err === ''
        log(`session/event: ${evt} sid=${shortSid(sid)} error=${ok ? 'none' : String(err)}`)
        // 🔴 **prune 感知（2026-10-01）**：裁剪事件**直接听**，不从水位间接推断
        //    （用户点破的漏洞："这轮用了 10%、裁剪裁掉 10% ⇒ 油表表面上无变化"）。
        if (evt === 'compaction/prune' && sid) {
          try {
            onPruneEvent(session, event)
          } catch (e) {
            log(`prune 感知出错（忽略，绝不影响别处）: ${e}`)
          }
          return
        }
        // 只有压缩「成功落地」才算：带 error 的 end 表示表层未替换、原上下文还在。
        if (evt === 'compaction/end' && ok && sid) {
          throttleResetFor.add(sid)
          capTick('F1', '压缩后清留意栏节流')
          log(`→ 已记：sid=${shortSid(sid)} 下一个 step 清留意栏节流（上下文被揉掉，留意要重说一遍）`)
          // 🔴 **2026-10-01 加（用户点出的根）**：**压缩把内容揉掉了 ⇒ 本会话的"已读"账全部作废**。
          //    原话："**我在让你修 a 关的时候不是让你扩展把所有的这个类型的闸门都按照这个格式来一遍吗？**"
          //    ⇒ 不作废的话，**A 关 / B 关 / 派活关 三关会拿几小时前的旧船票放行** ——
          //      而那份内容早已不在我上下文里（实测：17:40 派子会话时派活关没拦，账里是 13:15 读的）。
          try {
            resetAllReads(sid)
          } catch (e) {
            log(`压缩后作废"已读"账出错（忽略，绝不影响压缩本身）: ${e}`)
          }
        }
      } catch (e) {
        log(`session/event 处理出错（忽略）: ${e}`)
      }
    })
    log('hook 已注册: session/event', { silent: true })
  } catch (e) {
    log(`注册 session/event 失败: ${e}`)
  }

  // ---- 钩子 2：每轮 step 之前 ----
  try {
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
      const decision = await next()
      // F23 归档留底：顺手看一眼归档集合（节流 60 秒）。
      // ⚠️ **不让 F23 自己挂 pre-step** —— 脚手架的 on() 是"后注册顶掉先注册"，它一挂就把这里整条链顶掉（踩过两次）。
      tickArchiveCheck()
      // 骨架兜底（2026-09-19）：哪份留底缺骨架就补一份（F22/F23 两条路都补；**幂等**、内部节流 5 分钟）。
      // ⚠️ 挂在这儿而不是 F22/F23 自己里 —— 它俩互相 import，再由它们调补骨架就成了**循环 import**；
      //    由 F1（上层）来调，依赖是单向的：F1 → skeleton-repair → F22/F23。
      tickSkeletonRepair()
      // 考勤（F34 · 2026-09-26）：每步记一笔 —— 谁动过、谁连着几步没露面。
      // ⚠️ **必须排在下面那些早退之前**（`decision.kind !== 'enter'` / 子会话 / 没注入 …… 都会 return）：
      //    它记的是"这一步走到这儿了"，早退的步也是步。
      // 🔴 2026-09-26 补：那些早退的步要**标成 `idle`** —— 这一步"每步都该动"的能力本来就轮不上它
      //    （**子代理的每一步**都从 `isSubagent` 那儿 return），拿它算留意的话，子代理连跑三步就假报一次。
      try {
        const idleStep =
          decision === undefined ||
          decision.kind !== 'enter' ||
          signal?.aborted ||
          isSubagent(agent) ||
          !sessionIdOf(agent)
        watchTick('pre-step', idleStep)
      } catch (e) {
        log(`考勤（F34）记步失败（不影响注入）: ${e}`, { silent: true })
      }
      // 🛡 F38 安全总监的**心跳**（每步都写 —— 心跳跟步数走；判断才跟注入走）。
      //    🔴 2026-10-22 两次误报后的第二修：只把 `directorLine()` 挂在"有用户消息"那一步，
      //    会让我查个东西走 4 步就听见"总监掉队 4 步"。心跳必须每步都有。
      try {
        directorBeat()
      } catch (e) {
        log(`安全总监（F38）心跳失败（不影响注入）: ${e}`, { silent: true })
      }
      // 🔴 2026-09-26 修（**两版才修对**）：F1 的自报必须挂在"**这条链走到这儿了**"上，而且：
      //    ① **不能引后面的变量** —— 第一版写成 `if (users.length > 0)`，而 `users` 是下面才声明的，
      //       于是每步都 `ReferenceError: users is not defined`（被我自己的 try/catch 吞了，
      //       只在 `memoria.log` 里留一行）。**自报失踪＝考勤照喊**（连喊 11 步）。
      //    ② **别把条件写成"有真实用户消息"** —— 这条 pre-step 链（F23 看一眼 / 骨架兜底 / 注入）
      //       **每一步都跑**，所以"到场"＝每一步；挂条件就等于"没你的消息那几步它算死了"。
      try {
        capTick('F1', '到场')
      } catch (e) {
        log(`F1 自报失败（不影响注入）: ${e}`, { silent: true })
      }
      try {
        if (decision === undefined || decision.kind !== 'enter') return decision
        if (signal?.aborted) return decision
        if (isSubagent(agent)) return decision

        const users = realUserMessages(decision.messages)

        const sid = sessionIdOf(agent)
        if (!sid) return decision

        // 🔴 2026-09-20：顺手把这一轮"用户说过的话"记下来（记不上绝不影响放行）。
        //    给两件事共用：① `〔会话〕` 锚的**核验**（`f27-citation.js` 会去这份里搜引文）；
        //    ② 子会话预算闸门判"用户到底给过那个数字没有"。见 `said.js`。
        try {
          for (const u of users) {
            const said = Array.isArray(u?.content)
              ? u.content
                  .filter((c) => c && c.type === 'text')
                  .map((c) => String(c.text ?? ''))
                  .join('\n')
              : String(u?.content ?? '')
            noteUserSaid(sid, said)
          }
        } catch (e) {
          log(`记"用户说过的话"失败（不影响放行）: ${e}`)
        }

        // 首轮「在岗标记」：插件掉出组合树时它会消失 —— 这是「它没在跑」最早的信号
        // 🔴 **2026-10-22 加"切馆也要重报一次"**（用户当天点出：「**档案根这个得动态。不然挪了位置就成了死指针了**」）：
        //    这一行现在带着**档案根路径**，而它只在"每会话首轮"注入一次 ——
        //    切馆（`f32` 里 `CFG.archiveDir = …`）之后，**同一条会话不会再报新路径**，
        //    上下文里那条还指着旧馆 ⇒ 那才是真的死指针。
        //    ⇒ 档案根一变，就把这条会话的"已扫描"标记清掉，让它**重新报一次**。
        const rootNow = CFG.archiveDir
        if (lastRootOf.get(sid) !== rootNow) {
          lastRootOf.set(sid, rootNow)
          if (scannedSessions.has(sid)) {
            scannedSessions.delete(sid)
            log(`档案根变了 ⇒ 这条会话重新报一次在岗标记（新根：${rootNow}）`, { silent: true })
          }
        }
        const doMark = !scannedSessions.has(sid)

        // 🔴 **在岗标记与留意栏不许「新建消息」** —— 只在「这一步真有真实用户消息」时注入；
        //   没有就**整个跳过**，等用户的下一句话（＝挂到他下一条消息上）。
        //   起因（用户 2026-09-20 02:02 / 02:07 两次点出「我还没回答你就被激活」）：
        //   旧行为是「没有用户消息就追加到末尾」（照官方 time-context），于是它**凭空激活一个回合**：
        //   日志实证「消息数 0→1 / 1→2」，用户还没回答就已经被推进下一轮。
        //   ⚠️ 这一跳**必须排在 backlogText 前面** —— 它一算完就把节流指纹记下了，
        //      先算后跳 ＝ 这条留意被静默吞掉（下次得等 TTL 才说）。
        //   ⚠️ 手册坑 5 / 三问 ③「沉默 ≠ 正常」：本来要说话却没说 → **必须自报一行**。
        if (users.length === 0) {
          // 「沉默 ≠ 正常」的自报**必须是真探针**（2026-09-20 加）：
          //   探一下"本来会不会说话"，但 `peekBacklog()` **一个字都不记** ——
          //   否则"先算后跳"会把那条留意静默吞掉（`backlogText` 一算完就写节流指纹）。
          // ⚠️ **按内容指纹去重**：中间步很多，不去重就变成新的刷屏源（正是留意栏当初那个毛病）。
          //    同一份留意只报一次；内容真变了才再报一次。
          if (doMark) {
            log(`→ 没注入（在岗标记/留意栏）：本步没有真实用户消息，等用户下一句 · sid=${shortSid(sid)}`)
          }
          const pk = peekBacklog(sid)
          if (pk.wouldSay && pk.key && skippedNoted.get(sid) !== pk.key) {
            skippedNoted.set(sid, pk.key)
            if (skippedNoted.size > 200) skippedNoted.clear() // 防无限长；清掉只是可能重复报一次，无害
            log(`→ 没注入（留意栏）：欠着 ${pk.n} 类，本步没有真实用户消息，等用户下一句 · sid=${shortSid(sid)}`)
          }
          return decision
        }

        // ---- F26 留意栏：**把"现在有什么要留意"一次送到眼前**（2026-09-18 减重）----
        // 🔴 它替掉了原来这里的「F22 留底灯」：那盏灯按"最后一条真实用户消息的 id"去重 →
        //    等于**每一轮都亮一遍**（一轮一条 user 消息），噪音全落在对话里。现在由 F26 统一节流：
        //    **首次说 · 内容变了说 · 超过 TTL 才再说**；干净时一个字都不说。
        //    留底那些内容**没有丢** —— 它就是留意栏里的一行（还多了 F26 现算的"补完没有"）。
        // 🔴 **压缩后先清节流再组装**：上下文都被揉掉了，留意栏必须重说一遍（否则等于没提醒）。
        if (throttleResetFor.has(sid)) {
          throttleResetFor.delete(sid)
          resetBacklogThrottle(sid)
        }
        const noticeText = backlogText(sid)
        const doNotice = noticeText.length > 0
        // 🛡 F38 安全总监：**必须排在 `backlogText` 之后** —— 它要读到**本轮刚写的** `health/F26.json`。
        //    🔴 2026-10-22 实测栽过：排在前面时它永远慢一拍（第二次注入才看到第一次写的 F26），
        //    于是"同一会话第二次不再重复注入"那条断言当场红 —— 不是测试矫情，是真·拿旧状态判新情况。
        //    全绿且没变时 `dirLine` 是空串，一个字都不多说。
        let dirLine = ''
        try {
          dirLine = directorLine()
        } catch (e) {
          log(`安全总监（F38）判据失败（不影响注入）: ${e}`, { silent: true })
        }

        if (!doMark && !doNotice && !dirLine) return decision

        // 注入位置：插在**最后一条真实用户消息之前**（不改写用户内容，沿用原来的顺序习惯）。
        let text = doMark ? buildOnDuty() : ''
        // 留底灯**附在同一条注入消息里**（不另起一条 —— 少一条消息就少一次前缀扰动）
        if (doNotice) text = text ? `${text}\n\n${noticeText}` : noticeText
        // 🛡 安全总监那一句（只有"状态变化"时才有；全绿且没变时是空串）
        if (dirLine) text = text ? `${text}\n\n${dirLine}` : dirLine
        const lastUser = users[users.length - 1]
        const at = decision.messages.indexOf(lastUser)
        const rewritten = [...decision.messages]
        rewritten.splice(at >= 0 ? at : decision.messages.length, 0, createPluginMessage(text))
        if (doMark) scannedSessions.add(sid)
        log(
          `→ 已注入（${doMark ? '在岗标记' : '留意栏（F26）'}）：` +
            `sid=${shortSid(sid)} ${text.length} 字符，消息数 ${decision.messages.length}→${rewritten.length}`
        )
        capTick('F1', doMark ? '在岗标记' : '留意栏')

        return { ...decision, messages: rewritten }
      } catch (e) {
        log(`pre-step 注入失败（fail-open 放行）: ${e}`)
        return decision
      }
    })
    log('钩子已注册: session/event + agent/pre-step')
  } catch (e) {
    log(`注册 agent/pre-step 失败: ${e}`)
  }
}
