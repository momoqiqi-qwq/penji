// app.js
// 棚迹 - 农产品溯源小程序
// 核心链路：农田传感器采集真实数据 → AI 分析生产环境 → 自动生成农产品档案
//           → 二维码绑定农产品 → 消费者扫码查看真实生长过程 → 消费者反馈 → 数据返回农户
// 身份在进入界面时即选定（消费者 / 农户），农户才能上传，消费者只能反馈

const { initMockData } = require('./utils/mock.js')
const auth = require('./utils/auth.js')
const cloud = require('./utils/cloud.js')

App({
  globalData: {
    appName: '棚迹',
    slogan: '从地块到餐桌 · 看见每一寸土地的故事',
    version: '2.0.0',
    // 当前身份（consumer / farmer）；农户身份绑定 farmerId
    role: '',
    farmerId: '',
    // 云开发是否已就绪（由 onLaunch 写入，页面可据此显示数据来源）
    cloudReady: false
  },

  onLaunch() {
    try {
      // 云开发初始化：传感器云端采集、AI 农诊断、照片上传都走云函数/云存储
      // 未配置环境或基础库不支持时 init() 返回 false，sensors.js 会自动回落，不会白屏
      const cloudOk = cloud.init()
      console.log('[棚迹] 云开发：', cloudOk ? ('已启用 ' + cloud.envDesc()) : '未配置，回落演示数据')

      initMockData()
      const cur = auth.current()
      this.globalData.role = cur.role
      this.globalData.farmerId = cur.farmerId
      this.globalData.cloudReady = cloudOk
      console.log('[棚迹] 当前身份：', cur.role || '未选择', cur.farmerId || '')
    } catch (e) {
      console.error('[棚迹] 启动失败', e)
    }
  },

  // 身份变化后同步到 globalData（页面 onShow 调用）
  refreshAuth() {
    const cur = auth.current()
    this.globalData.role = cur.role
    this.globalData.farmerId = cur.farmerId
    return cur
  }
})
