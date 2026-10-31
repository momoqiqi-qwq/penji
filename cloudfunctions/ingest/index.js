// 云函数 ingest —— 棚迹设备数据入口
//
// 两个入口共用这一个函数：
//   1) HTTP 访问服务：ESP8266 / 电脑 curl 直接 POST 上来（event 带 body / httpMethod）
//   2) 小程序或测试：wx.cloud.callFunction({ name:'ingest', data:{...} })
//
// 统一返回 { ok:true, data:{...} } 或 { ok:false, msg:'原因' }
// 注意：返回 ok:false 时 HTTP 状态码仍是 200，设备端要看 body 里的 ok 字段。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// ==================== 需要你改的只有这一段 ====================
// 设备白名单。deviceKey 必须是一串足够长的随机字符，别用 "123456"。
//
// 两种配法，任选其一：
//   A. 直接改下面的字面量，重新上传云函数；
//   B. 不改代码，在「云函数 → 配置 → 环境变量」里加
//        PENGJI_DEVICE_KEYS = {"pengji-01":"你的32位随机串"}
//      环境变量优先于字面量。本地服务（tools/local-server.js）走的就是这条路，
//      所以同一份代码在本地和云上不用任何改动。
const DEVICE_KEYS = loadDeviceKeys({
  'pengji-01': 'CHANGE_ME_TO_A_LONG_RANDOM_STRING'
})

function loadDeviceKeys(base) {
  const raw = process.env.PENGJI_DEVICE_KEYS
  if (!raw) return base
  try {
    const extra = JSON.parse(raw)
    if (!extra || typeof extra !== 'object') return base
    return Object.assign({}, base, extra)
  } catch (e) {
    console.error('[ingest] PENGJI_DEVICE_KEYS 不是合法 JSON，已忽略并使用字面量')
    return base
  }
}

// deviceKey 最短长度。这里刻意按"长度"卡强度，而不是拿占位符字符串去比对——
// 那样一旦有人改了 key，校验反而永远报"未配置"，是联调时很难查的坑。
const MIN_KEY_LEN = 16

// 越限阈值，命中就写一条 alerts（小程序里可以据此红点提醒）
const THRESHOLDS = {
  airTemp:      { min: 5,  max: 40 },
  airHumidity:  { min: 30, max: 90 },
  soilMoisture: { min: 20, max: 85 }
}

// 超过这个时长没上报就认为设备离线（常规档 10 分钟一帧，留 3 倍余量）
const ONLINE_WINDOW_MS = 30 * 60 * 1000

// 同一设备两次上报的最小间隔，防重放 / 防固件死循环狂刷
const MIN_INTERVAL_MS = 900
// =============================================================

/** 按北京时间(+08:00)算日期串，避免用服务器 UTC 导致跨零点归错天 */
function dayOf(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 只接受有限数字，其余一律 null（不要用 0 兜底，0 和"没测到"是两件事） */
function num(v) {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v
  return null
}

function ok(data) { return { ok: true, data: data || {} } }
function fail(msg) { return { ok: false, msg: msg } }

/** 从 HTTP 访问服务事件里还原出 JSON body；callFunction 直调时原样返回 */
function extractPayload(event) {
  if (!event || typeof event !== 'object') return {}
  const isHttp = event.httpMethod || event.headers || event.body !== undefined
  if (!isHttp) return event
  let body = event.body
  if (typeof body === 'string') {
    if (event.isBase64Encoded) {
      try { body = Buffer.from(body, 'base64').toString('utf8') } catch (e) { return {} }
    }
    try { return JSON.parse(body) } catch (e) { return {} }
  }
  return body || {}
}

exports.main = async (event) => {
  const payload = extractPayload(event)

  const deviceId = String(payload.deviceId || '').trim()
  const deviceKey = String(payload.deviceKey || '').trim()

  if (!deviceId) return fail('MISSING_DEVICE_ID')

  const expect = DEVICE_KEYS[deviceId]
  if (!expect) return fail('DEVICE_NOT_REGISTERED')
  // 占位符（CHANGE_ME 开头）视同未配置：它随代码公开，谁都能拿它上报假数据
  if (/^CHANGE_ME/i.test(String(expect))) return fail('DEVICE_KEY_NOT_CONFIGURED')
  if (String(expect).length < MIN_KEY_LEN) return fail('DEVICE_KEY_NOT_CONFIGURED')
  if (deviceKey !== expect) return fail('BAD_DEVICE_KEY')

  const airTemp = num(payload.airTemp)
  const airHumidity = num(payload.airHumidity)
  const soilMoisture = num(payload.soilMoisture)
  const light = num(payload.light)

  if (airTemp === null || airHumidity === null || soilMoisture === null) {
    return fail('MISSING_CORE_FIELDS')
  }
  if (airTemp < -40 || airTemp > 80 || airHumidity < 0 || airHumidity > 100) {
    return fail('VALUE_OUT_OF_RANGE')
  }

  // 时间戳一律以服务器收到为准。板子没有 RTC，设备自报的时间不可信。
  const ts = Date.now()
  const plotId = String(payload.plotId || deviceId).trim()

  // 频率闸门：先看上次上报时间
  let lastSeen = 0
  try {
    const prev = await db.collection('devices').doc(deviceId).get()
    lastSeen = (prev && prev.data && prev.data.lastSeen) || 0
  } catch (e) {
    // 设备首次上报时 doc 不存在，.get() 会抛错，属正常情况
    lastSeen = 0
  }
  if (lastSeen && ts - lastSeen < MIN_INTERVAL_MS) return fail('TOO_FREQUENT')

  // ---- 组文档 ----
  const reading = {
    deviceId: deviceId,
    plotId: plotId,
    ts: ts,
    day: dayOf(ts),
    tag: ['online', 'quicktest', 'lab'].indexOf(payload.tag) >= 0 ? payload.tag : 'online',
    airTemp: airTemp,
    airHumidity: airHumidity,
    light: light === null ? 0 : light,
    soilMoisture: soilMoisture
  }

  // 扩展字段：以后接 RS485 氮磷钾 / 重金属探头时，这些字段直接带上就行，
  // 不改表结构、不改代码，前端按需取用。
  const EXTRA = ['soilTemp', 'soilPh', 'soilEc', 'n', 'p', 'k', 'heavyMetal']
  EXTRA.forEach(function (k) {
    const v = num(payload[k])
    if (v !== null) reading[k] = v
  })

  // ---- 越限判定 ----
  const alerts = []
  Object.keys(THRESHOLDS).forEach(function (f) {
    const v = reading[f]
    if (typeof v !== 'number') return
    const t = THRESHOLDS[f]
    if (v < t.min) alerts.push({ field: f, value: v, level: 'low', threshold: t.min })
    else if (v > t.max) alerts.push({ field: f, value: v, level: 'high', threshold: t.max })
  })

  // ---- 写入 ----
  try {
    await db.collection('readings').add({ data: reading })

    await db.collection('devices').doc(deviceId).set({
      data: {
        deviceId: deviceId,
        plotId: plotId,
        lastSeen: ts,
        lastDay: reading.day,
        fw: String(payload.fw || ''),
        rssi: num(payload.rssi) === null ? null : num(payload.rssi),
        lastReading: {
          airTemp: airTemp,
          airHumidity: airHumidity,
          light: reading.light,
          soilMoisture: soilMoisture
        }
      }
    })

    for (let i = 0; i < alerts.length; i++) {
      await db.collection('alerts').add({
        data: {
          deviceId: deviceId,
          plotId: plotId,
          ts: ts,
          day: reading.day,
          field: alerts[i].field,
          value: alerts[i].value,
          level: alerts[i].level,
          threshold: alerts[i].threshold
        }
      })
    }
  } catch (e) {
    const m = String((e && e.message) || e)
    if (/not exists|502005|ResourceNotFound/i.test(m)) {
      return fail('COLLECTION_MISSING: 请先在云开发控制台建好 readings / devices / alerts 三个集合')
    }
    console.error('[ingest] 写入失败', e)
    return fail('DB_WRITE_FAILED')
  }

  return ok({
    ts: ts,
    day: reading.day,
    accepted: true,
    alerts: alerts.length,
    onlineWindowMs: ONLINE_WINDOW_MS
  })
}
