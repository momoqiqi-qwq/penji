// 极简 MQTT 3.1.1 客户端（只实现"连接 + 订阅 + 收消息"，不含发布）
// 用于小程序通过 WebSocket 直连公共 broker（broker.emqx.io），实现秒级实时显示。
//
// 说明：
//   - 小程序没有 TCP，只能走 wx.connectSocket（WebSocket），broker 需支持 ws/wss
//   - emqx 公共 broker：wss://broker.emqx.io:8084/mqtt（tls）/ ws://...:8083/mqtt
//   - 真机上线前要在 mp 后台「socket 合法域名」加 wss://broker.emqx.io:8084
//   - 开发者工具里勾「不校验合法域名」即可联调

function _utf8(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)) }
    else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)) }
  }
  return out
}

function _strBytes(str) {
  const b = _utf8(str)
  return [(b.length >> 8) & 0xff, b.length & 0xff].concat(b)
}

// 可变长度剩余长度编码
function _remLen(n) {
  const out = []
  do {
    let d = n % 128
    n = Math.floor(n / 128)
    if (n > 0) d |= 0x80
    out.push(d)
  } while (n > 0)
  return out
}

function _packet(type, body) {
  return new Uint8Array([type].concat(_remLen(body.length), body)).buffer
}

function _connectPacket(clientId) {
  const body = _strBytes('MQTT')
    .concat([0x04, 0x02, 0x00, 0x3c])   // v3.1.1 / clean session / keepalive 60s
    .concat(_strBytes(clientId))
  return _packet(0x10, body)
}

let _pktId = 0
function _subscribePacket(topic) {
  _pktId = (_pktId + 1) % 0xffff
  const id = _pktId || 1
  const body = [(id >> 8) & 0xff, id & 0xff].concat(_strBytes(topic)).concat([0x00])
  return _packet(0x82, body)
}

/**
 * 订阅一个 MQTT 主题。
 * @param {object} opt { url, clientId, topic, onMessage(payload:Uint8Array, topic:string), onOpen, onError, onClose }
 * @returns {{close:Function}}
 */
function subscribe(opt) {
  const url = opt.url || 'wss://broker.emqx.io:8084/mqtt'
  const clientId = opt.clientId || ('wxlive-' + Math.random().toString(16).slice(2, 10))
  const topic = opt.topic
  let task = null
  let buf = new Uint8Array(0)
  let pingTimer = null
  let closed = false

  function _append(chunk) {
    const next = new Uint8Array(buf.length + chunk.length)
    next.set(buf, 0)
    next.set(chunk, buf.length)
    buf = next
  }

  // 解析累计缓冲区里所有完整 MQTT 报文
  function _drain() {
    for (;;) {
      if (buf.length < 2) return
      // 解剩余长度（最多 4 字节）
      let mult = 1, len = 0, pos = 1
      for (;;) {
        if (pos >= buf.length) return           // 长度字节没收齐，等下一包
        const d = buf[pos++]
        len += (d & 127) * mult
        mult *= 128
        if ((d & 128) === 0) break
      }
      if (buf.length < pos + len) return        // 报文体没收齐，等下一包
      const type = buf[0] >> 4
      const body = buf.slice(pos, pos + len)
      buf = buf.slice(pos + len)
      _handle(type, body)
    }
  }

  function _handle(type, body) {
    if (type === 2) {                           // CONNACK
      if (body[1] === 0) {
        if (opt.onOpen) opt.onOpen()
        _send(_subscribePacket(topic))
      } else if (opt.onError) {
        opt.onError(new Error('MQTT_CONN_REFUSED_' + body[1]))
      }
    } else if (type === 3) {                    // PUBLISH（QoS0）
      const tlen = (body[0] << 8) | body[1]
      const t = String.fromCharCode.apply(null, Array.from(body.slice(2, 2 + tlen)))
      const payload = body.slice(2 + tlen)
      if (t === topic && opt.onMessage) opt.onMessage(payload, t)
    }
    // SUBACK(9) / PINGRESP(13) 无需处理
  }

  function _send(ab) {
    try { task && task.send({ data: ab }) } catch (e) {}
  }

  function _startPing() {
    _stopPing()
    pingTimer = setInterval(() => _send(new Uint8Array([0xc0, 0x00]).buffer), 25000)
  }
  function _stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
  }

  function _connect() {
    if (closed) return
    task = wx.connectSocket({ url, protocols: ['mqtt'] })
    task.onOpen(() => _send(_connectPacket(clientId)))
    task.onMessage((res) => {
      if (res.data instanceof ArrayBuffer) { _append(new Uint8Array(res.data)); _drain() }
    })
    task.onClose(() => {
      _stopPing()
      if (opt.onClose) opt.onClose()
      if (!closed) setTimeout(_connect, 3000)   // 断线 3 秒重连
    })
    task.onError((err) => {
      _stopPing()
      if (opt.onError) opt.onError(err)
    })
    _startPing()
  }

  _connect()

  return {
    close() {
      closed = true
      _stopPing()
      try { _send(new Uint8Array([0xe0, 0x00]).buffer) } catch (e) {}
      try { task && task.close({}) } catch (e) {}
    }
  }
}

module.exports = { subscribe }
