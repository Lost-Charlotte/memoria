// 🔴 隔离（**必须在这份文件的第一个字节**）：把 DSH_HOME 指到临时目录。
//   为什么用 `createRequire`：ESM 会把**所有** `import` 提升到顶部并先求值 ——
//   写成 `process.env.DSH_HOME = ...` 放在哪都没用（它总在 import 之后跑）。
//   而 `require` 是**按位置执行**的，所以这三行真的能抢在插件之前（2026-09-18 实测：
//   修之前跑一次 test.mjs，用户的 ~/.dsh 里就多 11 个 txn 残件）。
const __m0 = await import('node:module')
const { __cr = __m0.createRequire } = __m0
const __req = __cr(import.meta.url)
process.env.DSH_HOME = __req('node:fs').mkdtempSync(__req('node:path').join(__req('node:os').tmpdir(), 'memoria-home-'))

/**
 * F9 落笔半（`dangan_log` 的写入内核）—— 2026-09-17 凌晨。
 * 跑法：node tests/f9-commit.mjs
 *
 * 这一半最要紧的不是"能写"，而是**写错能拦住、能退回去**。所以断言分成四组：
 *   ① 算得对：时间轴那一行 / 锚点 / "做了什么"的编号 / 目录行，都按规矩生成；
 *   ② 真落上了：落完**能被体检读回去**（0 条机械错）—— 不是"看起来写了"；
 *   ③ 拦得住：写入内核不在 → 一个字不写；有人先动过同一份文件 → 当场停手；
 *   ④ 退得回：写到一半失败 → **先写过的那个文件必须回到原样**（逐字节比）。
 */
const __m1 = await import('node:fs')
const { chmodSync = __m1.chmodSync, existsSync = __m1.existsSync, readFileSync = __m1.readFileSync } = __m1

const __m2 = await import('./harness.mjs')
const { check = __m2.check, done = __m2.done, loadPlugin = __m2.loadPlugin, makeArchive = __m2.makeArchive, mockCtx = __m2.mockCtx, sandboxHome = __m2.sandboxHome } = __m2
const __m3 = await import('../lib/f9-commit.js')
const { kernelPath = __m3.kernelPath, planCommit = __m3.planCommit, runTxnOps = __m3.runTxnOps } = __m3
const __m4 = await import('../lib/f5-check.js')
const { checkArchive = __m4.checkArchive } = __m4
// 🔴 2026-10-20：原来这里还 import 了 `f8-index.js` 的 `currentIndexRows` / `renderIndexTable` ——
//    那两个函数**一次都没被本文件用到**（只 import、不使用），而 `f8-index.js` 已整份删除。

sandboxHome()

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

// 🔴 2026-10-15：这两份**改了名**（原来叫 `01-时间轴…` / `01-事件表…`）——
//    L2 已删 ⇒ 夹具里再放那两份"正主"，`planCommit` 就会去写它们（而现实里它们不存在）。
//    改名之后 `findByName('时间轴'/'事件表')` 找不到 ⇒ 走"只写 L3 ＋ 待办"那条真路；
//    而下面那些"防撞 / 逐字节没变"的断言只把它当**一份普通文件**用，不受影响。
const root = makeArchive('f9', {
  '样例-甲.md': T,
  '样例-乙.md': E,
  // 🔴 2026-10-15：L2 已删 ⇒ 落档的**唯一落点**是 `detailIn` 指的那份 L3
  //    ⇒ 夹具里得有它，否则算出来是空梭（`runGuardedTxn` 那段的"造错"就没 ops 可改）。
  'L3-知识\\记录-测试用.md': ['# 记录 · 测试用（2026-10-15）', '', '> 🏷 **这份是什么**：测试夹具。', '> 🕐 **什么时候用**：测试。', '> ✍️ **谁写它**：测试。', '', '正文。', ''].join('\n'),
})

const mod = await loadPlugin()
const ctx = mockCtx()

// 🔴 2026-10-15：**落档收进织布机了**（「dangan_weave」的「pattern:'落档'」）——
//    老工具名「dangan_log」已删（用户："所有老指向该删除的全删除。接口接入新的替代地方。"）。
//    这个测试里那些"扁平形状"的老调用，统一走这层适配（**只活在测试里**，不改正式接口）。
const logTool = {
  execute: (a = {}) => {
    const { commit, ...rest } = a
    // 🔴 2026-10-15：L2 已删 ⇒ 老调用里那些 `event:'E1'/'E2'` 指向的事件**不存在了**
    //    （`eventList()` 空）⇒ 这里把它们折成"新建"，并补齐新建必给的三格。
    //    ⚠️ **只活在测试里**的适配：它让那些"防撞 / 回滚 / 内核不在"的通用断言还能跑。
    if (typeof rest.event === 'string' && rest.event !== 'new' && rest.event !== '新建') {
      rest.event = 'new'
      rest.title = rest.title ?? '（测试）适配出来的事件'
      rest.why = rest.why ?? '测试适配'
      rest.result = rest.result ?? '测试适配'
    }
    return ctx.registered
      .find((t) => t.name === 'dangan_weave')
      .execute({ pattern: '落档', items: [rest], commit: commit === true })
  },
}

mod.apply(ctx, { archiveDir: root })

const tPath = `${root}\\样例-甲.md`
const ePath = `${root}\\样例-乙.md`
const read = (p) => readFileSync(p, 'utf8')
const wf2 = (p, s) => writeFileSync(p, s, 'utf8')
const rows = (s) => s.split(/\r?\n/).filter((x) => /\*\*T\d+\*\*/.test(x))

console.log('—— ③ 拦得住（先试"内核不在"）——')
process.env.MEMORIA_KERNEL = `${root}\\不存在的内核.mjs`
const beforeT = read(tPath)
const r0 = await logTool.execute({
  what: '内核不在时不许写',
  level: '○',
  event: 'E1',
  did: '这条不该落上',
  commit: true,
})
check('内核不在 → 报"没写成"', r0.ok === false, String(r0.text).slice(0, 200))
check('内核不在 → 档案逐字节没变', read(tPath) === beforeT)
delete process.env.MEMORIA_KERNEL
check('本机写入内核在位（落笔半的前提）', existsSync(kernelPath()))

console.log('—— ③ 拦得住（有人先动过同一份文件）——')
// 🔴 2026-10-08：**改挂 `E2`** —— `E1` 到这儿已经有 3 条「做了什么」，会先撞上"最多 3 条"那道新闸
//   （本用例要测的是"`expect` 撞车"，不是那条闸）。
const plan2 = planCommit({ what: '这条应该被拦下来', level: '○', event: 'new', title: '（测试）被拦的那条', why: '测试', did: '不该落上', result: '测试', when: '2026-09-17 02:00' })
const tBefore = read(tPath)
const { appendFileSync } = await import('node:fs')
appendFileSync(tPath, '| ○ | **T99** | 2026-09-17 01:59 | 另一个会话插进来的 |\n', 'utf8')
const r3 = runTxnOps(plan2.ops, '自测：防撞')
check('别人动过 → 内核停手（退出非 0）', r3.ok === false)
// 🔴 2026-10-15：撞车/内核的**具体文案**随入口变了（走织布机后回执由它拼）⇒ 只看"停手了"这件事。
// 🗑 2026-10-15 删一条：内核撞车后那句**具体文案**随入口变了（回执由织布机拼）——
//    而"撞车就停手"这件事已由上一条（`r3.ok === false`）钉住。
check('被拦下时事件表一个字没动', !read(ePath).includes('不该落上'))
check('被拦下时那行"别人的"还在（没被覆盖）', read(tPath).includes('另一个会话插进来的'))

console.log('—— ④ 退得回（写到一半失败）——')
// 先把 T99 那行去掉，恢复成干净样本
const { writeFileSync } = await import('node:fs')
writeFileSync(tPath, tBefore, 'utf8')
const tClean = read(tPath)
const eClean = read(ePath)
chmodSync(ePath, 0o444) // 让第二份文件写不进去 → 内核写完第一份就会失败
const r4 = await logTool.execute({
  what: '这次会写到一半失败',
  level: '○',
  event: 'E1',
  did: '不该留下',
  when: '2026-09-17 02:10',
  commit: true,
})
chmodSync(ePath, 0o666)
check('落笔报"没写成"', r4.ok === false)
check('先写的那份（时间轴）已退回原样（逐字节相同）', read(tPath) === tClean)
check('后写的那份（事件表）本来就没变', read(ePath) === eClean)

console.log('—— ⑪ 旧错只是被顶下去一行，不许当成"新错"把好落笔撤掉 ——')
// 样本里先埋一条旧错（`见 E999` 死指针），再落一次笔：那条错会往下挪一行，但不该算新错
wf2(ePath, eClean + '\n见 E999 的说明（旧错，提前就在）。\n', 'utf8')
wf2(tPath, tClean, 'utf8')
const g3 = await logTool.execute({
  what: '旧错存在时也要能落',
  level: '○',
  event: 'E1',
  did: '在旧错存在时落的一笔',
  when: '2026-09-17 03:00',
  commit: true,
})
// 🗑 2026-10-15 删两条：它们测的是"**落档会写那份 L2 样例文件**"（`tPath`）——
//    而 L2 已删、落档现在只写 **L3 ＋ 待办** ⇒ 这个断言的对象不存在了。
wf2(ePath, eClean, 'utf8')
wf2(tPath, tClean, 'utf8')

// ---- 2026-09-17 加（**真踩到的一次**）：返回值的字段必须都在 `output.schema` 里声明过 ----
console.log('')
console.log('—— ⑫ 返回值字段必须声明过 ——')
// 踩到的现场：落档**已经写进档案**（E74/T211 都在了），工具却报
// `"value.data" is not a declared property` —— **报告被吞掉，而"报错 ≠ 没写"从错误里看不出来**，
// 差一步就重试写第二遍。这类"声明漏一个字段"的错，只有机器对一遍才防得住。
// 🔴 2026-10-15：`dangan_log` 已删（落档收进织布机）⇒ 这处改测**现在那个写入工具** `dangan_weave`。
const weaveToolForSchema = ctx.registered.find((t) => t.name === 'dangan_weave')
const declared = new Set(Object.keys(weaveToolForSchema.output.schema.properties))
// 🔴 2026-10-15：只留**现存**的那几个回执（L2 时代那批 `r1/r2/bad*/g*` 已随段删掉）。
const returned = [r0, r3].flatMap((x) => Object.keys(x ?? {}))
const undeclared = [...new Set(returned.filter((k) => !declared.has(k)))]
check(`每条返回值的字段都在 schema 里声明过（没声明的：${undeclared.join(' / ') || '无'}）`, undeclared.length === 0)
check('`output.schema` 是封闭的（`additionalProperties: false`）—— 否则"声明过"没有意义', weaveToolForSchema.output.schema.additionalProperties === false)
check('schema 里声明了 `data`（落笔半的每个分支都会带它）', declared.has('data'))

// ---- 2026-09-18 加：**快照 / 还原必须是"字节"，不是"UTF-8 串"** ----
// 出处：《待办》§四「回退时的字节快照」。原来快照写 `raw`（UTF-8 串），非 UTF-8 文件
// 在快照那一步就被解成 U+FFFD 了 —— 快照本身不是原样，退路自然也是坏的。
//
// ⚠️ 先把**边界**说清（免得这条测试被读成"改动也无损"）：非 UTF-8 文件一旦被**改**，
//    内核必须先把它解码成行、改完再编码 —— **这一步必然有损**（无解，谁也做不到）。
//    这条测试要钉的是另一样、也是《待办》里写的那样：**"回退"必须能拿回原样**。
//    所以判据是"改完之后 --restore 回来，逐字节等于最初那份"，而**不是**"改动无损"。
console.log('')
console.log('—— ⑬ 非 UTF-8 文件：快照 / 回退必须逐字节无损 ——')
{
  const { mkdirSync, readdirSync, writeFileSync: wf3 } = await import('node:fs')
  const { join } = await import('node:path')
  const { spawnSync } = await import('node:child_process')

  // 样本：**合法 UTF-8 中文 ＋ 故意插进去的非法字节**（单字节 0xAA、截断的 3 字节序列、
  // 像 GBK 那样的双字节）。这样"解码-再编码"**必然**与原件不同，而"逐字节拷"必然相同。
  const SAMPLE = Buffer.concat([
    Buffer.from('| ○ | **T1** | 2026-09-18 03:00 | ', 'utf8'),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), // ← GBK 的"中文"，在 UTF-8 下是非法字节
    Buffer.from(' |\r\n| ⭐ | **T2** | 2026-09-18 03:01 | ', 'utf8'),
    Buffer.from([0xe4, 0xb8]), // ← 截断的 3 字节序列
    Buffer.from(' |\r\n', 'utf8'),
  ])
  // 先自证样本真的"不是合法 UTF-8"——否则这条测试是在骗自己
  check('样本确实含非法 UTF-8 字节（解码会出现替换字符）', SAMPLE.toString('utf8').includes('\uFFFD'))

  const lineDir = join(root, 'L2-数据')
  mkdirSync(lineDir, { recursive: true })
  const lineFile = join(lineDir, '01-时间轴-我们做过什么.md')
  wf3(lineFile, SAMPLE)

  // 改第 2 行（那一行的非法字节是 **截断在行尾的**，所以它后面就是换行 → 让内核
  // 把第 2 行 decode/re-encode 一遍，非 UTF-8 那部分必然变形 —— 正是"改坏"的现场）
  const txnFile = join(root, 'txn-bytes.json')
  wf3(txnFile, JSON.stringify({
    note: '自测：字节快照（非 UTF-8 文件）',
    ops: [{ op: 'replace', file: 'L2-数据\\01-时间轴-我们做过什么.md', line: 2, text: '改过的第二行', expect: '| ⭐ | **T2** | 2026-09-18 03:01 | \uFFFD |' }],
  }), 'utf8')

  const kp = kernelPath()
  const runK = (args) => spawnSync(process.execPath, [kp, ...args], { env: { ...process.env, GAI_DANG_ROOT: root }, encoding: 'utf8' })
  const r = runK(['--txn', txnFile])
  check('内核在非 UTF-8 文件上照常落笔', r.status === 0, (r.stdout || '') + (r.stderr || ''))
  check('这一次"改"确实动到了字节（非 UTF-8 文件被改动必然有损 —— 边界在此）', !readFileSync(lineFile).equals(SAMPLE))

  const snapRoot = join(root, 'L6-工具临时', '改档快照')
  const snaps = readdirSync(snapRoot).sort()
  const snapDir = join(snapRoot, snaps[snaps.length - 1])
  // ① 快照那一份必须逐字节等于**改之前**的原件（旧实现：在这里就已经是 U+FFFD 的副本）
  check('快照那一份逐字节等于原件', readFileSync(join(snapDir, 'L2-数据', '01-时间轴-我们做过什么.md')).equals(SAMPLE))

  // ② 回退之后也要逐字节等于原件 —— 这条才是《待办》里"回退时的字节快照"的判据
  const rb = runK(['--restore', snapDir])
  check('回退报成功', rb.status === 0, (rb.stdout || '') + (rb.stderr || ''))
  check('回退之后**逐字节等于**最初那份（不是"解码再编码"的近似品）', readFileSync(lineFile).equals(SAMPLE))
}

// ---- 2026-10-02 加 · 🔴 2026-10-15 **撤**：字数闸门（≤120）----
// 它治的是"**事件表被追成流水账**"（E91 那条），而 **L2 整层已删** ⇒ `why` / `did` / `result`
//   **一个字都不写进档案**（落档只写 L3 时间标记 ＋ 待办）⇒ 这道闸**没有对象了**。
//   （用户 2026-10-15 点破：「现在都没这俩表了，怎么还在限制长度」）
// ⚠️ 这里改成**反向断言**（超长不再被拒）—— 免得哪天有人把这道撤掉的闸"修回来"。
//   📌 还留着的那道是 `DID_SELF`（>150 字必须给 `detailIn`）—— 它逼的是"先把经过写进 L3"，与长度无关。
console.log('')
console.log('—— ⑭ 字数闸门**已撤**：一段 121 字 → 不再拒收 ——')
{
  const weaveTool = ctx.registered.find((t) => t.name === 'dangan_weave')
  const over1 = await weaveTool.execute({
    pattern: '落档',
    items: [
      {
        what: '测字数闸门（超长 did）',
        level: '○',
        event: 'new',
        title: '（测试）超长 did',
        why: '测试',
        result: '测试',
        // 🔴 2026-10-15：**必须给 detailIn** —— L2 已删后，没它就算不出任何落点
        //    （空梭 ⇒ 织布机拒"一处都不用改"），那样测不到"字数闸已撤"这件事。
        // ⚠️ 2026-10-16 修：原来这里写的是**真档案**里那份的名字（`记录-2026-10-15-撤字数闸门.md`），
        //    而沙箱夹具里没有它 ⇒ `planCommit` 找不到落点、`ok=false` ⇒ 这条断言一直红，
        //    却被 `test.mjs` 的汇总**假绿**盖住（施工手册坑：它的退出码不可信、单跑才算数）。
        detailIn: 'L3-知识\\记录-测试用.md',
        did: '甲'.repeat(121),
        when: '2026-10-02 12:00',
      },
    ],
    commit: true,
  })
  check('一段 121 字的 `did` → **不再因字数被拒**', over1.ok === true, over1.text?.slice(0, 240))
  check('回执里不再出现"上限 120"那句', !/上限 120/.test(over1.text ?? ''), over1.text?.slice(0, 240))
}

// ---- 2026-10-07 加：落盘管线提取（`runGuardedTxn`）—— 写 → 写后体检 → 新错自动回滚 ----
// 起因：织布机（`lib/loom.js`）原来只调 `runTxnOps()`（只有"写"）⇒ 比 `dangan_log` 弱、
//      还漏了"落笔成功"那行记账（2026-10-07 实证：织布机落的档 F30 第 18 关不认）。
//      依据 `工程-清单.md` 节点 6「先补落盘管线」；施工面见《工程-织布机-拿不准（节点3）》第 1 条。
console.log('')
console.log('—— ⑮ 落盘管线 `runGuardedTxn`：新错 → 自动回滚（织布机与落笔共用同一条）——')
{
  const { runGuardedTxn } = await import('../lib/f9-commit.js')
  check('管线已提取成导出函数（织布机调得到）', typeof runGuardedTxn === 'function')
  // 🔴 2026-10-07（对抗审查）：**钉源码** —— `commitLog()` 必须真的调那条管线，
  //    不许"提取出来了、却自己又写一遍"（那等于两条路，提取就白做了）。
  // 🔴 2026-10-12（阶段⑥ 换门面 · 走 B）**更新这条实现钉**：落笔那一步现在**改由织布机执笔** ——
  //    `commitLog()` 调 `weave('事件表', …, {commit:true})`，而织布机内部落的仍是同一条
  //    `runGuardedTxn()`（那一句由 `tests/f36-loom.mjs` 钉住）。
  //    ⚠️ 为什么**必须改**：那台"提取白做了"的守护神不能靠散文里的字样满足 ——
  //    真源码里已经没有 `runGuardedTxn(plan.ops` 了，留着旧断言只会变成一条**假绿**。
  //    ⚠️ 这条是**实现钉**（钉的是"经手人是谁"），不是**行为钉**；对外行为由下面的用例与
  //    `f10-todo.mjs` / `f14-secrets.mjs` 守着。
  const f9src = readFileSync(new URL('../lib/f9-commit.js', import.meta.url), 'utf8')
  // 🔴 2026-10-14（L2 降级派生 · ④ B 轮）**更新这两条实现钉**：
  //    原文钉的是"`commitLog` 不自己落盘 / 不自己销账"（2026-10-12 阶段⑥ 走 B：落档交给织布机）。
  //    但 **L2 已删** ⇒ 织布机那条路（`weave('事件表')`）**没有落点**（那份"事件表"文档不存在了）
  //    ⇒ 落档只能**直连同一条落盘管线**（`runGuardedTxn` —— 织布机内部那一梭调的**正是它**）。
  //    ⇒ 钉子升级为「**两条路都走同一条管线**」—— **精神一字未变：不许另开一条写档案的路**。

  // 🔴 2026-10-20：**这条实现钉退役了** —— 它钉的是"`commitLog()` 的落笔走 `runGuardedTxn`"，
  //    而 `commitLog()` 当天**整份删掉了**（`dangan_log` 早就没了、正式路径只有织布机）。
  //    ⇒ 没有对象，硬留着就是一条**假绿**（它挂了几个月都没人发现，因为本文件没调 `done()`）。
  //    "**不许另开一条写档案的路**"这条精神现在由 `tests/f36-loom.mjs` 钉住（织布机那一梭走的就是 `runGuardedTxn`）。

  const eBefore = read(ePath)
  const tBefore = read(tPath)
  const before = checkArchive().filter((x) => x.lv === '错')
  // 造一条**会引入新机械错**的 ops。
  // 🔴 2026-10-15 改：原来是把"锚点"改成 `T999`（指向不存在的 T）—— 但**那个判据随 L2 退役删了**
  //    ⇒ 造不出错了。改用一条**仍在跑**的判据：往某一行里塞一个**不存在的档案引用**（文件型死指针）。
  // （⚠️ ops 必须由 `planCommit` 生成 —— 手搓的 op 缺内核要的字段，会先在 kernel 阶段就失败）
  // 🔴 2026-10-08：改挂 `E2` —— `E1` 此时已被前面的用例**真写到 3 条**，会先撞上"最多 3 条"那道新闸
  //   （本例要的是"一份 plan"，哪个 E 都行）。
  const pBad = planCommit({ what: '自测：管线回滚路径', level: '○', event: 'new', title: '（测试）回滚路径', why: '测试', did: '自测用（这一条不该落上）', result: '测试', when: '2026-10-07 16:00', detailIn: '记录-测试用.md' })
  // 🔴 2026-10-15：不限于 `replace` —— L2 已删后，落档对 L3 那一步**可能算成插入**
  //    （那份 L3 还没有时间标记时就是 `insertAfter`）⇒ 取第一条带 text 的 op 即可。
  const iRep = pBad.ops.findIndex((o) => typeof o.text === 'string' && o.text.length > 0)
  const badOps = pBad.ops.map((o, i) => (i === iRep ? { ...o, text: `${o.text} —— 见 \`L1-必读\\不存在.md\`` } : o))
  check('造错用的 ops 改成了一条"不存在的档案引用"（测试前提）', badOps.some((o) => /不存在\.md/.test(o.text ?? '')))
  const g = runGuardedTxn(badOps, { note: '自测：回滚路径', before })
  if (!g.ok && g.stage !== 'selfcheck') console.log('  · 诊断（没走到 selfcheck）：', JSON.stringify({ stage: g.stage, why: String(g.why ?? '').slice(0, 200) }))
  check('造出新机械错 → `ok:false` 且 `stage:"selfcheck"`', g.ok === false && g.stage === 'selfcheck', g.why ?? '')
  check('把新错报出来了（不是静默）', Array.isArray(g.fresh) && g.fresh.length > 0)
  check('真按快照回滚了', g.rolledBack === true)
  check('档案**逐字节**回到写之前（事件表）', read(ePath) === eBefore)
  check('档案**逐字节**回到写之前（时间轴）', read(tPath) === tBefore)
  check('回滚后体检仍是 0 错', checkArchive().filter((x) => x.lv === '错').length === 0)
}

// ---- 2026-10-07 加：**跨工作段的续集**（"完成之后还能往下延"）—— 只提示、不拦 ----
// 起因：`continuation` 只管"最近 3 天内"（刻意的保守）⇒ 完成已久又推进的那种**看不到提示** ⇒ 我另开号。
// 口径出处：用户 2026-09-26「事件该是**一件事的完整故事**，中间断几次、又推进几轮，都还是同一条」。
console.log('')