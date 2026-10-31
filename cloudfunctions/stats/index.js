// 云函数 stats —— 云端汇总统计（一个函数两种用法）
//
// 用法一（定时触发，每天 01:10，见 config.json）：
//   把"昨天"的原始读数聚合进 readings_daily，供 90 天档案曲线直接读，
//   避免前端每次翻几百条原始记录。
//
// 用法二（小程序调用）：
//   wx.cloud.callFunction({ name:'stats', data:{ plotId, days: 7 } })
//   返回最近 N 天的均值 / 极值 / 达标率，直接喂给"环境分析"和 OPI 计算。
//
// 需要索引：readings 上 day(升序) + plotId(升序)。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

// 与 ingest 保持一致，改阈值时两处都要改
const THRESHOLDS = {
  airTemp:      { min: 5,  max: 40 },
  airHumidity:  { min: 30, max: 90 },
  soilMoisture: { min: 20, max: 85 }
}
const FIELDS = ['airTemp', 'airHumidity', 'light', 'soilMoisture']

function dayOf(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}
function round(v, d) {
  if (v === null || v === undefined || !isFinite(v)) return null
  const p = Math.pow(10, d)
  return Math.round(v * p) / p
}

exports.main = async (event) => {
  const isTimer = event && (event.Type === 'Timer' || event.triggerName === 'rollupDaily')
  if (isTimer) return rollup(event)
  return summary(event)
}

// ---------------- 用法一：每日 rollup ----------------

async function rollup(event) {
  // 默认汇总昨天；手工补数时传 day:'2026-10-20'
  const targetDay = String((event && event.day) || dayOf(Date.now() - 86400000))

  const group = { _id: '$plotId', n: $.sum(1) }
  FIELDS.forEach(function (f) {
    group[f + 'Avg'] = $.avg('$' + f)
    group[f + 'Min'] = $.min('$' + f)
    group[f + 'Max'] = $.max('$' + f)
  })

  try {
    const agg = await db.collection('readings').aggregate()
      .match({ day: targetDay })
      .group(group)
      .end()

    const rows = agg.list || []
    let written = 0

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const plotId = String(r._id)
      const doc = { plotId: plotId, day: targetDay, n: r.n, updatedAt: Date.now() }
      FIELDS.forEach(function (f) {
        doc[f + 'Avg'] = round(r[f + 'Avg'], f === 'airTemp' ? 1 : 0)
        doc[f + 'Min'] = round(r[f + 'Min'], f === 'airTemp' ? 1 : 0)
        doc[f + 'Max'] = round(r[f + 'Max'], f === 'airTemp' ? 1 : 0)
      })
      // 固定 _id，重复跑同一天不会产生重复文档（幂等）
      await db.collection('readings_daily').doc(plotId + '_' + targetDay).set({ data: doc })
      written++
    }

    return { ok: true, data: { mode: 'rollup', day: targetDay, plots: rows.length, written: written } }
  } catch (e) {
    const m = String((e && e.message) || e)
    if (/not exists|502005|ResourceNotFound/i.test(m)) {
      return { ok: false, msg: 'COLLECTION_MISSING: 请先建 readings / readings_daily 集合' }
    }
    console.error('[stats] rollup 失败', e)
    return { ok: false, msg: 'ROLLUP_FAILED' }
  }
}

// ---------------- 用法二：区间汇总 ----------------

async function summary(event) {
  const plotId = String((event && event.plotId) || '').trim()
  if (!plotId) return { ok: false, msg: 'MISSING_PLOT_ID' }

  const days = Math.min(Math.max(parseInt((event && event.days) || 7, 10) || 7, 1), 90)
  const from = dayOf(Date.now() - (days - 1) * 86400000)

  try {
    const r = await db.collection('readings_daily')
      .where({ plotId: plotId, day: _.gte(from) })
      .orderBy('day', 'asc')
      .limit(days)
      .get()

    const rows = r.data || []
    if (!rows.length) {
      return { ok: true, data: { plotId: plotId, days: days, from: from, dayCount: 0, readingCount: 0, avg: null, min: null, max: null, pass: null, perDay: [] } }
    }

    const total = rows.reduce(function (s, d) { return s + (d.n || 0) }, 0) || 1
    const avg = {}, min = {}, max = {}, pass = {}

    FIELDS.forEach(function (f) {
      // 按每天条数加权，避免"数据少的那天"被等同对待
      let wsum = 0
      rows.forEach(function (d) {
        wsum += (d[f + 'Avg'] || 0) * (d.n || 0)
      })
      avg[f] = round(wsum / total, f === 'airTemp' ? 1 : 0)
      min[f] = round(Math.min.apply(null, rows.map(function (d) { return d[f + 'Min'] }).filter(function (v) { return typeof v === 'number' })), 1)
      max[f] = round(Math.max.apply(null, rows.map(function (d) { return d[f + 'Max'] }).filter(function (v) { return typeof v === 'number' })), 1)

      const t = THRESHOLDS[f]
      if (!t) { pass[f] = null; return }
      const okDays = rows.filter(function (d) {
        const v = d[f + 'Avg']
        return typeof v === 'number' && v >= t.min && v <= t.max
      }).length
      pass[f] = Math.round(okDays / rows.length * 100)
    })

    return {
      ok: true,
      data: {
        plotId: plotId,
        days: days,
        from: from,
        to: rows[rows.length - 1].day,
        dayCount: rows.length,
        readingCount: total,
        avg: avg, min: min, max: max, pass: pass,
        perDay: rows.map(function (d) {
          return {
            day: d.day, n: d.n,
            airTemp: d.airTempAvg, airHumidity: d.airHumidityAvg,
            light: d.lightAvg, soilMoisture: d.soilMoistureAvg
          }
        })
      }
    }
  } catch (e) {
    const m = String((e && e.message) || e)
    if (/not exists|502005|ResourceNotFound/i.test(m)) {
      return { ok: false, msg: 'COLLECTION_MISSING: 请先建 readings_daily 集合（或先跑一次 rollup）' }
    }
    console.error('[stats] summary 失败', e)
    return { ok: false, msg: 'SUMMARY_FAILED' }
  }
}
