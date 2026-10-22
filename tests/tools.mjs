/**
 * 工具注册与行为（`dangan_search` / `dangan_check`）。跑法：node tests/tools.mjs
 */
import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('tools', {
  '从这开始读.txt': '入口\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n- 凡批量，先在样本上试跑。\n- 梅莫莉亚是档案的哨兵。\n',
  'L1-必读/索引.md': [
    '# 索引（哪个文件讲什么、什么时候该读）',
    '',
    '## L3-知识',
    '',
    '| 时间 | 文件 | 一句话：它是做什么的 |',
    '|---|---|---|',
    '| 2026-10-14 09:00 | `记录.md` | 梅莫莉亚的设计讨论 |',
    '',
  ].join('\n'),
  // ⚠️ 2026-10-16：样本里原来的 `L2-数据`（时间轴 / 事件表）**换掉** —— 那层 2026-10-14 已删，
  //    现在 `L2` 是 `L2-用户`（"你我之间"那一层）。旧样本会继续教人"L2-数据 还在"。
  'L2-用户/记录-你我之间.md': '# 记录 · 你我之间\n\n- 梅莫莉亚上岗那天（见 E1 / T1）。\n',
  'L3-知识/记录.md': '- 梅莫莉亚的设计讨论（见 E1 / T1）。\n',
  'L5-证据/原始输出.txt': '- 梅莫莉亚的原始证据（scope 点名才该被搜到）。\n',
  'L6-工具临时/改档快照/20261016-010203-1-1-abc/L3-知识/记录.md': '- 快照副本：梅莫莉亚。\n',
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })

check('inject 声明了 tools', Array.isArray(mod.inject) && mod.inject.includes('tools'))
const names = ctx.registered.map((t) => t.name).sort()
check(`注册了两个工具（${names.join(' / ')}）`, names.includes('dangan_search') && names.includes('dangan_check'))

const search = ctx.registered.find((t) => t.name === 'dangan_search')
const r1 = await search.execute({ query: '梅莫莉亚' })
check('搜「梅莫莉亚」ok', r1.ok === true)
check('命中数 > 0', (r1.text.match(/^\d+\. /gm) || []).length > 0)
check('输出带 文件:行号', /\.md:\d+/.test(r1.text))
// ⚠️ 2026-10-16：锚点在输出里是**连写**的（`[E1 T1]`）—— 旧正则 `/\[[TE]\d+\]/` 只认单个锚点，
//    以前是靠样本里另有一行"只有 E1"蒙过去的；样本一改就露馅 ⇒ 改成容错写法。
check('输出带 T/E 锚点', /\[[TEARD]\d+(?: [TEARD]\d+)*\]/.test(r1.text))

const r2 = await search.execute({ query: '梅莫莉亚', scope: 'L1' })
const paths2 = [...r2.text.matchAll(/^\d+\. ([^\s:]+):\d+/gm)].map((m) => m[1])
check(`scope=L1 时命中全在 L1 下（${paths2.length} 条）`, paths2.length > 0 && paths2.every((p) => p.startsWith('L1')))

const r3 = await search.execute({ query: 'zzz肯定不存在zzz' })
check('无命中时给提示', r3.ok === true && r3.text.includes('0 条命中'))

let threw = false
try {
  await search.execute({ query: '   ' })
} catch {
  threw = true
}
check('空 query 抛错', threw)

// ---- C「上下 k 行」（2026-10-10 加 · 织布机收口阶段③ 的那一条）：给 `文件:行号`，回它上下各 k 行 ----
const TL = 'L2-用户\\记录-你我之间.md'
const r4 = await search.execute({ mode: 'around', at: `${TL}:3`, k: 2 })
check('around 返回 ok', r4.ok === true)
check('around 标出目标行（▶）', r4.text.includes('▶'))
check('around 每行都带行号', /\d+ \| /.test(r4.text))
check(
  'around 认得正斜杠写法',
  (await search.execute({ mode: 'around', at: 'L2-用户/记录-你我之间.md:3', k: 1 })).ok === true,
)
const r5 = await search.execute({ mode: 'around', at: `${TL}:99999`, k: 2 })
check('around 行号越界 ⇒ ok=false（回文本、不抛）', r5.ok === false && r5.text.includes('不存在'))
let threwAround = false
try {
  await search.execute({ mode: 'around' })
} catch {
  threwAround = true
}
check('around 缺 at ⇒ 抛错', threwAround)

const chk = ctx.registered.find((t) => t.name === 'dangan_check')
const rc = await chk.execute({})
check('dangan_check 返回 ok', rc.ok === true)
check('dangan_check 输出是给模型看的文本', typeof rc.text === 'string' && rc.text.includes('dangan_check'))

// ============================================================
// 2026-09-18 工具合并（10 → 6）：**一个工具四种 scope / 两种读法** 的路由对不对
// ============================================================
console.log('')
console.log('— 合并后的路由 —')

check(
  'scope 支持三种（all / overview / map —— 🔴 2026-10-15 `index` 随事件表退役）',
  JSON.stringify(chk.parameters.properties.scope.enum) === JSON.stringify(['all', 'overview', 'map'])
)
check('mode 支持四种（check / render / apply / detail）', JSON.stringify(chk.parameters.properties.mode.enum) === JSON.stringify(['check', 'render', 'apply', 'detail']))

const rOv = await chk.execute({ scope: 'overview' })
check('scope=overview 走总览那条路（读不到也说得出话）', /dangan_check · overview/.test(rOv.text))

const rRecent = await search.execute({ mode: 'recent' })
check('mode=recent 走读法那条路（🔴 2026-10-14 起：数据源＝《索引》的 L3 节，不再是时间轴）', /dangan_search · recent/.test(rRecent.text) && /最近 \d+ 件/.test(rRecent.text))

let threw2 = false
try {
  await search.execute({ mode: 'search' })
} catch {
  threw2 = true
}
check('🔴 mode=search 缺 query 仍然抛错（并成一个工具之后这条门槛不能丢）', threw2)

let threw3 = false
try {
  await search.execute({})
} catch {
  threw3 = true
}
check('🔴 不写 mode 时默认 search，同样要求 query', threw3)

// ============================================================
// 2026-10-16：`scope` 扩到 7 层 —— `L5`/`L6` 平时按语义跳过（`walk`），**点名才进**
//   （走 `CFG.scanForcedDirs` 强制扫；⚠️ 白名单要**层目录全名**，塞 `L6` 因全等比对等于没塞 —— 实测扫 0 份）
// ============================================================
console.log('')
console.log('— scope 扩层 —')

check(
  'scope 的枚举是 7 层 ＋ all',
  JSON.stringify(search.parameters.properties.scope.enum) === JSON.stringify(['all', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L8'])
)

const rAll = await search.execute({ query: '梅莫莉亚' })
check('默认 all：**不碰** L5/L6（那是原始证据与临时件）', !rAll.text.includes('L5-证据') && !rAll.text.includes('L6-工具临时'))

const rL5 = await search.execute({ query: '梅莫莉亚', scope: 'L5' })
check('点名 L5：进得去（命中 L5-证据 那份）', rL5.ok === true && rL5.text.includes('L5-证据'))

const rL6 = await search.execute({ query: '梅莫莉亚', scope: 'L6' })
check('点名 L6：进得去（命中快照副本）', rL6.ok === true && rL6.text.includes('L6-工具临时'))

const rAll2 = await search.execute({ query: '梅莫莉亚' })
check('🔴 点名扫完**不留全局副作用**（再搜 all 仍不含 L5/L6）', !rAll2.text.includes('L5-证据') && !rAll2.text.includes('L6-工具临时'))

done()
