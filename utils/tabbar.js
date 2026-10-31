// utils/tabbar.js
// 底部导航唯一配置 + 「当前页面路由 → 激活 tab」的同步逻辑
//
// 设计原则：
//   1. selected 永远使用 TABS 的全局索引（0=首页 1=地块 2=扫一扫 3=实况）
//   2. 激活项只由路由推导（routeToIndex），页面里不再写死 0/1/2/3
//   3. tab 页只需在 onShow 里调用 tabbar.sync(this)，不再直接摸 getTabBar
//
// 背景：微信自定义 tabBar 的组件实例由框架挂载，页面首次 onShow 时
// this.getTabBar() 可能还没就绪；组件自身的 pageLifetimes.show 也不保证触发。
// 因此这里以「路由」为唯一事实来源，并在挂载完成后重试。
const TABS = [
  { pagePath: 'pages/index/index',       text: '首页',   iconPath: '/assets/tabbar/home.png', selectedIconPath: '/assets/tabbar/home-on.png' },
  { pagePath: 'pages/plot/plot',         text: '地块',   iconPath: '/assets/tabbar/plot.png', selectedIconPath: '/assets/tabbar/plot-on.png' },
  { pagePath: 'pages/scan/scan',         text: '扫一扫', iconPath: '/assets/tabbar/scan.png', selectedIconPath: '/assets/tabbar/scan-on.png' },
  { pagePath: 'pages/simulate/simulate', text: '实况',   iconPath: '/assets/tabbar/live.png', selectedIconPath: '/assets/tabbar/live-on.png' }
]

// 首次进入时 tabBar 组件可能晚于页面 onShow 挂载，按以下时间点重试
const RETRY_DELAYS = [0, 30, 100, 300, 800]

/** 路由归一化：去掉前导斜杠与查询串（switchTab 传参、网页路径都可能带 / 或 ?） */
function normalizeRoute(route) {
  return String(route || '').replace(/^\/+/, '').split('?')[0]
}

/** 路由 → TABS 全局索引；不是 tab 页返回 -1 */
function routeToIndex(route) {
  const r = normalizeRoute(route)
  if (!r) return -1
  return TABS.findIndex(t => t.pagePath === r)
}

/** 当前页面栈栈顶路由（即用户正在看的页面） */
function currentRoute() {
  try {
    const pages = getCurrentPages()
    if (!pages || !pages.length) return ''
    return normalizeRoute(pages[pages.length - 1].route)
  } catch (e) {
    return ''
  }
}

/**
 * 底栏渲染列表：四个 tab 始终全部展示。
 * 之前消费者角色会把「实况」过滤掉，但首页仍保留「农田实况」入口，
 * 导致消费者进入实况页时底栏无对应项、只能停在上一次的高亮（首页）上。
 * tab 的可见性与高亮必须一一对应，因此不再按角色隐藏。
 */
function getList() {
  return TABS.map((t, i) => Object.assign({}, t, { globalIdx: i }))
}

/**
 * 把「当前路由」对应的 tab 高亮同步到页面自己的 tabBar 实例上。
 *
 * @param {object} page  页面实例（传 this），用于拿 page.getTabBar()
 * @param {string} [route] 可显式指定路由；默认依次取 page.route、页面栈栈顶
 * @returns {boolean} 是否已同步成功（组件未就绪时会自动重试）
 */
function sync(page, route) {
  const target = normalizeRoute(route) || normalizeRoute(page && page.route) || currentRoute()
  const idx = routeToIndex(target)
  if (idx < 0) return false // 不在 tab 页，保持原状

  let settled = false
  const apply = () => {
    if (settled) return
    // 防串页：延迟重试期间用户可能已切到别的 tab，此时不要回写旧页面的高亮
    const now = currentRoute()
    if (now && now !== target) return
    try {
      const bar = page && typeof page.getTabBar === 'function' ? page.getTabBar() : null
      if (!bar || typeof bar.setData !== 'function') return
      settled = true
      // 值已一致就不要空 setData，避免无意义渲染
      if (!bar.data || bar.data.selected !== idx) {
        bar.setData({ selected: idx })
      }
    } catch (e) {
      // tabBar 尚未挂载或页面已卸载：交给下一次重试 / 组件自身探测
    }
  }

  RETRY_DELAYS.forEach(ms => {
    if (ms === 0) apply()
    else setTimeout(apply, ms)
  })
  return settled
}

module.exports = {
  TABS,
  normalizeRoute,
  routeToIndex,
  currentRoute,
  getList,
  sync
}
