# dsh-plugin-boss-recruiter

**招聘助手 · Boss 直聘 Safari 插件（DeepSeek Harness 原生 Bundle）**

面向 macOS 的 [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) 原生插件包：安装后在 DSH 中接入你自己的任意大模型（DeepSeek / OpenAI / Anthropic / Gemini / Ollama 等），即可获得：

- **15 个原生 `boss_*` 工具**：Safari 环境体检、读取岗位与 JD、拟人化未读巡检、推荐/搜索寻源、按需查看在线简历、本地候选人台账读写、安全配额查询与受控外发沟通。
- **DSH 原生写操作审批弹窗**：所有对外写动作（`boss_send_message`、`boss_greet_candidate`、`boss_chat_action`）在非 `dryRun` 时通过 `tools/pre-execute` → `{ kind: 'ask' }` 弹出 DSH 审批卡片，同时叠加本地单日配额与最小写入间隔（默认 10 秒）双保险。
- **内置 `boss-safari-recruiter` 技能**：自带模型无关的招聘筛选 SOP 与声明式评分 Rubric 规范。
- **同端口内嵌「招聘助手」工作台（`/boss-desk/`）**：随 `dsh web` 自动挂载，无需额外端口，右侧 AI 助手直连 DSH 已配置模型（支持模型切换与图片粘贴分析）；内置 **PDF 简历查看器**、**Boss 在线简历本地存档**，以及 **消息列表 / 推荐牛人 / 精选牛人**（不含最新）多来源筛选与双标签（岗位标签 + 来源标签）。
- **零浏览器打包、零候选人隐私数据、新机器初始为空库**：只驱动宿主 macOS `/Applications/Safari.app`，所有候选人台账、PDF 与在线简历存档只保存在本地 `~/.boss-cli/`。

---

## 环境要求

- **macOS**（`darwin`）+ 本机 **Safari.app**
- **DeepSeek Harness (`dsh`)** `>= 0.2.0`
- **Boss Safari CLI**（本仓库根目录执行过 `npm run build`，或全局安装了 `@joohw/boss-cli`）

### 一次性开启 Safari AppleScript 权限

1. 打开 Safari → **设置** → **高级** → 勾选「显示网页开发者功能」。
2. 顶部菜单栏 **开发** → 勾选「允许来自 Apple 事件的 JavaScript」。
3. 在 Safari 打开并手动登录 `https://www.zhipin.com/web/chat/index`。

---

## 安装到 DeepSeek Harness

### 方式 A：一条命令启动（最简单，无需全局 `pnpm`）

```bash
git clone git@github.com:sudo-zz/bosss.git
cd bosss
npm install && npm --prefix desk install
npm link          # 注册独立全局命令 boss-dsh（不覆盖原生 dsh）
boss-dsh          # 任意目录一键启动 DSH + 招聘助手（自动构建与挂载，同端口自带 /boss-desk/）
```

### 方式 B：通过 `dsh plugin` 安装（需本机有 `pnpm`）

```bash
# 克隆并构建仓库（生成 boss CLI 与 招聘助手前端 dist）
git clone git@github.com:sudo-zz/bosss.git
cd bosss
npm install && npm run build && npm --prefix desk install && npm run desk:build

# 安装插件到 DSH web profile（也可换为 tui）
dsh plugin --profile web add "link:$(pwd)/packages/dsh-plugin-boss-recruiter"

# 验证配置与 Schema
dsh --profile web --dump-config-schema | grep -A 5 boss-recruiter

# 启动 DeepSeek Harness Web（同一端口自带 /boss-desk/）
dsh web
```

### 方式 B：直接从 Git 安装

```bash
dsh plugin --profile web add "github:sudo-zz/bosss#path:packages/dsh-plugin-boss-recruiter"
```

---

## 配置项（Schemastery，可在 DSH 设置页可视化编辑）

在 `boss-recruiter-service` 下可按自己公司情况自定义：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `cliPath` | `""` | 自定义 `boss` CLI 入口路径；留空自动探测仓库 `dist/cli/index.js` 或 `PATH` |
| `deskDistDir` | `""` | 自定义招聘助手构建目录；留空自动探测 `desk/dist` |
| `defaultReplyTemplate` | 标准三行要简历模板 | 默认首轮要简历与面试流程确认话术，可按公司地址修改 |
| `maxDailySend` | `40` | 单日最多发送聊天消息条数 |
| `maxDailyGreet` | `20` | 单日最多打招呼人数 |
| `maxDailyPreview` | `30` | 单日最多查看在线简历次数 |
| `minWriteIntervalSec` | `10` | 两次对外写操作之间的最小间隔（秒） |
| `enableWebDesk` | `true` | 是否在 `dsh web` 同端口挂载 `/boss-desk/` 招聘助手工作台 |
| `webDeskPath` | `"/boss-desk"` | 招聘助手工作台挂载路径前缀 |

---

## 启动后怎么用

1. 在 DSH 设置里连接你自己的任意模型（DeepSeek / OpenAI / Claude / Gemini / Ollama 等）。
2. 在 DSH 对话框直接说：
   - “先调用 `boss_doctor` 检查 Safari 环境，再巡检未读消息，结合在招岗位 JD 给候选人打分并写入台账。”
   - “挑短名单前 3 位高分候选人，先用 `dryRun: true` 预演要简历消息。”
   - “确认给张三和李四发送要简历消息。”（DSH 会弹出原生审批卡片，点击「允许一次」才真正发送）
3. 浏览器打开 `http://127.0.0.1:<dsh端口>/boss-desk/`，即可使用「招聘助手」三栏「简历筛选 / 面试评估」工作台与 AI 助手。
