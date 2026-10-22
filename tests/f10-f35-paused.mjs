/**
 * 「暂缓」那一条（面板二级菜单）—— 2026-10-01 建。跑法：`node tests/f10-f35-paused.mjs`
 *
 * 起因（用户 2026-10-01 原话，两句）：
 *   ① "**暂缓的工程和待办都不在梅莫莉亚的面板里显示，我需要他们能被显示。
 *      或许不用显示在第一级，可以做一个二级菜单放进去。**"
 *   ② "**做完的不要显示了**……现在已经这么多了，今后还会变多，放在这里面太夸张了。"
 *
 * 这一份钉四件事（**三条是反向断言** —— 照仓库纪律：自己写的判据要能证明"它坏不了"）：
 *   ① **收得对**：待办只收 `[等条件]` 那一节、工程只收"等拍板/等前置"那一节；
 *   ② 🔴 **反向一**：`[已决]`（不许再问）与 `[归档]`（做完的）**一条都不许进来** —— 那是用户明说的；
 *   ③ 🔴 **反向二**：工程"在推"（`actionable`）的**不许混进暂缓**（我第一版就写反了这个判据：
 *      把在推的当成暂缓、把等拍板的漏掉 —— 这条断言就是那次错的守门人）；
 *   ④ **合得对**：`panelTodo()` 那段 JSON 里 `paused` 是**两份来源合起来**的（同一界面、不新开路由）。
 */
import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const PROJECT = [
  '# 清单 · 工程',
  '',
  '## 一、在推 —— 我自己推 [自办]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **在推的那件** | 正在做 | 做完它 |',
  '',
  '## 二、等拍板 / 等前置 —— 要你点头 [拍板]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **等你点头的那件** | 要用户拍板 | 拍了才动 |',
  '| **等前置的那件** | 得等前面的 | 前置到了再做 |',
  '',
  '## 三、已归档 [归档]',
  '',
  '| 事情 | 结论 | 归档处 |',
  '|---|---|---|',
  '| 做完的那件 | 已完工 | 某处 |',
  '',
].join('\n')

const TODO = [
  '# 待办',
  '',
  '## 一、不许再问 [已决]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **早拍过板的那条** | 用户已定 | 别再问 |',
  '',
  '## 二、等条件 / 搁置 [等条件]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **等三盘在线的那条** | 条件没到 | 到了再测 |',
  '| **等新馆架构的那条** | 得等架构 | 架构定了再做 |',
  '| ✅ **已经做完的暂缓条** | 早做完了 | 已结 |',
  '',
  '## 五、需要你拍板 [拍板]',
  '',
  '| 事项 | 原因 | 目的 |',
  '|---|---|---|',
  '| **一条还开着的** | 等你点头 | 拍了就做 |',
  '',
  '## 八、已归档 [归档]',
  '',
  '| 事情 | 结论 | 归档处 |',
  '|---|---|---|',
  '| 做过的那件 | 结论 | 某处 |',
  '',
].join('\n')

const TIMELINE = ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', '| ○ | **T1** | 2026-10-01 02:00 | 甲 |', ''].join('\n')
const EVENTS = [
  '| E号 | 名称 | 时间 | 状态 | 锚点 |',
  '|---|---|---|---|---|',
  '| E1 | 甲 | 2026-10-01 | ✅ 完成 | T1 |',
  '',
  '### E1｜甲',
  '- **时间跨度**：2026-10-01',
  '- **锚点**：T1',
  '- **状态**：✅ 完成',
  '',
].join('\n')
const LEDGER = ['| 编号 | 说明 |', '|---|---|', '| **R1** | 甲 |', ''].join('\n')

const root = makeArchive('paused', {
  'L2-数据/01-时间轴-我们做过什么.md': TIMELINE,
  'L2-数据/01-事件表-我们做过什么.md': EVENTS,
  'L3-知识/AI错误总账.md': LEDGER,
  'L3-知识/工程-待办.md': TODO,
  'L4-施工/工程-清单.md': PROJECT,
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })

const f10 = await import('../lib/f10-todo.js')
const f35 = await import('../lib/f35-project.js')
const f16 = await import('../lib/f16-panel.js')

// ① 只收 `[等条件]`；⚠️ **表里那条 ✅ 的不算**（用户："做完的不要显示了"）
const z = f10.pausedTodoItems()
check('待办暂缓：2 条（✅ 那条不进）', z.items.length === 2)
check('待办暂缓：全部来自 [等条件] 那一节', z.items.every((it) => /\[等条件\]/.test(it.section)))
check('待办暂缓：带上行号与三段', z.items.every((it) => it.line > 0 && typeof it.item === 'string' && typeof it.why === 'string' && typeof it.goal === 'string'))
// ② 反向：已决 / 归档不许进
check('反向：`[已决]`（不许再问）一条都不进', !z.items.some((it) => /早拍过板/.test(it.item)))
check('反向：`[归档]`（做过的那件）一条都不进', !z.items.some((it) => /做过的那件/.test(it.item)))
check('反向：还开着那条（[拍板]）不算暂缓', !z.items.some((it) => /一条还开着的/.test(it.item)))

// ③ 工程只收"等着的"
const p = f35.pausedProjects()
check('工程暂缓：2 条（等拍板 ＋ 等前置）', p.length === 2)
check('反向：工程已归档的不进', !p.some((it) => /做完的那件/.test(it.item)))
check('反向：工程「在推」的不进暂缓（第一次判据写反就是这个）', !p.some((it) => /在推的那件/.test(it.item)))
check('工程暂缓：带上行号与分段', p.every((it) => it.line > 0 && typeof it.section === 'string'))

// ④ 面板那段 JSON 合得对
const r = f16.panelTodo()
const paused = r && r.data ? r.data.paused : null
check('面板 paused 是数组', Array.isArray(paused))
check('面板 paused ＝ 待办 2 ＋ 工程 2', paused && paused.length === 4)
check('面板 paused 两条来源都在', paused && new Set(paused.map((x) => x.from)).size === 2)
check('面板 paused 每条都带 from / item / line', paused && paused.every((x) => x.from && x.item && x.line > 0))
check('反向：面板 paused 里没有归档来的', paused && !paused.some((x) => /做过的那件|早就做完/.test(x.item)))

done()
