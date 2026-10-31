#!/usr/bin/env node
/**
 * 棚迹 · 静态自检（零依赖，Node >= 18）
 *
 *   node scripts/check.js            通过即退出码 0，有错误退出码 1
 *   node scripts/check.js --strict   警告也视为失败（发版前跑这个）
 *
 * 检查项：
 *   1  JSON 可解析
 *   2  JS 语法
 *   3  app.json 页面注册齐全（js/json/wxml/wxss 四件套）
 *   4  tabBar 唯一性：app.json / utils/tabbar.js / custom-tab-bar 三处必须一致
 *   5  WXML 事件处理器在对应 JS 中真实存在（防「点了没反应」）
 *   6  require 相对路径可解析
 *   7  静态资源引用存在（防图片 404）
 *   8  分层规则：页面不直接写 storage / 不直接 require mock
 *   9  孤立文件：未注册页面、未被引用的 utils、未被引用的图片
 *  10  主包体积（上限 2 MB）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
const STRICT = process.argv.includes('--strict')

const fails = []
const warns = []
const oks = []
const fail = (m) => fails.push(m)
const warn = (m) => warns.push(m)
const ok = (m) => oks.push(m)

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
const abs = (p) => {
  // 小程序里以 / 开头的是「包根路径」，不是文件系统根
  if (p.startsWith('/')) return path.join(ROOT, p.slice(1))
  return path.isAbsolute(p) ? p : path.join(ROOT, p)
}
const read = (p) => fs.readFileSync(abs(p), 'utf8')
const exists = (p) => fs.existsSync(abs(p))

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'miniprogram_npm', '.temp', '.upload',
  'coverage', '.idea', '.vscode'
])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(path.join(dir, entry.name), out)
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

const ALL = walk(ROOT)
const allRel = ALL.map(rel)
const byExt = (ext) => ALL.filter((f) => f.endsWith(ext))

/* ============================ 1. JSON ============================ */
function checkJson() {
  const files = byExt('.json')
  for (const f of files) {
    try {
      JSON.parse(read(f))
    } catch (e) {
      fail(`${rel(f)} JSON 解析失败：${e.message}`)
    }
  }
  ok(`${files.length} 个 JSON 文件可解析`)
  return JSON.parse(read('app.json'))
}

/* ============================ 2. JS 语法 ============================ */
function checkJsSyntax() {
  const files = byExt('.js')
  for (const f of files) {
    try {
      // 仅编译不执行：能抓出括号/引号/as const 之类的语法错误
      new vm.Script(read(f), { filename: rel(f) })
    } catch (e) {
      fail(`${rel(f)} 语法错误：${e.message}`)
    }
  }
  ok(`${files.length} 个 JS 文件语法正常`)
}

/* ============================ 3. 页面注册 ============================ */
function checkPages(appJson) {
  const pages = appJson.pages || []
  const exts = ['.js', '.json', '.wxml', '.wxss']
  for (const p of pages) {
    for (const ext of exts) {
      if (!exists(p + ext)) fail(`页面 ${p} 缺少 ${ext}（app.json 已注册）`)
    }
  }
  const registered = new Set(pages)
  const onDisk = fs
    .readdirSync(abs('pages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => 'pages/' + d.name + '/' + d.name)
    .filter((p) => exists(p + '.wxml'))
  for (const p of onDisk) {
    if (!registered.has(p)) warn(`${p} 存在于磁盘但未在 app.json 注册（不会被编译）`)
  }
  ok(`${pages.length} 个页面注册完整`)
  return pages
}

/* ============================ 4. tabBar 一致性 ============================ */
function checkTabBar(appJson) {
  const cfg = appJson.tabBar
  if (!cfg) return warn('app.json 未配置 tabBar')

  const appTabs = (cfg.list || []).map((t) => t.pagePath)
  const pages = new Set(appJson.pages || [])
  for (const p of appTabs) {
    if (!pages.has(p)) fail(`tabBar.list 中的 ${p} 不在 app.json pages 内`)
  }

  // utils/tabbar.js 是唯一配置源
  const { TABS } = require(abs('utils/tabbar.js'))
  const utilTabs = TABS.map((t) => t.pagePath)
  if (JSON.stringify(utilTabs) !== JSON.stringify(appTabs)) {
    fail(`tabBar 定义漂移：utils/tabbar.js TABS = [${utilTabs}]，app.json tabBar.list = [${appTabs}]`)
  }

  if (cfg.custom) {
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      if (!exists('custom-tab-bar/index' + ext)) fail(`custom:true 但缺少 custom-tab-bar/index${ext}`)
    }
    // 组件里不应再自建一份 TABS
    const src = read('custom-tab-bar/index.js')
    if (/const\s+ALL_TABS\s*=/.test(src)) {
      fail('custom-tab-bar/index.js 自建了 ALL_TABS，应从 utils/tabbar.js 取 TABS（三处定义必然漂移）')
    }
    if (!/require\(['"]\.\.\/utils\/tabbar\.js['"]\)/.test(src)) {
      warn('custom-tab-bar/index.js 未引用 utils/tabbar.js')
    }
  }
  ok(`tabBar 与 utils/tabbar.js 一致（${appTabs.length} 项）`)
}

/* ============================ 5. 事件处理器 ============================ */
function checkHandlers(pageList) {
  const targets = pageList.map((p) => ({ wxml: p + '.wxml', js: p + '.js' }))
  targets.push({ wxml: 'custom-tab-bar/index.wxml', js: 'custom-tab-bar/index.js' })

  let checked = 0
  const bindRe = /(?:bind|catch|capture-bind|capture-catch):?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g

  for (const t of targets) {
    if (!exists(t.wxml) || !exists(t.js)) continue
    const wxml = read(t.wxml)
    const js = read(t.js)
    const seen = new Set()
    let m
    while ((m = bindRe.exec(wxml))) {
      const name = m[1].trim()
      if (!/^[A-Za-z_$][\w$]*$/.test(name) || seen.has(name)) continue
      seen.add(name)
      checked++
      const defRe = new RegExp(`(?:^|[\\s,{])(?:async\\s+)?${name}\\s*(\\(|:\\s*(?:async\\s*)?(?:function|\\())`, 'm')
      if (!defRe.test(js)) {
        fail(`${t.wxml} 绑定了 ${name}，但 ${t.js} 中没有该方法`)
      }
    }
  }
  ok(`${checked} 个 WXML 事件处理器均有实现`)
}

/* ============================ 6. require 路径 ============================ */
function checkRequires() {
  let n = 0
  const reqRe = /require\(\s*['"](\.[^'"]*)['"]\s*\)/g
  for (const f of byExt('.js')) {
    const src = read(f)
    let m
    while ((m = reqRe.exec(src))) {
      n++
      const target = path.resolve(path.dirname(f), m[1])
      const candidates = [target, target + '.js', target + '.json', path.join(target, 'index.js')]
      if (!candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile())) {
        fail(`${rel(f)} require('${m[1]}') 无法解析`)
      }
    }
  }
  ok(`${n} 处 require 相对路径可解析`)
}

/* ============================ 7. 静态资源 ============================ */
function checkAssets() {
  let n = 0
  const assetRe = /["'(](\/?(assets\/[A-Za-z0-9_\-\/\.]+\.(?:png|jpe?g|gif|svg|webp)))/g
  for (const f of ALL.filter((x) => /\.(wxml|wxss|js|json)$/.test(x))) {
    const src = read(f)
    let m
    while ((m = assetRe.exec(src))) {
      n++
      if (!exists(m[1])) fail(`${rel(f)} 引用了不存在的图片 ${m[1]}`)
    }
  }
  ok(`${n} 处图片引用均存在`)
}

/* ============================ 8. 分层规则 ============================ */
function checkLayering() {
  const pageJs = byExt('.js').filter((f) => rel(f).startsWith('pages/'))
  for (const f of pageJs) {
    const src = read(f)
    if (/wx\.setStorageSync|wx\.removeStorageSync|wx\.clearStorageSync/.test(src)) {
      fail(`${rel(f)} 直接写入了本地存储，数据写入应统一走 utils/store.js`)
    }
    if (/require\(['"][^'"]*mock\.js['"]\)/.test(src)) {
      fail(`${rel(f)} 直接引用了 utils/mock.js，页面只能经 utils/store.js 取数`)
    }
  }

  // 全局字段引用必须真的在 app.js globalData 里定义过
  const appSrc = read('app.js')
  const gdStart = appSrc.indexOf('globalData')
  if (gdStart >= 0) {
    let depth = 0
    let end = gdStart
    let started = false
    for (let i = gdStart; i < appSrc.length; i++) {
      const ch = appSrc[i]
      if (ch === '{') { depth++; started = true }
      else if (ch === '}') { depth--; if (started && depth === 0) { end = i; break } }
    }
    const body = appSrc.slice(gdStart, end)
    const keys = new Set()
    let km
    const keyRe = /(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:/g
    while ((km = keyRe.exec(body))) keys.add(km[1])

    const used = new Map()
    for (const f of ALL.filter((x) => x.endsWith('.js') && !rel(x).startsWith('scripts/'))) {
      const src = read(f)
      let um
      const useRe = /globalData\.([A-Za-z_$][\w$]*)/g
      while ((um = useRe.exec(src))) {
        if (!used.has(um[1])) used.set(um[1], rel(f))
      }
    }
    for (const [k, where] of used) {
      if (!keys.has(k)) warn(`getApp().globalData.${k} 被 ${where} 使用，但 app.js globalData 未定义`)
    }
  }
  ok(`页面未绕过 store.js 写数据（${pageJs.length} 个页面）`)
}

/* ============================ 9. 孤立文件 ============================ */
function loadPackIgnores() {
  try {
    const cfg = JSON.parse(read('project.config.json'))
    return ((cfg.packOptions && cfg.packOptions.ignore) || []).map((it) => ({
      type: it.type,
      value: String(it.value || '').replace(/^\/+/, '')
    }))
  } catch (e) {
    return []
  }
}

function isPackIgnored(relPath, ignores) {
  return ignores.some((it) =>
    it.type === 'folder'
      ? relPath === it.value.replace(/\/$/, '') || relPath.startsWith(it.value.replace(/\/$/, '') + '/')
      : relPath === it.value
  )
}

function checkOrphans(appJson, ignores) {
  const sourceText = ALL.filter((f) => /\.(js|wxml|wxss|json)$/.test(f))
    .filter((f) => !rel(f).startsWith('scripts/'))
    .map(read)
    .join('\n')

  // utils 层孤立模块
  for (const f of byExt('.js').filter((x) => rel(x).startsWith('utils/'))) {
    const name = path.basename(f)
    if (name === 'store.js') continue
    const used = ALL.filter((x) => x !== f && /\.js$/.test(x))
      .some((x) => new RegExp(`require\\(['"][^'"]*${name.replace('.', '\\.')}['"]\\)`).test(read(x)))
    if (!used) warn(`utils/${name} 没有被任何文件 require`)
  }

  // 图片未被引用
  const assetFiles = allRel.filter((r) => r.startsWith('assets/'))
  let unreferenced = 0
  for (const a of assetFiles) {
    if (isPackIgnored(a, ignores)) continue
    if (!sourceText.includes(a)) {
      unreferenced++
      warn(`${a} 未被引用（建议加入 project.config.json 的 packOptions.ignore）`)
    }
  }
  ok(`资源引用审计完成（${assetFiles.length} 个资源，${unreferenced} 个未引用）`)
}

/* ============================ 10. 包体积 ============================ */
function checkSize(ignores) {
  const extraSkip = ['scripts/', 'docs/', 'package.json', 'package-lock.json', '.editorconfig', '.gitignore', 'README.md', 'AGENTS.md']
  let total = 0
  for (const f of ALL) {
    const r = rel(f)
    if (r.endsWith('.md')) continue
    if (extraSkip.some((s) => r === s || r.startsWith(s))) continue
    if (isPackIgnored(r, ignores)) continue
    total += fs.statSync(f).size
  }
  const mb = total / 1024 / 1024
  const msg = `主包体积约 ${mb.toFixed(2)} MB（上限 2.00 MB）`
  if (mb > 2) fail(msg + '，已超限')
  else if (mb > 1.8) warn(msg + '，接近上限')
  else ok(msg)
}

/* ============================ 运行 ============================ */
const ignores = loadPackIgnores()
const appJson = checkJson()
checkJsSyntax()
const pageList = checkPages(appJson)
checkTabBar(appJson)
checkHandlers(pageList)
checkRequires()
checkAssets()
checkLayering()
checkOrphans(appJson, ignores)
checkSize(ignores)

console.log('\n棚迹 · 静态自检\n' + '─'.repeat(56))
for (const m of oks) console.log('  ✔ ' + m)
for (const m of warns) console.log('  ⚠ ' + m)
for (const m of fails) console.log('  ✘ ' + m)
console.log('─'.repeat(56))
console.log(`  通过 ${oks.length} 项 · 警告 ${warns.length} 项 · 错误 ${fails.length} 项\n`)

if (fails.length) process.exit(1)
if (STRICT && warns.length) {
  console.log('  --strict：警告视为失败\n')
  process.exit(1)
}
