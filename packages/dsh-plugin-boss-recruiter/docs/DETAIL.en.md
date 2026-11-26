# Boss Safari Recruiting Assistant

A macOS-native DeepSeek Harness (DSH) recruiting plugin for Boss Zhipin. Install once, connect your own LLM provider in DeepSeek Harness settings (DeepSeek, OpenAI, Anthropic, Gemini, Ollama, etc.), and collaborate with your AI assistant through structured tools, approval-gated outreach, a bundled recruiting SOP skill, and the embedded `/boss-desk/` visual workbench.

## Highlights

- **Real Host macOS Safari Only**: Drives `/Applications/Safari.app` via AppleScript. Never bundles any browser runtime or anti-detection scripts. Stops immediately and hands off to the user on login, CAPTCHA, or HTTP 403 pages.
- **Bring Your Own Model**: Uses DeepSeek Harness's native multi-provider LLM layer — zero hardcoded keys or model lock-in.
- **15 Native `boss_*` Tools**: Environment doctor, job listings & JD reader, human-paced unread inbox inspector, chat reader, recommend/search sourcing, on-demand online resume preview, local candidate tracker, and safety quota inspector.
- **Approval-Gated Outbound Actions**: Outbound write tools (`boss_send_message`, `boss_greet_candidate`, `boss_chat_action`) trigger DeepSeek Harness's native pre-execute approval card before calling Boss, layered with local daily quotas and minimum 10s write spacing.
- **Bundled `boss-safari-recruiter` Skill**: Ships a model-agnostic recruiting SOP and declarative scoring rubric specification.
- **Embedded Web Workbench (`/boss-desk/`)**: Automatically mounts onto `dsh web`'s built-in HTTP server with zero extra ports, backed by your live `~/.boss-cli` tracker and DSH's configured LLM.
