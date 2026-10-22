/**
 * F30 · **prune 感知**（2026-10-01 建）—— 跑法：`node tests/f30-prune.mjs`
 *
 * 起因（用户当天的判断，原话照录）：
 *   "**你的脑子里已经没有 l1 的内容了，而且绕过了 a 关，因为 a 关只管你读没读过，
 *    而 a 关必须让你读不就是为了让这些东西都一直在你脑子里吗？这是绕过，不是没漏。
 *    已经漏的干干净净一点不剩了。**"
 *   ＋ "**油表倒转检测这里有个漏洞，那就是比如说这轮你用了百分之十，裁剪裁掉百分之十，
 *      油表会不会在表面上无变化从而不报警？**"（⇒ 所以**直接听裁剪事件**，不从水位推断）
 *   ＋ "**在监测到有必读内容被裁剪的时候，重置相应的闸门。不光是 l1 的闸门。**"
 *
 * 这一份钉四件事（**三条是反向断言**）：
 *   ① **记 seq**：A 关放行一次"读必读层" ⇒ 那个 read 的 seq 被记下（内存 ＋ 落盘）；
 *   ② 🔴 **裁到了必读层 ⇒ 已读被抹掉**（＝ A 关下一轮会重新拦住我，逼我重读）；
 *   ③ 🔴 **反向：裁的是别的东西 ⇒ 一份都不许抹**（否则每次裁剪都逼我重读一堆，白烧钱）；
 *   ④ 🔴 **反向：seq 对不上时也不许乱抹**（宁可不抹，也不能误伤）；
 *   ⑤ **反向：没读过任何必读层 ⇒ 裁剪不算命中**（空账不该产生假动作）。
 */
import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'
// 🔴 2026-10-01：验"文件真被写了"要用到它们（同 `f30-prune` 那一条补的断言）
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR } from '../lib/common.js'

sandboxHome()

const root = makeArchive('prune', {
  'L2-数据/01-时间轴-我们做过什么.md': ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', '| ○ | **T1** | 2026-10-01 01:00 | 甲 |', ''].join('\n'),
  'L2-数据/01-事件表-我们做过什么.md': [
    '| E号 | 名称 | 时间 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    '| E1 | 甲 | 2026-10-01 | ✅ 完成 | T1 |',
    '',
    '### E1｜甲',
    '- **时间跨度**：2026-10-01',
    '- **锚点**：T1',
    '- **结果**：做完了',
    '- **状态**：✅ 完成',
    '',
  ].join('\n'),
  'L3-知识/AI错误总账.md': ['| 编号 | 说明 |', '|---|---|', '| **R1** | 甲 |', ''].join('\n'),
  'L4-施工/工程-待办.md': ['# 待办', '', '## 四、短期 · 我能自己推 [自办]', '', '| 事项 | 原因 | 目的 |', '|---|---|---|', '| （还没有） | | |', ''].join('\n'),
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })

const F30 = await import('../lib/f30-toolgate.js')

// ============================================================
// ① 记 seq：造一个"刚读过必读层"的 exec（历史里有一条 read 的 tool/call）
// ============================================================
const sid = 'sess-prune'
const events = [
  { type: 'user/message', seq: 1, data: {} },
  { type: 'tool/call', seq: 18, data: { name: 'read', arguments: JSON.stringify({ file_path: 'L1-必读/铁律.md' }) } },
  { type: 'tool/result', seq: 19, data: {} },
]
const exec = { name: 'read', arguments: { file_path: 'L1-必读/铁律.md' }, agent: { session: { id: sid, events } } }

F30.__markRead(sid, 'L1-必读/铁律.md')
F30.noteRequiredRead(exec, 'L1-必读/铁律.md')

// 🔴 **2026-10-01 补的一刀（真事故逼出来的）**：原测试只验了**内存**标记、**没验"文件真被写了"** ——
//    于是"记账文件压根没生成"这种病**测试照样全绿**。⇒ **凡"写盘"的行为，测试必须去读那个盘**。
check(
  '🔴 记账文件真被写了（`memoria-f30-read-seqs.json` 里能找到这份的 seq）',
  (() => {
    try {
      const p = join(HOME_DIR, 'memoria-f30-read-seqs.json')
      if (!existsSync(p)) return false
      const j = JSON.parse(readFileSync(p, 'utf8'))
      const seqs = j?.[sid]?.['L1-必读/铁律.md']
      return Array.isArray(seqs) && seqs.includes(18)
    } catch {
      return false
    }
  })(),
)

// ============================================================
// ② 裁到了它（shadowedSeqs 里有 18/19 附近）⇒ 已读被抹掉
// ============================================================
check('① 抹之前：这份算"已读"', F30.__haveRead(sid).includes('L1-必读/铁律.md'))
const r1 = F30.onPruneEvent({ id: sid }, { type: 'compaction/prune', data: { shadowedSeqs: [19], shadowedTokenCount: 3890 } })
check('② 裁到了必读层 ⇒ 报出命中的那份（' + JSON.stringify(r1.hit) + '）', r1.hit.includes('L1-必读/铁律.md'))
check('🔴 裁到必读层 ⇒ "已读"被抹掉（A 关下一轮会逼我重读）', !F30.__haveRead(sid).includes('L1-必读/铁律.md'))

// ============================================================
// ③ 反向：裁的是**别处**（seq 跟这份无关）⇒ 一份都不许抹
// ============================================================
F30.__markRead(sid, 'L1-必读/铁律.md')
F30.noteRequiredRead(exec, 'L1-必读/铁律.md')
const r2 = F30.onPruneEvent({ id: sid }, { type: 'compaction/prune', data: { shadowedSeqs: [9001, 9002], shadowedTokenCount: 50000 } })
check('🔴 反向：裁的是别处 ⇒ 不命中（' + JSON.stringify(r2.hit) + '）', r2.hit.length === 0)
check('🔴 反向：不命中 ⇒ "已读"还在（不许误伤）', F30.__haveRead(sid).includes('L1-必读/铁律.md'))

// ============================================================
// ④ 反向：没有 seq 信息（空 shadowedSeqs）⇒ 什么都不做
// ============================================================
const r3 = F30.onPruneEvent({ id: sid }, { type: 'compaction/prune', data: { shadowedSeqs: [] } })
check('🔴 反向：prune 没给 seq ⇒ 不命中、不抹', r3.hit.length === 0 && F30.__haveRead(sid).includes('L1-必读/铁律.md'))

// ============================================================
// ⑤ 反向：**没读过任何必读层**的会话 ⇒ 裁多大都不命中（空账不产生假动作）
// ============================================================
const r4 = F30.onPruneEvent({ id: 'sess-没读过' }, { type: 'compaction/prune', data: { shadowedSeqs: [1, 2, 3], shadowedTokenCount: 99999 } })
check('🔴 反向：没读过必读层的会话 ⇒ 裁什么都不命中', r4.hit.length === 0)

// ============================================================
// ⑥ 健壮性：事件是空的 / 坏形状 ⇒ 不炸（fail-open）
// ============================================================
check('事件是空对象 ⇒ 不炸', (() => { try { F30.onPruneEvent({}, {}); return true } catch { return false } })())
check('session 是 null ⇒ 不炸', (() => { try { F30.onPruneEvent(null, { data: { shadowedSeqs: [1] } }); return true } catch { return false } })())

// ============================================================
// ⑦ 🔴 **压缩成功后：本会话的"已读"账全部作废**（2026-10-01 加 · 用户点出的根）
// ============================================================
// 病（实测）：压缩把内容揉成摘要 ⇒ **内容不在我上下文里了**，可"已读"账一份没作废 ⇒
//   **A 关 / B 关 / 派活关 三关拿几小时前的旧船票放行**
//   （2026-10-01 17:40 我派子会话时派活关没拦我 —— 查账发现是 13:15 读的，15:21 压缩后早没了）。
// ⇒ 口径：**"读过" ＝ "内容还在我脑子里"**（近似）⇒ **压缩 ⇒ 账全清**（与 prune 的分工：prune 只清被裁到的那几份）。
{
  const SID = 'sess-compact'
  F30.__markRead(SID, 'L1-必读/铁律.md')
  F30.__markRead(SID, 'L4-施工/工程-派活标准.md')
  check('作废前：账里有 2 份', F30.__haveRead(SID).length === 2)
  const n = F30.resetAllReads(SID)
  check('压缩后：报告作废了几条（>0）', n > 0, `n=${n}`)
  check('🔴 压缩后：已读集合**清空**（A / B / 派活三关都会重新拦住我）', F30.__haveRead(SID).length === 0)
  // 反向：**别的会话不受影响**（各记各的）
  F30.__markRead('sess-别的', 'L1-必读/铁律.md')
  F30.resetAllReads(SID)
  check('🔴 反向：只清自己那个会话，别人的账不许动', F30.__haveRead('sess-别的').length === 1)
}

done()
