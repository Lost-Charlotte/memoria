/**
 * ②c 的三件（2026-09-23 · 《留底全自动销账》讨论稿 v3-6 / v3-7）：
 *   ① `saveDumpState()` —— **原子写**（写完读得回来；不留临时文件）
 *   ② `auditDumpState()` —— 核对 `state↔盘`，**两个方向都带处理动作**：
 *        · 有记录、文件不在 → **清掉**（别让它烂在表里、留意栏永远念它）
 *        · 有文件、没记录 → **认领**（否则那份永远不会被留意栏看到、也永远销不掉）
 *   ③ `dumpNotice()` —— **现查盘**：记录在、文件不在的，**不许打印幽灵路径**
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()
const arch = makeArchive('f22audit', {})
const { CFG } = await import('../lib/common.js')
CFG.archiveDir = arch
const f22 = await import('../lib/f22-compact-dump.js')

const SID = 'session-audit111audit11'

console.log('')

// ---------- ① 原子写 ----------
f22.saveDumpState({ dumps: {}, lastAt: 'probe' })
check('原子写：写完读得回来', f22.loadDumpState().lastAt === 'probe')
check('原子写：不留临时文件', !readdirSync(join(f22.DUMP_STATE, '..')).some((f) => f.includes('.tmp-')))

// ---------- ② 方向一：有记录、文件不在 → 清掉 ----------
f22.saveDumpState({
  dumps: { [`compact:${SID}`]: { kind: 'compact', sidShort: 'audit111', mainAbs: join(arch, 'nope.md'), preT: 1 } },
})
const a1 = f22.auditDumpState()
check('核对①：僵尸记录被**清掉**（不是只报）', a1.zombieCleared === 1 && Object.keys(f22.loadDumpState().dumps ?? {}).length === 0)
check('核对①：如实说得出为什么', a1.notes.join(' ').includes('从没销账过'))

// ---------- ② 方向二：有文件、没记录 → 认领 ----------
const orphan = join(f22.DUMP_PENDING_DIR, '压缩留底-audit222.md')
mkdirSync(dirname(orphan), { recursive: true }) // 这条测试没走过"写留底"那条路，目录可能还没建
writeFileSync(orphan, 'x', 'utf8')
const a2 = f22.auditDumpState()
check(
  '核对②：无主留底被**认领**（不是无视）',
  a2.adopted === 1 && Object.values(f22.loadDumpState().dumps ?? {}).some((d) => d.mainAbs === orphan),
)

// ---------- ③ 现查盘 ----------
const key3 = Object.keys(f22.loadDumpState().dumps ?? {})[0]
const st3 = f22.loadDumpState()
st3.dumps[key3] = { ...st3.dumps[key3], mainAbs: join(arch, 'gone.md') }
f22.saveDumpState(st3)
check('留意栏现查盘：记录在、文件不在 → **一个字都不说**（不打印幽灵路径）', f22.dumpNotice().count === 0)

done()
