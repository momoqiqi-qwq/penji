// pages/farmerDetail/farmerDetail.js
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    farmerId: '',
    farmer: null,
    batches: [],
    reviews: [],
    records: [],
    creditBar: 0,
    creditDims: [],
    creditBasis: '',
    // 身份权限
    role: 'consumer',
    canReview: true,   // 仅消费者可评价
    showReviewSheet: false,
    reviewForm: { rating: 5, content: '' }
  },

  onLoad(query) {
    this.setData({ farmerId: query.id })
    this.refresh()
  },

  onShow() {
    if (this.data.farmerId) this.refresh()
  },

  refresh() {
    const detail = store.getFarmer(this.data.farmerId)
    if (!detail) {
      wx.showToast({ title: '农户不存在', icon: 'none' })
      return
    }
    const { farmer, batches, reviews, records } = detail
    farmer.starText = '★'.repeat(farmer.star) + '☆'.repeat(5 - farmer.star)
    farmer.level = util.scoreLevel(farmer.creditScore)
    farmer.joinedYear = farmer.joinedAt ? farmer.joinedAt.slice(0, 4) : ''

    // 三维度信用评价明细（GB/T 23794-2023）
    const creditDims = (farmer.creditDetail && farmer.creditDetail.dims ? farmer.creditDetail.dims : []).map(d => ({
      ...d,
      pct: d.max ? Math.round(d.score / d.max * 100) : 0,
      barCls: d.key === 'willingness' ? 'green' : (d.key === 'ability' ? 'gold' : 'green'),
      items: d.items.map(it => ({ ...it, pct: it.max ? Math.round(it.score / it.max * 100) : 0 }))
    }))
    const creditBasis = farmer.creditDetail ? farmer.creditDetail.basis : ''

    const batchesView = batches.map(b => ({
      ...b,
      statusTag: b.status === '种植中' ? 'tag-green' : 'tag-gray',
      flagTag: b.flag ? 'tag-warn' : ''
    }))

    const reviewsView = reviews.map(r => ({
      ...r,
      starText: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating),
      timeAgo: util.timeAgo(util.parseDate(r.date))
    }))

    const batchName = {}
    batches.forEach(b => batchName[b.batchId] = b.productName)
    const recordsView = records.map(r => ({
      ...r,
      productName: batchName[r.batchId] || '-',
      typeTag: this._typeTag(r.type),
      timeAgo: util.timeAgo(util.parseDate(r.date))
    }))

    const app = getApp()
    const cur = app.refreshAuth()
    this.setData({
      farmer,
      batches: batchesView,
      reviews: reviewsView,
      records: recordsView,
      creditBar: farmer.creditScore,
      creditDims,
      creditBasis,
      role: cur.role,
      canReview: auth.canReview(cur.role)
    })
  },

  _typeTag(type) {
    const map = { '播种': 'tag-green', '施肥': 'tag-gold', '灌溉': 'tag-green', '除草': 'tag-gray', '防治': 'tag-gold', '收获': 'tag-green' }
    return map[type] || 'tag-gray'
  },

  goPlot(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/plotDetail/plotDetail?id=' + id })
  },

  goBatch(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/product/product?id=' + id })
  },

  // 消费者反馈农户（数据回传农户）
  openReview() {
    if (!this.data.canReview) {
      wx.showToast({ title: '仅消费者可反馈', icon: 'none' })
      return
    }
    this.setData({ showReviewSheet: true })
  },
  closeReview() { this.setData({ showReviewSheet: false }) },
  onRating(e) { this.setData({ 'reviewForm.rating': +e.currentTarget.dataset.r }) },
  onContent(e) { this.setData({ 'reviewForm.content': e.detail.value }) },
  submitReview() {
    if (!this.data.farmer) return
    if (!this.data.canReview) {
      wx.showToast({ title: '仅消费者可反馈', icon: 'none' })
      return
    }
    const f = this.data.reviewForm
    if (!f.content.trim()) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    store.addReview({
      farmerId: this.data.farmer.farmerId,
      batchId: '',
      buyerName: '扫码消费者',
      rating: f.rating,
      content: f.content.trim()
    })
    wx.showToast({ title: '反馈已提交，将回传农户', icon: 'success' })
    this.setData({ showReviewSheet: false, 'reviewForm.content': '' })
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  }
})
