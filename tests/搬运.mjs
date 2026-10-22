/**
 * 搬运（编排器 `tools/搬运.mjs`）—— 2026-09-23
 *
 * 钉死四条（前三条是"这次试跑真踩出来的"）：
 *   ① 越界路径 / 目标已存在 → **当场拒**，一个字不写
 *   ② plan 命中引用 → 写清单 ＋ **退出码 2**（＝"停下等人分拣"，不是错）
 *   ③ 清单没分拣完 → go **拒绝执行**
 *   ④ 分拣好之后：go **干跑**通过、且**什么都不动**
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const HERE = fileURLToPath(new URL('.', import.meta.url))
const TOOL = join(HERE, '..', 'tools', '搬运.mjs')

const arch = makeArchive('搬运', {
  'L1-必读/索引.md': '# 索引\n\n| 文件 | 内容 |\n|---|---|\n| `L3-知识/旧名.md` | 样本 |\n',
  'L3-知识/旧名.md': '# 旧名\n\n样本正文\n',
})

const run = (args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GAI_DANG_ROOT: arch },
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

console.log('')

// ============================================================
// ① 硬护栏（先拒，什么都不写）
// ============================================================
{
  const r = run(['plan', '--from', '..\\..\\外面.md', '--to', 'L3-知识\\新名.md'])
  check('越界路径：当场拒', r.code === 1 && r.out.includes('越出档案根'))
}
{
  const r = run(['plan', '--from', 'L3-知识\\旧名.md', '--to', 'L3-知识\\旧名.md'])
  check('目标已存在：当场拒（不覆盖）', r.code === 1 && r.out.includes('已经存在'))
}

// ============================================================
// ② plan：列引用 → 写清单 → 停（退出码 2）
// ============================================================
const l9 = join(arch, 'L6-工具临时')
let listFile = ''
let body = ''
{
  const r = run(['plan', '--from', 'L3-知识\\旧名.md', '--to', 'L3-知识\\新名.md'])
  check('plan 命中引用后退出码 2（＝停下等人分拣）', r.code === 2)
  check('plan 说得出"命中几处"', /命中\s*1\s*处/.test(r.out))
  const files = existsSync(l9) ? readdirSync(l9).filter((f) => f.endsWith('.tsv')) : []
  check('plan 写出了清单', files.length === 1)
  listFile = join(l9, files[0] ?? '')
  body = existsSync(listFile) ? readFileSync(listFile, 'utf8') : ''
  check('清单里那处的动作还是「?」（等分拣）', /\t\?\t/.test(body))
  check('清单命中那一行是档案里真引用它的地方', body.includes('L1-必读\\索引.md'))
}

// ============================================================
// ③ 没分拣完 → 拒绝执行（这条是"别把没定的当定了"）
// ============================================================
{
  const r = run(['go', '--plan', listFile])
  check('清单没分拣完：go 拒绝执行', r.code === 1 && r.out.includes('没定动作'))
}

// ============================================================
// ④ 分拣好之后：干跑通过、什么都不动
// ============================================================
{
  writeFileSync(listFile, body.replace('\t?\t?\t', '\t改\tL3-知识/新名.md\t'), 'utf8')
  const r = run(['go', '--plan', listFile])
  check('分拣后：go **干跑**通过（退出码 0）', r.code === 0)
  check('干跑：源文件一个都没动', existsSync(join(arch, 'L3-知识', '旧名.md')))
  check('干跑：索引里那处引用**没被改**（干跑不写盘）', readFileSync(join(arch, 'L1-必读', '索引.md'), 'utf8').includes('L3-知识/旧名.md'))
}

done()
