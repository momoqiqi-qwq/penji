// utils/sensors.js
// 农田传感器数据接入层（四类参数：空气温度 airTemp / 空气湿度 airHumidity / 光照 light / 土壤湿度 soilMoisture）
//
// 数据来源（页面必须明确标注，严禁把模拟数据伪装成硬件数据）：
//   1. live  → 【实时直连真实数据】小程序直连 broker.emqx.io，秒级更新
//   2. cloud → 【云端采集真实数据】设备 → CloudBase 云函数 mqttPull → 云数据库
//   3. demo  → 【演示模拟数据】以上都没有时的本地仿真

const util = require('./util.js')
const cloud = require('./cloud.js')
const mqtt = require('./mqtt.js')

const LOCAL_BUF_KEY = 'pengji_sensor_local_v2'

const SOURCE = { CLOUD: 'cloud', DEMO: 'demo', LIVE: 'live' }
const SOURCE_LABEL = {
  cloud: '【云端采集真实数据】',
  live: '【实时直连真实数据】',
  demo: '【演示模拟数据】'
}
const SOURCE_TAG = {
  cloud: { cls: 'tag-green', text: '真实数据' },
  live: { cls: 'tag-green', text: '实时数据' },
  demo: { cls: 'tag-gray', text: '演示数据' }
}

// 云端最新读数的本地缓存：同一地块 8 秒内重复请求直接给缓存。
const CLOUD_CACHE_TTL = 8000
const _cloudCache = {}

// ---------- 数据来源模式 ----------
// live   ：小程序直连设备 MQTT（WebSocket 订阅 broker），秒级实时，不经过任何服务器
// auto   ：云端优先，取不到回落演示（默认，最稳）
// cloud  ：只用云端，取不到就给演示数据
// demo   ：强制演示数据（现场网络不可靠时兜底，绝不会卡）
const MODES = ['auto', 'live', 'cloud', 'demo']
const MODE_KEY = 'pengji_sensor_mode'
const MODE_DESC = {
  auto: '自动：云端优先，取不到回落演示',
  live: '实时：直连设备 MQTT，约 2 秒更新',
  cloud: '云端：只走 CloudBase 云函数',
  demo: '演示：本地模拟，不联网（最稳）'
}

function getMode() {
  try {
    const m = wx.getStorageSync(MODE_KEY)
    return MODES.indexOf(m) >= 0 ? m : 'auto'
  } catch (e) { return 'auto' }
}
function setMode(m) {
  const v = MODES.indexOf(m) >= 0 ? m : 'auto'
  try { wx.setStorageSync(MODE_KEY, v) } catch (e) {}
  clearCache()   // 换来源必须清缓存，否则会拿到上一来源的读数
  return v
}
function modeDesc(m) { return MODE_DESC[m] || MODE_DESC.auto }
function sourceLabel(src) { return SOURCE_LABEL[src] || SOURCE_LABEL.demo }
function sourceTag(src) { return SOURCE_TAG[src] || SOURCE_TAG.demo }

/**
 * 获取某地块最新传感器读数（四参数）
 * @returns {Promise<{source:string, sourceLabel:string, plotId:string, airTemp:number, airHumidity:number, light:number, soilMoisture:number, ts:number, deviceId:string}>}
 */
function fetchLatest(plotId) {
  const key = String(plotId || '')
  const mode = getMode()

  if (mode === 'demo') return Promise.resolve(_demoLatest(plotId))
  // live 模式：最新值由 watchLive 推送进缓存，这里只读缓存；尚未收到帧时给演示数据占位
  if (mode === 'live') {
    const lv = _liveCache[key]
    if (lv && Date.now() - lv.at < 15000) return Promise.resolve(lv.value)
    return Promise.resolve(_demoLatest(plotId))
  }

  // 8 秒内的重复请求直接给缓存，不打云端
  const hit = _cloudCache[key]
  if (hit && Date.now() - hit.at < CLOUD_CACHE_TTL) return Promise.resolve(hit.value)

  // 云端优先（auto / cloud 两种模式都先试云端）
  if (cloud.ready()) {
    return cloud.call('latest', { plotId: key })
      .then((d) => {
        if (d && typeof d.airTemp === 'number') {
          const reading = _withLabel({
            source: SOURCE.CLOUD,
            plotId: d.plotId || key,
            airTemp: +(+d.airTemp).toFixed(1),
            airHumidity: +(+(d.airHumidity !== undefined ? d.airHumidity : 0)).toFixed(0),
            light: +(+(d.light !== undefined ? d.light : 0)).toFixed(0),
            soilMoisture: +(+d.soilMoisture).toFixed(0),
            ts: d.ts || Date.now(),
            deviceId: d.deviceId || 'CLOUD',
            online: d.online !== false,
            tag: d.tag || 'online'
          })
          _cloudCache[key] = { at: Date.now(), value: reading }
          return reading
        }
        // 云端通了但库里还没数据：给演示数据（绝不标成"真实数据"）
        return _demoLatest(plotId)
      })
      .catch(() => _demoLatest(plotId))
  }

  // 云端没配好：给演示数据
  return Promise.resolve(_demoLatest(plotId))
}

/**
 * 获取某地块最近 N 条读数（曲线）
 * @param {number} count 条数（配合 daily=1 时为天数，如 90 = 最近 90 天按天聚合）
 * @param {boolean} daily true 时请求按天聚合（90 天档案曲线用）
 * @returns {Promise<{list:Array<{ts,date,airTemp,airHumidity,light,soilMoisture}>, source:string}>}
 *          带 source 是因为曲线页要区分真实/演示：demo 数据绝不能标成"真实数据"
 */
function fetchHistory(plotId, count, daily) {
  count = count || 30
  const mode = getMode()

  if (mode === 'demo') return Promise.resolve({ list: _demoHistory(plotId, count), source: SOURCE.DEMO })

  // 云端优先（auto / cloud）
  if (cloud.ready()) {
    return cloud.call('history', { plotId: String(plotId || ''), count: count, daily: !!daily })
      .then((list) => {
        if (Array.isArray(list) && list.length) return { list: _normalizeHistory(list), source: SOURCE.CLOUD }
        return { list: _demoHistory(plotId, count), source: SOURCE.DEMO }
      })
      .catch(() => ({ list: _demoHistory(plotId, count), source: SOURCE.DEMO }))
  }

  // 云端没配好：给演示数据
  return Promise.resolve({ list: _demoHistory(plotId, count), source: SOURCE.DEMO })
}

/** 云函数已按固定字段返回，这里只补齐 date 并按本地时区格式化 */
function _normalizeHistory(list) {
  return list.map((d) => ({
    ts: d.ts || Date.now(),
    date: util.formatDateTime(d.ts || Date.now()),
    airTemp: +(+d.airTemp).toFixed(1),
    airHumidity: +(+(d.airHumidity !== undefined ? d.airHumidity : 0)).toFixed(0),
    light: +(+(d.light !== undefined ? d.light : 0)).toFixed(0),
    soilMoisture: +(+d.soilMoisture).toFixed(0)
  }))
}

function _withLabel(r) { r.sourceLabel = sourceLabel(r.source); return r }

// ---------- 演示模式 ----------

function _buf() {
  try { return JSON.parse(wx.getStorageSync(LOCAL_BUF_KEY) || '{}') } catch (e) { return {} }
}
function _saveBuf(buf) {
  try { wx.setStorageSync(LOCAL_BUF_KEY, JSON.stringify(buf)) } catch (e) {}
}

function _baseOf(plotId) {
  let h = 0
  const s = String(plotId || 'DEMO')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997
  return {
    airTemp: 18 + (h % 10),
    airHumidity: 50 + (h % 30),
    light: 40 + (h % 50),
    soilMoisture: 45 + (h % 25)
  }
}

function _demoLatest(plotId) {
  const buf = _buf()
  const last = buf[plotId]
  const base = _baseOf(plotId)
  let airTemp, airHumidity, light, soilMoisture
  if (last && Date.now() - last.ts < 300000) {
    airTemp   = util.clamp(last.airTemp   + (Math.random() - 0.5) * 0.8, 5, 45)
    airHumidity = util.clamp((last.airHumidity || 50) + (Math.random() - 0.5) * 3, 10, 95)
    light       = util.clamp((last.light       || 50) + (Math.random() - 0.5) * 4, 0, 100)
    soilMoisture = util.clamp(last.soilMoisture + (Math.random() - 0.5) * 3, 10, 95)
  } else {
    airTemp     = util.clamp(base.airTemp     + (Math.random() - 0.5) * 2, 5, 45)
    airHumidity = util.clamp(base.airHumidity + (Math.random() - 0.5) * 5, 10, 95)
    light       = util.clamp(base.light       + (Math.random() - 0.5) * 6, 0, 100)
    soilMoisture = util.clamp(base.soilMoisture + (Math.random() - 0.5) * 6, 10, 95)
  }
  const reading = _withLabel({
    source: SOURCE.DEMO,
    plotId: plotId || 'DEMO',
    airTemp: +airTemp.toFixed(1),
    airHumidity: +airHumidity.toFixed(0),
    light: +light.toFixed(0),
    soilMoisture: +soilMoisture.toFixed(0),
    ts: Date.now(),
    deviceId: 'DEMO-ESP32'
  })
  buf[plotId] = reading
  _saveBuf(buf)
  return reading
}

function _demoHistory(plotId, count) {
  const list = []
  let cur = _baseOf(plotId)
  const now = Date.now()
  for (let i = count - 1; i >= 0; i--) {
    const ts = now - i * 3600000
    cur = {
      airTemp:     util.clamp(cur.airTemp     + (Math.random() - 0.5) * 1.2, 5, 45),
      airHumidity: util.clamp(cur.airHumidity + (Math.random() - 0.5) * 4, 10, 95),
      light:       util.clamp(cur.light       + (Math.random() - 0.5) * 5, 0, 100),
      soilMoisture: util.clamp(cur.soilMoisture + (Math.random() - 0.5) * 4, 10, 95)
    }
    list.push({
      ts,
      date: util.formatDateTime(ts),
      airTemp: +cur.airTemp.toFixed(1),
      airHumidity: +cur.airHumidity.toFixed(0),
      light: +cur.light.toFixed(0),
      soilMoisture: +cur.soilMoisture.toFixed(0)
    })
  }
  return list
}

// ---------- 云端实时监听（watch） ----------

/**
 * 监听某地块 readings 集合的最新一条记录，数据库一有写入就回调。
 * 云函数每次采集写库后，小程序无需轮询即可立刻拿到新读数。
 * 注意：客户端直连数据库需要 readings 集合权限为「所有用户可读」；
 *       权限未放开时 onError 会触发，调用方应回落到轮询，不影响功能。
 * @returns {{close:Function}|null} 监听句柄；无法监听时返回 null
 */
function watchLatest(plotId, onReading, onFail) {
  if (!cloud.ready()) {
    if (onFail) onFail(new Error('CLOUD_NOT_READY'))
    return null
  }
  const key = String(plotId || '')
  let watcher = null
  try {
    watcher = wx.cloud.database({ env: cloud.ENV_ID })
      .collection('readings')
      .where({ plotId: key })
      .orderBy('ts', 'desc')
      .limit(1)
      .watch({
        onChange: (snap) => {
          const docs = (snap && snap.docs) || []
          if (!docs.length) return
          const d = docs[0]
          if (typeof d.airTemp !== 'number') return
          const reading = _withLabel({
            source: SOURCE.CLOUD,
            plotId: d.plotId || key,
            airTemp: +(+d.airTemp).toFixed(1),
            airHumidity: +(+(d.airHumidity !== undefined ? d.airHumidity : 0)).toFixed(0),
            light: +(+(d.light !== undefined ? d.light : 0)).toFixed(0),
            soilMoisture: +(+d.soilMoisture).toFixed(0),
            ts: d.ts || Date.now(),
            deviceId: d.deviceId || 'CLOUD'
          })
          // 同步刷新缓存，避免立刻切回轮询时拿到旧值
          _cloudCache[key] = { at: Date.now(), value: reading }
          console.log('[sensors] watch 收到推送', reading)
          onReading(reading)
        },
        onError: (err) => {
          console.warn('[sensors] watch 失败', err)
          if (onFail) onFail(err)
        }
      })
  } catch (e) {
    console.warn('[sensors] watch 异常', e)
    if (onFail) onFail(e)
    return null
  }
  return {
    close() {
      try { if (watcher) watcher.close() } catch (e) {}
    }
  }
}

/** 清掉云端最新读数的缓存（下拉刷新时可调，让用户看到真正最新的数据） */
function clearCache(plotId) {
  if (plotId === undefined) {
    Object.keys(_cloudCache).forEach(k => { delete _cloudCache[k] })
  } else {
    delete _cloudCache[String(plotId)]
  }
}

// ---------- 实时直连模式（小程序 → MQTT over WebSocket → 设备帧） ----------

// 设备发布配置（与云函数 mqttPull 用同一主题；主题由设备固件固定为 mcub3a909，无法修改）
// 公共 broker 上该主题可能存在同款产品的陌生数据（串扰），答辩时在报告中作为安全观察点说明即可
const LIVE_MQTT_URL = 'wss://broker.emqx.io:8084/mqtt'
const LIVE_TOPIC = 'mcub3a909'
const _liveCache = {}

/**
 * 实时监听设备帧：小程序直连 broker，设备每发一帧（约 1.8 秒）回调一次。
 * 帧格式：'wwz' + 4 字节(气温/湿度/光照/土壤, int8) + 'end'
 * @returns {{close:Function}|null}
 */
function watchLive(plotId, onReading, onFail) {
  const key = String(plotId || '')
  let sub = null
  try {
    sub = mqtt.subscribe({
      url: LIVE_MQTT_URL,
      topic: LIVE_TOPIC,
      onMessage: (payload) => {
        // 帧解析：找 'wwz' 与 'end' 标记，中间取 4 字节（与 mqttPull 一致的宽容解析）
        if (!payload || payload.length < 10) return
        if (payload[0] !== 0x77 || payload[1] !== 0x77 || payload[2] !== 0x7a) return
        const n = payload.length
        if (payload[n - 3] !== 0x65 || payload[n - 2] !== 0x6e || payload[n - 1] !== 0x64) return
        const i8 = (b) => (b >= 128 ? b - 256 : b)
        const reading = _withLabel({
          source: SOURCE.LIVE,
          plotId: key,
          airTemp: i8(payload[3]),
          airHumidity: i8(payload[4]),
          light: i8(payload[5]),
          soilMoisture: i8(payload[6]),
          ts: Date.now(),
          deviceId: 'MQTT-LIVE'
        })
        _liveCache[key] = { at: Date.now(), value: reading }
        onReading(reading)
      },
      onError: (err) => {
        console.warn('[sensors] live 连接异常', err)
        if (onFail) onFail(err)
      }
    })
  } catch (e) {
    console.warn('[sensors] live 启动失败', e)
    if (onFail) onFail(e)
    return null
  }
  return { close() { try { sub && sub.close() } catch (e) {} } }
}

module.exports = {
  SOURCE, SOURCE_LABEL, SOURCE_TAG,
  sourceLabel, sourceTag,
  MODES, getMode, setMode, modeDesc,
  fetchLatest, fetchHistory,
  watchLatest,
  watchLive,
  cloudReady: cloud.ready,
  cloudEnv: cloud.ENV_ID,
  clearCache
}
