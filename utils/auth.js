// utils/auth.js
// 棚迹 身份与权限工具
// 进入小程序首次微信登录 + 选定身份：消费者 consumer / 农户 farmer / 采购商 buyer
// 农户：生产管护、上传档案；消费者：扫码溯源 + 反馈；采购商：检测核验、录入检测结果（不可改农户原始记录）

const ROLE_KEY = 'pengji_role_v3'

function _read() {
  try {
    const raw = wx.getStorageSync(ROLE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {}
  return { chosen: false, role: '', farmerId: '', buyerId: '', nickName: '', avatarUrl: '' }
}

function _write(state) {
  try { wx.setStorageSync(ROLE_KEY, JSON.stringify(state)) } catch (e) {}
}

/** 微信登录（wx.login 获取 code；真实部署可发后端换 openId） */
function wxLogin() {
  return new Promise((resolve) => {
    wx.login({
      success: (res) => resolve({ ok: true, code: res.code }),
      fail: () => resolve({ ok: false, code: '' })
    })
  })
}

/** 保存微信用户信息（昵称、头像） */
function saveWxUserInfo(userInfo) {
  const s = _read()
  _write({
    chosen: s.chosen, role: s.role, farmerId: s.farmerId, buyerId: s.buyerId,
    nickName: (userInfo && userInfo.nickName) || '微信用户',
    avatarUrl: (userInfo && userInfo.avatarUrl) || ''
  })
  return current()
}

/**
 * 当前身份
 * @returns {{chosen, role, farmerId, buyerId, isConsumer, isFarmer, isBuyer, nickName, avatarUrl}}
 */
function current() {
  const s = _read()
  const role = s.role || ''
  return {
    chosen: !!s.chosen && !!role,
    role,
    farmerId: s.farmerId || '',
    buyerId: s.buyerId || '',
    isConsumer: role === 'consumer',
    isFarmer: role === 'farmer',
    isBuyer: role === 'buyer',
    nickName: s.nickName || '',
    avatarUrl: s.avatarUrl || ''
  }
}

/** 选定身份（进入界面即选择），同时微信登录 */
async function chooseRole(role, extId) {
  await wxLogin()
  const s = _read()
  const state = {
    chosen: true,
    role: (role === 'farmer' || role === 'buyer' || role === 'consumer') ? role : 'consumer',
    farmerId: role === 'farmer' ? (extId || '') : (s.farmerId || ''),
    buyerId: role === 'buyer' ? (extId || '') : (s.buyerId || ''),
    nickName: s.nickName || '微信用户',
    avatarUrl: s.avatarUrl || ''
  }
  _write(state)
  return current()
}

/** 重新选择身份 */
function clearRole() {
  _write({ chosen: false, role: '', farmerId: '', buyerId: '', nickName: '', avatarUrl: '' })
  return current()
}

/** 权限判断 */
function canEdit(role, farmerId, plotOwnerId) { return role === 'farmer' && farmerId && farmerId === plotOwnerId }
function canUpload(role) { return role === 'farmer' }          // 仅农户上传
function canReview(role) { return role === 'consumer' }       // 仅消费者反馈
function canInspect(role) { return role === 'buyer' }         // 仅采购商录入检测

module.exports = {
  current, chooseRole, clearRole,
  canEdit, canUpload, canReview, canInspect,
  wxLogin, saveWxUserInfo
}
