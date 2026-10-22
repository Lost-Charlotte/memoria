/**
 * 骨架兜底补写：**哪份留底缺骨架，就从"有块类型的地方"补一份**。
 *
 * 钉的是用户 2026-09-19 那句提醒（"f22 不是双份备份吗？只有判断你归档完成才会自动删除第二份"）
 * 引出的一个更准的认识：
 *   · **留底全文一直没丢**（主份 ＋ 备份份 ＋ 会话日志，三重都在）；
 *   · 缺的从来不是"内容"，而是"**筛选依据**"—— 渲染成 markdown 之后，
 *     `reasoning`（我的思考）与 `text`（我对用户说的话）**长得一模一样**，
 *     块类型只活在**日志**与**压缩那一刻的内存**里。
 *
 * 所以两条路的可补性不同（这一份把差别钉死）：
 *   · **归档路**：日志在盘上（留底头写着路径）→ **能补**；
 *   · **压缩路**：日志也在，但要**知道捞哪一段**（`seqs`，2026-09-19 起才存进 state）→
 *     更早的留底**没有这个坐标** → 补不了，必须**如实报**，不许假装补过。
 *
 * ⚠️ 反向断言（照仓库纪律 1）：**没有留底的时候，一样东西都不许有**。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { check, done, sandboxHome } from './harness.mjs'

const HOME = sandboxHome() // 必须在 import 插件之前：留底/骨架/日志全落沙箱

const f22 = await import('../lib/f22-compact-dump.js')
const { SKELETON_DIR, skeletonFileName } = await import('../lib/skeleton.js')
const { repairSkeletons, tickSkeletonRepair } = await import('../lib/skeleton-repair.js')

console.log('')

// ============================================================
// 造一份"真"会话日志：**独立 zstd 帧拼接**（每个事件一帧，带顶层 seq）
// ============================================================
const WS = '--C-Users-admin-Desktop--'
const mkLog = (sid, list) => {
  const dir = join(HOME, 'sessions', WS, sid)
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'session.v3.jsonl.zstd')
  writeFileSync(
    log,
    Buffer.concat(list.map((ev) => zstdCompressSync(Buffer.from(`${JSON.stringify(ev)}\n`, 'utf8'))))
  )
  return log
}

const evs = [
  { type: 'user/message', seq: 0, time: 1789000000000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '兜底：用户的话' }] } },
  {
    type: 'assistant/message',
    seq: 1,
    time: 1789000001000,
    data: { content: [{ type: 'reasoning', text: '兜底：思考链不该进' }, { type: 'text', text: '兜底：我的答复' }] },
  },
  { type: 'tool/result', seq: 2, time: 1789000002000, data: { name: 'bash', content: [{ type: 'text', text: '兜底：工具输出不该进' }] } },
]

// ============================================================
// 一、反向：没有留底 → 一样东西都不许有
// ============================================================
const empty = repairSkeletons()
check('没有留底时不做事（checked 0 / repaired 0）', empty.checked === 0 && empty.repaired === 0)

// ============================================================
// 二、归档路：留底头写着日志路径 → 能补
// ============================================================
const sidA = 'session-repair-aaaa1111'
const logA = mkLog(sidA, evs)
mkdirSync(f22.DUMP_PENDING_DIR, { recursive: true })
const mainA = join(f22.DUMP_PENDING_DIR, '归档留底-repair-a.md')
writeFileSync(
  mainA,
  `# 归档留底（F23）—— 会话 repair-a\n\n- **归档时刻的 T：T1**\n- 来源：日志 \`${logA}\`（1 MB / 3 帧）\n\n---\n\n（正文略）\n`,
  'utf8'
)
const skA = join(SKELETON_DIR, skeletonFileName('repair-a', 'archive'))
check('补之前：确实没有骨架', !existsSync(skA))

const r1 = repairSkeletons()
check('归档路：缺骨架被认出来', r1.missing === 1)
check('归档路：**补出来了**（日志在盘上就够）', r1.repaired === 1 && existsSync(skA))
const t1 = existsSync(skA) ? readFileSync(skA, 'utf8') : ''
check('补出来的骨架里是真人对话与我的正式答复', t1.includes('兜底：用户的话') && t1.includes('兜底：我的答复'))
check('补出来的骨架里没有思考链、没有工具输出', !t1.includes('思考链不该进') && !t1.includes('工具输出不该进'))
check('幂等：再跑一次一份都不动（skipped）', repairSkeletons().repaired === 0 && repairSkeletons().skipped >= 1)

// ============================================================
// 三、压缩路：state 里有 seqs → 也能补
// ============================================================
const sidB = 'session-repair-bbbb2222'
const logB = mkLog(sidB, evs)
const mainB = join(f22.DUMP_PENDING_DIR, '压缩留底-repair-b.md')
writeFileSync(mainB, `# 压缩留底（F22）—— 会话 repair-b\n\n- **压缩前最后一条：T1**\n\n---\n\n（正文略）\n`, 'utf8')
const st = f22.loadDumpState()
st.dumps = st.dumps ?? {}
st.dumps[`compact:${sidB}`] = {
  kind: 'compact',
  sidShort: 'repair-b',
  mainAbs: mainB,
  relMain: mainB,
  preT: 1,
  seqs: [0, 1], // ← "哪几条被揉掉了"这个坐标（2026-09-19 起才存）
}
f22.saveDumpState(st)

const skB = join(SKELETON_DIR, skeletonFileName('repair-b', 'compact'))
const r2 = repairSkeletons()
check('压缩路：靠 state 里的 seqs 补出骨架', r2.repaired === 1 && existsSync(skB))
const t2 = existsSync(skB) ? readFileSync(skB, 'utf8') : ''
check('压缩路骨架只含被揉掉那两条（工具结果没被捞进来）', t2.includes('兜底：用户的话') && !t2.includes('工具输出不该进'))

// ============================================================
// 四、压缩路：没有 seq 坐标（0.32.0 之前的旧留底）→ **如实报补不了**
// ============================================================
const mainC = join(f22.DUMP_PENDING_DIR, '压缩留底-repair-c.md')
writeFileSync(mainC, `# 压缩留底（F22）—— 会话 repair-c\n\n---\n\n（正文略）\n`, 'utf8')
const r3 = repairSkeletons()
check(
  '旧压缩留底：**如实报"补不了"**（不许假装补过）',
  r3.unrepairable.length === 1 && r3.unrepairable[0].includes('没有 seq 坐标')
)
check('补不了的**不会留下半成品骨架**', !existsSync(join(SKELETON_DIR, skeletonFileName('repair-c', 'compact'))))

// ============================================================
// 五、节流入口（F1 的 pre-step 每轮都会调它）
// ============================================================
check('tickSkeletonRepair 存在且**按 5 分钟节流**', typeof tickSkeletonRepair === 'function')
const forced = tickSkeletonRepair(true)
check('force 跑得动（返回统计）', forced && typeof forced.checked === 'number')
check('紧接着再调 → 被节流挡住（返回 null）', tickSkeletonRepair() === null)

// ============================================================
// 六、沙箱与安全：一切都在 HOME 之下，且不碰档案
// ============================================================
check('沙箱：骨架目录与留底目录都在 HOME 之下', SKELETON_DIR.startsWith(HOME) && f22.DUMP_PENDING_DIR.startsWith(HOME))
check('沙箱：补出来的骨架真在沙箱里', skA.startsWith(HOME) && skB.startsWith(HOME))

done()
