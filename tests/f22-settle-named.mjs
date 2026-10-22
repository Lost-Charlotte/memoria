/**
 * 提名销账（`f22.settleNamed()`）—— 2026-09-23 · 《留底全自动销账》讨论稿 v3-3
 *
 * 钉死四条：
 *   ① **提名前**：那一份在 state 里、主份在 `pending\`；
 *   ② **提名**（事务真写成之后才调）→ 主份挪进 `verified\` ＋ state 里清掉它；
 *   ③ **幂等**：重复提名 → 如实说"没了"，不报错、不误销别的；
 *   ④ **点名不存在 / 点错**：**不静默** —— 说得出哪里不对。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const arch = makeArchive('f22named', {
  'L1-必读/00-必读-铁律.md': '# 铁律（样本）\n',
})
const { CFG, shortSid } = await import('../lib/common.js')
CFG.archiveDir = arch
const f22 = await import('../lib/f22-compact-dump.js')
const f29 = await import('../lib/f29-verified.js')

const SID = 'session-named1111named11'
const SHORT = shortSid(SID)

console.log('')

// ---------- ① 提名前 ----------
f22.persistDump(SID, '# 归档留底（样本）\n\n正文在这一份里\n', { kind: 'archive', cap: 'F23', preT: 1, items: 1 })
const mainAbs = f22.mainPath(SID, 'archive')
check('提名前：主份在 pending', existsSync(mainAbs))
check('提名前：state 里点得出这一份', Object.keys(f22.loadDumpState().dumps ?? {}).some((k) => k.includes(SID)))

// ---------- ② 提名 ----------
const r1 = f22.settleNamed(SHORT)
check('提名：销掉了', r1.ok === true && r1.hit === 1)
check('提名：主份已离开 pending', !existsSync(mainAbs))
check('提名：全文落在 verified 里', existsSync(f29.verifiedPath(SID, 'archive')))
check('提名：挪进去的那份正文一个字没丢', readFileSync(f29.verifiedPath(SID, 'archive'), 'utf8').includes('正文在这一份里'))
check('提名：state 里已经清掉它', !Object.keys(f22.loadDumpState().dumps ?? {}).some((k) => k.includes(SID)))

// ---------- ③ 幂等 ----------
const r2 = f22.settleNamed(SHORT)
check('重复提名：如实说"没了"，不报错', r2.ok === false && r2.hit === 0)

// ---------- ④ 不静默 ----------
const r3 = f22.settleNamed('nosuch99')
check('点一个不存在的 sid：说得出原因', r3.ok === false && String(r3.why).includes('没有'))
check('点空：当场拒', f22.settleNamed('   ').ok === false)

done()
