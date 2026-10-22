/**
 * F10 待办的「出」—— **自动移出 + 归档**（2026-09-17 晚补的最后一公里）。跑法：node tests/f10-todo-clean.mjs
 *
 * 起因（用户当天问得很准）："**待办我记得不是已经自动化了吗？我要的不是你老去自己看那些地方，
 * 要的是能自动化，你看看是什么原因导致自动化没成功。**"
 *
 * 🔴 **诊断出的根因**：`list` / `check` **两个都是只读的** —— W6 写的是"打 ✅ 后把那一行移进 §五"，
 *    而**"移出"那一步留给了人**。于是机器只**报**、不动手 → 每次还得人自己去看、自己去删。
 *    另外 `parseTodo` 原来**只解析"在办"章节** → §五（归档区）那张表根本读不到，
 *    **连归档位置都找不到**，自动化就断在这一步。
 *
 * 这一份钉住四件事：
 *   ① **只动"作者自己标了 ✅/🔚"的**（唯一机器能确定的一类）—— "还开着"的一条都不许碰；
 *   ② **默认干跑**，`apply` 才真动；
 *   ③ 真动时＝**删那一行 ＋ 往 §五 追加一行归档**（信息不丢），走**同一扇门**（快照可回滚）；
 *   ④ **幂等**：归档行带 `[清 日期]` 标，再跑一次不产生任何改动。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()
// 写入内核的落点：测试里显式指向包内那份（与生产同一条路）
process.env.MEMORIA_KERNEL = fileURLToPath(new URL('../tools/改档.mjs', import.meta.url))

const root = makeArchive('clean', {
  'L2-数据/01-时间轴-我们做过什么.md': ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', '| ○ | **T1** | 2026-09-17 10:00 | 甲 |', '- **锚点**：T1', ''].join('\n'),
  'L2-数据/01-事件表-我们做过什么.md': [
    '| E 号 | 事件名 | 时间跨度 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    '| E1 | 甲的事 | 2026-09-17 | 🔄 进行中 | T1 |',
    '',
    '### E1｜甲的事',
    '- **时间跨度**：2026-09-17',
    '- **锚点**：T1',
    '- **结果**：甲的事做完了（夹具补：2026-10-01 起字段名必须等于白名单、且「结果」必备）',
    '- **状态**：🔄 进行中',
    '',
  ].join('\n'),
  'L3-知识/工程-待办.md': [
    '# 待办',
    '',
    '## 四之七、最新那一节 [在办]',
    '',
    '| 事项 | 卡在哪 | 怎么算结 |',
    '|---|---|---|',
    '| **给搬运脚本加一个"先算容量"的自检** | 脚本里还没写 | 加上并实测一次 |',
    // ⚠️ 故意把 ✅ 写在**中间**（不是开头）—— 真档案里就是这么写的，
    //    而原来的 `isClosed` 只认"以 ✅ 开头" → 判不出"已办还挂着"（2026-09-17 深夜抓到的真 bug）
    '| **把工具箱最后两个脚本挪进插件包** —— ✅ **已办（2026-09-17 晚）** | 已办 | — |',
    '| **指纹信号与现算值对不上，要查清** | 试了 5 种算法都对不上 | 查明原因并修 |',
    '',
    '## 五、已经解决并归档的 [归档]',
    '',
    '| 事情 | 结论 | 归档处 |',
    '|---|---|---|',
    '| 旧事 | 早结了 | 某处 |',
    '',
  ].join('\n'),
  // 🔴 2026-10-16 加：**归档件**（`dangan_todo clean` 的新落点 —— 原来往 `工程-待办.md` 的 `[归档]` 节追加）
  'L8-施工归档/待办归档/待办归档.md': [
    '# 待办归档（已办完 / 已作废的待办条目）',
    '',
    '| 事项 | 怎么结的 | 归档处 |',
    '|---|---|---|',
    '| 旧事 | 早结了 | 某处 |',
    '',
  ].join('\n'),
})

const mod = await loadPlugin()
mod.apply(mockCtx(), { archiveDir: root })
const F10 = await import('../lib/f10-todo.js')
const { runTxnOps } = await import('../lib/f9-commit.js')
const p = root + '\\L3-知识\\工程-待办.md'
const read = () => readFileSync(p, 'utf8')

console.log('')
console.log('— ① 计划：只挑"作者自己标了完成"的 —')
const plan = F10.todoPlanClean()
// ⚠️ 这一条本身就是回归断言：**✅ 写在中间也要认出来**（真档案里就长这样）
check(`挑出 1 条（✅ 写在中间的那条），不是 2、也不是 0 —— 实得 ${plan.moves.length}`, plan.moves.length === 1)
check('挑中的正是那条"挪进插件包"（✅ 在中间）', plan.moves[0]?.item.includes('把工具箱最后两个脚本'))
check('🔴 归档件路径常量在（2026-10-16 新落点：L8\\待办归档）', F10.TODO_ARCHIVE_FILE === 'L8-施工归档\\待办归档\\待办归档.md')

console.log('')
console.log('— ② 干跑：一个字都不写 —')
const before = read()
const dryTxt = F10.formatCleanPlan(plan, { applied: false })
check('干跑文本里写明"干跑/一个字都没写"', dryTxt.includes('干跑') || dryTxt.includes('一个字都没写'))
check('干跑真的没动文件', read() === before)
// ⚠️ **2026-09-18 加**：这一行的文案原来写死成 `归档到：§${section.slice(0,24)}` ——
//    于是真档案里印出来是"归档到：§八、已归档（本次会话已经解决并归档的 · **不"（**§ 重复 ＋ 半句截断**）。
//    钉住"印的是真归档区的名字、且不截断"（真档案里那个标题有 40 多个字符）。
check('文案里印的是新归档件路径（L8\\待办归档）', /归档到：L8-施工归档\\待办归档\\待办归档\.md/.test(dryTxt), dryTxt.split('\n').slice(-2).join(' / '))

console.log('')
console.log('— ③ 真移出：删那一行 ＋ 往 §五 追加归档 —')
const built = F10.todoCleanOps({ plan, date: '2026-09-17' })
check(`事务 2 条改动（1 删 ＋ 1 归档）—— 实得 ${built.ops.length}`, built.ops.length === 2)
check('删行带 expect（原样那一行 → 别人动过就停手）', built.ops[0].op === 'deleteLine' && String(built.ops[0].expect).includes('把工具箱最后两个脚本'))
check('归档行带 [清 日期] 标（幂等靠它）', built.ops[1].text.includes('[清 2026-09-17]'))

const r = runTxnOps(built.ops, '测试：待办清理')
check(`内核落成了（走的是改档那扇唯一的门）—— ${String(r.out ?? '').trim().split('\n').slice(-2)[0] ?? ''}`, r.ok === true)

const after = read()
const arcPath = root + '\\L8-施工归档\\待办归档\\待办归档.md'
const arcAfter = readFileSync(arcPath, 'utf8')
check('那一条已从在办表移走', !/^\| ✅ \*\*把工具箱最后两个脚本/m.test(after))
check('🔴 它出现在**归档件**里（2026-10-16 新落点）', arcAfter.includes('把工具箱最后两个脚本'))
check('🔴 它**不再**留在待办文件里（L4 只留没做完的）', !after.includes('把工具箱最后两个脚本'))
check('另外两条"还开着"的一条都没被动', after.includes('先算容量') && after.includes('指纹信号与现算值对不上'))
check('归档行写明是自动移出', /自动移出/.test(arcAfter))

console.log('')
console.log('— ④ 幂等：再跑一次不产生任何改动 —')
const plan2 = F10.todoPlanClean()
check('第二次没有"该移出"的了', plan2.moves.length === 0)
const built2 = F10.todoCleanOps({ plan: plan2, date: '2026-09-17' })
check('第二次的 ops 是空的', built2.ops.length === 0)
check('文件没被再动一次', read() === after)

console.log('')
console.log('— ⑤ 表没被切坏（体检 0 错）—')
const issues = mod.__internals.checkArchive()
check(`机械体检 0 错 —— 实得 ${issues.filter((x) => x.lv === '错').length}`, issues.filter((x) => x.lv === '错').length === 0)

done()
