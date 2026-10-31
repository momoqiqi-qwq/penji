// pages/inspect/inspect.js
// 采购商批次核验详情：
// 批次档案 / 传感器环境数据 / 生产全过程时间线（只读）/ 投入品台账 /
// OPI 有机生产评价 / 数据完整性核验 / 食品检测结果 + 录入检测
const store = require('../../utils/store.js')
const sensors = require('../../utils/sensors.js')
const auth = require('../../utils/auth.js')
const util = require('../../utils/util.js')

Page({
  data: {
    batchId: '',
    // 入口页（未带批次号时显示）：可直接输码，也可从样品里挑
    inputId: '',
    ilTitle: '核对一批菜的来路',
    ilDesc: '输入批次编号，或从下方样品中挑选，查看环境数据、农事记录与检测结果。',
    ilPlaceholder: '请输入批次号，如 B-001',
    ilBtnGo: '核验',
    ilSep: '或 从样品中挑选',
    ilSepDot: '·',
    ilArrow: '›',
    sampleBatches: [],
    batch: null,
    plot: null,
    farmer: null,
    records: [],
    latestEnv: null,          // 最新环境快照
    latestEnvTag: '',
    opi: null,
    comp: null,
    inspections: [],
    // 录入表单
    showForm: false,
    standards: [],
    stdIndex: 0,
    form: {
      org: '',
      date: '',
      conclusion: '合格',
      items: [{ name: '', result: '', limit: '', conclusion: '合格' }]
    }
  },

  onLoad(q) {
    const batchId = q.id || ''
    this.setData({
      batchId,
      standards: store.listStandards(),
      'form.date': util.formatDate(new Date()),
      sampleBatches: batchId ? [] : store.listBatches().slice(0, 6)
    })
    if (batchId) this._load()
  },

  onShow() {
    if (this.data.batchId) this._load()
  },

  // ---------- 入口页：输码 / 选样品 ----------
  onInputId(e) { this.setData({ inputId: e.detail.value }) },

  submitInput() {
    const code = String(this.data.inputId || '').trim()
    if (!code) { wx.showToast({ title: '请输入批次号', icon: 'none' }); return }
    const hit = store.listBatches()
      .find(b => String(b.batchId).toUpperCase() === code.toUpperCase())
    if (!hit) { wx.showToast({ title: '没有找到该批次', icon: 'none' }); return }
    this._open(hit.batchId)
  },

  pickSample(e) {
    const id = e.currentTarget.dataset.id
    if (id) this._open(id)
  },

  _open(batchId) {
    this.setData({ batchId, sampleBatches: [], inputId: '' })
    this._load()
  },

  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/index/index' })
  },

  _load() {
    const ctx = store.getBatch(this.data.batchId)
    if (!ctx) {
      wx.showToast({ title: '批次不存在', icon: 'none' })
      return
    }
    const { batch, plot, farmer, records } = ctx
    const opi = store.getBatchOPI(this.data.batchId)
    const comp = store.getDataCompleteness(this.data.batchId)
    const inspections = store.listInspections(this.data.batchId)
    // 有机蔬菜生产合规核验（8 项强制要求；有机质/NPK/CEC 仅监测不判定）
    const organic = store.getOrganicCompliance(this.data.batchId)
    // 最新环境快照（优先地块传感器历史末条）
    let latestEnv = null
    if (plot && plot.envHistory && plot.envHistory.length) {
      latestEnv = plot.envHistory[plot.envHistory.length - 1]
    } else if (batch.envSnapshot) {
      latestEnv = batch.envSnapshot
    }
    // 农事记录补来源标签
    const recs = (records || []).map(r => ({
      ...r,
      envTag: r.envSnapshot ? sensors.sourceTag(r.envSnapshot.source || 'demo') : '',
      envLabel: r.envSnapshot ? sensors.sourceLabel(r.envSnapshot.source || 'demo') : ''
    }))
    if (latestEnv) latestEnv.sourceLabel = sensors.sourceLabel(latestEnv.source || 'demo')
    this.setData({
      batch, plot, farmer, records: recs, opi, comp, organic, inspections,
      latestEnv,
      latestEnvTag: latestEnv ? sensors.sourceTag(latestEnv.source || 'demo') : ''
    })
  },

  // ---------- 检测录入 ----------
  toggleForm() {
    const cur = auth.current()
    if (!cur.isBuyer) {
      wx.showToast({ title: '仅采购商可录入检测结果', icon: 'none' })
      return
    }
    this.setData({ showForm: !this.data.showForm })
  },

  onStdPick(e) { this.setData({ stdIndex: +e.detail.value }) },
  onOrg(e) { this.setData({ 'form.org': e.detail.value }) },
  onDate(e) { this.setData({ 'form.date': e.detail.value }) },
  onConclusion(e) { this.setData({ 'form.conclusion': e.detail.value }) },

  onItemInput(e) {
    const idx = e.currentTarget.dataset.idx
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.items[${idx}].${field}`]: e.detail.value })
  },
  onItemConc(e) {
    const idx = e.currentTarget.dataset.idx
    this.setData({ [`form.items[${idx}].conclusion`]: e.detail.value })
  },
  addItem() {
    const items = this.data.form.items.concat([{ name: '', result: '', limit: '', conclusion: '合格' }])
    this.setData({ 'form.items': items })
  },
  removeItem(e) {
    const idx = e.currentTarget.dataset.idx
    const items = this.data.form.items.slice()
    items.splice(idx, 1)
    this.setData({ 'form.items': items.length ? items : [{ name: '', result: '', limit: '', conclusion: '合格' }] })
  },

  submitInspection() {
    const f = this.data.form
    if (!f.org.trim()) { wx.showToast({ title: '请填写检测机构', icon: 'none' }); return }
    const items = f.items.filter(i => i.name.trim())
    if (!items.length) { wx.showToast({ title: '请至少填写一个检测项目', icon: 'none' }); return }
    const std = this.data.standards[this.data.stdIndex] || {}
    const cur = auth.current()
    const buyer = store.listBuyers().find(b => b.buyerId === cur.buyerId) || store.listBuyers()[0] || {}
    store.addInspection({
      batchId: this.data.batchId,
      buyerId: cur.buyerId || buyer.buyerId,
      buyerName: buyer.name || '采购商',
      standard: std.code || '',
      org: f.org.trim(),
      date: f.date,
      conclusion: f.conclusion,
      items
    })
    wx.showToast({ title: '检测结果已录入', icon: 'success' })
    this.setData({
      showForm: false,
      form: { org: '', date: util.formatDate(new Date()), conclusion: '合格',
        items: [{ name: '', result: '', limit: '', conclusion: '合格' }] }
    })
    this._load()
  }
})
