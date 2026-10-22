/**
 * 索引的「范围 ＋ 写法」—— **唯一判据**（2026-09-27 建）。
 *
 * 🔴 **为什么要单独一份**：这条判据原本有**三份副本** —— `lib/f5-check.js`（体检）·
 *    `lib/f17-map.js`（面板 / 地图数据）· `tools/档案结构地图.mjs`（地图生成器）。
 *    2026-09-27 索引改成**两栏**（去掉"什么时候该读"那一栏）＋ 名字改成**光文件名**（重名才带层）
 *    之后，三份**各坏一处**，而且**全都一声不吭**：
 *      · 地图生成器 → 报"索引漏登记 **51** 个"（其实一个都没漏）
 *      · `f17` → L1 八份全被报成"未登记"（键对不上：它拿"层\文件"比光文件名）
 *      · `f5` → 体检多报 1 份（它要求索引登记"**索引自己**"）
 *    ⇒ **判据只留这一份，三个消费方都 import 它。以后改索引的写法，只改这一份。**
 *
 * ⚠️ 这里是"机械可判"的部分；索引**内容**怎么写由《层与命名》§三 ③ 定，不在这份里。
 */

/** 只有这三层**该**被索引逐文件登记（`L5-证据` / `L6-工具临时` 按规矩不登记，别对它们喊"漏登记"）。 */
export const INDEXED_LAYER = /^L[123]-/

/** 这几份**故意不进索引**：索引是它自己 · 地图是机器生成的。 */
export const IDX_SKIP = /^(地图-档案结构（机器生成）|索引)\.md$/

/** 二进制件（图片 / 压缩包 / PDF…）不进索引 —— 它们没有"一句话"可读。 */
export const BIN_SKIP = /\.(png|jpe?g|gif|webp|avif|bmp|ico|zip|7z|rar|pdf|xlsx?|docx?|mp[34]|wav|ogg)$/i

/** 光文件名（索引的新写法：只写文件名，**重名才带层**）。
 *  ⚠️ 2026-09-28：**定义已收进 `lib/common.js`**（f13 / f30 / f32 都已 import 它）。
 *  🔴 这里必须**同时 import 进来**（本文件的 `SHOULD_REG()` 自己就要用它）——
 *     只写 `export { baseOf } from './common.js'` 的话，**本文件内部并没有这个绑定**，
 *     `SHOULD_REG` 会当场 `ReferenceError`（2026-09-28 就是这么让 5 个测试齐挂的）。 */
import { baseOf } from './common.js'
export { baseOf }

/** 该不该被索引逐文件登记（＝不是上面那两类）。**判"漏登记"之前先过这一关。** */
export const SHOULD_REG = (f) => {
  const b = baseOf(f)
  return !IDX_SKIP.test(b) && !BIN_SKIP.test(b)
}

/**
 * 解析《索引》那张表 → `Map<键, { what, when }>`。
 *
 * 🔴 **两栏与三栏都认**（三栏是旧写法"文件 / 内容 / 何时读"；两栏是新写法"文件 / 一句话"），
 *    并且**按 basename 再存一份** —— 这样下游无论拿"层\文件"还是光文件名都取得到。
 * ⚠️ **只有这一处实现**：别在下游再写一遍行正则（今天三处副本就是这么坏的）。
 */
export function parseIndexRows(text) {
  const out = new Map()
  // 🔴 2026-10-14（对抗审查 F13）：**当前这张表的「文件名在第几格」** —— 由**表头行**说了算（见下）。
  let nameCol = -1
  for (const line of String(text ?? '').split(/\r?\n/)) {
    // 🔴 2026-10-14：**不再假设"第一格就是文件名"** —— L3 节现在多一列「时间」（用户选 A 方案要的，
    //    销账判据读它）。改成：整行切格 ⇒ 取**第一个反引号包着的那一格**当文件名，它右边两格是 what / when。
    //    ⚠️ 这正是《施工手册》§二「改被别处读的格式之前，先列出谁在读它」的现场教训：
    //    我改完格式**没同步这里**，`f36-loom.mjs` 当场抓出"索引漏登记 2 份"。
    // ⚠️ 切格**必须认转义**（对抗审查 2026-10-14 抓出的 🔴）：渲染器 `cell()` 把内容里的 `|` 转成 `\|`，
    //    按裸 `|` 切会把那一格切断 ⇒ 文件名带竖线时**整行解析不出** ⇒ 体检报「索引漏登记」＝机械错
    //    ＝**G2 拦死**，而且每次重织再丢一次、**不收敛**。
    const cells = []
    {
      const body = line.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '')
      let cur = ''
      for (let i = 0; i < body.length; i++) {
        if (body[i] === '\\' && body[i + 1] === '|') { cur += '|'; i++; continue }  // 转义的竖线 ⇒ 收进本格
        if (body[i] === '|') { cells.push(cur.trim()); cur = ''; continue }
        cur += body[i]
      }
      cells.push(cur.trim())
    }
    // 🔴 2026-10-14（对抗审查 F13）：**列位由表头说了算** —— 原来那句是"找第一个整格被反引号包住的格"，
    //    而「一句话」那格**常常整格就是** `` `某文件.md` `` ⇒ 会把 what 当文件名
    //    （实测：现档案 L3 只有 9 行的反引号在第 0 格、其余 106 行在第 1 格 —— 歧义真实存在）。
    //    表头认不出来时才退回老办法。
    if (cells.some((c) => c === '文件')) nameCol = cells.indexOf('文件')
    // 表头说了算；**但那一格不是反引号包的文件名时就退回老办法**
    //（这样"表头行""分隔行"自己也会被自然跳过 —— 不动原来的行为）。
    const byHead = nameCol >= 0 ? cells[nameCol] ?? '' : ''
    const fi = /^`[^`]+`$/.test(byHead) ? nameCol : cells.findIndex((x) => /^`[^`]+`$/.test(x))
    if (fi < 0) continue
    const key = cells[fi].slice(1, -1).trim().replace(/\//g, '\\')
    const val = { what: cells[fi + 1] ?? '', when: cells[fi + 2] ?? '' }
    out.set(key, val)
    const base = baseOf(key)
    if (base && base !== key && !out.has(base)) out.set(base, val)
  }
  return out
}

/** 某个"层\文件"在索引里登记过没有 —— **带层的与光文件名的两种写法都认**。 */
export const registeredIn = (idx, f) => idx.has(f) || idx.has(baseOf(f))

/**
 * 🔴 **这一份到底该不该有三行自述** —— 唯一判据（别处不许再判一遍）。
 * 《层与命名》§三 ③（用户 2026-09-23 拍板）：**人写的文档（L3 / L4）**才用那三行；
 * **数据文件（L2 两张表）**由表头表达、**不加块引用**；**入口类**开头写"读序 / 这层有什么"；
 * `L1-必读` 层正文开头本来就有等价自述（且必读层要短）。
 * ⇒ 所以**只对 `L3-知识` 根下的非入口文档**要那三行；**可执行件**（`.ps1`/`.mjs`/`.cmd`）不算 ——
 *    它们用 `ABOUT: 一句话` 那条口径（`.ps1`/`.cmd` 必须纯 ASCII，写不了中文块引用）。
 *
 * 🔴 2026-10-11 收拢：`lib/f8b-index-doc.js` 与 `tools/档案索引.mjs` 原各有一份**逐字相同**的实现
 *    （后者的注释自己还写着"唯一判据（别处不许再判一遍）"）。口径扫扫出来后收进这里，两边都 import。
 */
export const NEED_INTRO = (layer, name) =>
  layer === 'L3-知识' && !/^_/.test(name) && /\.(md|txt)$/i.test(name)

/** 表格单元格：把**没转义的竖线**转义掉（自述里带 `|` 会把表格撑成多列 —— 2026-09-27 被体检抓到过一次）。 */
export const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** 《索引》自己那一行里的"重生成"提示 —— 一处写、两处用（`lib/f8b-index-doc.js` 与 `tools/档案索引.mjs`）。 */
export const INDEX_REGEN_HINT =
  "> 🚦 重生成：`node ~\\.dsh\\plugins\\dsh-memoria\\tools\\档案索引.mjs --apply`（先干跑看差异）· 或走织布机：`dangan_weave pattern:'索引'`。"

/**
 * 🔴 **《索引》文件头第 3 行**（那句"本文件由机器生成"）—— **唯一一份，两处渲染都引用它**。
 *
 * 为什么要有它：`lib/f8b-index-doc.js` 的 `renderIndexDoc()` 与 `tools/档案索引.mjs` 的 `render()`
 * **是两份独立的渲染实现**（正文口径一致，但**头文案那一行不同**）。两边各写各的 ⇒
 * `档案索引.mjs` 拿自己产出的短文案去比一个由 lib 版写出来的文件 ⇒ **永远报"差 1 行"**。
 * 2026-10-11 由用户那条线查出「那行文案硬写在插件代码里、两者打架」，这里收成一处。
 *
 * ⚠️ 更彻底的做法是**把两份渲染合并成一份**（`档案索引.mjs` 直接调 `renderIndexDoc()`）——
 *    那属于大改，留待专门一轮；本条只解决"文案打架"。
 */
export const INDEX_HEAD_LINE =
  '> 🤖 **本文件由机器生成**（`tools/档案索引.mjs` · 生成逻辑在 `lib/f8b-index-doc.js`）—— 素材是**每份文件开头那三行自述**。'
