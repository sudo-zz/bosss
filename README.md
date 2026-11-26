# boss-cli（macOS Safari 招聘筛选定制版）

基于 `joohw/boss-cli` 深度改造，专为 **macOS 真实 Safari + AI Agent 招聘筛选协作** 优化：

- **纯 Safari 驱动**：使用 macOS AppleScript 驱动本机日常 `Safari.app`，复用真实登录态，**彻底移除 Chrome / Puppeteer / CDP 依赖与前端反检测拦截层**。
- **筛选优先 + 写操作受控**：所有对外写操作（打招呼、发消息、标记不合适、换微信、求简历、备注）默认进入 **dry-run 预演模式**，确认后追加 `--confirm` 才实际执行；内置每日配额上限与最小写操作间隔。
- **零 OCR 成本读简历**：优先直接提取同源在线简历 DOM 文本；若简历为 Canvas/图片渲染或显式指定 `--screenshot`，截取 Safari 窗口供多模态 AI Agent 直接看图评估。
- **结构化 `--json` + 唯一 ID + 可控翻页**：`list` / `recommend` / `search` / `deep-search` / `chat` / `positions` / `jd` 全部支持 `--json`、`--limit <N>` 与 `--exclude-tracked`，并透出 `geekId` 和 1-based 序号，支持 `--index` / `--geek-id` 精准定位。
- **内置候选人筛选台账 (`boss tracker`)**：持久化记录已筛候选人、岗位匹配评分、理由和面试阶段，自动去重并一键导出 Markdown 面试候选人短名单。

---

## 招聘助手（统一工作台）

```bash
npm run desk        # 构建并在 http://127.0.0.1:7788 打开
```

打开即用，无需注册或登录；台账、看板、助手会话都存在本机 `~/.boss-cli` 与 `web/`，默认所有人共用同一份数据。

| 模块 | 管什么 |
| --- | --- |
| **简历筛选** | BOSS 直聘线上全流程：线索 → 初筛 → 短名单 → 打招呼 → 跟进 → 约面；列表/看板两种视图，可拖拽改阶段 |
| **面试评估** | 面试与候选人管理：简历分、面试分、综合分、面试记录与风险清单 |

技术栈全部为成熟库，组件源码落在本仓（可直接改）：

- **shadcn/ui**（Nova 预设 + Radix 原语）+ Tailwind CSS v4
- **Lucide** 统一界面图标，**Simple Icons** 只补技术栈品牌标识
- **Motion** 动效、**react-resizable-panels** 三栏、**dnd-kit** 看板拖拽、**Zustand** 状态
- **transitions.dev** 的 `thinking-orbs`、`border-beam`、`bot-avatars` 负责 AI 助手的思考态、流式边框与助手形象

实现细节、依赖边界与图标选型见 [`desk/README.md`](desk/README.md)。

---

## DeepSeek Harness 插件（`dsh-plugin-boss-recruiter`）

本项目提供原生 DeepSeek Harness（`dsh >= 0.2.0`）插件包 [`packages/dsh-plugin-boss-recruiter`](packages/dsh-plugin-boss-recruiter/README.md)，安装后在 DSH 设置中接入任意自有模型（DeepSeek / OpenAI / Anthropic / Gemini / Ollama 等）即可直接使用：

- **15 个原生 `boss_*` 工具**：Safari 体检、岗位/JD 读取、拟人未读巡检、推荐/搜索候选人、在线简历按需提取、本地台账读写与安全配额。
- **DSH 原生写操作审批卡片**：`boss_send_message`、`boss_greet_candidate`、`boss_chat_action` 默认触发 DSH 审批确认（非 `dryRun` 时 fail-closed），叠加本地单日配额与 10 秒最小写间隔。
- **内嵌 `boss-safari-recruiter` 技能**：自动注册到 DSH `skills` 服务，模型无关的完整招聘筛选 SOP。
- **同端口内嵌「招聘助手」工作台（`/boss-desk/`）**：随 `dsh web` 自动挂载，右侧助手优先直连 DSH 当前配置的默认模型。
- **零浏览器打包 & 零候选人隐私数据**：只调用宿主 macOS `Safari.app`，候选人数据仅存于本机 `~/.boss-cli/`。

```bash
# 全局安装一次后（npm link），在任意目录直接输入独立命令启动，完全不覆盖原生 dsh：
boss-dsh         # 或在仓库内运行 npm run dsh:web
```

（支持传参：`boss-dsh --port 3788 --no-open`、`boss-dsh --rebuild`；默认使用独立 profile `boss-web`，不修改原版 `dsh` 命令及默认 `web` profile。）

完整安装与配置说明见 [`packages/dsh-plugin-boss-recruiter/README.md`](packages/dsh-plugin-boss-recruiter/README.md)。

---

## 本地数据与隐私边界

本仓库**不包含任何候选人隐私数据**，新电脑安装初始化默认为空库；所有招聘过程中产生的数据仅保存在使用者自己的本机目录（均已加入 `.gitignore`）：

| 本地路径 | 内容 |
| --- | --- |
| `~/.boss-cli/tracker.json` | 候选人筛选台账（阶段、分数、来源、事件） |
| `~/.boss-cli/resumes/pdf/` | 候选人附件 PDF 简历（内嵌 PDF 查看器本地源） |
| `~/.boss-cli/resumes/online/` | Boss 在线简历本地存档（离线零额度查看） |
| `~/.boss-cli/sourcing/` | 推荐牛人 / 精选牛人拉取快照 |
| `~/.boss-cli/avatars/` | 候选人头像缓存 |
| `~/.boss-cli/jd/` | 已抓取的岗位 JD 缓存 |

新电脑直接前往 [GitHub Releases](https://github.com/sudo-zz/bosss/releases) 下载 `boss-recruiter-v*-darwin.tar.gz`，解压运行 `./install.sh` 即可零编译一键安装，并在右上角通过「检查更新」直接连 GitHub 获取后续更新。

---

## 快速安装（新电脑 / 团队复刻）

```bash
git clone git@github.com:sudo-zz/bosss.git
cd bosss
npm install
npm run skill:sync    # 构建并全局 link `boss` 命令 + 同步 boss-safari-recruiter 到各 AI Harness
```

如需打包成无候选人隐私数据的跨电脑压缩包：

```bash
npm run skill:export  # 输出 dist-bundle/boss-safari-recruiter-kit.tar.gz
```

## 首次使用（一次性配置）

1. 在 Safari 开启 Apple 事件 JavaScript 权限：
   - 打开 **Safari 浏览器 → 设置（⌘,）→ 高级** → 勾选「**显示网页开发者功能**」
   - 切换到 **开发者**（或顶部菜单栏 **开发**）→ 勾选「**允许来自 Apple 事件的 JavaScript**」
2. 如需对图片/Canvas 简历截屏，请在 **系统设置 → 隐私与安全性 → 录屏与系统录音** 授权当前终端/IDE。
3. 在 Safari 登录 Boss 直聘招聘端并运行自检：

```bash
boss login    # 在 Safari 打开登录页，人工扫码登录
boss doctor   # 自检 Safari 权限、登录态、今日配额与台账
```

---

## 常用命令

### 1. 岗位与寻源（只读）
```bash
boss positions --json
boss jd "前端工程师" --json                   # 抓取并缓存 JD（加 --refresh 强制刷新）
boss recommend "前端" --limit 30 --skip-viewed --skip-colleague --exclude-tracked --json
boss search "LangGraph" --limit 25 --json
boss deep-search "前端" --core "3年以上React" --bonus "AI应用经验" --json
boss deep-search --match --json               # 显式加 --match 才会消耗今日匹配次数
```

### 2. 在线简历与收件箱（只读）
```bash
boss preview --geek-id <ID> --json            # 按 geekId 精准查看在线简历（或 --index <N>）
boss preview "张三" --screenshot --json       # 强制附加 Safari 窗口截图
boss list --unread --limit 30 --json
boss chat --index 1 --unread --json
boss action history --json                    # 查看同事沟通/我的沟通，防撞单
boss action resume --json                     # 读取当前会话在线简历正文
```

### 3. 本地筛选台账（`~/.boss-cli/tracker.json`）
```bash
boss tracker upsert --name "张三" --geek-id "xxx" --job "前端" --stage shortlisted --score 88 --reason "React+AI项目扎实"
boss tracker list --job "前端" --stage shortlisted --min-score 80
boss tracker stats
boss tracker export --job "前端" --stage shortlisted --out ./shortlist.md
```

### 4. 受控写操作（默认预演，加 `--confirm` 才实际执行）
```bash
boss greet --index 1                          # 预演（不发送）
boss greet --index 1 --confirm                # 实际打招呼（支持推荐/深度搜索/常规搜索页）
boss send --to "张三" --strict -t "您好，方便发一份简历吗？" --confirm
boss action remark --remark "88分，建议约一面" --confirm
boss action wechat --confirm
boss action not-fit --confirm
```

---

## 安全配额环境变量（可在 `~/.boss-cli/.env` 配置）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BOSS_ALLOW_WRITE` | `0` | 设为 `1` 可关闭默认 dry-run（不建议，建议逐条 `--confirm`） |
| `BOSS_MIN_WRITE_INTERVAL_SEC` | `10` | 两次写操作之间最小间隔（秒） |
| `BOSS_MAX_DAILY_GREET` | `20` | 每日最大打招呼次数 |
| `BOSS_MAX_DAILY_SEND` | `40` | 每日最大发消息次数 |
| `BOSS_MAX_DAILY_PREVIEW` | `30` | 每日最大在线简历查看次数 |
| `BOSS_RESUME_OCR` | `0` | 默认关闭百度 OCR；仅在设为 `1` 时调用百度 OCR |
