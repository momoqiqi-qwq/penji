// pages/diagnose/diagnose.js
// AI 农诊断：农户描述种植问题 → 结合田间传感器读数 → utils/diagnose.js 本地规则库
// 给出病因分析、立即处置、有机防治与预防措施（离线计算，秒级返回）
const diag = require('../../utils/diagnose.js')
const sensors = require('../../utils/sensors.js')
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')

const MAX_TEXT = 300
const MAX_HISTORY = 5

Page({
  data: {
    crop: '',            // 作物/农产品名称
    text: '',            // 问题描述
    textLen: 0,
    maxText: MAX_TEXT,
    result: null,
    envHint: '',         // 环境提示（传感器读数）
    loading: false,
    history: []          // 本次会话诊断记录
  },

  onLoad(query) {
    const app = getApp()
    const cur = app.refreshAuth()
    if (!cur.isFarmer) {
      wx.showModal({
        title: '无权限',
        content: 'AI 农诊断仅对农户开放。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/index/index' })
      })
      return
    }
    if (query.crop) this.setData({ crop: decodeURIComponent(query.crop) })

    // 结合当前地块传感器环境（真实/演示）
    const plots = store.listPlotsByFarmer(cur.farmerId)
    if (!plots.length) return
    sensors.fetchLatest(plots[0].plotId).then((r) => {
      // 保留原始读数：诊断引擎用它判断症状与「该病高发区间」是否吻合
      this._env = {
        airTemp: r.airTemp,
        airHumidity: r.airHumidity,
        light: r.light,
        soilMoisture: r.soilMoisture
      }
      this.setData({
        envHint: `当前田间传感器读数：空气温度 ${r.airTemp}℃ / 空气湿度 ${r.airHumidity}% / 光照 ${r.light}% / 土壤湿度 ${r.soilMoisture}%（${sensors.sourceLabel(r.source)}）`
      })
    }).catch(() => {})
  },

  onCrop(e) { this.setData({ crop: e.detail.value }) },

  onText(e) {
    const text = e.detail.value || ''
    this.setData({ text, textLen: text.length })
  },

  // 点选「还可以补充」的追问，直接拼进描述，再次诊断会更准
  useAsk(e) {
    const q = e.currentTarget.dataset.q || ''
    if (!q || this.data.text.indexOf(q) >= 0) return
    const text = (this.data.text ? this.data.text + '；' + q : q).slice(0, MAX_TEXT)
    this.setData({ text, textLen: text.length })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  submit() {
    const d = this.data
    if (!String(d.text).trim()) {
      wx.showToast({ title: '请描述问题症状', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    const result = diag.diagnose({ crop: d.crop, text: d.text, env: this._env || null })
    result.envHint = d.envHint
    this._done(result)
  },

  _done(result) {
    const item = {
      id: (result.id || 'generic') + '_' + Date.now(),
      title: result.title,
      text: this.data.text,
      tsText: util.formatDateTime(),
      severity: result.severity,
      severityCls: result.severityCls,
      result
    }
    this.setData({
      loading: false,
      result,
      history: [item].concat(this.data.history).slice(0, MAX_HISTORY)
    })
    wx.nextTick(() => wx.pageScrollTo({ selector: '#result-anchor', duration: 250 }))
  },

  // 点历史记录回看当时的完整结论
  showHistoryItem(e) {
    const id = e.currentTarget.dataset.id
    const hit = this.data.history.find((h) => h.id === id)
    if (!hit || !hit.result) return
    this.setData({ result: hit.result })
    wx.nextTick(() => wx.pageScrollTo({ selector: '#result-anchor', duration: 250 }))
  },

  clearHistory() {
    const n = this.data.history.length
    if (!n) return
    wx.showModal({
      title: '清空诊断记录',
      content: `本次会话的 ${n} 条记录将被清除。`,
      success: (r) => { if (r.confirm) this.setData({ history: [] }) }
    })
  }
})
