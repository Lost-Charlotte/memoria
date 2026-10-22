/**
 * F30 · 第 10 关「不许自造会话日志读取器」—— 判据的样本回归。
 *
 * 由来（2026-09-21，用户拍板："你写 zstd 解压这个事情做闸门吧"）：
 *   那轮为了解释一个现象，AI **自己写了 6 版 zstd 解压脚本**去读 `~/.dsh/sessions/**.jsonl.zstd`，
 *   而现成的唯一入口 `read-session.mjs` 就写在《工具速查》表上 —— 每一版脚本 ＝ 一次全上下文重发
 *   （《总账》R30），是那 26 次调用里最贵的一段。
 *
 * 跑法：`node tests/f30-session-reader.mjs`（`node test.mjs` 会自动带上它）。
 *
 * 🔴 为什么样本必须住在 `tests/`（不能丢在 %TEMP% 里跑）：
 *   这一关**拦的正是"往临时目录写解压脚本"** —— 样本自己就带着那两个特征词，
 *   放外面会因为"写脚本"那一半被自己拦（**自锁**，《施工手册》坑 4 那一族）。
 *   插件目录内**明确放行**（`SELF_DIR_HINT`），所以测试只能住这儿。
 */
import { sessionReaderVerdict } from '../lib/f30-toolgate.js'

// 特征词**拆开拼**：免得这一行本身看起来就像"解压器源码"（判据只认函数名，但可读性也要顾）。
const Z = 'zstdDecompressSync'
const S = 'C:/Users/admin/.dsh/sessions/a/session.v3.jsonl.zstd'

const cases = [
  // —— 该拦：自己现写解压器（正是 2026-09-21 真实发生的那 6 版）——
  [
    '该拦 · pwsh 里现写解压',
    { name: 'pwsh', args: { command: `node -e "const z=require('zlib'); ${Z}('${S}')"` } },
    true,
  ],
  [
    '该拦 · 写临时 .cjs 解压器',
    {
      name: 'write',
      args: { file_path: 'C:/Users/admin/AppData/Local/Temp/insp.cjs', content: `const z=require('zlib'); ${Z}('${S}')` },
    },
    true,
  ],
  // —— 该放行：唯一入口、以及"只是看看"——
  [
    '放行 · 调现成读取器',
    { name: 'pwsh', args: { command: 'node C:/Users/admin/AppData/Local/dsh-session-reader/read-session.mjs byid 981cfaf0 head' } },
    false,
  ],
  [
    '放行 · 只列会话目录',
    { name: 'pwsh', args: { command: 'Get-ChildItem C:\\Users\\admin\\.dsh\\sessions -Recurse | Select-String zstd' } },
    false,
  ],
  [
    '放行 · 不碰会话日志的 zstd 解压',
    { name: 'pwsh', args: { command: `node -e "z.${Z}('D:/backup/other.zstd')"` } },
    false,
  ],
  // —— 边界：插件自己改自己，必须放行（否则就是自锁）——
  [
    '放行 · 插件目录(防自锁)',
    {
      name: 'write',
      args: { file_path: 'C:/Users/admin/.dsh/plugins/dsh-memoria/lib/f30-toolgate.js', content: `const z=require('zlib'); ${Z}('${S}')` },
    },
    false,
  ],
  // —— 边界：读类工具不该被这一关碰到（它是"写入面"那一半管的）——
  ['放行 · read 不受这一关影响', { name: 'read', args: { file_path: S } }, false],
]

let bad = 0
for (const [label, exec, want] of cases) {
  const got = !!sessionReaderVerdict(exec.name, exec.args)
  const ok = got === want
  if (!ok) bad += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label} => ${got ? '拦' : '放行'}${ok ? '' : `  (期望 ${want ? '拦' : '放行'})`}`)
}

if (bad === 0) {
  console.log(`✅ f30-session-reader：${cases.length} 条样本全过`)
  process.exit(0)
}
console.log(`❌ f30-session-reader：${bad} 条不符`)
process.exit(1)
