// utils/chart.js
// 轻量环境曲线工具：把环境历史采样成折线图数据（toLinechart），
// 配合 Canvas 2D 绘制折线 + 渐变填充。
// 早先还有一份 toSparkline（纯 WXML 条形）给 product 页用，页面改画布后没人再调，
// 留着只会让「曲线」有两种画法，所以删掉——要条形图时再单开接口。

/**
 * 从环境历史采样为折线图数据（Canvas 绘制折线 + 渐变填充）
 * @param {Array} envList 环境历史数组
 * @param {string} field 字段名
 * @param {number} maxPoints 最大点数
 * @returns {{points:Array<{x:number,y:number,value:number,date:string}>, min:number, max:number, rawMin:number, rawMax:number, avg:number, latest:number, dates:Array<[string,string]>}}
 *          points 中的 x/y 都是 0~1 的比例值（相对画布宽高），绘制时乘以 canvas 实际宽高即可。
 *          min/max 加了 10% 呼吸空间，只用于画图；页面上报区间要用 rawMin/rawMax，
 *          否则会显示成「-2.1~43.2℃」这种真实数据里根本不存在的边界。
 */
function toLinechart(envList, field, maxPoints) {
  if (!envList || !envList.length) {
    return { points: [], min: 0, max: 0, rawMin: 0, rawMax: 0, avg: 0, latest: 0, dates: ['', ''] }
  }
  const step = Math.max(1, Math.ceil(envList.length / maxPoints))
  const sampled = []
  for (let i = envList.length - 1; i >= 0; i -= step) {
    sampled.unshift(envList[i])
  }
  const values = sampled.map(e => +e[field])
  const rawMin = Math.min.apply(null, values)
  const rawMax = Math.max.apply(null, values)
  let min = rawMin
  let max = rawMax
  // 给 min/max 加 10% 呼吸空间，折线不顶到画布边缘
  const pad = (max - min) * 0.1 || 1
  min -= pad
  max += pad
  const sum = values.reduce((s, v) => s + v, 0)
  const avg = +(sum / values.length).toFixed(1)
  const range = max - min || 1
  const n = sampled.length
  const points = sampled.map((e, i) => {
    const v = +e[field]
    return {
      x: n <= 1 ? 0.5 : i / (n - 1),          // 水平比例 0 → 1
      y: 1 - (v - min) / range,                // 垂直比例，值越大 y 越小（画布从 0 顶部开始）
      value: v,
      date: e.date
    }
  })
  return {
    points,
    min: +min.toFixed(1),
    max: +max.toFixed(1),
    rawMin: +rawMin.toFixed(1),
    rawMax: +rawMax.toFixed(1),
    avg,
    latest: values[values.length - 1],
    dates: [sampled[0].date, sampled[sampled.length - 1].date]
  }
}

module.exports = { toLinechart }
