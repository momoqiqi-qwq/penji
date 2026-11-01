// pages/credential/credential.js
// 一张信用凭证的只读快照页。被授权方（采购商 / 金融机构 / 村集体）凭凭证号打开，
// 只能看到农户勾选授权的那几个维度；过期或作废就整页只留一句说明，不给任何数字。
const store = require('../../utils/store.js')

Page({
  data: {
    credentialId: '',
    cred: null,
    status: 'missing',   // valid / expired / revoked / missing
    statusText: '正在读取…',
    statusCls: 'tag-gray',
    dims: []
  },

  onLoad(query) {
    this.setData({ credentialId: query.id || '' })
    this.refresh()
  },

  refresh() {
    const cred = store.getCredential(this.data.credentialId)
    if (!cred) {
      this.setData({ cred: null, status: 'missing', statusText: '凭证不存在或已被删除', statusCls: 'tag-gray' })
      return
    }

    let status = 'valid'
    let statusText = '有效'
    let statusCls = 'tag-green'
    if (cred.revoked) {
      status = 'revoked'; statusText = '已作废'; statusCls = 'tag-warn'
    } else if (cred.expired) {
      status = 'expired'; statusText = '已过期'; statusCls = 'tag-gray'
    }

    const dims = ((cred.snapshot && cred.snapshot.dims) || []).map(d => ({
      ...d,
      pct: d.max ? Math.round(d.score / d.max * 100) : 0,
      items: (d.items || []).map(it => ({ ...it, pct: it.max ? Math.round(it.score / it.max * 100) : 0 }))
    }))

    this.setData({ cred, status, statusText, statusCls, dims })
  },

  // 转发给被授权方：带上凭证号，对方点开就是这一页
  onShareAppMessage() {
    const c = this.data.cred
    return {
      title: c ? `${c.farmerName}的信用凭证（${c.snapshot.grade} · ${c.snapshot.score} 分）` : '农户信用凭证',
      path: '/pages/credential/credential?id=' + this.data.credentialId
    }
  }
})
