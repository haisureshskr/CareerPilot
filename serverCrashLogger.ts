import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info';
export type LogSource = 'server' | 'web_client' | 'android_client';

export interface DeviceContext {
  deviceModel: string;
  os: string;
  browser?: string;
  platform?: string;
  userAgent?: string;
  language?: string;
  timezone?: string;
  viewport?: string;
  screen?: string;
  pixelRatio?: number;
  online?: boolean;
  appVersion?: string;
}

export interface StructuredCrashLog {
  eventId: string;
  level: LogLevel;
  source: LogSource;
  timestamp: string;
  date: string;
  localDateTime: string;
  context: string;
  route?: string;
  method?: string;
  statusCode?: number;
  errorName?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  sessionId?: string;
  device: DeviceContext;
  breadcrumbs?: Array<{ time: string; action: string }>;
  metadata?: Record<string, string | number | boolean | null>;
  runtime: {
    nodeVersion: string;
    platform: string;
    arch: string;
    hostname: string;
    uptimeSec: number;
    memoryRssMb: number;
  };
}

const DATA_DIR = path.resolve(process.cwd(), '.careerpilot-data');
const LOG_DIR = path.resolve(DATA_DIR, 'logs');
const MAX_DAILY_LOG_BYTES = 5 * 1024 * 1024; // 5 MB cap per daily log file
const MAX_LOG_RETENTION_DAYS = 14;
const CLIENT_RATE_LIMIT_MAX = 60;
const CLIENT_RATE_WINDOW_MS = 60_000;

let clientLogTimestamps: number[] = [];
let processHandlersInstalled = false;

export function redactSensitiveText(input: string): string {
  return input
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/sk-[0-9A-Za-z\-_]{16,}/g, '[REDACTED_SECRET]')
    .replace(/ghp_[0-9A-Za-z]{20,}/g, '[REDACTED_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-~+/]+=*/gi, '$1[REDACTED_TOKEN]')
    .replace(/(password|passwd|secret|token|apikey|api_key)\s*[:=]\s*["']?[^"'\s,}]+/gi, '$1=[REDACTED]');
}

function generateEventId(prefix = 'SRV'): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function getRuntimeSnapshot() {
  const mem = process.memoryUsage();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    uptimeSec: Math.round(process.uptime()),
    memoryRssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
  };
}

export function extractDeviceFromRequest(req?: Request): DeviceContext {
  if (!req) {
    return {
      deviceModel: `Server (${os.type()} ${os.arch()})`,
      os: `${os.type()} ${os.release()}`,
      platform: process.platform,
    };
  }

  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  const chModel = String(req.headers['sec-ch-ua-model'] || '').replace(/^"|"$/g, '').trim();
  const chPlatform = String(req.headers['sec-ch-ua-platform'] || '').replace(/^"|"$/g, '').trim();

  let deviceModel = chModel || 'Unknown Client';
  let osLabel = chPlatform || 'Unknown OS';
  let browser = 'Unknown Browser';

  const androidMatch = ua.match(/Android\s+([\d.]+);\s*([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i);
  if (androidMatch) {
    osLabel = `Android ${androidMatch[1]}`;
    if (!chModel) deviceModel = androidMatch[2].trim() || 'Android Device';
  } else if (/iPhone/i.test(ua)) {
    const ver = ua.match(/OS\s+([\d_]+)/i)?.[1]?.replace(/_/g, '.') || '';
    osLabel = ver ? `iOS ${ver}` : 'iOS';
    deviceModel = 'Apple iPhone';
  } else if (/iPad/i.test(ua)) {
    const ver = ua.match(/OS\s+([\d_]+)/i)?.[1]?.replace(/_/g, '.') || '';
    osLabel = ver ? `iPadOS ${ver}` : 'iPadOS';
    deviceModel = 'Apple iPad';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    osLabel = chPlatform || 'macOS';
    if (!chModel) deviceModel = 'Apple Mac';
  } else if (/Windows NT/i.test(ua)) {
    osLabel = chPlatform || 'Windows';
    if (!chModel) deviceModel = 'Windows PC';
  } else if (/Linux/i.test(ua)) {
    osLabel = chPlatform || 'Linux';
    if (!chModel) deviceModel = 'Linux Host';
  }

  if (/Edg\/([\d.]+)/i.test(ua)) {
    browser = `Edge ${ua.match(/Edg\/([\d.]+)/i)?.[1] || ''}`.trim();
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    browser = `Firefox ${ua.match(/Firefox\/([\d.]+)/i)?.[1] || ''}`.trim();
  } else if (/Chrome\/([\d.]+)/i.test(ua)) {
    browser = `Chrome ${ua.match(/Chrome\/([\d.]+)/i)?.[1] || ''}`.trim();
  } else if (/Safari/i.test(ua)) {
    browser = 'Safari';
  } else if (/node|undici|curl/i.test(ua)) {
    browser = ua.split(' ')[0] || 'HTTP Client';
  }

  return {
    deviceModel: deviceModel.slice(0, 120),
    os: osLabel.slice(0, 80),
    browser: browser.slice(0, 80),
    userAgent: ua,
    language: String(req.headers['accept-language'] || '').split(',')[0]?.slice(0, 32) || undefined,
  };
}

function getSafeDailyLogPath(utcDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) return null;
  const resolved = path.resolve(LOG_DIR, `crash-${utcDate}.jsonl`);
  if (!resolved.startsWith(LOG_DIR + path.sep)) return null;
  return resolved;
}

function pruneOldLogs(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((name) => /^crash-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort();
    while (files.length > MAX_LOG_RETENTION_DAYS) {
      const oldest = files.shift();
      if (!oldest) break;
      const target = path.resolve(LOG_DIR, oldest);
      if (target.startsWith(LOG_DIR + path.sep)) {
        fs.unlinkSync(target);
      }
    }
  } catch {
    // Non-fatal cleanup error
  }
}

function writeLogEntry(entry: StructuredCrashLog): void {
  const serialized = JSON.stringify(entry);
  if (entry.level === 'fatal' || entry.level === 'error') {
    console.error(`[CareerPilotLog:${entry.level.toUpperCase()}]`, serialized);
  } else if (entry.level === 'warn') {
    console.warn(`[CareerPilotLog:WARN]`, serialized);
  } else {
    console.log(`[CareerPilotLog:INFO]`, serialized);
  }

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const filePath = getSafeDailyLogPath(entry.date);
    if (!filePath) return;

    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size >= MAX_DAILY_LOG_BYTES) {
        return; // Prevent runaway disk consumption in a crash loop
      }
    }
    fs.appendFileSync(filePath, `${serialized}\n`, 'utf-8');
    pruneOldLogs();
  } catch {
    // Never crash the app due to filesystem logging issues
  }
}

export function logServerError(params: {
  level?: LogLevel;
  context: string;
  error: unknown;
  req?: Request;
  statusCode?: number;
  metadata?: Record<string, string | number | boolean | null>;
}): string {
  const now = new Date();
  const eventId = generateEventId('SRV');
  const level = params.level || 'error';

  let errorName = 'Error';
  let message = 'Unknown server error';
  let stack: string | undefined;

  if (params.error instanceof Error) {
    errorName = params.error.name || 'Error';
    message = params.error.message || 'Unknown server error';
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

  const entry: StructuredCrashLog = {
    eventId,
    level,
    source: 'server',
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    localDateTime: now.toString(),
    context: redactSensitiveText(params.context).slice(0, 200),
    route: params.req?.originalUrl?.slice(0, 300),
    method: params.req?.method,
    statusCode: params.statusCode,
    errorName: redactSensitiveText(errorName).slice(0, 100),
    message: redactSensitiveText(message).slice(0, 1000),
    stack: stack ? redactSensitiveText(stack).slice(0, 6000) : undefined,
    device: extractDeviceFromRequest(params.req),
    metadata: params.metadata,
    runtime: getRuntimeSnapshot(),
  };

  writeLogEntry(entry);
  return eventId;
}

export function ingestClientCrashLog(req: Request, res: Response): Response {
  const nowMs = Date.now();
  clientLogTimestamps = clientLogTimestamps.filter((ts) => ts >= nowMs - CLIENT_RATE_WINDOW_MS);
  if (clientLogTimestamps.length >= CLIENT_RATE_LIMIT_MAX) {
    return res.status(429).json({ ok: false, error: 'Client crash log rate limit exceeded.' });
  }
  clientLogTimestamps.push(nowMs);

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const allowedLevels: LogLevel[] = ['fatal', 'error', 'warn', 'info'];
  const level: LogLevel =
    typeof body.level === 'string' && allowedLevels.includes(body.level as LogLevel)
      ? (body.level as LogLevel)
      : 'error';
  const source: LogSource = body.source === 'android_client' ? 'android_client' : 'web_client';

  const now = new Date();
  const rawEventId = typeof body.eventId === 'string' ? body.eventId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) : '';
  const eventId = rawEventId || generateEventId(source === 'android_client' ? 'AND' : 'WEB');

  const rawDevice =
    body.device && typeof body.device === 'object' ? (body.device as Record<string, unknown>) : {};
  const fallbackDevice = extractDeviceFromRequest(req);

  const device: DeviceContext = {
    deviceModel: redactSensitiveText(String(rawDevice.deviceModel || fallbackDevice.deviceModel || 'Unknown')).slice(0, 120),
    os: redactSensitiveText(String(rawDevice.os || fallbackDevice.os || 'Unknown')).slice(0, 80),
    browser: rawDevice.browser
      ? redactSensitiveText(String(rawDevice.browser)).slice(0, 80)
      : fallbackDevice.browser,
    platform: rawDevice.platform ? String(rawDevice.platform).slice(0, 60) : fallbackDevice.platform,
    userAgent: redactSensitiveText(String(rawDevice.userAgent || fallbackDevice.userAgent || '')).slice(0, 400),
    language: rawDevice.language ? String(rawDevice.language).slice(0, 32) : fallbackDevice.language,
    timezone: rawDevice.timezone ? String(rawDevice.timezone).slice(0, 64) : undefined,
    viewport: rawDevice.viewport ? String(rawDevice.viewport).slice(0, 32) : undefined,
    screen: rawDevice.screen ? String(rawDevice.screen).slice(0, 32) : undefined,
    pixelRatio:
      typeof rawDevice.pixelRatio === 'number' && Number.isFinite(rawDevice.pixelRatio)
        ? Math.max(0.5, Math.min(10, rawDevice.pixelRatio))
        : undefined,
    online: typeof rawDevice.online === 'boolean' ? rawDevice.online : undefined,
    appVersion: rawDevice.appVersion ? String(rawDevice.appVersion).slice(0, 48) : undefined,
  };

  const breadcrumbs = Array.isArray(body.breadcrumbs)
    ? body.breadcrumbs.slice(-20).map((b) => {
        const rec = b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
        return {
          time: String(rec.time || now.toISOString()).slice(0, 40),
          action: redactSensitiveText(String(rec.action || '')).slice(0, 180),
        };
      })
    : undefined;

  const rawMeta =
    body.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null;
  let metadata: Record<string, string | number | boolean | null> | undefined;
  if (rawMeta) {
    metadata = {};
    for (const [k, v] of Object.entries(rawMeta).slice(0, 20)) {
      const cleanKey = k.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 48);
      if (!cleanKey) continue;
      if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
        metadata[cleanKey] = v;
      } else {
        metadata[cleanKey] = redactSensitiveText(String(v)).slice(0, 250);
      }
    }
  }

  const entry: StructuredCrashLog = {
    eventId,
    level,
    source,
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    localDateTime: typeof body.localDateTime === 'string' ? body.localDateTime.slice(0, 80) : now.toString(),
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : undefined,
    route: typeof body.route === 'string' ? redactSensitiveText(body.route).slice(0, 240) : undefined,
    context: redactSensitiveText(String(body.context || 'client.error')).slice(0, 200),
    errorName: redactSensitiveText(String(body.errorName || 'Error')).slice(0, 100),
    message: redactSensitiveText(String(body.message || 'Client error reported')).slice(0, 1000),
    stack: typeof body.stack === 'string' ? redactSensitiveText(body.stack).slice(0, 6000) : undefined,
    componentStack:
      typeof body.componentStack === 'string'
        ? redactSensitiveText(body.componentStack).slice(0, 4000)
        : undefined,
    device,
    breadcrumbs,
    metadata,
    runtime: getRuntimeSnapshot(),
  };

  writeLogEntry(entry);
  return res.status(202).json({ ok: true, eventId: entry.eventId, date: entry.date });
}

export function expressErrorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const eventId = logServerError({
    level: 'fatal',
    context: 'express.unhandled_route_error',
    error: err,
    req,
    statusCode: 500,
  });

  if (res.headersSent) return;
  res.status(500).json({
    error: 'An unexpected server error occurred. Please share the reference ID with the development team.',
    eventId,
  });
}

export function installProcessCrashHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  process.on('uncaughtException', (err: Error) => {
    logServerError({
      level: 'fatal',
      context: 'process.uncaughtException',
      error: err,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logServerError({
      level: 'error',
      context: 'process.unhandledRejection',
      error: reason,
    });
  });
}
