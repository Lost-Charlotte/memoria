/**
 * 引用改写 · **左右对照页**那条回路（2026-09-26 加 · 用户点的）
 *
 * 用户原话〔会话 2026-09-26〕："**工具会把被指引的地方连带前后一部分都挖给你。这样你只需要在一个
 *   界面左右对比，全部修改完成之后工具再批量替换回去？你觉得有戏吗？**"
 *
 * 这条链要证明的是四步都通：
 *   ① `--find ... --html`  **挖上下文 ＋ 生成单文件页面**（左现状 / 右定夺，不联网）；
 *   ② 页面「导出」出的 JSON → `--from-json`  **变回清单**；
 *   ③ `--plan` 读清单 → **生成事务**（干跑，一个字都不写）；
 *   ④ 台账仍旧走那扇唯一的门（`改档.mjs --txn`）—— 它自己不写档案。
 *
 * 跑法：`node tests/tool-yinyong-html.mjs`（`node test.mjs` 会带上它）。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { check, cleanup, done, makeArchive } from './harness.mjs'

const TOOL = join(import.meta.dirname, '..', 'tools', '引用改写.mjs')
const root = makeArchive('yy-html', {
  'L1-必读/00-必读-铁律.md': '# 铁律\n\n- 见 `第 12 行` 那一处（给读者指路）\n- 历史叙述：当年我们写过 `第 12 行` 这种指法\n',
  'L3-知识/记录.md': '# 记录\n\n- 上面那件的细节见 `第 12 行`\n',
  'L3-知识/无关.md': '# 无关\n\n- 这里没有那个词\n',
})
process.env.GAI_DANG_ROOT = root

const tmp = mkdtempSync(join(tmpdir(), 'yy-html-out-'))
const run = (args) => execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })

console.log('— ① --html：挖上下文 ＋ 生成单文件页面 —')
const htmlPath = join(tmp, '对照.html')
const out1 = run(['--find', '第 12 行', '--ctx', '1', '--html', htmlPath])
check('说清命中几处', /命中 3 处/.test(out1))
const html = readFileSync(htmlPath, 'utf8')
check('生成了单文件页面（自带 script／无外链）', html.includes('<script>') && !/<script[^>]+src=/.test(html))
check('左栏把**上下文**也挖出来了（现），右栏是定夺', html.includes('现状（上下文') && html.includes('定夺'))
check('页面里没有把档案原文之外的东西带出去（不联网：没有 http 外链）', !/https?:\/\/(?!www\.w3\.org)/.test(html))

console.log('')
console.log('— ② 页面导出的 JSON → --from-json 变回清单 —')
const jsonPath = join(tmp, '结果.json')
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      needle: '第 12 行',
      rows: [
        { rel: 'L1-必读/00-必读-铁律.md', line: 3, find: '第 12 行', act: '改', text: '`第 40 行`', original: '- 见 `第 12 行` 那一处（给读者指路）' },
        { rel: 'L1-必读/00-必读-铁律.md', line: 4, find: '第 12 行', act: '留', text: '', original: '- 历史叙述：当年我们写过 `第 12 行` 这种指法' },
        { rel: 'L3-知识/记录.md', line: 3, find: '第 12 行', act: '改', text: '`第 40 行`', original: '- 上面那件的细节见 `第 12 行`' },
      ],
    },
    null,
    2,
  ),
  'utf8',
)
const tsvPath = join(tmp, '清单.tsv')
const out2 = run(['--from-json', jsonPath, '--out', tsvPath])
check('清单已写、并报出几处', /清单已写/.test(out2) && /3 处/.test(out2))
check('清单里那三处的动作原样带过来了', /改/.test(readFileSync(tsvPath, 'utf8')) && /留/.test(readFileSync(tsvPath, 'utf8')))

console.log('')
console.log('— ③ --plan：读清单 → 生成事务（**干跑**，一个字都不写） —')
const out3 = run(['--plan', tsvPath])
check('报了"改动 2 处"（留的那处跳过）', /改动 2 处/.test(out3))
check('走的是**干跑**那条（默认不写）', /干跑/.test(out3))
const after1 = readFileSync(join(root, 'L1-必读/00-必读-铁律.md'), 'utf8')
check('干跑之后档案**一个字没变**', after1.includes('`第 12 行` 那一处'))

console.log('')
console.log('— ④ 安全：它自己不是写入口 —')
const src = readFileSync(TOOL, 'utf8')
check('工具源码里**没有**直接改档案的写操作（只生成事务、交给改档.mjs）', !/writeFileSync\(\s*join\(ARCHIVE/.test(src))
check('真落那一句是调 `改档.mjs --txn`', /GAI_DANG,\s*'--txn'/.test(src))

try {
  rmSync(tmp, { recursive: true, force: true })
} catch {
  /* 删不掉就算了 */
}
cleanup()
done()
