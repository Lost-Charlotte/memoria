/**
 * F30 · 第 17 关「永久删要人批准」—— 判据的样本回归（2026-09-27 加）。
 *
 * 由来（用户当天原话）〔会话 2026-09-27〕：
 *   "按防丢总则来。当初立这个规矩是**防止你对文件进行永久删除导致无法逆转的丢失**。我们需要将
 *    这份'**流水线**'对接死，**自动化结束直接删除。而你不能使用这个直接删除的口子**。类比一下就是
 *    **给这套流程罩个罩子**，避免你直接使用这个口子对文件进行直接删除。**但要留下检修口**否则坏了
 *    你也没法碰那不炸了。"
 *
 * 判据：`pwsh` 命令里出现 `-Permanent` → **除非用户最近一句里带固定格式准许**（`指令准许：…`）→ 否则拒。
 * ⚠️ 自动流水线（插件 F19）不走这个口子（它 `rmSync` 自己的快照），所以这一关只管"我手动去删"。
 *
 * 跑法：`node tests/f30-purge.mjs`（`node test.mjs` 会自动带上它）。
 */
import { check, done, makeArchive, sandboxHome } from './harness.mjs'

sandboxHome()

const root = makeArchive('f30purge', {
  '从这开始读.txt': 'DeepSeek 档案 —— 从这开始读\n',
  'L1-必读/00-总览-我们干过什么.md': '# 总览\n',
})
process.env.GAI_DANG_ROOT = root

const F30 = await import('../lib/f30-toolgate.js')
const SAID = await import('../lib/said.js')

const PERM = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\\x\\recycle-del.ps1' -ListFile C:\\x\\l.txt -AllowLocalDrives -Permanent -UserApprovedPurge`
const RECYCLE = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\\x\\recycle-del.ps1' -ListFile C:\\x\\l.txt -AllowLocalDrives`

console.log('— 第 17 关 · 永久删要人批准 —')
F30.__resetDiskTalk()

// ① 不含 -Permanent 的普通回收 → 不管（那是默认那条路）
SAID.__resetSaid()
SAID.noteUserSaid('P1', '把那个临时目录清一下')
check('✅ 普通回收（不带 -Permanent）→ 不拦', F30.purgeVerdict('pwsh', { command: RECYCLE }) === null)

// ② 含 -Permanent、用户没给准许 → 拒
SAID.__resetSaid()
SAID.noteUserSaid('P2', '把那个临时目录清一下')
const v1 = F30.purgeVerdict('pwsh', { command: PERM })
check('🔴 带 -Permanent、用户没点头 → 拦', v1 !== null && String(v1.tag).includes('永久删'))
check('   拒的理由里给了出路（去问用户 / 去掉 -Permanent）', v1 !== null && v1.reason.includes('指令准许'))

// ③ 用户给了**固定格式准许** → 放行（这就是检修口）
SAID.__resetSaid()
SAID.noteUserSaid('P3', '指令准许：把那批超期快照永久删掉')
check('🔴 用户给了 `指令准许：…` → 放行（检修口）', F30.purgeVerdict('pwsh', { command: PERM }) === null)

// ④ 🔴 反证：只说口语（"可以 / 同意 / 好的"）→ **不算批准**（2026-09-27 收紧的那条）
SAID.__resetSaid()
SAID.noteUserSaid('P4', '可以，你删吧')
check('🔴 只说口语（"可以"）→ **照样拦**（口语不再算批准）', F30.purgeVerdict('pwsh', { command: PERM }) !== null)

// ⑤ 别的工具带这个词 → 不管这一关
check('✅ 非 pwsh 工具 → 这一关不管', F30.purgeVerdict('read', { command: PERM }) === null)

done()
