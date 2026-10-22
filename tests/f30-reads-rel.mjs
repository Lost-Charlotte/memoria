/**
 * F30 · **"两关口径不一样"的回归** —— 落盘里记的是**绝对路径**时，B 关也得认得出。
 *
 * 根因（2026-09-21 实测抓到，用户点名要查）：
 *   · `rememberReadOnDisk` 对"**当时不在清单里**"的文件，落盘记的是**绝对路径**；
 *   · 而 `haveWithHistory` 的**落盘那一路**当初只做 `\` ↔ `/` 兼容、**不认绝对路径**
 *     （**历史那一路**反倒有 `matchKnown`）⇒ 那份文件**后来进了清单**时，B 关永远说"没读"。
 *   · 实测症状：同一时刻，B 关说《防丢总则》"没读"、**第 6 关说"本会话你已经读过它了"**
 *     —— 同一份账本、两关结论相反。
 *
 * 跑法：`node tests/f30-reads-rel.mjs`（`node test.mjs` 会自动带上它）。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f30rel', {
  '从这开始读.txt': 'DeepSeek 档案 —— 从这开始读\n',
  'L1-必读/00-总览-我们干过什么.md': '# 总览\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  'L1-必读/工具速查.md': '# 工具速查\n',
  'L3-知识/别的.md': '# 别的\n',
})

process.env.GAI_DANG_ROOT = root

const F30 = await import('../lib/f30-toolgate.js')

const rd = (sid, p) => ({ name: 'read', arguments: { file_path: p }, agent: { session: { id: sid } } })
const run = (sid, name, args) => ({ name, arguments: args, agent: { session: { id: sid } } })

console.log('— ㉖ 落盘里那条（当初记成绝对路径）必须还能被认成清单里的 rel —')
F30.__resetDiskReads()
// 先把必读层读齐 —— A 关放行之后才会记账（被拦下的那次读根本没发生）
for (const f of ['从这开始读.txt', 'L1-必读/00-总览-我们干过什么.md', 'L1-必读/00-必读-铁律.md', 'L1-必读/工具速查.md']) {
  F30.verdict(rd('S', root + '/' + f))
}
check('读一份**清单外**的档案内文件 → 放行', F30.verdict(rd('S', root + '/L3-知识/别的.md')) === null)

// 那份文件"进了清单"（这里直接拿 rel 去问）—— 不管当初落盘记成什么形态，都必须认得出
const have = F30.haveWithHistory(run('S', 'pwsh', { command: 'echo' }), [{ rel: 'L3-知识\\别的.md' }])
check('落盘那条能被认成清单里的 rel（反斜杠写法）', have.has('L3-知识\\别的.md'))
check('正斜杠写法也认', have.has('L3-知识/别的.md'))
check('绝对路径那条本身也还在集合里（**A 关**认它 —— 第 6 关 2026-09-25 起不再认落盘，见下）', [...have].some((x) => String(x).replace(/\\/g, '/').endsWith('L3-知识/别的.md')))

console.log('')
console.log('— ㉗ 重启之后不再冒充"我读过"（2026-09-25 · 撤掉落盘那条腿）—')
// 同 sid、但**本会话历史为空** ＝ 重启后的现场（DSH 官方那边观测状态也是重启即清 —— README：
// "resumed sessions must read targets again because observations are not persisted"）。
// 撤腿之前：第 6 关查落盘 ⇒ 命中 ⇒ **白拦一次**；撤腿之后：只看本会话历史 ⇒ 放行。
const afterBoot = { name: 'read', arguments: { file_path: root + '/L3-知识/别的.md' }, agent: { session: { id: 'S' } } }
check('落盘里有记录、但本会话没读过 ⇒ **放行**（撤腿之前这儿会被白拦一次）', F30.verdict(afterBoot) === null)

done()
