// 🔴 隔离（**必须在这份文件的第一个字节**）：把 DSH_HOME 指到临时目录。
//   为什么用 `createRequire`：ESM 会把**所有** `import` 提升到顶部并求值 ——
//   写成 `process.env.DSH_HOME = ...` 放在哪都没用（它总在 import 之后跑）。
const __m0 = await import('node:module')
const { __cr = __m0.createRequire } = __m0
const __req = __cr(import.meta.url)
process.env.DSH_HOME = __req('node:fs').mkdtempSync(__req('node:path').join(__req('node:os').tmpdir(), 'memoria-home-'))

/**
 * F9 落档给 L3 写「时间标记」—— 2026-10-14 夜（补**对抗审查 F14**）。
 *
 * 为什么有这一份（审查原话）：**"这四处改动没有一行测试，坏掉时不会有人知道"** ——
 *   本轮就是这么发现那四个问题的。这个文件专门钉住「落档口自动写时间标记」这条路：
 *   它**会自动改档案**，是这一批改动里**最该有测试**的一处。
 *
 * 钉住的五条（每条都对着一个真会犯的错）：
 *   ① 没标记 ⇒ 在**开头自述区之后**插一行（不是文件最开头，也不是正文里）；
 *   ② 只有起点（`> 🕐 2026-…`、没有 `~`）⇒ **起点不许被覆盖成现在**（2026-10-14 自查抓到的 bug）；
 *   ③ 标记后面有尾巴（`（起）`）⇒ **尾巴不许被吃掉**（对抗审查 F12）；
 *   ④ 正文里演示写法的那句 `> 🕐 …` **不算标记** —— 只认**开头 40 行**（对抗审查 F9）；
 *   ⑤ 找不到插入点（空表）⇒ **一个字都不改**（fail-open，不许乱插）。
 */
const __m1 = await import('node:fs')
const { readFileSync = __m1.readFileSync } = __m1

const __m2 = await import('./harness.mjs')
const { check = __m2.check, done = __m2.done, loadPlugin = __m2.loadPlugin, makeArchive = __m2.makeArchive, mockCtx = __m2.mockCtx, sandboxHome = __m2.sandboxHome } = __m2
const __m3 = await import('../lib/f9-commit.js')
const { runGuardedTxn = __m3.runGuardedTxn } = __m3
const __m4 = await import('../lib/loom-commit.js')
const { planCommit = __m4.planCommit } = __m4

// 🔴 2026-10-20：`commitLog()` 整份删了（用户拍板"老结构没用就该删干净"）⇒ 这里直接拿它的两层积木
//    拼一个**只给测试用的落档**：`planCommit()` 算改动（"给 L3 写时间标记"就在这一层）＋ `runGuardedTxn()` 真写。
//    测的东西一个字没变（标记怎么插、起点会不会被覆盖、尾巴会不会被吃），只是不再借那个夹具。
const commitLog = async (args) => {
  try {
    const p = planCommit(args)
    const ops = p?.ops ?? []
    if (ops.length === 0) return { ok: false, text: '【测试】算下来一处都不用改' }
    const g = runGuardedTxn(ops, { note: '测试落档' })
    return { ok: g?.ok === true, text: (p.summary ?? []).join('\n') + (g?.ok ? '' : `\n${g?.why ?? ''}`) }
  } catch (e) {
    return { ok: false, text: `【测试】${e?.message ?? e}` }
  }
}

sandboxHome()

const T = [
  '| 等级 | 编号 | 时间 | 发生了什么 |',
  '|---|---|---|---|',
  '| ○ | **T1** | 2026-10-14 01:00 | 甲 |',
  '',
].join('\n')

// ⚠️ **五份 L3 各用一条独立的事件号**（E1~E5）—— 一件事的「做了什么」默认最多 3 条，
//   五份共用一个号会在第 4 次落档时被那道闸拦下（那不是本文件要测的东西）。
const ev = (n, name) => [
  `| E${n} | **${name}** | 2026-10-14 | 🔄 进行中 | T1 |`,
  '',
  `### E${n}｜${name}`,
  '- **时间跨度**：2026-10-14 ~',
  '- **锚点**：T1',
  '- **模型**：`deepseek-flash`',
  '- **做了什么**：',
  '  1. 甲',
  '- **结果**：还没有',
  '- **状态**：🔄 进行中',
  '- **指引**：—',
  '',
].join('\n')

const E = [
  '| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |',
  '|---|---|---|---|---|',
  '| E1 | **标记甲** | 2026-10-14 | 🔄 进行中 | T1 |',
  '| E2 | **标记乙** | 2026-10-14 | 🔄 进行中 | T1 |',
  '| E3 | **标记丙** | 2026-10-14 | 🔄 进行中 | T1 |',
  '| E4 | **标记丁** | 2026-10-14 | 🔄 进行中 | T1 |',
  '| E5 | **标记戊** | 2026-10-14 | 🔄 进行中 | T1 |',
  '',
  ev(1, '标记甲'),
  ev(2, '标记乙'),
  ev(3, '标记丙'),
  ev(4, '标记丁'),
  ev(5, '标记戊'),
].join('\n')

// ① 没有时间标记的 L3：三行自述 ＋ 正文
const L3_PLAIN = [
  '# 记录 · 没有标记的那份（2026-10-14）',
  '',
  '> 🏷 **这份是什么**：测试用。',
  '> 🕐 **什么时候用**：测试。',
  '> ✍️ **谁写它**：测试。',
  '',
  '正文第一段。',
  '',
].join('\n')

// ② 只有起点、没有 `~` 的 L3 —— 起点绝不许被覆盖
const L3_START_ONLY = [
  '# 记录 · 只有起点的那份（2026-10-14）',
  '',
  '> 🏷 **这份是什么**：测试用。',
  '> 🕐 **什么时候用**：测试。',
  '> ✍️ **谁写它**：测试。',
  '> 🕐 2026-10-13 22:51',
  '',
].join('\n')

// ③ 标记后面带尾巴的 L3 —— 尾巴绝不许被吃掉
const L3_TAIL = [
  '# 记录 · 带尾巴的那份（2026-10-14）',
  '',
  '> 🏷 **这份是什么**：测试用。',
  '> 🕐 2026-10-13 22:51 ~ 2026-10-13 23:10（起）',
  '> ✍️ **谁写它**：测试。',
  '',
].join('\n')

// ④ 正文里（第 40 行之外）才有 `> 🕐 …` 的 L3 —— 那句**不算标记**
const L3_LATE_MARK =
  '# 记录 · 标记躲在正文里的那份（2026-10-14）\n\n> 🏷 **这份是什么**：测试用。\n> ✍️ **谁写它**：测试。\n\n' +
  Array.from({ length: 45 }, (_, i) => `正文第 ${i + 1} 行。`).join('\n') +
  '\n> 🕐 2026-01-01 00:00（正文里演示写法的一句，不是标记）\n'

// ⑤ 空表（三行自述都没有）—— 不许乱插
const L3_EMPTY = '# 记录 · 空的那份\n\n'

const root = makeArchive('f9-l3stamp', {
  '01-时间轴-我们做过什么.md': T,
  '01-事件表-我们做过什么.md': E,
  'L3-知识\\记录-没有标记.md': L3_PLAIN,
  'L3-知识\\记录-只有起点.md': L3_START_ONLY,
  'L3-知识\\记录-带尾巴.md': L3_TAIL,
  'L3-知识\\记录-标记在正文里.md': L3_LATE_MARK,
  'L3-知识\\记录-空的.md': L3_EMPTY,
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })

const path = (name) => `${root}\\L3-知识\\${name}`
const read = (name) => readFileSync(path(name), 'utf8')
const stampLines = (s) => s.match(/^>\s*🕐\s*\d{4}-\d{2}-\d{2}[^\n]*$/gm) ?? []

// 今天（北京时间）—— 断言末值时用它，免得测试"过了今天才烂"（坑 7 那一族的另一种形状）。
// ⚠️ 时间标记那一格**必须是** `YYYY-MM-DD HH:MM`（索引用 `\d{4}-\d{2}-\d{2}` 认它）——
//    本文件 ① 里那条断言正是 **F14 当场抓到的真 bug**：原来是 `nowCN().slice(0,16)`，
//    返回 `2026/10/14 02:0…`（斜杠 ＋ 截断）⇒ 索引根本认不出。这条断言现在钉住它。
const today = (() => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const g = (t) => (p.find((x) => x.type === t) || {}).value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
})()

console.log('—— ① 没有标记 ⇒ 在「开头自述区之后」插一行 ——')
{
  const before = read('记录-没有标记.md')
  const r = await commitLog({ what: '时间标记：加一行', level: '○', event: 'E1', did: '甲', when: '2026-10-14 02:00', detailIn: '记录-没有标记.md' })
  const after = read('记录-没有标记.md')
  const lines = after.split(/\r?\n/)
  const at = lines.findIndex((l) => /^>\s*🕐\s*\d{4}-\d{2}-\d{2}/.test(l))
  check('落档成功（没被闸拦）', r.ok === true, String(r.text ?? '').slice(0, 200))
  check('回执里报了这处改动', /L3 时间标记/.test(String(r.text ?? '')))
  check('L3 里真的多了一行时间标记', at >= 0)
  check('插入点在「✍️ 谁写它」那一行**之后**（不是文件最开头）', at >= 4)
  check('插入的那一行在**正文之前**（没插进正文里）', at < lines.findIndex((l) => l.startsWith('正文第一段')))
  check('**新标记的格式是 `YYYY-MM-DD HH:MM`**（F14 当场抓到的那个 bug 就出在这儿）', /^>\s*🕐\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(lines[at] ?? ''), lines[at] ?? '')
  check('只多这一处时间标记（不是每段都戳一个）', stampLines(after).length === 1)
  check('正文那几行逐字没动', after.includes('正文第一段。') && before.includes('正文第一段。'))
  check('比原来只多一行', after.split(/\r?\n/).length === before.split(/\r?\n/).length + 1)
}

console.log('')
console.log('—— ② 只有起点 ⇒ 起点不许被覆盖（只往后接末值）——')
{
  const r = await commitLog({ what: '时间标记：只有起点', level: '○', event: 'E2', did: '乙', when: '2026-10-14 02:05', detailIn: '记录-只有起点.md' })
  const line = stampLines(read('记录-只有起点.md'))[0] ?? ''
  check('落档成功', r.ok === true, String(r.text ?? '').slice(0, 200))
  check('**起点 2026-10-13 22:51 还在**（没被"现在"覆盖）', line.includes('2026-10-13 22:51'))
  check('接上了 `~` 和末值', /~/.test(line))
  check(
    `末值 ＝ 今天（${today}）`,
    line.includes(`~ ${today}`),
    line,
  )
}

console.log('')
console.log('—— ③ 带尾巴 ⇒ 只换末值，尾巴原样留着 ——')
{
  const r = await commitLog({ what: '时间标记：带尾巴', level: '○', event: 'E3', did: '丙', when: '2026-10-14 02:10', detailIn: '记录-带尾巴.md' })
  const line = stampLines(read('记录-带尾巴.md'))[0] ?? ''
  check('落档成功', r.ok === true, String(r.text ?? '').slice(0, 200))
  check('**尾巴 `（起）` 还在**（没被整行换掉吃掉）', line.includes('（起）'))
  check('起点 2026-10-13 22:51 还在', line.includes('2026-10-13 22:51'))
  check(`末值换成了今天（${today}）`, new RegExp(`~\\s*${today}`).test(line))
}

console.log('')
console.log('—— ④ 标记躲在正文里（第 40 行之外）⇒ 不算标记 ——')
{
  const before = read('记录-标记在正文里.md')
  const r = await commitLog({ what: '时间标记：正文里的假标记', level: '○', event: 'E4', did: '丁', when: '2026-10-14 02:15', detailIn: '记录-标记在正文里.md' })
  const after = read('记录-标记在正文里.md')
  check('落档成功', r.ok === true, String(r.text ?? '').slice(0, 200))
  check(
    '正文里那句 `> 🕐 2026-01-01` **一个字没动**（没被当成标记改掉）',
    after.includes('> 🕐 2026-01-01 00:00（正文里演示写法的一句，不是标记）'),
  )
  check(`在开头自述区补了一行真标记（${today}）`, (after.match(new RegExp(`^>\\s*🕐\\s*${today}`, 'gm')) ?? []).length === 1)
  check('比原来只多一行', after.split(/\r?\n/).length === before.split(/\r?\n/).length + 1)
}

console.log('')
console.log('—— ⑤ 找不到插入点（空表）⇒ 一个字都不改（不许乱插）——')
{
  const before = read('记录-空的.md')
  const r = await commitLog({ what: '时间标记：空表', level: '○', event: 'E5', did: '戊', when: '2026-10-14 02:20', detailIn: '记录-空的.md' })
  // 🔴 2026-10-15 改口径：L2 已删后，落档的**全部内容**就是"给 L3 写时间标记 ＋ 待办"——
  //    所以"找不到插入点" ⇒ **真的没东西可落** ⇒ 此时**拒掉是对的**（旧口径那时还会写时间轴，
  //    所以"写不了标记"不影响落档；现在没有那个兜底了）。
  check('写不了标记 ⇒ 这次没东西可落，当场拒（不假装写成功）', r.ok === false, String(r.text ?? '').slice(0, 200))
  check('空表那份**逐字节没动**（找不到自述行 ⇒ 不乱插）', read('记录-空的.md') === before)
}

done()
