// pages/addRecord/addRecord.js
// 新增农事记录（仅农户身份，记录自动归属当前农户）
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const auth = require('../../utils/auth.js')
const sensors = require('../../utils/sensors.js')

Page({
  data: {
    farmerId: '',
    farmerName: '',
    plots: [],       // 仅当前农户自己的地块
    batches: [],
    plotIndex: 0,
    batchIndex: 0,
    typeOptions: ['播种', '施肥', '灌溉', '除草', '防治', '收获'],
    typeIndex: 0,
    date: '',
    content: '',
    cost: ''
  },

  onLoad(query) {
    const app = getApp()
    const cur = app.refreshAuth()
    if (!cur.isFarmer) {
      wx.showModal({
        title: '无权限',
        content: '农事记录只有农户身份可以添加，消费者只能反馈。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    const farmerId = cur.farmerId
    const farmer = store.listFarmers().find(f => f.farmerId === farmerId) || {}
    // 仅本人地块
    const plots = store.listPlotsByFarmer(farmerId)
    let plotIndex = 0
    let batches = []
    if (query.plotId) {
      plotIndex = Math.max(0, plots.findIndex(p => p.plotId === query.plotId))
    }
    if (plots.length) {
      batches = (store.getPlot(plots[plotIndex].plotId) || {}).batches || []
    }
    this.setData({
      farmerId,
      farmerName: farmer.name || '农户',
      plots,
      batches,
      plotIndex,
      batchIndex: 0,
      typeIndex: 0,
      date: util.formatDate()
    })
  },

  onPlotChange(e) {
    const idx = +e.detail.value
    const plotId = this.data.plots[idx].plotId
    const detail = store.getPlot(plotId)
    const batches = detail ? detail.batches : []
    this.setData({ plotIndex: idx, batchIndex: 0, batches })
  },

  onBatchChange(e) {
    this.setData({ batchIndex: +e.detail.value })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: +e.detail.value })
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value })
  },

  onContent(e) { this.setData({ content: e.detail.value }) },
  onCost(e) { this.setData({ cost: e.detail.value }) },

  async submit() {
    const { plots, batches, plotIndex, batchIndex, typeOptions, typeIndex, date, content, cost, farmerId } = this.data
    if (!plots.length) {
      wx.showToast({ title: '请先创建自己的地块', icon: 'none' })
      return
    }
    if (!batches.length) {
      wx.showToast({ title: '该地块暂无批次，请先上传农产品档案', icon: 'none' })
      return
    }
    if (!content.trim()) {
      wx.showToast({ title: '请填写记录内容', icon: 'none' })
      return
    }
    const plot = plots[plotIndex]
    const batch = batches[batchIndex]
    // 抓取当时刻传感器快照（云端/实时真实数据，未接入时为演示数据）
    wx.showLoading({ title: '读取传感器...' })
    let envSnapshot = null
    try {
      const r = await sensors.fetchLatest(plot.plotId)
      envSnapshot = {
        airTemp: r.airTemp, airHumidity: r.airHumidity, light: r.light, soilMoisture: r.soilMoisture,
        source: r.source, ts: r.ts, deviceId: r.deviceId || ''
      }
      // 真实数据（云端/实时）同步归档到地块环境历史
      if (r.source === 'cloud' || r.source === 'live') {
        store.addSensorReading(plot.plotId, r)
      }
    } catch (e) {
      envSnapshot = null
    }
    wx.hideLoading()
    store.addRecord({
      plotId: plot.plotId,
      batchId: batch.batchId,
      farmerId,
      type: typeOptions[typeIndex],
      date,
      content: content.trim(),
      cost: Number(cost) || 0,
      envSnapshot
    })
    wx.showToast({ title: '已记录，环境快照已绑定', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 800)
  }
})
