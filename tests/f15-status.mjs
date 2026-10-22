/**
 * F15 · 状态面板。跑法：node tests/f15-status.mjs
 *
 * 它本身不做判定（判定都在各能力里），所以这一套要钉住的是**聚合的纪律**：
 *   ① **每一段都在**（在跑吗 / 体检 / 闸门 / 干活统计 / 哨兵 / 预算 / 待办 / 最近注入）；
 *   ② 🔴 **缺一段不许拖垮整屏** —— 样本档案里没有待办文件、没有日志，面板必须照样整屏出来；
 *   ③ **只读**：调它前后，档案文件的字节数一个都不许变；
 *   ④ 两个小工具（`tailLines` / `lastMatching`）的行为对（日志会长，不能整份读）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f15', {
  '从这开始读.txt': '入口\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  '01-时间轴-我们做过什么.md': [
    '| 等级 | 编号 | 时间 | 发生了什么 |',
    '|---|---|---|---|',
    '| ○ | **T1** | 2026-09-16 10:00 | 甲 |',
    '| ⭐ | **T2** | 2026-09-16 11:00 | 乙 |',
    '',
  ].join('\n'),
  '01-事件表-我们做过什么.md': [
    '| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |',
    '|---|---|---|---|---|',
    '| E1 | **甲事** | 2026-09-16 | 🔄 进行中 | T1 |',
    '',
    '### E1｜甲事',
    '- **时间跨度**：2026-09-16 ~',
    '- **锚点**：T1',
    '- **模型**：`deepseek-flash`',
    '- **做了什么**：',
    '  1. 先记一条',
    '- **结果**：还没有',
    '- **状态**：🔄 进行中',
    '- **指引**：—',
    '',
  ].join('\n'),
})

const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root })

const { tailLines, lastMatching, parseOpenTodoCount, buildStatus } = await import('../lib/f15-status.js')

console.log('')

// --- 一、小工具（日志会长，不能整份读） -------------------------------------
const tmpLog = join(process.env.DSH_HOME, '假日志.log')
const { writeFileSync } = await import('node:fs')
writeFileSync(tmpLog, Array.from({ length: 100 }, (_, i) => `第 ${i} 行`).join('\n'), 'utf8')
check('tailLines 只取尾部 N 行', tailLines(tmpLog, 5).length === 5 && tailLines(tmpLog, 5).at(-1) === '第 99 行')
check('tailLines 超过上限时**丢掉可能被切坏的第一行**', tailLines(tmpLog, 5, 60).length <= 4)
check('tailLines 对不存在的文件不炸（返回空）', tailLines(join(process.env.DSH_HOME, '没有这个.log')).length === 0)
check('lastMatching 找**最后一条**（不是第一条）', lastMatching(['甲 有', '乙 无', '丙 有'], '有') === '丙 有')
check('lastMatching 找不到时返回 null（不返回空串）', lastMatching(['甲'], '没有') === null)
check('parseOpenTodoCount 抠得出"还开着 N 条"', parseOpenTodoCount('【dangan_todo】还开着 **7 条**（…）') === 7)
// 🔴 2026-10-01 改（原断言是"抠不出就返回 null"）：**"表是空的"和"读不到表"必须分清** ——
//    原来空表被判成"抠不出" ⇒ `null` ⇒ **状态面板误报"（读不到待办表）"**
//    （实测打架：`dangan_status` 说读不到，`dangan_todo list` 读同一份表完全正常）。
//    ⇒ 现在钉**三种**：空表＝0 · 有条目＝N · **真读不到**（空串）＝null。
check('🔴 空表 ⇒ 0（不是"读不到"）', parseOpenTodoCount('【dangan_todo】待办文件里**没有还开着的条目**（L4-施工\\工程-待办.md）—— 干净') === 0)
check('🔴 真的读不到（空串）⇒ 才是 null', parseOpenTodoCount('') === null)

// --- 二、整屏：每段都在 ------------------------------------------------------
const before = readFileSync(join(root, '01-时间轴-我们做过什么.md'), 'utf8')
const text = buildStatus()

for (const seg of ['■ 在跑吗', '■ 体检', '■ 闸门', '■ 干活统计', '■ 哨兵', '■ 工具输出上限', '■ 待办', '■ 最近一次注入']) {
  check(`面板里有这一段：${seg}`, text.includes(seg))
}
check('面板开头自报"这是此刻跑着的代码"（版本 + 指纹）', /梅莫莉亚 · 状态/.test(text) && /指纹/.test(text))
// ⚠️ 2026-09-17 加，**2026-09-18 修成真断言**：指纹必须**在模块加载那一刻算定**（＝真正在跑的那份）。
//    原来它每次调用都读磁盘现算 —— 于是"改完还没重启"时指纹**已经变了**，
//    看起来就像新代码在跑（当天实测：面板报 v0.20.0，而新加的路由全是 404）。
//    🔴 **上一版这里的两条断言其实是空的**：`codeStamp() === codeStamp()` 只要磁盘不变就恒真
//       （它根本没碰"进程内是常量"这件事），另一条又拿"面板值 == 同一个现算函数的返回值"当证据
//       —— 于是**实现走错了（还在现算磁盘），断言照样全绿**，还挂了两年份的注释说"已钉住"。
//       这一版改成真断言：① 面板报的是 `LOADED_STAMP`；
//       ② **往 lib/ 放一个新文件**（磁盘变了、进程没重启）→ 面板**不跟着变**且**明说"还没装载"**；
//       ③ 对照组：磁盘指纹确实变了（证明 ② 不是恒真）。探针在 `finally` 里删干净。
const { LOADED_STAMP, codeStamp } = await import('../lib/common.js')
const { rmSync } = await import('node:fs')
check('装载指纹形如「… · 指纹 xxxxxxxx」', /· 指纹 [0-9a-f]{8}$/.test(LOADED_STAMP))
check('面板里的指纹 == **装载那一刻**的常量（真正在跑的那份）', text.includes(LOADED_STAMP))
check('磁盘与装载一致时**不**报"还没装载"（不喊狼来了）', codeStamp() === LOADED_STAMP && !text.includes('磁盘与装载不一致'))

const probe = new URL('../lib/__fp_probe.js', import.meta.url)
writeFileSync(probe, '// 临时探针：让"磁盘"与"装载"分叉（测完即删，不进 git）\n', 'utf8')
try {
  const t2 = buildStatus()
  check('🔴 磁盘改过之后：磁盘指纹确实变了（对照组，证明下一条不是恒真）', codeStamp() !== LOADED_STAMP)
  check('🔴 面板**不跟着变**，报的还是装载那份（旧实现会在这里露馅）', t2.includes(LOADED_STAMP))
  check(
    '🔴 并且**明说"磁盘与装载不一致 / 要重启"**（不许假装新代码已经在跑）',
    /磁盘与装载不一致/.test(t2) && /要重启/.test(t2),
  )
} finally {
  rmSync(probe, { force: true })
}
check('探针删干净了（磁盘回到装载那份）', codeStamp() === LOADED_STAMP)
// 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：L2 已删 ⇒ 那两个数显示成"（已删）"，不再给读数。
check('体检那段：L2 已删 ⇒ 显示「（已删）」（不把 -1 当读数给人看）', /时间轴/.test(text) && /事件/.test(text) && /（已删）/.test(text))
check('工具输出那段给出上限（注入用量已随重注入砍掉）', /工具输出上限：\d+ 字符/.test(text))
check('末尾指明"想深挖该走哪条路"', text.includes('dangan_check') && text.includes('memoria.log'))

// --- 三、🔴 缺一段不许拖垮整屏 ------------------------------------------------
check('样本里**没有待办文件**、也没有任何日志 —— 面板照样整屏出来', text.length > 300)
check('缺的那一段如实写"读不到 / 找不到"，不假装正常', /找不到|读不到|还没有|没找到/.test(text))
// 🔴 上线当天抓到的真 bug：原来只读日志尾部 8KB，而"已注入"是**稀疏事件**（常在几百行以前）
//    → 面板会说"**还没有注入记录**"。那是**撒谎**（明明有）。修法：往后读 512KB ＋ **只说"没找到"**。
check('🔴 找不到注入记录时**只说"这段里没找到"**，不说"还没有"（"没找到" ≠ "不存在"）', text.includes('没找到注入记录') && !text.includes('还没有注入记录'))
check('没有任何一段抛错把整屏打掉', !text.includes('（读不到 体检') && !text.includes('（读不到 哨兵'))

// --- 四、只读：调它前后档案一个字节都不许变 -----------------------------------
const after = readFileSync(join(root, '01-时间轴-我们做过什么.md'), 'utf8')
check('🔴 **只读**：调面板前后，档案文件逐字节相同', before === after)

// --- 五、接进清单与工具面 ----------------------------------------------------
const { CAPS } = await import('../lib/manifest.js')
check('清单里有 F15（状态面板）', CAPS.some((c) => c.id === 'F15' && c.tool?.name === 'dangan_status'))
check('它是**工具型**（不是我自动去查的），而且有 what', CAPS.some((c) => c.id === 'F15' && c.kind === 'tool' && c.what.length > 20))

const { danganStatusTool } = await import('../lib/tools.js')
const r = await danganStatusTool.execute({})
check('工具能跑通并返回 ok', r.ok === true && typeof r.text === 'string')
check('工具输出与面板同源（都来自 buildStatus）', r.text.includes('■ 在跑吗'))

done()
