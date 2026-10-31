// utils/diagnose.js
// 农技诊断引擎：把农户的自然语言描述与知识库条目做加权匹配，
// 结合作物种类与田间传感器读数（空气温度 / 空气湿度 / 光照 / 土壤湿度）输出处置方案。
// 纯本地计算，不依赖网络与云函数，秒级返回。

const KB = require('./diag-kb.js')

const CROP_ALIAS = {
  西红柿: '番茄', 番茄: '番茄', 洋柿子: '番茄',
  黄瓜: '黄瓜', 青瓜: '黄瓜',
  辣椒: '辣椒', 青椒: '辣椒', 尖椒: '辣椒',
  茄子: '茄子', 草莓: '草莓', 葡萄: '葡萄',
  白菜: '白菜', 大白菜: '白菜', 青菜: '白菜',
  生菜: '生菜', 菠菜: '菠菜', 芹菜: '芹菜',
  萝卜: '萝卜', 胡萝卜: '萝卜', 土豆: '马铃薯', 马铃薯: '马铃薯',
  西瓜: '西瓜', 甜瓜: '瓜类', 南瓜: '瓜类', 冬瓜: '瓜类', 丝瓜: '瓜类', 苦瓜: '瓜类',
  甘蓝: '甘蓝', 卷心菜: '甘蓝', 花菜: '甘蓝', 菜花: '甘蓝',
  油菜: '油菜', 柑橘: '柑橘', 橘子: '柑橘', 苹果: '苹果',
  玉米: '玉米', 水稻: '水稻', 小麦: '小麦', 大豆: '豆类', 豆角: '豆类', 菜豆: '豆类'
}

const SEV_CLS = { 高: 'tag-warn', 中: 'tag-gold', 低: 'tag-gray' }

function normCrop(name) {
  const n = String(name || '').trim()
  if (!n) return ''
  if (CROP_ALIAS[n]) return CROP_ALIAS[n]
  const hit = Object.keys(CROP_ALIAS).find((k) => n.indexOf(k) >= 0)
  return hit ? CROP_ALIAS[hit] : n
}

/** 关键词权重：越具体的词（字符越长）权重越高，避免「虫」这类泛词压过具体虫名 */
function keyWeight(k) {
  const len = String(k).length
  if (len >= 5) return 4
  if (len >= 3) return 3
  return 2
}

/** 环境条件是否吻合；返回 {hit:boolean, notes:[], mismatch:[]} */
function checkEnv(rule, env) {
  const notes = []
  const mismatch = []
  const cond = rule.env
  if (!cond || !env) return { hit: false, notes, mismatch }

  const fields = {
    airTemp: { label: '空气温度', unit: '℃', digits: 1 },
    airHumidity: { label: '空气湿度', unit: '%', digits: 0 },
    light: { label: '光照', unit: '%', digits: 0 },
    soilMoisture: { label: '土壤湿度', unit: '%', digits: 0 }
  }

  let allHit = true
  let anyChecked = false
  Object.keys(cond).forEach((key) => {
    const f = fields[key]
    const v = Number(env[key])
    if (!f || !isFinite(v)) { allHit = false; return }
    anyChecked = true
    const c = cond[key]
    const okMin = (c.min === undefined) || v >= c.min
    const okMax = (c.max === undefined) || v <= c.max
    const range = c.min !== undefined && c.max !== undefined
      ? c.min + '~' + c.max + f.unit
      : (c.min !== undefined ? '≥' + c.min + f.unit : '≤' + c.max + f.unit)
    if (okMin && okMax) {
      notes.push(f.label + ' ' + v.toFixed(f.digits) + f.unit + '，符合该病高发条件（' + range + '）')
    } else {
      allHit = false
      mismatch.push(f.label + ' ' + v.toFixed(f.digits) + f.unit + '（易发区间 ' + range + '）')
    }
  })
  return { hit: anyChecked && allHit, notes, mismatch }
}

/**
 * 诊断
 * @param {{crop:string, text:string, env?:{airTemp,airHumidity,light,soilMoisture}}} input
 */
function diagnose(input) {
  const crop = normCrop(input && input.crop)
  const text = String((input && input.text) || '')
  const env = (input && input.env) || null

  if (!text.trim()) {
    return generic('', env)
  }

  const scored = KB.map((rule) => {
    let score = 0
    const hits = []
    ;(rule.keys || []).forEach((k) => {
      if (text.indexOf(k) >= 0) {
        score += keyWeight(k)
        hits.push(k)
      }
    })
    // 作物、环境只作为「症状已命中」之后的加权项，避免没提到症状的条目被抬上来
    if (!hits.length) return { rule, score: 0, hits, env: { hit: false, notes: [], mismatch: [] } }

    if (crop && rule.crops && rule.crops.length) {
      if (rule.crops.indexOf(crop) >= 0) score += 3
      else score -= 1
    }
    const e = checkEnv(rule, env)
    if (e.hit) score += 2
    return { rule, score, hits, env: e }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score < 2) return generic(text, env, scored.slice(0, 3))

  const r = best.rule
  const summary = buildSummary(r, crop, best.env)
  return {
    matched: true,
    id: r.id,
    title: r.title,
    severity: r.sev,
    severityCls: SEV_CLS[r.sev] || 'tag-gray',
    summary,
    causes: r.causes.slice(0, 4),
    immediate: r.immediate.slice(0, 4),
    organic: r.organic.slice(0, 4),
    chemical: (r.chemical || []).slice(0, 2),
    prevent: r.prevent.slice(0, 4),
    ask: r.ask || [],
    envNotes: best.env.notes,
    hits: best.hits.slice(0, 4),
    alternatives: scored.slice(1, 4)
      .filter((x) => x.score >= 3)
      .map((x) => x.rule.title),
    organicNote: ORGANIC_NOTE
  }
}

function buildSummary(rule, crop, envResult) {
  let s = (crop ? crop + '' : '') + '疑似「' + rule.title + '」，风险等级：' + rule.sev + '。'
  if (envResult && envResult.notes.length) {
    s += '结合田间读数：' + envResult.notes.join('；') + '。'
  } else if (envResult && envResult.mismatch.length) {
    s += ' 当前读数（' + envResult.mismatch.join('、') + '）与该病典型高发条件不完全吻合，'
      + '若症状典型仍需按该病预防处理。'
  }
  return s
}

const ORGANIC_NOTE = '本方案按有机/绿色生产要求给出：优先物理防治、生物防治与有机肥、矿物源投入品；'
  + '化学合成农药、化肥、生长调节剂属禁用物质，"常规药剂参考"仅供常规地块对照。'

function generic(text, env, near) {
  const tips = []
  return {
    matched: false,
    id: '',
    title: '需要补充更多症状信息',
    severity: '低',
    severityCls: 'tag-gray',
    summary: '描述里暂未匹配到典型症状，请补充受害部位（叶 / 茎 / 根 / 花 / 果）、'
      + '发生比例（零星 / 成片）与出现时间，便于准确定位。',
    causes: ['描述信息不足，暂无法准确定位病因'],
    immediate: [
      '补充症状部位：是叶片、茎秆、根系，还是花和果实？',
      '补充发生情况：零星几株还是成片发生？出现几天了？',
      '核对田间读数：温度、湿度、光照、土壤湿度是否超出作物适宜区间'
    ],
    organic: [
      '加强田间管理：合理通风、均衡供水，及时摘除病残体带出田外',
      '物理防控先行：悬挂黄板 / 蓝板监测虫口，放风口覆盖防虫网'
    ],
    chemical: [],
    prevent: [
      '坚持轮作倒茬、增施腐熟有机肥、收获后清洁田园',
      '扩散快或拿不准的病虫害，请联系当地农技站现场鉴定'
    ],
    ask: ['叶片上有没有斑点、霉层或虫体？', '症状是从下部老叶还是顶部新叶开始？', '最近是否连续阴雨或刚浇过大水？'],
    envNotes: [],
    hits: [],
    alternatives: (near || []).map((x) => x.rule.title),
    organicNote: ORGANIC_NOTE
  }
}

module.exports = { diagnose, normCrop, KB }
