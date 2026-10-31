# AGENTS.md · 棚迹开发约定

给接手这个仓库的**人和 AI**。读一遍比读十遍代码省事。

## 开工顺序

1. **先同步远端** —— `git fetch origin` 看有没有新提交，有就拉（见下一节）。不要在没同步的旧代码上开工
2. `npm run check` —— 先确认基线是绿的，别在红灯上叠代码
3. 改数据相关的东西，先看 `utils/store.js` 的接口，不要绕过它
4. 改 UI，先看 `app.wxss` 顶部的 token 和四条硬规则

## 与远端同步

远端是唯一事实来源：<https://github.com/momoqiqi-qwq/penji>。**每次动代码之前**都要查一次，不是每节拍查一次。

```bash
git fetch origin
git rev-list --left-right --count origin/main...HEAD   # 左=远端新提交，右=本地领先
```

- 左边是 `0` → 远端没有新东西，直接开工。
- 左边不是 `0` → 先确认工作区干净（`git status --porcelain` 无输出），再 `git pull --ff-only origin main`。

四条硬规矩：

| # | 规矩 | 为什么 |
| --- | --- | --- |
| 1 | `git pull` 只允许 `--ff-only` | 本地和远端各走了几个提交就会分叉；自动 `merge` / `rebase` 会把别人的改动和你未审的改动搅成一个冲突现场，必须交给人判 |
| 2 | 工作区脏就先提交或 `git stash`，不要带脏活拉取 | 拉取失败时半合并的工作区比冲突更难收拾 |
| 3 | 拉完先 `npm run check`，绿灯才算同步成功 | 远端可能是红的，也可能是别处改坏了的；红灯就停下报告，不要接着写新代码 |
| 4 | `git push` 不由 AI 代劳 | 推上去就是对外发布，必须本人当场明确说 |

**拉到新提交后必须补一条更新日志**（见下一节），这是这条约定的闭合动作——没有日志等于这次同步没做完。

## 更新日志

`README.md` 里的「更新日志」表是这台项目的时间线，任何人都从这里看「最近变了什么」。

- 一次代码更新 = 表格顶部加一行：`YYYY-MM-DD` + 一句话。拉取远端的更新要加，自己改出来的实质变更也要加。
- 一句话说清**对外可见的变化**，不是提交信息复读，也不是文件清单。写「批次档案支持导出图片」，不写「改了 productDetail.js」。

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

**唯一例外：角色色。** 身份选择页（`pages/chooseRole`）用三个色相区分身份——农户 `#17603A` 绿、消费者 `#2D5DA8` 蓝、采购商 `#B4802F` 金。这三个色只出现在「这是谁」的语境里（身份卡、对应身份的账号列表），**不要**扩散到业务页面；业务语义（风险 / 合格 / 告警）仍只用四级绿 + `--warn` / `--gold`。

## 三种身份

| 身份 | 能力 | 判定 |
| --- | --- | --- |
| `consumer` | 扫码、看档案、评价 | `auth.canReview` |
| `farmer` | 地块、建档、农事记录、诊断、上传 | `auth.canEdit` / `auth.canUpload` |
| `buyer` | 批次核验、录入检测 | `auth.canInspect` |

页面入口处用 `getApp().refreshAuth()` 拿当前身份，越权时弹一句人话再退回首页，**不要**静默失败。身份存 `pengji_role_v3`。

登录态（`openid` / `unionid` / 昵称头像）和身份存在**同一个** `pengji_role_v3` 对象里，但两件事互不代表：`auth.clearRole()` 只清业务身份，不动登录态——换身份不是换人。

## 云函数

- 统一返回 `{ ok: true, data }` / `{ ok: false, msg }`。
- 时间戳一律用服务器时间，不接受客户端传的 `ts`。
- 幂等：`readings_daily` 用 `_id = plotId_day`，`initdb` 重复执行返回 `exists`。
- 密钥从环境变量读，代码里的字面量只能用于本地演示。
- 登录只走云函数 `login` 的 `cloud.getWXContext()`，**客户端不存 AppSecret**，也不需要自建服务器换 `code2session`。云开发没就绪时降级成本机身份，界面必须如实标注（`auth.identityLabel()`），不许假装核验过微信身份。
- 用户资料只认用户自己填的（`chooseAvatar` / `type="nickname"`）。`wx.getUserProfile` 现在只返回「微信用户」+ 灰头像，禁止再用。

## 提交

```bash
npm run check          # 先绿
# 在 README.md「更新日志」表顶部补一行
git add -A
git commit -m "feat: 批次档案支持导出图片"
```

前缀：`feat` / `fix` / `docs` / `chore` / `refactor` / `style`。一句话说清改了什么，中文即可。

提交信息说「为什么/改了什么」，更新日志说「用户看得见的变化」——两者不互相替代，都要写。

## 改完记得

- 加了图片 → 要么真用上，要么进 `project.config.json` 的 `packOptions.ignore`（`npm run check` 会提醒）
- 加了页面 → `app.json` 注册，四件套齐全
- 改了 tab → 只改 `utils/tabbar.js`，然后 `app.json` 的 `tabBar.list` 跟着对齐
- 新增计算逻辑 → 写纯函数放 `utils/`，页面只负责取数和展示
