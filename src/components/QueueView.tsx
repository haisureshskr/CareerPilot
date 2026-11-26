import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Layers,
  Lock,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  GuardrailStatus,
  JobListing,
  MasterProfile,
  OptOutRecord,
  QAVault,
  QueueItem,
  ScreeningAnswer,
} from '../types';
import { isRecruiterOptedOut, sanitizeExternalUrl } from '../utils/security';
import { ParallelPortalRunnerModal } from './ParallelPortalRunnerModal';

interface QueueViewProps {
  queue: QueueItem[];
  jobs: JobListing[];
  masterProfile: MasterProfile;
  qaVault: QAVault;
  optOuts: OptOutRecord[];
  consentAccepted: boolean;
  guardrails: GuardrailStatus;
  liveCooldown: number;
  onSaveToVault: (
    queueId: string,
    answers: Array<{ id: string; question: string; answer: string; confidence: 'AMBER' | 'GREEN' }>
  ) => Promise<void>;
  onApproveSubmit: (
    queueId: string,
    payload: {
      outcome: 'submitted' | 'action_required';
      updatedAnswers: Array<{ id: string; answer: string }>;
      actionReason?: string;
    }
  ) => Promise<void>;
  onSkip: (queueId: string) => Promise<void>;
  onNavigate: (path: string) => void;
}

interface SandboxState {
  item: QueueItem;
  simulateCaptcha: boolean;
  step: 'ready' | 'filling' | 'captcha_handoff' | 'submitting' | 'done';
  otpCode: string;
  captchaChecked: boolean;
}

export const QueueView: React.FC<QueueViewProps> = ({
  queue,
  jobs,
  masterProfile,
  qaVault,
  optOuts,
  consentAccepted,
  guardrails,
  liveCooldown,
  onSaveToVault,
  onApproveSubmit,
  onSkip,
  onNavigate,
}) => {
  // Local inline edits per queue card answer id
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingVaultId, setSavingVaultId] = useState<string | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<QueueItem | null>(null);
  const [sandbox, setSandbox] = useState<SandboxState | null>(null);
  const [selectedParallelIds, setSelectedParallelIds] = useState<string[]>([]);
  const [parallelItems, setParallelItems] = useState<QueueItem[] | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const jobUrlByJobId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const j of jobs) {
      map[j.id] = j.jobUrl;
    }
    return map;
  }, [jobs]);

  const activeSelectedIds = useMemo(
    () => selectedParallelIds.filter((id) => queue.some((q) => q.id === id)),
    [selectedParallelIds, queue]
  );

  const toggleParallelSelection = (id: string) => {
    setSelectedParallelIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 4) {
        setToast({
          type: 'error',
          text: 'You can open up to 4 job portals in parallel at once to review each application carefully.',
        });
        return prev;
      }
      return [...prev, id];
    });
  };

  const launchParallelRunner = (targetItems: QueueItem[]) => {
    setToast(null);
    if (!consentAccepted) {
      setToast({
        type: 'error',
        text: 'Please accept the mandatory personal productivity responsibility checkbox in Profile before opening portals.',
      });
      return;
    }
    if (targetItems.length === 0) return;
    setParallelItems(targetItems.slice(0, 4));
  };

  const getAnswerValue = (sq: ScreeningAnswer) =>
    editedAnswers[sq.id] !== undefined ? editedAnswers[sq.id] : sq.answer;

  const handleCopyNote = async (item: QueueItem) => {
    try {
      await navigator.clipboard.writeText(item.linkedinNote);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((curr) => (curr === item.id ? null : curr)), 2200);
    } catch {
      setToast({ type: 'error', text: 'Clipboard copy unavailable in this browser context.' });
    }
  };

  const handleSaveVault = async (item: QueueItem) => {
    setSavingVaultId(item.id);
    setToast(null);
    try {
      const payload = item.screeningQuestions.map((sq) => ({
        id: sq.id,
        question: sq.question,
        answer: getAnswerValue(sq),
        confidence: sq.confidence,
      }));
      await onSaveToVault(item.id, payload);
      setToast({
        type: 'success',
        text: `Saved reviewed Amber screening answers for ${item.company} back to your Q&A Vault.`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save answers to Vault.',
      });
    } finally {
      setSavingVaultId(null);
    }
  };

  const handleSkipItem = async (item: QueueItem) => {
    setSkippingId(item.id);
    setToast(null);
    try {
      await onSkip(item.id);
      setToast({
        type: 'success',
        text: `Archived ${item.company} — ${item.role} as Skipped in Tracker.`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not skip item.',
      });
    } finally {
      setSkippingId(null);
    }
  };

  const openSandbox = (item: QueueItem) => {
    setToast(null);
    if (!consentAccepted) {
      setToast({
        type: 'error',
        text: 'Please accept the mandatory personal productivity responsibility checkbox in Profile before submitting.',
      });
      return;
    }
    if (guardrails.remainingToday <= 0) {
      setToast({
        type: 'error',
        text: `Daily anti-spam cap reached (${guardrails.dailyCap} submissions / 24h rolling window).`,
      });
      return;
    }
    if (liveCooldown > 0) {
      setToast({
        type: 'error',
        text: `Anti-spam 60-second cooldown active. Please wait ${liveCooldown}s before opening the next submission.`,
      });
      return;
    }

    setSandbox({
      item,
      simulateCaptcha: item.portalComplexity === 'Multi-Step',
      step: 'ready',
      otpCode: '',
      captchaChecked: false,
    });
  };

  const runSandboxFill = () => {
    if (!sandbox) return;
    setSandbox({ ...sandbox, step: 'filling' });
    setTimeout(() => {
      setSandbox((prev) => {
        if (!prev) return null;
        if (prev.simulateCaptcha) {
          return { ...prev, step: 'captcha_handoff' };
        }
        return { ...prev, step: 'submitting' };
      });
    }, 850);
  };

  React.useEffect(() => {
    if (!sandbox || sandbox.step !== 'submitting') return;
    let cancelled = false;
    const submitNow = async () => {
      try {
        const updatedAnswers = sandbox.item.screeningQuestions.map((sq) => ({
          id: sq.id,
          answer: getAnswerValue(sq),
        }));
        await onApproveSubmit(sandbox.item.id, {
          outcome: 'submitted',
          updatedAnswers,
        });
        if (!cancelled) {
          setSandbox((prev) => (prev ? { ...prev, step: 'done' } : null));
          setToast({
            type: 'success',
            text: `Application to ${sandbox.item.company} approved, submitted via sandbox, and logged with an audit receipt.`,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setSandbox(null);
          setToast({
            type: 'error',
            text: err instanceof Error ? err.message : 'Submission blocked by guardrails.',
          });
        }
      }
    };
    const timer = setTimeout(submitNow, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sandbox?.step]);

  const pauseForManualHandoff = async () => {
    if (!sandbox) return;
    try {
      const updatedAnswers = sandbox.item.screeningQuestions.map((sq) => ({
        id: sq.id,
        answer: getAnswerValue(sq),
      }));
      await onApproveSubmit(sandbox.item.id, {
        outcome: 'action_required',
        updatedAnswers,
        actionReason: `Paused at ${sandbox.item.portalType} CAPTCHA / OTP verification gate — awaiting human handoff.`,
      });
      const company = sandbox.item.company;
      setSandbox(null);
      setToast({
        type: 'success',
        text: `${company} paused at CAPTCHA/OTP handoff and moved to Tracker under Action Required.`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to pause application.',
      });
    }
  };

  // Compute preview tailored bullets mapped onto master profile
  const previewBulletsMap = useMemo(() => {
    if (!previewItem) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const d of previewItem.resumeDiffs) {
      map.set(d.before.trim(), d.after.trim());
    }
    return map;
  }, [previewItem]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-indigo-600">Human-in-the-Loop Approval Gate</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Pending Approval Queue
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Zero blind auto-apply. Review every truthful resume diff, inspect pinned Amber AI drafts, and explicitly approve each submission within your anti-spam limits.
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0">
          <div>
            <span className="text-slate-500">Pending</span>
            <p className="font-mono text-base font-bold text-slate-900 tabular-nums">
              {queue.length}
            </p>
          </div>
          <div className="h-8 w-px bg-slate-200" aria-hidden="true" />
          <div>
            <span className="text-slate-500">24h Cap</span>
            <p className="font-mono text-base font-bold text-slate-900 tabular-nums">
              {guardrails.usedLast24h}/{guardrails.dailyCap}
            </p>
          </div>
        </div>
      </div>

      {/* Consent Warning */}
      {!consentAccepted && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-sm text-amber-950">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              <strong>Submission Gate Locked:</strong> Accept the personal productivity responsibility checkbox on your Profile tab before approving applications.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/profile')}
            className="min-h-[40px] rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap shrink-0"
          >
            Go to Profile
          </button>
        </div>
      )}

      {/* Live Cooldown Notice */}
      {liveCooldown > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-950 flex items-center gap-2.5">
          <Clock className="h-4 w-4 text-indigo-600 shrink-0" aria-hidden="true" />
          <span>
            Anti-spam pacing active: next submission unlocks in{' '}
            <strong className="font-mono tabular-nums">{liveCooldown}s</strong> (60-second minimum gap enforced).
          </span>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
            toast.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss message"
            className="p-1 text-current opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Empty Queue State */}
      {queue.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-indigo-600" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold text-slate-900">Your Approval Queue is Clear</h2>
          <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
            Head to Job Discovery to score roles against your Master Profile or paste any Job Description URL/text for Gemini analysis.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/discover')}
            className="mt-5 min-h-[44px] rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            Explore Jobs & Analyze JD
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Parallel Multi-Portal Launcher Bar */}
          {queue.length >= 2 && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-700">
                  <Layers className="h-4 w-4" aria-hidden="true" />
                  Parallel Multi-Portal Execution
                </div>
                <p className="text-sm font-semibold text-slate-900">
                  Open multiple job portals in parallel for simultaneous resume upload & details autofill
                </p>
                <p className="text-xs text-slate-600">
                  Select up to 4 reviewed jobs below or launch the top {Math.min(3, queue.length)} portals side-by-side. Every portal still requires your final click and enforces 60s pacing.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedParallelIds(
                      activeSelectedIds.length === Math.min(4, queue.length)
                        ? []
                        : queue.slice(0, 4).map((q) => q.id)
                    )
                  }
                  className="min-h-[42px] rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 whitespace-nowrap"
                >
                  {activeSelectedIds.length === Math.min(4, queue.length)
                    ? 'Clear Selection'
                    : `Select All (${Math.min(4, queue.length)})`}
                </button>
                <button
                  type="button"
                  disabled={!consentAccepted}
                  onClick={() => {
                    const targets =
                      activeSelectedIds.length > 0
                        ? queue.filter((q) => activeSelectedIds.includes(q.id))
                        : queue.slice(0, Math.min(3, queue.length));
                    launchParallelRunner(targets);
                  }}
                  className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-600 transition-colors whitespace-nowrap"
                >
                  <Layers className="h-4 w-4" aria-hidden="true" />
                  {activeSelectedIds.length > 0
                    ? `Open ${activeSelectedIds.length} Portal${activeSelectedIds.length > 1 ? 's' : ''} in Parallel`
                    : `Open ${Math.min(3, queue.length)} Portals in Parallel`}
                </button>
              </div>
            </div>
          )}

          {queue.map((item) => {
            const recruiterBlocked = isRecruiterOptedOut(item.hiringTeam.linkedinUrl, optOuts);
            const safeRecruiterUrl = sanitizeExternalUrl(item.hiringTeam.linkedinUrl);
            const isSelectedForParallel = activeSelectedIds.includes(item.id);

            // Pin AMBER answers strictly above GREEN answers
            const orderedQuestions = [
              ...item.screeningQuestions.filter((q) => q.confidence === 'AMBER'),
              ...item.screeningQuestions.filter((q) => q.confidence === 'GREEN'),
            ];
            const amberCount = item.screeningQuestions.filter((q) => q.confidence === 'AMBER').length;
            const noteLength = item.linkedinNote.length;

            return (
              <article
                key={item.id}
                className={`rounded-2xl border bg-white overflow-hidden transition-colors ${
                  isSelectedForParallel
                    ? 'border-indigo-500 ring-1 ring-indigo-500'
                    : 'border-slate-200'
                }`}
              >
                {/* Card Top Summary */}
                <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <label className="inline-flex items-center gap-1.5 mr-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isSelectedForParallel}
                          onChange={() => toggleParallelSelection(item.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                          aria-label={`Select ${item.company} ${item.role} for parallel portal runner`}
                        />
                        <span className="font-semibold text-indigo-700">Parallel</span>
                      </label>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-slate-900">{item.company}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.portalType}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.portalComplexity}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.workMode}</span>
                    </div>
                    <h2 className="mt-1 text-xl font-bold text-slate-900 leading-snug">
                      {item.role}
                    </h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-600">
                      <span>{item.location}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {item.salary}
                      </span>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-baseline sm:items-end justify-between sm:justify-start gap-1 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <span className="font-mono text-2xl font-bold text-indigo-600 tabular-nums">
                      {item.matchScore}%
                    </span>
                    <span className="text-xs font-medium text-slate-500">ATS Match Score</span>
                  </div>
                </div>

                {/* Section A: Hiring Team / Job Poster Card */}
                <div className="p-5 sm:p-6 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-900">
                      Hiring Team / Job Poster
                    </h3>
                    <span className="text-xs font-medium text-slate-600">
                      30-Day Auto-Purge Active · {item.hiringTeam.autoPurgeDaysRemaining}d remaining
                    </span>
                  </div>

                  {recruiterBlocked ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 flex items-start gap-3">
                      <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="text-xs text-slate-700">
                        <p className="font-semibold text-slate-900">
                          Recruiter profile hidden per public privacy opt-out
                        </p>
                        <p className="mt-0.5 text-slate-600">
                          This individual opted out via /privacy/opt-out. Their name, LinkedIn link, and outreach note are suppressed.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{item.hiringTeam.name}</p>
                          <p className="text-xs text-slate-600">
                            {item.hiringTeam.title} · Posted {item.hiringTeam.postedAgo}
                          </p>
                        </div>
                        {safeRecruiterUrl && (
                          <a
                            href={safeRecruiterUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap self-start sm:self-auto"
                          >
                            View on LinkedIn
                            <ExternalLink className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                          </a>
                        )}
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-slate-700">
                            Personalized LinkedIn Connection Note
                          </span>
                          <span
                            className={`font-mono tabular-nums ${
                              noteLength <= 280 ? 'text-slate-500' : 'text-rose-600 font-semibold'
                            }`}
                          >
                            {noteLength} / 280 chars
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm text-slate-800 leading-relaxed">
                          {item.linkedinNote}
                        </p>
                        <div className="mt-2.5 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleCopyNote(item)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
                          >
                            {copiedId === item.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                Copied Note
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                Copy Note
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section B: Transparent Resume Diff */}
                <div className="p-5 sm:p-6 border-b border-slate-100">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Transparent Resume Diff ({item.resumeDiffs.length} tailored bullets)
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Truthfulness Lock verified — reordered and keyword-aligned strictly from your Master Profile.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors whitespace-nowrap self-start sm:self-auto"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      Preview Tailored Resume
                    </button>
                  </div>

                  <div className="mt-4 space-y-4">
                    {item.resumeDiffs.map((diff, index) => (
                      <div
                        key={diff.id}
                        className="border-t border-slate-100 pt-3.5 first:border-t-0 first:pt-0 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-800">
                            {index + 1}. {diff.experienceRef}
                          </span>
                          <span className="text-slate-500">{diff.rationale}</span>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 text-xs leading-relaxed">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-600">
                            <span className="block font-semibold text-slate-500 mb-1">Original</span>
                            {diff.before}
                          </div>
                          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 text-slate-900">
                            <span className="block font-semibold text-indigo-700 mb-1">
                              Tailored for {item.company}
                            </span>
                            {diff.after}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section C: Pre-Filled Screening Questions (AMBER pinned above GREEN) */}
                <div className="p-5 sm:p-6 border-b border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Pre-Filled Screening Questions
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {amberCount} Amber AI-drafted essay answer(s) pinned at top for mandatory human review; Green answers pulled directly from your Q&A Vault.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3.5">
                    {orderedQuestions.map((sq) => {
                      const isAmber = sq.confidence === 'AMBER';
                      const value = getAnswerValue(sq);
                      return (
                        <div
                          key={sq.id}
                          className={`rounded-xl border p-4 ${
                            isAmber
                              ? 'border-amber-300 bg-amber-50/60'
                              : 'border-emerald-200 bg-emerald-50/40'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span
                              className={`inline-flex items-center gap-1.5 font-semibold ${
                                isAmber ? 'text-amber-900' : 'text-emerald-900'
                              }`}
                            >
                              {isAmber ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              )}
                              {isAmber ? 'AMBER · Mandatory Review' : 'GREEN · Deterministic Fact'}
                            </span>
                            <span className="text-slate-600">{sq.sourceLabel}</span>
                          </div>

                          <label
                            htmlFor={`sq-input-${sq.id}`}
                            className="mt-2 block text-sm font-semibold text-slate-900"
                          >
                            {sq.question}
                          </label>

                          {isAmber ? (
                            <textarea
                              id={`sq-input-${sq.id}`}
                              rows={3}
                              value={value}
                              onChange={(e) =>
                                setEditedAnswers((prev) => ({
                                  ...prev,
                                  [sq.id]: e.target.value,
                                }))
                              }
                              className="mt-2 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm text-slate-900 leading-relaxed focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                          ) : (
                            <input
                              id={`sq-input-${sq.id}`}
                              type="text"
                              value={value}
                              onChange={(e) =>
                                setEditedAnswers((prev) => ({
                                  ...prev,
                                  [sq.id]: e.target.value,
                                }))
                              }
                              className="mt-2 w-full min-h-[42px] rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section D: Human Approval Action Bar */}
                <div className="p-4 sm:px-6 sm:py-4 bg-slate-50/70 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={savingVaultId === item.id}
                      onClick={() => handleSaveVault(item)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-60 transition-colors whitespace-nowrap"
                    >
                      <Save className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                      {savingVaultId === item.id ? 'Saving...' : 'Edit & Save to Vault'}
                    </button>

                    <button
                      type="button"
                      disabled={skippingId === item.id}
                      onClick={() => handleSkipItem(item)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 transition-colors whitespace-nowrap"
                    >
                      <SkipForward className="h-4 w-4" aria-hidden="true" />
                      Skip
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => openSandbox(item)}
                    disabled={!consentAccepted || guardrails.remainingToday <= 0 || liveCooldown > 0}
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-600 transition-colors whitespace-nowrap"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {liveCooldown > 0
                      ? `Cooldown (${liveCooldown}s)`
                      : guardrails.remainingToday <= 0
                        ? 'Daily Cap Reached'
                        : 'Approve & Submit'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Tailored Resume Preview Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tailored-resume-title"
        >
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <h3 id="tailored-resume-title" className="text-base font-bold text-slate-900">
                  Tailored Resume Preview · {previewItem.company}
                </h3>
                <p className="text-xs text-slate-500">
                  Highlighted bullets reflect verified Truthfulness Lock edits for {previewItem.role}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                aria-label="Close tailored resume preview"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-5 text-sm">
              <div className="border-b border-slate-200 pb-4">
                <h4 className="text-xl font-bold text-slate-900">
                  {masterProfile.fullName || 'Candidate Name'}
                </h4>
                <p className="text-xs text-slate-600 mt-1">
                  {[masterProfile.location, masterProfile.email, masterProfile.phone]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {masterProfile.summary && (
                  <p className="mt-3 text-slate-700 leading-relaxed">{masterProfile.summary}</p>
                )}
              </div>

              {masterProfile.skills.length > 0 && (
                <div>
                  <h5 className="text-xs font-bold text-slate-900 tracking-wide">SKILLS</h5>
                  <p className="mt-1 text-xs text-slate-700 leading-relaxed">
                    {masterProfile.skills.join(' · ')}
                  </p>
                </div>
              )}

              <div>
                <h5 className="text-xs font-bold text-slate-900 tracking-wide">EXPERIENCE</h5>
                <div className="mt-2.5 space-y-4">
                  {masterProfile.experience.map((exp) => (
                    <div key={exp.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-slate-900">
                          {exp.title} — {exp.company}
                        </p>
                        <span className="font-mono text-xs text-slate-500 tabular-nums">
                          {exp.startDate} – {exp.endDate}
                        </span>
                      </div>
                      <ul className="mt-1.5 space-y-1.5 list-disc pl-4 text-xs text-slate-700 leading-relaxed">
                        {exp.bullets.map((bullet, idx) => {
                          const tailored = previewBulletsMap.get(bullet.trim());
                          return (
                            <li
                              key={idx}
                              className={
                                tailored
                                  ? 'rounded-lg bg-indigo-50/80 px-2 py-1 text-slate-900 font-medium'
                                  : ''
                              }
                            >
                              {tailored || bullet}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {masterProfile.projects.length > 0 && (
                <div>
                  <h5 className="text-xs font-bold text-slate-900 tracking-wide">PROJECTS</h5>
                  <div className="mt-2 space-y-2.5">
                    {masterProfile.projects.map((proj) => {
                      const tailored = previewBulletsMap.get(proj.description.trim());
                      return (
                        <div key={proj.id} className="text-xs">
                          <p className="font-semibold text-slate-900">
                            {proj.name} ·{' '}
                            <span className="font-normal text-slate-500">
                              {proj.techStack.join(', ')}
                            </span>
                          </p>
                          <p
                            className={`mt-1 leading-relaxed ${
                              tailored
                                ? 'rounded-lg bg-indigo-50/80 px-2 py-1 text-slate-900 font-medium'
                                : 'text-slate-700'
                            }`}
                          >
                            {tailored || proj.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {masterProfile.education.length > 0 && (
                <div>
                  <h5 className="text-xs font-bold text-slate-900 tracking-wide">EDUCATION</h5>
                  <div className="mt-2 space-y-1.5 text-xs">
                    {masterProfile.education.map((edu) => (
                      <div key={edu.id} className="flex items-baseline justify-between gap-2">
                        <span className="text-slate-800">
                          <strong>{edu.institution}</strong> — {edu.degree}
                        </span>
                        <span className="font-mono text-slate-500 tabular-nums">
                          {edu.graduationYear}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Truthfulness Lock: 0 fabricated employers, titles, dates, or degrees
              </span>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="min-h-[42px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Submission Sandbox Modal (ATS Fill + CAPTCHA/OTP Manual Handoff) */}
      {sandbox && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sandbox-modal-title"
        >
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs font-medium text-indigo-600">
                  WebView Execution Sheet · {sandbox.item.portalType}
                </p>
                <h3 id="sandbox-modal-title" className="text-base font-bold text-slate-900">
                  {sandbox.item.company} — {sandbox.item.role}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSandbox(null)}
                aria-label="Close submission sandbox"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Guardrail Check Summary */}
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <div>
                  <p className="text-[11px] text-slate-500">Daily Cap</p>
                  <p className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                    {guardrails.usedLast24h}/{guardrails.dailyCap}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Cooldown</p>
                  <p className="font-mono text-xs font-bold text-emerald-700 tabular-nums">
                    Ready (60s)
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">HITL Gate</p>
                  <p className="font-mono text-xs font-bold text-indigo-700">Verified</p>
                </div>
              </div>

              {sandbox.step === 'ready' && (
                <div className="space-y-4">
                  <div className="space-y-2 text-xs text-slate-700">
                    <p className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-indigo-600 shrink-0" />
                      Attaching tailored resume ({sandbox.item.resumeDiffs.length} truthful bullet updates)
                    </p>
                    <p className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-indigo-600 shrink-0" />
                      Injecting {sandbox.item.screeningQuestions.length} reviewed answers via safe WebView JavaScript bridge
                    </p>
                    <p className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-indigo-600 shrink-0" />
                      Logging user_approved_at server timestamp · Zero credential scraping
                    </p>
                  </div>

                  {/* Interactive CAPTCHA / OTP Manual Handoff Simulation Toggle */}
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <label className="flex items-start justify-between gap-3 cursor-pointer">
                      <div>
                        <span className="text-xs font-bold text-amber-950 block">
                          Simulate CAPTCHA / OTP Manual Handoff
                        </span>
                        <span className="text-xs text-amber-900/80 block mt-0.5">
                          Test how CareerPilot AI safely pauses whenever an ATS challenges with a CAPTCHA or SMS/Email OTP instead of trying to bypass security controls.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={sandbox.simulateCaptcha}
                        onChange={(e) =>
                          setSandbox({ ...sandbox, simulateCaptcha: e.target.checked })
                        }
                        className="mt-0.5 h-5 w-5 rounded border-amber-400 text-indigo-600 focus:ring-indigo-600 shrink-0"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSandbox(null)}
                      className="min-h-[44px] rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={runSandboxFill}
                      className="min-h-[44px] rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      Start ATS Form Fill
                    </button>
                  </div>
                </div>
              )}

              {sandbox.step === 'filling' && (
                <div className="py-6 text-center space-y-3">
                  <div className="mx-auto h-10 w-10 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
                  <p className="text-sm font-semibold text-slate-900">
                    Populating {sandbox.item.portalType} application fields...
                  </p>
                  <p className="text-xs text-slate-500">
                    Mapping Master Profile, tailored bullets, and verified Q&A Vault answers.
                  </p>
                </div>
              )}

              {sandbox.step === 'captcha_handoff' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
                    <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-950">
                      <p className="font-bold">Human Intervention Required (CAPTCHA / OTP Gate)</p>
                      <p className="mt-1 leading-relaxed">
                        {sandbox.item.portalType} triggered a human verification challenge. CareerPilot AI never bypasses CAPTCHAs or OTPs—complete the check below or pause to finish later in Tracker.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sandbox.captchaChecked}
                        onChange={(e) =>
                          setSandbox({ ...sandbox, captchaChecked: e.target.checked })
                        }
                        className="h-5 w-5 rounded border-slate-300 text-indigo-600"
                      />
                      <span className="text-sm font-medium text-slate-900">
                        I am human (Simulated ATS CAPTCHA challenge)
                      </span>
                    </label>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Simulated 6-digit Portal Email/SMS OTP (enter any 6 digits, e.g. 482910)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={sandbox.otpCode}
                        onChange={(e) =>
                          setSandbox({
                            ...sandbox,
                            otpCode: e.target.value.replace(/\D/g, '').slice(0, 6),
                          })
                        }
                        placeholder="482910"
                        className="mt-1.5 w-full min-h-[42px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm tracking-widest text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={pauseForManualHandoff}
                      className="min-h-[44px] rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                    >
                      Pause as Action Required
                    </button>
                    <button
                      type="button"
                      disabled={!sandbox.captchaChecked || sandbox.otpCode.length < 4}
                      onClick={() => setSandbox({ ...sandbox, step: 'submitting' })}
                      className="min-h-[44px] rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-600"
                    >
                      Complete Handoff & Submit
                    </button>
                  </div>
                </div>
              )}

              {sandbox.step === 'submitting' && (
                <div className="py-6 text-center space-y-3">
                  <div className="mx-auto h-10 w-10 rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin" />
                  <p className="text-sm font-semibold text-slate-900">
                    Recording audit timestamp & submitting application...
                  </p>
                </div>
              )}

              {sandbox.step === 'done' && (
                <div className="py-4 text-center space-y-3">
                  <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" />
                  <h4 className="text-base font-bold text-slate-900">
                    Application Submitted & Audited
                  </h4>
                  <p className="text-xs text-slate-600 max-w-sm mx-auto">
                    Your 60-second anti-spam cooldown has started and the audit receipt has been saved to your Tracker.
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSandbox(null)}
                      className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      Continue Reviewing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSandbox(null);
                        onNavigate('/tracker');
                      }}
                      className="min-h-[44px] rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      View in Tracker
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Parallel Multi-Portal Application Runner Modal */}
      {parallelItems && parallelItems.length > 0 && (
        <ParallelPortalRunnerModal
          items={parallelItems}
          editedAnswers={editedAnswers}
          masterProfile={masterProfile}
          qaVault={qaVault}
          jobUrlByJobId={jobUrlByJobId}
          guardrails={guardrails}
          liveCooldown={liveCooldown}
          onApproveSubmit={onApproveSubmit}
          onClose={() => {
            setParallelItems(null);
            setSelectedParallelIds([]);
          }}
        />
      )}
    </div>
  );
};
