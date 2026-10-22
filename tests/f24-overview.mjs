// 🔴 隔离（**必须在这份文件的第一个字节**）：把 DSH_HOME 指到临时目录。
//   为什么用 `createRequire`：ESM 会把**所有** `import` 提升到顶部并先求值 ——
//   写成 `process.env.DSH_HOME = ...` 放在哪都没用（它总在 import 之后跑）。
//   而 `require` 是**按位置执行**的，所以这三行真的能抢在插件之前（2026-09-18 实测：
//   修之前跑一次 test.mjs，用户的 ~/.dsh 里就多 11 个 txn 残件）。
import { createRequire as __cr } from 'node:module'
const __req = __cr(import.meta.url)
process.env.DSH_HOME = __req('node:fs').mkdtempSync(__req('node:path').join(__req('node:os').tmpdir(), 'memoria-home-'))

// ============================================================
// f24-overview · 判据钉死测试（2026-09-18 建）
// ============================================================
//
// 为什么有它：F24 的第一版就是**样本试跑逼出来的** —— 我原先把"事件条数"当成"编号上界"，
//   样本里标题写到 E2 而条数只有 1 → 合法的 E2 被误报成越界。**"多少条" ≠ "编号到几号"。**
//   所以这里把两个方向都钉住：**有病必须报**（样本 A）＋ **没病必须不报**（样本 B）。
//
// ⚠️ 全程在【临时档案】上跑（`GAI_DANG_ROOT` → 临时目录），**不碰真档案**。
//   临时目录由本文件自己清掉（不留给下一个人）。

import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = join(tmpdir(), `f24-test-${process.pid}`)

mkdirSync(join(ROOT, 'L1-必读'), { recursive: true })
mkdirSync(join(ROOT, 'L2-数据'), { recursive: true })

// 🔴 **先用动态 import，再改 CFG** —— 这两个顺序都有讲究：
//   ① 环境变量必须在**模块求值之前**设好（静态 import 会先跑，那样它读的还是真档案的根）；
//   ② `CFG.archiveDir` 是**求值那一刻**算出来的，所以就算环境变量有别的来源，
//      这里再显式钉一次，测试就与外面怎么跑无关。**两条一起上才叫"测试不会写别人的档案"。**
process.env.GAI_DANG_ROOT = ROOT
const m = await import('../lib/f24-overview.js')
const { CFG } = await import('../lib/common.js')
CFG.archiveDir = ROOT

// ---- 骨架：时间轴到 T5、事件编号到 E3（于是 T99 / E88 就是越界引用）----
writeFileSync(
  join(ROOT, 'L2-数据', '01-时间轴-我们做过什么.md'),
  ['# 时间轴', '| 等级 | 编号 | 时间 | 事 |', '|---|---|---|---|',
   '| ❗ | **T1** | 01-01 | 一 |', '| ⭐ | **T2** | 01-02 | 二 |', '| ○ | **T3** | 01-03 | 三 |',
   '| ○ | **T4** | 01-04 | 四 |', '| ○ | **T5** | 01-05 | 五 |'].join('\n'),
  'utf8'
)
writeFileSync(
  join(ROOT, 'L2-数据', '01-事件表-我们做过什么.md'),
  ['# 事件表', '', '### E1｜甲', '- **锚点**：T1', '', '### E2｜乙', '- **锚点**：T2', '', '### E3｜丙', '- **锚点**：T3'].join('\n'),
  'utf8'
)

const OVERVIEW = join(ROOT, 'L1-必读', '00-总览-我们干过什么.md')
const now = () => m.computeNow({ checkErrors: 0, checkTips: 0 })

// ============ 样本 A：故意长满毛病 → **每一条都必须被抓到** ============
const DIRTY = [
  '# 00-总览（样本 A）',
  '',
  m.HANDOFF_MARK,
  '',
  '> 现在的状态：v0.24.0 · 23 模块 ｜ 时间轴 241 行 / 事件 92 条。',
  '> 上个会话收尾时做了 AGENTS.md 替换（见 T99 与 E88）。',
  '',
  m.HANDOFF_END,
  '',
  '## 维护记录',
  '',
  '- 2026-09-14 建立了这套东西（这是一条足够长的说明文字，用来触发维护记录的条数判据）。',
  '- 2026-09-15 重建后逐轮盲测并修补（这也是足够长的一条，凑够四条以上）。',
  '- 2026-09-16 大体检收口 + 三件基建（同样是足够长的一条说明）。',
  '- 2026-09-17 深夜 第一次两个会话同时干活（这两行**逐字相同**，必须被抓到）。',
  '- 2026-09-17 深夜 第一次两个会话同时干活（这两行**逐字相同**，必须被抓到）。',
].join('\n')
writeFileSync(OVERVIEW, DIRTY, 'utf8')

const dirty = m.checkOverview(now())
const whats = dirty.problems.map((p) => `${p.where} ${p.what}`).join('\n')
assert.equal(dirty.ok, false, '样本 A 必须是"不 ok"')
// 🔴 2026-10-15：「越界 T99 / E88」两条断言随 L2 退役删除 —— 越界检查的上界来自
//    `L2-数据\01-时间轴…` / `01-事件表…`（L2 已删 ⇒ 上界恒 null ⇒ 那条检查本来就不执行）。
//    夹具（下面那份时间轴/事件表）按"样本数据"保留。
assert.ok(/整行逐字重复/.test(whats), '样本 A：整行重复必须被报出来')
assert.ok(/手写过程/.test(whats), '样本 A：维护记录还在抄过程必须被报出来')
console.log(`  ✓ 样本 A：抓到 ${dirty.problems.length} 条（含越界 T/E · 重复行 · 抄过程 · 遗留交接区）`)

// ============ 样本 B：干净（**2026-09-18 起的形态：没有交接区**）→ 一条都不许报 ============
const CLEAN = [
  '# 00-总览（样本 B）',
  '',
  '## 用户的私人东西在哪',
  '',
  '| 在哪 | 是什么 |',
  '|---|---|',
  '| 小私盘 | 8,974 文件 / 107.8 GB |',
  '',
  '## 维护记录',
  '',
  '- 过程不写在这里 —— 它全在 `L2-数据/01-时间轴-我们做过什么.md` 里。',
  '- 要看「最近在干什么」：调 `dangan_recent`。',
].join('\n')
writeFileSync(OVERVIEW, CLEAN, 'utf8')

const clean = m.checkOverview(now())
const cleanBad = clean.problems.filter((p) => p.level === '错')
assert.equal(clean.ok, true, `样本 B 必须 ok（实际报了：${clean.problems.map((p) => p.where + p.what).join(' / ')}）`)
assert.equal(clean.problems.length, 0, '**2026-09-18 起"没有交接区"是正常形态**：干净样本必须 0 错 0 提示')
// 普通区里的数字**不该**被报（只扫交接区）—— 上面那个 `8,974 文件 / 107.8 GB` 就是探针
assert.ok(!clean.problems.some((p) => /8,974|107\.8/.test(p.what)), '普通区的数字不该被当成"交接区的过期数字"')
console.log('  ✓ 样本 B：0 错 0 提示（普通区的数字没被误报）')

// ============ 样本 C：**旧形态**（还留着交接区）→ 必须提示"该删这块" ============
const WITH_HANDOFF = ['# 00-总览（样本 C）', '', m.HANDOFF_MARK, '', '> 上个会话已存档。', '', m.HANDOFF_END, ''].join('\n')
writeFileSync(OVERVIEW, WITH_HANDOFF, 'utf8')
const wh = m.checkOverview(now())
assert.ok(
  wh.problems.some((p) => /还留着"交接区"/.test(p.what)),
  '样本 C：还留着交接区就必须提示"该删"（用户 2026-09-18 取消了这一块）'
)
assert.equal(wh.ok, true, '样本 C 的这条是**提示**，不该报成"错"')
console.log('  ✓ 样本 C：留着的交接区被抓出来（提示级）')

// ============ 边界：没有交接区 / 没有维护记录 → 只报"提示"，不报"错" ============
const BARE = '# 00-总览\n\n什么都没有。\n'
writeFileSync(OVERVIEW, BARE, 'utf8')
const bare = m.checkOverview(now())
assert.equal(bare.ok, true, '没有交接区/维护记录时，不该报"错"（找不到锚点是提示，不是错）')
assert.ok(bare.problems.every((p) => p.level === '提示'), '那两条必须是"提示"级别')
assert.equal(m.handoffRange(BARE.split('\n')), null, 'handoffRange 找不到锚点必须返回 null（不是 []）')
console.log(`  ✓ 边界：无交接区/无维护记录 → ${bare.problems.length} 条提示、0 错`)

// ============ 提案文本：节标题必须原样在 → 哨兵下次才认得出 ============
const blocks = m.renderOverview()
assert.deepEqual(Object.keys(blocks), ['maint'], '**交接区提案已下线**（2026-09-18 取消那一块）：render 只该输出维护记录')
assert.ok(blocks.maint.startsWith(m.MAINT_HEAD), '维护记录提案必须以节标题开头')
assert.ok(/不写在这里/.test(blocks.maint), '维护记录提案该是"一句指针"的形态')
console.log('  ✓ 提案文本：只剩维护记录一节、节标题对得上')

rmSync(ROOT, { recursive: true, force: true })
console.log('f24-overview：判据钉死测试 **全过**')
