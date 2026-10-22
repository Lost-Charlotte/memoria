/**
 * F29 · verified（0 候选留底的中转站 ＋ 保留期清理）—— 2026-09-20（E165）
 *
 * 这套要钉死的是"**第三代销账**"的四条判据（别在以后重构时被顺手改掉）：
 *   ① 命名与 F22 的留底**同构**（两边各写一份文件名算法，必须算出同一个名字）；
 *   ② **0 候选 → 主份挪进 verified**（`pending\` 里那份必须已经不在），且有候选 → **留在 pending**；
 *   ③ 🔴 **对账跑不成（骨架缺 / 解析可疑）→ 一律留 pending** —— 宁可多报，不可当"0 候选"放行；
 *   ④ verified 的条目**不算"空删"**（T 没前进也不许判空删、不许从备份恢复）；
 *   ⑤ 保留期：**没到期的份一个都不许删**；到期才删，且**删前留清单**。
 */
import { existsSync, readFileSync } from 'node:fs'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const arch = makeArchive('f29', {
  // 对账要扫 L1/L2/L3；这里给一份"已进档"的证据行（连续 ≥10 字才够硬证据）
  'L1-必读/00-必读-铁律.md': '# 铁律（样本）\n\n- ○ | **T1** | 2026-09-20 01:00 | 这里面的事已经进档了，证据在这\n',
})

const { CFG } = await import('../lib/common.js')
CFG.archiveDir = arch
const f22 = await import('../lib/f22-compact-dump.js')
const f29 = await import('../lib/f29-verified.js')
const { writeSkeleton } = await import('../lib/skeleton.js')

const userEv = (text) => [{ type: 'user/message', time: Date.now(), data: { content: [{ type: 'text', text }] } }]

console.log('')

// ============================================================
// 一、命名同构（两边各算一份，必须一样）
// ============================================================
const sidA = 'session-aaaa1111bbbb2222'
check(
  'verified 文件名与 F22 留底文件名同构（归档）',
  f29.verifiedFileName(sidA, 'archive') === f22.dumpFileName(sidA, 'archive'),
)
check(
  'verified 文件名与 F22 留底文件名同构（压缩）',
  f29.verifiedFileName(sidA, 'compact') === f22.dumpFileName(sidA, 'compact'),
)

// ============================================================
// 二、复查口径那一段：幂等 ＋ 插在正文之前
// ============================================================
const raw = '# 留底\n\n- 基准 T1\n\n---\n\n正文来了\n'
const once = f29.withRecheckLine(raw)
check('插入了复查口径', once.includes('复查口径'))
check('第二次调用不再重复插（幂等）', f29.withRecheckLine(once) === once)
check('插在 `---` 之前（不落进正文里）', once.indexOf('复查口径') < once.indexOf('\n---\n'))

// ============================================================
// 三、0 候选 → 挪 verified；有候选 → 留 pending
// ============================================================
const sidOk = 'session-0k0k0k0k0k0k0k0k'
f22.persistDump(sidOk, '# 归档留底（样本）\n\n正文\n', { kind: 'archive', cap: 'F23', preT: 1, items: 1 })
const skOk = writeSkeleton(sidOk, userEv('这里面的事已经进档了'), 'test · 已进档样本', { kind: 'archive' })
const mainOk = f22.mainPath(sidOk, 'archive')
check('挪之前：主份在 pending', existsSync(mainOk))

const rOk = f22.settleDump(sidOk, 'archive', { skeletonPath: skOk.out })
check('0 候选 → 判为 verified', rOk.verdict === 'verified')
check('0 候选 → 主份已离开 pending', !existsSync(mainOk))
check('0 候选 → 全文落在 verified 里', existsSync(f29.verifiedPath(sidOk, 'archive')))
const moved = readFileSync(f29.verifiedPath(sidOk, 'archive'), 'utf8')
check('挪进去的份头里**自带复查口径**', moved.includes('复查口径'))
check('挪进去的份头里写了保守留至哪天', /保留至 \d{4}-\d{2}-\d{2}/.test(moved))
check('全文一个字没丢（原来的正文还在）', moved.includes('正文'))

const sidCand = 'session-cand1234cand1234'
f22.persistDump(sidCand, '# 归档留底（样本2）\n\n正文2\n', { kind: 'archive', cap: 'F23', preT: 1, items: 1 })
const skCand = writeSkeleton(sidCand, userEv('月球背面有个中继卫星叫鹊桥二号'), 'test · 没进档样本', { kind: 'archive' })
const rCand = f22.settleDump(sidCand, 'archive', { skeletonPath: skCand.out })
check('有候选 → 判为 pending', rCand.verdict === 'pending')
check('有候选 → 主份**留在** pending', existsSync(f22.mainPath(sidCand, 'archive')))
check('有候选 → 候选行里带 ❌（一点没匹配上）', (rCand.candidates ?? []).some((c) => c.includes('❌')))
check('有候选 → 没有往 verified 里塞', !existsSync(f29.verifiedPath(sidCand, 'archive')))

// 留意栏：pending 的份要报，verified 的份一个字都不说
const dn = f22.dumpNotice()
check('留意栏只报 pending 那一份（verified 的不算账）', dn.count === 1)
check('留意栏里能看到候选原文（🔴 2026-10-15 起文案改成「缺口 N 条」）', dn.compact.includes('缺口'))

// ============================================================
// 四、🔴 对账跑不成 → 一律留 pending（不许当 0 候选放行）
// ============================================================
const sidNoSk = 'session-nosk0000nosk0000'
f22.persistDump(sidNoSk, '# 归档留底（样本3）\n\n正文3\n', { kind: 'archive', cap: 'F23', preT: 1, items: 1 })
const rNoSk = f22.settleDump(sidNoSk, 'archive', { skeletonPath: '/definitely/not/here.md' })
check('骨架缺 → 判 unknown（不是 verified）', rNoSk.verdict === 'unknown')
check('骨架缺 → 主份仍在 pending', existsSync(f22.mainPath(sidNoSk, 'archive')))
check('骨架缺 → 没往 verified 里塞', !existsSync(f29.verifiedPath(sidNoSk, 'archive')))
check('骨架缺 → 留意栏里说得出"没跑成"', f22.dumpNotice().compact.includes('机器对账没跑成'))

// ============================================================
// 五、🔴 verified 的条目**不算空删**（不许误报）
// ============================================================
const v = f22.dumpVerdict(1) // 当前 T ＝ 基准 T（没前进）
check('verified 的份不判"空删"', v.ok === true && v.emptied === 0)
check('verified 的份销账后从状态表里清掉（留意栏只剩两份 pending）', f22.dumpNotice().count === 2)

// ============================================================
// 六、保留期：没到期不删 · 到期才删 · 删前留清单
// ============================================================
check('未到期的份：干跑也不动', f29.cleanVerified({ dryRun: true }).dropped === 0)
check('未到期的份：真跑也不动', f29.cleanVerified({}).dropped === 0)
check('未到期时留意栏一个字都不说（E165：0 候选不进留意栏）', f29.verifiedBacklogLine() === '')
check('面板读数说得出有几份', f29.reportF29().includes('verified'))

// 🔴 累计读数（用户 2026-09-23："不要让他静默失效"）——
//    到这一步为止：settleDump 裁决过 **2** 份（1 份 0 候选 → 挪入；1 份有候选 → 留 pending）。
//    ⚠️ "骨架缺"那份在 `cands` 之前就 return 了 ⇒ **不计**（它没走到裁决）。
{
  const line = f29.reportF29()
  check('0 份读数里带"裁决过几份"（0 才分得清"真没有"与"机制坏了"）', line.includes('裁决过 2 份'))
  check('累计里说得出"其中 0 候选 1 份"', line.includes('0 候选 1 份'))
  check('累计里说得出"挪入 1"', /挪入 1(?:\D|$)/.test(line))
}

f29.__forceExpire(f29.verifiedPath(sidOk, 'archive'), '2020-01-01')
check('过期了：留意栏才出声（提醒抽 1 份核）', f29.verifiedBacklogLine().includes('已过保留期'))
const cleaned = f29.cleanVerified({})
check('到期 → 清掉 1 份', cleaned.dropped === 1 && !existsSync(f29.verifiedPath(sidOk, 'archive')))
check('删之前留了清单', !!cleaned.listFile && existsSync(cleaned.listFile))
check('清理不会顺手删到别人的东西（pending 那份还在）', existsSync(f22.mainPath(sidCand, 'archive')))

done()
