// 🔴 隔离（**必须在这份文件的第一个字节**）：把 DSH_HOME 指到临时目录。
//   为什么用 `createRequire`：ESM 会把**所有** `import` 提升到顶部并先求值 ——
//   写成 `process.env.DSH_HOME = ...` 放在哪都没用（它总在 import 之后跑）。
const __m0 = await import('node:module')
const { __cr = __m0.createRequire } = __m0
const __req = __cr(import.meta.url)
process.env.DSH_HOME = __req('node:fs').mkdtempSync(__req('node:path').join(__req('node:os').tmpdir(), 'memoria-home-'))

/**
 * F36 织布机（`lib/loom.js` ＋ `lib/loom-patterns.js` ＋ `dangan_weave`）—— 2026-10-07（织布机工程节点 3）。
 * 跑法：node tests/f36-loom.mjs
 *
 * 断言分四组（对着《工程-织布机-设计（节点3）.md》§四 第⑤步那四条）：
 *   ① **对照**：同样一条线，走织布机 vs 走现有入口（`planCommit` ＋ `runTxnOps`）⇒ **产物逐字节相同**；
 *   ② **拒收**：不合格的线**必须被拒**，而且拒的理由是机械可判的那一类（`kind`）；
 *   ③ **默认不写**：不给 `commit` ⇒ 只出提案，**档案逐字节没变**；
 *   ④ **并行一致**：`parallel` 开与关，结果一模一样。
 *
 * 🔴 三条硬规矩（照 `tests/harness.mjs`）：**不依赖本机档案**（现造样本）· **不碰 `~/.dsh`**（DSH_HOME 指沙箱）· 不联网。
 */
const __m1 = await import('node:fs')
const { readFileSync = __m1.readFileSync } = __m1

const __m2 = await import('./harness.mjs')
const {
  check = __m2.check,
  done = __m2.done,
  loadPlugin = __m2.loadPlugin,
  makeArchive = __m2.makeArchive,
  mockCtx = __m2.mockCtx,
  sandboxHome = __m2.sandboxHome,
} = __m2
const __m3 = await import('../lib/f9-commit.js')
const { planCommit = __m3.planCommit, runTxnOps = __m3.runTxnOps } = __m3
const __m4 = await import('../lib/loom.js')
const { weavePlan = __m4.weavePlan } = __m4

sandboxHome()

// ---- 样本档案（照 `tests/f9-commit.mjs` 的样本，外加一份最小待办）----
const T = [
  '| 等级 | 编号 | 时间 | 发生了什么 |',
  '|---|---|---|---|',
  '| ○ | **T1** | 2026-09-16 10:00 | 甲 |',
  '| ⭐ | **T2** | 2026-09-16 11:00 | 乙 |',
  '',
].join('\n')

const E = [
  '| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |',
  '|---|---|---|---|---|',
  '| E1 | **落笔半** | 2026-09-16 | 🔄 进行中 | T1 |',
  '',
  '### E1｜落笔半',
  '- **时间跨度**：2026-09-16 ~',
  '- **锚点**：T1',
  '- **模型**：`deepseek-flash`',
  '- **做了什么**：',
  '  1. 先做了提案半',
  '- **结果**：还没有',
  '- **状态**：🔄 进行中',
  '- **指引**：—',
  '',
].join('\n')

const TODO = [
  '# 工程-待办（样本）',
  '',
  '> 样本：只为了让 `planTodoAdd` 能定位到一节（它按**语义标记**找节，找不到就抛错、不猜）。',
  '',
  '## 四、短期 · 我能自己推 [自办]',
  '',
  '| 事项（内容） | 原因 | 目的 |',
  '|---|---|---|',
  '| 已有的一条 | 因为要测 | 为了测通 |',
  '',
].join('\n')

const FILES = {
  '01-时间轴-我们做过什么.md': T,
  '01-事件表-我们做过什么.md': E,
  '工程-待办.md': TODO,
  // 🔴 2026-10-15：L2 已删 ⇒ 落档的落点在 L3 ⇒ 夹具里得有它，否则算出来是空梭。
  'L3-知识\\记录-测试用.md': '# 记录 · 测试用\n\n> 🏷 **这份是什么**：夹具。\n> 🕐 **什么时候用**：测试。\n> ✍️ **谁写它**：测试。\n',
}

// ⚠️ 2026-10-14（L2 降级派生 · ④ C 轮）：**原「两条路逐字节对照」整组退役** ——
//    它的 A 路是 `dangan_weave pattern:'事件表'`，而那个纹样（连同 `事件表目录` / `时间轴`）
//    已随 L2 一起退役 ⇒ **没有第二路可比了**。留下的这一路＝**现有入口**（`planCommit` ＋ `runTxnOps`）。
const rootB = makeArchive('loom-b', FILES)
const mod = await loadPlugin()
const ctxB = mockCtx()
mod.apply(ctxB, { archiveDir: rootB })
const weaveToolB = ctxB.registered.find((t) => t.name === 'dangan_weave')
const read = (root, name) => readFileSync(`${root}\\${name}`, 'utf8')

console.log('—— ① 现有入口能织成 ——')
// 🔴 2026-10-15：L2 已删后，落档的落点只有"给那份 L3 写时间标记"——
//    不给 `detailIn` ⇒ 空梭 ⇒ 这里就**没有一条线可织**（旧版那时还会写时间轴，所以没这个问题）。
const item = { what: '织布机冒烟', level: '⭐', did: '走织布机落一条', detailIn: '记录-测试用.md', when: '2026-10-07 03:40' }
const plan = planCommit(item)
const rB = runTxnOps(plan.ops, plan.note)
check('现有入口：一条线织成了', rB.ok === true)

// ---- 后面的拒收 / 干跑都在 **B** 这份上做（它现在＝已织过一条的稳定状态）----

console.log('—— ② 拒收：不合格的线一个字都不许写 ——')
const rejects = [
  ['未知纹样', { pattern: '不存在的类', items: [{ what: 'x', level: '○' }] }, 'unknown-pattern'],
  ['格式未定的类（元类）', { pattern: '元类', items: [{}] }, 'pattern-undefined'],
  // 🔴 2026-10-14（L2 降级派生 · ④ C 轮）：这一组原来全用 `事件表` 纹样 —— 它随 L2 退役了 ⇒
  //    改用还活着的 `待办`（字段跟着换：`item`）。⚠️ 末条「一段超字数」**整条退役** ——
  //    它测的是 `segLimit`，而带 `segLimit: true` 的那三个纹样（`事件表`/`事件表目录`/`时间轴`）
  //    全随 L2 退役 ⇒ 该判据现在**没有载体**（判据本体在 `loom.js` 里没删）。
  ['items 不是数组', { pattern: '待办', items: { item: 'x' } }, 'bad-items'],
  ['items 空数组', { pattern: '待办', items: [] }, 'bad-items'],
  ['缺必填', { pattern: '待办', items: [{}] }, 'missing-field'],
  ['字段表以外的键', { pattern: '待办', items: [{ item: 'x', 乱入的键: 'y' }] }, 'unknown-field'],
  ['竖线', { pattern: '待办', items: [{ item: '带|竖线' }] }, 'bad-char'],
  ['真换行', { pattern: '待办', items: [{ item: '带\n真换行' }] }, 'bad-char'],
]
// ⚠️ 此刻 `CFG.archiveDir` ＝ **B**（上一次 apply 换的）⇒ 下面这些操作动的都是 B，比的也得是 B。
const beforeT = read(rootB, '工程-待办.md')
let allRejected = true
for (const [label, args, kind] of rejects) {
  const r = await weaveToolB.execute(args)
  const ok = r.ok === false && r.data?.kind === kind
  if (!ok) allRejected = false
  check(`拒收：${label} ⇒ ${kind}`, ok)
}
check('逐条拒收之后，档案**逐字节没变**', read(rootB, '工程-待办.md') === beforeT)
check('拒收回执带 `kind`（机械可判，好被别处接住）', allRejected)

console.log('—— ③ 默认不写（与 `dangan_log` 同一个姿态）——')
const todoBefore = read(rootB, '工程-待办.md')
const rPlan = await weaveToolB.execute({ pattern: '待办', items: [{ item: '测试一条待办' }] })
check('待办：不给 commit ⇒ 只出提案', rPlan.ok === true && /干跑/.test(rPlan.text))
check('待办：干跑算出了落点', /加一行到 §/.test(rPlan.text))
check('待办：干跑之后档案逐字节没变', read(rootB, '工程-待办.md') === todoBefore)

console.log('—— ④ 并行一致（**真写**对照：开与关，两份档案必须逐字节相同）——')
// 🔴 2026-10-07（对抗审查）：这一组原来是**干跑**对照 ⇒ `parallel` 那条路**根本不参与**，
//    等于没测（干跑不走分组/落盘）。改成**两份档案各真写一遍**，拿项目自己的判据（逐字节相同）钉它。
const items2 = [{ item: '甲' }, { item: '乙' }]
const rootD1 = makeArchive('loom-d1', FILES)
const ctxD1 = mockCtx()
mod.apply(ctxD1, { archiveDir: rootD1 })
const rD1 = await ctxD1.registered
  .find((t) => t.name === 'dangan_weave')
  .execute({ pattern: '待办', items: items2, parallel: true, commit: true })
const rootD2 = makeArchive('loom-d2', FILES)
const ctxD2 = mockCtx()
mod.apply(ctxD2, { archiveDir: rootD2 })
const rD2 = await ctxD2.registered
  .find((t) => t.name === 'dangan_weave')
  .execute({ pattern: '待办', items: items2, parallel: false, commit: true })
const tally = (s) => (s.match(/合计：成 \d+ \/ 败 \d+/) ?? ['（没有）'])[0]
check('parallel 开与关：两份档案**逐字节相同**', read(rootD1, '工程-待办.md') === read(rootD2, '工程-待办.md'))
check('parallel 开与关：回执的「成 N / 败 M」一致', tally(rD1.text) === tally(rD2.text))
check(
  'parallel:true 的**真写**回执里明说了「物理上仍是顺序」（不许假装并发）',
  rD1.text.includes('物理上仍是顺序'),
)

// 🔴 2026-10-07 补（真跑抓出来的洞）：上面这几条走的都是**干跑**，于是
//    `commit:true ＋ parallel:true` 那条路上"回执把结果吞掉"的 bug 一路漏到生产 ——
//    它拿 `Promise.allSettled` 的**包装壳**当结果用 ⇒ 回执说「成 0 / 败 0」，
//    而档案**其实写进去了**（**假回执**：看起来没写、其实写了）。这里钉住它。
console.log('—— ⑤ parallel ＋ commit：回执必须报出真实结果（假回执专项）——')
const rootC = makeArchive('loom-c', FILES)
const ctxC = mockCtx()
mod.apply(ctxC, { archiveDir: rootC })
const weaveToolC = ctxC.registered.find((t) => t.name === 'dangan_weave')
const rPC = await weaveToolC.execute({ pattern: '待办', items: [{ item: '丙' }, { item: '丁' }], parallel: true, commit: true })
check('parallel ＋ commit：回执报出「成 2 / 败 0」（不再吞掉结果）', /合计：成 2 \/ 败 0/.test(rPC.text))
check('parallel ＋ commit：回执里两梭都列出来了', (rPC.text.match(/工程-待办\.md：/g) ?? []).length === 2)
const todoC = read(rootC, '工程-待办.md')
check('parallel ＋ commit：两行都**真写进**待办表了（回执与档案对得上）', /丙/.test(todoC) && /丁/.test(todoC))
check('回执里报了这一趟花了多久（《拿不准》第 13 条）', /⏱ [\d.]+ 秒/.test(rPC.text))

// 🔴 2026-10-15 加：**回执必须是"无损 JSON"** —— 工具返回值里夹 `undefined` / `NaN`
//    （例：某一梭没有 `ops` 字段）会被 harness 判「**value is not lossless JSON**」⇒
//    **整条回执作废**（实测：待办其实已经写进去了，我这边却只看到一条错误 —— 与坑 15 那次同一个病）。
const hasBadJson = (v) => {
  if (v === null) return false
  const t = typeof v
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') return true
  if (t === 'number') return !Number.isFinite(v)
  if (Array.isArray(v)) return v.some(hasBadJson)
  if (t === 'object') return Object.values(v).some(hasBadJson)
  return false
}
check('🔴 真织的回执是"无损 JSON"（夹 undefined / NaN 会让整条回执被 harness 判非法）', !hasBadJson(rPC))

// 🔴 同批：一次最多织几梭的**上限**（落盘口是阻塞 spawn —— 一次几十梭会把控制台堵住）
const many = Array.from({ length: 21 }, (_, i) => ({ item: `第${i + 1}条` }))
const rMany = await weaveToolB.execute({ pattern: '待办', items: many })
check('超过上限（21 梭）⇒ 拒收 too-many-items', rMany.ok === false && rMany.data?.kind === 'too-many-items')

// ⚠️ B 那份档案是留给"对照"用的，不参与后面的断言；`weaveToolB` 只证明两份都能装上
check('第二份档案也装上了织布机（装配与档案根无关）', !!weaveToolB)

// ---- 2026-10-07 加：织布机已接上「完整落盘管线」（`runGuardedTxn`，与 `dangan_log` 同一条）----
// 起因：原来只调 `runTxnOps()`（只有"写"）⇒ 比落笔弱、还漏了"落笔成功"那行记账
//       （实证：织布机落的档 F30 第 18 关不认）。依据 `工程-清单.md` 节点 6「先补落盘管线」。
console.log('')
console.log('—— 织布机 · 落盘管线（2026-10-07 补齐）——')
{
  const { runGuardedTxn } = await import('../lib/f9-commit.js')
  const { loomSelfCheck } = await import('../lib/loom.js')
  const src = readFileSync(new URL('../lib/loom.js', import.meta.url), 'utf8')
  check('落盘管线已导出（织布机调得到）', typeof runGuardedTxn === 'function')
  // 🔴 2026-10-07（对抗审查）：**钉源码，不钉文案** —— 原来这里只断言自检那几句字符串，
  //    把实现改回 `runTxnOps` 也照样全绿（**假绿**）。这里直接钉"落盘那一行调的是哪条管线"。
  check('织布机的落盘**真的**在调 `runGuardedTxn`（不是只改了文案）', /runGuardedTxn\(built\.ops/.test(src), src.slice(0, 0))
  check('织布机里**不再**有 `runTxnOps(built.ops` 那条老路', !/runTxnOps\(built\.ops/.test(src))
  const sc = loomSelfCheck()
  check('自检不再自称"够用版"（管线已补齐）', !/够用版/.test(sc) && /完整版/.test(sc), sc)
}

// ---- 2026-10-07 加（**换门面 · 第一步**）：落笔之后那三件，织布机也要有 ----
// 以前织布机"写进去"就完事，比 `dangan_log` 少三样：① 兑现「归账完成」提名 ② 清事务残件 ③ 落一行记账。
// ⚠️ 这一步**不动现有入口**（`dangan_log` 一个字没改）—— 只是把织布机补齐。
console.log('')
console.log('—— 织布机 · 落笔之后（换门面第一步）——')
{
  const src2 = readFileSync(new URL('../lib/loom.js', import.meta.url), 'utf8')
  check('落盘后**兑现「归账完成」提名**（源码钉住）', /settleNamedTokens\(item\?\.归账完成\)/.test(src2))
  check('落盘后**清事务残件**（源码钉住）', /sweepTxn\(\)/.test(src2))
  const rootE = makeArchive('loom-e', FILES)
  const ctxE = mockCtx()
  mod.apply(ctxE, { archiveDir: rootE })
  const rNom = await ctxE.registered
    .find((t) => t.name === 'dangan_weave')
    .execute({ pattern: '待办', items: [{ item: '测提名', 归账完成: ['archive:deadbeef'] }], commit: true })
  // 🔴 2026-10-14（L2 降级派生 · ④ C 轮）：原「提名**销不掉时如实说出来**」那条断言**退役** ——
  //    它靠 `pattern:'事件表'` 把 `归账完成` 递进去，而那个参数挂在 `EVENT_FIELDS` 上、随纹样一起没了。
  //    ⚠️ 判据本体（`loom.js` 里 `settleNamedTokens(item?.归账完成)` ＋「没销就说没销」）**一个字没删**；
  //    等哪天有纹样重新带得起 `归账完成`，这条断言该回来。
}

// ---- 2026-10-10 加（**织布机收口 · 六阶段新增的 6 种纹样**）：一条一条钉住 ----
// 为什么要有这组：收口期间每种纹样都跑过手工验收，但**没进测试套件** ⇒ 重启后要人肉点。
// 这里把它们钉成断言：`node test.mjs` 全绿 ＝ 那 6 种都还活着。
console.log('')
console.log('—— 织布机 · 收口新增的纹样（2026-10-10）——')
{
  const { weavePlan, patternList } = await import('../lib/loom.js')
  const ids = patternList()
  for (const id of ['索引', '地图', '备查', '指南', '引用改写', '引用去路径', '行号加固']) {
    check(`纹样册里有「${id}」`, ids.includes(id))
  }
  check(`纹样册 ≥9 类（现在 ${ids.length} 类）`, ids.length >= 9)
  // 🔴 2026-10-10 加：自检的**分母**只算"该有就地文档的那几类" ——
  //    原来拿全部可织纹样当分母，老报"能定位到 4/11"，读起来像 7 类出问题了（其实是新建型/跨多文件本来就没有）。
  const { loomSelfCheck } = await import('../lib/loom.js')
  const sc = loomSelfCheck()
  check('自检：报的是"该有就地文档的那几类"', /能定位到 \*\*\d+\/\d+\*\* 份/.test(sc) && /就地文档/.test(sc))
  check('自检：把"没有就地那一份"的单独报一行（不再混进告警）', /没有"就地那一份"/.test(sc))


  const rootN = makeArchive('loom-new', {
    '从这开始读.txt': '入口\n',
    'L1-必读/索引.md': '# 索引（哪个文件讲什么、什么时候该读）\n',

    'L3-知识/知识/备查/既有件.md':
      '# 备查：既有\n\n> 🏷 **这份是什么**：样本\n> 🕐 **什么时候用**：样本\n> ✍️ **谁写它**：样本\n',
  })
  const ctxN = mockCtx()
  mod.apply(ctxN, { archiveDir: rootN })
  const wt = ctxN.registered.find((t) => t.name === 'dangan_weave')


  // ③ 索引：从各文件开头派生（干跑）
  const pX = weavePlan('索引', [{}])
  check('索引干跑：给得出登记份数', /登记 \d+ 份/.test(pX.text ?? ''))

  // ④ 备查：**真新建一份**（这是阶段④ 那条能力的端到端）
  const item = { 主题: '回归测试件', what: '测新建', when: '测的时候', body: '正文' }
  const rNew = await wt.execute({ pattern: '备查', items: [item], commit: true })
  check('备查真跑：新建成功', rNew.ok === true && /新建/.test(rNew.text))
  let made = false
  try {
    made = read(rootN, 'L3-知识\\知识\\备查\\备查-回归测试件.md').includes('# 备查：回归测试件')
  } catch {
    made = false
  }
  check('备查：文件真的落地了（H1 由织布机补）', made)
  // ⑤ 备查：再织一次 ⇒ 必须 skip（幂等；空行不计）
  const rNew2 = await wt.execute({ pattern: '备查', items: [item], commit: true })
  check('备查：再织一次是「没写」（幂等）', /没写|一致/.test(rNew2.text))


}

done()
