// ============================================================
// F15 · 状态面板（2026-09-17 建 · 事件 E67 / 锚点 T204；同日加"数据层"供网页面板用）
// ============================================================
//
// README §九 一直挂着一个"将来的控制台面板"（"让你能看见：体检红了几条 / 闸门卡在哪 /
// 欠了多少账 / 一键豁免"）。本模块是它的**只读版** —— 回答一个问题：
//   **"梅莫莉亚现在到底在干嘛？"**
//
// 🔴 **两种呈现，共用一个数据源**（2026-09-17 加，写网页面板时定的）：
//   · `buildStatusData()` → **结构化对象**（给浏览器里的控制台面板用）；
//   · `buildStatus()`     → **一屏文本**（给 `dangan_status` 工具用）。
//   为什么要拆：面板有两个呈现，如果各写一套聚合逻辑，就是**同一件事两处手抄**
//   —— 档案 09-16 审查的头号病根（"副本病"）。所以：**聚合只在这里做一次**。
//
// 三条设计（照 README §九 留的接缝写）：
//   ① **只聚合，不判定** —— 每一段都调各能力**已有的**输出，本模块自己不做任何判断；
//   ② **缺一段不许拖垮整屏** —— 每段独立兜底，读不到就记进 `problems` 并留空（fail-open）；
//   ③ **每段都能单独复查** —— 末尾点明"想深挖就走哪个工具 / 看哪个日志"。

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { CAP_STATS, CFG, HOME_DIR, LOADED_STAMP, baseOf, readTextSafe, skippedDirs, stampDrift } from './common.js'
// （2026-09-29）原来这里 import 了 F1 的 `lastBudgetInfo`（注入预算实况）——「压缩后重注入」
// 整条删除之后它不存在了，留着这行会让**整个插件装载失败*（实测：控制台形象直接消失）。
import { voidedList } from './f2-void.js'
import { checkArchiveCached, checkStamp } from './f5-check.js'
import { GATE_LOG_FILE, gateMode, loadGateState } from './f7-gate.js'
import { formatTodoList, openItems, todoStaleCandidates } from './f10-todo.js'
import { BUDGET, TOOL_OUTPUT } from './f12-budget.js'
import { scanAnchors } from './f13-anchors.js'
import { scanArchiveForSecrets, secretsMode } from './f14-secrets.js'
import { TODO_PASS_ALERT, overPassedTodos, todoPassKey } from './f18-closing.js'
// 🔴 2026-10-15：`notBlockedPending` 随 G3 事件收尾一起退役（它读的事件表随 L2 删了），import 删除。
import { RETAIN, l9Stats, loadL9State } from './f19-tmpwatch.js'
import { VERIFIED_KEEP_COUNT, VERIFIED_KEEP_DAYS, listVerified } from './f29-verified.js'
// 工程（F35 · 2026-09-26 加）—— **与待办分开的一份**（用户："不允许将他们混为一谈"）。
import { findProjectTooLong, projectStaleCandidates, projectSummary } from './f35-project.js'

const LOG_FILE = join(HOME_DIR, 'memoria.log')

/** 北京时间的短形式（面板是给人看的，不带时区说明也没关系）。 */
function nowCN() {
  try {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  } catch {
    return new Date().toISOString()
  }
}

/**
 * 读一个日志文件的**尾部若干行**（不整份读 —— 日志会长）。
 * ⚠️ 从中间切可能切坏第一行，所以**丢掉第一行**（宁可少一行，不显示半行）。
 */
export function tailLines(file, maxLines = 6, maxBytes = 8192) {
  const t = readTextSafe(file)
  if (t.length === 0) return []
  const cut = t.length > maxBytes ? t.slice(t.length - maxBytes) : t
  const lines = cut.split(/\r?\n/).filter((s) => s.trim().length > 0)
  const tail = lines.slice(-maxLines)
  return t.length > maxBytes ? tail.slice(1) : tail
}

/** 从一组日志行里找**最后一条**含某关键词的（找不到返回 null）。 */
export function lastMatching(lines, needle) {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes(needle)) return lines[i]
  return null
}

/** 从 `formatTodoList()` 的第一行里抠出"还开着 N 条"。 */
export function parseOpenTodoCount(text) {
  const s = String(text ?? '')
  const m = s.match(/还开着\s*\*\*(\d+)\s*条\*\*/)
  if (m) return Number(m[1])
  // 🔴 **2026-10-01 修（真 bug）**：**"表是空的"和"读不到表"是两回事**，原实现把两者混成一种 ——
  //    待办空表时 `formatTodoList()` 输出的是"待办文件里**没有还开着的条目**…干净"，
  //    抠不出数字 ⇒ 返回 `null` ⇒ **状态面板误报"（读不到待办表）"**（实测：`dangan_status` 说读不到，
  //    可 `dangan_todo list` 读同一份表完全正常 —— **两个读数打架**，那天就是这么发现的）。
  //    ⇒ **认那句"没有还开着的条目" ⇒ 它就是 `0`**（档案里那条老判据：**"探测不到 ≠ 不存在"**）。
  if (/没有还开着的条目/.test(s)) return 0
  return null // 真的读不到（文件不在 / 解析不出）—— 这才该报"读不到"
}

/**
 * **面板数据**（结构化）—— 文本版与网页版**共用这一个数据源**。
 * ⚠️ 每段独立兜底：读不到就记进 `problems`，对应字段留 `null` —— **绝不因为一段读不到就整屏失败**。
 * @returns {{at:string, run:object, archive:object, check:object|null, gate:object|null, caps:Array, sentinels:object|null, budget:object, todo:object|null, lastInject:string, problems:string[]}}
 */
export function buildStatusData() {
  const problems = []
  const T = (label, fn, fallback = null) => {
    try {
      const v = fn()
      return v === undefined ? fallback : v
    } catch (e) {
      problems.push(`${label}：${e && e.message ? e.message : e}`)
      return fallback
    }
  }

  const check = T('体检', () => {
    // 🔴 2026-10-21：改调**带缓存**的那个 —— 状态面板每调一次就全档扫一遍太贵
    //    （第二路实测：30 天里我手动跑了 122 次全档体检）。它按"档案指纹变没变"判，够准。
    const issues = checkArchiveCached()
    // 🔴 2026-10-15：`hasTl` / `lv` 两个中间量**随 L2 退役删除** —— 时间轴已不在档案里，
    //    `countT()` 恒 -1、`timelineLevelStats()` 恒全 0 ⇒ 下面那几个数**一律直接写「（已删）」**。
    //    原话："**截图里这个检测这一栏，经常能看到各种问题，但我没法看究竟是什么地方出了问题。
    //    能不能加一个，比如我鼠标在上面就显示个小气泡告诉我是什么地方有什么问题，或者做成能点的按钮？**"
    //    ⚠️ 原来这里**只留计数**（`errors`/`tips`）⇒ 面板只能显示"错 0 · 提示 2"，**点进去也没东西可看**。
    //    ⇒ 现在带上前 20 条明细（每条给 文件:行 ＋ 一句话，够看懂"是什么"；要看全量走 `dangan_check`）。
    //    ⚠️ 取文件名用**唯一实现** `baseOf()`（口径关管的正是这个 —— 别再写第二份 `split`）。
    const LIMIT = 20
    const brief = (x) => `${baseOf(x.file)}:${x.line} ${String(x.msg).slice(0, 90)}`
    return {
      errors: issues.filter((x) => x.lv === '错').length,
      tips: issues.filter((x) => x.lv !== '错').length,
      /** 明细（最多 20 条，给人看"到底哪儿不对"） */
      list: issues.slice(0, LIMIT).map(brief),
      /** 明细被截了吗（截了就提示"还有 N 条，去 `dangan_check`"） */
      more: Math.max(0, issues.length - LIMIT),
      // 🔴 2026-10-21 加：**上次体检的时刻**（0 ＝ 本进程还没真跑过）+ **之后档案被改过没有**。
      //    加这个是因为：30 天里我手动跑了 122 次全档体检 —— 其实我要的只是"这份结论还新不新鲜"。
      at: checkStamp().at,
      wroteAfter: (() => {
        const at = checkStamp().at
        if (!at) return null
        try {
          // 🔴 2026-10-21 修（刚上线就发现）：事务文件**不是一个固定的 `memoria-txn.log`** ——
          //    `f9-commit.js` 用的是 `~/.dsh/memoria/memoria-txn/memoria-txn-<tag>.{json,log}`
          //    （多进程同时跑时各写各的，所以带 tag）⇒ 扫那个目录、取最新一份比时刻。
          //    ⚠️ 一份都没有时返回 `null`（**"不知道"**），不是 `false`：那些残件会被 F19 定期清掉，
          //      清掉之后说"没改过档"就是**假话** —— 宁可说不知道（"沉默 ≠ 正常"那一族的反面）。
          const dir = join(HOME_DIR, 'memoria-txn')
          const names = readdirSync(dir).filter((n) => /^memoria-txn-.*\.(json|log)$/.test(n))
          if (names.length === 0) return null
          let newest = 0
          for (const n of names) {
            const t = statSync(join(dir, n)).mtimeMs
            if (t > newest) newest = t
          }
          return newest > at
        } catch {
          return null
        }
      })(),
      // 🔴 2026-10-14（L2 降级派生 · ④ A 轮）：L2（时间轴 / 事件表）**已删** ⇒ 那两个数恒为 -1，
      // 🔴 2026-10-14（L2 降级派生 · ④ C 轮）：**四个等级数跟 `timeline` 同一处置** ——
      //    A 轮只把 `timeline` 那一格改成了「（已删）」，而 must/imp/plain/undecided 还是裸的 `0`
      //    ⇒ 面板上看着像「时间轴是空的」（正是「没找到」被说成「没有」那一族）。
      //    ⇒ 时间轴不在时，这四个数**一律**「（已删）」。
      timeline: '（已删）',
      must: '（已删）',
      imp: '（已删）',
      plain: '（已删）',
      undecided: '（已删）',
    }
  })

  const gate = T('闸门', () => {
    const st = loadGateState()
    const denied =
      st && st.deny && typeof st.deny === 'object'
        ? Object.values(st.deny).reduce((a, b) => a + (Number(b) || 0), 0)
        : 0
    const last = lastMatching(tailLines(GATE_LOG_FILE, 40), '闸门')
    return {
      mode: gateMode(),
      denied,
      closedAt: st?.closedAt ?? null,
      lastVerdict: last ? last.replace(/^\[[^\]]+\]\s*/, '') : '',
    }
  })

  const caps = T(
    '干活统计',
    () => [...CAP_STATS.entries()].map(([id, s]) => ({ id, count: s.count, note: s.note ?? '' })),
    [],
  )

  const sentinels = T('哨兵', () => {
    const a = scanAnchors(CFG.archiveDir)
    const secMode = secretsMode()
    return {
      voided: voidedList().length,
      anchorMissing: a.missing.length,
      anchorChecked: a.found,
      offlineDrives: a.offlineDrives,
      offlineCount: a.offlineCount,
      secretsMode: secMode,
      secretHits: secMode === 'off' ? null : scanArchiveForSecrets(CFG.archiveDir).length,
    }
  })

  // ⚠️ 2026-09-29：「压缩后重注入」删除后，**"注入用量"这个指标本身没了**（现在只剩极短的
  //    在岗标记与留意栏，不再走 `fitSections` 那套额度）⇒ 这里恒报 0，先保证面板不炸；
  //    ⇒ 2026-09-29 已照办：面板那行「注入用 N/M 字符」已去掉（现在只报工具输出上限）。
  const budget = {
    used: 0,
    limit: (CFG.budget ?? BUDGET).maxTotalChars,
    cut: 0,
    toolChars: (CFG.toolOutput ?? TOOL_OUTPUT).maxChars,
    toolLines: (CFG.toolOutput ?? TOOL_OUTPUT).maxLines,
  }

  const todo = T('待办', () => ({
    open: parseOpenTodoCount(formatTodoList()),
    stale: todoStaleCandidates().length,
    /** 过了 5 遍仍开着的那些（F18）—— 该我主动去问用户了 */
    // 🔴 2026-09-25：只报「表里还在」的那些 —— 销掉的旧条目不再出现在状态面板（见 `overPassedTodos` 注释）
    overPassed: overPassedTodos(TODO_PASS_ALERT, openItems().items.map((x) => todoPassKey(x.item))).map((x) => ({
      item: x.item,
      passes: x.passes,
    })),
  }))

  // 工程（F35 · 2026-09-26 加）—— **另一份文件、另一节面板**（用户 2026-09-26：
  //   "**待办是待办，工程是工程，这两个不是一回事**……**不允许将他们混为一谈**"）。
  // ⚠️ 找不到那份文件**不是异常**（老档案里就没有它）→ `open=0` ＋ `file=''`，别报"读不到"。
  const project = T('工程', () => {
    const s = projectSummary()
    return {
      open: s.count,
      file: s.file,
      limits: s.limits,
      stale: projectStaleCandidates().length,
      tooLong: findProjectTooLong().length,
    }
  })

  // 事件收尾（F18）：🔴 2026-10-15 退役删除（它读的事件表随 L2 删了 ⇒ 恒 0，每轮白算一遍、白念一行）。

  // L6-工具临时 层（F19，2026-09-17 晚加；**旧名 L9，2026-09-26 层重建改号**）：多大、多少快照、上次回收了什么 —— 让"悄悄长胖"有地方显示
  const l9 = T('L9 看门', () => {
    const s = l9Stats()
    const st = loadL9State()
    return { ...s, lastAt: st.at ?? null, lastDropped: st.dropped ?? null, lastMb: st.droppedMb ?? null, lastOk: st.ok ?? null }
  })

  // 0 候选留底（F29，2026-09-20 加 · E165）：有几份躺在 `verified\` 里、最早哪份到期。
  // ⚠️ 这些份**不进留意栏**（E165 定的"0 候选 → 一个字都不说"）→ 状态面板是它们的**唯一常驻出口**。
  const ved = T('0 候选留底', () => {
    const all = listVerified()
    return {
      n: all.length,
      expired: all.filter((x) => x.expired).length,
      nextYmd: all.length > 0 ? all[0].expiresYmd || '' : '',
      next: all.length > 0 ? all[0].file : '',
    }
  })

  // 检索/巡检**跳过了哪些目录**（2026-09-19 加）—— 跳过不再静默。
  // ⚠️ 只在这里报、**不进体检**：跳过是忠实描述、不是异常，每轮体检都念就成了"消不掉的告警"
  //    （档案里最忌那个 —— 2026-09-17 离线盘那条就是这么被挪出体检的）。
  //    真正害人的是"跳了却不报告"，所以把它摆在"读一眼现状"的地方就够了。
  const scanSkip = T(
    '检索跳过',
    () => skippedDirs().map((x) => ({ rel: x.rel, hint: x.hint })),
    [],
  )

  const lastInject = T('注入日志', () => {
    const l = lastMatching(tailLines(LOG_FILE, 4000, 512 * 1024), '已注入')
    return l ? l.replace(/^\[[^\]]+\]\s*/, '') : ''
  }, '')

  return {
    at: nowCN(),
    // 🔴 `stamp` 报的是**装载值**（模块载入那一刻算定）—— 这才是"**真正在跑的那份代码**"。
    //    用 `codeStamp()`（磁盘现算）会撒谎：改完还没重启时它**已经变了**，看着就像新代码在跑
    //    （2026-09-17 实测：面板报 v0.20.0，而那次新加的路由全是 404）。
    //    磁盘那份单独放 `drift`，两边不一致时由面板**明说"还没装载"**。
    run: {
      stamp: T('版本/指纹（装载）', () => LOADED_STAMP, null),
      drift: T('磁盘 vs 装载', () => stampDrift(), null),
    },
    archive: { root: CFG.archiveDir, injectMode: CFG.injectMode },
    check,
    gate,
    caps,
    sentinels,
    watch: T('考勤', () => watchdogText(), ''),
    budget,
    todo,
    project,
    // closing：🔴 2026-10-15 随 G3 退役删除
    l9,
    ved,
    // 闸门全表（2026-09-25 加 · 用户要的"一共几道门 / 什么时候拦 / 拦了几次"）：
    // 🔴 说明书在 `manifest.js` 的 `GATES`（唯一一处）；这里只贴**运行时的数**。
    gates: T('闸门表', () => ({
      specs: GATES,
      f30Mode: f30Mode(),
      ticks: Object.fromEntries(Object.entries(GATE_TICKS).map(([k, v]) => [k, { seen: v.seen, hit: v.hit }])),
    })),
    // 阈值真值（2026-09-19 · 待办"固定阈值收成单点真值"）：面板与前端文案里的数字一律从这里取。
    // 为什么值得单列：真值各只有一处（F18/F19），而"超过 3 天""过 5 遍"在文案里手抄了 30 多处 ——
    // 改一次阈值就得手工同步一遍，漏一处就是**面板对用户撒谎**。
    thresholds: { passAlert: TODO_PASS_ALERT, l9Days: RETAIN.days, l9Newest: RETAIN.newest, verifiedKeepDays: VERIFIED_KEEP_DAYS },
    scanSkip,
    lastInject,
    problems,
  }
}

/**
 * 一屏文本（`dangan_status` 工具用）—— **从 `buildStatusData()` 渲染**，不另做聚合。
 * @returns {string}
 */
// ⚠️ 放在这儿（不在文件头）是为了少动一处 —— ESM 的 `import` 允许出现在模块顶层任意位置。
import { spendLine } from './f28-fuel.js'
// 闸门全表（2026-09-25 加）：说明书在 `manifest.js` 的 `GATES`，运行时的数在 F30 的两个导出里。
import { GATES } from './manifest.js'
import { GATE_TICKS, f30Mode } from './f30-toolgate.js'
// 考勤（F34 · 2026-09-26）：状态面板那一行 —— **全好也出一句**（"它扫过了"必须看得见）。
import { watchdogText } from './f34-watchdog.js'

export function buildStatus() {
  const d = buildStatusData()
  const L = []
  const NA = '（读不到）'

  L.push(`【梅莫莉亚 · 状态】（${d.at}）`)

  // ---- 在跑吗 ----
  // 🔴 报**装载值**（真正在跑的那份）；磁盘与装载不一致时**当场明说** ——
  //    否则"改完还没重启"会被面板读成"新代码已经在跑"（那正是 T246 那个坑）。
  L.push(`■ 在跑吗：${d.run.stamp ?? NA}`)
  // 🔴 2026-09-20 加：**今天花了多少钱** —— 只是个**读数**（用户当天把它从"报警"改成"只给事实"：
  //    "既然目前每轮工作都会被'计价门卫'或者闸门所控制…那十五块总量的那个表已经没有存在意义了…
  //     我觉得只单纯方便你知道用了多少钱就行了。不用报警或者警告了。"）。
  //    ⚠️ 读不到 → **这一行不出现**（"探测不到 ≠ 不存在"，也**不许编一个数**）。
  {
    const spend = spendLine()
    if (spend) L.push(`■ ${spend}`)
  }
  if (d.run.drift) {
    L.push('  ⚠️ **磁盘与装载不一致 —— 改的代码还没装载（要重启才生效）**')
    L.push(`     装载：${d.run.drift.loaded}`)
    L.push(`     磁盘：${d.run.drift.disk}`)
  }
  L.push(`  档案根：${d.archive.root}`)
  L.push(`  注入模式：${d.archive.injectMode}`)

  // ---- 体检 ----
  // 🔴 2026-10-21 加尾注：**这份结论多新**（上次何时跑 + 之后档案动过没）。
  //    起因：第二路实测我 30 天手动跑了 122 次全档体检 —— 其实我想知道的就是"它还作不作数"。
  const checkFresh = (() => {
    if (d.check === null || !d.check.at) return ''
    const t = d.check.at
    const dt = new Date(t)
    const z = (n) => String(n).padStart(2, '0')
    const mins = Math.round((Date.now() - t) / 60000)
    const ago = mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : `${Math.floor(mins / 60)} 小时前`
    const tail = d.check.wroteAfter === true ? ' · ⚠️ 之后**改过档**（结论可能过时）' : d.check.wroteAfter === false ? ' · 之后没动过' : ''
    return ` ｜ 上次 ${z(dt.getHours())}:${z(dt.getMinutes())}（${ago}）${tail}`
  })()
  L.push(
    `■ 体检：${
      d.check === null
        ? NA
        : `**${d.check.errors} 条要修** · 提示 **${d.check.tips}** 条 ｜ 时间轴 ${d.check.timeline} 行` +
          `（❗${d.check.must} ⭐${d.check.imp} ○${d.check.plain}${d.check.undecided > 0 ? ` · ⚠️未定级 ${d.check.undecided}` : ''}）` +
          ` · 事件 ${d.check.events} 条`
    }${checkFresh}`,
  )

  // ---- 闸门 ----
  L.push(`■ 闸门：模式 **${d.gate?.mode ?? NA}**`)
  L.push(
    `  本会话已拦：${
      d.gate === null
        ? NA
        : `${d.gate.denied} 次（` +
          (d.gate.closedAt
            ? `上次通过：${new Date(d.gate.closedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
            : '还没有通过记录') +
          '）'
    }`,
  )
  L.push(`  最近一次判定：${d.gate?.lastVerdict || '（日志里还没有记录）'}`)

  // ---- 干活统计 ----
  L.push(`■ 干活统计（本进程累计，**没出现的能力＝这一程一次都没动过**）：`)
  L.push(
    `  ${
      d.caps.length === 0
        ? '（这一程什么都还没干）'
        : d.caps.map((c) => (c.note ? `${c.id}=${c.count}(${c.note})` : `${c.id}=${c.count}`)).join(' ')
    }`,
  )

  // ---- 哨兵 ----
  L.push(
    `■ 哨兵：${
      d.sentinels === null
        ? NA
        : `作废口径 ${d.sentinels.voided} 条 ｜ 路径锚点：探测不到 **${d.sentinels.anchorMissing}** 条 / 共查 ${d.sentinels.anchorChecked} 条` +
          (d.sentinels.offlineCount > 0 ? `（离线盘 ${d.sentinels.offlineDrives.join('/')} 跳过 ${d.sentinels.offlineCount} 条）` : '') +
          ` ｜ 凭据（模式 ${d.sentinels.secretsMode}）：${d.sentinels.secretHits === null ? '（已关闭，不查）' : `${d.sentinels.secretHits} 处`}`
    }`,
  )

  // ---- 考勤（F34 · 2026-09-26 加）----
  // 为什么单列一行、而且**全好也出**：它盯的是"每步该露面的能力谁不见了"，
  // 而"它自己还在不在扫"是同一个问题的另一半（用户要的"没出声这个能力也出声"）。
  // ⚠️ 与"哨兵"那一行的分工：哨兵报**内容**的毛病（作废口径 / 锚点 / 凭据），它报**能力活着**。
  {
    try {
      const w = watchdogText()
      if (w) L.push(w)
    } catch (e) {
      L.push(`■ 考勤：（读不到：${e}）`)
    }
  }

  // ---- 检索/巡检跳过（2026-09-19 加）----
  // 为什么值得单独一行："这份文件为什么搜不到"以前**没有任何地方能回答**（跳了不报告）。
  if (Array.isArray(d.scanSkip) && d.scanSkip.length > 0) {
    L.push(
      `■ 检索/巡检跳过（**只按档案根那一层的目录名**判）：${d.scanSkip
        .map((x) => `\`${x.rel}\`（名字含"${x.hint}"）`)
        .join('、')} —— 这些目录不进体检、也不进全档检索；要扫其中哪个，把它写进配置 \`scanForcedDirs\``,
    )
  }

  // ---- 预算 ----
  // ⚠️ 2026-09-29：「压缩后重注入」砍掉之后，"注入用量"这个指标本身没了 ⇒ 面板不再报它
  //    （用户当天定「整行去掉」；原先那句是 `■ 预算：注入用 N/M 字符 ｜ 工具输出上限 …`）。
  L.push(`■ 工具输出上限：${d.budget.toolChars} 字符 / ${d.budget.toolLines} 行`)

  // ---- 待办 ----
  L.push(
    `■ 待办：${
      d.todo === null || d.todo.open === null
        ? '（读不到待办表）'
        : `还开着 **${d.todo.open}** 条 ｜ 机器挑出 **${d.todo.stale}** 条"该消的"（用 dangan_todo list 看细节）`
    }`,
  )
  if (d.todo && Array.isArray(d.todo.overPassed) && d.todo.overPassed.length > 0) {
    L.push(`  ⏳ 其中 **${d.todo.overPassed.length} 条过了 ${TODO_PASS_ALERT} 遍仍未动** —— 该主动问用户"还做吗"：`)
    for (const x of d.todo.overPassed.slice(0, 5)) L.push(`    · ${x.item}（过 ${x.passes} 遍）`)
  }

  // ---- 工程（F35）----
  // 🔴 **单独一行，不许并进上面那行待办**（用户 2026-09-26："**待办是待办，工程是工程**……
  //    **不允许将他们混为一谈**"；两边的量级判据也不同）。面板上它同样是**单独一节**。
  L.push(
    `■ 工程：${
      d.project === null
        ? '（读不到工程清单）'
        : d.project.open === 0
          ? `**0 项**还开着${d.project.file ? `（${d.project.file}）` : '（档案里没有工程清单）'}`
          : `还开着 **${d.project.open}** 项（**跨很多轮、工程量爆表的那种活 —— 不是待办**）` +
            `｜ 机器挑出 **${d.project.stale}** 条"该看的"（也走 dangan_todo 看细节）`
    }`,
  )

  // ---- 事件收尾（F18）：🔴 2026-10-15 退役删除 ----

  // ---- L6-工具临时 层（F19；旧名 L9，2026-09-26 层重建改号）----
  L.push(
    `■ L6-工具临时：${
      d.l9 === null
        ? '（读不到）'
        : `${d.l9.files} 个文件 / **${d.l9.mb} MB**（快照 ${d.l9.snapshotCount} 个 / ${d.l9.snapshotMb} MB）` +
          (d.l9.lastAt
            ? ` ｜ 上次回收 ${d.l9.lastOk ? `${d.l9.lastDropped} 个 / ${d.l9.lastMb} MB` : '没跑成'}（${String(d.l9.lastAt).slice(5, 16).replace('T', ' ')}）`
            : ` ｜ 还没回收过（策略：最近 ${RETAIN.days} 天 ＋ 最新 ${RETAIN.newest} 个）`) +
          (d.l9.over ? ` ⚠️ **超过 ${d.l9.warnMB} MB 警戒线**` : '')
    }`,
  )

  // ---- 0 候选留底（F29，2026-09-20 · E165）----
  // 「机器筛过的账」也要看得见：它们**不进留意栏**（那是 E165 定的），所以面板是它们的唯一常驻出口。
  L.push(
    `■ 0 候选留底（verified）：${
      d.ved === null
        ? '（读不到）'
        : d.ved.n === 0
          ? `**0 份**（保留期 最近 ${VERIFIED_KEEP_COUNT} 份，到期自动清）`
          : `**${d.ved.n} 份**（**销账后挪入** · 保留期 最近 ${VERIFIED_KEEP_COUNT} 份）` +
            ` ｜ 最早到期 ${d.ved.nextYmd || '（读不到）'}${d.ved.expired ? ` · ⚠️ **${d.ved.expired} 份已到期待清**` : ''}`
    }`,
  )

  // ---- 最近一次注入 ----
  // ⚠️ 2026-09-17 上线当天修的真 bug：原来只读日志尾部 8KB ≈ 60 行，而"已注入"这种**稀疏事件**
  //    常常在几百行以前 → 面板会说"**还没有注入记录**"。**那是撒谎**（明明有）。
  //    现在：往后读 512KB；而且找不到时**只说"在这段里没找到"**，绝不说"没有"（"没找到" ≠ "不存在"）。
  L.push(
    `■ 最近一次注入（memoria.log 尾部 512KB）：${
      d.lastInject || '（这段里没找到注入记录 —— 不代表从来没注入过，只是它在更早的位置）'
    }`,
  )

  if (d.problems.length > 0) {
    L.push('')
    L.push(`⚠️ 有 ${d.problems.length} 段没读到（不影响其它段）：`)
    for (const p of d.problems) L.push(`  · ${p}`)
  }

  L.push('')
  L.push(
    '（想深挖哪一段：体检 → `dangan_check` · 待办 → `dangan_todo` · **工程 → `dangan_todo`（同一通道，另一份文件）** · 注入与统计 / 闸门 → 运行数据目录里的 `memoria.log` / `memoria-gate.log`）',
  )
  return L.join('\n')
}
