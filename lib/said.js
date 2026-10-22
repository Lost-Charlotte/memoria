// lib/said.js —— 「本会话里用户说过的话」（2026-09-20 建）
//
// 为什么单独一份：**两件事共用同一个地基** ——
//   ① `〔会话〕` 锚的核验（`f27-citation.js`）：引文标了"当场说的"，就得能去"你说过的话"里搜到；
//   ② 子会话预算闸门（`f30-toolgate.js`，下一步）：要判"用户到底有没有给过那个数字"。
// 两件事都需要"机器能读本会话里用户说的话"，所以只在**这一处**收、**这一处**取。
//
// 🔴 它治的是用户 2026-09-20 点破的那件事："**你一句'是现在刚说的'不也能轻易骗过你这个系统**"——
//    光靠我自己写个标记，那不是判据，是我的自觉。**标记必须能被机器拿去核。**
//
// ⚠️ **只在内存里**：重启后从零开始 —— 那时**取不到材料 → 一律放过**（绝不判"没说过"）。
//    这是档案里那条老规矩：**"探测不到 ≠ 不存在"**。
// ⚠️ 有上限（条数 / 每条字数）—— 它**不是**要把整场对话存下来，**够搜引文就行**。

const MAX_TEXTS = 400
const MAX_CHARS = 4000
const store = new Map() // sid → string[]
let lastSid = null

/** 记一条"用户说过的话"。`sid` 拿不到时记在 `_` 上。F1 每轮 pre-step 顺手调一次。 */
export function noteUserSaid(sid, text) {
  const key = sid || '_'
  const t = String(text == null ? '' : text).trim()
  if (!t) return
  lastSid = key
  if (!store.has(key)) store.set(key, [])
  const arr = store.get(key)
  if (arr[arr.length - 1] === t) return // 同一句连着来两遍（重发）不重复记
  arr.push(t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t)
  if (arr.length > MAX_TEXTS) arr.splice(0, arr.length - MAX_TEXTS)
}

/** 这个会话里用户说过的话（`sid` 不传就用"最近说话的那个会话"）。 */
export function userSaidTexts(sid) {
  const key = sid || lastSid || '_'
  return store.get(key) || []
}

/** 最近那个说过话的会话 id（没有就 null）。 */
export function lastUserSid() {
  return lastSid
}

/**
 * 这句话用户说过吗？
 * @returns {boolean|null} `true` 说过 · `false` **明确**没说过 · `null` **拿不到材料（＝不许指控）**
 */
export function hasUserSaid(quote, sid) {
  const q = String(quote == null ? '' : quote).replace(/\s+/g, '')
  if (!q) return null
  const texts = userSaidTexts(sid)
  if (texts.length === 0) return null // 一条都没记 → 拿不到材料 → 放过
  for (const t of texts) if (t.replace(/\s+/g, '').includes(q)) return true
  return false
}

/** 测试用：清空。 */
export function __resetSaid() {
  store.clear()
  lastSid = null
}
