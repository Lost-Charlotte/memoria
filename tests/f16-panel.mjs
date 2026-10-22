/**
 * F16 · 网页面板的数据通道（host 半边）。跑法：node tests/f16-panel.mjs
 *
 * 这一半只干三件事：送状态数据、送**地图与待办**、送形象图。所以断言就盯三处：
 *   ① **白名单是安全边界**（路径穿越 / 任意文件读取必须被挡）；
 *   ② **路由数量与形状对**（3 条数据 + 每张图一条 exact —— 不依赖"webServer 支不支持 prefix"这种没核实的事）；
 *   ③ **handler 真吐得出来**（假 res 收字节，验 Content-Type 与体长）。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const { CFG } = await import('../lib/common.js')
const { ASSET_WHITELIST, ROUTE_ASSET, ROUTE_HELLO, ROUTE_MAP, ROUTE_STATE, ROUTE_TODO, mountPanel, panelMap, panelState, panelTodo, readAsset } =
  await import('../lib/f16-panel.js')

const root = makeArchive('f16', {
  '从这开始读.txt': '入口\n',
  'L1-必读/00-必读-铁律.md': '# 铁律\n',
  '01-时间轴-我们做过什么.md': '| 等级 | 编号 | 时间 | 发生了什么 |\n|---|---|---|---|\n| ○ | **T1** | 2026-09-17 10:00 | 甲 |\n',
  '01-事件表-我们做过什么.md': '| E号 | 事件名 | 时间跨度 | 状态 | 锚点 |\n|---|---|---|---|---|\n| E1 | **甲** | 2026-09-17 | 🔄 进行中 | T1 |\n',
})
CFG.archiveDir = root

console.log('')

// ============================================================
// 一、白名单＝安全边界
// ============================================================
check('白名单里的 4 张图都读得到（真字节）', ASSET_WHITELIST.every((n) => (readAsset(n)?.length ?? 0) > 1000))
check('🔴 路径穿越被挡（`../package.json`）', readAsset('../package.json') === null)
check('🔴 路径穿越被挡（拼在合法名后面也一样）', readAsset('memoria-idle.png/../../package.json') === null)
check('🔴 反斜杠路径穿越也被挡', readAsset('..\\package.json') === null)
check('不在白名单里的名字一律读不到', readAsset('index.js') === null && readAsset('随便.webp') === null)
check('空 / 非字符串也读不到（不炸）', readAsset('') === null && readAsset(null) === null && readAsset(123) === null)

// ============================================================
// 二、面板数据：形状对、且"缺段不拖垮"
// ============================================================
const st = panelState()
check('`panelState()` 返回 `{ ok, data }`', st.ok === true && st.data !== null && typeof st.data === 'object')
const KEYS = ['at', 'run', 'archive', 'check', 'gate', 'caps', 'sentinels', 'budget', 'todo', 'lastInject', 'problems']
check(`data 里 11 个字段都在（缺：${KEYS.filter((k) => !(k in st.data)).join('/') || '无'}）`, KEYS.every((k) => k in st.data))
check('这份样本档案读得出体检段（不是 null）', st.data.check !== null && typeof st.data.check.errors === 'number')
check('`problems` 是数组（缺段会记在这儿，而不是整屏失败）', Array.isArray(st.data.problems))
check('面板数据不喂镜头：`at` 是给人看的时间串', typeof st.data.at === 'string' && st.data.at.length > 10)

// ============================================================
// 三、路由：数量 / 形状 / 真吐字节
// ============================================================
const routes = []
const wsrv = {
  register(cfg) {
    routes.push(cfg)
    return () => {}
  },
}
const ctx = {
  effect(fn) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  },
}
const n = mountPanel(ctx, wsrv)
const EXPECT_ROUTES = 3 + ASSET_WHITELIST.length + 2 // 状态 + 地图 + 待办 + 每张图 + 档案馆 + 客户端报到
check(`挂了 ${EXPECT_ROUTES} 条路由（状态 ＋ 地图 ＋ 待办 ＋ 每张图一条 ＋ 客户端报到）`, n === EXPECT_ROUTES && routes.length === n)
check('地图路由是 /memoria/map（面板主区的数据）', routes.some((r) => r.path === ROUTE_MAP))
check('待办路由是 /memoria/todo（那个抽屉）', routes.some((r) => r.path === ROUTE_TODO))
check('状态路由是 /memoria/state', routes.some((r) => r.path === ROUTE_STATE))
check('🔴 **有"客户端报到"那条**（2026-09-17 加：浏览器侧挂没挂上，服务器这半边看不出来）', routes.some((r) => r.path === ROUTE_HELLO))
check('每张图各有一条精确路由（不赌 prefix 支持）', ASSET_WHITELIST.every((name) => routes.some((r) => r.path === ROUTE_ASSET + name)))
check('全是 `kind: exact`', routes.every((r) => r.kind === 'exact'))
check('每条都带 handler', routes.every((r) => typeof r.handler === 'function'))

const mkRes = () => ({
  code: 0,
  headers: null,
  body: null,
  writeHead(code, headers) {
    this.code = code
    this.headers = headers
  },
  end(b) {
    this.body = b
  },
})

const stateRes = mkRes()
routes.find((r) => r.path === ROUTE_STATE).handler({}, stateRes)
const parsed = JSON.parse(stateRes.body)
check('状态路由真吐出 JSON（ok=true · 200）', stateRes.code === 200 && parsed.ok === true)
check('状态响应不许被缓存（`Cache-Control: no-store`）', String(stateRes.headers['Cache-Control']).includes('no-store'))

// ---- 地图（F17）：面板**主区**那条通道 ----
const mapRes = mkRes()
routes.find((r) => r.path === ROUTE_MAP).handler({}, mapRes)
const mp = JSON.parse(mapRes.body)
check('地图路由真吐出 JSON（ok=true）', mapRes.code === 200 && mp.ok === true)
// ⚠️ **层数不写死**（2026-09-26 改）：层清单现在**从档案根现算**（`layersOf()`）——
//    测试沙箱里没有真档案，所以这里只查"它是个数组、字段齐"。旧断言写死 `=== 5`，
//    比的其实是那个**写死的常量**、跟档案无关：真档案加了 `L4-施工`，它照样"通过"。
check('地图把各层发出来了（面板主区靠它渲染）', Array.isArray(mp.data.layers))
check(
  '地图带了七间"分室"（写入口 / 闸门 / 档案馆 / 总控 / 哨兵 / 读用工具 / 钩子）',
  Array.isArray(mp.data.rooms) && mp.data.rooms.map((r) => r.room).join(',') === '写入口,闸门,档案馆,总控,哨兵,读用工具,钩子',
)
// 地图顶上那一行"检查"与「闸门」页都读 `state.gates` —— 它必须真的发得出来（2026-09-25 加）。
check(
  '状态里带了闸门表（面板「闸门」那一页的数据源）',
  Array.isArray(st.data.gates && st.data.gates.specs) && st.data.gates.specs.length === 2,
)
check(
  '闸门表的运行时读数在位（两套各自的模式）',
  typeof st.data.gates.f30Mode === 'string' && typeof st.data.gate.mode === 'string',
)
check(
  '🔴 样本档案没有索引也没有地图快照 → **如实记进 problems**（读不到就说读不到，不假装没事）',
  Array.isArray(mp.data.problems) && mp.data.problems.length >= 2 && mp.data.snapshot.exists === false,
)

// ---- 待办（F10）：那个抽屉 ----
const todoRes = mkRes()
routes.find((r) => r.path === ROUTE_TODO).handler({}, todoRes)
const td = JSON.parse(todoRes.body)
check('待办路由真吐出 JSON（ok=true）', todoRes.code === 200 && td.ok === true)
check('样本里没有待办文件 → 如实报"没有"（不是假装 0 条就完事）', td.data.file === '' && td.data.count === 0 && Array.isArray(td.data.items))
check('`panelMap` / `panelTodo` 直调也一致（路由只是外壳）', panelMap().ok === true && panelTodo().ok === true)

const imgRes = mkRes()
routes.find((r) => r.path === ROUTE_ASSET + ASSET_WHITELIST[0]).handler({}, imgRes)
check('图路由真吐出图片字节（>50 KB）', imgRes.code === 200 && imgRes.body && imgRes.body.length > 50000)
check(
  '🔴 吐的是**真 WebP**（`RIFF`＋`WEBP`）—— 换图格式时最容易忘的就是这个头',
  imgRes.body.slice(0, 4).toString('ascii') === 'RIFF' && imgRes.body.slice(8, 12).toString('ascii') === 'WEBP',
)
check('图的 Content-Type 是 image/webp', String(imgRes.headers['Content-Type']).includes('image/webp'))
check('图**不许**浏览器缓存出旧图（2026-10-18 改 no-store：换图/换批次都不吃旧缓存）', String(imgRes.headers['Cache-Control']).includes('no-store'))

done()
