#!/usr/bin/env node
// ============================================================
// reconcile-dump —— 机械对账一份**留底骨架**，只吐"疑似没进档"的那几条
// ============================================================
// 规则与阈值都在 `lib/reconcile.js` 头部 —— **这里只是 CLI 壳，不抄第二份规则**。
//
// 用法（照抄）：
//   node reconcile-dump.mjs --skeleton <骨架.md> [--root <档案根>] [--brief] [--json]
//   node reconcile-dump.mjs --all [--root <档案根>]          # 跑 skeleton 目录下全部
//
// 🔴 **`--root` 与 `--archive` 是同一个意思**（`--root` 为主名，与 `档案索引.mjs` 统一；
//    `--archive` 留着兼容老命令）。**不给就默认"当前馆"** —— ⚠️ 跨馆核账时**必须给**，
//    否则它拿当前馆去搜，会报"完全搜不到"（2026-10-11 实测：那份留底属 DeepSeek档案，
//    而当时当前馆是游戏区馆 ⇒ 17 条真事全报 ❌，**看起来像丢档，其实只是搜错了地方**）。
//
// 退出码：0 ＝ 全部 ✅；1 ＝ 有 ⚠️/❌（**要人看一眼**）；2 ＝ 用法/读文件出错。
//
// 纪律：
//   · **只读**：读骨架、读档案；不写档案、不动留底、不删任何东西。
//   · 🔴 它只认**字面**：改写过的措辞会假阴性（报"未覆盖"）—— 报错只是多看一眼，漏报才是空删。
// ============================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CFG } from '../lib/common.js'
import { SKELETON_DIR } from '../lib/skeleton.js'
import { factLine, isCandidate, reconcileSkeleton } from '../lib/reconcile.js'

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const args = process.argv.slice(2)
  const getArg = (name, def = null) => {
    const i = args.indexOf(name)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def
  }
  if (args.includes('--help') || args.includes('-h') || (!getArg('--skeleton') && !args.includes('--all'))) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 18).join('\n'))
    process.exit(2)
  }
  // 🔴 **`--root` 与 `--archive` 同义**（`--root` 为主名 —— 与 `档案索引.mjs` 统一；`--archive` 兼容旧命令）。
  const archiveDir = getArg('--root') ?? getArg('--archive') ?? CFG.archiveDir
  const brief = args.includes('--brief')
  const asJson = args.includes('--json')

  const targets = args.includes('--all')
    ? (existsSync(SKELETON_DIR)
        ? readdirSync(SKELETON_DIR).filter((f) => f.startsWith('骨架-') && f.endsWith('.md')).map((f) => join(SKELETON_DIR, f))
        : [])
    : [getArg('--skeleton')]

  const out = []
  let worst = 0
  for (const p of targets) {
    if (!p || !existsSync(p)) {
      console.error(`❌ 找不到骨架：${p}`)
      process.exit(2)
    }
    const r = reconcileSkeleton(p, { archiveDir })
    if (!r.ok) {
      console.error(`❌ 对账失败（${p}）：${r.why}`)
      process.exit(2)
    }
    out.push(r)
    if (r.summary.weak || r.summary.miss) worst = 1
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    for (const r of out) {
      const s = r.summary
      // 🔴 2026-10-15（销账重组 · 判据 1 ＋ 2 —— 方案见 `L4-施工\工程-销账重组.md`）：
      //    产物从「逐条申报表」换成「**缺口清单 ＋ 折掉明细**」。
      //    以前报"待人看 N 处"，等于把用户按 W5 否掉的那些事（过程 / 寒暄 / 一次动作）
      //    重新抬成"档里的一条"来审 —— 而 W5 的默认值是「不落」，机制里根本没有那个默认项。
      //    现在：**查得到的当场折掉、并把"按什么折的"逐行同屏**（误折一眼可见）；
      //    只剩"查不到"的那几条要人判断，每条旁边带一句轻松的 W5
      //    （用户 2026-10-14 22:2x：「**别反问吧。放轻松宝贝。**」）。
      const inPool = r.facts.map((f, i) => isCandidate(f, r.facts[i - 1] ?? null))
      const folded = r.facts.filter((f, i) => f.verdict === 'ok' && inPool[i])
      const gaps = r.facts.filter((f, i) => f.verdict !== 'ok' && inPool[i])
      const noise = r.facts.filter((f, i) => !inPool[i])

      console.log(`\n留底对账 · 会话 ${r.sid || '?'} · 档案 ${r.archiveDir}`)
      console.log(`  真事 ${s.total} 条 → **缺口 ${gaps.length} 条**（已在档折掉 ${folded.length} · 不入候选池 ${noise.length}）`)

      console.log(
        `\n▸ **要你判断的（${gaps.length} 条）**${
          gaps.length === 0 ? '：没有 —— **缺口 0 条是合法结果**，核账记录照写就行' : ''
        }`,
      )
      for (const f of gaps) {
        console.log(`  ${factLine(f)}`)
        // 🔴 判据 2：每条旁边带一句**轻松一点的 W5 提醒** —— 只说门槛，不带质问、不带"必须"。
        console.log('     💬 按 W5：落不落只看一件事 —— 以后会不会因为不知道它而办错事？不会就不用落，没关系的。')
        console.log(`     真事：${f.text.replace(/\n/g, ' ').slice(0, 200)}`)
        const ev = f.evidence ?? []
        if (ev.length === 0) console.log('     档案 │（一处都没命中 —— ❌ 完全搜不到）')
        for (const e of ev) console.log(`     档案 │${e.file}:${e.no}│ ${String(e.raw).replace(/\n/g, ' ')}`)
      }

      if (folded.length > 0) {
        console.log(
          brief
            ? `\n▸ 已折掉 ${folded.length} 条（按"字面已覆盖"；要看明细去掉 --brief）`
            : `\n▸ **已折掉（不必补 · ${folded.length} 条）** —— 按"字面已覆盖"折的，**误折请当场说**：`,
        )
        if (!brief) for (const f of folded) console.log(`  ${factLine(f)}`)
      }

      if (noise.length > 0) {
        console.log(
          `\n▸ **不入候选池（${noise.length} 条）** —— 寒暄 / 太短 / 纯符号；留意栏也不会列它${brief ? '（要看明细去掉 --brief）' : ''}`,
        )
        if (!brief) for (const f of noise) console.log(`  ${factLine(f)}`)
      }
    }
    console.log('\n（⚠️/❌ 只表示"**字面没对上**" —— 档案里改写过用户措辞就会这样。**要人看一眼，不是缺口判决**。）')
  }
  process.exit(worst)
}
