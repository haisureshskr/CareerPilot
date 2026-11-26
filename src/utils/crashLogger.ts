export type CrashLogLevel = 'fatal' | 'error' | 'warn' | 'info';

export interface ClientDeviceInfo {
  deviceModel: string;
  os: string;
  browser: string;
  platform: string;
  userAgent: string;
  language: string;
  timezone: string;
  viewport: string;
  screen: string;
  pixelRatio: number;
  online: boolean;
  appVersion: string;
}

export interface ClientCrashReport {
  eventId: string;
  level: CrashLogLevel;
  source: 'web_client';
  timestamp: string;
  date: string;
  localDateTime: string;
  sessionId: string;
  route: string;
  context: string;
  message: string;
  errorName: string;
  stack?: string;
  componentStack?: string;
  device: ClientDeviceInfo;
  breadcrumbs: Array<{ time: string; action: string }>;
  metadata?: Record<string, string | number | boolean | null>;
}

const APP_VERSION = '1.0.0-web-india';
const MAX_BREADCRUMBS = 20;
const SESSION_ID = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const breadcrumbs: Array<{ time: string; action: string }> = [];
let globalHandlersInstalled = false;
let isSendingLog = false;
let cachedHighEntropyModel: string | null = null;

function redactSensitive(input: string): string {
  return input
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/sk-[0-9A-Za-z\-_]{16,}/g, '[REDACTED_SECRET]')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-~+/]+=*/gi, '$1[REDACTED_TOKEN]')
    .replace(/(password|passwd|secret|token|apikey|api_key)\s*[:=]\s*["']?[^"'\s,}]+/gi, '$1=[REDACTED]');
}

function generateEventId(): string {
  return `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function parseDeviceFromUserAgent(ua: string): { deviceModel: string; os: string; browser: string } {
  let os = 'Unknown OS';
  let deviceModel = 'Desktop Browser';

  const androidMatch = ua.match(/Android\s+([\d.]+);\s*([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i);
  if (androidMatch) {
    os = `Android ${androidMatch[1]}`;
    deviceModel = androidMatch[2].trim() || 'Android Device';
  } else if (/Android/i.test(ua)) {
    const ver = ua.match(/Android\s+([\d.]+)/i)?.[1] || '';
    os = ver ? `Android ${ver}` : 'Android';
    deviceModel = 'Android Device';
  } else if (/iPhone/i.test(ua)) {
    const ver = ua.match(/OS\s+([\d_]+)/i)?.[1]?.replace(/_/g, '.') || '';
    os = ver ? `iOS ${ver}` : 'iOS';
    deviceModel = 'Apple iPhone';
  } else if (/iPad/i.test(ua)) {
    const ver = ua.match(/OS\s+([\d_]+)/i)?.[1]?.replace(/_/g, '.') || '';
    os = ver ? `iPadOS ${ver}` : 'iPadOS';
    deviceModel = 'Apple iPad';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    const ver = ua.match(/Mac OS X\s+([\d_]+)/i)?.[1]?.replace(/_/g, '.') || '';
    os = ver ? `macOS ${ver}` : 'macOS';
    deviceModel = 'Apple Mac';
  } else if (/Windows NT/i.test(ua)) {
    const nt = ua.match(/Windows NT\s+([\d.]+)/i)?.[1] || '';
    os = nt === '10.0' ? 'Windows 10/11' : nt ? `Windows NT ${nt}` : 'Windows';
    deviceModel = 'Windows PC';
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
    deviceModel = 'Chromebook';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
    deviceModel = 'Linux Desktop';
  }

  let browser = 'Unknown Browser';
  if (/Edg\/([\d.]+)/i.test(ua)) {
    browser = `Edge ${ua.match(/Edg\/([\d.]+)/i)?.[1] || ''}`.trim();
  } else if (/OPR\/([\d.]+)/i.test(ua)) {
    browser = `Opera ${ua.match(/OPR\/([\d.]+)/i)?.[1] || ''}`.trim();
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    browser = `Firefox ${ua.match(/Firefox\/([\d.]+)/i)?.[1] || ''}`.trim();
  } else if (/Chrome\/([\d.]+)/i.test(ua)) {
    browser = `Chrome ${ua.match(/Chrome\/([\d.]+)/i)?.[1] || ''}`.trim();
  } else if (/Version\/([\d.]+).*Safari/i.test(ua)) {
    browser = `Safari ${ua.match(/Version\/([\d.]+)/i)?.[1] || ''}`.trim();
  }

  return {
    deviceModel: cachedHighEntropyModel || deviceModel,
    os,
    browser,
  };
}

function prefetchHighEntropyDeviceModel(): void {
  if (typeof navigator === 'undefined') return;
  const navWithUaData = navigator as Navigator & {
    userAgentData?: {
      model?: string;
      platform?: string;
      getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string; platformVersion?: string }>;
    };
  };
  const uaData = navWithUaData.userAgentData;
  if (!uaData?.getHighEntropyValues) return;
  uaData
    .getHighEntropyValues(['model', 'platform', 'platformVersion'])
    .then((values) => {
      if (values?.model && values.model.trim()) {
        cachedHighEntropyModel = values.model.trim().slice(0, 100);
      }
    })
    .catch(() => {
      // Browser may decline high-entropy hints; fallback to UA string parser
    });
}

export function collectDeviceInfo(): ClientDeviceInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      deviceModel: 'Non-Browser Runtime',
      os: 'Unknown',
      browser: 'Unknown',
      platform: 'unknown',
      userAgent: '',
      language: 'en',
      timezone: 'UTC',
      viewport: '0x0',
      screen: '0x0',
      pixelRatio: 1,
      online: true,
      appVersion: APP_VERSION,
    };
  }

  const ua = navigator.userAgent || '';
  const parsed = parseDeviceFromUserAgent(ua);
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();

  return {
    deviceModel: parsed.deviceModel,
    os: parsed.os,
    browser: parsed.browser,
    platform: navigator.platform || 'unknown',
    userAgent: ua.slice(0, 400),
    language: navigator.language || 'en',
    timezone,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: typeof window.screen !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : '0x0',
    pixelRatio: Number(window.devicePixelRatio || 1),
    online: navigator.onLine !== false,
    appVersion: APP_VERSION,
  };
}

export function addBreadcrumb(action: string): void {
  const clean = redactSensitive(action).slice(0, 180);
  breadcrumbs.push({ time: new Date().toISOString(), action: clean });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

function sendReportToBackend(report: ClientCrashReport): void {
  if (typeof window === 'undefined' || isSendingLog) return;
  isSendingLog = true;
  try {
    const body = JSON.stringify(report);
    if (report.level === 'fatal' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      const queued = navigator.sendBeacon('/api/logs/client', blob);
      if (queued) return;
    }
    void fetch('/api/logs/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Never throw secondary errors from logger transport
    });
  } catch {
    // Ignore transport failure
  } finally {
    isSendingLog = false;
  }
}

export function reportClientError(params: {
  level?: CrashLogLevel;
  context: string;
  error: unknown;
  componentStack?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): string {
  const now = new Date();
  const eventId = generateEventId();
  const level = params.level || 'error';

  let errorName = 'Error';
  let message = 'Unknown error';
  let stack: string | undefined;

  if (params.error instanceof Error) {
    errorName = params.error.name || 'Error';
    message = params.error.message || 'Unknown error';
    stack = params.error.stack;
  } else if (typeof params.error === 'string') {
    message = params.error;
  } else if (params.error && typeof params.error === 'object') {
    try {
      message = JSON.stringify(params.error);
    } catch {
      message = String(params.error);
    }
  }

  const report: ClientCrashReport = {
    eventId,
    level,
    source: 'web_client',
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    localDateTime: now.toString(),
    sessionId: SESSION_ID,
    route: typeof window !== 'undefined' ? window.location.pathname : '/',
    context: redactSensitive(params.context).slice(0, 200),
    errorName: redactSensitive(errorName).slice(0, 100),
    message: redactSensitive(message).slice(0, 1000),
    stack: stack ? redactSensitive(stack).slice(0, 6000) : undefined,
    componentStack: params.componentStack
      ? redactSensitive(params.componentStack).slice(0, 4000)
      : undefined,
    device: collectDeviceInfo(),
    breadcrumbs: [...breadcrumbs],
    metadata: params.metadata,
  };

  console.error('[CareerPilotCrash]', JSON.stringify(report));
  sendReportToBackend(report);
  return eventId;
}

export function logReactCrash(error: Error, componentStack?: string | null): string {
  return reportClientError({
    level: 'fatal',
    context: 'react.error_boundary',
    error,
    componentStack: componentStack || undefined,
  });
}

export function logAppError(
  context: string,
  error: unknown,
  metadata?: Record<string, string | number | boolean | null>
): string {
  return reportClientError({
    level: 'error',
    context,
    error,
    metadata,
  });
}

export function installGlobalCrashHandlers(): void {
  if (typeof window === 'undefined' || globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  prefetchHighEntropyDeviceModel();
  addBreadcrumb(`app_init:${window.location.pathname}`);

  window.addEventListener('error', (event: ErrorEvent) => {
    const err =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Uncaught window error');
    reportClientError({
      level: 'fatal',
      context: 'window.onerror',
      error: err,
      metadata: {
        filename: event.filename ? String(event.filename).slice(0, 250) : null,
        lineno: typeof event.lineno === 'number' ? event.lineno : null,
        colno: typeof event.colno === 'number' ? event.colno : null,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportClientError({
      level: 'error',
      context: 'window.unhandledrejection',
      error: event.reason ?? 'Unhandled promise rejection',
    });
  });
}
