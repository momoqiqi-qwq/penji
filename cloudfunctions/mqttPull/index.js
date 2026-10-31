// 云函数 mqttPull —— 云端主动采集（不需要电脑常开）
//
// 工作方式：
//   定时触发器每 5 分钟唤起本函数 → 连 broker.emqx.io → 订阅 mcub3a909
//   → 收 2 秒的 wwz...end 数据帧（设备 1 秒一帧，稳收 2 帧左右）
//   → 求平均后写 1 条 readings + 更新 devices 在线状态 → 断开
//
// 为什么不在云函数里长连 MQTT：
//   云函数是"被调用才运行"的，跑完就被回收，无法常驻。所以用"定时唤起 + 短采集"，
//   再用每 5 分钟一条的采样率把 90 天数据量压到可控范围（288 条/天）。
//
// 注意：本函数是云端主动出站连接，不需要 deviceKey 鉴权，也不占用 HTTP 触发器。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const net = require('net')
const tls = require('tls')
const dns = require('dns')

// ==================== 可调参数 ====================
const BROKER_HOST = process.env.PENGJI_MQTT_HOST || 'broker.emqx.io'
const BROKER_PORT = parseInt(process.env.PENGJI_MQTT_PORT || (process.env.PENGJI_MQTT_TLS === '1' ? '8883' : '1883'), 10)
// 若云端 1883 出站被拦，可设 PENGJI_MQTT_TLS=1 走 8883（TLS），端口会自动变 8883
const USE_TLS = process.env.PENGJI_MQTT_TLS === '1'
const TOPIC = process.env.PENGJI_MQTT_TOPIC || 'mcub3a909'

// 单次采集窗口。设备约 2 秒一帧，握手还要占掉几百毫秒，
// 所以 2000 偏紧；云函数超时改到 20 秒后建议设成 4000。
const WAIT_MS = Math.min(parseInt(process.env.PENGJI_PULL_MS || '2000', 10), 8000)

const DEFAULT_PLOT_ID = process.env.PENGJI_PLOT_ID || 'WJC-001'
const DEFAULT_DEVICE_ID = process.env.PENGJI_DEVICE_ID || 'pengji-01'
// ===================================================

/** 按北京时间算日期串，与 ingest / history 保持一致 */
function dayOf(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// ---------------- MQTT 最小实现（只用 net，不引入依赖） ----------------

function encRemain(n) {
  const out = []
  do {
    let d = n % 128
    n = Math.floor(n / 128)
    if (n > 0) d = d | 0x80
    out.push(d)
  } while (n > 0)
  return Buffer.from(out)
}

function buildConnect(clientId) {
  const id = Buffer.from(clientId, 'utf8')
  const body = Buffer.concat([
    Buffer.from([0x00, 0x04]), Buffer.from('MQTT', 'ascii'),
    Buffer.from([0x04, 0x02, 0x00, 0x3C]), // 协议 4，clean session，心跳 60s
    Buffer.from([(id.length >> 8) & 0xff, id.length & 0xff]), id
  ])
  return Buffer.concat([Buffer.from([0x10]), encRemain(body.length), body])
}

function buildSubscribe(topic, packetId) {
  const t = Buffer.from(topic, 'utf8')
  const body = Buffer.concat([
    Buffer.from([(packetId >> 8) & 0xff, packetId & 0xff]),
    Buffer.from([(t.length >> 8) & 0xff, t.length & 0xff]), t,
    Buffer.from([0x00])
  ])
  return Buffer.concat([Buffer.from([0x82]), encRemain(body.length), body])
}

/** 从 TCP 缓冲区里切出完整 MQTT 报文 */
function splitPackets(buf) {
  const packets = []
  let off = 0
  while (off + 2 <= buf.length) {
    let mul = 1
    let len = 0
    let i = off + 1
    let ok = false
    for (; i < buf.length && i <= off + 4; i++) {
      const b = buf[i]
      len += (b & 0x7f) * mul
      if ((b & 0x80) === 0) { ok = true; i++; break }
      mul *= 128
    }
    if (!ok) break
    if (buf.length < i + len) break
    packets.push({ header: buf[off], body: buf.slice(i, i + len) })
    off = i + len
  }
  return { packets, rest: buf.slice(off) }
}

/** 只取 PUBLISH 的负载（QoS0，跳过 2 字节主题长度 + 主题） */
function publishPayload(pkt) {
  if ((pkt.header >> 4) !== 3) return null
  const b = pkt.body
  if (b.length < 2) return null
  const tlen = (b[0] << 8) | b[1]
  if (b.length < 2 + tlen) return null
  return b.slice(2 + tlen)
}

/**
 * 解析 wwz + 4 字节 + end 的帧。
 * 4 个字节分别是 温度 / 空气湿度 / 光照 / 土壤湿度，int8 带符号。
 */
function signed(v) { return v > 127 ? v - 256 : v }

function pick(u, s, lo, hi) {
  if (lo <= s && s <= hi) return s
  if (lo <= u && u <= hi) return u
  return u
}

function parseFrame(payload) {
  const i = payload.indexOf(Buffer.from('wwz'))
  if (i < 0) return null
  const j = payload.indexOf(Buffer.from('end'), i + 3)
  if (j < 0) return null
  const d = payload.slice(i + 3, j)
  if (d.length < 4) return null
  const u = [d[0], d[1], d[2], d[3]]
  const s = u.map(signed)
  return {
    airTemp: pick(u[0], s[0], -40, 60),
    airHumidity: pick(u[1], s[1], 0, 100),
    light: pick(u[2], s[2], 0, 100),
    soilMoisture: pick(u[3], s[3], 0, 100)
  }
}

/** 强制解析 IPv4：云端若优先拿到 IPv6 且无路由，连接会一直挂着直到窗口结束 */
function resolveIPv4(host) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { family: 4 }, (err, addr) => {
      if (err || !addr) reject(new Error('DNS_FAILED: ' + host))
      else resolve(addr)
    })
  })
}

/** 连 broker、订阅、在 WAIT_MS 内收帧，返回 { frames, diag } */
async function collectFrames() {
  const diag = {
    host: BROKER_HOST, port: BROKER_PORT, tls: USE_TLS,
    ip: null, connected: false, connack: false, suback: false,
    bytes: 0, publishes: 0, error: null
  }
  diag.ip = await resolveIPv4(BROKER_HOST)

  const frames = await new Promise((resolve) => {
    const got = []
    let subscribed = false
    let settled = false
    let buf = Buffer.alloc(0)

    const clientId = 'pengji-cloud-' + Math.random().toString(36).slice(2, 10)
    const onConnect = () => {
      diag.connected = true
      sock.write(buildConnect(clientId))
    }
    // 用解析出的 IPv4 直连，避免 IPv6 无路由导致的静默挂起
    const sock = USE_TLS
      ? tls.connect({ host: diag.ip, port: BROKER_PORT, servername: BROKER_HOST }, onConnect)
      : net.createConnection({ host: diag.ip, port: BROKER_PORT }, onConnect)
    sock.setTimeout(WAIT_MS + 3000)
    if (typeof sock.setNoDelay === 'function') sock.setNoDelay(true)

    const done = () => {
      if (settled) return
      settled = true
      try { sock.destroy() } catch (e) {}
      resolve(got)
    }

    sock.on('data', (chunk) => {
      diag.bytes += chunk.length
      buf = Buffer.concat([buf, chunk])
      const r = splitPackets(buf)
      buf = r.rest
      r.packets.forEach((pkt) => {
        const type = pkt.header >> 4
        if (type === 2) {                          // CONNACK
          diag.connack = true
          if (pkt.body.length >= 2 && pkt.body[1] === 0) {
            if (!subscribed) { subscribed = true; sock.write(buildSubscribe(TOPIC, 1)) }
          } else {
            diag.error = 'CONNECT_REFUSED code=' + (pkt.body[1] || 0)
            done()
          }
        } else if (type === 9) {                   // SUBACK
          diag.suback = true
        } else if (type === 3) {                   // PUBLISH
          diag.publishes++
          const payload = publishPayload(pkt)
          const f = payload && parseFrame(payload)
          if (f) got.push(f)
        }
      })
    })

    sock.on('timeout', done)
    sock.on('error', (e) => { diag.error = String((e && e.message) || e); done() })
    sock.on('close', done)

    setTimeout(done, WAIT_MS)
  })

  return { frames, diag }
}

// ---------------- 入库 ----------------

function avg(list, k, digits) {
  if (!list.length) return 0
  const sum = list.reduce((s, x) => s + (x[k] || 0), 0)
  const p = Math.pow(10, digits)
  return Math.round((sum / list.length) * p) / p
}

function fail(msg) { return { ok: false, msg: msg } }

exports.main = async (event) => {
  const plotId = String((event && event.plotId) || DEFAULT_PLOT_ID).trim()
  const deviceId = String((event && event.deviceId) || DEFAULT_DEVICE_ID).trim()

  let frames, diag
  try {
    const r = await collectFrames()
    frames = r.frames
    diag = r.diag
    console.log('[mqttPull] diag=' + JSON.stringify(diag))
  } catch (e) {
    console.error('[mqttPull] 连接失败', e)
    return fail('MQTT_CONNECT_FAILED: ' + String((e && e.message) || e))
  }

  if (!frames.length) {
    // 把诊断信息一起返回，便于定位是"没连上"还是"连上但没数据"
    return { ok: false, msg: 'NO_FRAME_IN_WINDOW', diag: diag }
  }

  const ts = Date.now()
  const reading = {
    deviceId: deviceId,
    plotId: plotId,
    ts: ts,
    day: dayOf(ts),
    tag: 'online',
    airTemp: avg(frames, 'airTemp', 1),
    airHumidity: avg(frames, 'airHumidity', 0),
    light: avg(frames, 'light', 0),
    soilMoisture: avg(frames, 'soilMoisture', 0),
    nFrames: frames.length
  }

  try {
    await db.collection('readings').add({ data: reading })

    await db.collection('devices').doc(deviceId).set({
      data: {
        deviceId: deviceId,
        plotId: plotId,
        lastSeen: ts,
        lastDay: reading.day,
        fw: 'cloud-pull',
        rssi: null,
        lastReading: {
          airTemp: reading.airTemp,
          airHumidity: reading.airHumidity,
          light: reading.light,
          soilMoisture: reading.soilMoisture
        }
      }
    })
  } catch (e) {
    const m = String((e && e.message) || e)
    if (/not exists|502005|ResourceNotFound/i.test(m)) {
      return fail('COLLECTION_MISSING: 请先跑一次 initdb 建集合')
    }
    console.error('[mqttPull] 写入失败', e)
    return fail('DB_WRITE_FAILED')
  }

  return {
    ok: true,
    data: {
      plotId: plotId,
      deviceId: deviceId,
      ts: ts,
      frames: frames.length,
      sample: {
        airTemp: reading.airTemp,
        airHumidity: reading.airHumidity,
        light: reading.light,
        soilMoisture: reading.soilMoisture
      }
    }
  }
}
