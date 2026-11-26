/**
 * macOS Safari 浏览器驱动层（基于 AppleScript `do JavaScript`）。
 *
 * 设计要点：
 * - 直接复用用户日常登录的真实 Safari.app 窗口与登录态，不启动 Chrome，不暴露 webdriver 标志。
 * - 使用 Apple 官方「允许来自 Apple 事件的 JavaScript」接口，不注入反检测/风控绕过脚本。
 * - 所有 iframe 访问通过同源 contentDocument 并在函数参数中词法遮蔽 `(document, window)`，完全 CSP 安全（不使用 eval / new Function）。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sleepRandom } from './timing.js';

const execFileAsync = promisify(execFile);

const OSASCRIPT_TIMEOUT_MS = 25_000;
const FIELD_SEP = '\u001f';
const RECORD_SEP = '\u001e';

export type SafariTabRef = {
  winId: number;
  tabIdx: number;
  url: string;
  title: string;
};

export type FrameTarget =
  | 'main'
  | { selector: string }
  | { index: number }
  | { nested: [string, string] };

export type FrameMeta = {
  target: FrameTarget;
  name: string;
  src: string;
  url: string;
  visible: boolean;
  width: number;
  height: number;
};

export type FrameEvalMatch<T> = {
  target: FrameTarget;
  frameUrl: string;
  value: T;
};

export class SafariSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafariSetupError';
  }
}

function assertMacOS(): void {
  if (process.platform !== 'darwin') {
    throw new SafariSetupError(
      `当前系统为 ${process.platform}，Safari 驱动仅支持 macOS。`,
    );
  }
}

function mapAppleScriptError(err: unknown): Error {
  const raw =
    err instanceof Error
      ? `${err.message}${'stderr' in err && typeof (err as { stderr?: unknown }).stderr === 'string' ? `\n${(err as { stderr: string }).stderr}` : ''}`
      : String(err);

  if (
    /Allow JavaScript from Apple Events|JavaScript through AppleScript is turned off|允许来自\s*Apple\s*事件的\s*JavaScript/i.test(
      raw,
    )
  ) {
    return new SafariSetupError(
      [
        'Safari 尚未开启「允许来自 Apple 事件的 JavaScript」。请按以下步骤开启（一次性设置）：',
        '  1. 打开 Safari → 左上角菜单「Safari 浏览器」→「设置」（⌘,）',
        '  2. 切换到「高级」标签，勾选「显示网页开发者功能」',
        '  3. 切换到「开发者」标签（或顶部菜单栏「开发」），勾选「允许来自 Apple 事件的 JavaScript」',
        '  4. 开启后重新运行命令即可。',
      ].join('\n'),
    );
  }

  if (/-1743|Not authorized to send Apple events|不允许发送\s*Apple\s*事件/i.test(raw)) {
    return new SafariSetupError(
      [
        'macOS 尚未授权当前终端/应用控制 Safari。请前往：',
        '  系统设置 → 隐私与安全性 → 自动化 → 允许当前终端/IDE 控制「Safari 浏览器」。',
      ].join('\n'),
    );
  }

  if (/-1728|Can’t get tab|Can't get tab|Can’t get window|Can't get window/i.test(raw)) {
    return new Error(
      `Safari 目标标签页已关闭或窗口已变化，请重试命令。（原始信息：${raw.trim()}）`,
    );
  }

  return err instanceof Error ? err : new Error(raw);
}

export async function runAppleScript(
  script: string,
  args: string[] = [],
  timeoutMs = OSASCRIPT_TIMEOUT_MS,
): Promise<string> {
  assertMacOS();
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script, ...args], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.replace(/\r?\n$/, '');
  } catch (err) {
    throw mapAppleScriptError(err);
  }
}

const LIST_TABS_SCRIPT = `
on run argv
  set fieldSep to character id 31
  set recordSep to character id 30
  tell application "Safari"
    if not running then return ""
    set outList to {}
    set winCount to count of windows
    repeat with wIdx from 1 to winCount
      try
        set w to window wIdx
        set wId to id of w
        set tCount to count of tabs of w
        repeat with tIdx from 1 to tCount
          try
            set t to tab tIdx of w
            set u to URL of t
            if u is missing value then set u to ""
            set n to name of t
            if n is missing value then set n to ""
            set end of outList to ((wId as text) & fieldSep & (tIdx as text) & fieldSep & u & fieldSep & n)
          end try
        end repeat
      end try
    end repeat
    set AppleScript's text item delimiters to recordSep
    return outList as text
  end tell
end run
`;

export async function listSafariTabs(): Promise<SafariTabRef[]> {
  const raw = await runAppleScript(LIST_TABS_SCRIPT);
  if (!raw) {
    return [];
  }
  return raw
    .split(RECORD_SEP)
    .filter(Boolean)
    .map((row) => {
      const [winIdRaw, tabIdxRaw, url = '', title = ''] = row.split(FIELD_SEP);
      return {
        winId: Number.parseInt(winIdRaw ?? '0', 10),
        tabIdx: Number.parseInt(tabIdxRaw ?? '0', 10),
        url,
        title,
      };
    })
    .filter((t) => Number.isFinite(t.winId) && t.winId > 0 && Number.isFinite(t.tabIdx) && t.tabIdx > 0);
}

const OPEN_TAB_SCRIPT = `
on run argv
  set targetUrl to item 1 of argv
  set shouldActivate to (item 2 of argv) is "true"
  set fieldSep to character id 31
  tell application "Safari"
    if not running then
      launch
      delay 0.6
    end if
    if shouldActivate then activate
    if (count of windows) is 0 then
      make new document with properties {URL:targetUrl}
      delay 0.3
      set w to front window
      set tIdx to index of current tab of w
      return ((id of w as text) & fieldSep & (tIdx as text))
    else
      set w to front window
      tell w
        set newTab to make new tab with properties {URL:targetUrl}
        set current tab to newTab
        set tIdx to index of newTab
      end tell
      return ((id of w as text) & fieldSep & (tIdx as text))
    end if
  end tell
end run
`;

const SELECT_TAB_URL_SCRIPT = `
on run argv
  set winId to (item 1 of argv) as integer
  set tabIdx to (item 2 of argv) as integer
  tell application "Safari"
    set u to URL of tab tabIdx of window id winId
    if u is missing value then return ""
    return u as text
  end tell
end run
`;

const SET_TAB_URL_SCRIPT = `
on run argv
  set winId to (item 1 of argv) as integer
  set tabIdx to (item 2 of argv) as integer
  set targetUrl to item 3 of argv
  set shouldActivate to (item 4 of argv) is "true"
  tell application "Safari"
    set w to window id winId
    set t to tab tabIdx of w
    set URL of t to targetUrl
    if shouldActivate then
      set current tab of w to t
      set index of w to 1
      activate
    end if
  end tell
end run
`;

const ACTIVATE_TAB_SCRIPT = `
on run argv
  set winId to (item 1 of argv) as integer
  set tabIdx to (item 2 of argv) as integer
  tell application "Safari"
    set w to window id winId
    set current tab of w to tab tabIdx of w
    set index of w to 1
    activate
  end tell
end run
`;

const DO_JS_SCRIPT = `
on run argv
  set winId to (item 1 of argv) as integer
  set tabIdx to (item 2 of argv) as integer
  set jsCode to item 3 of argv
  tell application "Safari"
    set res to do JavaScript jsCode in tab tabIdx of window id winId
    if res is missing value then return ""
    return res as text
  end tell
end run
`;

function buildFrameResolverSnippet(target: FrameTarget): string {
  if (target === 'main') {
    return `
      const __doc = document;
      const __win = window;
    `;
  }
  if ('selector' in target) {
    return `
      const __ifr = document.querySelector(${JSON.stringify(target.selector)});
      if (!__ifr) throw new Error("IFRAME_NOT_FOUND:" + ${JSON.stringify(target.selector)});
      const __doc = __ifr.contentDocument;
      const __win = __ifr.contentWindow || window;
      if (!__doc) throw new Error("IFRAME_NOT_ACCESSIBLE:" + ${JSON.stringify(target.selector)});
    `;
  }
  if ('index' in target) {
    return `
      const __ifr = document.querySelectorAll("iframe")[${target.index}];
      if (!__ifr) throw new Error("IFRAME_INDEX_OUT_OF_RANGE:" + ${target.index});
      const __doc = __ifr.contentDocument;
      const __win = __ifr.contentWindow || window;
      if (!__doc) throw new Error("IFRAME_NOT_ACCESSIBLE:" + ${target.index});
    `;
  }
  return `
    const __outer = document.querySelector(${JSON.stringify(target.nested[0])});
    if (!__outer || !__outer.contentDocument) throw new Error("OUTER_IFRAME_NOT_ACCESSIBLE");
    const __inner = __outer.contentDocument.querySelector(${JSON.stringify(target.nested[1])});
    if (!__inner || !__inner.contentDocument) throw new Error("INNER_IFRAME_NOT_ACCESSIBLE");
    const __doc = __inner.contentDocument;
    const __win = __inner.contentWindow || __outer.contentWindow || window;
  `;
}

function buildEnvelopeJs(
  target: FrameTarget,
  fnBody: string,
  args: Record<string, unknown>,
): string {
  const argsLiteral = JSON.stringify(args);
  const resolver = buildFrameResolverSnippet(target);
  return `(() => {
    try {
      ${resolver}
      const __args = ${argsLiteral};
      const __run = (
        document,
        window,
        location,
        args,
        HTMLElement,
        HTMLInputElement,
        HTMLTextAreaElement,
        HTMLAnchorElement,
        Element,
        Event,
        InputEvent,
        KeyboardEvent,
        MouseEvent,
        getComputedStyle
      ) => {
        ${fnBody}
      };
      const __value = __run(
        __doc,
        __win,
        __win.location,
        __args,
        __win.HTMLElement || HTMLElement,
        __win.HTMLInputElement || HTMLInputElement,
        __win.HTMLTextAreaElement || HTMLTextAreaElement,
        __win.HTMLAnchorElement || HTMLAnchorElement,
        __win.Element || Element,
        __win.Event || Event,
        __win.InputEvent || InputEvent,
        __win.KeyboardEvent || KeyboardEvent,
        __win.MouseEvent || MouseEvent,
        __win.getComputedStyle ? __win.getComputedStyle.bind(__win) : getComputedStyle
      );
      return JSON.stringify({ __ok: true, value: __value === undefined ? null : __value });
    } catch (e) {
      const __msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
      return JSON.stringify({ __ok: false, error: __msg });
    }
  })()`;
}

type JsEnvelope<T> =
  | { __ok: true; value: T }
  | { __ok: false; error: string };

export class SafariPage {
  constructor(
    public readonly winId: number,
    public readonly tabIdx: number,
  ) {}

  async url(): Promise<string> {
    return runAppleScript(SELECT_TAB_URL_SCRIPT, [String(this.winId), String(this.tabIdx)]);
  }

  async activate(): Promise<void> {
    await runAppleScript(ACTIVATE_TAB_SCRIPT, [String(this.winId), String(this.tabIdx)]);
  }

  async goto(
    targetUrl: string,
    opts: { timeoutMs?: number; activate?: boolean } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 45_000;
    await runAppleScript(SET_TAB_URL_SCRIPT, [
      String(this.winId),
      String(this.tabIdx),
      targetUrl,
      opts.activate ? 'true' : 'false',
    ]);
    await sleepRandom(350, 650);
    await this.waitFor(
      async () => {
        const ready = await this.eval<boolean>(
          `return document.readyState === "interactive" || document.readyState === "complete";`,
        ).catch(() => false);
        return ready ? true : false;
      },
      timeoutMs,
      200,
      400,
      `等待页面加载完成 (${targetUrl})`,
    );
  }

  async eval<T>(fnBody: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.evalInFrame<T>('main', fnBody, args);
  }

  async evalInFrame<T>(
    target: FrameTarget,
    fnBody: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const js = buildEnvelopeJs(target, fnBody, args);
    const raw = await runAppleScript(DO_JS_SCRIPT, [
      String(this.winId),
      String(this.tabIdx),
      js,
    ]);
    if (!raw) {
      throw new Error('Safari 执行脚本返回空结果（页面可能正在跳转或尚未就绪）。');
    }
    let parsed: JsEnvelope<T>;
    try {
      parsed = JSON.parse(raw) as JsEnvelope<T>;
    } catch {
      throw new Error(`Safari 脚本返回内容无法解析为 JSON：${raw.slice(0, 200)}`);
    }
    if (!parsed.__ok) {
      throw new Error(parsed.error || 'Safari 页面脚本执行失败');
    }
    return parsed.value;
  }

  /**
   * 枚举主文档以及所有可访问的同源 iframe（含一层嵌套，如 recommendFrame 内的 c-resume）。
   */
  async listFrames(): Promise<FrameMeta[]> {
    return this.eval<FrameMeta[]>(`
      const out = [{
        target: "main",
        name: "main",
        src: location.href,
        url: location.href,
        visible: true,
        width: window.innerWidth,
        height: window.innerHeight,
      }];
      const topIframes = Array.from(document.querySelectorAll("iframe"));
      topIframes.forEach((ifr, idx) => {
        const rect = ifr.getBoundingClientRect();
        const st = window.getComputedStyle(ifr);
        const visible = rect.width > 8 && rect.height > 8 && st.display !== "none" && st.visibility !== "hidden";
        let frameUrl = "";
        let childDoc = null;
        try {
          childDoc = ifr.contentDocument;
          frameUrl = ifr.contentWindow?.location?.href || "";
        } catch {}
        const name = ifr.getAttribute("name") || "";
        const src = ifr.getAttribute("src") || "";
        out.push({
          target: name ? { selector: 'iframe[name="' + name.replace(/"/g, '\\\\"') + '"]' } : { index: idx },
          name,
          src,
          url: frameUrl,
          visible,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
        if (childDoc && name) {
          const nested = Array.from(childDoc.querySelectorAll("iframe"));
          nested.forEach((nIfr) => {
            const nSrc = nIfr.getAttribute("src") || "";
            const nRect = nIfr.getBoundingClientRect();
            const nSt = (ifr.contentWindow || window).getComputedStyle(nIfr);
            const nVis = nRect.width > 8 && nRect.height > 8 && nSt.display !== "none" && nSt.visibility !== "hidden";
            let nUrl = "";
            try {
              nUrl = nIfr.contentWindow?.location?.href || "";
            } catch {}
            const innerSel = nSrc.includes("c-resume")
              ? 'iframe[src*="c-resume"]'
              : nIfr.getAttribute("name")
                ? 'iframe[name="' + nIfr.getAttribute("name").replace(/"/g, '\\\\"') + '"]'
                : "iframe";
            out.push({
              target: { nested: ['iframe[name="' + name.replace(/"/g, '\\\\"') + '"]', innerSel] },
              name: nIfr.getAttribute("name") || "",
              src: nSrc,
              url: nUrl,
              visible: nVis,
              width: Math.round(nRect.width),
              height: Math.round(nRect.height),
            });
          });
        }
      });
      return out;
    `);
  }

  async evalInAllFrames<T>(
    fnBody: string,
    args: Record<string, unknown> = {},
  ): Promise<Array<FrameEvalMatch<T>>> {
    const frames = await this.listFrames();
    const results: Array<FrameEvalMatch<T>> = [];
    for (const f of frames) {
      try {
        const value = await this.evalInFrame<T>(f.target, fnBody, args);
        results.push({ target: f.target, frameUrl: f.url || f.src, value });
      } catch {
        // 跨域或已卸载的 frame 跳过
      }
    }
    return results;
  }

  async waitFor<T>(
    check: () => Promise<T | false | null | undefined>,
    timeoutMs: number,
    pollMsMin = 180,
    pollMsMax = 350,
    label = '条件就绪',
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await check();
      if (value !== false && value !== null && value !== undefined) {
        return value;
      }
      await sleepRandom(pollMsMin, pollMsMax);
    }
    throw new Error(`等待超时（${Math.round(timeoutMs / 1000)}s）：${label}`);
  }

  /**
   * 向当前窗口发送一次按键。
   * 在线简历的 Canvas 渲染层不响应 JS 合成事件，只能用真实键盘事件触发滚动。
   */
  async pressKey(keyCode: number, times = 1): Promise<void> {
    assertMacOS();
    await this.activate();
    await sleepRandom(180, 320);
    for (let i = 0; i < times; i++) {
      await runAppleScript(`tell application "System Events" to key code ${keyCode}`, []);
      await sleepRandom(120, 220);
    }
  }

  /**
   * 截取当前 Safari 窗口到 PNG 文件（用于简历为图片/Canvas 或显式要求截图的场景）。
   */
  async captureWindowScreenshot(absPath: string): Promise<{ ok: boolean; error?: string }> {
    assertMacOS();
    try {
      await this.activate();
      await sleepRandom(250, 400);
      await execFileAsync('screencapture', ['-x', '-o', '-l', String(this.winId), absPath], {
        timeout: 15_000,
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Safari 窗口截图失败（如提示无权限，请在「系统设置 → 隐私与安全性 → 录屏与系统录音」中授权当前终端）：${msg}`,
      };
    }
  }
}

export async function openOrReuseBossTab(opts: {
  targetUrl?: string;
  activate?: boolean;
  forceNavigate?: boolean;
} = {}): Promise<SafariPage> {
  const targetUrl = opts.targetUrl ?? 'https://www.zhipin.com/web/chat/index';
  const tabs = await listSafariTabs();

  const chatTab = tabs.find((t) => /zhipin\.com\/web\/chat/i.test(t.url));
  const anyBossTab = chatTab ?? tabs.find((t) => /zhipin\.com/i.test(t.url));

  if (anyBossTab) {
    const page = new SafariPage(anyBossTab.winId, anyBossTab.tabIdx);
    if (opts.forceNavigate) {
      await page.goto(targetUrl, { activate: opts.activate ?? false });
    } else if (opts.activate) {
      await page.activate();
    }
    return page;
  }

  const created = await runAppleScript(OPEN_TAB_SCRIPT, [
    targetUrl,
    opts.activate ? 'true' : 'false',
  ]);
  const [winIdRaw, tabIdxRaw] = created.split(FIELD_SEP);
  const winId = Number.parseInt(winIdRaw ?? '0', 10);
  const tabIdx = Number.parseInt(tabIdxRaw ?? '0', 10);
  if (!Number.isFinite(winId) || winId <= 0 || !Number.isFinite(tabIdx) || tabIdx <= 0) {
    throw new Error(`无法在 Safari 中打开 Boss 标签页（返回值：${created || '空'}）。`);
  }
  const page = new SafariPage(winId, tabIdx);
  await sleepRandom(400, 700);
  return page;
}

export async function checkSafariHealth(): Promise<{
  platform: string;
  safariRunning: boolean;
  tabCount: number;
  bossTab: SafariTabRef | null;
  jsAppleEventsEnabled: boolean;
  jsError?: string;
  loggedInShell?: boolean;
}> {
  assertMacOS();
  const tabs = await listSafariTabs();
  const bossTab =
    tabs.find((t) => /zhipin\.com\/web\/chat/i.test(t.url)) ??
    tabs.find((t) => /zhipin\.com/i.test(t.url)) ??
    null;

  const probeTab = bossTab ?? tabs[0] ?? null;
  if (!probeTab) {
    return {
      platform: process.platform,
      safariRunning: tabs.length > 0,
      tabCount: 0,
      bossTab: null,
      jsAppleEventsEnabled: false,
      jsError: 'Safari 当前没有打开的标签页，请先运行 boss login 打开 Boss 直聘。',
    };
  }

  const page = new SafariPage(probeTab.winId, probeTab.tabIdx);
  try {
    const hasMenu = await page.eval<boolean>(`return !!document.querySelector(".menu-list");`);
    return {
      platform: process.platform,
      safariRunning: true,
      tabCount: tabs.length,
      bossTab,
      jsAppleEventsEnabled: true,
      loggedInShell: bossTab ? hasMenu : false,
    };
  } catch (err) {
    return {
      platform: process.platform,
      safariRunning: true,
      tabCount: tabs.length,
      bossTab,
      jsAppleEventsEnabled: false,
      jsError: err instanceof Error ? err.message : String(err),
    };
  }
}
