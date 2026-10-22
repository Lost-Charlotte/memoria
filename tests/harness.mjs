/**
 * 测试脚手架。
 *
 * 三条硬规矩（为了让这套测试"体面"：换台机器也能跑）：
 *   1. **不依赖本机档案** —— 每个测试现造一份样本档案，跑完删掉。
 *   2. **不碰 ~/.dsh** —— 在 import 插件之前把 `DSH_HOME` 指到临时目录，
 *      这样插件的日志/状态文件全落在沙箱里，不污染真实运行数据。
 *   3. **不联网、不改任何用户文件。**
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** 插件入口（相对本文件，换目录也不会断）。 */
export const PLUGIN_ENTRY = new URL('../lib/index.js', import.meta.url).href

const created = []

/** 造一个沙箱 DSH_HOME。**必须在 import 插件之前调用**（HOME_DIR 在模块加载时算）。 */
export function sandboxHome() {
  const home = join(tmpdir(), `memoria-home-${process.pid}-${Math.random().toString(36).slice(2, 7)}`)
  mkdirSync(home, { recursive: true })
  created.push(home)
  process.env.DSH_HOME = home
  // ⚠️ **她的家也压到沙箱根**（2026-09-24 加）：`MEMORIA_DIR` 默认是 `DSH_HOME/memoria`，
  //    而各测试里"状态文件落在哪"是按沙箱根写的 —— 压平之后两边一致，
  //    既不用改一堆测试，也**绝不会碰到真的 `~/.dsh`**。
  process.env.MEMORIA_HOME = home
  // 🔴 **2026-10-07 加（多馆的副作用）**：`f32` 的**启动选馆**会在 `apply()` 时按"馆表里记忆的那个"
  //    改写 `CFG.archiveDir` —— 于是**测试传给 `apply()` 的沙箱档案根会被覆盖成真馆**
  //    （实测：`f17-map` 数出 `L1 根下 5 份（实得 8）`，而 8 就是真档案的份数）。
  //    病根不在 f32：**馆表本来就该隔离**（f32 自己写着 `MEMORIA_ARCHIVES_FILE` 是给测试隔离用的）。
  //    ⚠️ 为什么"以前一直绿、今晚才红"：那时馆表里**只有一个馆**，挑来挑去还是它；
  //    用户 2026-10-07 新建了第二个馆之后，这一挑就把沙箱档案根换掉了。
  process.env.MEMORIA_ARCHIVES_FILE = join(home, 'memoria-archives.json')
  return home
}

/** 造一份样本档案。files = { '相对路径': '内容' }。 */
export function makeArchive(name, files) {
  const root = join(tmpdir(), `memoria-archive-${process.pid}-${name}`)
  rmSync(root, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  created.push(root)
  return root
}

/** 跑完清场。 */
export function cleanup() {
  for (const p of created) {
    try {
      rmSync(p, { recursive: true, force: true })
    } catch {
      /* 删不掉就算了，反正在 temp 里 */
    }
  }
}

let pass = 0
let fail = 0

export function check(name, cond) {
  if (cond) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    // 🔴 2026-10-20 加：**失败就当场把退出码钉成 1**。
    //    原来只有 `done()` 会设退出码 —— 而当时有 **8 个测试文件忘了调 `done()`**
    //    （`f9-commit` / `f10-todo-sections` / `f24-overview` / `f27-citation` /
    //      `f30-scope-guard` / `f30-session-reader` / `f37-fastctx` / `tool-yinyong-qu-lujing`）
    //    ⇒ 那 8 个里**有断言失败也报绿**（实测 `f9-commit` 就真有一条挂了、一直没人发现）。
    //    现在：谁失败谁红，跟调没调 `done()` 无关。
    process.exitCode = 1
    console.log(`  ❌ ${name}`)
  }
}

export function done() {
  cleanup()
  console.log('')
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
}

/** 一个够用的 mock ctx（不需要 DSH）。注册过的工具在 `ctx.registered` 里。 */
export function mockCtx() {
  const handlers = {}
  const registered = []
  return {
    handlers,
    registered,
    on(ev, fn) {
      handlers[ev] = fn
    },
    tools: {
      register(t) {
        registered.push(t)
        return () => {}
      },
    },
    effect(fn) {
      try {
        fn()
      } catch {
        /* ignore */
      }
    },
  }
}

/** 载入插件（在 sandboxHome() 之后调用）。 */
export async function loadPlugin() {
  return await import(PLUGIN_ENTRY)
}
