/**
 * `walk()` 的"跳过"这一件事（2026-09-19 加）。
 *
 * 为什么要专门一份：五路审查把"**按目录名跳过却不报告**"列为插件三处静默失效之一 ——
 * 真档案里 `L3-知识\本机实现件备份\` 因为名字里带个"备份"，**整棵子树从检索与巡检里消失**，
 * 而且**没有任何地方说得出来**（"这份文件为什么搜不到"永远查不出原因）。
 *
 * 现在钉住两条：① 只在**档案根那一层**按名字判（其余层照扫）② 跳过了谁，`skippedDirs()` 报得出。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()
const { walk, skippedDirs, CFG } = await import('../lib/common.js')

const root = makeArchive('walk-skip', {
  'L1-必读/a.md': '# a',
  'L2-数据/b.md': '# b',
  // 🔴 就是它：**子目录**名字里带"备份" —— 旧代码会把整棵子树跳掉
  'L3-知识/本机实现件备份/_说明-读我.txt': '权威在插件包里',
  'L3-知识/本机实现件备份/动盘脚本/_说明-读我.txt': '同上',
  // 顶层那两层才该跳（它们就是"证据备份层 / 工具临时层"这两层的语义）
  'L5-证据/原始输出.txt': '证据原文',
  'L6-工具临时/快照.md': '临时',
  'L6-工具临时/旧版.md.bak': 'bak',
})

CFG.archiveDir = root
const norm = (list) => list.map((f) => f.slice(root.length + 1).replace(/\\/g, '/'))
const files = norm(walk(root))

check('顶层 `L5-证据` 被跳过', !files.some((f) => f.startsWith('L5-证据/')))
check('顶层 `L6-工具临时` 被跳过', !files.some((f) => f.startsWith('L6-工具临时/')))
check('.bak 仍然不扫', !files.some((f) => f.endsWith('.bak')))
check('普通层照扫（L1 / L2 / L3）', ['L1-必读/a.md', 'L2-数据/b.md', 'L3-知识/本机实现件备份/_说明-读我.txt'].every((f) => files.includes(f)))
check('🔴 子目录叫"备份"**不再**被跳过 —— 那条盲区堵上了', files.some((f) => f.startsWith('L3-知识/本机实现件备份/')))
check('更深一层也照扫', files.includes('L3-知识/本机实现件备份/动盘脚本/_说明-读我.txt'))

const sk = skippedDirs()
check('跳过清单报得出顶层那两个目录', sk.length === 2 && sk.every((x) => /^(L5-证据|L6-工具临时)$/.test(x.rel)))
check('跳过记录带"因为名字含什么"，不是一句黑话', sk.some((x) => x.hint === '证据') && sk.some((x) => x.hint === '临时'))

// ---- 参数化：点名要扫的，哪怕名字命中 ----
CFG.scanForcedDirs = ['L5-证据']
const forced = norm(walk(root))
check('`scanForcedDirs` 点名后，命中跳过的目录照样扫', forced.includes('L5-证据/原始输出.txt'))
check('豁免之后，跳过清单里不再有它', !skippedDirs().some((x) => x.rel === 'L5-证据'))
CFG.scanForcedDirs = null

// ---- 参数化：跳过片段本身可换 ----
CFG.skipDirHints = ['知识']
const custom = norm(walk(root))
check('`skipDirHints` 可换（改成"知识"→ L3 整层不扫）', !custom.some((f) => f.startsWith('L3-')))
check('换了片段之后，原来的"证据"不再跳（L5 照扫）', custom.includes('L5-证据/原始输出.txt'))
check('此时跳过清单报的是 L3-知识', skippedDirs().some((x) => x.rel === 'L3-知识' && x.hint === '知识'))
CFG.skipDirHints = null

// ---- 复位后回到默认口径（免得污染同一进程里别的测试）----
const back = norm(walk(root))
check('复位后回到默认：顶层两层跳、L3 照扫', back.includes('L5-证据/原始输出.txt') === false && back.includes('L3-知识/本机实现件备份/_说明-读我.txt'))

done()
