#!/usr/bin/env node
/**
 * 口径扫.mjs —— **扫出"同一件口径被独立实现了几遍"**（只读 · 2026-09-28 建）
 *
 * 它治的病（用户 2026-09-28 原话：「光报告是不是有点不够。我们需要的是今后不再犯的机制……
 *   我们可以通过这个工具扫出所有重复，然后通过那个批量修改工具全部一次性改掉」）：
 *   **一处口径改了、好几个消费方没跟上** —— 于是要么**假警报**（地图报 35 条死指针），
 *   要么更糟：**静默丢内容**（索引重生成会掉 35 份正文）。
 *   今天一天撞了 11 次同类；光"索引该登记哪些文件"这一条就散在 **4 个文件**里
 *   （`tools/档案索引.mjs` · `lib/f17-map.js` · `tools/档案结构地图.mjs` · `lib/f5-check.js`）。
 *
 * ⚠️ **为什么不能只按关键词数**：`L1-必读` 出现在 53 个文件里 —— 绝大多数是**正常引用**，
 *   不是"独立实现"。所以这里只认**判据形态**（下面四类），并按"**判据键**"归一化后分组。
 *
 * 认这四类（都是"会随环境变、且一旦分散就会打架"的东西）：
 *   ① **路径解析**：一行里出现 `split('\\')` / `split('/')` —— 层名/子目录/文件名怎么切
 *   ② **本机路径**：字符串里含 `.dsh`（`~/.dsh/...` 这种写死路径）
 *   ③ **范围/格式字面量**：`=== 'L1-必读'` / `=== '.md'` 这类**含层名或扩展名的比较**
 *   ④ **判据正则**：源码里的正则字面量（短、且含 `L\d` / `\\` / `kind` / `\.md` 这些"判据味"的）
 *
 * 输出：**同一"键"出现在 ≥2 个文件**的组 → 逐个列出 `文件:行` 与那一行。
 *   分组键做了归一化（去空白、抹掉变量名差异），所以 `r.split('\\').length === 2` 与
 *   `f.split('\\').length === 2` 会落进**同一组** —— 那正是要抓的"两份副本"。
 *
 * 纪律：**只读**（不写任何文件）· 不算 tests（测试里大量 `length === 2` 是数组长度，不是口径）。
 *
 * 用法：
 *   node tools/口径扫.mjs            # 全部四类
 *   node tools/口径扫.mjs --kind 路径解析   # 只看某一类
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE) // 插件根
const DIRS = ['lib', 'tools'] // ⚠️ **不含 tests**（那里的 `length === 2` 多是数组长度）
const EXT = /\.(js|mjs)$/

const wantKind = (() => {
  const i = process.argv.indexOf('--kind')
  return i >= 0 ? process.argv[i + 1] : ''
})()

/** 归一化：去空白、把"变量名/属性名"抹平 —— 让 `r.split` 与 `f.split` 落进同一组。 */
const norm = (s) =>
  String(s)
    .replace(/\/\/.*$/, '') // 去行尾注释
    .replace(/\s+/g, '')
    .replace(/\b[a-zA-Z_$][\w$]*\./g, '.') // `r.split` → `.split`
    .replace(/\b[a-zA-Z_$][\w$]*\b/g, (m) => (m.length <= 3 ? 'x' : m)) // 短标识符（r/f/e/d/k…）一律当变量
    .slice(0, 160)

/** 一行 → 候选口径（可能多条）。
 *
 *  ⚠️ **跳过整行注释**（`//` / `*` / `/*` 开头）—— 注释里常常在**举例说明**某个口径
 *     （今天实测：那 9 组"本机路径"里 16 处全是注释里的说明），那不是"独立实现"。
 *  🔴 **豁免留痕**：行内含 `口径-已确认` 就整行跳过 —— 这是"**人判过：形似意不同**"的留痕
 *     （配 F25 那套做法；没有它，判过的组下次又会被扫出来、又得再判一遍 —— 那正是要终结的重复劳动）。
 */
function candidatesOf(line, file, no) {
  const out = []
  const t = line.trim()
  if (/^(\/\/|\*|\/\*)/.test(t)) return out
  if (/口径-已确认/.test(line)) return out
  const push = (kind, key, raw) => out.push({ kind, key, file, no, raw: raw.trim().slice(0, 150) })

  // ① 路径解析：怎么把"层\子目录\文件"切开
  if (/\.split\(\s*['"][\\/]+['"]\s*\)/.test(line)) push('路径解析', norm(line), line)

  // ② 本机路径：写死的 ~/.dsh 之类
  for (const m of line.matchAll(/['"`]([^'"`]*\.dsh[^'"`]*)['"`]/g)) push('本机路径', norm(m[1]), line)

  // ③ 范围/格式字面量：含层名或扩展名的比较（`=== 'L1-必读'` / `=== '.md'`）
  for (const m of line.matchAll(/[!=]==?\s*'([^']{2,60})'/g)) {
    const v = m[1]
    if (/^L\d+-|\.(md|txt|ps1|mjs|cmd|json|zstd)$|^\^?L\[/.test(v)) push('范围/格式字面量', norm(v), line)
  }

  // ④ 判据正则：短、且有"判据味"（层名 / 转义反斜杠 / kind / 扩展名）
  for (const m of line.matchAll(/\/((?:\\.|\[[^\]]*\]|[^/\n\\]){2,80})\/[gimsuy]*/g)) {
    const body = m[1]
    if (/L\\?d|\\\\|kind|\\\.(md|txt)|证据|临时/.test(body)) push('判据正则', norm(`/${body}/`), line)
  }
  return out
}

const files = []
const walk = (dir) => {
  let ents = []
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (/node_modules|\.git|快照/.test(e.name)) continue
      walk(p)
    } else if (EXT.test(e.name)) files.push(p)
  }
}
for (const d of DIRS) walk(join(PKG, d))

const groups = new Map() // `${kind}\u0000${key}` → [{file,no,raw}]
let lines = 0
for (const abs of files) {
  let text = ''
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    continue
  }
  const rel = relative(PKG, abs).replace(/\\/g, '/')
  text.split(/\r?\n/).forEach((line, i) => {
    lines += 1
    for (const c of candidatesOf(line, rel, i + 1)) {
      if (wantKind && c.kind !== wantKind) continue
      const k = `${c.kind}\u0000${c.key}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(c)
    }
  })
}

const dup = [...groups.entries()]
  .map(([k, list]) => ({ kind: k.split('\u0000')[0], key: k.split('\u0000')[1], list }))
  .map((g) => ({ ...g, files: [...new Set(g.list.map((x) => x.file))] }))
  .filter((g) => g.files.length >= 2) // 🔴 判据：**≥2 个文件**才算"独立实现了几遍"
  .sort((a, b) => b.files.length - a.files.length || a.kind.localeCompare(b.kind))

const byKind = new Map()
for (const g of dup) byKind.set(g.kind, (byKind.get(g.kind) || 0) + 1)

console.log('【口径扫】扫出"同一件口径写在 ≥2 个文件里"的组（只读）')
console.log(`  扫了 ${files.length} 个文件 / ${lines} 行（lib ＋ tools，**不含 tests**）`)
console.log(`  ⚠️ 疑似重复口径：**${dup.length} 组**` + (byKind.size ? `（${[...byKind].map(([k, v]) => `${k} ${v}`).join(' · ')}）` : ''))
console.log('')
console.log('  ⚠️ 它只报"**机械可判**"的重复；是不是**真该合成一份**、该收到哪个模块 —— 仍要人判。')
console.log('')

for (const g of dup) {
  console.log(`  ── [${g.kind}] ${g.files.length} 个文件：${g.key.slice(0, 100)}`)
  for (const x of g.list.slice(0, 8)) console.log(`       ${x.file}:${x.no}  ${x.raw.slice(0, 110)}`)
  if (g.list.length > 8) console.log(`       …还有 ${g.list.length - 8} 处`)
}
console.log('')
console.log('  📌 下一步（闭环的"改"）：')
console.log('     · **字面量型**（路径 / 层名 / 扩展名 / 格式）→ 可交 `tools/引用改写.mjs --find <旧> --replace-all <新>` 一次改掉')
console.log('     · **结构型**（同一条判据的实现代码）→ 收进共用模块（如 `lib/idx-scope.js`），各消费方改成 import —— 这步要人做')
