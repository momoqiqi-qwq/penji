// pages/chooseRole/chooseRole.js
// 进入界面：微信登录 → 补头像昵称 → 选定身份
// 消费者（扫码溯源+反馈）/ 农户（生产管护+上传）/ 采购商（检测核验+录入检测结果）
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    // login：微信登录；profile：头像昵称；pick：选身份；farmer：选农户；buyer：选采购商
    step: 'login',
    logging: false,
    nickName: '',
    avatarUrl: '',
    identityLabel: '',
    farmers: [],
    buyers: [],
    showRegister: false,
    regName: '',
    regVillage: ''
  },

  onLoad() {
    const cur = auth.current()
    this.setData({
      farmers: store.listFarmers(),
      buyers: store.listBuyers(),
      // 之前填过头像昵称就直接带出来（clearRole 不会清掉它们）
      nickName: cur.nickName === '微信用户' ? '' : cur.nickName,
      avatarUrl: cur.avatarUrl,
      identityLabel: auth.identityLabel()
    })
    if (cur.chosen) {
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },

  // 第一步：微信登录（wx.login 取 code → 云函数 login 换 openid）
  async doWxLogin() {
    if (this.data.logging) return
    this.setData({ logging: true })
    const res = await auth.ensureLogin(true)
    if (!res.ok) {
      this.setData({ logging: false })
      wx.showToast({ title: '微信登录失败，请重试', icon: 'none' })
      return
    }
    // 云开发没就绪：登录本身没失败，但没拿到 openid —— 如实说一句，别假装核验过
    if (!res.openid) {
      wx.showToast({ title: '未连云端，先用本机身份进入', icon: 'none' })
    }
    const cur = auth.current()
    // 之前填过昵称就不再问一遍（切身份的常规路径：登录 → 直接选身份，和以前一样两步）
    const needProfile = !cur.nickName || cur.nickName === '微信用户'
    this.setData({
      logging: false,
      step: needProfile ? 'profile' : 'pick',
      nickName: cur.nickName === '微信用户' ? '' : cur.nickName,
      avatarUrl: cur.avatarUrl,
      identityLabel: auth.identityLabel()
    })
  },

  // 第二步：头像与昵称只能由用户自己填（open-type=chooseAvatar / type=nickname）
  // 不用 wx.getUserProfile：它从 2022-10 起只返回「微信用户」+ 灰头像，等于假数据
  onChooseAvatar(e) {
    const url = (e.detail && e.detail.avatarUrl) || ''
    if (!url) return
    this.setData({ avatarUrl: url })
  },
  onNickName(e) {
    this.setData({ nickName: ((e.detail && e.detail.value) || '').trim() })
  },
  async saveProfile() {
    this.setData({ logging: true })
    // 临时路径会上到云存储换成 fileID；没云环境就保留临时路径
    const avatarUrl = await auth.uploadAvatar(this.data.avatarUrl)
    // 昵称可以空着，展示层兜底成「微信用户」，不往库里写假名字
    auth.saveWxUserInfo({ nickName: this.data.nickName, avatarUrl: avatarUrl })
    this.setData({ logging: false, step: 'pick', avatarUrl: avatarUrl })
  },
  skipProfile() {
    this.setData({ step: 'pick' })
  },

  // 消费者
  async pickConsumer() {
    await auth.chooseRole('consumer')
    this._enter()
  },

  // 农户
  pickFarmer() {
    this.setData({ step: 'farmer', farmers: store.listFarmers() })
  },
  async pickFarmerId(e) {
    await auth.chooseRole('farmer', e.currentTarget.dataset.id)
    this._enter()
  },
  async register() {
    const name = this.data.regName.trim()
    if (!name) { wx.showToast({ title: '请填写姓名', icon: 'none' }); return }
    // 把注册人记在农户档案上：同一台微信以后能找回自己建的农户
    const f = store.registerFarmer(name, this.data.regVillage.trim(), auth.current().openid)
    await auth.chooseRole('farmer', f.farmerId)
    this._enter()
  },

  // 采购商（检测与审核者）
  pickBuyer() {
    this.setData({ step: 'buyer', buyers: store.listBuyers() })
  },
  async pickBuyerId(e) {
    await auth.chooseRole('buyer', e.currentTarget.dataset.id)
    this._enter()
  },

  backPick() { this.setData({ step: 'pick' }) },
  toggleRegister() { this.setData({ showRegister: !this.data.showRegister }) },
  onRegName(e) { this.setData({ regName: e.detail.value }) },
  onRegVillage(e) { this.setData({ regVillage: e.detail.value }) },

  _enter() {
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
