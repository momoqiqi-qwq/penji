// pages/simulate/simulate.js
// 农田实况：空气温度 / 空气湿度 / 光照 / 土壤湿度 四类传感器数据
// 数据来源：实时直连 MQTT / 云端 CloudBase / 演示模拟
//
// 刷新机制：
//   - 实时模式：小程序直连 broker，设备每发一帧（约 1.8 秒）页面即更新
//   - 云端模式：用云开发 watch 实时监听 readings 集合，数据库一写入页面立刻更新
//     watch 不可用（如集合读权限未放开）时自动退回 1 秒轮询
//   - 手动刷新：用户点击"立即刷新"，立即拉取一次并重建监听
const sensors = require('../../utils/sensors.js')
const ai = require('../../utils/ai.js')
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const tabbar = require('../../utils/tabbar.js')

const AUTO_REFRESH_INTERVAL = 1000

Page({
  data: {
    plots: [],
    plotIndex: 0,
    current: null,
    // 四参数读数
    airTemp: '--',
    airHumidity: '--',
    light: '--',
    soilMoisture: '--',
    source: 'demo',
    sourceLabel: sensors.sourceLabel('demo'),
    sourceTag: sensors.sourceTag('demo'),
    updateTime: '',
    deviceId: '',
    // AI 分析
    aiReport: null,
    // 数据来源配置
    sourceMode: 'auto',
    modeDesc: '',
    cloudEnv: '',
    // 自动刷新状态（供 UI 显示）
    autoRefresh: true,
    lastRefreshTs: 0
  },

  // 定时器句柄
  _timer: null,
  // 云端实时监听句柄（watch 生效时不再轮询）
  _watcher: null,
  // 拉取节流标志：上一次请求未返回时跳过，避免请求堆积冲突
  _fetching: false,

  onLoad() {
    const mode = sensors.getMode()
    this.setData({
      plots: store.listPlots(),
      sourceMode: mode,
      modeDesc: sensors.modeDesc(mode),
      cloudEnv: sensors.cloudEnv || ''
    })
    this._refresh()
    this._startWatch()
  },

  onShow() {
    // 按当前路由自动点亮底部 tab（= 实况），修复「实况页却亮着首页」
    tabbar.sync(this)
    // 页面从后台回到前台：恢复实时监听（或轮询）
    this._refresh()
    this._startWatch()
  },

  onHide() {
    // 页面隐藏时暂停监听/轮询，避免后台无意义请求
    this._stopWatch()
    this._stopTimer()
  },

  onUnload() {
    this._stopWatch()
    this._stopTimer()
  },

  // 启动自动刷新定时器（先清除旧的，避免重复）
  _startTimer() {
    this._stopTimer()
    if (!this.data.autoRefresh) return
    this._timer = setInterval(() => {
      // 节流：上一次请求未完成则跳过本次，等下一个周期
      if (this._fetching) return
      this._refresh()
    }, AUTO_REFRESH_INTERVAL)
  },

  // live 模式直连设备 MQTT；auto/cloud 用云端 watch；不满足条件时退回定时轮询
  _startWatch() {
    this._stopWatch()
    const mode = sensors.getMode()
    const plot = this._curPlot()
    // 实时直连：小程序订阅 broker，设备每发一帧（约 1.8 秒）页面即更新
    if (mode === 'live' && plot) {
      this._watcher = sensors.watchLive(
        plot.plotId,
        (r) => {
          this._fetching = false
          this._applyReading(r)
        },
        () => {
          // MQTT 连接失败（多为网络/域名限制）：退回轮询读缓存，功能不受影响
          this._watcher = null
          this._startTimer()
        }
      )
      if (this._watcher) {
        this._stopTimer()
        return
      }
    }
    const canWatch = (mode === 'auto' || mode === 'cloud') && sensors.cloudReady() && plot
    if (canWatch) {
      this._watcher = sensors.watchLatest(
        plot.plotId,
        (r) => {
          this._fetching = false
          this._applyReading(r)
        },
        () => {
          // 监听不可用（多为集合权限未放开）：回到轮询，功能不受影响
          this._watcher = null
          this._startTimer()
        }
      )
      if (this._watcher) {
        this._stopTimer()
        return
      }
    }
    this._startTimer()
  },

  _stopWatch() {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  },

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  // 切换自动刷新开关
  toggleAutoRefresh() {
    const next = !this.data.autoRefresh
    this.setData({ autoRefresh: next })
    if (next) this._startWatch()
    else { this._stopWatch(); this._stopTimer() }
    wx.showToast({ title: next ? '已开启自动刷新' : '已暂停自动刷新', icon: 'none' })
  },

  onPlotChange(e) {
    this.setData({ plotIndex: +e.detail.value })
    this._refresh()
    this._startWatch()   // 切换地块后监听目标也要跟着换
  },

  _curPlot() {
    return this.data.plots[this.data.plotIndex] || null
  },

  // 拉取一次最新读数 + AI 分析（自动/手动共用入口）
  _refresh() {
    const plot = this._curPlot()
    if (!plot) return
    // 节流：请求未返回时直接跳过，防止自动刷新与手动刷新重叠
    if (this._fetching) return
    this._fetching = true
    sensors.fetchLatest(plot.plotId).then(r => {
      this._fetching = false
      this._applyReading(r)
    }).catch(() => {
      this._fetching = false
    })
  },

  // 把一条读数渲染到页面（轮询、watch 推送、手动刷新共用）
  _applyReading(r) {
    const plot = this._curPlot()
    if (!plot || !r) return
    const report = ai.analyzeEnvironment([r], plot.name)
    this.setData({
      current: plot,
      airTemp: r.airTemp,
      airHumidity: r.airHumidity,
      light: r.light,
      soilMoisture: r.soilMoisture,
      source: r.source,
      sourceLabel: r.sourceLabel || sensors.sourceLabel(r.source),
      sourceTag: sensors.sourceTag(r.source),
      deviceId: r.deviceId || '',
      updateTime: util.formatDateTime(r.ts),
      aiReport: report,
      lastRefreshTs: Date.now()
    })
  },

  // ---------- 数据来源切换 ----------

  // 点选来源（只是切换选中态，点「应用」才真正生效）
  onMode(e) {
    const m = e.currentTarget.dataset.mode
    this.setData({
      sourceMode: m,
      modeDesc: sensors.modeDesc(m)
    })
  },

  // 应用：写入存储 + 清缓存 + 立即刷新
  applyMode() {
    const m = sensors.setMode(this.data.sourceMode)
    this.setData({ modeDesc: sensors.modeDesc(m) })
    wx.showToast({ title: '已切换到' + this._modeName(m), icon: 'none' })
    this._refresh()
    this._startWatch()   // 模式变了，监听/轮询方式也要重新选择
  },

  _modeName(m) {
    return ({ auto: '自动', cloud: '云端', live: '实时', demo: '演示数据' })[m] || m
  },

  // 手动刷新：立即拉取一次，并重置监听/轮询
  refreshManual() {
    if (this._fetching) {
      wx.showToast({ title: '正在刷新中…', icon: 'none' })
      return
    }
    this._refresh()
    this._startWatch()  // 重建监听（或重置轮询计时）
    wx.showToast({ title: '已刷新', icon: 'none' })
  },

  goPlot() {
    if (this.data.current) wx.navigateTo({ url: '/pages/plotDetail/plotDetail?id=' + this.data.current.plotId })
  },
  goDiagnose() {
    const p = this.data.current
    wx.navigateTo({ url: '/pages/diagnose/diagnose?crop=' + encodeURIComponent(p ? p.name : '') })
  },

  onPullDownRefresh() {
    this._refresh()
    wx.stopPullDownRefresh()
  }
})
