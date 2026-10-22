// ============================================================
// F32 · 多档案馆（馆列表 / 当前馆 / 切换 / 重命名 / 新建 / 别馆只读 / 工地馆）
// ============================================================
//
// 用户 2026-09-23 在面板上要的三个能力（地图栏里那条「档案馆」）：
//   ① 点按钮切馆　② 重命名　③ 末尾 ＋ 新建
//
// 两条**硬边界**（都是用户当天亲口定的）：
//   · **别馆只读**："这不是让你看到，是**保护另一个馆**。你在这个馆就只能改你这个馆和电脑，
//     但不能碰另一个馆。这是对的。不然你乱改另一个馆，那不炸了。" ⇒ 判据 `inOtherArchive()`。
//   · **工地馆不拦**（2026-09-24 用户定的工作流：他在老馆讨论好结构 → 切到新馆改结构）：
//     "这样我切回去不就会疯狂报错" —— 新馆是**工地**，半成品是常态，闸门**只提醒不拦**。
//     判据 `isLabArchive()`（原话出处：实验馆口径"闸门不做拦截，仅提醒。不然自动化怎么完成"）。
//
// 存哪：`~/.dsh/memoria-archives.json`（插件自己的文件）
//   · 存**馆列表** ＋ **上次选中的馆**（`active`）
//   · 🔴 **绝不写 `cordis.patch.yml`** —— 手改运行中的它把控制台弄死过 8 次 / 6 起。
//
// 🔴 **当前馆是可回退的**（2026-09-24 用户："记住上次选择的盘。并且可以回退。确实不错。
//    总不能卡死在老盘里。万一有错误字符给指挥台卡死就不好了"）：
//    `pickStartupArchive()` 按 **上次那个 → 配置默认 → 馆表里任何一个健康的** 顺序挑，
//    一个健康的都没有才留在原地，并**明说回退到了谁、为什么**。
//
// 为什么"切馆"改 `CFG.archiveDir` 一处就够（2026-09-23 核实）：
//   · 全档 **75 处**引用**全是运行时属性读**，没有一处启动时缓存成常量；
//   · 子进程（`改档.mjs` / `recycle-del.ps1`）由调用处用 `env.GAI_DANG_ROOT = CFG.archiveDir` 带过去。
//   ⚠️ 唯一要跟着动的是**按馆的缓存** —— 见 `bumpEpoch()`。
//
// 🔴 **本文件不自己写档案**：它只改 `CFG` 与自己的馆表；
//    建馆一律走 F20 的 `bootstrap()`（默认干跑、只补缺、绝不覆盖）。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { CFG, HOME_DIR, baseOf, log, normPath, stripTrailingSlash } from './common.js'
import { archiveState, bootstrap } from './f20-init.js'

/** 馆表落点（插件自己的文件，不是档案里的东西）。
 *  ⚠️ `MEMORIA_ARCHIVES_FILE` 是**给测试隔离用的** —— 测试绝不能写到真馆表上。 */
const FILE = process.env.MEMORIA_ARCHIVES_FILE || join(HOME_DIR, 'memoria-archives.json')

/** 上次"启动选馆"干了什么（面板要显示"回退了、为什么"）。 */
let lastStartup = null

/** 🔴 **唯一来源在 `common.js`**（2026-10-07 提上去：`f22` 判留底的馆归属也要用同一把尺子）。
 *  Windows 上路径比大小写没意义 —— 一律小写比。 */
const norm = normPath

/** `p` 是不是在 `root` 之下（含等于 root 本身）。 */
export function within(p, root) {
  const a = norm(p)
  const b = norm(root)
  return a === b || a.startsWith(b + '/')
}

/** 当前馆根 —— **唯一权威就是 `CFG.archiveDir`**；馆表里的名字只是"给它起的名"。 */
export function currentDir() {
  return resolve(CFG.archiveDir)
}

/** 切馆时把"按馆的缓存"全部作废（各缓存点比对 `CFG.archiveEpoch`）。 */
export function bumpEpoch() {
  CFG.archiveEpoch = Number(CFG.archiveEpoch || 0) + 1
  return CFG.archiveEpoch
}

/**
 * 读馆表。**读不到 / 坏了 → 退回"只有当前馆"**（绝不因为读不到就不干活）。
 * 当前馆**一定在表里**（不在就补进去 —— 老配置下第一次开面板就是这样）。
 */
export function loadArchives() {
  const cur = currentDir()
  let arr = []
  let savedActive = ''
  let err = ''
  try {
    if (existsSync(FILE)) {
      const j = JSON.parse(readFileSync(FILE, 'utf8'))
      if (typeof j?.active === 'string') savedActive = j.active
      if (Array.isArray(j && j.archives)) {
        arr = j.archives
          .filter((a) => a && a.name && a.dir)
          .map((a) => ({ name: String(a.name), dir: resolve(String(a.dir)), kind: a.kind === 'lab' ? 'lab' : 'main' }))
      }
    }
  } catch (e) {
    err = String((e && e.message) || e)
    arr = []
  }
  if (!arr.some((a) => norm(a.dir) === norm(cur))) {
    arr.unshift({ name: baseName(cur) || '当前馆', dir: cur, kind: 'main' })
  }
  return { ok: !err, err, active: cur, savedActive, archives: arr }
}

/** 原子写（临时名 + 改名：不会被读到写了一半的文件）。`active` ＝ 上次选中的馆。 */
function saveArchives(list, active) {
  try {
    const dir = dirname(FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = FILE + '.tmp'
    const body = { at: new Date().toISOString(), active: String(active || currentDir()), archives: list }
    writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
    renameSync(tmp, FILE)
    return true
  } catch (e) {
    log(`F32 馆表写不进去：${(e && e.message) || e}`)
    return false
  }
}

/** 目录名（给"还没名字的当前馆"起个默认名）。 */
function baseName(p) {
  // 2026-10-11：去尾斜杠走唯一来源（`lib/common.js` 的 `stripTrailingSlash`），不再自抄 `/[\\/]+$/`
  return baseOf(stripTrailingSlash(p)) // 半身：baseOf 也是唯一来源（2026-09-28 收）
}

/**
 * 这个目录像不像一座**能用的**档案。
 *
 * ⚠️ **不直接用 `archiveState().kind === 'ok'`**（2026-09-24 实测踩到）：它的判据里写死了**具体层名**
 * ⇒ 老馆（旧层名）会被判"不健康"（2026-10-14 补注：L2 那层已删，这个例子仍然成立 —— 要害是"写死层名"，不是某一层的名字）。
 * `pickStartupArchive()` 会把它跳过（"记住上次 + 坏了回退"这一套在新旧馆并存时**会失灵**）。
 * 所以这里只认**入口文件** —— 那是"这是一座档案"的最小铁证，**新旧层名都成立**。
 */
function healthy(dir) {
  try {
    if (!existsSync(dir)) return false
    if (existsSync(join(dir, '从这开始读.txt'))) return true
    return archiveState(dir).kind !== 'missing'
  } catch {
    return false
  }
}

/** 面板要的清单。 */
export function archivesForPanel() {
  const st = loadArchives()
  return {
    ok: st.ok,
    err: st.err || '',
    active: st.active,
    startup: lastStartup,
    items: st.archives.map((a) => ({
      name: a.name,
      dir: a.dir,
      kind: a.kind,
      active: norm(a.dir) === norm(st.active),
      // ⚠️ **两个字段都要给**（2026-09-24 修）：目录"在不在"与"是不是一座能用的档案"是两件事。
      //    第一版只给了 `healthy`，而面板读的是 `it.exists` ⇒ undefined 当假 ⇒
      //    **好好的馆也被显示成"（目录不在）"**（不报错，只是静静地显示成另一回事）。
      exists: existsSync(a.dir),
      healthy: healthy(a.dir),
    })),
  }
}

/**
 * 🏗 **当前馆是不是"工地馆"** —— 工地上的半成品是常态，闸门**只提醒不拦**（F7 读这个）。
 * 老馆（自动补进表的那条）默认 `main` ⇒ 照旧严。
 */
export function isLabArchive() {
  const st = loadArchives()
  const cur = currentDir()
  const hit = st.archives.find((a) => norm(a.dir) === norm(cur))
  return !!hit && hit.kind === 'lab'
}

/**
 * 🔴 **启动选馆**（2026-09-24 用户："记住上次选择的盘。并且可以回退。总不能卡死在老盘里"）。
 *
 * 顺序：**上次那个 → 配置默认 → 馆表里任何一个健康的**；一个健康的都没有 ⇒ 留在原地并明说。
 * @returns {{ok:boolean, dir:string, why:string, changed:boolean}}
 */
export function pickStartupArchive() {
  const st = loadArchives()
  const cur = resolve(CFG.archiveDir)
  const cands = []
  if (st.savedActive) cands.push({ dir: resolve(st.savedActive), why: '上次记着的那个馆' })
  cands.push({ dir: cur, why: '配置里的默认馆' })
  for (const a of st.archives) cands.push({ dir: a.dir, why: `馆表里的「${a.name}」` })
  for (const c of cands) {
    if (!existsSync(c.dir)) continue
    if (!healthy(c.dir)) continue
    const changed = norm(c.dir) !== norm(cur)
    const r = { ok: true, dir: c.dir, why: c.why, changed }
    return r
  }
  return { ok: false, dir: cur, why: '一个健康的馆都没找到（先留在配置里的那个）', changed: false }
}

/** 装配 F32：启动那一刻**按记忆选馆**（记忆里那个坏了就回退），并自报工作量。 */
export function registerF32(ctx) {
  void ctx // 清单装配要求收 ctx；这一件不需要挂任何钩子
  try {
    const r = pickStartupArchive()
    if (r.ok && r.changed) {
      const from = currentDir()
      CFG.archiveDir = r.dir
      bumpEpoch()
      lastStartup = { at: new Date().toISOString(), from, to: r.dir, why: r.why, fellBack: true }
      log(`F32 启动选馆：**从上一次那个换到了** ${r.dir}（${r.why}）；原先是 ${from}`)
    } else if (r.ok) {
      lastStartup = { at: new Date().toISOString(), from: r.dir, to: r.dir, why: r.why, fellBack: false }
    } else {
      lastStartup = { at: new Date().toISOString(), from: cur0(), to: cur0(), why: r.why, fellBack: true }
      log(`F32 启动选馆：⚠️ ${r.why} —— **别的馆可能都不健康**，先别乱切`)
    }
    log(`F32 ${reportF32()}`, { silent: true })
  } catch (e) {
    log(`F32 启动选馆出错（放行，照旧用配置里那个）: ${(e && e.message) || e}`)
  }
}

/** 出错时兜底拿当前馆（`CFG` 一定在）。 */
function cur0() {
  try {
    return currentDir()
  } catch {
    return ''
  }
}

/** 切馆（**人点的** —— 用户 2026-09-23 拍板："换馆由人点，AI 不自己切"）。 */
export function switchTo(key) {
  const want = String(key ?? '').trim()
  if (!want) return { ok: false, why: '没说切到哪个馆' }
  const st = loadArchives()
  const hit = st.archives.find((a) => norm(a.name) === norm(want) || norm(a.dir) === norm(want))
  if (!hit) return { ok: false, why: `馆表里没有「${want}」` }
  if (!existsSync(hit.dir)) return { ok: false, why: `这个馆的目录不在了：${hit.dir}` }
  const from = currentDir()
  if (norm(from) === norm(hit.dir)) return { ok: true, from, to: hit.dir, name: hit.name, same: true }
  CFG.archiveDir = hit.dir
  bumpEpoch()
  saveArchives(st.archives, hit.dir)
  log(`F32 换馆：${from} → ${hit.dir}（名「${hit.name}」${hit.kind === 'lab' ? ' · 🏗 工地馆' : ''}）`)
  return { ok: true, from, to: hit.dir, name: hit.name, kind: hit.kind }
}

/** 重命名：🔴 **只改显示名，磁盘目录一个字不动**（一动目录就要"搬文件"，那是最危险的一类活）。 */
export function renameArchive(oldName, newName) {
  const from = String(oldName ?? '').trim()
  const to = String(newName ?? '').trim()
  if (!from) return { ok: false, why: '没说改哪一个馆' }
  if (!to) return { ok: false, why: '新名字是空的' }
  const st = loadArchives()
  const hit = st.archives.find((a) => norm(a.name) === norm(from))
  if (!hit) return { ok: false, why: `馆表里没有「${from}」` }
  if (st.archives.some((a) => a !== hit && norm(a.name) === norm(to))) return { ok: false, why: `已经有叫「${to}」的馆了` }
  hit.name = to
  const ok = saveArchives(st.archives, st.active)
  if (ok) log(`F32 改名：「${from}」→「${to}」（🔴 只改显示名，磁盘目录一个字没动：${hit.dir}）`)
  return { ok, why: ok ? '' : '馆表写不进去', name: to, dir: hit.dir, dirUntouched: true }
}

/** 新建馆：**复用 F20 的 `bootstrap()`**（只补缺、绝不覆盖）。新建的馆是**工地馆**。 */
export function createArchive(name, dir) {
  const nm = String(name ?? '').trim()
  if (!nm) return { ok: false, why: '新馆得有个名字' }
  if (/[\\/:*?"<>|]/.test(nm)) return { ok: false, why: '名字里不能有 \\ / : * ? " < > | 这些字符' }
  const st = loadArchives()
  if (st.archives.some((a) => norm(a.name) === norm(nm))) return { ok: false, why: `已经有叫「${nm}」的馆了` }
  const target = resolve(String(dir || '').trim() || join(HOME_DIR, `DeepSeek档案-${nm}`))
  if (st.archives.some((a) => norm(a.dir) === norm(target))) return { ok: false, why: `已经有馆指着这个目录了：${target}` }
  // 🔴 **禁止嵌套**（用户 2026-09-24 提的：两个馆**并排放**没问题，**套着放**会出事）——
  //    外层馆做全档扫描时会把里层的六层当成自己的文件扫进来（体检当场爆"索引漏登记"），
  //    "别馆只读"的判据也会在同一批路径上两边打架。
  for (const a of st.archives) {
    if (within(target, a.dir)) return { ok: false, why: `不能建在别的馆**里面**（「${a.name}」：${a.dir}）` }
    if (within(a.dir, target)) {
      return { ok: false, why: `这个位置**套着**已有的馆「${a.name}」（${a.dir}）—— 两个馆不能套着放；**并排放没问题**` }
    }
  }
  const r = bootstrap({ dir: target, apply: true })
  if (!r.ok) return { ok: false, why: `建馆出错：${r.errors.join('；')}`, dir: target }
  st.archives.push({ name: nm, dir: target, kind: 'lab' })
  const saved = saveArchives(st.archives, st.active)
  log(`F32 建馆（🏗 工地馆）：「${nm}」→ ${target}（建 ${r.created.length} 份 / 补 ${r.dirs.length} 个目录）`)
  return {
    ok: true,
    why: saved ? '' : '馆建好了，但馆表没写进去（下次开面板它会自己补回来）',
    name: nm,
    dir: target,
    kind: 'lab',
    created: r.created.length,
    dirs: r.dirs.length,
    state: archiveState(target),
  }
}

/**
 * 🔴 **别馆写保护**（用户 2026-09-23 原话就是它的来由）。
 *
 * 返回 `null` ＝ 不归这条管（放行）；返回 `{name, dir}` ＝ **这是别的馆，禁写**。
 *
 * 三种情形：
 *   · 路径在**当前馆**里 → 放行（本来就能改）
 *   · 路径在**别的馆**里 → 拒（这就是"保护另一个馆"）
 *   · 路径**不在任何馆里**（电脑其它地方、`%TEMP%`…） → 放行（用户："可以改你这个馆**和电脑**"）
 */
export function inOtherArchive(p) {
  if (typeof p !== 'string' || !p.trim()) return null
  const n = resolve(p)
  if (within(n, currentDir())) return null
  const st = loadArchives()
  for (const a of st.archives) {
    if (within(n, a.dir)) return { name: a.name, dir: a.dir }
  }
  return null
}

/** 启动自报工作量（《施工手册》第 4 步：沉默 ≠ 正常）。 */
export function reportF32() {
  const st = loadArchives()
  const cur = st.archives.find((a) => norm(a.dir) === norm(st.active))
  const kind = cur && cur.kind === 'lab' ? ' · 🏗 工地馆' : ''
  return `${st.archives.length} 个馆（当前「${(cur && cur.name) || '?'}」${kind}）${st.ok ? '' : ' ⚠️ 馆表读不动'}`
}

/** 给测试用：馆表在哪。 */
export function archivesFile() {
  return FILE
}

/** 给测试用：把"启动选馆"的记忆清掉（免得测试之间互相影响）。 */
export function resetStartupMemory() {
  lastStartup = null
}
