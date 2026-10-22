/**
 * `findByName()` 的**优先级**（2026-09-27 建）。
 * 跑法：node tests/find-by-name.mjs
 *
 * 🔴 钉住的是一件**真发生过、而且一声不吭**的事：
 *    · 待办那份文件叫 `待办-未完成事项.md`，住在 `L4-施工`；
 *    · 而 `L3-知识` 里有一份 `记录-2026-09-25-桌面规整与待办重排.md`（名字里**含"待办"**）。
 *    老实现是"路径里含 `待办` 就返回"，`walk()` 按层序先走 L3 ⇒ 先撞上**那份记录** ⇒
 *    `dangan_todo` 一本正经地报"待办文件里没有还开着的条目（…记录-2026-09-25-…）"。
 *    **用户看到的是"干净"，实际是读错了文件** —— 这类"静默读错"比报错难发现得多。
 * ⇒ 顺序写死：**名字就是它 → 名字以它打头 → 才退到"名字里含它"**。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('findbyname', {
  'L3-知识/记录-2026-09-25-桌面规整与待办重排.md': '# 记录\n一\n',
  'L4-施工/待办-未完成事项.md': '# 待办\n一\n',
  'L2-数据/01-时间轴-我们做过什么.md': '# 时间轴\n一\n',
})

// ⚠️ `CFG.archiveDir` 在模块**加载那一刻**算好 —— 所以必须在 import 之前指到样本档案。
process.env.GAI_DANG_ROOT = root

const { findByName } = await import('../lib/common.js')

console.log('— 按名字找：优先级 —')
check(
  '🔴 「待办」必须找到 `待办-未完成事项.md`，**不是**那份名字里含"待办"的记录',
  String(findByName('待办') || '').endsWith('待办-未完成事项.md'),
)
check('「时间轴」照样找得到（它不以"时间轴"打头，靠"含它"这一档兜住）', String(findByName('时间轴') || '').includes('01-时间轴'))
check('找不到的返回 null（不抛错）', findByName('这个名字档案里没有') === null)

done()
