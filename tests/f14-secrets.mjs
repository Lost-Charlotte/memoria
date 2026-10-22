/**
 * F14 · 凭据硬拦。跑法：node tests/f14-secrets.mjs
 *
 * 这一条最要紧的不是"能认出来"，而是**两件相反的事**：
 *   ① **该报的必须报**（同行 key=value / Bearer / 私钥块 / 中文冒号写法）；
 *   ② **不该报的绝不许报** —— 档案里到处在**谈论**"密码 / API key / Bearer"这些词，
 *      把"谈论它"当成"使用它"就会满屏假告警（档案里的老教训：消不掉的告警等于没有告警）。
 * 另外钉住三档行为：**默认 `warn` 只报不拦**（档案里本来就有用户**有意**放的密码备忘）·
 *   `enforce` 拒写且**档案一个字不动** · `off` 连报都不报。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { check, done, loadPlugin, makeArchive, mockCtx, sandboxHome } from './harness.mjs'

// ⚠️ 必须**先** sandboxHome()、再动态 import —— `HOME_DIR` 是模块加载时算的（harness 的老规矩）。
sandboxHome()
const { inspectForSecrets, redactForLog, reportF14, secretsMode } = await import('../lib/f14-secrets.js')
// （`commitLog` 的 import 2026-10-20 删了 —— 那个函数整份删净，本文件其实一次都没调过它。）

console.log('')

// ============================================================
// 一、认得出（正例）—— 照 gate `redaction.js` 那 6 条 ＋ 中文那条
// ============================================================
const positives = [
  ['OpenAI 风格 key', 'key: sk-abcdefghijklmnopqrstuvwx'],
  ['GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz01'],
  ['AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
  ['Bearer token', 'Authorization: Bearer abcdefghijklmnop.qrst'],
  ['凭据赋值', 'password = hunter2hunter2'],
  ['私钥块', '-----BEGIN RSA PRIVATE KEY-----'],
  ['中文冒号写法', '密码：hunter2hunter2'],
]
for (const [label, text] of positives) {
  check(`认得出：${label}`, inspectForSecrets(text).secret === true)
}

// ============================================================
// 二、**不该误报**（反例）—— 档案里到处在"谈论"这些词
// ============================================================
const negatives = [
  '这条说的是"密码怎么保存"，不是密码本身',
  'API key 要放环境变量里，别写进档案',
  'Bearer token 的长度一般超过 16 个字符',
  'dangan_search 能查到 T197 那条',
  '桥接令牌**已作废**，别再用了', // 有"令牌"但没有冒号 + 值
]
for (const text of negatives) {
  const r = inspectForSecrets(text)
  check(`不误报：${text.slice(0, 18)}…（${r.labels.join('/') || '干净'}）`, r.secret === false)
}

// ============================================================
// 三、打码（日志里绝不能出现真凭据）
// ============================================================
const masked = redactForLog('token = sk-abcdefghijklmnopqrstuvwx')
check('打码版里**不再出现原文**', !masked.includes('sk-abcdefghijklmnop'))
check('打码版留了可见的标记（不是悄悄删掉）', masked.includes('[已打码]'))

// ============================================================
// 四、默认模式：warn（只报不拦）
// ============================================================
check('默认模式是 warn（档案里本来就有用户有意放的密码备忘 → 不能一律拒写）', secretsMode() === 'warn')

// ============================================================
// 五、接进落笔半：三档行为
// ============================================================
const T = [
  '| 等级 | 编号 | 时间 | 发生了什么 |',
  '|---|---|---|---|',
  '| ○ | **T1** | 2026-09-16 10:00 | 甲 |',
  '',
].join('\n')
const E = [
  '| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |',
  '|---|---|---|---|---|',
  '| E1 | **甲事** | 2026-09-16 | 🔄 进行中 | T1 |',
  '',
  '### E1｜甲事',
  '- **时间跨度**：2026-09-16 ~',
  '- **锚点**：T1',
  '- **模型**：`deepseek-flash`',
  '- **做了什么**：',
  '  1. 先记一条',
  '- **结果**：还没有',
  '- **状态**：🔄 进行中',
  '- **指引**：—',
  '',
].join('\n')

const root = makeArchive('f14', {
  '01-时间轴-我们做过什么.md': T,
  '01-事件表-我们做过什么.md': E,
  // 🔴 2026-10-15：L2 已删 ⇒ 落档的落点在 L3 ⇒ 夹具里得有它，否则算出来是空梭（凭据拦都轮不到）。
  'L3-知识\\记录-测试用.md': '# 记录 · 测试用\n\n> 🏷 **这份是什么**：夹具。\n> 🕐 **什么时候用**：测试。\n> ✍️ **谁写它**：测试。\n',
})
const mod = await loadPlugin()
mod.apply(mockCtx(), { archiveDir: root })

const tPath = join(root, '01-时间轴-我们做过什么.md')
const readT = () => readFileSync(tPath, 'utf8')
const MODE_FILE = join(process.env.DSH_HOME, 'memoria-secrets.mode')
const setMode = (m) => writeFileSync(MODE_FILE, m, 'utf8')

// 🔴 2026-10-15 改口径（「编号体系退役」连带）：**经"落档"这条路已经测不到凭据了** ——
//    凭据原来藏在 `did` 里，而 `did` 是要写进时间轴／事件表的；L2 那一层删了 ⇒ `did`
//    **不再入档**（它现在只剩一个用途：数"超没超 150 字"）⇒ F14 从"扫将要写入的文本"
//    这条路上**再也扫不到它**（实测：落档成功、回执里一个字都没提），留在这儿的断言就是**假过**。
//    ⇒ 改成**直接测判据本身**：`inspectForSecrets`（唯一权威）＋ `secretsMode()`（拦还是报）。
const SECRET_DID = '把 token sk-abcdefghijklmnopqrst 记下来'
const CLEAN_DID = '把这一轮的结论记下来'

const ins1 = inspectForSecrets(SECRET_DID)
const ins2 = inspectForSecrets(CLEAN_DID)
check('疑似凭据 ⇒ 判据认得出（warn 模式下它就是"报"的依据）', ins1.secret === true && ins1.labels.length > 0)
check('干净内容 ⇒ 判据不误报', ins2.secret === false)

setMode('enforce')
check('enforce ⇒ 模式读到 enforce（拦不拦由它定）', secretsMode() === 'enforce')
setMode('off')
check('off ⇒ 模式读到 off（连报都不报）', secretsMode() === 'off')
setMode('warn')


// ============================================================
// 六、自检行：必须自曝"0 处 ≠ 没有凭据"
// ============================================================
const line = reportF14()
check('自检行自报模式与命中数', /凭据硬拦 F14：模式 \*\*warn\*\*/.test(line))
check('🔴 自检行**明说"0 处不等于档案里没有凭据"**（否则会被误读成"档案很干净"）', line.includes('不等于'))
check('自检行点明"跨行写法不在射程里"（用户手工备忘那种）', line.includes('标签一行'))

done()
