// components/profileSheet/profileSheet.js
// 个人信息卡：头像 / 昵称 / 身份 / 微信身份来源
// 独立成组件的原因：身份页和首页都要能点头像看这些，判定写法只留一份，
// 免得两个地方对「算不算已登录」各有一套说法

const auth = require('../../utils/auth.js')
const store = require('../../utils/store.js')
const util = require('../../utils/util.js')

// 身份色只在这个语境里出现（这是谁），与身份选择页的角色色一致
const ROLE = {
  farmer: { name: '农户', color: '#17603A' },
  buyer: { name: '采购商', color: '#B4802F' },
  consumer: { name: '消费者', color: '#2D5DA8' }
}

Component({
  properties: {
    open: { type: Boolean, value: false }
  },

  data: {
    nickName: '微信用户',
    avatarUrl: '',
    avatarText: '我',
    roleName: '',
    roleColor: '',
    rows: []
  },

  observers: {
    // 每次打开都重算：这次会话里可能刚登录过、刚换过头像、刚换过身份
    open(v) {
      if (v) this._load()
    }
  },

  methods: {
    _load() {
      const cur = auth.current()
      const role = ROLE[cur.role] || null
      const nick = cur.nickName || '微信用户'
      const account = this._account(cur)
      const rows = []

      if (role) {
        rows.push({ k: '身份', v: account ? role.name + ' · ' + account : role.name })
      }
      rows.push({ k: '微信身份', v: this._identity(cur) })
      if (cur.loginAt) rows.push({ k: '登录时间', v: util.formatDateTime(cur.loginAt) })

      this.setData({
        nickName: nick,
        avatarUrl: cur.avatarUrl,
        avatarText: nick.slice(0, 1),
        roleName: role ? role.name : '还没选身份',
        roleColor: role ? role.color : '#55665A',
        rows: rows
      })
    },

    /** 当前身份对应的业务账号名；消费者不需要账号，返回空串 */
    _account(cur) {
      // 只为了一个名字，不用 store.getFarmer（那个会把批次、评价、记录整套捞出来）
      if (cur.role === 'farmer' && cur.farmerId) {
        const f = (store.listFarmers() || []).filter((x) => x.farmerId === cur.farmerId)[0]
        return (f && f.name) || ''
      }
      if (cur.role === 'buyer' && cur.buyerId) {
        const b = (store.listBuyers() || []).filter((x) => x.buyerId === cur.buyerId)[0]
        return (b && b.name) || ''
      }
      return ''
    },

    /**
     * 身份来源要如实说：核验过才敢写「已核验」，只在本机就说只在本机。
     * 只露 openid 后 6 位 —— 它不是密钥，但也没必要整串铺在界面上
     */
    _identity(cur) {
      if (cur.openid) return '已核验 · openid …' + cur.openid.slice(-6)
      if (cur.identitySource === 'local') return '本机身份 · 未连云端'
      return '未登录'
    },

    onClose() {
      this.triggerEvent('close')
    },

    // 点遮罩等同关闭；不用 catchtap 会让下面的页面也收到这一下
    onMask() {
      this.triggerEvent('close')
    },

    // 吞掉遮罩上的滑动，避免在卡片后面滚动页面
    noop() {}
  }
})
