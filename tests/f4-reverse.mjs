/**
 * F4 · `dangan_search` 的**空命中反查**（2026-09-22 加）—— 回归。
 *
 * 治什么：以前 0 命中只回一句"可以换更短的词"，等于**让我瞎试**。
 * 现在 0 命中当场**把词砍短再搜**（砍尾 1~2 字），能中的报出来 —— 打错字 / 多打一个字都接得住；
 * 同时把这次空查询记进 `~/.dsh/memoria.log`，让"我老搜不到什么"看得见。
 *
 * 跑法：`node tests/f4-reverse.mjs`（`node test.mjs` 会自动带上它）。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f4rev', {
  'L1-必读/工具速查.md': '# 工具速查\n口径巡检那一段在这里\n别的行\n',
  'L2-数据/01-事件表-我们做过什么.md': '# 事件表\n口径巡检上线了\n',
})

process.env.GAI_DANG_ROOT = root

const T = await import('../lib/tools.js')

console.log('— ㉗ 空命中反查 —')
const r1 = T.reverseLookup(['口径巡检t'])
check('砍掉尾字能反查到「口径巡检」', r1.length > 0 && r1[0].tried === '口径巡检')
check('反查结果带条数与样例位置', r1.length > 0 && r1[0].total > 0 && typeof r1[0].sample.file === 'string')

check('真找不到的词：反查也是空', T.reverseLookup(['zzzz不存在']).length === 0)
check('太短的词不反查（< 3 字直接跳过）', T.reverseLookup(['ab']).length === 0)

const f1 = T.formatHits('口径巡检t', { hits: [], total: 0, scanned: 2 })
check('0 命中时：正文里带「反查」', f1.includes('反查'))
check('0 命中时：报出了反查到的词', f1.includes('口径巡检'))
check('0 命中时：原来那句"全部要满足"还在', f1.includes('全部要满足'))

const f2 = T.formatHits('zzzz不存在', { hits: [], total: 0, scanned: 2 })
check('反查也空时：如实说"反查也没找到"', f2.includes('反查也没找到'))

const ok = T.formatHits('口径巡检', { hits: [{ file: 'a.md', line: 1, anchors: [], text: 'x' }], total: 1, scanned: 2 })
check('有命中时：一个字都不多说（不跑反查）', !ok.includes('反查'))

done()
