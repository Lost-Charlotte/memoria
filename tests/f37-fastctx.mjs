// F37 · FastCtx 文件清单读法（`lib/f37-fastctx.js`）—— 2026-10-11
// 跑法：node tests/f37-fastctx.mjs
//
// 断言三组：
//   ① **在不在要自报**（不许静默失效）：exe 探不到时，`filesMode` 必须回 `ok:false` **且带 why**；
//   ② **真调通**（本机装了才跑）：拿档案里一个**大概率存在**的词去搜，回执必须 `ok`；
//   ③ **输出收窄**：无论命中多少，回给模型的行数都不得超过内部上限（200 行 ＋ 表头 ＋ 溢出提示）。
//
// 🔴 本测试**只读**：它不写任何档案、不碰 `~/.dsh` 之外的东西（唯一例外：FastCtx 自己在 %TEMP% 下的临时目录，由内核自建自清）。

import { pathToFileURL } from 'node:url'
import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'

const mod = await import(pathToFileURL('C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\lib\\f37-fastctx.js').href)
const { FASTCTX_EXE, fastctxExe, filesMode } = mod

let passed = 0
let failed = 0
const t = (name, fn) => {
  try { fn(); passed += 1; console.log('  ✅ ' + name) }
  catch (e) { failed += 1; console.log('  ❌ ' + name + ' —— ' + (e?.message ?? e)) }
}

console.log('=== F37 FastCtx ===')
console.log('  exe: ' + FASTCTX_EXE)

t('① exe 探针：在就说在、不在就回 null（不抛）', () => {
  const got = fastctxExe()
  assert.ok(got === null || typeof got === 'string', 'fastctxExe() 只能回 null 或字符串')
  if (got !== null) assert.ok(existsSync(got), '报"在"就必须真的存在：' + got)
})

const have = fastctxExe() !== null
if (!have) {
  console.log('  ⏭ 本机没装 FastCtx —— 跳过 ②③（只验"不在时要自报"）')
  t('①b 不在时：filesMode 必须 ok:false 且带 why（不许静默）', () => {
    const r = filesMode('任何词', 'L3-知识')
    assert.equal(r.ok, false, '不在时不该报 ok')
    assert.ok(typeof r.why === 'string' && r.why.length > 0, '必须给出 why（自报工作量）')
  })
} else {
  const word = process.argv[2] || '销账'
  const r = filesMode(word, 'L3-知识')
  t('② 真调通：回执 ok（词：「' + word + '」）', () => {
    assert.equal(r.ok, true, '没调通：' + (r.why || '(没给 why)'))
    assert.ok(r.text.length > 0, 'ok 了却没有文本')
  })
  if (r.ok) {
    t('③ 输出收窄：行数 ≤ 203（200 ＋ 表头 ＋ 溢出提示）', () => {
      const n = r.text.split('\n').filter(Boolean).length
      assert.ok(n <= 203, '回给模型的行数超标：' + n)
    })
    t('③b 回执头必须自报"命中几个文件 ＋ 耗时"（可被发现）', () => {
      assert.ok(/命中 \*\*\d+ 个文件\*\*/.test(r.text), '回执头里没有"命中 N 个文件"：' + r.text.slice(0, 80))
      assert.ok(/耗时 \d+ ms/.test(r.text), '回执头里没有耗时：' + r.text.slice(0, 80))
    })
  }
}

console.log('')
console.log('=== 通过 ' + passed + ' · 失败 ' + failed + ' ===')
process.exit(failed === 0 ? 0 : 1)
