// 云函数 history —— 取某地块的曲线数据
//   count 条原始读数（默认 30，上限 300）
//   或 count 天的按天聚合（daily=true，90 天档案曲线用）
//
// 两种模式都返回数组，元素固定 5 个字段：
//   { ts, airTemp, airHumidity, light, soilMoisture }
// date 字段故意不返回——交给小程序用 util.formatDateTime 按本地时区格式化，
// 避免云端按 UTC 格式化后在东八区显示成前一天。
//
// 需要索引：readings 上 plotId(升序) + ts(降序)；readings 上 plotId(升序) + day(升序)。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

const MAX_COUNT = 300

/** 按北京时间算日期串，与 ingest 里保持一致 */
function dayOf(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 把 '2026-10-23' 还原成当天 00:00(东八区) 的毫秒时间戳 */
function dayStartMs(day) {
  return Date.parse(day + 'T00:00:00+08:00')
}

function r1(v) { return v === null || v === undefined ? 0 : +(+v).toFixed(1) }
function r0(v) { return v === null || v === undefined ? 0 : +(+v).toFixed(0) }

exports.main = async (event) => {
  const plotId = String((event && event.plotId) || '').trim()
  if (!plotId) return { ok: false, msg: 'MISSING_PLOT_ID' }

  const count = Math.min(Math.max(parseInt((event && event.count) || 30, 10) || 30, 1), MAX_COUNT)
  const daily = event && (event.daily === true || event.daily === 1 || event.daily === '1')

  try {
    if (daily) return { ok: true, data: await queryDaily(plotId, count) }
    return { ok: true, data: await queryRaw(plotId, count) }
  } catch (e) {
    const m = String((e && e.message) || e)
    if (/not exists|502005|ResourceNotFound/i.test(m)) {
      return { ok: false, msg: 'COLLECTION_MISSING: 请先建 readings 集合' }
    }
    console.error('[history] 查询失败', e)
    return { ok: false, msg: 'DB_QUERY_FAILED' }
  }
}

/** 原始逐条曲线：倒序取 N 条再翻回正序，保证前端画图是从旧到新 */
async function queryRaw(plotId, count) {
  const r = await db.collection('readings')
    .where({ plotId: plotId })
    .orderBy('ts', 'desc')
    .limit(count)
    .get()

  const list = (r.data || []).slice().reverse()
  return list.map(function (d) {
    return {
      ts: d.ts,
      airTemp: r1(d.airTemp),
      airHumidity: r0(d.airHumidity),
      light: r0(d.light),
      soilMoisture: r0(d.soilMoisture)
    }
  })
}

/**
 * 按天聚合曲线。
 * 优先读 readings_daily（stats 云函数每晚 rollup 出来的结果，快）；
 * 如果还没跑过 rollup（比如刚部署当天），就地聚合 readings，保证页面不空。
 */
async function queryDaily(plotId, count) {
  const since = dayOf(Date.now() - (count - 1) * 86400000)

  let rows = []
  try {
    const r = await db.collection('readings_daily')
      .where({ plotId: plotId, day: _.gte(since) })
      .orderBy('day', 'asc')
      .limit(count)
      .get()
    rows = (r.data || []).map(function (d) {
      return {
        day: d.day,
        airTemp: d.airTempAvg,
        airHumidity: d.airHumidityAvg,
        light: d.lightAvg,
        soilMoisture: d.soilMoistureAvg
      }
    })
  } catch (e) {
    rows = []
  }

  if (!rows.length) {
    const agg = await db.collection('readings').aggregate()
      .match({ plotId: plotId, day: _.gte(since) })
      .group({
        _id: '$day',
        airTemp: $.avg('$airTemp'),
        airHumidity: $.avg('$airHumidity'),
        light: $.avg('$light'),
        soilMoisture: $.avg('$soilMoisture')
      })
      .sort({ _id: 1 })
      .limit(count)
      .end()

    rows = (agg.list || []).map(function (d) {
      return { day: d._id, airTemp: d.airTemp, airHumidity: d.airHumidity, light: d.light, soilMoisture: d.soilMoisture }
    })
  }

  return rows.map(function (d) {
    return {
      ts: dayStartMs(d.day),
      airTemp: r1(d.airTemp),
      airHumidity: r0(d.airHumidity),
      light: r0(d.light),
      soilMoisture: r0(d.soilMoisture)
    }
  })
}
