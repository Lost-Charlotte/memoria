/**
 * 行号加固 · **"自动找"的三个场景** —— 跑法：`node tests/行号加固-自动找.mjs`
 *
 * 为什么单独测这一份（2026-10-01）：`tools/行号加固.mjs` 那天**补完了"自动找"那一半**
 *   （用户设计：指纹脱离行号时，在附近 ±N 行里按指纹重新定位）。
 *   而这条路**必须钉三件事**——尤其后两条是**反向断言**：
 *     ① **能找到**：目标被编辑推动了十几行 ⇒ 按指纹把它找回来、报告新行号
 *     ② 🔴 **撞车不许乱改**：范围内有 2 处同指纹 ⇒ **报"要人看"，一个都不许改**
 *     ③ 🔴 **找不到不许猜**：范围内 0 命中 ⇒ **报"搜不到"，不许瞎指一个**
 *   ⚠️ 别嫌这三条啰嗦：**"唯一命中才认"是 `T688` 那次教训换来的**（猜错比不找更坏）。
 *
 * 做法：**造一个临时档案**（`--root` 指过去 ⇒ 不碰生产配置、不动真档案），
 *   用**子进程**跑真工具、读它的输出（测的是"用户会看到什么"，不是内部函数）。
 * ⚠️ **引用要写成带扩展名的**（`` `目标.md` ``）：`resolveFpTarget` 里**别名那条路**（`防丢总则` 这类）
 *   走的是 `findByNameUnique()` —— **它只认生产档案**（`--root` 传不进去）；**带扩展名的才走 `walk(root)`**
 *   ⇒ 只有带扩展名，临时档案里的引用才解析得出来。这也更接近真实写法。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check, done } from './harness.mjs'
// 🔴 指纹算法**只有一份**（`lib/f13-anchors.js`）—— 测试也用它，别自己实现一套。
import { lineFingerprint as fingerprint } from '../lib/f13-anchors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const TOOL = join(PLUGIN, 'tools', '行号加固.mjs')

/** 造一份最小档案：`目标.md` 里放好"目标行"，`L1-必读/指针.md` 里写引用。 */
function makeArchive(name, { refLine, targetLines }) {
  const root = mkdtempSync(join(tmpdir(), `memoria-行号-${name}-`))
  mkdirSync(join(root, 'L1-必读'), { recursive: true })
  writeFileSync(join(root, 'L1-必读', '目标.md'), targetLines.join('\n') + '\n', 'utf8')
  writeFileSync(join(root, 'L1-必读', '指针.md'), refLine + '\n', 'utf8')
  return root
}

/**
 * **指纹别硬编码** —— 用工具自己那份算法现算。
 * ⚠️ 为什么（2026-10-01 实测踩过）：我心算「`- **结果**：这一句就是目标（唯一）`」的指纹时，
 *    **漏了"结果"两个字也参与采样**（标点剔掉后它还在）⇒ 我写「结就目」、工具算出「结是一」，
 *    测试四条里挂了三条、查了半天。**判据只有一份**（`lib/f13-anchors.js`），测试也照它取。
 */
const FP = (line) => fingerprint(line)

/** 跑工具、拿它的全部输出（`--fix` 干跑 —— 绝不用 `--apply`，测试不许写任何东西）。 */
function runTool(root) {
  try {
    return execFileSync(process.execPath, [TOOL, `--root=${root}`, '--fix'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

// ============================================================
// ① 能找到：目标被编辑推动了（旧行号 10，实际挪到 25）
// ============================================================
// 指针在第 3 行；目标文件里"那一行"在第 25 行 —— 正好落在"从指针位置 ±15"的窗口里。
{
  const target = Array.from({ length: 40 }, (_, i) => (i === 24 ? '- **结果**：这一句就是目标（唯一）' : `- 填充行 ${i + 1}`))
  const root = makeArchive('found', {
    refLine: ['# 指针', '', `见 \`目标.md\` 第 10 行〔${FP('- **结果**：这一句就是目标（唯一）')}〕。`].join('\n'),
    targetLines: target,
  })
  const out = runTool(root)
  check('① 能找到：报告里出现"自动找到"', /自动找到：第 10 → 第 25 行/.test(out), out.split('\n').filter((l) => /漂了|自动找到/.test(l)).join(' / '))
}

// ============================================================
// ② 🔴 撞车：范围内两处同指纹 ⇒ 报"要人看"，且**不许改**
// ============================================================
{
  const target = Array.from({ length: 40 }, (_, i) =>
    // ⚠️ 两处重复**都要落在搜索窗口内**（指针在第 3 行、半径 15 ⇒ 1~18 行）：放在第 9 与第 16 行。
    //    第一版我把第二处放在第 29 行（窗口外）⇒ 工具只找到 1 处、报"自动找到"，**它没错，是我夹具没摆好**。
    i === 8 || i === 15 ? '- **结果**：这一句就是目标（重复）' : `- 填充行 ${i + 1}`,
  )
  const root = makeArchive('clash', {
    refLine: ['# 指针', '', `见 \`目标.md\` 第 10 行〔${FP('- **结果**：这一句就是目标（重复）')}〕。`].join('\n'),
    targetLines: target,
  })
  const out = runTool(root)
  check('② 撞车：报告里出现"撞车"', /撞车/.test(out), out.split('\n').filter((l) => /撞车/.test(l)).join(' / '))
  check('🔴 撞车：**不许**自动改（没有"自动找到"）', !/自动找到/.test(out))
}

// ============================================================
// ③ 🔴 找不到：那个指纹在文件里根本不存在 ⇒ 报"搜不到"，不许瞎指
// ============================================================
{
  const target = Array.from({ length: 40 }, (_, i) => `- 填充行 ${i + 1}`)
  const root = makeArchive('missing', {
    refLine: ['# 指针', '', `见 \`目标.md\` 第 10 行〔${FP('- **结果**：这一句就是目标（唯一）')}〕。`].join('\n'),
    targetLines: target,
  })
  const out = runTool(root)
  check('③ 找不到：报告里出现"没找到"', /没找到/.test(out), out.split('\n').filter((l) => /没找到|漂了/.test(l)).join(' / '))
  check('🔴 找不到：**不许**自动改', !/自动找到/.test(out))
}

// ============================================================
// ④ 反向：**对得上就不该动它**（别把好引用改了）
// ============================================================
{
  const target = Array.from({ length: 40 }, (_, i) => (i === 9 ? '- **结果**：这一句就是目标（就在原位）' : `- 填充行 ${i + 1}`))
  const root = makeArchive('intact', {
    refLine: ['# 指针', '', `见 \`目标.md\` 第 10 行〔${FP('- **结果**：这一句就是目标（就在原位）')}〕。`].join('\n'),
    targetLines: target,
  })
  const out = runTool(root)
  check('④ 对得上 ⇒ 判定"✅ 对得上"', /✅ 对得上/.test(out))
  check('🔴 对得上 ⇒ 一个字都不改', !/自动找到/.test(out) && !/^ {2}· .*→/m.test(out))
}

done()
