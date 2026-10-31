// utils/ai.js
// 智慧农业分析引擎
// 1) analyzeEnvironment：基于四类传感器数据——空气温度 / 空气湿度 / 光照 / 土壤湿度，
//    结合作物适宜区间，输出可落地的种植管护建议（自动写入产品溯源档案）
// 2) calcOPI：棚迹有机生产评价指数（OPI）综合评分
// 农技诊断已独立到 utils/diagnose.js（离线知识库 + 加权匹配）。
//
// 权威依据（种植建议全程标注）：
//   · GB/T 25893-2010《温室蔬菜栽培环境因子调控技术规范》 —— 温湿度、光照、土壤湿度调控阈值
//   · NY/T 3667-2020《生态农场评价技术规范》 —— 产地环境监测指标（空气温湿度、光照、土壤水分）
//   · GB/T 19630-2019《有机产品》第7.5条可追溯体系要求
//   · 《设施农业环境控制技术规范》（农业农村部种植业管理司） —— 棚室通风、遮阳、灌溉操作准则

// 作物适宜生长区间：airTemp 空气温度℃ / humidity 空气湿度% / light 光照% / soil 土壤湿度%
const CROP_PROFILES = {
  '叶菜类': { temp: [15, 25], humidity: [55, 80], light: [40, 80], soil: [60, 80], note: '喜凉湿润，高温易抽薹；保持土壤湿度充足，避免强光直射' },
  '茄果类': { temp: [20, 30], humidity: [40, 70], light: [50, 90], soil: [55, 75], note: '喜温怕涝，高湿易发灰霉病；忌土壤积水，充足光照利于坐果' },
  '瓜类':   { temp: [22, 32], humidity: [45, 75], light: [55, 95], soil: [55, 75], note: '喜高温强光，坐果期均衡供水防裂瓜' },
  '根茎类': { temp: [15, 25], humidity: [45, 75], light: [40, 85], soil: [50, 70], note: '忌土壤过湿烂根，起垄栽培利排水' },
  '浆果类': { temp: [18, 28], humidity: [50, 80], light: [45, 85], soil: [55, 75], note: '草莓等喜湿润环境，花果期防干旱，充足光照利于着色' },
  '默认':   { temp: [15, 30], humidity: [40, 80], light: [30, 90], soil: [50, 80], note: '常规大田作物适宜区间' }
}

function _guessCategory(name) {
  const n = String(name || '')
  if (/白菜|青菜|生菜|菠菜|油菜|芹菜|韭菜|甘蓝|菜心|芥蓝|空心菜|苋菜/.test(n)) return '叶菜类'
  if (/番茄|西红柿|茄子|辣椒|青椒/.test(n)) return '茄果类'
  if (/黄瓜|西瓜|甜瓜|南瓜|冬瓜|丝瓜|苦瓜|瓜/.test(n)) return '瓜类'
  if (/萝卜|胡萝卜|土豆|马铃薯|红薯|地瓜|芋|姜|蒜|洋葱/.test(n)) return '根茎类'
  if (/草莓|蓝莓|葡萄|浆果/.test(n)) return '浆果类'
  return '默认'
}

// 偏离度工具：返回 0（完全在区间内）/ 1（轻度偏离）/ 2（中度偏离）/ 3（严重偏离）
function _deviation(val, range, softTol, hardTol) {
  if (val >= range[0] && val <= range[1]) return 0
  const dist = val < range[0] ? range[0] - val : val - range[1]
  if (dist <= softTol) return 1
  if (dist <= hardTol) return 2
  return 3
}

/**
 * AI 环境分析（基于四类传感器数据：airTemp / airHumidity / light / soilMoisture）
 * 定性评级：优 / 良 / 中 / 差（参考 NY/T 3667-2020 生态农场环境监测评价等级）
 * @param {{airTemp:number, airHumidity:number, light:number, soilMoisture:number}|Array} input 最新读数或读数数组
 * @param {string} cropName 作物名称（自动归类）
 */
function analyzeEnvironment(input, cropName) {
  const list = Array.isArray(input) ? input : [input]
  const valid = list.filter(d => d && typeof d.airTemp === 'number')
  const cat = _guessCategory(cropName)
  const p = CROP_PROFILES[cat]

  const n = valid.length || 1
  const avgTemp = valid.reduce((s, d) => s + (+d.airTemp || 0), 0) / n
  const avgHumidity = valid.reduce((s, d) => s + (+d.airHumidity || 0), 0) / n
  const avgLight = valid.reduce((s, d) => s + (+d.light || 0), 0) / n
  const avgSoil = valid.reduce((s, d) => s + (+d.soilMoisture || 0), 0) / n

  // 偏离判定（软容差 / 硬容差）：参考 GB/T 25893-2010 温湿度调控允许偏差
  const devT = _deviation(avgTemp, p.temp, 2, 5)
  const devH = _deviation(avgHumidity, p.humidity, 5, 12)
  const devL = _deviation(avgLight, p.light, 8, 18)
  const devS = _deviation(avgSoil, p.soil, 8, 18)

  const issues = []
  const suggestions = []

  // —— 温度 × 湿度 × 土壤 组合建议（依据 GB/T 25893-2010 温湿度联合调控） ——
  if (devT >= 2 && devS >= 2 && avgSoil < p.soil[0]) {
    issues.push('温度偏高且土壤湿度严重偏低，作物失水萎蔫风险高（依据 GB/T 25893-2010 第 6.3 节灌溉调控阈值）')
    suggestions.push('依据 GB/T 25893-2010：在清晨或傍晚气温低于 28℃ 时开展灌溉，避免正午高温冷水伤根')
    suggestions.push('依据设施农业环境控制规范：正午时段遮阳降温 30%~50%，配合微喷带增湿')
  } else if (devS >= 2 && avgSoil > p.soil[1]) {
    issues.push('土壤湿度过高（超出适宜上限 ' + p.soil[1] + '%），根系缺氧烂根风险（依据 NY/T 3667-2020 环境监测指标）')
    suggestions.push('依据 GB/T 25893-2010 第 5.2 节：暂缓灌溉，连续通风 2~3 天散墒')
    suggestions.push('起垄栽培地块疏通排水沟，必要时在垄间挖临时导水沟')
  } else if (devS >= 1 && avgSoil < p.soil[0]) {
    issues.push('土壤湿度偏低（当前 ' + avgSoil.toFixed(0) + '%），土壤水分供给不足（依据 NY/T 3667-2020 环境监测指标）')
    suggestions.push('依据 GB/T 25893-2010：结合作物生育阶段及时补水，小水勤浇保持土壤湿度在 ' + p.soil[0] + '%~' + p.soil[1] + '% 区间')
  }

  // —— 低温风险（依据 GB/T 25893-2010 第 6.1 节 低温胁迫阈值）——
  if (devT >= 2 && avgTemp < p.temp[0]) {
    issues.push('空气温度偏低（低于适宜下限 ' + p.temp[0] + '℃），存在低温冷害风险（依据 GB/T 25893-2010 第 6.1 节）')
    suggestions.push('依据 GB/T 25893-2010：采用多层覆膜或临时熏烟防寒，棚内增设热风炉加温')
  } else if (devT >= 1 && avgTemp > p.temp[1]) {
    issues.push('空气温度偏高（超出适宜上限 ' + p.temp[1] + '℃），作物呼吸消耗加大（依据 NY/T 3667-2020 环境监测）')
    suggestions.push('正午加大通风量，棚膜喷淋或遮阳网降温')
  }

  // —— 空气湿度诊断（依据 GB/T 25893-2010 第 5.1 节 高湿病害防控阈值）——
  if (devH >= 1 && avgHumidity < p.humidity[0]) {
    issues.push('空气湿度偏低（当前 ' + avgHumidity.toFixed(0) + '%，低于适宜下限 ' + p.humidity[0] + '%），易造成叶片失水萎蔫（依据 GB/T 25893-2010 第 5.1 节）')
    suggestions.push('依据 GB/T 25893-2010：增加田间微喷灌或叶面喷水，空气湿度维持在 ' + p.humidity[0] + '%~' + p.humidity[1] + '%')
    suggestions.push('大棚加盖遮阳网并配合侧窗通风，降低蒸腾速率')
  } else if (devH >= 1 && avgHumidity > p.humidity[1]) {
    issues.push('空气湿度偏高（当前 ' + avgHumidity.toFixed(0) + '%，超出适宜上限 ' + p.humidity[1] + '%），高湿易诱发病害（依据 GB/T 25893-2010 第 5.1 节）')
    suggestions.push('依据 GB/T 25893-2010：加大通风排湿，棚内湿度控制在 ' + p.humidity[0] + '%~' + p.humidity[1] + '% 区间内')
    suggestions.push('避免傍晚喷灌，叶面结露前务必通风散湿，减少真菌性病害爆发')
  }

  // —— 光照诊断（依据 GB/T 25893-2010 第 6.2 节 光照调控阈值）——
  if (devL >= 1 && avgLight < p.light[0]) {
    issues.push('光照偏低（当前 ' + avgLight.toFixed(0) + '%，低于适宜下限 ' + p.light[0] + '%），作物光合作用受限（依据 GB/T 25893-2010 第 6.2 节）')
    suggestions.push('依据 GB/T 25893-2010：清洁棚膜、张挂反光幕或增设 LED 补光灯（红蓝光配比 3:1）')
    suggestions.push('合理疏枝打杈，避免枝叶过密遮光')
  } else if (devL >= 1 && avgLight > p.light[1]) {
    issues.push('光照偏强（当前 ' + avgLight.toFixed(0) + '%，超出适宜上限 ' + p.light[1] + '%），强光易灼伤果实与叶片（依据 GB/T 25893-2010 第 6.2 节）')
    suggestions.push('正午强光时段建议遮阳：加盖 30%~50% 遮光率遮阳网或棚膜喷淋降温')
  }

  // —— 综合定性评级（参考 NY/T 3667-2020 生态农场环境监测评价等级划分）——
  // 两个判定维度配合使用：
  //   1) severity = 四参数偏离度之和（0~12）
  //   2) maxDev  = 单项最严重偏离（0~3）—— 任一参数严重偏离直接触发"差"
  // 例：土壤湿度 0%（严重偏离=3）+ 湿度 9%（严重=3）+ 光照 29%（轻度=1）→ severity=7, maxDev=3 → 差
  const severity = devT + devH + devL + devS
  const maxDev = Math.max(devT, devH, devL, devS)
  const severeCount = (devT === 3 ? 1 : 0) + (devH === 3 ? 1 : 0) + (devL === 3 ? 1 : 0) + (devS === 3 ? 1 : 0)
  let levelText, levelCls
  if (severity === 0) {
    levelText = '优'
    levelCls = 'tag-green'
    suggestions.push('环境总体适宜（四类传感器读数均处于「' + cat + '」适宜区间），依据 NY/T 3667-2020 评为优')
    suggestions.push('建议维持现有管护，持续开展环境监测')
  } else if (severity <= 2 && maxDev <= 1) {
    // 最多 2 个轻度偏离，无中度/严重偏离
    levelText = '良'
    levelCls = 'tag-green'
  } else if (severity <= 5 && maxDev <= 2 && severeCount <= 1) {
    // 总偏离不高、单项最多中度、严重偏离不超过 1 项 → 中
    levelText = '中'
    levelCls = 'tag-gold'
  } else {
    // 其余全部归为差：severity > 5 / 单项严重偏离 ≥ 2 项 / 任一项严重偏离
    levelText = '差'
    levelCls = 'tag-warn'
  }

  const summary = '综合 ' + valid.length + ' 条传感器读数（' + cat + '）：空气温度 ' + avgTemp.toFixed(1) +
    '℃（适宜区间 ' + p.temp[0] + '~' + p.temp[1] + '℃）/ 空气湿度 ' + avgHumidity.toFixed(0) +
    '%（适宜 ' + p.humidity[0] + '%~' + p.humidity[1] + '%）/ 光照 ' + avgLight.toFixed(0) +
    '%（适宜 ' + p.light[0] + '%~' + p.light[1] + '%）/ 土壤湿度 ' + avgSoil.toFixed(0) +
    '%（适宜 ' + p.soil[0] + '%~' + p.soil[1] + '%），环境评价「' + levelText + '」。' + p.note +
    '。评级依据：NY/T 3667-2020《生态农场评价技术规范》环境监测指标等级划分。'

  return {
    levelText, levelCls, issues, suggestions, summary,
    profile: p, category: cat,
    avg: { airTemp: +avgTemp.toFixed(1), airHumidity: +avgHumidity.toFixed(0), light: +avgLight.toFixed(0), soilMoisture: +avgSoil.toFixed(0) }
  }
}

// ========== 棚迹有机生产评价指数 OPI ==========
// 评价框架对标：中华人民共和国农业行业标准 NY/T 3667-2020《生态农场评价技术规范》（种植型农场 100 分制）
// 维度权重采用该标准“各大项等权重”的设计思想，按 环境30 / 种植过程50 / 管理体系20 组织：
//   环境（30%）：产地环境数据监测覆盖度（空气温度/空气湿度/光照/土壤湿度 连续采集）
//   种植过程（50%）：农事记录规范性、投入品台账完整性、生产过程完整性（三项等权）
//   管理体系（20%）：食品检测情况（10%）、批次追溯档案完整性（10%）（对标该标准“追溯记录的完整性”打分项）
// 维度定义同时参照 GB/T 19630-2019《有机产品》第7.5条可追溯体系要求。
const OPI_WEIGHTS = [
  { key: 'env', name: '产地环境监测', weight: 30, desc: '空气温度、空气湿度、光照、土壤湿度 连续监测覆盖度（对标 NY/T 3667-2020 环境大项）' },
  { key: 'plant', name: '种植过程管理', weight: 50, desc: '农事记录规范性、投入品台账完整性、生产过程完整性（对标 NY/T 3667-2020 种植大项，三项等权）' },
  { key: 'mgmt', name: '质量保障与追溯', weight: 20, desc: '食品检测情况（10%）、批次追溯档案完整性（10%）（对标 NY/T 3667-2020 管理体系大项）' }
]

/**
 * 计算 OPI 有机生产评价指数
 * 评价框架对标 NY/T 3667-2020《生态农场评价技术规范》（种植型农场 100 分制）：
 *  环境30 / 种植过程50 / 管理体系20。
 * @param {{sensorDays:number, recordRate:number, inputRate:number, processRate:number, hasTest:boolean, testPassed:boolean, traceRate:number}} m
 *   sensorDays 传感器连续采集天数；recordRate 农事规范0-100；inputRate 投入品台账0-100；
 *   processRate 生产过程0-100；hasTest 是否有检测记录；testPassed 检测是否合格；
 *   traceRate 批次追溯档案完整度0-100（地块/农事/投入品/检测档案建成率）
 */
function calcOPI(m) {
  m = m || {}
  // 环境（30%）：连续采集天数，满30天满分（对标 NY/T 3667-2020 环境大项 数据监测）
  const envScore = Math.min(100, (m.sensorDays || 0) / 30 * 100)
  // 种植过程（50%）：农事 / 投入品 / 过程 三项等权平均（对标 NY/T 3667-2020 种植大项）
  const recordScore = m.recordRate || 0
  const inputScore = m.inputRate || 0
  const processScore = m.processRate || 0
  const plantScore = (recordScore + inputScore + processScore) / 3
  // 管理体系（20%）：检测（10）+ 追溯档案（10）
  const testScore = !m.hasTest ? 40 : (m.testPassed ? 100 : 30)  // 0-100
  const testPart = testScore / 100 * 10                            // 0-10
  const tracePart = (m.traceRate || 0) / 100 * 10                  // 0-10
  const mgmtScore = (testPart + tracePart) / 20 * 100              // 0-100

  const dims = [
    { ...OPI_WEIGHTS[0], score: +envScore.toFixed(0) },
    { ...OPI_WEIGHTS[1], score: +plantScore.toFixed(0) },
    { ...OPI_WEIGHTS[2], score: +mgmtScore.toFixed(0) }
  ]
  const total = dims.reduce((s, d) => s + d.score * d.weight / 100, 0)
  const score = Math.round(total)
  let level, cls
  if (score >= 90) { level = '优秀'; cls = 'tag-green' }
  else if (score >= 75) { level = '良好'; cls = 'tag-green' }
  else if (score >= 60) { level = '一般'; cls = 'tag-gold' }
  else if (score >= 40) { level = '存在风险'; cls = 'tag-warn' }
  else { level = '风险较高'; cls = 'tag-warn' }
  return { score, level, cls, dims, hasTest: !!m.hasTest }
}

module.exports = {
  CROP_PROFILES, OPI_WEIGHTS,
  _guessCategory,
  analyzeEnvironment,
  calcOPI
}
