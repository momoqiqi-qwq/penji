// pages/buyer/buyer.js
// 采购商工作台（检测与审核者）
// 功能：查看产品各批次档案、核验数据完整性、查看 OPI 有机生产评价、食品标准查询、
//       录入食品检测结果、接收生产风险预警。
// 权限：采购商不可修改农户的地块信息与农事生产原始记录。
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')
const app = getApp()

Page({
  data: {
    tab: 'batches',         // batches：批次核验；standards：食品标准库
    buyer: null,
    batches: [],            // 批次列表（含 OPI/检测/完整率/风险标记）
    risks: [],              // 风险预警
    standards: [],
    riskCount: 0,
    riskExpanded: false,
    batchesExpanded: true,
    standardsExpanded: true
  },

  onShow() {
    const cur = app.refreshAuth ? app.refreshAuth() : auth.current()
    if (!cur.isBuyer) {
      wx.showModal({
        title: '身份提示', content: '该工作台仅采购商可用，请先选择采购商身份。',
        showCancel: false, confirmText: '重新选择',
        success: () => wx.reLaunch({ url: '/pages/chooseRole/chooseRole' })
      })
      return
    }
    const buyer = (store.listBuyers().find(b => b.buyerId === cur.buyerId)) || store.listBuyers()[0]
    this.setData({ buyer })
    this._load()
  },

  toggleRisk() {
    this.setData({ riskExpanded: !this.data.riskExpanded })
  },

  toggleBatches() {
    this.setData({ batchesExpanded: !this.data.batchesExpanded })
  },

  toggleStandards() {
    this.setData({ standardsExpanded: !this.data.standardsExpanded })
  },

  _load() {
    const standards = store.listStandards()
    const all = store.listBatches()
    const batches = all.map(b => {
      const farmer = store.getFarmer(b.farmerId) || {}
      const opi = store.getBatchOPI(b.batchId)
      const comp = store.getDataCompleteness(b.batchId)
      const organic = store.getOrganicCompliance(b.batchId)
      const insps = store.listInspections(b.batchId)
      const risks = []
      if (b.flag === '违规') risks.push('存在产地标注违规记录')
      if (opi && opi.score < 60) risks.push('OPI 评价偏低（' + opi.score + '分）')
      if (organic && organic.status === 'fail') risks.push('有机合规核验：' + organic.statusText + '（' + organic.failCount + ' 项不符合）')
      else if (organic && organic.status === 'unknown') risks.push('有机合规关键资料待核验（' + organic.unknownCount + ' 项）')
      if (b.status === '已收获' && insps.length === 0) risks.push('已采收但暂无食品检测数据')
      if (comp && comp.rate < 70) risks.push('生产档案完整度不足（' + comp.rate + '%）')
      return {
        batchId: b.batchId,
        productName: b.productName,
        status: b.status,
        stage: b.stage,
        farmerName: farmer.name || '—',
        village: farmer.village || '',
        plantDate: b.plantDate,
        harvestDate: b.harvestDate,
        opiScore: opi ? opi.score : null,
        opiLevel: opi ? opi.level : '',
        opiCls: opi ? opi.cls : 'tag-gray',
        orgStatus: organic ? organic.statusText : '',
        orgCls: organic ? organic.cls : 'tag-gray',
        testStatus: insps.length ? ('已检测·' + (opi && opi.hasTest ? '合格' : '关注')) : '暂无检测数据',
        testDone: insps.length > 0,
        compRate: comp ? comp.rate : 0,
        riskLevel: risks.length ? (risks.some(r => r.indexOf('违规') >= 0 || r.indexOf('不符合') >= 0) ? '高' : '中') : '低',
        risks
      }
    })
    const riskList = batches.filter(x => x.risks.length)
    this.setData({ batches, risks: riskList, riskCount: riskList.length, standards })
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }) },

  // 进入批次核验详情
  goInspect(e) {
    wx.navigateTo({ url: '/pages/inspect/inspect?id=' + e.currentTarget.dataset.id })
  },

  // 切换身份
  switchRole() {
    wx.showModal({
      title: '切换身份', content: '确定要退出采购商身份，重新选择吗？',
      success: (res) => {
        if (res.confirm) {
          auth.clearRole()
          wx.reLaunch({ url: '/pages/chooseRole/chooseRole' })
        }
      }
    })
  }
})
