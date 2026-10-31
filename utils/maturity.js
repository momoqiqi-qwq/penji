// utils/maturity.js
// 采购商「主推农地块」成熟度计算
// 目标：把地块当前在种批次换算成「距成熟天数 / 生长进度 / 是否临近成熟」，
//       由 store.listMainPlots() 统一排序，页面只负责展示。
// 说明：农户在新增批次时录入 expectedHarvest（预计收获日期）时以该日期为准；
//       老数据没有该字段时，按作物标准周期 + 当前生长阶段做估算，保证列表仍可排序。
const util = require('./util.js')

const DAY = 86400000
const NEAR_MATURE_DAYS = 21   // 距成熟 ≤21 天视为「即将成熟」，进入标黄区

// 常见作物从播种到成熟的大致天数（没有录入预计收获日期时的兜底）
const CROP_CYCLE_DAYS = {
  西红柿: 110, 番茄: 110, 黄瓜: 60, 草莓: 120, 玉米: 100,
  大白菜: 85, 茄子: 110, 萝卜: 70, 苹果: 180, 辣椒: 120,
  土豆: 90, 小麦: 240, 水稻: 140, 大豆: 100
}

// 各生长阶段在完整周期中的大致进度（0-100）
const STAGE_PROGRESS = {
  播种期: 8, 发芽期: 16, 幼苗期: 30, 生长期: 50,
  开花期: 65, 结果期: 82, 成熟期: 95, 已收获: 100
}

// 当前阶段距离成熟还剩的大致天数（没有明确成熟日期时使用）
const STAGE_REMAIN_DAYS = {
  播种期: 70, 发芽期: 55, 幼苗期: 40, 生长期: 25,
  开花期: 18, 结果期: 10, 成熟期: 3
}

function _cycleDays(batch) {
  const name = batch.productName || ''
  return CROP_CYCLE_DAYS[name] || 100
}

function _isLateStage(stage) {
  return stage === '结果期' || stage === '成熟期' || stage === '已收获'
}

/**
 * 评估一个批次的成熟度
 * @param {Object} batch 批次档案
 * @param {number} nowTs 可注入的当前时间（便于测试）
 * @returns {Object} { expectedHarvest, daysLeft, daysText, progress, cycleDays, nearMature, maturityText, harvested }
 */
function assessBatch(batch, nowTs) {
  if (!batch) return null
  const now = nowTs || Date.now()
  const todayTs = util.parseDate(util.formatDate(now))
  const plantTs = batch.plantDate ? util.parseDate(batch.plantDate) : todayTs
  const stage = batch.stage || ''
  const cycleDays = _cycleDays(batch)

  const explicitExpected = !!batch.expectedHarvest
  let expectedTs = 0
  if (batch.expectedHarvest) expectedTs = util.parseDate(batch.expectedHarvest)
  else if (batch.harvestDate) expectedTs = util.parseDate(batch.harvestDate)

  if (!expectedTs) {
    if (_isLateStage(stage)) {
      // 结果期/成熟期的批次，按作物完整周期估算成熟日；例如西红柿约 110 天
      expectedTs = plantTs + cycleDays * DAY
    } else {
      // 还处在早期阶段时，以「当前阶段还需多少天」估算，避免长期未更新阶段的批次被误判为临近成熟
      const remain = STAGE_REMAIN_DAYS[stage] || Math.max(7, Math.round(cycleDays * 0.45))
      expectedTs = todayTs + remain * DAY
    }
  }

  const expectedHarvest = util.formatDate(expectedTs)
  const daysLeft = Math.round((expectedTs - todayTs) / DAY)
  const totalDays = Math.max(1, Math.round((expectedTs - plantTs) / DAY))
  const harvested = batch.status === '已收获' || !!batch.harvestDate

  let progress
  if (harvested) {
    progress = 100
  } else if (explicitExpected || batch.harvestDate) {
    // 农户明确录入成熟日期：按时间轴算真实进度
    progress = Math.round((todayTs - plantTs) / Math.max(1, expectedTs - plantTs) * 100)
  } else if (STAGE_PROGRESS[stage] != null) {
    // 没有明确日期：以农户维护的生长阶段为准
    progress = STAGE_PROGRESS[stage]
  } else {
    progress = Math.round((todayTs - plantTs) / Math.max(1, expectedTs - plantTs) * 100)
  }
  progress = util.clamp(progress, 0, harvested ? 100 : 99)

  let daysText
  if (harvested) daysText = '已采收'
  else if (daysLeft < 0) daysText = '已到成熟期'
  else if (daysLeft === 0) daysText = '今天可采收'
  else daysText = '距成熟 ' + daysLeft + ' 天'

  return {
    expectedHarvest,
    daysLeft,
    daysText,
    progress,
    // 「生长周期」展示作物标准周期；农户录入明确成熟日期时展示计划周期
    cycleDays: (explicitExpected || batch.harvestDate) ? totalDays : _cycleDays(batch),
    nearMature: !harvested && daysLeft <= NEAR_MATURE_DAYS,
    maturityText: harvested ? '已采收' : ('预计 ' + expectedHarvest + ' 成熟'),
    harvested
  }
}

/**
 * 主推地块排序：在种地块在前；在种地块按距成熟天数升序（越临近越靠前），
 * 同一天数时进度高的在前；无在种批次的地块排最后。
 */
function sortMainPlots(list) {
  return (list || []).slice().sort((a, b) => {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1
    if (!a.active) return String(a.name || '').localeCompare(String(b.name || ''), 'zh')
    const da = (a.daysLeft === null || a.daysLeft === undefined) ? 9999 : a.daysLeft
    const db = (b.daysLeft === null || b.daysLeft === undefined) ? 9999 : b.daysLeft
    if (da !== db) return da - db
    return (b.progress || 0) - (a.progress || 0)
  })
}

module.exports = {
  NEAR_MATURE_DAYS,
  CROP_CYCLE_DAYS,
  STAGE_PROGRESS,
  assessBatch,
  sortMainPlots
}
