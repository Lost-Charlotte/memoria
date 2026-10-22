// 🔴 隔离（**必须在这份文件的第一个字节**）：把 DSH_HOME 指到临时目录。
//   为什么用 `createRequire`：ESM 会把**所有** `import` 提升到顶部并先求值 ——
//   写成 `process.env.DSH_HOME = ...` 放在哪都没用（它总在 import 之后跑）。
//   而 `require` 是**按位置执行**的，所以这三行真的能抢在插件之前（2026-09-18 实测：
//   修之前跑一次 test.mjs，用户的 ~/.dsh 里就多 11 个 txn 残件）。
import { createRequire as __cr } from 'node:module'
const __req = __cr(import.meta.url)
process.env.DSH_HOME = __req('node:fs').mkdtempSync(__req('node:path').join(__req('node:os').tmpdir(), 'memoria-home-'))

// ============================================================
// 待办分区判据 · 钉死测试（2026-09-18 建）
// ============================================================
//
// **为什么有它**：这一轮把待办从"按时间堆的 §四之N"改成"按性质分的八节"，
//   用的是标题末尾的**语义标记**（`[在办]` / `[拍板]` / `[等条件]` / `[归档]`…）。
//   改判据的过程里**连撞三个坑，每个都是真档案上报出来的**：
//     ① `openItems` 把 §二「等条件」算成待办 —— 因为兼容旧结构的 `/四之/` 太宽，
//        命中了 §二 标题说明文字里那个"四"字（"用户不提**四**…"）→ **关键词得在它该在的位置上**；
//     ② §三 的**表头第一格是 `#`**（`| # | 事项 | … |`），判据只认"第一格是事项/事情/待办" → **整节被漏掉**；
//     ③ `isTodoTable` **跨章节不清空** → 前一节有表头、后一节只有一张没表头的表时，后者被误当待办表。
//   三条都已经在真档案上验过修好，这里把**判据**钉住，免得下次重排又踩。
//
// ⚠️ 全程在【临时档案】上跑（`GAI_DANG_ROOT` → 临时目录），**不碰真档案**。

import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(tmpdir(), `f10-sections-${process.pid}`)
mkdirSync(join(ROOT, 'L3-知识'), { recursive: true })
process.env.GAI_DANG_ROOT = ROOT

const f10 = await import('../lib/f10-todo.js')
const { CFG } = await import('../lib/common.js')
CFG.archiveDir = ROOT

const TODO = join(ROOT, 'L3-知识', '工程-待办.md')
const write = (s) => writeFileSync(TODO, s, 'utf8')

// ---------- 样本：**新结构**（八节 · 语义标记），并把三个坑都埋进去 ----------
const SAMPLE = [
  '# 待办：未完成事项',
  '',
  '## 一、不许再问（用户已拍板）[已决]',
  '',
  '| # | 事项 | 用户决定 | 落地动作 |',
  '|---|---|---|---|',
  '| 1 | **甲** | 不动 | 原样保留 |',
  '',
  '## 二、等条件 / 搁置（**条件到了才办；用户不提起我不催**）[等条件]',
  '',
  '| 事项 | 等什么条件 | 条件到了怎么做 |',
  '|---|---|---|',
  '| **等插盘** | 插上私盘 | 搬过去 |',
  '',
  '## 三、短期 · 等你点头（**方案已给、成本已知**）[在办]',
  '',
  '| 事项 | 具体做法 | 成本 / 风险 |',
  '|---|---|---|',
  '| **1 乙** | 改一行 | 无风险 |',
  '',
  '### 三之一、明细小表（**表头不是待办**）',
  '',
  '| 项目 | 大小 | 备注 |',
  '|---|---|---|',
  '| `E:\\某某` | 117 GB | 注意这个 |',
  '',
  '## 四、短期 · 我能自己推（**不用拍板**）[在办]',
  '',
  '| 事项 | 现在卡在哪 | 怎么算结 |',
  '|---|---|---|',
  '| **丙** | 卡在丙 | 丙做完 |',
  '',
  '## 五、需要你拍板（**我问一次**）[拍板]',
  '',
  '| 事项 | 现在卡在哪 | 怎么算结 |',
  '|---|---|---|',
  '| **丁** | 等一句话 | 你点头 |',
  '',
  '## 六、我的错误（**动手前扫一眼**）[自查]',
  '',
  '| 我犯过的 | 经过 | 往后怎么做 |',
  '|---|---|---|',
  '| 误用 | 经过 | 别再犯 |',
  '',
  '## 八、已归档（**不要重做**）[归档]',
  '',
  '| 事情 | 结论 | 归档处 |',
  '|---|---|---|',
  '| 旧事 | 早结了 | 某处 |',
  '',
].join('\n')

write(SAMPLE)
const { sections } = f10.parseTodo()
const { items: open } = f10.openItems() // ⚠️ 返回的是 `{ file, items }`，不是数组
const names = open.map((r) => r.item.replace(/\*/g, ''))

// ① "在办 / 拍板"要认出来
assert.equal(sections.find((s) => /三、/.test(s.title))?.actionable, true, '带 [在办] 的 §三 该是"在办"')
assert.equal(sections.find((s) => /四、/.test(s.title))?.actionable, true, '带 [在办] 的 §四 该是"在办"')
assert.equal(sections.find((s) => /五、/.test(s.title))?.actionable, true, '带 [拍板] 的 §五 该是"在办"')
// ② 不 action 的别混进来
assert.equal(sections.find((s) => /一、/.test(s.title))?.actionable, false, '带 [已决] 的 §一 不该是"在办"')
assert.equal(sections.find((s) => /六、/.test(s.title))?.actionable, false, '带 [自查] 的 §六 不该是"在办"')
assert.equal(sections.find((s) => /八、/.test(s.title))?.actionable, false, '带 [归档] 的 §八 不该是"在办"')
console.log('  ✓ 标记判据：在办/拍板 认得出，已决/自查/归档 不混入')

// ③ **坑一**：§二「等条件」的标题里含"四"字，绝不能被算成在办（旧判据 `/四之/` 正是这么栽的）
const sec2 = sections.find((s) => /二、/.test(s.title))
assert.equal(sec2?.actionable, false, '**§二「等条件」不算在办** —— 标题里那个"四"字不许把整节拉进来')
assert.ok(!names.includes('等插盘'), '§二 那张表不该被当成待办')
console.log('  ✓ 坑一：§二「等条件」不误报（标题里的"四"字不再命中）')

// ④ **坑二**：表头第一格是 `#` 序号列的旧写法**已被淘汰**（2026-09-18 起见 `tests/../L3-知识/待办` 统一成"第一格就是事项"）
//   —— 这条测试盯着"别为了迁就序号列又把判据搞复杂"：**文件让步于判据，而不是反过来。**
assert.ok(names.includes('1 乙'), '事项在第一格的表要认得出')
console.log('  ✓ 表头统一成"第一格＝事项"（序号并进事项里）')

// ⑤ **坑三**：没有表头的表（`### 三之一` 的明细表）不该被当成待办
assert.ok(!names.includes('`E:\\某某`') && !names.includes('E:\\某某'), '没有待办表头的明细表不该被收进来')
assert.equal(sections.find((s) => /三之一/.test(s.title))?.rows.length, 0, '明细表的行数该是 0（它不是待办表）')
console.log('  ✓ 坑三：没表头的明细表不被误收')

// ⑥ 该开着的一个不少
assert.deepEqual(names.sort(), ['1 乙', '丙', '丁'].sort(), `还开着的该是 1 乙/丙/丁，实际：${names.join(',')}`)
assert.equal(open.length, 3, '还开着 3 条')
console.log('  ✓ openItems：乙 / 丙 / 丁 三条，一条不多一条不少')

// ============ 没有语义标记的表**不算待办**（2026-09-18 的口径：只认标记，不认序号） ============
//   ⚠️ 历史教训：原先还留了个"兼容旧结构"的分支（`/^(二|三)、/`）——
//   它救不了旧文件，却**专门误伤新结构的 §二「等条件」**（标题也以"二、"打头）。
//   已在真档案上验过并删掉；这条测试盯着"它别偷偷回来"。
const NOMARK = [
  '# 待办',
  '',
  '## 二、等用户点头就能做的',
  '',
  '| 事项 | 卡在哪 | 怎么算结 |',
  '|---|---|---|',
  '| **没标记的甲** | 等一句话 | 做了就结 |',
  '',
].join('\n')
write(NOMARK)
const noMark = f10.openItems().items.map((r) => r.item.replace(/\*/g, ''))
assert.ok(!noMark.includes('没标记的甲'), '**没有 `[在办]`/`[拍板]` 标记的表不该被当成待办**（只认标记，不认序号）')
console.log('  ✓ 无标记不算待办（旧结构兼容分支确已删除）')

// ============ 归档区：`[归档]` 标记要能被 clean 找到 ============
write(SAMPLE)
const plan = f10.todoPlanClean()
assert.ok(plan.archiveLine != null, '`[归档]` 标记的归档区要能被找到（clean 靠它追加）')
assert.ok(/八、/.test(plan.archiveSection ?? ''), `归档区该是 §八，实际：${plan.archiveSection}`)
console.log('  ✓ 归档区：`[归档]` 标记找得到（clean 有地方追加）')

rmSync(ROOT, { recursive: true, force: true })
console.log('待办分区判据：钉死测试 **全过**')
