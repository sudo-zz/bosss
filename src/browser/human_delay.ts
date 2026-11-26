/** 操作节奏与等待时长常量（Safari 驱动版） */

/** 导航到沟通页并 load 后，等待 SPA/接口渲染 */
export const CHAT_GOTO_SETTLE_MS = { min: 1800, max: 3200 } as const;

/** 页面执行上下文刷新后重试前 */
export const CONTEXT_DESTROY_RETRY_MS = { min: 800, max: 1500 } as const;

/** 侧栏导航点击后，等待路由与 SPA 状态开始变化 */
export const SIDEBAR_NAV_AFTER_CLICK_MS = { min: 450, max: 950 } as const;

/** 列表滚动查找候选人时，每轮之间的间隔 */
export const OPEN_CHAT_SCROLL_GAP_MS = { min: 260, max: 620 } as const;

/** 列表翻页滚动收集时的温和间隔 */
export const LIST_SCROLL_COLLECT_GAP_MS = { min: 450, max: 850 } as const;

/** 点击会话行后，等待右侧面板出现的短停顿 */
export const OPEN_CHAT_AFTER_ROW_CLICK_MS = { min: 420, max: 1000 } as const;

/** 筛选「全部 / 未读」等操作之间的停顿 */
export const LIST_FILTER_GAP_MS = { min: 650, max: 1200 } as const;

/** 岗位下拉打开、搜索输入、选择岗位等连续动作之间的停顿 */
export const JOB_SELECT_ACTION_GAP_MS = { min: 280, max: 680 } as const;

/** 岗位搜索输入后，等待前端过滤/接口刷新开始响应 */
export const JOB_SEARCH_ACTION_GAP_MS = { min: 420, max: 900 } as const;

/** 点击候选人卡片打开简历预览后，等待弹层/iframe 开始挂载 */
export const RESUME_PREVIEW_OPEN_GAP_MS = { min: 450, max: 1000 } as const;

/** 列表稳定轮询间隔（随机） */
export const LIST_POLL_MS = { min: 380, max: 700 } as const;

/** 列表为空时至少等待多久才认为稳定 */
export const LIST_MIN_BEFORE_EMPTY_OK_MS = 4000;

/** 登录态探测轮询间隔 */
export const PROBE_LOGIN_POLL_MS = { min: 480, max: 880 } as const;

/** 发送消息后短停顿 */
export const SEND_AFTER_ENTER_MS = { min: 300, max: 800 } as const;

/** 点击「沟通记录」后等待弹窗与列表渲染 */
export const CHAT_HISTORY_DIALOG_WAIT_MS = { min: 450, max: 1100 } as const;

/** 「同事沟通」/「我的沟通」切换后等待列表刷新 */
export const CHAT_HISTORY_TAB_SWITCH_MS = { min: 350, max: 800 } as const;

/** 点击后等待 c-resume iframe 出现或出现付费弹层的上限（毫秒） */
export const ONLINE_RESUME_IFRAME_WAIT_MAX_MS = 14_000;

/** 打招呼点击后主文档付费弹层轮询上限（毫秒） */
export const GREET_PAYWALL_WAIT_MAX_MS = 3200;
