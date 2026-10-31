// utils/mock.js
// 棚迹 仿真数据层（演示模式）
// 包含：地块、农户、采购商、农产品批次、农事记录（带环境快照）、消费者反馈、
//       地块环境历史、食品检验标准参考库、食品检测结果
// 四类传感器字段：airTemp（空气温度℃）/ airHumidity（空气湿度%）/ light（光照%）/ soilMoisture（土壤湿度%）
// 所有演示数据均标注 source:'demo'，页面必须显示【演示模拟数据】，接入硬件后以真实上报为准

const util = require('./util.js')
const ai = require('./ai.js')
const credit = require('./credit.js')

const STORAGE_KEY = 'pengji_mock_v6'

// ---------- 仿真农田环境生成（四类参数） ----------
/**
 * 生成某地块的环境历史曲线（演示模式；真实数据由 ESP32 WiFi 上报）
 * 每天 1 条：空气温度 / 空气湿度 / 光照 / 土壤湿度
 */
function genEnvHistory(plotId, startTs, endTs, profile) {
  const data = []
  const oneDay = 86400000
  const totalDays = Math.round((endTs - startTs) / oneDay)
  const step = totalDays > 120 ? 7 : 1
  for (let i = 0; i <= totalDays; i += step) {
    const ts = startTs + i * oneDay
    const dayOfYear = Math.floor((ts - new Date(new Date(ts).getFullYear(), 0, 0).getTime()) / oneDay)
    const seasonal = Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365) // 夏高冬低
    const airTemp = +(profile.baseTemp + seasonal * (profile.tempAmp || 12) + 4 + (Math.random() - 0.5) * 2.5).toFixed(1)
    const airHumidity = +util.clamp((profile.baseHumidity || 65) - seasonal * 10 + (Math.random() - 0.5) * 12, 25, 95).toFixed(0)
    const light = +util.clamp((profile.baseLight || 60) + seasonal * 15 + (Math.random() - 0.5) * 15, 10, 100).toFixed(0)
    const soilMoisture = +util.clamp((profile.baseSoil || 62) - seasonal * 8 + (Math.random() - 0.5) * 8, 25, 92).toFixed(0)
    data.push({ ts, date: util.formatDate(ts), airTemp, airHumidity, light, soilMoisture, source: 'demo', plotId })
  }
  return data
}

// 在地块环境历史中找与某日期最接近的一条（用作农事记录环境快照）
function _closestEnv(envHistory, dateStr) {
  if (!envHistory || !envHistory.length) return null
  const target = util.parseDate(dateStr)
  let best = envHistory[0], bestDiff = Infinity
  envHistory.forEach(e => {
    const diff = Math.abs(util.parseDate(e.date) - target)
    if (diff < bestDiff) { bestDiff = diff; best = e }
  })
  return { airTemp: best.airTemp, airHumidity: best.airHumidity, light: best.light, soilMoisture: best.soilMoisture, source: 'demo', date: best.date }
}

// ---------- 种子数据 ----------
function buildSeed() {
  const now = Date.now()
  const today = util.formatDate(now)

  // 农户
  const farmers = [
    { farmerId: 'F-001', name: '张老汉', village: '王家村', avatarColor: '#8B6520', joinedAt: '2024-03-12',
      bio: '种了三十年地，去年开始转型生态种植。', violations: 0, promiseSigned: true, farmingCompleteRate: 92 },
    { farmerId: 'F-002', name: '王秀英', village: '王家村', avatarColor: '#2E8A5C', joinedAt: '2024-01-20',
      bio: '王家村 2 号地大棚主理人，主打草莓 + 西红柿轮作。', violations: 0, promiseSigned: true, farmingCompleteRate: 88 },
    { farmerId: 'F-003', name: '李建国', village: '李家村', avatarColor: '#B23B34', joinedAt: '2024-06-01',
      bio: '李家村两块地，曾因萝卜批次虚假标注被扣信用分。', violations: 1, promiseSigned: false, farmingCompleteRate: 70 },
    { farmerId: 'F-004', name: '赵桂花', village: '赵家村', avatarColor: '#B4802F', joinedAt: '2023-09-15',
      bio: '老牌种植户，连续三年五星农户。', violations: 0, promiseSigned: true, farmingCompleteRate: 98 }
  ]

  // 采购商（检测与审核者）
  const buyers = [
    { buyerId: 'BY-001', name: '中原农批采购站', contact: '张采购', org: '中原农产品批发市场' },
    { buyerId: 'BY-002', name: '绿链食品采购有限公司', contact: '李品控', org: '绿链食品科技' }
  ]

  // 地块（envProfile：空气温度基准/年振幅/空气湿度基准/光照基准/土壤湿度基准）
  // organicSince：有机转换期起始日期（开始按有机方式管理、停用化学合成投入品的日期）
  // bufferZone：是否设置隔离缓冲带（防止周边常规地块禁用物质漂移）
  // soilMonitor：土壤肥力监测（有机质/有效氮磷钾/阳离子交换量，仅培肥监测，不作强制判定）
  const plots = [
    { plotId: 'WJC-001', name: '王家村 1 号地', village: '王家村', area: 2.5, soilType: '黄壤土', farmerId: 'F-001',
      cropIcon: 'corn',
      establishedAt: '2024-03-15', rotation: '玉米 → 大豆 → 玉米（两年三熟轮作）', photos: [],
      organicSince: '2023-05-01',
      bufferZone: { has: true, desc: '与东侧常规地块之间设 4 米缓冲带，种植香根草隔离' },
      location: { latitude: 34.751, longitude: 113.631, address: '河南省郑州市王家村东侧' },
      envProfile: { baseTemp: 18, tempAmp: 14, baseHumidity: 60, baseLight: 55, baseSoil: 58 } },
    { plotId: 'WJC-002', name: '王家村 2 号地', village: '王家村', area: 1.8, soilType: '沙壤土', farmerId: 'F-002',
      cropIcon: 'fruit',
      establishedAt: '2024-01-25', rotation: '草莓 → 西红柿 → 黄瓜（一年两茬轮作）', photos: [],
      organicSince: '2023-03-01',
      bufferZone: { has: true, desc: '大棚区四周设 6 米缓冲带，全程覆盖防虫网与外界隔离' },
      soilMonitor: { organicMatter: '2.8', availN: '96 mg/kg', availP: '32 mg/kg', availK: '135 mg/kg', cec: '14.6' },
      location: { latitude: 34.752, longitude: 113.633, address: '河南省郑州市王家村大棚区 2 号' },
      envProfile: { baseTemp: 19, tempAmp: 12, baseHumidity: 70, baseLight: 65, baseSoil: 65 }, isHighlight: true },
    { plotId: 'LJC-001', name: '李家村 1 号地', village: '李家村', area: 3.0, soilType: '黏土', farmerId: 'F-003',
      cropIcon: 'leafy',
      establishedAt: '2024-06-05', rotation: '大白菜 → 茄子（一年两茬）', photos: [],
      organicSince: '2025-08-01',
      bufferZone: { has: false, desc: '' },
      location: { latitude: 34.738, longitude: 113.652, address: '河南省郑州市李家村北洼地' },
      envProfile: { baseTemp: 17, tempAmp: 15, baseHumidity: 65, baseLight: 50, baseSoil: 70 } },
    { plotId: 'LJC-002', name: '李家村 2 号地', village: '李家村', area: 2.2, soilType: '沙壤土', farmerId: 'F-003',
      cropIcon: 'seedling',
      establishedAt: '2024-06-05', rotation: '萝卜 → 茄子（一年两茬）', photos: [],
      organicSince: '2025-04-01',
      bufferZone: { has: false, desc: '' },
      location: { latitude: 34.740, longitude: 113.655, address: '河南省郑州市李家村河滩地' },
      envProfile: { baseTemp: 18, tempAmp: 14, baseHumidity: 55, baseLight: 60, baseSoil: 60 } },
    { plotId: 'ZJC-001', name: '赵家村果园 1 号', village: '赵家村', area: 5.0, soilType: '果园壤土', farmerId: 'F-004',
      cropIcon: 'fruit',
      establishedAt: '2023-09-20', rotation: '苹果长期连作（果园多年生）', photos: [],
      organicSince: '2020-03-01',
      bufferZone: { has: true, desc: '果园四周保留 8 米草本缓冲带与天然沟渠，与周边农田隔离' },
      location: { latitude: 34.726, longitude: 113.610, address: '河南省郑州市赵家村坡地果园' },
      envProfile: { baseTemp: 16, tempAmp: 12, baseHumidity: 55, baseLight: 70, baseSoil: 55 } }
  ]

  // 生成 180 天四类传感器环境历史
  plots.forEach(p => {
    p.envHistory = genEnvHistory(p.plotId, now - 180 * 86400000, now, p.envProfile)
    delete p.envProfile
  })

  // 批次档案
  const batches = [
    { batchId: 'B-001', productName: '西红柿', category: '茄果类', plotId: 'WJC-002', farmerId: 'F-002',
      plantDate: '2026-08-01', harvestDate: null, status: '种植中', stage: '结果期',
      growthCycle: [
        { stage: '播种期', date: '2026-08-01', desc: '育苗盘播种，遮阳保湿' },
        { stage: '幼苗期', date: '2026-08-12', desc: '两叶一心，移栽定植' },
        { stage: '生长期', date: '2026-08-28', desc: '吊蔓整枝，控水蹲苗' },
        { stage: '结果期', date: '2026-09-05', desc: '第一穗果坐住，加大水肥' }
      ],
      location: { latitude: 34.752, longitude: 113.633, address: '河南省郑州市王家村大棚区 2 号' },
      aiReport: null, estYield: '1200 kg', seedSource: '本地农技站 樱桃番茄种',
      certifications: ['绿色食品认证'],
      inputs: [
        { date: '2026-08-05', name: '腐熟羊粪', type: '有机肥', amount: '300 kg/亩' },
        { date: '2026-08-28', name: '水溶肥(平衡型)', type: '肥料', amount: '5 kg/亩' }
      ] },
    { batchId: 'B-002', productName: '草莓', category: '浆果类', plotId: 'WJC-002', farmerId: 'F-002',
      plantDate: '2026-05-10', harvestDate: '2026-07-25', status: '已收获', stage: '已收获',
      growthCycle: [
        { stage: '播种期', date: '2026-05-10', desc: '红颜草莓苗定植' },
        { stage: '生长期', date: '2026-06-01', desc: '匍匐茎整理，疏叶' },
        { stage: '开花期', date: '2026-06-20', desc: '放蜂授粉' },
        { stage: '结果期', date: '2026-07-05', desc: '果实转色，控水提糖' },
        { stage: '包装', date: '2026-07-24', desc: '分级包装，张贴溯源二维码' },
        { stage: '已收获', date: '2026-07-25', desc: '采收完成' }
      ],
      location: { latitude: 34.752, longitude: 113.633, address: '河南省郑州市王家村大棚区 2 号' },
      estYield: '580 kg', seedSource: '红颜草莓苗',
      certifications: ['绿色食品认证'],
      inputs: [
        { date: '2026-05-12', name: '商品有机肥', type: '有机肥', amount: '500 kg/亩' },
        { date: '2026-06-25', name: '豆粕有机肥', type: '有机肥', amount: '60 kg/亩' }
      ] },
    { batchId: 'B-003', productName: '黄瓜', category: '瓜类', plotId: 'WJC-002', farmerId: 'F-002',
      plantDate: '2025-09-15', harvestDate: '2025-11-20', status: '已收获', stage: '已收获',
      growthCycle: [
        { stage: '播种期', date: '2025-09-15', desc: '津优 35 号直播' },
        { stage: '生长期', date: '2025-10-05', desc: '吊蔓，打侧枝' },
        { stage: '结果期', date: '2025-10-25', desc: '根瓜采收' },
        { stage: '已收获', date: '2025-11-20', desc: '盛果期集中采收' }
      ],
      location: { latitude: 34.752, longitude: 113.633, address: '河南省郑州市王家村大棚区 2 号' },
      estYield: '900 kg', seedSource: '津优 35 号', certifications: [],
      inputs: [{ date: '2025-09-20', name: '复合肥', type: '肥料', amount: '25 kg/亩' }] },
    { batchId: 'B-004', productName: '玉米', category: '粮食类', plotId: 'WJC-001', farmerId: 'F-001',
      plantDate: '2026-06-01', harvestDate: '2026-08-25', status: '已收获', stage: '已收获',
      growthCycle: [
        { stage: '土地准备', date: '2026-05-25', desc: '深翻整地，施底肥' },
        { stage: '播种期', date: '2026-06-01', desc: '郑单 958 精量播种' },
        { stage: '幼苗期', date: '2026-06-15', desc: '三叶期间苗' },
        { stage: '生长期', date: '2026-07-10', desc: '大喇叭口期追穗肥' },
        { stage: '已收获', date: '2026-08-25', desc: '籽粒变硬，机械收获' }
      ],
      location: { latitude: 34.751, longitude: 113.631, address: '河南省郑州市王家村东侧' },
      estYield: '1500 kg', seedSource: '郑单 958', certifications: ['绿色食品认证'],
      inputs: [{ date: '2026-05-26', name: '缓释肥', type: '肥料', amount: '40 kg/亩' }] },
    { batchId: 'B-005', productName: '大白菜', category: '叶菜类', plotId: 'LJC-001', farmerId: 'F-003',
      plantDate: '2026-08-20', harvestDate: null, status: '种植中', stage: '幼苗期',
      growthCycle: [
        { stage: '播种期', date: '2026-08-20', desc: '北京新三号直播' },
        { stage: '幼苗期', date: '2026-08-30', desc: '两片子叶展平，查苗补苗' }
      ],
      location: { latitude: 34.738, longitude: 113.652, address: '河南省郑州市李家村北洼地' },
      estYield: '2000 kg', seedSource: '北京新三号', certifications: [], inputs: [] },
    { batchId: 'B-006', productName: '茄子', category: '茄果类', plotId: 'LJC-002', farmerId: 'F-003',
      plantDate: '2026-04-10', harvestDate: '2026-07-15', status: '已收获', stage: '已收获',
      growthCycle: [
        { stage: '播种期', date: '2026-04-10', desc: '紫长茄育苗移栽' },
        { stage: '生长期', date: '2026-05-10', desc: '双干整枝' },
        { stage: '结果期', date: '2026-06-05', desc: '门茄瞪眼，追膨果肥' },
        { stage: '已收获', date: '2026-07-15', desc: '分批采收结束' }
      ],
      location: { latitude: 34.740, longitude: 113.655, address: '河南省郑州市李家村河滩地' },
      estYield: '700 kg', seedSource: '紫长茄', certifications: [],
      inputs: [{ date: '2026-04-15', name: '农家肥', type: '有机肥', amount: '200 kg/亩' }] },
    { batchId: 'B-007', productName: '萝卜', category: '根茎类', plotId: 'LJC-002', farmerId: 'F-003',
      plantDate: '2025-10-05', harvestDate: '2025-12-30', status: '已收获', stage: '已收获',
      growthCycle: [
        { stage: '播种期', date: '2025-10-05', desc: '白玉春穴播' },
        { stage: '生长期', date: '2025-11-10', desc: '肉质根膨大期' },
        { stage: '已收获', date: '2025-12-30', desc: '霜降前采收完毕' }
      ],
      location: { latitude: 34.740, longitude: 113.655, address: '河南省郑州市李家村河滩地' },
      estYield: '1100 kg', seedSource: '白玉春', certifications: [],
      inputs: [], flag: '违规' },
    { batchId: 'B-008', productName: '苹果', category: '浆果类', plotId: 'ZJC-001', farmerId: 'F-004',
      plantDate: '2025-08-01', harvestDate: '2025-10-20', status: '已收获', stage: '已收获',
      growthCycle: [
        { stage: '开花期', date: '2025-04-15', desc: '盛花期人工授粉' },
        { stage: '生长期', date: '2025-06-10', desc: '套袋防虫' },
        { stage: '结果期', date: '2025-09-10', desc: '摘袋着色' },
        { stage: '已收获', date: '2025-10-20', desc: '分级采收入库' }
      ],
      location: { latitude: 34.726, longitude: 113.610, address: '河南省郑州市赵家村坡地果园' },
      estYield: '4500 kg', seedSource: '红富士嫁接苗',
      certifications: ['绿色食品认证', '地理标志'],
      inputs: [
        { date: '2025-03-20', name: '腐熟牛粪', type: '有机肥', amount: '800 kg/亩' },
        { date: '2025-08-15', name: '钙镁磷肥', type: '肥料', amount: '30 kg/亩' }
      ] }
  ]

  // 农事记录（每条绑定当时刻三类传感器环境快照 + 数据来源）
  const records = []
  let rid = 1
  batches.forEach(b => {
    const n = util.randInt(3, 5)
    const plantTs = util.parseDate(b.plantDate)
    const endTs = b.harvestDate ? util.parseDate(b.harvestDate) : now
    const span = Math.max(1, (endTs - plantTs) / 86400000)
    const plot = plots.find(p => p.plotId === b.plotId)
    for (let i = 0; i < n; i++) {
      const dayOffset = Math.floor(span * (i + 0.5) / n)
      const date = util.formatDate(plantTs + dayOffset * 86400000)
      let type, content, cost
      switch (i) {
        case 0: type = '播种'; content = `播种 ${b.productName}，行距 40cm，密度合理。`; cost = 80; break
        case 1: type = '施肥'; content = `施用腐熟有机肥 200kg，配合复合肥。`; cost = 150; break
        case 2: type = '灌溉'; content = `滴灌 2 小时，保持土壤墒情。`; cost = 30; break
        case 3: type = '除草'; content = `人工拔除杂草，未使用除草剂。`; cost = 50; break
        default: type = b.status === '已收获' ? '收获' : '防治'; content = b.status === '已收获' ? `采收 ${b.productName}，分级包装。` : `生物防治蚜虫，悬挂黄板。`; cost = 60
      }
      records.push({
        recordId: 'R-' + String(rid++).padStart(3, '0'),
        plotId: b.plotId, batchId: b.batchId, farmerId: b.farmerId,
        type, date, content, cost, createdAt: util.parseDate(date),
        envSnapshot: _closestEnv(plot.envHistory, date)  // 关键农事记录绑定当时刻环境数据
      })
    }
  })

  // 消费者反馈
  const reviews = [
    { reviewId: 'RV-001', farmerId: 'F-002', batchId: 'B-002', buyerName: '社区团购-小李', rating: 5, content: '草莓又大又甜，下次还买！', date: '2026-07-28' },
    { reviewId: 'RV-002', farmerId: 'F-002', batchId: 'B-002', buyerName: '老主顾', rating: 5, content: '王姐家的草莓从来没让人失望。', date: '2026-07-30' },
    { reviewId: 'RV-003', farmerId: 'F-002', batchId: 'B-003', buyerName: '匿名买家', rating: 4, content: '黄瓜不错，就是有些弯。', date: '2025-11-22' },
    { reviewId: 'RV-004', farmerId: 'F-001', batchId: 'B-004', buyerName: '粮站', rating: 4, content: '玉米颗粒饱满，水分略高。', date: '2026-08-27' },
    { reviewId: 'RV-005', farmerId: 'F-004', batchId: 'B-008', buyerName: '果商王总', rating: 5, content: '苹果糖度高、着色好，全收了。', date: '2025-10-22' },
    { reviewId: 'RV-006', farmerId: 'F-004', batchId: 'B-008', buyerName: '社区团长', rating: 5, content: '老赵家的苹果是村里招牌。', date: '2025-10-25' },
    { reviewId: 'RV-007', farmerId: 'F-003', batchId: 'B-006', buyerName: '匿名买家', rating: 3, content: '茄子偏小，但没打药。', date: '2026-07-16' },
    { reviewId: 'RV-008', farmerId: 'F-003', batchId: 'B-007', buyerName: '匿名买家', rating: 2, content: '萝卜标注产地与实际不符。', date: '2025-12-31', flag: '违规批次' }
  ]

  // 食品检验标准参考库（本地演示标准样例，非官方实时数据库）
  const standards = [
    { stdId: 'STD-001', code: 'GB 2763-2021', name: '食品安全国家标准 食品中农药最大残留限量',
      scope: '适用于各类新鲜蔬菜、水果等农产品中农药残留判定',
      items: [
        { name: '毒死蜱（叶菜类）', limit: '0.02', unit: 'mg/kg' },
        { name: '氯氰菊酯（叶菜类）', limit: '2', unit: 'mg/kg' },
        { name: '多菌灵（茄果类）', limit: '3', unit: 'mg/kg' }
      ], isDemo: true },
    { stdId: 'STD-002', code: 'GB 2762-2022', name: '食品安全国家标准 食品中污染物限量',
      scope: '适用于食品中铅、镉等重金属污染物限量判定',
      items: [
        { name: '铅（新鲜蔬菜）', limit: '0.1', unit: 'mg/kg' },
        { name: '镉（叶菜蔬菜）', limit: '0.2', unit: 'mg/kg' },
        { name: '铅（新鲜水果）', limit: '0.1', unit: 'mg/kg' }
      ], isDemo: true },
    { stdId: 'STD-003', code: 'NY/T 391-2021', name: '绿色食品 产地环境质量',
      scope: '绿色食品产地土壤、灌溉水、空气质量要求',
      items: [
        { name: '土壤 pH 适宜范围', limit: '5.5~7.5', unit: '-' },
        { name: '土壤镉限值', limit: '0.3', unit: 'mg/kg' },
        { name: '土壤铅限值', limit: '50', unit: 'mg/kg' }
      ], isDemo: true },
    { stdId: 'STD-004', code: 'GB 5009.12-2017', name: '食品安全国家标准 食品中铅的测定',
      scope: '规定了食品中铅含量的石墨炉原子吸收测定方法',
      items: [{ name: '方法检出限', limit: '0.02', unit: 'mg/kg' }], isDemo: true }
  ]

  // 食品检测结果（由采购商录入；演示数据）
  const inspections = [
    { inspId: 'IN-001', batchId: 'B-002', buyerId: 'BY-001', buyerName: '中原农批采购站',
      standard: 'GB 2763-2021', org: '郑州市农产品质量检测中心', date: '2026-07-24', conclusion: '合格',
      items: [
        { name: '毒死蜱', result: '未检出', limit: '0.02 mg/kg', conclusion: '合格' },
        { name: '氯氰菊酯', result: '0.05 mg/kg', limit: '≤2 mg/kg', conclusion: '合格' },
        { name: '铅', result: '0.03 mg/kg', limit: '≤0.1 mg/kg', conclusion: '合格' }
      ], isDemo: true },
    { inspId: 'IN-002', batchId: 'B-008', buyerId: 'BY-002', buyerName: '绿链食品采购有限公司',
      standard: 'GB 2762-2022', org: '河南华测检测技术有限公司', date: '2025-10-18', conclusion: '合格',
      items: [
        { name: '铅', result: '0.02 mg/kg', limit: '≤0.1 mg/kg', conclusion: '合格' },
        { name: '镉', result: '0.01 mg/kg', limit: '≤0.05 mg/kg', conclusion: '合格' }
      ], isDemo: true },
    { inspId: 'IN-003', batchId: 'B-004', buyerId: 'BY-001', buyerName: '中原农批采购站',
      standard: 'GB 2763-2021', org: '中牟县农技推广中心快检室', date: '2026-08-24', conclusion: '合格',
      items: [
        { name: '有机磷类农残', result: '抑制率 8%', limit: '抑制率≤50%', conclusion: '合格' }
      ], isDemo: true }
    // B-001 种植中暂无检测数据；B-005/B-006/B-007 无检测记录
  ]

  // AI 环境报告补齐（基于各地块近 30 条传感器历史）+ 环境快照
  batches.forEach(b => {
    const plot = plots.find(p => p.plotId === b.plotId)
    const recent = (plot.envHistory || []).slice(-30)
    b.aiReport = ai.analyzeEnvironment(recent, b.productName)
    b.envSnapshot = recent.length ? recent[recent.length - 1] : null
  })

  // 农户信用评价（统一调用 credit.js：GB/T 23794-2023 三维度 + 农安信用分级实践）
  farmers.forEach(f => credit.evaluateFarmer({ farmers, plots, batches, records, reviews, inspections }, f))

  return { version: 8, generatedAt: now, today, farmers, buyers, plots, batches, records, reviews, standards, inspections, preorders: [] }
}

// ---------- 持久化 ----------
function load() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { console.warn('[棚迹] 读取本地数据失败', e) }
  return null
}
function save(data) {
  try { wx.setStorageSync(STORAGE_KEY, JSON.stringify(data)) } catch (e) { console.warn('[棚迹] 写入本地数据失败', e) }
}
function initMockData() {
  let data = load()
  // 版本不一致时重建（版本从 6 → 7 升级时自动重建）
  if (!data || data.version < 8) { data = buildSeed(); save(data) }
  return data
}
function resetMockData() {
  const data = buildSeed(); save(data); return data
}

module.exports = {
  initMockData, resetMockData, load, save, STORAGE_KEY,
  _genEnvHistoryForNewPlot: function (plotId, startTs, endTs, profile) {
    return genEnvHistory(plotId, startTs, endTs, profile)
  }
}
