/**
 * dsh-memoria —— 梅莫莉亚的**网页面板**（浏览器半边）
 *
 * 形态：**可拖动的悬浮窗**（照桌宠 deepseek-pet 的交互习惯：拖动 / 单击展开 / 记住位置），
 *       她本人就是入口 —— 点她展开控制台面板，看的是 `dangan_status` **同一份数据**。
 * 数据：同源 `fetch('/memoria/state')`（host 半边 `lib/f16-panel.js` 开的门）。
 * 形象：`/memoria/asset/*`（从桌面「梅莫莉亚形象库」来的 3 张 **抠好底的 PNG**）。
 *
 * 🔴 **免构建**：本文件是**手写**的 `__ModuleLoader__` factory（与官方 `dsh-client-ui-*` 产物同格式），
 *    用 `React.createElement` 而不写 JSX —— 所以**不需要 esbuild / 不需要打包**，
 *    与梅莫莉亚"零运行时依赖、免构建、改完即生效"一致。
 *
 * ⚠️ 三条自觉纪律：
 *   · **fail-open**：拿不到数据就显示"读不到"，**绝不因为面板坏了而影响别处**；
 *   · **只读**：这一版**不做任何写操作**（不给按钮去改模式 / 清待办）—— 先只读；
 *   · **拖动与点击必须分得开**：用"按下→抬起之间有没有移动过"判定（**不能用 onClick**，
 *     否则每次拖完都会顺手把面板开关一次 —— 这是第一版真踩过的坑）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-memoria',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')

    // ---------------- 配色（中性风：跟控制台/皮肤不冲突；蓝紫只用在进度条） ----------------
    const INK = '#1f2328'
    const SUB = '#57606a'
    const FAINT = '#8b949e'
    const LINE = '#e3e6ea'
    const PAPER = '#ffffff'
    const WASH = '#f6f7f9'
    const OK = '#1a7f37'
    const WARN = '#9a6700'
    const BAD = '#cf222e'
    const ACCENT = '#6f7bd6'
    const FONT = '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'
    const MONO = '"Cascadia Mono", "JetBrains Mono", Consolas, monospace'

    const POS_KEY = 'dsh-memoria-pet-pos'
    const SCALE_KEY = 'dsh-memoria-pet-scale'
    // 基础宽（100% 时的显示宽度）＋ 缩放范围。⚠️ 上限按**图的原生像素**定：
    // 形象图是 848px 宽的透明 WebP，所以缩到 250%（168 → 420px）时，**在 2x 屏上仍是 1:1**，
    // 再往上才会开始糊 —— 这就是"放大了也不失真"的边界，写在这儿免得以后瞎猜。
    const BASE_W = 168
    const SCALE_MIN = 0.6
    const SCALE_MAX = 2.5
    const clampScale = (v) => {
      const n = Number(v)
      if (!Number.isFinite(n)) return 1
      return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n))
    }
    const el = React.createElement

    /**
     * 🔴 **2026-10-20：localStorage 的两个小工具搬到这里**（原来在下面 400 多行处）。
     *
     * 为什么要搬：**"位置"与"缩放"两处用它的时候，它还没定义**（`const` 的 TDZ）⇒
     * 只好各自手写一套 `try { localStorage.getItem(…) } catch {}` —— 于是**三套并存**
     * （位置一套 / 缩放一套 / 这两个）。现在一处定义、三处共用。
     */
    const lsGet = (k, dflt) => {
      try {
        const v = localStorage.getItem(k)
        return v === null ? dflt : v
      } catch {
        return dflt
      }
    }
    const lsSet = (k, v) => {
      try {
        localStorage.setItem(k, String(v))
      } catch {
        /* 存不了就算了（下次回到默认） */
      }
    }

    // ---------------- 位置：拖动 + 记住 ----------------
    //
    // ⚠️ **2026-09-17 第三版 —— 真因确认了**（对照 `deepseek-pet` 那只桌宠的源码看出来的）：
    //   第一版"点她打不开面板"我以为是 `setPointerCapture` 把 click 吃掉了 —— **不准确**：
    //   参照实现**同时用了 `setPointerCapture` 和 `onClick`**，照样能点能拖。真正的毛病是**判定阈值**：
    //   我原来在 `pointermove` 里**无条件** `moved = true` —— 而真实的点击**几乎都会带 1px 抖动**
    //   （`pointermove` 一定会先来一下），于是**每一次点击都被判成拖动** → 开关永远不触发。
    //   参照实现用的是 `Math.hypot(dx, dy) > 4`。现在我照这个来（**位移 > 4px 才算拖动**），
    //   并且不用 capture：`pointerdown` 时把 `move`/`up` 挂到 **window**（鼠标移出她也照样跟手，
    //   这一点比 capture 更省心）—— 三条路都不会互相打架。
    const DRAG_SLOP = 4

    /**
     * @param tapRef  ref: () => void   没拖动就抬手 ＝ 点击（开合面板）
     * @param sizeRef ref: { w, h }     她当前的显示尺寸（缩放后要跟着变，才夹得住屏幕边界）
     */
    function usePetDrag(tapRef, sizeRef) {
      const size = () => (sizeRef && sizeRef.current) || { w: BASE_W, h: BASE_W * 1.49 }
      const clampPos = (p) => {
        const s = size()
        const maxL = Math.max(0, window.innerWidth - s.w)
        const maxT = Math.max(0, window.innerHeight - s.h)
        return { left: Math.min(Math.max(0, p.left), maxL), top: Math.min(Math.max(0, p.top), maxT) }
      }
      const [pos, setPos] = React.useState(() => {
        // 🔴 2026-10-20：走 `lsGet`（原来这里手写一套 try/catch —— "三套并存"之一）
        try {
          const s = lsGet(POS_KEY, null)
          if (s) {
            const p = JSON.parse(s)
            if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) return clampPos(p)
          }
        } catch {
          /* 读不到就用默认位置 */
        }
        return null // null ＝ 还没拖过 → 贴右下角
      })
      const live = React.useRef(pos)
      live.current = pos
      const st = React.useRef(null)

      const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return // 只认左键
        const box = e.currentTarget.getBoundingClientRect()
        st.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, sx: e.clientX, sy: e.clientY, moved: false }

        const onMove = (ev) => {
          const s = st.current
          if (!s) return
          if (!s.moved && Math.hypot(ev.clientX - s.sx, ev.clientY - s.sy) > DRAG_SLOP) s.moved = true
          if (!s.moved) return
          setPos(clampPos({ left: ev.clientX - s.dx, top: ev.clientY - s.dy }))
        }
        // 🔴 2026-10-20（子代理点名）：原来只撤 `pointerup` —— **窗口外松手 / 系统弹窗抢焦点 /
        //    面板被卸载**，这三个监听就永远留着（下次拖动位移翻倍）。现在三种收场都撤，
        //    而且 `pointercancel` / `blur` **不算点击**（否则一次系统中断会误开合面板）。
        const finish = (treatAsTap) => {
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          window.removeEventListener('pointercancel', onCancel, true)
          window.removeEventListener('blur', onCancel)
          const s = st.current
          st.current = null
          try {
            if (live.current) lsSet(POS_KEY, JSON.stringify(live.current))
          } catch {
            /* 存不了就算了（下次位置不记得而已） */
          }
          if (treatAsTap && s && !s.moved && tapRef && typeof tapRef.current === 'function') tapRef.current()
        }
        const onUp = () => finish(true)
        const onCancel = () => finish(false)
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
        window.addEventListener('pointercancel', onCancel, true)
        window.addEventListener('blur', onCancel)
      }

      /** 缩放变了 → 把她夹回屏幕内（否则放大后会有一半在屏幕外） */
      const reclamp = React.useCallback(() => {
        setPos((p) => (p ? clampPos(p) : p))
      }, [])

      return { pos, onPointerDown, reclamp }
    }

    // ---------------- 数据：同源 fetch（拿不到就如实说） ----------------
    //
    // 三条数据通道，**按需拉**（面板打开时只拉最轻的那条）：
    //   `/memoria/state` —— 顶端那一行 ＋「详情」（5 秒轮询一次，很轻）
    //   `/memoria/map`   —— 主区那张地图（要遍历档案目录，**只在真要显示时才拉**）
    //   `/memoria/todo`  —— 「待办 N」那个抽屉（不点就不读待办文件）
    function useJson(route, on, pollMs = 0) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [at, setAt] = React.useState(0)
      const load = React.useCallback(() => {
        fetch(route, { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              setData(j.data)
              setErr('')
            } else {
              // 🔴 2026-10-20：host 侧两条路由的失败字段**不统一**（`/memoria/state` 用 `error`、
              //    `/memoria/archives` 用 `why`）⇒ 这里两个都认，别只赌一个。
              setErr((j && (j.error || j.why)) || '数据有问题')
            }
            setAt(Date.now())
          })
          .catch((e) => setErr(String((e && e.message) || e)))
      }, [route])
      React.useEffect(() => {
        if (!on) return undefined
        load()
        if (!pollMs) return undefined
        const t = setInterval(load, pollMs)
        return () => clearInterval(t)
      }, [on, load, pollMs])
      return { data, err, at, reload: load }
    }

    // ---------------- 小积木 ----------------
    function Card(props) {
      return el(
        'div',
        { style: { border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 11px', background: PAPER } },
        el(
          'div',
          { style: { fontSize: 13, color: SUB, letterSpacing: 1, marginBottom: 5 } },
          props.title,
          props.badge
            ? el(
                'span',
                { style: { marginLeft: 8, color: props.badgeColor || FAINT, fontFamily: MONO, fontSize: 11 } },
                props.badge,
              )
            : null,
        ),
        props.children,
      )
    }

    function KV(props) {
      return el(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '1px 0' } },
        el('span', { style: { color: FAINT, flex: 'none' } }, props.k),
        el(
          'span',
          { style: { color: props.color || INK, fontFamily: MONO, textAlign: 'right', wordBreak: 'break-all' } },
          props.v,
        ),
      )
    }

    function Bar(props) {
      const pct = props.limit > 0 ? Math.min(100, Math.round((props.used / props.limit) * 100)) : 0
      return el(
        'div',
        null,
        el(
          'div',
          { style: { height: 6, background: WASH, borderRadius: 3, overflow: 'hidden', marginTop: 2 } },
          el('div', { style: { width: `${pct}%`, height: '100%', background: pct >= 80 ? WARN : ACCENT } }),
        ),
        el('div', { style: { fontSize: 11, color: FAINT, fontFamily: MONO, marginTop: 3 } }, `${props.used} / ${props.limit} 字符（${pct}%）`),
      )
    }

    // ---------------- 「详情」折叠区（体检 / 闸门 / 哨兵 / 预算 / 干活统计 / 最近注入） ----------------
    //
    // ⚠️ 2026-09-17 改版：**打开控制台先看到的是"档案馆地图"**，这些诊断信息收进这里
    //    （用户原话："我需要的不是这些内容……简化之后只在顶端显示就行了"）。
    //    **收起来 ≠ 删掉** —— 排查时一点就开，一件事没丢。
    function Details(props) {
      const { d, err } = props

      let body
      if (err) {
        body = el(
          'div',
          { style: { fontSize: 12, color: BAD, padding: '10px 0', lineHeight: 1.7 } },
          `读不到面板数据：${err}`,
          el('br'),
          el('span', { style: { color: FAINT } }, '（多半是 webServer 还没起来 —— 其它能力不受影响；点 ↻ 再试）'),
        )
      } else if (!d) {
        body = el('div', { style: { fontSize: 12, color: FAINT, padding: '10px 0' } }, '正在读……')
      } else {
        const cards = []

        cards.push(
          el(
            Card,
            { key: 'run', title: '在跑吗' },
            el(KV, { k: '版本 / 指纹（装载）', v: (d.run && d.run.stamp) || '（读不到）' }),
            d.run && d.run.drift
              ? el(KV, {
                  k: '⚠️ 磁盘 ≠ 装载',
                  v: `改的代码还没装载，要重启才生效 ｜ 磁盘 ${d.run.drift.disk}`,
                })
              : null,
            el(KV, { k: '档案根', v: d.archive.root }),
            el(KV, { k: '注入模式', v: d.archive.injectMode }),
          ),
        )

        if (d.check) {
          const c = d.check
          cards.push(
            el(
              Card,
              {
                key: 'check',
                title: '机械体检',
                badge: `${c.errors} 错 / ${c.tips} 提示`,
                badgeColor: c.errors > 0 ? BAD : c.tips > 0 ? WARN : OK,
              },
              el(KV, {
                k: '时间轴',
                v: `${c.timeline} 行（❗${c.must} ⭐${c.imp} ○${c.plain}${c.undecided > 0 ? ` 未定级 ${c.undecided}` : ''}）`,
              }),
              el(KV, { k: '事件', v: `${c.events} 条` }),
              el(KV, { k: '结论', v: c.errors === 0 ? '机械项全过' : '有错要修', color: c.errors === 0 ? OK : BAD }),
            ),
          )
        }

        if (d.gate) {
          const g = d.gate
          cards.push(
            el(
              Card,
              {
                key: 'gate',
                title: '落档闸门',
                badge: g.mode,
                badgeColor: g.mode === 'enforce' ? OK : g.mode === 'observe' ? WARN : FAINT,
              },
              el(KV, { k: '本会话已拦', v: `${g.denied} 次` }),
              el(KV, { k: '最近判定', v: g.lastVerdict || '（日志里还没有记录）' }),
            ),
          )
        }

        if (d.sentinels) {
          const s = d.sentinels
          cards.push(
            el(
              Card,
              { key: 'sent', title: '哨兵' },
              el(KV, { k: '作废口径', v: `${s.voided} 条` }),
              el(KV, {
                k: '路径锚点',
                v: `探测不到 ${s.anchorMissing} / 共查 ${s.anchorChecked}${s.offlineCount > 0 ? `（离线 ${s.offlineDrives.join('/')} 跳过 ${s.offlineCount}）` : ''}`,
                color: s.anchorMissing > 0 ? WARN : INK,
              }),
              el(KV, {
                k: '凭据',
                v: s.secretHits === null ? `模式 ${s.secretsMode}（不查）` : `模式 ${s.secretsMode} · ${s.secretHits} 处`,
              }),
            ),
          )
        }

        cards.push(
          el(
            Card,
            { key: 'budget', title: '注入预算' },
            el(Bar, { used: d.budget.used, limit: d.budget.limit }),
            el(KV, { k: '工具输出上限', v: `${d.budget.toolChars} 字符 / ${d.budget.toolLines} 行` }),
            d.budget.cut > 0 ? el(KV, { k: '上次注入被砍', v: `${d.budget.cut} 处`, color: WARN }) : null,
          ),
        )

        cards.push(
          el(
            Card,
            {
              key: 'caps',
              title: '干活统计',
              badge: (d.caps || []).length === 0 ? '这一程还没干活' : `${(d.caps || []).length} 项动过`,
            },
            (d.caps || []).length === 0
              ? el('div', { style: { fontSize: 12, color: FAINT } }, '（没出现的能力 ＝ 这一程一次都没动过）')
              : (d.caps || []).map((c) => el(KV, { key: c.id, k: c.id, v: c.note ? `${c.count} 次 · ${c.note}` : `${c.count} 次` })),
          ),
        )

        // 阈值真值（2026-09-19）：面板上出现的"几天 / 几遍 / 留几个"一律**从后端数据取**，不写死。
        // ⚠️ 右边那些数字只是**兜底**（老后端不带 `thresholds` 时用），**不是真值** —— 真值各在它的模块里
        //    （5 遍 = TODO_PASS_ALERT · L9 = `f19-tmpwatch.js` 的 RETAIN）。
        const TH = d.thresholds ?? {}
        const passAlert = TH.passAlert ?? 5
        // staleDays：🔴 2026-10-15 随「事件收尾」退役删除
        const l9Days = TH.l9Days ?? 3
        const l9Newest = TH.l9Newest ?? 20

        if (d.todo && Number.isFinite(d.todo.open)) {
          const over = Array.isArray(d.todo.overPassed) ? d.todo.overPassed : []
          cards.push(
            el(
              Card,
              { key: 'todo', title: '待办', badge: `还开着 ${d.todo.open}`, badgeColor: d.todo.open > 0 ? WARN : OK },
              el(KV, { k: '机器挑出"该消的"', v: `${d.todo.stale} 条` }),
              // F18 那一半：**过了 5 遍仍未动** 的条目 —— 该我主动去问用户了（用户 2026-09-17 点的）
              over.length > 0
                ? el(KV, { k: `过 ${passAlert} 遍仍未动`, v: `${over.length} 条（该问用户）`, color: WARN })
                : el(KV, { k: `过 ${passAlert} 遍仍未动`, v: '（没有）' }),
            ),
          )
        }

        // 🔴 2026-10-15：「事件收尾」那张卡随 G3 退役删除（它读的事件表随 L2 删了 ⇒ 恒 0，每轮白摆一张卡）。

        // L6-工具临时 层（F19，2026-09-17 晚加；**旧名 L9，2026-09-26 层重建改号**）：它会长胖 —— 所以把它摆出来，别让它悄悄长
        if (d.l9) {
          cards.push(
            el(
              Card,
              {
                key: 'l9',
                title: 'L6-工具临时',
                badge: `${d.l9.files} 个文件 / ${d.l9.mb} MB`,
                badgeColor: d.l9.over ? WARN : OK,
              },
              el(KV, { k: '其中快照', v: `${d.l9.snapshotCount} 个 / ${d.l9.snapshotMb} MB` }),
              el(KV, {
                k: '上次回收',
                v: d.l9.lastAt ? `${d.l9.lastOk ? `${d.l9.lastDropped} 个 · ${d.l9.lastMb} MB` : '没跑成'}（${String(d.l9.lastAt).slice(5, 16).replace('T', ' ')}）` : '还没回收过',
              }),
              el(KV, { k: '保留策略', v: `最近 ${l9Days} 天 ＋ 最新 ${l9Newest} 个 ＋ 每家族最新 1 个（其余进回收站）` }),
            ),
          )
        }

        cards.push(
          el(
            Card,
            { key: 'inject', title: '最近一次注入' },
            el(
              'div',
              { style: { fontSize: 11, color: SUB, fontFamily: MONO, lineHeight: 1.6, wordBreak: 'break-all' } },
              d.lastInject || '（这段里没找到注入记录 —— 不代表从来没注入过）',
            ),
          ),
        )

        body = el('div', { style: { display: 'grid', gap: 7, paddingTop: 9 } }, ...cards)
      }

      return body
    }

    // ---------------- 控制台（**地图为主**的只读面板） ----------------
    //
    // 结构（用户 2026-09-17 定的形态）：
    //   **顶端一行** —— 只放结论（在跑吗 / 体检 / 闸门 / 预算）＋ 几个入口（地图 / 待办 / 详情 / 收起 / 刷新）
    //   **主区**     —— **档案馆地图**：先按本来的**分层**（L1→L9），再按**功能/插件负责分室**
    //   **抽屉**     —— 待办逐条（事项 / 卡在哪 / 怎么算结 / 档案行号）；「详情」＝ 诊断信息（默认收起）
    //
    // ⚠️ 口径全在 host 侧（F17 地图 / F10 待办 / F15 状态），这里**只渲染，不判断**。
    //    面板宽度 420：地图那一列文件名长（`记录-2026-09-13至14-公盘整理总账.md`），336 放不下。
    const CK = { body: 'dsh-memoria-console-body', pane: 'dsh-memoria-console-pane', view: 'dsh-memoria-console-view' }

    /**
     * 面板宽度：**按屏幕给**（用户 2026-09-17 晚："我想这个面板稍微大一点，现在太小了有点不方便我查看"）。
     * 上限 **700**，屏幕不够就按 `innerWidth - 140` 收（留出她自己和边距的地方）。
     *
     * ⚠️ **Pet 的摆位 与 Console 的 `width` 必须调这同一个函数** —— 两边各写一个数，迟早漂。
     */
    function petPanelWidth() {
      try {
        return Math.max(420, Math.min(1000, Math.round(window.innerWidth - 160)))
      } catch {
        return 1000
      }
    }
    const BTN = {
      border: `1px solid ${LINE}`,
      background: PAPER,
      color: SUB,
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 13,
      lineHeight: 1.5,
      padding: '3px 9px',
      fontFamily: FONT,
      whiteSpace: 'nowrap',
    }
    const btn = (label, onClick, extra) =>
      el('button', { key: label, onClick, title: (extra && extra.title) || '', style: { ...BTN, ...(extra || {}) } }, label)
    const dot = (color) => el('span', { style: { color, fontSize: 12, lineHeight: 1 } }, '●')
    const hint = (text) => el('div', { style: { fontSize: 13, color: FAINT, padding: '10px 2px' } }, text)

    // ============================================================
    // 「暂缓」那一条（二级菜单 · 2026-10-01）
    // ============================================================
    // 🔴 **必须写在这一层**（factory 顶层）——**不许写进 `TodoView` 里面**：
    //    写在里面的话，每次 `TodoView` 重渲染（`/memoria/todo` 每 5 秒轮询一次 ＋ 每次开合面板）
    //    这个函数都是**新的一个**，React 认为"组件类型变了" ⇒ **卸载旧的、挂载新的** ⇒
    //    `useState` 清零 ⇒ 用户看到的症状："**他打开之后过几秒会自己闭合**"。
    // 🔴 **用函数声明**（会提升）：上一版用 `const` 箭头函数、又写在调用它的 `rowBtn` 之前，
    //    踩了暂时性死区（TDZ）⇒ 整个悬浮窗被卸载（用户："点了一下梅莫莉亚，她的形象直接没了"）。
    // ⚠️ 它只依赖**模块级**的 `el` / `btn` / 颜色常量；`plain()` 由 props 传进来（不抓外面）。
    /** props：`list` 暂停项数组 · `todoFile` 待办那份 · `projFile` 工程那份 · `plain` 剥标记的函数。 */
    function PausedBar(props) {
      const list = Array.isArray(props.list) ? props.list : []
      const [on, setOn] = React.useState(false)
      const pl = typeof props.plain === 'function' ? props.plain : (s) => String(s ?? '')
      const fileOf = (src) => (src === '工程' ? props.projFile : props.todoFile)
      if (list.length === 0) return null
      const kids = [
        el(
          'div',
          { key: 't', style: { display: 'flex', alignItems: 'center', gap: 6 } },
          el('span', { style: { color: FAINT, letterSpacing: 1 } }, '暂缓'),
          btn(`${list.length} 条 ${on ? '▴' : '▾'}`, () => setOn((v) => !v), {
            title: on ? '收起' : '摊开看：等条件 / 搁置 · 等拍板 / 等前置（做完的不在这里）',
          }),
          el('span', { style: { fontSize: 12, color: FAINT } }, '条件到了才办 —— 用户不提起我不催'),
        ),
      ]
      if (on) {
        for (const src of ['待办', '工程']) {
          const mine = list.filter((it) => it.from === src)
          if (mine.length === 0) continue
          kids.push(el('div', { key: `h:${src}`, style: { fontSize: 13, color: ACCENT, padding: '6px 0 2px' } }, `${src}　${mine.length} 条`))
          for (const it of mine) {
            kids.push(
              el(
                'div',
                { key: `i:${src}:${it.line}`, style: { marginBottom: 3 } },
                el('div', { style: { fontSize: 13, color: SUB, padding: '2px 0' } }, `${pl(it.item)}`),
                el('div', { style: { fontSize: 12, color: FAINT } }, `${pl(it.why) || '（没写原因）'}`),
                el('div', { style: { fontSize: 12, color: FAINT, fontFamily: MONO } }, `${fileOf(src)}:${it.line}`),
              ),
            )
          }
        }
      }
      return el('div', { style: { padding: '5px 0 4px', fontSize: 13 } }, ...kids)
    }

    /**
     * 一格小标签（只读 / 唯一能写 / 索引未登记 …）。
     * 🔴 **2026-10-11 修**：原来**根本不认 `onclick`** —— 调用方在「体检」和「事件超期」两处都传了
     *    `onclick: () => …`，本函数却只取 `title` / `style` / `children` ⇒ **事件连绑都没绑上**
     *    （用户当天报："**鼠标放上去会提示点一下看具体，实际没法点开**"）。
     *    ⚠️ 顺带把名字也摆正：**React 认的是 `onClick`** —— 原来那个小写 `onclick` 即使透传下去也无效。
     *    两种写法都收（不让老调用点白传），并给可点的加**手型光标**（不然没人知道它能点）。
     */
    function Chip(props) {
      const click = props.onClick || props.onclick
      return el(
        'span',
        {
          title: props.title || '',
          onClick: typeof click === 'function' ? click : undefined,
          style: {
            flex: 'none',
            fontSize: 12,
            lineHeight: 1.6,
            padding: '0 5px',
            borderRadius: 999,
            border: `1px solid ${props.color || LINE}`,
            color: props.color || FAINT,
            fontFamily: MONO,
            cursor: typeof click === 'function' ? 'pointer' : undefined,
          },
        },
        props.children,
      )
    }

    // ---------------- 地图的两张视图（**都是"图 ＋ 按钮 ＋ 点开详情"**） ----------------
    //
    // ⚠️ 2026-09-17 第二版（用户当场退回第一版："**这地图能好看吗？咱就不能真的做成一张图吗？
    //    塞这么多字，能不能变成按钮。。点开显示详细之类的？**"）。
    //    第一版的毛病：把索引那张表的"内容"列**铺在每一份文件下面** → 一屏全是字，看着像文档不像图。
    //    改法三条：① 顶上只留**结论行**（体检 / 索引 / 快照 / 自动重出 —— 2026-10-11 连那条体量图也删了）；
    //    ② 层 / 文件 / 能力**一律是按钮**，默认什么都不展开；
    //    ③ 详细（讲什么 / 何时读 / 权限）**点开才出**，一次只看一条。

    /**
     * 🔴 **2026-10-20 合并：层名原来有「三张平行表」**（颜色 / 小字 / 图标 —— 同一组 7 个层名各写一遍），
     *    而 `L8-施工归档` **真漏登记过一次**（2026-10-15 才补上，在此之前它一直吃默认灰）。
     *    现在一张：`color`（颜色）· `role`（层名后面那行小字）· `ico`（图标）。
     *    ⇒ **加一层 = 加一行**，三处再也不会漂。
     */
    const LAYER_META = {
      'L1-必读': { color: '#6f7bd6', role: '每轮必读', ico: '📖' },
      // 🔴 2026-10-15：`L2-用户` 用**暖色**（别层都中性偏冷）—— 它是"人"那一层，面板小字是「我记着你」。
      'L2-用户': { color: '#c98a9a', role: '我记着你', ico: '🧑' },
      'L3-知识': { color: '#5f8f70', role: '查时用', ico: '📚' },
      'L4-施工': { color: '#b07a5c', role: '未做完', ico: '🔧' },
      'L5-证据': { color: '#a08a5c', role: '只留底', ico: '🗄' },
      'L6-工具临时': { color: '#8b8f96', role: '机器托管层', ico: '🤖' },
      'L8-施工归档': { color: '#7d7f8a', role: '已归档', ico: '📦' },
    }
    // 🔴 2026-10-11：`layerShort()` 随体量图一起删了（图没了 ⇒ 它没人用）—— 死代码不留。
    const layerColor = (name) => (LAYER_META[name] || {}).color || FAINT
    const layerRole = (name) => (LAYER_META[name] || {}).role || ''
    const layerIco = (name) => (LAYER_META[name] || {}).ico || ''

    /** 名字太长就中间省略（详情卡里有全名）。 */
    const ellipsisMid = (s, n) => (s.length <= n ? s : `${s.slice(0, Math.ceil(n / 2))}…${s.slice(-Math.floor(n / 2) + 1)}`)

    /** 一张小卡：详情统一长这样（标题 ＋ 几行"标签：值"）。 */
    function DetailCard(props) {
      const rows = props.rows.filter((r) => r && r.v)
      return el(
        'div',
        {
          style: {
            marginTop: 6,
            border: `1px solid ${props.color || LINE}`,
            borderRadius: 8,
            padding: '7px 9px',
            background: WASH,
            lineHeight: 1.65,
          },
        },
        el('div', { style: { fontFamily: MONO, fontSize: 13, color: INK, wordBreak: 'break-all' } }, props.title),
        ...rows.map((r, i) =>
          el(
            'div',
            { key: i, style: { fontSize: 13, color: SUB, marginTop: i === 0 ? 4 : 3, lineHeight: 1.8 } },
            el('span', { style: { color: FAINT } }, `${r.k}：`),
            r.v,
          ),
        ),
      )
    }

    /** **分层**视图：五个层按钮（图标 / 层名 / 角色标签）；点层出文件按钮，点文件出详情。 */
    function MapLayers(props) {
      const m = props.m
      const focus = props.focus
      const [openLayer, setOpenLayer] = React.useState(null) // 一次只开一层（手风琴 —— 不然又是一屏字）
      // 🔴 2026-09-27：搜索命中 → **自动展开那一层 ＋ 把那份文件高亮 2 秒**
      //    （用户："帮我打开对应的层并且特殊显示一到两秒让我找到"）
      const [flash, setFlash] = React.useState(null)
      // 🔴 2026-09-27 加（用户当天："我本来想打开看看里面到底是什么东西，我草**一下子蹦出来这么多**……
      //    这合理吗？"）：**子目录默认收起**，点它才摊开。上一次是把每个子目录的文件**一次全列出来**，
      //    `L5-证据` 有 305 份，当然刷屏。
      const [dirOpen, setDirOpen] = React.useState(null)
      React.useEffect(() => {
        if (!focus || !focus.layer || !focus.file) return
        setOpenLayer(focus.layer)
        setFlash(focus.file)
        // 命中在子目录里 → 把那个子目录也自动展开（否则高亮了也看不见）
        if (focus.dir) setDirOpen(`${focus.layer}\\${focus.dir}`)
        const t = setTimeout(() => setFlash(null), 2000)
        return () => clearTimeout(t)
      }, [focus])

      /**
       * 🔴 **2026-10-20 合并：文件按钮原来写了两份**（根目录一份、子目录一份），逐字重复且**已经漂了**
       * —— 只有子目录那份挂搜索高亮，根目录那份连点击都没有（子代理点名）。
       * 现在一份：**点一下＝复制文件名**（面板里没有"打开文件"这条路 —— 浏览器开不了本地文件），
       * 复制成功就闪 0.9 秒当反馈。为什么给复制：想拿这份文件去搜、去引，复制名字就是最常用的下一步。
       */
      const fileBtn = (f) =>
        el(
          'button',
          {
            key: f.name,
            title: `${f.duty || '（索引里没写它讲什么）'}\n（点一下＝复制文件名）`,
            onClick: () => {
              try {
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(f.name)).catch(() => {})
              } catch {
                /* 复制不了也不影响别的 */
              }
              setFlash(f.name)
              setTimeout(() => setFlash((x) => (x === f.name ? null : x)), 900)
            },
            style: {
              ...BTN,
              fontFamily: MONO,
              fontSize: 13,
              padding: '3px 10px',
              display: 'inline-flex',
              gap: 6,
              alignItems: 'baseline',
              borderColor: flash === f.name ? ACCENT : f.registered ? LINE : WARN,
              color: SUB,
              background: PAPER,
              outline: flash === f.name ? `2px solid ${ACCENT}` : 'none',
            },
          },
          el('span', { style: { maxWidth: 430, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ellipsisMid(f.name, 46)),
          el(
            'span',
            { style: { color: FAINT, flex: 'none' } },
            f.bytes < 1048576 ? `${Math.max(1, Math.round(f.bytes / 1024))} KB` : `${(f.bytes / 1048576).toFixed(1)} MB`,
          ),
        )
      // 🔴 2026-10-11 用户（原话）：「**上面这个条……还有存在的必要吗。。。。**」
      //    ⇒ **那条体量图整个删了**（连同它下面"上图不含 L6…"那句）。
      //    为什么该删：① 它想说的"每层多大"，**每层那一行已经写着**（份数 ＋ MB）；
      //    ② 它恰恰是这一整天几乎所有毛病的发源地 —— L6 挤爆 74% → 改按字节 → `291%` →
      //       "给图用的过滤集合"误用到列表 → 图标/列全歪；**少一张图 = 少一处两个集合混用的机会**。

      return el(
        'div',
        null,
        // 🔴 2026-10-11 更正（用户："**不是不在上面给条，不是不在 l 显示啊……怎么整个 l6 都没了**"）：
        //    **列表永远是全部层**（L6 也要在！）—— 我曾把"给图用的过滤集合"误用到列表上，L6 连行带 🤖 消失了。
        ...m.layers.map((L, i) => {
          const on = openLayer === L.name
          const last = i === m.layers.length - 1
          const c = layerColor(L.name)
          return el(
            'div',
            { key: L.name, style: { display: 'flex', alignItems: 'flex-start' } },
            el(
              'button',
              {
                onClick: () => {
                  setOpenLayer(on ? null : L.name)
                },
                style: {
                  ...BTN,
                  flex: 'none',
                  // 🔴 2026-10-11 用户："**。。。。你觉得这对吗？**"（截图里 L6 被截成 `L6…`）——
                  //    根因：这里**写死 136px**，加了 🤖＋「机器托管层」后 L6 那一行装不下，被省略号截了。
                  //    ⇒ 放宽到 **230px**（🤖 ＋ 8 个中文字 ＋ 60px 标签列够用），并且**不再截断**。
                  width: 230,
                  overflow: 'visible',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 4,
                  padding: '3px 6px',
                  border: 'none',
                  background: 'none',
                  textAlign: 'left',
                },
              },
              el('span', { style: { color: FAINT, fontFamily: MONO, flex: 'none' } }, on ? '▾' : '▸'),
              // 🔴 2026-10-11 用户：「**emoji 呢……l 得对齐吧，- 得对齐吧 …… 啊啊啊啊**」——
              //    根因：只有 L6 有 emoji，**别的行没有** ⇒ "L6" 被整体右移，层名的 `L` 与 `-` 全跟别层错位。
              //    ⇒ 每层都给一个图标，并且放在**固定 20px** 的格子里（`textAlign:center`）：
              //      谁有谁没有、字形宽窄如何，层名那一列都从**同一个 x** 开始。
              (() => {
                const box = { key: 'ico', style: { flex: 'none', width: 20, textAlign: 'center', fontSize: 14 } }
                // 🔴 2026-10-20：小字与图标**不再各自一张表** —— 统一从 `LAYER_META` 取（见上面那条注）
                const role = layerRole(L.name)
                const ico = layerIco(L.name)
                return [
                  ico ? el('span', box, ico) : el('span', box, ''),
                  el('span', { key: 'nm', style: { color: on ? c : INK, fontSize: 14, whiteSpace: 'nowrap' } }, L.name),
                  el(
                    'span',
                    { key: 'role', style: { flex: 'none', width: 60, color: FAINT, fontSize: 11, fontFamily: MONO } },
                    role,
                  ),
                ]
              })(),
            ),
            // 连接件：竖干线 ＋ 横枝 ＋ 节点 —— 2026-09-19 用户："l1 跟 l2 之间**有上下引导关系的，用线段连接**"
            el(
              'div',
              { style: { flex: 'none', width: 26, alignSelf: 'stretch', position: 'relative' } },
              el('div', { style: { position: 'absolute', left: 7, top: 0, width: 2, background: LINE, ...(last ? { height: 17 } : { bottom: 0 }) } }),
              el('div', { style: { position: 'absolute', left: 7, top: 16, width: 18, height: 2, background: LINE } }),
              el('div', { style: { position: 'absolute', left: 4, top: 13, width: 8, height: 8, borderRadius: '50%', background: c } }),
            ),
            // 子内容：**横向**铺在这一层的纵坐标上（点层名才出）
            el(
              'div',
              { style: { flex: 1, minWidth: 0, paddingBottom: 8 } },
              el(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 7, fontSize: 13, color: FAINT, fontFamily: MONO, paddingTop: 4 } },
                el(
                  'span',
                  null,
                  // 🔴 2026-10-11 用户定：「**那就不显示行了吧**」—— 每层这串读数**去掉"行"**（保留份数 / MB；
                  //    行数既不代表分量，也容易把"表格长"误读成"这层重"）。
                  `${L.fileCount} 份 · ${((L.bytesTotal || 0) / 1048576).toFixed(2)} MB${L.dirCount ? ` · ${L.dirCount} 目录（含子目录 ${((L.bytesAll || 0) / 1048576).toFixed(2)} MB）` : ''}`,
                ),
                on ? null : el('span', null, '点层名看里面有什么'),
              ),
              on
              ? el(
                  'div',
                  { style: { padding: '5px 0 0 0' } },
                  L.note ? el('div', { style: { fontSize: 13, color: FAINT, paddingBottom: 5, lineHeight: 1.7 } }, L.note) : null,
                  // 🔴 2026-09-19 用户改：文件从"挤成一排 chips"改成**一行一个**（跟待办那种排列一致）——
                  //   原话："**我希望梅莫莉亚的地图能在控制面板上按照这样的形式进行排列。**"（附的是待办那一屏的截图）
                  el(
                    'div',
                    { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                    ...L.files.map(fileBtn),
                  ),
                  // 🔴 2026-09-27：子目录**默认收起**（点它才摊开）—— 见上面 `dirOpen` 那段注释。
                  //    但**要能看出里面有谁**：命中它里面的文件时会自动展开并高亮。
                  ...(L.dirs || []).map((x) => {
                    const dkey = `${L.name}\\${x.name}`
                    const inFlash = flash && (x.list || []).some((f) => f.name === flash)
                    const show = dirOpen === dkey || Boolean(inFlash)
                    return el(
                      'div',
                      { key: 'dir-' + x.name, style: { paddingTop: 4, width: '100%' } },
                      el(
                        'button',
                        { onClick: () => setDirOpen(show ? null : dkey), style: { ...BTN, fontSize: 13, padding: '2px 8px', color: FAINT } },
                        `${show ? '▾' : '▸'} ${x.name}\\　（${x.files} 个文件）`,
                      ),
                      show
                        ? el(
                            'div',
                            { style: { display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 4, paddingLeft: 16 } },
                            ...(x.list || []).map(fileBtn),
                          )
                        : null,
                    )
                  }),
                )
              : null,
            ),
          )
        }),
      )
    }

    /** **分室**视图：几间室各做一个方块按钮；点开一间出能力按钮；点一个能力出详情。
     *  ⚠️ 2026-09-25：原先 F7（落档闸门）/ F30（动手前门卫）被塞在「写入口」那一间里，用户找不到"闸门"这一类
     *    → 现在单立一间「闸门」（见 `manifest.js` 的 `ROOMS`）；**逐道门的说明在「闸门」那一页**。 */
    function MapRooms(props) {
      const m = props.m
      const [openRoom, setOpenRoom] = React.useState('写入口') // 默认开"写入口"（唯一能碰档案的一间）
      const [picked, setPicked] = React.useState(null)
      const roomColor = { 写入口: BAD, 哨兵: WARN, 读用工具: ACCENT, 钩子: '#4c8fb5' }
      const permChip = (it) =>
        /唯一被允许写/.test(it.perm)
          ? Chip({ color: BAD, title: it.perm, children: '唯一写口' })
          : it.perm
            ? Chip({ color: FAINT, title: it.perm, children: /只读/.test(it.perm) ? '只读' : '看一眼' })
            : null

      // 🔴 2026-10-20：`m.rooms` 缺席时原来直接 `.find` ⇒ **整棵崩**（子代理点名的 7 处之一）
      const rooms = Array.isArray(m.rooms) ? m.rooms : []
      const room = rooms.find((r) => r.room === openRoom) || rooms[0]
      return el(
        'div',
        null,
        // 四个方块：一眼看出分成哪几间、各几个部件
        el(
          'div',
          { style: { display: 'flex', gap: 5, margin: '7px 0 6px' } },
          ...m.rooms.map((r) => {
            const on = room && r.room === room.room
            const c = roomColor[r.room] || FAINT
            return el(
              'button',
              {
                key: r.room,
                onClick: () => {
                  setOpenRoom(r.room)
                  setPicked(null)
                },
                style: {
                  ...BTN,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1,
                  padding: '6px 2px',
                  borderColor: on ? c : LINE,
                  background: on ? WASH : PAPER,
                  borderTop: `3px solid ${c}`,
                },
              },
              el('span', { style: { fontSize: 14, color: on ? INK : SUB } }, r.room),
              el('span', { style: { fontFamily: MONO, fontSize: 13, color: FAINT } }, `${r.items.length} 个`),
            )
          }),
        ),
        room
          ? el(
              // 🔴 2026-09-19 用户改：部件也从"chips"改成**一行一个**（与分层页、与待办同一套排列）
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
              ...room.items.map((it) => {
                const sel = picked && picked.code === it.code
                return el(
                  'button',
                  {
                    key: it.code,
                    onClick: () => setPicked(sel ? null : it),
                    // 🔴 2026-09-25 用户："里面的好多工具在鼠标放上去之后没有明确的详细说明。"
                    //    原先给的是 `scope`（＝"它管档案的哪一块"，内部行话）；现在**人话说明优先**
                    //    （`what` ＝能力清单里那句"它是干什么的"），截到 200 字免得悬停出一屏。
                    title: (it.what || it.scope || '（能力清单里没写它干什么）').slice(0, 200),
                    style: {
                      ...BTN,
                      fontSize: 13,
                      padding: '3px 10px',
                      display: 'inline-flex',
                      gap: 5,
                      alignItems: 'baseline',
                      borderColor: sel ? ACCENT : LINE,
                      color: sel ? ACCENT : SUB,
                      background: sel ? WASH : PAPER,
                    },
                  },
                  el('span', { style: { fontFamily: MONO, color: ACCENT } }, it.code),
                  el('span', null, it.title),
                  el(
                    'span',
                    { style: { color: FAINT, fontFamily: MONO } },
                    it.ticks > 0 ? `${it.ticks} 次` : '—',
                  ),
                )
              }),
            )
          : null,
        picked
          ? el(DetailCard, {
              title: `${picked.code} ${picked.title}`,
              rows: [
                // 2026-09-25：**先说她干什么**（用户要"明确的详细说明"），再说权限与活跃度。
                { k: '它是干什么的', v: picked.what || '（能力清单里没写它干什么）' },
                { k: '它管档案的哪一块', v: picked.scope || '（那张对应表里没写它 —— 快照里可能没这条）' },
                { k: '对档案的权限', v: picked.perm ? permChip(picked) : '（地图那张对应表里没写）' },
                { k: '这一程动过几次', v: picked.ticks > 0 ? `${picked.ticks} 次` : '一次都没动' },
                {
                  k: '最后一次动',
                  v: picked.lastAt ? new Date(picked.lastAt).toLocaleString('zh-CN', { hour12: false }) : '（这一程还没动过）',
                },
              ],
            })
          : null,
      )
    }

    /** **档案馆条**（F32）—— 顶栏那条分隔线"拓宽"出来的那一条（用户 2026-09-23 要的）。
     *  三个能力：**点按钮切馆** · **改名** · **末尾 ＋ 新建**。
     *  🔴 改名**只改显示名**（磁盘目录一个字不动）；切馆由**人**点，AI 不自己切。 */
    function ArchiveBar(props) {
      const { a, onDone } = props
      const [msg, setMsg] = React.useState('')
      // 🔴 2026-10-20 加：**连点守卫**（原来没有 —— 连按两下「切馆」会发两次 POST；
      //    而且 `msg` 永不清，看到的总是上一次的结果）
      const [busy, setBusy] = React.useState(false)
      if (!a || !a.items || a.items.length === 0) return null
      const run = (body, okMsg) => {
        if (busy) return
        setBusy(true)
        setMsg('…')
        return fetch('/memoria/archives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then((r) => r.json())
          .then((r) => {
            setMsg(r && r.ok ? okMsg : `没成：${(r && (r.why || r.error)) || '（没说为什么）'}`)
            if (r && r.ok && onDone) onDone()
          })
          .catch((e) => setMsg('没成：' + String((e && e.message) || e)))
          .finally(() => setBusy(false))
      }
      const rename = (it) => {
        const to = window.prompt(`把「${it.name}」改叫什么？（只改显示名，磁盘目录不动）`, it.name)
        if (to === null) return
        const nm = String(to).trim()
        if (!nm || nm === it.name) return
        run({ action: 'rename', name: it.name, to: nm }, `已改名为「${nm}」（磁盘目录没动）`)
      }
      return el(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '5px 0 4px', fontSize: 13 } },
        el('span', { style: { color: FAINT, letterSpacing: 1 } }, '档案馆'),
        a.items.map((it) =>
          el(
            'span',
            { key: it.dir, style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
            btn(
              it.exists === false
                ? `${it.name}（目录不在）`
                : it.healthy === false
                  ? `${it.name}（骨架不全）`
                  : it.name,
              () => {
                // 🔴 2026-10-20：**目录不在的馆原来也能点**（切过去必然失败）—— 现在点不动。
                if (!it.active && it.exists !== false) run({ action: 'switch', name: it.name }, `已切到「${it.name}」`)
              },
              {
                ...(it.active ? { borderColor: ACCENT, color: ACCENT } : {}),
                title: `${it.dir}${it.active ? '（当前这个）' : ' · 点一下切过去'}`,
              },
            ),
            btn('✎', () => rename(it), { title: '改名（只改显示名，磁盘目录不动）' }),
          ),
        ),
        msg ? el('span', { style: { color: msg.startsWith('…') || msg.startsWith('没成') ? WARN : FAINT } }, msg) : null,
      )
    }

    /** **闸门**页：把两套门**逐道**摆出来（说明书 ＋ 此刻的数）。
     *  🔴 为什么单立一页（用户 2026-09-25 原话〔会话 2026-09-25〕）：
     *    "我需要了解我们一共有多少闸门，并且知道他们在什么时候触发，什么时候只是提醒，什么时候是拦截……
     *     所以应该有可视化的界面由我来进行判断。"
     *  ⚠️ **说明书只有一个来源**：`manifest.js` 的 `GATES`（判据本身仍在 F7 / F30 的代码里）。
     *  ⚠️ **判不出来的"此刻状态"一律不显示** —— 不许猜（显示一个假读数比不显示更坏）。 */
    function MapGates(props) {
      const { d } = props
      const g = d && d.gates
      if (!g || !Array.isArray(g.specs)) return hint('闸门表还没回来（要等状态那一份数据）')
      const t = (d && d.gate) || {}
      // st：🔴 2026-10-15 随 G3 退役删除
      const c = (d && d.check) || {}
      const ticks = g.ticks || {}
      const tickOf = { 6: 'reread', 10: 'reader', 11: 'disk', 12: 'debt' }
      /** 此刻"亮着"的，只报**判得出来**的那两道（其余留空，不许猜）。 */
      const why = (key) => {
        if (key === 'G2') return c.errors > 0 ? `体检：**${c.errors} 条要修**` : ''
        // G3：🔴 2026-10-15 已退役删除（它读的事件表随 L2 删了 ⇒ 恒不触发）
        return ''
      }
      const top = (label, color, title) => Chip({ color, title, children: label })
      return el(
        'div',
        { style: { paddingTop: 2 } },
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, paddingBottom: 7 } },
          top(
            `落档闸门 ${t.mode || '?'}`,
            t.mode === 'enforce' ? BAD : t.mode === 'observe' ? WARN : FAINT,
            'F7 的模式：enforce＝真拦 · observe＝只记日志 · off＝全关',
          ),
          top(
            `动手前门卫 ${g.f30Mode || '?'}`,
            g.f30Mode === 'enforce' ? BAD : g.f30Mode === 'observe' ? WARN : FAINT,
            'F30 的模式：enforce＝真拦 · observe＝只记日志 · off＝全关',
          ),
          top(`本会话被拦 ${t.denied || 0} 次`, (t.denied || 0) > 0 ? WARN : FAINT, '落档闸门记的累计数（跨多个回合）'),
          top('本回合被拦 —', FAINT, '这一项还没有读数：要动 F30 加一个"每回合清零"的计数。在那之前不显示假数。'),
          t.lastVerdict
            ? el('span', { style: { color: FAINT, fontFamily: MONO, fontSize: 12 } }, `最近：${String(t.lastVerdict).slice(0, 60)}`)
            : null,
        ),
        ...g.specs.map((grp) =>
          el(
            'div',
            { key: grp.key, style: { borderTop: `1px solid ${LINE}`, paddingTop: 6, marginBottom: 8 } },
            el(
              'div',
              { style: { display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', paddingBottom: 3 } },
              el('span', { style: { fontSize: 15, color: INK } }, grp.group),
              el('span', { style: { color: FAINT, fontFamily: MONO, fontSize: 12 } }, `${grp.key} · ${grp.items.length} 道`),
              Chip({ color: BAD, title: '这一套的动作：拦', children: grp.act }),
              el('span', { style: { color: SUB, fontSize: 13 } }, `触发时机：${grp.when}`),
            ),
            el('div', { style: { fontSize: 12, color: FAINT, paddingBottom: 5, lineHeight: 1.7 } }, grp.note),
            ...grp.items.map((it) => {
              const w = why(it.key)
              const tk = tickOf[it.key] ? ticks[tickOf[it.key]] : null
              return el(
                'div',
                {
                  key: it.key,
                  style: { display: 'flex', alignItems: 'baseline', gap: 7, padding: '2px 0', fontSize: 13, flexWrap: 'wrap' },
                },
                el('span', { style: { fontFamily: MONO, color: ACCENT, flex: 'none', minWidth: 48 } }, it.key),
                el('span', { style: { color: INK, flex: 'none' } }, it.name),
                el('span', { style: { color: FAINT, fontFamily: MONO, fontSize: 12, flex: 'none' } }, it.on || ''),
                el('span', { style: { color: SUB } }, it.what),
                w ? Chip({ color: WARN, title: w, children: '此刻亮着' }) : null,
                tk ? el('span', { style: { color: FAINT, fontFamily: MONO, fontSize: 12 } }, `判 ${tk.seen} / 拦 ${tk.hit}`) : null,
              )
            }),
            el('div', { style: { fontSize: 12, color: FAINT, paddingTop: 3 } }, `判据的唯一权威：${grp.src}`),
          ),
        ),
      )
    }

    /** 地图主区（分层 / 分室 / 闸门 三个页签 ＋ 检查那一行 ＋ 对账与快照那一行）。 */
    function MapView(props) {
      const { m, d, err, view, setView } = props
      if (!m) {
        return err
          ? el('div', { style: { fontSize: 11, color: BAD, padding: '10px 2px', lineHeight: 1.7 } }, `读不到地图：${err}`)
          : hint('正在读地图……（要遍历档案目录，稍等一下）')
      }
      const tab = (label, id) =>
        el(
          'button',
          {
            key: id,
            onClick: () => setView(id),
            style: { ...BTN, border: 'none', background: 'none', color: view === id ? ACCENT : FAINT, padding: '0 2px', fontSize: 15 },
          },
          `${view === id ? '◉' : '○'} ${label}`,
        )
      const snap = m.snapshot
      const c = d && d.check
      // ⚠️ 2026-10-01：这里原来还有一份 `overPassed`（"僵尸待办"）—— 那一格（待办标签）当天被用户删了
      //    （"待办其实可以从这个里面删掉了"）⇒ 这份定义**没人用了，已删**。
      //    ⚠️ **警示没丢**：Console 的状态面板里那份照旧（见 `d.todo.overPassed` 那一处）。
      // 🔴 2026-09-27 加（用户要的）：**分层页的搜索栏** —— 搜文件名 → 自动展开它所在的层 ＋ 高亮 2 秒。
      //    用户原话〔会话 2026-09-27〕：「我需要在右上角加入搜索栏，例如我现在就很难在地图上找到你说的
      //    '参考线条归属口径'，搜索之后我希望他可以帮我打开对应的层并且特殊显示一到两秒让我找到。
      //    但搜索这个功能应该只能在分层这个界面使用，所以建议放在右上角 xxx份，xxx行，xxxmb 的下面。」
      // 🔴 2026-09-27 改（用户当天："我查找条件，他干脆输出没有找到。**我不可能一比一复刻文件名字。
      //    我是人类，这不现实**"）：
      //    · **多词**：空格分隔，**每个词都要命中**；
      //    · **不只搜文件名** —— 名字 / 路径 / **讲什么** / **何时读** 四处任一命中就算
      //      （"条件"这类词只会在自述里，光搜名字当然找不到）；
      //    · 命中多个 → **列出来让他挑**（原来只认第一个）。
      const [q, setQ] = React.useState('')
      const [focus, setFocus] = React.useState(null)
      const [hits, setHits] = React.useState([])
      // 🔴 2026-10-01：体检那格**点开看明细**（用户当天要的："能不能加一个…或者做成能点的按钮？"）
      const [checkOpen, setCheckOpen] = React.useState(false)
      // 🔴 2026-10-01：事件超期那格也**点开看是哪几条**（用户当天："**事件超期可以有**"）
      const [staleOpen, setStaleOpen] = React.useState(false)
      const jump = (h) => setFocus({ layer: h.layer, file: h.file, dir: h.dir, at: Date.now() })
      const search = () => {
        const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
        if (words.length === 0) return
        const hay = (f) => `${f.name || ''} ${f.path || ''} ${f.duty || ''} ${f.when || ''}`.toLowerCase()
        const out = []
        for (const L of m.layers) {
          const push = (f, dir) => {
            if (words.every((w) => hay(f).includes(w))) out.push({ layer: L.name, file: f.name, dir, path: f.path })
          }
          for (const f of L.files || []) push(f, null)
          for (const d of L.dirs || []) for (const f of d.list || []) push(f, d.name)
        }
        setHits(out)
        if (out.length === 0) setFocus({ miss: q.trim(), at: Date.now() })
        else jump(out[0])
      }
      return el(
        'div',
        null,
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '7px 0 2px' } },
          tab('分层', 'layers'),
          tab('分室', 'rooms'),
          tab('闸门', 'gates'),
          el(
            'span',
            { style: { marginLeft: 'auto', color: FAINT, fontFamily: MONO, fontSize: 13 }, title: '口径：**只算各层「根下」的 md/txt 正文** —— 子目录（L5-证据 300+ 份、L6-工具临时 2400+ 份快照）不计入；全档体积看左边那枚 L6 chip' },
            `${m.totals?.files ?? '?'} 份 · ${((m.totals?.bytes || 0) / 1048576).toFixed(2)} MB 正文`,
          ),
        ),
        // ── 搜索栏（2026-09-27 加 · 用户要的）：**只在"分层"页出现**，放在右上角那三个数的下面 ──
        //    用户原话：「我需要在右上角加入搜索栏……搜索之后我希望他可以帮我打开对应的层并且特殊显示
        //    一到两秒让我找到。但搜索这个功能应该只能在分层这个界面使用。」（鼠标悬停能看到口径）
        view === 'layers'
          ? el(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, margin: '2px 0 4px' } },
              el('input', {
                value: q,
                placeholder: '搜文件名（如 条线归属口径）→ 回车',
                onChange: (e) => {
                  const v = e.target.value
                  setQ(v)
                  // 清空搜索框 ⇒ 命中那几行一起收掉（2026-10-19 用户：删掉内容后它们不消失，很占地方）
                  if (!v.trim()) {
                    setHits([])
                    setFocus(null)
                  }
                },
                onKeyDown: (e) => {
                  if (e.key === 'Enter') search()
                },
                style: {
                  flex: '0 1 430px',
                  font: 'inherit',
                  fontSize: 13,
                  padding: '3px 8px',
                  border: `1px solid ${LINE}`,
                  borderRadius: 6,
                  background: PAPER,
                  color: 'inherit',
                },
              }),
              el('button', { onClick: search, style: { ...BTN, fontSize: 13, padding: '3px 10px' } }, '找'),
              focus && focus.miss
                ? el('span', { style: { color: WARN, fontSize: 13 } }, `没找到「${focus.miss}」（名字 / 讲什么 / 何时读 里都没有）`)
                : null,
              // 🔴 命中多个 → **列出来让他挑**（原来只跳第一个，太武断）
              hits.length > 1
                ? el(
                    'div',
                    { style: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', paddingBottom: 4, width: '100%' } },
                    el('span', { style: { color: FAINT, fontSize: 12 } }, `命中 ${hits.length} 个：`),
                    ...hits.slice(0, 15).map((h) =>
                      el(
                        'button',
                        { key: h.layer + h.path, onClick: () => jump(h), style: { ...BTN, fontSize: 12, padding: '1px 7px' } },
                        `${h.layer}${h.dir ? '\\' + h.dir : ''}\\${h.file}`,
                      ),
                    ),
                    hits.length > 15 ? el('span', { style: { color: FAINT, fontSize: 12 } }, `…还有 ${hits.length - 15} 个`) : null,
                  )
                : null,
            )
          : null,
        // ── 检查那一行（2026-09-25 加）：原先这些读数只在悬浮窗顶栏，地图上一个字都没有 ──
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, color: FAINT, paddingBottom: 4 } },
          c
            ? Chip({
                color: c.errors > 0 ? BAD : c.tips > 0 ? WARN : OK,
                title:
                  `机械体检：**${c.errors} 条要修** · 提示 ${c.tips} 条（时间轴 ${c.timeline} 行 · 事件 ${c.events} 条）` +
                  `\n👆 **点一下看是哪几条**`,
                // 🔴 2026-10-01（用户当天要的）：**这栏只显示数字，他看不出"是什么问题"** ——
                //    原话："**经常能看到各种问题，但我没法看究竟是什么地方出了问题。
                //    能不能加一个，比如我鼠标在上面就显示个小气泡告诉我是什么地方有什么问题，或者做成能点的按钮？**"
                //    ⇒ 做成**可点**：点开在下面摊出明细（数据来自 `/memoria/state` 的 `check.list`）。
                onclick: () => setCheckOpen(!checkOpen),
                children: `体检 错${c.errors}·提示${c.tips}${checkOpen ? ' ▴' : ' ▾'}`,
              })
            : null,
          c && checkOpen
            ? el(
                'div',
                {
                  style: {
                    flexBasis: '100%',
                    fontSize: 12,
                    lineHeight: 1.7,
                    padding: '4px 8px',
                    marginTop: 2,
                    border: `1px solid ${LINE}`,
                    borderRadius: 6,
                    background: 'rgba(127,127,127,0.06)',
                    fontFamily: MONO,
                    whiteSpace: 'pre-wrap',
                    color: c.errors > 0 ? BAD : FAINT,
                  },
                },
                (c.list && c.list.length > 0 ? c.list.map((x, i) => `${i + 1}. ${x}`) : ['（干净 —— 没有要报的）']).join('\n') +
                  (c.more > 0 ? `\n…还有 ${c.more} 条（要看全量走 \`dangan_check\`）` : ''),
              )
            : null,
          // 🔴 2026-10-15：「事件超期」那一格随 G3 事件收尾退役删除（它读的事件表随 L2 删了）。
          // 🔴 **2026-10-01 删掉"待办"这一格**（用户当天定，原话）：
          //    "**待办其实可以从这个里面删掉了，因为上面的地图左边有待办，上面带数字了，所以这个没啥用了。**"
          //    ⇒ 同一份读数**只留一处**（操作栏那个按钮），这儿不再重复摆。
          // 🔴 **2026-10-11 删掉"L6-工具临时 xxMB"这一格**（用户当天定）：
          //    原话「**临时工具多少 mb 在 l6 那块显示了，该删掉**」—— 同一份读数**只留一处**
          //    （地图里已经有 L6 那一行），这儿不再重复摆。
          // 🔴 **2026-10-11 同时删掉"预算 N%"这一格**（用户当天定）：
          //    原话「**还有预算那一栏，我记得好像是个废弃机制了。这个东西好像没运作过**」——
          //    属实：**2026-09-29「压缩后重注入」整条砍掉之后，"注入用量"这个指标本身没了**
          //    （见 `f15-status.js` 那一段注释与 `f12-budget.js`）⇒ 这一格量的是个不存在的量，删。
        ),
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, color: FAINT, paddingBottom: 4 } },
          (m.index?.missing?.length || 0) > 0
            ? Chip({ color: WARN, children: `索引漏登记 ${m.index?.missing?.length || 0}` })
            : Chip({ color: OK, children: '索引没漏' }),
          (m.index?.dead?.length || 0) > 0 ? Chip({ color: BAD, children: `死指针 ${m.index?.dead?.length || 0}` }) : null,
          !snap.exists
            ? Chip({ color: WARN, title: `读不到 ${snap.path}`, children: '地图快照读不到' })
            : snap.stale
              ? Chip({ color: WARN, title: `快照自称 ${snap.files} 份 / ${snap.lines} 行，现算对不上`, children: '⚠️ .md 是旧快照' })
              : Chip({ color: OK, title: snap.path, children: '.md 与现算一致' }),
          // 它自己动过了 —— 这件事也得摆出来（"自动"不等于"看不见"）
          snap.auto && snap.auto.at
            ? Chip({
                color: snap.auto.ok ? FAINT : WARN,
                title: `上次自动重出：${new Date(snap.auto.at).toLocaleString('zh-CN', { hour12: false })} · 跑了 ${snap.auto.ran} 遍 · ${snap.auto.after || ''}`,
                children: `自动重出 ${String(snap.auto.at).slice(11, 16)}`,
              })
            : null,
        ),
        view === 'gates' ? el(MapGates, { d }) : view === 'rooms' ? el(MapRooms, { m }) : el(MapLayers, { m, focus }),
      )
    }

    /** **待办抽屉**：默认只列"这件事要做什么"（人话标题）；点开看**具体要做什么** ＋ 档案行号。
     *  🔴 2026-09-18 起：**"卡在哪 / 怎么算结"不再给用户看** —— 那是给 AI 的备注（留在文件第三格）。
     *  用户原话："**卡在什么地方和怎么结算不是需要我知道的。我需要知道的是这件事要做的是什么。**" */
    function TodoView(props) {
      const { t, err } = props
      // ⚠️ **hooks 必须在任何 return 之前**（否则"先没数据、后有数据"时 React 会报 hooks 数量变了）。
      const [openItem, setOpenItem] = React.useState(null)
      if (!t) {
        return err
          ? el('div', { style: { fontSize: 11, color: BAD, padding: '10px 2px', lineHeight: 1.7 } }, `读不到待办：${err}`)
          : hint('正在读待办……')
      }
      if (!t.file) return hint('找不到"待办"文件（名字里含「待办」的那份）')
      // ⚠️ **默认折叠、点开看详情** —— 2026-09-18 用户拍板**保留**（原话："**就目前这样就可以了。
      //    待办不是一直都只有三条。**" → 条数会涨，摊开又会变成一屏字）。
      // 🔴 **出处更正（2026-09-18）**：这条设计原先引的是"用户当天原话：能不能变成按钮。。点开显示详细之类的？"——
      //    而**那句原话是对"地图"说的**（2026-09-16 用户退回 0.20.0 地图时），被我**移花接木**安到了待办头上。
      //    现在这条设计**独立成立**（理由＝"条数会涨，别摊成一屏字"），**不再借那句原话**。
      // 🔴 2026-09-18：点开那部分**不再显示"卡在哪 / 怎么算结"**（那是给 AI 的备注，在文件第三格）。
      // ⚠️ 面板是**纯文本**渲染：`**` 会原样显示、`<br>` 也不会变成换行（用户截图里那些星号就是这么来的）——
      //    所以显示前统一过一道 `plain()`。
      const plain = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/\*\*/g, '').trim()
      // 🔴 2026-09-26 加「工程」（F35）—— 用户当天两句："**待办是待办，工程是工程**……**不允许将他们混为一谈**"
      //    ＋"**工程也是需要我在面板上能直接看到的**"，并要求加在待办那三节**下面**。
      //    所以：**同一屏、单独一节**，而数据来自**另一份文件**（`工程-清单.md`）。
      // ⚠️ 它**永远画**（哪怕 0 项）：藏起来 / 没数据就不显示 ＝ 又变回"得问才知道"，那不是"看得见"。
      const proj = t.projects && Array.isArray(t.projects.items) ? t.projects.items : []
      const projFile = t.projects && t.projects.file ? String(t.projects.file) : ''
      const projLimits = t.projects && t.projects.limits ? t.projects.limits : null
      // ⚠️ **2026-10-01 撤回**：这里原来取了 `paused` / `pausedFileOf` / `pausedOpen` 三个东西来画
      //    「暂缓」那一条 —— 面板连崩两次（先 TDZ、后"地图还没加载完就整个消失"），真因还没定位，
      //    **先一样都不留**（连 hook 也撤掉，免得留个没人用的状态在后面挖坑）。
      //    数据层照旧：`/memoria/todo` 的 `paused` 字段还在（17 条），随时可以画回来。
      const head = el(
        'div',
        { style: { fontSize: 13, color: FAINT, fontFamily: MONO, padding: '8px 0 3px', wordBreak: 'break-all', lineHeight: 1.7 } },
        `${t.file}　·　还开着 ${t.count} 条` + (projFile ? `　·　工程 ${proj.length} 项` : ''),
      )
      const noTodo = t.count === 0 ? el('div', { style: { fontSize: 13, color: OK, padding: '4px 0' } }, '没有还开着的条目 —— 干净') : null

      // 🔴 **「暂缓」那一条**（二级菜单 · 2026-10-01 第二版）—— **放在待办里面**（用户："该在待办里面"）、
      //    **默认折叠**（"放这里太夸张了"）。⚠️ **为什么单独立成一个组件**：
      //    第一版把它整段写在主组件里、又写在 `rowBtn` 之前 ⇒ 暂时性死区（TDZ）⇒ 面板整个被卸载。
      //    现在：① **用函数声明**（会提升，不受"定义先后"影响）② **展开内容只在真点开时构造**
      //    ③ 完全不碰主组件里的那些渲染助手。数据来自 `t.paused`（F16 合的：待办"等条件·搁置" ＋
      //    工程"等拍板/等前置"，**`[归档]` 与 `[已决]` 都不收**）。
      const paused = Array.isArray(t.paused) ? t.paused : []
      // ⚠️ **2026-10-01**：`PausedBar` 的**定义**已提到模块级（factory 顶层）——
      //    原先写在这儿 ⇒ 每次 `TodoView` 重渲染（`/memoria/todo` 每 5 秒轮询 ＋ 开合面板）
      //    它都是**新的一个函数**，React 认为"类型变了" ⇒ 卸载重挂 ⇒ **点开几秒后自己合上**。
      //    提到模块级后类型稳定，`useState` 才保得住。

      // ⚠️ **2026-10-01 修**：这一条原来写在这儿，但它调用的 `rowBtn` 定义在**下面** ——
      //    在 `const` 之前引用 ⇒ **暂时性死区（TDZ）**，一点开就抛 `ReferenceError`，
      //    整个悬浮窗被 React 卸载（用户实测："**点了一下梅莫莉亚，她的形象直接没了**"）。
      //    ⇒ 已挪到 `rowBtn` / `projBtn` **定义之后**、`return` 之前。

      /** 一条一行的折叠按钮（**待办与工程共用这一段**）——
       *  ⚠️ 两边各画一遍就是"两处必漂"（本档案的头号病根），所以只留这一份。
       *  `key` 用 `前缀:行号`（两份文件的行号会撞，光用行号会串折叠）。 */
      /**
       * 🔴 **2026-10-20 合并：行按钮的样式原来在「待办 / 工程 / 节点」三处各写一遍**
       *    （属性逐字相同，只有 `padding` 差一点）—— 改一处必漏另外两处。
       *    现在只留这一份；结构没动（三处的 children 本来就不一样）。
       */
      const rowStyle = (on, pad = '4px 10px') => ({
        ...BTN,
        width: '100%',
        display: 'flex',
        gap: 6,
        alignItems: 'baseline',
        padding: pad,
        textAlign: 'left',
        borderColor: on ? ACCENT : LINE,
        background: on ? WASH : PAPER,
      })

      /** 待办／工程那个可展开的行（两边各画一遍就是"两处必漂"，所以只留这一份）。
       *  `key` 用 `前缀:行号`（两份文件的行号会撞，光用行号会串折叠）。 */
      const rowBtn = (it, key, fileOf) => {
        const on = openItem === key
        return el(
          'div',
          { key, style: { marginBottom: 3 } },
          el(
            'button',
            {
              onClick: () => setOpenItem(on ? null : key),
              style: rowStyle(on),
            },
            el('span', { style: { color: FAINT, fontFamily: MONO, flex: 'none' } }, on ? '▾' : '▸'),
            el(
              'span',
              { style: { fontSize: 14, color: INK, lineHeight: 1.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              plain(it.item),
            ),
          ),
          on
            ? el(
                'div',
                { style: { padding: '6px 0 3px 16px', lineHeight: 1.8 } },
                // 🔴 2026-09-18：点开显示**完整三段**（内容 / 原因 / 目的）——
                //    第一版只给了"原因/目的"（以为折叠行已经显示内容就够了），用户当场问
                //    "**事项怎么丢了**"：折叠那行没标签，看起来就像少了一项。**三项一起给，别省。**
                //    面板是纯文本，所以过 `plain()` 剥掉标记。
                el(
                  'div',
                  { style: { fontSize: 13, color: SUB, whiteSpace: 'pre-wrap' } },
                  `内容：${plain(it.item) || '（没写）'}\n原因：${plain(it.why) || '（没写）'}\n目的：${plain(it.goal) || '（没写）'}`,
                ),
                el('div', { style: { fontSize: 12, color: FAINT, fontFamily: MONO } }, `${fileOf}:${it.line}`),
              )
            : null,
        )
      }

      /** 🔴 **工程一条一行**（2026-09-28 加）—— 跟待办**不一样**：它展开出来是
       *  「**外层总说明**（为什么要做 / 要达成什么）＋ 一条**节点链**」。
       *  用户当天的三句：①"**外部只放一个总体说明**，为什么要做这个，做这个要达成什么目的。**每个小点打开也是**，
       *  为什么要做什么，做这个要达成什么目的" ②"**有颜色表示就不要多加字了。保持界面的整洁性**"
       *  ③"**所有绿色的下一个，第一个灰色，就是我们现在的位置**"（所以当前位置＝第一个非绿节点，**不写"我在这"**）。 */
      const projBtn = (it, key, fileOf) => {
        // 🔴 2026-09-28 修（用户当天实测："**这个带颜色的小节点不能点开**"）：
        //    工程与节点**共用** `openItem` —— 点节点时它变成 `工程:行:nK`，工程那一行就判"不是我了"、
        //    整块收起 ⇒ 节点跟着父块一起消失，看着就是"点不开"。
        //    改法：**自己展开、或自己的某个节点展开时，工程都算展开**（节点 key 一律以 `${key}:n` 打头）。
        const on = openItem === key || String(openItem || '').startsWith(`${key}:n`)
        const ns = Array.isArray(it.nodes) ? it.nodes : []
        const cur = it.progress && it.progress.current >= 0 ? it.progress.current : -1
        return el(
          'div',
          { key, style: { marginBottom: 3 } },
          el(
            'button',
            {
              onClick: () => setOpenItem(on ? null : key),
              style: rowStyle(on),
            },
            el('span', { style: { color: FAINT, fontFamily: MONO, flex: 'none' } }, on ? '▾' : '▸'),
            el(
              'span',
              { style: { fontSize: 14, color: INK, lineHeight: 1.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              plain(it.item),
            ),
          ),
          on
            ? el(
                'div',
                { style: { padding: '6px 0 3px 16px', lineHeight: 1.8 } },
                el(
                  'div',
                  { style: { fontSize: 13, color: SUB, whiteSpace: 'pre-wrap' } },
                  `为什么要做：${plain(it.why) || '（没写）'}\n要达成什么：${plain(it.goal) || '（没写）'}`,
                ),
                ns.length
                  ? el(
                      'div',
                      { style: { marginTop: 6 } },
                      ...ns.map((n, k) => {
                        const nk = `${key}:n${k}`
                        const nOn = openItem === nk
                        const here = k === cur
                        return el(
                          'div',
                          { key: nk },
                          el(
                            'button',
                            {
                              onClick: () => setOpenItem(nOn ? null : nk),
                              style: rowStyle(nOn, '2px 8px'),
                            },
                            el('span', { style: { flex: 'none', fontSize: 13 } }, n.color || '⚪'),
                            el('span', { style: { flex: 'none', fontSize: 13, fontFamily: MONO, color: here ? INK : FAINT } }, `${n.n}.`),
                            el(
                              'span',
                              {
                                style: {
                                  fontSize: 13,
                                  color: here ? INK : SUB,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                              },
                              plain(n.name),
                            ),
                          ),
                          nOn
                            ? el(
                                'div',
                                { style: { fontSize: 12, color: SUB, padding: '2px 0 4px 26px', whiteSpace: 'pre-wrap' } },
                                (n.why ? `为什么要做：${plain(n.why)}\n` : '') + `完成判据：${plain(n.judge) || '（没写）'}`,
                              )
                            : null,
                        )
                      }),
                    )
                  : null,
                el('div', { style: { fontSize: 12, color: FAINT, fontFamily: MONO } }, `${fileOf}:${it.line}`),
              )
            : null,
        )
      }

      /** 按章节分好组再画（待办 / 工程都走它；`btn` 决定"一行怎么画" —— 待办用 rowBtn、工程用 projBtn）。 */
      const groupsEl = (rows, prefix, fileOf, btn = rowBtn) => {
        const groups = []
        for (const it of rows) {
          const last = groups[groups.length - 1]
          if (last && last.section === it.section) last.items.push(it)
          else groups.push({ section: it.section, items: [it] })
        }
        return groups.map((g) =>
          el(
            'div',
            { key: `${prefix}:${g.section}`, style: { paddingTop: 6 } },
            el('div', { style: { fontSize: 14, color: ACCENT, lineHeight: 1.7, paddingBottom: 3 } }, g.section),
            ...g.items.map((it) => btn(it, `${prefix}:${it.line}`, fileOf)),
          ),
        )
      }
      // ⚠️ **2026-10-01 临时撤下**：「暂缓」那一条先不画了 —— 它连续两次让面板崩掉
      //    （第一次 TDZ；第二次"面板能开、地图还没加载完就整个消失"），而我拿不到匹配的 React
      //    在本地复现。**先保面板能用**，定位到真因再画回来。数据层（`/memoria/todo` 的 `paused`）不动。

      return el(
        'div',
        null,
        head,
        noTodo,
        ...groupsEl(t.items, '待办', t.file),
        // 🔴 **「暂缓」那一条**（二级菜单 · 2026-10-01）—— 在还开着的条目**下面**、工程那一节**上面**。
        el(PausedBar, { key: '暂缓条', list: paused, todoFile: t.file, projFile, plain }),
        // 🔴 **工程那一节**（F35）—— 在待办那三节**下面**，**单独一节**。
        //    ⚠️ 标题与副标题都**不写 `**`**（面板是纯文本，写了会原样显示星号）。
        el(
          'div',
          { key: '工程节', style: { paddingTop: 12, marginTop: 10, borderTop: `1px solid ${LINE}` } },
          el(
            'div',
            { style: { fontSize: 14, color: ACCENT, lineHeight: 1.7 } },
            `工程（${proj.length} 项）` + (projLimits ? `　上限 ${projLimits.事项} / ${projLimits.原因} / ${projLimits.目的} 字` : ''),
          ),
          el(
            'div',
            { style: { fontSize: 12, color: FAINT, lineHeight: 1.7, paddingBottom: 4 } },
            (projFile ? `${projFile}　·　` : '') + '跨很多轮、工程量爆表的那种活 —— 不是待办',
          ),
          proj.length === 0
            ? el(
                'div',
                { style: { fontSize: 13, color: OK, padding: '2px 0' } },
                projFile ? '没有还开着的工程' : '档案里没有工程清单（`工程-清单.md`）',
              )
            : el('div', null, ...groupsEl(proj, '工程', projFile, projBtn)),
        ),
      )
    }

    /** 整个控制台：顶端一行 ＋（可收起的）主区。 */
    function Console(props) {
      const { open, onClose, width, maxHeight } = props
      const [body, setBody] = React.useState(() => lsGet(CK.body, '1') !== '0')
      const [pane, setPane] = React.useState(() => lsGet(CK.pane, 'map'))
      const [view, setView] = React.useState(() => lsGet(CK.view, 'layers'))
      // 🔴 2026-10-11 加（用户："**右上角刷新是无效按键，按了无事发生**"）：按钮确实在重新拉数据
      //    （`st.reload()`），但**没有任何反馈** ⇒ 数据本来就新时看着就像坏的。落一个"最近刷新"时刻，
      //    手动刷新后明说一句 —— 看得见才叫刷新过。
      const [lastRefresh, setLastRefresh] = React.useState(0)
      // 🔴 面板尺寸（可拖右下角改）—— 2026-09-19 用户："**以及平时看待办或者目前的地图这种不高的界面可以，
      //   看详情这种就会捅破天花板无法看清全貌**……或许可以将界面改为**可以拉动边角来改变宽高**。"
      //   `h: 0` ＝ 还没拖过 → 按内容自适应（吃 Pet 算出来的 `maxHeight`）；拖过就用他定的值。
      const [box, setBox] = React.useState(() => {
        try {
          const j = JSON.parse(lsGet('memoria.box', '') || '')
          if (j && typeof j.w === 'number' && typeof j.h === 'number' && j.w >= 360) return j
        } catch {
          /* 坏数据 ＝ 没存过 */
        }
        return { w: width || 1000, h: 0 }
      })
      React.useEffect(() => {
        lsSet(CK.body, body ? '1' : '0')
        lsSet(CK.pane, pane)
        lsSet(CK.view, view)
        lsSet('memoria.box', JSON.stringify(box))
      }, [body, pane, view, box])

      /** 右下角那个拖柄：按住改宽高。⚠️ `stopPropagation` 不能省 ——
       *  面板挂在"她"那个容器里，冒泡上去就成了"点她"＝**把面板关掉**（2026-09-17 那个坑）。 */
      const onGripDown = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const sx = e.clientX
        const sy = e.clientY
        const w0 = box.w
        const h0 = box.h || Math.round(e.currentTarget.parentElement.getBoundingClientRect().height)
        const move = (ev) => {
          const w = Math.max(360, Math.min(window.innerWidth - 24, w0 + (ev.clientX - sx)))
          const h = Math.max(220, Math.min(window.innerHeight - 24, h0 + (ev.clientY - sy)))
          setBox({ w, h })
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const st = useJson('/memoria/state', open, 5000)
      const mp = useJson('/memoria/map', open && body && pane === 'map')
      const td = useJson('/memoria/todo', open && body && pane === 'todo')
      const d = st.data
      const c = d && d.check
      const health = !d ? FAINT : c && c.errors > 0 ? BAD : (c && c.tips > 0) || (d.problems && d.problems.length > 0) ? WARN : OK
      const ver = d && d.run && d.run.stamp ? String(d.run.stamp).split(' · ')[0] : '…'
      const todoCount = d && d.todo && Number.isFinite(d.todo.open) ? d.todo.open : null
      // 🔴 2026-10-01：那个按钮里其实**还装着"工程"**（用户当天点出："里面已经是待办跟工程了"）
      //    ⇒ 读数也带上它（数据源就是状态里那一节 `d.project.open`，与状态面板同一份）。
      const projCount = d && d.project && typeof d.project.open === 'number' ? d.project.open : null
      const pick = (p) => {
        setBody(true)
        setPane(p)
      }
      const refreshAll = () => {
        setLastRefresh(Date.now())
        st.reload()
        if (pane === 'map') mp.reload()
        if (pane === 'todo') td.reload()
      }
      const active = (p) => (body && pane === p ? { borderColor: ACCENT, color: ACCENT } : null)

      const strip = el(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, color: SUB, paddingBottom: 2 } },
        dot(health),
        el('span', { style: { fontFamily: MONO, color: INK } }, ver),
        lastRefresh > 0
          ? Chip({ color: FAINT, title: '手动刷新完成 —— 面板数据已重新拉取', children: `已刷新 ${new Date(lastRefresh).toLocaleTimeString('zh-CN', { hour12: false })}` })
          : null,
        // 🔴 2026-09-25 用户拍板：**顶端不再摆读数**（体检 / 闸门 / 预算 / 收尾 / L9 全部撤掉）——
        //    原话："闸门这一项不要分散……左上角的那块如果可以的话，我希望取消。"
        //    它们现在集中在**地图**里：顶部「检查」那一行 ＋ 「闸门」那一页。
        //    这儿只留一个小圆点（她在忙还是闲），以及"有东西读不到"这种真故障。
        (d && d.problems && d.problems.length > 0) ? Chip({ color: WARN, title: d.problems.join('；'), children: `${d.problems.length} 处读不到` }) : null,
        el(
          'span',
          { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 } },
          // 🔴 **2026-10-01（用户当天定）**：这个按钮里**装的是两样东西**（待办 ＋ 工程），
          //    可它原来只写"待办 N" —— 用户原话："**上面那个待办里只写了待办，实际上里面已经是待办跟工程了，
          //    我觉得地图左边那个待办按钮可以改成 待办x/工程x 这样的形式。**"
          btn(
            todoCount === null
              ? '待办'
              : `待办 ${todoCount}${projCount === null ? '' : ` / 工程 ${projCount}`}`,
            () => pick('todo'),
            {
              ...(active('todo') || {}),
              color: active('todo') ? ACCENT : todoCount > 0 ? WARN : SUB,
              title:
                '逐条看还有什么要留意' +
                (projCount === null ? '' : `（里面两样：**待办 ${todoCount} 条** ＋ **工程 ${projCount} 项** —— 工程是"跨很多轮的活"，不是待办）`),
            },
          ),
          btn('地图', () => pick('map'), { ...(active('map') || {}), title: '档案馆结构（分层 / 分室）' }),
          btn('详情', () => pick('details'), { ...(active('details') || {}), title: '体检 / 闸门 / 哨兵 / 预算 / 干活统计' }),
          btn(body ? '▁ 收起' : '▸ 展开', () => setBody((v) => !v), { title: body ? '只留顶端这一行' : '展开正文' }),
          btn('↻', refreshAll, { title: '刷新' }),
          btn('×', onClose, { title: '关掉控制台（她自己还在）' }),
        ),
      )

      let main = null
      if (body) {
        // ⚠️ 地图页要 `d`（状态那一份）—— 「检查」那一行与「闸门」那一页的读数全从它来
        //    （2026-09-25 加：原先地图只拿得到 `mp`，于是"闸门在拦什么"在地图上根本看不见）。
        if (pane === 'map') main = el(MapView, { m: mp.data, d, err: mp.err, view, setView })
        else if (pane === 'todo') main = el(TodoView, { t: td.data, err: td.err })
        else main = el(Details, { d, err: st.err })
      }

      return el(
        'div',
        {
          style: {
            width: box.w,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: box.h || maxHeight || 'min(72vh, 900px)',
            // 🔴 **2026-09-17 晚 第三版：外框自己就是唯一的滚动区。**
            //    前两版是"外框卡高度 ＋ 里面一层滚动"，那要靠 flex 子项**肯不肯被压缩** ——
            //    它骗过我一次（flex 子项 `min-height` 默认 `auto` ＝ 内容高度，于是 maxHeight 只卡住
            //    外框、内容照样往外溢，看起来就是"面板被拉得老长"）。
            //    现在不用 flex 了：**块级盒子写 `max-height` ＋ `overflow:auto` 是铁定生效的**
            //    （浏览器一定会给它一个滚动条），顶端那一条改成 `sticky` 钉住。
            overflowY: 'auto',
            background: PAPER,
            border: `1px solid ${LINE}`,
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(16,22,26,.14)',
            fontFamily: FONT,
            userSelect: 'text',
          },
        },
        el(
          'div',
          {
            style: {
              position: 'sticky',
              top: 0,
              zIndex: 1,
              background: PAPER,
              padding: '11px 13px 8px',
              borderBottom: `1px solid ${LINE}`,
            },
          },
          // ⚠️ **2026-10-01**：档案馆条只在**地图**下画（用户点出它原来在待办里也显示）。
          //    ⚠️ 曾在这里挂过「暂缓」条 —— 已撤下（它让面板崩过两次，真因待定位）。
          strip,
          pane === 'map' ? el(ArchiveBar, { a: st.data && st.data.archives, onDone: refreshAll }) : null,
        ),
        body ? el('div', { style: { padding: '8px 13px 13px' } }, main) : null,
        // 拖柄（右下角）—— 2026-09-19 用户要"拉动边角改变宽高"。用 `sticky bottom` 钉住：
        // 放普通绝对定位会跟着内容一起滚，滚到中间就摸不着它了。
        el(
          'div',
          { style: { position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'flex-end', height: 0, pointerEvents: 'none' } },
          el(
            'div',
            {
              onPointerDown: onGripDown,
              onDoubleClick: () => setBox({ w: width || 1000, h: 0 }),
              title: '拖我改宽高 · 双击恢复默认',
              style: {
                pointerEvents: 'auto',
                width: 18,
                height: 18,
                cursor: 'nwse-resize',
                color: FAINT,
                fontSize: 12,
                lineHeight: '18px',
                textAlign: 'center',
                userSelect: 'none',
                touchAction: 'none',
              },
            },
            '◢',
          ),
        ),
      )
    }

    // ---------------- 她本人（悬浮窗） ----------------
    function Pet() {
      const [open, setOpen] = React.useState(false)
      const [hover, setHover] = React.useState(false)
      // 缩放（滚轮）—— 跟位置一样记在 localStorage 里
      const [scale, setScale] = React.useState(() => {
        // 🔴 2026-10-20：走 `lsGet`（"三套并存"之二）
        const v = Number(lsGet(SCALE_KEY, '1'))
        return Number.isFinite(v) && v >= SCALE_MIN && v <= SCALE_MAX ? v : 1
      })
      const [zooming, setZooming] = React.useState(false)
      // 眨眼帧：0=睁、1=半闭、2=闭、3=回半闭（回到 0 后重新等随机间隔）
      const [blink, setBlink] = React.useState(0)
      const zoomTimer = React.useRef(null)
      // 她当前的显示尺寸（拖动夹边界要用；缩放一变它就变）—— 由下面的 PET_W/PET_H 每轮刷新
      const sizeRef = React.useRef({ w: BASE_W, h: BASE_W * (1264 / 848) })
      // 点击 ＝ "按下又抬起、中间几乎没动" → 开合面板。
      // 用 ref 把回调递给 usePetDrag：免得它每次 render 都重挂 window 监听，
      // 也免得闭包抓到旧的 state。
      const tapRef = React.useRef(null)
      tapRef.current = () => setOpen((v) => !v)
      const { pos, onPointerDown, reclamp } = usePetDrag(tapRef, sizeRef)
      // ⚠️ 数据不在这儿拉了：控制台自己按需拉（state / map / todo 三条）——
      //    她只管"在哪儿、多大、开没开"，一个字节的档案数据都不碰。

      // ---------------- 滚轮缩放（做法学 `deepseek-pet` 那只桌宠） ----------------
      //
      // ⚠️ 三个要点，都是踩过才知道的：
      //   ① **必须用原生监听器 ＋ `{ passive: false }`**：React 的 `onWheel` 是**被动**监听器，
      //      里面 `preventDefault()` 无效（结果是"一边缩放、一边把页面滚走"，只在控制台留个警告
      //      —— 而浏览器控制台我平时看不见，正是"沉默 ≠ 正常"最爱藏的地方）。
      //   ② 步进用**指数**（`exp(-deltaY/500)`）而不是固定 ±10%：滚轮和触控板的 `deltaY` 差好几倍，
      //      指数式在两者上手感一致；参照实现是按档位调的，我这儿没档位、直接连续。
      //   ③ 缩完要**把她夹回屏幕内**（放大到 250% 时，原先贴右下的位置会有一半在屏幕外）。
      const petRef = React.useRef(null)
      // 🔴 2026-10-19：图片 URL 带一次性版本戳 —— **每次页面加载都换 URL**，
      //    浏览器再顽固的缓存（含内存里的那份）也绕得过去。换图不必再跟缓存斗。
      const assetV = React.useRef(Date.now()).current
      React.useEffect(() => {
        const node = petRef.current
        if (!node) return undefined
        const onWheel = (e) => {
          e.preventDefault() // 不许它顺便滚页面
          e.stopPropagation()
          setScale((s) => clampScale(s * Math.exp(-e.deltaY / 500)))
          setZooming(true)
          if (zoomTimer.current) clearTimeout(zoomTimer.current)
          zoomTimer.current = setTimeout(() => setZooming(false), 900)
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => {
          node.removeEventListener('wheel', onWheel)
          if (zoomTimer.current) clearTimeout(zoomTimer.current)
        }
      }, [])

      // 缩放一变：**记住** ＋ **夹回屏内**
      React.useEffect(() => {
        // 🔴 2026-10-20：走 `lsSet`（"三套并存"之三）
        lsSet(SCALE_KEY, scale)
        reclamp()
      }, [scale])

      // 眨眼：待机时每 3~7 秒眨一次（半闭 60ms → 闭 60ms → 半闭 60ms → 睁）；**悬停时不眨**。
      // 🔴 **2026-10-21 更正（用户当场问"为啥移出了开面板时候的眨眼"）**：
      //    昨晚我改成了"展开也不眨"，理由是那句老注释写着"展开/悬停时不眨"——
      //    **但那句注释是错的**：`assets/` 里躺着 **`memoria-show-half.webp` / `memoria-show-closed.webp`**
      //    两张**展开态的眨眼图** ⇒ 当初就是让她**面板开着也照眨**的（否则不必抠这两张）。
      //    ⇒ 现在：**悬停不眨（鼠标停在她身上会晃），展开照眨**。注释也改成了实话。
      //    ⚠️ DEP 里**不再带 `open`** —— 它在这段里没用到，带着只会让面板一开一合就重置定时器。
      React.useEffect(() => {
        if (hover) {
          setBlink(0)
          return undefined
        }
        const wait = blink === 0 ? 3000 + Math.random() * 4000 : 60
        const t = setTimeout(() => setBlink((b) => (b === 0 ? 1 : b === 1 ? 2 : b === 2 ? 3 : 0)), wait)
        return () => clearTimeout(t)
      }, [blink, hover])

      // 屏幕尺寸变了（换窗口 / 缩放页面）→ 重算一次（面板宽度是"按屏幕给的"）＋ 把她夹回屏内
      const [, bumpResize] = React.useState(0)
      React.useEffect(() => {
        const onResize = () => {
          bumpResize((n) => n + 1)
          reclamp()
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [reclamp])

      // 状态图：**展开时举起笔记本（show）**、悬停时像在忙（busy）、平时待机（idle）
      const img = open
        ? (blink === 2 ? 'memoria-show-closed.webp'
          : (blink === 1 || blink === 3) ? 'memoria-show-half.webp'
          : 'memoria-show.webp')
        : hover ? 'memoria-busy.webp'
        : blink === 2 ? 'memoria-idle-closed.webp'
        : (blink === 1 || blink === 3) ? 'memoria-idle-half.webp'
        : 'memoria-idle.webp'

      // ---------------- 摆位（几何都在这儿，面板一律**绝对定位**） ----------------
      //
      // ⚠️ 为什么面板不能当"流内兄弟"跟她在同一个 flex 列里（2026-09-17 改）：
      //   ① 面板宽 336、她只有 168 —— 一展开容器就变宽，而她是靠边对齐的，
      //      于是**她会横向跳 168px**（点一下人就窜出去，很怪）；
      //   ② 容器贴着屏幕右沿时，展开出来的面板会**有一半铺到屏幕外**。
      //   改成"她定住、面板绝对定位"之后：她一动不动，面板改按**哪边有地方**决定往哪铺。
      // 尺寸一律从 `scale` 推出来（图是 848×1264 → 高 ＝ 宽 × 1.4906）——
      // ⚠️ 下面 `img` 的 width **必须用同一个式子**（PET_W），否则面板会离她一段空隙。
      //
      // ⚠️ 2026-09-17 晚：**展开不再把她缩小**（用户："点开她的时候她会变小。。我觉得不太合适"）。
      //    原来展开时切成 124px 的小图，理由是"面板要在她旁边挤进来"；现在面板是绝对定位、
      //    想铺多大铺多大 —— 她缩不缩对排版毫无影响，那就不该缩。她只剩"悬停变大"这一个变化。
      const ASPECT = 1264 / 848
      const PET_W = Math.round((hover ? 190 : BASE_W) * scale)
      const PET_H = Math.round(PET_W * ASPECT)
      sizeRef.current = { w: PET_W, h: PET_H }
      // 面板宽度：**按屏幕给**（用户要"大一点"）—— 上限 700，屏幕窄就跟着收。
      // ⚠️ 这个数**同时**喂给控制台的 `width` 和下面的摆位计算（必须同源，否则面板会离她一段空隙）。
      const PANEL_W = petPanelWidth()
      const GAP = 8

      // 🔴 **2026-09-19 用户改：面板从"贴她的上/下"改成"贴她的左/右"** ——
      //   原话："**梅莫莉亚现在的控制面板打开是吸附在人物的上下的。而不是左右。
      //   我希望改到左右，这样可以显示更多信息。**"
      //   为什么左右反而显示得更多：原来纵向摆位时，面板高度被"她上面/下面还剩多少"卡着
      //   （`spaceH`）；摆到侧面之后高度就只跟**视口高**有关，一改就多出一大截。
      const petLeft = pos ? pos.left : window.innerWidth - 22 - PET_W
      const petTop = pos ? pos.top : window.innerHeight - 88 - PET_H
      // 铺哪边：**左边装得下就铺左边**（她多在右下角，左边最富余）；左边不够 → 铺右边。
      const spaceLeft = petLeft
      const spaceRight = window.innerWidth - (petLeft + PET_W)
      const side = spaceLeft >= PANEL_W + GAP + 8 || spaceLeft >= spaceRight ? 'left' : 'right'
      // 铺右边、而右边也不够时，把容器临时左移一点（保证整块面板都在屏内）；铺左边时容器**不动**。
      const needShift = open && side === 'right' && spaceRight < PANEL_W + GAP + 8
      const place = pos
        ? {
            left: needShift ? Math.max(8, window.innerWidth - PANEL_W - GAP - PET_W - 10) : pos.left,
            top: pos.top,
          }
        : { right: 22, bottom: 88 }

      // 高度：改左右之后**只跟视口高有关**（不再按"她上/下剩多少"算）。
      // ⚠️ 2026-09-17 那道 72vh 上限的由来（用户："**你是不是给宽度和长度搞错了。。我要的是宽度。。他怎么变长了。。**"）
      //    是**上下摆位**才必须压高度；改轴之后它就是负资产 —— 现在留 24px 边距、最多 90vh，内容多就在里面滚。
      const panelMaxH = Math.max(260, Math.round(Math.min(window.innerHeight - 24, window.innerHeight * 0.9)))
      // 纵向对齐：默认**与她的上边齐**；若这样面板底会冒出视口下沿，就改成与她的**下边齐**。
      const alignBottom = petTop + panelMaxH > window.innerHeight - 10

      const pic = el('img', {
        src: `/memoria/asset/${img}?v=${assetV}`,
        alt: '梅莫莉亚',
        draggable: false,
        onDragStart: (e) => e.preventDefault(),
        style: {
          width: PET_W, // ＝ 上面那个式子（含 scale）
          height: 'auto',
          display: 'block',
          transition: zooming ? 'none' : 'width .15s ease', // 滚轮缩放时别加过渡，否则跟手发飘
          // 图是带透明通道的 WebP（白底已在离线抠掉，见 assets/README）→ 阴影跟着她的轮廓走
          filter: open ? 'none' : 'drop-shadow(0 6px 14px rgba(16,22,26,.22))',
          cursor: 'grab',
        },
      })

      return el(
        'div',
        {
          style: {
            position: 'fixed',
            ...place,
            zIndex: 2147483000,
            fontFamily: FONT,
            userSelect: 'none',
            touchAction: 'none',
          },
        },
        el(
          'div',
          {
            // ⚠️ **拖动/点击必须挂在这一层（只包住她本人），不能挂在外层容器上** ——
            //    面板是**容器的另一个子节点**，挂在容器上时点面板里任何地方都会冒泡成"点她"，
            //    一点就把面板关掉（面板里全是只读内容，这个 bug 不会报错，只会"点了就消失"）。
            ref: petRef, // 滚轮缩放的原生监听器挂在这一层
            onPointerDown,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            title: '梅莫莉亚 —— 单击展开/收起控制台 · 拖我换位置 · 滚轮缩放',
            style: { cursor: 'grab', lineHeight: 0 },
          },
          pic,
        ),
        // 缩放读数（滚轮一滚就出现，900ms 后自己消失）—— **点它一下 ＝ 回到 100%**
        zooming
          ? el(
              'div',
              {
                onClick: () => setScale(1),
                title: '点一下回到 100%',
                style: {
                  position: 'absolute',
                  right: '100%',
                  top: 0,
                  marginRight: GAP,
                  background: 'rgba(31,35,40,.9)',
                  color: '#fff',
                  fontFamily: FONT,
                  fontSize: 11,
                  lineHeight: 1.4,
                  padding: '3px 7px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                },
              },
              `${PET_W}px · ${Math.round(scale * 100)}%`,
            )
          : null,
        // 控制台：绝对定位，贴在**她的左边或右边**（2026-09-19 用户改；原来贴她的上/下），
        // 纵向默认与她的上边齐、越出视口下沿时改与她的下边齐（见 `alignBottom`）。
        open
          ? el(
              'div',
              {
                style: {
                  position: 'absolute',
                  [side === 'left' ? 'right' : 'left']: PET_W + GAP,
                  [alignBottom ? 'bottom' : 'top']: 0,
                },
              },
              el(Console, { open, onClose: () => setOpen(false), width: PANEL_W, maxHeight: panelMaxH }),
            )
          : null,
      )
    }

    // ---------------- 插件入口 ----------------
    /**
     * ⚠️ **2026-09-17 修（重启后实测：她没出现）**：原来是这样写的 ——
     *     `const slots = ctx.get('slots'); if (slots === undefined) return`
     *   而 `slots` 是由客户端包（`@deepseek-ai/dsh-client-ui-layout` 那一串）提供的：
     *   **只要它比本插件晚就绪，`apply` 就一声不响地直接 return** ——
     *   人这边看到的就是"她根本没出来"，而且**没有任何报错**。
     *   （正是"沉默 ≠ 正常"，只不过这次犯在浏览器半边 —— 而浏览器控制台我平时看不见，所以更难发现。）
     *   两处一起改：① **不再"拿不到 slots 就放弃"，而是像 host 侧等 webServer 那样重试**
     *   （每 250ms 一次、共 10 秒），并在彻底失败时 `console.warn` 出声；
     *   ② 挂上之后**向 host 报个到**（POST `/memoria/client-hello`）—— 这样"她在不在"
     *   **会写进 `memoria.log`**，我不必再靠猜（浏览器控制台我平时看不见）。
     *
     *   🔴 **关于 `dsh.client.inject`：试过、又撤了**。样板（hermes / 桌宠）都声明了
     *   `inject: ['@deepseek-ai/dsh-client-runtime', …]`，我照抄时发现**本机这个部署里
     *   找不到 `dsh-client-runtime`**；而 modules 文档写明"**缺失提供方会让组合阶段拒绝**" ——
     *   那可能把**整个界面**弄白屏。**为一个还没证实的假设冒白屏的险，不值**；
     *   而"重试"本身就能覆盖"slots 晚就绪"这一种情形。**所以：先不声明，靠重试；
     *   真要 inject，先确认那些包在本机确实存在**（照《铁律》那套"先验证再动"）。
     */
    /**
     * 🔴 **2026-10-20 加：最小错误边界**（子代理通读后点名的第一条）。
     *
     * 病：原来**没有 ErrorBoundary**，而面板里有 7 处直接读 `d.archive.*` / `d.budget.*` / `m.totals.files`
     * 这类字段 —— **任一字段缺席就整棵卸载** ⇒ 表现是"**面板整个不见**"，而 host 侧一切正常。
     * 这正是最难查的那种失效：不是报错，是"她消失了"。
     *
     * 现在：出错那块换成一句人话 ＋ 错误摘要，**旁边的命令面板照常能用**（她用 `dangan_status`）。
     * ⚠️ 错误边界只在 **render 阶段**兜得住；事件回调里抛的它接不到（那些地方另有 try）。
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err }
      }
      componentDidCatch(err) {
        // 浏览器控制台没人看 —— 所以这条也顺手报到 host（失败就算了，不影响什么）
        console.warn('[dsh-memoria] 面板渲染出错（已兜住，面板还在）：', err)
        try {
          fetch('/memoria/client-hello', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              at: new Date().toISOString(),
              mounted: false,
              why: `面板渲染出错：${String((err && err.message) || err).slice(0, 160)}`,
              ua: String(navigator.userAgent || '').slice(0, 90),
            }),
          }).catch(() => {})
        } catch {
          /* 报到失败不影响渲染 */
        }
      }
      render() {
        if (this.state.err) {
          const msg = String((this.state.err && this.state.err.message) || this.state.err).slice(0, 200)
          return el(
            'div',
            { style: { padding: '10px 12px', fontSize: 12.5, color: '#b91c1c', maxWidth: 340, lineHeight: 1.7, background: '#fff' } },
            el('b', null, '面板出错了'),
            el('div', { style: { marginTop: 6, color: '#4b5563' } }, '她还在干活 —— 只是这一块画不出来。命令面板照可用（`dangan_status`）。'),
            el('div', { style: { marginTop: 6, fontSize: 11, color: '#9ca3af', wordBreak: 'break-all' } }, msg),
          )
        }
        return this.props.children
      }
    }

    function apply(ctx) {
      let tries = 0
      const tryMount = () => {
        let slots
        try {
          slots = ctx.get('slots')
        } catch (e) {
          console.warn('[dsh-memoria] 取 slots 失败：', e)
          return false
        }
        if (!slots || typeof slots.inject !== 'function') return false
        try {
          slots.inject('shell.overlay', () =>
            slots.register({ name: 'shell.overlay', id: 'memoria-pet' }, (props) => el(Boundary, null, el(Pet, props))),
          )
          console.info('[dsh-memoria] 悬浮窗已挂上 shell.overlay')
          // **向 host 报个到**（2026-09-17 加）：浏览器这半边挂没挂上，服务器那边是看不见的 ——
          // 这一声报到会写进 `~/.dsh/memoria.log`，**下次重启后我就能直接确认她在不在**。
          try {
            fetch('/memoria/client-hello', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ at: new Date().toISOString(), ua: String(navigator.userAgent || '').slice(0, 90) }),
            }).catch(() => {})
          } catch {
            /* 报到失败不影响挂载 */
          }
          return true
        } catch (e) {
          console.warn('[dsh-memoria] 注册悬浮窗失败：', e)
          return false
        }
      }

      if (tryMount()) return
      // slots 可能晚一步就绪 → 每 250ms 试一次，最多 10 秒
      const t = setInterval(() => {
        tries += 1
        const ok = tryMount()
        if (ok) {
          clearInterval(t)
          return
        }
        if (tries > 40) {
          clearInterval(t)
          console.warn('[dsh-memoria] 等了 10 秒没等到 slots —— 悬浮窗没挂上（其它能力不受影响）')
          // 🔴 2026-10-20 加：**失败也要向 host 报到**。
          //    原来这里只 `console.warn` —— 而**浏览器控制台没人看** ⇒ host 那边的日志一切正常，
          //    从日志看"她好好的"。这正是最坏的失效形态：**静默**（三路回执里那条"面板挂不上没人数"）。
          //    现在把失败也写进 `~/.dsh/memoria.log`，重启后一眼能查见她到底挂没挂上。
          try {
            fetch('/memoria/client-hello', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                at: new Date().toISOString(),
                mounted: false,
                why: 'slots 10 秒没就绪',
                ua: String(navigator.userAgent || '').slice(0, 90),
              }),
            }).catch(() => {})
          } catch {
            /* 报到失败不影响任何事 */
          }
        }
      }, 250)
    }

    exports.apply = apply
    return module.exports
  },
})
