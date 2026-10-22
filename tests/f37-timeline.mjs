// F37 · 时间轴两个读法（`lib/f37-timeline.js`）—— 2026-10-15（用户当天的设想）
// 跑法：node tests/f37-timeline.mjs
//
// 断言对着桩子里的四条判据：
//   ① 抽取：多写法（标准 / 加粗 / 含糊 `22:5x` / 只有时刻继承日期 / 只有日期 / 非法时刻）
//   ② 关键词锚：**文件名命中优先**（正文里提到它只是"路过"）
//   ③ 时间锚：定位到第一个 ≥ 它的点
//   ④ 查不到 ⇒ missing ＋ 退回最近几条（不空手、不假装）
// ⚠️ 只读：样本档案现造在 temp 里、跑完删（harness 管）。
import { pathToFileURL } from 'node:url'
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()
const root = makeArchive('timeline', {
  'L3-知识\\记录-甲.md': [
    '# 记录 · 甲',
    '- 2026-10-14 18:35：标准写法',
    '- 2026-10-14 **18:41**：加粗夹在中间',
    '- 2026-10-14 22:5x：含糊写法',
    '- 22:34：只有时刻 ⇒ 继承上文最近的日期',
    '- > 🕐 2026-10-15 21:00 ~ 2026-10-15 23:0x 区间式',
    '- 只有日期：2026-10-16',
    '- 端口 192.168.1.1:80 不该被当成时刻',
  ].join('\n'),
  'L3-知识\\记录-乙-三头六臂.md': '- 2026-10-14 20:00：文件名带关键词',
  'L3-知识\\记录-丙.md': '- 2026-10-14 19:00：正文里提到三头六臂',
})

const m = await import(pathToFileURL('C:\\Users\\admin\\.dsh\\plugins\\dsh-memoria\\lib\\f37-timeline.js').href)
const { extractTimes, formatTimeline, formatWindow, parseAnchorTime, sliceAround, timelineOf, windowOf } = m

console.log('=== F37 timeline ===')

const text = ['- 2026-10-14 18:35：标准', '- 2026-10-14 **18:41**：加粗', '- 2026-10-14 22:5x：含糊', '- 22:34：只有时刻', '- 2026-10-15 23:0x', '- 2026-10-16', '- 192.168.1.1:80'].join('\n')
const all = extractTimes(text)
const shown = all.map((p) => p.shown)

check('① 标准写法抽得到', shown.includes('2026-10-14 18:35'))
check('① 加粗夹在中间也抽得到', shown.includes('2026-10-14 18:41'))
check('① 含糊写法**显示原样**（22:5x）', shown.includes('2026-10-14 22:5x'))
check('① 只有时刻 ⇒ 继承上文日期', shown.includes('2026-10-14 22:34'))
check('① 只有日期 ⇒ 也收（time 为空）', all.some((p) => p.date === '2026-10-16' && p.time === ''))
check('① 非法时刻（:80）不认', !shown.some((s) => s.includes(':80')))
check('① 继承来的日期参与排序键（10-14 22:34 → 202610142234）', all.find((p) => p.shown === '2026-10-14 22:34')?.key === 202610142234)
check('① 含糊写法排序键按 50 算（22:5x → …2250）', all.find((p) => p.shown === '2026-10-14 22:5x')?.key === 202610142250)

const { points, files } = timelineOf(['L3-知识'], root)
check('② 扫到样本档案 3 份', files === 3)
check('② 全表按时间升序', points.every((p, i) => i === 0 || p.key >= points[i - 1].key))

const rk = sliceAround(points, '三头六臂', 2)
check('② 关键词锚：**文件名**那条当锚（记录-乙）', rk.points[rk.center - (rk.lo ?? 0)]?.file.includes('记录-乙') === true)
check('② 关键词锚：正文命中的也标出来（◀）', formatTimeline(rk).includes('◀'))

const rt = sliceAround(points, '2026-10-14 20:30', 1)
check('③ 时间锚：落在第一个 ≥ 它的点', rt.points[rt.center - (rt.lo ?? 0)]?.key >= parseAnchorTime('2026-10-14 20:30'))

const rm = sliceAround(points, 'zzz查不到', 2)
check('④ 查不到 ⇒ missing ＋ 不空手', rm.missing === true && rm.points.length > 0)
check('④ 查不到 ⇒ 文本里明说"没找到"', formatTimeline(rm).includes('没找到'))

const rw = sliceAround(points, '2026-10-14 22:30', 3)
check('④ 默认只要"有时刻"的点（日期档不混进来）', rw.points.length > 0 && rw.points.every((p) => p.time !== ''))
check('④ `withTime:false` 才带上日期档', sliceAround(points, '2026-10-14 22:30', 3, { withTime: false }).points.length > 0)

check('⑤ 锚是空的 ⇒ 当场抛（"岔口提示"）', (() => {
  try {
    sliceAround(points, '   ')
    return false
  } catch {
    return true
  }
})())
check('⑤ parseAnchorTime：时间给数字、关键词给 null', typeof parseAnchorTime('2026-10-14 22:30') === 'number' && parseAnchorTime('三头六臂') === null)

// ---- ⑥ 跨层时间窗（`mode="window"`）：目录名带秒级时间的挑得出来、L5 走 mtime ----
const root2 = makeArchive('window', {
  'L6-工具临时\\改档快照\\20261015-231040-874-6416-5ll6\\L1-必读\\铁律.md': 'x',
  'L6-工具临时\\改档快照\\20261014-223454-719-2444-2xls\\L1-必读\\铁律.md': 'y',
  'L5-证据\\说明.txt': 'z',
})
const w1 = windowOf('2026-10-15 23:00', '2026-10-15 23:10', ['L6'], root2)
check('⑥ window：目录名带秒级时间的挑得出来', w1.length === 1 && w1[0].rel.includes('20261015-231040'))
// ⚠️ 2026-10-16 修：这条原来拿"今天"当窗口，而样本目录的 **mtime 就是造它的那一刻** ⇒
//    `windowOf` 的 mtime 那一路会把它们收进来 ⇒ **一过午夜就红**（当晚 00:0x 实测踩到）。
//    改用**过去**的窗口（目录名是 2026 年、mtime 是现在，两头都不该命中）。
check('⑥ window：窗口外的一件都不要', windowOf('2020-01-01', '2020-01-02', ['L6'], root2).length === 0)
check('⑥ window：L5 走 mtime 那条', (() => {
  const w = windowOf('2020-01-01', '2030-01-01', ['L5'], root2)
  return w.length === 1 && w[0].kind === 'mtime'
})())
check('⑥ window：`from`/`to` 写不成时间 ⇒ 当场抛', (() => {
  try {
    windowOf('昨天', '今天', ['L6'], root2)
    return false
  } catch {
    return true
  }
})())
check('⑥ window：渲染里带命中数', formatWindow('a', 'b', w1).includes('命中 **1** 项'))

done()
