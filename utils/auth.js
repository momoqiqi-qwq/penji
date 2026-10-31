// utils/auth.js
// 棚迹 登录 / 身份 / 权限
//
// 登录只做一件事：用 wx.login 的 code 换回这台设备的微信 openid（云函数 login 里
// cloud.getWXContext() 直接给，AppSecret 一步都不碰）。
// 身份（consumer / farmer / buyer）是业务选择，和登录分开存：换身份不等于换微信用户，
// 所以 clearRole() 只清业务字段，openid 与昵称头像留着。
//
// 云开发没就绪时（本地演示 / 模拟器早期 / 没部署 login）登录降级为「本机身份」：
// openid 留空、identitySource='local'，再由 identityLabel() 如实说出来。
// 不能假装核验过微信身份 —— 和传感器读数必须带来源标签是同一条纪律。

const cloud = require('./cloud.js')

const ROLE_KEY = 'pengji_role_v3'
// 换 openid 是一次云函数调用，连不上时别把登录按钮卡太久
const LOGIN_TIMEOUT = 6000

const EMPTY = {
  chosen: false,
  role: '',
  farmerId: '',
  buyerId: '',
  nickName: '',
  avatarUrl: '',
  openid: '',          // 云函数 login 换回的微信身份；空字符串 = 尚未核验
  unionid: '',         // 绑定过开放平台才有，没有就是空
  identitySource: '',  // 'cloud' 云端核验过 / 'local' 只存在本机 / '' 没登过
  loginAt: 0
}

function _read() {
  try {
    const raw = wx.getStorageSync(ROLE_KEY)
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      // 用 EMPTY 兜底：老版本存下的对象没有 openid 字段，不能让 current() 读到 undefined
      return Object.assign({}, EMPTY, parsed)
    }
  } catch (e) {}
  return Object.assign({}, EMPTY)
}

function _write(state) {
  try { wx.setStorageSync(ROLE_KEY, JSON.stringify(state)) } catch (e) {}
}

/** 合并写入：只覆盖传进来的字段。以前每次都整对象重写，新增字段一写就丢 */
function _merge(patch) {
  const next = Object.assign({}, _read(), patch)
  _write(next)
  return current()
}

/** wx.login 取 code（一次性，5 分钟过期；只在前端拿，不缓存） */
function _wxCode() {
  return new Promise((resolve) => {
    wx.login({
      success: (res) => resolve((res && res.code) || ''),
      fail: () => resolve('')
    })
  })
}

/**
 * 微信登录：wx.login → 云函数 login 换 openid
 * @returns {Promise<{ok, code, openid, unionid, source, msg}>}
 *   ok=false 只有 wx.login 本身失败；云函数失败只把 source 降级成 'local'，不阻断进小程序
 */
async function wxLogin() {
  const code = await _wxCode()
  if (!code) {
    return { ok: false, code: '', openid: '', unionid: '', source: '', msg: 'WX_LOGIN_FAIL' }
  }
  try {
    const data = await cloud.call('login', {}, LOGIN_TIMEOUT)
    const openid = (data && data.openid) || ''
    if (!openid) {
      // 云函数通了但没给 openid：当作未核验，别伪造
      return { ok: true, code: code, openid: '', unionid: '', source: 'local', msg: 'LOGIN_NO_OPENID' }
    }
    return {
      ok: true,
      code: code,
      openid: openid,
      unionid: (data && data.unionid) || '',
      source: 'cloud'
    }
  } catch (e) {
    const msg = String((e && e.message) || e)
    console.warn('[auth] 云函数 login 不可用，降级本机身份', msg)
    return { ok: true, code: code, openid: '', unionid: '', source: 'local', msg: msg }
  }
}

/**
 * 拿到微信身份并落盘（幂等）
 * 已有 openid 直接复用，不重复调云函数 —— 冷启动、切身份都不该多花一次云调用
 * @param {boolean} force 强制重新登录（换账号 / 排查时用）
 */
async function ensureLogin(force) {
  const s = _read()
  if (!force && s.openid) {
    return {
      ok: true,
      openid: s.openid,
      unionid: s.unionid,
      source: s.identitySource || 'cloud',
      cached: true
    }
  }
  const res = await wxLogin()
  _merge({
    openid: res.openid || '',
    unionid: res.unionid || '',
    identitySource: res.source || '',
    loginAt: Date.now()
  })
  return res
}

/**
 * 头像落到云存储并返回 fileID
 * 为什么必须上传：chooseAvatar 给的是 wxfile:// 临时路径，重启小程序就失效，
 * 直接存本地等于下次打开头像变空白。没云环境时原样返回临时路径（本次会话内能看）。
 */
async function uploadAvatar(tempPath) {
  if (!tempPath) return ''
  // 已经是云文件或网络图，不用再传
  if (tempPath.indexOf('cloud://') === 0 || /^https?:\/\//.test(tempPath)) return tempPath
  const s = _read()
  if (!s.openid) return tempPath
  try {
    const ext = (tempPath.match(/\.[A-Za-z0-9]+$/) || ['.png'])[0]
    // 用 openid 命名：同一个人换头像就覆盖同一份，云存储不会越攒越多
    return await cloud.uploadFile('avatar/' + s.openid + ext, tempPath)
  } catch (e) {
    console.warn('[auth] 头像上传失败，先用本地临时路径', (e && e.message) || e)
    return tempPath
  }
}

/**
 * 保存微信用户信息（昵称、头像）
 * 昵称留空就存空串：展示层的「微信用户」是兜底文案，不是用户填的数据，
 * 别把兜底字样写进库里 —— 那样下次就分不清「没填」和「填了微信用户」
 */
function saveWxUserInfo(userInfo) {
  return _merge({
    nickName: (userInfo && userInfo.nickName) || '',
    avatarUrl: (userInfo && userInfo.avatarUrl) || ''
  })
}

/**
 * 当前身份
 * @returns {{chosen, role, farmerId, buyerId, isConsumer, isFarmer, isBuyer,
 *            nickName, avatarUrl, openid, unionid, identitySource, loginAt, loggedIn}}
 */
function current() {
  const s = _read()
  const role = s.role || ''
  return {
    chosen: !!s.chosen && !!role,
    role: role,
    farmerId: s.farmerId || '',
    buyerId: s.buyerId || '',
    isConsumer: role === 'consumer',
    isFarmer: role === 'farmer',
    isBuyer: role === 'buyer',
    nickName: s.nickName || '',
    avatarUrl: s.avatarUrl || '',
    openid: s.openid || '',
    unionid: s.unionid || '',
    identitySource: s.identitySource || '',
    loginAt: s.loginAt || 0,
    // 只有云端核验过 openid 才算真登录；本机身份也能用，但要标出来
    loggedIn: !!s.openid
  }
}

/** 身份来源的一句话说明（UI 如实标注用；没登过返回空串，不占版面） */
function identityLabel() {
  const s = _read()
  if (s.openid) return '微信身份已核验'
  if (s.identitySource === 'local') return '本机身份 · 未连云端'
  return ''
}

/** 选定身份（进入界面即选择），顺手确保微信身份已拿到 */
async function chooseRole(role, extId) {
  await ensureLogin()
  const s = _read()
  return _merge({
    chosen: true,
    role: (role === 'farmer' || role === 'buyer' || role === 'consumer') ? role : 'consumer',
    farmerId: role === 'farmer' ? (extId || '') : (s.farmerId || ''),
    buyerId: role === 'buyer' ? (extId || '') : (s.buyerId || '')
  })
}

/**
 * 重新选择身份
 * 只清业务身份，微信身份（openid / 昵称 / 头像）留着：
 * 换身份不是换人，下次进身份页不用再登一遍、也不用重新选头像
 */
function clearRole() {
  return _merge({ chosen: false, role: '', farmerId: '', buyerId: '' })
}

/** 权限判断 */
function canEdit(role, farmerId, plotOwnerId) { return role === 'farmer' && farmerId && farmerId === plotOwnerId }
function canUpload(role) { return role === 'farmer' }          // 仅农户上传
function canReview(role) { return role === 'consumer' }       // 仅消费者反馈
function canInspect(role) { return role === 'buyer' }         // 仅采购商录入检测

module.exports = {
  current, chooseRole, clearRole, identityLabel,
  canEdit, canUpload, canReview, canInspect,
  wxLogin, ensureLogin, saveWxUserInfo, uploadAvatar
}
