// pages/index/index.js
// 首页：身份展示 + 核心链路入口（按身份分流权限）
// 未选定身份时自动跳转身份选择页
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const auth = require('../../utils/auth.js')
const tabbar = require('../../utils/tabbar.js')

Page({
  data: {
    appName: '',
    slogan: '',
    role: '',
    farmerId: '',
    farmerName: '',
    roleLabel: '',
    nickName: '',
    avatarUrl: '',
    flowSteps: ['传感器采集', 'AI 分析', '自动建档', '二维码绑定', '扫码溯源', '消费者反馈'],
    entries: [],
    stats: { plots: 0, farmers: 0, batches: 0, reviews: 0 },
    featuredPlot: null,
    featuredFarmer: null,
    myFeedback: [],
    feedbackExpanded: true,
    featuredPlotExpanded: false,
    featuredFarmerExpanded: false
  },

  onLoad() {
    const app = getApp()
    this.setData({ appName: app.globalData.appName, slogan: app.globalData.slogan })
  },

  onShow() {
    // 按当前路由自动点亮底部 tab（= 首页），不再硬编码索引
    tabbar.sync(this)
    const app = getApp()
    const cur = app.refreshAuth()
    // 未选定身份：强制进入身份选择页（进入界面即选定身份）
    if (!cur.chosen) {
      wx.reLaunch({ url: '/pages/chooseRole/chooseRole' })
      return
    }
    let farmerName = ''
    let roleLabel = '消费者'
    if (cur.isFarmer) {
      const f = store.listFarmers().find(x => x.farmerId === cur.farmerId)
      farmerName = f ? f.name : '未知'
      roleLabel = '农户 · ' + farmerName
    } else if (cur.isBuyer) {
      const b = store.listBuyers().find(x => x.buyerId === cur.buyerId)
      roleLabel = '采购商 · ' + (b ? b.name : '检测审核')
    }
    this.setData({
      role: cur.role,
      farmerId: cur.farmerId,
      farmerName,
      roleLabel,
      nickName: cur.nickName || '微信用户',
      avatarUrl: cur.avatarUrl,
      entries: this._entriesFor(cur)
    })
    this.refresh()
  },

  // 按身份生成入口：农户管护上传；采购商核验检测；消费者扫码溯源 + 反馈
  _entriesFor(cur) {
    if (cur.isFarmer) {
      return [
        { key: 'upload', name: '上传农产品档案', desc: '定位拍照 · AI 自动建档', icon: '📤', color: '#1f7a3a', url: '/pages/productEdit/productEdit' },
        { key: 'diagnose', name: 'AI 农诊断', desc: '帮你分析种植问题', icon: '🩺', color: '#d9534f', url: '/pages/diagnose/diagnose' },
        { key: 'live', name: '农田实况', desc: '温度·湿度·光照·含水量 + AI 建议', icon: '🌡', color: '#8a6212', url: '/pages/simulate/simulate' },
        { key: 'farmer', name: '农户信用档案', desc: '查看口碑与反馈', icon: '⭐', color: '#d9a441', url: '/pages/farmer/farmer' }
      ]
    }
    if (cur.isBuyer) {
      return [
        { key: 'buyer', name: '采购商工作台', desc: '批次核验 · 检测录入 · OPI 评价', icon: '🧑‍💼', color: '#2d5da8', url: '/pages/buyer/buyer' },
        { key: 'scan', name: '扫码核验', desc: '扫码直达批次核验页', icon: '🔍', color: '#2d7dd2', url: '/pages/scan/scan' },
        { key: 'plot', name: '地块档案', desc: '查看地块与传感器历史', icon: '🗺', color: '#1f7a3a', url: '/pages/plot/plot' },
        { key: 'live', name: '农田实况', desc: '传感器真实环境数据', icon: '🌡', color: '#8a6212', url: '/pages/simulate/simulate' }
      ]
    }
    return [
      { key: 'scan', name: '扫码溯源', desc: '查看真实生长过程', icon: '🔍', color: '#2d7dd2', url: '/pages/scan/scan' },
      { key: 'plot', name: '地块档案', desc: '一块地的多年多茬记录', icon: '🗺', color: '#1f7a3a', url: '/pages/plot/plot' },
      { key: 'farmer', name: '农户信用档案', desc: '长期口碑辅助决策', icon: '⭐', color: '#d9a441', url: '/pages/farmer/farmer' },
      { key: 'live', name: '农田实况', desc: '传感器真实环境数据', icon: '🌡', color: '#8a6212', url: '/pages/simulate/simulate' }
    ]
  },

  refresh() {
    const plots = store.listPlots()
    const farmers = store.listFarmers()
    const batches = store.listBatches()
    let featuredPlot = [...plots].sort((a, b) => (b.isHighlight ? 1 : 0) - (a.isHighlight ? 1 : 0) || b.batchCount - a.batchCount)[0]
    let featuredFarmer = [...farmers].sort((a, b) => b.creditScore - a.creditScore)[0]
    if (featuredFarmer) {
      featuredFarmer.starText = '★'.repeat(featuredFarmer.star) + '☆'.repeat(5 - featuredFarmer.star)
      featuredFarmer.level = util.scoreLevel(featuredFarmer.creditScore)
    }
    // 农户身份：收到的消费者反馈（数据回传）
    let myFeedback = []
    if (this.data.role === 'farmer' && this.data.farmerId) {
      const detail = store.getFarmer(this.data.farmerId)
      if (detail) {
        myFeedback = detail.reviews.slice(0, 3).map(r => ({
          ...r,
          starText: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)
        }))
      }
    }
    this.setData({
      stats: {
        plots: plots.length,
        farmers: farmers.length,
        batches: batches.length,
        reviews: store.listFarmers().reduce((s, f) => s + (f.reviewsCount || 0), 0)
      },
      featuredPlot,
      featuredFarmer,
      myFeedback
    })
  },

  // 重新选择身份
  switchRole() {
    wx.showModal({
      title: '重新选择身份',
      content: '将返回身份选择页，重新选定消费者或农户身份。',
      success: (r) => {
        if (r.confirm) {
          auth.clearRole()
          wx.reLaunch({ url: '/pages/chooseRole/chooseRole' })
        }
      }
    })
  },

  toggleFeedback() {
    this.setData({ feedbackExpanded: !this.data.feedbackExpanded })
  },

  toggleFeaturedPlot() {
    this.setData({ featuredPlotExpanded: !this.data.featuredPlotExpanded })
  },

  toggleFeaturedFarmer() {
    this.setData({ featuredFarmerExpanded: !this.data.featuredFarmerExpanded })
  },

  goEntry(e) {
    const url = e.currentTarget.dataset.url
    // tabBar 页面必须用 switchTab，不能用 navigateTo（否则点击无反应）
    const tabUrls = ['/pages/index/index', '/pages/plot/plot', '/pages/scan/scan', '/pages/simulate/simulate']
    if (tabUrls.indexOf(url) >= 0) {
      wx.switchTab({ url })
    } else {
      wx.navigateTo({ url })
    }
  },

  goPlot(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/plotDetail/plotDetail?id=' + id })
  },

  goFarmer(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/farmerDetail/farmerDetail?id=' + id })
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/farmerDetail/farmerDetail?id=' + this.data.farmerId })
  },

  // 顶部四个统计数字可点击：按身份分流到对应页面
  goStat(e) {
    const key = e.currentTarget.dataset.key
    const role = this.data.role
    const selfId = this.data.farmerId
    if (key === 'plots') {
      // 地块档案（tabBar 页，必须 switchTab）
      wx.switchTab({ url: '/pages/plot/plot' })
    } else if (key === 'farmers') {
      // 农户信用档案列表
      wx.navigateTo({ url: '/pages/farmer/farmer' })
    } else if (key === 'batches') {
      if (role === 'buyer') {
        // 采购商：批次核验工作台
        wx.navigateTo({ url: '/pages/buyer/buyer' })
      } else if (role === 'farmer') {
        // 农户：我的信用档案（含全部种植批次与反馈）
        wx.navigateTo({ url: '/pages/farmerDetail/farmerDetail?id=' + selfId })
      } else {
        // 消费者：扫码即可查看任意批次的溯源档案
        wx.switchTab({ url: '/pages/scan/scan' })
      }
    } else if (key === 'reviews') {
      if (role === 'farmer') {
        // 农户：查看消费者回传的反馈
        wx.navigateTo({ url: '/pages/farmerDetail/farmerDetail?id=' + selfId })
      } else {
        // 消费者/采购商：反馈在扫码溯源后提交，直接回传农户
        wx.showModal({
          title: '消费者反馈',
          content: '扫描农产品二维码进入溯源页，即可对购买的批次打分、留言，反馈会直接回传给种植农户，助力信用档案。',
          confirmText: '去扫码',
          cancelText: '关闭',
          success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/scan/scan' }) }
        })
      }
    }
  },

  onShareAppMessage() {
    return {
      title: '棚迹 · 从地块到餐桌看见每一寸土地的故事',
      path: '/pages/index/index'
    }
  }
})
