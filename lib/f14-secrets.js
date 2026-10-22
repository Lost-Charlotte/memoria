// ============================================================
// F14 · 凭据硬拦（2026-09-17 建 · 事件 E66 / 锚点 T203）
// ============================================================
//
// **抄谁**：`dsh-memory-gate/lib/redaction.js`（6 条无状态正则；生态调研 §5.2 第 7 条）。
//   它那儿有一句值得原样抄下来：**"这类判断不交给模型，误报代价小于漏报代价"**。
//
// **为什么需要**：**档案是明文 Markdown，而且会被整体注入上下文**（压缩后重注入＝全文灌进去）。
//   凭据一旦落进档案，就会**反复进上下文、反复被写进会话日志** —— "泄漏一次、泄漏一辈子"。
//
// ---------------------------------------------------------------------------
// 🔴 **但本地有一个实情，决定了它不能做成"一律拒写"**：
//   档案里**本来就有一份用户要的密码备忘**（`L3-知识/备忘-SnowLuma密码与桥接令牌.txt`，见索引）。
//   所以本能力做成**三档**，默认只报不拦：
//     · `warn`（默认）：命中就**报出来**（"第几处、哪一类"），**但照写** —— 判断留给人
//       （"机器只报机械可判的"）；
//     · `enforce`：命中就**拒写**（用户明确要求"别让密钥进档案"时开）；
//     · `off`：完全不查。
//   模式从**文件**读（`$DSH_HOME/memoria-secrets.mode`），与闸门同一个套路：**不用重启就能切**。
//
// ⚠️ 正则**全是无状态的**（不看上下文），所以判断可复现、可单测；代价是**会有误报**
//   （典型：某一行正在**讲这个规则本身**）—— 这也是"默认只报不拦"的另一个理由。
// ---------------------------------------------------------------------------

import { join } from 'node:path'

import { CFG, HOME_DIR, log, readTextSafe, rel, walk } from './common.js'

/** 凭据特征（前 6 条照抄 gate 的 `redaction.js`；最后一条是**为中文档案补的**）。 */
export const SECRET_PATTERNS = [
  { label: 'OpenAI 风格 API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { label: 'GitHub token', pattern: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  {
    label: '凭据赋值',
    pattern: /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd)\s*[:=]\s*["']?[^\s"']{8,}/i,
  },
  { label: '私钥块', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  // 本地补：档案是中文的，凭据备忘多半写成"密码：xxx / 令牌：xxx"
  { label: '中文凭据写法', pattern: /(?:密码|口令|密钥|令牌|私钥)\s*[:：=]\s*\S{6,}/ },
]

/**
 * 查一段文本里有没有凭据特征。**只报类别，不回显内容**（免得日志本身又成一处泄漏）。
 * @param {string} text
 * @returns {{ secret: boolean, labels: string[] }}
 */
export function inspectForSecrets(text) {
  const s = String(text ?? '')
  const labels = []
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(s) && !labels.includes(label)) labels.push(label)
  }
  return { secret: labels.length > 0, labels }
}

/** 给日志用的打码版（**日志里绝不能出现真凭据**）。 */
export function redactForLog(text, maxLength = 160) {
  let v = String(text ?? '')
  for (const { pattern } of SECRET_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    v = v.replace(new RegExp(pattern.source, flags), '[已打码]')
  }
  return v.length > maxLength ? `${v.slice(0, maxLength - 1)}…` : v
}

export const SECRETS_MODE_FILE = join(HOME_DIR, 'memoria-secrets.mode')

/** 当前模式：`warn`（默认）/ `enforce` / `off`。 */
export function secretsMode() {
  return (readTextSafe(SECRETS_MODE_FILE).trim() || 'warn').toLowerCase()
}

/**
 * 扫**整个档案**，报出"现在有多少处疑似凭据"（F14 的启动自检用）。
 * ⚠️ 只报**文件与类别**，**不回显内容**。
 */
export function scanArchiveForSecrets(root = CFG.archiveDir) {
  const hits = []
  let docs = []
  try {
    docs = walk(root)
  } catch {
    docs = []
  }
  for (const f of docs) {
    const text = readTextSafe(f)
    if (text.length === 0) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const r = inspectForSecrets(lines[i])
      if (r.secret) hits.push({ file: rel(f), line: i + 1, labels: r.labels })
    }
  }
  return hits
}

/** 启动自检：**自报工作量**（模式是什么、档案里现在有几处）。 */
export function reportF14() {
  const mode = secretsMode()
  if (mode === 'off') return '凭据硬拦 F14：**已关闭**（mode=off）—— 写入前不查凭据'
  const hits = scanArchiveForSecrets()
  const byFile = new Map()
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
  const top = [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f, n]) => `${f} ${n} 处`)
    .join(' · ')
  return (
    `凭据硬拦 F14：模式 **${mode}**（${mode === 'enforce' ? '命中即拒写' : '只报不拦'}）—— ` +
    `按"同行 key=value / Bearer / 私钥块 / 中文冒号写法"这些**格式**查，档案里现在 **${hits.length} 处**命中` +
    `${byFile.size > 0 ? `，分布在 ${byFile.size} 份文档（${top}）` : ''}。` +
    `⚠️ **"0 处"不等于"档案里没有凭据"** —— 用户有意放的密码备忘（**标签一行、值一行**那种写法）` +
    `**本就不在这条的射程里**（跨行写法认不准，硬认会造一堆误报）；它打的是"**无意中粘进去的凭据**"（那多半是同行形式）。`
  )
}
