/**
 * F35「工程」—— 2026-09-26 建。跑法：`node tests/f35-project.mjs`
 *
 * 起因（用户 2026-09-26 原话）：
 *   "**待办是待办，工程是工程，这两个不是一回事**……**不允许将他们混为一谈**。
 *    而且顺着这件事，我觉得**工程也是需要我在面板上能直接看到的**。
 *    他的书写格式应该跟待办一样，但因为它的体量更大，**或许可以放宽字数要求**让你可以叙述工程的相关内容。"
 *
 * 这一份钉五件事（**两条是反向断言** —— 照仓库纪律：自己写的判据要能证明"它坏不了"）：
 *   ① **读得出**：事项 / 原因 / 目的 三段都进得来；**空表占位行不算一件工程**；✅ 的不算"还开着"；
 *   ② 🔴 **与待办不是一回事**：两份文件各读各的 —— 工程那条**不许**出现在待办的"还开着"里，反之亦然；
 *      而且**字数上限确实比待办宽**（放宽不是"没上限"：超了必须抓得到）；
 *   ③ **发到面板**：`panelTodo()` 那段 JSON 里带着工程（**同一界面、单独一节**，不新开路由）；
 *   ④ **同一条通道**：`dangan_todo list` 的输出末尾附一段【工程】；
 *   ⑤ **fail-open**：档案里**没有**这份文件时，一条都不许抛错（`file=null` / 0 项）。
 */
import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const PROJECT = [
  '# 清单 · 工程',
  '',
  '## 一、短期 · 我能自己推 [自办]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **全馆重建 —— 把老馆五层改造成六层** | 过渡期：老馆是五层、内容太多不许大改 | 合规范、能用、不再漂 |',
  '| **层重建 —— 重划六层与命名** | 全馆重建下面的一件子工程 | 层的定义在实物上立住 |',
  '| ✅ **早就做完的那件** | 早做完了 | 已结 |',
  '| （还没有） | | |',
  '',
  '## 二、短期 · 需要你拍板 [拍板]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| （还没有） | | |',
  '',
  '## 三、长期 · 不急着做 [长期]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **慢慢来的那件大事** | 不急 | 以后再说 |',
  '',
  '## 四、已归档 [归档]',
  '',
  '| 事情 | 结论 | 归档处 |',
  '|---|---|---|',
  '| 早就做完了的那件 | 结论 | 某处 |',
  '',
].join('\n')

const TODO = [
  '# 待办',
  '',
  '## 四、短期 · 我能自己推 [自办]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **一件具体的小事** | 三轮以内能完 | 做完就结 |',
  '',
].join('\n')

const TIMELINE = ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', '| ○ | **T1** | 2026-09-26 01:00 | 甲 |', ''].join('\n')
const EVENTS = [
  '| E号 | 名称 | 时间 | 状态 | 锚点 |',
  '|---|---|---|---|---|',
  '| E1 | 甲 | 2026-09-26 | ✅ 完成 | T1 |',
  '',
  '### E1｜甲',
  '- **时间跨度**：2026-09-26',
  '- **锚点**：T1',
  '- **状态**：✅ 完成',
  '',
].join('\n')
const LEDGER = ['| 编号 | 说明 |', '|---|---|', '| **R1** | 甲 |', ''].join('\n')

const root = makeArchive('f35', {
  'L2-数据/01-时间轴-我们做过什么.md': TIMELINE,
  'L2-数据/01-事件表-我们做过什么.md': EVENTS,
  'L3-知识/AI错误总账.md': LEDGER,
  'L3-知识/工程-待办.md': TODO,
  'L4-施工/工程-清单.md': PROJECT,
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })

const F35 = await import('../lib/f35-project.js')
const F10 = await import('../lib/f10-todo.js')
const F16 = await import('../lib/f16-panel.js')

console.log('— ① 读得出 —')
const parsed = F35.parseProject()
check('按名字找得到那份工程清单（**不硬编码路径**）', !!parsed.file && parsed.file.includes('工程-清单'))
const { items: open } = F35.openProjects()
const names = open.map((i) => i.item.replace(/\*/g, ''))
check(`还开着的工程是 3 项（两项在做 ＋ 一项长期）—— 实得 ${open.length}：${names.join('、')}`, open.length === 3)
check('已标 ✅ 的那件**不在**"还开着"里', !names.some((n) => n.includes('早就做完')))
check('🔴 **空表占位行「（还没有）」不算一件工程**（待办那边漏过这个坑）', !names.some((n) => n.includes('还没有')))
check('归档节（`[归档]`）里的东西**不算还开着**', !names.some((n) => n.includes('早就做完了的那件')))
check('三段都读得到（事项 / 原因 / 目的）', open[0].why.includes('过渡期') && open[0].goal.includes('不再漂'))
check('章节标记认得出（`[自办]` / `[长期]` 都算在办）', open.some((x) => x.section.includes('[自办]')) && open.some((x) => x.section.includes('[长期]')))

console.log('')
console.log('— ② 🔴 与待办**不是一回事**（两边三条硬边界）—')
check('文件是**两份**（工程清单 ≠ 待办表）', String(F35.projectFile()) !== String(F10.todoFile()))
const todoNames = F10.openItems().items.map((i) => i.item.replace(/\*/g, ''))
check(`待办那边只读出它自己那一条 —— 实得 ${todoNames.length}：${todoNames.join('、')}`, todoNames.length === 1 && todoNames[0].includes('一件具体的小事'))
check('🔴 **工程那三条一次都没出现在待办的"还开着"里**', !todoNames.some((n) => /全馆重建|层重建|慢慢来/.test(n)))
check('🔴 反过来也一样：待办那条**不在**工程里', !names.some((n) => n.includes('一件具体的小事')))
check(
  `字数上限**确实比待办宽**（事项 ${F35.PROJECT_LIMITS.事项} > 40 · 原因 ${F35.PROJECT_LIMITS.原因} > 60 · 目的 ${F35.PROJECT_LIMITS.目的} > 60）`,
  F35.PROJECT_LIMITS.事项 > 40 && F35.PROJECT_LIMITS.原因 > 60 && F35.PROJECT_LIMITS.目的 > 60,
)
check('样本都在上限之内 → "超字数"一条都不报（**不误报**）', F35.findProjectTooLong().length === 0)
check('✅ 却还留在在办节里 → 机器挑得出（施工层"做完就离开"）', F35.projectStaleCandidates().some((c) => c.msg.includes('早就做完的那件')))

// 🔴 **2026-10-16 加（用户当天："能不能拒绝没有链条的工程落笔，或者在一开始就告诉你必须要有链条？"）**
//    上面那份 `PROJECT` 是**旧形态**（只有「事项 / 原因 / 目的」表、没有节点表）⇒ 它**没有节点链** ⇒ 必须被报出来（报「错」，会挡 G2 门）。
check(
  '🔴 没有节点链的工程 ⇒ 报「错」（不是提示）',
  F35.projectStaleCandidates().some((c) => c.lv === '错' && c.msg.includes('没有节点链')),
)

// 反向：**有链的不许误报** —— 现场造一份带节点表的，必须一条都不报
const rootChain = makeArchive('f35-chain', {
  'L4-施工/工程-清单.md': [
    '# 清单 · 工程',
    '',
    '## 一、在推 [自办]',
    '',
    '### 带链的工程',
    '> **为什么要做**：因为它得看得见链条',
    '> **要达成什么**：一眼看到做到哪',
    '',
    '| # | 节点 | 为什么要做 | 完成判据 | 色 |',
    '|---|---|---|---|---|',
    '| 1 | 第一步 | 打地基 | 目录建起来 | 🟢 |',
    '',
  ].join('\n'),
})
mod.apply(ctx, { archiveDir: rootChain })
check('🔴 反向：**带节点链的工程不许被误报"没有节点链"**', !F35.projectStaleCandidates().some((c) => c.msg.includes('没有节点链')))

// 反向：**放宽 ≠ 没上限** —— 造一件超长的，必须抓得到
const long = '这是一件长得离谱的工程' + '甲'.repeat(200)
const root2 = makeArchive('f35-long', {
  'L4-施工/工程-清单.md': ['# 清单 · 工程', '', '## 一、短期 · 我能自己推 [自办]', '', '| 事项 | 原因 | 目的 |', '|---|---|---|', `| **${long}** | 为什么要立它 | 做完什么样 |`, ''].join('\n'),
})
mod.apply(ctx, { archiveDir: root2 })
const tooLong = F35.findProjectTooLong()
check(`超上限的「事项」抓得到（${tooLong[0] ? `${tooLong[0].len} 字 > ${tooLong[0].limit}` : '没抓到'}）`, tooLong.length === 1 && tooLong[0].field === '事项')

console.log('')
console.log('— ②′ 两级形态（工程 → 节点 · 2026-09-28 起）—')
// 用户 2026-09-28："我希望工程展开之后可以像地图那样**按照先后完成顺序组成一个个小节点**……
//   外部只放一个总体说明……**每个小点打开也是，为什么要做什么，做这个要达成什么目的**"＋
//   "**所有绿色的下一个，第一个灰色，就是我们现在的位置**"（所以位置＝第一个非绿节点，不另写字）。
const PROJECT2 = [
  '# 清单 · 工程',
  '',
  '## 一、在推 [自办]',
  '',
  '### 甲工程 —— 带节点的那种',
  '> **为什么要做**：因为它得看得见链条',
  '> **要达成什么**：一眼看到做到哪、下一步是什么',
  '',
  '| # | 节点 | 为什么要做 | 完成判据 | 色 |',
  '|---|---|---|---|---|',
  '| 1 | 第一步 | 打地基 | 目录建起来 | 🟢 |',
  '| 2 | 第二步 | 往上盖 | 体检 0 错 | ⚪ |',
  '| 3 | 第三步 | 封顶 | 用户点头 | 🔴 等拍板 |',
  '',
  '### 乙工程 —— 全绿就算完',
  '> **为什么要做**：试"节点全绿 ⇒ 这件工程算完"',
  '> **要达成什么**：它不该出现在"还开着"里',
  '',
  '| # | 节点 | 完成判据 | 色 |',
  '|---|---|---|---|',
  '| 1 | 唯一一步 | 做完了 | 🟢 |',
  '',
  '## 二、旧写法也还要认（节里没有三级标题 ⇒ 一行一件）[自办]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **旧形态的一件** | 免得不兼容 | 还能读 |',
  '',
].join('\n')
const root3 = makeArchive('f35-two', { 'L4-施工/工程-清单.md': PROJECT2 })
mod.apply(ctx, { archiveDir: root3 })
const p2 = F35.parseProject()
const all2 = p2.sections.flatMap((s) => s.projects)
const jia = all2.find((p) => p.item.includes('甲工程'))
check('两级：三级标题认成一件工程', !!jia)
check('两级：外层总说明两行都进来了（为什么要做 / 要达成什么）', !!jia && jia.why.includes('看得见链条') && jia.goal.includes('下一步'))
check('两级：节点读到 3 个', !!jia && jia.nodes.length === 3)
check('两级：节点带「为什么要做」（5 列写法）', !!jia && jia.nodes[0].why === '打地基')
check('两级：节点带「完成判据」', !!jia && jia.nodes[0].judge === '目录建起来')
check('两级：三档色认得出（🟢 / ⚪ / 🔴）', !!jia && jia.nodes.map((n) => n.color).join('') === '🟢⚪🔴')
check('两级：**当前位置 ＝ 所有绿之后的第一灰**（不另写"我在这"）', !!jia && F35.currentNodeIndex(jia) === 1)
const yi = all2.find((p) => p.item.includes('乙工程'))
check('两级：节点全绿 ⇒ 这件工程算完（不进"还开着"）', !!yi && yi.closed === true && !F35.openProjects().items.some((x) => x.item.includes('乙工程')))
check('两级：**旧形态（一行一件）仍认**（免得旧数据一断就崩）', (() => { const b = all2.find((p) => p.item.includes('旧形态的一件')); return !!b && b.legacy === true && b.nodes.length === 0 })())
check('两级：4 列写法也认（"为什么要做"那格可省）', !!yi && yi.nodes[0].color === '🟢' && yi.nodes[0].judge === '做完了')
const sum2 = F35.projectSummary()
const jiaIt = sum2.items.find((x) => x.item.includes('甲工程'))
check('两级：送面板那份带 `nodes` ＋ `progress`', !!jiaIt && jiaIt.nodes.length === 3 && jiaIt.progress.done === 1 && jiaIt.progress.total === 3)
check('两级：颜色说明也发出去（面板照着它显示）', !!sum2.colors && sum2.colors['🟢'] === '已完成' && sum2.colors['🔴'] === '卡住 / 等拍板 / 等前置')

console.log('')
console.log('— ③ 发到面板（同一界面、下面单开一节）—')
mod.apply(ctx, { archiveDir: root })
const panel = F16.panelTodo()
check('`panelTodo()` 仍然 ok（**没新开路由**，挂在待办那条通道上）', panel.ok === true)
check('面板数据里带着工程（`data.projects`）', !!panel.data.projects && panel.data.projects.count === 3)
check('工程那一节自带**另一份文件**的路径（不是待办那份）', String(panel.data.projects.file).includes('工程-清单') && !String(panel.data.projects.file).includes('待办'))
check('上限也一起发出去（面板要照着它显示）', panel.data.projects.limits && panel.data.projects.limits.事项 === F35.PROJECT_LIMITS.事项)
check('待办那一段**没被工程挤掉**（两段各是各的）', panel.data.count === 1 && panel.data.items.length === 1)

console.log('')
console.log('— ④ 同一条通道：`dangan_todo list` 末尾附一段【工程】—')
const todoTool = ctx.registered.find((t) => t.name === 'dangan_todo')
const beforeQuiet = console.log
console.log = () => {}
const listed = await todoTool.execute({})
const checked = await todoTool.execute({ mode: 'check' })
console.log = beforeQuiet
check('工具输出里**两段都在**（待办 ＋ 工程）', String(listed.text).includes('dangan_todo') && String(listed.text).includes('【工程】'))
check('工程那一段带着它自己的条目与文件行号', String(listed.text).includes('全馆重建') && String(listed.text).includes('工程-清单.md'))
check('`check` 也**分开报**（待办一段、工程一段）', String(checked.text).includes('【工程】') && String(checked.text).includes('工程清单'))
check('工具说明里写明了"工程与待办不是一回事"', String(todoTool.description).includes('不是一回事'))
check('工具说明里写明了 `clean` **不碰工程**', String(todoTool.description).includes('不碰工程'))

console.log('')
console.log('— ⑤ fail-open：档案里**没有**这份文件 —')
const bare = makeArchive('f35-bare', { 'L3-知识/工程-待办.md': TODO })
mod.apply(ctx, { archiveDir: bare })
check('找不到那份文件 → `projectFile()` 是 null（**不是抛错**）', F35.projectFile() === null)
check('`openProjects()` 照样回一份空的', F35.openProjects().items.length === 0)
check('`projectStaleCandidates()` 回空数组（老档案里本来就没这份文件）', F35.projectStaleCandidates().length === 0)
check('`findProjectTooLong()` 回空数组', F35.findProjectTooLong().length === 0)
check('`formatProjectList()` 明说"找不到"，**不撒谎说"0 项"**', F35.formatProjectList().includes('找不到'))
check('`projectSummary()` 给空的一份（面板那节留空就好）', F35.projectSummary().count === 0 && F35.projectSummary().file === '')
check('`panelTodo()` 在缺这份文件时**照样 ok**（不拖垮待办那条通道）', F16.panelTodo().ok === true && F16.panelTodo().data.count === 1)
check('启动自检**读不到也出声**（"沉默 ≠ 正常"）', F35.reportF35().includes('0 项'))

done()
