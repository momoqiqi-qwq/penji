// 云函数 login —— 微信登录的唯一出口：把调用方的 openid 换出来
//
// 为什么不用 code2session + AppSecret：
//   云函数里 cloud.getWXContext() 直接给出调用方的 OPENID / UNIONID，
//   AppSecret 一步都不用碰 —— 少一个能泄露的密钥，也少一个 access_token 刷新循环，
//   还不用配「request 合法域名」。真要和自建后端对接时才走 wx.login 的 code → code2session
//   （code 5 分钟过期且只能用一次，所以登录动作在前端，换 openid 在云函数）。
//
// 为什么还要写 users 集合：
//   openid 本身只是个字符串，落到库里才谈得上「这台微信是谁、他注册了哪几个农户」。
//   集合不存在（initdb 还没跑）不算登录失败，降级成 persisted:false —— 别让登录卡在建表上。
//
// 幂等：_id 就是 openid，一天登十次也只有一条，只更新 lastLoginAt / loginCount。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const USERS = 'users'

async function _touchUser(openid) {
  const now = Date.now()
  const coll = db.collection(USERS)

  let exists = false
  let firstLoginAt = now
  let prevCount = 0

  try {
    const r = await coll.doc(openid).get()
    if (r && r.data) {
      exists = true
      firstLoginAt = r.data.firstLoginAt || now
      prevCount = r.data.loginCount || 1
    }
  } catch (e) {
    // 没有这条（或集合还没有）都走新建分支，统一按「首次登录」处理
    exists = false
  }

  const loginCount = exists ? prevCount + 1 : 1
  const patch = { openid: openid, lastLoginAt: now, loginCount: loginCount }

  try {
    if (exists) {
      await coll.doc(openid).update({ data: patch })
    } else {
      // set 比 add 稳：_id 已定时它天然是 create-or-replace，并发重复登录不会造出两条
      await coll.doc(openid).set({ data: Object.assign({ firstLoginAt: now }, patch) })
    }
    return { persisted: true, isNew: !exists, firstLoginAt: firstLoginAt, loginCount: loginCount }
  } catch (e) {
    console.warn('[login] users 写入跳过', e)
    return {
      persisted: false,
      isNew: !exists,
      firstLoginAt: firstLoginAt,
      loginCount: loginCount,
      error: String((e && e.message) || e)
    }
  }
}

exports.main = async () => {
  const ctx = cloud.getWXContext()
  const openid = ctx.OPENID || ''

  // 控制台「云端测试」直调时没有用户上下文，这时候返回的是失败而不是一个空 openid：
  // 前端拿到空 openid 会当成「未连云端」，不该让它误以为是登录成功。
  if (!openid) {
    return { ok: false, msg: 'NO_OPENID: 没取到调用方微信身份（小程序端调用才有；控制台云端测试无用户上下文）' }
  }

  const info = await _touchUser(openid)

  return {
    ok: true,
    data: {
      openid: openid,
      unionid: ctx.UNIONID || '',
      appid: ctx.APPID || '',
      isNew: info.isNew,
      persisted: info.persisted,
      firstLoginAt: info.firstLoginAt,
      loginCount: info.loginCount,
      note: info.persisted ? '' : 'users 集合不可用，登录本身成功（openid 已返回）；跑一次 initdb 即可补上'
    }
  }
}
