// ============================================================
// F37 · FastCtx（把它的"文件清单式"短输出接进梅莫莉亚）
// ============================================================
//
// 为什么要它（2026-10-11 实测数字）：同一个词「销账」、同一个目录 `L3-知识` ——
//   `rg.exe`        → **75,011 字符 / 272 行**（给"行号 ＋ 每行原文"）
//   `fastctx grep`  → **2,338 字符 / 36 行**（文件列表模式：**只给文件路径**）
//   ⇒ **1/32**。反面数字：`rg` 搜**档案根**同一个词 = **4,344,419 字符 / 21,431 行**。
//
// 🔴 **它只走 MCP**（`fastctx serve` 说 stdio JSON-RPC）—— 没有"命令行直接 grep"那种入口。
//   所以这里是**一小段 MCP 客户端**：`initialize` → `notifications/initialized` → `tools/call`。
//
// 🔴 **子进程 stdio 一律走文件，绝不用管道**（《施工手册》坑 11：本机沙箱里 `stdio:'pipe'` 会 EPERM，
//   拿不到输出）⇒ 用一个**同步**子进程，stdin / stdout 都重定向到文件，读回来解析。
//
// ⚠️ **本模块只读** —— 只用 `grep` / `glob` / `inspect_local_file` 三个只读工具；
//   **`replace`（写）不进这里**：要改文件时必须走 `改档.mjs` 那扇唯一的门。
//
// ⚠️ **它凭什么能被约束**：工具是**我们自己注册**的（`dangan_search` 的一个 mode），
//   所以 F30 的全部门、白名单、输出收窄**原封不动管着它**。

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CFG, log } from './common.js'

/** 它在哪：**它是 AI 的可选工具、不是插件的一部分** —— 所以**不写死路径**（用户 2026-10-19 定的口径：
 *  "她自己的工具在她内部，我的工具是我的"）。用环境变量 `FASTCTX_EXE` 指定；没设就走 PATH 找裸名。
 *  找不到就降级（`fastctxExe()` 返回 null，检索走 rg 兜底并自报）。 */
export const FASTCTX_EXE = String(process.env.FASTCTX_EXE ?? '').trim() || 'fastctx.exe'

/** 回给模型的输出上限（防它一次吐回几千行 —— 那就白接它了）。 */
const MAX_LINES = 200

/** `fastctx` 在不在（**自报工作量**用：不在要说出来，绝不许静默失效）。 */
export function fastctxExe() {
  return existsSync(FASTCTX_EXE) ? FASTCTX_EXE : null
}

/** 把 stdout 那一串按行 JSON 解析成"id → 那条回执"。 */
function parseById(raw) {
  const byId = new Map()
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    let m
    try { m = JSON.parse(t) } catch { continue }
    if (m && m.id !== undefined && m.id !== null) byId.set(m.id, m)
  }
  return byId
}

/** 从一条 tools/call 回执里取出文本。 */
function textOf(msg) {
  const c = msg && msg.result && msg.result.content
  if (!Array.isArray(c)) return ''
  return c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n')
}

/**
 * 调一次 FastCtx 的只读工具。**同步**（与本插件其它内核同一个姿态）。
 * @param {string} tool `grep` / `glob` / `inspect_local_file`
 * @param {object} args 工具参数
 * @param {{timeoutMs?:number}} [opt]
 * @returns {{ok:boolean, text:string, why?:string, ms:number}}
 */
export function callFastctx(tool, args, opt = {}) {
  const t0 = Date.now()
  const exe = fastctxExe()
  if (!exe) return { ok: false, text: '', why: '本机没装 FastCtx 加速器（这是 AI 的可选工具，不是插件的一部分）—— 检索改走 rg 兜底', ms: 0 }
  const timeoutMs = Number.isFinite(opt.timeoutMs) && opt.timeoutMs > 0 ? opt.timeoutMs : 30000

  let tmp = null
  try {
    tmp = mkdtempSync(join(tmpdir(), 'memoria-fastctx-'))
    const inFile = join(tmp, 'in.jsonl')
    const outFile = join(tmp, 'out.jsonl')
    const reqs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-memoria', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args ?? {} } },
    ]
    // 🔴 **stdin / stdout 都用"文件描述符"**，既不碰管道（沙箱 EPERM）、也不经 cmd（引号会被吃 ——
    //    2026-10-11 实测：`cmd /c "… < in > out"` 那条一律退出码 1、stdout 0 字符）。
    writeFileSync(inFile, reqs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    const fdIn = openSync(inFile, 'r')
    const fdOut = openSync(outFile, 'w')
    let p
    try {
      p = spawnSync(exe, ['serve'], { stdio: [fdIn, fdOut, 'ignore'], cwd: CFG.archiveDir, timeout: timeoutMs, windowsHide: true })
    } finally {
      try { closeSync(fdIn) } catch { /* ignore */ }
      try { closeSync(fdOut) } catch { /* ignore */ }
    }
    if (p.error) log('F37 起 fastctx 失败：' + p.error.message)
    let raw = ''
    try { raw = readFileSync(outFile, 'utf8') } catch { raw = '' }
    const byId = parseById(raw)
    const msg = byId.get(2)
    if (!msg) {
      const why = p.error
        ? '起不来：' + p.error.message
        : (p.status === null ? '超时 ' + timeoutMs + 'ms 被杀（stdout ' + raw.length + ' 字符）' : 'FastCtx 没给出回执（退出码 ' + p.status + ' · stdout ' + raw.length + ' 字符）')
      log('F37 FastCtx ' + tool + ' 失败：' + why)
      return { ok: false, text: '', why, ms: Date.now() - t0 }
    }
    if (msg.error) {
      return { ok: false, text: '', why: 'FastCtx 报错：' + String(msg.error.message ?? JSON.stringify(msg.error)), ms: Date.now() - t0 }
    }
    return { ok: true, text: textOf(msg), ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, text: '', why: 'F37 出错：' + (e && e.message ? e.message : String(e)), ms: Date.now() - t0 }
  } finally {
    try { if (tmp) rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉也无害 */ }
  }
}

/**
 * `dangan_search mode="files"` 的实现：**只给文件清单**（不给行号与原文）—— 这就是省 1/32 的那一半。
 * @param {string} pattern 检索模式（FastCtx 与 rg 同一套语法）
 * @param {string} subdir 档案内的相对目录（空 ＝ 档案根）
 * @returns {{ok:boolean, text:string, why?:string, ms:number, rel:string}}
 */
export function filesMode(pattern, subdir, opt = {}) {
  const rel = String(subdir ?? '').trim()
  const root = rel ? join(CFG.archiveDir, rel) : CFG.archiveDir
  const r = callFastctx('grep', { pattern, path: root }, opt)
  if (!r.ok) return { ...r, rel }
  const raw = r.text.split(/\r?\n/).filter(Boolean)
  // ⚠️ 计数**只算文件路径行** —— FastCtx 末尾会带一行元信息（如 `(Complete: all 2 files shown.)`），
  //    把它算成一个"文件"会让头里的数比列出来的多一个（2026-10-11 试剑当场发现）。
  const isPath = (s) => /^[A-Za-z]:[\\/]/.test(s) || /^[\\/]{1,2}/.test(s)
  const lines = raw.filter(isPath)
  const meta = raw.filter((s) => !isPath(s))
  const shown = lines.slice(0, MAX_LINES)
  const more = lines.length > shown.length ? '\n…（还有 ' + (lines.length - shown.length) + ' 个文件，**收窄 pattern 再看**）' : ''
  const head = '【文件清单】「' + pattern + '」命中 **' + lines.length + ' 个文件**（目录：' + (rel || '档案根') + ' · 耗时 ' + r.ms + ' ms · FastCtx）'
  return { ok: true, text: head + '\n' + shown.join('\n') + more + (meta.length ? '\n' + meta.join('\n') : ''), ms: r.ms, rel }
}
