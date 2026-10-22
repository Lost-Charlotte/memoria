/**
 * `tools/引用改写.mjs` 的测试 —— 🔴 **2026-10-08 加**（加 `--map` 映射表模式时一并补）
 *
 * 为什么必须测：《施工手册》坑 15 ——「**凡"会自动改档案"的东西，写完必须让人从"怎么把它弄坏"的
 * 方向再审一遍**」。它自己虽然一个字不写（真落走 `改档.mjs --txn`），但它**生成事务** ⇒
 * 事务算错就是把档案改错。而 2026-10-08 之前，这份工具**一条测试都没有**。
 *
 * ⚠️ 两个技术约束（都踩过）：
 *   ① 它是**独立脚本**（顶层就跑 + `process.exit`）⇒ **不能 import**，只能起进程；
 *   ② 本机沙箱下 `spawnSync` 带 `stdio:'pipe'` 会 **EPERM**（《施工手册》坑 11）⇒ 输出**重定向到文件**再读。
 *
 * 跑法：node tests/引用改写.mjs
 */
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

const HOME = sandboxHome()
const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, '..', 'tools', '引用改写.mjs')

/** 样本档案：三种形状各来一处 —— 单引用 / 一行两个号 / 历史叙述。 */
const root = makeArchive('refmap', {
  '从这开始读.txt': '入口\n',
  'L1-必读/甲.md': '第一处：这里引用了 F8 代号。\n第二处：F8 与 F9 同时出现在这一行。\n',
  'L3-知识/乙.md': '历史叙述：当年它叫 F8（后来改成了别的）。\n',
})

/**
 * 起一次工具 —— **输出重定向到文件**（坑 11：pipe 会 EPERM）。
 * @returns {{status:number, out:string}}
 */
function run(args) {
  const log = join(HOME, `out-${Math.random().toString(36).slice(2, 8)}.txt`)
  const fd = openSync(log, 'w')
  let status = 1
  try {
    const r = spawnSync(process.execPath, [TOOL, ...args], {
      cwd: join(HERE, '..'),
      env: { ...process.env, GAI_DANG_ROOT: root },
      stdio: ['ignore', fd, fd],
    })
    status = r.status ?? 1
  } finally {
    closeSync(fd)
  }
  return { status, out: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

const T = (...p) => join(tmpdir(), `refmap-${process.pid}-${p.join('-')}`)

// ── ① 正常映射：一次换一批 ────────────────────────────────
const map1 = T('map1.tsv')
writeFileSync(map1, '# 自测\nF8\tE99\n', 'utf8')
const list1 = T('list1.tsv')
const r1 = run(['--map', map1, '--out', list1])
check('--map 跑得通（退出码 0）', r1.status === 0)
const body1 = existsSync(list1) ? readFileSync(list1, 'utf8') : ''
check('清单写出来了', body1.includes('# 引用改写清单'))
const rows1 = body1.split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('\t'))
console.log('  · 诊断 清单头：', body1.split(/\r?\n/)[1])
console.log(
  '  · 诊断 命中行数：',
  rows1.length,
  '｜前 2 行：',
  rows1
    .slice(0, 2)
    .map((l) => l.split('\t').slice(0, 5).join(' | '))
    .join('  ///  '),
)
// ⚠️ **3 行**（不是 2）：样本里 `乙.md` 那句「历史叙述：当年它叫 F8」**也会被扫出来** ——
//    这正是这份工具的用法：它**只负责列全**。"这处该改还是该留"由人逐处定（历史叙述填 `留`）。
check('清单头写明"映射 N 对 + 命中几行"', /# 映射 1 对（F8→E99）—— 命中 3 行/.test(body1))
check('样本档案里 3 行命中 F8（甲.md 两行 ＋ 乙.md 的历史叙述一行）', rows1.length === 3)
check('第 3 列预填成「改」', rows1.every((l) => l.split('\t')[2] === '改'))
check('第 4 列预填成整行新文本（旧值已换成新值）', rows1.every((l) => l.split('\t')[3].includes('E99')))
check('第 5 列自带"要找什么"（--plan 靠它）', rows1.every((l) => l.split('\t')[4] === 'F8'))

// ── ② 同一行两个号：必须**合并成一条** op ──────────────────
const map2 = T('map2.tsv')
writeFileSync(map2, 'F8\tX1\nF9\tX2\n', 'utf8')
const list2 = T('list2.tsv')
run(['--map', map2, '--out', list2])
const rows2 = readFileSync(list2, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && l.includes('\t'))
// ⚠️ 判"是哪一行"必须看**第 6 列（原行）**，不能用 `includes` —— 清单**还带上下文列**，
//    第一处的"下文"里就是第二处的原文 ⇒ `includes('第二处')` 会把它也算进来（我第一版就栽在这）。
const twoHitLines = rows2.filter((l) => l.split('\t')[5].includes('第二处'))
check('🔴 一行里两个号 ⇒ **只出一条**（不是两条打同一行）', twoHitLines.length === 1)
check('🔴 那一条把两个号都换了（X1 与 X2 都在新文本里）', /X1/.test(twoHitLines[0]) && /X2/.test(twoHitLines[0]))

// ── ③ 冲突：换完仍含另一个待换的旧值 ⇒ 清单头告警 ──────────
const map3 = T('map3.tsv')
writeFileSync(map3, 'F8\tF9\nF9\tZ9\n', 'utf8')
const list3 = T('list3.tsv')
run(['--map', map3, '--out', list3])
const body3 = readFileSync(list3, 'utf8')
check('🔴 有冲突时清单头出告警行', /⚠️ \*\*\d+ 处冲突\*\*/.test(body3))

// ── ④ --plan 默认干跑：**一个字都不写**（这是底线）──────────
const map4 = T('map4.tsv')
writeFileSync(map4, 'F8\tE99\n', 'utf8')
const list4 = T('list4.tsv')
run(['--map', map4, '--out', list4])
const before = readFileSync(join(root, 'L1-必读', '甲.md'), 'utf8')
const r4 = run(['--plan', list4])
check('--plan 能读这份清单（退出码 0）', r4.status === 0)
check('输出里明说这是干跑', /干跑/.test(r4.out))
check('🔴 干跑之后样本档案**一个字节没变**', readFileSync(join(root, 'L1-必读', '甲.md'), 'utf8') === before)

// ── ⑤ --renumber：删了号 ⇒ 后面的自动前移（2026-10-08 加 · 用户拍板的"自愈"）──
{
  const { mkdirSync } = await import('node:fs')
  // 现造一份小时间轴 T1~T5（不动前面几组的样本 —— 它们已经跑完了）
  mkdirSync(join(root, 'L2-数据'), { recursive: true })
  const tl = join(root, 'L2-数据', '时间轴.md')
  const mkRows = (rows) => ['| 等级 | 编号 | 时间 | 发生了什么 |', '|---|---|---|---|', ...rows].join('\n') + '\n'
  const row = (n) => `| ⭐ | **T${n}** | 2026-01-01 00:0${n} | 第 ${n} 件 |`
  writeFileSync(tl, mkRows([row(1), row(2), row(3), row(4), row(5)]), 'utf8')
  const map5 = T('map5.tsv')
  const r5 = run(['--renumber', 'T3,T99', '--out', map5])
  check('--renumber 跑得通（退出码 0）', r5.status === 0)
  const m5 = readFileSync(map5, 'utf8')
  check('🔴 算出的映射：T4→T3、T5→T4（删了 T3 ⇒ 后面往前挪一位）', /\nT4\tT3\n/.test(m5) && /\nT5\tT4\n/.test(m5))
  check('🔴 被删的那个号（T3）**不进映射表** —— 它是"要删的"，不是"要改的"', !/\nT3\t/.test(m5))
  check('🔴 它前面的号（T1、T2）不动', !/\nT1\t/.test(m5) && !/\nT2\t/.test(m5))
  check('点了档案里没有的号（T99）⇒ 告警（防呆）', /本来就不存在/.test(m5))
  // 🔴 端到端：`--renumber` 出的表**能被 `--map` 直接吃**（两个模式接得上 —— 这是"自愈"成链的关键一步）
  const r5b = run(['--map', map5, '--out', T('list5.tsv')])
  check('🔴 端到端：--renumber 的表能被 --map 吃（退出码 0）', r5b.status === 0)
}

// ── ⑥ 换"带层前缀的引用"：旧前缀必须**跟着一起换掉**（2026-10-09 加 · 沙箱真跑抓出来的）──
// 病根：`--map` 一次只扫一个 needle，而 `batch-plan` 喂的是**文件名** ⇒ 引用写成
// `L4-施工\x（已办完）.md` 时只换掉文件名那截，留下 `L4-施工\L8-施工归档\x.md` ⇒ **死指针**。
// 修法（窄）：映射表加**可选第三列＝旧值所在的层前缀**，预填时把那个前缀一起吃掉；
// ⚠️ **只在"旧值与新值的层不同"时才动手** —— 改号（同层）一行行为都不许变。
{
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(root, 'L4-施工'), { recursive: true })
  writeFileSync(
    join(root, 'L4-施工', '甲.md'),
    '带层前缀的引用：见 `L4-施工\\样本-已办完的件（已办完）.md` 里的做法。\n纯文件名引用：见 `样本-已办完的件（已办完）.md`。\n',
    'utf8',
  )
  const map6 = T('map6.tsv')
  writeFileSync(map6, '样本-已办完的件（已办完）.md\tL8-施工归档\\样本-已办完的件.md\tL4-施工\n', 'utf8')
  const list6 = T('list6.tsv')
  const r6 = run(['--map', map6, '--out', list6])
  check('⑥ --map 吃三列表（旧值 TAB 新值 TAB 旧层前缀）也不报错', r6.status === 0)
  const rows6 = readFileSync(list6, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('\t'))
  const rowPre = rows6.find((l) => l.split('\t')[5].includes('带层前缀的引用'))
  const rowBare = rows6.find((l) => l.split('\t')[5].includes('纯文件名引用'))
  check('⑥ 两处引用都被扫出来（带前缀的 ＋ 纯文件名的）', Boolean(rowPre) && Boolean(rowBare))
  console.log(' · 诊断 ⑥ 带前缀那行的前 5 列：', rowPre ? rowPre.split('\t').slice(0, 5).join(' | ') : '（没扫到）')
  console.log(' · 诊断 ⑥ 纯文件名那行的前 5 列：', rowBare ? rowBare.split('\t').slice(0, 5).join(' | ') : '（没扫到）')
  // ⚠️ 断言用 `includes`（不写带反斜杠的正则 —— 模板串里 `\\` 的层数极易写错，我第一版就栽在这）
  const cPre = rowPre ? rowPre.split('\t')[3] : ''
  const cBare = rowBare ? rowBare.split('\t')[3] : ''
  check('🔴 ⑥ 带前缀的：整段换成新位置（旧前缀 L4-施工 不许留下）', cPre.includes('L8-施工归档\\样本-已办完的件.md') && !cPre.includes('L4-施工\\L8-施工归档'))
  check('🔴 ⑥ 纯文件名的：只换名字（不许凭空长出层前缀）', cBare.includes('样本-已办完的件.md') && !cBare.includes('L8-施工归档'))
}

done()
