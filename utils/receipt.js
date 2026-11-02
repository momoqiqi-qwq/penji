// utils/receipt.js
// 采购商「进货后限期接受确认」的时限计算（纯函数，不读写存储）
// 规则：进货登记后 LIMIT_HOURS 小时内必须完成接受确认；剩余不足 WARN_HOURS 小时进入「即将超期」；
//       超期后不再允许普通确认，只能「逾期补录」，并把超期时长与原因随单留痕（不美化、不吞掉）。
// 说明：时间一律以毫秒时间戳传入，页面只负责展示，避免各页面各算一套口径。
const util = require('./util.js')

const HOUR = 3600000
const LIMIT_HOURS = 72      // 接受确认时限：进货登记后 72 小时
const WARN_HOURS = 24       // 剩余不足 24 小时提醒「即将超期」
const LIMIT_MS = LIMIT_HOURS * HOUR
const WARN_MS = WARN_HOURS * HOUR

const PHASE_TEXT = {
  open: '待接受确认',
  warn: '即将超期',
  overdue: '已逾期',
  accepted: '已接受确认',
  backfilled: '逾期补录'
}

const PHASE_CLS = {
  open: 'tag-green',
  warn: 'tag-gold',
  overdue: 'tag-warn',
  accepted: 'tag-green',
  backfilled: 'tag-warn'
}

/** 时限规则的一句话说明，页面直接引用，保证各处文案一致 */
function limitText() {
  return '进货登记后 ' + LIMIT_HOURS + ' 小时内须完成接受确认；剩余不足 ' + WARN_HOURS + ' 小时会提醒；超期后不能再普通确认，只能逾期补录，超期时长与原因随单留痕。'
}

/** 时长描述：18 分钟 / 5 小时 12 分 / 2 天 3 小时 */
function formatDuration(ms) {
  const min = Math.max(0, Math.floor(ms / 60000))
  if (min < 60) return min + ' 分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m ? h + ' 小时 ' + m + ' 分' : h + ' 小时'
  const d = Math.floor(h / 24)
  const hh = h % 24
  return hh ? d + ' 天 ' + hh + ' 小时' : d + ' 天'
}

/** 时限截止时间：进货时间 + LIMIT_MS */
function deadlineOf(receivedAt) {
  return (receivedAt || 0) + LIMIT_MS
}

/**
 * 计算一张进货单的时限状态
 * @param {Object} r 进货单
 * @param {number} [nowTs] 可注入的当前时间，便于测试
 * @returns {Object} phase / phaseText / statusCls / canConfirm / needReason / remainText / lateText / progress 等
 */
function compute(r, nowTs) {
  if (!r) return null
  const now = nowTs || Date.now()
  const deadlineAt = r.deadlineAt || deadlineOf(r.receivedAt)
  const remainMs = deadlineAt - now
  const out = {
    phase: 'open',
    phaseText: '',
    statusCls: 'tag-gray',
    canConfirm: false,
    needReason: false,
    remainText: '',
    lateText: '',
    receivedText: r.receivedAt ? util.formatDateTime(r.receivedAt) : '—',
    deadlineText: deadlineAt ? util.formatDateTime(deadlineAt) : '—',
    limitHours: LIMIT_HOURS,
    warnHours: WARN_HOURS,
    remainMs,
    // 剩余时限占比（0-100），用于画进度条；已超期为 0
    progress: 0
  }

  if (r.status === 'accepted' || r.status === 'backfilled') {
    out.phase = r.status
    out.phaseText = PHASE_TEXT[r.status]
    out.statusCls = PHASE_CLS[r.status]
    out.progress = 0
    if (r.status === 'backfilled') {
      out.lateText = '超期 ' + formatDuration(r.lateMs || 0) + ' 完成补录'
    } else {
      out.remainText = '按时确认'
    }
    return out
  }

  // 待确认：按剩余时间分三档
  out.progress = Math.round(util.clamp(remainMs / LIMIT_MS, 0, 1) * 100)
  if (remainMs > WARN_MS) {
    out.phase = 'open'
    out.remainText = '剩余 ' + formatDuration(remainMs)
    out.canConfirm = true
  } else if (remainMs > 0) {
    out.phase = 'warn'
    out.remainText = '仅剩 ' + formatDuration(remainMs)
    out.canConfirm = true
  } else {
    out.phase = 'overdue'
    out.remainText = '已超期 ' + formatDuration(-remainMs)
    out.lateText = '已超过 ' + LIMIT_HOURS + ' 小时时限，只能补录'
    out.needReason = true
  }
  out.phaseText = PHASE_TEXT[out.phase]
  out.statusCls = PHASE_CLS[out.phase]
  return out
}

/** 汇总：待确认 / 即将超期 / 已逾期 / 已处理 */
function summarize(list, nowTs) {
  const out = { total: 0, pending: 0, warn: 0, overdue: 0, done: 0 }
  ;(list || []).forEach(r => {
    out.total++
    if (r.status === 'accepted' || r.status === 'backfilled') {
      out.done++
      return
    }
    const c = compute(r, nowTs)
    out.pending++
    if (c.phase === 'warn') out.warn++
    else if (c.phase === 'overdue') out.overdue++
  })
  return out
}

module.exports = {
  HOUR,
  LIMIT_HOURS,
  WARN_HOURS,
  LIMIT_MS,
  WARN_MS,
  PHASE_TEXT,
  PHASE_CLS,
  limitText,
  formatDuration,
  deadlineOf,
  compute,
  summarize
}
