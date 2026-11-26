# 招聘助手 · 工作台

BOSS 直聘线上招聘 + 面试候选人管理，一套本地应用。

```bash
npm run desk        # 构建 + 启动 + 打开（http://127.0.0.1:7788）
npm run desk:dev    # 前端热更新（Vite 5173，API 代理到 7788）
npm run desk:serve  # 只启动服务
npm run desk:build  # 只构建前端
```

没有账号系统：打开就是工作台，台账、看板与助手会话默认共用同一份本地数据（`~/.boss-cli` + `web/`），只监听 `127.0.0.1`。

## 模块

| 模块 | 内容 |
| --- | --- |
| **简历筛选** | 统计、阶段/岗位筛选、搜索、列表与看板、候选人详情、发消息、改阶段、撤销、面试评估互跳 |
| **面试评估** | 152 份深度评估：排行榜/备选池、五维评分、面试分与综合分、面试逐项、简历页查看 |
| **助手** | 读本地台账回答问题；会话管理、思考过程、流式输出 |

## 技术选型（以及为什么没有第二种做法）

| 能力 | 依赖 | 说明 |
| --- | --- | --- |
| 组件 | **shadcn/ui**（`radix-nova`） | 源码在 `src/components/ui/`，Nova 紧凑排版 + Radix 可访问性原语 |
| 样式 | **Tailwind CSS v4** | 设计令牌全在 `src/index.css`，不写第二套 CSS 体系 |
| 图标 | **Lucide** | 所有界面图标；`components.json` 的 `iconLibrary` 也是 lucide |
| 品牌图标 | **Simple Icons** | 只用于技术栈商标（Python / LangChain / Docker 等），与 Lucide 不重叠 |
| 动效 | **Motion** | 数字滚动、状态切换、流式文字、列表进出场 |
| 分栏 | **react-resizable-panels** | 列表 / 详情 / 助手三栏，可拖拽、可折叠 |
| 拖拽 | **dnd-kit** | 看板跨阶段拖拽 + DragOverlay + 键盘传感器 |
| 状态 | **Zustand** | `store/desk.ts`（数据与筛选）、`store/chat.ts`（会话，持久化） |
| AI 动效 | **transitions.dev** | `thinking-orbs`（思考球）、`border-beam`（流式边框）、`bot-avatars`（助手形象） |
| 表单 | shadcn `Field` + 受控输入 | 发消息表单，错误用 `FieldError` |
| 提示 | **Sonner** | 阶段变更、发送结果、撤销 |

没有自研 Dialog / Select / Tabs / Toast / Sheet / 折叠面板 / 分栏 / 拖拽排序；这些都用上表的库。自定义代码只负责业务编排与数据。

## 图标库调研

2026 年主流方案对比后只保留一个补充库：

- **Lucide** — shadcn 默认，24px 网格、2px 描边，覆盖全部界面语义（本应用用了 70+ 个）
- **Simple Icons** — 3,200+ 品牌标识，CC0，Lucide 没有商标类图标
- Tabler 覆盖更广但与 Lucide 风格重叠；Phosphor 的六种字重会引出第二套视觉语言；Font Awesome 需署名
- 结论：**Lucide 做界面，Simple Icons 只做技术栈**。没有引入 Iconify / React Icons 这类聚合层，避免依赖重复

## 数据流

```
~/.boss-cli/tracker.json ─┐
巡检快照 (inspect-*.json) ─┼─► web/build.mjs ─► web/pipeline.json ─► /api/data
评分看板 (candidates-*.json) ┘                                        │
评估库 data.js ─────────────────────────────────────────────────────► │
                                                                     ▼
                                                     desk（React，Zustand 缓存）
```

- 改阶段：`POST /api/stage` → `boss tracker upsert` → **重建 pipeline** → 返回最新数据（乐观更新失败会回滚）
- 发消息：`POST /api/send` → `boss send --to --strict --confirm`；前端二次确认、显示剩余额度
- 同步：`POST /api/refresh` → 重跑 `web/build.mjs`，页面不刷新、筛选与滚动保留
- 头像 `/media/avatars/*`、简历页 `/media/eval/*` 由服务端直接读本地文件

## 安全边界

- 服务只监听 `127.0.0.1`；POST 校验 `Origin` 必须是本机
- 写操作一律 `execFile` 参数数组，不拼 shell；消息长度上限 800 字；发消息需经前端确认弹窗并受每日配额与最小间隔限制
- 原始简历 PDF / 截图（`web/assets`）与聊天附件不提交到版本库

## AI 助手

默认使用**本地数据助手**：读台账与评估库，按问题类型（跟进 / 约面 / 岗位 / 统计）给出具体人名与下一步，不需要密钥。

配置真实模型后自动切换为流式：

```bash
export DEEPSEEK_API_KEY=sk-...     # 或 OPENAI_API_KEY
export DESK_MODEL=deepseek-chat    # 可选
npm run desk
```

模型只拿到聚合后的统计与候选人摘要，不接触完整简历文件；助手没有写权限。

## 交互约定

- 模块切换不改变布局：统计 → 作用域条（chip + 右侧动作）→ 列表，两模块同一套位置
- 阶段/岗位/搜索是共享状态，切换模块保留岗位过滤
- 详情默认选中分数最高的人；窄屏（<1024px）改成抽屉
- 看板拖拽后 6 秒内可撤销；淘汰需要二次确认
- 发消息前必须过一次确认弹窗，写明「发送会切到 Safari、发出后无法撤回」

## 目录

```
desk/
├── server/index.mjs      # 本地服务：认证、数据、动作、AI SSE
├── src/
│   ├── pages/            # 登录页、工作台
│   ├── components/
│   │   ├── source/       # 简历筛选：统计、列表、看板、详情、技术栈
│   │   ├── assess/       # 面试评估：排行榜、评估详情
│   │   ├── assistant/    # AI 助手
│   │   ├── motion/       # transitions.dev 风格动效封装
│   │   └── ui/           # shadcn 组件源码
│   ├── store/            # Zustand
│   └── lib/              # API 客户端与格式化
└── dist/                 # 构建产物（gitignore）
```
