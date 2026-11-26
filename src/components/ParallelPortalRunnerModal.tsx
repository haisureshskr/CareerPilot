import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileUp,
  Columns2,
  Layers,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  GuardrailStatus,
  MasterProfile,
  QAVault,
  QueueItem,
  ScreeningAnswer,
} from '../types';
import { sanitizeExternalUrl } from '../utils/security';

interface ParallelPortalRunnerModalProps {
  items: QueueItem[];
  editedAnswers: Record<string, string>;
  masterProfile: MasterProfile;
  qaVault: QAVault;
  jobUrlByJobId: Record<string, string>;
  guardrails: GuardrailStatus;
  liveCooldown: number;
  onApproveSubmit: (
    queueId: string,
    payload: {
      outcome: 'submitted' | 'action_required';
      updatedAnswers: Array<{ id: string; answer: string }>;
      actionReason?: string;
    }
  ) => Promise<void>;
  onClose: () => void;
}

type PortalStage =
  | 'opening'
  | 'uploading_resume'
  | 'filling_details'
  | 'captcha_handoff'
  | 'ready_to_submit'
  | 'submitting'
  | 'submitted'
  | 'paused';

interface PortalFieldPreview {
  id: string;
  label: string;
  value: string;
  source: 'Profile' | 'Vault' | 'AI Draft';
}

interface PortalSessionState {
  item: QueueItem;
  portalUrl: string;
  resumeFileName: string;
  resumeContent: string;
  resumeSizeKb: string;
  stage: PortalStage;
  uploadProgress: number;
  filledFieldCount: number;
  fields: PortalFieldPreview[];
  simulateCaptcha: boolean;
  captchaChecked: boolean;
  otpCode: string;
  error: string | null;
}

function buildTailoredResumeText(profile: MasterProfile, item: QueueItem): string {
  const diffLookup = new Map<string, string>();
  for (const d of item.resumeDiffs) {
    diffLookup.set(d.before.trim(), d.after.trim());
  }

  const lines: string[] = [
    `${profile.fullName || 'Candidate'} — Tailored Resume for ${item.company} (${item.role})`,
    [profile.headline, profile.location, profile.email, profile.phone].filter(Boolean).join(' | '),
    '',
    'SUMMARY',
    profile.summary || '',
    '',
    'SKILLS',
    profile.skills.join(', '),
    '',
    'EXPERIENCE',
  ];

  for (const exp of profile.experience) {
    lines.push(`${exp.title} — ${exp.company} (${exp.startDate} - ${exp.endDate})`);
    for (const bullet of exp.bullets) {
      const tailored = diffLookup.get(bullet.trim());
      lines.push(`  • ${tailored || bullet}`);
    }
    lines.push('');
  }

  if (profile.projects.length > 0) {
    lines.push('PROJECTS');
    for (const proj of profile.projects) {
      const tailored = diffLookup.get(proj.description.trim());
      lines.push(`${proj.name} [${proj.techStack.join(', ')}]: ${tailored || proj.description}`);
    }
    lines.push('');
  }

  if (profile.education.length > 0) {
    lines.push('EDUCATION');
    for (const edu of profile.education) {
      lines.push(`${edu.institution} — ${edu.degree} (${edu.graduationYear})`);
    }
  }

  return lines.join('\n');
}

function makeResumeFileName(fullName: string, company: string): string {
  const cleanName = (fullName || 'Candidate').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const cleanCompany = company.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${cleanName}_${cleanCompany}_Tailored_Resume.txt`;
}

export const ParallelPortalRunnerModal: React.FC<ParallelPortalRunnerModalProps> = ({
  items,
  editedAnswers,
  masterProfile,
  qaVault,
  jobUrlByJobId,
  guardrails,
  liveCooldown,
  onApproveSubmit,
  onClose,
}) => {
  const [layoutMode, setLayoutMode] = useState<'grid' | 'tabs'>('grid');
  const [activeTabId, setActiveTabId] = useState<string>(items[0]?.id ?? '');
  const timersRef = useRef<number[]>([]);

  const resolveAnswer = (sq: ScreeningAnswer) =>
    editedAnswers[sq.id] !== undefined ? editedAnswers[sq.id] : sq.answer;

  const initialSessions = useMemo<PortalSessionState[]>(() => {
    return items.map((item) => {
      const rawUrl = item.jobUrl || jobUrlByJobId[item.jobId] || '';
      const portalUrl = sanitizeExternalUrl(rawUrl) || `https://careers.example.com/${item.jobId}`;
      const resumeContent = buildTailoredResumeText(masterProfile, item);
      const resumeFileName = makeResumeFileName(masterProfile.fullName, item.company);
      const sizeKb = Math.max(1.2, new Blob([resumeContent]).size / 1024).toFixed(1);

      const fields: PortalFieldPreview[] = [
        { id: `${item.id}-f-name`, label: 'Full Name', value: masterProfile.fullName || '—', source: 'Profile' },
        { id: `${item.id}-f-email`, label: 'Email Address', value: masterProfile.email || '—', source: 'Profile' },
        { id: `${item.id}-f-phone`, label: 'Phone Number', value: masterProfile.phone || '—', source: 'Profile' },
        { id: `${item.id}-f-loc`, label: 'Current Location', value: masterProfile.location || '—', source: 'Profile' },
        {
          id: `${item.id}-f-li`,
          label: 'LinkedIn Profile',
          value: qaVault.linkedinUrl || '—',
          source: 'Vault',
        },
        ...item.screeningQuestions.map((sq) => ({
          id: `${item.id}-sq-${sq.id}`,
          label: sq.question,
          value: resolveAnswer(sq) || '—',
          source: (sq.confidence === 'AMBER' ? 'AI Draft' : 'Vault') as 'AI Draft' | 'Vault',
        })),
      ];

      return {
        item,
        portalUrl,
        resumeFileName,
        resumeContent,
        resumeSizeKb: `${sizeKb} KB`,
        stage: 'opening',
        uploadProgress: 0,
        filledFieldCount: 0,
        fields,
        simulateCaptcha: item.portalComplexity === 'Multi-Step',
        captchaChecked: false,
        otpCode: '',
        error: null,
      };
    });
  }, [items]);

  const [sessions, setSessions] = useState<PortalSessionState[]>(initialSessions);

  const clearAllTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  // Run all selected portals concurrently: open portal -> upload tailored resume -> autofill details
  const startParallelPipeline = (targetIds?: Set<string>) => {
    clearAllTimers();

    setSessions((prev) =>
      prev.map((s) => {
        if (targetIds && !targetIds.has(s.item.id)) return s;
        if (s.stage === 'submitted' || s.stage === 'paused') return s;
        return {
          ...s,
          stage: 'opening',
          uploadProgress: 0,
          filledFieldCount: 0,
          error: null,
          captchaChecked: false,
        };
      })
    );

    sessions.forEach((session, idx) => {
      if (targetIds && !targetIds.has(session.item.id)) return;
      if (session.stage === 'submitted' || session.stage === 'paused') return;

      const id = session.item.id;
      // Slight natural stagger per portal (80ms) while genuinely running all portals in parallel
      const jitter = idx * 80;

      // Step 1: Begin tailored resume upload
      timersRef.current.push(
        window.setTimeout(() => {
          setSessions((prev) =>
            prev.map((s) =>
              s.item.id === id && s.stage === 'opening'
                ? { ...s, stage: 'uploading_resume', uploadProgress: 35 }
                : s
            )
          );
        }, 320 + jitter)
      );

      // Step 2: Upload progress 80%
      timersRef.current.push(
        window.setTimeout(() => {
          setSessions((prev) =>
            prev.map((s) =>
              s.item.id === id && s.stage === 'uploading_resume'
                ? { ...s, uploadProgress: 82 }
                : s
            )
          );
        }, 720 + jitter)
      );

      // Step 3: Upload 100% -> begin filling candidate details & screening Q&A
      timersRef.current.push(
        window.setTimeout(() => {
          setSessions((prev) =>
            prev.map((s) =>
              s.item.id === id && s.stage === 'uploading_resume'
                ? {
                    ...s,
                    stage: 'filling_details',
                    uploadProgress: 100,
                    filledFieldCount: Math.min(2, s.fields.length),
                  }
                : s
            )
          );
        }, 1100 + jitter)
      );

      // Step 4: Fill remaining details incrementally in parallel
      const totalFields = session.fields.length;
      for (let f = 3; f <= totalFields; f++) {
        timersRef.current.push(
          window.setTimeout(() => {
            setSessions((prev) =>
              prev.map((s) =>
                s.item.id === id && s.stage === 'filling_details'
                  ? { ...s, filledFieldCount: f }
                  : s
              )
            );
          }, 1100 + jitter + (f - 2) * 180)
        );
      }

      // Step 5: Complete autofill -> ready for human final submit (or CAPTCHA gate)
      const finishTime = 1280 + jitter + Math.max(1, totalFields - 2) * 180;
      timersRef.current.push(
        window.setTimeout(() => {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.item.id !== id || s.stage !== 'filling_details') return s;
              return {
                ...s,
                filledFieldCount: s.fields.length,
                stage: s.simulateCaptcha ? 'captcha_handoff' : 'ready_to_submit',
              };
            })
          );
        }, finishTime)
      );
    });
  };

  useEffect(() => {
    startParallelPipeline();
    return () => clearAllTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownloadTailoredResume = (session: PortalSessionState) => {
    const blob = new Blob([session.resumeContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = session.resumeFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleSubmitPortal = async (session: PortalSessionState) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.item.id === session.item.id ? { ...s, stage: 'submitting', error: null } : s
      )
    );

    try {
      const updatedAnswers = session.item.screeningQuestions.map((sq) => ({
        id: sq.id,
        answer: resolveAnswer(sq),
      }));

      await onApproveSubmit(session.item.id, {
        outcome: 'submitted',
        updatedAnswers,
      });

      setSessions((prev) =>
        prev.map((s) =>
          s.item.id === session.item.id ? { ...s, stage: 'submitted', error: null } : s
        )
      );
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) =>
          s.item.id === session.item.id
            ? {
                ...s,
                stage: s.simulateCaptcha && !s.captchaChecked ? 'captcha_handoff' : 'ready_to_submit',
                error: err instanceof Error ? err.message : 'Submission blocked by guardrails.',
              }
            : s
        )
      );
    }
  };

  const handlePausePortal = async (session: PortalSessionState) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.item.id === session.item.id ? { ...s, stage: 'submitting', error: null } : s
      )
    );

    try {
      const updatedAnswers = session.item.screeningQuestions.map((sq) => ({
        id: sq.id,
        answer: resolveAnswer(sq),
      }));

      await onApproveSubmit(session.item.id, {
        outcome: 'action_required',
        updatedAnswers,
        actionReason: `Paused at ${session.item.portalType} CAPTCHA / OTP gate during parallel portal run — awaiting human handoff.`,
      });

      setSessions((prev) =>
        prev.map((s) =>
          s.item.id === session.item.id ? { ...s, stage: 'paused', error: null } : s
        )
      );
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) =>
          s.item.id === session.item.id
            ? {
                ...s,
                stage: 'captcha_handoff',
                error: err instanceof Error ? err.message : 'Could not pause portal.',
              }
            : s
        )
      );
    }
  };

  const readyOrDoneCount = sessions.filter((s) =>
    ['ready_to_submit', 'captcha_handoff', 'submitted', 'paused'].includes(s.stage)
  ).length;
  const submittedCount = sessions.filter((s) => s.stage === 'submitted').length;

  const visibleSessions =
    layoutMode === 'tabs'
      ? sessions.filter((s) => s.item.id === activeTabId)
      : sessions;

  const stageLabel = (stage: PortalStage) => {
    switch (stage) {
      case 'opening':
        return 'Opening Portal...';
      case 'uploading_resume':
        return 'Uploading Tailored Resume';
      case 'filling_details':
        return 'Auto-Filling Details';
      case 'captcha_handoff':
        return 'CAPTCHA / OTP Gate';
      case 'ready_to_submit':
        return 'Pre-Filled · Ready to Submit';
      case 'submitting':
        return 'Submitting...';
      case 'submitted':
        return 'Submitted & Logged';
      case 'paused':
        return 'Paused (Action Required)';
    }
  };

  const stageBadgeClass = (stage: PortalStage) => {
    switch (stage) {
      case 'submitted':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'ready_to_submit':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'captcha_handoff':
      case 'paused':
        return 'bg-amber-100 text-amber-900 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/70 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="parallel-runner-title"
    >
      <div className="w-full max-w-6xl max-h-[94vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-slate-50 border border-slate-200 shadow-2xl overflow-hidden">
        {/* Top Control Header */}
        <div className="bg-white border-b border-slate-200 px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-indigo-700">
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                Parallel Multi-Portal Runner
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-mono text-slate-600 tabular-nums">
                {readyOrDoneCount}/{sessions.length} Portals Prepared
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-mono text-emerald-700 font-semibold tabular-nums">
                {submittedCount} Submitted
              </span>
            </div>
            <h2
              id="parallel-runner-title"
              className="mt-1 text-base sm:text-lg font-bold text-slate-900 truncate"
            >
              Simultaneous Resume Upload & Details Fill ({sessions.length} Job Portals)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Live Anti-Spam Cooldown & Daily Cap Telemetry */}
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                Cap {guardrails.usedLast24h}/{guardrails.dailyCap}
              </span>
              <span className="h-3.5 w-px bg-slate-300" aria-hidden="true" />
              <span
                className={`inline-flex items-center gap-1 font-mono font-semibold tabular-nums ${
                  liveCooldown > 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {liveCooldown > 0 ? `${liveCooldown}s pacing` : 'Ready'}
              </span>
            </div>

            {/* Layout Switcher (Side-by-Side Grid vs Focused Portal Tabs) */}
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLayoutMode('grid')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
                  layoutMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
                Side-by-Side
              </button>
              <button
                type="button"
                onClick={() => {
                  setLayoutMode('tabs');
                  if (!activeTabId && sessions[0]) setActiveTabId(sessions[0].item.id);
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
                  layoutMode === 'tabs'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                Tabs
              </button>
            </div>

            <button
              type="button"
              onClick={() => startParallelPipeline()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Re-run parallel upload and autofill for unfinished portals"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Re-Fill
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close parallel portal runner"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Compliance Notice Bar */}
        <div className="bg-indigo-50/70 border-b border-indigo-100 px-5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-indigo-950">
          <span>
            <strong>Parallel Prep + Human Submit:</strong> All {sessions.length} portals upload your tailored resume and fill details concurrently, then pause for your final click per portal (enforcing 60s anti-spam pacing between submissions).
          </span>
          {liveCooldown > 0 && (
            <span className="font-mono font-semibold text-amber-800 whitespace-nowrap shrink-0">
              Next submit unlocks in {liveCooldown}s
            </span>
          )}
        </div>

        {/* Portal Tab Strip (shown in Tabs mode or quick-jump summary) */}
        {layoutMode === 'tabs' && (
          <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex items-center gap-2 overflow-x-auto">
            {sessions.map((s) => {
              const isActive = s.item.id === activeTabId;
              return (
                <button
                  key={s.item.id}
                  type="button"
                  onClick={() => setActiveTabId(s.item.id)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{s.item.company}</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    ({s.item.portalType})
                  </span>
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${stageBadgeClass(
                      s.stage
                    )}`}
                  >
                    {s.stage === 'submitted'
                      ? 'Done'
                      : s.stage === 'ready_to_submit'
                        ? 'Ready'
                        : s.stage === 'captcha_handoff'
                          ? 'CAPTCHA'
                          : s.stage === 'paused'
                            ? 'Paused'
                            : `${s.uploadProgress}%`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Parallel Portal Lanes Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div
            className={
              layoutMode === 'grid'
                ? `grid grid-cols-1 ${
                    sessions.length === 2
                      ? 'lg:grid-cols-2'
                      : sessions.length >= 3
                        ? 'md:grid-cols-2 xl:grid-cols-3'
                        : ''
                  } gap-4`
                : 'max-w-3xl mx-auto'
            }
          >
            {visibleSessions.map((session) => {
              const isBusy =
                session.stage === 'opening' ||
                session.stage === 'uploading_resume' ||
                session.stage === 'filling_details' ||
                session.stage === 'submitting';

              const canConfirmSubmit =
                (session.stage === 'ready_to_submit' ||
                  (session.stage === 'captcha_handoff' &&
                    session.captchaChecked &&
                    session.otpCode.trim().length >= 6)) &&
                liveCooldown <= 0 &&
                guardrails.remainingToday > 0;

              return (
                <section
                  key={session.item.id}
                  className="flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs"
                >
                  {/* Simulated Browser / Portal Chrome Header */}
                  <div className="bg-slate-900 text-white px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[11px] text-slate-300">
                          <span className="font-semibold text-indigo-300">
                            {session.item.portalType}
                          </span>
                          <span>·</span>
                          <span>{session.item.portalComplexity}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{session.item.matchScore}% ATS</span>
                        </div>
                        <h3 className="text-sm font-bold text-white truncate mt-0.5">
                          {session.item.company} — {session.item.role}
                        </h3>
                      </div>

                      <a
                        href={session.portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                        title="Open live job portal in a browser tab"
                      >
                        Portal
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>

                    {/* Portal URL Bar + Live Stage Badge */}
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/90 px-2.5 py-1.5 text-[11px]">
                      <span className="font-mono text-slate-300 truncate">{session.portalUrl}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap shrink-0 ${stageBadgeClass(
                          session.stage
                        )}`}
                      >
                        {isBusy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                        {stageLabel(session.stage)}
                      </span>
                    </div>
                  </div>

                  {/* Lane Body: 1) Tailored Resume Upload + 2) Auto-Filled Candidate & Q&A Fields */}
                  <div className="flex-1 p-4 space-y-4">
                    {/* Step 1: Tailored Resume Upload Panel */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                          <FileUp className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                          Tailored Resume Upload
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-indigo-700 tabular-nums">
                          {session.uploadProgress}%
                        </span>
                      </div>

                      <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            session.uploadProgress === 100 ? 'bg-emerald-600' : 'bg-indigo-600'
                          }`}
                          style={{ width: `${session.uploadProgress}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="min-w-0">
                          <p className="font-mono text-slate-800 font-medium truncate">
                            {session.resumeFileName}
                          </p>
                          <p className="text-slate-500">
                            {session.resumeSizeKb} · {session.item.resumeDiffs.length} truthful bullet updates
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDownloadTailoredResume(session)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                        >
                          <Download className="h-3 w-3" aria-hidden="true" />
                          File
                        </button>
                      </div>
                    </div>

                    {/* Step 2: Candidate Details & Screening Fields Auto-Fill Stream */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                          <UserCheck className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                          Details & Screening Autofill
                        </span>
                        <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                          {session.filledFieldCount}/{session.fields.length} fields
                        </span>
                      </div>

                      <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                        {session.fields.map((field, fIdx) => {
                          const isFilled = fIdx < session.filledFieldCount;
                          return (
                            <div
                              key={field.id}
                              className={`px-3 py-2 text-xs transition-colors ${
                                isFilled ? 'bg-white' : 'bg-slate-50/70 opacity-60'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-700 truncate">
                                  {field.label}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold whitespace-nowrap shrink-0 ${
                                    isFilled
                                      ? field.source === 'AI Draft'
                                        ? 'text-amber-700'
                                        : 'text-emerald-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {isFilled ? `✓ ${field.source}` : 'Pending...'}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[11px] text-slate-600 line-clamp-2">
                                {isFilled ? field.value : 'Waiting for field injection...'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Per-Portal CAPTCHA / OTP Handoff Toggle & Challenge Box */}
                    {session.stage !== 'submitted' && session.stage !== 'paused' && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2.5">
                        <label className="flex items-center justify-between gap-2 cursor-pointer text-xs">
                          <span className="font-semibold text-amber-950">
                            Simulate CAPTCHA / OTP Handoff
                          </span>
                          <input
                            type="checkbox"
                            checked={session.simulateCaptcha}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSessions((prev) =>
                                prev.map((s) => {
                                  if (s.item.id !== session.item.id) return s;
                                  let nextStage = s.stage;
                                  if (checked && s.stage === 'ready_to_submit') {
                                    nextStage = 'captcha_handoff';
                                  } else if (!checked && s.stage === 'captcha_handoff') {
                                    nextStage = 'ready_to_submit';
                                  }
                                  return {
                                    ...s,
                                    simulateCaptcha: checked,
                                    stage: nextStage,
                                    captchaChecked: false,
                                  };
                                })
                              );
                            }}
                            className="h-4 w-4 rounded border-amber-400 text-indigo-600 shrink-0"
                          />
                        </label>

                        {session.stage === 'captcha_handoff' && (
                          <div className="space-y-2 pt-2 border-t border-amber-200/80">
                            <p className="flex items-start gap-1.5 text-[11px] text-amber-950">
                              <ShieldAlert className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                              Complete human verification or pause this portal while other portals proceed.
                            </p>
                            <label className="flex items-center gap-2 text-xs text-slate-900 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={session.captchaChecked}
                                onChange={(e) =>
                                  setSessions((prev) =>
                                    prev.map((s) =>
                                      s.item.id === session.item.id
                                        ? { ...s, captchaChecked: e.target.checked }
                                        : s
                                    )
                                  )
                                }
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                              />
                              I am human (CAPTCHA verified)
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              placeholder="Enter 6-digit OTP (e.g. 482910)"
                              value={session.otpCode}
                              onChange={(e) =>
                                setSessions((prev) =>
                                  prev.map((s) =>
                                    s.item.id === session.item.id
                                      ? { ...s, otpCode: e.target.value.replace(/\D/g, '') }
                                      : s
                                  )
                                )
                              }
                              className="w-full min-h-[38px] rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {session.error && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                        {session.error}
                      </div>
                    )}
                  </div>

                  {/* Per-Portal Bottom Human Confirmation Action */}
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between gap-2">
                    {session.stage === 'submitted' ? (
                      <div className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700 py-1.5">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Approved, Submitted & Audited
                      </div>
                    ) : session.stage === 'paused' ? (
                      <div className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-amber-800 py-1.5">
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                        Paused in Tracker (Action Required)
                      </div>
                    ) : (
                      <>
                        {session.stage === 'captcha_handoff' && (
                          <button
                            type="button"
                            onClick={() => void handlePausePortal(session)}
                            className="min-h-[40px] rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50 whitespace-nowrap"
                          >
                            Pause to Tracker
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!canConfirmSubmit}
                          onClick={() => void handleSubmitPortal(session)}
                          className="flex-1 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-600 transition-colors"
                        >
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                          {isBusy
                            ? stageLabel(session.stage)
                            : guardrails.remainingToday <= 0
                              ? 'Daily Cap Reached'
                              : liveCooldown > 0
                                ? `Pre-Filled · Submit in ${liveCooldown}s`
                                : session.stage === 'captcha_handoff'
                                  ? 'Complete CAPTCHA/OTP to Submit'
                                  : 'Confirm & Submit'}
                        </button>
                      </>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="bg-white border-t border-slate-200 px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            Tailored resumes are generated strictly from your Master Profile (Truthfulness Lock active).
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 self-end sm:self-auto"
          >
            Done & Return to Queue
          </button>
        </div>
      </div>
    </div>
  );
};
