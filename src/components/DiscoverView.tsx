import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Ban,
  ExternalLink,
  FileCheck2,
  FileText,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type {
  BackendJobSearchResponse,
  CountryFilter,
  GroundingSource,
  JobListing,
  MasterProfile,
  PortalType,
  QueueItem,
  WorkMode,
} from '../types';
import { sanitizeExternalUrl } from '../utils/security';

export interface BackendSearchFilters {
  query: string;
  country: CountryFilter;
  market: 'All' | 'India' | 'Global';
  workMode: 'All' | WorkMode;
  portalType: 'All' | PortalType;
  minMatch: number;
  notInterestedMode?: 'hide' | 'only' | 'all';
}

interface DiscoverViewProps {
  jobs: JobListing[];
  queue: QueueItem[];
  masterProfile: MasterProfile;
  onSearchBackendJobs: (filters: BackendSearchFilters) => Promise<BackendJobSearchResponse>;
  onDiscoverJobsFromResume: (
    filters: BackendSearchFilters
  ) => Promise<BackendJobSearchResponse & { discoveredCount: number }>;
  onAnalyzeJob: (payload: {
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
  }) => Promise<{ queued: boolean; job: JobListing }>;
  onDirectApplyJob: (jobId: string) => Promise<{ queueItem: QueueItem; job: JobListing }>;
  onToggleNotInterested: (
    jobId: string,
    notInterested: boolean
  ) => Promise<{ job: JobListing; notInterested: boolean }>;
  onNavigate: (path: string) => void;
}

const PORTALS: Array<'All' | PortalType> = [
  'All',
  'Greenhouse',
  'Lever',
  'Ashby',
  'Workday',
  'Naukri',
];
const WORK_MODES: Array<'All' | WorkMode> = ['All', 'Remote', 'Hybrid', 'On-site'];
const MARKETS: Array<'India'> = [
  // Other regions commented out — focusing on India first
  // 'All',
  'India',
  // 'Global',
];
const COUNTRIES: CountryFilter[] = [
  // Other regions commented out — focusing on India first
  // 'All',
  'India',
  // 'United States',
  // 'United Kingdom',
  // 'Canada',
  // 'Germany',
  // 'Singapore',
  // 'Australia',
  // 'United Arab Emirates',
  // 'Netherlands',
  // 'Ireland',
];

export const DiscoverView: React.FC<DiscoverViewProps> = ({
  jobs,
  queue,
  masterProfile,
  onSearchBackendJobs,
  onDiscoverJobsFromResume,
  onAnalyzeJob,
  onDirectApplyJob,
  onToggleNotInterested,
  onNavigate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState<CountryFilter>('India');
  const [marketFilter, setMarketFilter] = useState<'All' | 'India' | 'Global'>('India');
  const [workModeFilter, setWorkModeFilter] = useState<'All' | WorkMode>('All');
  const [portalFilter, setPortalFilter] = useState<'All' | PortalType>('All');
  const [minMatch, setMinMatch] = useState<number>(0);
  const [notInterestedMode, setNotInterestedMode] = useState<'hide' | 'only'>('hide');

  // Backend search state — all searching/filtering runs on the Express backend
  const [backendJobs, setBackendJobs] = useState<JobListing[]>(jobs);
  const [totalCatalogCount, setTotalCatalogCount] = useState<number>(jobs.length);
  const [notInterestedCount, setNotInterestedCount] = useState<number>(
    jobs.filter((j) => Boolean(j.notInterested)).length
  );
  const [groundingSources, setGroundingSources] = useState<GroundingSource[]>([]);
  const [lastDiscoveredAt, setLastDiscoveredAt] = useState<string | null>(null);
  const [resumeSummary, setResumeSummary] = useState<
    BackendJobSearchResponse['resumeProfileSummary'] | null
  >(null);
  const [searchingBackend, setSearchingBackend] = useState(false);
  const [discoveringLive, setDiscoveringLive] = useState(false);

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customCompany, setCustomCompany] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [customSalary, setCustomSalary] = useState('');
  const [customWorkMode, setCustomWorkMode] = useState<WorkMode>('Remote');
  const [customPortal, setCustomPortal] = useState<PortalType>('Greenhouse');
  const [customUrl, setCustomUrl] = useState('');
  const [customRecruiterName, setCustomRecruiterName] = useState('');
  const [customDescription, setCustomDescription] = useState('');

  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [directApplyingId, setDirectApplyingId] = useState<string | null>(null);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    undoJobId?: string;
    showQueueLink?: boolean;
  } | null>(null);
  const requestSeqRef = useRef(0);

  const queuedItemByJobId = useMemo(() => {
    const map = new Map<string, QueueItem>();
    for (const q of queue) {
      map.set(q.jobId, q);
    }
    return map;
  }, [queue]);

  const handleCountryChange = (nextCountry: CountryFilter) => {
    setCountryFilter(nextCountry);
    setMarketFilter('India');
    /* Other regions commented out — focusing on India first
    if (nextCountry === 'India') {
      setMarketFilter('India');
    } else if (nextCountry === 'All') {
      setMarketFilter('All');
    } else {
      setMarketFilter('Global');
    }
    */
  };

  const handleMarketChange = (nextMarket: 'India') => {
    setMarketFilter(nextMarket);
    setCountryFilter('India');
    /* Other regions commented out — focusing on India first
    if (nextMarket === 'India') {
      setCountryFilter('India');
    } else if (nextMarket === 'All') {
      setCountryFilter('All');
    } else if (countryFilter === 'India') {
      setCountryFilter('All');
    }
    */
  };

  const currentFilters = useMemo<BackendSearchFilters>(
    () => ({
      query: searchQuery,
      country: countryFilter,
      market: marketFilter,
      workMode: workModeFilter,
      portalType: portalFilter,
      minMatch,
      notInterestedMode,
    }),
    [searchQuery, countryFilter, marketFilter, workModeFilter, portalFilter, minMatch, notInterestedMode]
  );

  const runBackendCatalogSearch = useCallback(
    async (filters: BackendSearchFilters) => {
      const seq = ++requestSeqRef.current;
      setSearchingBackend(true);
      try {
        const result = await onSearchBackendJobs(filters);
        if (seq !== requestSeqRef.current) return;
        setBackendJobs(result.jobs);
        setTotalCatalogCount(result.totalCatalogCount);
        setNotInterestedCount(result.notInterestedCount ?? 0);
        setResumeSummary(result.resumeProfileSummary);
        setGroundingSources(result.groundingSources || []);
        setLastDiscoveredAt(result.lastDiscoveredAt);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'Backend job search failed.',
        });
      } finally {
        if (seq === requestSeqRef.current) {
          setSearchingBackend(false);
        }
      }
    },
    [onSearchBackendJobs]
  );

  // Trigger backend search whenever filters, query, or parsed resume changes
  useEffect(() => {
    const timer = setTimeout(() => {
      void runBackendCatalogSearch(currentFilters);
    }, searchQuery.trim() ? 240 : 0);
    return () => clearTimeout(timer);
  }, [currentFilters, masterProfile.lastParsedAt, masterProfile.headline, jobs.length, runBackendCatalogSearch, searchQuery]);

  const handleDiscoverFromResume = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setDiscoveringLive(true);
    setFeedback(null);
    const seq = ++requestSeqRef.current;
    try {
      const result = await onDiscoverJobsFromResume(currentFilters);
      if (seq !== requestSeqRef.current) return;
      setBackendJobs(result.jobs);
      setTotalCatalogCount(result.totalCatalogCount);
      setNotInterestedCount(result.notInterestedCount ?? 0);
      setResumeSummary(result.resumeProfileSummary);
      setGroundingSources(result.groundingSources || []);
      setLastDiscoveredAt(result.lastDiscoveredAt);
      setFeedback({
        type: 'success',
        text: `Backend discovered ${result.discoveredCount} live roles tailored to ${result.resumeProfileSummary.fullName}'s resume in ${currentFilters.country}${
          currentFilters.query.trim() ? ` matching "${currentFilters.query.trim()}"` : ''
        }.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Live resume job search failed.',
      });
    } finally {
      setDiscoveringLive(false);
    }
  };

  const handleAnalyzeExisting = async (job: JobListing, forceQueue = false) => {
    setAnalyzingId(job.id);
    setFeedback(null);
    try {
      const result = await onAnalyzeJob({ jobId: job.id, forceQueue });
      await runBackendCatalogSearch(currentFilters);
      setFeedback({
        type: 'success',
        text: result.queued
          ? `${result.job.company} scored ${result.job.matchScore}% ATS match and was added to your Human Approval Queue.`
          : `${result.job.company} scored ${result.job.matchScore}% ATS match (below the 75% auto-queue threshold).`,
        showQueueLink: result.queued,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gemini analysis failed.',
      });
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleDirectApply = async (job: JobListing) => {
    setDirectApplyingId(job.id);
    setFeedback(null);
    try {
      await onDirectApplyJob(job.id);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to launch direct apply with uploaded resume.',
      });
    } finally {
      setDirectApplyingId(null);
    }
  };

  const handleNotInterestedToggle = async (job: JobListing, markNotInterested: boolean) => {
    setFlaggingId(job.id);
    setFeedback(null);
    try {
      await onToggleNotInterested(job.id, markNotInterested);
      await runBackendCatalogSearch(currentFilters);
      setFeedback({
        type: 'success',
        text: markNotInterested
          ? `Flagged "${job.company} — ${job.role}" as Not Interested and hid it from active discovery.`
          : `Restored "${job.company} — ${job.role}" back to active discovery.`,
        undoJobId: markNotInterested ? job.id : undefined,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update Not Interested flag.',
      });
    } finally {
      setFlaggingId(null);
    }
  };

  const handleAnalyzeCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDescription.trim() && !customUrl.trim()) {
      setFeedback({
        type: 'error',
        text: 'Please paste a job description or job posting URL to analyze.',
      });
      return;
    }

    setAnalyzingId('custom');
    setFeedback(null);
    try {
      const result = await onAnalyzeJob({
        customJob: {
          company: customCompany || undefined,
          role: customRole || undefined,
          location: customLocation || undefined,
          salary: customSalary || undefined,
          workMode: customWorkMode,
          portalType: customPortal,
          jobUrl: customUrl || undefined,
          recruiterName: customRecruiterName || undefined,
          description: customDescription || undefined,
        },
      });
      setCustomCompany('');
      setCustomRole('');
      setCustomLocation('');
      setCustomSalary('');
      setCustomUrl('');
      setCustomRecruiterName('');
      setCustomDescription('');
      setShowCustomForm(false);
      await runBackendCatalogSearch(currentFilters);
      setFeedback({
        type: 'success',
        text: result.queued
          ? `Analyzed ${result.job.company} — ${result.job.role} (${result.job.matchScore}% match) and moved it into your Approval Queue.`
          : `Analyzed ${result.job.company} — ${result.job.role} (${result.job.matchScore}% match). Because it is ≤75%, it remains in Discovery unless manually queued.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to analyze custom job.',
      });
    } finally {
      setAnalyzingId(null);
    }
  };

  const hasResume =
    resumeSummary?.hasResume ??
    Boolean(masterProfile.fullName.trim() || masterProfile.skills.length > 0 || masterProfile.experience.length > 0);
  const activeSkills = resumeSummary?.topSkills ?? masterProfile.skills.slice(0, 8);
  const activeHeadline = resumeSummary?.headline || masterProfile.headline || 'No resume parsed yet';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-indigo-600">Resume-Driven Backend Job Discovery</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Jobs Matched to Your Resume
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            All job searching, ATS match scoring, and live public board discovery run on the backend directly against your parsed Master Profile—with zero login scraping.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={discoveringLive || !hasResume}
            onClick={() => void handleDiscoverFromResume()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {discoveringLive ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Searching Backend...
              </>
            ) : (
              <>
                <Globe className="h-4 w-4" aria-hidden="true" />
                Search Jobs from Resume
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowCustomForm((prev) => !prev)}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {showCustomForm ? 'Close Quick Tailor' : 'Quick Tailor JD'}
          </button>
        </div>
      </div>

      {/* Active Resume Context Banner */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <FileText className="h-4 w-4 text-indigo-600 shrink-0" aria-hidden="true" />
            <span>
              Active Resume Basis:{' '}
              <strong className="text-slate-900">
                {resumeSummary?.fullName || masterProfile.fullName || 'Upload Resume Required'}
              </strong>
            </span>
            {lastDiscoveredAt && (
              <span className="text-slate-400 font-normal">
                · Last live search {new Date(lastDiscoveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 truncate">{activeHeadline}</p>
          {activeSkills.length > 0 && (
            <p className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">Resume skills indexed: </span>
              {activeSkills.join(' · ')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/profile')}
          className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0"
        >
          {hasResume ? 'Update Resume' : 'Upload Resume'}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </section>

      {feedback && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <span>{feedback.text}</span>
          <div className="flex items-center gap-3">
            {feedback.undoJobId && (
              <button
                type="button"
                onClick={() => {
                  const idToRestore = feedback.undoJobId;
                  if (!idToRestore) return;
                  void onToggleNotInterested(idToRestore, false).then(() => {
                    setFeedback({ type: 'success', text: 'Posting restored to active discovery.' });
                    return runBackendCatalogSearch(currentFilters);
                  });
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-800 hover:text-indigo-700 underline underline-offset-2 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Undo
              </button>
            )}
            {feedback.type === 'success' && feedback.showQueueLink !== false && !feedback.undoJobId && (
              <button
                type="button"
                onClick={() => onNavigate('/queue')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
              >
                Review Queue <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Custom JD On-Demand Analyzer */}
      {showCustomForm && (
        <form
          onSubmit={handleAnalyzeCustom}
          className="rounded-2xl border border-indigo-200 bg-white p-5 sm:p-6 space-y-4"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Analyze Any Job Description with Gemini
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              No behind-login scraping. Paste public job text or a direct ATS link (Greenhouse, Lever, Ashby, Workday, Naukri).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              value={customCompany}
              onChange={(e) => setCustomCompany(e.target.value)}
              placeholder="Company (optional)"
              className="min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="text"
              value={customRole}
              onChange={(e) => setCustomRole(e.target.value)}
              placeholder="Role Title (optional)"
              className="min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="text"
              value={customLocation}
              onChange={(e) => setCustomLocation(e.target.value)}
              placeholder="Location (e.g. Bengaluru / Remote)"
              className="min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="text"
              value={customSalary}
              onChange={(e) => setCustomSalary(e.target.value)}
              placeholder="Salary / CTC (optional)"
              className="min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              value={customRecruiterName}
              onChange={(e) => setCustomRecruiterName(e.target.value)}
              placeholder="Recruiter / Hiring Manager Name"
              className="min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="Public Job URL (https://...)"
              className="min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <select
              value={customWorkMode}
              onChange={(e) => setCustomWorkMode(e.target.value as WorkMode)}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="Remote">Work Mode: Remote</option>
              <option value="Hybrid">Work Mode: Hybrid</option>
              <option value="On-site">Work Mode: On-site</option>
            </select>
            <select
              value={customPortal}
              onChange={(e) => setCustomPortal(e.target.value as PortalType)}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="Greenhouse">Portal: Greenhouse</option>
              <option value="Lever">Portal: Lever</option>
              <option value="Ashby">Portal: Ashby</option>
              <option value="Workday">Portal: Workday</option>
              <option value="Naukri">Portal: Naukri</option>
            </select>
          </div>

          <textarea
            rows={5}
            value={customDescription}
            onChange={(e) => setCustomDescription(e.target.value)}
            placeholder="Paste the full Job Description text here (responsibilities, requirements, tech stack)..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/40 p-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
          />

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCustomForm(false)}
              className="min-h-[44px] rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={analyzingId === 'custom'}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {analyzingId === 'custom' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scoring & Tailoring...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Run Gemini ATS Match
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Backend Search & Filter Bar */}
      <form
        onSubmit={handleDiscoverFromResume}
        className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-5 relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search backend jobs or enter role/city for live search..."
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={discoveringLive || !hasResume}
              title="Run live backend search using your resume, country, and query"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {discoveringLive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Live Search
            </button>
          </div>

          <div className="md:col-span-4 flex items-center gap-2">
            <label htmlFor="country-filter-select" className="sr-only">
              Filter by Country
            </label>
            <select
              id="country-filter-select"
              value={countryFilter}
              onChange={(e) => handleCountryChange(e.target.value as CountryFilter)}
              className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  Country: {c} (Only)
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
              {MARKETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleMarketChange(m)}
                  className={`min-h-[36px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    marketFilter === m
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-3 flex items-center gap-2.5 px-1">
            <SlidersHorizontal className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Min Match</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {minMatch}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={95}
                step={5}
                value={minMatch}
                onChange={(e) => setMinMatch(Number(e.target.value))}
                className="mt-1 w-full accent-indigo-600"
                aria-label="Minimum ATS match score"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {WORK_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setWorkModeFilter(mode)}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  workModeFilter === mode
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {mode === 'All' ? 'Any Work Mode' : mode}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {PORTALS.map((portal) => (
              <button
                key={portal}
                type="button"
                onClick={() => setPortalFilter(portal)}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  portalFilter === portal
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {portal}
              </button>
            ))}

            <button
              type="button"
              onClick={() =>
                setNotInterestedMode((prev) => (prev === 'hide' ? 'only' : 'hide'))
              }
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                notInterestedMode === 'only'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              {notInterestedMode === 'only'
                ? `Viewing Not Interested (${notInterestedCount})`
                : `Not Interested (${notInterestedCount})`}
            </button>
          </div>
        </div>
      </form>

      {/* Job Listings Grid */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span>
            {notInterestedMode === 'only' ? (
              <>
                Showing <strong className="font-mono text-rose-700 tabular-nums">{backendJobs.length}</strong>{' '}
                posting(s) flagged Not Interested · Click Restore to bring any role back
              </>
            ) : (
              <>
                Backend returned <strong className="font-mono text-slate-900 tabular-nums">{backendJobs.length}</strong> of{' '}
                <span className="font-mono tabular-nums">{totalCatalogCount}</span> active resume-scored roles
                <strong className="text-indigo-700"> · Strict filter: {countryFilter} only</strong>
              </>
            )}
          </span>
          {(searchingBackend || discoveringLive) && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" aria-hidden="true" />
          )}
        </span>
        <span>Choose Tailor &amp; Queue or Apply Directly with your uploaded resume</span>
      </div>

      {backendJobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <p className="text-base font-semibold text-slate-900">
            {notInterestedMode === 'only'
              ? 'No postings flagged as Not Interested'
              : `No cached jobs found in ${countryFilter} matching your filters`}
          </p>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {notInterestedMode === 'only'
              ? 'Any job you flag as Not Interested will appear here so you can review or restore it later.'
              : `Run a live backend search to discover roles strictly in ${countryFilter} matched to your resume, or reset filters.`}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {notInterestedMode === 'only' ? (
              <button
                type="button"
                onClick={() => setNotInterestedMode('hide')}
                className="min-h-[44px] rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Back to Active Jobs
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={discoveringLive || !hasResume}
                  onClick={() => void handleDiscoverFromResume()}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  <Globe className="h-4 w-4" />
                  Search Live Jobs in {countryFilter}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCountryFilter('India');
                    setMarketFilter('India');
                    setWorkModeFilter('All');
                    setPortalFilter('All');
                    setMinMatch(0);
                  }}
                  className="min-h-[44px] rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Reset Filters
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {backendJobs.map((job) => {
            const queuedItem = queuedItemByJobId.get(job.id);
            const isQueued = Boolean(queuedItem);
            const isAnalyzing = analyzingId === job.id;
            const isDirectApplying = directApplyingId === job.id;
            const isFlagging = flaggingId === job.id;
            const isNotInterested = Boolean(job.notInterested);
            const safeUrl = sanitizeExternalUrl(job.jobUrl);
            const scoreColor =
              job.matchScore >= 85
                ? 'text-emerald-700'
                : job.matchScore > 75
                  ? 'text-indigo-700'
                  : 'text-amber-700';

            return (
              <article
                key={job.id}
                className={`flex flex-col justify-between rounded-2xl border p-5 transition-colors ${
                  isNotInterested
                    ? 'border-rose-200 bg-rose-50/30'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-500">
                        {job.company} · {job.portalType} · {job.portalComplexity}
                        {job.discoverySource === 'resume_backend_search' && (
                          <span className="text-indigo-600 font-semibold"> · Live Resume Match</span>
                        )}
                        {isNotInterested && (
                          <span className="text-rose-700 font-semibold"> · Flagged Not Interested</span>
                        )}
                      </p>
                      <h3 className="mt-1 text-base font-bold text-slate-900 leading-snug">
                        {job.role}
                      </h3>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono text-xl font-bold tabular-nums ${scoreColor}`}>
                        {job.matchScore}%
                      </p>
                      <p className="text-[11px] text-slate-500">ATS Match</p>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                    <span>{job.location}</span>
                    {job.country &&
                      job.country !== 'Global' &&
                      !job.location.toLowerCase().includes(job.country.toLowerCase()) && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-slate-700">{job.country}</span>
                        </>
                      )}
                    <span aria-hidden="true">·</span>
                    <span>{job.workMode}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      {job.salary}
                    </span>
                  </div>

                  {job.resumeMatchReason && (
                    <p className="mt-2.5 rounded-xl bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900 leading-relaxed">
                      <span className="font-semibold">Resume Fit: </span>
                      {job.resumeMatchReason}
                    </p>
                  )}

                  <p className="mt-3 text-sm text-slate-600 leading-relaxed line-clamp-3">
                    {job.description}
                  </p>

                  <div className="mt-3.5 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
                    {job.matchedKeywords.length > 0 && (
                      <p className="text-slate-600">
                        <span className="font-semibold text-emerald-700">Verified resume overlap: </span>
                        {job.matchedKeywords.join(' · ')}
                      </p>
                    )}
                    {job.missingKeywords.length > 0 && (
                      <p className="text-slate-500">
                        <span className="font-semibold text-slate-700">Gaps (not fabricated): </span>
                        {job.missingKeywords.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {safeUrl ? (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors"
                      >
                        Source Posting <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <span />
                    )}

                    <button
                      type="button"
                      disabled={isFlagging}
                      onClick={() => void handleNotInterestedToggle(job, !isNotInterested)}
                      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        isNotInterested
                          ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                          : 'text-slate-500 hover:text-rose-700 hover:bg-rose-50'
                      }`}
                    >
                      {isFlagging ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isNotInterested ? (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {isNotInterested ? 'Restore Posting' : 'Not Interested'}
                    </button>
                  </div>

                  {!isNotInterested && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isAnalyzing || isDirectApplying || !hasResume}
                        onClick={() => void handleAnalyzeExisting(job, !isQueued)}
                        className="flex-1 inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap"
                      >
                        {isAnalyzing ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Tailoring...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                            {isQueued && queuedItem?.applicationMode !== 'direct_resume'
                              ? 'Re-Tailor & Queue'
                              : 'Tailor & Queue'}
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isDirectApplying || isAnalyzing || !hasResume}
                        onClick={() => void handleDirectApply(job)}
                        title={
                          masterProfile.uploadedResumeFileName
                            ? `Apply directly with ${masterProfile.uploadedResumeFileName} (no AI edits)`
                            : 'Apply directly with your uploaded base resume (no AI edits)'
                        }
                        className="flex-1 inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                      >
                        {isDirectApplying ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Preparing...
                          </>
                        ) : (
                          <>
                            <FileCheck2 className="h-3.5 w-3.5" />
                            Apply Directly (Uploaded Resume)
                          </>
                        )}
                      </button>

                      {isQueued && (
                        <button
                          type="button"
                          onClick={() => onNavigate('/queue')}
                          className="inline-flex min-h-[42px] items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                        >
                          {queuedItem?.applicationMode === 'direct_resume' ? 'Direct in Queue' : 'In Queue'}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Grounding Sources returned from backend Google Search */}
      {groundingSources.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-2.5">
          <p className="text-xs font-semibold text-slate-700">
            Live Public Job Boards Queried by Backend (Zero-Scraping APIs)
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {groundingSources.slice(0, 8).map((src) => {
              const safeSrc = sanitizeExternalUrl(src.uri);
              if (!safeSrc) return null;
              return (
                <a
                  key={safeSrc}
                  href={safeSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
                >
                  <span className="max-w-[240px] truncate">{src.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
