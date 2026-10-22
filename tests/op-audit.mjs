// 🔴 隔离（**必须在这份文件的第一个字节**）：把 DSH_HOME 指到临时目录。
//   为什么用 `createRequire`：ESM 会把**所有** `import` 提升到顶部并先求值 ——
//   写成 `process.env.DSH_HOME = ...` 放在哪都没用（它总在 import 之后跑）。
//   而 `require` 是**按位置执行**的，所以这三行真的能抢在插件之前（2026-09-18 实测：
//   修之前跑一次 test.mjs，用户的 ~/.dsh 里就多 11 个 txn 残件）。
const __m0 = await import('node:module')
const { __cr = __m0.createRequire } = __m0
const __req = __cr(import.meta.url)
process.env.DSH_HOME = __req('node:fs').mkdtempSync(__req('node:path').join(__req('node:os').tmpdir(), 'memoria-home-'))

/**
 * `auditOps` —— 落笔半交给内核**之前**的最后一道机械闸。跑法：node tests/op-audit.mjs
 *
 * 为什么单独立一个文件：它是**纯函数**，而且对着**一场具体事故**（09-16"哈希表数字 key 取值失败 →
 * 写入空值 → **一次清空 9 行**"）。把它的全部边界摆在一处，比散在 f9 的长流程里更好复查。
 *
 * ⚠️ 最要紧的不是"能拦坏 op"，而是**不许误伤真提案** —— 所以最后一段专门验这个：
 *    拿真实样本跑一遍 `planCommit`，它的 ops 必须**一条都不被闸碰掉**。
 */
const __m1 = await import('./harness.mjs')
const { check = __m1.check, done = __m1.done, loadPlugin = __m1.loadPlugin, makeArchive = __m1.makeArchive, mockCtx = __m1.mockCtx, sandboxHome = __m1.sandboxHome } = __m1

sandboxHome()
const { auditOps, planCommit } = await import('../lib/f9-commit.js')

console.log('')

// ============================================================
// 一、坏 op 必须被拦（每一条都对应一种真事故）
// ============================================================
check('空清单 → 拦（"没有任何要改的地方"不该走到落笔）', auditOps([]).length === 1)
check('不是数组 → 拦', auditOps(null).length === 1)

const undef = auditOps([{ op: 'append', file: 'x.md', text: undefined, expectLast: 'a' }])
check('🔴 `text` 是 undefined → 拦（**这就是 09-16 写空值的机理**）', undef.length === 1 && undef[0].includes('空值'))

const empty = auditOps([{ op: 'insertAfter', file: 'x.md', line: 3, text: '', expect: 'a' }])
check('`text` 是空串 → 拦（"会把那一行清掉"）', empty.length === 1 && empty[0].includes('清掉'))

const whitespace = auditOps([{ op: 'replace', file: 'x.md', line: 3, text: '   ', expect: 'a' }])
check('`text` 只有空白 → 也拦（空白＝等于清掉那一行）', whitespace.length === 1)

const sticky = auditOps([{ op: 'replace', file: 'x.md', line: 3, text: '甲\n乙', expect: 'a' }])
check('🔴 单行 op 的 `text` 夹换行 → 拦（**粘行 / 破表**，T190 的教训）', sticky.length === 1 && sticky[0].includes('粘行'))

const noExpect = auditOps([{ op: 'replace', file: 'x.md', line: 3, text: '甲' }])
check('`replace` 缺 `expect` → 拦（那就是**闭眼写**）', noExpect.length === 1 && noExpect[0].includes('闭眼写'))

const noExpectInsert = auditOps([{ op: 'insertAfter', file: 'x.md', line: 3, text: '甲' }])
check('`insertAfter` 缺 `expect` → 也拦', noExpectInsert.length === 1)

check('一次报多条（不漏报）', auditOps([
  { op: 'replace', file: 'x.md', line: 1, text: undefined, expect: 'a' },
  { op: 'insertAfter', file: 'x.md', line: 2, text: '', expect: 'b' },
]).length === 2)

// ============================================================
// 二、好 op 一条都不许报（防"闸太紧把自己锁死"）
// ============================================================
const good = [
  { op: 'append', file: 'T.md', text: '| ⭐ | **T3** | 2026-09-17 01:30 | 甲 |', expectLast: '| ○ | **T2** | … |' },
  { op: 'blankAfter', file: 'E.md', line: 5, expect: '' },
  { op: 'insertAfter', file: 'E.md', line: 7, text: '  2. 乙', expect: '- **做了什么**：' },
  { op: 'replace', file: 'E.md', line: 9, text: '- **状态**：✅ 完成', expect: '- **状态**：🔄 进行中' },
]
check('正常 op（append / blankAfter / insertAfter / replace）→ 一条都不报', auditOps(good).length === 0)
check('`blankAfter` 不需要 `text`（别把它当缺字段）', auditOps([good[1]]).length === 0)

// ============================================================
// 三、🔴 不许误伤真提案：真样本跑一遍，闸必须是空的
// ============================================================
const T = [
  '| 等级 | 编号 | 时间 | 发生了什么 |',
  '|---|---|---|---|',
  '| ○ | **T1** | 2026-09-16 10:00 | 甲 |',
  '',
].join('\n')
const E = [
  '| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |',
  '|---|---|---|---|---|',
  '| E1 | **甲事** | 2026-09-16 | 🔄 进行中 | T1 |',
  '',
  '### E1｜甲事',
  '- **时间跨度**：2026-09-16 ~',
  '- **锚点**：T1',
  '- **模型**：`deepseek-flash`',
  '- **做了什么**：',
  '  1. 先记一条',
  '- **结果**：还没有',
  '- **状态**：🔄 进行中',
  '- **指引**：—',
  '',
].join('\n')

const root = makeArchive('opaudit', {
  '01-时间轴-我们做过什么.md': T,
  '01-事件表-我们做过什么.md': E,
  // 🔴 2026-10-15：L2 已删 ⇒ 落档的落点在 L3 ⇒ 夹具里得有它，否则算出来是空梭。
  'L3-知识\\记录-测试用.md': '# 记录 · 测试用\n\n> 🏷 **这份是什么**：夹具。\n> 🕐 **什么时候用**：测试。\n> ✍️ **谁写它**：测试。\n',
})
const mod = await loadPlugin()
mod.apply(mockCtx(), { archiveDir: root })

// 🔴 2026-10-15：**必须给 `detailIn`** —— L2 已删后，落档的唯一落点就是"给那份 L3 写时间标记"，
//    不给它 ⇒ 空梭 ⇒ 下面那条"ops 非空"就没意义了（这也是它当时红的原因）。
const plan = planCommit({
  what: '做了一件事',
  level: '⭐',
  did: '把这件事记下来',
  detailIn: '记录-测试用.md',
  when: '2026-09-17 01:30',
})
check('真实提案的 ops 非空（否则下面那条断言没意义）', plan.ops.length > 0)
check('🔴 **真提案一条都不被闸碰掉**（闸太紧会把自己锁死）', auditOps(plan.ops).length === 0)
check('真提案每条都带 expect / expectLast（防撞能力没丢）', plan.ops.every((o) => (o.op === 'append' ? typeof o.expectLast === 'string' : o.op === 'blankAfter' ? true : typeof o.expect === 'string')))

done()
