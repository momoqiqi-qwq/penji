// pages/productEdit/productEdit.js
// 农户上传农产品档案（仅农户身份可进入）
// 1) 选择地块 2) 填写农产品 + 成长周期 3) 定位种植地点（防伪）
// 4) 生长环境自动读取四类传感器数据（空气温度/空气湿度/光照/土壤湿度） 5) 拍照上传（照片附带定位）
// 提交后：AI 分析环境 → 自动生成农产品档案 → 生成绑定二维码
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const auth = require('../../utils/auth.js')
const sensors = require('../../utils/sensors.js')

const STAGES = ['播种期', '发芽期', '幼苗期', '生长期', '开花期', '结果期', '成熟期']
const CATEGORIES = ['茄果类', '瓜类', '叶菜类', '水果类', '粮食类', '根茎类']

Page({
  data: {
    farmerId: '',
    farmerName: '',
    plots: [],
    plotIndex: 0,
    productName: '',
    categories: CATEGORIES,
    categoryIndex: 0,
    stages: STAGES,
    stageIndex: 0,
    plantDate: '',
    expectedHarvest: '',
    seedSource: '',
    estYield: '',
    // 定位（必填，防伪）
    location: null,          // {latitude, longitude, address}
    locating: false,
    // 传感器环境（自动获取）
    envSnapshot: null,       // {airTemp, airHumidity, light, soilMoisture, source}
    envLoading: true,
    // 照片（附带定位）
    photos: [],
    submitting: false
  },

  onLoad() {
    const app = getApp()
    const cur = app.refreshAuth()
    if (!cur.isFarmer) {
      wx.showModal({
        title: '无权限',
        content: '只有农户身份可以上传农产品信息，消费者只能反馈。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/index/index' })
      })
      return
    }
    const farmer = store.listFarmers().find(f => f.farmerId === cur.farmerId) || {}
    const plots = store.listPlotsByFarmer(cur.farmerId)
    this.setData({
      farmerId: cur.farmerId,
      farmerName: farmer.name || '农户',
      plots,
      plantDate: util.formatDate(),
      expectedHarvest: util.formatDate(Date.now() + 90 * 86400000)
    })
    if (!plots.length) {
      wx.showModal({
        title: '还没有地块',
        content: '请先在「地块」页新建地块，再上传农产品档案。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    this._loadEnv(plots[0].plotId)
  },

  // 读取传感器最新四参数读数（自动，不可手填；真实数据，未接入时为演示数据）
  _loadEnv(plotId) {
    this.setData({ envLoading: true })
    sensors.fetchLatest(plotId).then(r => {
      this.setData({
        envSnapshot: {
          airTemp: r.airTemp, airHumidity: r.airHumidity, light: r.light, soilMoisture: r.soilMoisture,
          source: r.source, ts: r.ts, deviceId: r.deviceId || '',
          sourceLabel: r.sourceLabel,
          sourceTag: sensors.sourceTag(r.source)
        },
        envLoading: false
      })
    })
  },

  onPlotChange(e) {
    const idx = +e.detail.value
    this.setData({ plotIndex: idx })
    this._loadEnv(this.data.plots[idx].plotId)
  },

  onName(e) { this.setData({ productName: e.detail.value }) },
  onCategoryChange(e) { this.setData({ categoryIndex: +e.detail.value }) },
  onStageChange(e) { this.setData({ stageIndex: +e.detail.value }) },
  onPlantDate(e) { this.setData({ plantDate: e.detail.value }) },
  onExpectedHarvest(e) { this.setData({ expectedHarvest: e.detail.value }) },
  onSeedSource(e) { this.setData({ seedSource: e.detail.value }) },
  onEstYield(e) { this.setData({ estYield: e.detail.value }) },

  // 定位种植地点（防伪核心）
  chooseLocation() {
    this.setData({ locating: true })
    const fallback = () => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          this.setData({
            locating: false,
            location: {
              latitude: +res.latitude.toFixed(6),
              longitude: +res.longitude.toFixed(6),
              address: 'GPS 定位（未选点）'
            }
          })
        },
        fail: () => {
          this.setData({ locating: false })
          wx.showModal({
            title: '定位失败',
            content: '上传农产品必须获取地理位置以保障真实性。请在设置中开启定位权限后重试。',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting() }
          })
        }
      })
    }
    if (wx.chooseLocation) {
      wx.chooseLocation({
        success: (res) => {
          this.setData({
            locating: false,
            location: {
              latitude: +res.latitude.toFixed(6),
              longitude: +res.longitude.toFixed(6),
              address: res.address || res.name || '已选位置'
            }
          })
        },
        fail: fallback
      })
    } else {
      fallback()
    }
  },

  // 拍照/选图上传
  choosePhoto() {
    const max = 6
    const remain = max - this.data.photos.length
    if (remain <= 0) { wx.showToast({ title: '最多 6 张', icon: 'none' }); return }
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],   // 拍照优先
        success: (res) => this._appendPhotos(res.tempFiles.map(f => f.tempFilePath))
      })
    } else {
      wx.chooseImage({
        count: remain,
        sourceType: ['camera', 'album'],
        success: (res) => this._appendPhotos(res.tempFilePaths)
      })
    }
  },

  _appendPhotos(paths) {
    if (!paths || !paths.length) return
    // 每张照片附带当前定位 + 时间（防伪）
    const loc = this.data.location
    if (!loc) {
      wx.showToast({ title: '请先定位种植地点', icon: 'none' })
      return
    }
    const items = paths.map(p => ({
      path: p,
      location: { ...loc },
      date: util.formatDateTime()
    }))
    this.setData({ photos: this.data.photos.concat(items) })
  },

  deletePhoto(e) {
    const idx = +e.currentTarget.dataset.idx
    const photos = this.data.photos.slice()
    photos.splice(idx, 1)
    this.setData({ photos })
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: this.data.photos.map(p => p.path) })
  },

  submit() {
    const d = this.data
    if (d.submitting) return
    if (!d.productName.trim()) { wx.showToast({ title: '请填写农产品名称', icon: 'none' }); return }
    if (!d.location) { wx.showToast({ title: '请先定位种植地点（防伪）', icon: 'none' }); return }
    if (!d.photos.length) { wx.showToast({ title: '请至少拍摄 1 张现场照片', icon: 'none' }); return }
    if (!d.envSnapshot) { wx.showToast({ title: '传感器数据获取中，请稍候', icon: 'none' }); return }

    const plot = d.plots[d.plotIndex]
    const category = d.categories[d.categoryIndex]
    const stage = d.stages[d.stageIndex]

    // 成长周期时间轴（自动按播种日期生成各阶段日期）
    const cycle = this._buildCycle(d.plantDate, d.expectedHarvest, stage)

    d.submitting = true
    const batch = store.addProductBatch({
      plotId: plot.plotId,
      productName: d.productName.trim(),
      category,
      stage,
      plantDate: d.plantDate,
      expectedHarvest: d.expectedHarvest,
      growthCycle: cycle,
      location: d.location,
      photos: d.photos,
      envSnapshot: d.envSnapshot,
      seedSource: d.seedSource.trim(),
      estYield: d.estYield.trim()
    }, d.farmerId)

    d.submitting = false
    if (!batch) {
      wx.showToast({ title: '建档失败（越权）', icon: 'none' })
      return
    }
    wx.showModal({
      title: '档案已自动生成',
      content: `AI 环境评分 ${batch.aiReport.score} 分。二维码 ${batch.batchId} 已绑定农产品，消费者扫码即可查看真实生长过程。`,
      showCancel: false,
      success: () => wx.redirectTo({ url: '/pages/qr/qr?id=' + batch.batchId })
    })
  },

  // 生成成长周期阶段日期（按播种→预计收获线性分布）
  _buildCycle(plantDate, harvestDate, currentStage) {
    const stageNames = ['播种期', '发芽期', '幼苗期', '生长期', '开花期', '结果期', '成熟期']
    const curIdx = Math.max(0, stageNames.indexOf(currentStage))
    const stages = stageNames.slice(0, curIdx + 1)
    const start = util.parseDate(plantDate)
    const end = harvestDate ? util.parseDate(harvestDate) : Date.now()
    const span = Math.max(1, end - start)
    const n = stages.length
    return stages.map((s, i) => ({
      stage: s,
      date: util.formatDate(start + (i === n - 1 ? span : span * i / n)),
      desc: s === currentStage ? '当前阶段' : ''
    }))
  }
})
