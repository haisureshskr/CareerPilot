import type { OptOutRecord, TrackedApplication } from '../types';

/**
 * Validates external URLs to strictly allow http: and https: protocols,
 * blocking javascript:, data:, vbscript:, or malformed URIs.
 */
export function sanitizeExternalUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeLinkedInHandle(rawUrl: string): string {
  const trimmed = rawUrl.trim().toLowerCase();
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const cleanedPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${cleanedPath}`;
  } catch {
    return trimmed.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  }
}

export function isRecruiterOptedOut(linkedinUrl: string, optOuts: OptOutRecord[]): boolean {
  const target = normalizeLinkedInHandle(linkedinUrl);
  return optOuts.some((record) => record.normalizedHandle === target);
}

export function downloadSubmissionProof(app: TrackedApplication): void {
  const lines = [
    '====================================================================',
    'CAREEEPILOT AI — HUMAN-APPROVED APPLICATION AUDIT PROOF',
    '====================================================================',
    `Audit Receipt ID : ${app.auditReceiptId}`,
    `Recorded At (UTC): ${new Date(app.timestamp).toISOString()}`,
    `Status           : ${app.status.toUpperCase()}`,
    `Human Verified   : ${app.humanVerified ? 'YES (Explicit HITL Approval Gate)' : 'NO'}`,
    '',
    'POSITION DETAILS',
    '--------------------------------------------------------------------',
    `Company          : ${app.company}`,
    `Role             : ${app.role}`,
    `Location         : ${app.location}`,
    `Compensation     : ${app.salary}`,
    `ATS Portal       : ${app.portalType}`,
    `ATS Match Score  : ${app.matchScore}%`,
    app.actionReason ? `Action Note      : ${app.actionReason}` : '',
    '',
    'TRUTHFUL RESUME DIFFS APPLIED',
    '--------------------------------------------------------------------',
    ...app.resumeDiffs.flatMap((d, idx) => [
      `${idx + 1}. [${d.experienceRef}]`,
      `   Before   : ${d.before}`,
      `   After    : ${d.after}`,
      `   Rationale: ${d.rationale}`,
      '',
    ]),
    'SCREENING ANSWERS SUBMITTED',
    '--------------------------------------------------------------------',
    ...app.screeningQuestions.flatMap((q, idx) => [
      `${idx + 1}. [${q.confidence} · ${q.sourceLabel}] ${q.question}`,
      `   Answer: ${q.answer}`,
      '',
    ]),
    '====================================================================',
    'CareerPilot AI is an independent productivity tool and is not',
    'affiliated with, endorsed by, or sponsored by LinkedIn, Naukri,',
    'Workday, Greenhouse, or Indeed.',
    '====================================================================',
  ].filter(Boolean);

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CareerPilot-Audit-${app.auditReceiptId}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
