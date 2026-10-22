/**
 * F30 · 第 12 关「留底留意超期」—— **G5 在工具调用面的执行臂**。
 *
 * 由来（2026-09-21，用户原话〔会话 2026-09-21〕）：
 *   "**是强制的但记留意。。那你一直带着账那不没意义。。或许在欠多少次之后强制你必须先归档？**"
 *
 * 病：G5（`lib/f7-gate.js`）只判"上一轮几份、这一轮还几份"，**没有次数**，未过只**记留意** ——
 *   0.50.0 删掉 `agent.steer` 之后，门不再把回合拽回来，于是"带着账"可以一直带下去。
 *   实测：那 3 份留底从 09-20 挂到 09-21 晚，G5 在日志里连报"第 4 次 / 第 5 次"都没用。
 *
 * 跑法：`node tests/f30-dump-debt.mjs`（`node test.mjs` 会自动带上它）。
 *
 * ⚠️ 两条边界（本关自己的命门）：
 *   · **销账链路一律放行**（`read` / `grep` / `dangan_*` / 跑对账·骨架·删留底的 pwsh）——
 *     否则连骨架都读不出来 ⇒ **死锁**（《施工手册》坑 4 那一族）。
 *   · **防死锁第二层**：连拦 `DUMP_DEBT_MAX_DENY` 次就自动放行（沿用闸门既有上限）。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f30debt', {
  '从这开始读.txt': 'DeepSeek 档案 —— 从这开始读\n',
  'L1-必读/00-总览-我们干过什么.md': '# 总览\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  'L1-必读/工具速查.md': '# 工具速查\n',
  'L1-必读/防丢失总则.md': '# 防丢总则\n',
})

process.env.GAI_DANG_ROOT = root

const F30 = await import('../lib/f30-toolgate.js')

const RECON = 'node C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\tools\\reconcile-dump.mjs --all'
const RECYCLE =
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\tools\\recycle-del.ps1' -ListFile l.txt -AllowLocalDrives -DryRun"

console.log('— ㉑ 没到线时：一个字都不说 —')
F30.__resetDumpDebt()
check('轮数 0：拦不着任何东西', F30.dumpDebtVerdict('subagent', {}) === null)
F30.__setDumpStuck(F30.DUMP_DEBT_ROUNDS - 1)
check(`轮数 ${F30.DUMP_DEBT_ROUNDS - 1}（差一轮）：照样放行`, F30.dumpDebtVerdict('subagent', {}) === null)

console.log('— ㉒ 到线之后：非销账动作一律拦 —')
// ⚠️ **每条例都要先复位** —— `dumpDebtDenied` 是"连拦几次"的计数，连拦 3 次就自动放行（防死锁）。
//    第一版这里没复位，于是第 4 条例拿到的必然是放行 —— **失败的不是判据，是测试**，而且恰好证明了防死锁有效。
for (const [label, name, args] of [
  ['subagent', 'subagent', {}],
  ['edit', 'edit', { file_path: 'D:\\x.md' }],
  ['write', 'write', { file_path: 'D:\\x.md', content: 'x' }],
  ['与留底无关的 pwsh', 'pwsh', { command: 'node test.mjs' }],
  ['diagram_apply（画图）', 'diagram_apply', {}],
]) {
  F30.__resetDumpDebt()
  F30.__setDumpStuck(F30.DUMP_DEBT_ROUNDS)
  check(`到线 · ${label} → 拦`, F30.dumpDebtVerdict(name, args) !== null)
}
F30.__resetDumpDebt()
F30.__setDumpStuck(F30.DUMP_DEBT_ROUNDS)
const dv = F30.dumpDebtVerdict('subagent', {})
check('拒绝理由里给了销账三步（对账）', dv !== null && dv.reason.includes('reconcile-dump.mjs'))
check('拒绝理由里给了销账三步（删留底）', dv !== null && dv.reason.includes('recycle-del.ps1'))
check('拒绝理由里写了"连拦 N 次自动放行"（防死锁）', dv !== null && dv.reason.includes('自动放行'))

console.log('— ㉓ 销账链路必须畅通（否则死锁）—')
for (const [label, name, args] of [
  ['read（读骨架）', 'read', { file_path: 'D:\\骨架.md' }],
  ['grep', 'grep', { pattern: 'x' }],
  ['skill', 'skill', { name: 'drawai-canvas' }],
  ['dangan_log（落档）', 'dangan_log', { commit: true }],
  ['dangan_check', 'dangan_check', {}],
  ['pwsh 跑 reconcile-dump', 'pwsh', { command: RECON }],
  ['pwsh 跑 recycle-del', 'pwsh', { command: RECYCLE }],
]) {
  F30.__resetDumpDebt()
  F30.__setDumpStuck(F30.DUMP_DEBT_ROUNDS)
  check(`到线 · ${label} → 放行`, F30.dumpDebtVerdict(name, args) === null)
}

console.log('— ㉔ 防死锁第二层：连拦到上限就自动放行 —')
F30.__resetDumpDebt()
F30.__setDumpStuck(F30.DUMP_DEBT_ROUNDS)
let denied = 0
for (let i = 0; i < F30.DUMP_DEBT_MAX_DENY + 2; i++) if (F30.dumpDebtVerdict('subagent', {})) denied += 1
check(`连拦 ${F30.DUMP_DEBT_MAX_DENY} 次之后就放行（不多不少）`, denied === F30.DUMP_DEBT_MAX_DENY)

console.log('— ㉕ 心跳：第 12 关必须自报"判过"（三问③）—')
check('GATE_TICKS 里有第 12 关那一格', F30.GATE_TICKS && typeof F30.GATE_TICKS.debt === 'object')
const beforeSeen = F30.GATE_TICKS.debt.seen
F30.noteGatePass({ name: 'subagent' })
check('路过一次工具调用 → 第 12 关的 seen 涨了（它看所有工具）', F30.GATE_TICKS.debt.seen === beforeSeen + 1)
const beforeHit = F30.GATE_TICKS.debt.hit
F30.noteGateHit('留底留意超期')
check('拦下一条 → 第 12 关的 hit 涨了', F30.GATE_TICKS.debt.hit === beforeHit + 1)
check('自检那一行里报了第 12 关', F30.reportF30().includes('第 12 关'))

done()
