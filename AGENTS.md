# Agent 招聘助手协作规范（Safari 定制版）

本项目是面向 macOS **真实 Safari.app** 的 `boss-cli` 改造版，核心目标是由 AI Agent 通过本地 `boss` 命令协助用户完成 **简历筛选、面试候选人评估与受控沟通执行**。

## 浏览器与安全原则

1. **只用真实 Safari.app**：通过 Apple 官方「允许来自 Apple 事件的 JavaScript」驱动日常 Safari，不启动 Chrome，不注入任何反检测伪装或风控拦截代码。
2. **遇登录/验证立即交还人工**：若检测到登录页、安全验证页或 403，立刻停止并通知用户在 Safari 窗口手动完成，严禁轮询或尝试绕过。
3. **筛选优先 + 写操作受控**：
   - 所有对外写操作（`greet`、`send`、`action not-fit|wechat|request-attachment-resume|agree-resume|remark`）默认处于 **dry-run 预演模式**，不带 `--confirm` 不会真正执行。
   - Agent 在筛选阶段只能运行只读命令，**必须先将候选人评分表与拟执行动作汇报给用户确认**，得到明确指令后才追加 `--confirm` 执行。
   - 严格遵守每日配额（`boss quota`）与最小写操作间隔（默认 10 秒）。

## Agent 筛选简历与面试人标准 SOP

当用户下达筛选指令（例如：“帮我筛前端岗位的推荐人选，挑 5 个适合面试的”或“看看未读消息里有哪些值得聊的”）：

### 1. 环境与岗位对齐
- 先运行 `boss doctor --json` 确认 Safari 权限与登录态正常。
- 运行 `boss positions --json` / `boss jd <岗位名称> --json` 拿到目标岗位的完整 JD 要求。

### 2. 寻源 / 收件箱读取（全链路用 `--json`）
- **推荐寻源**：`boss recommend <岗位> --limit 30 --skip-viewed --skip-colleague --exclude-tracked --json`
- **关键词搜人**：`boss search <关键词> --limit 30 --exclude-tracked --json`
- **深度搜索**：先 `boss deep-search <岗位> --core ... --bonus ... --json` 看表单与剩余次数；用户确认后再加 `--match`。
- **未读巡检**：`boss list --unread --limit 30 --json`，再按 `boss chat --index <N> --unread --json` 与 `boss action history --json` 逐个核查，避免和同事撞单。

### 3. 低成本初筛 → 按需深看在线简历
- 先依据卡片摘要（年限、公司、学历、薪资期望、优势标签）淘汰明显不符的人，**不浪费每日在线简历查看额度**。
- 只对初筛高潜候选人调用 `boss preview --geek-id <ID> --json`（或 `--index <N>`），聊天页用 `boss action resume --json`。
- CLI 默认优先直读同源 DOM 简历文本（零 OCR 成本）；若返回了 `screenshotPath`（如 Canvas 渲染），直接用多模态读图能力查看截图并综合打分。

### 4. 沉淀本地台账 + 输出面试短名单
- 将每位评估过的候选人写入台账（便于后续自动去重）：
  `boss tracker upsert --name <姓名> --geek-id <ID> --job <岗位> --stage <shortlisted|screened|rejected|hold> --score <0-100> --summary "..." --reason "..."`
- 向用户输出清晰表格：排名、姓名、匹配分（0–100）、核心亮点、潜在风险、建议动作（打招呼话术 / 回复草稿 / 约面建议）。
- 如用户需要交付文档，运行 `boss tracker export --job <岗位> --stage shortlisted --out ./shortlist.md`。
- 只有用户回复确认具体人选后，才加 `--confirm` 执行 `boss greet` / `boss send` / `boss action`。

### 5. 标准要简历与初面确认文案（默认首选）

在收到用户指示或确认向候选人发起首轮沟通/要简历时，默认使用以下标准文案（如有岗位或办公地点变化，按实际 JD 调整第一句地点即可）：

```text
你好，感谢投递，公司地点在奉贤区南上海科创中心,请问是否方便通勤？
我们的面试流程是一轮线上初面 + 现场进行技术面试（需要携带电脑）,请问是否方便呢？
可以的话麻烦发送一份附件简历过来，谢谢！
```
