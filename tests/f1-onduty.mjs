/**
 * F1 · 在岗标记 ＋ 钩子转交（2026-09-30 重写）。跑法：node tests/f1-onduty.mjs
 * 全程 mock ctx，不依赖 DSH / 模型 / 网络。
 *
 * 起因：2026-09-29 用户拍板「**砍 1、改名 a**」—— 把「压缩后重注入」整条砍掉。
 *   机制没了，原来 15 条钉着它的断言随之作废；这一份改成钉**现在还成立的形态**：
 *     ① **在岗标记**：每轮一句话，短、点名、不含档案正文（入口由宿主自己灌）
 *     ② **两个钩子的转交**仍挂着（`session/event` 记用户原话与压缩；`agent/pre-step` 出标记/留意栏）
 *     ③ **保住的那条能力**：「压缩成功落地 → 清留意栏节流」（挂在 `throttleResetFor` 上）
 *     ④ **旧机制那半砍干净了**：模块不再导出它（这是"砍完"的证据，不是"我以为砍了"）
 */
import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f1', {
  '从这开始读.txt': [
    'DeepSeek 档案 —— 从这开始读',
    '【给接手的 AI】',
    'L1-必读 ......... 先读这一层（6 份）',
    'L2-数据 ..... 01-时间轴 / 01-事件表',
    '「未使用」不等于「缺」。',
    '',
  ].join('\n'),
  'L1-必读/铁律.md': [
    '# 必读铁律',
    '1. 绝不硬编码盘符。',
    '2. 删之前必须有据。',
    '3. 凡批量、凡写脚本，先在样本上试跑。',
    '',
  ].join('\n'),
  'L3-知识/某记录.md': ['- 这条口径**已作废**，别再用。', ''].join('\n'),
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root, entryFile: '从这开始读.txt', tieDir: 'L1-必读', tieNameHint: '铁律' })

const I = mod.__internals
const S = I.CAP_STATS
const compact = ctx.handlers['session/event']
const preStep = ctx.handlers['agent/pre-step']

const userMsg = { role: 'user', id: 'u1', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }
const enter = (msgs = [userMsg]) => ({ kind: 'enter', messages: msgs })
const agentOf = (id, header = {}) => ({ agent: { session: { id, header } }, messages: [], signal: {} })
const textOf = (m) => String(m?.content?.[0]?.text ?? '')

console.log('注册的钩子: ' + Object.keys(ctx.handlers).join(', '))
console.log('')

// --- ① 旧机制砍干净了 -------------------------------------------------------
check('`buildReinjection` 已从模块里删掉', I.buildReinjection === undefined)
check('`lastBudgetInfo` 也删了（注入预算随它一起没）', I.lastBudgetInfo === undefined)
check(
  '`pendingReinject` / `loadPending` / `writePending` / `persistedPendingHit` 一并删了',
  I.pendingReinject === undefined && I.loadPending === undefined && I.writePending === undefined && I.persistedPendingHit === undefined,
)

// --- ② 在岗标记：短、点名、不含档案正文 -------------------------------------
const buildOnDuty = I.buildOnDuty ?? (await import('../lib/f1-onduty.js')).buildOnDuty
check('buildOnDuty 拿得到（直接导出，或在 __internals 里）', typeof buildOnDuty === 'function')
const mark = String(buildOnDuty?.() ?? '')
check('在岗标记非空', mark.length > 0)
check('含「梅莫莉亚在岗」', mark.includes('梅莫莉亚在岗'))
const firstLine = mark.split('\n')[0]
// 🔴 2026-10-22：上限 60 → 120 —— 这一行**加了"档案根在哪"**（用户实测：新会话不知道档案在哪，
//    得 glob 全盘找一遍 ⇒「**不行这样太慢了**」）。一行 ~90 字符换掉一次全盘搜索，**值**；
//    但也不能再长（它每次重启都进上下文）。
check(`那一行很短（${firstLine.length} 字符，< 120）`, firstLine.length > 0 && firstLine.length < 120)
check('★ 这一行带上了**档案根路径**（新会话不用再全盘找）', /档案根[：:]\s*[A-Za-z]:\\/.test(firstLine))
check('不含档案入口正文（入口由宿主 AGENTS.md 灌，不重复灌）', !mark.includes('L1-必读 .........'))

// --- ③ pre-step：真用户消息 → 注入在岗标记（插在它之前） ---------------------
const out = await preStep(agentOf('S1'), async () => enter())
check('新会话首轮 → 注入（消息数 1 → 2）', out.messages.length === 2)
check('注入条 source.kind=dsh-memoria', out.messages[0]?.source?.kind === 'dsh-memoria')
check('注入条 plugin=dsh-memoria', out.messages[0]?.source?.plugin === 'dsh-memoria')
check('注入的**就是**在岗标记', textOf(out.messages[0]).includes('梅莫莉亚在岗'))
check('🔴 不再有「压缩后重注入」那种整篇灌入', !textOf(out.messages[0]).includes('压缩后重注入'))
check('用户那条没被改写、被挤到第 2 位', out.messages[1] === userMsg)

const out2 = await preStep(agentOf('S1'), async () => enter())
check('同一会话第二次不再重复注入', out2.messages.length === 1)

// 没有真实用户消息 → 不注入、原样返回（不许凭空起一个回合）
const pluginOnly = { role: 'user', source: { kind: 'plugin' }, content: [] }
const out3 = await preStep(agentOf('S2'), async () => enter([pluginOnly]))
check('只有 plugin 消息（压缩后的摘要）→ 不注入、原样返回', out3.messages.length === 1 && out3.messages[0] === pluginOnly)

// 非 enter / 子代理 → 一律不注入
const out4 = await preStep(agentOf('S3'), async () => ({ kind: 'skip', messages: [userMsg] }))
check('decision.kind 非 enter → 不注入', out4.messages.length === 1)
const out5 = await preStep(agentOf('S4', { origin: 'subagent' }), async () => enter())
check('子代理 → 不注入', out5.messages.length === 1)

// --- ④ 保住的那条能力：压缩成功落地 → 清留意栏节流 ---------------------------
compact({ id: 'S5' }, { type: 'compaction/end', data: {} })
check('压缩成功落地 → F1 记一笔「压缩后清留意栏节流」', String(S.get('F1')?.note ?? '').includes('压缩后清留意栏节流'))
const noteAfterOk = String(S.get('F1')?.note ?? '')
compact({ id: 'S6' }, { type: 'compaction/end', data: { error: 'boom' } })
check('压缩带 error → 那一笔不动（没成功落地，没什么可清的）', String(S.get('F1')?.note ?? '') === noteAfterOk)

done()
