# agent.md · 棚迹项目 Agent 约定（速查）

这份文件把「接手的 AI 每次都要做的事」固定下来，完整版见 [AGENTS.md](AGENTS.md)；两份冲突时以 `AGENTS.md` 为准。

远端是唯一事实来源：<https://github.com/momoqiqi-qwq/penji>

## 一、每次动代码之前，先查远端有没有新提交

```bash
git fetch origin
git rev-list --left-right --count origin/main...HEAD   # 左=远端新提交，右=本地领先
```

- 左边是 `0` → 远端没有新东西，直接开工。
- 左边不是 `0` → 工作区先干净（`git status --porcelain` 无输出，脏就先提交或 `git stash`），再 `git pull --ff-only origin main`。
- **有这个仓库里的一处本地配置：** 本机 Windows 直连 GitHub 会失败，必须先设好仓库本地配置（已设，换机器重设）：

```bash
git config --local http.proxy  http://127.0.0.1:7890
git config --local https.proxy http://127.0.0.1:7890
git config --local http.sslBackend openssl   # schannel 在本机握手报 SEC_E_NO_CREDENTIALS
```

## 二、拉到了更新，就在 README.md 补一条更新日志

`README.md` →「更新日志」表格**顶部**加一行：

```
| YYYY-MM-DD | 一句话说清用户看得见的变化 |
```

- 拉取远端的新提交要加；自己改出来的实质变更也要加。
- 写对外可见的变化，不写提交信息复读、不写文件清单（写「批次档案支持导出图片」，不写「改了 productDetail.js」）。
- 没有日志等于这次同步没做完。

## 三、同步完先自检，绿灯才算成功

```bash
npm run check     # 有问题退出码 1；本机没有全局 node 时用 DSH 自带 node：
# C:\Users\Fantong\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe scripts/check.js
```

红灯就停手报告，不要在红灯上叠新代码。

## 四、红线

1. `git pull` 只允许 `--ff-only`，不做自动 `merge` / `rebase`（分叉交给人判）。
2. 不带脏工作区拉取。
3. `git push` 不由 AI 代劳，必须本人当场明确说。
4. 页面只通过 `utils/store.js` 读写数据，不 require `utils/mock.js`，tab 只在 `utils/tabbar.js` 的 `TABS` 定义，读数必须带来源标签，信用分只走 `credit.evaluateFarmer`，保持零 npm 依赖。

## 五、提交

```bash
npm run check          # 先绿
# README.md「更新日志」补一行
git add -A
git commit -m "feat: ..."   # 前缀 feat / fix / docs / chore / refactor / style
```
