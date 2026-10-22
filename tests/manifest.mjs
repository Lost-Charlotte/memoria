/**
 * 能力清单（`lib/manifest.js`）与控制台装配 —— 2026-09-17 建。
 *
 * 为什么单独一个测试文件：用户 2026-09-16 的原话是"**没有一个很好的接口的话，后续每次添加都会麻烦**"。
 * 所以这里钉住三件事：
 *   ① 五件工具 + 两个钩子/拦截器**都在清单里**（少一件就是"装了等于没装"）；
 *   ② 代号**不重复**（撞号＝两件事共用一个名字，与"两个真 R5"是同一个坑）；
 *   ③ 每一项**都能被装**（有 register / tool / selfCheck 至少一样）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()
const root = makeArchive('manifest', {
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  '从这开始读.txt': '入口\n',
  '01-时间轴-我们做过什么.md': ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', '| ○ | **T1** | 09-10 01:00 | 甲 |', ''].join('\n'),
  '01-事件表-我们做过什么.md': ['| E号 | 名称 | 时间 | 状态 | 锚点 |', '|---|---|---|---|---|', '| E1 | 甲 | 09-10 | ✅ | T1 |', '', '### E1｜甲', '- **时间跨度**：09-10', '- **锚点**：T1', '- **状态**：✅ 完成', ''].join('\n'),
  'AI错误总账.md': ['| 编号 | 说明 |', '|---|---|', '| **R1** | 甲 |', ''].join('\n'),
})

const mod = await loadPlugin()
const { CAPS, capabilityList, manifestProblems } = await import('../lib/manifest.js')

console.log('— 清单本身 —')
// ⚠️ **故意不写死项数**（原来这里写的是 `=== 10`）：每加一个能力就得回来改测试，
//    正是档案里点过的"**元数字没来源**"病根。改成"项数与 capabilityList() 必须一致、且不为 0"。
check(`清单项数与 capabilityList() 一致（实得 ${CAPS.length} 项）`, capabilityList().length === CAPS.length && CAPS.length > 0)
check('清单自身没有毛病（缺字段 / 撞号 / 装了等于没装）', manifestProblems().length === 0)
check('代号不重复', new Set(CAPS.map((c) => c.id)).size === CAPS.length)
// ⚠️ **加工具时同步这一行**（它是"工具面的期望清单"，不是元数字）——
//    2026-10-07 织布机（F36）进来时从 6 件改成 7 件；
//    🔴 **2026-10-15 又回到 6 件**：`dangan_log`（F6 的门面）**收进织布机**了
//    （落档改走 `dangan_weave` 的 `pattern:'落档'`）⇒ F6 只留内核。
check(
  `那 6 件工具都在清单里、且**正好 6 件**（工具数实得 ${CAPS.filter((c) => c.toolName).length}）`,
  ['dangan_search', 'dangan_check', 'dangan_todo', 'dangan_status', 'dangan_init', 'dangan_weave'].every((n) =>
    CAPS.some((c) => c.toolName === n)
  ) && CAPS.filter((c) => c.toolName).length === 6
)
// 🔴 2026-09-18 工具合并：**被并掉的 4 个名字不许再出现**（否则"旧名字仍可调"成了第二个入口）。
check(
  '被并掉的 4 个旧工具名不再注册（dangan_recent / dangan_index / dangan_overview / dangan_map）',
  !['dangan_recent', 'dangan_index', 'dangan_overview', 'dangan_map'].some((n) => CAPS.some((c) => c.toolName === n))
)
// 🔴 2026-09-21 **用户改了口径**："**旧的代号就非得留着吗？东西都没了留下个代号就为了不报错？**"
//    —— 被合并的能力**不再单独留在清单里**：它的"能做什么"并进吸收它的那一条（如"归档留底"那条路
//    写进了 F22 会话存档）。所以这里改钉"**旧代号确实没了**"，而不是"留着并标明并到哪儿"。
check(
  '被合并的旧代号不再单独占清单一行（F8/R1/F21/F24/F9/F17/F23/F25/F27）',
  ['F8', 'R1', 'F21', 'F24', 'F9', 'F17', 'F23', 'F25', 'F27'].every((id) => !CAPS.some((c) => c.id === id))
)
// 同理：不写死"挂事件的能力有几个"，只钉住"这两件必须是 hook 型"。
check('两个"挂事件/拦截"的能力在（F1 重注入 / F7 闸门）', ['F1', 'F7'].every((id) => CAPS.some((c) => c.id === id && typeof c.register === 'function')))
check('每个能力都有"它替我做掉什么"（给人看的那句话）', CAPS.every((c) => typeof c.what === 'string' && c.what.length > 8))
check('capabilityList() 是纯数据（不含函数，供将来的控制台面板读）', capabilityList().every((c) => !Object.values(c).some((v) => typeof v === 'function')))

console.log('')
console.log('— 装出来的东西 —')
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })
const names = ctx.registered.map((t) => t.name).sort()
check(`照清单装出了与清单同数的工具（实得 ${names.length}：${names.join(' / ')}）`, names.length === CAPS.filter((c) => c.toolName).length)
check('工具名与清单一一对应', names.join(',') === CAPS.filter((c) => c.toolName).map((c) => c.toolName).sort().join(','))
check('钩子也挂了（session/event + agent/pre-step）', !!ctx.handlers['session/event'] && !!ctx.handlers['agent/pre-step'])
check('闸门也挂了（agent/turn-stopping）', !!ctx.handlers['agent/turn-stopping'])

console.log('')
console.log('— 启动自检：**每个能力都得真出声** —')
// ⚠️ 2026-09-17 加（**重启后实测抓到的真缺陷**）：`selfCheck` 有两种写法 ——
//    "自己 log"（F2/F5/F9）与"**返回一句字符串**"（F12/F13/F14）。
//    而 `index.js` 原来只调不接返回值 → **那三个的启动自检一个字都没说**。
//    这条断言钉住"**两种写法都必须落到日志里**" —— 沉默 ≠ 正常。
const logText = readFileSync(join(process.env.DSH_HOME, 'memoria.log'), 'utf8')
check('F12（返回字符串型）的自检真写进了日志', logText.includes('注入预算 F12'))
check('F13（返回字符串型）的自检真写进了日志', logText.includes('有效性锚点 F13'))
check('F14（返回字符串型）的自检真写进了日志', logText.includes('凭据硬拦 F14'))
check('F2（自己 log 型）的自检也还在', logText.includes('作废哨兵'))
check('🔴 没有任何自检抛错被吞掉', !logText.includes('自检失败（fail-open）'))

done()
