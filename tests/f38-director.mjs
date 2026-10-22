/**
 * F38 · 安全总监 —— 只测它"**什么时候说话**"。
 *
 * 用户 2026-10-21 定死的规则（原话）：
 *   「**开局报一声，证明它存在。然后他就可以不出声了。除非有问题。有问题他再出声。
 *     你修好了。他报全正常。然后又不出声了。直到下次出问题。**」
 *
 * 所以三条断言就是三个状态切换：
 *   ① 全绿 ⇒ 首轮说一句、之后沉默
 *   ② 由绿转红 ⇒ 说一句（且点名是哪几处）
 *   ③ 由红转绿 ⇒ 说"全正常"、之后沉默
 *
 * ⚠️ 不测"它判得准不准" —— 它的输入是 `health/*.json`（别的口子写的），它只负责汇总与"报变化"。
 *    判准不准是**那些口子**的事（它们各自有测试）。
 */
import { check, done, sandboxHome } from './harness.mjs'

sandboxHome()

const { writeHealth } = await import('../lib/common.js')
const { __resetDirector, directorLine } = await import('../lib/f38-director.js')

console.log('— ① 一个口子都没报过：不许硬说"全部正常" —')
__resetDirector()
check('空场 → 沉默（替不存在的东西担保是假的）', directorLine() === '')

console.log('— ② 全绿：首轮报一声，之后沉默 —')
writeHealth('F5', true, '体检 0 错 · 提示 3')
__resetDirector()
let r = directorLine()
check('首轮全绿 → 报一声（证明它存在）', r.includes('全部正常'))
check('带上了项数（1 项）', r.includes('1 项'))
r = directorLine()
check('状态没变 → 一个字不说', r === '')

console.log('— ③ 由绿转红：说一句，且点名是哪几处 —')
writeHealth('F26', false, '留底 1 份超期')
r = directorLine()
check('由绿转红 → 说一句', r.includes('1 处不正常'))
check('点名了是哪一处（不是光报个数）', r.includes('留底 1 份超期'))
r = directorLine()
check('红着没变 → 不再重复说（不然又成刷屏源）', r === '')

console.log('— ④ 又红了一处：这算"状态变了"，要说 —')
writeHealth('F13', false, '路径锚点 2 处探测不到')
r = directorLine()
check('红的数量变了 → 再说一句（2 处）', r.includes('2 处不正常'))

console.log('— ⑤ 修好了：报全正常，然后沉默 —')
writeHealth('F26', true, '留底 0 份')
writeHealth('F13', true, '路径锚点 0 处')
r = directorLine()
check('由红转绿 → 报全正常', r.includes('全部正常'))
r = directorLine()
check('修好之后又沉默（直到下次出问题）', r === '')

console.log('— ⑥ 它自己那份不算进"别人" —')
// 清理掉别的，只留 F38 自己那份心跳 ⇒ 应当等于"一个口子都没报"
for (const id of ['F5', 'F26', 'F13']) {
  try {
    const { HEALTH_DIR } = await import('../lib/common.js')
    const fs = await import('node:fs')
    fs.rmSync(`${HEALTH_DIR}/${id}.json`, { force: true })
  } catch {
    /* 删不掉不影响断言 */
  }
}
__resetDirector()
check('只剩自己那份心跳时 → 沉默（不拿自己判自己）', directorLine() === '')

done()
