#!/usr/bin/env node
// ============================================================
// dump-skeleton —— 给某份留底生成"骨架"（销账时读它，不读全文）
// ============================================================
// 规则与实测数字都在 `lib/skeleton.js` 头部 —— **这里只是 CLI 壳，不抄第二份规则**。
//
// 用法（照抄）：
//   node dump-skeleton.mjs --log <session.v<N>.jsonl.zstd> [--out <骨架.md>]
//   默认输出：`~/.dsh/memoria-dumps/skeleton/骨架-<会话短id>.md`
//
// 纪律：
//   · **只读日志、只写骨架**；不碰档案、不改留底、不删任何东西。
//   · 输出已存在 → **拒绝并退出非 0**（绝不覆盖）；要重来先自己删（走 `recycle-del.ps1`）。
//   · ⚠️ 骨架**不是**"用完就删"的临时件：**销账时不删它**（保留到留底到期，3 天 —— 2026-09-29 用户定）。
//     它有两个独立用处：① `f29` 的**复查**要读它（校准"机器报 0 候选可不可信"）；
//     ② **回溯**被揉掉那段对话（2026-09-29 实测：压缩前推进的事只能靠它快速捞回来）。
// ============================================================

import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readSessionEvents } from '../lib/f23-archive-dump.js'
import { writeSkeleton } from '../lib/skeleton.js'

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const args = process.argv.slice(2)
  const getArg = (name, def = null) => {
    const i = args.indexOf(name)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def
  }
  const LOG = getArg('--log')
  if (!LOG || args.includes('--help') || args.includes('-h')) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 20).join('\n'))
    process.exit(LOG ? 0 : 2)
  }
  if (!existsSync(LOG)) {
    console.error(`❌ 找不到日志：${LOG}`)
    process.exit(2)
  }

  const sid = /session-([0-9a-f-]{8,})/.exec(LOG)?.[1] ?? basename(LOG).slice(0, 8)
  const { events, badLines, failedFrames } = readSessionEvents(LOG)
  // 🔴 2026-10-10 加 `--replace`：**手动重建**时要能覆盖。
  //    默认仍是"已存在就不覆盖"（`create` → `wx`，防误覆盖 —— 见下面 exit 3 那条）⇒ 要覆盖得**显式**要。
  //    ⚠️ 真踩过：想重建一份干净的骨架（它叠了两份），被 `wx` 拦下、还以为"重建成功了"。
  const wantReplace = process.argv.includes('--replace')
  const res = writeSkeleton(sid, events, LOG, {
    out: getArg('--out') ?? undefined,
    ...(wantReplace ? { mode: 'replace' } : {}),
  })

  if (!res.ok) {
    console.error(`❌ 没写成：${res.why}\n   ${res.out}`)
    process.exit(res.why === '骨架已存在（不覆盖）' ? 3 : 4)
  }
  const s = res.stats
  console.log(`✅ 骨架已写出：${res.out}`)
  console.log(`   事件 ${s.events} 条（坏行 ${badLines} · 坏帧 ${failedFrames}）`)
  console.log(`   用户真事 ${s.userMsgs} 条 / ${s.userChars} 字符（逐字全留）`)
  console.log(`   我的正式答复 ${s.textBlocks} 条 / ${s.textChars} 字符（逐字全留）`)
  console.log(`   丢掉 ${s.dropped} 字符：思考链 ${s.reasoningBlocks} 块/${s.reasoningChars} · 工具结果 ${s.toolChars} · 机器注入 ${s.injected} 段/${s.injectedChars}`)
  console.log(`   → 骨架 ${res.chars} 字符`)
}
