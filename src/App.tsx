import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Briefcase,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Compass,
  Globe,
  LogIn,
  LogOut,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { auth } from './firebase';
import {
  logApprovalToFirestore,
  signInWithGooglePopup,
  signOutFirebase,
  submitRecruiterOptOutHashToFirestore,
  syncDiscoveredJobsToFirestore,
  syncWorkspaceToFirestore,
  wipeUserFirestoreData,
} from './services/firestoreSync';
import { COMPLIANCE_DISCLAIMER } from './constants/pricing';
import type {
  AppStatePayload,
  BackendJobSearchResponse,
  JobListing,
  MasterProfile,
  PortalType,
  PricingTierId,
  QAVault,
  QueueItem,
  WorkMode,
} from './types';
import { ProfileView } from './components/ProfileView';
import { DiscoverView, type BackendSearchFilters } from './components/DiscoverView';
import { QueueView } from './components/QueueView';
import { TrackerView } from './components/TrackerView';
import { PricingSettingsView } from './components/PricingSettingsView';
import { PrivacyOptOutView } from './components/PrivacyOptOutView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls';
import { addBreadcrumb, logAppError } from './utils/crashLogger';

type RoutePath =
  | '/profile'
  | '/discover'
  | '/queue'
  | '/tracker'
  | '/pricing'
  | '/privacy/opt-out'
  | '/diagnostics';

const OFFLINE_CACHE_KEY = 'careerpilot_offline_cache_v1';

function normalizeRoute(pathname: string): RoutePath {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/profile') return '/profile';
  if (clean === '/discover') return '/discover';
  if (clean === '/queue') return '/queue';
  if (clean === '/tracker') return '/tracker';
  if (clean === '/pricing') return '/pricing';
  if (clean === '/privacy/opt-out') return '/privacy/opt-out';
  if (clean === '/diagnostics') return '/diagnostics';
  return '/queue';
}

export default function App() {
  const [route, setRoute] = useState<RoutePath>(() =>
    typeof window !== 'undefined' ? normalizeRoute(window.location.pathname) : '/queue'
  );
  const [appState, setAppState] = useState<AppStatePayload | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveCooldown, setLiveCooldown] = useState<number>(0);
  const [pendingDirectApplyQueueId, setPendingDirectApplyQueueId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsubscribe();
  }, []);

  const navigate = useCallback((path: string) => {
    const next = normalizeRoute(path);
    setRoute(next);
    addBreadcrumb(`navigate:${next}`);
    if (typeof window !== 'undefined' && window.location.pathname !== next) {
      window.history.pushState({}, '', next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(normalizeRoute(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const syncState = useCallback((next: AppStatePayload) => {
    setAppState(next);
    setLiveCooldown(next.guardrails.cooldownSecondsRemaining);
    try {
      localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota issues
    }
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('Unable to load workspace state.');
      const data = (await res.json()) as AppStatePayload;
      syncState(data);
      setLoadError(null);
    } catch (err) {
      // Offline PWA fallback from localStorage cache
      try {
        const cached = localStorage.getItem(OFFLINE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as AppStatePayload;
          setAppState(parsed);
          setLiveCooldown(parsed.guardrails.cooldownSecondsRemaining);
          setLoadError(null);
          return;
        }
      } catch {
        // ignore cache error
      }
      logAppError('app.fetchState', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to connect to server.');
    } finally {
      setLoading(false);
    }
  }, [syncState]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Live 1-second tick for 60s cooldown countdown
  useEffect(() => {
    if (liveCooldown <= 0) return;
    const interval = setInterval(() => {
      setLiveCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [liveCooldown > 0]);

  const handleSaveProfile = async (
    nextProfile: MasterProfile,
    nextVault: QAVault,
    nextConsent: boolean
  ) => {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        masterProfile: nextProfile,
        qaVault: nextVault,
        consentAccepted: nextConsent,
      }),
    });
    const data = (await res.json()) as AppStatePayload & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Failed to save profile.');
    syncState(data);
    if (firebaseUser?.emailVerified) {
      await syncWorkspaceToFirestore(
        firebaseUser,
        data.masterProfile,
        data.qaVault,
        data.consentAccepted,
        data.selectedTier,
        []
      );
    }
  };

  const handleParseResume = async (payload: {
    resumeText?: string;
    fileBase64?: string;
    mimeType?: string;
    fileName?: string;
  }): Promise<{ extractedLinkedInUrl?: string | null }> => {
    const res = await fetch('/api/profile/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to parse resume with Gemini.');
    syncState(data.state);
    return { extractedLinkedInUrl: data.extractedLinkedInUrl ?? data.profile?.linkedinUrl ?? null };
  };

  const handleSearchBackendJobs = useCallback(
    async (filters: BackendSearchFilters): Promise<BackendJobSearchResponse> => {
      const res = await fetch('/api/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to search jobs in backend.');
      return data as BackendJobSearchResponse;
    },
    []
  );

  const handleDiscoverJobsFromResume = useCallback(
    async (
      filters: BackendSearchFilters
    ): Promise<BackendJobSearchResponse & { discoveredCount: number }> => {
      const res = await fetch('/api/jobs/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to discover resume-matched jobs in backend.');
      if (data.state) {
        syncState(data.state);
      }
      if (firebaseUser?.emailVerified && Array.isArray(data.jobs)) {
        void syncDiscoveredJobsToFirestore(firebaseUser, data.jobs as JobListing[]);
      }
      return data as BackendJobSearchResponse & { discoveredCount: number };
    },
    [firebaseUser, syncState]
  );

  const handleAnalyzeJob = async (payload: {
    jobId?: string;
    customJob?: {
      company?: string;
      role?: string;
      location?: string;
      salary?: string;
      workMode?: WorkMode;
      portalType?: PortalType;
      jobUrl?: string;
      recruiterName?: string;
      description?: string;
    };
    forceQueue?: boolean;
  }): Promise<{ queued: boolean; job: JobListing }> => {
    const res = await fetch('/api/jobs/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to analyze job.');
    syncState(data.state);
    return { queued: Boolean(data.queued), job: data.job };
  };

  const handleDirectApplyJob = async (
    jobId: string
  ): Promise<{ queueItem: QueueItem; job: JobListing }> => {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/direct-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to prepare direct application.');
    syncState(data.state);
    if (data.queueItem?.id) {
      setPendingDirectApplyQueueId(data.queueItem.id);
      navigate('/queue');
    }
    return { queueItem: data.queueItem as QueueItem, job: data.job as JobListing };
  };

  const handleToggleNotInterested = async (
    jobId: string,
    notInterested: boolean
  ): Promise<{ job: JobListing; notInterested: boolean }> => {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/not-interested`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notInterested }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update job interest flag.');
    syncState(data.state);
    return { job: data.job as JobListing, notInterested: Boolean(data.notInterested) };
  };

  const handleSaveToVault = async (
    queueId: string,
    answers: Array<{ id: string; question: string; answer: string; confidence: 'AMBER' | 'GREEN' }>
  ) => {
    const res = await fetch(`/api/queue/${encodeURIComponent(queueId)}/save-vault`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save to Q&A Vault.');
    syncState(data.state);
  };

  const handleApproveSubmit = async (
    queueId: string,
    payload: {
      outcome: 'submitted' | 'action_required';
      updatedAnswers: Array<{ id: string; answer: string }>;
      actionReason?: string;
    }
  ) => {
    const res = await fetch(`/api/queue/${encodeURIComponent(queueId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission blocked by compliance guardrails.');
    const prevQueueItem = appState?.queue.find((q) => q.id === queueId);
    syncState(data.state);
    if (firebaseUser?.emailVerified && prevQueueItem && data.application) {
      await logApprovalToFirestore(firebaseUser, prevQueueItem, data.application);
    }
  };

  const handleSkipQueue = async (queueId: string) => {
    const res = await fetch(`/api/queue/${encodeURIComponent(queueId)}/skip`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not skip item.');
    syncState(data.state);
  };

  const handleResumeActionRequired = async (trackerId: string) => {
    const res = await fetch(`/api/tracker/${encodeURIComponent(trackerId)}/resume`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not resume application.');
    syncState(data.state);
  };

  const handleSelectTier = async (tier: PricingTierId) => {
    const res = await fetch('/api/pricing-tier', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not switch pricing tier.');
    syncState(data);
  };

  const handleSubmitOptOut = async (linkedinUrl: string, reason?: string) => {
    const res = await fetch('/api/privacy/opt-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkedinUrl, reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not register opt-out.');
    syncState(data.state);
    try {
      await submitRecruiterOptOutHashToFirestore(linkedinUrl);
    } catch {
      // Server opt-out already persisted; Firestore public hash sync is best-effort if offline
    }
  };

  const handleDeleteAccount = async () => {
    if (firebaseUser?.emailVerified) {
      await wipeUserFirestoreData(firebaseUser);
    }
    const res = await fetch('/api/account', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not delete account data.');
    try {
      localStorage.removeItem(OFFLINE_CACHE_KEY);
    } catch {
      // ignore
    }
    syncState(data.state);
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    try {
      const user = await signInWithGooglePopup();
      if (appState && user.emailVerified) {
        await syncWorkspaceToFirestore(
          user,
          appState.masterProfile,
          appState.qaVault,
          appState.consentAccepted,
          appState.selectedTier,
          []
        );
      }
    } catch (err) {
      logAppError('auth.googleSignIn', err);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRestoreDemo = async () => {
    const res = await fetch('/api/account/restore-demo', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not restore demo workspace.');
    syncState(data.state);
  };

  const mainTabs: Array<{
    path: RoutePath;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { path: '/profile', label: 'Master Profile', shortLabel: 'Profile', icon: UserIcon },
    {
      path: '/discover',
      label: 'Job Discovery',
      shortLabel: 'Discover',
      icon: Compass,
    },
    {
      path: '/queue',
      label: 'Approval Queue',
      shortLabel: 'Queue',
      icon: CheckSquare,
      count: appState?.queue.length ?? 0,
    },
    {
      path: '/tracker',
      label: 'Applied Tracker',
      shortLabel: 'Tracker',
      icon: ClipboardCheck,
      count: appState?.tracker.filter((t) => t.status === 'action_required').length || undefined,
    },
    { path: '/pricing', label: 'PPP Pricing & Settings', shortLabel: 'Pricing', icon: Globe },
  ];

  const usedToday = appState?.guardrails.usedLast24h ?? 0;
  const dailyCap = appState?.guardrails.dailyCap ?? 25;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:left-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <button
            type="button"
            onClick={() => navigate('/queue')}
            className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-indigo-600 rounded-lg"
          >
            <span className="h-8 w-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shrink-0">
              <Briefcase className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              CareerPilot AI
            </span>
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Main navigation">
          {mainTabs.map((tab) => {
            const Icon = tab.icon;
            const active = route === tab.path;
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => navigate(tab.path)}
                aria-current={active ? 'page' : undefined}
                className={`w-full min-h-[44px] flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`}
                  />
                  {tab.label}
                </span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="font-mono text-xs font-semibold tabular-nums text-indigo-700">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => navigate('/privacy/opt-out')}
              aria-current={route === '/privacy/opt-out' ? 'page' : undefined}
              className={`w-full min-h-[44px] flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                route === '/privacy/opt-out'
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              Recruiter Opt-Out
            </button>
          </div>
        </nav>

        {/* Sidebar Guardrails Summary */}
        <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/70">
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span>24h Submission Cap</span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {usedToday}/{dailyCap}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-transform origin-left"
                style={{
                  transform: `scaleX(${Math.min(1, usedToday / Math.max(1, dailyCap))})`,
                }}
              />
            </div>
            <div className="flex items-center justify-between pt-1 text-slate-600">
              <span>Cooldown Pacing</span>
              <span
                className={`font-mono font-semibold tabular-nums ${
                  liveCooldown > 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {liveCooldown > 0 ? `${liveCooldown}s wait` : 'Ready'}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
            {firebaseUser ? (
              <button
                type="button"
                onClick={() => void signOutFirebase()}
                className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate">{firebaseUser.email || 'Sign Out'}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleSignIn}
                className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                {authBusy ? 'Signing in...' : 'Google Sign-In (Sync)'}
              </button>
            )}
          </div>

          <PWAInstallButton compact />
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Compact Sticky Top Header (Mobile + Desktop) */}
        <header className="sticky top-0 z-30 h-14 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/queue')}
            className="flex lg:hidden items-center gap-2 whitespace-nowrap shrink-0"
          >
            <span className="h-7 w-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-slate-900">
              CareerPilot AI
            </span>
          </button>

          <p className="hidden lg:block text-sm font-semibold text-slate-800 whitespace-nowrap truncate">
            {route === '/privacy/opt-out'
              ? 'Public Recruiter Opt-Out (/privacy/opt-out)'
              : route === '/diagnostics'
                ? 'Diagnostics & Self-Test (/diagnostics)'
                : mainTabs.find((t) => t.path === route)?.label}
          </p>

          {/* Live Daily Counter & 60s Cooldown Telemetry in Header */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-xs">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-slate-500 hidden sm:inline">Daily Cap:</span>
              <span
                className={`font-mono font-semibold tabular-nums ${
                  usedToday >= dailyCap ? 'text-rose-700' : 'text-slate-900'
                }`}
                title="Rolling 24-hour anti-spam submission cap"
              >
                {usedToday}/{dailyCap}
              </span>
            </div>

            <span className="h-4 w-px bg-slate-200" aria-hidden="true" />

            <div
              className="flex items-center gap-1.5 whitespace-nowrap"
              title="Minimum 60-second anti-spam cooldown between consecutive submissions"
            >
              <Clock
                className={`h-3.5 w-3.5 shrink-0 ${
                  liveCooldown > 0 ? 'text-amber-600' : 'text-emerald-600'
                }`}
                aria-hidden="true"
              />
              <span
                className={`font-mono font-semibold tabular-nums ${
                  liveCooldown > 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {liveCooldown > 0 ? `${liveCooldown}s` : 'Ready'}
              </span>
            </div>

            <div className="hidden sm:block lg:hidden">
              <PWAInstallButton compact />
            </div>
          </div>
        </header>

        {/* Scrollable Workspace Content */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {loading ? (
            <div className="space-y-4 animate-pulse" aria-busy="true">
              <div className="h-8 w-64 rounded-lg bg-slate-200" />
              <div className="h-4 w-96 max-w-full rounded bg-slate-200" />
              <div className="h-64 w-full rounded-2xl bg-slate-200/70" />
            </div>
          ) : loadError || !appState ? (
            <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center">
              <h2 className="text-base font-bold text-slate-900">Unable to load CareerPilot AI</h2>
              <p className="mt-1 text-sm text-slate-600">
                {loadError || 'Server connection interrupted.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  fetchState();
                }}
                className="mt-4 min-h-[44px] rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Retry Connection
              </button>
            </div>
          ) : (
            <>
              {route === '/profile' && (
                <ProfileView
                  profile={appState.masterProfile}
                  qaVault={appState.qaVault}
                  consentAccepted={appState.consentAccepted}
                  onSaveProfile={handleSaveProfile}
                  onParseResume={handleParseResume}
                  onNavigate={navigate}
                />
              )}

              {route === '/discover' && (
                <DiscoverView
                  jobs={appState.jobs}
                  queue={appState.queue}
                  masterProfile={appState.masterProfile}
                  onSearchBackendJobs={handleSearchBackendJobs}
                  onDiscoverJobsFromResume={handleDiscoverJobsFromResume}
                  onAnalyzeJob={handleAnalyzeJob}
                  onDirectApplyJob={handleDirectApplyJob}
                  onToggleNotInterested={handleToggleNotInterested}
                  onNavigate={navigate}
                />
              )}

              {route === '/queue' && (
                <QueueView
                  queue={appState.queue}
                  jobs={appState.jobs}
                  masterProfile={appState.masterProfile}
                  qaVault={appState.qaVault}
                  optOuts={appState.optOuts}
                  consentAccepted={appState.consentAccepted}
                  guardrails={appState.guardrails}
                  liveCooldown={liveCooldown}
                  autoOpenSandboxQueueId={pendingDirectApplyQueueId}
                  onConsumeAutoOpenSandbox={() => setPendingDirectApplyQueueId(null)}
                  onSaveToVault={handleSaveToVault}
                  onApproveSubmit={handleApproveSubmit}
                  onSkip={handleSkipQueue}
                  onNavigate={navigate}
                />
              )}

              {route === '/tracker' && (
                <TrackerView
                  tracker={appState.tracker}
                  guardrails={appState.guardrails}
                  liveCooldown={liveCooldown}
                  onResumeActionRequired={handleResumeActionRequired}
                />
              )}

              {route === '/pricing' && (
                <PricingSettingsView
                  selectedTier={appState.selectedTier}
                  onSelectTier={handleSelectTier}
                  onDeleteAccount={handleDeleteAccount}
                  onRestoreDemo={handleRestoreDemo}
                  onNavigate={navigate}
                  firebaseUserEmail={firebaseUser?.email}
                  authBusy={authBusy}
                  onGoogleSignIn={handleGoogleSignIn}
                  onSignOut={signOutFirebase}
                />
              )}

              {route === '/privacy/opt-out' && (
                <PrivacyOptOutView
                  optOuts={appState.optOuts}
                  onSubmitOptOut={handleSubmitOptOut}
                  onNavigate={navigate}
                />
              )}

              {route === '/diagnostics' && (
                <DiagnosticsView
                  masterProfile={appState.masterProfile}
                  firebaseUser={firebaseUser}
                  onNavigate={navigate}
                />
              )}
            </>
          )}
        </main>

        {/* Mandatory Disclaimer Footer on Every Page */}
        <footer className="mt-auto border-t border-slate-200 bg-white px-4 sm:px-6 lg:px-8 py-5 pb-24 lg:pb-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500">
            <p className="leading-relaxed max-w-3xl">{COMPLIANCE_DISCLAIMER}</p>
            <div className="flex items-center gap-4 shrink-0">
              <button
                type="button"
                onClick={() => navigate('/privacy/opt-out')}
                className="font-medium text-slate-700 hover:text-indigo-600 underline underline-offset-4 whitespace-nowrap"
              >
                Recruiter Opt-Out (/privacy/opt-out)
              </button>
            </div>
          </div>
        </footer>
      </div>

      {/* Mobile-First Fixed Bottom Tab Bar */}
      <nav
        aria-label="Mobile bottom navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-5 items-center h-16">
          {mainTabs.map((tab) => {
            const Icon = tab.icon;
            const active = route === tab.path;
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => navigate(tab.path)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center min-h-[48px] px-1 transition-colors ${
                  active ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 text-[10px] font-mono font-bold text-white flex items-center justify-center tabular-nums">
                      {tab.count}
                    </span>
                  )}
                </span>
                <span className="mt-1 text-[10px] font-semibold tracking-tight whitespace-nowrap">
                  {tab.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
