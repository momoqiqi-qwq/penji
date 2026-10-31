// pages/plotEdit/plotEdit.js
// 新增/编辑地块（仅农户身份）
// 含：种植地点 GPS 定位、照片上传（附带定位）
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')
const util = require('../../utils/util.js')

Page({
  data: {
    mode: 'add',           // 'add' | 'edit'
    plotId: '',
    farmerId: '',
    farmerName: '',
    name: '',
    village: '',
    area: '',
    soilType: '',
    rotation: '',
    photos: [],
    location: null,        // 种植地点 {latitude, longitude, address}
    soilOptions: ['黄壤土', '沙壤土', '黏土', '果园壤土', '沙土', '壤土', '其它'],
    soilIndex: 0
  },

  onLoad(query) {
    const app = getApp()
    const cur = app.refreshAuth()
    if (!cur.isFarmer) {
      wx.showModal({
        title: '无权限',
        content: '只有农户身份可以管理地块。请重新进入并选择农户身份。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/index/index' })
      })
      return
    }
    const farmerId = cur.farmerId
    const farmers = store.listFarmers()
    const farmerName = (farmers.find(f => f.farmerId === farmerId) || {}).name || '未知'

    // 编辑模式：从 store 读取已存在地块
    if (query.id) {
      const detail = store.getPlot(query.id)
      if (!detail || detail.plot.farmerId !== farmerId) {
        wx.showModal({
          title: '无权限',
          content: '该地块不属于当前农户，无法编辑。',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      const p = detail.plot
      const soilIndex = Math.max(0, this.data.soilOptions.indexOf(p.soilType))
      this.setData({
        mode: 'edit',
        plotId: p.plotId,
        farmerId,
        farmerName,
        name: p.name,
        village: p.village,
        area: String(p.area),
        soilType: p.soilType,
        soilIndex,
        rotation: p.rotation || '',
        photos: p.photos || [],
        location: p.location || null
      })
      wx.setNavigationBarTitle({ title: '编辑地块' })
    } else {
      this.setData({ mode: 'add', farmerId, farmerName })
      wx.setNavigationBarTitle({ title: '新增地块' })
    }
  },

  onName(e) { this.setData({ name: e.detail.value }) },
  onVillage(e) { this.setData({ village: e.detail.value }) },
  onArea(e) { this.setData({ area: e.detail.value }) },
  onRotation(e) { this.setData({ rotation: e.detail.value }) },
  // 有机转换期起始日期（一年生蔬菜转换期不少于 24 个月，多年生作物参考 36 个月）
  onOrganicSince(e) { this.setData({ organicSince: e.detail.value }) },
  // 隔离缓冲带
  onBufferChange(e) { this.setData({ bufferHas: !!e.detail.value }) },
  onBufferDesc(e) { this.setData({ bufferDesc: e.detail.value }) },
  onSoilChange(e) {
    const idx = +e.detail.value
    this.setData({ soilIndex: idx, soilType: this.data.soilOptions[idx] })
  },

  // 种植地点定位
  chooseLocation() {
    const fallback = () => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          this.setData({
            location: {
              latitude: +res.latitude.toFixed(6),
              longitude: +res.longitude.toFixed(6),
              address: 'GPS 定位（未选点）'
            }
          })
        },
        fail: () => {
          wx.showModal({
            title: '定位失败',
            content: '请在设置中开启定位权限后重试。',
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

  // 上传照片（chooseMedia 优先，老版本回退 chooseImage），附带定位
  choosePhoto() {
    const max = 6
    const remain = max - this.data.photos.length
    if (remain <= 0) {
      wx.showToast({ title: '最多 6 张', icon: 'none' })
      return
    }
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
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
    const { mode, plotId, farmerId, name, village, area, soilType, rotation, photos, location,
      organicSince, bufferHas, bufferDesc } = this.data
    if (!name.trim()) { wx.showToast({ title: '请填写地块名', icon: 'none' }); return }
    if (!area) { wx.showToast({ title: '请填写规模面积', icon: 'none' }); return }
    if (!location) { wx.showToast({ title: '请定位种植地点（防伪）', icon: 'none' }); return }
    const payload = {
      name: name.trim(),
      village: village.trim(),
      area: Number(area),
      soilType,
      rotation: rotation.trim(),
      photos,
      location,
      // 有机管理：转换期起始日期 + 隔离缓冲带
      organicSince: organicSince || '',
      bufferZone: { has: !!bufferHas, desc: bufferHas ? bufferDesc.trim() : '' }
    }
    if (mode === 'add') {
      const plot = store.addPlot(payload, farmerId)
      wx.showToast({ title: '地块已建档', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/plotDetail/plotDetail?id=' + plot.plotId }), 800)
    } else {
      const plot = store.updatePlot(plotId, payload, farmerId)
      if (!plot) {
        wx.showToast({ title: '保存失败（越权）', icon: 'none' })
        return
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    }
  }
})
