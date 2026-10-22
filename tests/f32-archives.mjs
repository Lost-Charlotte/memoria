/**
 * F32 · 多档案馆（馆列表 / 切馆 / 改名 / 新建 / 别馆只读 / 工地馆 / 记住与回退）。
 * 跑法：node tests/f32-archives.mjs
 *
 * 盯六件事：
 *   ① 当前馆**一定在表里**（老配置下第一次开面板就是这个形态）
 *   ② **切馆 ＝ 改 `CFG.archiveDir`**，且 epoch 前进（按馆的缓存从此作废）
 *   ③ 🔴 **改名只改显示名，磁盘目录一个字不动**（动目录＝搬文件，那是丢过 8 个文件的那类活）
 *   ④ 🔴 **别馆只读**：当前馆放行 · 别的馆拒 · 电脑其它地方放行；且**第 13 关真接上了**
 *   ⑤ **新建/登记**都走 F20 的 `bootstrap()`（只补缺、绝不覆盖 ⇒ 六层齐）；新建的馆是**工地馆**
 *   ⑥ 🔴 **记住上次选的馆 ＋ 坏了自己回退**（用户 2026-09-24："总不能卡死在老盘里"）
 *
 * ⚠️ 一个容易想歪的地方：**"切馆"只认馆表里的馆** —— 手上已有的目录要先经
 *    `createArchive`（新建/登记）进表，之后才切得过去。所以本测试第一步就是登记第二馆。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const { CFG, HOME_DIR } = await import('../lib/common.js')
const {
  archivesForPanel,
  createArchive,
  currentDir,
  inOtherArchive,
  isLabArchive,
  loadArchives,
  pickStartupArchive,
  renameArchive,
  resetStartupMemory,
  switchTo,
} = await import('../lib/f32-archives.js')
const { DIRS } = await import('../lib/f20-init.js')

const rootA = makeArchive('f32a', { '从这开始读.txt': '甲\n' })
CFG.archiveDir = rootA

console.log('')

// ---- ① 当前馆一定在表里 ----
const st0 = loadArchives()
check('当前馆**一定在表里**（老配置下第一次开面板就靠这条）', st0.archives.some((x) => resolve(x.dir) === resolve(rootA)))
check('面板清单给得出当前馆（active）', resolve(archivesForPanel().active) === resolve(rootA))
check('馆表里那一项**有名字**（不是空串）', String(st0.archives[0].name || '').length > 0)
check('老馆默认是 `main`（正式馆 ⇒ 闸门照旧严）', isLabArchive() === false)

// ---- ② 登记第二馆（＝工地馆）＋ 切馆 ----
const rootB = join(dirname(rootA), 'f32b')
const reg = createArchive('乙馆', rootB)
check('把一个**已存在的目录**登记成馆（＝只补缺 ＋ 进表）', reg.ok === true && resolve(reg.dir) === resolve(rootB))
check('🆕 新建的馆被标成 `lab`（工地馆 ⇒ 闸门只提醒不拦）', reg.kind === 'lab')
check('登记时六层也补齐了（bootstrap 只补缺）', DIRS.every((d) => existsSync(join(rootB, d))))

const e0 = Number(CFG.archiveEpoch || 0)
const sw = switchTo('乙馆')
check('切馆成功，且指到了新根', sw.ok === true && resolve(currentDir()) === resolve(rootB))
check('🔴 切馆会推进 epoch（按馆的缓存从此作废）', Number(CFG.archiveEpoch || 0) === e0 + 1)
check('切馆后表里两个馆都在', loadArchives().archives.length >= 2)
check('切馆后 active 跟着变', resolve(archivesForPanel().active) === resolve(rootB))
check('🔴 切到工地馆后 `isLabArchive()` ＝ true（闸门从此只提醒不拦）', isLabArchive() === true)
check('切到一个不存在的馆 → 拒（不炸）', switchTo('根本没这个馆').ok === false)

// ---- ③ 改名：只改显示名 ----
const dirBefore = currentDir()
const rn = renameArchive('乙馆', '乙馆二号')
check('改名成功', rn.ok === true && rn.name === '乙馆二号')
check('🔴 改名**没动磁盘目录**（currentDir 一个字没变）', currentDir() === dirBefore)
check('🔴 目录本身也真的还在（没被当成"改名"搬走）', existsSync(rootB))
check(
  '改完名，表里那一项跟着变',
  loadArchives().archives.some((x) => x.name === '乙馆二号' && resolve(x.dir) === resolve(rootB)),
)
check('改成一个已经存在的名字 → 拒', renameArchive('乙馆二号', loadArchives().archives[0].name).ok === false)
check('改成一个空名字 → 拒', renameArchive('乙馆二号', '   ').ok === false)

// ---- ④ 别馆只读（用户 2026-09-23 点名的："保护另一个馆"）----
CFG.archiveDir = rootA
check('当前馆里的路径 → 放行', inOtherArchive(join(rootA, '从这开始读.txt')) === null)
const hit = inOtherArchive(join(rootB, '从这开始读.txt'))
check('🔴 **别馆里的路径 → 拒**', hit !== null && resolve(hit.dir) === resolve(rootB))
check('🔴 别馆的**根目录本身**也拒（不能整馆搬走 / 删掉）', inOtherArchive(rootB) !== null)
check(
  '电脑其它地方（%TEMP%）→ 放行（用户："可以改你这个馆**和电脑**"）',
  inOtherArchive(join(process.env.TEMP || 'C:\\Windows\\Temp', 'x.txt')) === null,
)
check('空 / 非字符串 → 放行（不炸）', inOtherArchive('') === null && inOtherArchive(null) === null)

// ---- ⑤ 新建第三个馆 ----
const rootC = join(dirname(rootA), 'f32c')
const cr = createArchive('丙馆', rootC)
check('新建成功', cr.ok === true && resolve(cr.dir) === resolve(rootC))
check('🆕 六层目录都建出来了（复用 F20 的骨架）', DIRS.every((d) => existsSync(join(rootC, d))))
check('新建之后它进了馆表', loadArchives().archives.some((x) => resolve(x.dir) === resolve(rootC)))
check('重名的馆 → 拒', createArchive('丙馆', join(dirname(rootA), 'f32d')).ok === false)
check('🔴 名字里带路径字符 → 拒（不许逃出桌面）', createArchive('坏/名字', join(dirname(rootA), 'f32e')).ok === false)

// ---- ⑥ 第 13 关真的**接上了**（"判据写了" ≠ "门装了"）----
const { verdict } = await import('../lib/f30-toolgate.js')
CFG.archiveDir = rootA
const vOther = verdict({ name: 'write', arguments: { file_path: join(rootB, 'x.md'), content: 'x' } })
check('🔴 第 13 关：写**别馆**的文件 → 被 verdict 拒', vOther !== null && /别馆/.test(String(vOther.tag)))
const vOwn = verdict({ name: 'write', arguments: { file_path: join(rootA, 'x.md'), content: 'x' } })
check('写**当前馆**的文件 → 第 13 关不拦它（tag 不该是"别馆"）', !vOwn || !/别馆/.test(String(vOwn.tag)))

// ---- ⑦ 🔴 记住上次选的馆 ＋ 坏了自己回退（用户 2026-09-24）----
const AFILE = join(HOME_DIR, 'memoria-archives.json')
const rawA = JSON.parse(readFileSync(AFILE, 'utf8'))
check('🔴 馆表里**存着上次选中的馆**（重启不会再把你甩回老馆）', typeof rawA.active === 'string' && rawA.active.length > 0)
check('🔴 每项都带 kind（main / lab）—— 工地馆靠它决定闸门宽严', rawA.archives.every((a) => a.kind === 'main' || a.kind === 'lab'))
check('🔴 新建的馆在盘上也标成 lab', rawA.archives.some((a) => a.kind === 'lab'))

// 让"上次记着的那个"是一个**健康的**馆（rootB 是 bootstrap 过的工地馆；
// 而 rootA 只有入口文件 —— `archiveState` 判它不健康，正好留给下面那条"会跳过坏的"用）
switchTo('乙馆二号')
resetStartupMemory()
const pk = pickStartupArchive()
check('启动选馆：优先用**上次记着的那个**（它健康 ⇒ 原样用、不折腾）', pk.ok === true && resolve(pk.dir) === resolve(rootB) && pk.changed === false)

// 把记忆改成一个不存在的目录 → 必须回退，不能卡死
const broken = JSON.parse(readFileSync(AFILE, 'utf8'))
broken.active = join(dirname(rootA), '这个馆不存在')
writeFileSync(AFILE, JSON.stringify(broken, null, 2), 'utf8')
const pk2 = pickStartupArchive()
check('🔴 记忆里那个馆不在了 → **回退**到健康的馆（不卡死在老盘里）', pk2.ok === true && existsSync(pk2.dir))
check('回退之后当前馆不会被设成一个不存在的目录', existsSync(currentDir()))

done()
