/**
 * F30 · 第 11 关「pwsh 不许裸写 / 删 / 搬」＋「动盘前先读《防丢总则》」—— 判据的样本回归。
 *
 * 由来（2026-09-21 那轮的真账）：
 *   ① 我用 `[System.IO.File]::WriteAllText` **裸 pwsh 往 %TEMP% 写临时脚本** —— 该走 `write` 工具；
 *   ② 同一天更早，我**跳过闸门①**（先出方案、等批准）直接删了 6 个留底 —— 命令走的是 `recycle-del.ps1`，
 *      **完全合法**，但**没先读《防丢总则》**（判据 A 对那次一点用都没有，是判据 B 该拦住的）。
 *   用户拍板："**pwsh 的改动调用应该是严令禁止的**" ＋ "**给防丢失流程并入闸门，将动盘必读变成规矩**"。
 *
 * 跑法：`node tests/f30-disk-entry.mjs`（`node test.mjs` 会自动带上它）。
 *
 * ⚠️ 两条边界（这一关自己写在注释里，样本要把它钉住）：
 *   · 第 11 关**只管 `pwsh`**：换个写法（`node -e "fs.writeFileSync"`）拦不住 —— 文本判据只降概率。
 *   · **唯一入口是白名单**：`recycle-del.ps1` / `move-verify.ps1` 就是"那扇门"本身，
 *     拦住它们＝自锁（《施工手册》坑 4 那一族）。它们放行第 11 关，但**照样触发 B 关**。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f30disk', {
  '从这开始读.txt': 'DeepSeek 档案 —— 从这开始读\n',
  'L1-必读/00-总览-我们干过什么.md': '# 总览\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  'L1-必读/工具速查.md': '# 工具速查\n',
  'L3-知识/记录-梅莫莉亚-施工手册.md': '# 施工手册\n',
  'L1-必读/防丢失总则.md': '# 防丢总则\n',
  'L3-知识/动U盘前必读.md': '# 动U盘前必读\n',
})

// ⚠️ `CFG.archiveDir` 在模块**加载那一刻**算好 —— 所以必须在 import 之前指到样本档案。
process.env.GAI_DANG_ROOT = root

const F30 = await import('../lib/f30-toolgate.js')

const run = (sid, name, args) => ({ name, arguments: args, agent: { session: { id: sid } } })
const FANGDIU = 'L3-知识\\防丢失流程-动盘必读.md'

/** 真机里那一条（第 11 关必须放行它，否则入口把自己拦死）。 */
const RECYCLE =
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\tools\\recycle-del.ps1' " +
  '-ListFile C:\\Users\\admin\\.dsh\\memoria-txn\\l.txt -AllowLocalDrives -DryRun'

console.log('— ⑱ 第 11 关 · pwsh 裸写 / 删 / 搬 → 拒 —')
const verdictCases = [
  // —— 该拦（全是真账里出现过或同族的写法）——
  // 🔴 2026-10-20：第 11 关**收窄成"只管档案"** ⇒ 这几条必须写成**档案里的路径**才会被拦
  //    （原来拿 `D:\x\a.txt` 这种非档案路径也拦 —— 那正是"陌生人装上就当机"的根）。
  ['该拦 · 裸 Remove-Item', `Remove-Item '${root}\\L3-知识\\x.txt'`],
  ['该拦 · 裸 Set-Content', `Set-Content -LiteralPath '${root}\\L3-知识\\x.txt' -Value hi`],
  ['该拦 · 裸 Out-File', `'hi' | Out-File '${root}\\L3-知识\\x.txt'`],
  ['该拦 · 裸 Move-Item', `Move-Item '${root}\\L3-知识\\a' -Destination '${root}\\L3-知识\\b'`],
  ['该拦 · 裸 robocopy', `robocopy '${root}\\L3-知识' '${root}\\L6-工具临时\\b' /E`],
  ['该拦 · .NET 直写（2026-09-21 真发生的那次）', `[System.IO.File]::WriteAllText('${root}\\L3-知识\\a.mjs', 'code')`],
  ['该拦 · 重定向到盘', `node a.mjs > '${root}\\L3-知识\\log.txt'`],
  // —— 该放行（防误伤：这几条必须一条都不能中）——
  ['放行 · **非档案路径**的裸写（2026-10-20 起只管档案）', `New-Item -ItemType Directory 'D:\\myproj\\src' -Force`],
  ['放行 · **非档案路径**的裸删', `Remove-Item 'D:\\myproj\\dist' -Recurse`],
  ['放行 · 调唯一入口 recycle-del', RECYCLE],
  ['放行 · 纯只读（列目录）', `Get-ChildItem 'D:\\x' -File | Select-Object -First 5`],
  ['放行 · `-gt` 不是重定向', `if (1 -gt 0) { 'ok' }`],
  ['放行 · `2>&1` 不是写盘', `node a.mjs 2>&1 | Select-Object -Last 3`],
  ['放行 · 跑测试/脚本本身', `node test.mjs`],
  ['放行 · 引号里的词（只是查它，不是调它）', `Select-String -Pattern 'Remove-Item' x.js`],
]
for (const [label, cmd] of verdictCases) {
  const want = label.startsWith('该拦')
  const got = !!F30.diskWriteVerdict('pwsh', { command: cmd })
  check(`${label} => ${got ? '拦' : '放行'}${got === want ? '' : `（期望 ${want ? '拦' : '放行'}）`}`, got === want)
}
check('放行 · read 工具不受这一关影响', F30.diskWriteVerdict('read', { file_path: 'D:\\x' }) === null)
check('放行 · write 工具不受这一关影响（它归 D 关与 B 关管）', F30.diskWriteVerdict('write', { file_path: 'D:\\x.mjs', content: 'x' }) === null)
const rv = F30.diskWriteVerdict('pwsh', { command: `Remove-Item '${root}\\L3-知识\\x'` })
check('拒绝理由里给了出路（write/edit 工具）', rv !== null && rv.reason.includes('write'))
check('拒绝理由里给了出路（recycle-del / move-verify）', rv !== null && rv.reason.includes('recycle-del') && rv.reason.includes('move-verify'))
check('拒绝理由点明依据（铁律 §四 唯一入口）', rv !== null && rv.reason.includes('唯一入口'))

console.log('— ⑲ 动盘**不再**挂"按需必读"（09-27 加回·当天又删）→ 改由第 15 关按"用户原话"软提醒 —')
// 🔴 三段历史（W8：旧做法就地标、不许删原文）：
//   · 09-26 拆：原项 need 的是《防丢总则》，它已挪进 `L1-必读`（A 关每轮管），且每轮都触发。
//   · 09-27 加回：need 换成《动U盘前必读》（管"认哪个盘 / 这东西归哪个筐"的现场判据）。
//   · 09-27 又删：用户拍板"**我觉得删了吧。不然你每调用一次工具他都得吵你。既然是u盘相关，就不要牵连到别人**"
//     —— `recycle-del` / `move-verify` 不只用于 U 盘，动本机档案里的文件也走它们 ⇒ 挂在它们上会牵连本机搬运。
F30.__resetDiskReads()
check(
  '🔴 调唯一入口 recycle-del：**不再**被"按需必读"拦（改由第 15 关按用户原话软提醒）',
  F30.scopedVerdict(run('D1', 'pwsh', { command: RECYCLE }), 'pwsh', { command: RECYCLE }) === null,
)
check(
  '✅ 裸写命令：仍归第 11 关拦，**不**走"按需必读"（两张判据各管一段，别叠）',
  F30.scopedVerdict(run('D2', 'pwsh', { command: `Remove-Item 'D:\\x'` }), 'pwsh', { command: `Remove-Item 'D:\\x'` }) === null,
)

console.log('— ㉑ 第 15 关：用户提到 U 盘 → 软提醒一次（再发即放行）—')
const SAID = await import('../lib/said.js')
F30.__resetDiskTalk()
SAID.__resetSaid()
SAID.noteUserSaid('D5', '帮我把 u盘 里那些文件整理一下')
const vDisk1 = F30.diskTalkVerdict(run('D5', 'pwsh', { command: `Get-ChildItem 'D:\\x'` }), 'pwsh', {
  command: `Get-ChildItem 'D:\\x'`,
})
check('🔴 用户刚提到 U 盘 → 先软拒一次', vDisk1 !== null && String(vDisk1.tag).includes('U 盘'))
const vDisk2 = F30.diskTalkVerdict(run('D5', 'pwsh', { command: `Get-ChildItem 'D:\\x'` }), 'pwsh', {
  command: `Get-ChildItem 'D:\\x'`,
})
check('✅ 再发一次 → 放行（这一关只拦一次）', vDisk2 === null)
SAID.noteUserSaid('D6', '今天天气不错，随便聊聊')
F30.__resetDiskTalk()
check(
  '✅ 没提到 U 盘 → 不拦',
  F30.diskTalkVerdict(run('D6', 'pwsh', { command: `Get-ChildItem 'D:\\x'` }), 'pwsh', { command: `Get-ChildItem 'D:\\x'` }) === null,
)
// 🔴 **反证**（证明没有误拆）：`SCOPED_READS` 里"**动插件前必读**"那一项**还在**。
check(
  '反证：动插件之前仍然要读（施工手册 / 现状总纲）—— 那一项没被误拆',
  (() => {
    const p = 'C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\lib\\x.js'
    const v = F30.scopedVerdict(run('D4', 'write', { file_path: p, content: 'x' }), 'write', { file_path: p, content: 'x' })
    return v !== null && v.tag === '按需必读未读'
  })(),
)

console.log('— ⑳ 各关心跳：第 11 关必须自报"判过"（三问③ · 沉默 ≠ 正常）—')
check('GATE_TICKS 里有第 11 关那一格', F30.GATE_TICKS && typeof F30.GATE_TICKS.disk === 'object')
check('第 11 关那一格有 seen / hit', F30.GATE_TICKS.disk.seen >= 0 && F30.GATE_TICKS.disk.hit >= 0)
const beforeSeen = F30.GATE_TICKS.disk.seen
F30.noteGatePass({ name: 'pwsh' })
check('路过一次 pwsh → 第 11 关的 seen 涨了', F30.GATE_TICKS.disk.seen === beforeSeen + 1)
const beforeHit = F30.GATE_TICKS.disk.hit
F30.noteGateHit('pwsh 裸写/删/搬')
check('拦下一条 → 第 11 关的 hit 涨了', F30.GATE_TICKS.disk.hit === beforeHit + 1)
check('自检那一行里报了第 11 关', F30.reportF30().includes('第 11 关'))

done()
