/**
 * F2 作废哨兵的降噪规则。跑法：node tests/f2-void.mjs
 *
 * 这里钉住的是**真实踩过的坑**（每一条都对应一次误报或误伤），代码改动时不许退化：
 *   1. 系统自身的说明书 / 读我 → 整份跳过（它提到"作废"是在讲这个机制）
 *   2. 被引号/反引号裹着的作废词 → 跳过（在谈论这个词，不是在用它）
 *   3. ⚠️ 但 `"用完要删"**已作废**` 这种**必须保留** —— 引号在后面，不是在谈论它
 */
import { check, done, loadPlugin, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f2', {
  '从这开始读.txt': '入口\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  'L1-必读/日志系统-使用说明.md': [
    '- 状态：✅完成 / 🔄进行中 / ⏸搁置 / 🗑 已作废',
    '- **`🗑 已作废` 与 `🔚已结案` 不是一回事**',
    '5. **逐条核查有没有"已作废"**',
    '',
  ].join('\n'),
  'L3-知识/真例.md': [
    '- 这条口径**已作废**，别再用。',
    '- 早先说过的"用完要删"**已作废** —— 这条必须被保留（引号在后面）',
    '',
  ].join('\n'),
  'L3-知识/在谈论它.md': [
    '- 引用里写着"已作废"这个词（这是谈论，不是口径）',
    '- 咱的落地：**L2 状态新增 `🗑 已作废`**（2026-09-16）',
    '',
  ].join('\n'),
  'L3-知识/自认.md': ['- 本条结论已作废，见别处。', ''].join('\n'),
})

const mod = await loadPlugin()
mod.apply({ on() {}, tools: { register: () => () => {} }, effect() {} }, { archiveDir: root })

const hits = mod.__internals.scanVoided(root)
const has = (needle) => hits.some((h) => h.text.includes(needle))
const inFile = (file) => hits.filter((h) => h.file.includes(file)).length

console.log(`命中 ${hits.length} 条`)
for (const h of hits) console.log(`   ${h.file}:${h.line}  ${h.text.slice(0, 70)}`)
console.log('')

check('① 整份跳过"系统自身的说明书"（日志系统-使用说明.md）', inFile('使用说明') === 0)
check('② 跳过"在谈论这个词"（引号裹着作废词）', !has('引用里写着'))
check('② 跳过"状态新增 `🗑 已作废`"这类元描述', !has('咱的落地'))
check('③ 保留真例：一般的"已作废"', has('这条口径'))
check('③ **保留** `"用完要删"**已作废**`（引号在后面 → 不是在谈论它）', has('用完要删'))
check('保留"本条结论已作废"（自指式，闸门/体检要用）', has('本条结论已作废'))

done()
