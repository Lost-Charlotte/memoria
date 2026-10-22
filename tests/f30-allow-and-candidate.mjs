/**
 * 第三批的两条（2026-09-23）：
 *   ① **第 12 关不自锁** —— 留意期 `pwsh` 直调改档 / 引用改写必须**放行**
 *      （讨论稿 §十七-2 抓到的自锁：本该"逼我先归账"，结果变成"我根本归不了账"）
 *   ② **候选池过滤** —— 短句 / 纯标点 / 与上一条重复 → **不摆给人看**
 *      ⚠️ 它**只管显示**、不动裁决（动了就会把"有候选"伪装成"0 候选"）
 */
import { check, done, sandboxHome } from './harness.mjs'

sandboxHome()

const { isCandidate } = await import('../lib/reconcile.js')
const { DUMP_DEBT_PWSH_ALLOW } = await import('../lib/f30-toolgate.js')

const F = (norm, verdict = 'miss') => ({ norm, verdict, text: norm, time: '2026-09-23 00:00', ids: [], lcc: 0, cov: 0 })

console.log('')

// ---------- ① 第 12 关不自锁 ----------
check('留意期：pwsh 直调 `改档.mjs` **放行**', DUMP_DEBT_PWSH_ALLOW.test('node 改档.mjs --txn x.json'))
check('留意期：pwsh 直调 `引用改写.mjs` **放行**', DUMP_DEBT_PWSH_ALLOW.test('node 引用改写.mjs --plan x.tsv'))
check('销账链路那三个仍然放行', DUMP_DEBT_PWSH_ALLOW.test('node reconcile-dump.mjs --all'))
check('🔴 别的裸写**仍然被拦**（这道关没被放宽）', !DUMP_DEBT_PWSH_ALLOW.test('Set-Content x.txt hello'))

// ---------- ② 候选池过滤（只管显示） ----------
check('短句不入池：`嗯？`', !isCandidate(F('嗯？')))
check('纯标点不入池（长度够、但一个字母数字都没有）', !isCandidate(F('————————')))
check('与上一条归一化后相同 → 不入池', !isCandidate(F('同一条真事摆两遍'), F('同一条真事摆两遍')))
check('跟**更早**那条相同不影响（只比"上一条"）', isCandidate(F('同一条真事摆两遍'), F('中间隔了别的一句')))
check('长句真事入池', isCandidate(F('这是用户说的真真正正一件事')))
check('刚好 6 个字的短句也入池（边界）', isCandidate(F('指纹乱码了呢')))

done()
