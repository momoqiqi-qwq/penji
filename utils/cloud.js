// utils/cloud.js
// 云开发统一入口：初始化 + 云函数调用（带超时）。
// 约定：云函数统一返回 { ok:true, data } 或 { ok:false, msg }，本模块 resolve 的是 data 部分。
// 云函数调用不受小程序「request 合法域名」限制，无需备案域名与 HTTPS 证书。

const config = require('../config.js')

// 云开发环境 ID：config.js 为空时用默认环境
const ENV_ID = config.cloudEnv || ''

// 传感器读数类云函数的客户端超时（秒级刷新，不能等太久）
const CALL_TIMEOUT = 8000

let inited = false
let initFailed = false

function available() {
  return typeof wx !== 'undefined' && !!wx.cloud
}

/** 初始化（幂等）；环境未配置或基础库不支持时返回 false */
function init() {
  if (inited) return true
  if (initFailed) return false
  if (!available()) { initFailed = true; return false }
  try {
    const opts = { traceUser: true }
    if (ENV_ID) opts.env = ENV_ID
    wx.cloud.init(opts)
    inited = true
    console.log('[cloud] 初始化成功', ENV_ID || '(默认环境)')
  } catch (e) {
    console.error('[cloud] 初始化失败', e)
    initFailed = true
    inited = false
  }
  return inited
}

/** 云开发是否可用（幂等，可反复调用） */
function ready() {
  return init()
}

function envDesc() {
  return ENV_ID || '(默认环境)'
}

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 入参
 * @param {number} timeoutMs 客户端超时（要略小于云函数超时）
 * @returns {Promise<any>} resolve 的是 data 部分
 */
function call(name, data, timeoutMs) {
  const ms = timeoutMs || CALL_TIMEOUT
  return new Promise((resolve, reject) => {
    if (!available()) {
      reject(new Error('CLOUD_NOT_SUPPORTED'))
      return
    }
    if (!init()) {
      reject(new Error('CLOUD_NOT_READY'))
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('CLOUD_TIMEOUT'))
    }, ms)

    wx.cloud.callFunction({
      name: name,
      data: data || {},
      success: (res) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const r = res && res.result
        if (!r || r.ok !== true) {
          reject(new Error((r && (r.msg || r.message)) || 'FN_ERROR'))
          return
        }
        resolve(r.data)
      },
      fail: (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        console.warn('[cloud] callFunction 失败', name, err)
        reject(new Error('CLOUD_CALL_FAIL'))
      }
    })
  })
}

module.exports = {
  ENV_ID,
  available, init, ready, envDesc,
  call,
  get inited() { return inited }
}
