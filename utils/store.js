// utils/store.js
// 棚迹 数据访问层
// 所有页面通过此模块读写数据；真实部署时仅需将内部实现替换为 wx.cloud.callFunction / wx.cloud.database()
// 接口保持不变，页面无需改动 —— 这是「云开发即可实现、可平滑迁移」的设计
//
// 核心链路：传感器采集 → AI 分析生产环境 → 自动生成农产品档案 → 二维码绑定 → 消费者扫码/反馈 → 数据返回农户

const mock = require('./mock.js')
const util = require('./util.js')
const ai = require('./ai.js')
const credit = require('./credit.js')

function _db() {
  return mock.load() || mock.initMockData()
}

function _persist(data) {
  mock.save(data)
}

// 重新计算农户信用分（统一调用 credit.js 权威评价模型，全项目唯一口径）
// 触发时机：新增农事记录 / 消费者反馈 / 标记违规 / 检测录入后
function _recalcFarmer(data, farmerId) {
  const f = data.farmers.find(x => x.farmerId === farmerId)
  if (!f) return
  credit.evaluateFarmer(data, f)
}

// ========== 地块相关 ==========

/** 地块列表（带农户名 + 当前作物） */
function listPlots() {
  const data = _db()
  return data.plots.map(p => {
    const f = data.farmers.find(x => x.farmerId === p.farmerId)
    const batchCount = data.batches.filter(b => b.plotId === p.plotId).length
    const growing = data.batches.find(b => b.plotId === p.plotId && b.status === '种植中')
    // 回退策略：先找种植中的批次，再从 rotation 第一个作物，再从最新批次
    let currentCrop = ''
    if (growing) {
      currentCrop = growing.productName
    } else if (p.rotation) {
      const rot = p.rotation.split('→')[0].split('（')[0].trim()
      currentCrop = rot
    } else {
      const latest = data.batches.filter(b => b.plotId === p.plotId).sort((a, b) => (b.plantDate || '').localeCompare(a.plantDate || ''))[0]
      currentCrop = latest ? latest.productName : ''
    }
    return {
      ...p,
      farmerName: f ? f.name : '未知',
      farmerStar: f ? f.star : 0,
      batchCount,
      currentCrop
    }
  })
}

/** 地块详情 */
function getPlot(plotId) {
  const data = _db()
  const plot = data.plots.find(p => p.plotId === plotId)
  if (!plot) return null
  const farmer = data.farmers.find(f => f.farmerId === plot.farmerId)
  const batches = data.batches
    .filter(b => b.plotId === plotId)
    .sort((a, b) => util.parseDate(b.plantDate) - util.parseDate(a.plantDate))
  const records = data.records
    .filter(r => r.plotId === plotId)
    .sort((a, b) => util.parseDate(b.date) - util.parseDate(a.date))
  const envRecent = (plot.envHistory || []).slice(-90)
  return { plot, farmer, batches, records, envRecent, envFull: plot.envHistory || [] }
}

/** 地块环境历史曲线（指定时间窗口） */
function getPlotEnvHistory(plotId, days) {
  const data = _db()
  const plot = data.plots.find(p => p.plotId === plotId)
  if (!plot || !plot.envHistory) return []
  if (days && days < plot.envHistory.length) {
    return plot.envHistory.slice(-days)
  }
  return plot.envHistory
}

// ========== 农户相关 ==========

/** 农户列表 */
function listFarmers() {
  const data = _db()
  return data.farmers.map(f => ({ ...f }))
}

/** 农户详情：农户 + 全部批次（带地块名） + 消费者反馈 + 农事记录 */
function getFarmer(farmerId) {
  const data = _db()
  const farmer = data.farmers.find(f => f.farmerId === farmerId)
  if (!farmer) return null
  const batches = data.batches
    .filter(b => b.farmerId === farmerId)
    .map(b => {
      const p = data.plots.find(x => x.plotId === b.plotId)
      return { ...b, plotName: p ? p.name : '未知', village: p ? p.village : '' }
    })
    .sort((a, b) => util.parseDate(b.plantDate) - util.parseDate(a.plantDate))
  const reviews = data.reviews
    .filter(r => r.farmerId === farmerId)
    .sort((a, b) => util.parseDate(b.date) - util.parseDate(a.date))
  const records = data.records
    .filter(r => r.farmerId === farmerId)
    .sort((a, b) => util.parseDate(b.date) - util.parseDate(a.date))
  return { farmer, batches, reviews, records }
}

// ========== 批次/溯源相关 ==========

/** 批次详情（溯源结果页核心） */
function getBatch(batchId) {
  const data = _db()
  const batch = data.batches.find(b => b.batchId === batchId)
  if (!batch) return null
  const plot = data.plots.find(p => p.plotId === batch.plotId)
  const farmer = data.farmers.find(f => f.farmerId === batch.farmerId)
  const records = data.records
    .filter(r => r.batchId === batchId)
    .sort((a, b) => util.parseDate(a.date) - util.parseDate(b.date))
  const reviews = data.reviews.filter(r => r.batchId === batchId)
  const siblingBatches = data.batches
    .filter(b => b.plotId === batch.plotId && b.batchId !== batchId)
    .sort((a, b) => util.parseDate(b.plantDate) - util.parseDate(a.plantDate))
  return { batch, plot, farmer, records, reviews, siblingBatches }
}

/** 扫码溯源：根据溯源码（=批次号）查询 */
function traceByCode(code) {
  return getBatch(code)
}

/** 全部批次列表 */
function listBatches() {
  const data = _db()
  return data.batches.map(b => {
    const p = data.plots.find(x => x.plotId === b.plotId)
    const f = data.farmers.find(x => x.farmerId === b.farmerId)
    return { ...b, plotName: p ? p.name : '', farmerName: f ? f.name : '' }
  })
}

/** 列出某农户名下的地块（农户视角） */
function listPlotsByFarmer(farmerId) {
  const data = _db()
  return data.plots
    .filter(p => p.farmerId === farmerId)
    .map(p => {
      const batchCount = data.batches.filter(b => b.plotId === p.plotId).length
      const growing = data.batches.find(b => b.plotId === p.plotId && b.status === '种植中')
      let currentCrop = ''
      if (growing) {
        currentCrop = growing.productName
      } else if (p.rotation) {
        const rot = p.rotation.split('→')[0].split('（')[0].trim()
        currentCrop = rot
      } else {
        const latest = data.batches.filter(b => b.plotId === p.plotId).sort((a, b) => (b.plantDate || '').localeCompare(a.plantDate || ''))[0]
        currentCrop = latest ? latest.productName : ''
      }
      return { ...p, batchCount, currentCrop }
    })
}

/** 农户是否可编辑某地块（必须是自己的） */
function canEditPlot(farmerId, plotId) {
  const data = _db()
  const p = data.plots.find(x => x.plotId === plotId)
  return !!p && p.farmerId === farmerId
}

// ========== 写操作 ==========

/** 新增地块（农户身份） */
function addPlot(payload, farmerId) {
  const data = _db()
  const ts = Date.now()
  const plot = {
    plotId: payload.plotId || ('P-' + ts.toString(36).toUpperCase()),
    name: payload.name || '未命名地块',
    village: payload.village || '',
    area: Number(payload.area) || 0,
    soilType: payload.soilType || '未标注',
    rotation: payload.rotation || '',
    photos: Array.isArray(payload.photos) ? payload.photos : [],
    location: payload.location || null,
    // 有机管理档案：转换期起始日期 + 隔离缓冲带
    organicSince: payload.organicSince || '',
    bufferZone: payload.bufferZone || { has: false, desc: '' },
    farmerId,
    establishedAt: util.formatDate(),
    envProfile: { baseTemp: 18, tempAmp: 12, baseHumidity: 60, baseLight: 55, baseSoil: 62 },
    envHistory: []
  }
  // 同步生成空环境历史的起始点（演示模式兜底；真实数据以传感器上报为准）
  const endTs = ts
  const startTs = ts - 7 * 86400000
  plot.envHistory = mock._genEnvHistoryForNewPlot(plot.plotId, startTs, endTs, plot.envProfile)
  data.plots.push(plot)
  _persist(data)
  return plot
}

/** 更新地块（农户身份，需校验归属） */
function updatePlot(plotId, payload, farmerId) {
  const data = _db()
  const plot = data.plots.find(p => p.plotId === plotId)
  if (!plot) return null
  if (plot.farmerId !== farmerId) return null // 越权
  if (payload.name !== undefined) plot.name = payload.name
  if (payload.village !== undefined) plot.village = payload.village
  if (payload.area !== undefined) plot.area = Number(payload.area)
  if (payload.soilType !== undefined) plot.soilType = payload.soilType
  if (payload.rotation !== undefined) plot.rotation = payload.rotation
  if (payload.location !== undefined) plot.location = payload.location
  if (payload.organicSince !== undefined) plot.organicSince = payload.organicSince
  if (payload.bufferZone !== undefined) plot.bufferZone = payload.bufferZone
  if (Array.isArray(payload.photos)) plot.photos = payload.photos
  plot.updatedAt = util.formatDateTime()
  _persist(data)
  return plot
}

/** 追加地块照片（增量上传，照片必须带定位） */
function appendPlotPhotos(plotId, photos, farmerId) {
  const data = _db()
  const plot = data.plots.find(p => p.plotId === plotId)
  if (!plot || plot.farmerId !== farmerId) return null
  plot.photos = (plot.photos || []).concat(photos)
  plot.updatedAt = util.formatDateTime()
  _persist(data)
  return plot
}

/**
 * 自动生成农产品档案（核心链路：AI 分析 → 自动建档 → 二维码绑定）
 * 仅农户可调用；页面需先获取传感器最新读数与拍照定位
 * @param {Object} payload { plotId, productName, category, plantDate, expectedHarvest, stage,
 *                           growthCycle:[{stage,date,desc}], location:{latitude,longitude,address},
 *                           photos:[{path,location,date}], envSnapshot:{airTemp,airHumidity,light,soilMoisture,source} }
 * @param {string} farmerId 当前农户
 * @returns batch 档案
 */
function addProductBatch(payload, farmerId) {
  const data = _db()
  const plot = data.plots.find(p => p.plotId === payload.plotId)
  if (!plot || plot.farmerId !== farmerId) return null // 仅本人地块可上传

  // 批次号（=溯源码=二维码内容）
  const seq = data.batches.length + 1
  const batchId = 'B-' + String(seq).padStart(3, '0')

  // AI 分析生产环境 → 自动生成环境报告
  const readings = payload.envSnapshot ? [payload.envSnapshot] : []
  const report = ai.analyzeEnvironment(payload.productName, readings)

  const batch = {
    batchId,
    productName: payload.productName || '未命名农产品',
    category: payload.category || ai._guessCategory(payload.productName),
    plotId: payload.plotId,
    farmerId,
    plantDate: payload.plantDate || util.formatDate(),
    harvestDate: null,
    status: '种植中',
    stage: payload.stage || '播种期',
    growthCycle: Array.isArray(payload.growthCycle) ? payload.growthCycle : [],
    location: payload.location || null,       // 种植地点（GPS 防伪）
    photos: Array.isArray(payload.photos) ? payload.photos : [], // 每张照片带定位
    envSnapshot: payload.envSnapshot || null, // 传感器环境快照
    aiReport: report,                         // AI 环境分析报告
    createdAt: util.formatDateTime(),
    estYield: payload.estYield || '',
    seedSource: payload.seedSource || '',
    certifications: []
  }
  data.batches.push(batch)

  // 同步追加一条「建档」农事记录，串联农事链路（绑定当时刻传感器快照）
  data.records.push({
    recordId: 'R-' + String(data.records.length + 1).padStart(3, '0'),
    plotId: payload.plotId, batchId, farmerId,
    type: '播种',
    date: batch.plantDate,
    content: `自动建档：${batch.productName}，二维码 ${batchId} 已绑定，环境评价「${report.levelText}」。`,
    cost: 0,
    envSnapshot: payload.envSnapshot || null,
    createdAt: Date.now()
  })

  _recalcFarmer(data, farmerId)
  _persist(data)
  return batch
}

/** 收获一个批次（农户） */
function harvestBatch(batchId, farmerId) {
  const data = _db()
  const batch = data.batches.find(b => b.batchId === batchId)
  if (!batch || batch.farmerId !== farmerId) return null
  batch.status = '已收获'
  batch.stage = '已收获'
  batch.harvestDate = util.formatDate()
  batch.growthCycle = (batch.growthCycle || []).concat([
    { stage: '已收获', date: batch.harvestDate, desc: '采收完成，档案封存' }
  ])
  _persist(data)
  return batch
}

/** 传感器读数入库：追加到地块环境历史（四参数：空气温度/空气湿度/光照/土壤湿度） */
function addSensorReading(plotId, reading) {
  const data = _db()
  const plot = data.plots.find(p => p.plotId === plotId)
  if (!plot) return null
  plot.envHistory = plot.envHistory || []
  plot.envHistory.push({
    ts: reading.ts || Date.now(),
    date: reading.date || util.formatDateTime(reading.ts),
    airTemp: +(+reading.airTemp).toFixed(1),
    airHumidity: +(+reading.airHumidity).toFixed(0),
    light: +(+reading.light).toFixed(0),
    soilMoisture: +(+reading.soilMoisture).toFixed(1),
    source: reading.source || 'demo',
    deviceId: reading.deviceId || '',
    plotId
  })
  // 控制体积：最多保留 400 条
  if (plot.envHistory.length > 400) plot.envHistory = plot.envHistory.slice(-400)
  _persist(data)
  return plot.envHistory[plot.envHistory.length - 1]
}

/** 新增农事记录（仅农户；可附带当时刻四类传感器环境快照 + 数据来源） */
function addRecord(payload) {
  const data = _db()
  const record = {
    recordId: 'R-' + String(data.records.length + 1).padStart(3, '0'),
    plotId: payload.plotId,
    batchId: payload.batchId,
    farmerId: payload.farmerId,
    type: payload.type,
    date: payload.date || util.formatDate(),
    content: payload.content || '',
    cost: payload.cost || 0,
    envSnapshot: payload.envSnapshot || null,  // 绑定操作时刻：空气温度/空气湿度/光照/土壤湿度/来源
    createdAt: Date.now()
  }
  data.records.push(record)
  _recalcFarmer(data, payload.farmerId)
  _persist(data)
  return record
}

/** 消费者反馈（仅消费者；数据返回农户） */
function addReview(payload) {
  const data = _db()
  const review = {
    reviewId: 'RV-' + String(data.reviews.length + 1).padStart(3, '0'),
    farmerId: payload.farmerId,
    batchId: payload.batchId,
    buyerName: payload.buyerName || '扫码消费者',
    rating: util.clamp(payload.rating || 5, 1, 5),
    content: payload.content || '',
    date: util.formatDate(),
    createdAt: Date.now()
  }
  data.reviews.push(review)
  _recalcFarmer(data, payload.farmerId)
  _persist(data)
  return review
}

/** 注册新农户（身份选择页使用） */
function registerFarmer(name, village) {
  const data = _db()
  const n = data.farmers.length + 1
  const farmer = {
    farmerId: 'F-' + String(n).padStart(3, '0'),
    name: name || '新农户',
    village: village || '',
    avatarColor: '#2E8A5C',
    joinedAt: util.formatDate(),
    bio: '新入驻农户。',
    violations: 0, farmingCompleteRate: 0
  }
  data.farmers.push(farmer)
  _recalcFarmer(data, farmer.farmerId)
  _persist(data)
  return farmer
}

/** 管理员标记批次违规（扣农户信用分） */
function markViolation(batchId, reason) {
  const data = _db()
  const batch = data.batches.find(b => b.batchId === batchId)
  if (!batch) return null
  batch.flag = '违规'
  batch.violationReason = reason
  const farmer = data.farmers.find(f => f.farmerId === batch.farmerId)
  if (farmer) {
    farmer.violations = (farmer.violations || 0) + 1
    _recalcFarmer(data, farmer.farmerId)
  }
  _persist(data)
  return batch
}

/** 重置全部仿真数据 */
function resetAll() {
  return mock.resetMockData()
}

// ========== 采购商 / 食品检测 / 标准库 / OPI ==========

/** 采购商列表 */
function listBuyers() {
  const data = _db()
  return (data.buyers || []).map(b => ({ ...b }))
}

/** 食品检验标准参考库（本地演示标准样例） */
function listStandards() {
  const data = _db()
  return data.standards || []
}

/** 某批次的检测结果列表 */
function listInspections(batchId) {
  const data = _db()
  const list = data.inspections || []
  return batchId ? list.filter(x => x.batchId === batchId) : list
}

/** 采购商录入食品检测结果（仅采购商；不可修改农户原始记录） */
function addInspection(payload) {
  const data = _db()
  if (!data.inspections) data.inspections = []
  const insp = {
    inspId: 'IN-' + String(data.inspections.length + 1).padStart(3, '0'),
    batchId: payload.batchId,
    buyerId: payload.buyerId || 'BY-001',
    buyerName: payload.buyerName || '采购商',
    standard: payload.standard || '',
    org: payload.org || '',
    date: payload.date || util.formatDate(),
    conclusion: payload.conclusion || '合格',
    items: Array.isArray(payload.items) ? payload.items : [],
    isDemo: false,
    createdAt: Date.now()
  }
  data.inspections.push(insp)
  _persist(data)
  return insp
}

/**
 * 采购商核验：批次生产数据完整程度
 * 返回各关键模块是否齐备（不修改任何原始数据）
 */
function getDataCompleteness(batchId) {
  const data = _db()
  const b = data.batches.find(x => x.batchId === batchId)
  if (!b) return null
  const plot = data.plots.find(p => p.plotId === b.plotId)
  const records = data.records.filter(r => r.batchId === batchId)
  const inspections = (data.inspections || []).filter(x => x.batchId === batchId)
  const checks = [
    { key: 'plot', name: '地块与种植地点信息', ok: !!(plot && plot.location) },
    { key: 'cycle', name: '生长周期/生产时间线', ok: (b.growthCycle || []).length >= 3 },
    { key: 'records', name: '农事操作记录', ok: records.length >= 3 },
    { key: 'env', name: '传感器环境数据', ok: (plot && plot.envHistory && plot.envHistory.length > 0) },
    { key: 'qr', name: '溯源二维码绑定', ok: !!b.batchId },
    { key: 'test', name: '食品检测记录', ok: inspections.length > 0 }
  ]
  const passed = checks.filter(c => c.ok).length
  return { checks, passed, total: checks.length, rate: Math.round(passed / checks.length * 100) }
}

// ========== 有机蔬菜生产合规核验 ==========
// 核心强制约束：
//   1. 一年生蔬菜土地转换期不少于 24 个月（多年生果树参考 36 个月）
//   2. 设置隔离缓冲带，防止周边常规地块禁用物质漂移
//   3. 禁止使用化学合成化肥、化学农药、生长调节剂、转基因品种
//   4. 依靠轮作、绿肥、有机肥培肥地力
//   5. 病虫害以物理、生物措施防控
//   6. 生产全过程记录可追溯
//   注：有机质、有效氮磷钾、阳离子交换量(CEC) 不作强制判定指标，仅用于培肥监测
//   注：重金属/污染物检测暂不作为采购商工作台批次风险判定项（GB 15618/GB 5084/GB 3095 土壤环境、灌溉水、空气质量
//       检测属于产地环境条件核验，通常由产地认定环节完成；采购端以生产过程合规性与食品检测为主）
const ORGANIC = {
  // 禁用投入品关键词（化学合成化肥/农药/生长调节剂/转基因）
  PROHIBITED: ['复合肥', '化肥', '尿素', '二铵', '磷酸二铵', '缓释肥', '控释肥', '水溶肥', '冲施肥',
    '生长调节剂', '激素', '赤霉素', '乙烯利', '膨大剂', '转基因',
    '除草剂', '杀虫剂', '杀菌剂', '农药', '毒死蜱', '氯氰菊酯', '多菌灵'],
  // 有机允许/鼓励的培肥方式关键词
  FERTILIZING: ['有机肥', '农家肥', '腐熟', '绿肥', '堆肥', '沼液', '沼渣', '饼肥', '豆粕', '微生物菌', '菌肥', '钙镁磷肥', '草木灰', '轮作'],
  // 物理/生物防控关键词
  PEST_CONTROL: ['黄板', '蓝板', '防虫网', '诱虫灯', '杀虫灯', '性诱', '天敌', '捕食螨', '释放', '生物防治', '套袋', '人工', '清园']
}

// 判断文本中是否"实际使用"了禁用词（排除"未使用/不使用/无"等否定语境与物理设备名）
function _hitProhibited(text, kw) {
  let idx = text.indexOf(kw)
  while (idx >= 0) {
    const before = text.slice(Math.max(0, idx - 6), idx)
    const after = text.slice(idx + kw.length, idx + kw.length + 1)
    const negated = /[未不无禁非]/.test(before)      // 前文含否定词：未使用/不使用/无/严禁/非（转基因）
    const isDevice = after === '灯'                   // 杀虫灯/诱虫灯 属物理设备
    if (!negated && !isDevice) return true
    idx = text.indexOf(kw, idx + 1)
  }
  return false
}

/**
 * 某批次有机蔬菜生产合规核验（采购商评估用，只读不修改原始数据）
 * @returns {{status:'pass'|'warn'|'unknown'|'fail', statusText, cls, checks:Array, convMonths, reqMonths, failCount, unknownCount, warnCount, note}}
 */
function getOrganicCompliance(batchId) {
  const data = _db()
  const b = data.batches.find(x => x.batchId === batchId)
  if (!b) return null
  const plot = data.plots.find(p => p.plotId === b.plotId)
  const records = data.records.filter(r => r.batchId === batchId)
  const inspections = (data.inspections || []).filter(x => x.batchId === batchId)

  // 多年生果树参考 36 个月；一年生蔬菜强制 ≥24 个月
  const isFruitTree = /苹果|梨|桃|柑橘|葡萄|果园/.test(b.productName + ' ' + (plot ? plot.name : ''))
  const reqMonths = isFruitTree ? 36 : 24
  const checks = []

  // 1. 土地转换期
  let convMonths = null
  if (plot && plot.organicSince) {
    convMonths = Math.round((util.parseDate(b.plantDate) - util.parseDate(plot.organicSince)) / (30.44 * 86400000))
  }
  checks.push({
    key: 'conversion', name: isFruitTree ? '土地转换期（多年生作物参考≥36个月）' : '土地转换期（一年生蔬菜≥24个月）',
    required: true,
    status: convMonths === null ? 'unknown' : (convMonths >= reqMonths ? 'pass' : 'fail'),
    detail: convMonths === null
      ? '未填报转换期起始日期，无法核验'
      : `转换期自 ${plot.organicSince} 起，至播种约 ${convMonths} 个月（要求满 ${reqMonths} 个月）`,
    standard: 'GB/T 19630-2019 第4.2.1.1条：一年生植物的转换期至少为播种前的24个月，饲料作物以外的其他多年生植物的转换期至少为收获前的36个月；第4.2.1.4条：转换期内使用禁用物质应重新开始转换。'
  })

  // 2. 隔离缓冲带
  const buf = plot && plot.bufferZone
  checks.push({
    key: 'buffer', name: '隔离缓冲带', required: true,
    status: (buf && buf.has) ? 'pass' : 'fail',
    detail: (buf && buf.has) ? ('已设置：' + (buf.desc || '与周边常规地块设缓冲隔离带')) : '未设置隔离缓冲带，存在周边常规地块禁用物质漂移风险',
    standard: 'GB/T 19630-2019 第4.2条（植物生产）：在有机生产和常规生产区域之间应设置有效的缓冲带或物理屏障，以防止有机生产地块受到禁用物质漂移污染。'
  })

  // 3. 禁用投入品扫描（投入品台账 + 农事记录文本）
  const hits = []
  ;(b.inputs || []).forEach(i => {
    ORGANIC.PROHIBITED.forEach(k => {
      if (_hitProhibited((i.name || '') + (i.type || ''), k)) hits.push(`台账投入品"${i.name}"`)
    })
  })
  records.forEach(r => {
    ORGANIC.PROHIBITED.forEach(k => {
      if (_hitProhibited((r.content || '') + (r.type || ''), k)) hits.push(`${r.date} 农事记录涉及"${k}"`)
    })
  })
  const uniqHits = Array.from(new Set(hits))
  checks.push({
    key: 'prohibited', name: '禁用投入品（化学合成化肥/农药、生长调节剂、转基因）', required: true,
    status: uniqHits.length ? 'fail' : 'pass',
    detail: uniqHits.length ? '发现禁用投入：' + uniqHits.join('；') : '投入品台账与农事记录未发现化学合成化肥、农药、生长调节剂或转基因投入',
    standard: 'GB/T 19630-2019 第4.1.3.1条：不应在有机生产中引入或使用转基因生物及其衍生物（含种子、肥料、植物保护产品、植物生长调节剂等投入品）；第4.1.5.2条：外来投入品仅限标准附录A/附录B列出的物质，化学合成农药、化肥、生长调节剂禁用。'
  })

  // 4. 培肥方式（轮作/绿肥/有机肥）
  const allText = (b.inputs || []).map(i => i.name + (i.type || '')).join(' ')
    + ' ' + records.map(r => (r.type || '') + (r.content || '')).join(' ')
    + ' ' + (b.growthCycle || []).map(g => (g.stage || '') + (g.desc || '')).join(' ')
    + ' ' + (plot ? (plot.rotation || '') : '')
  const fertOk = ORGANIC.FERTILIZING.some(k => allText.indexOf(k) >= 0)
  checks.push({
    key: 'fertilizing', name: '培肥方式（轮作/绿肥/有机肥）', required: true,
    status: fertOk ? 'pass' : 'warn',
    detail: fertOk ? '有有机肥、绿肥还田或轮作等培肥记录' : '未见有机肥、绿肥或轮作培肥记录，需补充地力养护台账',
    standard: 'GB/T 19630-2019 第4.1.5.1条：应选择并实施栽培管理措施，以维持或改善土壤理化和生物性状；培肥以腐熟有机肥、绿肥、轮作等方式为主。'
  })

  // 5. 病虫害物理/生物防控
  const pestOk = ORGANIC.PEST_CONTROL.some(k => allText.indexOf(k) >= 0)
  checks.push({
    key: 'pestControl', name: '病虫害物理/生物防控', required: true,
    status: pestOk ? 'pass' : 'warn',
    detail: pestOk ? '采用物理或生物措施防控病虫害（黄板/防虫网/诱虫灯/天敌/套袋等）' : '未见物理或生物防控记录，需补充防控措施台账',
    standard: 'GB/T 19630-2019 第4.2条（植物保护）：应尽量利用灯光/色彩诱杀害虫、机械捕捉害虫、机械或人工除草等措施防治病虫草害；植保产品有效成分应符合附录A表A.2（生物源、矿物源药剂）。'
  })

  // 6. 生产全过程记录可追溯
  const comp = getDataCompleteness(batchId)
  checks.push({
    key: 'traceable', name: '生产全过程记录可追溯', required: true,
    status: comp.rate >= 70 ? 'pass' : 'warn',
    detail: '生产档案完整度 ' + comp.rate + '%（地块/时间线/农事/环境/二维码/检测）',
    standard: 'GB/T 19630-2019 第7.5条（可追溯体系与产品召回）：应建立覆盖生产全过程的可追溯体系，保存完整生产档案与投入品、采收、销售记录。'
  })

  // 7. 土壤肥力监测项（不强制判定，仅培肥监测）
  const m = plot && plot.soilMonitor
  checks.push({
    key: 'soilMonitor', name: '土壤肥力监测（有机质/有效氮磷钾/阳离子交换量）', required: false,
    status: 'monitor',
    detail: m
      ? `有机质 ${m.organicMatter || '-'}%，有效氮 ${m.availN || '-'}、有效磷 ${m.availP || '-'}、有效钾 ${m.availK || '-'}，CEC ${m.cec || '-'} cmol/kg；该项仅用于培肥监测，不作强制判定`
      : '暂无土壤肥力监测数据；该项仅用于培肥指导，不作为合规判定指标',
    standard: '土壤有机质、有效氮磷钾、阳离子交换量（CEC）为地力培肥监测指标，GB/T 19630-2019 未将其列为有机认证否决项，仅用于指导土壤培肥改良。'
  })

  const requiredChecks = checks.filter(c => c.required)
  const fails = requiredChecks.filter(c => c.status === 'fail')
  const unknowns = requiredChecks.filter(c => c.status === 'unknown')
  const warns = requiredChecks.filter(c => c.status === 'warn')
  let status, statusText, cls
  if (fails.length) { status = 'fail'; statusText = '不符合有机生产要求'; cls = 'tag-warn' }
  else if (unknowns.length) { status = 'unknown'; statusText = '关键资料待核验'; cls = 'tag-gold' }
  else if (warns.length) { status = 'warn'; statusText = '基本符合·待完善'; cls = 'tag-gold' }
  else { status = 'pass'; statusText = '符合有机生产要求'; cls = 'tag-green' }

  return {
    status, statusText, cls, checks, convMonths, reqMonths,
    failCount: fails.length, unknownCount: unknowns.length, warnCount: warns.length,
    standardName: 'GB/T 19630-2019《有机产品 生产、加工、标识与管理体系要求》',
    note: '本核验依据国家标准 GB/T 19630-2019《有机产品 生产、加工、标识与管理体系要求》，对生产档案自动比对，仅用于采购评估与生产改进；正式有机产品认证以国家授权认证机构现场检查为准。'
  }
}

/**
 * 消费者口径的批次风险提示（溯源页用，与采购商工作台相互独立）
 * 汇总：产地违规记录 / OPI 综合评价 / 有机合规核验 / 食品检测 / 档案完整度
 * @returns {{level:'high'|'mid'|'low', levelText, cls, items:Array<{level,text}>, advice}}
 */
function getBatchRisks(batchId) {
  const data = _db()
  const b = data.batches.find(x => x.batchId === batchId)
  if (!b) return null
  const opi = getBatchOPI(batchId)
  const comp = getDataCompleteness(batchId)
  const organic = getOrganicCompliance(batchId)
  const insps = (data.inspections || []).filter(x => x.batchId === batchId)

  const items = []
  // 高风险项
  if (b.flag === '违规') {
    items.push({ level: 'high', text: '该批次存在产地标注违规记录（产地与实际不符），请谨慎购买' })
  }
  if (opi && opi.score < 60) {
    items.push({ level: 'high', text: '棚迹生产综合评价偏低（' + opi.score + ' 分），生产过程管控较弱' })
  }
  if (organic && organic.status === 'fail') {
    items.push({ level: 'high', text: '有机合规核验未通过（' + organic.failCount + ' 项不符合），不应按有机产品看待' })
  }
  // 中风险/提示项
  if (organic && organic.status === 'unknown') {
    items.push({ level: 'mid', text: '有机生产关键资料不完整（' + organic.unknownCount + ' 项待核验），暂无法确认其有机属性' })
  }
  if (b.status === '已收获' && insps.length === 0) {
    items.push({ level: 'mid', text: '已采收但暂无第三方食品检测数据' })
  }
  if (comp && comp.rate < 70) {
    items.push({ level: 'mid', text: '生产档案完整度不足（' + comp.rate + '%），可追溯信息不够完整' })
  }

  const hasHigh = items.some(i => i.level === 'high')
  const level = items.length ? (hasHigh ? 'high' : 'mid') : 'low'
  const map = {
    high: { levelText: '消费风险提示', cls: 'tag-warn' },
    mid: { levelText: '消费留意事项', cls: 'tag-gold' },
    low: { levelText: '暂未发现风险提示', cls: 'tag-green' }
  }
  return {
    level,
    levelText: map[level].levelText,
    cls: map[level].cls,
    items,
    advice: level === 'low'
      ? '该批次生产档案、食品检测与有机合规核验暂未发现异常，可放心参考溯源信息选购。'
      : '建议优先选择检测齐全、合规核验通过的批次；详情可查看下方溯源档案，或咨询销售方与当地农技部门。'
  }
}

/**
 * 计算某批次「棚迹有机生产评价指数 OPI」
 * 框架对标 NY/T 3667-2020《生态农场评价技术规范》：环境30 / 种植过程50 / 管理体系20
 */
function getBatchOPI(batchId) {
  const data = _db()
  const b = data.batches.find(x => x.batchId === batchId)
  if (!b) return null
  const plot = data.plots.find(p => p.plotId === b.plotId)
  const records = data.records.filter(r => r.batchId === batchId)
  const inspections = (data.inspections || []).filter(x => x.batchId === batchId)

  // 环境监测：地块环境历史覆盖的天数（真实 / 演示均计入连续性）
  let sensorDays = 0
  if (plot && plot.envHistory && plot.envHistory.length) {
    const first = plot.envHistory[0].ts, last = plot.envHistory[plot.envHistory.length - 1].ts
    sensorDays = Math.round((last - first) / 86400000)
  }
  // 农事规范：记录数 / 期望数（每批次期望 6 条关键节点）
  const recordRate = Math.min(100, Math.round(records.length / 6 * 100))
  // 投入品台账：肥料/农资投入记录
  const inputCount = (b.inputs || []).length
  const inputRate = inputCount === 0 ? 30 : Math.min(100, 40 + inputCount * 30)
  // 生产过程完整性：生长周期覆盖的关键阶段
  const keyStages = ['土地准备', '播种', '生长期', '施肥', '灌溉', '防治', '收获', '包装', '检测']
  const cycleText = (b.growthCycle || []).map(g => g.stage + (g.desc || '')).join('')
  const hitStages = keyStages.filter(k => cycleText.indexOf(k) >= 0 || records.some(r => r.type === k))
  const processRate = Math.round(hitStages.length / keyStages.length * 100)
  const hasTest = inspections.length > 0
  const testPassed = hasTest && inspections.every(x => x.conclusion === '合格')
  // 批次追溯档案完整度（0-100）：地块关联 + 农事记录 + 投入品台账 + 检测记录 四项建成率
  const traceRate = Math.min(100, Math.round(
    (plot ? 25 : 0) + (records.length > 0 ? 25 : 0) + (inputCount > 0 ? 25 : 0) + (hasTest ? 25 : 0)
  ))

  return ai.calcOPI({ sensorDays, recordRate, inputRate, processRate, hasTest, testPassed, traceRate })
}

module.exports = {
  listPlots,
  getPlot,
  getPlotEnvHistory,
  listFarmers,
  getFarmer,
  getBatch,
  traceByCode,
  listBatches,
  listPlotsByFarmer,
  canEditPlot,
  addPlot,
  updatePlot,
  appendPlotPhotos,
  addProductBatch,
  harvestBatch,
  addSensorReading,
  addRecord,
  addReview,
  registerFarmer,
  markViolation,
  listBuyers,
  listStandards,
  listInspections,
  addInspection,
  getDataCompleteness,
  getBatchOPI,
  getOrganicCompliance,
  getBatchRisks,
  ORGANIC,
  resetAll
}
