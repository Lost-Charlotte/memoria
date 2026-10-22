/**
 * G5 · 警示强制（2026-09-20 建 · 用户点的）。
 * 跑法：node tests/g5-warn.mjs
 *
 * 这一份钉的就是用户那句话：
 *   "**提醒之后第二轮发现你没做，用闸门强制你必须做。**"
 * 治的是当天实测那件事：留意栏那 2 条候选**从会话开始挂了几十分钟没人动**，直到用户自己提出来。
 *
 * 判据：**上一轮亮着几份留底、这一轮还是几份** → 拦；**第一轮只亮灯（放行）**。
 * ⚠️ 它**不复用 F26 的节流**：F26 是"同一内容不重复说"（减重），这里要的恰恰相反。
 */
import { check, done, sandboxHome } from './harness.mjs'

sandboxHome() // f7-gate.js 会 import common.js —— HOME_DIR / CFG 在模块加载那一刻就算好

const mod = await import('../lib/f7-gate.js')
const g = mod.dumpWarnVerdict

console.log('— G5 警示强制：第一轮亮灯、第二轮拦 —')
check('上一轮没见过（第一轮）→ 只亮灯、放行', g(1, '明细') === null)
check('第二轮还是那 1 份没动 → 拦', typeof g(1, '明细') === 'string')
check('拦的话术点了名（G5 ＋ 几份）', (g(1) ?? '').includes('G5') && (g(1) ?? '').includes('1 份'))
check('把它处理掉（0 份）→ 复位', g(0) === null)
check('复位之后又是"第一轮"（放行）', g(1) === null)
check('再一轮还没动 → 再拦', typeof g(1) === 'string')
check('份数变了（新留底进来）→ 不算"没动"，放行', g(2) === null)

done()
