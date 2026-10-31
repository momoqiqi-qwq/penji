// pages/scan/scan.js
// 扫码溯源：扫描农产品二维码（内容 PENGJI|批次号）→ 查看真实生长过程 → 消费者反馈
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')
const tabbar = require('../../utils/tabbar.js')

Page({
  data: {
    batches: [],
    code: '',
    recent: [],
    role: '',
    isFarmer: false,
    myBatches: [],
    recentExpanded: true,
    batchesExpanded: true
  },

  onShow() {
    // 按当前路由自动点亮底部 tab（= 扫一扫）
    tabbar.sync(this)
    this.refresh()
  },

  refresh() {
    const cur = auth.current()
    const batches = store.listBatches()
    this.setData({
      batches,
      role: cur.role,
      isFarmer: cur.isFarmer,
      // 农户：自己名下批次的二维码入口
      myBatches: cur.isFarmer ? batches.filter(b => b.farmerId === cur.farmerId) : [],
      // 最近浏览（演示：取前 3 个已收获批次）
      recent: batches.filter(b => b.status === '已收获').slice(0, 3)
    })
  },

  toggleRecent() {
    this.setData({ recentExpanded: !this.data.recentExpanded })
  },

  toggleBatches() {
    this.setData({ batchesExpanded: !this.data.batchesExpanded })
  },

  onInput(e) { this.setData({ code: e.detail.value }) },

  // 真机扫码
  doScan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        this._trace(this._parseCode(res.result || ''))
      },
      fail: () => {
        wx.showToast({ title: '扫码取消或失败，可用下方模拟', icon: 'none' })
      }
    })
  },

  // 解析二维码内容：支持 PENGJI|B-001 / 纯批次号 / 页面链接
  _parseCode(raw) {
    const s = String(raw).trim()
    const m = s.match(/PENGJI\|?([A-Za-z0-9-]+)/)
    if (m) return m[1]
    const m2 = s.match(/id=([A-Za-z0-9-]+)/)   // 兼容分享链接
    if (m2) return m2[1]
    return s
  },

  // 模拟扫码：随机一个批次
  mockScan() {
    const list = this.data.batches
    if (!list.length) return
    const b = list[Math.floor(Math.random() * list.length)]
    wx.showModal({
      title: '模拟扫码',
      content: '已模拟扫到溯源码：' + b.batchId + '（' + b.productName + '）',
      showCancel: false,
      success: () => this._trace(b.batchId)
    })
  },

  // 输入码溯源
  traceInput() {
    if (!this.data.code.trim()) {
      wx.showToast({ title: '请输入溯源码', icon: 'none' })
      return
    }
    this._trace(this._parseCode(this.data.code.trim()))
  },

  goBatch(e) {
    this._trace(e.currentTarget.dataset.id)
  },

  // 农户：查看自己批次的二维码
  goQr(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/qr/qr?id=' + id })
  },

  _trace(code) {
    const detail = store.traceByCode(code)
    if (!detail) {
      // 找不到该批次时，先尝试 seed 数据里预设的任意一个演示批次
      const presetBatches = ['B-001', 'B-002', 'B-003', 'B-004', 'B-008']
      const fallback = presetBatches.find(id => store.traceByCode(id))
      const content = fallback
        ? '溯源码 ' + code + ' 未匹配到任何批次档案（跨设备 Storage 无法共享，请在上传设备上扫码）。是否改用预设演示批次 ' + fallback + ' 查看完整溯源链路？'
        : '溯源码 ' + code + ' 未匹配到任何批次档案。请确保在此设备上已上传档案后再扫码。'
      wx.showModal({
        title: '未找到档案',
        content,
        confirmText: fallback ? '查看演示批次' : '确定',
        success: (r) => {
          if (r.confirm && fallback) this._openTrace(fallback)
        }
      })
      return
    }
    this._openTrace(code)
  },

  _openTrace(code) {
    const app = getApp()
    const cur = app.refreshAuth ? app.refreshAuth() : { isBuyer: false }
    if (cur.isBuyer) {
      wx.navigateTo({ url: '/pages/inspect/inspect?id=' + code })
    } else {
      wx.navigateTo({ url: '/pages/product/product?id=' + code })
    }
  }
})
