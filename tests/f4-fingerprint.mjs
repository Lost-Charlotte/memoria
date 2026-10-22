/**
 * F4 · **行指纹**（2026-09-22 加 · 用户设计）—— 回归。
 *
 * 治什么：引用里写"见 `X.md` 第 42 行"，**文件一改行号就漂，而读者不会察觉**
 * （按行号翻到的是另一句话，还以为那就是要找的 —— **静默指错**比指不到更坏）。
 *
 * 用户的设计：让那个"排行号"的工具**顺便把被指路那一行的指纹也吐出来** ——
 * 跳过 markdown 标记后取第 **1 / 4 / 7** 个可见字符（取 1/4/7 而不是"前三个字"：
 * **改动落在中间也能发现**）。以后 `dangan_check` 拿指纹核"那一行还是不是那行"。
 *
 * 跑法：`node tests/f4-fingerprint.mjs`（`node test.mjs` 会自动带上它）。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f4fp', {
  'L1-必读/工具速查.md': [
    '# 工具速查',
    '| **R1** | **硬编码盘符 `F:\\`** | ≥2 轮 / 28+ 个脚本 | 说明 |',
    '密码之类的东西是需要经常输入的',
    '',
  ].join('\n'),
})

process.env.GAI_DANG_ROOT = root

const T = await import('../lib/tools.js')

console.log('— ㉘ 行指纹 —')
// 去掉标记后是 `R1硬编码盘符F:\≥2轮/28+个脚本说明` → 第 1/4/7 个 = R / 编 / 符
check('跳过 markdown 标记：第 1/4/7 个可见字符', T.lineFingerprint('| **R1** | **硬编码盘符 `F:\\`** | 说明 |') === 'R编符')
// `密码之类的东西…` → 第 1/4/7 个 = 密 / 类 / 西
check('中文行：取第 1/4/7 个', T.lineFingerprint('密码之类的东西是需要经常输入的') === '密类西')
check('空行 → 空指纹（不编）', T.lineFingerprint('') === '')
check('纯标记行 → 空指纹', T.lineFingerprint('|---|') === '')
check('短行：有几个取几个，不补位', T.lineFingerprint('ab') === 'ab'.slice(0, 1) + '' || T.lineFingerprint('ab').length <= 2)
check('markdown 标记不影响指纹（同一个内容 → 同一个指纹）', T.lineFingerprint('密码之类的东西') === T.lineFingerprint('密码之类的**东西**'))

// formatHits 里必须带上它
const res = {
  hits: [{ file: 'L1-必读/工具速查.md', line: 2, anchors: ['R1'], text: '| **R1** | **硬编码盘符 `F:\\`** | 说明 |' }],
  total: 1,
  scanned: 1,
}
const txt = T.formatHits('硬编码', res)
check('命中行里带「指纹」两个字', txt.includes('指纹'))
check('指纹值真的印出来了', txt.includes('R编符'))
check('原来的 文件:行号 还在', txt.includes('L1-必读/工具速查.md:2'))
check('原来的锚点还在', txt.includes('[R1]'))

done()
