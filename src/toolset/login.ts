/**
 * Safari 登录入口与环境自检（`boss login` / `boss doctor`）。
 */
import { checkSafariHealth, openOrReuseBossTab } from '../browser/index.js';
import { BOSS_LOGIN_URL, describeManualInterventionUrl } from '../common/auth.js';
import { getQuotaSummary } from '../common/safety.js';
import { getTrackerStats } from '../common/tracker.js';

/**
 * 在真实 Safari.app 中打开 Boss 直聘登录页并前置窗口，交还人工完成扫码登录。
 * 不轮询、不等待登录结果。
 */
export async function runLogin(): Promise<string> {
  await openOrReuseBossTab({
    targetUrl: BOSS_LOGIN_URL,
    activate: true,
    forceNavigate: true,
  });

  return [
    `已在 Safari 中打开 Boss 直聘登录页：${BOSS_LOGIN_URL}`,
    '请在 Safari 窗口中自行扫码或验证码登录（登录态将直接保存在你的日常 Safari 中）。',
    '首次使用请确认已在 Safari 开启：设置 → 高级 → 显示网页开发者功能 → 开发者 → 允许来自 Apple 事件的 JavaScript。',
    '登录完成后运行 boss doctor 校验状态。',
  ].join('\n');
}

export async function runDoctor(opts: { json?: boolean } = {}): Promise<string> {
  const safari = await checkSafariHealth();
  const quota = getQuotaSummary();
  const tracker = getTrackerStats();
  const intervention = safari.bossTab ? describeManualInterventionUrl(safari.bossTab.url) : null;

  const payload = {
    browser: 'Safari (AppleScript)',
    ...safari,
    manualInterventionRequired: Boolean(intervention),
    manualInterventionMessage: intervention,
    quota,
    tracker,
  };

  if (opts.json) {
    return JSON.stringify(payload, null, 2);
  }

  const jsStatusLabel = safari.jsAppleEventsEnabled
    ? '已开启 ✅'
    : safari.tabCount === 0
      ? '待检测（Safari 尚未打开标签页）'
      : '未开启 ❌';

  const lines: string[] = [
    '=== Boss CLI (Safari 版) 环境自检 ===',
    `系统平台：${safari.platform}`,
    `Safari 运行中：${safari.safariRunning ? '是' : '否'}（当前共 ${safari.tabCount} 个标签页）`,
    `Apple 事件 JavaScript 权限：${jsStatusLabel}`,
  ];

  if (safari.jsError) {
    lines.push(`权限提示：\n${safari.jsError}`);
  }

  if (safari.bossTab) {
    lines.push(`Boss 标签页：已找到（window=${safari.bossTab.winId}, tab=${safari.bossTab.tabIdx}）`);
    lines.push(`当前 URL：${safari.bossTab.url}`);
    lines.push(`登录主界面（.menu-list）：${safari.loggedInShell ? '已登录 ✅' : '未进入主界面 ⚠️'}`);
  } else {
    lines.push('Boss 标签页：未打开（请先运行 boss login 或在 Safari 打开 zhipin.com）');
  }

  if (intervention) {
    lines.push(`⚠️ 需要人工处理：${intervention}`);
  }

  lines.push(
    '',
    `写操作默认模式：${quota.writeDefaultMode}（最小间隔 ${quota.minWriteIntervalSec}s）`,
    `今日配额：打招呼 ${quota.quotas.greet.used}/${quota.quotas.greet.limit}｜发消息 ${quota.quotas.send.used}/${quota.quotas.send.limit}｜简历预览 ${quota.quotas.preview.used}/${quota.quotas.preview.limit}`,
    `本地台账：共 ${tracker.total} 人（shortlisted=${tracker.byStage.shortlisted}，interview=${tracker.byStage.interview}，greeted=${tracker.byStage.greeted}，rejected=${tracker.byStage.rejected}）`,
  );

  return lines.join('\n');
}
