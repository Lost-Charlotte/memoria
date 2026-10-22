/**
 * F30 · 动手前门卫（2026-09-20 建）。
 * 跑法：node tests/f30-toolgate.mjs
 *
 * 这一份钉住**用户当天定的四条语义**（不是"函数能跑"）：
 *   ① **闲聊不触发** —— 不调工具时，这一关一个字都不说（它是"动手前"的门，不是"每轮都念"的哨兵）；
 *   ② **动手前必须读齐** —— 入口 ＋ 读序 ①→⑥ 没读完之前，除了"读那几份"，其余一律拒，且**告诉你缺哪几份**；
 *   ③ **只看不拦、写才拦** —— 按需必读那条：`read` 梅莫莉亚的文件不触发，`write`/`edit` 才触发；
 *   ④ **`.ps1` 只许 ASCII 是"拦"不是"检测"** —— 判据在写入前跑，文件根本不会产生
 *      （用户原话："能不能限制你在写这个的时候只能写英文。而不是靠检测"）。
 *   另加两条底线：**解析失败必须出声**（不许静默当空清单放行）、**判据出错 fail-open**（插件 bug 不许把人锁死）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { check, done, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f30', {
  '从这开始读.txt': [
    'DeepSeek 档案 —— 从这开始读',
    '',
    '  L1-必读 ......... 每次接手**先读这一层**，读序就按下面 ①→⑥：',
    '                      ① 00-总览-我们干过什么.md ... 一页',
    '                      ② 00-必读-铁律.md ......... 红线',
    '                      ③ 工具速查.md ............. 有什么工具',
    '',
  ].join('\n'),
  'L1-必读/00-总览-我们干过什么.md': '# 总览\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  'L1-必读/工具速查.md': '# 工具速查\n',
  'L3-知识/记录/记录-梅莫莉亚-施工手册.md': '# 施工手册\n',
  // 2026-09-24：B 关的"动插件前必读"从 1 份变 2 份（＋《现状总纲》）—— 样本里也得有它，
  // 否则"读完就放行"那条断言**永远过不了**（缺一份 ⇒ 一直判"没读"）。
  // ⚠️ 2026-10-09：那份《现状总纲》随 L3 重分类**改名**（`参考-` → `备查-`，住进 `知识\备查\`）
  //    —— 样本路径与下面的 `__markRead` 都要跟着走，否则"读完就放行"永远过不了。
  'L3-知识/知识/备查/备查-老馆与新馆（现状总纲）.md': '# 现状总纲\n',
  // 2026-10-20：**派活关现在「档案里没有这份文档就放行」**（fail-open，新用户骨架不带它）。
  //   ⇒ 要测"没读就拒"，样本里必须真有这份文档，否则它永远走放行那条路。
  'L4-施工/工程-派活标准.md': '# 派活标准\n',
})

// ⚠️ `CFG.archiveDir` 在模块**加载那一刻**算好 —— 所以必须在 import 之前指到样本档案。
process.env.GAI_DANG_ROOT = root

const F30 = await import('../lib/f30-toolgate.js')
// 🔴 `HOME_DIR` 也是沙箱（上面 `sandboxHome()` 设了 `DSH_HOME`）—— 所以"该拒"的那一条
//    必须用 `join(HOME_DIR, 'AGENTS.md')` 现算，**不许写死 `C:\Users\admin\.dsh\`**。
const { HOME_DIR } = await import('../lib/common.js')

// ⚠️ **假 session 的 `events` 要小心用**（2026-10-01 踩过两次）：
//    · 真实会话对象**是有** `session.events` 的（生产里 `historyReadPaths()` 靠它扫"历史读过哪几份"），
//      所以**依赖 events 的路径（如 `currentReadSeq()`）必须有 events 才测得出来**；
//    · 🔴 但**不能给所有用例都加** —— 一旦 events 里写了"读过铁律"，A 关的"已读"判据就被污染，
//      一串"还没读齐"的用例当场全挂（实测挂了 6 条）。
//    ⇒ **要 events 的用例用专门的 `rdEv` / `runEv`**，其余保持干净。
const EV = [
  { type: 'user/message', seq: 1, data: {} },
  { type: 'tool/call', seq: 22, data: { name: 'read', arguments: JSON.stringify({ file_path: 'L1-必读/00-必读-铁律.md' }) } },
  { type: 'tool/result', seq: 23, data: {} },
]
const rd = (sid, p) => ({ name: 'read', arguments: { file_path: p }, agent: { session: { id: sid } } })
const run = (sid, name, args) => ({ name, arguments: args, agent: { session: { id: sid } } })
/** 带 `events` 的变体 —— **只有"要靠 events 才测得出"的用例才用它**。 */
const rdEv = (sid, p) => ({ name: 'read', arguments: { file_path: p }, agent: { session: { id: sid, events: EV } } })

const HANDBOOK = 'L3-知识\\知识\\指南\\指南-梅莫莉亚-施工手册.md'
const MEM_FILE = 'C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\lib\\x.js'
const PS1 = 'C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\tools\\x.ps1'

console.log('— ① 必读清单从入口现算（不另立一份权威）—')
const L = F30.requiredList()
check('清单 = 入口 ＋ 读序 3 份（样本里就写了 3 行）', L.files.length === 4)
check('第一份是入口自己', L.files[0].rel === '从这开始读.txt')
check('读序解析出 3 份', L.order.length === 3)
check('解析没报错', L.error === '')
check('清单里就是那 3 个文件名', L.order.map((f) => f.name).join('|') === '00-总览-我们干过什么.md|00-必读-铁律.md|工具速查.md')

console.log('— ①·二 读序的行号不许写死（2026-09-27 现场教训）—')
// 🔴 起因：入口的读序从 ①→⑥ 扩到 ①→⑦ 那天，解析器里的正则**还写死 ①②③④⑤⑥**，
//    于是 A 关（必读层闸门）**静默失效** —— 界面上看不出来，只在日志里留一行"解析失败"。
//    这条钉住"入口里加一行读序，就必须解析得出"，防同类失效再发生。
writeFileSync(join(root, '从这开始读.txt'), [
  '读序：',
  '① 00-总览-我们干过什么.md',
  '② 00-必读-铁律.md',
  '③ 工具速查.md',
  '④ 索引.md',
  '⑤ 日志系统-使用说明.md',
  '⑥ _说明-读我.txt',
  '⑦ 防丢失总则.md',
  '⑧ 第八份.md',
  '⑨ 第九份.md',
  '⑩ 第十份.md',
  '⑮ 第十五份.md',
  '⑳ 第二十份.md',
].join('\n'), 'utf8')
F30.__resetListCache()
const L二 = F30.requiredList()
check('⑧/⑨/⑩/⑮/⑳ 都解析得出（正则不许写死 ①→⑥）', L二.error === '' && L二.order.length === 12)
check('第一份与最后一份都在（⑳ 也没被漏掉）', L二.order[0].name === '00-总览-我们干过什么.md' && L二.order[11].name === '第二十份.md')
check('清单份数跟着涨（入口自己 ＋ 12）', L二.files.length === 13)
// 复位：后面的用例（②③…）依赖"样本里就写了 3 行"那份入口。
writeFileSync(join(root, '从这开始读.txt'), [
  'DeepSeek 档案 —— 从这开始读',
  '',
  '  L1-必读 ......... 每次接手**先读这一层**，读序就按下面 ①→⑥：',
  '                      ① 00-总览-我们干过什么.md ... 一页',
  '                      ② 00-必读-铁律.md ......... 红线',
  '                      ③ 工具速查.md ............. 有什么工具',
  '',
].join('\n'), 'utf8')
F30.__resetListCache()

console.log('— ② 没读齐之前：动手就拒，且告诉你缺哪几份 —')
// 🔴 **2026-10-22 改**：`glob` / `grep` 现在**放行**（"只读探查"）—— 治的是用户当天亲测到的死锁：
//    **新会话连档案根在哪都不知道**，要搜一下，而 A 关只放行 `read` ⇒
//    「不知道在哪 → 要查 → 被拦 → 永远不知道在哪」。
//    ⚠️ **`pwsh` 不放**（当天自查撤掉）：A 关拦它是**"改档案前必须读过必读"的最后一道** ——
//       第 11 关只堵 `Remove-Item` 这类字面，`pwsh` 能跑 `node -e "fs.writeFileSync(...)"` 绕过去。
//       而 `glob '**/*'` 已经够探路，不值得为"列目录"拆掉那道。
check('调 glob 去找档案 ⇒ **放行**（2026-10-22 起：只读探查不拦）', F30.verdict(run('S1', 'glob', { pattern: '*' })) === null)
check('调 grep 也一样放行', F30.verdict(run('S1', 'grep', { pattern: 'x' })) === null)
check('★ 调 pwsh **仍旧拦**（它是"改档案前必须读过必读"的最后一道）', F30.verdict(run('S1', 'pwsh', { command: 'echo hi' })) !== null)
// 但**会改东西的**照旧拦 —— 这才是 A 关的本意
const v1 = F30.verdict(run('S1', 'write', { file_path: join(root, 'L3-知识', 'x.md'), content: 'x' }))
check('调 write → **拒**（改档案照旧拦）', v1 !== null && v1.tag === '必读层未读完')
check('拒绝理由里列了缺的那几份', v1.reason.includes('00-必读-铁律.md') && v1.reason.includes('工具速查.md'))
check('拒绝理由点明依据（铁律 §四）', v1.reason.includes('铁律'))

console.log('— ③ 读清单里的那几份 → 放行并记账；读清单外的 → 仍然拒 —')
// 🔴 2026-09-21：第 6 关改用**落盘**判"重读"之后，落盘是**跨测试运行**存在的 ——
//    不先清一次，第二次跑这套测试时"第一次读"就会被判成"重读"
//    （详见 `lib/f30-toolgate.js` 里 `__resetDiskReads` 的注释：那是**状态污染**，不是判据错）。
F30.__resetDiskReads()
check('读铁律（绝对路径）→ 放行', F30.verdict(rd('S1', root + '/L1-必读/00-必读-铁律.md')) === null)
check('已读集合里记下了', F30.__haveRead('S1').length === 1)
check('读清单外的文件 → 仍然拒', F30.verdict(rd('S1', root + '/L3-知识/别的.md')) !== null)

F30.verdict(rd('S1', root + '/从这开始读.txt'))
F30.verdict(rd('S1', root + '/L1-必读/00-总览-我们干过什么.md'))
F30.verdict(rd('S1', root + '/L1-必读/工具速查.md'))
check('读齐 4 份之后：pwsh 放行', F30.verdict(run('S1', 'pwsh', { command: 'echo' })) === null)

console.log('— ④ 路径写法两种都认（相对 / 绝对）—')
check('用档案内相对路径也能认', F30.verdict(rd('S2', 'L1-必读/00-必读-铁律.md')) === null)
check('S2 的已读集合里记下了 1 份', F30.__haveRead('S2').length === 1)
check('S1 与 S2 各记各的（不串台）', F30.__haveRead('S1').length === 4)

console.log('— ④-2 🔴 重读也要记账（2026-10-01 真事故：只记"第一次" ⇒ prune 感知永远是空账）—')
// 事故经过（用户当天追问："**我怎么好像没见到 a 关拦你重读 l1**"）：
//   `noteRequiredRead` 原来挂在 `if (!have.has(hit))`（**只有本会话第一次读这一份**才进）——
//   可**实际路径是"重读"**（A 关的"已读"有三层：落盘 ∪ 历史 ∪ 内存 ⇒ 早就满了、一直放行）
//   ⇒ **记账从没执行过** ⇒ `memoria-f30-read-seqs.json` 里只有测试造的假会话 ⇒ **prune 感知永远不命中**。
//   ⇒ 断言：**已经读过之后再读一次，账也要刷新**（这条就是那个 bug 的照妖镜）。
{
  const { existsSync, readFileSync } = await import('node:fs')
  const { join: pjoin } = await import('node:path')
  const { HOME_DIR } = await import('../lib/common.js')
  const seqFile = pjoin(HOME_DIR, 'memoria-f30-read-seqs.json')
  F30.verdict(rdEv('S1', root + '/L1-必读/00-必读-铁律.md')) // ← 这一份**已经读过**（上面 ③ 那步）
  check(
    '🔴 重读已读过的必读文件 ⇒ 记账文件里也要有它（不能被"已读"挡在门外）',
    (() => {
      try {
        if (!existsSync(seqFile)) return false
        const j = JSON.parse(readFileSync(seqFile, 'utf8'))
        // ⚠️ 键可能是 `\` 或 `/` 两种写法（记账用的是档案内相对路径，层与层之间是反斜杠）
        //    ⇒ **按 basename 比**，别死抠分隔符（2026-10-01 第一版断言就是死在正/反斜杠上）。
        const mine = j?.['S1'] ?? {}
        return Object.entries(mine).some(([k, v]) => /必读-铁律\.md$/.test(k) && Array.isArray(v) && v.length > 0)
      } catch {
        return false
      }
    })(),
  )
}

console.log('— ⑤ 按需必读：只看不拦、写才拦 —')
check('只是 read 梅莫莉亚的文件 → 不触发', F30.scopedVerdict(run('S3', 'read', { file_path: MEM_FILE }), 'read', { file_path: MEM_FILE }) === null)
const bv = F30.scopedVerdict(run('S3', 'write', { file_path: MEM_FILE }), 'write', { file_path: MEM_FILE })
check('要 write 它 → 拒', bv !== null && bv.tag === '按需必读未读')
check('拒绝理由点了名（施工手册）', bv.reason.includes('施工手册'))
F30.__markRead('S3', HANDBOOK)
// 🔴 2026-09-24：B 关现在要求**两份**（施工手册 ＋ 现状总纲）—— 只读一份**不算读完**。
check(
  '只读了施工手册（总纲还没读）→ **仍然拒**',
  F30.scopedVerdict(run('S3', 'write', { file_path: MEM_FILE }), 'write', { file_path: MEM_FILE }) !== null,
)
F30.__markRead('S3', 'L3-知识\\知识\\备查\\备查-老馆与新馆（现状总纲）.md')
check('两份都读了之后 → 放行', F30.scopedVerdict(run('S3', 'write', { file_path: MEM_FILE }), 'write', { file_path: MEM_FILE }) === null)
check('写档案里的文件不触发这一关', F30.scopedVerdict(run('S3', 'write', { file_path: 'C:\\Users\\admin\\Desktop\\DeepSeek档案\\L1-必读\\索引.md' }), 'write', { file_path: 'C:\\Users\\admin\\Desktop\\DeepSeek档案\\L1-必读\\索引.md' }) === null)

console.log('— ⑥ .ps1 只许 ASCII：写的那一刻就拒 —')
check('写 .ps1 带中文注释 → 拒', F30.asciiVerdict('write', { file_path: PS1, content: '# 中文注释\nWrite-Host ok\n' }) !== null)
check('写 .ps1 纯 ASCII → 放行', F30.asciiVerdict('write', { file_path: PS1, content: '# comment\nWrite-Host ok\n' }) === null)
check('脚本**路径**带中文 → 拒（R2 第②次就是路径惹的）', F30.asciiVerdict('write', { file_path: 'D:\\工具箱\\中文夹\\x.ps1', content: 'ok' }) !== null)
check('edit 的 new_string 带中文 → 拒', F30.asciiVerdict('edit', { file_path: PS1, old_string: 'a', new_string: '中文' }) !== null)
check('改 .md 带中文 → 放行（只管 .ps1）', F30.asciiVerdict('write', { file_path: 'C:\\a\\b.md', content: '# 中文' }) === null)
check('read 一个 .ps1 → 不判（读不是写）', F30.asciiVerdict('read', { file_path: PS1 }) === null)

console.log('— ⑦ 挂上钩子 ＋ deny 的形状 —')
const ctx = mockCtx()
F30.registerF30(ctx)
check('挂上了 tools/pre-execute', typeof ctx.handlers['tools/pre-execute'] === 'function')
const h = ctx.handlers['tools/pre-execute']
// 🔴 2026-10-22：`pwsh` / `glob` / `grep` 已放行（"只读探查"，治"新会话找不到档案"的死锁）⇒
//    这一节改用 `write`（**真会改档案**的那个）当样本，A 关照旧该拦它。
const out = await h(
  run('S9', 'write', { file_path: join(root, 'L3-知识', 'x.md'), content: 'x' }),
  async () => ({ kind: 'allow' }),
)
check('没读必读层 → deny', out !== null && out.kind === 'deny')
check('deny 一定带 reason', typeof out.reason === 'string' && out.reason.length > 0)
const sub = await h({ name: 'pwsh', arguments: {}, agent: { session: { id: 'S10', header: { origin: 'subagent' } } } }, async () => ({ kind: 'allow' }))
check('子代理不参与（放行）', sub !== null && sub.kind === 'allow')

console.log('— ⑧ 自检自报工作量（三问③：不许静默失效）—')
check('自检报出清单份数', F30.reportF30().includes('必读清单') && F30.reportF30().includes('4 份'))

console.log('— ⑨ 解析失败必须出声 ＋ fail-open —')
writeFileSync(join(root, '从这开始读.txt'), '这一份里没有读序那六行\n', 'utf8')
F30.__resetListCache()
check('入口没有读序 → 报错（不许静默当空清单）', F30.requiredList().error.length > 0)
check('自检里出现 ⚠️', F30.reportF30().includes('⚠️'))
check('解析失败时放行（fail-open，插件 bug 不许把人锁死）', F30.verdict(run('S11', 'pwsh', { command: 'echo' })) === null)

console.log('— ⑨·二 记账口子必须开着（少了它 B 关死锁 —— 2026-09-20 真撞上过）—')
// ⚠️ 上一段**故意把入口改坏了**（那是测 fail-open）—— 这里先恢复入口：
//    入口坏着的时候 requiredVerdict 会 fail-open 直接放行、**根本走不到记账那一步**，
//    那样测的就不是"记账口子"了（第一版就是这么写错的，跑出来 1 条红）。
writeFileSync(join(root, '从这开始读.txt'), '① 00-总览-我们干过什么.md\n② 00-必读-铁律.md\n③ 工具速查.md\n', 'utf8')
F30.__resetListCache()
// 直接去读"B 关点名的那份"（施工手册）：**必须能记上账**。
// 少了这个口子，B 关会永远说"还没读"→ **连修它的代码都写不进去**（施工手册坑 4 那一族）。
F30.verdict(rd('S12', 'C:\\Users\\admin\\Desktop\\DeepSeek档案\\L3-知识\\知识\\指南\\指南-梅莫莉亚-施工手册.md'))
// ⚠️ 记账键的形态可能是「完整相对路径」或「纯文件名」（看 `matchKnown` 有没有现算出 rel）
//    ⇒ 只比文件名，别死抠层路径（2026-10-18 施工手册改名 `记录-`→`指南-` 后，这条红过一次）。
check('读"B 关点名的那份"能记上账', F30.__haveRead('S12').some((x) => String(x).includes('梅莫莉亚-施工手册')))

console.log('— ⑨·三 第 18 关 · 派活关（2026-09-29 加）：派子会话之前必须先读《派活标准》—')
const subCall = (sid) => ({ name: 'subagent', arguments: { prompt: 'x' }, agent: { session: { id: sid } } })
const sg1 = F30.verdict(subCall('S20'))
check('没读过《派活标准》→ 拒', sg1 !== null && sg1.tag === '派活前必读未读')
check('拒绝理由点了名（派活标准）', String(sg1 && sg1.reason).includes('派活标准'))
check('拒绝理由说清了"怎么过"（读了再发一次）', String(sg1 && sg1.reason).includes('再发一次'))
F30.__markRead('S20', 'L4-施工\\工程-派活标准.md')
check('读过之后 → 这一关不再拦（后面还有别的关，不管）', (() => { const v = F30.verdict(subCall('S20')); return v === null || v.tag !== '派活前必读未读' })())
check('别的工具不受这一关影响', (() => { const v = F30.verdict({ name: 'pwsh', arguments: { command: 'echo hi' }, agent: { session: { id: 'S21' } } }); return v === null || v.tag !== '派活前必读未读' })())
check('subagent_fork 同判', (() => { const v = F30.verdict({ name: 'subagent_fork', arguments: { prompt: 'x' }, agent: { session: { id: 'S22' } } }); return v !== null && v.tag === '派活前必读未读' })())
check('读过之后 → 这一关不再拦（后面还有别的关，不管）', (() => { const v = F30.verdict(subCall('S20')); return v === null || v.tag !== '派活前必读未读' })())

console.log('— ⑩ 模式开关：不用重启就能切；默认就是拦 —')
check('默认 enforce（要的是"拦"，不是"检测"）', F30.f30Mode() === 'enforce')
writeFileSync(F30.F30_MODE_FILE, 'observe', 'utf8')
check('切成 observe → 读得到', F30.f30Mode() === 'observe')
const ctxO = mockCtx()
F30.registerF30(ctxO)
const outO = await ctxO.handlers['tools/pre-execute'](run('S8', 'pwsh', { command: 'echo' }), async () => ({ kind: 'allow' }))
check('observe 下判据照跑、但不拦（留痕）', outO !== null && outO.kind === 'allow')
writeFileSync(F30.F30_MODE_FILE, 'off', 'utf8')
const ctxOff = mockCtx()
F30.registerF30(ctxOff)
const outOff = await ctxOff.handlers['tools/pre-execute'](run('S8b', 'pwsh', {}), async () => ({ kind: 'allow' }))
check('off 下直接放行', outOff !== null && outOff.kind === 'allow')
writeFileSync(F30.F30_MODE_FILE, 'enforce', 'utf8')
check('切回去 → 又拦', F30.f30Mode() === 'enforce')

console.log('— ⑪ 数"伸了几次手"（钱 ≈ 次数 × 上下文长度，见《总账》R30）—')
F30.resetToolCalls()
check('清零后是 0', F30.toolCallsThisTurn() === 0)
F30.noteToolCall()
F30.noteToolCall()
check('记两次就是 2', F30.toolCallsThisTurn() === 2)
F30.resetToolCalls()
check('再清零又回到 0', F30.toolCallsThisTurn() === 0)

console.log('— ⑫ 「已读集合」以**会话历史**为准（重启后不重量读 —— 2026-09-20 修）—')
// 病根：内存集合**重启即清**，而会话历史是**恢复**的 —— 重启后它判"一份都没读"，逼着白读一遍。
// ⚠️ 下面造的事件形状是**实测的**（本机会话日志逐帧解压核对），不是猜的：
//    {"type":"tool/call","data":{"turn":1,"step":1,"callId":"…","name":"read",
//      "arguments":"{\"file_path\": \"C:\\\\…\\\\从这开始读.txt\"}"}}   ← **arguments 是 JSON 字符串**
const NEEDS = [
  join(root, '从这开始读.txt'),
  join(root, 'L1-必读', '00-总览-我们干过什么.md'),
  join(root, 'L1-必读', '00-必读-铁律.md'),
  join(root, 'L1-必读', '工具速查.md'),
]
const readCall = (i, p, name = 'read') => ({
  type: 'tool/call',
  data: { turn: 1, step: 1, callId: 'c' + i, name, arguments: JSON.stringify({ file_path: p }) },
})
const evAll = NEEDS.map((p, i) => readCall(i, p))
const withHist = (sid, events) => (name, args) => ({ name, arguments: args, agent: { session: { id: sid, events } } })

check('内存集合是空的（模拟重启后的进程）', F30.__haveRead('S13').length === 0)
check('内存空、**历史里读过 4 份** → pwsh 不再被拦', F30.verdict(withHist('S13', evAll)('pwsh', { command: 'echo' })) === null)
check(
  '只认 read：历史里用 grep 扫过 → 不算读过，照旧拦',
  F30.verdict(withHist('S13c', NEEDS.map((p, i) => readCall(i, p, 'grep')))('write', { file_path: join(root, 'L3-知识', 'y.md'), content: 'y' })) !== null,
)

const evOne = [readCall(0, join(root, 'L1-必读', '00-必读-铁律.md'))]
const vh = F30.verdict(withHist('S14', evOne)('write', { file_path: join(root, 'L3-知识', 'z.md'), content: 'z' }))
check('历史里只读了 1 份 → 仍然拦', vh !== null && vh.tag === '必读层未读完')
check('拦的理由里**不再**点名已读的那份', !vh.reason.includes('00-必读-铁律.md'))
check('拦的理由里点了还没读的', vh.reason.includes('工具速查.md'))

check(
  '历史里 arguments 是坏 JSON → 不炸、当没读到（fail-open）',
  // ⚠️ 2026-10-22：`pwsh` 已放行（只读探查）⇒ 拿 `write` 当"会被 A 关拦"的样本
  F30.verdict(withHist('S15', [{ type: 'tool/call', data: { name: 'read', arguments: '{不是 json' } }])('write', { file_path: join(root, 'L3-知识', 'a.md'), content: 'a' })) !== null,
)
check('拿不到 events（不是数组）→ 退回内存，照旧拦', F30.verdict(withHist('S16', null)('write', { file_path: join(root, 'L3-知识', 'b.md'), content: 'b' })) !== null)

// B 关（按需必读）那条也**照同一把尺子**：历史里读过施工手册 → 写梅莫莉亚不再被拦。
// ⚠️ 2026-09-24：B 关要**两份**了（＋《现状总纲》）—— 历史里也得两份才算"读完"。
const evHan = [
  readCall(0, join(root, 'L3-知识', '知识', '指南', '指南-梅莫莉亚-施工手册.md')),
  readCall(1, join(root, 'L3-知识', '知识', '备查', '备查-老馆与新馆（现状总纲）.md')),
]
check(
  'B 关：内存空、历史里读过施工手册 → write 梅莫莉亚放行',
  F30.scopedVerdict(withHist('S17', evHan)('write', { file_path: MEM_FILE }), 'write', { file_path: MEM_FILE }) === null,
)
check(
  'B 关反面：历史里没读过 → 照旧拦',
  F30.scopedVerdict(withHist('S18', [])('write', { file_path: MEM_FILE }), 'write', { file_path: MEM_FILE }) !== null,
)

console.log('— ⑬ E 关（第四道）：绝不用 write/edit 手改 cordis.patch.yml —')
// 依据《铁律》§二；为什么危险：那个 profile 是 `patchReload: live`，手改它**立刻热重载**
// （2026-09-05 因此把控制台弄死过三次 ·《AI错误总账》R3）。
const CORDIS = 'C:\\Users\\admin\\.dsh\\profiles\\web\\cordis.patch.yml'
const CORDIS_FWD = 'C:/Users/admin/.dsh/profiles/web/cordis.patch.yml'
check('write cordis.patch.yml → 拒', F30.patchVerdict('write', { file_path: CORDIS }) !== null)
check('edit cordis.patch.yml → 也拒', F30.patchVerdict('edit', { file_path: CORDIS, old_string: 'a', new_string: 'b' }) !== null)
check('正斜杠写法一样认（规范化 \\→/）', F30.patchVerdict('write', { file_path: CORDIS_FWD }) !== null)
check('写别的 .yml → 放行', F30.patchVerdict('write', { file_path: 'C:\\Users\\admin\\.dsh\\profiles\\web\\other.yml' }) === null)
check('沾边但结尾不是它（.yml.bak）→ 放行', F30.patchVerdict('write', { file_path: CORDIS + '.bak' }) === null)
check('**read** cordis.patch.yml → 放行（看是允许的，改才拦）', F30.patchVerdict('read', { file_path: CORDIS }) === null)
check('grep 它 → 放行（不是写类工具）', F30.patchVerdict('grep', { file_path: CORDIS }) === null)
const cv = F30.patchVerdict('write', { file_path: CORDIS })
check('话术点了依据（铁律 §二）', cv.reason.includes('铁律'))
check('话术讲了为什么危险（热重载 ＋ 09-05 死过三次）', cv.reason.includes('热重载') && cv.reason.includes('三次'))
check('话术给了正确做法（dsh plugin --profile web add）', cv.reason.includes('dsh plugin --profile web add'))
check('话术给了只读的看配置办法（--dump-config）', cv.reason.includes('--dump-config'))
// 位置：**D 之后、B 之前** —— 拿一个"同时会被 B 关点名"的路径（在 dsh-memoria 插件目录里）来验：
// B 关这时也该拒（没读施工手册），但 E 关排在它前面，所以拒的理由必须是 E 关那条。
const CORDIS_IN_PLUGIN = 'C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\profiles\\web\\cordis.patch.yml'
const vE = F30.verdict(withHist('S20', [])('write', { file_path: CORDIS_IN_PLUGIN }))
check('总判里 E 关排在 B 关之前（同一条路径，先报 E）', vE !== null && vE.tag === '手改 cordis.patch.yml')

console.log('— ⑭ 本回合记下"调过哪些工具"（F31 判"有没有写动作"靠它）—')
F30.resetToolCalls()
check('清零后没有任何工具名', F30.toolsCalledThisTurn().length === 0)
F30.noteToolCall('read')
F30.noteToolCall('grep')
check('只读工具 → 不算写', F30.wroteThisTurn() === false)
check('次数照记（不破坏原计数）', F30.toolCallsThisTurn() === 2)
F30.noteToolCall('edit')
check('调过 edit → 算写', F30.wroteThisTurn() === true)
F30.resetToolCalls()
F30.noteToolCall('dangan_log')
check('调过 dangan_log → 也算写（它真写档案）', F30.wroteThisTurn() === true)
F30.resetToolCalls()
check('清零把工具名也清了', F30.toolsCalledThisTurn().length === 0 && F30.wroteThisTurn() === false)

console.log('— ⑮ 第 0 关：只保护**每轮注入的那一个** AGENTS.md（改它必须先问用户）—')
// 依据：用户 2026-09-20 拍板"**这个必须堵死**"（AI 未经他同意就改了这个文件）；
//      它是**每轮注入、权重最高**的文件；2026-09-17 定的规矩是"**成果先放桌面待确认**"。
// 🔴 2026-09-20 收窄（用户原话："除了真的会每轮注入你的那个，其他的都不触发闸门。
//    桌面这些副本都不值钱。不值得这样的流程。"）：
//    判据从"任意目录的同名文件"改成"规范化后路径 == `HOME_DIR/AGENTS.md`" ⇒ **只认这一个**。
const AGENTS_MD = join(HOME_DIR, 'AGENTS.md')
check('写 ~/.dsh/AGENTS.md（用 HOME_DIR 算，不写死真路径）→ 拒', F30.agentsMdVerdict('write', { file_path: AGENTS_MD }) !== null)
check('edit 它 → 也拒', F30.agentsMdVerdict('edit', { file_path: AGENTS_MD, old_string: 'a', new_string: 'b' }) !== null)
check('正斜杠写法一样认（规范化后相等）', F30.agentsMdVerdict('write', { file_path: AGENTS_MD.replace(/\\/g, '/') }) !== null)
check('🔴 核心：写**工作区级**的 AGENTS.md → 放行', F30.agentsMdVerdict('write', { file_path: 'C:\\某项目\\AGENTS.md' }) === null)
check(
  '🔴 核心：写**桌面的副本**（AGENTS-新版-干净版.md）→ 放行',
  F30.agentsMdVerdict('write', { file_path: 'C:\\Users\\admin\\Desktop\\AGENTS-新版-干净版.md' }) === null,
)
check('工作区级那个的 edit 也放行', F30.agentsMdVerdict('edit', { file_path: 'C:\\某项目\\AGENTS.md', old_string: 'a', new_string: 'b' }) === null)
check('**read** ~/.dsh/AGENTS.md → 放行（返回 null）', F30.agentsMdVerdict('read', { file_path: AGENTS_MD }) === null)
check('写别的 .md（C:\\x\\别的.md）→ 放行', F30.agentsMdVerdict('write', { file_path: 'C:\\x\\别的.md' }) === null)
check('沾边但文件名不是它（AGENTS.md.bak）→ 放行', F30.agentsMdVerdict('write', { file_path: 'C:\\x\\AGENTS.md.bak' }) === null)
check('同名但在别的 home 下（C:\\别的home\\.dsh\\AGENTS.md）→ 放行', F30.agentsMdVerdict('write', { file_path: 'C:\\别的home\\.dsh\\AGENTS.md' }) === null)
const av = F30.agentsMdVerdict('write', { file_path: AGENTS_MD })
check('话术里含"每轮"（说清它凭什么被保护）', av.reason.includes('每轮'))
check('话术里含"只保护"（说清范围就这一个）', av.reason.includes('只保护'))
check('话术里含"桌面"的副本不触发（说清收窄后的边界）', av.reason.includes('桌面') && av.reason.includes('不触发'))
check('话术里含"用户"（依据来自用户拍板）', av.reason.includes('用户'))
check('话术里含"问"（唯一出路是去问，不是干拦）', av.reason.includes('问'))
check('话术里含"完整全文"（要求给全貌，不是片段）', av.reason.includes('完整全文'))
check('话术教了标注写法（含"（原："与"已删"）', av.reason.includes('（原：') && av.reason.includes('已删'))
check('话术指明放哪给他审（"桌面"）', av.reason.includes('桌面'))
check('话术里含"操作指令"（⑤ 教它该写什么）', av.reason.includes('操作指令'))
check('话术里含"不写前因后果"（⑤ 不许写论证与数字）', av.reason.includes('不写前因后果'))
check('话术里含"三两句"（⑤ 一条就要短）', av.reason.includes('三两句'))
check('话术里含"去哪找"（⑤ 变的东西只许指路）', av.reason.includes('去哪找'))
// 位置：**总判里排最前** —— 拿"必读层还没读"的会话来验：A 关也会拒，但先报的必须是第 0 关那条。
const vA0 = F30.verdict(withHist('S21', [])('write', { file_path: AGENTS_MD }))
check('总判里第 0 关排在 A 关之前（A 关也会拒，但先报 AGENTS.md）', vA0 !== null && vA0.tag === 'AGENTS.md 只读')
check('read 它走总判也放行（必读层已读齐的会话）', F30.verdict(withHist('S22', evAll)('read', { file_path: AGENTS_MD })) === null)
check(
  '总判里写工作区级的 AGENTS.md **不**被第 0 关拦（走的是别的关）',
  (() => {
    const v = F30.verdict(withHist('S23', [])('write', { file_path: 'C:\\某项目\\AGENTS.md' }))
    return v !== null && v.tag === '必读层未读完'
  })(),
)


console.log('— ⑰ 「已读集合」再补一层**落盘**（真机实测：重启后光靠历史不够 —— 2026-09-20 第二次修）—')
// 现象（真机）：用户重启控制台后，AI 调第一个非 read 工具**仍被拒**、仍被要求重读那 7 份；
//   日志（`~/.dsh/memoria.log`）里**只有**"F30：记下已读 …"那 7 条（被拒之后现读的），
//   **没有一条**"从历史读到"。根因：重启后 `agent.session.events` 里**那一刻还没有历史**
//   （界面能看到旧对话 ≠ 插件当场拿得到事件流）⇒ 判据要**三合一**：落盘 ∪ 历史 ∪ 内存。
// ⚠️ `HOME_DIR` 是沙箱（`sandboxHome()` 设了 `DSH_HOME`）—— 路径**现算**，不写死真路径。
const READS_FILE = join(HOME_DIR, 'memoria-f30-reads.json')
const diskWrite = (obj) => {
  mkdirSync(dirname(READS_FILE), { recursive: true })
  writeFileSync(READS_FILE, JSON.stringify(obj), 'utf8')
}
const diskNow = () => JSON.parse(readFileSync(READS_FILE, 'utf8'))
// ⚠️ 上一段（⑯）也在同一个沙箱 HOME 里跑过 —— 有旧条目才叫"修剪过了"，所以不断言"就一条"。
// ⚠️ 键用一个**清单里真有的**那份的 `rel`（`join()` 出来的形态，Windows 上是反斜杠）——
//    不然测的就是"两份不同的相对路径"，断言会假红（第一版就是这么写错的）。
const REL4 = F30.requiredList().files.map((f) => f.rel)

// 🔴 核心：**落盘里记过、内存空、历史也空** → 判据仍认为已读（＝"重启后"那一刻的真实现场）
const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
diskWrite({
  D1: Object.fromEntries(REL4.map((r) => [r, Date.now()])),
  D2: { '从这开始读.txt': Date.parse(old) }, // 30 天前 —— 该被裁掉
})
check('内存集合是空的（模拟重启后的进程）', F30.__haveRead('D1').length === 0)
check(
  '🔴 核心：落盘里记过、内存空、历史也空 → pwsh 不再被拦（重启不逼重读）',
  F30.verdict(withHist('D1', [])('pwsh', { command: 'echo' })) === null,
)
check('落盘只记了一部分 → 照旧拦（落盘不是万能钥匙）', F30.verdict(withHist('D3', [])('write', { file_path: join(root, 'L3-知识', 'c.md'), content: 'c' })) !== null)
check('超过 7 天的旧条目 → 读出来时被裁掉', F30.f30DiskReads().D2 === undefined)
check('同一次读里，7 天内的条目留着', F30.f30DiskReads().D1?.[REL4[0]] > 0)

// 读清单里某一份 → 那一刻落盘里确实多出这条（写时机）
const IRON_REL = F30.requiredList().files[2].rel
const IRON = root + '/L1-必读/00-必读-铁律.md'
rmSync(READS_FILE, { force: true })
F30.verdict(rd('D4', IRON))
check('读了清单里某一份 → 落盘文件里确实多了那条', diskNow()?.D4?.[IRON_REL] > 0)

// fail-open：文件不存在 / 内容坏 JSON → 不抛错、当空处理（判据退回历史＋内存，照旧拦）
rmSync(READS_FILE, { force: true })
let boom = ''
try {
  F30.verdict(withHist('D5', [])('pwsh', { command: 'echo' }))
  F30.f30DiskReads()
} catch (e) {
  boom = String(e)
}
check('落盘文件不存在 → 不抛错', boom === '')
check('不存在 → 当空（返回空对象）', Object.keys(F30.f30DiskReads()).length === 0)
check('不存在时判据照旧拦（不因落盘缺了就放行）', F30.verdict(withHist('D5', [])('write', { file_path: join(root, 'L3-知识', 'd.md'), content: 'd' })) !== null)
writeFileSync(READS_FILE, '{坏 JSON 不是 json', 'utf8')
let boom2 = ''
try {
  F30.f30DiskReads()
  F30.verdict(withHist('D6', [])('pwsh', { command: 'echo' }))
} catch (e) {
  boom2 = String(e)
}
check('落盘内容坏 JSON → 不抛错', boom2 === '')
check('坏 JSON → 当空（返回空对象）', Object.keys(F30.f30DiskReads()).length === 0)
check('坏 JSON 时判据照旧拦（fail-open 不是"全放行"）', F30.verdict(withHist('D6', [])('write', { file_path: join(root, 'L3-知识', 'e.md'), content: 'e' })) !== null)
// 坏文件之上还能正常补写（写失败也不影响放行 —— 这里直接验"写了不出错"）
const QUICK_REL = F30.requiredList().files[3].rel
F30.verdict(rd('D7', root + '/L1-必读/工具速查.md'))
check('坏文件之上照样能补写（写不进去也绝不影响放行）', diskNow()?.D7?.[QUICK_REL] > 0)

// B 关（按需必读）走的是**同一把尺子**：落盘里记过**那两份** → 写梅莫莉亚不再被拦。
diskWrite({ D8: { [HANDBOOK]: Date.now(), ['L3-知识\\知识\\备查\\备查-老馆与新馆（现状总纲）.md']: Date.now() } })
check(
  'B 关：落盘里记过那两份 → write 梅莫莉亚放行',
  F30.scopedVerdict(withHist('D8', [])('write', { file_path: MEM_FILE }), 'write', { file_path: MEM_FILE }) === null,
)

const S8 = await import('../lib/said.js')

// ============================================================
// 🗑 第 9 关（本回合调用额度）2026-10-20 删净 —— 它的断言随函数一起没了。
//    留着的行为只有"计数"（下面 ⑧ 那段还钉着 `toolCallsThisTurn()`），**不再有"到顶就拦"**。
// ============================================================

// ============================================================
// ⑨ 不许"整份覆盖"一个已经存在的文件（2026-09-25 加）
//    病：`glob` 报"没有这个文件"给了**假信号**，我差点 `write` 覆盖掉一份 152 行的测试；
//    而 read-before-write 那条政策**读一次就放行** —— 我那次"读"只是为了确认它存在，
//    读完反而获得了"覆盖它的资格"。**规则反着使了。**
// ============================================================
console.log('')
console.log('—— ⑨ 不许整份覆盖已存在的文件 ——')

{
  // 用块包起来：这一套变量名（overwriteA / tryWrite / v1…）可能跟文件里别处重名（第一次真撞了 `v1`）
  const overwriteA = join(root, 'L3-知识', '覆盖测试A.md')
  const overwriteB = join(root, 'L3-知识', '覆盖测试B.md')
  writeFileSync(overwriteA, '# A\n第二行\n第三行\n', 'utf8')
  writeFileSync(overwriteB, '# B\n', 'utf8')

  const tryWrite = (p) => F30.overwriteVerdict('write', { file_path: p }, 'test-sid')

  const v1 = tryWrite(overwriteA)
  check('目标已存在 → **拦**（第一次）', v1 !== null)
  check('拦的时候把现况摆出来（多少行 / 开头是什么）', v1 !== null && /现在 \d+ 行/.test(v1.reason) && v1.reason.includes('# A'))
  check('★ 出路：再发一次同一个 write → **放行**（只拦一次，不靠自觉）', tryWrite(overwriteA) === null)
  check('第三次又拦（拦一次、放一次，不是永久放行）', tryWrite(overwriteA) !== null)
  check('目标不存在（真新建）→ 放行', tryWrite(join(root, 'L3-知识', '不存在的新文件.md')) === null)
  check('`edit` 不管 —— 它是匹配替换，天生不会整份覆盖', F30.overwriteVerdict('edit', { file_path: overwriteB }, 'test-sid') === null)
  check('没给路径 → 放行（判据出错一律 fail-open）', F30.overwriteVerdict('write', {}, 'test-sid') === null)
}

console.log('—— ⑩ 销账三步门（第 18 关 · 用户 2026-09-29 定的机制）——')

{
  const lsid = 'ledger-sid-1'
  const skel = join(HOME_DIR, 'memoria-dumps', 'skeleton', '骨架-归档-abcdef12.md')
  const nomArgs = { '归账完成': ['archive:abcdef12'] }
  // ⚠️ 生产里 `verdict()` 每次调用都先走 `noteLedgerStep`（记账），所以这里也照做 —— 不然"步号"没推进。
  const call = (name, args, file) => {
    const ex = run(lsid, name, args)
    F30.noteLedgerStep(file ? rd(lsid, file) : ex, file ? 'read' : name, file ? { file_path: file } : args)
    return F30.verifiedGateVerdict(ex, name, args)
  }

  // ① 没读骨架就提名 ⇒ 拦（并把出路给全）
  const v1 = call('dangan_log', nomArgs)
  check('① 没读骨架就提名 ⇒ **拦**', v1 !== null)
  check('拦的时候**直接给出骨架路径**（照抄就能读）', v1 !== null && v1.reason.includes('骨架-归档-abcdef12.md'))
  check('骨架缺的出路：重建命令也在理由里', v1 !== null && v1.reason.includes('dump-skeleton.mjs'))
  check(
    '★ **硬拦**：不允许跳过流程 —— 再发一次**还是拦**（用户 2026-09-30："无关你的判断，程序必须执行"）',
    call('dangan_log', nomArgs) !== null,
  )

  // ② 读了骨架、却**没留下核账记录** ⇒ 拦
  //    🔴 2026-10-22 改口径（用户：「**销账不再依赖落档吧**」）：
  //    原来这一关要求"读了之后必须真落过一次档" —— 而 `落档` 纹样**只维护时间标记**，
  //    同一天第二次必然"一处都不用改"（织布机不写盘）⇒ **销账永远卡死**。改成看「有没有核账记录」。
  call('read', { file_path: skel }, skel) // 只"读骨架"，不写核账记录
  const v2 = call('dangan_log', nomArgs)
  check('② 读了骨架却没核账记录 ⇒ **拦**', v2 !== null)
  check('理由点出"没留下核账记录"', v2 !== null && v2.reason.includes('没留下核账记录'))

  // ③ 有了核账记录 ⇒ **放行**（**不再要求先落一次档**）
  {
    const { CFG } = await import('../lib/common.js')
    // ⚠️ `makeArchive` 造的是 tmpdir 那一份，**不会自动改 `CFG.archiveDir`** ⇒ 这里临时指过去（完事恢复）
    const oldRoot = CFG.archiveDir
    CFG.archiveDir = root
    const l3 = join(root, 'L3-知识')
    check('沙箱里找得到 L3 目录（不然下面写不进核账记录）', existsSync(l3))
    writeFileSync(join(l3, '记录-2026-10-22-核账-abcdef12.md'), '缺口 0 条（全是过程原话）', 'utf8')
    check('③ 有核账记录 ⇒ **放行**（2026-10-22 起不再要求先落一次档）', call('dangan_log', nomArgs) === null)
    CFG.archiveDir = oldRoot
  }

  // ③c 换了另一份留底、**它没有核账记录** ⇒ 仍旧拦（证明判据是"按留底认"，不是"有记录就全放"）
  {
    const sid2 = '98765432'
    const skel2 = join(tmpdir(), `骨架-归档-${sid2}.md`)
    // 记账靠 `read` 的路径正则认，不靠 API
    call('read', { file_path: skel2 }, skel2)
    check('③c 另一份留底没核账记录 ⇒ 仍旧拦', call('dangan_log', { ...nomArgs, '归账完成': [sid2] }) !== null)
  }

  // ④ 别的工具 / 没带提名 ⇒ 一个字都不说
  check('④ 没带「归账完成」⇒ 不管', F30.verifiedGateVerdict(run(lsid, 'dangan_log', { what: 'x', level: '○' }), 'dangan_log', { what: 'x', level: '○' }) === null)
  check('⑤ 别的工具 ⇒ 不管', F30.verifiedGateVerdict(run(lsid, 'dangan_todo', {}), 'dangan_todo', {}) === null)
}

console.log('— ㉒ 第 19 关 · 改完 JS 要验语法（2026-10-10 加 · 治《总账》R44，复发 7 次）—')
{
  const s1 = 'syntax-sid-1'
  F30.noteSyntaxDebt(run(s1, 'edit', { file_path: 'C:\\x\\lib\\x.js' }), 'edit', { file_path: 'C:\\x\\lib\\x.js' })
  const v1 = F30.syntaxDebtVerdict(run(s1, 'dangan_log', {}), 'dangan_log', {})
  check('① 改过 .js、还没验语法 ⇒ **落档被拦**', v1 !== null)
  check('   拦的理由里**列出欠哪个文件**（给出路）', v1 !== null && v1.reason.includes('x.js'))
  F30.noteSyntaxDebt(run(s1, 'pwsh', { command: 'node --check lib\\x.js' }), 'pwsh', { command: 'node --check lib\\x.js' })
  check('② 跑过 node --check ⇒ **放行**', F30.syntaxDebtVerdict(run(s1, 'dangan_log', {}), 'dangan_log', {}) === null)

  const s2 = 'syntax-sid-2'
  F30.noteSyntaxDebt(run(s2, 'write', { file_path: 'D:\\p\\y.mjs' }), 'write', { file_path: 'D:\\p\\y.mjs' })
  check('③ **只拦落档** —— 别的工具一个字都不说', F30.syntaxDebtVerdict(run(s2, 'dangan_search', {}), 'dangan_search', {}) === null)

  const s3 = 'syntax-sid-3'
  F30.noteSyntaxDebt(run(s3, 'edit', { file_path: 'C:\\a\\b.md' }), 'edit', { file_path: 'C:\\a\\b.md' })
  check('④ 非 JS 文件不记欠（改 .md 不该被拦）', F30.syntaxDebtVerdict(run(s3, 'dangan_log', {}), 'dangan_log', {}) === null)
}

console.log('— ⑳ 🔴 prune「内容判据」（2026-10-01 加：不再靠记账猜坐标，直接看裁掉的是什么）—')
// 为什么换成它：记账那条路**连栽四跤**（挂在"只有第一次读"的分支 · 只扫最后 5 条 ·
//   把任何工具的 tool/result 当 read 坐标 · **`exec.agent.session` 上根本没有 `events`**）——
//   日志原话："**拿不到 session.events（形状不对）**"。而 `session.eventAt(seq)` **是有的**（F22 一直在用）。
//   ⇒ 现在：prune 给 seq ⇒ `eventAt(seq)` 取回原文 ⇒ 看那份原文是不是"读某份文件"的结果。
{
  const pathInResult = `${root}\\L1-必读\\00-必读-铁律.md`
  const sess = {
    id: 'S9',
    // read 的结果长这样：`<path>…</path>\n<type>file</type>\n<content>…`
    eventAt: (s) =>
      s === 500
        ? {
            type: 'tool/result',
            seq: 500,
            data: { message: { content: [{ text: `<path>${pathInResult}</path>\n<type>file</type>\n<content>\n1: # 铁律\n</content>` }] } },
          }
        : null,
  }
  F30.__markRead('S9', 'L1-必读/00-必读-铁律.md')
  const r = F30.onPruneEvent(sess, { type: 'compaction/prune', data: { shadowedSeqs: [500], shadowedTokenCount: 3890 } })
  check('🔴 内容判据：从"被裁的原文"里认出它读的是必读层文件', r.hit.some((x) => /铁律/.test(x)), JSON.stringify(r.hit))
  check(
    '🔴 认出之后 ⇒ 那份"已读"被抹掉（A 关下一轮会逼我重读）',
    !F30.__haveRead('S9').includes('L1-必读/00-必读-铁律.md'),
  )
  // 反向：裁掉的是**别的文件**（原文里没有必读层的路径）⇒ 一份都不许抹
  F30.__markRead('S9', 'L1-必读/00-必读-铁律.md')
  const sess2 = {
    id: 'S9',
    eventAt: (s) => (s === 600 ? { type: 'tool/result', seq: 600, data: { message: { content: [{ text: '<path>C:\\别的\\无关文件.txt</path>' }] } } } : null),
  }
  const r2 = F30.onPruneEvent(sess2, { type: 'compaction/prune', data: { shadowedSeqs: [600], shadowedTokenCount: 100 } })
  check('🔴 反向：裁的是别处 ⇒ 不命中、不误伤', r2.hit.length === 0 && F30.__haveRead('S9').includes('L1-必读/00-必读-铁律.md'))
}

console.log('— ㉑ 🔴 必读层必须「一次读全」（2026-10-01 加 · 用户："不能只读片段，必须全读"）—')
// ⚠️ **本块只钉"判据本身"，不钉"它在 verdict 链里跑通没有"** —— 后者在本夹具里测不出来：
//    诊断过三轮（`S21 账里 = []`，而那次 read 确实不带 offset/limit）⇒ 记账那段**在这个夹具里走不到**
//    （根因在夹具/链，不在判据）。**别把"测不动"当成"测过了"** —— 所以这里只断言纯函数行为，
//    "它在真档案里拦不拦我"**留给重启后手工验一次**（读一份 L1 时故意带 limit，看它拦不拦）。
{
  const whole = (extra) => F30.__readWholeFile({ file_path: 'x.md', ...extra })
  check('不带 offset/limit ⇒ 判为"一次读全"', whole({}) === true)
  check('带了 limit ⇒ 判为"只读片段"', whole({ limit: 8 }) === false)
  check('带了 offset ⇒ 判为"只读片段"', whole({ offset: 9 }) === false)
  check('两个都带 ⇒ 同样判为片段', whole({ offset: 3, limit: 5 }) === false)
  check('边界：limit 是 0 / 空串 ⇒ 按"没给"算（全读）', whole({ limit: 0, offset: 0 }) === true)
}

console.log('— ㉓ 🔴 借外部程序写档案（2026-10-16 加 · 用户：「绕过去这个倒是值得堵死」）—')
// 洞的样子：`ffmpeg` / `7zr` / `tar` / `node -e` 被当"工具"放行，而它们写盘**不经过**裸 cmdlet 判据
//   ⇒ 那天我用 `ffmpeg` 把 3 个临时件写进了**别馆**的 `L6-工具临时\`。
// ⚠️ 这一关**只降概率、不给保证**（没列进来的 exe 照样绕）—— 断言钉的是"列进来的必须拦、只读用法别误伤"。
{
  const cmd = (c) => F30.diskWriteVerdict('pwsh', { command: c })
  const inside = `${root}\\L6-工具临时\\x.mp4`
  check('ffmpeg 写进档案里 ⇒ 拒', cmd(`ffmpeg -i a.mp4 -y "${inside}"`) !== null)
  check('ffmpeg 写档案外（E:）⇒ 放行', cmd('ffmpeg -i a.mp4 -y E:\\tmp\\x.mp4') === null)
  check('7zr 解到档案里 ⇒ 拒', cmd(`7zr x a.7z -o${root}\\L6-工具临时`) !== null)
  check('tar -xf 解到档案里 ⇒ 拒', cmd(`tar -xf a.7z -C "${root}\\L5-证据"`) !== null)
  check('tar -tf 只读 ⇒ 放行（别误伤）', cmd(`tar -tf "${root}\\L5-证据\\a.7z"`) === null)
  check('rg 搜档案 ⇒ 放行（它不是写盘程序）', cmd(`rg foo "${root}"`) === null)
  check('node -e 里写档案 ⇒ 拒', cmd(`node -e "require('fs').writeFileSync('${root}\\\\L3\\\\x.md','')"`) !== null)
  check('pandoc -o 到档案里 ⇒ 拒', cmd(`pandoc a.md -o "${root}\\L3-知识\\x.docx"`) !== null)
  check('白名单入口（改档）⇒ 放行', cmd(`node 改档.mjs --txn "E:\\t.json" "${root}\\L4-施工\\工程-待办.md"`) === null)
  check('裸写 cmdlet 那条老判据照旧 ⇒ 拒', cmd(`Set-Content -Path "${root}\\L1-必读\\总览.md" -Value x`) !== null)
}

done()
