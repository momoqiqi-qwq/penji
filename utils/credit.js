// utils/credit.js
// 农户质量安全信用评价模型（全项目唯一口径，store.js / mock.js 统一调用）
//
// ============================== 评价依据（公开可查） ==============================
// [1] GB/T 23794-2023《企业信用评价指标》（全国社会信用标准化技术委员会归口，现行）
//       §5.2  基本指标包括「履约意愿、履约能力、履约行为」三个维度
//       §6.1  基本指标在全部指标中权重占比应不低于 40%
//       §7.2  信用等级 A、B、C、D 四等，A 等可细分为 AAA、AA、A 三级
// [2] 《中华人民共和国农产品质量安全法》(2022修订) 第五十四条：
//       县级以上农业农村部门应建立农产品生产经营者信用记录，记载违法行为及处理结果
// [3] 农业农村部令2025年第4号《农产品质量安全承诺达标合格证管理办法》：
//       生产主体应开具承诺达标合格证，违法违规行为记入信用记录
// [4] 浙江省食用农产品生产主体信用评价体系（农业农村部官网 2021 年推介）：
//       公共基础信息 300 分 + 行业生产行为信息 700 分，扣分制；
//       A>800、B>700、C>600、D>500 —— 本模型折算为百分制边界 80/70/60/50
// [5] 广西农安信用试点（农业农村部官网 2024 年推介）：百分制动态记分，
//       由高到低 AAA、AA、A、B、C、D 六档
// ================================================================================

const util = require('./util.js')

/* ---------------- 权重表（合计100分；基本指标=意愿+能力=60分 ≥ 国标40%下限） ---------------- */
const WEIGHTS = {
  willingness: 20,  // 履约意愿（对应 GB/T 23794 §5.2a：履行承诺的理念意识）
  ability: 40,      // 履约能力（§5.2b：履行承诺的综合性能力）
  behavior: 40      // 履约行为（§5.2c：履行承诺的表现情况，扣分制对标浙江千分制）
}

// 等级边界：80/70/60/50 源于浙江千分制 A/B/C/D 边界；A 等细分 AAA/AA/A 源于 GB/T 23794 §7.2
const GRADES = [
  { code: 'AAA', min: 90, text: 'AAA 信用极佳', cls: 'tag-green' },
  { code: 'AA',  min: 80, text: 'AA 信用优秀',  cls: 'tag-green' },
  { code: 'A',   min: 70, text: 'A 信用良好',   cls: 'tag-green' },
  { code: 'B',   min: 60, text: 'B 信用一般',   cls: 'tag-gold' },
  { code: 'C',   min: 50, text: 'C 信用较差',   cls: 'tag-warn' },
  { code: 'D',   min: 0,  text: 'D 失信风险',   cls: 'tag-warn' }
]

// 生产档案四个必备环节（依据农产品质量安全法§27 生产记录制度：播种、施肥用药、管理、采收）
const STAGES = [
  { key: 'plant',  name: '播种定植', match: t => t === '播种' },
  { key: 'manage', name: '田间管理', match: t => t === '施肥' || t === '灌溉' },
  { key: 'protect',name: '植保除草', match: t => t === '防治' || t === '除草' },
  { key: 'harvest',name: '采收上市', match: t => t === '收获' }
]

const PENALTY_SERIOUS = 15  // 严重失信（虚假标注/行政处罚）每条扣15分  [依据2]
const PENALTY_COMPLAINT = 8   // 经核实的消费者投诉每条扣8分        [社会监督]
const NEUTRAL_REVIEW = 9      // 无评价数据时的中性起评分（数据不足，不作正向背书）
const NEUTRAL_INSPECT = 9     // 无已收获批次时检测项中性起评分

function gradeOf(score) {
  return GRADES.find(g => score >= g.min) || GRADES[GRADES.length - 1]
}

function starOf(score) {
  if (score >= 90) return 5
  if (score >= 80) return 4
  if (score >= 70) return 3
  if (score >= 60) return 2
  if (score >= 50) return 1
  return 0
}

/**
 * 评价单个农户
 * @param {object} data   全量数据库（batches/records/reviews/inspections/plots）
 * @param {object} farmer 待评价农户（结果直接写回该对象）
 * @returns {object} 结构化评价结果 creditDetail
 */
function evaluateFarmer(data, farmer) {
  const batches = data.batches.filter(b => b.farmerId === farmer.farmerId)
  const records = data.records.filter(r => r.farmerId === farmer.farmerId)
  const reviews = data.reviews.filter(r => r.farmerId === farmer.farmerId)
  const plots = data.plots.filter(p => p.farmerId === farmer.farmerId)
  const batchIds = new Set(batches.map(b => b.batchId))
  const insps = data.inspections.filter(i => batchIds.has(i.batchId))

  /* ---------- 维度一：履约意愿 20 分 ---------- */
  // I1 质量安全信用承诺（承诺达标合格证制度 [依据3]）
  const i1 = farmer.promiseSigned ? 10 : 0
  // I2 生产主体备案信息完整度（信用档案"立信"，每缺一项扣2分）
  const profileItems = [
    !!farmer.name, !!farmer.village, !!farmer.bio, !!farmer.joinedAt, plots.length > 0
  ]
  const i2 = profileItems.filter(Boolean).length * 2

  /* ---------- 维度二：履约能力 40 分 ---------- */
  // I3 生产档案完整率：每批次按必备环节覆盖度计分（种植中批次免采收环节）
  let covered = 0, expected = 0
  batches.forEach(b => {
    const rs = records.filter(r => r.batchId === b.batchId)
    const need = b.status === '已收获' ? STAGES : STAGES.slice(0, 3)
    need.forEach(stage => {
      expected++
      if (rs.some(r => stage.match(r.type))) covered++
    })
  })
  const completeRate = expected ? Math.round(covered / expected * 100) : 0
  const i3 = expected ? Math.round(covered / expected * 15) : 0

  // I4 检验检测合格情况（GB 2762/2763 检测；出现不合格结论一票该项清零）
  const harvested = batches.filter(b => b.status === '已收获')
  const passed = new Set(insps.filter(i => i.conclusion === '合格').map(i => i.batchId))
  const failed = new Set(insps.filter(i => i.conclusion === '不合格').map(i => i.batchId))
  let i4, inspectNote = ''
  if (failed.size > 0) {
    i4 = 0
    inspectNote = '存在检测不合格批次，该项一票否决'
  } else if (harvested.length === 0) {
    i4 = NEUTRAL_INSPECT
    inspectNote = '暂无采收批次，检测数据不足，按中性起评'
  } else {
    i4 = Math.round(passed.size / harvested.length * 15)
    inspectNote = `已采收${harvested.length}批，合格检测覆盖${passed.size}批`
  }

  // I5 质量认证与标准化生产（绿色食品/有机/地理标志等认证覆盖）
  const certBatches = batches.filter(b => (b.certifications || []).length > 0)
  const i5 = batches.length ? Math.round(certBatches.length / batches.length * 10) : 0

  /* ---------- 维度三：履约行为 40 分（基准分 + 扣减，对标浙江扣分制） ---------- */
  // I6 消费者扫码评价（社会监督，1-5星）
  const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0
  let i6, reviewNote = ''
  if (reviews.length) {
    i6 = Math.round(avgRating / 5 * 15)
    reviewNote = `${reviews.length}条评价，平均${avgRating.toFixed(1)}星`
  } else {
    i6 = NEUTRAL_REVIEW
    reviewNote = '暂无消费者评价，按中性起评9分'
  }

  // I7 溯源赋码与记录可查：含≥2条生产记录的批次占比（一品一码可追溯）
  const traceable = batches.filter(b => records.filter(r => r.batchId === b.batchId).length >= 2)
  const i7 = batches.length ? Math.round(traceable.length / batches.length * 10) : 0

  // I8 失信行为扣减（基准15分）：严重失信-15/条，核实投诉-8/条 [依据2]
  const complaintCount = reviews.filter(r => r.flag).length
  const seriousCount = farmer.violations || 0
  const i8 = util.clamp(15 - seriousCount * PENALTY_SERIOUS - complaintCount * PENALTY_COMPLAINT, 0, 15)

  /* ---------- 汇总 ---------- */
  const willScore = i1 + i2
  const abilScore = i3 + i4 + i5
  const behaScore = i6 + i7 + i8
  const score = util.clamp(willScore + abilScore + behaScore, 0, 100)
  const g = gradeOf(score)

  const creditDetail = {
    basis: 'GB/T 23794-2023《企业信用评价指标》三维度框架；农产品质量安全法第五十四条；浙/桂农安信用分级实践',
    dims: [
      {
        key: 'willingness', name: '履约意愿', score: willScore, max: WEIGHTS.willingness,
        basis: 'GB/T 23794-2023 §5.2a；承诺达标合格证管理办法（农业农村部令2025年第4号）',
        items: [
          { name: '质量安全信用承诺签署', score: i1, max: 10, note: farmer.promiseSigned ? '已签署承诺达标承诺' : '尚未签署信用承诺' },
          { name: '生产主体备案信息完整度', score: i2, max: 10, note: `${profileItems.filter(Boolean).length}/5项备案信息齐全` }
        ]
      },
      {
        key: 'ability', name: '履约能力', score: abilScore, max: WEIGHTS.ability,
        basis: 'GB/T 23794-2023 §5.2b；农产品质量安全法第二十七条生产记录制度',
        items: [
          { name: '农事生产档案完整率', score: i3, max: 15, note: `必备环节覆盖 ${completeRate}%（播种/管理/植保/采收）` },
          { name: '检验检测合格情况', score: i4, max: 15, note: inspectNote },
          { name: '质量认证与标准化生产', score: i5, max: 10, note: `${certBatches.length}/${batches.length}批获绿色/有机/地理标志认证` }
        ]
      },
      {
        key: 'behavior', name: '履约行为', score: behaScore, max: WEIGHTS.behavior,
        basis: 'GB/T 23794-2023 §5.2c；浙江农安信用扣分制；农产品质量安全法第五十四条',
        items: [
          { name: '消费者扫码评价', score: i6, max: 15, note: reviewNote },
          { name: '溯源赋码与记录可查', score: i7, max: 10, note: `${traceable.length}/${batches.length}批生产记录可扫码溯源` },
          { name: '失信行为扣减', score: i8, max: 15,
            note: (seriousCount + complaintCount) === 0 ? '无失信记录，得基准满分'
              : `严重失信${seriousCount}条(-${seriousCount * PENALTY_SERIOUS})、核实投诉${complaintCount}条(-${complaintCount * PENALTY_COMPLAINT})` }
        ]
      }
    ],
    grade: g.code,
    gradeText: g.text,
    updatedAt: util.formatDateTime()
  }

  farmer.creditScore = score
  farmer.grade = g.code
  farmer.star = starOf(score)
  farmer.creditDetail = creditDetail
  farmer.farmingCompleteRate = completeRate
  farmer.totalBatches = batches.length
  farmer.reviewsCount = reviews.length
  farmer.avgRating = +avgRating.toFixed(2)
  farmer.violations = seriousCount
  return creditDetail
}

module.exports = {
  WEIGHTS,
  GRADES,
  evaluateFarmer,
  gradeOf,
  starOf
}
