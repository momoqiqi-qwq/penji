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
    envLine: null,          // 环境曲线数据（toLinechart 输出，Canvas 2D 画）
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
    const envLine = {
      airTemp: chart.toLinechart(env, 'airTemp', 24),
      airHumidity: chart.toLinechart(env, 'airHumidity', 24),
      light: chart.toLinechart(env, 'light', 24),
      soilMoisture: chart.toLinechart(env, 'soilMoisture', 24)
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
      envLine,
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
    }, () => this._drawAllLinecharts())
  },

  // ======== Canvas 2D 折线图绘制 ========
  // 配色沿用这一页原本条形图的四色，换画法不换语义
  _drawAllLinecharts() {
    if (!this.data.envLine) return
    const themeColors = {
      airTemp:      { stroke: '#C2793A', fill: 'rgba(194,121,58,0.18)' },
      airHumidity:  { stroke: '#4A7FA8', fill: 'rgba(74,127,168,0.18)' },
      light:        { stroke: '#B9892F', fill: 'rgba(185,137,47,0.18)' },
      soilMoisture: { stroke: '#3E7A5C', fill: 'rgba(62,122,92,0.18)' }
    }
    const fields = ['airTemp', 'airHumidity', 'light', 'soilMoisture']
    fields.forEach(f => {
      const data = this.data.envLine[f]
      if (data && data.points && data.points.length) {
        this._drawLinechart('canvas-' + f, data, themeColors[f])
      }
    })
  },

  _drawLinechart(canvasId, data, colors) {
    if (!data || !data.points || data.points.length < 1) return
    const query = wx.createSelectorQuery()
    query.select('#' + canvasId)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const w = res[0].width
        const h = res[0].height
        // 高清屏适配
        const dpr = wx.getSystemInfoSync().pixelRatio || 2
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)

        ctx.clearRect(0, 0, w, h)
        const pad = { top: 6, right: 6, bottom: 6, left: 6 }
        const cw = w - pad.left - pad.right
        const ch = h - pad.top - pad.bottom
        const pts = data.points

        // 坐标映射：x→[0,cw], y→[0,ch]
        const mapPt = (p) => ({
          x: pad.left + p.x * cw,
          y: pad.top + p.y * ch
        })

        // 渐变填充（折线下方）
        if (pts.length >= 2) {
          ctx.beginPath()
          const first = mapPt(pts[0])
          ctx.moveTo(first.x, pad.top + ch)
          ctx.lineTo(first.x, first.y)
          for (let i = 1; i < pts.length; i++) {
            const cur = mapPt(pts[i])
            const prev = mapPt(pts[i - 1])
            const cx = (prev.x + cur.x) / 2
            ctx.quadraticCurveTo(prev.x, prev.y, cx, (prev.y + cur.y) / 2)
          }
          const last = mapPt(pts[pts.length - 1])
          ctx.lineTo(last.x, last.y)
          ctx.lineTo(last.x, pad.top + ch)
          ctx.closePath()
          const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch)
          grad.addColorStop(0, colors.fill)
          grad.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = grad
          ctx.fill()
        }

        // 折线（二次贝塞尔平滑）
        ctx.beginPath()
        if (pts.length === 1) {
          const p = mapPt(pts[0])
          ctx.moveTo(p.x, p.y)
        } else {
          for (let i = 0; i < pts.length; i++) {
            const cur = mapPt(pts[i])
            if (i === 0) {
              ctx.moveTo(cur.x, cur.y)
            } else {
              const prev = mapPt(pts[i - 1])
              const cpx = prev.x + (cur.x - prev.x) / 2
              ctx.quadraticCurveTo(prev.x, prev.y, cpx, (prev.y + cur.y) / 2)
            }
          }
        }
        ctx.strokeStyle = colors.stroke
        ctx.lineWidth = 2.2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()

        // 末点高亮
        if (pts.length >= 1) {
          const last = mapPt(pts[pts.length - 1])
          ctx.beginPath()
          ctx.arc(last.x, last.y, 3.8, 0, Math.PI * 2)
          ctx.fillStyle = colors.stroke
          ctx.fill()
          ctx.beginPath()
          ctx.arc(last.x, last.y, 1.6, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
        }
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
