// 云函数 initdb —— 一次性建好 5 个集合，省得在控制台点 5 遍
//
// 用法：上传后在「云开发控制台 → 云函数 → initdb → 测试」里点一下运行即可（参数留空）。
// 或者在开发者工具的云函数列表里右键 initdb → 「云端测试」。
//
// 幂等：集合已存在不会报错，会返回 exists。重复跑没副作用。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = [
  'readings',       // 原始读数（每条上报一行）
  'devices',        // 设备状态（每台设备一行，记录 lastSeen 判断在线）
  'alerts',         // 越限告警
  'readings_daily', // 按天聚合（90 天档案曲线用）
  'users'           // 微信登录账户（_id = openid，由云函数 login 写入）
]

exports.main = async () => {
  const result = []

  for (let i = 0; i < COLLECTIONS.length; i++) {
    const name = COLLECTIONS[i]
    try {
      await db.createCollection(name)
      result.push({ name: name, status: 'created' })
    } catch (e) {
      const msg = String((e && e.message) || e)
      // 已存在不是错误，这在重复执行时是常态
      if (/already exist|ALREADY_EXISTS|已存在|-501001/i.test(msg)) {
        result.push({ name: name, status: 'exists' })
      } else {
        result.push({ name: name, status: 'failed', error: msg })
      }
    }
  }

  const failed = result.filter(function (r) { return r.status === 'failed' })
  return {
    ok: failed.length === 0,
    data: {
      collections: result,
      note: failed.length === 0
        ? '集合已就绪。下一步去「数据库 → readings → 索引管理」建 2 个索引（见回复里的说明）'
        : '有集合创建失败，看 collections 里的 error'
    }
  }
}
