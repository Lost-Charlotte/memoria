/**
 * F20「从 0 建档案」—— 2026-09-17 晚。跑法：node tests/f20-init.mjs
 *
 * 起因（用户当天定的标准）："**假设梅莫莉亚会作为插件包被上传，那么我总不能上传我的历史信息吧。
 * 同时梅莫莉亚需要有被别人下载后，别人使用 DeepSeek 时，梅莫莉亚可以从 0 建造档案库的能力。**"
 *
 * 这一份断言盯六件事：
 *   ① **全新环境**（目标目录压根不存在）能建出一座"关键件齐全"的档案；
 *   ② 🔴 **只补缺、绝不覆盖** —— 已经存在的文件（哪怕内容被用户改过）一个字都不许动；
 *   ③ **默认干跑**：不给 apply 就一个字节都不写；
 *   ④ 建出来的骨架**真能被插件自己认出来**（`archiveState` 说 ok、时间轴/事件表格式可解析、索引与地图能对上）；
 *   ⑤ **路径不许跑出档案根**；
 *   ⑥ **启动指引**：没有档案时要出声（不再静默失效）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()
const mod = await loadPlugin()
const F20 = await import('../lib/f20-init.js')
const F5 = await import('../lib/f5-check.js')
const F5_STD = F5.STD_FIELDS

/** 一个"干净的目标"：父目录在、目标子目录**不存在**（＝全新环境最常见的形态）。 */
const freshDir = () => join(tmpdir(), `memoria-fresh-${process.pid}-${Math.random().toString(36).slice(2, 7)}`, 'DeepSeek档案')

console.log('')
console.log('—— ① 状态判断 ——')

const d1 = freshDir()
check('目标不存在 → kind=missing', F20.archiveState(d1).kind === 'missing')

const d2 = makeArchive('f20-empty', { '随手放的东西.txt': 'x' })
check('目录在、但关键件一份都没有 → kind=empty', F20.archiveState(d2).kind === 'empty')

const d3 = makeArchive('f20-partial', {
  '从这开始读.txt': '入口\n',
  'L1-必读/铁律.md': '# 铁律\n',
  'L2-数据/时间轴.md': '# 时间轴\n',
})
const st3 = F20.archiveState(d3)
// 🔴 2026-10-14 改：关键件**不再含 L2 两份**（时间轴 / 事件表随 L2 降级派生退役）——
//    判据出处见 `lib/f20-init.js` 的 `archiveState()` 注释；这条断言跟着改，
//    并顺手**反向钉住**：L2 那两份**不许**再出现在 missing 里。
check('关键件缺一半 → kind=partial 且点名缺了什么', st3.kind === 'partial' && st3.missing.includes('使用说明') && !st3.missing.includes('事件表') && !st3.missing.includes('时间轴'))

console.log('')
console.log('—— ② 干跑：一个字节都不写 ——')

const before = existsSync(d1)
const dry = F20.bootstrap({ dir: d1 })
check('干跑时目标目录仍然不存在', !existsSync(d1) && before === false)
check('干跑也把"将要建什么"报出来了（**七层**：`L1`/`L2-用户`/`L3`/`L4`/`L5`/`L6` ＋ `L8-施工归档`）', dry.created.length > 10 && dry.dirs.length === 7)
check('干跑 marked 成 applied:false', dry.applied === false)

console.log('')
console.log('—— ③ 真建：全新环境 ——')

const real = F20.bootstrap({ dir: d1, apply: true })
check('真建成功、没有错', real.ok && real.errors.length === 0)
check(
  '**七个**标准层目录都建出来了（`L1`/`L2-用户`/`L3`/`L4`/`L5`/`L6` ＋ `L8-施工归档`；`L2-用户` 是 2026-10-15 新加的）',
  F20.DIRS.length === 7 && F20.DIRS.includes('L8-施工归档') && F20.DIRS.every((x) => existsSync(join(d1, x))),
)
check('入口文件在', existsSync(join(d1, '从这开始读.txt')))
check('铁律在 L1（按"名字含铁律"能被找到）', existsSync(join(d1, 'L1-必读', '铁律.md')))
check('使用说明在 L1', existsSync(join(d1, 'L1-必读', '使用说明.md')))
check('🔴 旧的 `L2-数据`（时间轴/事件表）**不再建** —— 换成新的 `L2-用户`（2026-10-15 用户定）', !existsSync(join(d1, 'L2-数据')) && existsSync(join(d1, 'L2-用户')))
// 🔴 2026-09-23 六层重划后的分家：**记错本是"已经知道的事" → L3-知识**；**待办是"还没做完的事" → L4-施工**
// 🔴 **2026-10-16 改**：那份 2026-10-15 由《AI错误总账》改名「**记错本.md**」，而插件代码找的也是「记错本」
//    （`f13-anchors.js` 锚点表）⇒ 骨架必须建同名，否则新馆一开箱就「档案缺」。下面连着钉"旧名不再建"。
check('🔴 记错本（原《AI错误总账》）在 L3-知识', existsSync(join(d1, 'L3-知识', '记错本.md')))
check('🔴 旧名 `AI错误总账.md` **不再建**（骨架别带旧名出门）', !existsSync(join(d1, 'L3-知识', 'AI错误总账.md')))
check('🔴 待办在 L4-施工（不在 L3）', existsSync(join(d1, 'L4-施工', '工程-待办.md')))
// 🗑 **2026-10-07：`工程-待补清单.md` 不再进骨架** —— 那份 2026-10-05 已整体作废（用户拍板"不是什么事
//    都落档"，之后"该补的当场补"）⇒ 新馆**不该**开局就带一个废文件。这条钉住"它确实不建"。
check(
  '🔴 已作废的「工程-待补清单」**不再建**（免得新馆开局带一个废文件）',
  !existsSync(join(d1, 'L4-施工', '工程-待补清单.md')),
)
// 🔴 2026-09-26 加：**工程清单也要开箱就有**（否则新用户那一节面板永远是空的、也没人知道有这么一类），
//    而且它**与待办是两份**（用户："**不允许将他们混为一谈**"）。
check('🔴 工程清单也在 L4-施工，且**与待办是两份不同的文件**', existsSync(join(d1, 'L4-施工', '工程-清单.md')) && F20.F.project !== F20.F.todo)

// 🔴 **2026-10-16 加**：`L8-施工归档\待办归档\待办归档.md` **必须开箱就在** ——
//    它是 `dangan_todo clean` 的落点（`f10-todo.js` 的 `todoArchiveTailLine()` 找它最后一行 `|`）。
//    没有它 ⇒ 新馆里**第一次 clean 就报**「归档件读不到或没有表格」。表头也得在（那一行就是追加位置）。
const arcTodo = join(d1, 'L8-施工归档', '待办归档', '待办归档.md')
check(
  '🔴 新馆开箱带 `L8-施工归档\\待办归档\\待办归档.md`（`dangan_todo clean` 的落点）＋ 表头',
  existsSync(arcTodo) &&
    (F20.skeletonFiles('2026-10-16').find((f) => f.rel.includes('待办归档'))?.text ?? '').includes('| 事项 |'),
)
check('🔴 它们**不再**待在 L3-知识', !existsSync(join(d1, 'L3-知识', '工程-待办.md')))
check('防丢失总则在 L1-必读（它是"每次接手先读"的判据，与铁律同层）', existsSync(join(d1, 'L1-必读', '防丢失总则.md')))

const stAfter = F20.archiveState(d1)
check('建完之后她自己认得出"关键件齐全"', stAfter.kind === 'ok')

console.log('')
console.log('—— ④ 🔴 只补缺、绝不覆盖 ——')

// 用户手改过的内容 + 少一个文件 → 再建一次
const keepFile = join(d1, 'L1-必读', '00-总览-我们干过什么.md')
writeFileSync(keepFile, '# 我自己改写过的总览\n这是我的内容，不许被覆盖。\n', 'utf8')
const second = F20.bootstrap({ dir: d1, apply: true })
check('二次建：已有文件全部跳过、一份都不"新建"', second.created.length === 0 && second.skipped.length > 10)
check('🔴 用户改过的内容原封不动', readFileSync(keepFile, 'utf8').includes('这是我的内容，不许被覆盖'))

// 缺一件时能补那一件（这是"补缺"的另一半）
const { rmSync } = await import('node:fs')
rmSync(join(d1, 'L1-必读', '工具速查.md'))
const third = F20.bootstrap({ dir: d1, apply: true })
check('缺的那一件会被补回来（且只补那一件）', third.created.length === 1 && third.created[0].includes('工具速查'))
check('补回来的文件内容不为空', readFileSync(join(d1, 'L1-必读', '工具速查.md'), 'utf8').length > 200)

console.log('')
console.log('—— ⑤ 骨架本身能不能被插件解析（"建出来≠用得了"）——')
// 🔴 2026-10-14 改：原来这一节钉的是 **L2 那两份**（时间轴 / 事件表）的解析 —— 它们随
//    「L2 降级派生」退役、骨架也不再建 ⇒ 那组断言失去对象（**留着就是"看着在跑、其实已死"**）
//    ⇒ 换成钉 L3 这份还在的资产。

// 🔴 **2026-10-16 改**：那份 2026-10-15 已由《AI错误总账》改名「**记错本.md**」—— 骨架建的也是新名。
const ledger = readFileSync(join(d1, 'L3-知识', '记错本.md'), 'utf8')
check('记错本（原《AI错误总账》）在 L3 且非空（它是"已经知道的事"那一类的落点）', ledger.length > 200)

const rules = readFileSync(join(d1, 'L1-必读', '铁律.md'), 'utf8')
check('铁律里有"先在样本上试跑"这条最硬的红线', rules.includes('样本') && rules.includes('试跑'))
check('铁律里写了"不许永久删"', rules.includes('回收站'))
check('铁律里**没有**本机专有的私人信息（不该把历史带进包里）', !rules.includes('admin') && !rules.includes('陈') && !rules.includes('DeepSeek工具箱'))

const howto = readFileSync(join(d1, 'L1-必读', '使用说明.md'), 'utf8')
// 🔴 **2026-10-16 改**：W1（时间轴）/ W2（事件表）随 L2 退役 ⇒ 骨架也不该再教它们；
//    原先那两条"定级"断言（"空白＝还没定级" / "普通必须显式写 ○"）的对象是时间轴，一起下掉。
check('使用说明带全现行的 W 系列（W0 / W3 / W4 / W5 / W6）', ['W0', 'W3', 'W4', 'W5', 'W6'].every((w) => howto.includes(w)))
check('🔴 骨架里**不再**出现时间轴 / 事件表 / T＋E 那套（防回潮）', !/01-时间轴|01-事件表|T ＋ E|T<序号>/.test(howto))
check('使用说明写明"该落 ＝ 决定 / 教训 / 转折"（现行的落档尺子）', howto.includes('决定 / 教训 / 转折'))

const idx = readFileSync(join(d1, 'L1-必读', '索引.md'), 'utf8')
check('索引登记了 L3 的关键件（记错本，原《AI错误总账》）—— L2 那两份退役后，索引由 L3 承接', idx.includes('L3-知识') && idx.includes('记错本')) // 2026-10-14 改：原钉的是"时间轴/事件表在索引里"；2026-10-16 改：总账 10-15 已改名「记错本」
check('索引里没有本机绝对路径', !idx.includes('E:\\') && !idx.includes('C:\\'))

console.log('')
console.log('—— ⑥ 路径不许跑出档案根 ——')

// 真正的越界：把"档案根"指到样本里，然后**从里面往外**建（路径带 `..`）
const outer = makeArchive('f20-outer', { 'L1-必读/铁律.md': '# 铁律\n' })
const innerRoot = join(outer, 'L1-必读')
const inside = F20.bootstrap({ dir: innerRoot, apply: true })
check('把档案根指到子目录时，建出来的东西全在它下面（没有跑到上一层）', inside.created.every((rel) => !rel.includes('..')) && existsSync(join(innerRoot, '从这开始读.txt')))
check('上一层那个"外面的文件"没被碰', readFileSync(join(outer, 'L1-必读', '铁律.md'), 'utf8') === '# 铁律\n')

console.log('')
console.log('—— ⑦ 启动指引：没有档案要出声 ——')

const logs = []
mod.apply(mockCtx(), { archiveDir: freshDir() })
// 🔴 2026-10-22：`log()` **默认不再上控制台**（用户要它闭嘴）⇒ 这里改读**日志文件**，那才是真出处。
//    从前截 `console.log` 的写法，在"默认静音"之后**永远截不到**（这两条断言就是这么红的）。
const C = await import('../lib/common.js')
const logged = (() => {
  try {
    return readFileSync(C.LOG_FILE, 'utf8')
  } catch {
    return ''
  }
})()
logs.push(logged)
check('档案不存在时，启动日志里出现"还没建 + 怎么办"', logs.some((l) => l.includes('档案根不存在') || l.includes('dangan_init')))
check('启动指引指向 dangan_init（而不是只说"读不到"）', logs.join('\n').includes('dangan_init'))

// 同上：这次看"档案齐全时**不**报'档案根不存在'" —— 读日志文件里**这一段**新增的内容。
const beforeLen = (() => {
  try {
    return readFileSync(C.LOG_FILE, 'utf8').length
  } catch {
    return 0
  }
})()
mod.apply(mockCtx(), { archiveDir: d1 })
const afterText = (() => {
  try {
    return readFileSync(C.LOG_FILE, 'utf8').slice(beforeLen)
  } catch {
    return ''
  }
})()
check('档案齐全时**不啰嗦**（不再报"还没有档案"）', !afterText.includes('档案根不存在'))

console.log('')
console.log('—— ⑧ 工具：dangan_init 注册上了；被并掉的旧名字不再注册 ——')

const ctx = mockCtx()
mod.apply(ctx, { archiveDir: freshDir() })
const names = ctx.registered.map((t) => t.name)
check('dangan_init 已注册（F20）', names.includes('dangan_init'))
check('🔴 `dangan_map` **不再注册**（2026-09-18 并进 `dangan_check scope="map"`）', !names.includes('dangan_map'))
check('`dangan_check` 注册了（地图能力从这儿进）', names.includes('dangan_check'))

const initTool = ctx.registered.find((t) => t.name === 'dangan_init')
const quiet = () => {}
const beforeQuiet = console.log
console.log = quiet
const outDry = await initTool.execute({})
console.log = beforeQuiet
check('dangan_init 默认干跑，输出里写明"一个字都没写"', String(outDry.text).includes('干跑') || String(outDry.text).includes('一个字都没写'))

console.log('')
console.log('—— ⑨ 🔴 开箱体检 0 错（**这条一直没人钉** —— 讨论稿 §62 早就点出来了）——')
// 🔴 为什么要它：骨架自己必须**不自相矛盾**（索引不漏登记 / 没有死指针 / 每张表列数一致 ……）。
//    2026-10-07 用户在新馆实测到「**索引漏登记 7 · 死指针 6**」：根因是**骨架的索引表写的是老馆旧名**
//    （`00-必读-铁律.md` 这一族），而骨架实际建的是 `铁律.md` ⇒ **每个新馆开局都带病**。
//    这一条一加，**骨架再漂就当场红**。
{
  const { CFG } = await import('../lib/common.js')
  const { checkArchive } = await import('../lib/f5-check.js')
  const { tmpdir } = await import('node:os')
  // ⚠️ **要用一份全新的干净骨架**来体检 —— `d1` 已经被这个测试自己改过（上面"只补缺、绝不覆盖"
  //    那一节**故意**造了一份旧名的 `00-总览-我们干过什么.md`），拿它体检会误报"索引漏登记 1 份"。
  const d99 = join(tmpdir(), `memoria-obox-${process.pid}-${Math.random().toString(36).slice(2, 7)}`)
  const fresh = F20.bootstrap({ dir: d99, apply: true })
  const keepDir = CFG.archiveDir
  CFG.archiveDir = d99 // 体检按"当前档案根"扫
  let issues = []
  try {
    issues = checkArchive().filter((x) => x.lv === '错')
  } finally {
    CFG.archiveDir = keepDir
  }
  for (const x of issues.slice(0, 10)) console.log(`    · ${x.file}${x.line ? `:${x.line}` : ''} · ${x.msg}`)
  check(
    `🔴 **开箱体检 0 错**（新骨架：建 ${fresh.created.length} 份 / ${fresh.dirs.length} 个目录 · 实得 ${issues.length} 条错）`,
    issues.length === 0,
  )
}

done()
