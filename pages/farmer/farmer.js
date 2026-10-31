// pages/farmer/farmer.js
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')

Page({
  data: { farmers: [], keyword: '' },

  onShow() {
     this.refresh() },

  refresh() {
    let farmers = store.listFarmers().sort((a, b) => b.creditScore - a.creditScore)
    const kw = this.data.keyword.trim()
    if (kw) {
      farmers = farmers.filter(f =>
        f.name.indexOf(kw) >= 0 || f.village.indexOf(kw) >= 0 || f.farmerId.indexOf(kw) >= 0
      )
    }
    farmers = farmers.map((f, i) => ({
      ...f,
      rank: i + 1,
      starText: '★'.repeat(f.star) + '☆'.repeat(5 - f.star),
      level: util.scoreLevel(f.creditScore),
      rankCls: i === 0 ? 'tag-gold' : (i === 1 ? 'tag-green' : 'tag-gray')
    }))
    this.setData({ farmers })
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
    wx.navigateTo({ url: '/pages/farmerDetail/farmerDetail?id=' + id })
  }
})
