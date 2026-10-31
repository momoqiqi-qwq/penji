// pages/plot/plot.js
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')
const tabbar = require('../../utils/tabbar.js')

Page({
  data: {
    plots: [],
    keyword: '',
    role: 'consumer',
    farmerId: '',
    farmerName: '',
    roleLabel: '消费者'
  },

  onShow() {
    // 按当前路由自动点亮底部 tab（= 地块）
    tabbar.sync(this)
    const app = getApp()
    const cur = app.refreshAuth()
    let farmerName = ''
    if (cur.isFarmer) {
      const f = store.listFarmers().find(x => x.farmerId === cur.farmerId)
      farmerName = f ? f.name : '未知'
    }
    this.setData({
      role: cur.role,
      farmerId: cur.farmerId,
      farmerName,
      roleLabel: cur.isFarmer ? ('农户 · ' + farmerName) : '消费者'
    })
    this.refresh()
  },

  refresh() {
    const cur = auth.current()
    let plots
    if (cur.isFarmer) {
      // 农户身份：只看自己的地块
      plots = store.listPlotsByFarmer(cur.farmerId)
    } else {
      plots = store.listPlots()
    }
    const kw = this.data.keyword.trim()
    if (kw) {
      plots = plots.filter(p =>
        p.name.indexOf(kw) >= 0 ||
        p.plotId.indexOf(kw) >= 0 ||
        p.village.indexOf(kw) >= 0 ||
        (p.farmerName && p.farmerName.indexOf(kw) >= 0)
      )
    }
    this.setData({ plots })
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value }, this.refresh)
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/plotDetail/plotDetail?id=' + id })
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/plotEdit/plotEdit' })
  }
})
