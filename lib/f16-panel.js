// ============================================================
// F16 · 网页面板的数据通道（**host 半边**）—— 2026-09-17 建 · 事件 E72
// ============================================================
//
// 这一半只干两件事：把 `buildStatusData()` 送进浏览器、把 `assets/` 里的形象图当资源发出去。
// **真正的界面在 `lib/client.js`**（浏览器半边，走 `__ModuleLoader__` 那条路）。
//
// 四条接线（照 `dsh-hermes-memory` 的做法 —— 那都是踩坑换来的）：
//   ① 🔴 **webServer 可能比本插件晚激活** → 用 `ctx.get('webServer')` **轮询等它**（500ms，最多 30s）。
//      **没有 webServer 的环境（TUI / headless）就自动放弃面板层** —— 面板缺席，**其它能力照常**
//      （这也是为什么**不**把 `webServer` 写进 `inject`：写了就等于"没有它我就不激活"，那会在 headless 下把整个插件拖死）。
//   ② 路由一律用 `ctx.effect(...)` 包起来 → fiber 装卸时**自动注销**，不留野路由。
//   ③ 资源名走**白名单**（4 张图），且**每张图各注册一条精确路由** ——
//      既防路径穿越，也不依赖"webServer 支不支持 prefix 路由"这种没核实的事。
//   ④ **动作类**（会改状态的）路由一律 `POST`，且**先验参数再动手**（F32 的 `/memoria/archives` 就是第一条）。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { log } from './common.js'
import { buildStatusData } from './f15-status.js'
import { buildMapData } from './f17-map.js'
import { openItems, pausedTodoItems } from './f10-todo.js'
// 工程（F35 · 2026-09-26 加）：抽屉里那一节「工程」的数据 —— **另一份文件**（`工程-清单.md`）。
// 2026-10-01 加 `pausedProjects`：面板「待办」窗格那条二级菜单里的"暂缓工程"。
import { projectSummary, pausedProjects } from './f35-project.js'
import { archivesForPanel, createArchive, renameArchive, switchTo } from './f32-archives.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, '..', 'assets')

export const ROUTE_STATE = '/memoria/state'
/** 档案馆地图（F17）：面板**主区**的数据 —— 分层 ＋ 分室 ＋ 对账 ＋ 快照对比。 */
export const ROUTE_MAP = '/memoria/map'
/** 待办（F10）：面板那个"待办 N ▾"抽屉 —— 每条带"卡在哪 / 怎么算结 / 档案行号"。 */
export const ROUTE_TODO = '/memoria/todo'
/**
 * 多档案馆（F32）—— 面板那条「档案馆」栏：**列馆 · 切馆 · 改名 · 新建**。
 * ⚠️ 这是**第一条会改状态**的路由（前三条都是只读），所以只收 `POST`。
 */
export const ROUTE_ARCHIVES = '/memoria/archives'
export const ROUTE_ASSET = '/memoria/asset/'
/** 客户端挂上后**报个到** —— 浏览器侧的回执（只看服务器半边是看不出她挂没挂上的）。 */
export const ROUTE_HELLO = '/memoria/client-hello'

/** 允许发出的资源（白名单：既是安全边界，也是"有哪些图"的清单）。 */
export const ASSET_WHITELIST = [
  'memoria-idle.webp', // 待机（手交叠、笔记本合上）
  'memoria-idle-half.webp', // 待机 · 眨眼半闭帧
  'memoria-idle-closed.webp', // 待机 · 眨眼闭眼帧
  'memoria-busy.webp', // 工作中（动笔写）
  'memoria-show.webp', // 展示面板（举起笔记本）
  'memoria-show-closed.webp', // 展示面板 · 眨眼闭眼帧
  'memoria-show-half.webp', // 展示面板 · 眨眼半闭帧
  'memoria-sheet.webp', // 三视图（**备用**：这张是"参考图"、不是悬浮形象，没做抠底）
]

/** 读一张图（**只认白名单里的名字**）。 */
export function readAsset(name) {
  const f = String(name ?? '')
  if (!ASSET_WHITELIST.includes(f)) return null
  try {
    return readFileSync(join(ASSETS, f))
  } catch {
    return null
  }
}

/** 面板 JSON（测试可直接调它）。 */
export function panelState() {
  const d = buildStatusData()
  // F32：馆列表 ＋ 当前馆（面板那条「档案馆」栏读它；读不到也照样把状态发出去）
  try {
    d.archives = archivesForPanel()
  } catch (e) {
    d.archives = { ok: false, err: String((e && e.message) || e), active: '', items: [] }
  }
  return { ok: true, data: d }
}

/** 地图 JSON（F17）—— 面板主区。 */
export function panelMap() {
  return { ok: true, data: buildMapData() }
}

/** 待办 JSON（F10）—— 面板那个抽屉；`rel` 路径给人看，`line` 供去档案里对原文。
 *
 * 🔴 **2026-09-26 加 `projects`（F35）**：抽屉里在待办那三节**下面**多一节「工程」。
 *   用户当天："**待办是待办，工程是工程，这两个不是一回事**……**不允许将他们混为一谈**"
 *   ＋"**工程也是需要我在面板上能直接看到的**"。
 *   ⚠️ **不新开路由、不新开工具** —— 就挂在这条已有的待办通道上（用户要的是"同一个界面、下面加一节"）。
 *   ⚠️ 它读的是**另一份文件**：找不到 / 读不到 → 给一份空的（`file:''`），**不让整条通道失败**
 *      （"工程清单还没有"不是错，老档案里本来就没有这份文件）。
 */
export function panelTodo() {
  const { file, items } = openItems()
  let projects = { file: '', count: 0, limits: null, items: [] }
  try {
    projects = projectSummary()
  } catch (e) {
    log(`F35 工程清单读不到（面板那一节留空，待办照发）: ${e}`)
  }
  // 🔴 **2026-10-01 加 `paused`**：面板「待办」窗格里那条二级菜单的数据 ——
  //    用户当天："**暂缓的工程和待办都不在梅莫莉亚的面板里显示，我需要他们能被显示。
  //    或许不用显示在第一级，可以做一个二级菜单放进去。**"＋"**做完的不要显示了**"。
  //    ⇒ 两份来源：**待办的"等条件·搁置"** ＋ **工程的"等拍板/等前置"**；`[归档]` 一律不进。
  //    ⚠️ **失败了不让整条通道失败**（与上面 projects 同一个姿态）。
  let paused = []
  try {
    for (const it of pausedTodoItems().items) {
      paused.push({ from: '待办', section: it.section, line: it.line, item: it.item, why: it.why, goal: it.goal })
    }
  } catch (e) {
    log(`待办的"暂缓"一节读不到（面板那条二级菜单少一半，其余照发）: ${e}`)
  }
  try {
    for (const p of pausedProjects()) {
      paused.push({ from: '工程', section: p.section, line: p.line, item: p.item, why: p.why, goal: p.goal })
    }
  } catch (e) {
    log(`工程的"暂缓"一节读不到（面板那条二级菜单少一半，其余照发）: ${e}`)
  }
  return {
    ok: true,
    data: {
      at: new Date().toISOString(),
      file: file ? String(file).replace(/\\/g, '/') : '',
      count: items.length,
      items: items.map((it) => ({ section: it.section, line: it.line, item: it.item, why: it.why, goal: it.goal })),
      projects,
      paused,
    },
  }
}

/**
 * 多档案馆（F32）的动作口 —— **列馆 / 切馆 / 改名 / 新建**。
 *
 * 判据（三条都由 `f32-archives.js` 现算，这里只做参数透传）：
 *   · `switch` —— 馆表里有这个馆、且它的目录还在 ⇒ 改 `CFG.archiveDir`（＋作废按馆的缓存）
 *   · `rename` —— **只改显示名，磁盘目录一个字不动**
 *   · `create` —— 走 F20 的 `bootstrap()`（只补缺、绝不覆盖）
 * @param {{action?:string, name?:string, to?:string, dir?:string}} body
 */
export function panelArchiveAction(body) {
  const b = body && typeof body === 'object' ? body : {}
  const act = String(b.action || '')
  let r
  if (act === 'switch') r = switchTo(b.name || b.dir || '')
  else if (act === 'rename') r = renameArchive(b.name || '', b.to || '')
  else if (act === 'create') r = createArchive(b.name || '', b.dir || '')
  else r = { ok: false, why: `不认这个动作：${act || '（空）'}` }
  try {
    r.archives = archivesForPanel()
  } catch (e) {
    r.archives = { ok: false, err: String((e && e.message) || e), items: [] }
  }
  return r
}

/** 读一个 POST 的 JSON body（读不到就当空对象 —— 判据在动作里，不在这儿）。 */
async function readJson(req) {
  let raw = ''
  try {
    for await (const chunk of req) raw += chunk
  } catch {
    /* 读不到 body 也无妨 */
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

/**
 * 把路由挂到一个 webServer 上（`wsrv` 作为参数传进来 —— 方便单测，不必真起服务）。
 * @returns {number} 注册了几条路由
 */
export function mountPanel(ctx, wsrv) {
  let n = 0
  const json = (res, code, value) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  // ① 状态数据
  ctx.effect(() =>
    wsrv.register({
      kind: 'exact',
      path: ROUTE_STATE,
      handler: (_req, res) => {
        try {
          json(res, 200, panelState())
        } catch (e) {
          json(res, 200, { ok: false, error: String(e && e.message ? e.message : e) })
        }
      },
    }),
  )
  n += 1

  // ①-b 档案馆地图（F17）—— 面板的**主区**：分层 ＋ 分室 ＋ 对账 ＋ 快照对比。
  // ⚠️ 一次请求要遍历档案目录（63 份正文 + 几百个子目录文件，实测几十毫秒），所以**不并进 state**：
  //    面板打开时只拉 state（轻），切到地图/展开时才拉它。
  ctx.effect(() =>
    wsrv.register({
      kind: 'exact',
      path: ROUTE_MAP,
      handler: (_req, res) => {
        try {
          json(res, 200, panelMap())
        } catch (e) {
          json(res, 200, { ok: false, error: String(e && e.message ? e.message : e) })
        }
      },
    }),
  )
  n += 1

  // ①-c 待办（F10）—— 那个"待办 N ▾"抽屉。**按需拉**（不点就不读待办文件）。
  ctx.effect(() =>
    wsrv.register({
      kind: 'exact',
      path: ROUTE_TODO,
      handler: (_req, res) => {
        try {
          json(res, 200, panelTodo())
        } catch (e) {
          json(res, 200, { ok: false, error: String(e && e.message ? e.message : e) })
        }
      },
    }),
  )
  n += 1

  // ①-d 多档案馆（F32）—— 面板那条「档案馆」栏。**唯一一条会改状态的路由**（所以只收 POST）。
  ctx.effect(() =>
    wsrv.register({
      kind: 'exact',
      path: ROUTE_ARCHIVES,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, why: '这条只收 POST' })
        try {
          const body = await readJson(req)
          const r = panelArchiveAction(body)
          if (r && r.ok) log(`F32 面板动作「${body && body.action}」：${r.name || body.name || ''}`)
          json(res, 200, r)
        } catch (e) {
          json(res, 200, { ok: false, why: String(e && e.message ? e.message : e) })
        }
      },
    }),
  )
  n += 1

  // ② 形象图（每张一条精确路由，不依赖 prefix 支持）
  for (const name of ASSET_WHITELIST) {
    ctx.effect(() =>
      wsrv.register({
        kind: 'exact',
        path: ROUTE_ASSET + name,
        handler: (_req, res) => {
          const buf = readAsset(name)
          if (buf === null) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
          }
          // ⚠️ 2026-10-18：原来 `max-age=3600`（缓存 1 小时）⇒ 换图后普通刷新看不到新图，
          //    被当成"抠图没抠干净"排查了半天。图只有 ~100KB，改成 no-cache（允许 304）就够。
          const type = name.slice(-4).toLowerCase() === '.png' ? 'image/png' : 'image/webp'
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store, must-revalidate' })
          res.end(buf)
        },
      }),
    )
    n += 1
  }

  // ③ **客户端报到**（2026-09-17 加 · 起因正是"重启后她没出现"那一次）：
  //    以前只看得到"服务器这半边挂上了"，**看不到浏览器那半边到底挂上没有** ——
  //    而那次真因恰恰是浏览器侧**静默返回**（`ctx.get('slots')` 拿到 undefined 就 return）。
  //    现在：她挂上后会 POST 一声，**我在 `memoria.log` 里就能看见"客户端报到 ✔"**。
  ctx.effect(() =>
    wsrv.register({
      kind: 'exact',
      path: ROUTE_HELLO,
      handler: async (req, res) => {
        let raw = ''
        try {
          for await (const chunk of req) raw += chunk
        } catch {
          /* 读不到 body 也无妨 */
        }
        let note = ''
        let say = '**客户端报到**：悬浮窗已挂上 ✔'
        try {
          const j = JSON.parse(raw || '{}')
          note = [j.at, j.ua].filter(Boolean).join(' · ')
          // 🔴 2026-10-20：**失败也来报到**（`mounted:false` ＋ `why`）—— 原来只认"挂上了"那种，
          //    于是"面板没出现"这件事在 host 日志里**永远看不见**。现在两种都记，且用不同的字样。
          if (j && j.mounted === false) {
            say = `**客户端报到**：悬浮窗**没挂上** ✘${j.why ? `（${j.why}）` : ''} —— 面板不会出现，但 host 侧能力都还在`
          }
        } catch {
          note = String(raw || '').slice(0, 120)
        }
        log(`${say}${note ? `（${note}）` : ''}`)
        json(res, 200, { ok: true })
      },
    }),
  )
  n += 1

  return n
}

/** 装配 F16：等 webServer 出现，然后挂路由（**没有就安静缺席**）。 */
export function registerF16(ctx) {
  const tryMount = () => {
    let wsrv
    try {
      wsrv = ctx.get('webServer')
    } catch {
      wsrv = undefined
    }
    if (!wsrv || typeof wsrv.register !== 'function') return false
    try {
      const n = mountPanel(ctx, wsrv)
      // ⚠️ 原来是 `${n - 1} 张形象图` —— 加了地图/待办两条数据路由之后，这个数**不再是形象图张数**
      //    （2026-09-17 实测日志写成"+ 7 张形象图"，而实际只有 4 张，另外 3 条是数据通道）。
      //    日志宁可写清分开的数，也不要一个"看起来对、其实混着算"的数。
      log(
        `面板数据通道已挂上：${ROUTE_STATE} · ${ROUTE_MAP} · ${ROUTE_TODO} · ${ROUTE_ARCHIVES}（F32 多馆，收 POST） · ` +
          `${ASSET_WHITELIST.length} 张形象图（${ROUTE_ASSET}…）共 ${n} 条路由`,
      )
    } catch (e) {
      log(`面板路由注册失败（面板缺席，其它能力照常）: ${e}`)
    }
    return true
  }

  if (tryMount()) return

  // webServer 的激活链依赖 webStartup，可能晚于本插件 → 轮询等（照 hermes 的做法）
  const WAIT_MS = 500
  const WAIT_MAX = 30_000
  let waited = 0
  const timer = setInterval(() => {
    waited += WAIT_MS
    if (tryMount()) {
      clearInterval(timer)
      return
    }
    if (waited >= WAIT_MAX) {
      clearInterval(timer)
      log('等了 30 秒没等到 webServer（TUI / headless？）—— **网页面板缺席，其它能力照常**')
    }
  }, WAIT_MS)
  try {
    if (typeof timer.unref === 'function') timer.unref() // 别拖住进程退出
  } catch {
    /* 老 Node 没有 unref 也无妨 */
  }
}
