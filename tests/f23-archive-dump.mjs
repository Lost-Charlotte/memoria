/**
 * F23 归档留底：**没压缩就归档**那条路上的"内容不丢"。
 *
 * 钉的是用户 2026-09-17 深夜点出的漏洞与给的方案：
 *   · 漏洞："**如果我没触发上下文压缩就再不输出新内容，会导致档案丢失内容**"（F22 只认压缩这一个扳机）；
 *   · 方案："**梅莫莉亚只要检测到一个会话被归档了，那么他同样触发这一套，留两个副本**"；
 *   · 前提："**我归档的时候，里面的 agent 是没法动的**"（所以只能由别的会话／启动时替它留底）。
 *
 * ⚠️ 这一份里最要紧的两条**反向**断言（照仓库纪律 1）：
 *   ① **没归档的时候，一样东西都不许有**（否则"亮灯"会变成狼来了）；
 *   ② **读不到归档集合 ≠ 一个都没归档**（照 R20：探测不到绝不判"不存在"）。
 *
 * 另外钉住那个**实测踩出来的坑**：会话日志是"独立 zstd 帧拼接"的，
 * **整份解压只出第一帧还返回成功** —— 所以必须逐帧解压，多帧文件要能全解出来。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

const HOME = sandboxHome() // 必须在 import 插件之前：sessions/ 与状态文件全落沙箱

// 样本档案（countT / findByName 要有东西可数）
const T = (n) => `| ❗ | **T${n}** | 2026-09-17 23:40 | 样本 ${n} |\n`
const root = makeArchive('f23', {
  'L2-数据/01-时间轴.md': `# 时间轴\n\n| 等级 | 编号 | 时间 | 事件 |\n|---|---|---|---|\n${[1, 2, 3].map(T).join('')}`,
  'L2-数据/01-事件表.md': `# 事件表\n\n### E1｜样本事件\n- **状态**：🔄 进行中\n`,
})

const { CFG } = await import('../lib/common.js')
CFG.archiveDir = root
const f23 = await import('../lib/f23-archive-dump.js')
const f22 = await import('../lib/f22-compact-dump.js')
const { SKELETON_DIR, skeletonFileName } = await import('../lib/skeleton.js')

console.log('')

// ============================================================
// 造一个"真"会话日志：**独立 zstd 帧拼接**（每个事件一帧）—— 正是那个坑的形状
// ============================================================
const SID = 'session-f23-aaaa1111'
const DIRNAME = f23.dirNameOf(SID) // 去掉 session- 前缀的样子
const WS = '--C-Users-admin-Desktop--'
// 🔴 真机布局是**两层**：`sessions/<工作区目录>/<会话目录>/<日志>`，而且**会话目录名有的带 `session-` 前缀、有的不带**。
//    第一版测试造假了（只造一层）→ 测试全绿、**真机第一跑 11 个会话全被误报"找不到日志"**。这个形状现在钉在测试里。
const sessDir = join(HOME, 'sessions', WS, SID)
mkdirSync(sessDir, { recursive: true })
const LOG = join(sessDir, 'session.v3.jsonl.zstd')

const evs = [
  { type: 'user/message', time: '2026-09-17T15:00:00Z', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '归档前的要紧话' }] } },
  { type: 'assistant/message', time: '2026-09-17T15:00:05Z', data: { content: [{ type: 'text', text: '归档前的回答' }] } },
  // 🔴 2026-09-19：tool/result 样本改成**真实会话日志的形状**（正文嵌两层）——
  //    原来的扁平形状让"留底里只剩 [tool-result] 占位符"的 bug 逃过了测试。
  {
    type: 'tool/result',
    time: '2026-09-17T15:00:09Z',
    data: {
      name: 'bash',
      message: { content: [{ type: 'tool-result', toolCallId: 'c1', isError: false, content: [{ type: 'text', text: '归档前的工具输出' }] }] },
    },
  },
  { type: 'system/message', data: { content: [{ type: 'text', text: '系统提示词（不该进留底）' }] } },
]
const frame = (ev) => zstdCompressSync(Buffer.from(`${JSON.stringify(ev)}\n`, 'utf8'))
writeFileSync(LOG, Buffer.concat(evs.map(frame)))

const wj = join(HOME, 'storages', 'workspace.json')
const writeWorkspace = (archived) => {
  mkdirSync(join(HOME, 'storages'), { recursive: true })
  writeFileSync(wj, JSON.stringify({ global: { initialized: true, archivedSessionIds: archived } }, null, 2), 'utf8')
}

// ============================================================
// 一、反向：没归档 → 一样东西都不许有
// ============================================================
check('dirNameOf 剥掉了 session- 前缀（去掉前缀的样子）', DIRNAME === 'f23-aaaa1111')
check('找得到会话日志（**两层布局** ＋ 带前缀的目录名）', f23.findSessionLog(SID) === LOG)

// 🔴 真机第一跑撞出来的假阴性：**有的会话目录名不带 `session-` 前缀** —— 两种都得认
const SID2 = 'session-f23-bbbb2222'
const dirNoPrefix = join(HOME, 'sessions', WS, f23.dirNameOf(SID2))
mkdirSync(dirNoPrefix, { recursive: true })
writeFileSync(join(dirNoPrefix, 'session.v3.jsonl.zstd'), Buffer.concat(evs.map(frame)))
check('🔴 不带 session- 前缀的目录名也认（本机两种都存在）', f23.findSessionLog(SID2) === join(dirNoPrefix, 'session.v3.jsonl.zstd'))

writeWorkspace([])
let r = f23.checkArchivedSessions()
check('没归档：一个新会话都没有', r.ok === true && r.fresh === 0 && r.dumped === 0)
check('没归档：不产生任何留底（防"狼来了"）', !f23.__exists(f23.archivePaths(SID).main))
check('没归档：亮灯是空的', f22.dumpNotice().text === '')

// ============================================================
// 一之二、🔴 **历史归档的会话一样要补底** —— "已归档" ≠ "内容已落进档案"
// （用户 2026-09-17 深夜纠正："**历史上所有已经归档的会话并非每一个都完成了日志的归档。需要这一步**"）
// ============================================================
const OLD = 'session-f23-old00000'
const OLD_DIR = join(HOME, 'sessions', WS, OLD)
mkdirSync(OLD_DIR, { recursive: true })
writeFileSync(join(OLD_DIR, 'session.v3.jsonl.zstd'), Buffer.concat(evs.map(frame)))
writeWorkspace([OLD])
r = f23.checkArchivedSessions()
check('🔴 历史归档的会话**照样留底**（跳过它 ＝ 把没落完的内容丢了）', r.fresh === 1 && r.dumped === 1)
check('🔴 它确实写出了主份', f23.__exists(f23.archivePaths(OLD).main))

// 这一段测完就把它清干净（不留底、也不留状态），免得干扰后面"未销账计数"那几条断言
{
  const st0 = f22.loadDumpState()
  if (st0.dumps) delete st0.dumps[`archive:${OLD}`]
  f22.saveDumpState(st0)
}
rmSync(f23.archivePaths(OLD).main, { force: true })

// ============================================================
// 二、🔴 读不到归档集合 → **不许当成"没有归档"**
// ============================================================
writeFileSync(wj, '这不是 JSON{{{', 'utf8')
r = f23.checkArchivedSessions()
check('🔴 读不到归档集合时 ok=false（"读不到" ≠ "没有归档"）', r.ok === false && r.archived === null)
check('🔴 读不到时不留底、也不当成"处理过"', !f23.__exists(f23.archivePaths(SID).main))

// ============================================================
// 三、归档了 → 留两份 + 全文都在
// ============================================================
writeWorkspace([SID])
r = f23.checkArchivedSessions()
check('发现 1 个新归档会话', r.fresh === 1 && r.dumped === 1)
const paths = f23.archivePaths(SID)
check('主份写出来了（~/.dsh/memoria-dumps/pending）', f23.__exists(paths.main))
check('🔴 不再写备份份了（那条路已拆）', typeof paths.backup === 'undefined')
check('文件名带"归档留底"（与压缩留底分得开）', paths.name.includes('归档留底'))

// 🔴 2026-09-19：留底那一刻**顺手写骨架**（销账读它、不读全文：358K → 21K）。
//    钉住这条**集成** —— 别哪天有人把那两行删掉，留底照旧、骨架没了，谁也不会发现。
const skPath = join(SKELETON_DIR, skeletonFileName(SID, 'archive'))
check('骨架名与留底名同构（骨架-归档-<短id>.md）', skPath.endsWith('骨架-归档-f23-aaaa.md'))
// ⚠️ 2026-09-19 实测踩到：真实 `~/.dsh/memoria-dumps/skeleton/` 里出现过**测试 SID 的骨架残留**
//    （`骨架-f23-aaaa.md` / `骨架-f23-old0.md`，时间对得上某次全套运行，单独重跑 f23 却复现不了）。
//    这条断言就是那道保险：**沙箱一旦失效，它立刻红** —— 别再让"测试往真 HOME 写垃圾"无声发生。
check('🔴 骨架写在沙箱 HOME 里（不碰真实 ~/.dsh）', skPath.startsWith(HOME))
check('🔴 留底顺手写了骨架（销账读它，不读全文）', f23.__exists(skPath))
const skText = f23.__exists(skPath) ? readFileSync(skPath, 'utf8') : ''
check('骨架里是真人对话（用户话 ＋ 我的答复都在）', skText.includes('归档前的要紧话') && skText.includes('归档前的回答'))
check('骨架里没有工具结果（它是证据，不是信息源）', !skText.includes('归档前的工具输出'))
check('骨架头写了销账办法（提名 ＋ 插件自动清）', skText.includes('归账完成') && skText.includes('verified'))

const body = readFileSync(paths.main, 'utf8')
// 🔴 2026-10-08：**文案与口径都变了** —— 记的是**最大号**（`maxT()`）而不是行数，而且**它不再是判据**
//    （销账认**提名**，不看 T 号有没有变大）。见《工程-时间线修改-讨论稿》节点 3。
//    ⚠️ 断言用正则、不绑具体函数 —— 免得以后口径再动时它又红一次。
// 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：L2 已删 ⇒ 头一行不再记 T 号，改记 `（已删）`。
//    断言仍用正则、不绑具体字样 —— 口径再动时不至于又红一次。
check('头一行记「归档时刻档案写到」—— L2 已删 ⇒ 写「（已删）」', /^- \*\*归档时刻档案写到/m.test(body) && /（已删/.test(body))
check('留底里取到了用户那句要紧话', body.includes('归档前的要紧话'))
check('留底里取到了我的回答', body.includes('归档前的回答'))
check('留底里取到了工具输出', body.includes('归档前的工具输出'))
// 🔴 2026-09-19：**不许只留占位符**（两层没读出来时，留底里只剩 `[tool-result]`）。
check('🔴 工具结果正文真进了留底（不是只剩 [tool-result] 占位符）', body.includes('归档前的工具输出') && !body.includes('[tool-result]'))
check('系统提示词不进留底', !body.includes('系统提示词（不该进留底）'))
check('🔴 **多帧全解出来了**（整份解压只会出第一帧 —— 这个坑钉住）', body.includes('归档前的回答') && body.includes('归档前的工具输出'))
check('留底里写明了来源（被归档）+ 帧数', body.includes('这个会话被归档了') && body.includes('4 帧'))

// ============================================================
// 三之二、🔴 2026-10-07（用户拍板"甲"）：**归档写成之后，同会话的旧留底就地作废**
//   —— 治的是"同一个会话被销 2~3 次"（实测 `739a1b79` 销了三次：两份压缩留底 ＋ 一份归档留底，
//      而归档那份把前两份整个盖住了）。顺序是硬的：**本份写成功才动作**。
// ============================================================
const f29 = await import('../lib/f29-verified.js')
const SID3 = 'session-f23-dddd4444'
const dir3 = join(HOME, 'sessions', WS, SID3)
mkdirSync(dir3, { recursive: true })
writeFileSync(join(dir3, 'session.v3.jsonl.zstd'), Buffer.concat(evs.map(frame)))
// 先给它造一份"压缩留底"（模拟"这个会话压缩过、还没销账"）
f22.persistDump(SID3, '# 压缩留底（样本）\n\n- 样本内容\n', { kind: 'compact', preT: 2, items: 1, source: '样本' })
check('（前置）SID3 的压缩留底在 pending 里', f23.__exists(f22.mainPath(SID3, 'compact')))
check('（前置）`pendingDumpsOf` 列得出它', f22.pendingDumpsOf(SID3).length === 1)
check('（前置）`pendingDumpsOf` 不会把归档那份也列进来', f22.pendingDumpsOf(SID3, { except: null }).length === 1)

writeWorkspace([SID, OLD, SID3])
r = f23.checkArchivedSessions()
check('SID3 归档：留底 1 份', r.dumped === 1)
const body3 = readFileSync(f23.archivePaths(SID3).main, 'utf8')
check(
  '🔴 归档留底头注写明「本份盖住了那份旧留底」＋ 旧留底的基准 T（⚠️ **不许再写「已核过 / 可跳过」**—— 那份根本没被单独核过；2026-10-07 对抗审查抓出来的）',
  body3.includes('本份盖住了本会话此前那份压缩/裁剪留底') &&
    body3.includes('T2') &&
    body3.includes('此前没有被单独核过') &&
    !body3.includes('已核过'),
)
check('🔴 同会话的旧压缩留底**已就地作废**（pending 里没了）', !f23.__exists(f22.mainPath(SID3, 'compact')))
check('🔴 状态表里那条记录也没了（留意栏再也报不到它）', !f22.loadDumpState().dumps?.[`compact:${SID3}`])
check('🔴 作废 ≠ 删：它挪进了 verified', f23.__exists(f29.verifiedPath(SID3, 'compact')))
const stamp3 = f23.__exists(f29.verifiedPath(SID3, 'compact')) ? readFileSync(f29.verifiedPath(SID3, 'compact'), 'utf8') : ''
check('🔴 戳记写明"**被归档留底覆盖**"（不是"销账后挪入" —— 两种来路必须分得开）', stamp3.includes('被归档留底覆盖') && !stamp3.includes('**销账后挪入**'))
check('🔴 旧留底作废后**不再进"待销账"计数**（SID3 只算归档那一份）', f22.dumpNotice().count === 2)

// 这一段测完就清干净（免得干扰下面第四节"未销账计数"那几条断言）
{
  const st0 = f22.loadDumpState()
  if (st0.dumps) delete st0.dumps[`archive:${SID3}`]
  f22.saveDumpState(st0)
}
rmSync(f23.archivePaths(SID3).main, { force: true })
rmSync(f29.verifiedPath(SID3, 'compact'), { force: true })

// ============================================================
// 四、亮灯认得"归档留底"
// ============================================================
const notice = f22.dumpNotice()
check('亮灯里点名"归档留底"', notice.text.includes('归档留底') && notice.count === 1)
check('归档留底也进"未销账"计数', notice.text.includes('1 份未销账'))

// ============================================================
// 五、幂等：再检查一次不许重复留底
// ============================================================
r = f23.checkArchivedSessions()
check('同一个归档会话不会被重复留底', r.fresh === 0 && r.dumped === 0)

// ============================================================
// 六、归档了但日志找不到 → 不炸，且记"已处理"免得每轮重找
// ============================================================
writeWorkspace([SID, 'session-f23-cccc3333'])
r = f23.checkArchivedSessions()
check('找不到日志的会话：不抛错、只跳过', r.ok === true && r.fresh === 1 && r.dumped === 0)
// ⚠️ **"找不到"允许有限重试**（真机第一跑就因为查找 bug 把 11 个会话误判成 no-log）—— 试满 3 次才不再找
check('找不到日志：第 2 次还会再试（"找不到" ≠ "没有"）', f23.checkArchivedSessions().fresh === 1)
check('找不到日志：第 3 次也还试', f23.checkArchivedSessions().fresh === 1)
check('找不到日志：试满 3 次后才不再反复找', f23.checkArchivedSessions().fresh === 0)

// ============================================================
// 七、销账（2026-09-23 改：**只剩"提名"一条正路** —— 空删 / T 判据 / 备份份全拆了）
// ============================================================
check('🔴 归档路不再有"备份份"这条路（整条已拆）', typeof f23.archivePaths(SID).backup === 'undefined')
check('🔴 `dumpVerdict` 永远通过（它只管副作用，不是闸门）', f22.dumpVerdict(-1).ok === true)

// ============================================================
// 八、自检说得出话（沉默 ≠ 正常）
// ============================================================
const said = f23.reportF23()
// ⚠️ 2026-09-23：`reportF23()` 有两支（**有待销账**时那一支不提"已处理过"）——
//    原断言写死了"必须有已处理过"，于是它依赖 state 的具体内容，本来就脆。放宽成两支都认。
check('启动自检报得出"归档 N 个"（＋已处理过 / 待销账）', /归档留底 F23/.test(said) && /(已处理过|待销账)/.test(said))

done()
