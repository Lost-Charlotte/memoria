/**
 * F17 档案地图（网页面板的**主区**数据源）—— 2026-09-17 下午。
 * 跑法：node tests/f17-map.mjs
 *
 * 它替用户回答一个问题：**"整个档案馆长什么样、谁负责哪一块"**。所以断言分五组：
 *   ① 结构：五层都在、层内文件与行数算得对（**数行数的方法必须与那台生成器一致**，否则快照对比天天误报）；
 *   ② 职责：从 `索引.md` 现取（取到 / 没登记 都要分得清）；
 *   ③ 对账：索引漏登记 / 索引死指针，机器算得出来；
 *   ④ 快照：那份 .md 是不是旧了（**两份各说各话要能当场看见**）；
 *   ⑤ 分室：写入口 / 哨兵 / 读用工具 / 钩子，代号一个不漏、一个不重。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const IDX = [
  '# 索引',
  '',
  '| 文件 | 内容 | 何时读 |',
  '|---|---|---|',
  '| `L1-必读/00-必读-铁律.md` | ⭐ 红线一页 | 接活前 |',
  '| `L1-必读/索引.md` | 总目录 | 想知道翻哪份时 |',
  '| `L2-数据/01-时间轴-我们做过什么.md` | 按时间 | 查某天 |',
  '| `L3-知识/没有这个文件.md` | 死指针（实际不存在） | —— |',
  '',
].join('\n')

const MAP = [
  '# 地图 · 档案结构（机器生成）',
  '',
  '## 梅莫莉亚 ↔ 档案：一一对应',
  '',
  '| 梅莫莉亚的部件 | 它管档案的哪一块 | 对档案的权限 |',
  '|---|---|---|',
  '| 压缩后重注入（F1） | 读入口 + 铁律 → 压缩后塞回上下文 | 只读 |',
  '| **落笔半（F9 · 2026-09-17 建成）** | 把改动交给 `改档.mjs --txn` | ⚠️ **唯一被允许写档案的零件** |',
  '',
  '> L1~L9 正文文件共 **10 个**（不含子目录内），其中 md/txt **51 行**。',
  '',
].join('\n')

const TODO = [
  '# 待办',
  '',
  '## 二、还没了结的',
  '',
  '| 事项 | 卡在哪 | 怎么算结 |',
  '|---|---|---|',
  '| **把地图搬进面板** | 等用户点头 | 面板能看分层与分室 |',
  '| **旧的那件事** | 没线索 | 找到为止 |',
  '',
].join('\n')

const files = {
  '从这开始读.txt': '入口\n',
  'L1-必读/_说明-读我.txt': 'L1 说明\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n一\n二\n三\n',
  'L1-必读/00-总览-我们干过什么.md': '# 总览\n**故意没登记进索引**\n',
  'L1-必读/索引.md': IDX,
  'L1-必读/地图-档案结构（机器生成）.md': MAP,
  'L2-数据/01-时间轴-我们做过什么.md': '# 时间轴\n| ○ | **T1** | 2026-09-17 10:00 | 甲 |\n',
  'L2-数据/01-事件表-我们做过什么.md': '# 事件表\n| E1 | **甲** |\n',
  'L3-知识/待办-未完成事项.md': TODO,
  'L3-知识/记录-某件事.md': '# 记录\n甲\n乙\n',
  'L5-证据/_说明-读我.txt': 'L4 说明\n',
  'L5-证据/某备份/原始脚本.ps1': 'Write-Host 1\n',
  'L5-证据/某备份/日志.txt': 'a\nb\n',
  'L6-工具临时/快照/一张快照.md': '快照\n',
}

const root = makeArchive('f17', files)
const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })
// 🔴 2026-10-07 定案（那条待办的答案）：**`f32` 的启动选馆会按"馆表里记着的那个"改写 `apply()` 传进来的
//    档案根** —— 那是**生产里要的行为**（"记住上次选择的馆 ＋ 坏了回退"，用户 2026-09-24 定），**不是 bug**；
//    但**测试必须显式钉住**自己的沙箱根，否则整套断言会拿**真档案**去比（实测数出 `L1 实得 8` ＝ 真档案的份数）。
//    ⚠️ **为什么以前一直绿**：那时馆表里只有一个馆，挑来挑去还是它；用户 2026-10-07 新建第二个馆之后就露了。
{
  const { CFG } = await import('../lib/common.js')
  CFG.archiveDir = root
}

const { buildMapData, readSnapshot, reportF17 } = await import('../lib/f17-map.js')
const { manifestProblems, ROOMS, CAPS } = await import('../lib/manifest.js')

/** 跑之前先把整棵树的"内容指纹"记下来 —— 跑完必须一模一样（**只读**不是嘴上说的）。 */
const fingerprint = () => {
  const out = []
  const walk = (dir, pre = '') => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        out.push(`D ${pre}${e.name}`)
        walk(p, `${pre}${e.name}/`)
      } else out.push(`F ${pre}${e.name} ${statSync(p).size} ${readFileSync(p, 'utf8').length}`)
    }
  }
  walk(root)
  return out.join('\n')
}
const before = fingerprint()

const m = buildMapData()

console.log('—— ① 结构 ——')
check('五层都在，顺序与档案一致', m.layers.map((x) => x.name).join(',') === 'L1-必读,L2-数据,L3-知识,L5-证据,L6-工具临时')
const l1 = m.layers[0]
check(`L1 根下 5 份（实得 ${l1.fileCount}）`, l1.fileCount === 5)
check('L1 有 0 个子目录', l1.dirCount === 0)
// ⚠️ 层号 2026-09-26 改过名（L4-证据备份→L5-证据）：这里按**下标**取，改名后下标不变
const l5 = m.layers[3]
check('L5-证据 认出 1 个子目录（不逐文件展开）', l5.dirCount === 1 && l5.dirs[0].files === 2)
check('L5-证据 根下只算根下的文件', l5.fileCount === 1 && l5.total === 3)
const tie = l1.files.find((f) => f.name === '00-必读-铁律.md')
check('行数用 `split(/\\r?\\n/).length` 数（与那台生成器一致：4 行文本 = 5）', tie.lines === 5)
check('非 md/txt 也有"多大"（字节）', l1.files.every((f) => typeof f.bytes === 'number' && f.bytes > 0))
check('根下那份从这开始读.txt 不在任何层里（它是入口，不在 L* 目录下）', m.totals.all > m.totals.files)

console.log('')
console.log('—— ② 职责：从索引现取 ——')
check('取到职责（铁律那份）', /红线/.test(tie.duty))
check('"何时读"那一列也取出来了（面板详情卡要用）', /接活前/.test(tie.when))
check('每层带 `linesTotal`（顶上那张"体量图"按它分宽度）', m.layers.every((L) => typeof L.linesTotal === 'number') && l1.linesTotal === 30)
check('没登记的那份被标出来', l1.unregistered.includes('00-总览-我们干过什么.md'))
check('登记过的不算未登记', !l1.unregistered.includes('00-必读-铁律.md'))
check('L5/L6 **不**参与"未登记"（那两层按规矩不登记，别对它们喊）', l5.unregistered.length === 0 && m.layers[4].unregistered.length === 0)
check('职责取不到时留空、不编', m.layers[2].files.find((f) => f.name === '记录-某件事.md').duty === '')

console.log('')
console.log('—— ③ 对账（机器算的）——')
check(`漏登记 ${m.index.missing.length} 个（样本里就没全登记）`, m.index.missing.length === 5)
check('那份"故意没登记"的总览在漏登记名单里', m.index.missing.some((x) => x.includes('00-总览')))
check('🔴 "索引自己"**不算**漏登记（它按规矩不进索引；2026-09-27 起地图与体检都认这一条）', !m.index.missing.some((x) => /索引\.md$/.test(x)))
check(`死指针 ${m.index.dead.length} 条（索引指向不存在的文件）`, m.index.dead.length === 1 && m.index.dead[0].includes('没有这个文件'))
check('漏登记进了 `problems`（面板/自检能看见）', m.problems.some((p) => /漏登记/.test(p)))

console.log('—— ③·二 索引改成**两栏**之后，解析器也得认（2026-09-27）——')
// 🔴 起因：索引改成 `| 文件 | 一句话 |`（用户当天拍板"一句话说清它做什么"）之后，
//    `indexDuty()` 的正则**还写死"三栏"** —— 它一个文件都没解析出来，地图当场报
//    "索引漏登记 51 个"。**改了格式不改解析器＝静默失效**（同一天 A 关就是这么坏的）。
//    这条钉住：**两栏表与三栏表，对账结果必须一模一样**。
const idxAbs = join(root, 'L1-必读', '索引.md')
const idxBefore = readFileSync(idxAbs, 'utf8')
// ⚠️ 这份测试里 `writeFileSync` 是**后面才 const 解构**出来的（TDZ：这里直接用它会报
//    "Cannot access before initialization"）—— 所以另起一个别名，别去动后面那行。
const { writeFileSync: wfs } = await import('node:fs')
wfs(
  idxAbs,
  [
    '# 索引',
    '',
    '| 文件 | 一句话：它是做什么的 |',
    '|---|---|',
    '| `L1-必读/00-必读-铁律.md` | ⭐ 红线一页 |',
    '| `L1-必读/索引.md` | 总目录 |',
    '| `L2-数据/01-时间轴-我们做过什么.md` | 按时间 |',
    '| `L3-知识/没有这个文件.md` | 死指针（实际不存在） |',
    '',
  ].join('\n'),
  'utf8',
)
const m2 = buildMapData()
check(`两栏表：登记照样认得出（漏登记 ${m2.index.missing.length} 个，须与三栏表一致）`, m2.index.missing.length === 5)
check(`两栏表：死指针照样认得出来（${m2.index.dead.length} 条）`, m2.index.dead.length === 1 && m2.index.dead[0].includes('没有这个文件'))
check(
  '两栏表：职责那一格取得到（旧写法里"何时读"为空 —— 那是正常的，不算解析失败）',
  m2.layers[0].files.find((f) => f.name === '00-必读-铁律.md').duty !== '',
)
wfs(idxAbs, idxBefore, 'utf8')
check('试完把样本索引还原了', readFileSync(idxAbs, 'utf8') === idxBefore)

console.log('')
console.log('—— ④ 快照：那份 .md 旧没旧 ——')
const snap = readSnapshot()
check('读到了"谁管哪块"那张表（2 条）', snap.corr.size === 2)
check('读到了 F9 那条的权限原文', /唯一被允许写/.test(snap.corr.get('F9').perm))
check('读到了 .md 自称的总数', snap.files === 10 && snap.lines === 51)
check('总数与现算一致 → 不算旧', m.snapshot.exists === true && m.snapshot.stale === false)
// ⚠️ "只读"这条**必须在这儿查** —— 下面那步要故意往档案里加一份文件（否则就被它污染了）
check('跑完档案一个字节都没动', fingerprint() === before)
// 现在往档案里加一份文件 → 现算会变，快照没变 → 必须报"旧快照"
const { writeFileSync } = await import('node:fs')
writeFileSync(join(root, 'L3-知识/新加的一份.md'), '# 新的\n一\n', 'utf8')
check('加了一份文件之后 → **报"快照是旧的"**（两份不能各说各话）', buildMapData().snapshot.stale === true)

console.log('')
console.log('—— ⑤ 分室（面板"按功能分室"那一页）——')
check(
  '七间室，写入口排第一（2026-09-25 起闸门单立一间 · 2026-10-21 加「总控」一间给 F38）',
  m.rooms.map((r) => r.room).join(',') === '写入口,闸门,档案馆,总控,哨兵,读用工具,钩子',
)
const roomOf = (code) => (m.rooms.find((r) => r.items.some((x) => x.code === code)) || {}).room
check(
  'F6 在"写入口"，F7 / F30 在"闸门"（F9 已并进 F6「写档案」，不再单独占位）',
  roomOf('F6') === '写入口' && roomOf('F7') === '闸门' && roomOf('F30') === '闸门',
)
check('F5 体检 / F13 锚点 / F14 凭据 在"哨兵"', roomOf('F5') === '哨兵' && roomOf('F13') === '哨兵' && roomOf('F14') === '哨兵')
// F17 已并进 F5（"档案体检 + 档案地图"），不再单独占"读用工具"一间。
check('分室条目带上了"它管哪一块"（取自快照那张表）', /压缩后塞回上下文/.test(m.rooms.flatMap((r) => r.items).find((x) => x.code === 'F1').scope))
check('每个能力**恰好**分到一间室（机械可判）', manifestProblems().length === 0)
check(`能力总数 ${CAPS.length} = ROOMS 里的条目数 ${ROOMS.flatMap((r) => r[1]).length}`, CAPS.length === ROOMS.flatMap((r) => r[1]).length)
// 闸门表（2026-09-25 加 · 用户："我需要了解我们一共有多少闸门"）：**两套共 11 道** ——
// 面板「闸门」那一页逐道摆的就是它；漏摆一道就红。（`import` 在顶层任意位置都合法。）
// 落档闸门现为 **2 道**（G2 / G5）。
// 🔴 **2026-10-22：13 → 11**（0.81.12 删了「第 6 关 重复读」和「工具说明书闸门」，
//    而这张表没跟着改 —— 结果面板上摆着两道**已经不存在的关**，用户的眼睛被骗了一整天）。
//    📌 **这个数字是活的**：删关就得改这儿；**别再从别处抄一个数字过来**。
import { GATES } from '../lib/manifest.js'
check(
  '闸门表：两套共 11 道（落档闸门 2 ＋ 动手前门卫 9）',
  GATES.length === 2 && GATES.reduce((n, g) => n + g.items.length, 0) === 11,
)
check(
  '闸门表每道都写清了"什么时候触发"与"管哪些工具"',
  GATES.every((g) => g.when && g.act && g.items.every((it) => it.key && it.name && it.what && it.on)),
)

console.log('')
console.log('—— ⑥ 只读 + 自检出声 ——')
const afterWrite = fingerprint()
const said = reportF17()
check('自检**说得出话**（沉默 ≠ 正常）', typeof said === 'string' && said.includes('档案地图 F17') && said.includes('层'))
check('自检把"漏登记/死指针"报出来了', /漏登记 \d+/.test(said) && /死指针 1/.test(said))
check('自检也不动档案（读一遍就走）', fingerprint() === afterWrite)

console.log('')
console.log('—— ⑦ 自动重出（用户："这地图就不能改成自动更新吗？"）——')
// 造一台**假生成器**（真那台在工具箱里、是唯一的渲染器；插件只负责"替它跑"）：
// 它按与 F17 同口径把总数写回那份 .md，且**恒定 4 行** —— 于是第二遍必然收敛。
// （真生成器要跑两遍，是因为它**把自己也数进去**、写完自己变长，实测差 6 行。）
{
  const { CFG } = await import('../lib/common.js')
  const fake = join(root, '..', `memoria-fake-gen-${process.pid}.mjs`)
  const src = [
    "import { readFileSync, readdirSync, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    `const ROOT = ${JSON.stringify(root)}`,
    "const LAYERS = ['L1-必读', 'L2-数据', 'L3-知识', 'L5-证据', 'L6-工具临时']",
    'let files = 0, lines = 0',
    'for (const L of LAYERS) {',
    '  let es = []',
    '  try { es = readdirSync(join(ROOT, L), { withFileTypes: true }) } catch { continue }',
    '  for (const e of es) {',
    '    if (!e.isFile()) continue',
    '    files += 1',
    "    if (/\\.(md|txt)$/i.test(e.name)) lines += readFileSync(join(ROOT, L, e.name), 'utf8').split(/\\r?\\n/).length",
    '  }',
    '}',
    "const out = ['# 地图（假的，只为测自愈）', '', `> L1~L9 正文文件共 **${files} 个**（不含子目录内），其中 md/txt **${lines} 行**。`, ''].join('\\n')",
    "writeFileSync(join(ROOT, 'L1-必读', '地图-档案结构（机器生成）.md'), out, 'utf8')",
    '',
  ].join('\n')
  writeFileSync(fake, src, 'utf8')

  const { regenMapIfStale, mapRegenState, MAP_STATE } = await import('../lib/f17-map.js')
  writeFileSync(join(root, 'L3-知识/又一份.md'), '# 又\n一\n', 'utf8')
  check('先确认它现在是"旧的"', buildMapData().snapshot.stale === true)

  CFG.mapGenerator = fake
  const r = regenMapIfStale()
  check(`自愈跑成了、而且**跑两遍才收敛**（实得 ${r.ran} 遍）`, r.ok === true && r.ran === 2)
  check('收敛之后：快照与现算一致', buildMapData().snapshot.stale === false)
  const st2 = mapRegenState()
  check('自愈**留了痕**（本地状态文件记着时间与结果）', st2.ok === true && typeof st2.at === 'string' && st2.at.length > 10)
  check('状态文件在 ~/.dsh，不在档案里', !MAP_STATE.startsWith(root))

  // 生成器不在 → **不炸**，地图停在旧版（fail-open）
  writeFileSync(join(root, 'L3-知识/再一份.md'), '# 再\n一\n', 'utf8')
  CFG.mapGenerator = join(root, '..', '不存在的生成器.mjs')
  let threw = false
  let r2 = null
  try {
    r2 = regenMapIfStale()
  } catch {
    threw = true
  }
  check('🔴 生成器不在 → **不抛错**（fail-open，绝不影响别的能力）', threw === false)
  check('如实报"生成器不在"，ran=0', Boolean(r2) && r2.ok === false && r2.ran === 0 && /生成器不在/.test(r2.why))
  check('地图**停在旧版**（没被写坏）', buildMapData().snapshot.stale === true)
  check('假生成器只写了那一处（其它文件没被碰）', readFileSync(join(root, 'L1-必读', '地图-档案结构（机器生成）.md'), 'utf8').includes('假的，只为测自愈'))
}

done()
