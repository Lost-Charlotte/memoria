/**
 * 闸门表 ↔ 门卫代码：**两边必须对得上**（2026-10-22 新建）。
 *
 * 🔴 **为什么有它**（当天真事）：0.81.12 删了两道关（「第 6 关 重复读」＋「工具说明书闸门」），
 *    而 `manifest.js` 的 `GATES` 表**没跟着改** ⇒ 面板「闸门」页上摆着**两道已经不存在的关**，
 *    **用户的眼睛被骗了一整天**。子会话审计时把这条列为"最硬的倒欠"。
 *
 * ⇒ 这条测试干两件事：
 *    ① `GATES` 里每一道，**必须在 `f30-toolgate.js` 里真的能找着**；
 *    ② 反过来，`f30` 里删掉的关，`GATES` 里也不许还留着。
 *
 * ⚠️ **"存在"的判法**（跟代码里的写法绑死，改写法就得改这儿）：
 *    · **数字关**：源码里要有 `第 N 关`
 *    · **字母关**：注释里要有一行以 `// <字母> ` 开头
 *    📌 这是唯一一处"怎么算存在"的口径 —— **别在别的地方再写一份**（重述必漂）。
 */
import { readFileSync } from 'node:fs'

import { GATES } from '../lib/manifest.js'
import { check, done } from './harness.mjs'

const f30 = readFileSync(new URL('../lib/f30-toolgate.js', import.meta.url), 'utf8')
const f7 = readFileSync(new URL('../lib/f7-gate.js', import.meta.url), 'utf8')

/**
 * 这道关在**它那一组**的源码里的"存在标记" —— **判据的唯一实现**。
 * ⚠️ **两组关在不同的文件里，别拿一个文件查全部**：
 *    · `GATES[0]`（key=`F7`，落档闸门 G2/G5）⇒ `f7-gate.js`
 *    · `GATES[1]`（key=`F30`，动手前门卫）⇒ `f30-toolgate.js`
 *    （2026-10-22 第一版就栽在这儿：拿 `f30` 查 `G2/G5`，报了两条假缺。）
 */
function presentInCode(groupKey, key) {
  const src = groupKey === 'F7' ? f7 : f30
  if (/^[Gg]?\d+$/.test(String(key))) {
    // 落档闸门写成 `G2` / `G5`；门卫写成 `第 N 关`
    if (/^[Gg]/.test(String(key))) return new RegExp(`id:\\s*'${String(key)}'`).test(src)
    return src.includes(`第 ${key} 关`)
  }
  return new RegExp(`^\\s*//\\s*${String(key)} `, 'm').test(src)
}

const missing = []
for (const g of GATES) {
  for (const it of g.items) {
    if (!presentInCode(g.key, it.key)) missing.push(`${it.key}（${it.name}）`)
  }
}

check(`闸门表里每一道在 f30 里都真的存在（缺 ${missing.length} 道）`, missing.length === 0)
if (missing.length) console.log('   ❗ 说明书写了、代码里没有：', missing.join(' / '))

// 反向：`GATES` 总共几道 —— **钉一个数**，删关时这条会红（逼人来改，而不是悄悄漂）。
const total = GATES.reduce((n, g) => n + g.items.length, 0)
check(`闸门总数仍是 11 道（现在是 ${total}）—— 删/加关时必须同步改这里与说明文案`, total === 11)

// 🔴 **检查器自检**：一个"肯定不存在"的关号必须被判成缺 —— 否则这个测试永远绿、等于没写。
//    （2026-10-22 第一版就差点犯这个：拿 f30 查 G2/G5，报了两条**假缺**，反过来也可能永远不报缺。）
check('自检：不存在的关号要被判成"缺"（不然这个检查器永远绿）', presentInCode('F30', '99') === false)

done()
