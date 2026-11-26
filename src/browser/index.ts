/**
 * 浏览器驱动统一出口（macOS Safari AppleScript 驱动）。
 */
export * from './timing.js';
export * from './human_delay.js';
export {
  checkSafariHealth,
  listSafariTabs,
  openOrReuseBossTab,
  runAppleScript,
  SafariPage,
  SafariSetupError,
  type FrameEvalMatch,
  type FrameMeta,
  type FrameTarget,
  type SafariTabRef,
} from './safari_driver.js';
