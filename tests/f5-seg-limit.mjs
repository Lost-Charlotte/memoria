/**
 * 字数判据的**尺子**（`segLimitSplit` / `segLimitOver`）—— 纯函数回归测试
 *
 * 🔴 2026-10-15 改：原来这份测的是"体检对**存量事件表**逐段报错"那一半 ——
 *    而事件表随 L2 退役（用户口径："**这是结构变化**"）⇒ 那一半已从 `f5-check.js` 删除。
 *    但**尺子本身还在用**：提案口 `f6-log.js` 的拆段闸 · 织布机 `loom.js` 的字段校验
 *    （⚠️ **2026-10-15 又撤掉落档口那道 `segLimitGate`** —— L2 删后它拦的参数一个字都不写进档案）
 *    ⇒ 这份测试改成**直接测尺子**，覆盖不降（原来①②③"三类字段豁免"与④⑤⑥"存量报错"
 *      随 L2 下线；尺子本身的行为收进下面这些断言）。
 */
import { check, done, loadPlugin, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()
const mod = await loadPlugin()

const { segLimitSplit, segLimitOver, SEG_LIMIT } = await import('../lib/f5-check.js')

const LONG = '甲'.repeat(130) // 130 字 > 120

check(`尺子 ＝ ${SEG_LIMIT} 字`, SEG_LIMIT === 120)
check('短句 → 1 段', segLimitSplit('短句').length === 1)
check('没有句读的长句 → **仍是 1 段**（它按 <br> / 换行切，**不按句号切**）', segLimitSplit(LONG).length === 1)
check('`<br>` 断开 → 2 段', segLimitSplit('甲<br>乙').length === 2)
check('换行断开 → 2 段', segLimitSplit('甲\n乙').length === 2)
check('编号前缀 `1. ` 会被去掉', segLimitSplit('1. 甲')[0] === '甲')
check('空段被过滤（`甲<br><br>乙` → 2 段）', segLimitSplit('甲<br><br>乙').length === 2)
check('超长的那一段被 `segLimitOver` 抓出来', segLimitOver(LONG).length === 1 && segLimitOver(LONG)[0].length === 130)
check('合格的值 → `segLimitOver` 空数组', segLimitOver('短句').length === 0)
check('切开之后就合格了（两段各 70 字 → 无超标）', segLimitOver(`${'甲'.repeat(70)}<br>${'乙'.repeat(70)}`).length === 0)

done()
