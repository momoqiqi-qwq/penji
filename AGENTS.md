# AGENTS.md · 棚迹开发约定

给接手这个仓库的**人和 AI**。读一遍比读十遍代码省事。

## 开工顺序

1. `npm run check` —— 先确认基线是绿的，别在红灯上叠代码
2. 改数据相关的东西，先看 `utils/store.js` 的接口，不要绕过它
3. 改 UI，先看 `app.wxss` 顶部的 token 和四条硬规则

## 六条不可破坏的不变量

| # | 规则 | 为什么 |
| --- | --- | --- |
| 1 | 页面**只能**通过 `utils/store.js` 读写数据 | 它是唯一入库口，换成云开发时只改这一个文件；页面直接写 storage 会让迁移变成全量重写 |
| 2 | 页面**不得** `require('utils/mock.js')` | mock 是 store 的实现细节 |
| 3 | tab 列表只在 `utils/tabbar.js` 的 `TABS` 里定义一次 | 曾经 `app.json` / `utils/tabbar.js` / `custom-tab-bar` 各存一份并漂移，导致消费者进实况页没有高亮 |
| 4 | 传感器读数必须带来源标签 | `【实时直连真实数据】`/`【云端采集真实数据】`/`【演示模拟数据】` 三者不可混用、不可省略。演示数据伪装成真实采集会直接毁掉产品的前提 |
| 5 | 信用分只有一个算法 | `credit.evaluateFarmer`，由 `store._recalcFarmer` 统一调用，不要在页面里自己算 |
| 6 | 零依赖 | 没有 npm 依赖；二维码、MQTT 都是手写的最小实现。加依赖必须先说服人 |

`npm run check` 会拦住 1、2、3 的违规，其余靠自觉。

## 代码风格

- **中文注释**，写「为什么」，不写「做了什么」。文件头一行说明这个文件负责什么。
- **不写行尾分号**，2 空格缩进，单引号，对象字面量尾逗号不保留。
- 事件处理器命名：`onXxx`（表单输入）/ `submitXxx` / `goXxx`（跳转）/ `_xxx`（内部方法）。WXML 里 `bindtap` 必须能在同目录 JS 里找到同名方法——`check.js` 会检查。
- 页面 data 只放渲染需要的；原始读数、定时器句柄等挂 `this._xxx`。
- 定时器 / 订阅在 `onHide`、`onUnload` 里必须停掉（参考 `pages/simulate`）。
- 单位、单位符号、日期格式统一用 `utils/util.js`。

## 设计纪律

四条硬规则（`app.wxss` 文件头也写着）：

1. 绿色只有四级：`--ink` / `--green` / `--lime` / `--green-mist`。要第五种说明设计错了。
2. 字号只有 6 级：**20 / 22 / 24 / 26 / 32 / 40 rpx**。不要出现 27rpx。
3. 阴影永远两层（近实 + 远散），用 `--sh-1` / `--sh-2` / `--sh-btn`。
4. 圆角只用 `--r-sm` / `--r-md` / `--r-lg` / `--r-xl`。

`--lime` 用量 < 5%，它是高光不是主色。新组件先在 `app.wxss` 找有没有可复用的 `.card` / `.tag` / `.btn` / `.section-title`。

## 三种身份

| 身份 | 能力 | 判定 |
| --- | --- | --- |
| `consumer` | 扫码、看档案、评价 | `auth.canReview` |
| `farmer` | 地块、建档、农事记录、诊断、上传 | `auth.canEdit` / `auth.canUpload` |
| `buyer` | 批次核验、录入检测 | `auth.canInspect` |

页面入口处用 `getApp().refreshAuth()` 拿当前身份，越权时弹一句人话再退回首页，**不要**静默失败。身份存 `pengji_role_v3`。

## 云函数

- 统一返回 `{ ok: true, data }` / `{ ok: false, msg }`。
- 时间戳一律用服务器时间，不接受客户端传的 `ts`。
- 幂等：`readings_daily` 用 `_id = plotId_day`，`initdb` 重复执行返回 `exists`。
- 密钥从环境变量读，代码里的字面量只能用于本地演示。

## 提交

```bash
npm run check
git add -A
git commit -m "feat: 批次档案支持导出图片"
```

前缀：`feat` / `fix` / `docs` / `chore` / `refactor` / `style`。一句话说清改了什么，中文即可。

## 改完记得

- 加了图片 → 要么真用上，要么进 `project.config.json` 的 `packOptions.ignore`（`npm run check` 会提醒）
- 加了页面 → `app.json` 注册，四件套齐全
- 改了 tab → 只改 `utils/tabbar.js`，然后 `app.json` 的 `tabBar.list` 跟着对齐
- 新增计算逻辑 → 写纯函数放 `utils/`，页面只负责取数和展示
