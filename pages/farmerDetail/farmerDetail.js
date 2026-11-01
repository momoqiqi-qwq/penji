// pages/farmerDetail/farmerDetail.js
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    farmerId: '',
    farmer: null,
    batches: [],
    reviews: [],
    records: [],
    creditBar: 0,
    creditDims: [],
    creditBasis: '',
    // 身份权限
    role: 'consumer',
    canReview: true,   // 仅消费者可评价
    // 是不是本人的档案：决定能不能看到「提升信用」这条修复通道
    isSelf: false,
    repair: { items: [], gainable: 0, rest: 0 },
    // 信用凭证：农户自己决定给谁看哪几个维度
    credentials: [],
    showCredSheet: false,
    scopeOptions: [],
    audiences: store.CRED_AUDIENCES,
    credAudience: '采购商',
    credDays: 30,
    credNote: '',
    showReviewSheet: false,
    reviewForm: { rating: 5, content: '' }
  },

  onLoad(query) {
    this.setData({ farmerId: query.id })
    this.refresh()
  },

  onShow() {
    if (this.data.farmerId) this.refresh()
  },

  refresh() {
    const detail = store.getFarmer(this.data.farmerId)
    if (!detail) {
      wx.showToast({ title: '农户不存在', icon: 'none' })
      return
    }
    const { farmer, batches, reviews, records } = detail
    farmer.starText = '★'.repeat(farmer.star) + '☆'.repeat(5 - farmer.star)
    farmer.level = util.scoreLevel(farmer.creditScore)
    farmer.joinedYear = farmer.joinedAt ? farmer.joinedAt.slice(0, 4) : ''

    // 三维度信用评价明细（GB/T 23794-2023）
    const creditDims = (farmer.creditDetail && farmer.creditDetail.dims ? farmer.creditDetail.dims : []).map(d => ({
      ...d,
      pct: d.max ? Math.round(d.score / d.max * 100) : 0,
      barCls: d.key === 'willingness' ? 'green' : (d.key === 'ability' ? 'gold' : 'green'),
      items: d.items.map(it => ({ ...it, pct: it.max ? Math.round(it.score / it.max * 100) : 0 }))
    }))
    const creditBasis = farmer.creditDetail ? farmer.creditDetail.basis : ''

    const batchesView = batches.map(b => ({
      ...b,
      statusTag: b.status === '种植中' ? 'tag-green' : 'tag-gray',
      flagTag: b.flag ? 'tag-warn' : ''
    }))

    const reviewsView = reviews.map(r => ({
      ...r,
      starText: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating),
      timeAgo: util.timeAgo(util.parseDate(r.date))
    }))

    const batchName = {}
    batches.forEach(b => batchName[b.batchId] = b.productName)
    const recordsView = records.map(r => ({
      ...r,
      productName: batchName[r.batchId] || '-',
      typeTag: this._typeTag(r.type),
      timeAgo: util.timeAgo(util.parseDate(r.date))
    }))

    const app = getApp()
    const cur = app.refreshAuth()
    const isSelf = !!(cur.isFarmer && cur.farmerId && cur.farmerId === farmer.farmerId)
    // 修复通道只给本人看：把「你还差哪几项」摊开给外人看，等于替农户示弱
    const plan = isSelf ? store.getRepairPlan(farmer.farmerId) : { items: [], gainable: 0 }

    // 凭证列表要带「有效期过了没 / 我作废了没」，这些都算在 store 那一侧，
    // 页面不自己比日期——两处判过期迟早会不一致
    const credentials = isSelf
      ? store.listCredentials(farmer.farmerId).map(c => {
          const full = store.getCredential(c.credentialId) || {}
          const revoked = !!full.revoked
          const expired = !!full.expired
          return Object.assign({}, c, {
            scopeText: store.CRED_SCOPES
              .filter(s => c.scopes.indexOf(s.key) >= 0)
              .map(s => s.name)
              .join(' · '),
            revoked,
            statusText: revoked ? '已作废' : (expired ? '已过期' : '有效'),
            statusCls: revoked ? 'tag-warn' : (expired ? 'tag-gray' : 'tag-green')
          })
        })
      : []

    this.setData({
      farmer,
      batches: batchesView,
      reviews: reviewsView,
      records: recordsView,
      creditBar: farmer.creditScore,
      creditDims,
      creditBasis,
      role: cur.role,
      canReview: auth.canReview(cur.role),
      isSelf,
      credentials,
      // 只摊前 4 条，剩下的按条数提示——8 项全铺开会把这一页拉得很长
      repair: {
        items: plan.items.slice(0, 4),
        gainable: plan.gainable,
        rest: Math.max(0, plan.items.length - 4)
      }
    })
  },

  _typeTag(type) {
    const map = { '播种': 'tag-green', '施肥': 'tag-gold', '灌溉': 'tag-green', '除草': 'tag-gray', '防治': 'tag-gold', '收获': 'tag-green' }
    return map[type] || 'tag-gray'
  },

  goPlot(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/plotDetail/plotDetail?id=' + id })
  },

  goBatch(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/product/product?id=' + id })
  },

  // 消费者反馈农户（数据回传农户）
  openReview() {
    if (!this.data.canReview) {
      wx.showToast({ title: '仅消费者可反馈', icon: 'none' })
      return
    }
    this.setData({ showReviewSheet: true })
  },
  closeReview() { this.setData({ showReviewSheet: false }) },
  onRating(e) { this.setData({ 'reviewForm.rating': +e.currentTarget.dataset.r }) },
  onContent(e) { this.setData({ 'reviewForm.content': e.detail.value }) },
  submitReview() {
    if (!this.data.farmer) return
    if (!this.data.canReview) {
      wx.showToast({ title: '仅消费者可反馈', icon: 'none' })
      return
    }
    const f = this.data.reviewForm
    if (!f.content.trim()) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    store.addReview({
      farmerId: this.data.farmer.farmerId,
      batchId: '',
      buyerName: '扫码消费者',
      rating: f.rating,
      content: f.content.trim()
    })
    wx.showToast({ title: '反馈已提交，将回传农户', icon: 'success' })
    this.setData({ showReviewSheet: false, 'reviewForm.content': '' })
    this.refresh()
  },

  // 签署承诺书：修复通道里唯一当场涨分的动作，写完立刻重算 + 刷新
  onSignPromise() {
    if (!this.data.isSelf) return
    store.signPromise(this.data.farmerId)
    wx.showToast({ title: '已签署，信用分已更新', icon: 'success' })
    this.refresh()
  },

  goRepair(e) {
    const entry = e.currentTarget.dataset.entry
    if (!entry) return
    wx.navigateTo({ url: entry })
  },

  // ========== 信用凭证 ==========
  // 每次打开都重置勾选：上一份的授权范围不该被默默继承，否则农户容易多发一个维度
  openCredSheet() {
    this.setData({
      showCredSheet: true,
      scopeOptions: store.CRED_SCOPES.map(s => ({ key: s.key, name: s.name, desc: s.desc, on: false })),
      credAudience: '采购商',
      credDays: 30,
      credNote: ''
    })
  },

  closeCredSheet() {
    this.setData({ showCredSheet: false })
  },

  toggleScope(e) {
    const key = e.currentTarget.dataset.key
    this.setData({
      scopeOptions: this.data.scopeOptions.map(s => (
        s.key === key ? { key: s.key, name: s.name, desc: s.desc, on: !s.on } : s
      ))
    })
  },

  pickAudience(e) {
    this.setData({ credAudience: e.currentTarget.dataset.a })
  },

  pickDays(e) {
    this.setData({ credDays: +e.currentTarget.dataset.d })
  },

  onCredNote(e) {
    this.setData({ credNote: e.detail.value })
  },

  submitCredential() {
    if (!this.data.isSelf) return
    const scopes = this.data.scopeOptions.filter(s => s.on).map(s => s.key)
    if (!scopes.length) {
      wx.showToast({ title: '先勾选要披露的维度', icon: 'none' })
      return
    }
    const cred = store.createCredential({
      farmerId: this.data.farmerId,
      scopes,
      audience: this.data.credAudience,
      days: this.data.credDays,
      note: this.data.credNote
    })
    if (!cred) {
      wx.showToast({ title: '生成失败，请重试', icon: 'none' })
      return
    }
    this.setData({ showCredSheet: false })
    wx.showToast({ title: '凭证已生成', icon: 'success' })
    this.refresh()
  },

  goCredential(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/credential/credential?id=' + id })
  },

  // 收回授权：给出去的东西必须能拿回来，否则「授权」只是「交出」
  onRevoke(e) {
    if (!this.data.isSelf) return
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '作废这份凭证',
      content: '作废后对方打开只会看到「已作废」，内容仅作留档。',
      success: res => {
        if (!res.confirm) return
        store.revokeCredential(id, this.data.farmerId)
        wx.showToast({ title: '已作废', icon: 'success' })
        this.refresh()
      }
    })
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  }
})
