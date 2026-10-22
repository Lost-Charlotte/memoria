/**
 * 骨架（销账派生物）：把留底从 **358K 压到 21K** 的那条规则。
 *
 * 钉的是 2026-09-19 凌晨用户点出的老大难
 *   ——"每次新会话，老会话的归档问题就是个老大难，总不能每次都读那么大的上下文"——
 * 与实测踩出来的两个坑：
 *   ① 留底里 **84.5% 是我的思考链**（`reasoning` 块），销账一个字都不需要它；
 *   ② 不滤 `<system-reminder>` 那类 XML 注入 → **一条 6.7K 的 AGENTS.md 全文混进"用户真事"**
 *      （第一版骨架把"用户真事"虚报成 9 条 /10,096 字符，滤掉后才是真的 4 条 /4,062）。
 *
 * 两条**反向**断言（照仓库纪律 1）：
 *   · **机器注入必须一个字都不进**（否则"用户真事"这个数就成了假账）；
 *   · **已存在就拒绝覆盖**（骨架是派生物，宁可报错也不许静默改写）。
 */
import { existsSync } from 'node:fs'

import { check, done, sandboxHome } from './harness.mjs'

const HOME = sandboxHome() // 必须在 import 插件之前：SKELETON_DIR 在模块加载时算

const { SKELETON_DIR, renderSkeleton, skeletonFileName, writeSkeleton } = await import('../lib/skeleton.js')

console.log('')

const evs = [
  { type: 'user/message', time: 1789000000000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '用户真事第一句' }] } },
  { type: 'user/message', time: 1789000001000, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '〔梅莫莉亚在岗〕入口注入' }] } },
  {
    type: 'user/message',
    time: 1789000002000,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: `<system-reminder>\nInstructions from: ~/.dsh/AGENTS.md\n${'x'.repeat(500)}` }] },
  },
  {
    type: 'assistant/message',
    time: 1789000003000,
    data: {
      content: [
        { type: 'reasoning', text: '内心独白第一段：先看状态。我应该…' },
        { type: 'reasoning', text: '内心独白第二段' },
        { type: 'text', text: '结论在前。\n\n要不要我做 X？' },
      ],
    },
  },
  { type: 'tool/result', time: 1789000004000, data: { name: 'bash', content: [{ type: 'text', text: '工具输出一大堆' }] } },
]

const { skeleton, stats } = renderSkeleton(evs, { shortSid: 'test1234', source: 'C:\\fake\\session.v3.jsonl.zstd' })

check('真人用户消息逐字进骨架', skeleton.includes('用户真事第一句'))
check('插件注入不进骨架', !skeleton.includes('梅莫莉亚在岗'))
// ⚠️ 占位行**故意**留了注入的前 40 字符（便于追溯"丢的是哪一条"），
//    所以这里不能拿 `Instructions from` 当判据 —— 要盯**注入正文**（那 500 个 x）在不在。
check('system-reminder 注入的正文不进骨架', !skeleton.includes('x'.repeat(50)))
check('XML 注入**不静默**：原位留了"已省略机器注入"占位', skeleton.includes('已省略机器注入'))
check('我的正式答复逐字进骨架（末尾的建议也在）', skeleton.includes('要不要我做 X？'))
check('我的思考链一个字都不进骨架', !skeleton.includes('内心独白'))
check('工具结果不进骨架', !skeleton.includes('工具输出一大堆'))
check('骨架头写明来源与销账办法', skeleton.includes('归账完成') && skeleton.includes('session.v3.jsonl.zstd'))
check('统计：用户真事 1 条', stats.userMsgs === 1)
check('统计：我的正式答复 1 块', stats.textBlocks === 1)
check('统计：思考链 2 块全记账', stats.reasoningBlocks === 2)
check('统计：丢掉的总量 ≥ 思考链（思考链是大头）', stats.dropped >= stats.reasoningChars)

const r1 = writeSkeleton('session-abc12345-xxxx', evs, 'C:\\fake\\log.zstd')
check('writeSkeleton 落在沙箱 skeleton 目录（不碰真实 ~/.dsh）', r1.ok === true && r1.out.startsWith(SKELETON_DIR))
check('骨架文件真的写到盘上', r1.ok === true && existsSync(r1.out))
check('🔴 命名按来源分开：压缩路是「骨架-压缩-<短id>.md」', r1.out.endsWith('骨架-压缩-abc12345.md'))
const r2 = writeSkeleton('session-abc12345-xxxx', evs, 'C:\\fake\\log.zstd')
check('已存在就**拒绝覆盖**（不静默改写）', r2.ok === false && String(r2.why).includes('已存在'))
check('🔴 归档路另起一个名（**同一会话先压缩后归档也不撞名**）', skeletonFileName('session-abc12345-xxxx', 'archive') === '骨架-归档-abc12345.md')

// ⚠️ 压缩路的唯一例外：留底主份本身就是覆盖写的，骨架必须**跟着覆盖**
//    （否则会出现"主份是新的、骨架还是旧的"那种对不上账的形态）
const r3 = writeSkeleton('session-abc12345-xxxx', evs, 'C:\\fake\\log.zstd', { kind: 'compact', overwrite: true })
check('压缩路可显式覆盖（与主份同语义），并标记 overwritten', r3.ok === true && r3.overwritten === true)

const empty = renderSkeleton([], {})
check('空事件不报错，骨架头照样出得来', empty.skeleton.includes('骨架（销账用）') && empty.stats.userMsgs === 0)
check('沙箱 HOME 被用上了（没落到真实 home）', SKELETON_DIR.startsWith(HOME))

done()
