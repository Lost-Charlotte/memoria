/**
 * 梅莫莉亚 · 公共设施
 *
 * 配置（CFG）、日志（log）、路径与文件小工具、消息构造、会话小工具。
 * ⚠️ `CFG` 只有这一份 —— `apply()` 合并配置、测试直接改 `__internals.CFG.archiveDir`，
 * 两边必须是**同一个对象引用**，不许拷贝。
 */

import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** DSH **自己的**数据根（`~/.dsh`）—— `sessions` / `storages` / `AGENTS.md` / `.dshw-usage.json` 都在这儿。 */
export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

/**
 * 🔴 **她自己的家**（2026-09-24 收拢）：她的运行数据（日志 / 状态 / 馆表 / 闸门 / 留底 / 事务残件）
 * 从此全住这一个目录 —— 不再平铺在 `~/.dsh` 根下（原来根层 52 项里她占 24 项）。
 * 老文件由 `migrateHomeOnce()` **一次性搬过来**（只搬、不删、不覆盖）。
 */
export const MEMORIA_DIR = process.env.MEMORIA_HOME || join(DSH_HOME, 'memoria')

/**
 * ⚠️ **历史别名 —— 2026-09-24 起它 ＝ `MEMORIA_DIR`（她的家），不再等于 `~/.dsh`。**
 *
 * 为什么留着这个名字：`join(HOME_DIR, 'memoria-xxx')` 这种写法散在十几个模块里（grep 出 100 处），
 * 逐处改名＝改 100 处且必然漏；**改它的"指向"＝只改这一处**。所以名字先留着，指向已经换了。
 *
 * 🔴 凡是要 **DSH 自己**的东西（`sessions` / `storages` / `AGENTS.md` / `.dshw-usage.json` /
 *    `.credentials.yaml`），**一律用 `DSH_HOME`**，不要用这个。
 */
export const HOME_DIR = MEMORIA_DIR

export const LOG_FILE = join(HOME_DIR, 'memoria.log')

/** 她的家必须先在 —— 否则第一条日志就写不进去。 */
try {
  if (!existsSync(MEMORIA_DIR)) mkdirSync(MEMORIA_DIR, { recursive: true })
} catch {
  /* 建不出来也让插件照常跑（日志那边自己会失败并降级） */
}

/**
 * **一次性搬家**（2026-09-24）：把平铺在 `~/.dsh` 根下的 `memoria-*`（文件与目录）挪进 `MEMORIA_DIR`。
 *
 * 三条纪律：**只搬 · 不删 · 不覆盖**（目标已存在 ⇒ 跳过并记一行）。**幂等** —— 搬完就没什么可搬的。
 * ⚠️ 搬不动（占用 / 权限）**不算错**：新位置照旧能写，旧文件留着不影响跑。
 */
export function migrateHomeOnce() {
  const moved = []
  const skipped = []
  try {
    for (const name of readdirSync(DSH_HOME)) {
      if (name === 'memoria' || name.startsWith('.')) continue
      if (!name.startsWith('memoria-') && name !== 'memoria.log') continue
      const to = join(MEMORIA_DIR, name)
      try {
        if (existsSync(to)) {
          // 目标已有同名 —— **绝不覆盖**：给源加个时间戳后缀，一起搬进去（两份都留着，谁都不丢）。
          // ⚠️ 这条路**真会走到**：搬家那一刻，**运行中的旧代码还在往旧位置写** —— 于是"两边都有"。
          //    （2026-09-24 实测踩到：跳过的话，它刚写的那几份会永远散在 `~/.dsh` 根下。）
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const alt = `${name}.old-${stamp}`
          renameSync(join(DSH_HOME, name), join(MEMORIA_DIR, alt))
          moved.push(`${name}（目标已有 ⇒ 存成 ${alt}）`)
          continue
        }
        renameSync(join(DSH_HOME, name), to)
        moved.push(name)
      } catch (e) {
        skipped.push(`${name}（${(e && e.code) || (e && e.message) || e}）`)
      }
    }
  } catch {
    /* 列目录都失败就算了 */
  }
  return { moved, skipped }
}

// 模块一被 import 就把家搬好（放这儿是因为 `LOG_FILE` 等常量就在上面等着用）
try {
  const r = migrateHomeOnce()
  if (r.moved.length > 0) {
    appendFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] 运行数据收拢：从 ~/.dsh 搬进 memoria/ 共 ${r.moved.length} 项` +
        `${r.skipped.length ? `（跳过 ${r.skipped.length}：${r.skipped.join('、')}）` : ''}\n`,
    )
  }
} catch {
  /* 搬不动不影响跑 */
}

/**
 * 档案根目录的默认值 —— **取第一个存在的**，一个都不在就用第一个候选（＝"还没建"）。
 * ⚠️ 不写死某台机器的用户名/盘符：别人下载插件后，这份默认值也得成立。
 */
function defaultArchiveDir() {
  // 🔴 2026-10-19：**默认落 `~/.dsh`**（跟 DSH 自己的 sessions / storages 放一起），**桌面降级成老位置兜底**。
  //    用户原话：「不要让他默认在桌面了。说实话是因为最早懒才放在桌面的」。
  //    桌面那条**只留着读老用户已有的档案**，新用户（两处都没有）会建在 `~/.dsh`。
  const cands = [
    process.env.GAI_DANG_ROOT,
    // 🔴 2026-10-20（发布前修）：这里原来是 `join(HOME_DIR, 'DeepSeek档案')`，而 `HOME_DIR` 是
    //    `~/.dsh/**memoria**`（运行数据目录）⇒ 新用户的档案会建到 `~/.dsh/memoria/DeepSeek档案`，
    //    和 5 份文档写的 `~/.dsh/DeepSeek档案` 差一层。现在改成 `DSH_HOME`（`~/.dsh`），与文档一致。
    //    ⚠️ 老用户不受影响：多馆之后走 `activeArchiveDir()` → 馆表 `active`，到不了这里。
    join(DSH_HOME, 'DeepSeek档案'),
    join(homedir(), 'Desktop', 'DeepSeek档案'),
  ].filter((p) => typeof p === 'string' && p.length > 0)
  for (const p of cands) {
    try {
      if (existsSync(p)) return p
    } catch {
      /* 探不到就当不存在 */
    }
  }
  return cands[0]
}

/**
 * **当前活跃馆** —— 给"没有 cordis 配置可读"的那一族用（随包脚本的 CLI 默认值）。
 *
 * 🔴 **2026-10-16 加**（真账：新馆里跑 `reconcile-dump.mjs`，骨架属新馆而脚本默认读旧馆
 *   ⇒ **虚报 53 处"没进档"**；总账 R1 就是这么来的）。
 *
 * 次序：① `GAI_DANG_ROOT`（测试隔离 / 显式指定，**最高优先**）
 *       ② 馆表 `memoria-archives.json` 的 `active` ← **活跃馆的权威就这一处**（切馆时由 F32 写）
 *       ③ `defaultArchiveDir()` 的老兜底
 * 兜底判据：**目录得在**（馆表坏了 / 那条馆被删 ⇒ 回落，绝不因为读不到就不干活）。
 *
 * ⚠️ 只回**目录**，不回"它健不健康" —— 判健康要读入口文件，那是 `f32-archives.js` 的 `healthy()`，
 *    而它是插件内部件；这里只给"路径默认值"这一件事（消费方是 `tools/` 下的 CLI 壳）。
 * ⚠️ `MEMORIA_ARCHIVES_FILE` 认 —— 它是馆表的**测试隔离口**，跟 `f32-archives.js` 同一口径。
 */
export function activeArchiveDir() {
  const env = process.env.GAI_DANG_ROOT
  if (typeof env === 'string' && env.length > 0) return env
  try {
    const f = process.env.MEMORIA_ARCHIVES_FILE || join(HOME_DIR, 'memoria-archives.json')
    if (existsSync(f)) {
      const a = JSON.parse(readFileSync(f, 'utf8'))?.active
      if (typeof a === 'string' && a.length > 0 && existsSync(a)) return a
    }
  } catch {
    /* 馆表读不到 / 坏了 ⇒ 走老兜底（与 f32 的"绝不因为读不到就不干活"同一条） */
  }
  return defaultArchiveDir()
}

/**
 * 路径规范化 —— **比较路径时的唯一一把尺子**（Windows 上比大小写没意义）。
 * 一律：分隔符统一成 `/` · 去掉尾斜杠 · 转小写。
 *
 * 🔴 **2026-10-07 从 `f32-archives.js` 提到这里**（唯一来源）：`f32`（认馆 / 别馆只读）与
 *    `f22`（留底的**馆归属**）用的是**同一把尺子** —— 两处各写一份就是 R26 那一族
 *    （"同一口径两处实现"，改一处必漏一处）。
 */
export const normPath = (p) => String(p ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()

/** 默认配置；全部可用 cordis patch 的 config 覆盖 —— 改路径不用碰代码。 */
export const CFG = {
  /**
   * 档案根目录。
   *
   * ⚠️ **2026-09-17：默认值不再写死某台机器的绝对路径** —— 解析次序是
   *   `GAI_DANG_ROOT` 环境变量 → `~/Desktop/DeepSeek档案` → `~/.dsh/DeepSeek档案`（**取第一个存在**的）。
   * 为什么：插件要能被**别人下载**（用户定的标准："我总不能上传我的历史信息吧"），
   * 所以包里不许留"只有这台机器才成立"的路径；而换档案位置时**只改这一处**（或干脆设环境变量）。
   * 要指向别处：① cordis 配置里的 `archiveDir`（最高优先）② `GAI_DANG_ROOT` ③ 上面那两个默认位置。
   *
   * 🔴 **2026-10-16 改**：默认值从 `defaultArchiveDir()` 换成 `activeArchiveDir()` ——
   *   多馆并存之后，默认值要认**活跃馆**（馆表的 `active`），否则换馆后**随包脚本**读旧馆
   *   （真账：新馆里跑对账，虚报 53 处"没进档"）。
   *   **插件运行时不受影响**：`apply()` 合并 cordis 配置时会把它覆盖成配置那一份（最高优先）。
   *   **测试隔离不受影响**：`GAI_DANG_ROOT` 仍在最前（`activeArchiveDir()` 的第一条）。
   */
  archiveDir: activeArchiveDir(),
  entryFile: '从这开始读.txt',
  tieDir: 'L1-必读',
  tieNameHint: '铁律',
  /** 'full' = 入口 + 铁律 + 作废清单（默认）；'list' = 只作废清单（小上下文模型验证用）。 */
  injectMode: 'full',
  /**
   * 注入预算（F12，2026-09-17 加）。`null` ＝ 用 `lib/f12-budget.js` 里的默认值
   * （那一份顶着**实测来源**的注释：真档案一次注入实测 18,432 字符）。
   * ⚠️ 这里是**浅合并** —— patch 里写 `budget` 会**整块替换**默认值（要改就写全）。
   */
  budget: null,
  /**
   * 工具输出的预算（F12 的第二半，2026-09-17 加）：`maxChars` / `maxLines`。
   * `null` ＝ 用 `lib/f12-budget.js` 里的 `TOOL_OUTPUT`（真档案实测最大 7,405 字符 / 82 行 → 留约 3 倍余量）。
   * ⚠️ `dangan_check scope="index" mode="render"`（原 `dangan_index`）**故意不受它管**（那份产物要拿去整块替换，截断＝交出坏产物）。
   */
  toolOutput: null,
  /**
   * 地图生成器（F17 自动重出地图时调它）。
   *
   * ⚠️ **为什么是"调它"而不是"插件自己再写一个渲染器"**：那份 .md 的渲染**只有一份代码**
   *    （`tools/档案结构地图.mjs`，它自带快照 + 读回对账），插件再写一份就是**第二个渲染器** ——
   *    两处必漂，正是这份档案的头号病根（副本病）。所以插件只负责"**在它该跑的时候替它跑**"。
   * 找不到 / 跑不动 → **只记日志、绝不抛错**（地图停在旧版而已，别的能力不受影响）。
   *
   * 📦 **2026-09-17：生成器随插件走** —— 原来它住在 `E:\DeepSeek工具箱\`（插件包外），
   *    换机器就没有。现在默认指向包内 `tools/档案结构地图.mjs`，`toolPath()` 仍会回退到工具箱。
   */
  mapGenerator: null,
  /**
   * 回收站脚本（F19 回收 L9 里的旧快照时调它）—— **唯一入口，可复原**。
   * ⚠️ **绝不 `Remove-Item` 永久删**：那正是 09-14 丢文件那类事故的形状。
   * 📦 2026-09-17 起随插件走（包内 `tools/recycle-del.ps1`），找不到就回退工具箱。
   */
  recycleTool: null,
  /**
   * 🔴 **2026-10-21 核（第一路结构审查报的"四处口径打架"）**：**现在实际是 `false`，走回收站**
   *   （运行时 `~/.dsh/memoria/memoria-l9.json` 也记着 `"mode":"回收站"`）。
   *   下面 217 / 227 那两段是"**曾经改成 true**"时的记录 —— **别拿它当现状**；
   *   234 / 236 那一段才是现在这套（"默认不去冒那个险"）。两份原文都照留（W8）。
   *
   * 🔴 **2026-09-27 改成 `true`（走"永久删"那条路）** —— 用户当天〔会话 2026-09-27〕：
   *    "**有关临时和快照，这些东西本来就是一次性的东西，没必要一直留着。用完就删是对的，
   *     但总不能一直这样提起来才删吧，或许我们需要自动化删除。而且确实不该走回收站。
   *     我的回收站里全是这些玩意**"。
   *
   * ⚠️ **历史（W8：旧做法就地标，不许删原文）**：
   *   · 用户 2026-09-17 晚先说过"自己彻底删除吧，不然回收站不也越堆越大"，
   *     **但同一条消息的后半句就是"回收站就回收站吧。就这样。"** —— 于是那一版**默认定成回收站**
   *     （下面那段原来的注释就是那时写的，照留）。
   *   · 后果实测（2026-09-27）：回收站被快照挤到 **C: 727.6 MB / D: 101.5 MB**，用户"打开都卡"。
   * ⇒ 现在按最新口径切回**永久删**。风险控制三条：① 保留策略仍是"最近 `RETAIN.days` 天 ∪ 最新
   *   `RETAIN.newest` 个 ∪ 每家族最新 1 个"——**近期的快照永远在**；② 删前清单落 `~/.dsh` 留档；
   *   ③ 路径过 `f19-tmpwatch.js` 的 `isSafeSnapPath()` 护栏（只认那 6 个快照家族、必须恰好两层）。
   *
   * 原注释（2026-09-17 那版，照留）：L9 旧快照：默认**走回收站**（可复原）。
   *    ⚠️ 用户 2026-09-17 晚先说过"自己彻底删除吧，不然回收站不也越堆越大"，
   *       但**同一条消息的后半句就是"回收站就回收站吧。就这样。"** —— 于是**默认定成回收站**。
   *       永久删的那条路**留着可切**（把这里改成 true），护栏在 `f19-tmpwatch.js` 的 `isSafeSnapPath()`：
   *       只认那 6 个"快照家族"、路径必须恰好两层、每次删除留清单到 `~/.dsh`。
   *       换句话说：**要永久删是一行的事，但默认不去冒那个险** —— 快照是"写错了怎么退回去"的最后一道网。
   */
  l9PermanentDelete: false,
  /**
   * 检索/巡检时**按目录名跳过**的片段（`null` ＝ 用 `SKIP_DIR_HINTS`）。
   * 🔴 只在**档案根这一层**参与判定（见 `walk()` 的注释）；改这里能一次改掉"哪些顶层目录不进检索"。
   */
  skipDirHints: null,
  /**
   * **显式豁免**：命中跳过片段、但必须照扫的目录（相对档案根的路径，`\` 与 `/` 都认）。
   * 例：`L3-知识/本机实现件备份`
   */
  scanForcedDirs: null,
}

/** 日志轮转阈值：到 10 MB 就把当前这份改名成 `.1`（覆盖上一份 `.1`）⇒ 恒定 ≤ 30 MB。 */
const LOG_ROTATE_BYTES = 10 * 1024 * 1024

/**
 * 写日志。
 * `silent=true` 时**只写文件、不刷黑框** —— 黑框是给用户看的（只留关键几行），
 * 明细一律进 memoria.log 供我诊断。（2026-09-16：用户反馈重启时黑框"多了好多内容"）
 *
 * 🔴 **2026-10-21 加轮转**（用户问「日志如何清除，总不能让他无限写吧」）：
 *   实测那天 `memoria.log` 已经 **24.95 MB / 196,717 行** —— 原来这里是**无条件 append**，没有上限。
 *   现在 ≥ 10 MB 就把它改名成 `memoria.log.1`（**只留 2 份**，旧的 `.1` 直接被覆盖）。
 *   ⚠️ 只留两份就够：诊断要看的是"**最近发生了什么**"，不是半年前的流水。
 *   ⚠️ 轮转失败（文件被占用等）**绝不许影响写日志本身** —— 整段吞掉，照旧 append。
 */
export function log(msg, opt) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    try {
      if (statSync(LOG_FILE).size >= LOG_ROTATE_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`)
    } catch {
      /* 文件还不存在 / 改名失败 —— 都照旧往下写 */
    }
    appendFileSync(LOG_FILE, line)
  } catch {
    /* 日志失败不许阻塞 */
  }
  // 🔴 **2026-10-22 改了默认**（用户第三次指着控制台说「这些胡七八糟的，真的没法管管吗」）：
  //    **默认不打印**，只有显式 `{ show: true }` 才上控制台。
  //    从前的默认是"什么都打印"，于是每次启动有三十几行"自报工作量"糊满整个窗口 ——
  //    而那些东西**只在排查时有用**，全都在文件里。
  //    ⇒ 现在控制台只留**真的该让人看到的那几行**（启动就位 ＋ 出错了）。
  //    ⚠️ 这是一次语义翻转：以前写 `{silent:true}` 才静默，现在写 `{show:true}` 才出声。
  //       改的时候**所有老的 `silent:true` 依然无害**（它本来就只想静默，现在更静），不用回去清。
  // 🔴 **2026-10-22 修**：这里原来写 `if (opt && opt.show !== true) return` —— **逻辑写反了**。
  //    不传 `opt` 时 `opt` 是 `undefined` ⇒ `opt && …` 整个是 `undefined` ⇒ **假** ⇒ 不 return ⇒ **照样打印**。
  //    于是 0.81.17 那一版"控制台只留一行"**等于什么都没做**（用户 18:26 重启后截图，三十几行照旧）。
  //    教训：**"没测过不传参数"就是没测过**。现在改成显式判真：只有 `{show:true}` 才出声。
  if (!opt || opt.show !== true) return
  try {
    console.log(`[memoria] ${msg}`)
  } catch {
    /* 同上 */
  }
}

// ============================================================
// 「健康状态」—— 机器对机器的闭环（2026-10-21 加 · 用户定的架构原则）
// ============================================================
//
// 🔴 **原则**（用户原话）：**「能机器判的不给 AI 看」** ——
//   从前每个口子把结论"报给 AI"（"我扫了 133 份 / 判了 12 次"），于是我每轮都要重新判断"这算正常吗"。
//   现在倒过来：**口子把结论写成机读状态**，由**安全总监（F38）**汇总成一句；
//   全绿时谁都不打扰（只写日志），有红时只给 AI 一句"① … ② …"。
//
// 📐 **一行状态的格式（唯一口径）**：
//     { id: 'F5', at: <毫秒时间戳>, ok: <bool>, brief: '体检 0 错 · 提示 3' }
//   ⚠️ `brief` 是**给人看的一句摘要**（总监红的时候直接拼进那句话里），不是给程序解析的。
//   ⚠️ `at` 是**新鲜度**：考勤靠"这个 at 太久没变"判那个口子死了。

/** 健康状态目录（一个能力一个 `<id>.json`）。 */
export const HEALTH_DIR = join(HOME_DIR, 'health')

// ============================================================
// 🔴 **谁能进 `health/`（入选尺子 · 唯一一处）**
// ============================================================
//
// 用户 2026-10-22 定的（原话）：
//   「**一些一眼就能看出问题的就不用总监来管了**……织布机你落档总要用吧，用不成你不就知道了；
//     平尺你又不用，那他坏了也就丢那了；待办和工程这些都是咱们要用的，真要坏了眼睛就看到了」
//
// ⇒ **判据（就这一条）**：
//     **用了就知道坏没坏的 ⇒ 自己就是哨兵，不接。**
//     **平时不用 / 后台跑，坏了也没人看见的 ⇒ 才接。**
//
// 📋 **当前名单（7 个）**：
//     · **F2 作废口径** —— 不看就不知道有哪些作废的说法（`ok` 恒 true，只记条数，理由见该模块注释）
//     · **F5 体检** —— 按需跑，不跑就不知道档案坏没坏
//     · **F13 锚点** —— 一整月可以触发 0 次，坏了完全没动静
//     · **F19 清理** —— 后台回收；坏了要等磁盘涨起来才发现
//     · **F26 留意栏** —— 它不响就不知道有没有欠账
//     · **F27 引文对账** —— 产出只是报告末尾一个数字，我不逐条看
//     · **F34 考勤** —— 它本身就是监控者（盯"谁没来"）
//
// ❌ **明确不接（以及为什么）**：
//     · **F36 织布机 / F6 落笔** —— 落档时要用，用不成**当场就卡住**
//     · **F10 待办 / F35 工程** —— 要用，坏了**眼睛就看到了**
//     · **F4 检索 / F15 状态 / F16 面板 / F1 注入** —— 都在眼前
//     · **F30 门卫** —— 拦不拦、判不判，**当场就知道**（2026-10-22 从名单里撤掉）
//
// ⚠️ **别"全接"**：接得越多，"全绿"看着越可信，但每接一个都要付一次写盘 + 一次读；
//    而且**接"用了就知道的"那些是白付** —— 它们的坏，本来就在你手里那件事上露馅。
//    📌 要加新成员，先拿上面那条尺子量一遍，并把理由补进这份名单（**别只加不写**）。

/**
 * 上面那份名单的**机读版**（`health/` 里只认这几个 id）。
 *
 * 🔴 为什么要有它（2026-10-22）：`health/` 是**只写不清**的 —— 某个口子从名单里撤掉后，
 *   它留下的旧 `<id>.json` 会**一直躺在那儿**，总监照样读、照样算进"N 项"。
 *   门卫 F30 撤掉当天就撞上了：文件还在，总监还以为它在报。
 *   ⇒ **只认名单**，撤掉的自动忽略；将来真要清文件再单独清。
 */
export const HEALTH_IDS = ['F2', 'F5', 'F13', 'F19', 'F26', 'F27', 'F34']

/**
 * 写一行"我跑完了、结论是这样"的**机读**状态。
 * ⚠️ 原子写（先 `.tmp` 再 rename）：总监可能正在读，半截文件会让它 `JSON.parse` 炸。
 * ⚠️ 写不了（目录权限 / 磁盘满）**绝不影响主流程** —— 整段吞掉。
 *
 * 🔴 **2026-10-22 加第 4 参 `extra`**（`{ step?: number }`）—— 起因是一次**误报**：
 *   用户上午回来看到「安全总监心跳停了 580 分钟 —— 它可能已经死了」，而那 580 分钟
 *   正是**昨晚到现在没人用**的那段（没人说话 ⇒ 一步都没走 ⇒ 总监当然不写心跳）。
 *   **"没跑"被当成了"死了"** —— 判据缺一个"**这段时间机器动过没有**"的参照，
 *   所以现在带上 `step`（那一刻记下的步数）：考勤拿"**我走了几步、它没跟上**"判，而不是拿墙上的钟判。
 */
export function writeHealth(id, ok, brief, extra) {
  try {
    mkdirSync(HEALTH_DIR, { recursive: true })
    const p = join(HEALTH_DIR, `${id}.json`)
    const tmp = `${p}.tmp`
    const row = { id, at: Date.now(), ok: ok === true, brief: String(brief ?? '') }
    if (extra && typeof extra === 'object') Object.assign(row, extra)
    writeFileSync(tmp, JSON.stringify(row), 'utf8')
    renameSync(tmp, p)
  } catch {
    /* 报不上自己，也不许把调用者拖下水 */
  }
}

/** 读所有健康状态（总监用）。坏文件一律跳过，不抛。 */
export function readHealth() {
  const out = []
  try {
    for (const n of readdirSync(HEALTH_DIR)) {
      if (!n.endsWith('.json')) continue
      try {
        const j = JSON.parse(readFileSync(join(HEALTH_DIR, n), 'utf8'))
        if (j && typeof j.id === 'string' && typeof j.ok === 'boolean') out.push(j)
      } catch {
        /* 坏文件跳过（可能正被写；原子写之后不该出现，兜底而已） */
      }
    }
  } catch {
    /* 目录还不存在 ＝ 一个口子都还没报过 */
  }
  return out
}

// ============================================================
// 能力「干活计数」（2026-09-17 加 · 事件 E62 / 锚点 T199）
// ============================================================
//
// 只回答一个问题：**这个能力到底动过没有？**
// 档案里反复吃过"沉默 ≠ 正常"的亏（《总账》R26：哨兵只在出事时出声，于是"没出声"分不清
// 是"没问题"还是"它瞎了"）。启动自检只能报"它读到了什么"，**报不出"它这一程动过几次"**。
// 所以：**每个能力在真干活的那一刻自己记一笔**（纯内存，**不新增状态文件**），
// 由 `F7 落档闸门` 在回合结束时把"有变化的那一份"写进 `memoria.log`。
//
// 📌 判据（照 C 路调研那条）：**`kind === 'hook'` 的能力，若整场日志里从没出现过它的统计
//    → 就是"装了等于没装"**（与 `f7-gate.js` 删掉 G3 是同一条理由：看起来在跑、其实已死）。
export const CAP_STATS = new Map()

/** 记一笔"我干了一次活"。**绝不抛错** —— 计数坏掉不许影响任何主流程。 */
export function capTick(id, note = '') {
  try {
    const s = CAP_STATS.get(id) ?? { count: 0, lastAt: null, note: '' }
    s.count += 1
    s.lastAt = new Date().toISOString()
    if (note) s.note = String(note).slice(0, 80)
    CAP_STATS.set(id, s)
  } catch {
    /* 同上：计数器失败不阻塞 */
  }
}

/**
 * 工具调用时钟（2026-09-26 加 · 给考勤 F34 用）。
 *
 * 为什么必须单独一个：考勤要问门卫（F30）"**该判的那一次它判了吗**"，
 * 而"有没有发生工具调用"这个事实**必须独立于 F30 自己的计数** ——
 * 拿 F30 的计数当信号就成了同义反复（它没记＝它没调用，永远判不出"它瞎了"）。
 * 所以由 `noteToolCall()`（`tools/pre-execute` 是**每一次调用必经**的那个点）在这里 +1，
 * 考勤把两个数对一对：**这个涨了、F30 的计数没涨 ⇒ 门卫没在判**（＝部分失效）。
 * 纯内存、不新增状态文件，与 `CAP_STATS` 同一姿态。
 */
let toolCallsSeen = 0

/** `tools/pre-execute` 每次见到工具调用时 +1（由 `noteToolCall` 调）。 */
export function bumpToolCalls() {
  toolCallsSeen += 1
}

/** 这一程一共见过多少次工具调用（跨重启累计，与 `CAP_STATS` 的 `count` 同口径）。 */
export function toolCallsTotal() {
  return toolCallsSeen
}

/** 一行"谁干过几次"（只列动过的；没动过的不出现 —— 这本身就是信息）。 */
export function capReport() {
  try {
    const parts = []
    for (const [id, s] of CAP_STATS) {
      if (!s || s.count === 0) continue
      parts.push(s.note ? `${id}=${s.count}(${s.note})` : `${id}=${s.count}`)
    }
    return parts.join(' ')
  } catch {
    return ''
  }
}

export function readTextSafe(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** 目录下第一个「文件名里含 hint 且以 ext 结尾」的文件。找不到返回 null。 */
export function findByHint(dir, hint, ext = '.md') {
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.includes(hint) && e.name.endsWith(ext)) return join(dir, e.name)
    }
  } catch {
    /* 目录不存在等一律当"没找到" */
  }
  return null
}

export const rel = (p) => p.slice(CFG.archiveDir.length + 1)

// ============================================================
// 随包走的辅助脚本（2026-09-17）
// ============================================================
//
// 用户 2026-09-17 定的口径：**"所有跟梅莫莉亚相关的、由她管理的，都挪进插件里"**
// （前提：**档案不上传 —— 插件包里只放代码与骨架，不放任何一份用户的历史信息**）。
//
// 于是"改档 / 地图生成器 / 时间轴那几个脚本 / 两个动盘脚本"从 `E:\DeepSeek工具箱\`
// 搬进包内 `tools/`。但**本机仍在用的旧位置不能一夜消失**，所以这里只做一件事：
// **包内优先、工具箱兜底** —— 迁移期两边都在时用包内那份（单文件权威），
// 旧位置哪天清掉了也不影响（这正是"插件包自足"要的效果）。
export const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
export const TOOLS_DIR = join(PKG_DIR, 'tools')
// 🔴 2026-10-19：**旧的工具箱兜底路径已删** —— 迁移期结束，包内 `tools/` 已自足；
//    给别人的包里不该出现"只有这台机器才有"的路径（用户定的口径：**她自己的工具在她内部**）。

/**
 * 取一个辅助脚本的真实位置：**包内优先 → 额外目录 → null**。
 * @param {string} name 文件名（如 `改档.mjs`）
 * @param {string[]} extraDirs 额外的兜底目录
 */
export function toolPath(name, extraDirs = []) {
  const cands = [join(TOOLS_DIR, name), ...extraDirs.map((d) => join(d, name))]
  for (const p of cands) {
    try {
      if (existsSync(p)) return p
    } catch {
      /* 探测失败当"没有" */
    }
  }
  return null
}

/**
 * 按语义跳过的目录：证据备份层装的是原始证据（脚本/日志/CSV），
 * 里面的"作废"是证据原文；工具临时层是 .bak 所在地。
 * ⚠️ 2026-09-19 起这两个片段**只在档案根那一层**生效（顶层正好就是这两层）；判定与理由见 `shouldSkipDir()`。
 */
export const SKIP_DIR_HINTS = ['证据', '临时', '备份']

/**
 * 本次进程里**被跳过的目录**（绝对路径 → 命中的片段）。
 * 🔴 **它是"静默失效"的解药**：跳过这件事本身没错，错的是**跳了却不报告** ——
 *    于是"这份文件搜不到"永远查不出原因（2026-09-18 的五路审查把这一条列为三处静默失效之一）。
 *    记下来之后，`skippedDirs()` 能把它摆到状态面板上。
 */
const SKIPPED_DIRS = new Map()

/**
 * 被跳过的目录清单（路径解析成**相对档案根**的形式）。
 * ⚠️ 语义＝**最近一次从档案根开始的全档扫描**跳过了什么（`walk(CFG.archiveDir)` 会重置它）。
 */
export function skippedDirs() {
  return [...SKIPPED_DIRS.entries()]
    .map(([p, hint]) => ({ path: p, rel: rel(p), hint }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

/** 路径规范化成"相对档案根 + 反斜杠"的形态（豁免清单的比对口径）。 */
const normRel = (s) => String(s ?? '').replace(/\//g, '\\').replace(/^\.\\/, '').replace(/\\+$/, '')

/** 生效的跳过片段（配置优先，配置为空就用默认那份）。 */
function skipHints() {
  const h = CFG.skipDirHints
  return Array.isArray(h) && h.length > 0 ? h : SKIP_DIR_HINTS
}

/** 命中跳过片段、但被 `CFG.scanForcedDirs` 点名要扫的目录 → 不跳。 */
function isForcedScan(abs) {
  const list = Array.isArray(CFG.scanForcedDirs) ? CFG.scanForcedDirs : []
  if (list.length === 0) return false
  const r = normRel(rel(abs))
  return list.some((x) => normRel(x) === r)
}

/**
 * 这条目录该不该跳过？🔴 **只有档案根那一层**才按名字判（`parent !== CFG.archiveDir` 一律不跳）。
 *
 * 为什么（2026-09-19 实测后重做）：原来递归里**每一层**都按 `name.includes(h)` 跳，于是
 * "人随手起的中文目录名"只要带个"备份 / 临时 / 证据"，**整棵子树就从检索与巡检里消失**。
 * 真档案量过：命中的只有 3 个目录 —— 该跳的两个都在顶层（`L5-证据` / `L6-工具临时`），
 * 而 `L3-知识\本机实现件备份\` 是**误伤**：里面 3 份 .txt 历来没进过任何一次机械巡检。
 * 代价是"档案里再也不能有别的叫**备份**的目录" —— 这个隐性约束本身就是病根，所以改成看**层**，不看名字。
 */
function shouldSkipDir(abs, name, parent) {
  if (parent !== CFG.archiveDir) return false
  if (isForcedScan(abs)) return false
  const hit = skipHints().find((h) => name.includes(h))
  if (!hit) return false
  SKIPPED_DIRS.set(abs, hit)
  return true
}

/**
 * 走一遍档案，收 `.md` / `.txt`（**按语义跳过**顶层证据备份层与工具临时层）。
 *
 * ⚠️ 跳过记录是**累积**的，且在"从档案根开始扫"时重置 —— 语义＝**这一次全档扫描**跳过了哪些目录。
 * 若调用方传的是子目录，清单仍是上一次全档扫描的（没有任何调用方这么干，留个说明免得读错）。
 */
export function walk(dir, out = []) {
  if (dir === CFG.archiveDir) SKIPPED_DIRS.clear()
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (shouldSkipDir(p, e.name, dir)) continue
      walk(p, out)
    } else {
      const lower = e.name.toLowerCase()
      if (!lower.endsWith('.md') && !lower.endsWith('.txt')) continue
      if (lower.includes('.bak')) continue
      out.push(p)
    }
  }
  return out
}

/**
 * 档案**变了没有**的便宜信号（2026-09-19 加 · 待办"节流提到扫描前/共用缓存"）。
 *
 * 为什么需要：机械体检（`checkArchive()`）要把全档 **1.39 MB / 51 份**文档读好几遍，
 * 而它**每回合**都被闸门 G2 跑一次。原先唯一的省法是"5 分钟内不再跑"——那是个坏交易：
 *   · 省是省了，但"我刚把档案改坏"这件事**在 5 分钟内不会有人说**（漏报，档案最忌）；
 *   · 而 5 分钟一到，不管档案动没动都得整扫一遍。
 * 现在改成"**看档案本身变没变**"：`(相对路径, 大小, mtime)` 汇总成一个指纹 ——
 *   · 只需 `readdir` ＋ `stat`（几十毫秒级，**不读正文**）；
 *   · 档案一动指纹必变 → 立刻重算（**不漏报**）；没动 → 直接复用上次结论（**不空转**）。
 * 指纹带文件份数前缀，所以"新建/删除文档"也一定让它变。
 */
export function archiveFingerprint() {
  try {
    const files = walk(CFG.archiveDir).sort()
    const h = createHash('sha1')
    for (const f of files) {
      let stamp = '?'
      try {
        const st = statSync(f)
        stamp = `${st.size}|${st.mtimeMs}`
      } catch {
        /* stat 不到就当变了（宁可重算，不可误命中） */
      }
      h.update(`${rel(f)}|${stamp}\n`)
    }
    return `${files.length}:${h.digest('hex').slice(0, 16)}`
  } catch {
    return ''
  }
}

/** 跨层按文件名找一份文件（"时间轴""事件表""总览""总账"）。找不到返回 null。 */
export function findByName(hint) {
  const all = walk(CFG.archiveDir)
  // 🔴 2026-09-27：**优先级必须写死** —— ① 名字**就是**它（去掉扩展名）→ ② 名字**以它打头**
  //    （`待办-未完成事项.md`）→ ③ 才退到"名字里**含**它"。
  //    起因（真发生过）：待办那份叫 `待办-未完成事项.md`、住 `L4-施工`，而 `L3-知识` 里有一份
  //    `记录-2026-09-25-桌面规整与待办重排.md`；按"含它就返回"找，先撞上的是**那份记录** ⇒
  //    `dangan_todo` 一本正经地报"没有还开着的条目"—— **看起来一切正常，其实读错了文件**。
  //    ⚠️ 取"最后一段"改用 `baseOf()`（2026-09-29：原来这里自抄了一份 `split('\\').pop()`，
  //    被第 17 关当场拦下 —— 这条口径的唯一来源在本文件 `baseOf` 那一处）。
  return (
    all.find((f) => baseOf(f).replace(/\.(md|txt)$/i, '') === hint) ||
    all.find((f) => baseOf(f).startsWith(`${hint}-`) || baseOf(f).startsWith(`${hint}_`)) ||
    all.find((f) => f.includes(hint)) ||
    null
  )
}

/**
 * 🔴 「这份文件是不是**那张表的正主**」—— **唯一实现**（2026-10-14 · L2 降级派生 ④ C 轮收拢）。
 *
 * 为什么必须有它：`findByName()` 的三档里**第三档是「名字里含它就返回」**（由来见上面那段注释），
 *   而 L2 一删，`findByName('时间轴')` / `('事件表')` 就会撞上**别处名字含这两个词**的文件：
 *     · `L3-知识/…/记录-时间轴独有事项（2026-10-14 收拢）.md` —— **实测**：体检拿 T 号判据去量它，
 *       报出「T 号缺：7、9、11…」两条**假提示**；
 *     · `L8-施工归档/工程-事件表合并-分批清单.md`；
 *     · 还有 `L6-工具临时/改档快照/<时刻>/L2-数据/事件表.md` 这类**备份副本** —— 撞上它最坏是**往备份里写**。
 * ⇒ 凡「拿这个名字去找**正文 / 找行 / 找表**」的地方，都先过这一关。
 *
 * ⚠️ 它**不是新判据** —— `findByNameUnique()`（2026-09-29 加）就是为同一个病；这里只是把
 *   `lib/f9-commit.js` 里那份**局部**实现（原名 `isTableOf`）收成唯一来源，再让消费方接过来。
 * ⚠️ 判据里**不能用「路径在 L2-数据 下」**：测试夹具把这两份造在**档案根**下，那样判会把
 *   夹具整批判成「没有 L2」、把 5 个测试当场弄红（2026-10-14 实测踩过）。
 */
export function isL2Doc(p, name) {
  if (typeof p !== 'string' || !p) return false
  if (/改档快照|L6-工具临时|memoria-dumps/.test(p)) return false
  const b = baseOf(p).replace(/\.(md|txt)$/i, '')
  return b === name || b.startsWith(`${name}-`) || b.startsWith(`01-${name}`)
}

/**
 * 同 `findByName`，但**要求命中唯一**：多于一个 ⇒ 返回 `null`（并记一行日志）。
 *
 * 🔴 **给"按名字现算路径"用**（2026-09-29 加）：宁可**认不出**（调用方会报"待补"），
 *    也**不许静默认错** —— 2026-09-27 的 `T688` 就是"含它就返回"先撞上同名那份、
 *    **读错了文件却报"干净"**。凡"拿这个名字去找正文 / 找行"的地方，都该走这一档。
 */
export function findByNameUnique(hint) {
  const all = walk(CFG.archiveDir)
  const tiers = [
    (f) => baseOf(f).replace(/\.(md|txt)$/i, '') === hint,
    (f) => baseOf(f).startsWith(`${hint}-`) || baseOf(f).startsWith(`${hint}_`),
    (f) => f.includes(hint),
  ]
  for (const hit of tiers) {
    const found = all.filter(hit)
    if (found.length === 1) return found[0]
    if (found.length > 1) {
      log(`按名字找「${hint}」命中 ${found.length} 个（${found.map((f) => baseOf(f)).join(' · ')}）⇒ 认不出，不猜`, {
        silent: true,
      })
      return null
    }
  }
  return null
}

// 🔴 2026-10-15：**`countT()` / `maxT()` / `countE()` 三个函数整块删除** —— 它们读的是时间轴 / 事件表，
//    而 L2 已删 ⇒ 三个都退化成**恒返回 `-1` 的空壳**（2026-10-14 那一轮已把它们改成直接 `return -1`）。
//    用户口径："**这是结构变化**"，不是"暂时查不到" ⇒ W8：直接删干净。
//    ⚠️ 调用方已全部同步：`f7-gate`（G1 退役残留 → 删读数，`dumpVerdict` 传常量）· `f22` / `f23`（改常量 `-1`）
//      · `index.js`（不再转发）· `f15-status`（面板那几格直接写「（已删）」）。

/**
 * 构造一条独立的插件快照消息。
 * 结构照 @deepseek-ai/dsh-llm 的 createUserMessage：{ role, content, source, id }。
 *
 * 🔴 `source.kind` —— **2026-09-28 适配 DSH 0.1.7 的会话格式 v4**：
 *   v4 的准入规则是「**保留未知归属、拒绝已退休的 `plugin` 包装器**」
 *   （`dsh-session-format-v3-to-v4`：`kind` 必须是非空字符串且 **≠ `'plugin'`**，
 *   否则写盘时抛 `format v4 message requires a producer-owned source kind` —— 会话当场坏掉）。
 *   ⇒ 改用**生产者自有**的名字 `'dsh-memoria'`（官方插件也这么干：
 *     `@deepseek-ai/dsh-system-prompt` → `runtime-context`）。其余 `plugin` / `form` 字段照留。
 *   ⚠️ `realUserMessages()` 只认 `kind === 'user'` ⇒ 改它**不会被误当成真实用户消息**（不会循环注入）。
 *   ⚠️ 旧名 `'plugin'` 在 0.1.5 及更早能用、在 0.1.7 被**明确拒收** —— 别改回去。
 */
export function createPluginMessage(text) {
  return {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-memoria', plugin: 'dsh-memoria', form: 'snapshot' },
  }
}

export function sessionIdOf(agent) {
  const id = agent?.session?.id ?? agent?.session?.header?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * 会话 id 的**短形式**（只给日志看）。
 * ⚠️ 2026-09-16 晚修：原来直接 `sid.slice(0, 8)` —— 而会话 id 的形态是 `session-<uuid>`，
 * 头 8 个字符**正好就是 `session-`**，于是日志里每个会话都长一个样，等于没记。
 * 现在**先剥掉 `session-` 前缀**再截；实在剥不出东西就取尾部。
 */
export function shortSid(sid) {
  const s = String(sid ?? '?')
  const t = s.replace(/^session-/, '')
  if (t.length >= 6) return t.slice(0, 8)
  return s.length <= 8 ? s : s.slice(-8)
}

export function isSubagent(agent) {
  return agent?.session?.header?.origin === 'subagent'
}

/** 真实用户消息（跳过工具结果、插件通知、模型消息）。 */
export function realUserMessages(messages) {
  return (messages ?? []).filter((m) => m?.source?.kind === 'user')
}

/** 北京时间字符串（注入内容里自证"这份是什么时候生成的"；拿不到就退回 ISO）。 */
export function nowCN() {
  try {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  } catch {
    return new Date().toISOString()
  }
}

/**
 * 北京时间拆成时间轴要的那两格：`{ ymd: 'YYYY-MM-DD', hm: 'HH:MM', md: 'MM-DD' }`。
 *
 * ⚠️ **2026-09-16 深夜用户纠正**："**不能写今晚几点几分，要写 xx 年 xx 月 xx 日，不然谁知道今晚是那一晚**"
 * → 从此**新行一律带年份**（`2026-09-16 22:11`）。`md` 仍返回，是为了兼容"存量那些只有月日的行"。
 */
export function nowStamp() {
  const two = (n) => String(n).padStart(2, '0')
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const get = (t) => (parts.find((x) => x.type === t) || {}).value ?? ''
    const y = get('year')
    const md = `${get('month')}-${get('day')}`
    const hm = `${get('hour')}:${get('minute')}`
    if (/^\d{4}$/.test(y) && /^\d{2}-\d{2}$/.test(md) && /^\d{2}:\d{2}$/.test(hm)) {
      return { ymd: `${y}-${md}`, md, hm, year: y }
    }
  } catch {
    /* 走下面的退路 */
  }
  const d = new Date()
  const md = `${two(d.getMonth() + 1)}-${two(d.getDate())}`
  return { ymd: `${d.getFullYear()}-${md}`, md, hm: `${two(d.getHours())}:${two(d.getMinutes())}`, year: String(d.getFullYear()) }
}

/**
 * 本插件**当前是哪一版代码**（2026-09-16 晚加；**2026-09-17 晚重做，见下**）。
 *
 * 为什么需要它：插件改完必须**重启控制台**才生效，而"到底生效没有"以前只能**间接猜**。
 *
 * 🔴 **2026-09-17 晚重做 —— 这个信号原来会在最要紧的场合撒谎**：
 *   它原来只在**模块第一次装载**那一刻算一次（`STAMP_AT_LOAD`），之后终身不变。
 *   于是**热重载 / 只开新会话（宿主进程没换）**时，跑的是新代码、报的还是最初那份的指纹 ——
 *   当天实测：磁盘现算 `ad7a7a34`，日志却报 `1a23df87`（试了 5 种算法都对不上 →
 *   它对应的是**改动前**的磁盘内容）。**一个"用来判断新代码上没上"的信号，自己先失准了。**
 *   现在拆成两件事：
 *     · `codeStamp()`  → **每次调用都现算磁盘**（＝"这一刻磁盘上是哪一版"）
 *     · `LOADED_STAMP` → 模块装载那一刻的值（＝"最初装载的是哪一版"）
 *   `apply()` 把两者一起打出来：**相同＝这次确实装载了磁盘上最新那份**；
 *   不同＝**中途改过代码而模块没重新装载**（那时跑的是 `LOADED_STAMP` 那份）。
 */
const stampOf = () => {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const names = readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .sort()
    const h = createHash('sha1')
    for (const f of names) h.update(readFileSync(join(dir, f)))
    let version = '?'
    try {
      version = JSON.parse(readTextSafe(join(dir, '..', 'package.json'))).version ?? '?'
    } catch {
      /* 读不到就写 ?，不影响启动 */
    }
    return { version: `v${version}`, modules: names.length, fp: h.digest('hex').slice(0, 8) }
  } catch (e) {
    return { version: '?', modules: 0, fp: `err:${String(e).slice(0, 20)}` }
  }
}

/** 模块**装载那一刻**的指纹（终身不变；与"现算"对照用）。 */
export const LOADED_STAMP = (() => {
  const s = stampOf()
  return `${s.version} · ${s.modules} 模块 · 指纹 ${s.fp}`
})()

/** **磁盘现状**的指纹（每次调用现算）。 */
export function codeStamp() {
  const s = stampOf()
  return `${s.version} · ${s.modules} 模块 · 指纹 ${s.fp}`
}

/** 装载值 vs 磁盘值：不一致＝中途改过代码、模块没重新装载。一致返回 null。 */
export function stampDrift() {
  const disk = codeStamp()
  return LOADED_STAMP === disk ? null : { loaded: LOADED_STAMP, disk }
}

// ============================================================
// 口径的**唯一来源**（2026-09-28 加 · 止在源头）
// ============================================================
//
// 🔴 **为什么要加**：这两条口径原本各自散在好几处**独立的实现**里 ——
//    · **留底文件名格式**（`归档留底-<8位>.md` / `压缩留底-<8位>.md`）：散在 **5 处**
//      （`lib/f22-compact-dump.js` 生成器 ＋ 第 160 行的认名 · `lib/f29-verified.js` 第 61/166/187/264 · `lib/skeleton-repair.js` 的 `DUMP_RE`）；
//    · **扫"该管的层目录"**：散在 **4 处**（`tools/引用去路径.mjs` · `tools/引用改写.mjs` · `tools/档案结构地图.mjs` · `lib/f17-map.js`）。
//    一处改了、别处不跟 ⇒ **假警报**（地图报 35 条死指针）或更糟：**静默漏读**。
//    今天一天撞了 11 次同类（见 `E323`）；口径扫（`tools/口径扫.mjs`）当场把它们扫成两组。
//    ⇒ 从此**只在这里写一次**；`lib/scope-registry.js` 登记它，F30 第 17 关**在落笔之前**拦住"再抄一份"。

/** 留底文件名：`归档留底-<8位>.md` / `压缩留底-<8位>.md`（**唯一来源**）。 */
export const DUMP_NAME_RE = /^(归档留底|压缩留底)-([0-9A-Za-z]{8})\.md$/

/** 路径的**最后一段**（basename）—— **唯一实现**。
 *  🔴 2026-09-28：从 `lib/idx-scope.js` 收拢到这儿 —— `f13` / `f30` / `f32` 三处各抄了一份（口径扫扫出来的），
 *     而它们**都已经** import 本模块 ⇒ 放这儿只需加个名字、不用新增 import。
 *     `lib/idx-scope.js` 仍在**转出**它（别处 `import { baseOf } from './idx-scope.js'` 照旧能用）。 */
export const baseOf = (f) => String(f ?? '').split(/[\\/]/).pop() // 口径-已确认：唯一来源自身的实现（2026-09-29 修：原来只按 \ 分，遇到正斜杠路径会**静默返回整串**——真踩到过）；别处不许再写

/**
 * **去掉路径末尾的斜杠**（`"a/b/"` → `"a/b"`）—— 🔴 唯一实现（2026-10-11 收拢）。
 * 原来 `lib/f32-archives.js` 的 `baseName()` 与 `tools/引用改写.mjs` 各写了一份 `/[\\/]+$/`（口径扫扫出来的）。
 */
export const stripTrailingSlash = (p) => String(p ?? '').replace(/[\\/]+$/, '')

/**
 * **去掉文本 / 文件名末尾的 `.md` / `.txt`** —— 🔴 唯一实现（2026-10-11 收拢）。
 * 原来 `lib/f9-commit.js`（两处）· `lib/loom-patterns.js` · `tools/施工层归档.mjs` 各写了一份 `replace(/\.md$/i, '')`
 * （口径扫扫出来的）。去**扩展名**与去**目录**是两件事：目录走 `baseOf()`，扩展名走这里。
 */
export const stripExt = (s) => String(s ?? '').replace(/\.(md|txt)$/i, '')

/** 是不是留底文件名。 */
export const isDumpName = (name) => DUMP_NAME_RE.test(String(name ?? ''))

/** 从留底文件名里取 `{ kind, sidShort }`；认不出返回 `null`。 */
export function parseDumpName(name) {
  const m = DUMP_NAME_RE.exec(String(name ?? ''))
  return m ? { kind: m[1] === '归档留底' ? 'archive' : 'compact', sidShort: m[2] } : null
}

/** "**证据 / 临时**"层 —— 扫层时要跳过的那两类（**唯一实现**）。
 *  🔴 2026-09-28：原来 `scanLayerDirs` 里内联一份、`tools/引用去路径.mjs` 又写了一份 `SKIPPED_RE`；
 *     口径扫把这两处扫成一组 ⇒ 收进这里。 */
export const SKIPPED_LAYER_RE = /证据|临时/

/**
 * 扫"档案根下 `L<号>-*` 的层目录" —— **唯一实现**。
 *
 * @param {string} archiveDir 档案根
 * @param {{skipEvidence?:boolean}} [opts]
 *   `skipEvidence`：跳过名字含"证据 / 临时"的层。**默认跳**（引用类工具是多数用法）；
 *   要**列层结构**的（地图 / 面板）显式给 `{ skipEvidence: false }`。
 * @returns {string[]} 层目录名，按层号排序
 */
export function scanLayerDirs(archiveDir, opts = {}) {
  const skipEvidence = opts?.skipEvidence !== false
  let ents = []
  try {
    ents = readdirSync(archiveDir, { withFileTypes: true })
  } catch {
    return []
  }
  return ents
    .filter((e) => e.isDirectory() && /^L\d+-/.test(e.name)) // 口径-已确认：这里就是 scanLayerDirs 自身的实现（唯一来源），别处不许再写
    .map((e) => e.name)
    .filter((n) => (skipEvidence ? !SKIPPED_LAYER_RE.test(n) : true))
    .sort((a, b) => {
      const na = Number((a.match(/^L(\d+)/) || [])[1]) || 0
      const nb = Number((b.match(/^L(\d+)/) || [])[1]) || 0
      return na - nb || a.localeCompare(b)
    })
}

/**
 * 哪些层**已经有子目录**了 —— 给体检的「**结构假设对账**」用（2026-09-28 加 · 用户点名的第二条哨兵）。
 *
 * 🔴 **为什么需要它**：今天那场病的根子是"**结构变了、没人告诉代码**" —— L3 分进 9 个子目录之后，
 *    四个消费方还在按"平层"扫它 ⇒ 地图假报 **35 条死指针**、索引一重生成就会**掉 35 份正文**。
 *    这条**只提示、不判错**：把"这层有子目录"摆到我眼前，让写"扫层"代码的人先看见
 *    （判据一句话：**凡扫这一层，都必须能进子目录**）。
 *
 * @returns {Array<{layer:string, subs:string[]}>} 只回**有子目录**的层
 */
export function layersWithSubdirs(archiveDir) {
  const out = []
  for (const layer of scanLayerDirs(archiveDir, { skipEvidence: false })) {
    try {
      const subs = readdirSync(join(archiveDir, layer), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
      if (subs.length) out.push({ layer, subs })
    } catch {
      /* 读不到就算了 */
    }
  }
  return out
}

/**
 * 🔴 2026-10-20：**L4 里"可以归档了"的文件名标记**（写在文件名末尾、扩展名之前）。
 *
 * 为什么搬到这儿：`tools/施工层归档.mjs` 原来自己写一份 `MARKS`；现在**留意栏也要判同一件事**
 * （"L4 有几份标了已办完、还没归档"）⇒ 两处各写一份就是 R26 那一族（同一口径两处实现）。
 * ⇒ **唯一来源在这里**，两边都 import 它。**加新标记只改这一行**。
 */
export const L4_ARCHIVE_MARKS = ['（已办完）', '（已作废）']
