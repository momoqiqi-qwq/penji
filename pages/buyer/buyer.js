// pages/buyer/buyer.js
// 采购商工作台（货源雷达 + 检测与审核者）
// 功能：主推农地块（按成熟倒计时排序、临近成熟高亮、预订购）、批次档案核验、
//       OPI 有机生产评价、食品标准查询、录入食品检测结果、接收生产风险预警。
// 权限：采购商不可修改农户的地块信息与农事生产原始记录。
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')
const app = getApp()

Page({
  data: {
    tab: 'plots',            // plots：主推农地块；batches：批次核验；standards：食品标准库
    buyer: null,
    mainPlots: [],           // 主推农地块（按成熟倒计时排序，含预订购状态）
    nearCount: 0,            // 临近成熟地块数
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
    this.setData({ buyer }, () => this._load())
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

  // 预订购：同一批次只允许一个采购商锁定；被他人预订时提示，取消后释放
  onPreorder(e) {
    const batchId = e.currentTarget.dataset.batch
    const plot = (this.data.mainPlots || []).find(p => p.batchId === batchId)
    if (!plot) return
    if (plot.preorder) {
      if (plot.preorderMine) wx.showToast({ title: '您已预订该批次', icon: 'none' })
      else wx.showToast({ title: '该批次已被其他采购商预订', icon: 'none' })
      return
    }
    const buyer = this.data.buyer || {}
    wx.showModal({
      title: '预订购该批次',
      content: '确认向 ' + (plot.farmerName || '该农户') + ' 预订 ' + (plot.cropName || '该作物') + '（' + plot.name + '），预计 ' + (plot.expectedHarvest || '成熟期') + ' 成熟？',
      confirmText: '确认预订',
      success: (res) => {
        if (!res.confirm) return
        const r = store.createPlotPreorder({
          plotId: plot.plotId,
          batchId: plot.batchId,
          buyerId: buyer.buyerId || auth.current().buyerId,
          buyerName: buyer.name || ''
        })
        if (r.ok) {
          wx.showToast({ title: r.already ? '您已预订' : '预订成功', icon: 'success' })
        } else if (r.reason === 'locked') {
          const who = r.preorder && r.preorder.buyerName ? r.preorder.buyerName : '其他采购商'
          wx.showModal({
            title: '该批次已被预订',
            content: who + ' 已预订该批次，您可关注其取消后再预订。',
            showCancel: false,
            confirmText: '知道了'
          })
        } else if (r.reason === 'no_buyer') {
          wx.showToast({ title: '请先选择采购商身份', icon: 'none' })
        } else {
          wx.showToast({ title: '该批次已不可预订', icon: 'none' })
        }
        this._load()
      }
    })
  },

  // 取消预订购：仅本人可取消，取消后其他采购商可再次预订
  onCancelPreorder(e) {
    const preorderId = e.currentTarget.dataset.preorder
    const plot = (this.data.mainPlots || []).find(p => p.preorder && p.preorder.preorderId === preorderId)
    if (!plot || !plot.preorder) return
    const buyer = this.data.buyer || {}
    wx.showModal({
      title: '取消预订购',
      content: '取消后该批次将释放，其他采购商可再次预订。确定取消吗？',
      confirmText: '取消预订',
      confirmColor: '#B23B34',
      success: (res) => {
        if (!res.confirm) return
        const r = store.cancelPlotPreorder(preorderId, buyer.buyerId || auth.current().buyerId)
        if (r.ok) wx.showToast({ title: '已取消', icon: 'success' })
        else wx.showToast({ title: r.reason === 'forbidden' ? '只能取消自己的预订' : '取消失败', icon: 'none' })
        this._load()
      }
    })
  },

  _load() {
    const standards = store.listStandards()
    const all = store.listBatches()
    const buyerId = (this.data.buyer && this.data.buyer.buyerId) || ''
    const mainPlots = store.listMainPlots().map(p => Object.assign({}, p, {
      preorderMine: !!(p.preorder && p.preorder.buyerId === buyerId)
    }))
    const nearCount = mainPlots.filter(p => p.nearMature).length
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
    this.setData({ mainPlots, nearCount, batches, risks: riskList, riskCount: riskList.length, standards })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    // 回到主推地块时重新算一次，保证成熟倒计时/排序是最新的
    if (tab === 'plots') this._load()
  },

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
