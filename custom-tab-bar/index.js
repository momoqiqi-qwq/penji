// custom-tab-bar/index.js
// 自定义底栏只负责「渲染 + 高亮」，tab 列表的唯一配置源是 utils/tabbar.js。
// 曾经这里自建过一份 ALL_TABS，与 utils/tabbar.js 的 TABS 漂移（消费者少一项「实况」），
// 导致进入实况页时底栏没有对应项、高亮停在首页 —— 所以不再重复定义。
const tabbar = require('../utils/tabbar.js')

Component({
  data: {
    selected: 0,
    color: '#98A69C',
    selectedColor: '#17603A',
    list: tabbar.getList()
  },

  lifetimes: {
    attached() { this._detectSelected() },
    ready() { this._detectSelected() }
  },

  // 页面切回来时路由可能已变，组件自身的 pageLifetimes 不保证触发，这里再兜一次
  pageLifetimes: {
    show() { this._detectSelected() }
  },

  methods: {
    // 激活项只由路由推导，页面里不再写死索引
    _detectSelected() {
      const idx = tabbar.routeToIndex(tabbar.currentRoute())
      if (idx >= 0 && idx !== this.data.selected) {
        this.setData({ selected: idx })
      }
    },

    switchTab(e) {
      const ds = e.currentTarget.dataset
      const path = ds.path
      if (!path) return
      const gIdx = Number(ds.globalIdx)
      if (Number.isFinite(gIdx)) this.setData({ selected: gIdx })
      wx.switchTab({
        url: '/' + path,
        fail: () => wx.switchTab({ url: path, fail: () => {} })
      })
    }
  }
})
