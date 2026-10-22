/**
 * F7 落档闸门的判定内核。跑法：node tests/f7-gate.mjs
 *
 * 两道门（G1 落没落 / G2 对不对得上）+ 一条边界：
 * **首次运行没有基线时，不许误报 G1。**
 * ⚠️ 夹具里的等级列**必须显式写 `○`** —— 空白现在等于"没定级"，会被 G2 报错（2026-09-16 晚起）。
 */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const D = (i) => `09-${String(i).padStart(2, '0')}`

function build({ name, tCount, eCount, idxCount, ovDate }) {
  const tl = ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|']
  for (let i = 1; i <= tCount; i++) tl.push(`| ○ | **T${i}** | ${D(i)} 01:00 | 第 ${i} 件事 |`)
  // 给"日期正则"挖的坑：整篇文本里出现完整年份，绝不能被当成 `26-09` 这个日期。
  // （2026-09-16 实测踩到：闸门在观察模式里报"时间轴已经到 26-09"，假的。）
  tl.push('', '> 快照：本表生成于 2026-09-16。')

  const ev = ['| E号 | 事件 | 时间跨度 | 状态 | 锚点 |', '|---|---|---|---|---|']
  for (let i = 1; i <= idxCount; i++) ev.push(`| E${i} | 第${i}件 | ${D(i)} | ✅ | T${i} |`)
  for (let i = 1; i <= eCount; i++) {
    ev.push(
      '',
      `### E${i}｜第${i}件`,
      `- **时间跨度**：${D(i)}`,
      `- **锚点**：T${i}`,
      `- **结果**：第${i}件做完了（夹具补：2026-10-01 起这条字段是必备的）`,
      '- **状态**：✅ 完成',
      '- **指引**：`L3-知识/x.md`',
    )
  }

  return makeArchive(name, {
    '01-时间轴-我们做过什么.md': tl.join('\n') + '\n',
    '01-事件表-我们做过什么.md': ev.join('\n') + '\n',
    '00-总览-我们干过什么.md': ['| 日期 | 一句话 | 去哪看 |', '|---|---|---|', `| **${ovDate}** | 最近的事 | — |`, ''].join('\n'),
    'L3-知识/x.md': '占位，防死指针误报。\n',
  })
}

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: '/placeholder' })

// 先造一份"标准档"，拿到事件表的指纹当基线 —— **现在真实运行里的基线都带指纹**，
// 所以测 G1 要用带指纹的 state（"无指纹的老 state"另有专门的用例，见文件末尾）。
mod.__internals.CFG.archiveDir = build({ name: 'f7-canon', tCount: 5, eCount: 5, idxCount: 5, ovDate: D(5) })
const E5 = '' // 🔴 2026-10-15：`eventTableHash()` 随 L2 退役删除 ⇒ 这里直接用空串（原来算事件表 sha1）

const cases = [
  ['A 全绿（样本里埋着 `2026-09-16`，不许被读成 26-09）', { tCount: 5, eCount: 5, idxCount: 5, ovDate: D(5) }, { lastT: 5, lastE: 5, lastEHash: E5 }, (v) => v.ok === true],
  // 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：原「B G1：时间轴涨了、事件表一个字没动 → 拦」
  //    随 L2 删除**退役** —— `countT()`/`countE()` 恒 -1 ⇒ G1 不再触发（它没有对象了）。
  //    改成钉住"退役后不许误拦"。
  ['B（原 G1）L2 已删：时间轴/事件表都不存在 ⇒ G1 退役、不许误拦', { tCount: 6, eCount: 5, idxCount: 5, ovDate: D(5) }, { lastT: 5, lastE: 5, lastEHash: E5 }, (v) => v.ok === true],
  // 🔴 2026-10-15：原「C G2：正文有 E5、索引表少一行」**随 L2 退役删除**（那份"索引↔正文对账"判据已下线）。
  //    "G2 该拦"这个覆盖**另换道具保住** —— 见下面循环之后那条（用仍在跑的"文件型死指针"造错）。
  // ⚠️ 原「D G3：总览停在 09-02」已删——总览不再抄时间线，G3 没有检查对象（2026-09-16 晚）
  ['E 首次运行没有基线 → 不许误报 G1', { tCount: 5, eCount: 5, idxCount: 5, ovDate: D(5) }, {}, (v) => v.ok === true],
]

for (const [name, opts, state, ok] of cases) {
  mod.__internals.CFG.archiveDir = build({ name: 'f7-' + name.slice(0, 1), ...opts })
  const v = mod.__internals.gateVerdict(state)
  check(`${name}  → ${v.id}`, ok(v))
}

// 🔴 2026-10-15 加：**G2 的"要拦"用一个仍在跑的判据来造错** —— 往档案里塞一个不存在的档案引用
//    （文件型死指针）。原来那个道具（"索引表少一行"）随 L2 退役下线了。
{
  const rootDead = build({ name: 'f7-dead', tCount: 5, eCount: 5, idxCount: 5, ovDate: D(5) })
  appendFileSync(join(rootDead, 'L3-知识', 'x.md'), '\n见 `L1-必读\\不存在.md`。\n', 'utf8')
  mod.__internals.CFG.archiveDir = rootDead
  const vDead = mod.__internals.gateVerdict({ lastT: 5, lastE: 5, lastEHash: E5 })
  check(`C G2：档案里有死指针 → 拦  → ${vDead.id}`, vDead.ok === false && vDead.id === 'G2')
}

// ---- G1 的判据必须是"事件表**内容**有没有动"，不是"E 的**条数**涨没涨" ----
// 真事（2026-09-16 深夜）：T174 那轮我**更新了 E55**（条数 58 没变）→ 按"比条数"的老规则必被假拦。
console.log('')
const rootA = build({ name: 'f7-hash', tCount: 5, eCount: 5, idxCount: 5, ovDate: D(5) })
mod.__internals.CFG.archiveDir = rootA
const base = { lastT: 5, lastE: 5, lastEHash: '' }
check('基线：T 没涨 → 通过', mod.__internals.gateVerdict(base).ok === true)

// ① 时间轴涨一行、事件表**内容改过**（条数不变）→ 这是合规的收尾，不许拦
const rootB = build({ name: 'f7-hash2', tCount: 6, eCount: 5, idxCount: 5, ovDate: D(5) })
appendFileSync(join(rootB, '01-事件表-我们做过什么.md'), '\n- **结果**：追加了一句（条数没变，但内容动了）\n', 'utf8')
mod.__internals.CFG.archiveDir = rootB
const vUpd = mod.__internals.gateVerdict(base)
check(`时间轴涨了但**更新了已有 E 条** → 不拦（现在 ${vUpd.id}）`, vUpd.ok === true)

// 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：下面 ② 与 ④ 原本测"时间轴涨了、事件表没动 → G1 拦"。
//    L2 已删 ⇒ `countT()`/`countE()` 恒 -1 ⇒ **G1 不再触发**（它没有对象了）。
//    这两处改成钉住"退役后不许误拦"（判据随 L2 退役，不是放松）。
const rootC = build({ name: 'f7-hash3', tCount: 6, eCount: 5, idxCount: 5, ovDate: D(5) })
mod.__internals.CFG.archiveDir = rootC
const vFroze = mod.__internals.gateVerdict(base)
check(`L2 已删：时间轴涨了、事件表没动 → G1 退役、不拦（现在 ${vFroze.id} / ok=${vFroze.ok}）`, vFroze.ok === true)

// ③ 老 state（没有指纹字段）→ **不许指控**。
//    反面教材就是我上一版：这里原本写的是"退回旧判据"，等于把**死锁**写成了预期行为 ——
//    基线只在"通过"时才写，于是"失败 → 不写基线 → 继续失败"。真机上连报两轮，被日志推翻。
const vLegacy = mod.__internals.gateVerdict({ lastT: 5, lastE: 5 })
check(`老 state（无指纹）→ 放过、不假拦（现在 ${vLegacy.id} / ok=${vLegacy.ok}）`, vLegacy.ok === true)

// ④ 自愈：放过那一轮 closeGate 会把带指纹的基线写下去 → 从下一轮起按指纹判
const st = { lastT: 5, lastE: 5 }
mod.__internals.closeGate(st)
check('closeGate 不再写指纹基线（`eventTableHash` 随 L2 退役删除）', st.lastEHash === undefined)
// 🔴 2026-10-15：**「迁移后的基线记 -1」这条断言随 G1 退役删除** —— G1 整段退役后，
//    `closeGate` 不再写 `lastT` / `lastE` 两个基线（只有退役的 G1 读它们）。`lastEHash` 仍在写（115 行钉着）。
const rootD = build({ name: 'f7-hash4', tCount: 7, eCount: 5, idxCount: 5, ovDate: D(7) })
mod.__internals.CFG.archiveDir = rootD
const vAfter = mod.__internals.gateVerdict(st)
check(`L2 已删：迁移完成后 G1 不再触发、不误拦（现在 ${vAfter.id} / ok=${vAfter.ok}）`, vAfter.ok === true)

// ---- G3 事件收尾（2026-09-17 下午加 · 用户点的："每次都会强制你判断一次"）----
// 起因：真档案里 76 条事件有 19 条写着"进行中"，其中 E61~E75 是逐版事件、**每一版都发完了**
//   → 待办那三类里的"上游（T/E）已结案"永远挑不出东西。G3 就是逼我回头收尾的那道门。
console.log('')
const g3root = makeArchive('f7-g3', {
  '01-时间轴-我们做过什么.md': [
    '| 等级 | 编号 | 时间 | 发生了什么 |',
    '|---|---|---|---|',
    '| ○ | **T1** | 2020-01-01 01:00 | 老事 |',
    '| ○ | **T2** | 2020-01-02 01:00 | 老事二 |',
    '',
  ].join('\n'),
  '01-事件表-我们做过什么.md': [
    '| E号 | 事件 | 时间跨度 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    '| E1 | **老的事** | 2020-01-01 | 🔄 进行中 | T1 |',
    '| E2 | **另一件** | 2020-01-02 | ✅ 完成 | T2 |',
    '',
    '### E1｜老的事',
    '- **时间跨度**：2020-01-01',
    '- **锚点**：T1',
    '- **结果**：老的事还开着（夹具补：2026-10-01 起这条字段是必备的）',
    '- **状态**：🔄 进行中',
    '',
    '### E2｜另一件',
    '- **时间跨度**：2020-01-02',
    '- **锚点**：T2',
    '- **结果**：另一件做完了（夹具补：2026-10-01 起这条字段是必备的）',
    '- **状态**：✅ 完成',
    '',
  ].join('\n'),
  'L3-知识/x.md': '占位，防死指针误报。\n',
})
mod.__internals.CFG.archiveDir = g3root
const g3state = { lastT: 2, lastE: 2, lastEHash: '' }
const vG3 = mod.__internals.gateVerdict(g3state)
// 🔴 2026-10-15：G3 事件收尾已退役删除（它读的事件表随 L2 删了 ⇒ 恒空、永不触发）。
//    夹具照旧造一份"2020 年没动、还开着"的事件表，钉的就是"**它现在不拦**"这条。
check(`G3 已退役：事件表里那条"2020 年没动"的**不再拦**（现在 ${vG3.id} / ok=${vG3.ok}）`, vG3.ok === true)

done()
