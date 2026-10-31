# 棚迹 Pengji

> 从地块到餐桌 · 看见每一寸土地的故事

面向小农户的**农产品溯源小程序**：田里的传感器数据自动进来，农事记录随手一记，系统生成批次档案并绑定二维码；消费者扫码看这一批菜是怎么长出来的，采购商扫同一张码核验检测结果。

```
传感器（MQTT / 云开发） ──► readings 集合
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
             环境评价 / OPI            农事记录 + 投入品台账
                    │                       │
                    └──────────► 批次档案 ◄─┘
                                    │
                              二维码（批次号）
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
              消费者扫码溯源                 采购商核验 + 录入检测
                     │                             │
                     └──────► 信用分 / 反馈 ◄──────┘
```

## 技术栈

| 项 | 值 |
| --- | --- |
| 类型 | 微信小程序（原生，无框架、无 npm 依赖） |
| AppID | `wx790e94f1d6ddd142` |
| 基础库 | `3.17.2` |
| 后端 | 微信云开发，环境 `cloud1-d9g4y3u2m54e8c635` |
| 页面 | 16 个，其中 4 个自定义 tabBar 页 |
| 代码量 | 约 150 文件 / 1.3 MB（资源占 0.78 MB，主包约 0.99 MB） |

项目**刻意保持零依赖**：二维码编码器（`utils/qrcode.js`）、MQTT 客户端（`utils/mqtt.js`）都是手写的最小实现。加依赖前先想清楚为什么。

## 快速开始

```bash
# 1. 自检（改完代码先跑这个）
npm run check

# 2. 用微信开发者工具打开项目根目录
#    E:\E-Develop-Project\微信web开发者工具\cli.bat  (命令行可用 cli)
```

打开后即可运行：`utils/mock.js` 会种下一套完整演示数据（4 位农户 / 5 块地 / 若干批次 / 农事记录 / 检测报告），无需云环境也能走完全流程。

**第一次运行请先选身份**（`pages/chooseRole`）：

| 身份 | 能做什么 | 演示账号 |
| --- | --- | --- |
| 农户 farmer | 地块、批次、农事记录、AI 诊断、环境实况 | 张老汉 F-001 / 王秀英 F-002 / 李建国 F-003 / 赵桂花 F-004 |
| 消费者 consumer | 扫码头溯源、看档案、评价 | 任意 |
| 采购商 buyer | 主推农地块（按成熟倒计时排序）、预订购、批次核验、录入食品检测 | 演示采购商 |

重置演示数据：`utils/store.resetAll()`，或清掉小程序缓存（存储键 `pengji_mock_v6`，结构版本 `version: 8`，版本不符会自动重建）。

## 目录结构

```
├── app.js / app.json / app.wxss      入口、路由表、设计系统（token 全在 app.wxss 顶部）
├── config.js                         云环境 ID（唯一一处）
├── custom-tab-bar/                   自定义底栏：只渲染，列表来自 utils/tabbar.js
├── pages/                            16 个页面
│   ├── index / plot / scan / simulate      4 个 tabBar 页
│   ├── chooseRole                           身份选择
│   ├── plotDetail / plotEdit                地块详情 / 新建地块
│   ├── product / productEdit / qr           批次档案 / 建档 / 二维码
│   ├── addRecord                            农事记录录入
│   ├── farmer / farmerDetail / buyer        农户主页 / 农户档案 / 采购商工作台（主推地块 + 预订购）
│   ├── diagnose                             农技诊断（本地规则库）
│   └── inspect                              采购商批次核验 + 检测录入
├── utils/                            全部能力层，页面只调这里
│   ├── store.js                      唯一的读写入库口（替换成 wx.cloud 即接真后端）
│   ├── mock.js                       演示数据种子 + 本地持久化
│   ├── auth.js                       微信登录（openid）+ 三身份与权限判定
│   ├── sensors.js                    四参数读数：自动/实况/云端/演示 四种来源
│   ├── ai.js                         作物适宜区间、环境分析、OPI 指数
│   ├── credit.js                     农户信用分（六档 AAA→D）
│   ├── maturity.js                   生长周期与成熟倒计时（主推地块排序依据）
│   ├── diagnose.js + diag-kb.js      农技诊断引擎 + 知识库
│   ├── tabbar.js 底栏唯一配置 · qrcode.js 二维码 · mqtt.js MQTT 客户端
│   └── cloud.js 云函数调用封装 · chart.js 折线 · util.js 格式化
├── cloudfunctions/                   7 个云函数（见下表）
├── assets/                           图标与插图（未引用的已在 packOptions 里排除）
└── scripts/check.js                  静态自检
```

## 数据层：只有一个入口

`utils/store.js` 是**唯一**的数据访问层，页面从不直接读写 storage，也不直接 `require('utils/mock.js')`（`npm run check` 会拦住）。

```js
const store = require('../../utils/store.js')

store.listPlotsByFarmer(farmerId)   // 读
store.addRecord({ ... })            // 写
store.getBatchOPI(batchId)          // 派生计算（不落库）
```

- 内部实现是 `mock.load() / mock.save()`，注释里写明「真实部署时仅需替换内部实现为 `wx.cloud.*`，接口不变」——接云开发时**不要**改页面。
- 任何写操作都会经过 `_persist()`，并重算受影响农户的信用分（`_recalcFarmer` → `credit.evaluateFarmer`），信用分只有这一个口径。
- 页面加载时统一 `getApp().refreshAuth()` 拿当前身份，`auth.canEdit / canUpload / canReview / canInspect` 判权限。

## 传感器链路

四参数：`airTemp` 空气温度、`airHumidity` 空气湿度、`light` 光照、`soilMoisture` 土壤湿度。

三种来源在 UI 上**必须如实标注**（`sensors.sourceLabel`）：`【实时直连真实数据】` / `【云端采集真实数据】` / `【演示模拟数据】`。演示数据不得伪装成真实采集——这是这个产品的立身之本。

| 来源 | 通道 | 说明 |
| --- | --- | --- |
| `live` | `wss://broker.emqx.io:8084/mqtt`，topic `mcub3a909` | 浏览器直连 MQTT；帧格式 `wwz` + 4×int8(温/湿/光/土) + `end` |
| `cloud` | 云开发数据库 `readings` 集合 `watch()` | 需集合权限「所有用户可读」，失败自动回落轮询，缓存 8 s |
| `demo` | `utils/mock.js` 种子 + 随机漂移 | 无硬件时的兜底 |

来源模式存在 `pengji_sensor_mode`（`auto`/`live`/`cloud`/`demo`），默认 `auto` 按优先级降级。

## 云函数

| 函数 | 触发 | 职责 |
| --- | --- | --- |
| `initdb` | 手动执行一次 | 建 `readings` / `devices` / `alerts` / `readings_daily` / `users` 五个集合，幂等 |
| `login` | 前端调用 | 微信登录：`getWXContext()` 取 `OPENID`/`UNIONID`，顺手 upsert `users`（`_id = openid`）。**不需要 AppSecret** |
| `ingest` | HTTP 访问服务 / callFunction | 设备上报入口。设备密钥 `pengji-01` 或环境变量 `PENGJI_DEVICE_KEYS`（≥16 位，`CHANGE_ME` 开头视为未配置）；阈值告警、900 ms 防重放、30 min 在线窗口；时间戳以服务器为准 |
| `latest` | 手动 / 前端调用 | 取某地块最新一条读数 + 在线状态 |
| `history` | 前端调用 | ≤300 条原始数据，或 `daily=true` 按天聚合 |
| `stats` | 定时器 `0 10 1 * * * *`（每天 01:10） | 把昨天 rollup 进 `readings_daily`（`_id = plotId_day`，幂等）；直接调用则返回区间统计 |
| `mqttPull` | 定时器 `0 * * * * * *`（每分钟） | 云函数侧主动拉 MQTT，多帧取平均写 1 条读数 |

部署顺序：`initdb` → `login` → 其余 5 个 → 在控制台给 `readings` 设「所有用户可读」→ 部署 `stats` / `mqttPull` 的定时触发器。所有云函数统一返回 `{ ok: true, data }` 或 `{ ok: false, msg }`，前端由 `utils/cloud.js` 解包。

## 登录链路

```
wx.login() ──code──▶ （不发给任何人）
       └─▶ 云函数 login ──getWXContext()──▶ openid / unionid
                                   └─▶ users 集合（_id = openid，幂等 upsert）
```

- **不碰 AppSecret。** 云开发里云函数天然带调用方身份，`cloud.getWXContext()` 直接给 `OPENID`；省掉 AppSecret 保管、`access_token` 刷新和请求域名白名单。以后要接自建后端，才把 `wx.login` 的 code 拿去 `code2session`（5 分钟过期、一次性）。
- `utils/auth.js` 的 `ensureLogin()` 是幂等的：已有 openid 直接复用，不重复调云函数；`chooseRole()` 内部会先确保登录。
- **身份与登录分开存。** `clearRole()` 只清 `chosen/role/farmerId/buyerId`，openid 与昵称头像保留——换身份不是换人。
- **云开发没就绪时降级为本机身份**：`openid` 留空、`identitySource = 'local'`，`identityLabel()` 返回「本机身份 · 未连云端」，首页在昵称旁如实标出来。不阻断进小程序，但不假装核验过微信身份（和传感器来源标签同一条纪律）。
- **头像昵称只能用户自己填**（`open-type="chooseAvatar"` + `<input type="nickname">`）。`wx.getUserProfile` 从 2022-10 起只返回「微信用户」+ 灰头像，等于假数据，已不再使用。头像走 `wx.cloud.uploadFile` 换 `fileID`（`avatar/<openid>.png`，同一人覆盖同一份），因为 `chooseAvatar` 给的是重启即失效的临时路径。
- 注册农户时把注册人 openid 记在 `farmers.openid` 上（`store.registerFarmer(name, village, openid)`）。

> 需要在微信侧自己动手的：① 小程序后台「隐私保护指引」里声明收集头像昵称；② 云开发控制台把 `login` 云函数上传部署；③ 真机预览（模拟器里 openid 与云存储都能通，但 `chooseAvatar` 只在真机/近版本开发者工具里正常）。

## 两套评价模型

**农户信用分**（`utils/credit.js`，0–100，六档 AAA/AA/A/B/C/D）——依据 GB/T 23794-2023、农产品质量安全法（2022）§54、农业农村部令 2025 年第 4 号、浙江千分制与广西六档试点。权重：履约意愿 20 / 履约能力 40 / 履约行为 40；严重失信每条 −15，经核实投诉每条 −8；检测不合格对检测项一票否决。

**OPI 有机生产评价指数**（`utils/ai.js`，0–100）——对标 NY/T 3667-2020《生态农场评价技术规范》：环境监测 30（连续采集满 30 天满分）/ 种植过程 50（农事、投入品、过程三项等权）/ 质量保障与追溯 20（检测 10 + 追溯档案 10）。等级：≥90 优秀 / ≥75 良好 / ≥60 一般 / ≥40 存在风险 / <40 风险较高。

外加**有机合规核验**（`store.getOrganicCompliance`）：转换期（一年生 ≥24 个月、多年生果树 ≥36 个月，GB/T 19630-2019 §4.2.1.1）、隔离缓冲带、禁用投入品扫描（含「未使用化肥」这类否定表述的排除逻辑）。

## 设计系统

全部 token 在 `app.wxss` 顶部，四条硬规则写在文件头注释里：

1. 绿色只有四级（`--ink` / `--green` / `--lime` / `--green-mist`），不要引入第五种
2. 字号阶梯只有 6 级：20 / 22 / 24 / 26 / 32 / 40 rpx
3. 阴影永远两层（近实 + 远散），单层一定显廉价
4. 圆角只用 `--r-sm 16` / `--r-md 24` / `--r-lg 32` / `--r-xl 44rpx`

底色 `--bg: #F6F5F1` 是暖纸白，`--lime: #C8E96B` 是唯一高光色，用量控制在 5% 以内。

唯一的例外是**角色色**：身份选择页用 农户绿 `#17603A` / 消费者蓝 `#2D5DA8` / 采购商金 `#B4802F` 三个色相区分身份，只用于「这是谁」，不进入业务语义。

## 自检

```bash
npm run check          # 有问题退出码 1
npm run check:strict   # 警告也算失败，发版前跑
```

检查 10 项：JSON 可解析、JS 语法、页面四件套齐全、tabBar 三处一致、WXML 事件处理器真实存在、`require` 路径可解析、图片引用存在、页面没有绕过 store.js 写数据、孤立文件、主包体积（上限 2 MB）。

## 更新日志

一次代码更新加一行，新的写最上面。日期用 `YYYY-MM-DD`，一句话说清用户看得见的变化。约定见 [AGENTS.md](AGENTS.md)「更新日志」。

| 日期 | 更新 |
| --- | --- |
| 2026-11-01 | 固化与远端同步的约定：开工先 `git fetch`，有新提交就 `--ff-only` 拉取，并在本表补一行日志 |
| 2026-11-01 | 云端登录上线：登录改走云函数 `login` 的 `getWXContext()`，身份与登录态拆开，首页按登录态分流；身份选择页头图居中并加棚迹图标，角色卡改成整块渐变底 |
| 2026-10-31 | 采购商端：主推农地块按成熟倒计时排序，支持预订购 |
| 2026-10-31 | 身份选择页三种身份各用一种颜色，采购商金色正文压深一档过 AA 对比度 |

## 已知问题与待办

| 优先级 | 事项 | 说明 |
| --- | --- | --- |
| P0 | 照片不落云存储 | `plotEdit` / `productEdit` 选完图只存 `tempFilePath`，重进小程序即失效。接 `wx.cloud.uploadFile` 后再写回 fileID |
| P0 | 数据层仍是本地 mock | 多设备看到的是各自的本地数据，需要按 `store.js` 的接口逐个替换为云开发实现 |
| P1 | 设备密钥是字面量 | `ingest` 里 `pengji-01` 仅作演示，生产必须走环境变量 `PENGJI_DEVICE_KEYS` |
| P1 | 无字号无障碍开关 | 曾有一版 `largeFont` 机制（WXML 已留位）但从未接线，已移除；真要做需要一个新的设置入口 |
| P2 | 无分包 | 主包 1.04 MB 尚安全，插图继续增长时把 `assets/` 拆进分包 |
| P2 | 无自动化测试 | 目前只有静态自检；核心计算（`credit` / `ai.calcOPI` / `diagnose`）值得补纯函数单测 |

## 提交前

```bash
npm run check && git add -A && git commit -m "feat: ..."
```

约定见 [AGENTS.md](AGENTS.md)。
