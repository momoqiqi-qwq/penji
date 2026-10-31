// utils/util.js - 通用工具函数

/** 日期格式化 YYYY-MM-DD */
function formatDate(ts) {
  const d = ts ? new Date(ts) : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 日期格式化 YYYY-MM-DD HH:mm */
function formatDateTime(ts) {
  const d = ts ? new Date(ts) : new Date()
  const base = formatDate(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${base} ${h}:${mi}`
}

/** 解析 YYYY-MM-DD 为时间戳 */
function parseDate(str) {
  return new Date(str + 'T00:00:00').getTime()
}

/** 两个日期相隔天数 */
function daysBetween(a, b) {
  const ta = typeof a === 'string' ? parseDate(a) : a
  const tb = typeof b === 'string' ? parseDate(b) : b
  return Math.round(Math.abs(tb - ta) / 86400000)
}

/** 相对时间描述（刚刚/x分钟前/x小时前/x天前） */
function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 2592000000) return Math.floor(diff / 86400000) + '天前'
  return formatDate(ts)
}

/**
 * 由 0-100 信用分计算 0-5 星
 * 等级边界对齐 GB/T 23794-2023 §7.2 与浙江农安信用千分制折算（80/70/60/50）
 */
function scoreToStar(score) {
  if (score >= 90) return 5  // AAA
  if (score >= 80) return 4  // AA
  if (score >= 70) return 3  // A
  if (score >= 60) return 2  // B
  if (score >= 50) return 1  // C
  return 0                    // D
}

/**
 * 信用等级（六档）：AAA/AA/A/B/C/D
 * 依据：GB/T 23794-2023 §7.2（A等细分AAA/AA/A）+ 广西农安信用六档命名
 */
function scoreLevel(score) {
  if (score >= 90) return { code: 'AAA', text: 'AAA 信用极佳', cls: 'tag-green' }
  if (score >= 80) return { code: 'AA',  text: 'AA 信用优秀',  cls: 'tag-green' }
  if (score >= 70) return { code: 'A',   text: 'A 信用良好',   cls: 'tag-green' }
  if (score >= 60) return { code: 'B',   text: 'B 信用一般',   cls: 'tag-gold' }
  if (score >= 50) return { code: 'C',   text: 'C 信用较差',   cls: 'tag-warn' }
  return { code: 'D', text: 'D 失信风险', cls: 'tag-warn' }
}

/** 生成简易唯一 id（仿真用，不保证全局唯一） */
function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
}

/** 限制范围 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/** 随机整数 [min,max] */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** 随机选择 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

module.exports = {
  formatDate,
  formatDateTime,
  parseDate,
  daysBetween,
  timeAgo,
  scoreToStar,
  scoreLevel,
  uid,
  clamp,
  randInt,
  pick
}
