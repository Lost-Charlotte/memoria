/**
 * 梅莫莉亚 dsh-memoria —— DeepSeek档案的哨兵（host 插件）
 *
 * 名字：Memoria / メモリア，拉丁语「记忆」。
 * 定位：档案是唯一权威源。**默认只读** —— 看护、体检、提醒、拦住"该落的档没落"；
 *   **写入是例外**：只在她被明确授权的那一个落笔入口里发生，且只走「改档工具」那扇唯一的门。
 *   （2026-09-16 深夜用户要求改口：原来写的是"只读、一个字都不写"；加了落档工具之后，这条定义必须跟着改。）
 *
 * 核心三件事（**F1 / F2 / F4 均已实现**；完整能力表见 `manifest.js` 的 `CAPS` —— 别在这儿抄第二份）：
 *   F1 在岗标记    ：每轮在开头报一句「梅莫莉亚在岗 ＋ 时间」；压缩留底 / 考勤 / 油表那些钩子转交也挂在这一档
 *   F2 文字体检    ：扫"作废的口径 / 过时的说法 / 核不到出处的引文"三类（**能力标题以 `manifest.js` 为准**）
 *   F4 读档案      ：关键词 / 时间轴 / 时间窗 / 最近 / 上下文 / 文件清单 —— 六种读法一个工具（`dangan_search`）
 *
 * 解耦原则（2026-09-16，用户指出"改档案就牵一发动全身"后重写）：
 *   **插件不假设档案的结构。** 路径全部走 config；文件按「名字里有什么」来找，
 *   不硬编码完整路径。档案随便重组、随便挪盘，这里一个字都不用改。
 *     - 读序  → 不硬编码，直接注入入口文件全文（读序本来就写在里面）
 *     - 铁律  → 在 tieDir 下找名字含「铁律」的 .md
 *     - 跳过  → 按语义跳过名字含「证据 / 临时 / 备份」的目录
 *
 * 工程决定：
 * - 零运行时依赖：不 import 任何 @deepseek-ai/* 包。宿主包在 Junction 布局下
 *   Node 按 realpath 解析会找不到（meow-memory 因此必须 esbuild 打包成自包含产物）。
 *   我们只需要构造一个 user-role 消息对象，手写即可 —— 免构建、改完即生效。
 *   ✅ 2026-09-16 真实 API 实测：手写消息被 DSH 接受，注入后模型正常响应。
 * - 全程 fail-open：pre-step 是 async 监听器，本插件抛错会沿 agent-loop 传播、
 *   改变宿主 turn 的错误语义 —— 所有自己的逻辑一律 try/catch 吞掉并放行原 decision。
 * - 注入消息必须打 source.kind='plugin'：否则会被当成真实用户消息。
 * - 挂载只走 `dsh plugin --profile web add <本地目录>`：它一次做全三件事
 *   （junction + dependencies + **dsh.profile.bundles**）。
 *   ⚠️ 只建 junction、漏掉 bundles 的插件永远不会被加载（qq-mode-console 就这么躺了 13 天）。
 *
 * 目录结构（2026-09-16 按职责拆模块，行为零变化）：
 *   f<代号>-<名字>.js  能力内核，一个能力一个文件（f1 在岗标记 / f2 作废 / f5 体检 / f7 闸门 / …）
 *   manifest.js    **装配的唯一来源** —— 那张 `CAPS` 表说清"装谁、叫什么、干什么"，模块名单别在这儿抄第二份
 *   tools.js       六个工具（`dangan_search` / `check` / `weave` / `todo` / `status` / `init`）的定义
 *   common.js      配置(CFG)、日志、路径与文件小工具、消息构造、会话小工具、版本指纹
 *   sentinel.js    哨兵公共底座（扫档案 + 判命中）—— 🔴 **现在只有 F27 用它**：F25 已退役（2026-10-19）、F2 自己扫
 *   texts.js       文案表（`assets/texts.json`）的读取口
 *   client.js      网页面板（浏览器半边）
 *   本文件          apply()：只做注册与编排
 */

import { join } from 'node:path'

import { CFG, CAP_STATS, LOADED_STAMP, capReport, codeStamp, createPluginMessage, findByHint, log, readTextSafe, rel, shortSid, stampDrift } from './common.js'
// （2026-09-29）原来这里 import 了 F1 的 7 个导出（`buildReinjection` / `lastBudgetInfo` /
// `loadPending` / `markPendingServiced` / `pendingReinject` / `persistedPendingHit` / `writePending`）
// —— 「压缩后重注入」整条删除之后，它们**一个都不存在了**。ESM 会因"找不到导出"**当场装载失败**
// （2026-09-29 实测：控制台上的梅莫莉亚形象直接消失）。所以这一行整行删掉，不留半个名字。
import { scanVoided } from './f2-void.js'
import { checkArchive, dateKey, formatRecent, pickRecent } from './f5-check.js'
import { closeGate, gateMode, gateVerdict } from './f7-gate.js'
import { CAPS, capabilityList, manifestProblems } from './manifest.js'
// 🔴 2026-09-22：工具**直接**在这里 import，不再经 `manifest.js` 转手 ——
//    那条 `manifest ← tools ← … ← manifest` 的环，成败取决于"谁先被加载"：
//    实测直接 `import './lib/tools.js'` 会报 `Cannot access 'danganCheckTool' before initialization`
//    （跑测试时才踩响，实际运行因为 `index.js` 先跑而一直没露）。
//    现在 manifest 只记**工具名**（`toolName`），由这里映射回真的 ToolDefinition。
import { danganCheckTool, danganInitTool, danganSearchTool, danganStatusTool, danganTodoTool, danganWeaveTool } from './tools.js'

/** 工具名 → ToolDefinition（装配时按 manifest 的 `toolName` 取）。 */
const TOOLS_BY_NAME = {
  dangan_check: danganCheckTool,
  dangan_init: danganInitTool,
  // 🔴 2026-10-15：「落档」的入口**收进织布机**了（用户：「这是类似 l2 平推的活。结构性调整。
  //    所有老指向该删除的全删除。接口接入新的替代地方。」）—— 老工具名 `dangan_log` 已删，
  //    落档改走 `dangan_weave` 的 **`pattern:'落档'`**（见 `lib/loom-patterns.js`）。
  dangan_search: danganSearchTool,
  dangan_status: danganStatusTool,
  dangan_todo: danganTodoTool,
  dangan_weave: danganWeaveTool,
}
import { buildStatus } from './f15-status.js'
// ⚠️ 工具定义**只由 `manifest.js` 那张表引用**（它自己 import `tools.js`）——
//    这里不再 import 一遍（2026-09-18 工具合并顺手清掉：那次合并删掉了 4 个工具对象，
//    而这一行还按老名字 import，**加载时就会整条报错**：`does not provide an export named`）。
//    "表在哪儿"只有一处 —— 免得下次再漂。

export const name = 'dsh-memoria'

/** 依赖 tools 服务 —— 注册 dangan_search 用。 */
export const inject = ['tools']

// ============================================================
// 插件本体
// ============================================================

export function apply(ctx, config = {}) {
  try {
    Object.assign(CFG, config ?? {})
  } catch (e) {
    log(`config 合并失败（用默认值继续）: ${e}`)
  }
  if (process.env.MEMORIA_INJECT) CFG.injectMode = process.env.MEMORIA_INJECT

  log(`apply called; DSH_HOME=${process.env.DSH_HOME ?? '(unset)'} cwd=${process.cwd()}`)
  // ⚠️ 2026-09-17 晚：**报两个指纹** —— 现算（磁盘这一刻）与装载值（模块最初载入那份）。
  //   两者不一致＝中途改过代码而模块没重新装载（那时跑的是"装载值"那份）。
  //   原来只报一个（装载值），于是热重载 / 只开新会话时会**误报成旧代码**（当天实测撞上）。
  // 🔴 **控制台上唯一必留的那一行**（2026-10-22 用户第三次嫌控制台乱）：
  //    `log()` 现在**默认不打印**，只有显式 `{ show: true }` 才出声。
  //    启动只留这一行（版本 ＋ 模块数 ＋ 指纹 ＋ 装载值），其余全进 `memoria.log`。
  log(`梅莫莉亚 ${codeStamp()}（磁盘这一刻）· 装载值 ${LOADED_STAMP}`, { show: true })
  {
    const d = stampDrift()
    if (d) log(`⚠️ **装载值 ≠ 磁盘** —— 说明中途改过代码而模块没重新装载，现在跑的是装载那份；重启控制台才会换成磁盘这份`, { show: true })
  }
  log(`档案根目录: ${CFG.archiveDir} | 注入模式: ${CFG.injectMode}`)

  // 自检：档案入口和铁律能不能按"名字"找到（找不到就是配置或结构变了，不是崩溃）
  try {
    const entryPath = join(CFG.archiveDir, CFG.entryFile)
    const tiePath = findByHint(join(CFG.archiveDir, CFG.tieDir), CFG.tieNameHint)
    log(`自检 · 入口文件：${readTextSafe(entryPath).length > 0 ? 'OK' : `读不到 ${entryPath}`}`)
    log(`自检 · 铁律文件：${tiePath ? rel(tiePath) : `在 ${CFG.tieDir} 下没找到名字含「${CFG.tieNameHint}」的 .md`}`)
  } catch (e) {
    log(`自检失败（fail-open）: ${e}`)
  }

  // ⚠️ F2 作废哨兵 / F5 等级哨兵那两段自检**已挪进各自模块**（`f2-void.js` 的 `reportF2`、
  //    `f5-check.js` 的 `reportF5Levels`），由能力清单在装配时调用 —— "每个能力自己报自己的工作量化"。
  //    搬走的理由：原来这两段写死在这里，加一个能力就要来这儿再插一段，正是"改一处牵一发动全身"。

  // ============================================================
  // 装配：**只照着 `manifest.js` 那张能力清单装**（2026-09-17 模块化改造）
  //   · 加功能＝加一个文件 ＋ 清单加一行 —— 这里一个字都不用改
  //   · 每装一个就报一行；**装不上要出声**（静默失效是本档案最想避免的那类毛病）
  // ============================================================
  const bad = manifestProblems()
  // 🔴 2026-10-22：`log()` 默认不打印了 ⇒ **这类"装配期严重问题"必须显式出声**，
  //    否则控制台一片安静、问题只躺在日志文件里（那正是"沉默 ≠ 正常"要防的事）。
  for (const b of bad) log(`⚠️ 能力清单有问题：${b}`, { show: true })
  log(`能力清单：${CAPS.length} 项（${capabilityList().map((c) => c.id).join(' / ')}）`, { silent: true })

  for (const cap of CAPS) {
    // ① 挂事件 / 拦截器
    if (typeof cap.register === 'function') {
      try {
        cap.register(ctx)
        log(`已装配 ${cap.id} ${cap.title}`, { silent: true })
      } catch (e) {
        log(`装配 ${cap.id} ${cap.title} 失败（fail-open）: ${e}`, { show: true })
      }
    }
    // ② 注册工具（挂 ctx.effect：fiber dispose / 热重载时自动注销）
    // 2026-09-22：manifest 只记工具名，这里映射回真的 ToolDefinition（见文件头那条注释）。
    // 🔴 2026-10-21 加（第一路审查报的"拼错就静默消失"）：**声明了工具名、却映射不到** ⇒ 出声。
    //    原来这里是 `if (cap.toolName && TOOLS_BY_NAME[cap.toolName])` —— 没有 else：
    //    一个字母打错，那个工具就凭空不见了，而日志正常、测试照样绿。
    if (cap.toolName) {
      if (TOOLS_BY_NAME[cap.toolName]) cap.tool = TOOLS_BY_NAME[cap.toolName]
      else log(`⚠️ ${cap.id} 声明了工具名「${cap.toolName}」，但 tools.js 里没有它 —— 这个工具不会出现（先查拼写）`)
    }
    if (cap.tool) {
      try {
        if (ctx.tools && typeof ctx.tools.register === 'function') {
          const dispose = ctx.tools.register(cap.tool)
          try {
            if (typeof ctx.effect === 'function') ctx.effect(() => () => dispose())
          } catch {
            /* effect 不可用就交给进程退出回收 */
          }
          log(`工具已注册: ${cap.tool.name}（${cap.id} ${cap.title}）`)
        } else {
          log(`ctx.tools 不可用 —— ${cap.tool.name} 没注册（inject 没生效？）`)
        }
      } catch (e) {
        log(`注册 ${cap.tool?.name ?? cap.id} 失败: ${e}`)
      }
    }
    // ③ 启动自检：**自报工作量**（沉默 ≠ 正常）
    // ⚠️ **2026-09-17 修**（重启后实测抓到的）：`selfCheck` 有**两种写法** ——
    //    `reportF2` / `reportF5Levels` / `reportF9` 是"**自己 log**"，
    //    而 `reportF12` / `reportF13` / `reportF14` 是"**返回一句字符串**"。
    //    这里原来只 `cap.selfCheck()`、**不接返回值** → **那三个的启动自检一个字都没说**：
    //    **写了自检，却没接上输出线** —— 正好是"沉默 ≠ 正常"要防的那件事（只是这次犯的人是我自己）。
    //    现在：**返回值是字符串就替它打出来**（两种写法都对）。
    if (typeof cap.selfCheck === 'function') {
      try {
        const said = cap.selfCheck()
        if (typeof said === 'string' && said.trim().length > 0) log(said)
      } catch (e) {
        log(`${cap.id} 自检失败（fail-open）: ${e}`)
      }
    }
  }
  log('apply 结束', { silent: true })
}

/** 供测试脚本使用的内部导出（生产路径不依赖）。 */
export const __internals = {
  createPluginMessage,
  scanVoided,
  checkArchive,
  // 🔴 2026-10-15：`timelineLevelStats` 随 L2 退役删除（时间轴已不在档案里）。
  pickRecent,
  formatRecent,
  gateVerdict,
  // 🔴 2026-10-15：`countT` / `countE` 随 L2 退役删除（时间轴 / 事件表都不在档案里）。
  // 🔴 2026-10-15：`eventTableHash` 随 L2 退役删除（它读事件表算指纹，给已退役的 G1 当基线）。
  dateKey,
  closeGate,
  gateMode,
  shortSid,
  codeStamp,
  CFG,
  CAP_STATS,
  capReport,
  buildStatus,
}
