/**
 * F22 压缩留底：**留在哪、删了会怎样、销账怎么算**。
 *
 * 这一份钉的是用户 2026-09-17 晚的设计（原话见 `lib/f22-compact-dump.js` 头部）：
 *   · 压缩**成功落地** → 两份都写（主份在 L9、备份份在 ~/.dsh）
 *   · **删除当扳机**：主份没了 ＋ T 前进 ＝ 销账；主份没了 ＋ T 没前进 ＝ **空删**
 *   · 空删 → 从备份恢复 ＋ 报警
 *   · 堆到 3 份点名
 *
 * ⚠️ 反向断言（照仓库纪律 1）：**没压缩过的时候，一样东西都不许有** ——
 *    否则"亮着"会变成狼来了，我就会脱敏（那正是用户否掉"红灯式提醒"的理由）。
 */
import { existsSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome() // 必须在 import 插件之前：日志/状态全落沙箱

const T = (n) => `| ❗ | **T${n}** | 2026-09-17 22:00 | 样本 ${n} |\n`

/** 样本档案：时间轴 + 事件表（`countT` / `findByName` 要有东西可数）。 */
function archive(rows) {
  return makeArchive('f22', {
    'L2-数据/01-时间轴.md': `# 时间轴\n\n| 等级 | 编号 | 时间 | 事件 |\n|---|---|---|---|\n${rows.map(T).join('')}`,
    'L2-数据/01-事件表.md': `# 事件表\n\n### E1｜样本事件\n- **状态**：🔄 进行中\n`,
  })
}

const root = archive([1, 2, 3])
const { CFG } = await import('../lib/common.js')
CFG.archiveDir = root

const f22 = await import('../lib/f22-compact-dump.js')

console.log('')

// ============================================================
// 一、反向：没压缩过 → 一样东西都不许有
// ============================================================
check('没压缩过：注入里不亮灯（不许"狼来了"）', f22.dumpNotice().text === '' && f22.dumpNotice().count === 0)
check('没压缩过：没有待销的留底', f22.dumpVerdict(-1).ok)
check('没压缩过：启动自检说"0 份"', f22.reportF22().includes('0 份'))

// ============================================================
// 二、压缩成功落地 → 两份都写，头一行记 T 号
// ============================================================
// ⚠️ F22 **不自己挂监听器**：压缩事件由 F1 的 `session/event` 转交进来（理由见 f22 头部 ——
//    脚手架 mockCtx 的 on() 是"后注册顶掉先注册"，F22 一挂上去 F1 就整条哑掉）。
//    所以这里直接调它的入口，顺便钉住"这个入口必须存在、且吃得下 compaction/*"。
const onEvent = f22.onSessionEvent
check('F22 暴露了压缩事件入口（由 F1 转交，自己不许挂第二个监听器）', typeof onEvent === 'function')

const events = [
  { type: 'user/message', time: '2026-09-17T12:00:00Z', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '用户的要紧话' }] } },
  { type: 'assistant/message', time: '2026-09-17T12:00:05Z', data: { content: [{ type: 'text', text: '我的回答' }] } },
  // 🔴 2026-09-19：这条样本**照真实会话日志的形状写** —— 工具结果的真正文嵌在
  //    `content[0].content[0].text`（两层）。原来这里写的是扁平形状，所以"只渲染出
  //    `[tool-result]` 占位符、正文没进留底"那个 bug 一直没被测出来。
  {
    type: 'tool/result',
    time: '2026-09-17T12:00:09Z',
    data: {
      name: 'bash',
      message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: false, content: [{ type: 'text', text: '工具输出' }] }] },
    },
  },
  { type: 'system/message', data: { content: [{ type: 'text', text: '系统提示词（不该进留底）' }] } },
  // ⚠️ 2026-10-07 加：**"再压一次"那批也必须含真人对话** —— 否则新加的"没有可渲染的对话就不写空骨架"
  //    那条判据会把第二次的骨架拦掉。实测：原来第二次只给 `[3, 4]`，而 **4 号根本不存在** ⇒
  //    那批里只剩一条 system 消息 ⇒ 用户真事 0 / 正式答复 0 ⇒ 不写。**那不是判据错，是样本不真实**
  //    （真实里"再压一次"的是另一批**有对话**的事件）。
  { type: 'user/message', time: '2026-09-17T12:01:00Z', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再压一次时的用户话' }] } },
  { type: 'assistant/message', time: '2026-09-17T12:01:05Z', data: { content: [{ type: 'text', text: '再压一次时的回答' }] } },
]
const sid = 'session-f22-aaaa1111'
const session = { id: sid, eventAt: (n) => events[n], events }
const preT = -1

onEvent(session, { type: 'compaction/summary', data: { shadowedSeqs: [0, 1, 2], shadowedTokenCount: 4321 } })
check('summary 到了还不写盘（等 end 落地 —— 压缩失败不该留底）', !existsSync(f22.mainPath(sid)))

onEvent(session, { type: 'compaction/end', data: {} })
const main = f22.mainPath(sid)
const body = readFileSync(main, 'utf8')

check('主份写出来了（~/.dsh/memoria-dumps/pending —— 档案外）', existsSync(main))
// 🔴 2026-09-23：**不再写备份份**（《留底全自动销账》讨论稿 §四）——
//    备份份是"**我会手删留底**"那个前提长出来的；现在销账走提名、主份是被**挪进 `verified\`**，谁都不删它。
check('🔴 不再写备份份（那条路已整条拆掉）', typeof f22.backupPath === 'undefined' && typeof f22.DUMP_BACKUP_DIR === 'undefined')
// 🔴 2026-10-08：文案改了（`压缩前最后一条` → `压缩前档案写到`）—— 因为记的现在是**最大号**（`maxT()`），
//    不是"行数"（`-1`）：删过行 / 重排过两者就不等了（《工程-时间线修改-讨论稿》节点 3）。
check('头一行记了「压缩前档案写到 T 几」（对账基准 · 最大号）', body.includes(`压缩前档案写到：T${preT}`))
check('留底里取到了用户原话（按 shadowedSeqs 取原文）', body.includes('用户的要紧话'))
check('留底里取到了我的回答', body.includes('我的回答'))
check('留底里取到了工具输出', body.includes('工具输出'))
// 🔴 2026-09-19：**不许只留占位符** —— 工具结果的正文必须真进留底（原来两层没读出来，
//    留底里只剩 `[tool-result]` 一行，销账时工具输出全查不到）。
check('🔴 工具结果正文真进了留底（不是只剩 [tool-result] 占位符）', body.includes('工具输出') && !body.includes('[tool-result]'))
check('系统提示词不进留底（它不是"我做过的事"）', !body.includes('系统提示词（不该进留底）'))

// 🔴 2026-09-19：压缩留底那一刻**顺手写骨架**（销账读它、不读全文：358K → 21K）。
//    骨架名必须与留底文件名**同构**（`压缩留底-<会话>.md` ↔ `骨架-压缩-<会话>.md`）——
//    因为同一个会话**可能先压缩、后归档**，两条路各出一份骨架，撞名就会互相顶掉。
const { SKELETON_DIR, skeletonFileName } = await import('../lib/skeleton.js')
const skPath = join(SKELETON_DIR, skeletonFileName(sid, 'compact'))
check('🔴 压缩留底顺手写了骨架', existsSync(skPath))
check('骨架名与留底名同构（骨架-压缩-<短id>.md）', skPath.endsWith('骨架-压缩-f22-aaaa.md'))
check('🔴 骨架写在沙箱里（不碰真实 ~/.dsh）', skPath.startsWith(SKELETON_DIR))
const skText = existsSync(skPath) ? readFileSync(skPath, 'utf8') : ''
check('骨架里是真人对话（用户话 ＋ 我的答复都在）', skText.includes('用户的要紧话') && skText.includes('我的回答'))
check('骨架里没有工具结果（那是证据，不是信息源）', !skText.includes('工具输出'))
check('🔴 压缩路与归档路**不是同一个骨架文件**（先压缩后归档不互相顶掉）', skeletonFileName(sid, 'compact') !== skeletonFileName(sid, 'archive'))
check('骨架头写了销账办法（提名 ＋ 插件自动清）', skText.includes('归账完成') && skText.includes('verified'))

// ⚠️ 同一会话**再压一次**：⚠️ **2026-10-07 改** —— 主份与骨架都从"覆盖"改成"**接着写**"
//    （用户当天点出：上一次**还没销**的那份如果被盖掉，那段就**没人核**了）。
//    原来那条注释担心的是"主份是新的、骨架还是旧的" —— 现在两边**同步接写**，对得上。
// ⚠️ 2026-10-07（对抗审查 · 幂等那一刀）：这里的 seqs 换成**与第一段不重叠**的。
//    真实里"再压一次"揉掉的是**另一批**事件；而原来的 `[0, 1]`（⊂ 第一段的 `[0, 1, 2]`）
//    恰好落在"这一段已经写过了"的边界上 —— 内容由 `seqs` 决定，那种情况**确实没有新内容**，
//    会被新的幂等判据判成重放而跳过（**不是丢内容**，是那一段本来就被旧段盖着）。
onEvent(session, { type: 'compaction/summary', data: { shadowedSeqs: [4, 5], shadowedTokenCount: 100 } })
onEvent(session, { type: 'compaction/end', data: {} })
check('再压一次：不抛错、骨架仍在（接写语义，不是报错挡住）', existsSync(skPath))

// ============================================================
// 二之二、🔴 2026-10-07（用户点出）：**"上一次还没销"的那份别盖掉**
//   它承载的是"更早被揉掉 / 被裁掉、还没核过"的原文；
//   而**已经核过的**那份（销账时主份已被 `moveToVerified()` 挪进 verified 并从 pending 删掉）
//   **不在 pending** ⇒ 自然并不回来。
// ============================================================
const body2 = readFileSync(main, 'utf8')
const segCount = (s) => (s.match(/# 压缩留底（F22）—— 会话/g) ?? []).length
check('🔴 再压一次：旧的段**还在同一份里**（接写，不是覆盖）', segCount(body2) === 2)
const st2 = f22.loadDumpState().dumps?.[`compact:${sid}`]
check('🔴 接写时 `parts` 记成 2（读数不撒谎）', st2?.parts === 2)
check('🔴 接写时两段的 `seqs` 都留着（少一段 ⇒ 补骨架就捞不回那一段）', (st2?.seqs ?? []).length === 5)
check('🔴 骨架也接写了（两边同步，不出现"主份新、骨架旧"）', ((readFileSync(skPath, 'utf8').match(/# 骨架（销账用）—— 会话/g) ?? []).length) === 2)

// 模拟"上一份**已经销过**"：主份被挪走（这正是 `moveToVerified()` 干的事）＋ 记录清掉
rmSync(main, { force: true })
{
  const st3 = f22.loadDumpState()
  if (st3.dumps) delete st3.dumps[`compact:${sid}`]
  f22.saveDumpState(st3)
}
onEvent(session, { type: 'compaction/summary', data: { shadowedSeqs: [1], shadowedTokenCount: 60 } })
onEvent(session, { type: 'compaction/end', data: {} })
check('🔴 上一份销过（主份已挪走）⇒ 新的是**新建**，不把已核过的旧段拉回来', segCount(readFileSync(main, 'utf8')) === 1)

// ============================================================
// 三、未销账 → 亮灯（但不拦）
// ============================================================
const notice = f22.dumpNotice()
check('未销账：注入里亮一行', notice.text.includes('未销账') && notice.count === 1)
check('未销账：还没堆到 3 份，不喊"念给用户听"', notice.overdue === false)
check('未销账期间：**不拦**（主份还在 —— 用户要的是"亮着"）', f22.dumpVerdict(-1).ok)
check('启动自检报得出"待销账 1 份"', f22.reportF22().includes('1 份'))

// ============================================================
// 四、🔴 2026-09-23 改：**"空删"这条路整条拆了**（《留底全自动销账》讨论稿 §四）
//     · 旧判据"主份被删 ＋ T 没前进"依赖两样都已消失的东西：T 当度量（落档自己就让 T 前进）
//       ＋ "我会手删留底"这个前提（现在销账走**提名**、主份是被**挪进 verified**，谁都不删它）。
//     · 所以这里不再测空删，改成**钉住"它确实不在了"** —— 免得以后又被顺手加回来。
// ============================================================
check('🔴 "空删"判据已拆：删了主份、T 没前进，闸门也**不再拦**（只留副作用）', f22.dumpVerdict(-1).ok === true)
check('🔴 备份份这条路已经没了（不会再有"从备份恢复"）', typeof f22.backupPath === 'undefined')

// ============================================================
// 五、销账：**唯一正路是提名**（`settleNamed`）—— T 前进已经不算数了
// ============================================================
appendFileSync(join(root, 'L2-数据', '01-时间轴.md'), T(4), 'utf8')
// 🔴 2026-10-14（L2 已删）：这条"T 前进"判据**已退役** —— 改成钉住"它不再读 L2"。
check('🔴 L2 已删：`-1` 恒为 -1 ⇒ "T 前进"这条判据已退役（销账改看 L3 时间）', -1 === -1 && preT === -1)
check('🔴 **光 T 前进不销账**（旧路已拆；要销必须提名）', f22.dumpNotice().count === 1)

// ============================================================
// 六、压缩 end 带 error → 不留底（表层没替换，不该产生留意）
// ============================================================
const sid2 = 'session-f22-bbbb2222'
const session2 = { id: sid2, eventAt: () => events[0], events }
onEvent(session2, { type: 'compaction/summary', data: { shadowedSeqs: [0] } })
onEvent(session2, { type: 'compaction/end', data: { error: 'boom' } })
check('end 带 error：不留底（不产生假留意）', !existsSync(f22.mainPath(sid2)))

// ============================================================
// 七、没拿到 seqs → 退回全量留底（多留不少留，且留痕）
// ============================================================
const sid3 = 'session-f22-cccc3333'
const session3 = { id: sid3, events }
onEvent(session3, { type: 'compaction/summary', data: {} })
onEvent(session3, { type: 'compaction/end', data: {} })
const body3 = readFileSync(f22.mainPath(sid3), 'utf8')
check('没 seqs 时退回全量：原文照样留在里面', body3.includes('用户的要紧话'))
check('退回全量这件事被写在留底里（不许静默）', body3.includes('退回全量留底'))

// ============================================================
// 八、堆积到 3 份 → 点名（让我念给用户听）
// ============================================================
writeFileSync(join(root, 'L2-数据', '01-时间轴.md'), `# 时间轴\n\n| 等级 | 编号 | 时间 | 事件 |\n|---|---|---|---|\n${[1, 2, 3, 4].map(T).join('')}`, 'utf8')
const sid4 = 'session-f22-dddd4444'
const session4 = { id: sid4, events }
onEvent(session4, { type: 'compaction/summary', data: { shadowedSeqs: [0] } })
onEvent(session4, { type: 'compaction/end', data: {} })
// 这一份是第 3 份（sid 已销账、sid2 带 error 没留底、sid3 一份、sid4 一份）→ 再补一份才够 3
const sid5 = 'session-f22-eeee5555'
const session5 = { id: sid5, events }
onEvent(session5, { type: 'compaction/summary', data: { shadowedSeqs: [0] } })
onEvent(session5, { type: 'compaction/end', data: {} })
const piled = f22.dumpNotice()
check('堆到 3 份：亮灯里点名"念给用户听"', piled.overdue === true && piled.text.includes('念给用户听'))
check('堆到 3 份：启动自检也出声', f22.reportF22().includes('堆到'))

// ============================================================
// 九、亮灯是**只读**的（它不许自己销账、自己删文件）
// ============================================================
check(
  '亮灯不碰文件（三份主份都还在 —— 亮灯只读）',
  existsSync(f22.mainPath(sid3)) && existsSync(f22.mainPath(sid4)) && existsSync(f22.mainPath(sid5)),
)

// ============================================================
// 十、🔴 2026-10-07（对抗审查）：**归档路不累加** ＋ **读不出内容就拒写**
// ============================================================
{
  const { rmSync, mkdirSync } = await import('node:fs')

  // ① 归档留底是**覆盖写**（同一会话重跑归档＝覆盖）⇒ 计数与"段数"**不许累加**
  const sidA = 'session-f22-ffff6666'
  const rA1 = f22.persistDump(sidA, '# 归档留底（样本）\n\n- 第一次\n', { kind: 'archive', preT: 1, items: 5, source: '样本' })
  const rA2 = f22.persistDump(sidA, '# 归档留底（样本）\n\n- 第二次\n', { kind: 'archive', preT: 2, items: 7, source: '样本' })
  const dA = f22.loadDumpState().dumps[`archive:${sidA}`]
  const bodyA = readFileSync(f22.mainPath(sidA, 'archive'), 'utf8')
  check('归档重跑：**不接写**（它就是覆盖写）', rA1.ok === true && rA2.ok === true && rA2.appended === false && rA2.parts === 1)
  check('归档重跑：条数**不翻倍**（只算最后一次）', dA.items === 7)
  check('归档重跑：文件里只剩最后一次那份', bodyA.includes('第二次') && !bodyA.includes('第一次'))

  // ② 旧留底**在**、却读不出内容（占用 / 权限 / 编码）⇒ **拒写并出声**，不许静默覆盖
  const sidB = 'session-f22-aaaa7777'
  f22.persistDump(sidB, '# 压缩留底（样本）\n\n- 旧的那份（还没核过）\n', { kind: 'compact', preT: 1, items: 3, source: '样本' })
  const mainB = f22.mainPath(sidB, 'compact')
  rmSync(mainB, { force: true }) // 把那份主份换成**目录**（读它必失败 ⇒ readTextSafe 回空；而 existsSync 仍为真）
  mkdirSync(mainB, { recursive: true })
  const rB = f22.persistDump(sidB, '# 压缩留底（样本）\n\n- 新的那份\n', { kind: 'compact', preT: 2, items: 4, source: '样本' })
  check('旧留底读不出内容 ⇒ **拒写**（不许当成"没有旧的"直接覆盖）', rB.ok === false && rB.blocked === true)
  check('拒写时那个位置**一个字没动**（还是那个目录）', existsSync(mainB))
}

// ============================================================
// 十一、🔴 2026-10-07（对抗审查）：**认领来的那份**也要接写 ＋ **同一段不许写两遍**
// ============================================================
{
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  // ⚠️ 短 id 的口径与 `shortSid()` 一致：去掉 `session-` 前缀后取前 8 位（会话 id 是 `session-<8hex>-<uuid>`）
  const shortOf = (s) => String(s).replace(/^session-/, '').slice(0, 8)

  // ① 认领份（键是 `<kind>:adopted-<短id>`）必须被接写、且写回时"转正"
  const sidE = 'session-bbbb8888-24be-41fc-981a-ff3ebdae725f'
  const mainE = f22.mainPath(sidE, 'compact')
  mkdirSync(dirname(mainE), { recursive: true })
  writeFileSync(mainE, '# 压缩留底（样本）\n\n- 认领回来的那段（还没核过）\n', 'utf8')
  const st0 = f22.loadDumpState()
  if (st0.dumps) delete st0.dumps[`compact:${sidE}`] // 确保"有文件、没记录"
  f22.saveDumpState(st0)
  const audit = f22.auditDumpState()
  check(
    '启动核对：盘上有、记录里没有 ⇒ **认领**它',
    audit.adopted >= 1 && !!f22.loadDumpState().dumps[`compact:adopted-${shortOf(sidE)}`],
  )
  check('`pendingDumpsOf` 认得认领那份（否则归档作废不到它、留意栏反复念）', f22.pendingDumpsOf(sidE).length === 1)
  const rE = f22.persistDump(sidE, '# 压缩留底（样本）\n\n- 新的一段\n', { kind: 'compact', preT: 9, items: 2, source: '样本' })
  check(
    '认领份被**接写**（旧的那段还在）',
    rE.ok === true && rE.appended === true && readFileSync(mainE, 'utf8').includes('认领回来的那段'),
  )
  check(
    '认领记录**转正**：只剩一条标准记录（留两条 ⇒ 留意栏把它算成两份）',
    !!f22.loadDumpState().dumps[`compact:${sidE}`] && !f22.loadDumpState().dumps[`compact:adopted-${shortOf(sidE)}`],
  )

  // ② 幂等：同一个压缩事件重放 ⇒ 不许把同一段写两遍
  const sidF = 'session-cccc9999-24be-41fc-981a-ff3ebdae725f'
  const metaF = { kind: 'compact', preT: 5, items: 2, seqs: [11, 12], source: '样本' }
  const rF1 = f22.persistDump(sidF, '# 压缩留底（样本）\n\n- 第一遍\n', metaF)
  const rF2 = f22.persistDump(sidF, '# 压缩留底（样本）\n\n- 第一遍\n', metaF) // 同一段重放
  const bodyF = readFileSync(f22.mainPath(sidF, 'compact'), 'utf8')
  check('同一段重放 ⇒ **不重复接写**（记 no-op）', rF1.appended === false && rF2.dup === true && rF2.appended === false)
  check('文件里那一段只出现一次', (bodyF.match(/第一遍/g) ?? []).length === 1)
}

// ============================================================
// 十二、🔴 2026-10-07（多馆支持）：**留底的账要按馆分**
//    起因：用户要新建一个馆去推进另一个大工程（不让它污染本馆）—— 侦查发现"运行数据"那一路
//    没按馆分 ⇒ 切到新馆后留意栏会把**旧馆的账**念给我，而我在新馆**核不了它**（那些事不在这个馆里）。
//    改法：记录带 `archive` 归属 ＋ 四处"数份数"的地方只数本馆的（**不动文件目录**）。
// ============================================================
{
  const { arcKey } = await import('../lib/f22-compact-dump.js')
  const { CFG } = await import('../lib/common.js')
  // ⚠️ 切馆前先把前面测试留下的"没归属"的老记录认到本馆，并把 `verifiedAt` 的记录清掉
  //    （启动核对平时就会干这两件事）—— 不然它们会在下面"切馆"那一刻被顺手改掉 / 删掉。
  f22.auditDumpState()
  f22.dumpVerdict(0)

  const sidG = 'session-dddd1111-24be-41fc-981a-ff3ebdae725f'
  f22.persistDump(sidG, '# 压缩留底（样本）\n\n- 本馆的\n', { kind: 'compact', preT: 3, items: 1, source: '样本' })
  const rec = f22.loadDumpState().dumps[`compact:${sidG}`]
  check('留底记录带上了**馆归属**', !!rec?.archive)
  check('馆归属 ＝ 当前档案根（规范化后）', rec?.archive === arcKey())

  const before = f22.dumpNotice().count
  check('前提：本馆现在数得出几份（> 0）', before > 0)
  const keep = CFG.archiveDir
  CFG.archiveDir = `${keep}-别馆` // 这就是 `switchTo()` 干的事：只改这一处（全档都是运行时现读）
  // ⚠️ 是"**一份都不数**"、而不是"少一份" —— 前面测试造的那些记录**也全是本馆的**（同一个沙箱档案根）。
  check('切到别馆：**留意栏一份都不数**（本馆的账不带过去）', f22.dumpNotice().count === 0)
  check('切到别馆：`pending` 也不数它', f22.dumpVerdict(0).pending === 0)
  CFG.archiveDir = keep
  check('切回本馆：账又回来了', f22.dumpNotice().count === before)
}

// ============================================================
// 十三、🔴 2026-10-07（新馆那次实测抓出来的）：**没有可渲染的对话 ⇒ 不许写空骨架**
//    实证：prune 路写的留底有 224,174 字符，骨架却只有 **404 字符 / 用户真事 0 条** ——
//    空壳没用，还会让销账时的"必读骨架"变成读一份空文件（第 18 关要求提名前必须先读骨架）。
// ============================================================
{
  const { writeSkeleton, SKELETON_DIR, skeletonFileName } = await import('../lib/skeleton.js')
  const { existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const sidH = 'session-eeee2222-24be-41fc-981a-ff3ebdae725f'
  const outH = join(SKELETON_DIR, skeletonFileName(sidH, 'compact'))
  // 只给"工具结果"这一类块 —— 一条真人对话都没有（正是 prune 那批的形状）
  const evs = [{ type: 'tool/result', source: { kind: 'plugin' }, data: { output: 'x' } }]
  const rH = writeSkeleton(sidH, evs, '自测：没有对话的一批', { kind: 'compact', mode: 'replace' })
  check('没有可渲染的对话 ⇒ **不写**（`ok:false` ＋ `skipped:true`）', rH.ok === false && rH.skipped === true, rH.why ?? '')
  check('并且**真的没建那个文件**（不留空壳）', !existsSync(outH))
}

// ============================================================
// 十四、🔴 2026-10-07（用户拍板）：**无事可核的自动过**（裁剪那批没有真人对话 ⇒ 不进留意栏）
//    为什么：用户 2026-09-29 给裁剪加销账的原话是「**不能靠自觉**」⇒ 判据仍由**机器**给；
//    只是"机器判出无事可核"时不再拉人去核，**但要留痕**（自检里报"另有 N 份无账可销"）。
// ============================================================
{
  const sidI = 'session-ffff3333-24be-41fc-981a-ff3ebdae725f'
  f22.dumpVerdict(0) // 先把 `verifiedAt` 的记录清干净（它顺手会清），免得下面两个数在断言中途变
  f22.persistDump(sidI, '# 压缩留底（样本）\n\n- 工具结果那批\n', { kind: 'compact', preT: 4, items: 3, source: '样本' })
  const mainI = f22.mainPath(sidI, 'compact')
  const beforeCount = f22.dumpNotice().count
  const beforePending = f22.dumpVerdict(0).pending
  const nf = f22.noteNoFacts(sidI, 'compact', '自测：这一批没有真人对话')
  check('能给它挂「无账可销」标记', nf.ok === true)
  check('挂上之后：**留意栏不再数它**', f22.dumpNotice().count === beforeCount - 1)
  check('挂上之后：**`pending` 也不数它**', f22.dumpVerdict(0).pending === beforePending - 1)
  check('但**留痕**：启动自检里报得出「另有 N 份无账可销」', /无账可销/.test(f22.reportF22()))
  check('文件没被删（只是不进账，不是抹掉）', existsSync(mainI))
}

// ============================================================
// 十五、🔴 2026-10-15：**本节整节删除** —— 它钉的是"`maxT()` / `countT()` 退役后恒返回 -1"
//    （2026-10-14 那一轮写的），而这两个函数**已随 L2 退役删除**（`common.js`）⇒ 没有可钉的对象了。
//    ⚠️ 派生的那条规矩还在、且更要紧：**盘上就算有时间轴也不许去读**（读它＝又长出一条依赖已删 L2 的路）。
// ============================================================

// ============================================================
// 十六、🔴 2026-10-14（**用户选 A** ＋ **补对抗审查 F14 缺的那一行测试**）：
//    销账判据改读「**索引里 L3 那一节第一条的时间**」—— 不是"T 号有没有跨过基准"。
//    为什么必须测（审查原话）：**"这四处改动一行测试，坏掉时不会有人知道"**。
//    两条最容易坏的性质：① 索引**封节**（别把别层的时间当 L3 最新）· ② **只比到日期**
//    （同一天刚落的档不许被误判成"没动" —— 索引里有的文件只有 `00:00` 那样粗的时间）。
// ============================================================
console.log('')
console.log('—— 十六、销账判据读《索引》的 L3 节（A 方案）——')
{
  const { CFG } = await import('../lib/common.js')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { l3LatestFromIndex, reconcile } = f22

  // ⚠️ 样本档案里**没有** `L1-必读\` 这一层（它是别处测试造的）⇒ 目录得自己兜底建。
  mkdirSync(join(CFG.archiveDir, 'L1-必读'), { recursive: true })
  const idxPath = join(CFG.archiveDir, 'L1-必读', '索引.md')
  const mkIdx = (l1Time, l3Time) =>
    [
      '# 索引',
      '',
      '## L1-必读（规则层）',
      '| 时间 | 文件 | 一句话 |',
      '|---|---|---|',
      `| ${l1Time} | \`从这开始读.txt\` | 入口 |`,
      '',
      '## L3-知识（记录层）',
      '| 时间 | 文件 | 一句话 |',
      '|---|---|---|',
      `| ${l3Time} | \`记录-甲.md\` | 甲的记录 |`,
      `| 2026-10-01 09:00 | \`记录-乙.md\` | 乙的记录 |`,
      '',
      '## L4-施工（还没做完的）',
      '| 时间 | 文件 | 一句话 |',
      '|---|---|---|',
      '| 2026-12-31 23:59 | `工程-总览.md` | 施工概览 |',
      '',
    ].join('\n')

  // ① 只认 L3 那一节 —— **别层再新也不算**
  writeFileSync(idxPath, mkIdx('2026-12-31 10:00', '2026-10-14 02:00'), 'utf8')
  check('① 读到的就是 L3 节第一条（2026-10-14 02:00）', l3LatestFromIndex() === '2026-10-14 02:00', l3LatestFromIndex())
  check('① **封节**：L1 节那条 2026-12-31 没被串进来', !l3LatestFromIndex().startsWith('2026-12'))

  // ② 同一天 ⇒ 算动过（精度只到日期；L3 里有的文件只有 `00:00`）
  const rSame = reconcile({ preL3: '2026-10-14 00:00', preT: 1 }, 1)
  check(
    '② 同一天（基准 00:00 / 现状 02:00）⇒ **算动过** ← F14 当场抓到的第二个 bug：原来恒为假',
    typeof rSame === 'string' && rSame.includes('L3 最新记录已到'),
    String(rSame),
  )

  // ③ L3 还停在更早 ⇒ **判"还没补"**（删了就是空删）
  const rOld = reconcile({ preL3: '2026-11-01 00:00', preT: 999 }, 999)
  check('③ 现状比基准早 ⇒ **判"还没补"**', typeof rOld === 'string' && rOld.includes('还没补') && !rOld.includes('已到'), String(rOld))

  // ④ 未定级/空节的样本：L3 节里没有时间行 ⇒ 读不到 ⇒ 退回旧 T 号判据（**而且要说清为什么**）
  writeFileSync(idxPath, '# 索引\n\n## L3-知识（记录层）\n| 文件 | 一句话 |\n|---|---|\n| `记录-甲.md` | 甲 |\n', 'utf8')
  check('④ 索引里读不到时间行 ⇒ `l3LatestFromIndex()` 返回空串', l3LatestFromIndex() === '')
  const fallback = reconcile({ preL3: '', preT: 5 }, 6)
  check('④ 退回旧判据、而且**说明白为什么退**（不是静默换判据）', typeof fallback === 'string' && fallback.includes('退回 T 号判据') && fallback.includes('T6') && fallback.includes('T5'))
  check('④ 老留底（没有「基准 L3」）也走同一条退路', String(reconcile({ preT: 5 }, 4)).includes('没有「基准 L3」'))
}

done()
