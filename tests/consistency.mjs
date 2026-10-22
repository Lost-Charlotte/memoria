/**
 * 一致性回归：**文档里写的东西，必须与代码里的真相一致**。跑法：node tests/consistency.mjs
 *
 * 为什么单独立一个文件：档案 2026-09-16 那次全面审查的**头号病根**是两样 ——
 *   ① **副本病**（同一件事多处手抄，一处改了别处忘）；
 *   ② **元数字没来源**（把"会变的数"写死在正文里，改了就漂）。
 * 插件这边有一模一样的风险，而且**机器全能查**：
 *   · README 的能力表里列了哪个代号，就该与 `manifest.js` 的清单**双向一致**；
 *   · README 里抄的默认上限（注入 30,000 / 工具输出 24,000 / 400 行…）必须与**代码常量**一致；
 *   · CHANGELOG 顶部那一节的版本号必须与 `package.json` 一致。
 * ⚠️ 这个文件**不重复**各模块的行为测试 —— 它只查"文档 ↔ 代码"这一层。
 */
import { existsSync, readFileSync } from 'node:fs'

import { check, done, sandboxHome } from './harness.mjs'

sandboxHome() // 只为不碰真实 ~/.dsh（本文件其实一个字节都不写）

const { CAPS } = await import('../lib/manifest.js')
const { BUDGET, TOOL_OUTPUT } = await import('../lib/f12-budget.js')

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

console.log('')

// ============================================================
// 一、能力代号：README ↔ 清单，**双向都不许漂**
// ============================================================
// README 里的写法形如 `**注入预算（F12）**` 或 `**\`dangan_log\`（F6 · 落档）**`；
// 所以代号后面**允许还有别的字**（`[^）]*`），只要那个括号里是以代号开头。
const codeInReadme = new Set([...readme.matchAll(/\*\*[^*\n]{0,40}（([FR]\d+)[^）]*）\*\*/g)].map((m) => m[1]))
const codeInCaps = new Set(CAPS.map((c) => c.id))

const ghosts = [...codeInReadme].filter((id) => !codeInCaps.has(id)).sort()
const missing = [...codeInCaps].filter((id) => !codeInReadme.has(id)).sort()

check(`README 提到的代号都真存在（凭空写的：${ghosts.join(' / ') || '无'}）`, ghosts.length === 0)
check(`清单里每个能力 README 都写了（漏掉的：${missing.join(' / ') || '无'}）`, missing.length === 0)

// ============================================================
// 二、元数字：README 里抄的上限，必须与**代码常量**一致
//    （照档案的老规矩：这数不该手抄 —— 既然抄了，就由机器盯着）
// ============================================================
const fmt = (n) => Number(n).toLocaleString('en-US')

check(`README 里的注入总上限 = 代码里的 ${fmt(BUDGET.maxTotalChars)}`, readme.includes(fmt(BUDGET.maxTotalChars)))
check(
  `README 里三个单块上限 = 代码里的 ${fmt(BUDGET.maxEntryChars)} / ${fmt(BUDGET.maxTieChars)} / ${fmt(BUDGET.maxVoidChars)}`,
  readme.includes(fmt(BUDGET.maxEntryChars)) && readme.includes(fmt(BUDGET.maxTieChars)) && readme.includes(fmt(BUDGET.maxVoidChars)),
)
check(
  `README 里的工具输出上限 = 代码里的 ${fmt(TOOL_OUTPUT.maxChars)} 字符 / ${fmt(TOOL_OUTPUT.maxLines)} 行`,
  readme.includes(fmt(TOOL_OUTPUT.maxChars)) && readme.includes(fmt(TOOL_OUTPUT.maxLines)),
)
check(
  `README 里的"自报比例" = 代码里的 ${Math.round(BUDGET.warnRatio * 100)}%`,
  readme.includes(`${Math.round(BUDGET.warnRatio * 100)}%`),
)

// ============================================================
// 三、版本号：CHANGELOG 顶部那一节 == package.json
// ============================================================
const topVersion = (changelog.match(/^##\s+(\d+\.\d+\.\d+)/m) ?? [])[1]
check(`CHANGELOG 顶部版本（${topVersion}）== package.json（${pkg.version}）`, topVersion === pkg.version)

// ============================================================
// 四、清单卫生（与 manifest.mjs 不重叠的那几条）
// ============================================================
check('每个能力都有"给人看的一句话"（what）', CAPS.every((c) => typeof c.what === 'string' && c.what.length > 15))
check('每个能力都写了它属于哪一类（hook / tool / guard / sensor）', CAPS.every((c) => typeof c.kind === 'string' && c.kind.length > 0))
check('README 里没有把"已经被删掉的功能"还列着（这条靠上面的双向比对保证）', ghosts.length === 0)

// ============================================================
// 五、README 里点名的 `lib/<x>.js` 必须真的存在（防「幽灵文件」）
// ------------------------------------------------------------
// 2026-10-20 真事：目录树里列着 `f6-log.js` —— 文件早删了，README 还在指它；
// 同族还有 4 个不存在的 `tools/` 脚本。判据：README 里出现的 lib 文件名，全去磁盘对一遍。
// ============================================================
const libMentioned = [...new Set(readme.match(/lib\/[A-Za-z0-9_-]+\.js/g) ?? [])]
const libMissing = libMentioned.filter((m) => !existsSync(new URL(`../${m}`, import.meta.url)))
check(
  `README 点名的 lib 文件都存在（${libMentioned.length} 个）${libMissing.length ? `：缺 ${libMissing.join(' / ')}` : ''}`,
  libMissing.length === 0,
)

done()
