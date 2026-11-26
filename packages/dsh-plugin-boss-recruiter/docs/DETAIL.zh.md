# 招聘助手 · Boss 直聘 Safari 插件

面向 macOS 的 DeepSeek Harness（DSH）原生招聘插件。安装后在 DSH 中接入你自己的任意模型（DeepSeek / OpenAI / Claude / Gemini / Ollama 等），即可让 AI 助手直接协助筛选 Boss 直聘候选人，并在同端口打开「招聘助手」可视化工作台。

## 核心特性

- **只驱动本机真实 Safari.app**：通过 macOS AppleScript 调用你日常已登录的 Safari，不打包任何浏览器内核，不注入反检测脚本；遇到登录页、安全验证或 403 立即停止并提示人工在 Safari 完成。
- **任意模型即插即用**：完全复用 DeepSeek Harness 原生模型配置（`dsh-llm-deepseek` / `dsh-llm-pi-ai`），插件内不硬编码任何模型或 API Key。
- **15 个原生 `boss_*` 工具**：涵盖环境巡检、岗位 JD 读取、未读消息拟人巡检、推荐/搜索候选人、简历深看、本地台账读写与安全配额查询。
- **写操作原生审批弹窗**：所有对外动作（发消息、打招呼、要简历、标记不合适、换微信、备注）在真实执行前都会触发 DSH 原生审批卡片（`tools/pre-execute` → `ask`），同时叠加本地单日配额与最小写入间隔（默认 10 秒）双保险。
- **内嵌 `boss-safari-recruiter` 技能**：自带完整招聘筛选 SOP 与可配置评分 Rubric 规范，任何接入的模型都能按标准流程协作。
- **内嵌「招聘助手」工作台（`/boss-desk/`）**：在 `dsh web` 启动时自动挂载到同一端口，零额外进程即可查看看板、推进阶段、对比评估与调用当前 DSH 默认模型进行候选人问答。

## 使用前准备（一次性）

1. 打开 macOS **Safari** → 设置 → 高级 → 勾选「显示网页开发者功能」。
2. Safari 顶部菜单栏 → 开发 → 勾选「允许来自 Apple 事件的 JavaScript」。
3. 在 Safari 中打开并手动登录 `https://www.zhipin.com/web/chat/index`。
4. 在 DSH 设置中配置任意可用模型，打开对话直接让 AI 执行“先检查 Boss 环境，再巡检未读消息并按岗位 JD 筛选高潜人选”。
