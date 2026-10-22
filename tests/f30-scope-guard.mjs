// ============================================================
// F30 第 17 关 · 口径关 —— 回归测试（2026-09-28 建）
// ============================================================
// 这一关的存在理由（用户 2026-09-28 原话）：
//   「**不是让你常态化扫描**，是类似落待办这种，**限制你在写的时候就不要写那么多乱七八糟的地方。
//     止在源头。**不是说经常查经常改。是以后不发生。」
// ⇒ 所以这里钉两件事：**抄第二份的那一刻被拒** ＋ **该放行的别误拦**。
// 🔴 样本用的都是**今天真实扫出来的那几份副本的写法**（不是编的）。
// ============================================================
import { scopeGuardVerdict } from '../lib/f30-toolgate.js'

let pass = 0
let fail = 0
const check = (name, ok) => {
  if (ok) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    console.log(`  ❌ ${name}`)
  }
}

const PKG = 'C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria'
const LIB = `${PKG}\\lib\\f13-anchors.js`
const TOOLS = `${PKG}\\tools\\引用去路径.mjs`
const ARCHIVE = 'C:\\Users\\admin\\Desktop\\DeepSeek档案\\L4-施工\\清单-工程.md'
const w = (body, file = LIB) => scopeGuardVerdict('write', { file_path: file, content: body })
const e = (body, file = LIB) => scopeGuardVerdict('edit', { file_path: file, new_string: body })

// ---- 该拦的（= 今天那几份副本的原样写法）----
check('拦 · 自抄"取最后一段"（`lib/f13-anchors.js:332` 原样）', w(String.raw`const base = r.split(/[\\/]/).pop() ?? ''`) !== null)
check('拦 · 自抄"取最后一段"（`lib/f30-toolgate.js:205` 原样，单引号版）', w(String.raw`out.push({ name: String(rel).split('\\').pop(), rel })`) !== null)
check('拦 · 自抄"扫层目录"（`lib/f17-map.js:48` 原样）', w(String.raw`return readdirSync(AR).filter((e) => e.isDirectory() && /^L\d+-/.test(e.name))`) !== null)
check('拦 · 自抄"表分格"（`lib/f5-check.js:33` 原样 —— 已收拢，防它再长回来）', w(String.raw`const cellsOf = (row) => row.split(/(?<!\\)\|/)`) !== null)
check('拦 · 自抄"留底文件名格式"（`lib/f29-verified.js:187` 原样）', w(String.raw`if (!/^(归档留底|压缩留底)-[0-9A-Za-z]{8}\.md$/.test(e.name)) continue`) !== null)
check('拦 · `edit` 的新内容同样要查（不是只查 `write`）', e(String.raw`const base = f.split('\\').pop()`) !== null)
check('拦 · `tools/` 下的脚本也在射程内', w(String.raw`const base = x.split(/[\\/]/).pop()`, TOOLS) !== null)

// ---- 该放行的 ----
check('放行 · 行尾 `口径-已确认`（人判过、确实要写一份）', w(String.raw`const base = r.split(/[\\/]/).pop() // 口径-已确认：这里必须手写（理由：xxx）`) === null)
check('放行 · **整行注释**里说明口径（那是说明，不是实现）', w(String.raw`// 留底名形如 归档留底|压缩留底-<8位>.md，来源见 common.js`) === null)
check('放行 · 正确写法一：用共用来源 `baseOf()`', w(String.raw`import { baseOf } from './idx-scope.js'
const base = baseOf(r)`) === null)
check('放行 · 正确写法二：用 `scanLayerDirs()`', w(String.raw`import { scanLayerDirs } from './common.js'
const dirs = scanLayerDirs(CFG.archiveDir, { skipEvidence: true })`) === null)
check('放行 · 改**档案**时写路径（不归这关管）', w(String.raw`见 \`~/.dsh/memoria/memoria.log\` 的修改时间`, ARCHIVE) === null)
check('放行 · 非写工具（`read` 不属 WRITE_TOOLS）', scopeGuardVerdict('read', { file_path: LIB }) === null)
check('放行 · 普通的、没命中任何受管片段的代码', w(String.raw`export const ANSWER = 1 + 2`) === null)

// ---- 拒的时候必须说清"该用什么"（否则只是一道墙，不是一条路）----
{
  const v = w(String.raw`const base = r.split(/[\\/]/).pop() ?? ''`)
  check('拒的文案给得出**正确来源**（提到 baseOf 与第 17 关）', Boolean(v) && /baseOf/.test(v.reason) && /第 17 关/.test(v.reason))
  check('拒的文案带 `tag`（便于日志归因）', Boolean(v) && v.tag === '口径关')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
