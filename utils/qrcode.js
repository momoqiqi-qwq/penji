// utils/qrcode.js
// 轻量二维码生成器（纯 JS，无外部依赖）
// 输入 UTF-8 文本，输出模块矩阵（二维数组）+ 便捷的 Canvas 绘制函数
// 实现：Byte 模式 + ECC 纠错级别 M + 自动选择版本 1~10 + 固定掩模 2（符合 QR 规范，可被任意扫码器识别）

// ---------- GF(256) ----------
const EXP = new Array(256)
const LOG = new Array(256)
;(function () {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  EXP[255] = EXP[0]
  LOG[0] = 0
})()
function gexp(n) { return EXP[((n % 255) + 255) % 255] }
function glog(n) { if (n < 1) throw new Error('glog(' + n + ')'); return LOG[n] }

// ---------- RS 纠错块表（版本 1~10，级别 M）：[块数, 每块总码字, 每块数据码字, ...] ----------
const RS_BLOCKS = {
  1: [1, 26, 16],
  2: [1, 44, 28],
  3: [1, 70, 44],
  4: [2, 50, 32],
  5: [2, 67, 43],
  6: [4, 43, 27],
  7: [4, 49, 31],
  8: [2, 60, 38, 2, 61, 39],
  9: [3, 58, 36, 2, 59, 37],
  10: [4, 69, 43, 1, 70, 44]
}

// 版本 1~10 字节容量（4bit 模式 + 8bit 长度 + 数据）
const CAPACITY = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 }

// 位置探测/对齐图案坐标
const ALIGN_POS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }

const G15 = 0x537
const G15_MASK = 0x5412

function bchDigit(d) {
  let n = 0
  while (d !== 0) { n++; d >>>= 1 }
  return n
}

function bchTypeInfo(data) {
  let d = data << 10
  while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15))
  return ((data << 10) | d) ^ G15_MASK
}

function utf8Bytes(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i)
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return out
}

// ---------- 多项式 ----------
function Poly(num, shift) {
  let offset = 0
  while (offset < num.length && num[offset] === 0) offset++
  this.num = new Array(num.length - offset + shift).fill(0)
  for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset]
}
Poly.prototype.get = function (i) { return this.num[i] }
Poly.prototype.length = function () { return this.num.length }
Poly.prototype.multiply = function (e) {
  const r = new Array(this.length() + e.length() - 1).fill(0)
  for (let i = 0; i < this.length(); i++)
    for (let j = 0; j < e.length(); j++)
      r[i + j] ^= gexp(glog(this.num[i]) + glog(e.num[j]))
  return new Poly(r, 0)
}
Poly.prototype.mod = function (e) {
  if (this.length() - e.length() < 0) return this
  const ratio = glog(this.get(0)) - glog(e.get(0))
  const num = this.num.slice()
  for (let i = 0; i < e.length(); i++) num[i] ^= gexp(glog(e.get(i)) + ratio)
  return new Poly(num, 0).mod(e)
}
function errorCorrectPoly(len) {
  let a = new Poly([1], 0)
  for (let i = 0; i < len; i++) a = a.multiply(new Poly([1, gexp(i)], 0))
  return a
}

// ---------- BitBuffer ----------
function BitBuffer() { this.buffer = []; this.length = 0 }
BitBuffer.prototype.put = function (num, len) {
  for (let i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) === 1)
}
BitBuffer.prototype.putBit = function (bit) {
  const idx = Math.floor(this.length / 8)
  if (this.buffer.length <= idx) this.buffer.push(0)
  if (bit) this.buffer[idx] |= (0x80 >>> (this.length % 8))
  this.length++
}

// ---------- 掩模 2：列 %3==0 ----------
function maskFn(row, col) { return col % 3 === 0 }

/**
 * 生成二维码模块矩阵
 * @param {string} text 文本内容（UTF-8）
 * @returns {{size:number, modules:boolean[][]}}
 */
function make(text) {
  const bytes = utf8Bytes(String(text || ''))
  // 自动选版本
  let version = 0
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= CAPACITY[v]) { version = v; break }
  }
  if (!version) throw new Error('内容过长，最多约 213 字节')
  const blockSpec = RS_BLOCKS[version]
  // 解析块结构
  const blocks = []
  let totalDataCount = 0
  for (let i = 0; i < blockSpec.length; i += 3) {
    for (let b = 0; b < blockSpec[i]; b++) {
      blocks.push({ total: blockSpec[i + 1], data: blockSpec[i + 2] })
      totalDataCount += blockSpec[i + 2]
    }
  }

  // 数据编码
  const buf = new BitBuffer()
  buf.put(4, 4)                 // byte 模式
  buf.put(bytes.length, 8)      // 长度（v1~10 为 8bit）
  bytes.forEach(b => buf.put(b, 8))
  if (buf.length + 4 <= totalDataCount * 8) buf.put(0, 4)
  while (buf.length % 8 !== 0) buf.putBit(false)
  while (true) {
    if (buf.length >= totalDataCount * 8) break
    buf.put(0xec, 8)
    if (buf.length >= totalDataCount * 8) break
    buf.put(0x11, 8)
  }

  // RS 纠错 + 交织
  const offset = 0
  const dcdata = [], ecdata = []
  let maxDc = 0, maxEc = 0, ptr = 0
  for (let i = 0; i < blocks.length; i++) {
    const dcCount = blocks[i].data
    const ecCount = blocks[i].total - blocks[i].data
    maxDc = Math.max(maxDc, dcCount)
    maxEc = Math.max(maxEc, ecCount)
    const dc = new Array(dcCount)
    for (let r = 0; r < dcCount; r++) dc[r] = 0xff & buf.buffer[r + ptr]
    ptr += dcCount
    const rsPoly = errorCorrectPoly(ecCount)
    const rawPoly = new Poly(dc, rsPoly.length() - 1)
    const modPoly = rawPoly.mod(rsPoly)
    const ec = new Array(ecCount).fill(0)
    for (let j = 0; j < ecCount; j++) {
      const modIndex = j + modPoly.length() - ecCount
      ec[j] = modIndex >= 0 ? modPoly.get(modIndex) : 0
    }
    dcdata.push(dc)
    ecdata.push(ec)
  }
  const total = []
  for (let i = 0; i < maxDc; i++)
    for (let b = 0; b < blocks.length; b++)
      if (i < dcdata[b].length) total.push(dcdata[b][i])
  for (let i = 0; i < maxEc; i++)
    for (let b = 0; b < blocks.length; b++)
      if (i < ecdata[b].length) total.push(ecdata[b][i])

  // 构建模块矩阵
  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array(size).fill(null))

  function setProbe(r, c) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
        const dark = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
          (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
        modules[rr][cc] = dark
      }
    }
  }
  setProbe(0, 0); setProbe(0, size - 7); setProbe(size - 7, 0)

  // 时序图案
  for (let i = 8; i < size - 8; i++) {
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0
  }
  // 对齐图案
  const pos = ALIGN_POS[version]
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      const r = pos[i], c = pos[j]
      if (modules[r][c] !== null) continue
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          modules[r + dr][c + dc] = dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0)
    }
  // 版本信息（v7+ 需要，这里 v1~10 中 v7~10 需要）
  if (version >= 7) {
    // 版本信息 BCH(18,6)，G18=0x1F25
    let data = version
    let d = version << 12
    const G18 = 0x1f25
    while (bchDigit(d) - bchDigit(G18) >= 0) d ^= G18 << (bchDigit(d) - bchDigit(G18))
    const bits = (version << 12) | d
    for (let i = 0; i < 18; i++) {
      const mod = ((bits >> i) & 1) === 1
      const a = Math.floor(i / 3), b = i % 3 + size - 8 - 3
      // 两个镜像位置
      modules[a][b] = mod
      modules[b][a] = mod
    }
  }

  // 类型信息（ECC M=0，掩模 2）——必须在数据填充之前写入，
  // 否则 Z 字形填充会把数据位消耗在这些功能格上，扫码器跳过后位流错位导致无法识别
  const maskPattern = 2
  const bits = bchTypeInfo((0 << 3) | maskPattern)
  for (let i = 0; i < 15; i++) {
    const mod = ((bits >> i) & 1) === 1
    if (i < 6) modules[i][8] = mod
    else if (i < 8) modules[i + 1][8] = mod
    else modules[size - 15 + i][8] = mod
  }
  for (let i = 0; i < 15; i++) {
    const mod = ((bits >> i) & 1) === 1
    if (i < 8) modules[8][size - i - 1] = mod
    else if (i < 9) modules[8][15 - i] = mod
    else modules[8][14 - i] = mod
  }
  modules[size - 8][8] = true // 固定暗模块

  // 掩模 + 数据填充（仅填充仍为 null 的数据区格子）
  let inc = -1
  let row = size - 1, bitIndex = 7, byteIndex = 0
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--
    while (true) {
      for (let c = 0; c < 2; c++) {
        if (modules[row][col - c] === null) {
          let dark = false
          if (byteIndex < total.length) dark = ((total[byteIndex] >>> bitIndex) & 1) === 1
          if (maskFn(row, col - c)) dark = !dark
          modules[row][col - c] = dark
          bitIndex--
          if (bitIndex === -1) { byteIndex++; bitIndex = 7 }
        }
      }
      row += inc
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break }
    }
  }

  return { size, modules }
}

/**
 * 绘制到小程序 Canvas（2d 或旧版均可）
 * @param {Object} ctx canvas 上下文
 * @param {string} text 内容
 * @param {number} px 画布边长（px）
 */
function drawToCanvas(ctx, text, px) {
  const { size, modules } = make(text)
  // 整数像素对齐：扫码器对硬边界敏感，cell 取整保证模块边长为整数
  const cell = Math.floor(px / (size + 8))   // 四周至少 4 模块静区
  const drawSize = cell * (size + 8)         // 模块 + 上下左右 4 格静区 的完整尺寸
  const margin = (px - drawSize) / 2         // 画布多余空间均分到四周（允许 .5 小数，保证绝对对称）
  const off = margin + 4 * cell              // 模块起点 = 外边距 + 静区宽度
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = '#000000'
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (modules[r][c]) ctx.fillRect(off + c * cell, off + r * cell, cell, cell)
  return { size }
}

module.exports = { make, drawToCanvas }
