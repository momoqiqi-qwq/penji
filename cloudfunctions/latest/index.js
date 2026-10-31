// 云函数 latest —— 取某地块最新一条读数
//
// 为什么单独做一个函数而不是让前端直接查数据库：
//   1) 前端直接读库要开集合权限，容易越权看到别的农户数据；
//   2) "最新一条"还要顺带算设备在线状态，逻辑放云端只算一次；
//   3) 返回字段在这里裁剪干净，前端拿到的就是固定 8 个字段，页面不用改。
//
// 需要索引：readings 上建复合索引 plotId(升序) + ts(降序)，否则数据多了会变慢。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ONLINE_WINDOW_MS = 30 * 60 * 1000

exports.main = async (event) => {
  const plotId = String((event && event.plotId) || '').trim()
  if (!plotId) return { ok: false, msg: 'MISSING_PLOT_ID' }

  try {
    const r = await db.collection('readings')
      .where({ plotId: plotId })
      .orderBy('ts', 'desc')
      .limit(1)
      .get()

    if (!r.data || !r.data.length) {
      // 没有数据不是错误，前端据此显示"暂无数据"，别抛异常
      return { ok: true, data: null }
    }

    const d = r.data[0]
    const ageMs = Date.now() - d.ts

    return {
      ok: true,
      data: {
        plotId: d.plotId,
        deviceId: d.deviceId,
        ts: d.ts,
        day: d.day,
        tag: d.tag || 'online',
        airTemp: d.airTemp,
        airHumidity: d.airHumidity,
        light: d.light,
        soilMoisture: d.soilMoisture,
        // 以下三个是"附加信息"，sensors.js 会忽略，页面想用可以自己取
        online: ageMs < ONLINE_WINDOW_MS,
        ageMs: ageMs,
        soil: d.soilTemp !== undefined ? {
          soilTemp: d.soilTemp, soilPh: d.soilPh, soilEc: d.soilEc,
          n: d.n, p: d.p, k: d.k, heavyMetal: d.heavyMetal
        } : null
      }
    }
  } catch (e) {
    const m = String((e && e.message) || e)
    if (/not exists|502005|ResourceNotFound/i.test(m)) {
      return { ok: false, msg: 'COLLECTION_MISSING: 请先建 readings 集合' }
    }
    console.error('[latest] 查询失败', e)
    return { ok: false, msg: 'DB_QUERY_FAILED' }
  }
}
