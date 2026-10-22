/**
 * F13 · 有效性锚点。跑法：node tests/f13-anchors.mjs
 *
 * 这一套要钉住的**不是"能不能抽路径"，而是三条防噪音的纪律**（都是试跑三次换来的）：
 *   ① 只认**反引号里当路径写**的（裸文本里的 `C:\Program Files` 会被空格截成 `C:\Program` → 噪音）；
 *   ② 只扫**工具类文档**、跳过**历史快照**（快照里的路径本来就该是旧的）；
 *   ③ 🔴 **盘不在线 → 跳过，绝不算"探测不到"**（照 max-null："探测不到 ＝ 未校验，绝不判失效"）。
 * 另外还要钉住：它只报**提示**、不报**错** —— 因为档案里的路径有三种用法，机器分不清。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'
import { driveOnline, extractPaths, probePaths, scanAnchors } from '../lib/f13-anchors.js'

sandboxHome()

const root = makeArchive('f13', {
  '从这开始读.txt': '入口\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  'L3-知识/某记录.md': '记录里提到一个路径，它不是工具类事实。\n',
})
const EXISTS = join(root, 'L1-必读', '00-必读-铁律.md') // 真存在
const GONE = join(root, '早就没有了的目录') // 盘在线、但路径没了
const OFFLINE = 'Q:\\tools\\thing.exe' // 盘根本不在线
const SNAPSHOT_ONLY = join(root, '快照里才有的目录') // 只出现在"快照"文档里
const RECORD_ONLY = join(root, '记录里引用但不存在') // 只出现在非工具类文档里

// 工具类文档（F13 该扫的）
writeFileSync(
  join(root, 'L1-必读', '工具速查.md'),
  [
    '| 工具 | 位置 |',
    '|---|---|',
    `| 真工具 | \`${EXISTS}\` |`,
    `| 假工具 | \`${GONE}\` |`,
    `| 离线盘的 | \`${OFFLINE}\` |`,
    `| 举例的 | \`${join(root, '举例用的东西')}\` （举例：当时在别处见过） |`,
    `| 占位的 | \`C:\\某目录\\xxx\` |`,
    '',
  ].join('\n'),
  'utf8',
)
// 历史快照（必须跳过）
writeFileSync(
  join(root, '清单-2026-09-13-三盘全量扫描.txt'),
  `这是快照\n\`${SNAPSHOT_ONLY}\`\n`,
  'utf8',
)
// 非工具类文档（不该扫）
writeFileSync(join(root, 'L3-知识', '某记录.md'), `随手提一句 \`${RECORD_ONLY}\`\n`, 'utf8')

console.log('')

// --- 一、抽取口径：只认反引号 ---
check('抽反引号里的绝对路径', extractPaths(`看 \`${EXISTS}\` 这份`).length === 1)
check('**裸文本里的路径不抽**（否则 `C:\\Program Files` 会被空格截成 `C:\\Program` → 噪音）', extractPaths(`在 C:\\Program Files 下面`).length === 0)
check('占位符不抽（`某目录` / `...` / 通配符）', extractPaths('`C:\\某目录\\x` `C:\\...\\y` `C:\\a\\*`').length === 0)
check('太短的片段不抽（`C:\\a` 这种）', extractPaths('`C:\\a`').length === 0)

// --- 二、盘在线判定 ---
check('真盘（C:）判定在线', driveOnline('C:\\whatever') === true)
check('假盘（Q:）判定离线', driveOnline(OFFLINE) === false)

// --- 三、探测三分：在线-在 / 在线-没了 / 离线（🔴 三类绝不许混） ---
const probed = probePaths([
  { path: EXISTS, file: 'a', line: 1 },
  { path: GONE, file: 'b', line: 2 },
  { path: OFFLINE, file: 'c', line: 3 },
])
check('存在的路径计进 exists', probed.exists === 1)
check('盘在线但路径没了 → missing（这才是"可能过期"）', probed.missing.length === 1 && probed.missing[0].path === GONE)
check('🔴 **盘不在线的绝不出现在 missing 里**（探测不到 ＝ 未校验，绝不判失效）', !probed.missing.some((m) => m.path === OFFLINE))
check('盘不在线的被单独记成 offline（还带盘符，供汇总）', probed.offlineCount === 1 && probed.offlineDrives.includes('Q:'))

// --- 四、扫描范围：只扫工具类、跳过快照与普通记录 ---
const scanned = scanAnchors(root)
const paths = scanned.missing.map((m) => m.path)
check('扫到了工具类文档（工具速查）', scanned.files >= 1)
check('**历史快照被跳过**（它自己标着"快照·非现状"，里面的路径本来就该是旧的）', !paths.includes(SNAPSHOT_ONLY))
check('**非工具类文档不扫**（记录里随手提的路径不算"工具类事实"）', !paths.includes(RECORD_ONLY))
check('行里写明"举例 / 当时"的 → 跳过', !paths.some((p) => p.includes('举例用的东西')))
check('真过期的那条**必须被抓到**（这才是它存在的意义）', paths.includes(GONE))
check('离线的盘进了 offline 汇总，不是 missing', scanned.offlineDrives.includes('Q:') && !paths.includes(OFFLINE))

// --- 五、接进体检：只报提示，不报错（错要留给机器真能判的事） ---
const mod = await loadPlugin()
const ctx = mockCtx()
mod.apply(ctx, { archiveDir: root, entryFile: '从这开始读.txt', tieDir: 'L1-必读', tieNameHint: '铁律' })

const issues = mod.__internals.checkArchive()
check('体检里出现"探测不到"的**提示**条目', issues.some((x) => x.lv === '提示' && x.msg.includes('找不到')))
// ⚠️ 断言只针对**锚点自己产生的那几条**：样本档案没有时间轴/事件表，本来就会有别的"错"，
//    拿"整个体检 0 错"来断言会把无关的条件混进来（那是 `f5-check.mjs` 该管的事）。
check(
  '🔴 锚点问题**不报成"错"**（否则闸门 G2 会拿它拦每一个回合）',
  !issues.some((x) => x.lv === '错' && /探测不到|不在线/.test(x.msg)),
)
// ⚠️ 2026-09-17 上线当天改：离线盘**不进体检** —— 盘长期不在线时它会**每轮都报**，
//    那就是"消不掉的告警"（档案里的原话："等于没有告警"）。它改由 F13 自检行与 `dangan_status` 面板报。
check('离线盘**不进体检**（防"消不掉的告警"）', issues.filter((x) => x.msg.includes('不在线')).length === 0)
check('提示里写清了"该怎么判"（举例 / 已删除 就不算错）', issues.some((x) => x.msg.includes('你判断一下')))

// --- 六、自检行 ---
const { reportF13 } = await import('../lib/f13-anchors.js')
const line = reportF13()
// 🔴 2026-10-07 诊断：这条断言红过（而日志里明明有那两句）—— 把原文打出来，别猜。
if (!(line.includes('跳过') && line.includes('不算错'))) {
  console.log('  · 诊断 reportF13() 原文：', JSON.stringify(String(line).slice(0, 400)))
}
check('自检行自报工作量（几份文档 / 几条路径）', /查了 L1（现行层）\d+ 份文档里的 \d+ 条路径/.test(line))
check('自检行明确说"离线的跳过、不算错"', line.includes('跳过') && line.includes('不算错'))

done()
