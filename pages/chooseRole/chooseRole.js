// pages/chooseRole/chooseRole.js
// 进入界面：微信登录 → 选定身份
// 消费者（扫码溯源+反馈）/ 农户（生产管护+上传）/ 采购商（检测核验+录入检测结果）
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    step: 'login',         // login：微信登录；pick：选身份；farmer：选农户；buyer：选采购商
    logging: false,
    farmers: [],
    buyers: [],
    showRegister: false,
    regName: '',
    regVillage: ''
  },

  onLoad() {
    this.setData({ farmers: store.listFarmers(), buyers: store.listBuyers() })
    const cur = auth.current()
    if (cur.chosen) {
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },

  // 微信登录
  async doWxLogin() {
    this.setData({ logging: true })
    const res = await auth.wxLogin()
    if (res.ok) {
      wx.getUserProfile({
        desc: '用于展示您的微信身份',
        success: (infoRes) => {
          auth.saveWxUserInfo(infoRes.userInfo)
          this.setData({ logging: false, step: 'pick' })
        },
        fail: () => {
          auth.saveWxUserInfo({ nickName: '微信用户', avatarUrl: '' })
          this.setData({ logging: false, step: 'pick' })
        }
      })
    } else {
      this.setData({ logging: false })
      wx.showToast({ title: '微信登录失败，请重试', icon: 'none' })
    }
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
    const f = store.registerFarmer(name, this.data.regVillage.trim())
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
