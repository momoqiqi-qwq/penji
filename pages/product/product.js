// pages/product/product.js
// 溯源结果页：消费者扫码后查看真实生长过程
// 展示：成长周期时间轴 + 传感器环境曲线 + 带定位的现场照片 + AI 环境报告 + 农事记录
// 消费者可反馈（评价）；农户只能查看，不能上传/评价
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const chart = require('../../utils/chart.js')
const sensors = require('../../utils/sensors.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    batchId: '',
    batch: null,
    plot: null,
    farmer: null,
    records: [],
    reviews: [],
    siblingBatches: [],
    growthCycle: [],
    envSpark: null,
    latestEnv: null,
    latestEnvTag: '',
    opi: null,
    organic: null,
    risk: null,
    inspections: [],
    photos: [],
    aiReport: null,
    showReviewSheet: false,
    reviewForm: { rating: 5, content: '' },
    // 身份权限
    role: '',
    canReview: true
  },

  onLoad(query) {
    const id = query.id || query.code || ''
    this.setData({ batchId: id })
    this.refresh()
  },

  onShow() {
    if (this.data.batchId) this.refresh()
  },

  refresh() {
    const app = getApp()
    const cur = app.refreshAuth()
    const detail = store.getBatch(this.data.batchId)
    if (!detail) {
      wx.showToast({ title: '批次不存在', icon: 'none' })
      return
    }
    const { batch, plot, farmer, records, reviews, siblingBatches } = detail

    batch.statusTag = batch.status === '种植中' ? 'tag-green' : 'tag-gray'
    batch.flagTag = batch.flag ? 'tag-warn' : ''

    const recordsView = records.map(r => ({ ...r, typeTag: this._typeTag(r.type) }))
    const reviewsView = reviews.map(r => ({
      ...r,
      starText: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)
    }))
    const siblingView = siblingBatches.map(b => ({
      ...b,
      statusTag: b.status === '种植中' ? 'tag-green' : 'tag-gray'
    }))

    if (farmer) {
      farmer.starText = '★'.repeat(farmer.star) + '☆'.repeat(5 - farmer.star)
      farmer.level = util.scoreLevel(farmer.creditScore)
    }

    // 成长周期时间轴（当前阶段高亮）
    const growthCycle = (batch.growthCycle || []).map(s => ({
      ...s,
      isCurrent: s.stage === batch.stage
    }))

    // 传感器环境曲线（空气温度 / 空气湿度 / 光照 / 土壤湿度；来自地块环境历史）
    const env = store.getPlotEnvHistory(batch.plotId, 30)
    const envSpark = {
      airTemp: chart.toSparkline(env, 'airTemp', 24),
      airHumidity: chart.toSparkline(env, 'airHumidity', 24),
      light: chart.toSparkline(env, 'light', 24),
      soilMoisture: chart.toSparkline(env, 'soilMoisture', 24)
    }
    // 最新环境快照 + 来源标注
    const latestEnv = env && env.length ? env[env.length - 1] : (batch.envSnapshot || null)
    if (latestEnv) latestEnv.sourceLabel = sensors.sourceLabel(latestEnv.source || 'demo')
    const latestEnvTag = latestEnv ? sensors.sourceTag(latestEnv.source || 'demo') : ''
    // OPI 有机生产评价 + 食品检测结果
    const opi = store.getBatchOPI(this.data.batchId)
    // 有机蔬菜生产合规核验（8 项强制要求；有机质/NPK/CEC 仅监测不判定）
    const organic = store.getOrganicCompliance(this.data.batchId)
    // 消费者口径风险提示（与采购商工作台独立）
    const risk = store.getBatchRisks(this.data.batchId)
    const inspections = store.listInspections(this.data.batchId)

    // 现场照片（对象结构，带定位；兼容字符串）
    const photos = (batch.photos || []).map(p => {
      if (typeof p === 'string') return { path: p, location: null, date: '' }
      return p
    })

    this.setData({
      batch, plot, farmer,
      records: recordsView,
      reviews: reviewsView,
      siblingBatches: siblingView,
      growthCycle,
      envSpark,
      latestEnv,
      latestEnvTag,
      opi,
      organic,
      risk,
      inspections,
      photos,
      aiReport: batch.aiReport || null,
      role: cur.role,
      canReview: auth.canReview(cur.role)
    })
  },

  _typeTag(type) {
    const map = { '播种': 'tag-green', '施肥': 'tag-gold', '灌溉': 'tag-green', '除草': 'tag-gray', '防治': 'tag-gold', '收获': 'tag-green' }
    return map[type] || 'tag-gray'
  },

  // 查看种植地点（内置地图查看坐标）
  viewLocation() {
    const loc = this.data.batch && this.data.batch.location
    if (!loc) { wx.showToast({ title: '该批次无定位信息', icon: 'none' }); return }
    wx.openLocation({
      latitude: loc.latitude,
      longitude: loc.longitude,
      name: '种植地点',
      address: loc.address || ''
    })
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: this.data.photos.map(p => p.path) })
  },

  goPlot() {
    if (this.data.plot) wx.navigateTo({ url: '/pages/plotDetail/plotDetail?id=' + this.data.plot.plotId })
  },
  goFarmer() {
    if (this.data.farmer) wx.navigateTo({ url: '/pages/farmerDetail/farmerDetail?id=' + this.data.farmer.farmerId })
  },
  goSibling(e) {
    const id = e.currentTarget.dataset.id
    wx.redirectTo({ url: '/pages/product/product?id=' + id })
  },
  goQr() {
    wx.navigateTo({ url: '/pages/qr/qr?id=' + this.data.batchId })
  },

  // 消费者反馈（数据返回农户）
  openReview() { this.setData({ showReviewSheet: true }) },
  closeReview() { this.setData({ showReviewSheet: false }) },
  onRating(e) { this.setData({ 'reviewForm.rating': +e.currentTarget.dataset.r }) },
  onContent(e) { this.setData({ 'reviewForm.content': e.detail.value }) },
  submitReview() {
    if (!this.data.batch) return
    if (!this.data.canReview) {
      wx.showToast({ title: '消费者才能反馈', icon: 'none' })
      return
    }
    const f = this.data.reviewForm
    if (!f.content.trim()) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    store.addReview({
      farmerId: this.data.batch.farmerId,
      batchId: this.data.batch.batchId,
      buyerName: '扫码消费者',
      rating: f.rating,
      content: f.content.trim()
    })
    wx.showToast({ title: '反馈已提交，将回传农户', icon: 'success' })
    this.setData({ showReviewSheet: false, 'reviewForm.content': '' })
    this.refresh()
  },

  onShareAppMessage() {
    return {
      title: '棚迹溯源 · ' + (this.data.batch ? this.data.batch.productName : ''),
      path: '/pages/product/product?id=' + this.data.batchId
    }
  }
})
