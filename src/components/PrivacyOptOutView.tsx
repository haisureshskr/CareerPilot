import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import type { OptOutRecord } from '../types';

interface PrivacyOptOutViewProps {
  optOuts: OptOutRecord[];
  onSubmitOptOut: (linkedinUrl: string, reason?: string) => Promise<void>;
  onNavigate: (path: string) => void;
}

export const PrivacyOptOutView: React.FC<PrivacyOptOutViewProps> = ({
  optOuts,
  onSubmitOptOut,
  onNavigate,
}) => {
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      await onSubmitOptOut(linkedinUrl, reason);
      setLinkedinUrl('');
      setReason('');
      setResult({
        type: 'success',
        text: 'Opt-out recorded immediately. This LinkedIn profile is now blocked from appearing in any CareerPilot AI Hiring Team card.',
      });
    } catch (err) {
      setResult({
        type: 'error',
        text: err instanceof Error ? err.message : 'Please provide a valid LinkedIn profile URL.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-xs font-medium text-emerald-700">Public Compliance Registry · /privacy/opt-out</p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Recruiter & Hiring Manager Privacy Opt-Out
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          CareerPilot AI never scrapes behind LinkedIn or Naukri logins and enforces automatic 30-day data purging. Any recruiter or hiring manager can permanently suppress their public job-poster profile here.
        </p>
      </div>

      {result && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3 ${
            result.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {result.text}
          </span>
          {result.type === 'success' && (
            <button
              type="button"
              onClick={() => onNavigate('/queue')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
            >
              Verify in Queue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Block Your LinkedIn Profile Immediately
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Enter your public LinkedIn profile URL below. Suppression takes effect instantaneously without creating an account.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="opt-out-url" className="block text-xs font-semibold text-slate-700">
            LinkedIn Profile URL
          </label>
          <input
            id="opt-out-url"
            type="url"
            required
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/your-profile-handle"
            className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <button
            type="button"
            onClick={() =>
              setLinkedinUrl('https://www.linkedin.com/in/siddharth-kulkarni-checkout')
            }
            className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            Fill sample recruiter URL (Siddharth Kulkarni · Razorpay) to test live redaction
          </button>
        </div>

        <div>
          <label htmlFor="opt-out-reason" className="block text-xs font-semibold text-slate-700">
            Optional Note (e.g. DPDP / GDPR / CCPA request)
          </label>
          <input
            id="opt-out-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional — no justification required"
            className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Stored as normalized suppression hash · Zero login required
          </span>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Suppressing...' : 'Block My Profile'}
          </button>
        </div>
      </form>

      {/* Active Suppression Registry */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            Active Opt-Out Suppressions ({optOuts.length})
          </h2>
          <span className="text-xs text-slate-500">Applied globally in real time</span>
        </div>

        {optOuts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No profiles opted out yet. Submit a LinkedIn URL above to see it redacted in the Approval Queue.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-xs">
            {optOuts.map((rec) => (
              <li key={rec.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-slate-900 truncate">
                    {rec.urlSha256 ? `SHA-256: ${rec.urlSha256.slice(0, 32)}…` : rec.normalizedHandle}
                  </p>
                  <p className="text-slate-500 mt-0.5">
                    {rec.reason ? `${rec.reason} · ` : ''}One-way hashed suppression active
                  </p>
                </div>
                <span className="font-mono text-slate-500 tabular-nums">
                  Blocked {new Date(rec.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
