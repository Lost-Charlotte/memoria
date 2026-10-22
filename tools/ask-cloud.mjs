#!/usr/bin/env node
// ============================================================
// ask-cloud —— 把"苦活文本加工"派给**免费云模型**，结果只落文件、不进对话
// ============================================================
//
// 为什么有它（用户 2026-09-18 晚）：
//   "**子代理也是我的钱啊……非必要不能给刚刚装的那个免费 ai 吗？**"
//   —— 子代理花的是主模型（付费）的钱；能交给免费模型的机械活就该交给它。
//
// 它干什么：
//   读一段文本（文件 / stdin / 参数）→ 带上你的指令 → 调**智谱免费档**（默认 `glm-4.7-flash`，30B 级 / 200K）
//   → 把回答**写到文件**（`--out`）或 stdout。**调用过程完全不经过 DSH 的对话上下文**。
//
// 怎么用（照抄）：
//   node ask-cloud.mjs --in 待处理.txt --prompt "给每一行补一个出处锚" --out 结果.txt
//   Get-Content x.txt -Raw | node ask-cloud.mjs --prompt "压缩成三行" --out y.txt
//   node ask-cloud.mjs --prompt "只回四个字：连接正常"        # 连通性自检
//
// 安全与纪律（写在代码里，别绕过）：
//   · key 从 DSH 凭据库 `~/.dsh/.credentials.yaml` 的 `refs.ZHIPU_API_KEY` 读（也可用环境变量覆盖）——
//     **key 不许写进任何档案 / 不许回显**。
//   · 免费档会**间歇性限流**（1305 / 429）→ 内置重试与退避；仍失败就**如实退出非 0**（不伪造结果）。
//   · 默认**不把结果写进档案**：它只产出文本文件；要不要落进档案，由人/主模型看过再决定。

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DSH_HOME, MEMORIA_DIR } from '../lib/common.js'

/** 经验日志：**每次调用都追加一行**（用户 2026-09-18 要的"以后一眼判断这活它能不能做"）。
 *  它自动记，不需要额外模型调用；一行＝一次调用。
 *  🔴 **2026-09-28 改**：路径**从 `MEMORIA_DIR` 现算**，不再自己拼 `~/.dsh/memoria/` ——
 *     口径扫（`tools/口径扫.mjs`）当场扫出这一处；而"写死老路径"正是今天撞过的病
 *     （AGENTS.md · 工具速查 · 插件里 5 处文案全栽在同一件事上）。 */
const LOG_PATH = join(MEMORIA_DIR, 'memoria-askcloud-log.md')
const OP = process.argv.find((a) => a.startsWith('--op='))?.slice(5) ?? '未标注'
const ONE = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 60)
function logLine(ok, outLen, usage, note, sentLen, t0) {
  try {
    const line = `| ${new Date().toISOString().slice(0, 16).replace('T', ' ')} | ${MODEL} | ${hasFlag('--no-think') ? '关' : '开'} | ${ONE(OP)} | 共${sentLen}字 | ${ok ? `✅ ${outLen}字` : `❌ ${ONE(note)}`} | ${usage ? `${usage.total_tokens ?? '?'}` : '—'} | ${Math.round((Date.now() - t0) / 1000)}s |`
    appendFileSync(LOG_PATH, `${line}\n`, 'utf8')
  } catch {
    /* 记不上就算了：别让日志把活弄失败 */
  }
}

const args = process.argv.slice(2)
const getArg = (name, def = null) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def
}
const hasFlag = (name) => args.includes(name)

const MODEL = getArg('--model', process.env.ASK_CLOUD_MODEL || 'glm-4.7-flash')
const BASE = getArg('--base', process.env.ASK_CLOUD_BASE || 'https://open.bigmodel.cn/api/paas/v4')
const IN = getArg('--in')
const OUT = getArg('--out')
const MAX_TOKENS = Number(getArg('--max-tokens', '8192'))
const TIMEOUT_MS = Number(getArg('--timeout-ms', '180000'))
const TRIES = Number(getArg('--tries', '5'))
const PROMPT = getArg('--prompt') ?? '处理下面这段文本，保持原有结构，只输出处理后的结果。'

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 24).join('\n'))
  process.exit(0)
}

/** 读 key：环境变量优先，其次 DSH 凭据库（refs.ZHIPU_API_KEY）。**任何情况下都不打印它**。 */
function readKey() {
  for (const k of ['ZHIPU_API_KEY', 'ASK_CLOUD_KEY']) {
    if (process.env[k] && process.env[k].trim()) return process.env[k].trim()
  }
  const p = join(DSH_HOME, '.credentials.yaml') // 2026-09-28：走唯一来源（`lib/common.js` 的 DSH_HOME），不再自己拼
  let t = ''
  try {
    t = readFileSync(p, 'utf8')
  } catch (e) {
    throw new Error(`读不到凭据库 ${p}（${e.message}）；也可以设环境变量 ZHIPU_API_KEY`)
  }
  const m = t.match(/^\s*ZHIPU_API_KEY:\s*(.+?)\s*$/m)
  if (!m || !m[1]) throw new Error(`凭据库里没有 ZHIPU_API_KEY（${p}）—— 先在 DSH 面板或凭据库里放好`)
  return m[1].replace(/^["']|["']$/g, '')
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function callOnce(key, body) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const text = await res.text()
    let j = null
    try {
      j = JSON.parse(text)
    } catch {
      /* 非 JSON 当失败处理 */
    }
    if (!j) return { ok: false, retry: false, why: `非 JSON 响应（HTTP ${res.status}）：${text.slice(0, 200)}` }
    if (j.error) {
      const code = String(j.error.code ?? '')
      const msg = String(j.error.message ?? '')
      // 1305 / 429 / 限流类 → 退避重试；其余（鉴权、模型名错、参数错）不重试
      const retry = /1305|429|访问量过大|rate/i.test(code + msg)
      return { ok: false, retry, why: `${code || res.status}: ${msg.slice(0, 160)}` }
    }
    const m = j?.choices?.[0]?.message ?? {}
    const content = (m.content ?? '').trim()
    const reasoning = (m.reasoning_content ?? '').trim()
    return { ok: true, content, reasoning, usage: j.usage ?? null }
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, retry: true, why: `超时（${TIMEOUT_MS}ms）` }
    return { ok: false, retry: true, why: `网络：${e && e.message ? e.message : e}` }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const t0 = Date.now()
  const input = IN ? readFileSync(IN, 'utf8') : hasFlag('--stdin') || !process.stdin.isTTY ? readStdin() : ''
  const key = readKey()

  // GLM-4.7 系列默认开思考；`--no-think` 显式关掉（快一些，机械活通常不需要思考）
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: input ? `${PROMPT}\n\n----\n${input}` : PROMPT }],
    max_tokens: MAX_TOKENS,
    ...(hasFlag('--no-think') ? { thinking: { type: 'disabled' } } : {}),
  }

  const sentLen = body.messages?.[0]?.content?.length ?? 0

  let last = null
  for (let i = 1; i <= TRIES; i++) {
    const r = await callOnce(key, body)
    if (r.ok) {
      const out = r.content || ''
      if (!out) {
        // 思考把 max_tokens 吃光时会得到空正文 —— 如实报错，别当成"模型说没有"
        console.error(
          `⚠️ 正文为空（思考 ${(r.reasoning || '').length} 字符，用量 ${JSON.stringify(r.usage)}）—— 加 --max-tokens 或加 --no-think 再来`,
        )
        logLine(false, 0, r.usage, '正文为空（思考吃光 max_tokens）', sentLen, t0)
        process.exit(3)
      }
      // 经验日志：记下"这次派了什么活、成不成"（用户 2026-09-18 要的边界库）
      logLine(true, out.length, r.usage, '', sentLen, t0)
      if (OUT) {
        writeFileSync(OUT, out.endsWith('\n') ? out : `${out}\n`, 'utf8')
        console.error(`✅ 已写 ${OUT}（${out.length} 字符，模型 ${MODEL}，用量 ${JSON.stringify(r.usage)}）`)
      } else {
        process.stdout.write(out.endsWith('\n') ? out : `${out}\n`)
        console.error(`✅ 完成（${out.length} 字符，模型 ${MODEL}，用量 ${JSON.stringify(r.usage)}）`)
      }
      return
    }
    last = r
    if (!r.retry) break
    if (i < TRIES) {
      const wait = Math.min(1500 * 2 ** (i - 1), 20000)
      console.error(`⏳ 第 ${i}/${TRIES} 次失败（${r.why}）—— ${wait}ms 后重试`)
      await sleep(wait)
    }
  }
  console.error(`❌ 失败（试了 ${TRIES} 次）：${last ? last.why : '未知'}`)
  logLine(false, 0, null, last ? last.why : '未知', sentLen, t0)
  process.exit(2)
}

main().catch((e) => {
  console.error(`❌ ${e && e.message ? e.message : e}`)
  process.exit(1)
})
