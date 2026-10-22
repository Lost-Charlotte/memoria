/**
 * F31 · 输出端的门：**宣称"已做"要有凭据**（2026-09-20 建 · 第一版只 observe）。
 * 跑法：node tests/f31-claim.mjs
 *
 * 这一份钉的就是《AI错误总账》**R23**：
 *   我在回复里写"脚本也按你说的写了（桌面 `安装梅莫莉亚.cmd`）"，
 *   **但全程没调用过任何写文件的动作** —— 用户重启完去桌面找，**找不到**。
 *
 * 🔴 **第一版绝对不拦人**（只 log ＋ capTick）—— 关键词启发式，误报一定会有。
 *    所以这里钉的不是"函数能跑"，而是**沉默的边界**：
 *    没宣称 → 沉默 · 写了东西 → 沉默 · 空文本 → 沉默；只有"说了却没写"才出声。
 */
import { check, done, sandboxHome } from './harness.mjs'

sandboxHome() // f7-gate.js 会 import common.js —— HOME_DIR / CFG 在模块加载那一刻就算好

const mod = await import('../lib/f7-gate.js')
const F30 = await import('../lib/f30-toolgate.js')
const v = mod.claimVerdict

console.log('— ① 判据本身（纯函数 claimVerdict）—')
check('宣称完成 ＋ 本回合没写 → 出声', typeof v('脚本已经写好放在桌面了', false) === 'string')
check('话术点了 R23 ＋ "没有任何写操作"', (v('已经写好', false) ?? '').includes('R23') && (v('已经写好', false) ?? '').includes('没有任何写操作'))
check('宣称完成 ＋ 本回合写了 → 沉默', v('脚本已经写好放在桌面了', true) === null)
check('没宣称 → 沉默', v('我先看了看你的档案，暂时没动。', false) === null)
check('空文本 → 沉默', v('', false) === null)
check('只有空白 → 沉默', v('   \n  ', false) === null)
check('不是字符串（undefined / null / 数）→ 沉默、不炸', v(undefined, false) === null && v(null, false) === null && v(12345, false) === null)
check('词表里的每一个都认', mod.CLAIM_WORDS.every((w) => typeof v(`这件事${w}`, false) === 'string'))
check('词表里没有太宽的词（"完成"单独一个不算）', v('我们讨论一下完成标准', false) === null)
check('说了"搞定"但没写 → 出声', typeof v('这个也搞定了', false) === 'string')

console.log('— ② 拿"本回合回复文本"的那条路（lastAssistantText，形状是实测的）—')
// 实测形状（2026-09-20 用本插件 readSessionEvents() 逐帧解压核对）：
//   {"type":"assistant/message","data":{"turn":1,"step":1,
//     "message":{"role":"assistant","content":[{"type":"text","text":"…"}],"source":…,"id":…},"usage":{…}}}
const am = (blocks) => ({ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: blocks } } })
const agentOf = (events) => ({ session: { events } })
check(
  '正文在 data.message.content[]、只取 text 块（reasoning / tool-call 不算）',
  mod.lastAssistantText(agentOf([am([{ type: 'reasoning', text: '心里想的' }, { type: 'text', text: '正式答复' }, { type: 'tool-call', text: 'x' }])])) === '正式答复',
)
check(
  '最后一条没有 text 块（只剩思考＋工具调用）→ 倒着找上一条有正文的',
  mod.lastAssistantText(
    agentOf([am([{ type: 'text', text: '上一句' }]), am([{ type: 'reasoning', text: '想' }, { type: 'tool-call', text: 'y' }])]),
  ) === '上一句',
)
check('一条 assistant/message 都没有 → 空（沉默）', mod.lastAssistantText(agentOf([])) === '')
check('拿不到 events（不是数组 / 没有 agent）→ 空、不炸', mod.lastAssistantText(undefined) === '' && mod.lastAssistantText({}) === '')
// 兜底那层：有的形状正文直接在 data.content（skeleton.js 的 blocksOf 两种都认）
check(
  '兜底：正文写在 data.content 上也认',
  mod.lastAssistantText(agentOf([{ type: 'assistant/message', data: { content: [{ type: 'text', text: '兜底正文' }] } }])) === '兜底正文',
)

console.log('— ③ 拿"本回合有没有写动作"的那条路（f30 的 noteToolCall 记账）—')
F30.resetToolCalls()
check('没调过任何工具 → 不算写', F30.wroteThisTurn() === false)
F30.noteToolCall('read')
F30.noteToolCall('grep')
check('只读工具 → 不算写', F30.wroteThisTurn() === false)
F30.resetToolCalls()
F30.noteToolCall('write')
check('调过 write → 算写', F30.wroteThisTurn() === true)
F30.resetToolCalls()
F30.noteToolCall('dangan_log')
check('调过 dangan_log → 也算写', F30.wroteThisTurn() === true)
F30.resetToolCalls()
F30.noteToolCall('mcp__dsh__dangan_log')
check('带前缀的工具名也认（endsWith）', F30.wroteThisTurn() === true)
F30.resetToolCalls()
check('reset 之后回到"没写"', F30.wroteThisTurn() === false)

console.log('— ④ 两条路合起来：这正对照 R23 那一次 —')
// 🔴 **2026-09-23：这条边界补上了** —— R23 的**原话**是"脚本也按你说的**写了**（桌面 `安装梅莫莉亚.cmd`）"，
//    它一个"完成族"的词都不含，原来**当场漏掉**（档案待办里那条"词表抓不到 R23 原话"就是它）。
//    修法＝扩词表：加"**按你说的写**"这一族 ＋"写好了 / 已经写了 / 改好了 / 修好了 / 做好了 / 都写了"。
// ⚠️ 但**仍然不收光秃秃的"写了"** —— 那太宽（"文档里写了""这里写了"全会命中），误报一多哨兵就没人看了。
const r23Literal = agentOf([am([{ type: 'text', text: '脚本也按你说的写了（桌面 安装梅莫莉亚.cmd）' }])])
F30.resetToolCalls()
F30.noteToolCall('read') // 那一轮我只读了文件、**一次都没写**
check('🔴 R23 **原话**现在抓得到了（2026-09-23 扩词表）', typeof v(mod.lastAssistantText(r23Literal), F30.wroteThisTurn()) === 'string')

const r23Claim = agentOf([am([{ type: 'text', text: '脚本已经写好放在桌面了（桌面 安装梅莫莉亚.cmd）' }])])
check('同一件事、换成"已经写好" → 出声', typeof v(mod.lastAssistantText(r23Claim), F30.wroteThisTurn()) === 'string')
F30.resetToolCalls()
F30.noteToolCall('write')
check('同样的回复、但真写了 → 沉默', v(mod.lastAssistantText(r23Claim), F30.wroteThisTurn()) === null)

done()
