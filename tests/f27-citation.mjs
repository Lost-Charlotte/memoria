// ============================================================
// F27 引用对账哨兵 —— 测试（2026-09-18）
// ============================================================
// 用户定的三档：**搜不到→错 · 类似→提示 · 全绿→沉默**；另加两档：**没标锚→提示 · 锚是死的→错**。
//
// ⚠️ 样本目录建在系统 TEMP 里，**跑完不删**（《总账》那条教训：临时样本要么留给系统清、
//    要么走 `recycle-del.ps1` —— 不许用永久删）。TEMP 本来就会被系统回收。

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CFG } from '../lib/common.js'
import { citationScan } from '../lib/f27-citation.js'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    console.log(`  ❌ ${name}${extra ? ` ｜ ${extra}` : ''}`)
  }
}

const root = mkdtempSync(join(tmpdir(), 'f27-sample-'))
for (const d of ['L1-必读', 'L2-数据', 'L3-知识']) mkdirSync(join(root, d), { recursive: true })

writeFileSync(
  join(root, 'L1-必读', '样本.md'),
  [
    '# 样本（含五种引用）',
    '用户原话〔T1〕："这是对的那句话"',
    '用户原话〔T2〕："这句话根本不在那里"',
    '用户原话〔T3〕："这是对的那句话但改了几个字变成类似的意思"',
    '用户原话："这句话没标出处"',
    '用户原话："该记没记"',
    '用户原话："补锚要写成形如〔T312〕这样"',
    '用户原话〔T9〕："锚是死的"',
    // 🔴 2026-09-20 加：`〔会话〕` ＝ "当场原话，档案里没有它的锚"（编号是**这次落档才生成**的，无处可补）
    '用户原话〔会话〕："这是当场说的原话"',
    '用户原话〔会话 2026-09-20〕："这也是当场说的，带日期"',
  ].join('\n'),
  'utf8',
)

writeFileSync(
  join(root, 'L2-数据', '01-时间轴-我们做过什么.md'),
  [
    '| 等级 | 编号 | 时间 | 发生了什么 |',
    '|---|---|---|---|',
    '| ○ | **T1** | 2026-09-18 21:00 | 用户说"这是对的那句话"，就这些 |',
    '| ○ | **T2** | 2026-09-18 21:01 | 完全无关的内容 |',
    '| ○ | **T3** | 2026-09-18 21:02 | 用户说"这是对的那句话只不过换了个说法" |',
  ].join('\n'),
  'utf8',
)

const oldDir = CFG.archiveDir
CFG.archiveDir = root
try {
  const s = citationScan()
  const mine = s.hits.filter((h) => h.label.startsWith('档案 L1-必读/'))
  const find = (frag) => mine.find((h) => String(h.quote).includes(frag))
  const bad = mine.filter((h) => h.level === '错')
  const tips = mine.filter((h) => h.level === '提示')

  console.log('— F27：三档判得对 —')
  check('① 对得上的 → **绿、不报**（"全绿自然无事发生"）', !mine.some((h) => String(h.quote) === '这是对的那句话'), JSON.stringify(mine.map((h) => h.quote)))
  // 🔴 2026-10-15：**「② 搜不到」与「③ 类似」两条随 L2 退役删除** —— 它们要拿锚（T/E）去**时间轴/事件表**
  //    取正文来比；两份文件都不在了 ⇒ 无从核起（`sourceOf` 恒 null，调用处已改为**跳过而非判死**）。
  check('④ 没标出处的 → **提示**（待补锚）', find('没标出处')?.level === '提示', find('没标出处')?.why)
  // 🔴 2026-10-15：「⑤ 锚是死的 → 错」随 L2 退役删除（同②③：T/E 的正文源没了，判死会变成整片假报）。
  // 2026-09-19 加：先把"这到底算不算引用"分开 —— 存量实测 68 处里约 40 处压根不是引用，
  // 混在"待补锚"里人就核不动（那正是这条待办卡住的真正原因）。
  check('⑦ 引文太短（归一化后 <6 字）→ **不算引用**，单独一类', find('该记没记')?.kind === 'short', find('该记没记')?.why)
  check('⑧ 在讲引用格式本身 → **不算引用**，单独一类', find('形如')?.kind === 'meta', find('形如')?.why)
  check(
    '⑨ 那两类**不会被催着补锚**（措辞里没有"待补锚"）',
    !/待补锚/.test(String(find('该记没记')?.why)) && !/待补锚/.test(String(find('形如')?.why)),
  )
  check(
    '⑥ 计数对得上：错 0 · 提示 3',
    bad.length === 0 && tips.length === 3,
    `错 ${bad.length} / 提示 ${tips.length}（${mine.map((h) => `${h.level}:${h.kind ?? '-'}:${h.quote.slice(0, 12)}`).join(' ')}）`,
  )

  // 🔴 2026-09-20 加：`〔会话〕` —— 当场原话、档案里没有它的锚
  //   起因：落档时引"用户**当场**说的原话"，那一刻还没有 T/E 编号可锚（编号是这次落档才生成的）
  //   → 每落一次档报一次"待补锚"，而根本无处可补。用户："实在不行先把小尾巴解决了吧…我不想这种事情分散你的注意力"。
  console.log('')
  console.log('— 🔴 〔会话〕：不打扰，但看得见 —')
  check('⑩ 标了〔会话〕的 → **不报这一条**', !find('这是当场说的原话'), JSON.stringify(mine.map((h) => h.quote)))
  // 🔴 2026-09-21 改：带日期的 `〔会话〕` 从"真核"降为"核不到就提示"——
  //    材料（said.js）只在内存、只覆盖当前会话，**历史会话的引文必然核不到**，
  //    再报成"错"就是假阳性（实测 7 处 09-20 晚的原话全中）。**但不放过**：仍进"提示"档。
  // ⚠️ 这一条在"**材料为空**"的上下文里跑 —— 那时核不了就**不指控**，带日期那条根本不会进 hits；
  //    "带日期 ＋ 材料非空但没这句 → 降成提示"由下面的 ⑰ 覆盖，两条各测一边。
  check('⑪ 带日期的写法〔会话 2026-09-20〕也认（不被当成"没标出处"）', !find('带日期'))
  // ⚠️ 用 `>=` 而不是 `==`：扫描面**不止样本档案**（插件源码里引的用户原话也算），所以总数会多于样本里的 2 条。
  check('⑫ 但它**照样被数出来**（不打扰 ≠ 看不见，暴涨就是滥用）', s.sessionMarked.length >= 2, `实得 ${s.sessionMarked.length}`)

  console.log('')
  console.log('— 🔴 〔会话〕不是免罪符：机器真去"你说过的话"里核（2026-09-20 加）—')
  // 用户当天点破："你一句'是现在刚说的'不也能轻易骗过你这个系统" —— 说得对，光靠标记就是我的自觉。
  // 所以标记本身不算数：机器拿引文去"本会话里用户说过的话"里搜（见 lib/said.js）。
  const S = await import('../lib/said.js')
  // ⚠️ 只认**样本档案**里的命中 —— F27 的扫描面**不止档案**（插件自己的源码里引了用户原话也会被它核，
  //    这是对的；但断言得限定在样本上，否则别处那句话漏进来就会把这条测试搞红）。
  const mineOf = (r) => r.hits.filter((h) => String(h.label).startsWith('档案 L1-必读/'))
  S.__resetSaid()
  const rNo = citationScan()
  check('⑬ 会话记录为空 → **不指控**（"探测不到 ≠ 不存在"）', mineOf(rNo).every((h) => h.kind !== 'notSaid'))
  S.noteUserSaid('X', '这是当场说的原话')
  S.noteUserSaid('X', '这也是当场说的，带日期')
  const rYes = citationScan()
  check(
    '⑭ 两句都真说过 → 照样不报、但数得出来',
    mineOf(rYes).every((h) => h.kind !== 'notSaid') && rYes.sessionMarked.length === 2,
    `notSaid=${mineOf(rYes).filter((h) => h.kind === 'notSaid').length}`,
  )
  // 🔴 2026-09-21 改：⑮ 原来拿"**带日期**那句"当"编造样本"——而它现在会降成提示
  //    （历史会话的引文，材料只在内存、核不了），继续拿它测"凭空引用"就测不到了。
  //    改成**材料里放一句不相干的话**来造"明确搜不到"（材料非空、但就是没这句）。
  S.__resetSaid()
  S.noteUserSaid('X', '一句跟样本不相干的话')
  const rHalf = citationScan()
  const notSaid = mineOf(rHalf).filter((h) => h.kind === 'notSaid')
  check('⑮ 编造（**不带日期**的〔会话〕）→ **仍报错**（凭空引用这一档没放松）', notSaid.length === 1 && notSaid[0].level === '错', JSON.stringify(notSaid.map((h) => h.quote)))
  check('⑯ 话术说清了为什么（要么引错、要么随手标的）', /随手标/.test(String(notSaid[0]?.why)))
  const histOnly = mineOf(rHalf).filter((h) => h.kind === 'notSaidHist')
  check('⑰ 带日期的、材料里没有 → **降成提示**（材料只覆盖本会话，核不到 ≠ 没说过）', histOnly.length === 1 && histOnly[0].level === '提示', JSON.stringify(histOnly.map((h) => h.quote)))
} finally {
  CFG.archiveDir = oldDir
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
