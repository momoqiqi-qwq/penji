// utils/auth.js
// 棚迹 登录 / 身份 / 权限
//
// 登录只做一件事：拿到这台微信的 openid。云函数 login 里 cloud.getWXContext() 直接给，
// AppSecret 一步都不碰 —— 正因为 openid 是服务端自己认出来的，前端连 wx.login 都不用跑，
// 更没有 code 要传（曾经取过一次 code 却从未使用，还让 wx.login 失败白白封死登录）。
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
  loginAt: 0,
  profileSkipped: false // 用户主动跳过「补头像昵称」：跳过就别每次登录再问一遍
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

/**
 * 微信登录：直接问云函数要 openid（openid 由 getWXContext 在服务端认出来）
 * @returns {Promise<{ok, openid, unionid, source, msg}>}
 *   ok = 真的核验到了微信身份（= 有 openid）。
 *   云开发不可用只把 source 降级成 'local' 并给空 openid，不阻断进小程序 ——
 *   这里没有「登录失败」这条分支，也就没有理由让谁卡在门外。
 */
async function wxLogin() {
  try {
    const data = await cloud.call('login', {}, LOGIN_TIMEOUT)
    const openid = (data && data.openid) || ''
    if (!openid) {
      // 云函数通了但没给 openid：当作未核验，别伪造
      return { ok: false, openid: '', unionid: '', source: 'local', msg: 'LOGIN_NO_OPENID' }
    }
    return {
      ok: true,
      openid: openid,
      unionid: (data && data.unionid) || '',
      source: 'cloud'
    }
  } catch (e) {
    const msg = String((e && e.message) || e)
    console.warn('[auth] 云函数 login 不可用，降级本机身份', msg)
    return { ok: false, openid: '', unionid: '', source: 'local', msg: msg }
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
  // 只有确实拿到新 openid 才覆盖：云端抖一下不该把上一次核验过的身份抹成空串，
  // 那等于让一次断网把用户永久降级成本机身份（而且自己不会恢复）。
  const patch = { loginAt: Date.now() }
  if (res.openid) {
    patch.openid = res.openid
    patch.unionid = res.unionid || ''
    patch.identitySource = res.source || 'cloud'
  } else if (!s.openid) {
    // 本来就没核验过，才允许记成本机身份；有旧值就原样留着
    patch.identitySource = res.source || ''
  }
  _merge(patch)
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
    avatarUrl: (userInfo && userInfo.avatarUrl) || '',
    // 自己填过了，就不再算「跳过头像昵称」，以后登录不必再问
    profileSkipped: false
  })
}

/**
 * 记住「先跳过补头像昵称」
 * 只 setData 不落盘的话，跳过的人下次登录会被再问一遍 —— 这不是提醒，是纠缠
 */
function skipProfile() {
  return _merge({ profileSkipped: true })
}

/**
 * 当前身份
 * @returns {{chosen, role, farmerId, buyerId, isConsumer, isFarmer, isBuyer,
 *            nickName, avatarUrl, openid, unionid, identitySource, loginAt,
 *            profileSkipped, loggedIn}}
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
    profileSkipped: !!s.profileSkipped,
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
  wxLogin, ensureLogin, saveWxUserInfo, skipProfile, uploadAvatar
}
