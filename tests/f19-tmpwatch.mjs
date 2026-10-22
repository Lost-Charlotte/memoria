/**
 * F19 L9 看门（快照保留 ＋ 体积哨兵）—— 2026-09-17 晚。
 * 跑法：node tests/f19-tmpwatch.mjs
 *
 * 起因（用户当天）："**L9 岂不是真的堆得很大 / 我不想造成污染**"。
 * 实测真档案：L9 110 个文件 / 5.55 MB，其中改档快照占 82%，24 个快照全是当天的 —— **≈4.6 MB/天、无上限**。
 *
 * 这一份断言就盯四件事：
 *   ① **保留策略**算得对（最近 3 天 ∪ **最新 20 个** ∪ 每家族最新 1 个 —— 并集：最新 20 个永远保底）；
 *   ② 🔴 **该留的绝不许扔**（尤其是"某个家族唯一的那份退路"—— 哪怕它两个月前）；
 *   ③ **回收走回收站、自己不删**（代码里**没有**任何 `Remove-Item`：真删是那个唯一入口干的）；
 *   ④ 体积哨兵会出声；回收工具不在 → **只记日志、不抛错**。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

sandboxHome()

const stamp = (daysAgo, h = 10, m = 0) => {
  const d = new Date(Date.now() - daysAgo * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(h)}${p(m)}00-000-1-aaa`
}

// ---- 造一份带 L9 的样本档案 ----
const files = { 'L1-必读/00-必读-铁律.md': '# 铁律\n' }
const root = makeArchive('f19', files)
const L9 = join(root, 'L6-工具临时')
const mkSnap = (family, name, bytes = 4096) => {
  const dir = join(L9, family, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '01-事件表.md'), 'x'.repeat(bytes), 'utf8')
  writeFileSync(join(dir, 'manifest.json'), '{}', 'utf8')
  return dir
}
// 改档快照：20 个是今天的；5 个是 10 天前的
for (let i = 0; i < 20; i++) mkSnap('改档快照', stamp(0, 10, i))
const oldOnes = []
for (let i = 0; i < 5; i++) oldOnes.push(mkSnap('改档快照', stamp(10, 9, i)))
// 某家族**唯一**的那份退路：30 天前（策略必须留住它）
const loneOld = mkSnap('档案结构地图快照', stamp(30, 8, 0))
// 别的东西（不该被碰）：根下一个日志
writeFileSync(join(L9, '时间轴标级日志.txt'), 'log\n', 'utf8')

const mod = await loadPlugin()
const { CFG } = await import('../lib/common.js')
// ⚠️ **先把它指到一把不存在的回收工具上、并关掉"永久删"**，再 apply ——
//    否则 apply 里的启动自检会**真的**按保留策略把那 5 个"十天前"处理掉
//    （第一次跑测试时就是这么被自己坑了的：它真删了；反过来也证明这机制是活的）。
//    指到不存在的脚本 + 走回收站那条路 → 它只会记一行日志、什么都不动。
CFG.recycleTool = join(root, '..', `memoria-不存在的回收工具-${process.pid}.ps1`)
CFG.l9PermanentDelete = false
mod.apply(mockCtx(), { archiveDir: root })

const F = await import('../lib/f19-tmpwatch.js')

console.log('')
console.log('—— ① 统计与保留策略 ——')
const s0 = F.l9Stats()
check(`数得出 L9 有多大（${s0.files} 文件 / ${s0.mb} MB）`, s0.files === 53 && s0.mb > 0)
check(`认得 26 个快照（20 当天 + 5 十天前 + 1 三十天前）—— 实得 ${s0.snapshotCount}`, s0.snapshotCount === 26)

const { keep, drop } = F.planRetention()
check(`该扔 5 个（只有"十天前那 5 个"同时不满足三条规则）—— 实得 ${drop.length}`, drop.length === 5)
check('扔的全是十天前那批', drop.every((d) => oldOnes.some((p) => p === d.abs)))
check('🔴 **某家族唯一的那份退路**（30 天前）必须留住', keep.some((d) => d.abs === loneOld))
check('🔴 最新 20 个必须留住', keep.filter((d) => d.family === '改档快照').length === 20)
check('保留策略＝用户拍板的"最近 3 天 ∪ 最新 20 个"（⚠️ 2026-09-18 用户把 7 天改成 3 天；**最新 20 个永远留下**）', F.RETAIN.days === 3 && F.RETAIN.newest === 20)

console.log('')
console.log('—— ② 干跑不许动东西 ——')
const dry = F.applyRetention({ dryRun: true })
check(`干跑报 5 个 / 有大小（${dry.droppedMb} MB）`, dry.dropped === 5 && dry.droppedMb >= 0)
check('干跑之后那 5 个**还在原地**', oldOnes.every((p) => existsSync(p)))

console.log('')
console.log('—— ③ 走回收站那条路（留着的备选）：代码自己不删 ——')
// 造一把"假回收脚本"：它只把收到的清单抄一份出来（**故意不真删**），
// 于是"文件还在不在"就成了"代码有没有自己动手删"的证据。
CFG.l9PermanentDelete = false // 这一节测的是"回收站"那条备选路
const fakeTool = join(root, '..', `memoria-fake-recycle-${process.pid}.ps1`)
const marker = join(root, '..', `memoria-fake-recycle-out-${process.pid}.txt`)
writeFileSync(
  fakeTool,
  `param([string]$ListFile,[switch]$AllowLocalDrives,[switch]$DryRun)\nGet-Content -LiteralPath $ListFile | Set-Content -LiteralPath '${marker.replace(/'/g, "''")}' -Encoding UTF8\nWrite-Output "deleted-to-recyclebin: 5"\n`,
  'utf8',
)
CFG.recycleTool = fakeTool
const real = F.applyRetention()
check('回收跑成了、报 5 个', real.ok === true && real.dropped === 5)
check('清单交给了那个唯一入口（假脚本收到了 5 行路径）', existsSync(marker) && readdirSync(root).length > 0 && (await import('node:fs')).readFileSync(marker, 'utf8').split(/\r?\n/).filter(Boolean).length === 5)
check('🔴 **代码自己没删任何东西**（假脚本没删 → 目录全在）', oldOnes.every((p) => existsSync(p)))
check('回收记录落到本地状态文件（`~/.dsh`，不是档案里）', (() => {
  const st = F.loadL9State()
  return st.ok === true && st.dropped === 5 && typeof st.at === 'string'
})())

console.log('')
console.log('—— ③-b 永久删（用户 2026-09-17 授权：不进回收站，免得回收站也堆）——')
// 造一个"该被永久删"的（二十天前）＋ 两个"绝不许碰"的诱饵（不在家族里 / 在档案别处）
const doomed = mkSnap('改档快照', stamp(20, 6, 0))
const decoyInside = join(L9, '别碰我.txt')
writeFileSync(decoyInside, 'not a snapshot\n', 'utf8')
const decoyOutside = join(root, 'L1-必读', '00-必读-铁律.md')
CFG.l9PermanentDelete = true
const perm = F.applyRetention()
check(`永久删跑成了（删 ${perm.dropped} 个）`, perm.ok === true && perm.dropped >= 1)
check('🔴 该删的**真的没了**（不是进回收站）', !existsSync(doomed))
check('🔴 L9 根下那个诱饵**一根毛都没动**（只认两层的快照目录）', existsSync(decoyInside))
check('🔴 档案别处的文件也没被碰（护栏管住了）', existsSync(decoyOutside))
check('删除清单留档在 `~/.dsh`（谁、何时、删了哪些）', (() => {
  const st = F.loadL9State()
  return st.mode === '永久删' && typeof st.listFile === 'string' && existsSync(st.listFile)
})())
check('护栏本体：路径穿越 / 少一层 / 不在家族里 —— 一律拒', (() => {
  const L9abs = join(root, 'L6-工具临时')
  return (
    F.isSafeSnapPath(join(L9abs, '改档快照', 'x')) === true &&
    F.isSafeSnapPath(join(L9abs, '改档快照')) === false &&
    F.isSafeSnapPath(join(L9abs, '随便一个目录', 'x')) === false &&
    F.isSafeSnapPath(join(L9abs, '..', 'L1-必读', '索引.md')) === false &&
    F.isSafeSnapPath(join(root, 'L1-必读', '00-必读-铁律.md')) === false
  )
})())

console.log('')
console.log('—— ④ 哨兵与节流 ——')
check('体积哨兵会出声（阈值 0.001 MB → over）', F.l9Stats(0.001).over === true)
check('🔴 默认**不设**警戒线（用户 2026-09-17 深夜："即便是几个 G 也是临时的"）', F.L9_WARN_MB === null)
check('🔴 没设线时 over **永远 false**（不是"0 MB 也算超"）', F.l9Stats().over === false)
const said = F.reportF19()
check('自检说得出话（含 MB 与快照数）', /F19/.test(said) && /MB/.test(said) && /快照/.test(said))
// ⚠️ 默认档下这条**恒真**（压根没设线）；留它是因为它测的是**措辞不谎报** —— 给了数字的档仍然适用。
check('🔴 自检**不谎报**：没超阈值就不说"超警戒线"', !/超过 50 MB/.test(said))
const again = F.maybeCleanL9()
check('12 小时内不重复清（节流）', again.skipped === true)

console.log('')
console.log('—— ⑤ 回收工具不在 → 只记日志、不抛错（这一节测的是"回收站"那条备选路）——')
// 再塞一个"二十天前"的进来（它确实该被处理），然后把工具指到不存在的路径、并切回回收站模式
mkSnap('改档快照', stamp(20, 7, 0))
CFG.recycleTool = join(root, '..', '不存在的-recycle-del.ps1')
CFG.l9PermanentDelete = false
const before5 = F.l9Stats().snapshotCount
let threw = false
let third = null
try {
  third = F.applyRetention()
} catch {
  threw = true
}
check('🔴 不抛错（fail-open）', threw === false)
check('如实报"没跑成"', Boolean(third) && third.ok === false && /没跑成/.test(third.why))
check('东西一个没少（工具不在就继续堆着，绝不自作主张）', F.l9Stats().snapshotCount === before5)

done()
