#!/usr/bin/env node
/**
 * 行号加固.mjs —— 给"第 N 行"式的引用**补行指纹**，并把**漂了的行号自动找回来**
 *                （2026-09-22 建 · 用户设计；2026-10-01 补完"自动找"那一半）
 *
 * 用户原话〔会话 2026-09-22〕："**还会自动抓取被指路地方的第一行的…第一，第四，第七个字。
 * 这样即便无所谓内容是啥，你点进去只需要核，确实是这几个字就行了。也不用你大量重复的去改这些玩意。工具全自动。**"
 *
 * 用户原话〔会话 2026-10-01〕（**"自动找"就是照这句做的**）：
 *   "**但如你所说行号会变啊。。我觉得这样吧，或许可以给机器加一个，当检测到指纹脱离行号。
 *     会自动在上下五行或者十行里重新找。因为一般你就算改档案，也不会变动超过这么多行。
 *     那加上指纹本身就不太可能重复，在这个范围内找到的一模一样的指纹，那百分之九十九点九九就是之前的事情。**"
 *
 * 三种模式：
 *   · `--scan`（默认）—— 只读报告：每处引用 → 目标行现在长什么样 ＋ 算出来的指纹
 *   · `--fix` —— **干跑**（默认就是干跑）：把"打算怎么改"逐条摆出来**给人核**
 *   · `--fix --apply` —— 生成事务交给 `改档.mjs --txn`（**它自己不写**；快照 → 预检 → 写 → 读回）
 *
 * 🔴 **判据只有一份**：指纹算法与"认目标"都在 `lib/f13-anchors.js`。
 * 🔴 **两条不许破**（`T688` 的教训）：① **唯一命中才改**；② 搜不到 / 撞车 / 指纹太短 ⇒ **报给人，不猜**。
 * 🔴 **`--fix` 为什么必须先给人看**（这条是老工具第 11 行自己写的）：
 *    "**自动抓会把'已经指错的'固化下来**" —— 补指纹是**给现状盖章**，
 *    万一那处引用**本来就指错了**（今天实测有 3 处：写着"第 118 行"，可那行是空的），
 *    一补就等于**把错的盖成对的**。所以 `--fix` 先出预览（**带目标行原文**），核完再 `--apply`。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CFG, HOME_DIR } from '../lib/common.js'
import { lineFingerprint as fingerprint, resolveFpTarget } from '../lib/f13-anchors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 扫描范围 —— 判定与"认目标"都从 `ARCHIVE` 出发。 */
const SCAN_DIRS = ['L1-必读', 'L2-数据', 'L3-知识']
const GAI_DANG = join(HERE, '改档.mjs')

/** 命令行参数（**要在算 `ARCHIVE` 之前读** —— `--root` 就是拿来指临时档案给测试用的）。 */
const args = process.argv.slice(2)
/** `--root=<档案根>`：默认用配置里的档案；测试拿它指向临时档案（**不改生产配置**）。 */
const rootArg = args.find((a) => a.startsWith('--root='))
const ARCHIVE = rootArg ? rootArg.slice(7) : CFG.archiveDir
const wantFix = args.includes('--fix')
const apply = args.includes('--apply')

/** 「`` `文件` 第 N 行 ``」或「`` `文件` 第 N 行〔指纹〕 ``」—— 指纹可选（老引用多数还没有）。 */
const RE = /`([^`]+)`\s*第\s*(\d+)\s*行(?:\s*〔([^〕]*)〕)?/g
/** 自动找的搜索半径（用户说"上下五行或者十行"；我放宽到 15 —— 多搜不花钱，只多算几行）。 */
const RADIUS = 15
/**
 * 🔴 **这类"改"只许落在 L1（现行层）** —— 2026-10-01 定的口径。
 *    工具当天抓出一个真实的坑：`事件表:4858` 报"目标行是空的（要人定）"，
 *    可那**根本不是引用** —— 是刚落的一条**事件正文在叙述历史**（里面写了「`防丢总则` 第 118 行〔g档滚〕」当反例）。
 *    ⇒ **L2 事件表 / L3 知识层是"记录层"**：里面的行号是在**记"当时引用了哪一行"**，改了就等于**篡改记录**。
 *    ⇒ **L1 才补指纹**（那是给人照着去查的现行指路）；**L2/L3 只在报告里列出来**。
 * ⚠️ 定义必须放在**用它的地方之前**（`const` 不提升 —— 今天差一点又栽在 TDZ 上）。
 */
const isL1 = (file) => /^L1-必读[\\/]/.test(String(file))

const isEmpty = (s) => String(s ?? '').trim() === ''

function walk(dir, out = []) {
  let ents = []
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(md|txt)$/i.test(e.name)) out.push(p)
  }
  return out
}

function linesOf(rel) {
  try {
    return readFileSync(join(ARCHIVE, rel), 'utf8').split(/\r?\n/)
  } catch {
    return null
  }
}

/**
 * **自动找**：按指纹在目标文件里搜"那一行现在去哪了"。
 *
 * **两头搜**（2026-10-01 定，今天那 3 处就是证据）：
 *   · 窗口 A：**从"指针自己所在的位置"出发** —— 引用通常不搬家，而目标被推动的距离 ≈ 前面插了多少行；
 *   · 窗口 B：**从"引用写的旧行号"出发** —— 目标自己挪了、引用没动的情况。
 * ⚠️ 只有**唯一命中**才算成功；两个窗口给出**不同**答案、或窗口内有多个同指纹 ⇒ **报冲突，不猜**。
 * @returns {{hit:number|null, why:string, cands:number[]}}
 */
function findMoved(lines, fp, anchorLineNo, oldN) {
  if (!fp || fp.length < 3) return { hit: null, why: '指纹不足 3 字（短行退化）⇒ 不自动找', cands: [] }
  const collect = (center) => {
    const out = []
    const from = Math.max(1, center - RADIUS)
    const to = Math.min(lines.length, center + RADIUS)
    for (let i = from; i <= to; i++) {
      if (i === oldN) continue // 旧行号本身不算（它已经对不上了）
      if (fingerprint(lines[i - 1]) === fp) out.push(i)
    }
    return out
  }
  const uniq = [...new Set([...collect(anchorLineNo), ...collect(oldN)])].sort((x, y) => x - y)
  if (uniq.length === 0) return { hit: null, why: `±${RADIUS} 行内没找到「${fp}」`, cands: [] }
  if (uniq.length > 1) return { hit: null, why: `±${RADIUS} 行内有 ${uniq.length} 处同指纹（撞车）⇒ 要人看`, cands: uniq }
  return { hit: uniq[0], why: '', cands: uniq }
}

// ------------------------------------------------------------
// 扫描 ＋ 判定
// ------------------------------------------------------------
const items = []
const unresolved = []

for (const d of SCAN_DIRS) {
  for (const f of walk(join(ARCHIVE, d))) {
    let raw = ''
    try {
      raw = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    const lines = raw.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      RE.lastIndex = 0
      let m
      while ((m = RE.exec(line)) !== null) {
        const [, what, nStr, fpInRef = ''] = m
        const n = Number(nStr)
        const rel = resolveFpTarget(what, ARCHIVE)
        const at = `${relative(ARCHIVE, f)}:${i + 1}`
        if (!rel) {
          unresolved.push({ at, what, n })
          continue
        }
        const tl = linesOf(rel)
        const target = tl ? (tl[n - 1] ?? null) : null
        const nowFp = target === null ? '' : fingerprint(target)
        let verdict = ''
        let fix = null
        let newN = null
        let note = ''
        if (target === null) {
          verdict = '⚠️ 行号越界'
        } else if (isEmpty(target)) {
          verdict = '🔴 目标行是空的'
          note = '要人定（当年就指错了？）'
        } else if (!fpInRef) {
          verdict = '🟡 缺指纹'
          fix = 'add-fp'
          note = `补 〔${nowFp}〕`
        } else if (fpInRef === nowFp) {
          verdict = '✅ 对得上'
        } else {
          verdict = '🔴 漂了'
          const r = findMoved(tl, fpInRef, i + 1, n)
          if (r.hit) {
            fix = 'move'
            newN = r.hit
            note = `自动找到：第 ${n} → 第 ${r.hit} 行`
          } else {
            note = r.why || '搜不到'
          }
        }
        items.push({ file: relative(ARCHIVE, f), line: i + 1, raw: line, what, n, fpInRef, rel, target, nowFp, verdict, fix, newN, note })
      }
    }
  }
}

// ------------------------------------------------------------
// 报告
// ------------------------------------------------------------
console.log(`扫描完毕：**能解析的 ${items.length} 处** · 认不出目标的 ${unresolved.length} 处`)
console.log('')
console.log('| # | 引用处 | 指到 | 判定 | 说明 |')
console.log('|---|---|---|---|---|')
items.forEach((h, i) => {
  console.log(`| ${i + 1} | ${h.file}:${h.line} | \`${h.rel}\`:${h.n} | ${h.verdict} | ${h.note || '—'} |`)
})
if (unresolved.length > 0) {
  console.log('')
  console.log(`**认不出目标的 ${unresolved.length} 处**（指向档案外／代码符号 ⇒ 本工具不管）：`)
  for (const u of unresolved.slice(0, 20)) console.log(`  · ${u.at} —— 它写的是 \`${u.what}\` 第 ${u.n} 行`)
}

const addFp = items.filter((h) => h.fix === 'add-fp')
const moves = items.filter((h) => h.fix === 'move')
const needEye = items.filter((h) => h.verdict.startsWith('🔴'))
console.log('')
console.log(`**汇总**：补指纹 ${addFp.length} · 自动改行号 ${moves.length} · 要人看 ${needEye.filter((h) => !h.fix).length}`)

if (!wantFix) {
  console.log('')
  console.log('（这是**只读报告**。要动手：`--fix`（干跑＋预览）→ 核完再加 `--apply`。）')
  process.exit(0)
}

// ------------------------------------------------------------
// `--fix`：**先把要盖章的那些"目标行原文"摆出来给人核**
// ------------------------------------------------------------
console.log('')
console.log('## 要补指纹的（**只列 L1** —— 那是给人照着去查的现行指路；核一眼目标行对不对，补指纹＝给现状盖章）')
for (const h of addFp.filter((x) => isL1(x.file))) {
  console.log(`  · ${h.file}:${h.line} → \`${h.rel}\`:${h.n}〔${h.nowFp}〕`)
  console.log(`      目标行：${String(h.target).trim().slice(0, 100)}`)
}
{
  const rest = addFp.filter((x) => !isL1(x.file))
  if (rest.length > 0) console.log(`  （另有 **${rest.length} 处**在 L2/L3 —— 记录层，**只报告不补**）`)
}
if (moves.length > 0) {
  console.log('')
  console.log('## 要自动改行号的')
  for (const h of moves) console.log(`  · ${h.file}:${h.line}：第 ${h.n} → 第 ${h.newN} 行（\`${h.rel}\`）`)
}
const stuck = needEye.filter((h) => !h.fix)
if (stuck.length > 0) {
  console.log('')
  console.log('## ⚠️ 要人看的（**没动**）')
  for (const h of stuck) console.log(`  · ${h.file}:${h.line} → \`${h.rel}\`:${h.n} —— ${h.note}`)
}

if (!apply) {
  console.log('')
  console.log('（**干跑**：一个字没写。上面核完没问题，再加 `--apply` 生成事务。）')
  process.exit(0)
}

// ------------------------------------------------------------
// `--apply`：生成事务（**自己不写档案**）
// ------------------------------------------------------------
// 🔴 **"只改 L1"的口径定义在文件上方**（`isL1`）—— 理由写在那儿。
function rewrite(raw, it) {
  RE.lastIndex = 0
  return raw.replace(RE, (whole, what, nStr, fpInRef = '') => {
    if (what !== it.what || Number(nStr) !== it.n) return whole
    if (it.fix === 'add-fp') return `\`${what}\` 第 ${nStr} 行〔${it.nowFp}〕`
    if (it.fix === 'move') return `\`${what}\` 第 ${it.newN} 行` + (fpInRef ? `〔${fpInRef}〕` : '')
    return whole
  })
}

const todo = [...addFp, ...moves].filter((it) => isL1(it.file))
const skipped = [...addFp, ...moves].filter((it) => !isL1(it.file))
if (skipped.length > 0) {
  console.log('')
  console.log(`⚠️ **跳过 ${skipped.length} 处**（在 L2/L3 —— 那是记录层，**只报告不修改**）：`)
  for (const s of skipped.slice(0, 8)) console.log(`  · ${s.file}:${s.line} → \`${s.rel}\`:${s.n}（${s.note || s.verdict}）`)
}
const ops = []
for (const it of todo) {
  const text = rewrite(it.raw, it)
  if (text === it.raw) continue
  ops.push({ op: 'replace', file: it.file.split('/').join('\\'), line: it.line, text, expect: it.raw })
}
if (ops.length === 0) {
  console.log('没有要改的。')
  process.exit(0)
}
ops.sort((a, b) => b.line - a.line)
// 🔴 2026-10-10 加（织布机收口 · 阶段⑤）：环境变量 `MEMORIA_TXN_OUT` 指了就把事务写到那儿
//    （落盘交给调用方 —— 织布机就是这么接的）。⚠️ 没指 ⇒ 与以前一字不差。
const out = process.env.MEMORIA_TXN_OUT || join(process.env.TEMP || HOME_DIR, '事务-行号加固.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ ops }, null, 2), 'utf8')
console.log('')
console.log(`事务 ${ops.length} 条 → ${out}`)
console.log(`真写：node "${GAI_DANG}" --txn "${out}"`)
