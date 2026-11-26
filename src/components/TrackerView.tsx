import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Play,
  Search,
  SkipForward,
  X,
} from 'lucide-react';
import type { GuardrailStatus, TrackedApplication } from '../types';
import { downloadSubmissionProof } from '../utils/security';

interface TrackerViewProps {
  tracker: TrackedApplication[];
  guardrails: GuardrailStatus;
  liveCooldown: number;
  onResumeActionRequired: (trackerId: string) => Promise<void>;
}

type StatusFilter = 'all' | 'submitted' | 'action_required' | 'skipped';

export const TrackerView: React.FC<TrackerViewProps> = ({
  tracker,
  guardrails,
  liveCooldown,
  onResumeActionRequired,
}) => {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resumingItem, setResumingItem] = useState<TrackedApplication | null>(null);
  const [captchaDone, setCaptchaDone] = useState(false);
  const [submittingResume, setSubmittingResume] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const counts = useMemo(
    () => ({
      all: tracker.length,
      submitted: tracker.filter((t) => t.status === 'submitted').length,
      action_required: tracker.filter((t) => t.status === 'action_required').length,
      skipped: tracker.filter((t) => t.status === 'skipped').length,
    }),
    [tracker]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracker.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (!q) return true;
      return (
        item.company.toLowerCase().includes(q) ||
        item.role.toLowerCase().includes(q) ||
        item.auditReceiptId.toLowerCase().includes(q) ||
        item.portalType.toLowerCase().includes(q)
      );
    });
  }, [tracker, filter, search]);

  const handleCompleteHandoff = async () => {
    if (!resumingItem) return;
    setSubmittingResume(true);
    setNotice(null);
    try {
      await onResumeActionRequired(resumingItem.id);
      setNotice({
        type: 'success',
        text: `Completed manual CAPTCHA/OTP handoff for ${resumingItem.company}. Marked as Submitted with updated audit timestamp.`,
      });
      setResumingItem(null);
      setCaptchaDone(false);
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to resume submission right now.',
      });
    } finally {
      setSubmittingResume(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-indigo-600">Applied Tracker & Audit Log</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Submission Audit Trail
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Every human-approved submission, CAPTCHA/OTP handoff pause, and skipped role is logged with immutable timestamps and downloadable proof summaries.
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs shrink-0">
          <div>
            <span className="text-slate-500">Submitted</span>
            <p className="font-mono text-lg font-bold text-emerald-700 tabular-nums">
              {counts.submitted}
            </p>
          </div>
          <div>
            <span className="text-slate-500">Action Required</span>
            <p className="font-mono text-lg font-bold text-amber-700 tabular-nums">
              {counts.action_required}
            </p>
          </div>
          <div>
            <span className="text-slate-500">Skipped</span>
            <p className="font-mono text-lg font-bold text-slate-600 tabular-nums">
              {counts.skipped}
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notice"
            className="p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
          {(
            [
              { id: 'all', label: `All (${counts.all})` },
              { id: 'submitted', label: `Submitted (${counts.submitted})` },
              { id: 'action_required', label: `Action Required (${counts.action_required})` },
              { id: 'skipped', label: `Skipped (${counts.skipped})` },
            ] as Array<{ id: StatusFilter; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by company or receipt ID..."
            className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Audit List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-base font-semibold text-slate-900">No audit records match this filter</p>
          <p className="mt-1 text-sm text-slate-600">
            Approved, CAPTCHA-paused, and skipped applications from your Approval Queue appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isExpanded = expandedId === item.id;
            const statusConfig =
              item.status === 'submitted'
                ? {
                    label: 'Submitted',
                    color: 'text-emerald-700',
                    icon: CheckCircle2,
                  }
                : item.status === 'action_required'
                  ? {
                      label: 'Action Required (CAPTCHA / OTP)',
                      color: 'text-amber-700',
                      icon: AlertTriangle,
                    }
                  : {
                      label: 'Skipped',
                      color: 'text-slate-500',
                      icon: SkipForward,
                    };
            const StatusIcon = statusConfig.icon;

            return (
              <article
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              >
                <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                      <span className={`inline-flex items-center gap-1.5 font-semibold ${statusConfig.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {statusConfig.label}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {item.auditReceiptId}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <h3 className="mt-1.5 text-base font-bold text-slate-900">
                      {item.company} — {item.role}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                      <span>{item.location}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-medium text-slate-900 tabular-nums">
                        {item.salary}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.portalType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-indigo-700 tabular-nums">
                        {item.matchScore}% Match
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          item.applicationMode === 'direct_resume'
                            ? 'font-medium text-emerald-700'
                            : 'font-medium text-slate-600'
                        }
                      >
                        {item.applicationMode === 'direct_resume'
                          ? 'Uploaded Base Resume'
                          : 'AI-Tailored Resume'}
                      </span>
                    </div>

                    {item.actionReason && (
                      <p className="mt-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        {item.actionReason}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {item.status === 'action_required' && (
                      <button
                        type="button"
                        disabled={guardrails.remainingToday <= 0 || liveCooldown > 0}
                        onClick={() => {
                          setResumingItem(item);
                          setCaptchaDone(false);
                        }}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:bg-slate-300 disabled:text-slate-600 whitespace-nowrap"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        {liveCooldown > 0 ? `Cooldown (${liveCooldown}s)` : 'Resume Handoff'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => downloadSubmissionProof(item)}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                      Download Proof
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      aria-expanded={isExpanded}
                      className="inline-flex min-h-[42px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                    >
                      Details
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-5 space-y-4 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {item.applicationMode === 'direct_resume'
                          ? `Uploaded Base Resume Snapshot (${item.resumeLabel || 'Uploaded Base Resume'} · 0 AI edits)`
                          : `Tailored Resume Diff Snapshot (${item.resumeDiffs.length} bullets)`}
                      </p>
                      {item.resumeDiffs.length === 0 ? (
                        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-emerald-900">
                          Submitted directly using your uploaded base resume with zero AI modifications.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-2 text-slate-700">
                          {item.resumeDiffs.map((diff) => (
                            <li key={diff.id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <span className="font-semibold text-slate-900 block">
                                {diff.experienceRef}
                              </span>
                              <span className="block mt-1 text-slate-700">{diff.after}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <p className="font-semibold text-slate-900">
                        Screening Q&A Snapshot ({item.screeningQuestions.length})
                      </p>
                      <div className="mt-2 space-y-2">
                        {item.screeningQuestions.map((sq) => (
                          <div key={sq.id} className="rounded-lg border border-slate-200 bg-white p-3">
                            <p className="font-semibold text-slate-900">
                              [{sq.confidence}] {sq.question}
                            </p>
                            <p className="mt-1 text-slate-700">{sq.answer}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Manual CAPTCHA / OTP Resume Modal */}
      {resumingItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-handoff-title"
        >
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-amber-700">Human Handoff Resume</p>
                <h3 id="resume-handoff-title" className="text-base font-bold text-slate-900 mt-0.5">
                  {resumingItem.company} — {resumingItem.role}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResumingItem(null)}
                aria-label="Close resume modal"
                className="min-h-[44px] min-w-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              Confirm you have manually completed the {resumingItem.portalType} CAPTCHA or OTP verification in your browser session to finalize submission and log the completion timestamp.
            </p>

            <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
              <input
                type="checkbox"
                checked={captchaDone}
                onChange={(e) => setCaptchaDone(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-slate-300 text-indigo-600"
              />
              <span className="text-xs font-medium text-slate-800">
                I have manually completed the portal CAPTCHA / OTP verification and confirmed submission.
              </span>
            </label>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setResumingItem(null)}
                className="min-h-[44px] rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!captchaDone || submittingResume}
                onClick={handleCompleteHandoff}
                className="min-h-[44px] rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-600"
              >
                {submittingResume ? 'Logging...' : 'Mark Submitted'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
