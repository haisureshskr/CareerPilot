export type PortalType = 'Greenhouse' | 'Lever' | 'Ashby' | 'Workday' | 'Naukri';
export type WorkMode = 'Remote' | 'Hybrid' | 'On-site';
export type PortalComplexity = '1-Click' | 'Multi-Step';
export type PricingTierId = 'tier1' | 'tier2' | 'tier3' | 'tier4';
export type CountryFilter =
  // Other regions commented out — focusing on India first
  // | 'All'
  | 'India';
  // | 'United States'
  // | 'United Kingdom'
  // | 'Canada'
  // | 'Germany'
  // | 'Singapore'
  // | 'Australia'
  // | 'United Arab Emirates'
  // | 'Netherlands'
  // | 'Ireland';

export interface ExperienceItem {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface EducationItem {
  id: string;
  institution: string;
  degree: string;
  graduationYear: string;
  details?: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  techStack: string[];
  description: string;
}

export interface MasterProfile {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl?: string;
  summary: string;
  skills: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
  projects: ProjectItem[];
  rawResumeText?: string;
  lastParsedAt?: string;
}

export interface SavedCustomQA {
  id: string;
  question: string;
  answer: string;
  savedAt: string;
}

export interface QAVault {
  currentCtc: string;
  expectedCtc: string;
  noticePeriodDays: string;
  workAuthorization: string;
  relocationPreference: string;
  linkedinUrl: string;
  customQAs: SavedCustomQA[];
}

export interface HiringTeamMember {
  name: string;
  title: string;
  linkedinUrl: string;
  postedAgo: string;
  autoPurgeDaysRemaining: number;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface JobListing {
  id: string;
  company: string;
  role: string;
  location: string;
  country?: string;
  market: 'India' | 'Global';
  salary: string;
  workMode: WorkMode;
  portalType: PortalType;
  portalComplexity: PortalComplexity;
  matchScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  description: string;
  jobUrl: string;
  hiringTeam: HiringTeamMember;
  analyzedAt: string;
  isCustom?: boolean;
  discoverySource?: 'resume_backend_search' | 'custom_jd' | 'catalog';
  resumeMatchReason?: string;
}

export interface BackendJobSearchResponse {
  jobs: JobListing[];
  totalCatalogCount: number;
  resumeProfileSummary: {
    fullName: string;
    headline: string;
    location: string;
    topSkills: string[];
    inferredTargetRoles: string[];
    hasResume: boolean;
  };
  groundingSources: GroundingSource[];
  lastDiscoveredAt: string | null;
  searchMode: 'backend_catalog' | 'live_resume_search';
}

export interface ResumeDiffItem {
  id: string;
  experienceRef: string;
  before: string;
  after: string;
  rationale: string;
}

export interface ScreeningAnswer {
  id: string;
  question: string;
  answer: string;
  confidence: 'AMBER' | 'GREEN';
  sourceLabel: string;
  vaultField?: string;
  reviewed: boolean;
}

export interface QueueItem {
  id: string;
  jobId: string;
  company: string;
  role: string;
  location: string;
  salary: string;
  workMode: WorkMode;
  portalType: PortalType;
  portalComplexity: PortalComplexity;
  jobUrl?: string;
  matchScore: number;
  hiringTeam: HiringTeamMember;
  linkedinNote: string;
  resumeDiffs: ResumeDiffItem[];
  screeningQuestions: ScreeningAnswer[];
  createdAt: string;
  status: 'pending' | 'submitted' | 'action_required' | 'skipped';
}

export interface TrackedApplication {
  id: string;
  queueItemId: string;
  jobId: string;
  company: string;
  role: string;
  location: string;
  salary: string;
  portalType: PortalType;
  matchScore: number;
  status: 'submitted' | 'action_required' | 'skipped';
  timestamp: string;
  auditReceiptId: string;
  actionReason?: string;
  tailoredBulletsCount: number;
  resumeDiffs: ResumeDiffItem[];
  screeningQuestions: ScreeningAnswer[];
  humanVerified: boolean;
}

export interface OptOutRecord {
  id: string;
  linkedinUrl: string;
  normalizedHandle: string;
  urlSha256?: string;
  reason?: string;
  createdAt: string;
}

export interface GuardrailStatus {
  dailyCap: number;
  usedLast24h: number;
  remainingToday: number;
  cooldownSecondsRemaining: number;
  lastSubmissionAt: string | null;
}

export interface AppStatePayload {
  masterProfile: MasterProfile;
  qaVault: QAVault;
  consentAccepted: boolean;
  jobs: JobListing[];
  queue: QueueItem[];
  tracker: TrackedApplication[];
  optOuts: OptOutRecord[];
  selectedTier: PricingTierId;
  guardrails: GuardrailStatus;
}

export interface PricingTierConfig {
  id: PricingTierId;
  name: string;
  regions: string;
  multiplier: string;
  weeklyPrice: string;
  monthlyPrice: string;
  currency: 'USD' | 'INR';
  credits: number;
  dailyCap: number;
  expectedCountryCode: string;
  sampleCountries: { code: string; label: string }[];
  audience: string;
}
