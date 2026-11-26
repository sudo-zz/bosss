# 招聘助手 × boss-cli（macOS Safari 能力包 + 纯静态展示工作台）

专配 **WorkBuddy / 千问办公 / 豆包工作 / Claude Code / Codex** 等带浏览器分屏模式的桌面 Agent 设计：
- **左边 Agent 对话框**：由你熟悉的 AI 工具调用内置 Skill 与本地 `boss` CLI 操控本机 Safari（读未读、拉取推荐/精选牛人、转存 Boss 在线简历、归档本地 PDF 简历、经确认后发消息/打招呼）。
- **右边浏览器（`http://127.0.0.1:7788`）**：打开超轻量纯静态只读工作台 **`boss-desk`**，自动监听 `~/.boss-cli/` 文件变化在 1 秒内无感刷新，专注宽屏展示 **多来源统计、岗位+来源双标签、差异化筛选、只读阶段看板、内嵌 PDF 跳页查看、Boss 在线简历本地存档**，且右上角支持直连 GitHub **一键检查更新**（零数据影响）。

---

## 新电脑一键安装（macOS，零 DSH、零编译、约 3 秒）

打开新 Mac 的「终端」，粘贴执行这一条命令即可（自动准备 Node 22、安装 `boss` 与 `boss-desk`、同步 `boss-safari-recruiter` Skill、并在桌面生成「启动招聘助手.command」双击图标；新电脑初始化数据为空）：

```bash
curl -fsSL https://raw.githubusercontent.com/sudo-zz/bosss/main/install.sh | bash
```

### 首次使用（3 步）
1. **开启 Safari 自动化权限（仅需一次）**：
   - Safari → **设置（⌘,）→ 高级** → 勾选「显示网页开发者功能」
   - 顶部菜单 **开发** → 勾选「允许来自 Apple 事件的 JavaScript」
2. **在 Safari 登录 Boss 直聘招聘端**：https://www.zhipin.com/web/chat/index
3. **双击桌面的「启动招聘助手.command」**（或在终端执行 `boss-desk`）打开 `http://127.0.0.1:7788`，并在 WorkBuddy 等 Agent 的浏览器模式中加载该地址即可配合左侧对话框使用。

---

## 核心能力

- **纯 Safari 驱动（`boss` CLI）**：使用 macOS AppleScript 驱动本机日常 `Safari.app`，复用真实登录态，无 Chrome/Puppeteer 依赖；所有对外写操作默认 dry-run，必须明确确认并加 `--confirm` 才执行，且内置每日配额与最小写间隔。
- **多来源筛选与双标签**：支持 `消息列表`（`message`）、`推荐牛人`（`recommend`）、`精选牛人`（`featured`）三类来源（不含「最新」），按岗位 × 来源实时统计与差异化筛选，每位候选人同时展示 **岗位标签 + 来源标签**。
- **内嵌 PDF 查看器（本地存储 + 跳页）**：将候选人 PDF 简历放入 `~/.boss-cli/resumes/pdf/<姓名>.pdf`，工作台自动识别并支持内嵌预览、页码输入/`P1..PN` 快捷跳转（`#page=N`）与评估页点击跳页。
- **Boss 在线简历本地存档**：Agent 调用 `boss action resume` 或 `boss preview --tab recommend|featured` 自动将在线简历转存为 `~/.boss-cli/resumes/online/<姓名>.json` 与 `.md`，后续离线零额度查看。
- **实时自动刷新 + 一键检查更新**：后端通过 `fs.watch` + SSE 监听 `~/.boss-cli/`，Agent 写完数据右侧浏览器自动同步；右上角「检查更新」直连 GitHub Releases CDN 校验 SHA-256 并原子升级程序，绝不改动本地简历与台账。

---

## 本地数据目录规范（`~/.boss-cli/`）

本仓库不包含任何候选人隐私数据，所有招聘数据仅保存在使用者本机（详见 [`skills/boss-safari-recruiter/references/data-spec.md`](skills/boss-safari-recruiter/references/data-spec.md)）：

| 路径 | 说明 |
| --- | --- |
| `~/.boss-cli/tracker.json` | 候选人台账（推荐用 `boss tracker upsert` 维护） |
| `~/.boss-cli/resumes/pdf/` | 候选人附件 PDF 简历（内嵌 PDF 查看器直接读取） |
| `~/.boss-cli/resumes/online/` | Boss 在线简历本地 JSON/MD 存档（离线零额度查看） |
| `~/.boss-cli/sourcing/` | 推荐牛人 / 精选牛人拉取快照 |
| `~/.boss-cli/eval/data.json` | 「面试评估」模块深度评估数据（可选） |
| `~/.boss-cli/avatars/` | 候选人头像缓存 |
| `~/.boss-cli/jd/` | 岗位 JD 缓存 |

---

## 常用 `boss` CLI 命令（供 Agent 调用）

```bash
boss doctor --json                                                              # 体检 Safari 权限与登录态
boss positions --json                                                           # 查看在招岗位
boss jd "<岗位名称>" --refresh --json                                            # 拉取岗位 JD
boss inspect-unread --max 60 --pause-every 25 --json                            # 拟人化巡检未读消息
boss recommend "<岗位>" --tab recommend --limit 20 --sync-tracker --json        # 拉取推荐牛人并入库
boss recommend "<岗位>" --tab featured --limit 20 --sync-tracker --json         # 拉取精选牛人并入库
boss preview "<姓名>" --tab featured --job "<岗位>" --json                       # 读取并转存推荐/精选在线简历
boss chat "<姓名>" --strict --json && boss action resume --json                 # 读取并转存聊天页在线简历
boss tracker upsert --name "<姓名>" --job "<岗位>" --source message --stage shortlisted --score 85 --summary "..." --reason "..." --json
boss send --to "<姓名>" --strict -t "<文案>" --confirm --json                    # 经人工确认后发消息
boss greet "<姓名>" --tab featured --job "<岗位>" --confirm --json               # 经人工确认后打招呼
```

## 本地开发与发版

```bash
npm install && npm --prefix desk install
npm run desk              # 编译并启动 http://127.0.0.1:7788
npm run desk:dev          # 前端开发热更新（Vite 5173）
npm run release:pack      # 打包零隐私 macOS 发行包到 ./release/
```
