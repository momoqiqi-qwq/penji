// pages/buyer/buyer.js
// 采购商工作台（货源雷达 + 检测与审核者）
// 功能：主推农地块（按成熟倒计时排序、临近成熟高亮、预订购）、进货登记与限期接受确认、
//       批次档案核验、OPI 有机生产评价、食品标准查询、录入食品检测结果、接收生产风险预警。
// 权限：采购商不可修改农户的地块信息与农事生产原始记录。
const store = require('../../utils/store.js')
const auth = require('../../utils/auth.js')
const util = require('../../utils/util.js')
const receipt = require('../../utils/receipt.js')
const app = getApp()

Page({
  data: {
    tab: 'plots',            // plots：主推农地块；receipts：进货验收；batches：批次核验；standards：食品标准库
    buyer: null,
    mainPlots: [],           // 主推农地块（按成熟倒计时排序，含预订购状态）
    nearCount: 0,            // 临近成熟地块数
    batches: [],             // 批次列表（含 OPI/检测/完整率/风险标记）
    risks: [],               // 风险预警
    standards: [],
    riskCount: 0,
    riskExpanded: false,
    batchesExpanded: true,
    standardsExpanded: true,

    // ---- 进货验收（进货后限期接受确认 / 逾期补录 / 操作时限）----
    receipts: [],            // 本人进货单（每条带时限计算结果）
    receiptSummary: { total: 0, pending: 0, warn: 0, overdue: 0, done: 0 },
    limitHours: receipt.LIMIT_HOURS,
    receiptLimitText: receipt.limitText(),
    conclusions: ['合格', '待复检', '不合格'],
    formReceiptId: '',       // 当前展开确认表单的进货单
    formConclusion: '合格',
    formNote: '',
    formLateReason: '',
    registerBatchId: '',     // 当前展开「登记进货」表单的批次
    regDate: '',
    regQty: ''
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
    // 时限在走：每 30 秒刷新一次剩余时间/超期状态，离开页面立即停掉
    this._startTick()
  },

  onHide() {
    this._stopTick()
  },

  onUnload() {
    this._stopTick()
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

  // ---------- 进货登记（批次核验页）----------
  onOpenRegister(e) {
    const batchId = e.currentTarget.dataset.batch
    const b = (this.data.batches || []).find(x => x.batchId === batchId)
    if (!b) return
    if (b.hasReceipt) {
      wx.showToast({ title: '该批次已登记过进货', icon: 'none' })
      return
    }
    if (!b.harvested) {
      wx.showToast({ title: '该批次尚未采收，暂不能登记进货', icon: 'none' })
      return
    }
    this.setData({ registerBatchId: batchId, regDate: util.formatDate(), regQty: '' })
  },

  closeRegister() {
    this.setData({ registerBatchId: '' })
  },

  onRegDate(e) {
    this.setData({ regDate: e.detail.value })
  },

  onRegQty(e) {
    this.setData({ regQty: e.detail.value })
  },

  // 表单容器拦一下冒泡：批次卡本身是「去核验」的整块点击区
  stopTap() {},

  submitRegister() {
    const b = (this.data.batches || []).find(x => x.batchId === this.data.registerBatchId)
    if (!b) return
    const buyer = this.data.buyer || {}
    const r = store.createReceipt({
      batchId: b.batchId,
      buyerId: buyer.buyerId || auth.current().buyerId,
      buyerName: buyer.name || '',
      date: this.data.regDate,
      qty: Number(this.data.regQty) || 0,
      unit: 'kg'
    })
    if (!r.ok) {
      let tip = '登记失败'
      if (r.reason === 'duplicate') tip = '该批次已登记过进货'
      else if (r.reason === 'not_harvested') tip = '该批次尚未采收'
      else if (r.reason === 'future_date') tip = '进货日期不能晚于今天'
      else if (r.reason === 'no_buyer') tip = '请先选择采购商身份'
      wx.showToast({ title: tip, icon: 'none' })
      return
    }
    wx.showToast({ title: '已登记，' + receipt.LIMIT_HOURS + ' 小时内确认', icon: 'none' })
    this.setData({ registerBatchId: '', tab: 'receipts' })
    this._load()
  },

  // ---------- 接受确认 / 逾期补录 ----------
  onOpenConfirm(e) {
    const receiptId = e.currentTarget.dataset.receipt
    const r = (this.data.receipts || []).find(x => x.receiptId === receiptId)
    if (!r || r.status !== 'pending') return
    this.setData({
      formReceiptId: receiptId,
      formConclusion: '合格',
      formNote: '',
      formLateReason: ''
    })
  },

  cancelConfirm() {
    this.setData({ formReceiptId: '', formNote: '', formLateReason: '' })
  },

  onReceiptConclusion(e) {
    this.setData({ formConclusion: e.currentTarget.dataset.value })
  },

  onReceiptNote(e) {
    this.setData({ formNote: e.detail.value })
  },

  onReceiptLateReason(e) {
    this.setData({ formLateReason: e.detail.value })
  },

  submitConfirm() {
    const r = (this.data.receipts || []).find(x => x.receiptId === this.data.formReceiptId)
    if (!r) return
    const res = store.confirmReceipt({
      receiptId: r.receiptId,
      buyerId: this._buyerId(),
      conclusion: this.data.formConclusion,
      note: this.data.formNote,
      lateReason: this.data.formLateReason
    })
    if (!res.ok) {
      if (res.reason === 'need_reason') wx.showToast({ title: '已超期，请填写超期原因', icon: 'none' })
      else if (res.reason === 'already_done') wx.showToast({ title: '该进货单已处理', icon: 'none' })
      else wx.showToast({ title: '提交失败', icon: 'none' })
      this._load()
      return
    }
    const lateHours = Math.max(1, Math.round((res.receipt.lateMs || 0) / receipt.HOUR))
    wx.showToast({
      title: res.late ? '已逾期补录（超期 ' + lateHours + ' 小时）' : '已接受确认',
      icon: res.late ? 'none' : 'success'
    })
    this.setData({ formReceiptId: '' })
    this._load()
  },

  _buyerId() {
    return (this.data.buyer && this.data.buyer.buyerId) || auth.current().buyerId || ''
  },

  _startTick() {
    this._stopTick()
    this._tickTimer = setInterval(() => {
      // 只在进货验收页刷新，其余页不必重复算
      if (this.data.tab === 'receipts') this._loadReceipts()
    }, 30000)
  },

  _stopTick() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer)
      this._tickTimer = null
    }
  },

  _load() {
    const standards = store.listStandards()
    const all = store.listBatches()
    const buyerId = this._buyerId()
    const receiptBatchIds = store.listReceiptBatchIds(buyerId)
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
        harvested: b.status === '已收获' || !!b.harvestDate,
        hasReceipt: receiptBatchIds.indexOf(b.batchId) >= 0,
        riskLevel: risks.length ? (risks.some(r => r.indexOf('违规') >= 0 || r.indexOf('不符合') >= 0) ? '高' : '中') : '低',
        risks
      }
    })
    const riskList = batches.filter(x => x.risks.length)
    this.setData({ mainPlots, nearCount, batches, risks: riskList, riskCount: riskList.length, standards })
    this._loadReceipts()
  },

  // 进货单 + 时限状态：每次都按「现在」重算，保证倒计时和超期判定不滞后
  _loadReceipts() {
    const now = Date.now()
    const list = store.listReceipts(this._buyerId()).map(r => Object.assign({}, r, receipt.compute(r, now)))
    const summary = receipt.summarize(list, now)
    // 表单对应的单子已被处理（或换人）就收起，避免表单挂在一张已完成的单子上
    const openId = this.data.formReceiptId
    const keep = openId && list.some(x => x.receiptId === openId && x.status === 'pending')
    this.setData({
      receipts: list,
      receiptSummary: summary,
      formReceiptId: keep ? openId : ''
    })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    // 回到主推地块时重新算一次，保证成熟倒计时/排序是最新的
    if (tab === 'plots') this._load()
    if (tab === 'receipts') this._loadReceipts()
  },

  // 进入批次核验详情
  goInspect(e) {
    // 去核验时收起未提交的登记表单，回来时不要挂着一个旧表单
    if (this.data.registerBatchId) this.setData({ registerBatchId: '' })
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
