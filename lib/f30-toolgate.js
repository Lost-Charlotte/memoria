// ============================================================
// F30 · 动手前门卫（`tools/pre-execute` 三道关）—— 2026-09-20 建
// ============================================================
//
// 为什么有它（用户 2026-09-20 原话）：
//   · "我们已经在梅莫莉亚里做过很多闸门了。有关这个，我需要你不只是做在铁律上。"
//   · "所有必读的文件必须在你新会话开始，第一轮工作开始前读完，什么是危险信号？或许是工具调用？
//      在动任何文件之前必须读所有必读的文件，这样闲聊或许不会触发？"
//   · "我输入都有输入法，你输入中文难道和英文一样吗？能不能限制你在写这个的时候只能写英文。而不是靠检测"
//
// 当天的真实账（这就是它要防的三件事）：
//   · **读序 ①→⑥ 六份，我只读了 2 份**（铁律还迟到 30 多轮）—— 而铁律 §四 明写着"必读层整份读、不设任何阈值"。
//     也就是说：**我违反的那条规矩，恰好写在我就没读的那份文件里**。
//   · `.ps1` 里写中文（《总账》**R2，犯了 5 次**）—— 防它只有一句"跑前自检"，**没人强制跑**。
//   · 结论（《总账》R2/R3/R15/R24 那一族的共同结论）：**写规矩防不住**；
//     **真正能防住的是"不让危险动作出现"**（也是唯一入口那套东西生效的原因）。
//
// 挂点（**本插件第一次用这个原语**；2026-09-20 从 `dsh-tools/lib/types/index.d.ts:38` 查实）：
//   'tools/pre-execute'(exec: ToolExecution, next) => Promise<PreToolDecision>
//   · `exec` = { callId, name, arguments, agent?, signal }（**参数在 policy 之前就已解析、深冻结**）
//   · `PreToolDecision` = {kind:'allow'} | {kind:'deny', reason} | {kind:'ask', reason?}
//   · 🔴 **deny 时工具体根本不执行** —— 这才叫"写的那一刻堵住"，不是写完再检测。
//
// 🔴 **动手前的各道关**（都只判**机械可判**的；判不了的仍然留给规范，别在这儿装聪明）。
//    ⚠️ **这里原来写"六道关"，2026-10-22 一数就发现对不上**（当时下面已经十几道了）。
//    这就是"重述必漂"的活标本：**数字写在这行、条目写在下面，改一处不动另一处。**
//    要数字就**现数下面的条目**（`第 N 关` ＋ 字母关），**别信任何注释里的总数**。
//   第 0 关 AGENTS.md 只读 —— 写/改的目标路径**规范化后等于 `HOME_DIR/AGENTS.md`**
//                  （＝ `~/.dsh/AGENTS.md`，**每轮注入 AI 上下文的那一个**）⇒ 拒。**只认这一个文件**。
//                  依据：用户 2026-09-20 拍板"这个必须堵死"；它是**每轮注入、权重最高**的文件；
//                  2026-09-17 定的规矩是"成果先放桌面待确认"。**唯一出路是去问用户**。
//                  ⚠️ 2026-09-20 收窄（用户原话："除了真的会每轮注入你的那个，其他的都不触发闸门。
//                    桌面这些副本都不值钱。不值得这样的流程。"）—— 工作区级的 `AGENTS.md`、
//                    桌面上的副本**一律不再触发这一关**（原来判"任意目录同名文件"太宽）。
//                  ⚠️ 排在最前面（绝对禁止，理由由它给出、不许被别的关抢先）；**读不拦**、别的 `.md` 不拦。
//   A 必读层    —— 本会话读齐【入口 ＋ 读序那几行】之前，**只放行"读这几份"的 read**，其余一律拒。
//                  **闲聊不调工具 ⇒ 完全不触发**（用户的设计；也是它与"每轮都念"那类东西的区别）。
//   B 按需必读  —— 要**写/改**某个范围的文件 ⇒ 先读它的必读文档；**只是看（read）不拦**。
//   D 只许 ASCII —— 写/改 `.ps1`，内容或路径含非 ASCII ⇒ 拒。
//                  依据：PowerShell 5.1 按 ANSI 读**整个文件**，注释里的中文一样会把后面读崩；
//                  而"脚本自身的路径"也必须纯 ASCII（R2 第②次就是中文目录名被读成乱码、空跑 0 项）。
//   E 不许手改 cordis.patch.yml —— `write`/`edit` 的目标路径以 `cordis.patch.yml` 结尾 ⇒ 拒。
//                  依据《铁律》§二："运行中的控制台，绝不手改 `cordis.patch.yml`"。
//                  为什么危险：那个 profile 是 `patchReload: live`，**手改它立刻热重载**
//                  （2026-09-05 因此把控制台弄死过三次，《AI错误总账》R3）。
//                  ⚠️ **读它不拦**（`read` 不是 `WRITE_TOOLS`）—— 看是允许的，改才拦。
//   🗑 **第 6 关 · 重复读 —— 2026-10-21 删净**：它唯一的输入 `exec.agent.session.events` 在这版宿主上
//      根本不存在（本文件上方自己就写着"agent.session 上根本没有 events"），日志里 886 条
//      "拿不到 session.events"、最后一次真拦是 2026-09-25 ⇒ 装上起就静默死了。
//      用户拍板：「**我们没有，就代表所有的都没有**」（宿主没改过，不必为假想中的别的机器留适配）。
//
// 三条自我约束（写死在代码里，不靠记性）：
//   · **判据出错一律 fail-open**（放行 ＋ 出声）—— 插件自己的 bug 不许把我锁死；
//   · **子代理不参与**（与 F7 同一条：子代理不背这套档案规矩）；
//   · **不写档案**（只写自己那一份 `~/.dsh/memoria-f30-reads.json` 状态文件，见 `join(HOME_DIR, …)`）；
//     "已读集合" ＝ **落盘里记过的 ∪ 历史里读过的 ∪ 内存里记的**（2026-09-20 修了两轮：
//      ① 先改成"以会话历史为准" —— 会话是**恢复**的、历史还在，只有进程内存会清；
//      ② 真机实测发现**光靠历史不够**：重启后 `agent.session.events` 里**那一刻还没有历史**
//         （界面能看到旧对话 ≠ 插件当场拿得到事件流），于是仍被判"一份必读层都没读"、逼着白读 7 份。
//      ⇒ 补一层落盘状态文件当"双保险"（写入 fail-open、只留最近 7 天）。
//      按《总账》R30：**每次重启白读 7 份 ＝ 白花一次冤枉钱**（历史部分走缓存命中，钱在新塞进去的字）。
//
// 📖 闸门与判据的编号口径：判据**只在 `f7-gate.js` 顶部那张「闸门定义表」定义一次**；
//    这里是"工具调用面"的另一组关（A/B/D），编号各自在本文件头部讲清，档案文档只许引用、不许重述。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CAP_STATS, CFG, DSH_HOME, HOME_DIR, baseOf, bumpToolCalls, capTick, findByNameUnique, isSubagent, log, readTextSafe, sessionIdOf } from './common.js'
import { skeletonDir } from './skeleton.js'
// ⚠️ 只借它"现在欠几份留底"这一个读数（`dumpNotice().count`）—— 第 12 关的判据在下面，
//    不在这里另立第二份留底状态。`f22` 不 import 本文件 ⇒ 不成环。
import { dumpNotice } from './f22-compact-dump.js'
import { inOtherArchive } from './f32-archives.js'
// 🔴 2026-09-28：**口径登记表** —— 第 17 关（口径关）拿它拦住"再抄一份口径"（**止在源头**）。
import { SCOPES } from './scope-registry.js'

/**
 * 模式开关（**不用重启就能切** —— 与 `memoria-gate.mode` 同一套做法）。
 * · `off`      —— 这一关全不关
 * · `observe`  —— 只记日志、**不拦**（先看它判得准不准）
 * · `enforce`  —— 真拦（**默认**：用户 2026-09-20 要的就是"拦"，不是"检测"）
 */
export const F30_MODE_FILE = join(HOME_DIR, 'memoria-f30.mode')

/** 写类工具（只认这两个 —— 它们的目标路径与内容是**结构化**给的，判据才可靠）。 */
export const WRITE_TOOLS = new Set(['write', 'edit'])

/** 读类工具（宿主那个 `read`；它是唯一算数"读过某份文件"的工具）。 */
export const READ_TOOLS = new Set(['read'])

/**
 * 按需必读表（**B 关**）。
 * 加一条＝加一行；`match` 命中**目标绝对/相对路径**，`need` 是"动它之前必须先读的档案内相对路径"。
 *
 * ⚠️ 只拦**写/改**（`WRITE_TOOLS`）—— 用户 2026-09-20 定的边界：
 *   "你要动梅莫莉亚的文件时拦住，并且要求你必读。这样只要你不动里面的东西，只是看就不拦。"
 */

/**
 * 🔴 2026-09-21（用户拍板："**pwsh 的改动调用应该是严令禁止的**" ＋ "**给防丢失流程并入闸门，将动盘必读变成规矩**"）
 *   —— **动盘特征**：裸写/删/搬动作 **或** 调那两个动盘入口（`recycle-del` / `move-verify`）。
 *
 * 两处共用它：
 *   · **第 11 关**（`diskWriteVerdict`）：命令里出现**裸**动作 ⇒ 拒（该走 `write`/`edit`/唯一入口）；
 *   · **B 关**（`scopedVerdict` 的动盘那一条）：**动盘前先读《防丢总则》**（读一次、整场会话放行）。
 *
 * 正则的边界（免得误伤正事）：
 *   · 裸 cmdlet 要**词首**（`(?:^|[\s|;&(])`）—— 所以 `Select-String -Pattern 'Remove-Item'` 也会中招；
 *     那类"只是想看"的查询改走 `grep` 工具（这是**故意的**：判据纯机械，宁可拦一次也不放行真写）。
 *   · `>` 重定向**排除** `-gt` / `=>` / `2>&1`（`[^\-<>=]` 那一撇）。
 *   · 调唯一入口**放行第 11 关**（白名单，否则入口把自己拦死＝自锁），但**照样触发 B 关**。
 */
export const DISK_ACTION_HINT = /(?:^|[\s|;&(])(?:Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Clear-Content|Out-File|Tee-Object|New-Item|Set-ItemProperty|Remove-ItemProperty|New-ItemProperty|Export-Csv|Export-Clixml|robocopy|xcopy|mkdir|rmdir|del|erase|rd)\b|\[(?:System\.)?IO\.(?:File|Directory)\]::(?:Write|Append|Create|Delete|Move|Copy)|(?:^|[^\-<>=])>>?\s*['"]?(?:[A-Za-z]:[\\/]|\.[\\/]|\/)|recycle-del\.ps1|move-verify\.ps1/i

/** 已登记的**唯一入口** —— 命令里出现它们就放行**第 11 关**（它们就是"那扇门"本身，拦住＝自锁）。 */
// ⚠️ 2026-09-21 补 `引用改写.mjs`：它**自己一个字都不写** —— 只生成事务，再调 `改档.mjs --txn`，
//    等于"那扇门的封装"。用户当天点出"这条链门看不见"（命令文本里没有写动作词），
//    登记进来就把"**恰好没被拦**"变成"**被承认是那条路**"。
export const ENTRY_WHITELIST = /recycle-del\.ps1|move-verify\.ps1|改档\.mjs|ask-cloud\.mjs|dump-skeleton\.mjs|reconcile-dump\.mjs|引用改写\.mjs/i

/**
 * **A 关放行的"只读探查"工具**（2026-10-22 加 —— 治"新会话连档案在哪都不知道"那个死锁）。
 *
 * 🔴 **只收 `glob` / `grep`** —— 它们**纯读**，`glob '**\/*'` 就足够找到档案在哪。
 *
 * ⚠️ **为什么一开始我把 `pwsh` 也放进来了、又撤掉**（当天自查）：
 *    A 关拦 `pwsh` **不是顺手**，它是**"改档案前必须读过必读"的最后一道** ——
 *    第 11 关只堵 `Remove-Item` / `Set-Content` 这类**字面**，而 `pwsh` 能跑
 *    `node -e "fs.writeFileSync(...)"` **绕开第 11 关直接改档案**。
 *    放行 `pwsh` ＝ 把这道拆了，换来的只是"能列目录"—— **不值**。
 *    `glob` / `grep` 已经够探路，所以这一格**只留它们**。
 * ⚠️ 会改东西的 `write` / `edit` **同样不在这里**。
 */
export const EXPLORE_TOOLS = new Set(['glob', 'grep'])

/**
 * 🔴 **2026-10-16 加**：**不经过"唯一入口"、却会写盘的外部程序**（用户当天点名要堵的那个洞）。
 *
 * 由来：那天我用 `ffmpeg` 把 3 个临时件写进了**别馆**的 `L6-工具临时\` —— `ffmpeg` 被当"工具"放行，
 *   而它写盘**根本不经过** `DISK_ACTION_HINT` 那套裸 cmdlet 判据 ⇒ **换一个 exe 就能绕过第 11 关**。
 *   用户原话：「**写过去确实不对，但无伤大雅，l6 而已。绕过去这个倒是值得堵死。**」
 *
 * ⚠️ **它只降概率、不给保证**（与第 11 关同族）：列进来的拦得住，**没列进来的照样绕**。
 *   真正的保证只能来自"别馆目录**物理**拒写"那一层（ACL）—— 2026-10-16 用户**只批准了本层**。
 *   ⇒ 判据刻意**只认"会写盘的那几种用法"**（`tar -x` / `node -e` / `pandoc -o`…），
 *     免得把 `tar -tf`、`rg`、`read` 这些**只读**用法误伤（`-tf` 不含 `x`/`c` ⇒ 不中）。
 */
export const EXTERNAL_WRITER_HINT = /(?:^|[\s|;&("'])(?:ffmpeg|7zr|7z|yt-dlp|czkawka_cli|tar\s+-[a-z]*[xc]|(?:node|python[0-9.]*|py)\s+(?:-e|--eval|-c)\b|pandoc(?=[^|;&]*\s-o\s))/i

/** 命令里出现的**路径**落在**本馆或别馆**里吗（`toRel` 管本馆，`inOtherArchive` 管别馆）。 */
function commandTouchesArchive(cmd) {
  try {
    const paths = cmd.match(/[A-Za-z]:[\\/][^'"\s|;&)]+/g) ?? []
    return paths.some((p) => {
      // ⚠️ 认馆要读馆表 ⇒ 那一步单独兜底：读不到**只当"不是别馆"**，不许把整条判据带崩。
      try {
        if (inOtherArchive(p)) return true
      } catch {
        /* 认馆失败 ⇒ 不当别馆（下面的本馆判据照走） */
      }
      // 🔴 别用本文件那份 `normPath`：它经 `toRel()` 把**馆内**路径转成**相对**形式
      //    （`l6-工具临时/x.mp4`），拿它跟馆根比 `startsWith` **永远对不上**（2026-10-16 踩过：
      //    5 条测试全红，查了三轮才发现"同名不同物"）。这里要的判据就是 `toRel !== null`。
      return toRel(p) !== null
    })
  } catch {
    return false // 🔴 判据出错 ⇒ 放行（fail-open：插件 bug 不许把人锁死）
  }
}

/** 「借外部程序写档案」那一支的拒绝话术（出路三条，都走得通）。 */
function externalWriterReason(where) {
  return (
    'F30 先停一下：**这条命令里既有"会写盘的外部程序"、又有"档案里的路径"** ——\n  ' + where +
    '\n① 为什么拦：外部程序**不经过**第 11 关那套裸写判据（`Remove-Item` / `Set-Content` / 重定向…）。\n' +
    '   那天我用 `ffmpeg` 把临时件写进了**别馆**的 `L6-工具临时\\` —— 用户 2026-10-16：\n' +
    '   「**写过去确实不对，但无伤大雅，l6 而已。绕过去这个倒是值得堵死。**」\n' +
    '② 出路（三条，都走得通）：\n' +
    '   · **要写档案** → `write` / `edit`；要改档案 → `改档.mjs`（`--line` / `--append` / `--txn`）\n' +
    '   · **要搬进来** → 先写到**档案外**（`%TEMP%` 这类临时目录），再 `move-verify.ps1` 搬（盘上"新建"＝先在外面造出来、再搬）\n' +
    '   · **只是想读** → 输出改到档案外（`tar -tf` 这种只读用法**不中这一关**；要解包就解到临时目录再搬）\n' +
    '③ ⚠️ 这一关**只降概率、不给保证**（没列进来的 exe 照样绕）—— 真正的保证在"别馆目录物理拒写"那一层。'
  )
}

export const SCOPED_READS = [
  {
    what: '梅莫莉亚插件',
    match: /[\\/]plugins[\\/]dsh-memoria[\\/]/i,
    // 🔴 2026-09-29：**只写文件名** —— 层与子目录由 `baseOf` / 现算取，搬层不用再回来改这里。
    //    判定"读过没"在 `scopedVerdict` 里按**文件名**兜底（纯放宽：原来认的照认，另多认同名那份）。
    // ⚠️ **2026-10-09 改**：那份《现状总纲》当天随 L3 重分类**改了名**（`参考-` → `备查-`）——
    //    这里写旧名 ⇒ 关卡**永远认不出"已读"**（实测：读了 3 遍仍被拦，且"修这一行"这个动作
    //    又被它自己拦着，成了死锁）。⇒ **只写新名**。
    //    ⚠️ 别把旧名也塞进来"防一手"：`scopedVerdict` 按**文件名**兜底，`need` 里每一项**都得被满足**，
    //       多写一个旧名 ＝ **多要求读一份不存在的文件** ⇒ 反而永远拦住。
    // 🔴 **2026-10-16 改**：它**去掉了日期**（原 `记录-2026-09-16-梅莫莉亚-施工手册.md`）——
    //    按《各类文件格式》§3.10：「对象**没有结束日**（在维护的设施）→ `记录-<对象名>.md`」；
    //    施工手册正是"随插件进展续改"的那种 ⇒ 带日期会被读成"2026-09-16 那一天的事"。
    //    ⚠️ 同 2026-10-09 那条教训：**只写新名** —— `need` 里多写一个旧名 ＝ 多要求读一份不存在的文件。
    need: ['指南-梅莫莉亚-施工手册.md', '备查-老馆与新馆（现状总纲）.md'],
    because:
      '《施工手册》：加新功能的六步 · 动手前必过的三问 · 踩过的 15 个坑（含"凡会自动改档案的东西，写完必须请人从怎么弄坏它的方向再审一遍"）· ' +
      '《现状总纲》：**现在处在搬家过渡期** —— 老馆内容太多不许大改、新格式的馆还没装修好；**先搞清楚"这件事该落在哪"再动插件**' +
      '（2026-09-24 用户要求把它挂进这一关："关于老馆，以及这些论据，不要散落在各处……下一个会话直接去看，就能知道什么情况"）',
  },
  // 🗑 **2026-09-27：这一项加回来当天又删掉了**（用户当场拍板〔会话 2026-09-27〕：
  //    "**我觉得删了吧。不然你每调用一次工具他都得吵你。既然是u盘相关，就不要牵连到别人**"）。
  //    为什么删：`recycle-del.ps1` / `move-verify.ps1` 这两个入口**不只用于 U 盘** —— 动本机档案里的文件
  //    也走它们 ⇒ 挂在"调这两个入口"上，等于**每次搬本机文件都被要求读一份 U 盘文档**（牵连到别人）。
  //    改由 **第 15 关**（本文件上面的 `diskTalkVerdict`）管：判据＝**用户那句话里出现 U 盘**，软的、只提醒一次。
  //
  // 🔴 这一天它被拆过、加回过、又拆掉 —— **三段都留档**（W8：旧做法就地标，不许删原文）：
  //    · **09-26 拆**（用户："动盘前必读的闸门就可以去掉了"）：原项 need 的是《防丢总则》，它已挪进 `L1-必读`、
  //      由 A 关每轮管（再挂一道门＝同一件事收两遍）；且它每轮都触发，不该被当成"偶尔动盘才读的东西"。
  //    · **09-27 加回**（用户："凡是可以通过闸门来约束的，都应该被闸门管辖"）：need 换成《动U盘前必读》
  //      （管"认哪个盘 / 这东西归哪个筐"的**现场判据**；与 L1 那份《防丢总则》不是一回事）。
  //    · **09-27 又删**（用户："不要牵连到别人"）：判据落在"调了那两个入口"上**太宽** —— 那两个入口是本机搬运
  //      与 U 盘搬运**共用**的，够不着"只对 U 盘"这个意图。⇒ 交给"按用户原话"的第 15 关。
  // 🔴 2026-09-26 **这一项原来被拆掉过**（用户当天拍板"动盘前必读的闸门就可以去掉了"），
  //    **2026-09-27 又加回来了**（就是上面那一项）—— 用户当天补的口径是"凡能用闸门约束的都该由闸门管"。
  //    今天想清了分工，两件事不是一回事：
  //      · 《防丢总则》在 `L1-必读`（A 关管）—— 它管"**怎么搬 / 怎么删**"的**总则**，而且**每轮都读**；
  //      · 《动U盘前必读》挂在**动盘那一刻** —— 它管"**认哪个盘 · 这件东西归哪个筐**"的**现场判据**。
  //    拆它那天给的两条理由（原样留档，别再删）：
  //      ① 那份文件**已经挪进 `L1-必读`**（改名《防丢总则》）—— L1 是"每次接手先读"的一层，
  //         **A 关**（必读层没读齐就拦）本来就会管它 ⇒ 再挂一道门＝同一件事收两遍；
  //      ② 它其实**每轮都会触发**（有了归档机制之后，新会话第一轮基本都在销上一轮的留底），
  //         所以它早就不该被当成"偶尔动盘才需要读的东西"。
  //    ⚠️ 本轮加回的是**另一份文件**（《动U盘前必读》），不违背上面第 ① 条。
  // 原注释（2026-09-26 那条）留在这里：**这里原来还有一项，已拆掉**（用户当天拍板）：
  //    原项＝「用户的文件 / 盘（动盘 · 搬运 · 删除 · 改档）」→ `need: ['L3-知识\\防丢失流程-动盘必读.md']`。
  //    拆它的理由（用户原话："**动盘前必读的闸门就可以去掉了**"）：
  //      ① 那份文件**已经挪进 `L1-必读`**（改名《防丢总则》）—— 而 L1 是"每次接手先读"的一层，
  //         **A 关**（必读层没读齐就拦）本来就会管它 ⇒ 再挂一道门＝同一件事收两遍；
  //      ② 它其实**每轮都会触发**（有了归档机制之后，新会话第一轮基本都在销上一轮的留底），
  //         所以它早就不该被当成"偶尔动盘才需要读的东西"。
  //    ⇒ **文件在 L1、闸门不重复**。真要"动盘前必读"这条规矩，靠的是 L1 必读本身。
]

// ------------------------------------------------------------
// 路径小工具
// ------------------------------------------------------------

const toSlash = (p) => String(p ?? '').replace(/\\/g, '/')

/** 档案内相对路径（不在档案根之下就返回 null）。 */
export function toRel(p) {
  const n = toSlash(p)
  const root = toSlash(CFG.archiveDir).replace(/\/+$/, '') + '/'
  if (n.toLowerCase().startsWith(root.toLowerCase())) return n.slice(root.length)
  return null
}

/** 拿一个路径去清单里找"这是哪一份"（绝对路径 / 相对路径 / 只是档案内相对路径，三种都认）。 */
function matchKnown(p, items) {
  if (typeof p !== 'string' || p.length === 0) return null
  const n = toSlash(p).toLowerCase()
  for (const it of items) {
    const rel = toSlash(it.rel).toLowerCase()
    if (n === rel || n.endsWith('/' + rel)) return it.rel
    // 🔴 2026-09-29：**文件名兜底** —— 清单里现在只写文件名（层路径现算），而且**那份文档搬过层**
    //    之后旧路径就再也对不上；认不出 ⇒"永远没读过"⇒ **B 关把我拦死**（施工手册坑 4 那一族的死锁）。
    //    命中时优先记"它真实的相对路径"，拿不到再退回清单里的写法。
    if (baseOf(n) === baseOf(rel)) return toRel(p) ?? it.rel
  }
  return null
}

/**
 * B 关（按需必读）点名要读的那几份 —— 它们**也属于"允许读、且读了要记账"的清单**。
 *
 * 🔴 少了这一步就是**死锁**（2026-09-20 我自己撞上的，被自己的 B 关连拦两轮才想通）：
 *    B 关要求"动梅莫莉亚之前先读施工手册"，可 read 施工手册**记不上账**
 *    （记账口子原来只认 A 关那 7 份）→ B 关永远说"还没读"→ **连修它的代码都写不进去**。
 *    这是施工手册坑 4 那一族（"基线只在成功时写 → 死锁"）。
 *    退路是模式文件（`memoria-f30.mode` 写 `observe`）—— 设计时就留了，这次真用上了。
 */
function scopedNeeds() {
  const out = []
  for (const s of SCOPED_READS) {
    // 🔴 2026-09-29：清单里**只写文件名**（搬层不用回来改）；这里**现算**成当前的真实相对路径 ——
    //    否则记账键会跟 `read` 调用记下的完整路径对不上 ⇒ **B 关死锁**
    //    （`tests/f30-toolgate.mjs` 那条「记账口子必须开着」的红就是它）。
    for (const rel of s.need) out.push({ label: '按需必读', name: baseOf(rel), rel: curRelOf(rel) })
  }
  return out
}

/**
 * 清单里的"文件名" → **当前真实相对路径**（现算）。
 * 现算不出（找不到 / 命中不唯一）就**原样返回文件名** —— 交给判定那一步的**文件名兜底**收拾。
 */
function curRelOf(name) {
  const bare = baseOf(String(name)).replace(/\.(md|txt)$/i, '')
  const abs = findByNameUnique(bare)
  if (!abs) return name
  const r = toRel(abs)
  // ⚠️ `toRel` 回的是**正斜杠**形态，而档案内相对路径的惯用写法是**反斜杠**
  //    （清单、落盘账本、`HANDDBOOK` 那类断言都用 `\`）⇒ 这里统一成 `\`，否则"记上了但比不着"。
  return r ? r.replace(/\//g, '\\') : name
}

// ------------------------------------------------------------
// A 关 · 必读清单（**从入口现算，不另立一份**）
// ------------------------------------------------------------
//
// 🔴 为什么不在这里写死清单：《使用说明》定死"**读序只有入口 `从这开始读.txt` 那一份，别处不再另定**"。
//    写死＝第二处权威＝必漂（这正是本档案的头号病根）。
// 🟠 解析不出来**必须出声**：读不到入口 / 一条读序都没匹配上 → 记 `error`，
//    自检里如实报，并在判据里 fail-open（宁可漏拦，也不许因为入口读不到就把人锁死）。

// ------------------------------------------------------------
// 「伸了几次手」计数（2026-09-20 加 · 判据见《总账》R30）
// ------------------------------------------------------------
//
// 为什么在这儿数：`tools/pre-execute` 是**每一次工具调用都必经**的那一个点（本文件唯一挂它的地方）。
// 用户 2026-09-20 当场量出来的账：**工具来回的次数就是钱**（ⓘ 现行口径：钱 ＝ 新塞进去的字 × 全价 ＋ 历史长度 × 次数 × 命中价，见《备查-计费口径》）。
// 它只记账、不拦人（拦人是上面那三关）—— 报数的那一头在 F7 收工那一刻。

/** 本回合工具调用次数（"伸了几次手"）。**这是"次数"那一半的钱**（钱的大头是每次新塞进去的字，见《备查-计费口径》）。 */
let callsThisTurn = 0

/**
 * 本回合**调过哪些工具名**（2026-09-20 加 · 给 F31「宣称已做要有凭据」用）。
 *
 * 🔴 为什么记在这儿而不是让 F31 自己去扫 events：`tools/pre-execute` 是**每一次调用必经**的那一个点
 *    （本文件唯一挂它的地方），在这儿记是**一次调用一行、不会漏**；
 *    而去 events 里扫要自己判"哪些事件属于本回合"（`turn` 字段的起止），容易漏判。
 *    ⚠️ 它只记名字、**不拦人**；F31 第一版也只出声不拦。
 */
let toolsThisTurn = new Set()

// ------------------------------------------------------------
// 🔴 2026-09-20 深夜（第二版）· 「一个回合」的边界改挂到**用户消息**上
// ------------------------------------------------------------
// 为什么改：真机实测 `agent/turn-stopping` **会在回合中途就触发**（21:53:36 那次我正干到一半），
// 而"计数清零"原来挂在那个钩子里 → 一触发就清零 → **"每回合 10 次"变成"每两步 10 次"，形同虚设**
// （证据：21:56:44 那一段真机数出 10 次，可其中只有 3 次是真伸手的）。
// 现在：**用户又说话了 ⇒ 新回合 ⇒ 计数归零** —— 用户消息才是回合的起点。
let lastTurnUserKey = ''

/** 当前"用户消息指纹"（条数 ＋ 最后一条原文）。拿不到用户的话 → 空串。 */
export function turnKeyNow() {
  try {
    const t = userSaidTexts()
    return t.length > 0 ? `${t.length}\u0001${t[t.length - 1]}` : ''
  } catch {
    return ''
  }
}

/** 用户又说话了 → 新回合（计数归零）。他没说话时什么都不做。 */
function maybeNewTurn() {
  const k = turnKeyNow()
  if (!k || k === lastTurnUserKey) return
  lastTurnUserKey = k
  resetToolCalls()
  // 🔴 2026-09-21：顺手推进"留底欠了几轮"（第 12 关的计数就挂在这个边界上 ——
  //    **用户说话才算一轮**，不挂工具调用：否则我一口气干十几个调用就够 3 轮了）。
  noteDumpDebtTurn()
}

// ------------------------------------------------------------
// 🔴 2026-09-21 · **第 12 关：留底留意超期** —— G5 在"工具调用面"的执行臂
// ------------------------------------------------------------
// 用户原话〔会话 2026-09-21〕："**是强制的但记留意。。那你一直带着账那不没意义。。或许在欠多少次之后强制你必须先归档？**"
//
// 病：G5（`f7-gate.js`）只判"上一轮几份、这一轮还几份"，**没有次数**，而且未过只**记留意**
//   （0.50.0 删掉 `agent.steer` 之后，门不再把回合拽回来）—— 于是"带着账"可以一直带下去：
//   实测那 3 份留底从 09-20 挂到 09-21 晚，G5 在日志里连报"第 4 次 / 第 5 次"都没用。
//
// 判据：**连续多少轮（＝用户说了几次话）留底份数一动没动** ≥ `DUMP_DEBT_ROUNDS` ⇒ 拦。
//   · 数在 `maybeNewTurn()` 里推进（回合边界），**不在工具调用上**。
//   · ⚠️ 只放行**销账链路的工具** —— 否则连骨架都读不出来 ⇒ **死锁**（《施工手册》坑 4 那一族）。
//   · ⚠️ 防死锁第二层：**连拦 `DUMP_DEBT_MAX_DENY` 次就自动放行并记留意**
//     （沿用闸门既有的"同一会话连续拦 3 次"上限 —— 用户 2026-09-17 拍板"沿用，不另设一类"）。
export const DUMP_DEBT_ROUNDS = 3
// 🔴 2026-09-22 深夜：`3` → **`1`**。由来是一场真事故（会话 be14dc7a 因此报废）：
//   它在第 2 次被拦之后就"思考完没动静"、**再也没发出第 3 次** ⇒ 这个上限**永远到不了** ⇒ **永久死锁**，
//   会话彻底干不了活、只能归档（用户原话："我服了。。他彻底寄了"）。
//   拦 1 次已经足够"强制你看一眼出路"，而留意栏本来就每轮在念 —— **强制不该以"把会话堵死"为代价**。
//   （同族先例：《施工手册》坑 4 —— "基线只在成功时写 → 死锁"。）
export const DUMP_DEBT_MAX_DENY = 1

/**
 * 留意超期时**一律放行**的工具（销账链路 ＋ 一切"看"）。`dangan_*` 另按前缀放行。
 *
 * 🔴 **2026-10-14 加 `run_code`**（三头六臂适配第一处）：
 *    ① **它本来会被这一关误拦** —— 名单里没有它，而三头六臂里我正是用它跑对账 / 读骨架；
 *    ② **它该放行** —— 它是那副身子的**主入口**（原生工具与 `run_code` 两种形态并存），
 *       拦它 ＝ 把"销账链路"整条挡住（同 `read`／`grep`：那是防丢机制的一部分，不是"伸手"）；
 *    ③ ⚠️ **它也不构成第 11 关那种风险** —— 第 11 关防的是"意外丢失"（pwsh 搬运时目的地不存在
 *       ⇒ 文件被送去异次元）。2026-10-14 实测 `run_code`：往不存在的目录写**抛 `ENOENT`**、
 *       不静默丢文件；唯一要守的是"覆盖已存在文件"那条既有规矩（搬＝复制→校验→才删源）。
 *       （判据出处：用户 2026-10-14 22:5x 点破第 11 关的根因是"意外丢失"，不是"写"本身。）
 */
export const DUMP_DEBT_TOOL_ALLOW = new Set(['read', 'grep', 'skill', 'run_code'])
/**
 * `pwsh` 里只有含这些**唯一入口**的命令放行（对账 / 骨架 / 删留底 / 读会话 / **改档**）。
 * 🔴 **2026-09-23 补 `改档.mjs` / `引用改写.mjs`** —— 这一关的本意是"**先归账**"，
 *    但"**归不了账**"绝不该发生（讨论稿 §十七-2 抓到的自锁）：留意期我连"补档"都做不了。
 *    ⚠️ `dangan_*` 本来就在放行名单里 —— **真被这道关拦住的，正是"pwsh 直调改档 / 引用改写"**。
 */
export const DUMP_DEBT_PWSH_ALLOW = /reconcile-dump\.mjs|dump-skeleton\.mjs|recycle-del\.ps1|read-session\.mjs|改档\.mjs|引用改写\.mjs/i

let dumpStuckRounds = 0
let lastDumpCount = -1
let dumpDebtDenied = 0

/** 新回合时调一次：留底份数**一动没动**就累加，动了（或多于 0 → 0）就归零。 */
function noteDumpDebtTurn() {
  try {
    const n = Number(dumpNotice()?.count) || 0
    if (n <= 0) {
      dumpStuckRounds = 0
      lastDumpCount = 0
      return
    }
    if (n === lastDumpCount) dumpStuckRounds += 1
    else {
      lastDumpCount = n
      dumpStuckRounds = 0
    }
  } catch {
    /* 读不到留底状态不影响判据（宁可漏拦，也不许把人锁死） */
  }
}

/** 测试用：把这一关的计数复位。 */
export function __resetDumpDebt() {
  dumpStuckRounds = 0
  lastDumpCount = -1
  dumpDebtDenied = 0
}

/** 测试用：直接把"欠了几轮"设成某个数（省得造整套留底 state）。 */
export function __setDumpStuck(n) {
  dumpStuckRounds = Number(n) || 0
}

/**
 * 见过的工具名（每见一个新的就往日志写一行）。
 * 🔴 为什么要它：第二版发现"落档类不计数"**没生效**，可 `exec.name` 到底长什么样只能猜 ——
 *    于是让它自己把见到的名字写进 `memoria.log`，下一程照着判，不用再猜。
 */
const seenToolNames = new Set()
function noteNameSeen(nm) {
  if (!nm || seenToolNames.has(nm)) return
  seenToolNames.add(nm)
  try {
    log(`pre-execute 见到工具名：${nm}`, { silent: true })
  } catch {
    /* 日志写不了不影响计数 */
  }
}

/** pre-execute 每次调一下（由 registerF30 内部调，不用外部调）。`name` 可省（老调用点兼容）。 */
export function noteToolCall(name, args, sid) {
  const nm = String(name ?? '')
  // 🔴 2026-09-26 加：**工具调用时钟**（`common.js` 的 `bumpToolCalls`）——
  //    考勤（F34）拿它跟"门卫判了几次"对一对，才能测出"**门卫瞎了**"：
  //    拿 F30 自己的计数当信号是**同义反复**（它不记＝它没调用，永远判不出来）。
  //    挂在这里是因为 `tools/pre-execute` 是**每一次工具调用必经**的那个点。
  bumpToolCalls()
  noteNameSeen(nm)
  maybeNewTurn()
  // 🔴 第一版（2026-09-20 晚，用户报"f30 出了问题"）：**落档 / 体检 / 检索类不计数**。
  //    ⚠️ 真机把它推翻了：21:53:36~21:56:44 那一段只有 **3** 次非落档调用，真机却数出 **10**
  //    （3 ＋ 5 次 `dangan_log` ＋ 2 次体检）—— 判据没生效，`exec.name` 的形状跟这里想的不一样。
  //    所以第二版：判据放宽成 `/dangan/i`（不再要求那个下划线），**并把见过的名字写进日志**。
  if (!EXEMPT_TOOL_RE.test(nm)) callsThisTurn += 1
  if (nm.length > 0) toolsThisTurn.add(nm)
}


/** 收工时读一次（F7 会调它）。不重置 —— 重置由 `resetToolCalls()` 负责。 */
export function toolCallsThisTurn() {
  return callsThisTurn
}

/** 本回合调过的工具名（去重后的快照）。F31 用它判"这一轮有没有写动作"。 */
export function toolsCalledThisTurn() {
  return [...toolsThisTurn]
}

/**
 * 本回合**有没有"写"动作**（F31 的判据之一）。
 * · `WRITE_TOOLS`（`write`/`edit`）被调用过 → 算；
 * · `dangan_log` 被调用过 → 也算（它**会真写档案**，只是名字不在 `WRITE_TOOLS` 里）；
 *   ⚠️ 用 `endsWith` 而不是全等 —— 宿主挂出来的工具名可能带前缀（`xxx.dangan_log` / `xxx__dangan_log`）。
 * 拿不准（记不到名字）→ 返回 `false`，F31 第一版只会"多出声"，**不会拦人**。
 */
export function wroteThisTurn() {
  for (const n of toolsThisTurn) {
    if (WRITE_TOOLS.has(n)) return true
    // ⚠️ 织布机（`dangan_weave`）也会真写档案 —— 2026-10-07（对抗审查）补上：
    //    否则"用织布机写了档"在 F31 眼里等于"这一回合什么都没写"。
    const ln = String(n).toLowerCase()
    if (ln.endsWith('dangan_log') || ln.endsWith('dangan_weave')) return true
  }
  return false
}

/** 收工处理完再清零（F7 会调它）。 */
export function resetToolCalls() {
  callsThisTurn = 0
  toolsThisTurn = new Set()
}

let listCache = null

/** 解析入口，得必读清单。带 mtime 失效，所以入口一改就自动跟上。 */
/**
 * 🔴 **测试钩子：清掉必读清单的缓存**（2026-10-01 加）。
 * 为什么需要它：`requiredList()` 的缓存 key 是**入口文件的 mtime** ——
 *   测试里"写坏入口 → 再写好入口"两步**常常落在同一毫秒**，mtime 不变 ⇒ **缓存不失效**
 *   ⇒ 返回的还是"解析失败"那一版 ⇒ **A 关 fail-open** ⇒ **后面对它的断言全在假世界里跑**
 *   （实测：`f30-toolgate.mjs` 里 4 条断言因此**假通过/假失败**，查了三轮才找到这里）。
 */
export function __clearListCache() {
  listCache = null
}

export function requiredList() {
  const entry = join(CFG.archiveDir, CFG.entryFile)
  let stamp = 'missing'
  try {
    stamp = String(statSync(entry).mtimeMs)
  } catch {
    /* 读不到就是 missing */
  }
  const key = `${CFG.archiveDir}|${stamp}`
  if (listCache && listCache.key === key) return listCache

  const text = readTextSafe(entry)
  const order = []
  let error = ''
  if (!text) {
    error = `读不到入口：${entry}`
  } else {
    // 入口里那几行形如：`  ① 00-总览-我们干过什么.md ..... 一页…`
    // 🔴 2026-09-26 修：**圈码不许写死行数**。原来只认 `①②③④⑤⑥` —— 当天往读序里加了第 ⑦ 份
    //    （《防丢总则》挪进必读）之后，这里**一条都匹配不上** ⇒ `order` 空 ⇒ **A 关当场 fail-open**
    //    （那道门"等于没开"，而且只在日志里留一行、没人会去翻）。
    //    现在认 ①~⑳，够用很久；真要超过 20 份，那时该拆的是必读层本身。
    //    ⚠️ 教训与"改了格式没改读它的机器"**同族**：**改入口的读序，必须同时改这里**。
    const re = /^[ \t]*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])[ \t]+([^\s（(]+\.(?:md|txt))/gm
    let m
    while ((m = re.exec(text)) !== null) {
      order.push({ label: m[1], name: m[2], rel: join(CFG.tieDir, m[2]) })
    }
    if (order.length === 0) error = '入口里没解析出读序（形如「① 00-总览-…md」的那几行）'
  }

  // 入口自身也算一份：宿主 `AGENTS.md` 第一句就是"接活前先读 `从这开始读.txt`"。
  const files = [{ label: '入口', name: CFG.entryFile, rel: CFG.entryFile }, ...order]
  listCache = { key, entry, files, order, error }
  return listCache
}

/** 测试用：清缓存。 */
export function __resetListCache() {
  listCache = null
}

// ------------------------------------------------------------
// 落盘状态（**双保险的第二层** —— 2026-09-20 第二次修）
// ------------------------------------------------------------
//
// 为什么还要落盘（真机实测）：
//   · 用户**重启控制台**后，AI 调第一个非 read 工具时**仍被拒**、仍被要求重读那 7 份。
//   · 日志实证（`~/.dsh/memoria.log`）：重启后**只有**"F30：记下已读 …"那 7 条
//     —— 那是**被拒之后 AI 现读的**；**没有一条**"从历史读到"。
//   · 根因：重启后 `agent.session.events` 里**那一刻还没有历史**
//     （界面能看到旧对话 ≠ 插件当场拿得到事件流）⇒ **光靠历史不够**。
//   · 用户的原意（2026-09-20 亲口）："**重启不该逼我重读**"（每次重读 7 份＝白花一次冤枉钱，《总账》R30）。
//
// 形状：`{ "<sid>": { "<档案内相对路径>": <时间戳 ms> } }`（sid 用 `sidOf(exec)`；rel 用归一化后的档案内相对路径）。
// 三条自我约束：**读不出来／坏 JSON → 当空、绝不抛错**；**写不进去只 `log` 一声、绝不影响放行**（fail-open）；
//   **只留最近 7 天**（按时间戳裁）—— 免得无限涨。

/** 落盘状态文件：`~/.dsh/memoria-f30-reads.json`。**唯一**一处 F30 会写的文件（不写档案）。 */
export const F30_READS_FILE = join(HOME_DIR, 'memoria-f30-reads.json')

/** 条目保留时长：**最近 7 天**，过期即裁（免得这个文件无限涨）。 */
const READS_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 读落盘那份状态，**顺手裁掉超过 7 天的条目**（按时间戳）。
 * 文件不存在 / 坏 JSON / 形状陌生 / 读不动 → 一律返回 `{}`，**绝不抛错**（fail-open）。
 * @returns {Record<string, Record<string, number>>}
 */
export function f30DiskReads() {
  const out = {}
  let raw = ''
  try {
    raw = readFileSync(F30_READS_FILE, 'utf8')
  } catch {
    return out // 文件不存在／读不动：当空
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    log('F30 已读状态文件坏了（不是 JSON）—— 当空处理（fail-open）', { silent: true })
    return out
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out
  const cutoff = Date.now() - READS_TTL_MS
  for (const [sid, m] of Object.entries(data)) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue
    const keep = {}
    for (const [rel, ts] of Object.entries(m)) {
      const t = Number(ts)
      if (!Number.isFinite(t) || t < cutoff) continue // 超 7 天／时间戳认不出 → 丢掉
      // ⚠️ 键**保持原样**（不动 `\` ↔ `/`）：改键会让"读出来再写回去"把文件里的写法搬家，
      //    而且跟清单里的 `rel` 就对不上了。两种写法由 `haveWithHistory` 那一处统一兼容。
      keep[rel] = t
    }
    if (Object.keys(keep).length > 0) out[sid] = keep
  }
  return out
}

/**
 * 该会话在落盘里"记过哪几份"（读不出来就是空集）。
 * ⚠️ 返回的键**保持文件里的原样**（可能是 `\` 或 `/`），好让它和清单里的 `rel` 直接比；
 *    归一化只用在小写比较那一处（`hasDiskRel`），**不在这里改键**（改了就跟 `rel` 对不上）。
 */
function diskHave(sid) {
  try {
    return new Set(Object.keys(f30DiskReads()[sid] ?? {}))
  } catch {
    return new Set() // fail-open：状态文件坏了绝不许把判据放倒
  }
}

/** 落盘里有没有"这一份"（`\` / `/` 两种写法都认）。 */
function hasDiskRel(sid, rel) {
  const want = toSlash(rel).toLowerCase()
  for (const r of diskHave(sid)) {
    if (toSlash(r).toLowerCase() === want) return true
  }
  return false
}

/**
 * 🧪 **测试用**：把落盘那份"已读"清空。
 *
 * 🔴 为什么必须有它（2026-09-21 实测到的坑）：第 6 关改用落盘判"重读"之后，
 *    **落盘是跨测试运行存在的**（`~/.dsh/memoria-f30-reads.json`）——
 *    而 `tests/f30-toolgate.mjs` 用的是**固定假 sid**（`S1` / `S2` / `R3` …）。
 *    于是**第二次跑测试**时，"第一次读"就被判成了"重读"：实测 `读铁律（绝对路径）→ 放行`
 *    与 `用档案内相对路径也能认` 两条**只在第二次跑时挂**（第一次是绿的）—— 典型的**状态污染**，
 *    不是判据错。测试开头调一次它即可。
 *
 * ⚠️ 它清的是**整个文件**（含真实会话的条目）—— 只在测试里用；真机跑一次测试后，
 *    本会话那 7 份必读层的"已读"记录会没，**下次要求重读一遍**（白付一回重读，《总账》R30）。
 *    这是刻意选的：钩子越简单越不会骗人。
 */
export function __resetDiskReads() {
  try {
    writeFileSync(F30_READS_FILE, '{}', 'utf8')
  } catch (e) {
    log(`F30 测试钩子清落盘失败（不影响判据）: ${e}`)
  }
}

/**
 * 把"这一份读过了"写进落盘。🔴 **fail-open**：写不进去只 `log` 一声，**绝不影响放行**
 * （插件自己写不动状态文件，不该把 AI 锁死）。整份重写（几百字节级别，不值得做增量）。
 */
function diskRemember(sid, rel) {
  if (!sid || sid === 'unknown' || typeof rel !== 'string' || rel.length === 0) return
  try {
    const all = f30DiskReads()
    all[sid] = { ...(all[sid] ?? {}), [rel]: Date.now() }
    // 写临时文件再改名：避免"写一半被杀"留下坏 JSON（坏了自己也认得出来，见上）。
    const tmp = F30_READS_FILE + '.tmp'
    mkdirSync(dirname(F30_READS_FILE), { recursive: true })
    writeFileSync(tmp, JSON.stringify(all), 'utf8')
    renameSync(tmp, F30_READS_FILE)
  } catch (e) {
    log(`F30 已读状态落盘失败（fail-open，不影响放行）: ${e}`)
  }
}

// ------------------------------------------------------------
// 会话状态（**落盘 ∪ 历史 ∪ 内存**；内存那份只当缓存）
// ------------------------------------------------------------
//
// 🔴 2026-09-20 修（病根：**把"进程"当成了"会话"**）：A 关原先只认内存里那个集合，
//    而**会话历史是恢复的、内存不是** —— 重启后它认为"一份必读层都没读"，逼着重读一批；
//    每次读＝多一次调用（《总账》R30）⇒ 每次重启白付一回。
//    现在判据**先看落盘、再看历史**（`tool/call` 里对清单内文件的 `read`），最后并上内存那份（缓存）。

const readSets = new Map() // sid -> Set<档案内相对路径>（缓存；判据见 haveWithHistory）

function sidOf(exec) {
  try {
    return sessionIdOf(exec?.agent) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function haveOf(sid) {
  let s = readSets.get(sid)
  if (!s) {
    s = new Set()
    readSets.set(sid, s)
  }
  return s
}

/**
 * 从会话历史里扫出"这个会话对哪些路径调用过 `read`"。
 *
 * ⚠️ **形状是实测的，不是猜的**（2026-09-20 从本机会话日志逐帧解压核对：
 *    `~/.dsh/sessions/<工作区>/<sid>/session.v3.jsonl.zstd`，469 帧 / 897 事件里
 *    `tool/call` 189 条、其中 `read` 44 条）：
 *      {"type":"tool/call","seq":18,"time":1789839364576,
 *       "data":{"turn":1,"step":1,"callId":"call_00_y2FARNI8sf2voGzH7bqh9721",
 *               "name":"read","arguments":"{\"file_path\": \"C:\\\\…\\\\从这开始读.txt\"}"}}
 *    —— 🔴 **`data.arguments` 是"JSON 字符串"，不是对象**，所以要 `JSON.parse` 一次。
 *    （同一条调用在 `assistant/message` 的 `content[].type==='tool-call'` 里也有一份，
 *      字段同样是字符串 `arguments`；**认 `tool/call` 这一条就够** —— 它是宿主自己 emit 的，
 *      每次调用必有一条，且与 `tool/result` 一一对应。）
 * 认不出来（坏 JSON / 陌生形状 / 历史读不到）→ 一律当作"没读到"，**绝不因此拒人**（fail-open）。
 */
function historyReadPaths(exec) {
  const out = []
  try {
    const evs = exec?.agent?.session?.events
    if (!Array.isArray(evs)) return out
    for (const ev of evs) {
      if (String(ev?.type ?? '') !== 'tool/call') continue
      const d = ev?.data ?? {}
      if (!READ_TOOLS.has(String(d.name ?? ''))) continue
      let a = d.arguments
      if (typeof a === 'string') {
        try {
          a = JSON.parse(a)
        } catch {
          continue
        }
      }
      const p = a?.file_path
      if (typeof p === 'string' && p.length > 0) out.push(p)
    }
  } catch {
    /* 历史读不出来 → 只认内存那份，绝不把判据放倒 */
  }
  return out
}

/**
 * 本会话"读过哪几份" ＝ **落盘里记过的** ∪ **历史里读过的** ∪ 内存里记的（当缓存）。
 * ⚠️ 顺序是"先落盘、再历史、最后并内存" —— 所以**重启后只要落盘或历史里读到过，就不再要求重读**
 *   （落盘是 2026-09-20 第二次修补的那层：真机实测"重启后那一刻事件流里还没有历史"）。
 * @param {object} exec `tools/pre-execute` 的 exec（含 `agent.session.events`）
 * @param {Array} items 清单条目（`{rel}`），用来把历史里的原始路径认成"哪一份"
 */
export function haveWithHistory(exec, items) {
  const s = new Set(haveOf(sidOf(exec)))
  let disk = null
  try {
    disk = diskHave(sidOf(exec))
  } catch {
    disk = null // fail-open：读不动就只认历史与内存
  }
  // 落盘那层的键可能是 `\` 或 `/` ⇒ **两种写法都塞进集合**，好跟清单里的 `rel` 直接比
  // （少了这一步，落盘那一层会"看着有、判起来没有"——第一版就是这么写错的）。
  // 🔴 2026-09-21 补：落盘里的键**还可能是一整条绝对路径**（`rememberReadOnDisk` 对"当时不在清单里"
  //    的文件记的就是绝对路径）⇒ 那份文件**后来进了清单**时，光比字符串永远对不上。
  //    实测症状：B 关说《防丢总则》"没读"、第 6 关说"本会话你已经读过它了" —— **同一份账、两关结论相反**。
  //    所以这里**再拿 `matchKnown` 认一次**（历史那一路本来就是这么做的）。
  if (disk)
    for (const r of disk) {
      s.add(r)
      s.add(toSlash(r))
      const hit = matchKnown(r, items)
      if (hit) {
        s.add(hit)
        s.add(toSlash(hit))
      }
    }
  for (const p of historyReadPaths(exec)) {
    const hit = matchKnown(p, items)
    if (hit) {
      s.add(hit)
      s.add(toSlash(hit)) // 正/反斜杠两种写法都算读过（清单里的 rel 是 `join()` 出来的）
    }
  }
  return s
}

/** 测试用：直接标记"某会话读过哪几份"。 */
export function __markRead(sid, rel) {
  haveOf(sid).add(rel)
}

/** 测试用：看某会话已读集合。 */
export function __haveRead(sid) {
  return [...haveOf(sid)]
}

// ============================================================
// 🔴 **prune 感知（2026-10-01 加 —— 用户当天点破的一个真漏）**
// ============================================================
// 用户的判断（原话）："**你的脑子里已经没有 l1 的内容了，而且绕过了 a 关，
//   因为 a 关只管你读没读过，而 a 关必须让你读不就是为了让这些东西都一直在你脑子里吗？
//   这是绕过，不是没漏。已经漏的干干净净一点不剩了。**"
//
// ⇒ 病根：**A 关记的是"读过"，可内容被 prune 剪掉之后，"读过"这个事实还在、内容却没了**
//    （用户接着点破："**水位倒转检测这里有个漏洞 —— 这轮用了 10%、裁剪裁掉 10%，油表表面上无变化**"
//     ⇒ 所以**不能靠水位倒转间接推断，要直接听 DSH 报的裁剪事件**）。
//
// ⇒ 本块做三件事：
//   ① `noteRequiredRead()` —— A 关放行一次"读必读层"时，记下**那个 read 事件的 seq**（住内存 ＋ 落盘）；
//   ② `onPruneEvent()` —— F1 的 `session/event` 把 `compaction/prune` 转交进来，
//      拿 `shadowedSeqs` 跟①对账；**命中 ⇒ 把那几份的"已读"抹掉**（内存 ＋ 落盘）；
//   ③ 抹掉之后，**A 关下一轮就会重新拦住我** —— 闸门把关，不靠自觉（这才是用户要的）。

/** 每份文件"读它时的 seq" —— `sid -> Map<rel, Set<number>>`（一个文件可能读过多次） */
const readSeqs = new Map()
const seqPath = () => join(HOME_DIR, 'memoria-f30-read-seqs.json')

function seqOf(sid) {
  let m = readSeqs.get(sid)
  if (!m) {
    m = new Map()
    readSeqs.set(sid, m)
  }
  return m
}

/** 落盘（跨重启；prune 动不了它）—— 失败只记日志，绝不影响放行 */
function saveReadSeqs() {
  try {
    const o = {}
    for (const [sid, m] of readSeqs) {
      o[sid] = {}
      for (const [rel, s] of m) o[sid][rel] = [...s]
    }
    writeFileSync(seqPath(), JSON.stringify(o), 'utf8')
  } catch (e) {
    log(`F30 read-seqs 落盘失败（fail-open）: ${e}`, { silent: true })
  }
}

/** 读回来（懒加载一次） */
let readSeqsLoaded = false
function loadReadSeqs() {
  if (readSeqsLoaded) return
  readSeqsLoaded = true
  try {
    const o = JSON.parse(readFileSync(seqPath(), 'utf8'))
    for (const [sid, m] of Object.entries(o)) {
      const t = seqOf(sid)
      for (const [rel, arr] of Object.entries(m)) t.set(rel, new Set(arr))
    }
  } catch {
    /* 没有 / 坏了 —— 当空（fail-open） */
  }
}

/**
 * 从会话历史里取"**最近一次 `read` 调用**"的 seq —— 记账就用它当坐标。
 *
 * 🔴 **2026-10-01 修的第三处（前两处：挂在"只有第一次读"的分支里 · 只扫最后 5 条）**：
 *    原实现是"取最后一条 `tool/call` **或** `tool/result`" —— 而那个 `OR` 有个洞：
 *    `tool/result` **不分是哪个工具的**，于是它会返回**别的工具**（如 `pwsh`）的 result 的 seq
 *    ⇒ **记进去的是错坐标** ⇒ 将来 prune 砍到那条时，会**误报"裁到了必读层"**（假的警报比不报更坏）。
 *    ⇒ 现在**只认 `name === 'read'` 的 `tool/call`**，且**扫全量**（不设窗口）。
 * ⚠️ 为什么"扫全量、取最后一条 read"就够：**这个函数是在"读文件被放行"那一刻调用的** ——
 *    所以"最后一条 read"**就是当前这一次**（哪怕几轮前还读过别的文件）。
 * @returns {number|null} 拿不到就 `null`（并留一行日志，**不许静默**）
 */
function currentReadSeq(exec) {
  try {
    const evs = exec?.agent?.session?.events
    if (!Array.isArray(evs)) {
      log('F30 currentReadSeq：拿不到 session.events（形状不对）', { silent: true })
      return null
    }
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i]
      if (String(ev?.type ?? '') !== 'tool/call') continue
      if (!READ_TOOLS.has(String(ev?.data?.name ?? ''))) continue
      const n = Number(ev?.seq)
      if (Number.isFinite(n)) return n
    }
    log(`F30 currentReadSeq：扫了 ${evs.length} 条事件，没找到 read 的 tool/call`, { silent: true })
  } catch (e) {
    log(`F30 currentReadSeq 出错：${e}`, { silent: true })
  }
  return null
}

/**
 * ① **A 关放行一次"读清单内的文件"时调它**：记下 `rel ↔ seq`（内存 ＋ 落盘）。
 *
 * 🔴 **2026-10-01 这一处连栽三跤**（用户追问"**我怎么好像没见到 a 关拦你重读 l1**"才揪出来）：
 *    ① 原来挂在 `if (!have.has(hit))` 里（**只有本会话第一次读才记账**）—— 可实际路径是"重读"⇒ **从没执行过**；
 *    ② `currentReadSeq` 只扫**最后 5 条**事件 —— 读完后紧跟着 result／回复 ⇒ **那条 call 早被挤出去了**；
 *    ③ 它还把**任何工具的 `tool/result`** 都当成 read 的坐标 ⇒ 记的可能是 `pwsh` 的 seq（**假坐标 = 假警报**）。
 *    ⇒ **三条一起修**（本函数挂到"每次放行" · 扫全量取最后一条 read · 只认 `name==='read'`）。
 * 🔴 **并且加"不沉默"的日志**（两条路都记）：前两次失败都是因为**它静默地什么都没做**，
 *    我只能在"重启后再看文件"这一层猜。⇒ 现在**成功／取不到 seq 都写一行**到 `memoria.log`：
 *    `grep noteRequiredRead` 就能看出它到底跑没跑、拿到没有。
 */
export function noteRequiredRead(exec, rel) {
  try {
    if (!rel) return
    loadReadSeqs()
    const sid = sidOf(exec)
    const n = currentReadSeq(exec)
    if (n === null) {
      log(`F30 noteRequiredRead：${baseOf(rel)} **取不到 seq**（记账跳过 —— 见 currentReadSeq 的日志）`)
      return
    }
    const m = seqOf(sid)
    if (!m.has(rel)) m.set(rel, new Set())
    // 记一个小区间：`tool/call` 与 `tool/result` 是两个相邻事件，prune 砍的可能是后者
    for (let k = n - 1; k <= n + 5; k++) m.get(rel).add(k)
    saveReadSeqs()
    log(`F30 noteRequiredRead：${baseOf(rel)} → seq ${n}（已落盘 · 会话 ${String(sid).slice(0, 8)}）`)
  } catch (e) {
    log(`F30 noteRequiredRead 出错（忽略）: ${e}`)
  }
}

/**
 * 🔴 **压缩成功后：本会话的"已读"账全部作废**（2026-10-01 加 · **用户点出的根**）
 *
 * 用户原话（2026-10-01，两次都指向同一个病）：
 *   · "**你的脑子里已经没有 l1 的内容了，而且绕过了 a 关，因为 a 关只管你读没读过**"
 *   · "**我在让你修 a 关的时候不是让你扩展把所有的这个类型的闸门都按照这个格式来一遍吗？
 *      怎么没调整派子会话这关？那下载前那关是不也没调。**"
 *
 * 🔴 **病**：压缩（`compaction/end`）**把整段历史揉成摘要** ⇒ 那些文件的内容**已经不在我上下文里了**，
 *    可"已读"账（内存 ＋ 落盘 `memoria-f30-reads.json`）**一份都没作废** ⇒
 *    **A 关 / B 关 / 派活关 三关全部照旧放行** —— 走的是**几小时前那张旧船票**。
 *    （实测：2026-10-01 17:40 我派子会话时，派活关没拦我；查账发现本会话 13:15 读过《派活标准》，
 *      **15:21 压缩把它揉掉了、之后又重启几次** —— 账还记着"读过"，我手上一个字都没有。）
 *
 * ⇒ **口径**：**"读过"＝"内容还在我脑子里"**（近似）。压缩把内容揉掉 ⇒ **账就该全部作废**
 *    （L1 必读 ＋ 按需必读 ＋ 派活标准，**一律重读**）。
 * ⚠️ 与 prune 的分工：**压缩 ⇒ 全清**（揉掉一大片）；**prune ⇒ 只清被裁到的那几份**（`resetReadFor`）。
 * @returns {number} 作废了几条账（给人看的读数）
 */
export function resetAllReads(sid) {
  let n = 0
  try {
    // ① 内存层：整个会话的"已读"集合清空
    try {
      const s = readSets.get(sid)
      if (s) {
        n += s.size
        s.clear()
      }
    } catch {
      /* ignore */
    }
    // ② 落盘层（跨重启那份）
    try {
      const all = f30DiskReads()
      if (all && typeof all === 'object' && all[sid] && typeof all[sid] === 'object') {
        n += Object.keys(all[sid]).length
        all[sid] = {}
        writeFileSync(F30_READS_FILE, JSON.stringify(all), 'utf8')
      }
    } catch (e) {
      log(`F30 resetAllReads 落盘清空失败（fail-open）: ${e}`, { silent: true })
    }
    // ③ prune 的 seq 账也清掉（那份是配合裁剪用的，压缩后同样作废）
    try {
      seqOf(sid).clear()
      saveReadSeqs()
    } catch {
      /* ignore */
    }
    log(`F30 🔴 压缩后作废"已读"账：会话 ${String(sid).replace(/^session-/, '').slice(0, 8)} · **${n} 条** —— 下一轮三关（A / B / 派活）都会重新拦住我，逼我重读`)
  } catch (e) {
    log(`F30 resetAllReads 出错（忽略，绝不影响压缩本身）: ${e}`)
  }
  return n
}

/** ③ 把若干份的"已读"抹掉（内存 ＋ 落盘）—— 抹完 A 关会重新拦住我 */
export function resetReadFor(sid, rels) {
  if (!rels || rels.length === 0) return 0
  let n = 0
  for (const rel of rels) {
    // 🔴 **2026-10-01 修（测试逮出来的真 bug）**：**两种写法都要删**（正/反斜杠）。
    //    因为 `haveWithHistory()` 往集合里**同时塞了 `hit` 与 `toSlash(hit)` 两份**（第 754 行那两行）——
    //    只删一种 ⇒ **另一种还留着 ⇒ 集合里仍然"有它" ⇒ A 关照样放行 ⇒ 永远不会逼我重读**
    //    （实测：测试里 `__markRead` 用正斜杠、而 `hit` 是反斜杠 ⇒ 抹不掉 ⇒ 断言当场挂）。
    for (const v of new Set([rel, toSlash(rel), String(rel).replace(/\//g, '\\')])) {
      try {
        if (haveOf(sid).delete(v)) n += 1
      } catch {
        /* ignore */
      }
    }
  }
  // 落盘那份：**照它的真实结构改**（`{sid: {rel: 记得的东西}}`，读入函数就是 `f30DiskReads()`）
  try {
    const all = f30DiskReads()
    const mine = all?.[sid]
    if (mine && typeof mine === 'object') {
      for (const rel of rels) {
        for (const k of Object.keys(mine)) {
          if (k === rel || String(k).endsWith(rel) || String(k).includes(rel)) delete mine[k]
        }
      }
      writeFileSync(F30_READS_FILE, JSON.stringify(all), 'utf8')
    }
  } catch (e) {
    log(`F30 重置落盘已读失败（fail-open）: ${e}`, { silent: true })
  }
  return n
}

/**
 * 从一条事件里抠出"它读了哪几份文件"（**按内容判，不靠记账**）。
 *
 * 🔴 为什么改用这个（2026-10-01 · 同一件事栽了四跤之后的最终方案）：
 *    "记账 seq"那条路**依赖三件都对**（读的那一刻记 · 记得准 · 对得上），而实测**三件都没成**：
 *    ① 记账挂在"只有第一次读"的分支里 ⇒ 从没执行；② `currentReadSeq` 只扫最后 5 条 ⇒ 取不到；
 *    ③ 它还把任何工具的 `tool/result` 当 read 的坐标；④ **`exec.agent.session` 上根本没有 `events`**
 *       （日志原话："**拿不到 session.events（形状不对）**" —— 而 `session.eventAt(seq)` 是有的，F22 一直在用）。
 *    ⇒ **换成"裁到什么、就看什么"**：prune 给了 seq ⇒ 用 `session.eventAt(seq)` 取回原文 ⇒
 *      看那份原文**是不是"读某份文件"的结果** ⇒ 是必读层的就重置闸门。**不再需要任何记账。**
 * @returns {string[]} 这批事件里"被读过的路径"（read 的结果形如 `<path>C:\…\铁律.md</path>\n<type>file</type>…`）
 */
function readPathsOfEvent(ev) {
  const out = []
  try {
    const parts = ev?.data?.message?.content
    if (!Array.isArray(parts)) return out
    for (const p of parts) {
      const t = String(p?.text ?? '')
      const m = t.match(/<path>([^<]+)<\/path>/)
      if (m) out.push(m[1])
    }
  } catch {
    /* 形状不对就当没有 */
  }
  return out
}

/**
 * ② F1 把 `compaction/prune` 转交进来 —— 判"这次裁掉的里面有没有必读层的内容"。
 * @returns {{hit:string[], seqs:number[]}} 命中的必读文件（空数组 ＝ 没裁到必读层）
 */
export function onPruneEvent(session, event) {
  try {
    const sid = typeof session?.id === 'string' ? session.id : 'unknown'
    const seqs = Array.isArray(event?.data?.shadowedSeqs) ? event.data.shadowedSeqs.map(Number) : []
    const n = Number(event?.data?.shadowedTokenCount) || 0
    // ⚠️ **2026-10-01 修**：原来写 `slice(0, 8)` —— 可 session id 带 `session-` 前缀
    //    ⇒ 日志里全成了 `sid=session-`（**一点信息量都没有**）。
    //    实测代价：我按 sid 查日志时**当场查了个空**，还以为"本会话从没 prune 过"，白绕一圈。
    //    判据：**先剥前缀再截**（与 `shortSid()` 同一口径 —— 别处一律用它）。
    log(`F30 prune：裁掉 ${seqs.length} 条 / ${n} token · sid=${String(sid).replace(/^session-/, '').slice(0, 8)}`)
    if (seqs.length === 0) return { hit: [], seqs }

    /** 本会话的必读清单（现算，不另立一份） */
    let items = []
    try {
      const L = requiredList()
      items = [...(L?.files ?? []), ...scopedNeeds()]
      // 🔴 **2026-10-01 补（用户点出的漏）**：**《派活标准》也要进来** ——
      //    用户原话："**我在让你修 a 关的时候不是让你扩展把所有的这个类型的闸门都按照这个格式来一遍吗？
      //    怎么没调整派子会话这关？**"
      //    它由"派活关"单独管、**不在上面两个清单里** ⇒ prune 感知原来够不着它。
      //    ⚠️ 同类的"按需必读"若将来再加，也一律往这儿挂（别只挂在自己那一关上）。
      const pb = curRelOf('派活标准.md')
      if (pb) items.push({ rel: pb })
    } catch {
      items = []
    }
    const byBase = new Map() // basename → rel（降级判据用）
    for (const it of items) {
      const rel = typeof it === 'string' ? it : (it?.rel ?? '')
      if (rel) byBase.set(baseOf(rel), rel)
    }

    const hit = new Set()
    const at = typeof session?.eventAt === 'function' ? session.eventAt.bind(session) : null
    if (!at) log('F30 prune：session 上没有 eventAt ⇒ 只靠记账判据（内容判据用不了）')
    let grabbed = 0
    const loose = [] // 降级命中的（没抠到 <path>，只按文件名撞上的）—— 日志里单独标出来
    for (const s of seqs) {
      let ev = null
      try {
        ev = at ? at(s) : null
      } catch {
        ev = null
      }
      if (!ev) continue
      grabbed += 1
      const paths = readPathsOfEvent(ev)
      if (paths.length > 0) {
        for (const p of paths) {
          const r = matchKnown(p, items)
          if (r) hit.add(r)
        }
      } else {
        // 降级：抠不到 <path> 时**宽松搜文件名**（宁可多读一遍，也别漏）—— 但日志里**标明**是降级命中
        let txt = ''
        try {
          txt = JSON.stringify(ev?.data ?? {})
        } catch {
          txt = ''
        }
        for (const [b, rel] of byBase) {
          if (b.length >= 2 && txt.includes(b)) {
            hit.add(rel)
            loose.push(rel)
          }
        }
      }
    }
    log(`F30 prune：按 seq 取回 ${grabbed}/${seqs.length} 条原文`)

    // 记账判据**保留作为兜底**（两条路都查得更好；命中并集）
    loadReadSeqs()
    const m = seqOf(sid)
    for (const [rel, ss] of m) {
      if (seqs.some((x) => ss.has(x))) hit.add(rel)
    }

    const list = [...hit]
    if (list.length === 0) return { hit: [], seqs }
    const cleared = resetReadFor(sid, list)
    capTick('F30', 'prune 后重置必读已读')
    log(
      `F30 🔴 prune 裁到了必读层：${list.join(' / ')}` +
        (loose.length > 0 ? `（其中降级命中：${[...new Set(loose)].join(' / ')}）` : '') +
        ` —— 已把它们的"已读"抹掉（${cleared} 份），**下一轮 A 关会重新拦住我、逼我重读**`,
    )
    return { hit: list, seqs }
  } catch (e) {
    log(`F30 onPruneEvent 出错（忽略，绝不因此拦人）: ${e}`)
    return { hit: [], seqs: [] }
  }
}

// ------------------------------------------------------------
// 三道关
// ------------------------------------------------------------

/** D 关：`.ps1` 只许 ASCII（内容 ＋ 路径）。 */
export function asciiVerdict(name, args) {
  if (!WRITE_TOOLS.has(name)) return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  if (!/\.ps1$/i.test(p)) return null

  if (/[^\x00-\x7F]/.test(p)) {
    return {
      tag: 'ps1-路径非ASCII',
      reason:
        `F30 先停一下：要写的脚本路径里有非 ASCII 字符 ——\n  ${p}\n` +
        'PowerShell 5.1 按 ANSI 读脚本，路径带中文会让它连"列表文件在哪"都读不对（R2 第②次：空跑 0 项）。\n' +
        '改成：脚本放进纯 ASCII 的目录，中文只留在它运行时读入的 UTF-8 数据文件里。',
    }
  }

  const body = [args?.content, args?.new_string].filter((x) => typeof x === 'string').join('\n')
  if (/[^\x00-\x7F]/.test(body)) {
    const bad = body.match(/[^\x00-\x7F]/g) ?? []
    return {
      tag: 'ps1-内容非ASCII',
      reason:
        `F30 先停一下：要写的 .ps1 正文里有 ${bad.length} 个非 ASCII 字符（${[...new Set(bad)].slice(0, 8).join('')} …）。\n` +
        '依据《铁律》第 3 条：PS 5.1 按 ANSI 读整个文件，**连注释里的中文都会把后面读崩**（R2 犯过 5 次）。\n' +
        '改成：脚本纯 ASCII；中文放进"运行时读入"的 UTF-8 列表文件，用 [System.IO.File]::ReadAllLines($f, [Text.Encoding]::UTF8) 读。\n' +
        '（写完再跑 Select-String 自检是事后补；这里是写之前就拒。）',
    }
  }
  return null
}

/**
 * E 关（**第四道**）：绝不用 `write`/`edit` 手改 `cordis.patch.yml`。
 *
 * 依据《铁律》**§二**："运行中的控制台，绝不手改 `cordis.patch.yml`"。
 * 为什么危险：`profiles/<x>/cordis.patch.yml` 那个 profile 是 **`patchReload: live`** ——
 *   **手改它立刻热重载**；2026-09-05 因此把控制台**弄死过三次**（《AI错误总账》**R3**）。
 * 正确做法：装插件走 `dsh plugin --profile web add <pkg>`；
 *   真想看配置用 `cmd /c "dsh --profile web --dump-config"`（那是**只读**的）。
 *
 * ⚠️ **只拦写、不拦读**（`read` 不属 `WRITE_TOOLS`）—— 看是允许的，改才拦。
 * ⚠️ 判据纯机械：`WRITE_TOOLS` ＋ 路径规范化（`\`→`/`）后**以 `cordis.patch.yml` 结尾**。
 *    fail-open 由调用方负责（`registerF30` 那个 catch）。
 */
export function patchVerdict(name, args) {
  if (!WRITE_TOOLS.has(name)) return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  if (!p) return null
  const s = toSlash(p).toLowerCase()
  if (!s.endsWith('cordis.patch.yml')) return null
  // 🔴 2026-10-20 **修窄**：只拦 **profile 的那一个**（`profiles/<名字>/cordis.patch.yml` ——
  //    它才是 `patchReload: live`，手改立刻热重载）。
  //    原来按"文件名结尾"一刀切，连**插件自带的配置模板**（`plugins/dsh-memoria/cordis.patch.yml`）
  //    也一起拦了 —— 那个是启动时读一次的模板，改了不触发热重载，不该拦。
  if (!/\/profiles\/[^/]+\/cordis\.patch\.yml$/.test(s)) return null
  return {
    tag: '手改 cordis.patch.yml',
    reason:
      `F30 先停一下：\`cordis.patch.yml\` 不能手改（\`${name}\`）——\n  ${p}\n` +
      '① 依据《铁律》§二："运行中的控制台，绝不手改 `cordis.patch.yml`"。\n' +
      '② 为什么危险：那个 profile 是 **`patchReload: live`** —— **手改它立刻热重载**，' +
      '2026-09-05 因此把控制台**弄死过三次**（《AI错误总账》R3）。\n' +
      '③ 正确做法：装插件走 `dsh plugin --profile web add <pkg>`；' +
      '真想看配置用 `cmd /c "dsh --profile web --dump-config"`（那是**只读**的，不会触发重载）。\n' +
      '（只是 `read` 看它不会触发这条；**改**才触发。）',
  }
}

// ------------------------------------------------------------
// 第 17 关 · 永久删要「人批准」（2026-09-27 加 · 用户要的"罩子"）
// ------------------------------------------------------------
//
// 用户原话〔会话 2026-09-27〕：
//   "按防丢总则来。当初立这个规矩是**防止你对文件进行永久删除导致无法逆转的丢失**。我们需要将
//    这份'**流水线**'对接死，**自动化结束直接删除。而你不能使用这个直接删除的口子**。类比一下就是
//    **给这套流程罩个罩子**，避免你直接使用这个口子对文件进行直接删除。**但要留下检修口**否则坏了
//    你也没法碰那不炸了。"
//
// 判据：`pwsh` 命令里出现 `-Permanent`（＝ `tools/recycle-del.ps1` 的永久删开关）→
//   **除非用户最近那一句里带固定格式的准许**（`指令准许：…`），否则**硬拒**。
// ⚠️ 自动流水线（插件 F19）**不经这个口子** —— 所以这一关**只管我**。
//    它走的是包内的 `recycle-del.ps1`（`common.js` 的 `l9PermanentDelete` 默认 `false` ⇒ **进回收站**，
//    运行时 `memoria-l9.json` 也记着 `"mode":"回收站"`）。
// ⚠️ 姿态：取不到用户的话 → **拦**（这一关宁可多问一句，不可误开；与用户"罩子"的原意一致）。

/** 永久删的开关（与 `tools/recycle-del.ps1` 的 `-Permanent` 对应）。 */
const PERMANENT_RE = /-Permanent\b/i

export function purgeVerdict(name, args) {
  const isPwsh = name === 'pwsh' || String(name ?? '').endsWith('pwsh')
  if (!isPwsh) return null
  const cmd = typeof args?.command === 'string' ? args.command : ''
  if (!cmd || !PERMANENT_RE.test(cmd)) return null
  let said = []
  try {
    said = userSaidTexts()
  } catch {
    said = []
  }
  const last = said.length > 0 ? String(said[said.length - 1] || '') : ''
  if (APPROVE_RE.test(last)) return null // 用户当场给了固定格式准许 → 放行（这就是"检修口"）
  return {
    tag: '永久删要人批准',
    reason:
      'F30 先停一下：**永久删（`-Permanent`）要用户当场点头** ——\n' +
      '① 依据：用户 2026-09-27 定「**给这套流程罩个罩子**……**而你不能使用这个直接删除的口子**」；\n' +
      '② 出路（机械的）：\n' +
      '   · 只是想**清东西** → 去掉 `-Permanent`，走回收站那条路（那是默认）；\n' +
      '   · **确实要永久删** → 回来问用户，请他给一句固定格式的准许：`指令准许：<要删什么>` ——\n' +
      '     他给了之后，**再发同一条命令即放行**（这一关只拦到"他说话"为止）；\n' +
      '③ 自动流水线不受这一关管（插件 F19 删自己的快照走 `rmSync`，根本不经过这个脚本）。',
  }
}

/** B 关：按需必读（只拦写/改；只看不拦）。 */
export function scopedVerdict(exec, name, args) {
  const isPwsh = name === 'pwsh' || String(name ?? '').endsWith('pwsh')
  if (!WRITE_TOOLS.has(name) && !isPwsh) return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  const cmd = typeof args?.command === 'string' ? args.command : ''
  if (!p && !cmd) return null
  const have = haveWithHistory(exec, scopedNeeds())
  for (const s of SCOPED_READS) {
    // ⚠️ 同一份清单、两种触发面：`match` 按**目标路径**（管文件范围）· `cmd` 按**命令文本**（管动盘动作）。
    const hit = s.cmd
      ? Boolean((cmd && s.cmd.test(cmd)) || (s.archiveWrite && p && toRel(p) !== null))
      : Boolean(p && s.match && s.match.test(p))
    if (!hit) continue
    // 🔴 2026-09-29：**按文件名兜底**（清单里现在只写文件名；历史账本里可能存的是带层的旧写法）
    //    —— 纯放宽：原来路径对得上的照认，另多认"同名那份"，**不会比原来更严**（防 B 关自锁）。
    const haveNames = new Set([...have].map((h) => baseOf(h)))
    const missing = s.need.filter((rel) => !have.has(rel) && !haveNames.has(baseOf(rel)))
    if (missing.length > 0) {
      return {
        tag: '按需必读未读',
        reason:
          `F30 先停一下：动「${s.what}」之前，先把它那份必读文档读完 ——\n` +
          missing.map((rel) => '· ' + rel).join('\n') +
          `\n${s.because}\n` +
          '（只看不写不会触发这条；写/改才触发。）',
      }
    }
  }
  return null
}


// ------------------------------------------------------------
// **派活关**（2026-09-29 加 · 用户批"那就挂上吧"）—— 派子会话之前，先读《派活标准》
// ------------------------------------------------------------
//
// 为什么有它（`AI错误总账` **R24 第 3 次**）：`L4-施工\_派活标准.md` 第 4 行明写
//   「🕐 什么时候用：**任何一次派活之前**」，而我 2026-09-29 **派子会话之前没去读它** ——
//   是用户提醒「**动子会话之前先看派活规则**」才发现。**光写规矩挡不住我** ⇒ 挂物理约束。
//   （同一天还漏了它 §四 第 2 条："派'读全档'的活时，我自己别同时改档案"。）
//
// 判据：调 `subagent` / `subagent_fork` 时，**本会话读过《派活标准》没有**（复用"读过没"那套记账）；
//   没读过 ⇒ **拦一次**、指名那份文件；读了再发一次同一个调用即放行。
// ⚠️ 与 B 关（按需必读）**同形态**；**不会死锁** —— 读那份文档本身不需要任何前置许可。
// ⚠️ 文案**按名字指、不写死路径**（2026-09-29 起 `L4-施工\` 正在改名，写死就会立刻过时）。

export function playbookGateVerdict(exec, name, args) {
  const n = String(name ?? '')
  if (!SUBAGENT_TOOLS.some((t) => n === t || n.endsWith(t))) return null
  // ⚠️ 2026-10-20（发布前）：**档案里没有这份文档就放行（fail-open）**。
  //    新用户的骨架（`f20-init`）不带《派活标准》—— 否则他会卡死在这里：
  //    拒 → 读不到 → 再拒，永远派不出子代理，而且他自己走不出来。
  try {
    if (!findByNameUnique('派活标准')) return null
  } catch {
    return null
  }
  const rel = curRelOf('派活标准.md')
  const have = haveWithHistory(exec, [{ label: '派活前必读', name: '派活标准.md', rel }])
  const read = have.has(rel) || [...have].some((h) => baseOf(String(h)) === baseOf(rel))
  if (read) return null
  return {
    tag: '派活前必读未读',
    reason:
      'F30 先停一下（**派活关**）：**派子会话之前，先把《派活标准》读完** ——\n' +
      '  · 《派活标准》（`L4-施工\\` 下，按名字找得到；当前文件名可能是 `_派活标准.md` 或 `工程-派活标准.md`）\n' +
      '  ⚠️ 它第 4 行写着「什么时候用：**任何一次派活之前**」—— 缺了它，交代就会漏段\n' +
      '     （2026-09-29 我第一次派活时就漏了它 §四 第 2 条：**派"读全档"的活时，我自己别同时改档案**）。\n' +
      '  ⇒ 读它（一次即可，整场会话有效），**再发一次同一个调用**就放行。\n' +
      '（依据：用户 2026-09-29「动子会话之前先看派活规则」＋ 批准挂闸门；同族见 `AI错误总账` R24 第 3 次）',
  }
}

// ------------------------------------------------------------
// 第 15 关 · 你提到「U 盘」→ 先读《动U盘前必读》（2026-09-27 加 · **判据是你设计的**）
// ------------------------------------------------------------
//
// 用户原话（2026-09-27）：
//   "其实我觉得判据可以不依靠代码调动。而是依靠我的原文。比如我在我要求你动u盘的时候。
//    检测到我提出u盘两个字就触发一次，只拦截一次让你读，你自己判断要不要去读，再发起一次就通行。
//    本身我们没事就很少提及u盘。所以这个闸门很少会被触发。真触发了，你判断只是我们聊天聊到，
//    那也可以直接再发起一次当做无事发生。真有u盘插在电脑上并且需要你在上面工作的时候，
//    你不会选择不读的。"
//
// 为什么这个判据比"看命令里有没有 recycle-del"更准：
//   · 动盘这件事**总是从用户那句话开始的**（他说"动一下 U 盘"）；命令文本看不到盘符
//     （盘符都在 `-ListFile` 指的那个列表文件里）⇒ 命令判据只能宽，宽就吵；
//   · 而"他提到 U 盘"**天然稀少** ⇒ 触发面小、又正对着真实场景。
// 🔴 **软闸门**：同一个会话只软拒一次（"拒过的 key"记在内存 Map 里、用掉就删）——
//    "这次只是聊天聊到"完全可能，把判断权留给判的人，别把人锁死。
// ⚠️ fail-open 照旧：取不到你说的话 / 判据出错 → 放行（"探测不到 ≠ 不存在"）。

/**
 * 第 15 关的**触发表** —— 一条 ＝「你说的话里出现这些词」→「该读哪一份」。
 * 🔴 **判据一律取"用户原话"，不看工具调用**（用户 2026-09-27 定的："判据不依靠代码调动，依靠我的原文"）。
 *    为什么要这样：这些事**总是从你那句话开始**的；从工具调用入手会**牵连到共用同一条路的别人**
 *    （实测：`recycle-del` / `move-verify` 本机搬运与 U 盘搬运共用 ⇒ 挂在它们上，每次搬本机文件都要读 U 盘文档）。
 * ⚠️ 词表刻意**宽**：多提一句词只多提醒一次（几秒钟），漏了才是真出事。
 */
const TALK_TRIGGERS = [
  {
    id: 'disk',
    re: /u\s*盘|usb|移动硬盘/i,
    rel: '动U盘前必读.md', // 🔴 2026-09-29：只写文件名（层路径交给现算）
    what: 'U 盘',
    why:
      '**认盘一律按卷序列号**（绝不用盘符或卷标 —— 两个私盘卷标同名）· 公 / 公私 / 私 三个筐怎么分 ·\n' +
      '  搬到哪之前先确认目标 · 2026-09-14 丢过 8 个文件，全是"搬运命令写错"。',
  },
  {
    id: 'download',
    re: /下载|下个|抓取|拉一下|yt-dlp/i,
    rel: '参考-下载东西知识.md', // 🔴 2026-09-29：只写文件名（层路径交给现算）
    what: '下载',
    why:
      '里面是**下载各种东西踩过的坑与解法**（被限速 · 镜像 · 先 HEAD 探测 · 大文件走 BITS · 哪些源不通）——\n' +
      '  动手前对一眼"这次属于哪一种"，能省掉大量等待时间。',
  },
  // 🗑 **2026-09-27 取消「读会话」这一条**（用户当天想清楚后拍板）：现在**销账机制已经完备** ——
  //    要"读上一个会话"时，读**骨架**（`~\.dsh\memoria/memoria-dumps\skeleton\`）或**梅莫莉亚的留底备份**就够了，
  //    **根本不需要碰 `~/.dsh/sessions/` 的会话原文**。用户原话："**我觉得不碰 dsh 是对的。或许这个闸门该取消？**"
  //    ⇒ 取消这一条。⚠️ 但**第 10 关留着**（`sessionReaderVerdict`：拦"自己写解压器读会话日志"）——
  //      那一道才是真正在守"不碰 dsh"的关；本关只管"提醒去读某份文档"，留着它反而**把人往那条路上引**。
]

/** 已软拒过一次的记号（key ＝ 触发项 id ＋ sid；**只在内存**，重启即清）。 */
const talkAsked = new Set()

/** 第 15 关：你说的话里出现触发词 → 软提醒一次（再发一次即放行）。 */
export function diskTalkVerdict(exec, name, args) {
  const sid = sidOf(exec)
  const said = userSaidTexts(sid)
  if (!said || said.length === 0) return null // 拿不到材料 → 放过
  const last = String(said[said.length - 1] || '')
  for (const t of TALK_TRIGGERS) {
    if (!t.re.test(last)) continue
    const key = `${t.id}::${sid || '_'}`
    if (talkAsked.has(key)) continue // 这一项已软拒过一次 → 放行
    // 🔴 2026-09-29：清单里只写文件名 ⇒ 这里**现算**成真实相对路径（同 B 关口径）；
    //    判定再加一层**文件名兜底**（纯放宽：原来路径对得上的照认，另多认"同名那份"）。
    const relNow = curRelOf(t.rel)
    const items = [{ label: '按需必读', name: baseOf(t.rel), rel: relNow }]
    const haveTalk = haveWithHistory(exec, items)
    if (haveTalk.has(relNow) || [...haveTalk].some((h) => baseOf(h) === baseOf(t.rel))) continue // 本会话读过了
    talkAsked.add(key)
    return {
      tag: `你提到「${t.what}」（软闸门）`,
      reason:
        `F30 提醒（**只拦这一次**）：你刚提到 **${t.what}** ——\n` +
        `· 要不要先读一眼 \`${t.rel}\`？\n` +
        `  ${t.why}\n` +
        '① 只是聊天聊到 / 这次不干这件事 → **再发一次同一个调用，直接放行**（这一关只拦一次，你自己判断）。\n' +
        '② 真要干 → 先 `read` 它（读一次，整场会话不再啰嗦）。\n' +
        '（判据＝**你那句话里出现了触发词**；你 2026-09-27 定的："判据不依靠代码调动，依靠我的原文"。）',
    }
  }
  return null
}

/** 测试用：清掉"已软拒过"的记号（第 15 关）。 */
export function __resetDiskTalk() {
  talkAsked.clear()
}

// 🗑 **第 16 关（待办软闸门）整块删净**（2026-09-27 加 → 2026-10-07 不再拽回合 → 2026-10-20 删代码与测试）。
//    用户当年的判据保留在 CHANGELOG 0.30.0 一带；现在的姿态是**只在留意栏报一行**（F26），不拦人。
//    🔴 别照旧记录把它加回来 —— 用户明确说「**待办这事老拦人挺烦的**」。


/** A 关：必读层（读齐之前，只放行"读清单里那几份"）。 */
// ⚠️ 放在这儿（不在文件头）是为了少动一处 —— ESM 的 `import` 允许出现在模块顶层任意位置。
import { userSaidTexts } from './said.js'

const SUBAGENT_TOOLS = ['subagent', 'subagent_fork']
// 🔴 **2026-09-27 改成固定格式**（用户当天〔会话 2026-09-27〕："批准词这个我觉得不对。或者说
//    **批准词应该带有命令，指令的感觉才行，这方面之前是个漏洞**……例如原本你检测到我说
//    **删除**，你才能删除。变成检测到我说**指令准许：删除**。才能删除。这样就**避免了我在日常
//    跟你沟通的时候误触导致给你开口子的情况**。"）
// ⚠️ 原来（下面这行是旧版，照留）是一串口语词 `合适|可以|行|没问题|就这么|够了|照这么|你定|同意|好的|ok`
//    —— 用户随口一句"可以"就等于开了一次口子。现在**只有固定格式**才算：
//    `指令准许：<要准许的那件事>`（半角 / 全角冒号都认，后面必须有非空内容）。
// 旧版（2026-09-20 补的，已作废）：const APPROVE_RE = /(合适|可以|行|没问题|就这么|够了|照这么|你定|同意|好的|ok)/i
const APPROVE_RE = /指令准许\s*[:：]\s*\S/
const NUM_RE = /(?:预算|上限|次数|工具调用|子会话)[^0-9]{0,10}(\d{1,3})|(\d{1,3})\s*次/

// 🗑 **第 9 关（本回合调用额度）已整块删净**（2026-09-20 起不再拦人，2026-10-20 删代码与测试）。
//    当年的判据与数据留在 CHANGELOG 0.52.0 一带；**别再照旧记录把它加回来** ——
//    用户否掉它的两条理由仍然成立：拦一次要用户回话（他花钱又搭注意力）· 那个数本身不准。

// 🔴 2026-10-20（差点删错）：`EXEMPT_TOOL_RE` **不是第 9 关的**，它管的是**计数豁免**
//    （`noteToolCall()` 里判"`dangan_*` 不算一次伸手"）。删第 9 关时被一起带走，
//    测试 `f31-claim.mjs` 当场 `ReferenceError` 抓到 —— 所以它留在原处、**不许跟着删**。
const EXEMPT_TOOL_RE = /dangan/i


// 🗑 `noteUserGrant()` / `__resetTurnLimit()` / `turnLimitVerdict()` 三件 2026-10-20 删净
//    （第 9 关整块退役）。`turnGranted` / `grantedOn` 这两个记账变量也随之没了。



/**
 * 🔴 **2026-10-01 加：「必读层必须读全」**（用户原话："**那看来需要给 a 关加新的条件了，不能只读片段，必须全读。可以做到吗？？**"）
 *
 * 病（当天我自己犯的）：为了省上下文，读 L1 时**只读前 8 行**就让它把"已读"记上
 *   ⇒ **内容根本没进上下文，账却满了** ⇒ 那正是"旧船票"的翻版，**而且是我自己绕自己设的门**。
 *
 * 判据（只看 `read` 的参数，不用等结果 —— 简单、可机械判）：
 *   · **既没给 `offset`、也没给 `limit` ⇒ 一次读全 ⇒ 算读过**；
 *   · **给了任一个 ⇒ 只是片段 ⇒ 不算**（下一轮 A 关照样拦我，并说明"只读了片段"）。
 *   ⚠️ 为什么不做"分段累计"（1-8 再 9-178 合起来算全读）：那套要维护行区间、还要读文件数行，
 *      代码多一倍且当场就出了"两次 key 不一致导致不合并"的毛病；**而 L1 那几份都不大，一次读得完**
 *      ⇒ **简单版更严、也更不容易自己骗自己**。
 *   ⚠️ **读不到行数/文件**时不影响判据（本判据根本不读文件）。
 */
function readWholeFile(args) {
  const off = Number(args?.offset)
  const lim = Number(args?.limit)
  return !(off > 0) && !(lim > 0)
}

/** 测试钩子：把上面那条判据单独暴露出来（`verdict` 链在测试夹具里走不到 A 关那一段，详见 ㉑ 那块注释） */
export function __readWholeFile(args) {
  return readWholeFile(args)
}

export function requiredVerdict(exec, name, args) {
  const L = requiredList()
  if (L.error) {
    capTick('F30', '清单解析失败')
    log(`F30 ⚠️ 必读清单解析失败：${L.error}（本轮放行 —— fail-open）`)
    return null
  }
  const sid = sidOf(exec)
  // 判据：**落盘里记过的 ∪ 历史里读过的 ∪ 内存里记的**（任一命中即算已读 —— 2026-09-20 修）
  const listItems = [...L.files, ...scopedNeeds()]
  const have = haveWithHistory(exec, listItems)

  // 这一调用若是在读"允许读的清单"里的某一份 → 记下（内存 ＋ **落盘**）＋ 放行
  // ⚠️ 清单＝A 关那几份 ∪ **B 关点名的几份**（少了后者就死锁，见 `scopedNeeds()` 的注释）。
  if (READ_TOOLS.has(name)) {
    const hit = matchKnown(args?.file_path, listItems)
    if (hit) {
      // 🔴 **2026-10-01 加：必须"一次读全"才算读过**（用户："**不能只读片段，必须全读**"）。
      //    给了 `offset` 或 `limit` ⇒ 只是片段 ⇒ **不记账**（下一轮 A 关照样拦我）。
      if (!readWholeFile(args)) {
        capTick('F30', '只读了片段')
        log(`F30：${baseOf(hit)} 只读了片段（带 offset/limit）⇒ 不算读过 —— 整份读完 A 关才放行`)
        return null
      }
      if (!have.has(hit)) {
        have.add(hit)
        haveOf(sid).add(hit) // 顺手落进内存那份当缓存
        capTick('F30', `已读 ${have.size} 份`)
        log(`F30：记下已读 ${hit}`, { silent: true })
      }
      // 🔴 **2026-10-01 修（真事故逼出来的）**：记账原来挂在上面那个 `if (!have.has(hit))` 里 ——
      //    那意味着**只有"本会话第一次读这一份"才记账**。可**实际路径是"重读"**
      //    （A 关的"已读"有三层：落盘 ∪ 历史 ∪ 内存 ⇒ 早就满了、一直放行）⇒
      //    **记账从没执行过** ⇒ `memoria-f30-read-seqs.json` 里只有测试造的假会话
      //    ⇒ **prune 感知永远"账是空的、永远不命中"**（用户当天追问："我怎么好像没见到 a 关拦你重读 l1"）。
      //    ⇒ **改挂到"A 关放行了一次读清单内的文件"这个动作上 —— 不管是不是第一次。**
      //    每读一次刷新一次账（**最新那次读的 seq 才是该盯的**）。
      noteRequiredRead(exec, hit)
      // 🔴 2026-09-21：**落盘写入挪到 `registerF30`（判完再写）** —— 原来写在这儿，
      //    于是同一次 `verdict()` 里排在后面的**第 6 关**会读到"刚刚写进去的这一条"，
      //    把**这一次**的读看成**上一次**的读 ⇒ **自己把自己绊倒**
      //    （实测：`读铁律（绝对路径）→ 放行` / `用档案内相对路径也能认` 两条断言当场挂）。
      //    挪走之后：第 6 关看到的永远是"上一次"的状态；顺带让测试（直接调 `verdict()`、
      //    不走注册点）**完全碰不到落盘**，天然隔离，不再需要清状态。
      return null
    }
  }

  const missing = L.files.filter((f) => !have.has(f.rel))
  if (missing.length === 0) return null

  // 🔴 **2026-10-22 修死锁**（用户亲测到）：新会话**连档案根在哪都不知道** ⇒ 它要 `pwsh` / `glob` / `grep`
  //    去找，可 A 关只放行 `read`（还是"清单里那几份"）⇒ **找路的工具被锁在门外** ⇒
  //    「不知道在哪 → 要查 → 被拦 → 读不了必读 → 永远不知道在哪」**死循环**。
  //    用户当天截图里那个新会话就是这么卡住的。
  //
  //    ⇒ **放行"只读探查"**：`glob` / `grep` / `pwsh`。
  //    ⚠️ **为什么放 `pwsh` 是安全的**：它的**写 / 删 / 搬已经被第 11 关整个堵掉**
  //       （`Remove-Item` / `Set-Content` / 重定向… 全部当场拒），A 关再拦一遍是**重复**，
  //       而代价是"连目录都不能列"。真正会改东西的 `write` / `edit` **照样拦**。
  //    ⚠️ 副作用**是好的**：用 `pwsh` 读必读也算读（内容确实进了上下文），不违背 A 关的本意。
  if (EXPLORE_TOOLS.has(String(name ?? ''))) return null

  return {
    tag: '必读层未读完',
    reason:
      `F30 先停一下：本会话还没读齐必读层（入口 ＋ 读序那几行），还缺 ${missing.length} 份 ——\n` +
      missing.map((f) => `· [${f.label}] ${f.rel}`).join('\n') +
      '\n依据《铁律》§四：必读层**整份读、不设任何阈值**（"必读层长大了是该拆它的信号，不是放宽纪律"）。\n' +
      '先把上面这几份读完再动手；只是聊天、不调工具，不会触发这条。',
  }
}


/**
 * 路径归一化（照本文件现有做法：`\`→`/` ＋ 去尾斜杠 ＋ 统一小写；
 * 档案内的文件先归成**档案内相对路径**，这样"绝对写法"与"相对写法"认成同一份）。
 */
function normPath(p) {
  const n = toSlash(p).trim().replace(/\/+$/, '')
  const rel = toRel(n)
  return String(rel ?? n).toLowerCase()
}





/**
 * 第 0 关（**必须最先判**）：`~/.dsh/AGENTS.md` 只读 —— 改它**先问用户**，没有第二条路。
 *
 * 依据（用户两次表态，原文不许改写）：
 *   · 2026-09-17 就定过它改动的规矩是"**成果先放桌面待确认**"；
 *   · 2026-09-20 用户又当场拍板："**这个必须堵死**" —— 因为 AI 未经他同意就改了这个文件。
 * 为什么必须堵在机制上：`~/.dsh/AGENTS.md` 是**每一轮都注入、权重最高**的那份文件 ——
 *   写规矩防不住（本文件头部的结论：真正能防住的是"不让危险动作出现"）。
 *
 * 判据（纯机械）：工具名 ∈ `WRITE_TOOLS`（`write`/`edit`）**且** `args.file_path`
 *   **规范化后**（`\`→`/`、去尾斜杠、统一小写）**等于 `HOME_DIR/AGENTS.md`** ⇒ 拒。
 *   · **只认这一个文件** —— 就是**每轮都注入 AI 上下文**的那一个；
 *   · 工作区级的 `AGENTS.md`、桌面上的副本 → **放行**（2026-09-20 用户收窄，见头部）；
 *   · **`read` 它不拦**（每轮都在读它，读是正常的）；改**别的** `.md` 也不拦。
 *
 * ⚠️ 排在最前面：改这个文件是**绝对禁止**，理由必须由这一关给出，不能被别的关抢先。
 * ⚠️ 本关**不自己读模式文件** —— 它挂在 `verdict()` 里，`f30Mode()` 的 off/observe/enforce 自动生效。
 */

/** 第 0 关保护的**唯一**那个文件：`HOME_DIR/AGENTS.md`（`~/.dsh/AGENTS.md`）。 */
const AGENTS_MD_INJECTED = toSlash(DSH_HOME).replace(/\/+$/, '') + '/AGENTS.md'

/** 相等比较用的规范化（`\`→`/`、去尾斜杠、小写）。 */
const normLower = (p) => toSlash(p).trim().replace(/\/+$/, '').toLowerCase()

/**
 * 🔴 2026-09-20 加 —— **"用户当场同意了"这条通路**。
 * 起因（用户原话）：**"靠。。意思我点不点头都得我改呗。那还是改闸门吧。。能在我的最后一次输出里确认我让你做了"**
 *   —— 旧版只认"去问"，**没有"他同意了"这个判据**，于是**点头也白点**（这个文件变成了只有他自己能改）。
 *
 * 判据（**两道都要，缺一不放**）——只看**他最近一条**消息：
 *   · ① 里面**提到这个文件**（`AGENTS`，不分大小写）；
 *   · ② 里面带**固定格式的准许**：`指令准许：<内容>`（🔴 2026-09-27 改 —— 原先是口语的
 *        "同意 / 可以改 / 批准 / 确认 / 改吧 / 去改 / 授权"，用户指出那不是命令、日常会误触）。
 * ⚠️ **为什么非要"提到 AGENTS"**：只认准许的话，他平时说"指令准许"的地方也可能不是指这件事 ——
 *    **两样都要有才算**。
 * ⚠️ **只看最近一条**（说完就过期）：免得三天前一句准许今天还管用。
 * ⚠️ 拿不到他说过的话（还没记 / 重启后为空）→ **不放行**（宁可多问一次，不可误开）。
 */
const AGENTS_APPROVE_RE = /指令准许\s*[:：]\s*\S/
function userAgreedAgents() {
  let texts = []
  try {
    texts = userSaidTexts()
  } catch {
    return false
  }
  const last = texts.length > 0 ? texts[texts.length - 1] : ''
  if (!last) return false
  return /agents/i.test(last) && AGENTS_APPROVE_RE.test(last)
}

export function agentsMdVerdict(name, args) {
  if (!WRITE_TOOLS.has(name)) return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  if (!p) return null
  if (normLower(p) !== AGENTS_MD_INJECTED.toLowerCase()) return null
  // 🔴 2026-09-20 加：**用户当场同意了就放行**（判据见 `userAgreedAgents` 的注释）。
  if (userAgreedAgents()) return null
  return {
    tag: 'AGENTS.md 只读',
    reason:
      `F30 先停一下：这个文件它不归我改（\`${name}\` → \`AGENTS.md\`）——\n  ${p}\n` +
      '① 依据（用户原话）：**2026-09-20 用户当场拍板"这个必须堵死"**（因为 AI 未经他同意就改了这个文件）；\n' +
      '   这个文件**每一轮都注入、权重最高**；**2026-09-17** 就定过它改动的规矩是"**成果先放桌面待确认**"。\n' +
      '② 出路（**两条，任一即可**）：\n' +
      '   · **请用户当场给一句固定格式的准许** —— 他最近那条消息里**既要提到 AGENTS、又要写成** `指令准许：<要准许的事>`（🔴 2026-09-27 起**所有准许统一成这一种格式**；口语那串「同意 / 可以改 / 批准 / 确认 / 改吧」**已作废、不再认**）→ 这一关直接放行；\n' +
      '   · 或者先把**改后完整全文**摆桌面给他审（④ 的写法），他审完给一句带 AGENTS 的 `指令准许：…`。\n' +
      '   ⚠️ **不许把"他没反对"当成准许**；也**不许自己替他说那句话**（判据只认他发过来的原文）。\n' +
      '③ 边界：**只保护这一个文件** —— `~/.dsh/AGENTS.md`（**每轮注入**我的那一个）。\n' + // 口径-已确认：AGENTS.md 就在 DSH_HOME 根下，这个路径是对的（不是写错的老路径）
      '   工作区级的 `AGENTS.md`、桌面上的副本文件，**都不触发这一关**（用户 2026-09-20 收窄：\n' +
      '   "除了真的会每轮注入你的那个，其他的都不触发闸门。桌面这些副本都不值钱。不值得这样的流程。"）。\n' +
      '   另外：**读它也不拦**（每轮都在读它）；改**别的** `.md` 也不拦。\n' +
      '④ **要去问的时候，这样呈现**（2026-09-20 用户当场教过，别再犯）：\n' +
      '   写一份**修改后的完整全文**——**不许只挑改动片段**（用户原话："看不到全貌，我无法下任何判断"）；\n' +
      '   改动处**紧跟**一行「（原：…）」写它原来的样子 · 删掉的在**原位置**留一行「（已删：…）」· 新增的标「（新增）」；\n' +
      '   **没标括号的＝一字未动**；把这份稿子**放桌面**给他审，**他点头才落笔**。\n' +
      '⑤ **它该怎么写**（这份文件每轮都注入，每一条都按"每轮都在付费"掂量）：\n' +
      '   只写"给未来的我看的操作指令"——**不写前因后果**（实测数字 · 时间线 · "为什么"的论证 · 别处已有的原文）；\n' +
      '   **一条三两句**就够；**不写会变的数字与列表，只写"去哪找"**；判据与出处一律**改指路**（"见《铁律》§四" / "见《总账》R30"），**别在这儿重述**。\n' +
      '   （用户 2026-09-15 原话："需要时启动即可。这就行了。后面的纯属多余。"）',
  }
}

/**
 * **第 10 关 · 不许自造会话日志读取器**（2026-09-21 加；用户拍板："你写 zstd 解压这个事情做闸门吧"）。
 *
 * 由来（2026-09-21 那轮的真账，见 T539/E222）：为了解释一个现象，我**自己写了 6 版 node 解压脚本**
 *   去读 `~/.dsh/sessions/**.jsonl.zstd` —— 而**现成的唯一入口 `read-session.mjs` 就写在《工具速查》表上**，
 *   我到第 16 轮才想起来用它。那 6 版脚本每一版 ＝ 多一次调用（《总账》R30 说的"钱"就是这么烧的）。
 *
 * 为什么归"唯一入口"那一族：《铁律》§四 的禁用清单写着"**凡是有唯一入口的动作，一律不许绕过入口**"
 *   （改档 → `改档.mjs`；搬删 → `move-verify` / `recycle-del`）。**读会话日志也有唯一入口**，
 *   只是那张表 2026-09-21 之前**没有覆盖到它** —— 这一关就是把它补上。
 *
 * 判据（纯机械；只认"**解压函数名**"，不认光秃秃的 `zstd` 字样 —— 否则"列个目录"都会被误伤）：
 *   · `pwsh` 的 `command` 里出现解压函数名（`zstdDecompressSync` / `createZstdDecompress` / `zstdDecompress`）
 *     **且**同时提到会话日志（`sessions` / `jsonl.zstd` / `session.v?N.jsonl`）⇒ 拒；
 *   · `write`/`edit` 往 `.cjs`/`.js`/`.mjs`/`.ps1` 里写同样的组合 ⇒ 拒（写完下一步就是跑它）。
 *
 * ⚠️ **两条边界**（免得挡了正事）：
 *   · **只管"读会话日志"这个组合** —— 解压别的 `.zstd`、或单纯列会话目录，一律放行；
 *   · **插件目录内放行** —— 改梅莫莉亚自己的代码时，正文里必然会同时出现这两个词（这一关的实现就在里面）。
 *     不放行就是**自锁**（《施工手册》坑 4："基线只在成功时写 → 死锁"）。
 */
export const ZSTD_DECOMP_HINT = /zstdDecompressSync|createZstdDecompress|zstdDecompress/i
export const SESSION_LOG_HINT = /[\\/]sessions[\\/]|\bsessions\b|jsonl\.zstd|session\.v?\d*\.?jsonl/i
/** 插件自己的地盘 —— 这一关在里面不生效（否则改它自己的代码必被自己拦）。 */
const SELF_DIR_HINT = /[\\/]plugins[\\/]dsh-memoria[\\/]/i

/** 第 10 关的"出路"文案（只有这一条：用现成读取器）。 */
function readerReason(where) {
  return (
    'F30 先停一下：**这条有现成的门**（别自己写"会话日志解压器"）——\n  ' + where + '\n' +
    '① 读 DSH 会话日志**有现成的唯一入口**：你本机装的那个读取器（见《工具速查》）。\n' +
    '   ⚠️ 本机**没装**它 ⇒ 如实说"没装"，**不要退回去自己写解压器**（写了必然踩下面那两个坑）。\n' +
    '   · `list` 列全部存活会话 · `byid <id> <子命令>` 按 id 定位 · `head <file>` 看帧结构\n' +
    '   · `users` / `conv` / `find <file> <kw>` 取内容 —— 它内部**逐帧**解压，`tornStart` 会如实报出来。\n' +
    '   ⚠️ 会话文件是**多帧拼接**的（实测一个 8 MB 文件 2808 帧）：`zstdDecompressSync` 一把梭\n' +
    '      **只解得出第一帧**，流式解压器会报 `Unknown frame descriptor` ——\n' +
    '      自己写必然同时踩这两个坑（2026-09-21 我踩了 6 版才发现）。\n' +
    '② 依据《铁律》§四 禁用清单："**凡是有唯一入口的动作，一律不许绕过入口**" ——\n' +
    '   改档走 `改档.mjs`、搬删走 `move-verify` / `recycle-del`；**读会话日志**就是这一族。\n' +
    '③ 为什么算危险动作：那轮为了解释一个现象，6 版脚本**每一版都多花一次冤枉钱**（《总账》R30），\n' +
    '   是那 26 次调用里最贵的一段。\n' +
    '（要查会话内容，就去调上面那个读取器；**不要再写第二个解压器**。）'
  )
}

export function sessionReaderVerdict(name, args) {
  const n = String(name ?? '')
  if (!n) return null

  // ① pwsh：命令里同时出现"解压函数名" ＋ "会话日志"
  if (n === 'pwsh' || n.endsWith('pwsh')) {
    const cmd = typeof args?.command === 'string' ? args.command : ''
    if (!cmd) return null
    if (!ZSTD_DECOMP_HINT.test(cmd) || !SESSION_LOG_HINT.test(cmd)) return null
    return { tag: '自造会话日志读取器', reason: readerReason('pwsh 命令') }
  }

  // ② write / edit：往脚本里写同样的组合（写完下一步就是跑它）
  if (!WRITE_TOOLS.has(n)) return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  if (!p || SELF_DIR_HINT.test(p)) return null
  if (!/\.(cjs|js|mjs|ps1)$/i.test(p)) return null
  const body = [args?.content, args?.new_string].filter((x) => typeof x === 'string').join('\n')
  if (!body) return null
  if (!ZSTD_DECOMP_HINT.test(body) || !SESSION_LOG_HINT.test(body)) return null
  return { tag: '自造会话日志读取器', reason: readerReason(p) }
}

/**
 * **第 11 关 · pwsh 不许裸写 / 删 / 搬**（2026-09-21 加；用户拍板："**pwsh 的改动调用应该是严令禁止的**"）。
 *
 * 由来（2026-09-21 那轮的真账）：我用 `[System.IO.File]::WriteAllText` **裸 pwsh 往 `%TEMP%` 写临时脚本**
 *   —— 该走 `write` 工具。同一天更早，我还跳过闸门①直接删了 6 个留底。这一关与第 10 关**同族**：
 *   《铁律》§四 禁用清单写着"**凡是有唯一入口的动作，一律不许绕过入口**"。
 *
 * 判据（纯机械，**只看 `pwsh`**）：
 *   · `command` 命中 `DISK_ACTION_HINT`（裸 cmdlet / `[IO.File]::Write*` / 重定向到盘）
 *     **且**没命中 `ENTRY_WHITELIST`（命令里调的是已登记的唯一入口）⇒ 拒。
 *   · ⚠️ **白名单必须有**：`recycle-del.ps1` / `move-verify.ps1` 就是"那扇门"本身，拦住它们＝自锁
 *     （《施工手册》坑 4 那一族）。
 *   · ⚠️ **只管 `pwsh`**：换个写法（`node -e "fs.writeFileSync"`）拦不住 —— 文本判据只降概率、不给保证。
 *     真正的保证是"唯一入口"那条物理路径；这一关的价值是**把"顺手写一下"变成"必须换一条路"**。
 *   · 出路明确 ⇒ **硬拒**（不留第 6 关那种"再发一次放行"的口子 —— 换一条路永远走得通）。
 */
function diskEntryReason(where) {
  return (
    'F30 先停一下：**这条得走那扇门**（别用 pwsh 裸写 / 删 / 搬）——\n  ' + where + '\n' +
    '① 《铁律》§四 禁用清单：**凡是有唯一入口的动作，一律不许绕过入口**。按动作对门：\n' +
    '   · 写 / 改**任意文件** → `write` / `edit` 工具\n' +
    '   · 改**档案** → `改档.mjs`（`--line` / `--append` / `--txn`）或 `edit` 工具\n' +
    '   · **搬**文件 → `move-verify.ps1`（robocopy 复制 ＋ 逐文件 MD5，校验过才动源）\n' +
    '   · **删**文件 → `recycle-del.ps1`（先 `-DryRun` 干跑；本机盘加 `-AllowLocalDrives`）\n' +
    '   · 只是**看**内容 → `read` / `grep` 工具\n' +
    '     ⚠️ 拿 pwsh 去 `Select-String -Pattern \'Remove-Item\'` 这种"查一个写动作名"也会撞这一关 —— 改用 `grep` 工具。\n' +
    '② 为什么算危险动作（都是真账，不是推理）：\n' +
    '   · 2026-09-14 丢的 8 个文件 —— **全部是我搬运时把命令写错**（用户拍板的删除，他从没后悔过）；\n' +
    '   · 2026-09-16 我用 pwsh 批量改档 —— **把 9 行清空**（靠备份才恢复）；\n' +
    '   · 2026-09-21 —— 裸 pwsh 写临时脚本 ×1、跳闸门①删留底 ×1。\n' +
    '③ 出路说完了：**照上面换一条路重发**。'
  )
}

export function diskWriteVerdict(name, args) {
  const n = String(name ?? '')
  if (n !== 'pwsh' && !n.endsWith('pwsh')) return null
  const cmd = typeof args?.command === 'string' ? args.command : ''
  if (!cmd) return null
  if (ENTRY_WHITELIST.test(cmd)) return null
  // 🔴 2026-10-16：**借外部程序写档案**（`ffmpeg` / `7zr x` / `tar -x` / `node -e` / `pandoc -o`…）
  //    与裸写同族，一并拒 —— 用户当天点名要堵的就是它。
  if (EXTERNAL_WRITER_HINT.test(cmd) && commandTouchesArchive(cmd)) {
    return { tag: 'pwsh 借外部程序写档案', reason: externalWriterReason('pwsh 命令') }
  }
  if (!DISK_ACTION_HINT.test(cmd)) return null
  // 🔴 2026-10-20（发布前修）：**只管档案**（本馆 ∪ 别馆）。
  //    原来不分路径、一刀切 —— 陌生人让 AI 在**自己的项目**里 `New-Item` 建个目录、
  //    `Copy-Item` 备份、`Remove-Item` 清临时件，全被拒，理由还引用《铁律》§四和
  //    `recycle-del.ps1`（他馆里根本没有这份文件）⇒ 装上就当机。
  //    ⇒ 用户的其他文件**不归梅莫莉亚管**：那是 DSH 自己的 sandbox / approval 的职责。
  //    命令里没出现档案路径（绝对路径或相对馆根）⇒ 放行。
  if (!commandTouchesArchive(cmd)) return null
  return { tag: 'pwsh 裸写/删/搬', reason: diskEntryReason('pwsh 命令') }
}

/** 第 12 关的拒绝话术（出路写死在这里）。 */
function dumpDebtReason(rounds, detail) {
  return (
    `F30 先停一下（**只停这一次**）：**留底留意已经挂了 ${rounds} 轮没动**（第 12 关 —— G5 在工具调用面的执行臂）——\n` +
    '🔴 **先去销账：下面三样一律放行，销完这一关就不再拦你。**\n' +
    (detail ? detail + '\n' : '') +
    '① 为什么从"点名"升级成"拦"（用户原话〔会话 2026-09-21〕）：\n' +
    '   "**是强制的但记留意。。那你一直带着账那不没意义。。或许在欠多少次之后强制你必须先归档？**"\n' +
    `   ⇒ 连续 ${rounds} 轮没动，就不再只是留意栏点名，而是**拦住动作**。\n` +
    '② 销账三步 —— 这三类的工具**一律放行**，不会被这一关挡：\n' +
    '   · 机器对账：`node ~\\.dsh\\plugins\\dsh-memoria\\tools\\reconcile-dump.mjs --all`\n' +
    '   · 读骨架 / 落档：`read` 那份骨架 · `dangan_log` 带 `commit:true`\n' +
    '   · 删主份＋骨架：`recycle-del.ps1`（先 `-DryRun` 干跑）\n' +
    '③ 确实要先不动 → 把理由交代清楚（留意栏本来就每轮在报这件事）。\n' +
    `   ⚠️ 防死锁：本关**连拦 ${DUMP_DEBT_MAX_DENY} 次就自动放行**（沿用闸门既有上限，《施工手册》坑 4 那一族）。`
  )
}

/**
 * **第 12 关 · 留底留意超期**（判据与来由见上面那一大段注释）。
 * 只看"欠了几轮"，与具体工具无关；销账链路一律放行。
 */
export function dumpDebtVerdict(name, args) {
  if (dumpStuckRounds < DUMP_DEBT_ROUNDS) return null
  const n = String(name ?? '')
  if (DUMP_DEBT_TOOL_ALLOW.has(n) || /^dangan_/i.test(n)) return null
  if (n === 'pwsh' || n.endsWith('pwsh')) {
    const cmd = typeof args?.command === 'string' ? args.command : ''
    if (DUMP_DEBT_PWSH_ALLOW.test(cmd)) return null
  }
  if (dumpDebtDenied >= DUMP_DEBT_MAX_DENY) return null
  dumpDebtDenied += 1
  let detail = ''
  try {
    detail = String(dumpNotice()?.compact ?? '')
  } catch {
    /* 拿不到明细就不附 —— 判据照走 */
  }
  return { tag: '留底留意超期', reason: dumpDebtReason(dumpStuckRounds, detail) }
}

// ------------------------------------------------------------
// 第 19 关 · 改完 JS 要验语法（2026-10-10 加 —— 治《总账》**R44：复发 7 次，排第一**）
// ------------------------------------------------------------
// 来路：F30 建立当天（2026-09-20）就定下一条结论（用户原话）——
//   "**写规矩防不住；真正能防住的是「不让危险动作出现」**"（见本文件头部）。
// R44（模板字符串里嵌反引号）的判据**早就写着**（施工手册"踩过的坑"第 1 条 ＋ 总账 R44 判据①
//   "改完 JS 先 node --check"）—— 可它靠自觉 ⇒ 复发到 **7 次**，2026-10-10 一天还犯两次
//   （其中一次：**一句文案打碎了 37 个测试文件**）。
// 判据：本会话**写过 / 改过 `.js` / `.mjs`** ⇒ 记一笔"欠验证"；
//   跑过 `node --check …` 或 `node test.mjs` ⇒ 清账；
//   **欠着账时调 `dangan_log`（落档 ＝ 收工信号）⇒ 拒**，并把"欠哪几个文件"直接列出来。
// ⚠️ 三条自我约束照旧：判据出错 fail-open · 只写内存（不写任何 state 文件）· 不写档案。
const syntaxDebt = new Map() // sid -> Set<路径>
// （原来的 `SYNTAX_FIXED_RE = /node\s+--check|node\s+test\.mjs/` 2026-10-20 删掉 ——
//   它一匹配就 `debt.clear()`，等于"验 a 就免掉 b/c 的账"，R44 的账白记。现在分开判。）

/** 第 19 关的**记账**（`verdict()` 每次调用都走一遍）—— 改 JS 记欠、验语法清账。 */
export function noteSyntaxDebt(exec, name, args) {
  try {
    const sid = sidOf(exec) || '?'
    if (!syntaxDebt.has(sid)) syntaxDebt.set(sid, new Set())
    const debt = syntaxDebt.get(sid)
    const n = String(name ?? '')
    const p = typeof args?.file_path === 'string' ? args.file_path : ''
    if (/^(write|edit)$/.test(n) && /\.m?js$/i.test(p)) {
      debt.add(p)
      return
    }
    if (n.endsWith('pwsh')) {
      const cmd = String(args?.command ?? '')
      // `node test.mjs` ＝ 全量验证 ⇒ 清全部
      if (/node\s+test\.mjs/.test(cmd)) {
        debt.clear()
        return
      }
      // 🔴 2026-10-20：`node --check <某个文件>` **只清那一个**（按 basename 比，走 `baseOf` 唯一来源）。
      //    原来一匹配 `node --check` 就 `debt.clear()` —— 等于"验 a 免掉 b/c 的账"，R44 的账白记。
      for (const m of cmd.matchAll(/node\s+--check\s+["']?([^"'\s]+)["']?/g)) {
        const want = baseOf(m[1])
        for (const d of [...debt]) {
          if (baseOf(String(d)) === want) debt.delete(d)
        }
      }
    }
  } catch {
    /* 记账出错不许影响判链 —— fail-open */
  }
}

/**
 * **第 19 关 · 改完 JS 要验语法** —— 只在**落档**（＝收工信号）那一刻判。
 * ⚠️ 它**不是**"不许改 JS"，而是"**改完得验一次**"：一秒的事，R44 为此复发 7 次。
 * 🆕 **2026-10-15**：落档的入口要收进织布机（`dangan_weave`）⇒ 这里**两个名字都认**
 *   （只认旧名的话，换名之后这一关会**静默失效** —— 那正是"看着在跑、其实已死"）。
 */
export function syntaxDebtVerdict(exec, name, args) {
  try {
    if (!/(dangan_log|dangan_weave)/i.test(String(name ?? ''))) return null
    const debt = syntaxDebt.get(sidOf(exec) || '?')
    if (!debt || debt.size === 0) return null
    const list = [...debt].slice(0, 6).join(' · ')
    return {
      tag: '第 19 关·改完 JS 没验语法',
      reason:
        'F30 拦住（**第 19 关 · 改完 JS 要验语法**）—— 治《总账》**R44**（模板串里嵌反引号，**复发 7 次、排第一**）。\n' +
        `  · 本会话改过这些 JS、还没验过语法：${list}\n` +
        '  · 验一次就行（一秒）：node --check 那个文件 · 或者 node test.mjs（顺带把测试也跑了）。\n' +
        '  · 为什么拦在落档这一刻：R44 的判据**早就写着**（施工手册坑 1 ＋ 总账 R44），可它靠自觉 ⇒ 复发 7 次；\n' +
        '    F30 建立当天的结论就是：**写规矩防不住，真正能防住的是"不让危险动作出现"**（用户 2026-09-20）。',
    }
  } catch {
    return null
  }
}

// ------------------------------------------------------------
// 第 18 关 · 销账三步门（2026-09-30 加 · **用户定的机制**）
// ------------------------------------------------------------
// 用户 2026-09-29 原话：「我要的是**销账的自动化**，通过机制限制你必须严格按照：
//   **读骨架，补档案，然后再归档完成**。而不是像现在这样**不做事直接归档完成**。」
// 方案：`L4-施工\工程-销账三步门-讨论稿.md`。三条定案：
//   ① **硬拦**（🔴 2026-09-30 用户改口：「不允许跳过流程。无关你的判断，程序必须执行」——
//      原定的「拦一次、再发即放行」**已作废**；唯一出口＝用户本人给的口令）
//   ② 骨架与原文**只留最近 5 份**（口径在 `f29-verified.js` 的 `VERIFIED_KEEP_COUNT`）
//   ③ **"无需补"不许我自己走** ⇒ 要用户给一句 `指令准许：xxx`
// 🔴 为什么要单独记账：骨架在**档案之外**（`~/.dsh/memoria/memoria-dumps/skeleton\`），
//    A 关那套"档案内相对路径"的已读记账**看不见它** ⇒ 本关自己记"哪份骨架被读过"。
const SKELETON_RE = /(?:骨架|摘要)-(归档|压缩)-([0-9a-f]{8})\.md$/i
const ledgerState = new Map() // sid -> { step, lastCommit, prevCommit, saidN, skelAt: Map<短id, 步号> }
// 🔴 2026-09-30 用户改口：**不再"拦一次就放行"** —— 他当天原话：
//    「不允许跳过流程。无关你的判断，程序必须执行。」
//    ⇒ 本关**只有"他本人给口令"这一个出口**（`指令准许：…`）；没有"再发一次就放行"这种自我通道。
// （原「拦过几次」那套计数器 ＋ 它的测试出口，2026-09-30 已整条拆掉 —— 见上面改口那条）
// 2026-10-17：骨架/摘要已跟着馆走（`<馆>\L6-工具临时\留底`）—— 路径不再写死 ~/.dsh。
const SKEL_DIR = () => skeletonDir()

/**
 * **找这份留底的核账记录**（2026-10-22 加 · 用户改口径「销账不再依赖落档吧」的配套）。
 *
 * 为什么要它：原来第 18 关要求"读了之后必须**真落过一次档**"—— 而 `落档` 纹样**只维护"时间标记"**，
 *   同一天第二次落档必然是"一处都不用改"（织布机不写盘）⇒ **销账永远卡死**（2026-10-22 实测绕了半晚）。
 * ⇒ 改成看「**有没有核账记录**」：那才是核账**真正的产物**，比"落过档"更贴近"我真核过"。
 *
 * 判据（用户已明确"你不会为这个撒谎"，所以**只要求存在**，不验内容）：
 *   `L3-知识` 下任一文件名**同时含**"核账"与这份留底的短 id。
 *   ⚠️ **只扫文件名、不读内容** —— 每步都调，读内容会变成新负担。
 */
function findReconcileRecord(sid) {
  if (!sid) return ''
  try {
    // ⚠️ 不能拿 `findByName('L3-知识')` —— 那函数找的是**文件**（返回一份 .md 的路径），拿它当目录用会炸。
    const layer = join(CFG.archiveDir, 'L3-知识')
    if (!existsSync(layer)) return ''
    const walk = (dir, depth = 0) => {
      if (depth > 4) return ''
      let ents = []
      try {
        ents = readdirSync(dir, { withFileTypes: true })
      } catch {
        return ''
      }
      for (const e of ents) {
        const full = `${dir}\\${e.name}`
        if (e.isDirectory()) {
          const hit = walk(full, depth + 1)
          if (hit) return hit
          continue
        }
        if (!/\.md$/i.test(e.name)) continue
        if (e.name.includes('核账') && e.name.toLowerCase().includes(String(sid).toLowerCase())) return full
      }
      return ''
    }
    return walk(layer)
  } catch {
    return ''
  }
}

function ledgerOf(exec) {
  const sid = sidOf(exec) || '?'
  if (!ledgerState.has(sid)) ledgerState.set(sid, { step: 0, lastCommit: 0, prevCommit: 0, saidN: 0, skelAt: new Map() })
  return ledgerState.get(sid)
}
function sid8Of(x) {
  const m = String(x ?? '').match(/([0-9a-f]{8})/i)
  return m ? m[1].toLowerCase() : ''
}

/**
 * 销账三步门的**记账**（`verdict()` 每次调用都走一遍）：
 *   · 读到骨架（`read` 且路径合 `骨架-{归档|压缩}-<短id>.md`）⇒ 记"哪份、第几步"
 *   · 落过档（`dangan_log`，或 `pwsh` 里跑 `改档.mjs`）⇒ 记"第几步落的"
 *   · 用户换了一轮话 ⇒ 把"本关拦过几次"清零（每轮最多拦一次）
 */
export function noteLedgerStep(exec, name, args) {
  const st = ledgerOf(exec)
  st.prevCommit = st.lastCommit
  st.step += 1
  const n = String(name ?? '')
  if (READ_TOOLS.has(n)) {
    const p = typeof args?.file_path === 'string' ? args.file_path : ''
    const m = p.match(SKELETON_RE)
    if (m) {
      st.skelAt.set(m[2].toLowerCase(), st.step)
      capTick('F30', `读了骨架 ${m[2]}`)
      log(`F30 销账三步门：已读骨架 ${m[2]}（${m[1]}）`, { silent: true })
    }
  }
  // 🔴 2026-10-07（对抗审查）：① **织布机（`dangan_weave`）真写也算落档** —— 原来只认 `dangan_log`，
  //    织布机落的档照旧不算（那正是 0.79.4 要治的那件事，当时只治了一半）；
  //    ② 两个工具都**必须 `commit:true`** —— 干跑不许当落档（`args.commit` 就是"真写"的开关）；
  //    ③ `pwsh` 那条同样排除 `--dry-run`（干跑内核不写盘）。
  const toolWrite = /dangan_(log|weave)/i.test(n) && args?.commit === true
  const cmd = String(args?.command ?? '')
  const kernelWrite = n.endsWith('pwsh') && /改档\.mjs/.test(cmd) && !/--dry-run/.test(cmd)
  if (toolWrite || kernelWrite) {
    st.lastCommit = st.step
  }
}

/**
 * **第 18 关 · 销账三步门** —— 提名销账（`dangan_log` 带 `归账完成`）时判三步：
 *   ① 那份留底的**骨架读过没有**（没读 ⇒ 拦，并把骨架路径／重建命令直接给出来）
 *   ② 读过之后**落过档没有**（一个字没落 ⇒ 拦："是真核过了，还是跳步了？"）
 *   ③ 用户给了 `指令准许：…` ⇒ 一律放行（"无需补"这条路只归他）
 * 🔴 **硬拦**（2026-09-30 起）：**不许跳过流程** —— 三步没走完就一直拦
 *    （原「连拦 N 次自动放行」那套已拆）；唯一的出口是**用户本人给的口令**；
 *    判据出错一律 fail-open（插件 bug 不许把人锁死）。
 */
export function verifiedGateVerdict(exec, name, args) {
  try {
    const n = String(name ?? '')
    // 🆕 **2026-10-15**：两个入口都认（落档要收进 `dangan_weave`）；且它把参数装在 `items[]` 里
    //   ⇒ `归账完成` 也要**从 items 里找**，否则换了入口这一关就永远读不到（静默失效）。
    if (!/(dangan_log|dangan_weave)/i.test(n)) return null
    const nom =
      args?.['归账完成'] ?? (Array.isArray(args?.items) ? args.items[0]?.['归账完成'] : undefined)
    const list = Array.isArray(nom) ? nom.filter((x) => String(x ?? '').trim()) : nom ? [nom] : []
    if (list.length === 0) return null
    let last = ''
    try {
      const said = userSaidTexts()
      last = said.length > 0 ? String(said[said.length - 1] || '') : ''
    } catch {
      last = ''
    }
    if (APPROVE_RE.test(last)) return null // ③ 口令路：用户当场准许 ⇒ 放行
    const st = ledgerOf(exec)
    for (const item of list) {
      const sid = sid8Of(item)
      if (!sid) continue
      const at = st.skelAt.get(sid)
      if (!at) {
        return {
          tag: '销账三步门·没读摘要',
          reason:
            // 🔴 用户 2026-09-30 定：拦截提示上**写他的原话**，且**不允许跳过流程**（与他怎么判断无关）。
            'F30 先停一下（**第 18 关 · 销账三步门**）—— 🔴 **不允许跳过流程，程序必须执行**。\n' +
            '**用户原话（2026-09-29）**：「我要的是销账的自动化，通过机制限制你必须严格按照：**读骨架，补档案，然后再归档完成**。而不是像现在这样**不做事直接归档完成**。」\n' +
            `  · 这次要销的留底是 \`${sid}\` ⇒ **先读摘要**（**必须**）：\n` +
            `    \`${SKEL_DIR()}\\摘要-归档-${sid}.md\`（若是压缩留底则 \`摘要-压缩-${sid}.md\`）\n` +
            '  · **摘要核不出来**（某条判不了“该补还是不该补”）⇒ 才去读**骨架**（同目录 `骨架-…-<短id>.md`）。\n' +
            '  · **骨架也判不出来** ⇒ 最后才看**原文**（留底主份）。⚠️ **骨架都看不出来的情况基本没有。**\n' +
            '  · 🔴 **判不出来的那几条，必须写进核账记录**（写“XX 没法核实”）—— **不许装作核过**；用户会按记录提醒去看原文。\n' +
            '  · **摘要 / 骨架都不存在** ⇒ 先重建（**两条路都能重建**：归档路的日志路径写在留底头里；压缩路就拿**那场会话的日志**整份重解 —— 重建出来是「整场会话版」，比原来那份大几倍、但内容更全）：\n' +
            `    \`node ~\\.dsh\\plugins\\dsh-memoria\\tools\\dump-skeleton.mjs --log <会话日志> --out "${SKEL_DIR()}\\骨架-归档-${sid}.md"\`\n` +
            '  · 读完、把还没进档的**补上并落一次档**，才准提名；确实"无需补" ⇒ 请用户给一句 `指令准许：<要准许的事>` —— **只有他的口令能开这个口子**。\n' +
            '（依据：`L4-施工\\工程-销账三步门-讨论稿.md` §二；同族见总账 `R38` 与 `E341`）',
        }
      }
      // 🔴 **2026-10-10 用户改口径**（原话：「**只要动了时间线就算。不要必须多号吧我觉得**」）：
      //    同一次调用里"既落档又提名"**不再拦** —— 它自己就是一次真落档（`commit:true` ⇒ 真写时间轴），
      //    按新口径这已经算「**动过时间线**」。原设计（"必须拆成两次调用 ⇒ 每次销账多生 2 个号"，
      //    见 `记录-事件详录-第17册.md` 那条"这是设计，不是故障"）**已作废**。
      //    ⚠️ 仍在拦的只剩一种：**干跑提名**（不带 `commit:true`）而之前一次真写都没有。
      // 🔴 **2026-10-22 用户改口径：「销账不再依赖落档吧」** ——
      //    原来这里要求"读了之后必须**真落过一次档**"，而 `落档` 纹样只维护时间标记 ⇒
      //    同一天第二次必然"一处都不用改"（织布机不写盘）⇒ **销账永远卡死**（当晚实测绕了半晚）。
      //    ⇒ 改成看「**有没有核账记录**」：核账真正的产物是那份记录，不是"落过档"这个动作。
      // 🔴 用户当天原话（关于"不怕我糊弄"）：「**你不会为了这个事情撒谎的。撒谎对你来说没有意义。**」
      //    ⇒ 判据**只要求记录存在**，不验内容、不验字数（他的原话也可能就俩字"好吧"）。
      const rec = findReconcileRecord(sid)
      if (!rec) {
        return {
          tag: '销账三步门·没落核账',
          reason:
            'F30 先停一下（**第 18 关 · 销账三步门**）—— 你**读了摘要，但没留下核账记录**。\n' +
            `  · 留底 \`${sid}\` 的摘要/骨架读在第 ${at} 步。\n` +
            '  · 缺的那一步：**把核账结果写成一份 L3 记录**（文件名里带「核账」和这份留底的短 id），里面写清：\n' +
            '      · 缺口 **N 条**（跟 `reconcile-dump --brief` 报的对得上）\n' +
            '      · **逐条结论**（`已有档案：<路径>` ／ `按 W5 不落：<理由>`）\n' +
            '      · **判不出来的那几条，直说“没法核实”** —— 别装作核过（用户会照记录提醒去看原文）。\n' +
            '  · 有了这份记录再来提名（**2026-10-22 起不再要求"先落一次档"** —— 那条路会把自己卡死）。\n' +
            '（依据：用户 2026-10-22「销账不再依赖落档吧」；同族见总账 `R38` 与 `E341`）',
        }
      }
    }
    return null
  } catch (e) {
    log(`F30 销账三步门判据出错（放行）：${e?.message ?? e}`)
    return null
  }
}

/**
 * **第 13 关 · 别馆只读**（2026-09-23 加，随 F32 一起）。
 *
 * 用户 2026-09-23 原话："跨馆只读是对的，**这不是让你看到，是保护另一个馆**。
 *   你在这个馆就只能改你这个馆和电脑，但不能碰另一个馆。这是对的。不然你乱改另一个馆，那不炸了。"
 *
 * 只管 `write` / `edit` 两个工具：
 *   · `pwsh` 的裸写已被**第 11 关**整个堵掉，而唯一入口（`改档.mjs` / `recycle-del.ps1` /
 *     `move-verify.ps1`）认的都是"当前馆根" ⇒ 那一边**天然**只读，不必在这儿重复管；
 *   · `read` / `grep` **不受这条管**（用户要的正是"只读是对的"）。
 *
 * 判据在 `f32-archives.js` 的 `inOtherArchive()`：当前馆放行 · 别的馆拒 · 电脑其它地方照旧。
 */
export function otherArchiveVerdict(name, args) {
  const n = String(name ?? '')
  if (!WRITE_TOOLS.has(n)) return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  if (!p) return null
  let hit = null
  try {
    hit = inOtherArchive(p)
  } catch {
    return null // 判据出错一律 fail-open（插件 bug 不许把人锁死）
  }
  if (!hit) return null
  return {
    tag: '别馆只读（F32）',
    reason:
      'F30 先停一下（**第 13 关 · 别馆只读**）：这个路径在**别的档案馆**里 ——\n' +
      `  「${hit.name}」 ${hit.dir}\n` +
      '① 用户 2026-09-23 原话：**"这不是让你看到，是保护另一个馆。你在这个馆就只能改你这个馆和电脑，但不能碰另一个馆。"**\n' +
      `② 当前馆是：${CFG.archiveDir}\n` +
      '③ 出路（都是换一条路，不是绕）：\n' +
      '   · 要改**当前馆** → 用当前馆里的相对路径；\n' +
      '   · 要改**那个馆** → 面板那条「档案馆」栏上点一下**切过去**（切完它就是当前馆，改它名正言顺）；\n' +
      '   · 只是**看**它 → `read` / `grep` 照旧放行。',
  }
}

/**
 * **第 14 关 · 不许"整份覆盖"一个已经存在的文件**（2026-09-25 加 · 用户："这个能不能用机制避免"）
 *
 * 病（当天实测）：`glob` 报"没有这个文件"给了**假信号**，我信了它、直接 `write` 想"新建" ——
 *   而那个文件其实存在（152 行的测试）→ **差一步整份覆盖掉**。是"未观测不许写"那条政策拦下来的。
 *   ⚠️ 更糟的是：那条政策（read-before-write）**只要我读一次就放行** ——
 *   而我那次"读"只是**为了确认它存在**，读完反而获得了"覆盖它的资格"。**规则反着使了。**
 *
 * 判据：`write` 的目标**已存在** ⇒ 拒**一次**（并把现况摆出来：多少行 / 开头是什么）。
 *   出路（机械的，不靠自觉）：① 要**改**它 → 用 `edit`（匹配替换，天生不会整份覆盖）；
 *   ② 确实要**整份重写** → **再发一次同一个 `write`，放行**（照第 6 关那套：拦一次、给机械出路）。
 * ⚠️ **只管 `write`** —— `edit` 是匹配替换、不是覆盖，不管它。
 * ⚠️ 判据一律 **fail-open**（stat 失败 / 没给路径 → 放行）—— 插件自己的 bug 不许把人锁死。
 * ⚠️ 子代理不参与（与别的关同一条）。
 */
const overwriteAsked = new Set()

export function overwriteVerdict(name, args, sid) {
  if (String(name ?? '') !== 'write') return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  if (!p) return null
  let st
  try {
    st = statSync(p)
  } catch {
    return null // 不存在 → 正常新建，放行
  }
  if (!st.isFile()) return null
  const key = `${sid ?? ''}|${p.toLowerCase()}`
  if (overwriteAsked.has(key)) {
    overwriteAsked.delete(key) // 只拦一次（第三次再拦）
    return null
  }
  overwriteAsked.add(key)
  let lines = 0
  let head = ''
  try {
    const arr = readFileSync(p, 'utf8').split(/\r?\n/)
    lines = arr.length
    head = (arr.find((x) => x.trim()) || '').slice(0, 80)
  } catch {
    /* 读不到就不报细节 */
  }
  return {
    tag: '整份覆盖已存在的文件',
    reason:
      'F30 拦住（**第 14 关 · 不许整份覆盖**）：这个文件**已经存在** ——\n' +
      `  ${p}\n` +
      `  现在 ${lines} 行 · 开头：${head || '（读不到）'}\n` +
      '① 为什么拦：**"新建"和"覆盖"长得一模一样**，而覆盖会把已有的东西整份抹掉\n' +
      '   （2026-09-25 实测：`glob` 报"没有这个文件"是**假信号**，差一步覆盖掉一份 152 行的测试）。\n' +
      '② 出路（机械的，不靠自觉、不靠商量）：\n' +
      '   · 要**改**它 → 用 `edit`（匹配替换那一段，天生不会整份覆盖）；\n' +
      '   · 确实要**整份重写** → **再发一次同一个 `write`，我会放行**（这一关只拦一次）。',
  }
}

/**
 * 第 17 关 · **口径关**（2026-09-28 加）—— **止在源头**：写插件代码时，不许再抄第二份"已经有唯一来源"的口径。
 *
 * 用户当天定的口径（原话）：「**不是让你常态化扫描**，是类似落待办这种，**限制你在写的时候
 *   就不要写那么多乱七八糟的地方。止在源头。**不是说经常查经常改。是以后不发生。」
 * ⇒ 拿 `lib/scope-registry.js` 那几条，对 `edit` / `write` **要写入的新内容**逐行检查：
 *   命中受管片段 ⇒ **当场拒**，并直接给出正确来源（"去 import 它，别在这儿再写一份"）。
 * 边界（用户明说不用防的）：**只拦"同一片段照抄"**；"换种写法做同一件事"**不防**。
 * 豁免：那一行**行尾**含 `口径-已确认` ⇒ 放行（人判过、确实要在这儿写一份）。
 */
export function scopeGuardVerdict(name, args) {
  if (!WRITE_TOOLS.has(name)) return null
  const p = typeof args?.file_path === 'string' ? args.file_path : ''
  // 只拦**插件自己的代码**（`lib/` 或 `tools/`）—— 改档案时写 `~/.dsh/...` 之类是正常的，不归这关管。
  if (!/\/(lib|tools)\//.test(toSlash(p))) return null
  const body = name === 'write' ? String(args?.content ?? '') : String(args?.new_string ?? '')
  if (!body) return null
  const hits = []
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue // 注释里**说明**口径是对的，不拦
    if (/口径-已确认/.test(line)) continue
    for (const s of SCOPES) if (s.re.test(line)) hits.push({ s, line: line.trim().slice(0, 90) })
  }
  if (hits.length === 0) return null
  return {
    tag: '口径关',
    reason:
      `F30 拦住（**第 17 关 · 口径关**）：这段新代码里又写了一份"**已经有唯一来源**"的口径 ——\n` +
      hits
        .slice(0, 4)
        .map((h) => `  · [${h.s.id}] \`${h.line}\`\n      ⇒ 该用 ${h.s.use}\n      （为什么：${h.s.why}）`)
        .join('\n') +
      `\n⚠️ 真有必要在这儿再写一份 ⇒ 在**那一行行尾**加 \`口径-已确认：<理由>\`，本关即放行。\n` +
      `（依据：用户 2026-09-28「限制你在写的时候就不要写那么多乱七八糟的地方 —— 止在源头」；表在 \`lib/scope-registry.js\`）`,
  }
}

/**
 * 总判（**第 13 关 → 第 17 关 → 第 0 关 → D → E → 第 10 关 → 第 11 关 → 第 12 关 → B → A → 第 14 关**：
 * 先绝对禁止，再纯写入面，再唯一入口，再按需，再全局必读层，最后"覆盖"与"重复读"）。
 * ⚠️ **第 13 关（别馆只读）排在最前** —— 它是"范围"类判据（这个路径根本不归你管），
 *    比"该不该读某份文档"更靠前：不该动的文件，读没读过必读都一样不该动。
 */
export function verdict(exec) {
  const name = exec?.name
  if (typeof name !== 'string' || name.length === 0) return null
  const args = exec?.arguments ?? {}
  try {
    noteLedgerStep(exec, name, args) // 第 18 关（销账三步门）的记账：读骨架 / 落档 / 换轮清零
  } catch {
    /* 记账出错不许影响判链 —— fail-open */
  }
  try {
    noteSyntaxDebt(exec, name, args) // 第 19 关记账：改 JS 记欠 / 验语法清账
  } catch {
    /* 同上 */
  }
  const v =
    otherArchiveVerdict(name, args) ??
    scopeGuardVerdict(name, args) ??
    agentsMdVerdict(name, args) ??
    asciiVerdict(name, args) ??
    patchVerdict(name, args) ??
    sessionReaderVerdict(name, args) ??
    purgeVerdict(name, args) ??
    diskWriteVerdict(name, args) ??
    dumpDebtVerdict(name, args) ??
    syntaxDebtVerdict(exec, name, args) ??
    verifiedGateVerdict(exec, name, args) ??
    scopedVerdict(exec, name, args) ??
    playbookGateVerdict(exec, name, args) ??
    diskTalkVerdict(exec, name, args) ??
    // 🗑 **第 16 关（待办软提醒）2026-10-07 退役；2026-10-20 代码与测试一并删净。**
    //    用户当天拍板：「**待办这事老拦人挺烦的。或许只放在留意栏里就可以了**」→「**彻底降成提醒吧**」。
    //    ⇒ 提醒只留在留意栏那一行（`F26`：`待办：N 条还开着`），**不拽回合**。
    requiredVerdict(exec, name, args) ??
    overwriteVerdict(name, args, sidOf(exec))
    // 🗑 **第 12 关（本回合调用额度）2026-09-20 起就不再拦人；2026-10-20 代码与测试一并删净。**
    //    计数与"收工 ≥8 次记一行"照旧（`toolCallsThisTurn()`），只是**不当闸门** ——
    //    理由当年已写死：① 拦一次要用户回一句话（他花钱又搭注意力）；② 那个数本身不准。
    // 🗑 **第 6 关（重复读）2026-10-21 删净** —— 它唯一的输入 `exec.agent.session.events` 在这版宿主上
    //    **根本不存在**（本文件上方自己就写着"agent.session 上根本没有 events"），日志里有 886 条
    //    "拿不到 session.events"、最后一次真拦是 2026-09-25。
    //    用户拍板：「**我们没有，就代表所有的都没有**」（宿主没改过、不必为假想中的别的机器留适配）。
  // 🔴 2026-09-21：落盘那份"已读"**在整条链判完之后**才写 ——
  //    写在 `requiredVerdict` 里面时，排在其后的**第 6 关**会读到"刚刚写进去的这一条"，
  //    把**这一次**的读看成**上一次**的读 ⇒ **自己把自己绊倒**（实测两条断言当场挂）。
  //    放在这儿：第 6 关看到的永远是**上一次**的状态；而"`verdict()` 会写落盘"这条行为照旧保留
  //    （测试 ⑰ 段钉着它）。⚠️ 只在**放行**时写 —— 被拦下的那次读根本没发生。
  if (!v) rememberReadOnDisk(exec)
  return v
}

/** 日志里那行"拦的是哪次调用"（别把整个参数倒进日志）。 */
function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return ''
  const p = args.file_path ?? args.path ?? args.command
  return typeof p === 'string' ? p.slice(0, 120) : ''
}

// ------------------------------------------------------------
// 注册 ＋ 自检
// ------------------------------------------------------------

/**
 * 注册 F30 的拦截器。
 *
 * ⚠️ 这是本插件**唯一**挂 `tools/pre-execute` 的地方。若将来还有模块要挂同一个事件，
 *    先读 `f1-reinject.js` 头部那条警告（脚手架 mockCtx 的 `on()` 是"后注册顶掉先注册"——
 *    F22 当初自己挂 `session/event`，一挂上去 F1 就整条哑掉）。
 */
/** 读模式文件。读不到 / 写了个不认识的值 → 一律按默认 `enforce`。 */
export function f30Mode() {
  try {
    const m = readTextSafe(F30_MODE_FILE).trim().toLowerCase()
    if (m === 'off' || m === 'observe' || m === 'enforce') return m
  } catch {
    /* 读不到就用默认 */
  }
  return 'enforce'
}

/**
 * 把"这次读过的路径"写进落盘（**判完再写** —— 见 `requiredVerdict` 里那段注释）。
 *
 * 两类都写：
 *   · **A 关清单内的**（必读层 ＋ B 关点名）→ 用清单里的 `hit`（档案内相对路径）写，
 *     这样跨重启 `hasDiskRel` 也认得出（A 关判"读齐了没"靠它）；
 *   · **其余任何路径**（档案内长文档 / 档案外包源码 / 会话文件…）→ 用 `normPath` 写，
 *     **第 6 关（重复读）2026-09-25 起不再认它**（改用会话历史；原因见 `rereadVerdict` 里那段注释） —— 2026-09-21 之前那一关只认 `session.events`，拿不到就静默放行。
 *
 * ⚠️ **只在放行时调**（被拦下的那次读根本没发生，不该记成"读过"）；写失败只出声（fail-open）。
 */
function rememberReadOnDisk(exec) {
  try {
    if (!READ_TOOLS.has(String(exec?.name ?? ''))) return
    const p = typeof exec?.arguments?.file_path === 'string' ? exec.arguments.file_path : ''
    if (!p) return
    const L = requiredList()
    const hit = matchKnown(p, [...(L.files ?? []), ...scopedNeeds()])
    // ⚠️ 记的形态**统一优先用"档案内相对路径"**（`toRel`）—— 这样"后来才进清单"的那份也认得出；
    //    档案外 / 认不出的才退回绝对路径（第 6 关判"重复读"两种都认，见 `hasDiskRel`）。
    diskRemember(sidOf(exec), hit ?? toRel(p) ?? normPath(p))
  } catch (e) {
    log(`F30 落盘记账失败（fail-open，不影响放行）: ${e}`)
  }
}

/**
 * **各关"判过 / 拦过"计数**（本进程）—— 2026-09-21 加，这是"让规矩真的生效"那件事的根治。
 *
 * 病（当天实测）：第 6 关（重复读）自 2026-09-20 装上起**静默死了三天** —— 它只认
 *   `session.events`，拿不到就静默 `count=0` 放行；而 `CAP_STATS` 只记"**拦过**几次"
 *   ⇒ **"从没拦过"和"死了"长得一模一样**（状态面板上都显示"没动过"）—— 死了没人知道。
 *
 * 方（照《施工手册》"动手前三问"第③问"**会不会静默失效 → 必须自报工作量，沉默 ≠ 正常**"）：
 *   · 相应工具**每路过一次**就给那一关记一笔"**判过**"（`seen`），拦下时再记"`hit`"；
 *   · 这一程**第一次**判到时往 `memoria.log` 写一行心跳 —— 于是"**日志里没有这行**"本身就说明它没跑。
 *   ⚠️ 只记数、**不拦人**；计数出问题不影响判据。
 */
export const GATE_TICKS = {
  reader: { seen: 0, hit: 0 },
  disk: { seen: 0, hit: 0 },
  debt: { seen: 0, hit: 0 },
}

/** 各关在心跳日志里的名字。 */
const GATE_LABEL = {
  reader: '10（不许自造会话日志读取器）',
  disk: '11（pwsh 不许裸写 / 动盘先读总则）',
  debt: '12（留底留意超期 —— G5 的执行臂）',
}

/** 已经报过心跳的关（只报一次 —— 免得每轮刷屏）。 */
const gateHeartbeat = new Set()

/** 哪几关管哪个工具（第 6 关看 `read`；第 10 关看 `pwsh` 与写脚本；第 11 关看 `pwsh`）。 */
function gatesOfTool(name) {
  const n = String(name ?? '')
  // ⚠️ 第 12 关看**所有**工具（留底留意超期时，除了销账链路一律拦）—— 所以它每次都记一笔"判过"。
  const out = ['debt']
  if (n === 'pwsh' || n.endsWith('pwsh')) out.push('reader', 'disk')
  else if (WRITE_TOOLS.has(n)) out.push('reader')
  return out
}

/** 一次工具调用路过时，给对应关记一笔"判过"（并首次报心跳）。 */
export function noteGatePass(exec) {
  try {
    for (const which of gatesOfTool(exec?.name)) {
      GATE_TICKS[which].seen += 1
      if (gateHeartbeat.has(which)) continue
      gateHeartbeat.add(which)
      log(`F30 第 ${GATE_LABEL[which]} 关这一程第一次判到 —— 它活着（此后不再重复报）`, { silent: true })
    }
    // 🗑 **2026-10-22 撤掉了 F30 的 health 上报**（用户当天定的入选尺子）：
    //    「**一些一眼就能看出问题的就不用总监来管了**」—— 门卫拦不拦、判不判，我**当场就知道**。
    //    **"用了就知道坏没坏"的，自己就是哨兵，不配进名单。**
    //    （`GATE_TICKS` 计数照旧 —— 那是它自己的心跳，`dangan_status` 在用。）
  } catch {
    /* 日志写不了不影响判据 */
  }
}

/** 拦下一条时，给对应关记一笔"拦过"。 */
export function noteGateHit(tag) {
  try {
    if (tag === '自造会话日志读取器') GATE_TICKS.reader.hit += 1
    // ⚠️ 口径：第 11 关那笔**同时收**它自己那条（pwsh 裸写）与 B 关的"按需必读未读"
    //    （后者含"动盘前没读《防丢总则》"—— 正是这一关要治的事；施工手册那条也一起计，不细分）。
    else if (tag === 'pwsh 裸写/删/搬' || tag === '按需必读未读') GATE_TICKS.disk.hit += 1
    else if (tag === '留底留意超期') GATE_TICKS.debt.hit += 1
  } catch {
    /* 同上 */
  }
}

export function registerF30(ctx) {
  try {
    ctx.on('tools/pre-execute', async (exec, next) => {
      // 🔴 **计数放最前面**：子代理那次提前 return 之前也要计数（照原顺序，放最前最省事）；
      //    fail-open 的 catch 里**不许**动计数（判据坏了不是"少伸一次手"）。
      //    顺手把**工具名**也记下（F31 判"这一轮有没有写动作"就靠它）。
      noteToolCall(exec?.name, exec?.arguments, sidOf(exec))
      const pass = () => (typeof next === 'function' ? next() : { kind: 'allow' })
      try {
        const mode = f30Mode()
        if (mode === 'off') return pass()
        if (isSubagent(exec?.agent)) {
          // 子会话：判过就算到场，其余判据一律放过（那些管的是"我"，不是它）
          capTick('F30', '判过')
          return pass()
        }
        // 🔴 2026-09-21：**各关心跳**（"让规矩真的生效"的根治，见 `GATE_TICKS` 那段注释）。
        noteGatePass(exec)
        const v = verdict(exec)
        // 🔴 2026-09-26 修：**判过就算到场**（判出东西没有都算 —— 考勤问的是"这条链还判不判"）。
        //    原来只在"有关卡给出结论"时才 `capTick` ⇒ "全关放行"的步一步都不自报，
        //    考勤于是把**一直在判的门卫**算成"连着 N 步没露面"（假警报的另一半）。
        //    ⚠️ 考勤手里"该判没判"的信号是 `toolCallsTotal()`（common.js 的独立时钟）。
        capTick('F30', '判过')
        if (v) {
          noteGateHit(v.tag)
          log(`F30 ${mode === 'enforce' ? '拦住' : '看见（observe，不拦）'}【${v.tag}】${exec?.name ?? '?'} ${summarizeArgs(exec?.arguments)}`)
          if (mode === 'enforce') return { kind: 'deny', reason: v.reason }
        }
      } catch (e) {
        // fail-open：判据自己坏了，绝不许把我锁死（但要出声 —— 沉默 ≠ 正常）
        log(`F30 判据出错（fail-open，放行）: ${e}`)
      }
      return typeof next === 'function' ? next() : { kind: 'allow' }
    })
    log('hook 已注册: tools/pre-execute（动手前门卫 F30）', { silent: true })
  } catch (e) {
    log(`注册 tools/pre-execute 失败: ${e}`)
  }

  // 🔴 **2026-10-21 加（第二路审查报的：R44 复发 8 次，最近一次让 44 个测试文件齐挂）**：
  //    **改完 `.js` 立刻自动跑 `node --check`** —— 不用再靠"收工时被第 19 关拦住、我自己去跑"。
  //    验过就**清账**（第 19 关那笔欠自动消）；有错就**留着账 ＋ 当场出声**（下一轮留意栏/收工时都看得见）。
  //    ⚠️ 只 `next()` **不动工具结果** —— `PostToolDecision` 的形状不熟，改错了会把工具的输出吞掉，
  //       那比"语法没验"严重得多（R44 那种错是"多花一轮排查"）。这一层要守的就是这个优先级。
  try {
    ctx.on('tools/post-execute', async (exec, _result, next) => {
      try {
        const nm = String(exec?.name ?? '')
        const p = typeof exec?.arguments?.file_path === 'string' ? exec.arguments.file_path : ''
        if (/^(write|edit)$/.test(nm) && /\.m?js$/i.test(p)) {
          const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8', timeout: 15000 })
          if (r.status === 0) {
            const debt = syntaxDebt.get(sidOf(exec) || '?')
            if (debt) debt.delete(p)
          } else {
            const why = String(r.stderr ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' / ')
            log(`⚠️ 语法没过（第 19 关自动跑）：${p} —— ${why || '（没输出）'}`)
          }
        }
      } catch {
        /* fail-open：验语法出事，绝不许影响工具结果本身 */
      }
      return typeof next === 'function' ? next() : undefined
    })
    log('hook 已注册: tools/post-execute（改完 JS 自动验语法）', { silent: true })
  } catch (e) {
    log(`注册 tools/post-execute 失败: ${e}`)
  }
}

/** 启动自检：**必读清单几份、从哪来、解析成不成**（三问③：会不会静默失效 → 自报工作量）。 */
export function reportF30() {
  try {
    const L = requiredList()
    const stat = CAP_STATS.get('F30')
    const acted = stat && stat.count > 0 ? ` · 这一程动过 ${stat.count} 次（${stat.note || '—'}）` : ''
    // 🔴 2026-09-21：**判过 ≠ 拦过** —— 只报"拦过几次"时，"从没拦过"和"死了"长得一模一样
    //    （第 6 关就这么静默死了三天）。所以把"判过几次"一并报出来。
    const g = GATE_TICKS
    const gates =
      ` · 第 10 关判 ${g.reader.seen}/拦 ${g.reader.hit}` +
      ` · 第 11 关判 ${g.disk.seen}/拦 ${g.disk.hit} · 第 12 关判 ${g.debt.seen}/拦 ${g.debt.hit}`
    if (L.error) {
      return `动手前门卫 F30：⚠️ 必读清单解析失败（${L.error}）—— 这一关**这一程等于没开**${acted}${gates}`
    }
    return (
      `动手前门卫 F30：必读清单 ${L.files.length} 份（入口 ＋ 读序 ${L.order.length} 份，从 \`${L.entry}\` 现算）` +
      ` · ${L.files.map((f) => f.name).join(' / ')}${acted}${gates}`
    )
  } catch (e) {
    return `动手前门卫 F30：自检失败（${e && e.message ? e.message : e}）`
  }
}
