# Rubric Configuration Schema (`rubric.json`)

`scripts/generate_dashboard.mjs` evaluates every candidate uniformly from a declarative `rubric.json`.
No hardcoded JavaScript changes are needed when switching to a different company, team tech stack, city, or job role.

## Top-Level Structure

```jsonc
{
  "schemaVersion": 1,
  "storageKey": "boss_hr_marks_ai_app_v1",
  "job": {
    "title": "ai应用开发工程师",
    "company": "公司名称",
    "location": "上海奉贤区...",
    "salary": "15-19K · 12薪",
    "requirements": "一句话核心岗位要求",
    "targetCity": "上海",
    "cityAliases": ["上海"],
    "requireOnSite": true,
    "onSiteRegex": "配合上海现场|来上海",
    "gradReferenceYear": 2026,
    "expIdealRange": [1, 4],
    "expSeniorCutoff": 8,
    "salaryTargetMax": 19,
    "salarySoftMax": 22,
    "salaryWarnMin": 20,
    "allowCollege": false
  },
  "projectsSummary": "简述团队在研项目与技术栈，渲染在报告和看板顶部说明栏",
  "signals": {
    "langgraph": "langgraph|deepagent|autogen|crewai|openclaw|pi\\s|hermes|状态机|hitl",
    "python": "python|fastapi|django|flask|pydantic|uv\\b"
  },
  "dimensions": [
    {
      "key": "agent",
      "shortLabel": "Agent",
      "label": "1. Agent / RAG / MCP 工程深度",
      "maxScore": 35,
      "description": "对标项目与考察重点...",
      "projectNames": ["ai-crm", "meigu-agent"],
      "exclusiveGroups": [
        [
          { "when": "langgraph", "points": 14, "highlight": "LangGraph/可控Agent编排" },
          { "when": "basicAgent", "points": 8, "highlight": "Agent/Workflow基础" }
        ]
      ],
      "additive": [
        { "when": "mcp", "points": 9, "highlight": "MCP/工具调用治理" }
      ],
      "caps": [
        { "when": "lowCode && !langgraph && !mcp", "maxScore": 12, "risk": "偏低代码工作流(需核实代码能力)" }
      ]
    }
  ],
  "baseDimension": {
    "key": "base",
    "shortLabel": "基础",
    "label": "5. 基础条件与现场面试可行性",
    "maxScore": 10,
    "description": "学历、经验年限、期望城市现场可达性、薪资预算匹配"
  },
  "modifiers": {
    "internSignal": "27年应届|28年应届|长期实习|每周到岗|实习生|大三|研二",
    "graduatedOverride": "已毕业|拿双证|26年|社招|全职工作",
    "internCap": 58,
    "nonDevRoleRegex": "产品经理|ui设计|交互设计|测试工程师|运营|销售",
    "devEvidenceSignals": "python || java || typescript || frontend",
    "nonDevCap": 45,
    "nonTargetCityPenalty": 12,
    "collegePenalty": 6,
    "partTimePenalty": 5,
    "resumeAttachmentBonus": 4
  },
  "tiers": {
    "S": { "min": 80, "label": "S级 · 强烈推荐约面", "stage": "shortlisted", "sub": "80-100分 · 高度对齐" },
    "A": { "min": 66, "label": "A级 · 重点看简历/沟通", "stage": "shortlisted", "sub": "66-79分 · 强工程或双栈背景" },
    "B": { "min": 48, "label": "B级 · 备选跟进池", "stage": "screened", "sub": "48-65分或待补信息" }
  },
  "techFilters": [
    { "id": "ai_tools", "label": "Codex / Claude Code / OpenClaw", "pattern": "codex|claude|openclaw|skill|workbuddy|pi " }
  ],
  "replyTemplates": {
    "shortlistOnSite": "您好{name}！看了您的背景和{topHighlight}与我们团队非常契合。我们在{location}，方便发一份详细简历过来吗？合适的话我们尽快安排技术面试！",
    "shortlistVerifyCity": "您好{name}！看了您的背景和{topHighlight}与我们团队非常契合。注意该岗位要求{targetCity}现场面试与办公（{location}），请确认是否方便现场面试，方便发一份详细简历过来吗？",
    "templateOnly": "您好，请问有做过与岗位核心技术相关的实战项目吗？另外该岗位需要{targetCity}现场面试，如方便可发一份简历过来评估。",
    "internDecline": "同学你好，目前这个岗位主要面向能全职在岗的社招/已毕业人选，后续如有实习需求再联系你，感谢关注！"
  }
}
```

## Safe Expression Language (`when`)

`when` supports boolean combinations over keys defined in `signals` (plus built-in flags `hasOverride`, `hasResumeImages`, `hasLinks`):
- Operators: `&&` (AND), `||` (OR), `!` (NOT), and parentheses `(...)`.
- Example: `"frontend && !(python && frontend)"` awards bonus points for frontend skills only when not already counted in a Python+Frontend full-stack combo.
- Every regex in `signals` or rules is compiled once at startup as case-insensitive (`'i'`). Avoid backtracking traps.

## Expert Overrides (`expert-overrides.json`)

Optional JSON keyed by candidate `name` (or `"name#order"` if duplicate names exist) added after reading screenshot resumes (`friendImageLocalPaths`) or inspecting `boss preview`:

```json
{
  "张三": {
    "extraResumeText": "从图片简历人工读取的详细项目栈与指标...",
    "projectFit": ["core-agent", "enterprise-rag"],
    "expertNote": "综合精评结论...",
    "interviewFocus": "建议面试深挖问题..."
  }
}
```
