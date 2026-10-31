// pages/plotDetail/plotDetail.js
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const chart = require('../../utils/chart.js')
const auth = require('../../utils/auth.js')
const sensors = require('../../utils/sensors.js')

Page({
  data: {
    plotId: '',
    plot: null,
    farmer: null,
    batches: [],
    records: [],
    envLine: null,          // 折线图数据（toLinechart 输出）
    envHistoryTag: { cls: 'tag-gray', text: '演示模拟数据' },
    envHistoryDays: 0,
    envHistoryTip: '',
    yearGroups: [],
    recordCount: 0,
    // 身份与权限
    role: 'consumer',
    farmerId: '',
    canEdit: false,
    batchesExpanded: true,
    recordsExpanded: true,
  },

  toggleBatches() {
    this.setData({ batchesExpanded: !this.data.batchesExpanded })
  },

  toggleRecords() {
    this.setData({ recordsExpanded: !this.data.recordsExpanded })
  },

  onLoad(query) {
    this.setData({ plotId: query.id })
    this.refresh()
  },

  onShow() {
    if (!this.data.plotId) return
    this.refresh()
    this._loadRealHistory()
  },

  // 拉真实环境历史。优先按天聚合（90 天档案曲线）；
  // 刚接入那天聚合表通常只有 1 个点，图上只剩一根柱子看不出趋势，
  // 这种情况自动降级成原始读数（最近 30 条），保证曲线"有线可看"。
  // 只有真实来源（cloud / live）才允许覆盖 refresh() 填的本地演示曲线——
  // 演示数据标成"真实数据"是答辩和溯源场景的大忌。
  _loadRealHistory() {
    sensors.fetchHistory(this.data.plotId, 90, true).then(res => {
      if (!res || res.source === 'demo') return
      if (res.list.length >= 2) return this._renderRealHistory(res.list, true)
      return sensors.fetchHistory(this.data.plotId, 30, false).then(raw => {
        if (raw && raw.source !== 'demo' && raw.list.length >= 2) {
          this._renderRealHistory(raw.list, false)
        }
      })
    }).catch(() => {})
  },

  _renderRealHistory(list, isDaily) {
    this.setData({
      envLine: {
        airTemp: chart.toLinechart(list, 'airTemp', 30),
        airHumidity: chart.toLinechart(list, 'airHumidity', 30),
        light: chart.toLinechart(list, 'light', 30),
        soilMoisture: chart.toLinechart(list, 'soilMoisture', 30)
      },
      envHistoryTag: { cls: 'tag-green', text: '真实数据（田间传感器）' },
      envHistoryDays: isDaily ? list.length : 0,
      envHistoryTip: isDaily
        ? ('已接入真实传感器数据（按天聚合，覆盖 ' + list.length + ' 天）')
        : ('已接入真实传感器数据（今日实时读数 ' + list.length + ' 条，满一天后自动切换为按天聚合）')
    }, () => this._drawAllLinecharts())
  },

  refresh() {
    const app = getApp()
    const cur = app.refreshAuth()
    const detail = store.getPlot(this.data.plotId)
    if (!detail) {
      wx.showToast({ title: '地块不存在', icon: 'none' })
      return
    }
    const { plot, farmer, batches, records, envRecent } = detail

    // 四参数环境曲线：空气温度 / 空气湿度 / 光照 / 土壤湿度
    const envLine = {
      airTemp: chart.toLinechart(envRecent, 'airTemp', 30),
      airHumidity: chart.toLinechart(envRecent, 'airHumidity', 30),
      light: chart.toLinechart(envRecent, 'light', 30),
      soilMoisture: chart.toLinechart(envRecent, 'soilMoisture', 30)
    }
    const latestEnv = envRecent && envRecent.length ? envRecent[envRecent.length - 1] : null
    if (latestEnv) latestEnv.sourceLabel = sensors.sourceLabel(latestEnv.source || 'demo')
    const latestEnvTag = latestEnv ? sensors.sourceTag(latestEnv.source || 'demo') : ''

    const yearMap = {}
    batches.forEach(b => {
      const y = b.plantDate.slice(0, 4)
      if (!yearMap[y]) yearMap[y] = []
      yearMap[y].push(b)
    })
    const yearGroups = Object.keys(yearMap).sort((a, b) => b - a).map(y => ({
      year: y,
      list: yearMap[y].map(b => ({
        ...b,
        statusTag: b.status === '种植中' ? 'tag-green' : 'tag-gray',
        recordCount: records.filter(r => r.batchId === b.batchId).length
      }))
    }))

    const batchMap = {}
    batches.forEach(b => batchMap[b.batchId] = b.productName)
    const recordsView = records.map(r => ({
      ...r,
      productName: batchMap[r.batchId] || '-',
      typeTag: this._typeTag(r.type),
      timeAgo: util.timeAgo(util.parseDate(r.date)),
      envTag: r.envSnapshot ? sensors.sourceTag(r.envSnapshot.source || 'demo') : '',
      envLabel: r.envSnapshot ? sensors.sourceLabel(r.envSnapshot.source || 'demo') : ''
    }))

    if (farmer) {
      farmer.starText = '★'.repeat(farmer.star) + '☆'.repeat(5 - farmer.star)
      farmer.level = util.scoreLevel(farmer.creditScore)
    }

    // 权限：农户身份 + 该地块归属本人
    const canEdit = cur.isFarmer && plot.farmerId === cur.farmerId

    this.setData({
      plot, farmer,
      batches,
      records: recordsView,
      recordCount: records.length,
      envLine,
      latestEnv,
      latestEnvTag,
      yearGroups,
      role: cur.role,
      farmerId: cur.farmerId,
      canEdit
    }, () => this._drawAllLinecharts())
  },

  _typeTag(type) {
    const map = {
      '播种': 'tag-green', '施肥': 'tag-gold', '灌溉': 'tag-green',
      '除草': 'tag-gray', '防治': 'tag-gold', '收获': 'tag-green'
    }
    return map[type] || 'tag-gray'
  },

  // ======== Canvas 2D 折线图绘制 ========
  _drawAllLinecharts() {
    if (!this.data.envLine) return
    const themeColors = {
      airTemp:     { stroke: '#D97706', fill: 'rgba(217,119,6,0.18)' },    // 金
      airHumidity: { stroke: '#0891B2', fill: 'rgba(8,145,178,0.18)' },     // 青
      light:       { stroke: '#F59E0B', fill: 'rgba(245,158,11,0.18)' },    // 黄
      soilMoisture:{ stroke: '#16A34A', fill: 'rgba(22,163,74,0.18)' }      // 绿
    }
    const fields = ['airTemp', 'airHumidity', 'light', 'soilMoisture']
    fields.forEach(f => {
      const canvasId = 'canvas-' + f
      const data = this.data.envLine[f]
      const colors = themeColors[f]
      if (data) this._drawLinechart(canvasId, data, colors)
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
          ctx.moveTo(first.x, pad.top + ch)   // 左下起点
          ctx.lineTo(first.x, first.y)
          for (let i = 1; i < pts.length; i++) {
            const cur = mapPt(pts[i])
            const prev = mapPt(pts[i - 1])
            const cx = (prev.x + cur.x) / 2
            ctx.quadraticCurveTo(prev.x, prev.y, cx, (prev.y + cur.y) / 2)
          }
          const last = mapPt(pts[pts.length - 1])
          ctx.lineTo(last.x, last.y)
          ctx.lineTo(last.x, pad.top + ch)   // 右下终点
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

  goFarmer() {
    if (this.data.farmer) {
      wx.navigateTo({ url: '/pages/farmerDetail/farmerDetail?id=' + this.data.farmer.farmerId })
    }
  },

  goBatch(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/product/product?id=' + id })
  },

  goAddRecord() {
    if (this.data.plot) {
      wx.navigateTo({ url: '/pages/addRecord/addRecord?plotId=' + this.data.plotId + '&farmerId=' + this.data.plot.farmerId })
    }
  },

  // 农户身份：跳转编辑地块
  goEdit() {
    if (!this.data.canEdit) {
      wx.showToast({ title: '仅本人可编辑', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/plotEdit/plotEdit?id=' + this.data.plotId })
  },

  // 农户身份：上传地块照片（增量，强制附带 GPS 定位防伪）
  uploadPhoto() {
    if (!this.data.canEdit) {
      wx.showToast({ title: '仅本人可上传', icon: 'none' })
      return
    }
    const max = 6
    const photos = this.data.plot.photos || []
    if (max - photos.length <= 0) {
      wx.showToast({ title: '最多 6 张', icon: 'none' })
      return
    }
    const choose = wx.chooseMedia
      ? wx.chooseMedia.bind(wx)
      : ((opts) => wx.chooseImage({ ...opts, success: (r) => opts.success({ tempFiles: (r.tempFilePaths || []).map(p => ({ tempFilePath: p })) }) }))
    choose({
      count: max - photos.length,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const paths = (res.tempFiles || []).map(f => f.tempFilePath)
        if (!paths.length) return
        // 获取当前定位（防伪）
        wx.getLocation({
          type: 'gcj02',
          success: (loc) => {
            const items = paths.map(p => ({
              path: p,
              location: { latitude: +loc.latitude.toFixed(6), longitude: +loc.longitude.toFixed(6) },
              date: util.formatDateTime()
            }))
            store.appendPlotPhotos(this.data.plotId, items, this.data.farmerId)
            wx.showToast({ title: '已上传（含定位）', icon: 'success' })
            this.refresh()
          },
          fail: () => {
            wx.showModal({
              title: '需要定位',
              content: '上传照片必须获取地理位置以保障真实性，请在设置中开启定位权限。',
              confirmText: '去设置',
              success: (r) => { if (r.confirm) wx.openSetting() }
            })
          }
        })
      }
    })
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: (this.data.plot.photos || []).map(p => typeof p === 'string' ? p : p.path) })
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  }
})
