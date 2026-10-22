/**
 * 体检缓存（2026-09-19 加）——判据是"**档案变没变**"，不是"过了几分钟"。
 *
 * 两条必须钉住（少一条这个优化就是坏交易）：
 *   ① 档案没动 → **复用**上次结论（否则每回合白读 1.39 MB）
 *   ② 档案一动 → **立刻重算**（否则"我刚把档案改坏"会被 5 分钟窗口盖住 = 漏报）
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()
const { CHECK_CACHE_MS, checkArchiveCached } = await import('../lib/f5-check.js')
const { CFG, archiveFingerprint } = await import('../lib/common.js')

const root = makeArchive('check-cache', {
  'L2-数据/01-时间轴-我们做过什么.md': '| ⭐ | **T1** | 2026-09-19 00:00 | 一件小事 |\n',
  'L2-数据/01-事件表-我们做过什么.md': '### E1｜小事\n\n- **状态**：🔄 进行中\n- **锚点**：T1\n',
})
CFG.archiveDir = root

const fp1 = archiveFingerprint()
const a = checkArchiveCached()
const b = checkArchiveCached()

check('档案没动 → 复用同一份结论（缓存命中，不重扫）', a === b)
check('指纹自己稳定（连算两次一致）', fp1 === archiveFingerprint())
check('TTL 仍是个正数（兜底上限没丢）', CHECK_CACHE_MS > 0)

// 时间轴上加一行 —— 长度变了，指纹**必然**跟着变（不依赖 mtime 精度）
const f = join(root, 'L2-数据', '01-时间轴-我们做过什么.md')
writeFileSync(f, '| ⭐ | **T1** | 2026-09-19 00:00 | 一件小事 |\n| ○ | **T2** | 2026-09-19 00:01 | 又一件 |\n', 'utf8')

check('档案改一下 → 指纹就变了（"看得见改动"的依据）', archiveFingerprint() !== fp1)
const c = checkArchiveCached()
check('🔴 档案一变 → **立刻重算**（不是等 TTL 到点）', c !== b)

// 再算一次：又该稳定了（说明"重算后写回缓存"这一步真的做了）
check('重算之后缓存重新生效（不是每次都重扫）', checkArchiveCached() === c)

done()
