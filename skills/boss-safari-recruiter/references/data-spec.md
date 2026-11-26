# 招聘助手本地数据规范（`~/.boss-cli/`）

本规范供 WorkBuddy、千问办公、豆包工作、Claude Code、Codex 等桌面 Agent 使用。  
当 Agent 按此规范写入或更新 `~/.boss-cli/` 下的任意文件时，运行中的 `boss-desk`（默认 `http://127.0.0.1:7788`）会通过 `fs.watch` + SSE 在 **1 秒内自动刷新右侧浏览器画面**。

---

## 目录结构总览

```text
~/.boss-cli/
├── tracker.json                 # 核心候选人台账（推荐使用 `boss tracker upsert` 写入）
├── unread-inspect.json          # `boss inspect-unread` 产出的未读对话与基础画像快照
├── sourcing/
│   └── <tab>-<job>.json         # `boss recommend --tab recommend|featured` 产出的推荐/精选快照
├── resumes/
│   ├── pdf/
│   │   └── <候选人姓名>.pdf      # 候选人附件 PDF 简历（内嵌 PDF 查看器直接渲染，支持 #page=N 跳页）
│   └── online/
│       ├── <候选人姓名>.json     # Boss 在线简历结构化本地存档（离线零额度查看）
│       └── <候选人姓名>.md       # 同步生成的可读 Markdown 版本
├── avatars/                     # 候选人头像图片（png/jpg/webp）
├── jd/                          # `boss jd` 缓存的岗位 JD Markdown
├── eval/
│   ├── data.json                # 「面试评估」模块深度评估数据（可选）
│   ├── pdfs/                    # 评估库关联 PDF（可选）
│   └── assets/                  # 评估简历逐页截图（可选）
├── quota.json                   # 今日 Boss 操作配额统计
└── update-config.json           # 检查更新源配置（可选）
```

---

## 1. 候选人台账写入规范（推荐用 CLI）

**优先使用 `boss tracker upsert`**（自动维护 `id`、去重、`updatedAt` 与 `history`）：

```bash
boss tracker upsert \
  --name "张三" \
  --job "AI 应用开发工程师" \
  --source message \
  --stage shortlisted \
  --score 86 \
  --summary "25岁｜3年｜本科｜上海｜15-18K｜某科技·Python" \
  --reason "【强烈建议约面】Java+Python 双栈，具备 LangGraph 与 MCP 工程落地经验。" \
  --resume-pdf "$HOME/.boss-cli/resumes/pdf/张三.pdf" \
  --json
```

### 字段约定
- **`--job`（岗位标签）**：清晰岗位名，如 `AI 应用开发工程师`、`新媒体运营专员`。
- **`--source`（来源标签，仅支持以下 3 种，不含「最新」）**：
  - `message` → 页面展示 **「消息列表」**
  - `recommend` → 页面展示 **「推荐牛人」**
  - `featured` → 页面展示 **「精选牛人」**
- **`--stage`（阶段）**：`new` | `screened` | `shortlisted` | `greeted` | `replied` | `interview` | `hold` | `rejected`
- **`--summary`（基础画像，竖线 `｜` 分隔）**：`年龄｜年限｜学历｜城市｜薪资｜最近公司·职位`，前端卡片上半区会自动解析并展示。
- **`--reason`（AI 综合研判）**：建议使用 `【结论标签】精简研判理由` 格式，前端卡片下半区会自动高亮标签并精简呈现。

---

## 2. 归档已有本地 PDF 简历

把人事电脑上已收集的 PDF 简历统一归档到 `~/.boss-cli/resumes/pdf/`：
1. 复制或重命名为 `~/.boss-cli/resumes/pdf/<候选人姓名>.pdf`（或 `<候选人姓名>-<时间戳>.pdf`）。
2. 调用 `boss tracker upsert --name "<姓名>" --job "<岗位>" --source message --stage screened --score <0-100> --summary "..." --reason "..." --resume-pdf "$HOME/.boss-cli/resumes/pdf/<文件名>.pdf" --json`。
3. 即使尚未写入 `tracker.json`，直接放入 `~/.boss-cli/resumes/pdf/` 的 PDF 也会被 `boss-desk` 自动识别并显示在看板中，点开即可使用内嵌 PDF 查看器与页码跳转。

---

## 3. 转存 Boss 在线简历到本地

- **消息列表里的候选人**：
  ```bash
  boss chat "<姓名>" --strict --json
  boss action resume --json           # 自动保存到 ~/.boss-cli/resumes/online/<姓名>.json 和 .md
  ```
- **推荐牛人 / 精选牛人里的候选人**：
  ```bash
  boss preview "<姓名>" --tab recommend --job "<岗位>" --json
  # 或精选：
  boss preview "<姓名>" --tab featured --job "<岗位>" --json
  ```
转存后，`boss-desk` 自动显示「在线简历」标识，后续离线点开与交给 Agent 复读均 **0 额度消耗**。

---

## 4. 拉取推荐牛人 / 精选牛人（不含「最新」）

```bash
# 推荐牛人
boss recommend "<岗位>" --tab recommend --limit 20 --skip-viewed --skip-colleague --sync-tracker --json

# 精选牛人
boss recommend "<岗位>" --tab featured --limit 20 --skip-viewed --skip-colleague --sync-tracker --json
```
加 `--sync-tracker` 会自动将候选人按对应的 `job`（岗位标签）与 `source`（`recommend` / `featured` 来源标签）写入台账与快照。

---

## 5. 面试评估库格式（`~/.boss-cli/eval/data.json`，可选）

如需在工作台「面试评估」页签展示深度评估报告，写入 `~/.boss-cli/eval/data.json`：

```json
{
  "meta": { "position": "AI 应用开发工程师", "updatedAt": "2026-11-26" },
  "positions": [
    {
      "id": "ai-dev",
      "name": "AI 应用开发工程师",
      "short": "AI 应用开发",
      "dims": [
        { "k": "Agent/RAG", "max": 35 },
        { "k": "全栈工程", "max": 25 },
        { "k": "AI工具", "max": 15 },
        { "k": "B端业务", "max": 15 },
        { "k": "基础条件", "max": 10 }
      ]
    }
  ],
  "candidates": [
    {
      "id": "eval-zhangsan",
      "name": "张三",
      "positionId": "ai-dev",
      "age": 25,
      "education": "本科",
      "school": "示例大学",
      "major": "计算机科学",
      "years": "3年",
      "current": "某科技 · AI 应用开发",
      "location": "上海",
      "score": 86,
      "status": "recommend",
      "tagline": "工程落地扎实，架构匹配度高",
      "dimensions": { "Agent/RAG": 30, "全栈工程": 21, "AI工具": 13, "B端业务": 13, "基础条件": 9 },
      "pros": ["有 LangGraph 生产经验", "Java+Python 双栈"],
      "cons": ["需确认到岗时间"],
      "questions": ["请详述 Agent 工具调用权限边界设计"],
      "pdf": "张三.pdf"
    }
  ]
}
```
（其中 `pdf` 会自动从 `~/.boss-cli/resumes/pdf/` 或 `~/.boss-cli/eval/pdfs/` 加载并在内嵌 PDF 查看器中打开。）
