# 数据层

`web/` 只负责**把本地台账与评估库聚合成页面数据**，不再包含任何界面代码。

- `build.mjs` — 读取本地 `~/.boss-cli/tracker.json`、巡检快照、推荐/精选快照与可选评估库，生成本机 `pipeline.json`
- 所有候选人数据与隐私文件（`pipeline.json`、`data.js`、`avatars/`、`assets/`、`pdfs/`）均已加入 `.gitignore`，仅留在本机，不提交至版本库。

```bash
node web/build.mjs   # 或 npm run data:build
```

全新机器初始化时本地数据为空，启动后自动从本机 `~/.boss-cli/` 实时读写。
