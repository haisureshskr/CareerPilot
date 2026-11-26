import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  AppStatePayload,
  BackendJobSearchResponse,
  CountryFilter,
  GroundingSource,
  GuardrailStatus,
  JobListing,
  MasterProfile,
  OptOutRecord,
  PortalComplexity,
  PortalType,
  PricingTierId,
  QAVault,
  QueueItem,
  ResumeDiffItem,
  ScreeningAnswer,
  TrackedApplication,
  WorkMode,
} from './src/types.ts';
import {
  expressErrorMiddleware,
  ingestClientCrashLog,
  installProcessCrashHandlers,
  logServerError,
} from './serverCrashLogger.ts';

installProcessCrashHandlers();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const HARD_MAX_DAILY_CAP = 25;
const COOLDOWN_MS = 60_000;
const DATA_DIR = path.resolve(process.cwd(), '.careerpilot-data');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');

interface ServerStore {
  masterProfile: MasterProfile;
  qaVault: QAVault;
  consentAccepted: boolean;
  jobs: JobListing[];
  queue: QueueItem[];
  tracker: TrackedApplication[];
  optOuts: OptOutRecord[];
  selectedTier: PricingTierId;
  submissionTimestamps: number[];
  lastDiscoveredAt?: string | null;
  lastDiscoveredProfileHash?: string | null;
  groundingSources?: GroundingSource[];
}

const TIER_DAILY_CAPS: Record<PricingTierId, number> = {
  tier1: 25,
  tier2: 25,
  tier3: 20,
  tier4: 20,
};

const TRUTHFULNESS_LOCK_INSTRUCTION = `TRUTHFULNESS LOCK (STRICT, NON-NEGOTIABLE):
- NEVER invent, fabricate, or hallucinate any employer, job title, employment date, degree, institution, certification, metric, or technical skill that is NOT explicitly present in the user's Master Profile or Q&A Vault.
- You may ONLY reorder existing bullet points, emphasize truthful verified accomplishments, and align phrasing with the target Job Description's terminology using facts strictly supported by the Master Profile.
- If the Job Description asks for a tool or domain not in the Master Profile, honestly highlight adjacent verified skills from the Master Profile without claiming mastery of the missing tool.`;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  request: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
): Promise<{ response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>; modelUsed: string }> {
  const attempts: Array<{ model: string; delayMs: number }> = [
    { model: 'gemini-4-hydrogen', delayMs: 0 },
    { model: 'gemini-3.1-flash-lite', delayMs: 250 },
    { model: 'gemini-4-neon', delayMs: 400 },
    { model: 'gemini-4-hydrogen', delayMs: 800 },
  ];

  let lastErr: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    const { model, delayMs } = attempts[i];
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const response = await ai.models.generateContent({
        ...request,
        model,
      });
      return { response, modelUsed: model };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        /503|429|404|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|high demand|overloaded|temporarily|DEADLINE_EXCEEDED/i.test(msg);
      if (!isRetryable && i > 0) {
        throw err;
      }
      console.warn(`Gemini model ${model} attempt ${i + 1} failed (${msg.slice(0, 140)}); trying fallback...`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Gemini API is temporarily unavailable. Please try again.');
}

function normalizeLinkedInHandle(rawUrl: string): string {
  const trimmed = rawUrl.trim().toLowerCase();
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const cleanedPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${cleanedPath}`;
  } catch {
    return trimmed.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  }
}

function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const SUPPORTED_COUNTRIES: CountryFilter[] = [
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

const COUNTRY_LOCATION_PATTERNS: Record<CountryFilter, RegExp> = {
  India:
    /\bindia\b|\bbengaluru\b|\bbangalore\b|\bmumbai\b|\bhyderabad\b|\bpune\b|\bchennai\b|\bnew delhi\b|\bdelhi\b|\bnoida\b|\bgurugram\b|\bgurgaon\b|\bkolkata\b|\bahmedabad\b|\bkochi\b|\bcoimbatore\b|\bjaipur\b|\bchandigarh\b|\bindore\b|\bthiruvananthapuram\b|\btrivandrum\b|\bnagpur\b|\bsurat\b|\bvadodara\b|\bmangalore\b|\bmysuru\b|\bmysore\b|\bvisakhapatnam\b|\bvizag\b|\bbhubaneswar\b/i,
  /* Other regions commented out — focusing on India first
  'United States':
    /\bunited states\b|\bu\.s\.a\.?\b|\busa\b|\b(?:remote\s*\(?\s*us\b|us\s*only|us\s*remote|us\s*\/|\/\s*us\b|\bus\s*-\s*remote\b)|\bnew york\b|\bnyc\b|\bsan francisco\b|\bseattle\b|\baustin\b|\bboston\b|\bchicago\b|\blos angeles\b|\bdenver\b|\batlanta\b|\bmiami\b|\bdallas\b|\bhouston\b|\bsilicon valley\b|\bmountain view\b|\bpalo alto\b|\bmenlo park\b|\bcupertino\b|\bcalifornia\b|\btexas\b|\bwashington,?\s*dc\b|\bphiladelphia\b|\bsan diego\b|\bsan jose\b|\bphoenix\b|\bportland\b|\bminneapolis\b|\bdetroit\b|\braleigh\b|\bcharlotte\b|,\s*(?:ca|ny|tx|wa|ma|il|co|ga|fl|va|nc|nj|pa|oh|az|ut|or|mn|mi|md|dc)\b/i,
  'United Kingdom':
    /\bunited kingdom\b|\bu\.k\.?\b|\buk\b|\bengland\b|\bscotland\b|\bwales\b|\blondon\b|\bmanchester\b|\bedinburgh\b|\bbristol\b|\bbirmingham\b|\bcambridge,?\s*uk\b|\boxford,?\s*uk\b|\bglasgow\b|\bleeds\b|\bbelfast\b|\bliverpool\b|\bnewcastle\b/i,
  Canada:
    /\bcanada\b|\btoronto\b|\bvancouver\b|\bmontreal\b|\bmontréal\b|\bottawa\b|\bcalgary\b|\bwaterloo\b|\bedmonton\b|\bquebec\b|\bontario\b|\bbritish columbia\b|\bhalifax\b|\bwinnipeg\b/i,
  Germany:
    /\bgermany\b|\bdeutschland\b|\bberlin\b|\bmunich\b|\bmünchen\b|\bhamburg\b|\bfrankfurt\b|\bcologne\b|\bköln\b|\bstuttgart\b|\bdüsseldorf\b|\bdusseldorf\b|\bleipzig\b|\bdresden\b|\bkarlsruhe\b|\bdortmund\b|\bessen\b|\bbonn\b|\bhanover\b|\bhannover\b|\bnuremberg\b|\bnürnberg\b|\bmannheim\b|\bbremen\b|\baachen\b|\bfreiburg\b|\bmünster\b|\bmunster\b|\bheidelberg\b|\bregensburg\b|\bbochum\b|\bwiesbaden\b|\bmainz\b|\bheilbronn\b|\baugsburg\b|\bwalldorf\b|\bbaden-württemberg\b|\bbavaria\b|\bbayern\b/i,
  Singapore: /\bsingapore\b/i,
  Australia:
    /\baustralia\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b|\bperth\b|\badelaide\b|\bcanberra\b|\bgold coast\b/i,
  'United Arab Emirates':
    /\bunited arab emirates\b|\buae\b|\bu\.a\.e\.?\b|\bdubai\b|\babu dhabi\b|\bsharjah\b/i,
  Netherlands:
    /\bnetherlands\b|\bholland\b|\bamsterdam\b|\brotterdam\b|\butrecht\b|\beindhoven\b|\bthe hague\b|\bden haag\b|\bdelft\b|\bgroningen\b/i,
  Ireland: /\bireland\b|\bdublin\b|\bcork\b|\bgalway\b|\blimerick\b/i,
  */
};

const COUNTRY_SALARY_PATTERNS: Partial<Record<CountryFilter, RegExp>> = {
  India: /₹|\binr\b|\blpa\b/i,
  /* Other regions commented out — focusing on India first
  'United Kingdom': /£|\bgbp\b/i,
  Canada: /\bcad\b|c\$/i,
  Singapore: /\bsgd\b|s\$/i,
  Australia: /\baud\b|a\$/i,
  'United Arab Emirates': /\baed\b/i,
  */
};

function sanitizeCountryFilter(_raw: unknown): CountryFilter {
  // Other regions commented out — focusing on India first
  // if (typeof _raw === 'string' && (SUPPORTED_COUNTRIES as string[]).includes(_raw)) {
  //   return _raw as CountryFilter;
  // }
  return 'India';
}

function inferJobCountry(
  location: string,
  market?: string,
  salary?: string,
  explicitCountry?: string
): string {
  const loc = (location || '').trim();
  const sal = (salary || '').trim();

  // 1. Direct location match (most reliable)
  for (const country of SUPPORTED_COUNTRIES) {
    if (COUNTRY_LOCATION_PATTERNS[country].test(loc)) {
      return country;
    }
  }

  // 2. Unambiguous local currency hint in salary
  for (const [country, pattern] of Object.entries(COUNTRY_SALARY_PATTERNS)) {
    if (pattern && pattern.test(sal)) {
      return country;
    }
  }

  // 3. Explicit country metadata if provided and valid
  if (
    explicitCountry &&
    (SUPPORTED_COUNTRIES as string[]).includes(explicitCountry)
  ) {
    return explicitCountry;
  }

  // 4. India market fallback
  if (market === 'India') {
    return 'India';
  }

  return 'Global';
}

function matchesCountryFilter(
  job: { location: string; country?: string; market?: string; salary?: string; portalType?: string },
  country: CountryFilter
): boolean {
  const loc = (job.location || '').trim();
  const sal = (job.salary || '').trim();

  // Check explicit location match first
  if (COUNTRY_LOCATION_PATTERNS[country].test(loc)) {
    return true;
  }

  // Check unambiguous local currency hint
  const salPattern = COUNTRY_SALARY_PATTERNS[country];
  if (salPattern && salPattern.test(sal)) {
    return true;
  }

  // For India, Naukri jobs are India-specific
  if (country === 'India' && job.portalType === 'Naukri') {
    return true;
  }

  // If location doesn't specify ANY known country, check inferred/explicit country (excludes generic Global)
  const inferred = inferJobCountry(loc, job.market, sal, job.country);
  return inferred === country;
}

function normalizeCandidateLinkedInUrl(rawInput: string): string | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  let cleaned = rawInput
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/[.,;:!?)\]'"`]+$/g, '')
    .replace(/\s+/g, '');

  if (!cleaned) return null;

  // Handle "linkedin.com/in/handle" or "www.linkedin.com/in/handle" or "in.linkedin.com/in/handle"
  const fullMatch = cleaned.match(
    /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(in|pub)\/([A-Za-z0-9._%/-]+)/i
  );
  if (fullMatch) {
    const section = fullMatch[1].toLowerCase();
    const rawSlugPath = fullMatch[2].split(/[?#]/)[0].replace(/\/+$/, '');
    const segments = rawSlugPath.split('/').filter(Boolean);
    const slug = segments[0];
    if (!slug || slug.length < 2 || slug.length > 120) return null;
    if (/^(jobs|company|feed|learning|school|messaging|notifications|mynetwork|login|signup)$/i.test(slug)) {
      return null;
    }
    if (section === 'pub') {
      return `https://www.linkedin.com/pub/${segments.join('/')}`;
    }
    return `https://www.linkedin.com/in/${slug}`;
  }

  // Handle shorthand "in/handle" if passed directly
  const shortMatch = cleaned.match(/^\/?in\/([A-Za-z0-9][A-Za-z0-9._%-]{1,119})$/i);
  if (shortMatch) {
    return `https://www.linkedin.com/in/${shortMatch[1]}`;
  }

  return null;
}

function extractLinkedInUrlFromText(text: string): string | null {
  if (!text) return null;

  // Collapse soft line breaks right after "linkedin.com/in/" in extracted PDF text
  const repaired = text
    .replace(/(linkedin\.com\/(?:in|pub)\/)\s*\r?\n\s*([A-Za-z0-9._%-]+)/gi, '$1$2')
    .replace(/(linkedin\.com\/)\s*\r?\n\s*(in\/[A-Za-z0-9._%-]+)/gi, '$1$2');

  const urlMatches = repaired.match(
    /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9._%/-]+/gi
  );
  if (urlMatches) {
    for (const candidate of urlMatches) {
      const normalized = normalizeCandidateLinkedInUrl(candidate);
      if (normalized) return normalized;
    }
  }

  // Check explicit "LinkedIn: handle" or "LinkedIn - /in/handle" patterns
  const labeledMatch = repaired.match(
    /linkedin(?:\s+profile)?\s*[:|–—-]\s*(?:https?:\/\/)?(?:(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/)?(?:\/?in\/)?@?([A-Za-z0-9][A-Za-z0-9-]{2,80})/i
  );
  if (labeledMatch) {
    const slug = labeledMatch[1].replace(/[.,;:!?)]+$/, '');
    if (
      slug &&
      !/^(profile|link|url|account|page|com|www|http|https|linkedin)$/i.test(slug)
    ) {
      return `https://www.linkedin.com/in/${slug}`;
    }
  }

  return null;
}

function decodePdfLiteralString(raw: string): string {
  return raw
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\r?\n/g, '');
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length < 4) return '';
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  try {
    const buf = Buffer.from(padded, 'hex');
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      // UTF-16BE BOM
      let out = '';
      for (let i = 2; i + 1 < buf.length; i += 2) {
        out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
      }
      return out;
    }
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function scanPdfChunkForLinkedIn(chunk: string): string | null {
  // 1. Prefer explicit PDF /URI (...) annotations (where visible text only says "LinkedIn")
  const uriParenRegex = /\/URI\s*\(((?:\\.|[^()\\]){4,450})\)/g;
  let match: RegExpExecArray | null;
  while ((match = uriParenRegex.exec(chunk)) !== null) {
    const decoded = decodePdfLiteralString(match[1]);
    const normalized = normalizeCandidateLinkedInUrl(decoded);
    if (normalized) return normalized;
  }

  // 2. Check hex-encoded PDF /URI <...> annotations
  const uriHexRegex = /\/URI\s*<([0-9A-Fa-f\s]{8,900})>/g;
  while ((match = uriHexRegex.exec(chunk)) !== null) {
    const decoded = decodePdfHexString(match[1]);
    const normalized = normalizeCandidateLinkedInUrl(decoded);
    if (normalized) return normalized;
  }

  // 3. Fallback: direct text scan inside uncompressed chunk
  return extractLinkedInUrlFromText(chunk);
}

function extractLinkedInUrlFromPdfBuffer(pdfBuf: Buffer): string | null {
  if (!pdfBuf || pdfBuf.length === 0) return null;

  // Step 1: Scan raw PDF bytes (covers uncompressed Link annotations and metadata)
  const rawLatin1 = pdfBuf.toString('latin1');
  const directHit = scanPdfChunkForLinkedIn(rawLatin1);
  if (directHit) return directHit;

  // Step 2: Inflate FlateDecode streams (covers object streams / compressed annotations / text streams)
  let searchPos = 0;
  let inspectedStreams = 0;
  const maxStreams = 64;
  const maxStreamBytes = 2 * 1024 * 1024;

  while (inspectedStreams < maxStreams) {
    const streamIdx = pdfBuf.indexOf('stream', searchPos, 'latin1');
    if (streamIdx === -1) break;

    let dataStart = streamIdx + 6;
    if (pdfBuf[dataStart] === 0x0d && pdfBuf[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (pdfBuf[dataStart] === 0x0a || pdfBuf[dataStart] === 0x0d) {
      dataStart += 1;
    } else {
      searchPos = dataStart;
      continue;
    }

    const endIdx = pdfBuf.indexOf('endstream', dataStart, 'latin1');
    if (endIdx === -1) break;

    searchPos = endIdx + 9;
    inspectedStreams += 1;

    const streamLen = endIdx - dataStart;
    if (streamLen <= 4 || streamLen > maxStreamBytes) continue;

    const slice = pdfBuf.subarray(dataStart, endIdx);
    let inflated: Buffer | null = null;
    try {
      inflated = zlib.inflateSync(slice, { maxOutputLength: maxStreamBytes });
    } catch {
      try {
        inflated = zlib.inflateRawSync(slice, { maxOutputLength: maxStreamBytes });
      } catch {
        inflated = null;
      }
    }

    if (inflated && inflated.length > 0) {
      const hit = scanPdfChunkForLinkedIn(inflated.toString('latin1'));
      if (hit) return hit;
    }
  }

  return null;
}

function isSafePublicJobUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function buildResumeCorpus(profile: MasterProfile): string {
  const parts: string[] = [
    profile.headline,
    profile.summary,
    profile.location,
    ...profile.skills,
    ...profile.experience.flatMap((e) => [e.company, e.title, e.location, ...e.bullets]),
    ...profile.education.flatMap((ed) => [ed.institution, ed.degree, ed.details || '']),
    ...profile.projects.flatMap((p) => [p.name, p.description, ...p.techStack]),
    profile.rawResumeText || '',
  ];
  return parts.join(' \n ').toLowerCase();
}

function computeProfileHash(profile: MasterProfile, qaVault: QAVault): string {
  const canonical = JSON.stringify({
    fullName: profile.fullName,
    headline: profile.headline,
    location: profile.location,
    skills: profile.skills,
    experience: profile.experience.map((e) => ({ company: e.company, title: e.title, bullets: e.bullets })),
    education: profile.education.map((e) => ({ degree: e.degree, institution: e.institution })),
    projects: profile.projects.map((p) => ({ name: p.name, techStack: p.techStack })),
    relocationPreference: qaVault.relocationPreference,
    expectedCtc: qaVault.expectedCtc,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

function extractResumeSummary(profile: MasterProfile): BackendJobSearchResponse['resumeProfileSummary'] {
  const hasResume = Boolean(
    profile.fullName.trim() ||
      profile.headline.trim() ||
      profile.skills.length > 0 ||
      profile.experience.length > 0
  );
  const inferredRoles = Array.from(
    new Set(
      [
        ...profile.experience.map((e) => e.title.trim()).filter(Boolean),
        profile.headline.split(/[(\-|]/)[0]?.trim() || '',
      ].filter((r) => r.length >= 3)
    )
  ).slice(0, 4);

  return {
    fullName: profile.fullName || 'Candidate',
    headline: profile.headline || 'Upload or parse your resume to personalize backend discovery',
    location: profile.location || 'Global / Remote',
    topSkills: profile.skills.slice(0, 10),
    inferredTargetRoles: inferredRoles,
    hasResume,
  };
}

function verifyKeywordsAgainstResume(
  proposedMatched: string[],
  proposedMissing: string[],
  profile: MasterProfile
): { matchedKeywords: string[]; missingKeywords: string[] } {
  const corpus = buildResumeCorpus(profile);
  const verifiedMatched: string[] = [];
  const verifiedMissing: string[] = [];
  const seen = new Set<string>();

  for (const rawKw of proposedMatched) {
    const kw = String(rawKw || '').trim().slice(0, 48);
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const tokens = key.split(/[^a-z0-9+#.]+/).filter((t) => t.length >= 2);
    const inCorpus =
      corpus.includes(key) ||
      (tokens.length > 0 && tokens.every((tok) => corpus.includes(tok)));

    if (inCorpus) {
      verifiedMatched.push(kw);
    } else {
      verifiedMissing.push(kw);
    }
  }

  for (const rawKw of proposedMissing) {
    const kw = String(rawKw || '').trim().slice(0, 48);
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    verifiedMissing.push(kw);
  }

  return {
    matchedKeywords: verifiedMatched.slice(0, 10),
    missingKeywords: verifiedMissing.slice(0, 8),
  };
}

function rescoreCatalogJobForResume(job: JobListing, profile: MasterProfile): JobListing {
  const corpus = buildResumeCorpus(profile);
  if (!corpus.trim()) return job;

  const jobText = `${job.role} ${job.description} ${job.matchedKeywords.join(' ')} ${job.missingKeywords.join(' ')}`.toLowerCase();
  const resumeSkills = profile.skills.filter((s) => s.trim().length > 1);
  const matchedFromSkills = resumeSkills.filter((s) => jobText.includes(s.toLowerCase()));

  const roleTokens = job.role
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length >= 3 && !['senior', 'staff', 'lead', 'engineer', 'and', 'the', 'for'].includes(t));
  const roleHits = roleTokens.filter((t) => corpus.includes(t)).length;
  const roleRatio = roleTokens.length > 0 ? roleHits / roleTokens.length : 0.4;

  const { matchedKeywords, missingKeywords } = verifyKeywordsAgainstResume(
    Array.from(new Set([...matchedFromSkills, ...job.matchedKeywords])),
    job.missingKeywords,
    profile
  );

  const skillRatio =
    resumeSkills.length > 0
      ? Math.min(1, matchedKeywords.length / Math.max(3, Math.min(6, resumeSkills.length)))
      : 0.35;

  const computedScore = Math.max(
    18,
    Math.min(97, Math.round(22 + skillRatio * 48 + roleRatio * 26))
  );

  return {
    ...job,
    matchScore: computedScore,
    matchedKeywords,
    missingKeywords,
  };
}

function scrubOptedOutRecruiterFromJob(job: JobListing, optOuts: OptOutRecord[]): JobListing {
  const url = job.hiringTeam?.linkedinUrl || '';
  if (!url) return job;
  const normalized = normalizeLinkedInHandle(url);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  const blocked = optOuts.some(
    (o) => o.normalizedHandle === normalized || o.urlSha256 === hash
  );
  if (!blocked) return job;
  return {
    ...job,
    hiringTeam: {
      name: 'Hiring Team (Opted Out)',
      title: 'Privacy-Protected Contact',
      linkedinUrl: '',
      postedAgo: job.hiringTeam.postedAgo,
      autoPurgeDaysRemaining: 0,
    },
  };
}

function extractJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const objStart = candidate.indexOf('{');
    const objEnd = candidate.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      return JSON.parse(candidate.slice(objStart, objEnd + 1));
    }
    const arrStart = candidate.indexOf('[');
    const arrEnd = candidate.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      return JSON.parse(candidate.slice(arrStart, arrEnd + 1));
    }
    throw new Error('Could not parse structured JSON from Gemini job search response.');
  }
}

function filterAndRankBackendJobs(
  allJobs: JobListing[],
  filters: {
    query: string;
    country: CountryFilter;
    market: string;
    workMode: string;
    portalType: string;
    minMatch: number;
    notInterestedMode?: 'hide' | 'only' | 'all';
  }
): JobListing[] {
  const q = filters.query.trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const notInterestedMode = filters.notInterestedMode || 'hide';

  const filtered = allJobs
    .map((job) => ({
      ...scrubOptedOutRecruiterFromJob(job, store.optOuts),
      country: inferJobCountry(job.location, job.market, job.salary, job.country),
    }))
    .filter((job) => {
      if (notInterestedMode === 'hide' && job.notInterested) return false;
      if (notInterestedMode === 'only' && !job.notInterested) return false;
      if (!matchesCountryFilter(job, filters.country)) return false;
      // Other regions commented out — focusing on India first
      // if (filters.country === 'All' && filters.market !== 'All' && job.market !== filters.market) return false;
      if (filters.workMode !== 'All' && job.workMode !== filters.workMode) return false;
      if (filters.portalType !== 'All' && job.portalType !== filters.portalType) return false;
      if (job.matchScore < filters.minMatch) return false;
      if (tokens.length === 0) return true;
      const haystack = [
        job.company,
        job.role,
        job.location,
        job.country || '',
        job.market,
        job.workMode,
        job.portalType,
        job.salary,
        job.description,
        job.resumeMatchReason || '',
        ...job.matchedKeywords,
        ...job.missingKeywords,
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    });

  return filtered.sort((a, b) => {
    const aLive = a.discoverySource === 'resume_backend_search' ? 1 : 0;
    const bLive = b.discoverySource === 'resume_backend_search' ? 1 : 0;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (bLive !== aLive) return bLive - aLive;
    return b.analyzedAt.localeCompare(a.analyzedAt);
  });
}

function stripHtmlToText(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface LivePublicJobCandidate {
  id: string;
  company: string;
  role: string;
  location: string;
  market: 'India' | 'Global';
  salary: string;
  workMode: WorkMode;
  portalType: PortalType;
  portalComplexity: PortalComplexity;
  description: string;
  jobUrl: string;
  postedAgo: string;
  sourceLabel: string;
  preliminaryScore: number;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 4000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CareerPilotAI/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

async function fetchLivePublicJobsFromAllowlistedApis(
  searchTerms: string[],
  profile: MasterProfile
): Promise<{ candidates: LivePublicJobCandidate[]; sources: GroundingSource[] }> {
  const corpus = buildResumeCorpus(profile);
  const resumeTerms = Array.from(
    new Set(
      [
        ...profile.skills,
        ...searchTerms,
        ...profile.experience.map((e) => e.title),
      ]
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9+#]+/)
        .filter((t) => t.length >= 2 && !['and', 'the', 'for', 'with', 'senior', 'lead', 'engineer'].includes(t))
    )
  ).slice(0, 35);

  const scoreCandidate = (title: string, desc: string, loc: string): number => {
    const text = `${title} ${desc} ${loc}`.toLowerCase();
    let hits = 0;
    for (const term of resumeTerms) {
      if (text.includes(term)) hits += 1;
    }
    const queryHits = searchTerms.filter((q) => q.trim() && text.includes(q.trim().toLowerCase())).length;
    return hits * 4 + queryHits * 10 + (corpus.includes(title.toLowerCase().split(' ')[0] || '') ? 3 : 0);
  };

  const inferMarket = (loc: string, salary: string): 'India' | 'Global' =>
    /india|bengaluru|bangalore|mumbai|hyderabad|pune|chennai|delhi|noida|gurgaon|₹|inr|lpa/i.test(
      `${loc} ${salary}`
    )
      ? 'India'
      : 'Global';

  const inferWorkMode = (loc: string, desc: string, isRemoteHint = false): WorkMode => {
    if (isRemoteHint || /\bremote\b|worldwide|anywhere/i.test(loc)) return 'Remote';
    if (/\bhybrid\b/i.test(`${loc} ${desc}`)) return 'Hybrid';
    return 'On-site';
  };

  const cleanTerms = searchTerms
    .map((t) => t.trim().slice(0, 60))
    .filter((t) => t.length >= 2)
    .slice(0, 2);

  const tasks: Array<Promise<{ items: LivePublicJobCandidate[]; source?: GroundingSource }>> = [];

  // 1. Remotive official public remote jobs API (queried with resume-derived keywords)
  for (const term of cleanTerms.length > 0 ? cleanTerms : ['software']) {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=20`;
    tasks.push(
      fetchJsonWithTimeout(url, 4500).then((data) => {
        const list = ((data as { jobs?: Array<Record<string, unknown>> })?.jobs ?? []).slice(0, 20);
        const items: LivePublicJobCandidate[] = [];
        for (const j of list) {
          const jobUrl = String(j.url || '').trim();
          if (!isSafePublicJobUrl(jobUrl)) continue;
          const company = String(j.company_name || 'Employer').trim().slice(0, 120);
          const role = String(j.title || 'Open Role').trim().slice(0, 160);
          const location = String(j.candidate_required_location || 'Remote (Global)').trim().slice(0, 120);
          const salary = String(j.salary || 'Not disclosed').trim().slice(0, 100) || 'Not disclosed';
          const desc = stripHtmlToText(String(j.description || '')).slice(0, 1400);
          items.push({
            id: `live_remotive_${String(j.id || items.length)}`,
            company,
            role,
            location,
            market: inferMarket(location, salary),
            salary,
            workMode: 'Remote',
            portalType: /lever\.co/i.test(jobUrl)
              ? 'Lever'
              : /ashbyhq\.com/i.test(jobUrl)
                ? 'Ashby'
                : /workday/i.test(jobUrl)
                  ? 'Workday'
                  : 'Greenhouse',
            portalComplexity: '1-Click',
            description: desc || `${role} at ${company} (${location}).`,
            jobUrl,
            postedAgo: String(j.publication_date || 'Recent').slice(0, 10),
            sourceLabel: 'Remotive Public API',
            preliminaryScore: scoreCandidate(role, desc, location),
          });
        }
        return {
          items,
          source: { title: `Remotive Live Search (${term})`, uri: `https://remotive.com/remote-jobs?search=${encodeURIComponent(term)}` },
        };
      })
    );
  }

  /* Other regions commented out — focusing on India first (EU-only Arbeitnow board)
  // 2. Arbeitnow official public job board API
  tasks.push(
    fetchJsonWithTimeout('https://www.arbeitnow.com/api/job-board-api', 4500).then((data) => {
      const list = ((data as { data?: Array<Record<string, unknown>> })?.data ?? []).slice(0, 50);
      const items: LivePublicJobCandidate[] = [];
      for (const j of list) {
        const jobUrl = String(j.url || '').trim();
        if (!isSafePublicJobUrl(jobUrl)) continue;
        const company = String(j.company_name || 'Employer').trim().slice(0, 120);
        const role = String(j.title || 'Open Role').trim().slice(0, 160);
        const location = String(j.location || 'Remote / Global').trim().slice(0, 120);
        const desc = stripHtmlToText(String(j.description || '')).slice(0, 1400);
        const isRemote = Boolean(j.remote);
        items.push({
          id: `live_arbeit_${String(j.slug || items.length).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}`,
          company,
          role,
          location,
          market: inferMarket(location, ''),
          salary: 'Competitive / Market',
          workMode: inferWorkMode(location, desc, isRemote),
          portalType: 'Greenhouse',
          portalComplexity: '1-Click',
          description: desc || `${role} at ${company}.`,
          jobUrl,
          postedAgo: 'Recent',
          sourceLabel: 'Arbeitnow Public API',
          preliminaryScore: scoreCandidate(role, desc, location),
        });
      }
      return {
        items,
        source: { title: 'Arbeitnow Public Job Board', uri: 'https://www.arbeitnow.com/jobs' },
      };
    })
  );
  */

  // 3. Official Ashby Public Job Boards (India-hiring boards active; US/EU-only commented out)
  const ashbyBoards = [
    // { slug: 'linear', name: 'Linear' },
    { slug: 'notion', name: 'Notion' },
    // { slug: 'ramp', name: 'Ramp' },
    { slug: 'deel', name: 'Deel' },
  ];
  for (const board of ashbyBoards) {
    tasks.push(
      fetchJsonWithTimeout(`https://api.ashbyhq.com/posting-api/job-board/${board.slug}`, 3500).then((data) => {
        const list = ((data as { jobs?: Array<Record<string, unknown>> })?.jobs ?? []).slice(0, 30);
        const items: LivePublicJobCandidate[] = [];
        for (const j of list) {
          const jobUrl = String(j.jobUrl || j.applyUrl || '').trim();
          if (!isSafePublicJobUrl(jobUrl)) continue;
          const role = String(j.title || 'Open Role').trim().slice(0, 160);
          const location = String(j.location || 'Global / Remote').trim().slice(0, 120);
          const dept = String(j.department || '').trim();
          const desc = stripHtmlToText(String(j.descriptionPlain || j.descriptionHtml || `${role} (${dept}) at ${board.name}.`)).slice(0, 1400);
          items.push({
            id: `live_ashby_${board.slug}_${String(j.id || items.length).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}`,
            company: board.name,
            role,
            location,
            market: inferMarket(location, ''),
            salary: 'Competitive / Market',
            workMode: inferWorkMode(location, desc, Boolean(j.isRemote)),
            portalType: 'Ashby',
            portalComplexity: '1-Click',
            description: desc,
            jobUrl,
            postedAgo: String(j.publishedAt || 'Recent').slice(0, 10),
            sourceLabel: `Ashby Public Board · ${board.name}`,
            preliminaryScore: scoreCandidate(role, `${dept} ${desc}`, location),
          });
        }
        return {
          items,
          source: { title: `${board.name} Careers (Ashby)`, uri: `https://jobs.ashbyhq.com/${board.slug}` },
        };
      })
    );
  }

  /* Other regions commented out — focusing on India first (US/EU-focused Lever boards)
  // 4. Official Lever Public Postings API (Palantir, Plaid, Netflix)
  const leverBoards = [
    { slug: 'palantir', name: 'Palantir' },
    { slug: 'plaid', name: 'Plaid' },
    { slug: 'netflix', name: 'Netflix' },
  ];
  for (const board of leverBoards) {
    tasks.push(
      fetchJsonWithTimeout(`https://api.lever.co/v0/postings/${board.slug}?mode=json&limit=25`, 3500).then((data) => {
        const list = (Array.isArray(data) ? data : []).slice(0, 25) as Array<Record<string, unknown>>;
        const items: LivePublicJobCandidate[] = [];
        for (const j of list) {
          const jobUrl = String(j.hostedUrl || j.applyUrl || '').trim();
          if (!isSafePublicJobUrl(jobUrl)) continue;
          const cats = (j.categories as Record<string, unknown>) || {};
          const role = String(j.text || 'Open Role').trim().slice(0, 160);
          const location = String(cats.location || 'Global').trim().slice(0, 120);
          const team = String(cats.team || cats.department || '').trim();
          const desc = stripHtmlToText(String(j.descriptionPlain || j.description || `${role} on ${team} at ${board.name}.`)).slice(0, 1400);
          items.push({
            id: `live_lever_${board.slug}_${String(j.id || items.length).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}`,
            company: board.name,
            role,
            location,
            market: inferMarket(location, ''),
            salary: 'Competitive / Market',
            workMode: inferWorkMode(location, `${String(j.workplaceType || '')} ${desc}`, String(j.workplaceType || '').toLowerCase() === 'remote'),
            portalType: 'Lever',
            portalComplexity: '1-Click',
            description: desc,
            jobUrl,
            postedAgo: 'Recent',
            sourceLabel: `Lever Public Board · ${board.name}`,
            preliminaryScore: scoreCandidate(role, `${team} ${desc}`, location),
          });
        }
        return {
          items,
          source: { title: `${board.name} Careers (Lever)`, uri: `https://jobs.lever.co/${board.slug}` },
        };
      })
    );
  }
  */

  const settled = await Promise.allSettled(tasks);
  const allCandidates: LivePublicJobCandidate[] = [];
  const sources: GroundingSource[] = [];
  const seenSources = new Set<string>();

  for (const res of settled) {
    if (res.status === 'fulfilled') {
      allCandidates.push(...res.value.items);
      if (res.value.source && !seenSources.has(res.value.source.uri)) {
        seenSources.add(res.value.source.uri);
        sources.push(res.value.source);
      }
    }
  }

  return { candidates: allCandidates, sources };
}

async function discoverJobsFromResumeInBackend(params: {
  query?: string;
  country?: CountryFilter;
  market?: string;
  workMode?: string;
  portalType?: string;
}): Promise<{ discoveredJobs: JobListing[]; groundingSources: GroundingSource[] }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'Gemini API key is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets.'
    );
  }

  const profile = store.masterProfile;
  const vault = store.qaVault;
  const summary = extractResumeSummary(profile);
  if (!summary.hasResume) {
    throw new Error('Please upload, paste, or fill in your resume in Master Profile before searching jobs.');
  }

  const cleanQuery = (params.query || '').trim().slice(0, 200);
  const countryFilter: CountryFilter = sanitizeCountryFilter(params.country);
  const marketFilter = 'India';
  /* Other regions commented out — focusing on India first
  const marketFilter =
    countryFilter === 'India'
      ? 'India'
      : countryFilter !== 'All'
        ? 'Global'
        : params.market && params.market !== 'All'
          ? params.market
          : 'All';
  */
  const workModeFilter = params.workMode && params.workMode !== 'All' ? params.workMode : 'All';
  const portalFilter = params.portalType && params.portalType !== 'All' ? params.portalType : 'All';

  // Step 1: Derive tailored search keywords from the candidate's actual resume using Gemini
  const { response: planResponse } = await generateContentWithRetry(ai, {
    contents: `Extract 3 concise job-board search terms (1-3 words each) and primary domain/seniority strictly from this candidate's resume and optional user query.
CANDIDATE RESUME:
Name: ${profile.fullName}
Headline: ${profile.headline}
Location: ${profile.location}
Summary: ${profile.summary}
Skills: ${profile.skills.join(', ')}
Experience: ${profile.experience.slice(0, 4).map((e) => `${e.title} at ${e.company}`).join('; ')}
Education: ${profile.education.map((e) => `${e.degree} (${e.institution})`).join('; ')}
User Query: ${cleanQuery || '(none)'}
Target Country: ${countryFilter}`,
    config: {
      systemInstruction: TRUTHFULNESS_LOCK_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          searchTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
          primaryDomain: { type: Type.STRING },
          preferredMarket: { type: Type.STRING },
        },
        required: ['searchTerms', 'primaryDomain'],
      },
    },
  });

  const planParsed = JSON.parse((planResponse.text ?? '{}').trim() || '{}') as {
    searchTerms?: string[];
    primaryDomain?: string;
  };
  const derivedSearchTerms = Array.from(
    new Set([
      ...(cleanQuery ? [cleanQuery] : []),
      ...(Array.isArray(planParsed.searchTerms) ? planParsed.searchTerms : []),
      ...summary.inferredTargetRoles.slice(0, 2),
      ...profile.skills.slice(0, 2),
    ])
  )
    .map((s) => String(s).trim())
    .filter((s) => s.length >= 2)
    .slice(0, 4);

  // Step 2: Query real allowlisted public job board & ATS JSON APIs in parallel from the backend
  const { candidates: liveCandidates, sources: liveSources } =
    await fetchLivePublicJobsFromAllowlistedApis(derivedSearchTerms, profile);

  // Filter & pre-rank live public postings against resume overlap + strict India filter + user filters
  const filteredLive = liveCandidates
    .filter((c) => {
      if (!matchesCountryFilter(c, countryFilter)) return false;
      if (workModeFilter !== 'All' && c.workMode !== workModeFilter) return false;
      if (portalFilter !== 'All' && c.portalType !== portalFilter) return false;
      return true;
    })
    .sort((a, b) => b.preliminaryScore - a.preliminaryScore);

  // Deduplicate live candidates by company + role
  const uniqueLive: LivePublicJobCandidate[] = [];
  const seenKeys = new Set<string>();
  for (const c of filteredLive) {
    const key = `${c.company.toLowerCase()}::${c.role.toLowerCase()}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueLive.push(c);
    }
    if (uniqueLive.length >= 14) break;
  }

  const countryInstruction = `STRICT COUNTRY LOCK (MANDATORY — INDIA ONLY): The app is currently focused exclusively on Country = "${countryFilter}".
- EVERY SINGLE job you return MUST be physically located in or explicitly hiring in India (e.g., Bengaluru, Mumbai, Hyderabad, Pune, Chennai, Delhi NCR, Noida, Gurugram, or "Remote (India)").
- Every job's "location" field MUST explicitly include "India" (for example: "Bengaluru, India" or "Remote (India)").
- Set "country" to "India" and "market" to "India".
- Use Indian salary conventions in INR LPA (e.g. "₹18L – ₹28L CTC").
- NEVER return jobs located in any other country or generic "Worldwide / Global" roles.`;
  /* Other regions commented out — focusing on India first
  const multiCountryFallback = `Include a relevant mix of jobs matching the candidate's location (${profile.location || 'Global'}) and active Market filter (${marketFilter}). Set each job's "country" to its primary country name (e.g. "India", "United States", "United Kingdom", "Germany", "Canada", "Singapore", "Australia", "United Arab Emirates", "Netherlands", "Ireland", or "Global").`;
  */

  // Step 3: Use Gemini 4 Hydrogen structured JSON to score & rerank the live public jobs against the exact resume
  const rankPrompt = `You are the CareerPilot AI backend Resume-to-Job Matching Engine.

CANDIDATE RESUME (MASTER PROFILE):
Name: ${profile.fullName}
Headline: ${profile.headline}
Location: ${profile.location}
Summary: ${profile.summary}
Verified Skills: ${profile.skills.join(', ')}
Experience:
${profile.experience
  .slice(0, 5)
  .map(
    (e) =>
      `- ${e.title} at ${e.company} (${e.startDate} – ${e.endDate}, ${e.location}): ${e.bullets.slice(0, 3).join(' | ')}`
  )
  .join('\n')}
Education: ${profile.education.map((ed) => `${ed.degree} — ${ed.institution} (${ed.graduationYear})`).join('; ')}
Projects: ${profile.projects.map((p) => `${p.name} [${p.techStack.join(', ')}]: ${p.description}`).join('; ')}
Q&A Vault Preferences: Expected CTC=${vault.expectedCtc || 'Market'}, Relocation=${vault.relocationPreference || profile.location}

ACTIVE BACKEND SEARCH FILTERS:
Query: ${cleanQuery || '(derived from resume)'}
Selected Country: ${countryFilter}
Market: ${marketFilter}
Work Mode: ${workModeFilter}
Portal: ${portalFilter}

LIVE PUBLIC ATS / JOB BOARD CANDIDATES FETCHED BY BACKEND (${uniqueLive.length} real postings already filtered for ${countryFilter}):
${JSON.stringify(
  uniqueLive.map((c) => ({
    candidateId: c.id,
    company: c.company,
    role: c.role,
    location: c.location,
    country: inferJobCountry(c.location, c.market, c.salary),
    market: c.market,
    salary: c.salary,
    workMode: c.workMode,
    portalType: c.portalType,
    jobUrl: c.jobUrl,
    postedAgo: c.postedAgo,
    descriptionSnippet: c.description.slice(0, 420),
  })),
  null,
  2
)}

INSTRUCTIONS:
1. ${countryInstruction}
2. Evaluate the LIVE PUBLIC CANDIDATES above against the candidate's actual resume. Keep genuinely relevant live postings (preserving their exact candidateId, company, role, and jobUrl) and compute an honest ATS matchScore (0-100), verified matchedKeywords (ONLY skills/experience present in the candidate's resume), missingKeywords, and a concise 1-sentence resumeMatchReason.
3. If fewer than 8 of the live postings strongly fit the candidate's specific resume domain, seniority, and Selected Country (${countryFilter}), include additional resume-aligned openings located specifically in ${countryFilter} so the final list has 8 high-relevance jobs total. For any supplemental role, set candidateId to "" and use a real public company careers or ATS/Naukri search URL (https://...).
4. Obey the TRUTHFULNESS LOCK strictly: never put any skill absent from the candidate's resume into matchedKeywords.
5. Sort output by matchScore descending.`;

  const { response: rankResponse } = await generateContentWithRetry(ai, {
    contents: rankPrompt,
    config: {
      systemInstruction: TRUTHFULNESS_LOCK_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          jobs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                candidateId: { type: Type.STRING },
                company: { type: Type.STRING },
                role: { type: Type.STRING },
                location: { type: Type.STRING },
                country: { type: Type.STRING },
                market: { type: Type.STRING },
                salary: { type: Type.STRING },
                workMode: { type: Type.STRING },
                portalType: { type: Type.STRING },
                portalComplexity: { type: Type.STRING },
                matchScore: { type: Type.INTEGER },
                matchedKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                resumeMatchReason: { type: Type.STRING },
                description: { type: Type.STRING },
                jobUrl: { type: Type.STRING },
                postedAgo: { type: Type.STRING },
              },
              required: [
                'company',
                'role',
                'location',
                'country',
                'market',
                'workMode',
                'portalType',
                'matchScore',
                'matchedKeywords',
                'missingKeywords',
                'resumeMatchReason',
                'description',
              ],
            },
          },
        },
        required: ['jobs'],
      },
    },
  });

  const rankedParsed = JSON.parse((rankResponse.text ?? '{}').trim() || '{}') as {
    jobs?: Array<Record<string, unknown>>;
  };
  const rawJobs = Array.isArray(rankedParsed.jobs) ? rankedParsed.jobs : [];
  if (rawJobs.length === 0) {
    throw new Error('Backend resume matcher returned no job results. Please retry.');
  }

  const liveById = new Map(uniqueLive.map((c) => [c.id, c]));
  const validPortals: PortalType[] = ['Greenhouse', 'Lever', 'Ashby', 'Workday', 'Naukri'];
  const validWorkModes: WorkMode[] = ['Remote', 'Hybrid', 'On-site'];
  const nowIso = new Date().toISOString();

  const mappedJobs: JobListing[] = rawJobs.slice(0, 12).map((item, idx) => {
    const cid = String(item.candidateId || '').trim();
    const matchedLive = cid ? liveById.get(cid) : undefined;

    const company = (matchedLive?.company || String(item.company || 'Employer')).trim().slice(0, 120);
    const role = (matchedLive?.role || String(item.role || 'Open Role')).trim().slice(0, 160);
    const location = (
      matchedLive?.location ||
      String(item.location || `${profile.location || 'Bengaluru'}, India`)
    )
      .trim()
      .slice(0, 120);
    const salary = (matchedLive?.salary || String(item.salary || 'Not disclosed')).trim().slice(0, 100);

    const explicitCountry = String(item.country || '').trim();
    const rawMarket = matchedLive?.market || String(item.market || '');
    const inferredCountry = inferJobCountry(location, rawMarket, salary, explicitCountry);

    const market: 'India' | 'Global' =
      inferredCountry === 'India' ||
      rawMarket === 'India' ||
      COUNTRY_LOCATION_PATTERNS.India.test(location) ||
      /₹|\binr\b|\blpa\b/i.test(salary)
        ? 'India'
        : 'Global';

    const rawPortal = matchedLive?.portalType || String(item.portalType || '');
    const inferredUrl = matchedLive?.jobUrl || String(item.jobUrl || '').trim();
    let portalType: PortalType = validPortals.includes(rawPortal as PortalType)
      ? (rawPortal as PortalType)
      : /lever\.co/i.test(inferredUrl)
        ? 'Lever'
        : /ashbyhq\.com/i.test(inferredUrl)
          ? 'Ashby'
          : /myworkdayjobs\.com|workday/i.test(inferredUrl)
            ? 'Workday'
            : /naukri\.com/i.test(inferredUrl)
              ? 'Naukri'
              : 'Greenhouse';

    if (portalFilter !== 'All' && validPortals.includes(portalFilter as PortalType)) {
      portalType = portalFilter as PortalType;
    }

    const rawMode = matchedLive?.workMode || String(item.workMode || '');
    const workMode: WorkMode = validWorkModes.includes(rawMode as WorkMode)
      ? (rawMode as WorkMode)
      : /remote/i.test(location)
        ? 'Remote'
        : 'Hybrid';

    const portalComplexity: PortalComplexity =
      item.portalComplexity === 'Multi-Step' || portalType === 'Workday' || portalType === 'Naukri'
        ? 'Multi-Step'
        : '1-Click';

    const safeJobUrl = isSafePublicJobUrl(inferredUrl)
      ? inferredUrl.slice(0, 500)
      : market === 'India' && portalType === 'Naukri'
        ? `https://www.naukri.com/${encodeURIComponent(role.toLowerCase().replace(/\s+/g, '-'))}-jobs`
        : `https://www.google.com/search?q=${encodeURIComponent(`${company} ${role} ${location} jobs`)}`;

    const proposedMatched = Array.isArray(item.matchedKeywords)
      ? item.matchedKeywords.map(String)
      : [];
    const proposedMissing = Array.isArray(item.missingKeywords)
      ? item.missingKeywords.map(String)
      : [];
    const { matchedKeywords, missingKeywords } = verifyKeywordsAgainstResume(
      proposedMatched,
      proposedMissing,
      profile
    );

    const rawScore = Number(item.matchScore);
    const matchScore = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(100, Math.round(rawScore)))
      : Math.max(55, Math.min(95, 62 + matchedKeywords.length * 5));

    const slug = `${company}_${role}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);

    return {
      id: `job_res_${slug}_${idx}`,
      company,
      role,
      location,
      country: inferredCountry,
      market,
      salary,
      workMode,
      portalType,
      portalComplexity,
      matchScore,
      matchedKeywords,
      missingKeywords,
      description: (
        matchedLive?.description ||
        String(item.description || `Open ${role} opportunity at ${company} matching your resume.`)
      )
        .trim()
        .slice(0, 5500),
      jobUrl: safeJobUrl,
      hiringTeam: {
        name: `${company} Talent Team`.slice(0, 80),
        title: matchedLive ? `Verified Public Board (${matchedLive.sourceLabel})` : 'Hiring Team · Public Careers',
        linkedinUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${company} ${role}`)}`,
        postedAgo: (matchedLive?.postedAgo || String(item.postedAgo || 'Live search')).trim().slice(0, 40),
        autoPurgeDaysRemaining: 30,
      },
      analyzedAt: nowIso,
      discoverySource: 'resume_backend_search',
      resumeMatchReason: String(
        item.resumeMatchReason ||
          `Matched against verified resume skills (${matchedKeywords.slice(0, 3).join(', ') || profile.headline}).`
      )
        .trim()
        .slice(0, 260),
    };
  });

  // Deterministic strict India post-filter: never leak non-India jobs
  const discoveredJobs = mappedJobs.filter((job) => matchesCountryFilter(job, countryFilter));

  // Preserve Not Interested flags across fresh live searches so dismissed postings stay flagged
  const existingNotInterestedByKey = new Map<string, string>();
  for (const prev of store.jobs) {
    if (prev.notInterested) {
      const k = `${prev.company.toLowerCase()}::${prev.role.toLowerCase()}`;
      existingNotInterestedByKey.set(k, prev.notInterestedAt || nowIso);
    }
  }

  const currentProfileHash = computeProfileHash(profile, vault);
  const customJobs = store.jobs.filter((j) => j.isCustom && matchesCountryFilter(j, countryFilter));
  const flaggedJobs = store.jobs.filter((j) => j.notInterested && matchesCountryFilter(j, countryFilter));
  const sameResume = store.lastDiscoveredProfileHash === currentProfileHash;
  const baseJobsToKeep = sameResume
    ? store.jobs.filter((j) => matchesCountryFilter(j, countryFilter))
    : [...customJobs, ...flaggedJobs];

  const deduped = new Map<string, JobListing>();
  for (const job of [...discoveredJobs, ...baseJobsToKeep]) {
    const key = `${job.company.toLowerCase()}::${job.role.toLowerCase()}`;
    if (!deduped.has(key)) {
      const flaggedAt = existingNotInterestedByKey.get(key);
      deduped.set(
        key,
        flaggedAt
          ? { ...job, notInterested: true, notInterestedAt: flaggedAt }
          : job
      );
    }
    if (deduped.size >= 48) break;
  }

  store.jobs = Array.from(deduped.values());
  store.lastDiscoveredAt = nowIso;
  store.lastDiscoveredProfileHash = currentProfileHash;
  store.groundingSources = liveSources;
  saveStore(store);

  return { discoveredJobs, groundingSources: liveSources };
}

function createSeedStore(): ServerStore {
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

  const masterProfile: MasterProfile = {
    fullName: 'Ananya Deshmukh',
    headline: 'Senior Full-Stack & Frontend Engineer (React, TypeScript, Node.js, Design Systems)',
    email: 'ananya.deshmukh@example.com',
    phone: '+91 98450 11204',
    location: 'Bengaluru, India',
    summary:
      'Product-focused software engineer with 6+ years building high-throughput fintech checkout experiences, accessible React/TypeScript web platforms, and resilient Node.js APIs across Indian and global markets.',
    skills: [
      'React',
      'TypeScript',
      'Next.js',
      'Node.js',
      'Express',
      'Tailwind CSS',
      'GraphQL',
      'PostgreSQL',
      'Web Performance',
      'PWA & Service Workers',
      'Design Systems',
      'CI/CD',
      'Playwright',
    ],
    experience: [
      {
        id: 'exp-1',
        company: 'FinStack Payments',
        title: 'Senior Frontend Engineer',
        location: 'Bengaluru, India',
        startDate: 'Mar 2022',
        endDate: 'Present',
        bullets: [
          'Architected a modular React & TypeScript checkout SDK handling 1.8M monthly UPI and card transactions with 99.96% uptime.',
          'Reduced mobile checkout p95 First Contentful Paint by 41% via route-level code splitting, asset preloading, and PWA offline shell caching.',
          'Led a 4-engineer design system guild that unified 38 accessible UI primitives across merchant dashboards and consumer surfaces.',
          'Partnered with backend and risk teams to ship step-up OTP verification flows with clear human fallback diagnostics.',
        ],
      },
      {
        id: 'exp-2',
        company: 'CloudLedger Labs',
        title: 'Full-Stack Software Engineer',
        location: 'Mumbai, India',
        startDate: 'Jul 2019',
        endDate: 'Feb 2022',
        bullets: [
          'Built multi-currency invoicing and GST reconciliation modules in React, Node.js, and PostgreSQL for 14,000+ SMBs.',
          'Designed idempotent webhook ingestion pipelines and rate-limited REST APIs processing 250k daily ledger events.',
          'Improved automated test coverage from 34% to 82% using Playwright and Jest, cutting regression hotfixes by half.',
        ],
      },
    ],
    education: [
      {
        id: 'edu-1',
        institution: 'NIT Surathkal (National Institute of Technology Karnataka)',
        degree: 'B.Tech in Computer Science & Engineering',
        graduationYear: '2019',
        details: 'CGPA 8.7 / 10',
      },
    ],
    projects: [
      {
        id: 'proj-1',
        name: 'PayGrid Offline POS (PWA)',
        techStack: ['React', 'TypeScript', 'Workbox', 'IndexedDB'],
        description:
          'Offline-first merchant point-of-sale PWA with queued transaction sync and sub-100ms touch responsiveness on low-end Android devices.',
      },
    ],
    lastParsedAt: hoursAgo(12),
  };

  const qaVault: QAVault = {
    currentCtc: '₹31 LPA (Fixed) + ESOPs',
    expectedCtc: '₹42–48 LPA (India)',
    noticePeriodDays: '30',
    workAuthorization: 'Indian Citizen · Authorized to work in India',
    relocationPreference: 'Open to Bengaluru / Mumbai / Hyderabad Hybrid or Remote (India)',
    linkedinUrl: 'https://www.linkedin.com/in/ananya-deshmukh-eng',
    customQAs: [
      {
        id: 'cqa-1',
        question: 'Describe your experience optimizing web performance on mobile devices.',
        answer:
          'At FinStack Payments, I cut mobile checkout p95 FCP by 41% through route splitting, strict bundle budgets, and Workbox caching for low-bandwidth networks.',
        savedAt: hoursAgo(24),
      },
    ],
  };

  const jobs: JobListing[] = [
    {
      id: 'job-razorpay',
      company: 'Razorpay',
      role: 'Senior Frontend Engineer — Checkout Platform',
      location: 'Bengaluru, India',
      market: 'India',
      salary: '₹34L – ₹46L CTC',
      workMode: 'Hybrid',
      portalType: 'Greenhouse',
      portalComplexity: '1-Click',
      matchScore: 91,
      matchedKeywords: ['React', 'TypeScript', 'Web Performance', 'Checkout SDK', 'Design Systems', 'UPI'],
      missingKeywords: ['Micro-frontends'],
      description:
        'Build ultra-fast, reliable checkout flows powering millions of daily UPI, card, and netbanking transactions across India. Own bundle size budgets, React/TypeScript SDK architecture, accessibility, and p95 mobile latency.',
      jobUrl: 'https://boards.greenhouse.io/razorpay/jobs/checkout-senior-fe',
      hiringTeam: {
        name: 'Siddharth Kulkarni',
        title: 'Engineering Manager, Checkout Experience',
        linkedinUrl: 'https://www.linkedin.com/in/siddharth-kulkarni-checkout',
        postedAgo: '2 days ago',
        autoPurgeDaysRemaining: 28,
      },
      analyzedAt: hoursAgo(4),
    },
    /* Other regions commented out — focusing on India first
    {
      id: 'job-stripe',
      company: 'Stripe',
      role: 'Full-Stack Product Engineer — Global Billing',
      location: 'Remote (US / Global)',
      market: 'Global',
      salary: '$168k – $208k USD',
      workMode: 'Remote',
      portalType: 'Ashby',
      portalComplexity: '1-Click',
      matchScore: 89,
      matchedKeywords: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Multi-currency Invoicing', 'APIs'],
      missingKeywords: ['Ruby'],
      description:
        'Design and build developer-first billing, subscription, and multi-currency invoicing surfaces. Collaborate closely with product designers and API engineers to craft resilient, accessible UI and reliable idempotent backend workflows.',
      jobUrl: 'https://jobs.ashbyhq.com/stripe/global-billing-product-eng',
      hiringTeam: {
        name: 'Elena Rostova',
        title: 'Staff Recruiting Partner, Billing & Revenue',
        linkedinUrl: 'https://www.linkedin.com/in/elena-rostova-recruiting',
        postedAgo: '1 day ago',
        autoPurgeDaysRemaining: 29,
      },
      analyzedAt: hoursAgo(3),
    },
    */
    {
      id: 'job-swiggy',
      company: 'Swiggy',
      role: 'Staff UI Engineer — Consumer Mobile Web',
      location: 'Bengaluru, India',
      market: 'India',
      salary: '₹42L – ₹56L CTC',
      workMode: 'Hybrid',
      portalType: 'Naukri',
      portalComplexity: 'Multi-Step',
      matchScore: 84,
      matchedKeywords: ['React', 'TypeScript', 'PWA & Service Workers', 'Web Performance', 'Design Systems'],
      missingKeywords: ['React Native'],
      description:
        'Lead mobile-web performance and PWA resilience for Swiggy food and Instamart flows serving tens of millions of users on 4G Android devices. Drive design system adoption and Core Web Vitals optimization.',
      jobUrl: 'https://www.naukri.com/swiggy-staff-ui-bengaluru',
      hiringTeam: {
        name: 'Pranav Mehta',
        title: 'Principal Talent Partner, Consumer Tech',
        linkedinUrl: 'https://www.linkedin.com/in/pranav-mehta-talent',
        postedAgo: '4 days ago',
        autoPurgeDaysRemaining: 26,
      },
      analyzedAt: hoursAgo(6),
    },
    /* Other regions commented out — focusing on India first
    {
      id: 'job-linear',
      company: 'Linear',
      role: 'Senior Product Engineer',
      location: 'Remote (US / EU / Global)',
      market: 'Global',
      salary: '$175k – $215k USD',
      workMode: 'Remote',
      portalType: 'Ashby',
      portalComplexity: '1-Click',
      matchScore: 86,
      matchedKeywords: ['React', 'TypeScript', 'Web Performance', 'Design Systems', 'Offline-first'],
      missingKeywords: ['Sync Engine Internals'],
      description:
        'Craft snappy, keyboard-first, offline-capable web software with uncompromising visual polish and sub-50ms interaction latency. Work autonomously from concept to production across React, TypeScript, and local-first state.',
      jobUrl: 'https://jobs.ashbyhq.com/linear/senior-product-engineer',
      hiringTeam: {
        name: 'Marcus Lindqvist',
        title: 'Head of Engineering Recruiting',
        linkedinUrl: 'https://www.linkedin.com/in/marcus-lindqvist-linear',
        postedAgo: '3 days ago',
        autoPurgeDaysRemaining: 27,
      },
      analyzedAt: hoursAgo(5),
    },
    */
    {
      id: 'job-zepto',
      company: 'Zepto',
      role: 'Lead React & PWA Engineer',
      location: 'Mumbai, India',
      market: 'India',
      salary: '₹36L – ₹48L CTC',
      workMode: 'Hybrid',
      portalType: 'Lever',
      portalComplexity: '1-Click',
      matchScore: 81,
      matchedKeywords: ['React', 'TypeScript', 'PWA & Service Workers', 'Tailwind CSS', 'Web Performance'],
      missingKeywords: ['Webpack Module Federation'],
      description:
        'Own our rapid-commerce web storefront and dark-store operator PWA in Mumbai. Optimize checkout speed, offline resilience, and touch ergonomics for high-frequency mobile shoppers.',
      jobUrl: 'https://jobs.lever.co/zepto/lead-react-pwa-mumbai',
      hiringTeam: {
        name: 'Kavya Nair',
        title: 'Technical Recruiter, Engineering',
        linkedinUrl: 'https://www.linkedin.com/in/kavya-nair-zepto',
        postedAgo: '5 days ago',
        autoPurgeDaysRemaining: 25,
      },
      analyzedAt: hoursAgo(8),
    },
    /* Other regions commented out — focusing on India first
    {
      id: 'job-vercel',
      company: 'Vercel',
      role: 'Senior Software Engineer — Developer Experience',
      location: 'Remote (Global)',
      market: 'Global',
      salary: '$170k – $210k USD',
      workMode: 'Remote',
      portalType: 'Greenhouse',
      portalComplexity: '1-Click',
      matchScore: 83,
      matchedKeywords: ['Next.js', 'React', 'TypeScript', 'Node.js', 'CI/CD', 'Design Systems'],
      missingKeywords: ['Rust'],
      description:
        'Build Next.js dashboard workflows, deployment observability UIs, and developer tooling used by millions of frontend teams worldwide.',
      jobUrl: 'https://boards.greenhouse.io/vercel/jobs/senior-swe-dx',
      hiringTeam: {
        name: 'Jordan Brooks',
        title: 'Senior Technical Recruiter, DX',
        linkedinUrl: 'https://www.linkedin.com/in/jordan-brooks-dx',
        postedAgo: '2 days ago',
        autoPurgeDaysRemaining: 28,
      },
      analyzedAt: hoursAgo(7),
    },
    */
    {
      id: 'job-atlassian',
      company: 'Atlassian',
      role: 'Principal Frontend Architect — Jira Platform',
      location: 'Bengaluru, India',
      market: 'India',
      salary: '₹55L – ₹72L CTC',
      workMode: 'Remote',
      portalType: 'Workday',
      portalComplexity: 'Multi-Step',
      matchScore: 71,
      matchedKeywords: ['React', 'TypeScript', 'Design Systems', 'GraphQL'],
      missingKeywords: ['10+ yrs enterprise platform architecture', 'Java'],
      description:
        'Set multi-year frontend architectural direction across Jira Cloud enterprise modules, GraphQL federation, and cross-org UI accessibility standards.',
      jobUrl: 'https://atlassian.wd5.myworkdayjobs.com/en-US/careers/principal-fe',
      hiringTeam: {
        name: 'Deepak Sharma',
        title: 'Director of Engineering, Work Management',
        linkedinUrl: 'https://www.linkedin.com/in/deepak-sharma-workmgmt',
        postedAgo: '6 days ago',
        autoPurgeDaysRemaining: 24,
      },
      analyzedAt: hoursAgo(9),
    },
    {
      id: 'job-cred',
      company: 'CRED',
      role: 'Senior Web Platform Engineer',
      location: 'Bengaluru, India',
      market: 'India',
      salary: '₹38L – ₹52L CTC',
      workMode: 'On-site',
      portalType: 'Lever',
      portalComplexity: 'Multi-Step',
      matchScore: 74,
      matchedKeywords: ['React', 'TypeScript', 'Web Performance', 'Checkout SDK'],
      missingKeywords: ['WebGL / Three.js'],
      description:
        'Build high-craft web payment surfaces and interactive member experiences with smooth 60fps animations and strict financial reliability.',
      jobUrl: 'https://jobs.lever.co/cred/senior-web-platform',
      hiringTeam: {
        name: 'Rohan Malhotra',
        title: 'Staff Engineering Manager, Web',
        linkedinUrl: 'https://www.linkedin.com/in/rohan-malhotra-cred',
        postedAgo: '3 days ago',
        autoPurgeDaysRemaining: 27,
      },
      analyzedAt: hoursAgo(10),
    },
  ];

  const queue: QueueItem[] = [
    {
      id: 'q-razorpay',
      jobId: 'job-razorpay',
      company: 'Razorpay',
      role: 'Senior Frontend Engineer — Checkout Platform',
      location: 'Bengaluru, India',
      salary: '₹34L – ₹46L CTC',
      workMode: 'Hybrid',
      portalType: 'Greenhouse',
      portalComplexity: '1-Click',
      jobUrl: jobs[0].jobUrl,
      matchScore: 91,
      hiringTeam: jobs[0].hiringTeam,
      linkedinNote:
        'Hi Siddharth — I saw your Checkout Platform FE opening at Razorpay. Over the past 3 years at FinStack Payments I built a React/TS UPI checkout SDK (1.8M monthly txns) and cut mobile p95 FCP by 41%. Would love to connect!',
      resumeDiffs: [
        {
          id: 'diff-rzp-1',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Architected a modular React & TypeScript checkout SDK handling 1.8M monthly UPI and card transactions with 99.96% uptime.',
          after:
            'Architected a high-throughput React & TypeScript checkout SDK powering 1.8M monthly UPI and card transactions at 99.96% uptime (pinned as Bullet #1 for Checkout Platform alignment).',
          rationale: 'Promoted verified UPI/card checkout SDK bullet to lead position to mirror JD core focus.',
        },
        {
          id: 'diff-rzp-2',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Reduced mobile checkout p95 First Contentful Paint by 41% via route-level code splitting, asset preloading, and PWA offline shell caching.',
          after:
            'Cut mobile checkout p95 First Contentful Paint (FCP) by 41% through bundle-size budgets, route-level code splitting, asset preloading, and PWA shell caching.',
          rationale: 'Aligned verified performance metric directly with Razorpay p95 mobile latency keywords.',
        },
        {
          id: 'diff-rzp-3',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Led a 4-engineer design system guild that unified 38 accessible UI primitives across merchant dashboards and consumer surfaces.',
          after:
            'Led a 4-engineer design system initiative standardizing 38 WCAG-accessible UI primitives across consumer checkout and merchant web surfaces.',
          rationale: 'Surfaced accessibility and design systems alignment without altering verified team size or scope.',
        },
      ],
      screeningQuestions: [
        {
          id: 'sq-rzp-1',
          question: 'Why are you interested in Razorpay’s Checkout Platform team, and what relevant performance challenge have you solved?',
          answer:
            'I have spent the last three years building high-volume UPI and card checkout experiences in React and TypeScript at FinStack Payments (1.8M monthly transactions). My favorite performance win was reducing mobile checkout p95 FCP by 41% via route splitting and PWA shell caching—skills directly transferable to Razorpay’s scale.',
          confidence: 'AMBER',
          sourceLabel: 'AI draft · Review required',
          reviewed: false,
        },
        {
          id: 'sq-rzp-2',
          question: 'Current CTC (Annual Fixed + Variable)',
          answer: qaVault.currentCtc,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'currentCtc',
          reviewed: true,
        },
        {
          id: 'sq-rzp-3',
          question: 'Expected CTC',
          answer: qaVault.expectedCtc,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'expectedCtc',
          reviewed: true,
        },
        {
          id: 'sq-rzp-4',
          question: 'Notice Period (in days)',
          answer: `${qaVault.noticePeriodDays} days`,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'noticePeriodDays',
          reviewed: true,
        },
      ],
      createdAt: hoursAgo(3),
      status: 'pending',
    },
    /* Other regions commented out — focusing on India first
    {
      id: 'q-stripe',
      jobId: 'job-stripe',
      company: 'Stripe',
      role: 'Full-Stack Product Engineer — Global Billing',
      location: 'Remote (US / Global)',
      salary: '$168k – $208k USD',
      workMode: 'Remote',
      portalType: 'Ashby',
      portalComplexity: '1-Click',
      jobUrl: 'https://jobs.ashbyhq.com/stripe/global-billing-product-eng',
      matchScore: 89,
      hiringTeam: {
        name: 'Elena Rostova',
        title: 'Staff Recruiting Partner, Billing & Revenue',
        linkedinUrl: 'https://www.linkedin.com/in/elena-rostova-recruiting',
        postedAgo: '1 day ago',
        autoPurgeDaysRemaining: 29,
      },
      linkedinNote:
        'Hi Elena — I applied for Stripe’s Global Billing Product Engineer role. I previously built multi-currency invoicing & idempotent webhook pipelines at CloudLedger Labs and checkout SDKs at FinStack. Would love to connect!',
      resumeDiffs: [
        {
          id: 'diff-str-1',
          experienceRef: 'CloudLedger Labs · Full-Stack Software Engineer',
          before:
            'Built multi-currency invoicing and GST reconciliation modules in React, Node.js, and PostgreSQL for 14,000+ SMBs.',
          after:
            'Engineered multi-currency invoicing and tax reconciliation workflows in React, Node.js, and PostgreSQL serving 14,000+ SMBs (elevated for Global Billing relevance).',
          rationale: 'Highlighted verified multi-currency billing & full-stack PostgreSQL experience.',
        },
        {
          id: 'diff-str-2',
          experienceRef: 'CloudLedger Labs · Full-Stack Software Engineer',
          before:
            'Designed idempotent webhook ingestion pipelines and rate-limited REST APIs processing 250k daily ledger events.',
          after:
            'Designed idempotent webhook ingestion pipelines and rate-limited REST APIs handling 250k daily financial ledger events reliably.',
          rationale: 'Matched Stripe’s idempotent API reliability focus using exact verified metrics.',
        },
        {
          id: 'diff-str-3',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Partnered with backend and risk teams to ship step-up OTP verification flows with clear human fallback diagnostics.',
          after:
            'Collaborated across frontend, backend, and risk engineering to ship resilient payment verification flows with transparent fallback diagnostics.',
          rationale: 'Emphasized cross-functional full-stack product ownership strictly from Master Profile.',
        },
      ],
      screeningQuestions: [
        {
          id: 'sq-str-1',
          question: 'Tell us about a full-stack billing or financial system you built end-to-end and how you ensured reliability.',
          answer:
            'At CloudLedger Labs, I built multi-currency invoicing in React, Node.js, and PostgreSQL for 14,000+ SMBs alongside idempotent webhook ingestion pipelines handling 250k daily ledger events. Combining idempotency keys with automated Playwright/Jest tests (lifting coverage from 34% to 82%) cut regression hotfixes in half.',
          confidence: 'AMBER',
          sourceLabel: 'AI draft · Review required',
          reviewed: false,
        },
        {
          id: 'sq-str-2',
          question: 'Work Authorization / Visa Status',
          answer: qaVault.workAuthorization,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'workAuthorization',
          reviewed: true,
        },
        {
          id: 'sq-str-3',
          question: 'Relocation / Remote Work Preference',
          answer: qaVault.relocationPreference,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'relocationPreference',
          reviewed: true,
        },
        {
          id: 'sq-str-4',
          question: 'LinkedIn Profile URL',
          answer: qaVault.linkedinUrl,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'linkedinUrl',
          reviewed: true,
        },
      ],
      createdAt: hoursAgo(2),
      status: 'pending',
    },
    {
      id: 'q-linear',
      jobId: 'job-linear',
      company: 'Linear',
      role: 'Senior Product Engineer',
      location: 'Remote (US / EU / Global)',
      salary: '$175k – $215k USD',
      workMode: 'Remote',
      portalType: 'Ashby',
      portalComplexity: '1-Click',
      jobUrl: 'https://jobs.ashbyhq.com/linear/senior-product-engineer',
      matchScore: 86,
      hiringTeam: {
        name: 'Marcus Lindqvist',
        title: 'Head of Engineering Recruiting',
        linkedinUrl: 'https://www.linkedin.com/in/marcus-lindqvist-linear',
        postedAgo: '3 days ago',
        autoPurgeDaysRemaining: 27,
      },
      linkedinNote:
        'Hi Marcus — huge admirer of Linear’s speed and craft. I’ve built offline-first PWAs (IndexedDB/Workbox) and led a 38-component React/TS design system. Just reviewed my application for Senior Product Engineer — happy to connect!',
      resumeDiffs: [
        {
          id: 'diff-lin-1',
          experienceRef: 'PayGrid Offline POS · Project',
          before:
            'Offline-first merchant point-of-sale PWA with queued transaction sync and sub-100ms touch responsiveness on low-end Android devices.',
          after:
            'Built PayGrid, an offline-first React/TypeScript PWA using IndexedDB & Workbox with queued sync and sub-100ms interaction responsiveness.',
          rationale: 'Elevated verified offline-first local state project directly relevant to Linear.',
        },
        {
          id: 'diff-lin-2',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Led a 4-engineer design system guild that unified 38 accessible UI primitives across merchant dashboards and consumer surfaces.',
          after:
            'Led a 4-engineer design system guild unifying 38 accessible React & TypeScript UI primitives for consistent product craft across web surfaces.',
          rationale: 'Connected verified design systems craft to Linear’s product engineering bar.',
        },
        {
          id: 'diff-lin-3',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Reduced mobile checkout p95 First Contentful Paint by 41% via route-level code splitting, asset preloading, and PWA offline shell caching.',
          after:
            'Reduced p95 First Contentful Paint by 41% via route-level code splitting, preloading, and service worker caching.',
          rationale: 'Highlights verified latency discipline with exact original numbers.',
        },
      ],
      screeningQuestions: [
        {
          id: 'sq-lin-1',
          question: 'What is a web software detail or offline-first architecture decision you are especially proud of?',
          answer:
            'For PayGrid Offline POS, I paired IndexedDB queued mutation logs with Workbox shell caching in React/TypeScript so merchants kept sub-100ms interaction latency even when mobile connectivity dropped. At FinStack, I brought the same performance discipline to cut p95 FCP by 41%.',
          confidence: 'AMBER',
          sourceLabel: 'AI draft · Review required',
          reviewed: false,
        },
        {
          id: 'sq-lin-2',
          question: 'Expected Compensation Range',
          answer: qaVault.expectedCtc,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'expectedCtc',
          reviewed: true,
        },
        {
          id: 'sq-lin-3',
          question: 'Notice Period (Days)',
          answer: `${qaVault.noticePeriodDays} days`,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          vaultField: 'noticePeriodDays',
          reviewed: true,
        },
      ],
      createdAt: hoursAgo(1),
      status: 'pending',
    },
    */
  ];

  const tracker: TrackedApplication[] = [
    /* Other regions commented out — focusing on India first
    {
      id: 'tr-1',
      queueItemId: 'q-seed-vercel',
      jobId: 'job-vercel',
      company: 'Vercel',
      role: 'Senior Software Engineer — Developer Experience',
      location: 'Remote (Global)',
      salary: '$170k – $210k USD',
      portalType: 'Greenhouse',
      matchScore: 83,
      status: 'submitted',
      timestamp: hoursAgo(5),
      auditReceiptId: 'CP-2026-8419A',
      tailoredBulletsCount: 3,
      resumeDiffs: [
        {
          id: 'tr-diff-1',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Led a 4-engineer design system guild that unified 38 accessible UI primitives across merchant dashboards and consumer surfaces.',
          after:
            'Led a 4-engineer design system guild standardizing 38 accessible React & TypeScript UI primitives for developer and merchant dashboards.',
          rationale: 'Emphasized verified design systems & dashboard craft for Vercel DX.',
        },
      ],
      screeningQuestions: [
        {
          id: 'tr-sq-1',
          question: 'Work Authorization / Visa Status',
          answer: qaVault.workAuthorization,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          reviewed: true,
        },
      ],
      humanVerified: true,
    },
    */
    {
      id: 'tr-2',
      queueItemId: 'q-seed-swiggy',
      jobId: 'job-swiggy',
      company: 'Swiggy',
      role: 'Staff UI Engineer — Consumer Mobile Web',
      location: 'Bengaluru, India',
      salary: '₹42L – ₹56L CTC',
      portalType: 'Naukri',
      matchScore: 84,
      status: 'action_required',
      timestamp: hoursAgo(2),
      auditReceiptId: 'CP-2026-9032B',
      actionReason: 'Paused at portal CAPTCHA / Mobile OTP step — awaiting human completion.',
      tailoredBulletsCount: 3,
      resumeDiffs: [
        {
          id: 'tr-diff-2',
          experienceRef: 'FinStack Payments · Senior Frontend Engineer',
          before:
            'Reduced mobile checkout p95 First Contentful Paint by 41% via route-level code splitting, asset preloading, and PWA offline shell caching.',
          after:
            'Cut mobile web p95 First Contentful Paint by 41% via route-level code splitting, asset preloading, and PWA offline shell caching.',
          rationale: 'Aligned verified mobile web performance work with Swiggy Consumer Web.',
        },
      ],
      screeningQuestions: [
        {
          id: 'tr-sq-2',
          question: 'Notice Period (Days)',
          answer: `${qaVault.noticePeriodDays} days`,
          confidence: 'GREEN',
          sourceLabel: 'Q&A Vault · Verified fact',
          reviewed: true,
        },
      ],
      humanVerified: true,
    },
  ];

  return {
    masterProfile,
    qaVault,
    consentAccepted: true,
    jobs,
    queue,
    tracker,
    optOuts: [],
    selectedTier: 'tier4',
    submissionTimestamps: [now - 5 * 3600_000],
  };
}

function createEmptyUserStore(existingOptOuts: OptOutRecord[]): ServerStore {
  return {
    masterProfile: {
      fullName: '',
      headline: '',
      email: '',
      phone: '',
      location: '',
      summary: '',
      skills: [],
      experience: [],
      education: [],
      projects: [],
    },
    qaVault: {
      currentCtc: '',
      expectedCtc: '',
      noticePeriodDays: '',
      workAuthorization: '',
      relocationPreference: '',
      linkedinUrl: '',
      customQAs: [],
    },
    consentAccepted: false,
    jobs: createSeedStore().jobs,
    queue: [],
    tracker: [],
    optOuts: existingOptOuts,
    // Other regions commented out — focusing on India first ('tier1' paused)
    selectedTier: 'tier4',
    submissionTimestamps: [],
  };
}

function loadStore(): ServerStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as ServerStore;
      if (parsed && parsed.masterProfile && Array.isArray(parsed.jobs)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Could not read persisted store, starting fresh:', err);
  }
  const seeded = createSeedStore();
  saveStore(seeded);
  return seeded;
}

function saveStore(store: ServerStore): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpPath, STORE_PATH);
  } catch (err) {
    logServerError({ context: 'store.saveStore', error: err });
  }
}

let store: ServerStore = loadStore();

function computeGuardrails(): GuardrailStatus {
  const now = Date.now();
  const windowStart = now - 24 * 3600_000;
  // Prune timestamps older than 24h rolling window
  store.submissionTimestamps = store.submissionTimestamps.filter((ts) => ts >= windowStart);

  const tierCap = TIER_DAILY_CAPS[store.selectedTier] ?? HARD_MAX_DAILY_CAP;
  const dailyCap = Math.min(tierCap, HARD_MAX_DAILY_CAP);
  const usedLast24h = store.submissionTimestamps.length;
  const remainingToday = Math.max(0, dailyCap - usedLast24h);

  const lastTs =
    store.submissionTimestamps.length > 0
      ? Math.max(...store.submissionTimestamps)
      : null;
  const elapsedMs = lastTs ? now - lastTs : COOLDOWN_MS + 1;
  const cooldownSecondsRemaining =
    lastTs && elapsedMs < COOLDOWN_MS ? Math.ceil((COOLDOWN_MS - elapsedMs) / 1000) : 0;

  return {
    dailyCap,
    usedLast24h,
    remainingToday,
    cooldownSecondsRemaining,
    lastSubmissionAt: lastTs ? new Date(lastTs).toISOString() : null,
  };
}

function getClientPayload(): AppStatePayload {
  const isDifferentCandidateWithSeedLinkedIn =
    store.masterProfile.fullName.trim().length > 0 &&
    !store.masterProfile.fullName.toLowerCase().includes('ananya') &&
    store.qaVault.linkedinUrl.toLowerCase().includes('ananya-deshmukh-eng');

  if (isDifferentCandidateWithSeedLinkedIn) {
    store.qaVault.linkedinUrl = store.masterProfile.linkedinUrl || '';
    saveStore(store);
  }

  return {
    masterProfile: {
      ...store.masterProfile,
      linkedinUrl: store.masterProfile.linkedinUrl || store.qaVault.linkedinUrl || '',
    },
    qaVault: store.qaVault,
    consentAccepted: store.consentAccepted,
    jobs: store.jobs
      .map((job) => ({
        ...job,
        country: inferJobCountry(job.location, job.market, job.salary, job.country),
      }))
      .filter((job) => matchesCountryFilter(job, 'India')),
    queue: store.queue,
    tracker: store.tracker,
    optOuts: store.optOuts,
    selectedTier: store.selectedTier,
    guardrails: computeGuardrails(),
  };
}

function generateReceiptId(): string {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CP-2026-${rand}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // 1. Fetch full application state
  app.get('/api/state', (_req, res) => {
    res.json(getClientPayload());
  });

  // 2. Parse resume (PDF base64 or plain text) via Gemini API
  app.post('/api/profile/parse', async (req, res) => {
    try {
      const { resumeText, fileBase64, mimeType, fileName } = req.body as {
        resumeText?: string;
        fileBase64?: string;
        mimeType?: string;
        fileName?: string;
      };

      if (!resumeText?.trim() && !fileBase64?.trim()) {
        return res.status(400).json({ error: 'Please paste resume text or upload a PDF/text resume file.' });
      }

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({
          error:
            'Gemini API key is not configured on the server. Please add GEMINI_API_KEY in Settings > Secrets.',
        });
      }

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      let pdfExtractedLinkedIn: string | null = null;
      if (fileBase64 && mimeType) {
        const allowedMimes = ['application/pdf', 'text/plain'];
        if (!allowedMimes.includes(mimeType)) {
          return res.status(400).json({ error: 'Only PDF and plain text (.txt) resumes are supported.' });
        }
        if (mimeType === 'application/pdf') {
          try {
            const pdfBuf = Buffer.from(fileBase64, 'base64');
            pdfExtractedLinkedIn = extractLinkedInUrlFromPdfBuffer(pdfBuf);
          } catch {
            pdfExtractedLinkedIn = null;
          }
        }
        parts.push({
          inlineData: {
            mimeType,
            data: fileBase64,
          },
        });
      }

      const textExtractedLinkedIn = resumeText ? extractLinkedInUrlFromText(resumeText) : null;

      parts.push({
        text: `Parse the provided candidate resume into a clean structured JSON Master Profile.
Extract ONLY facts explicitly written in the resume. Do not invent employers, titles, dates, skills, or degrees.
IMPORTANT: Carefully extract the candidate's LinkedIn profile URL (e.g. "https://www.linkedin.com/in/..." or "linkedin.com/in/...") into the "linkedinUrl" field if present anywhere in the header, contact block, footer, or hyperlinks. If no LinkedIn profile is present, return an empty string "".
${pdfExtractedLinkedIn ? `\nDetected embedded PDF hyperlink: ${pdfExtractedLinkedIn}` : ''}
${resumeText ? `\n--- RESUME TEXT ---\n${resumeText.slice(0, 30000)}` : ''}`,
      });

      const { response } = await generateContentWithRetry(ai, {
        contents: { parts },
        config: {
          systemInstruction:
            'You are a strict, factual resume parser for CareerPilot AI. Extract structured fields accurately without inventing any data.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fullName: { type: Type.STRING },
              headline: { type: Type.STRING },
              email: { type: Type.STRING },
              phone: { type: Type.STRING },
              location: { type: Type.STRING },
              linkedinUrl: { type: Type.STRING },
              summary: { type: Type.STRING },
              skills: { type: Type.ARRAY, items: { type: Type.STRING } },
              experience: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    company: { type: Type.STRING },
                    title: { type: Type.STRING },
                    location: { type: Type.STRING },
                    startDate: { type: Type.STRING },
                    endDate: { type: Type.STRING },
                    bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
              },
              education: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    institution: { type: Type.STRING },
                    degree: { type: Type.STRING },
                    graduationYear: { type: Type.STRING },
                    details: { type: Type.STRING },
                  },
                },
              },
              projects: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    techStack: { type: Type.ARRAY, items: { type: Type.STRING } },
                    description: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const rawJson = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawJson);

      const geminiLinkedIn = normalizeCandidateLinkedInUrl(String(parsed.linkedinUrl || ''));
      const resolvedLinkedIn = pdfExtractedLinkedIn || textExtractedLinkedIn || geminiLinkedIn || '';
      const previousFullName = (store.masterProfile.fullName || '').trim().toLowerCase();
      const nextFullName = String(parsed.fullName || '').trim();
      const candidateChanged =
        Boolean(nextFullName) &&
        Boolean(previousFullName) &&
        nextFullName.toLowerCase() !== previousFullName;

      const structuredProfile: MasterProfile = {
        fullName: nextFullName,
        headline: String(parsed.headline || ''),
        email: String(parsed.email || ''),
        phone: String(parsed.phone || ''),
        location: String(parsed.location || ''),
        linkedinUrl: resolvedLinkedIn,
        summary: String(parsed.summary || ''),
        skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : [],
        experience: Array.isArray(parsed.experience)
          ? parsed.experience.map((exp: Record<string, unknown>, idx: number) => ({
              id: `exp-${Date.now()}-${idx}`,
              company: String(exp.company || ''),
              title: String(exp.title || ''),
              location: String(exp.location || ''),
              startDate: String(exp.startDate || ''),
              endDate: String(exp.endDate || ''),
              bullets: Array.isArray(exp.bullets) ? exp.bullets.map(String) : [],
            }))
          : [],
        education: Array.isArray(parsed.education)
          ? parsed.education.map((edu: Record<string, unknown>, idx: number) => ({
              id: `edu-${Date.now()}-${idx}`,
              institution: String(edu.institution || ''),
              degree: String(edu.degree || ''),
              graduationYear: String(edu.graduationYear || ''),
              details: edu.details ? String(edu.details) : '',
            }))
          : [],
        projects: Array.isArray(parsed.projects)
          ? parsed.projects.map((proj: Record<string, unknown>, idx: number) => ({
              id: `proj-${Date.now()}-${idx}`,
              name: String(proj.name || ''),
              techStack: Array.isArray(proj.techStack) ? proj.techStack.map(String) : [],
              description: String(proj.description || ''),
            }))
          : [],
        rawResumeText: resumeText?.slice(0, 30000),
        uploadedResumeFileName:
          typeof fileName === 'string' && fileName.trim()
            ? fileName.trim().slice(0, 160)
            : fileBase64
              ? 'Uploaded Resume.pdf'
              : undefined,
        lastParsedAt: new Date().toISOString(),
      };

      store.masterProfile = structuredProfile;
      // Sync extracted LinkedIn URL into Screening Q&A Vault; clear stale previous candidate's URL if candidate changed
      if (resolvedLinkedIn) {
        store.qaVault = {
          ...store.qaVault,
          linkedinUrl: resolvedLinkedIn,
        };
      } else if (candidateChanged) {
        store.qaVault = {
          ...store.qaVault,
          linkedinUrl: '',
        };
      }
      // Immediately re-score existing backend jobs against the newly parsed resume and clear stale discovery hash
      store.jobs = store.jobs.map((job) => rescoreCatalogJobForResume(job, structuredProfile));
      store.lastDiscoveredProfileHash = null;
      saveStore(store);

      return res.json({
        profile: structuredProfile,
        extractedLinkedInUrl: resolvedLinkedIn || null,
        state: getClientPayload(),
      });
    } catch (err) {
      const eventId = logServerError({ context: 'api.profile.parse', error: err, req, statusCode: 500 });
      const message = err instanceof Error ? err.message : 'Failed to parse resume with Gemini API.';
      return res.status(500).json({ error: message, eventId });
    }
  });

  // 3. Save Master Profile, Q&A Vault, and Consent Checkbox
  app.put('/api/profile', (req, res) => {
    const { masterProfile, qaVault, consentAccepted } = req.body as {
      masterProfile?: MasterProfile;
      qaVault?: QAVault;
      consentAccepted?: boolean;
    };

    let normalizedLinkedIn = qaVault?.linkedinUrl?.trim() ?? masterProfile?.linkedinUrl?.trim() ?? '';
    if (normalizedLinkedIn) {
      const candidateNormalized = normalizeCandidateLinkedInUrl(normalizedLinkedIn);
      if (candidateNormalized) {
        normalizedLinkedIn = candidateNormalized;
      } else if (!/^https?:\/\//i.test(normalizedLinkedIn) && /^[\w.-]+\.[a-z]{2,}/i.test(normalizedLinkedIn)) {
        normalizedLinkedIn = `https://${normalizedLinkedIn}`;
      }
      if (!isValidHttpUrl(normalizedLinkedIn)) {
        return res.status(400).json({ error: 'LinkedIn Profile URL must be a valid http(s) URL.' });
      }
    }

    if (masterProfile) {
      store.masterProfile = {
        ...masterProfile,
        linkedinUrl: normalizedLinkedIn || masterProfile.linkedinUrl || '',
      };
      store.jobs = store.jobs.map((job) => rescoreCatalogJobForResume(job, store.masterProfile));
      store.lastDiscoveredProfileHash = null;
    }
    if (qaVault) {
      store.qaVault = {
        ...qaVault,
        linkedinUrl: normalizedLinkedIn,
      };
      if (store.masterProfile) {
        store.masterProfile.linkedinUrl = normalizedLinkedIn;
      }
    }
    if (typeof consentAccepted === 'boolean') {
      store.consentAccepted = consentAccepted;
    }

    saveStore(store);
    return res.json(getClientPayload());
  });

  // 3B. Search ALL jobs in the backend (resume-scored catalog search & filtering)
  app.post('/api/jobs/search', (req, res) => {
    const body = (req.body || {}) as {
      query?: unknown;
      country?: unknown;
      market?: unknown;
      workMode?: unknown;
      portalType?: unknown;
      minMatch?: unknown;
      notInterestedMode?: unknown;
    };

    const queryStr = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';
    const country = sanitizeCountryFilter(body.country);
    const market = 'India';
    /* Other regions commented out — focusing on India first
    const market =
      country === 'India'
        ? 'India'
        : country !== 'All'
          ? 'Global'
          : typeof body.market === 'string' && ['All', 'India', 'Global'].includes(body.market)
            ? body.market
            : 'All';
    */
    const workMode =
      typeof body.workMode === 'string' && ['All', 'Remote', 'Hybrid', 'On-site'].includes(body.workMode)
        ? body.workMode
        : 'All';
    const portalType =
      typeof body.portalType === 'string' &&
      ['All', 'Greenhouse', 'Lever', 'Ashby', 'Workday', 'Naukri'].includes(body.portalType)
        ? body.portalType
        : 'All';
    const minMatch =
      typeof body.minMatch === 'number' && Number.isFinite(body.minMatch)
        ? Math.max(0, Math.min(100, Math.round(body.minMatch)))
        : 0;
    const notInterestedMode: 'hide' | 'only' | 'all' =
      body.notInterestedMode === 'only' || body.notInterestedMode === 'all'
        ? body.notInterestedMode
        : 'hide';

    // Ensure every backend job reflects current resume match if resume changed
    const currentHash = computeProfileHash(store.masterProfile, store.qaVault);
    if (store.lastDiscoveredProfileHash !== currentHash && extractResumeSummary(store.masterProfile).hasResume) {
      store.jobs = store.jobs.map((job) => rescoreCatalogJobForResume(job, store.masterProfile));
    }

    const filtered = filterAndRankBackendJobs(store.jobs, {
      query: queryStr,
      country,
      market,
      workMode,
      portalType,
      minMatch,
      notInterestedMode,
    });

    const indiaJobs = store.jobs.filter((job) => matchesCountryFilter(job, 'India'));
    const notInterestedCount = indiaJobs.filter((job) => Boolean(job.notInterested)).length;
    const activeIndiaCatalogCount = indiaJobs.length - notInterestedCount;
    const payload: BackendJobSearchResponse = {
      jobs: filtered,
      totalCatalogCount: notInterestedMode === 'only' ? notInterestedCount : activeIndiaCatalogCount,
      notInterestedCount,
      resumeProfileSummary: extractResumeSummary(store.masterProfile),
      groundingSources: store.groundingSources ?? [],
      lastDiscoveredAt: store.lastDiscoveredAt ?? null,
      searchMode: 'backend_catalog',
    };

    return res.json(payload);
  });

  // 3C. Live Resume-Based Job Discovery in Backend (Allowlisted Public APIs + Gemini Reranking)
  app.post('/api/jobs/discover', async (req, res) => {
    try {
      const body = (req.body || {}) as {
        query?: unknown;
        country?: unknown;
        market?: unknown;
        workMode?: unknown;
        portalType?: unknown;
        minMatch?: unknown;
        notInterestedMode?: unknown;
      };

      const queryStr = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';
      const country = sanitizeCountryFilter(body.country);
      const market = 'India';
      /* Other regions commented out — focusing on India first
      const market =
        country === 'India'
          ? 'India'
          : country !== 'All'
            ? 'Global'
            : typeof body.market === 'string' && ['All', 'India', 'Global'].includes(body.market)
              ? body.market
              : 'All';
      */
      const workMode =
        typeof body.workMode === 'string' && ['All', 'Remote', 'Hybrid', 'On-site'].includes(body.workMode)
          ? body.workMode
          : 'All';
      const portalType =
        typeof body.portalType === 'string' &&
        ['All', 'Greenhouse', 'Lever', 'Ashby', 'Workday', 'Naukri'].includes(body.portalType)
          ? body.portalType
          : 'All';
      const minMatch =
        typeof body.minMatch === 'number' && Number.isFinite(body.minMatch)
          ? Math.max(0, Math.min(100, Math.round(body.minMatch)))
          : 0;
      const notInterestedMode: 'hide' | 'only' | 'all' =
        body.notInterestedMode === 'only' || body.notInterestedMode === 'all'
          ? body.notInterestedMode
          : 'hide';

      const { discoveredJobs, groundingSources } = await discoverJobsFromResumeInBackend({
        query: queryStr,
        country,
        market,
        workMode,
        portalType,
      });

      const filtered = filterAndRankBackendJobs(store.jobs, {
        query: queryStr,
        country,
        market,
        workMode,
        portalType,
        minMatch,
        notInterestedMode,
      });

      const indiaJobs = store.jobs.filter((job) => matchesCountryFilter(job, 'India'));
      const notInterestedCount = indiaJobs.filter((job) => Boolean(job.notInterested)).length;
      const activeIndiaCatalogCount = indiaJobs.length - notInterestedCount;
      return res.json({
        jobs: filtered,
        totalCatalogCount: notInterestedMode === 'only' ? notInterestedCount : activeIndiaCatalogCount,
        notInterestedCount,
        discoveredCount: discoveredJobs.length,
        resumeProfileSummary: extractResumeSummary(store.masterProfile),
        groundingSources,
        lastDiscoveredAt: store.lastDiscoveredAt ?? null,
        searchMode: 'live_resume_search',
        state: getClientPayload(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to search live jobs for your resume on the backend.';
      const status = message.includes('GEMINI_API_KEY') ? 503 : message.includes('Master Profile') ? 400 : 500;
      const eventId = logServerError({ context: 'api.jobs.discover', error: err, req, statusCode: status });
      return res.status(status).json({ error: message, eventId });
    }
  });

  // 4. Analyze a seeded or custom Job Description via Gemini (ATS Match + Truthful Tailoring + Queue)
  app.post('/api/jobs/analyze', async (req, res) => {
    try {
      const { jobId, customJob, forceQueue } = req.body as {
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
      };

      if (!store.masterProfile.fullName && store.masterProfile.experience.length === 0) {
        return res.status(400).json({
          error: 'Please complete or parse your Master Profile before analyzing jobs.',
        });
      }

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({
          error:
            'Gemini API key is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets.',
        });
      }

      let targetJob: JobListing | undefined;
      if (jobId) {
        targetJob = store.jobs.find((j) => j.id === jobId);
        if (!targetJob) {
          return res.status(404).json({ error: 'Job listing not found.' });
        }
      } else if (customJob && (customJob.description?.trim() || customJob.jobUrl?.trim())) {
        if (customJob.jobUrl && !isValidHttpUrl(customJob.jobUrl)) {
          return res.status(400).json({ error: 'Job URL must start with http:// or https://.' });
        }
        const safePortal: PortalType = ['Greenhouse', 'Lever', 'Ashby', 'Workday', 'Naukri'].includes(
          customJob.portalType || ''
        )
          ? (customJob.portalType as PortalType)
          : 'Greenhouse';
        const safeMode: WorkMode = ['Remote', 'Hybrid', 'On-site'].includes(customJob.workMode || '')
          ? (customJob.workMode as WorkMode)
          : 'Remote';

        targetJob = {
          id: `job-custom-${Date.now()}`,
          company: customJob.company?.trim() || 'Target Employer',
          role: customJob.role?.trim() || 'Analyzed Role',
          location: customJob.location?.trim() || 'Global / Remote',
          market: /india|bengaluru|bangalore|mumbai|hyderabad|pune|delhi|₹|inr|lpa/i.test(
            `${customJob.location || ''} ${customJob.salary || ''} ${customJob.description || ''}`
          )
            ? 'India'
            : 'Global',
          salary: customJob.salary?.trim() || 'Not disclosed',
          workMode: safeMode,
          portalType: safePortal,
          portalComplexity: safePortal === 'Workday' || safePortal === 'Naukri' ? 'Multi-Step' : '1-Click',
          matchScore: 0,
          matchedKeywords: [],
          missingKeywords: [],
          description: (customJob.description || `Job posting reference: ${customJob.jobUrl}`).slice(0, 12000),
          jobUrl: customJob.jobUrl?.trim() || 'https://example.com/careers',
          hiringTeam: {
            name: customJob.recruiterName?.trim() || 'Hiring Team Contact',
            title: 'Engineering Recruiting Partner',
            linkedinUrl: 'https://www.linkedin.com/jobs/',
            postedAgo: 'Analyzed just now',
            autoPurgeDaysRemaining: 30,
          },
          analyzedAt: new Date().toISOString(),
          isCustom: true,
        };
      } else {
        return res.status(400).json({ error: 'Provide either a jobId or custom job description/URL to analyze.' });
      }

      const prompt = `Analyze the following candidate Master Profile and Q&A Vault against the target Job Description.

CANDIDATE MASTER PROFILE:
${JSON.stringify(store.masterProfile, null, 2)}

CANDIDATE Q&A VAULT:
${JSON.stringify(store.qaVault, null, 2)}

TARGET JOB:
Company: ${targetJob.company}
Role: ${targetJob.role}
Location: ${targetJob.location}
Salary: ${targetJob.salary}
Portal Type: ${targetJob.portalType}
Description:
${targetJob.description}

TASKS:
1. If Company, Role, Location, or Salary were generic placeholders ("Target Employer", "Analyzed Role", "Not disclosed"), infer them accurately from the Job Description text if mentioned; otherwise keep them.
2. Compute an honest ATS Match Score (integer 0 to 100) based strictly on verified overlap between the Master Profile and JD.
3. Determine portalComplexity: "1-Click" (typical for Greenhouse, Lever, Ashby) or "Multi-Step" (typical for Workday, Naukri, complex forms).
4. List matchedKeywords (verified in profile) and missingKeywords (in JD but absent in profile).
5. Produce 3 to 4 resumeDiffs: select EXISTING bullets from the candidate's Master Profile experience or projects, keep the exact "before" bullet verbatim, and provide a keyword-aligned "after" bullet that strictly obeys the TRUTHFULNESS LOCK (zero fabricated skills, employers, titles, dates, or metrics).
6. Draft 1 to 2 subjective essay/motivation screening questions ("amberQuestions") with truthful AI-drafted answers referencing ONLY real Master Profile facts.
7. Draft a personalized LinkedIn connection note ("linkedinNote") strictly UNDER 270 characters addressed to ${targetJob.hiringTeam.name} (first name only) referencing verified experience from the profile.`;

      const { response } = await generateContentWithRetry(ai, {
        contents: prompt,
        config: {
          systemInstruction: TRUTHFULNESS_LOCK_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              inferredCompany: { type: Type.STRING },
              inferredRole: { type: Type.STRING },
              inferredLocation: { type: Type.STRING },
              inferredSalary: { type: Type.STRING },
              matchScore: { type: Type.INTEGER },
              portalComplexity: { type: Type.STRING },
              matchedKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              linkedinNote: { type: Type.STRING },
              resumeDiffs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    experienceRef: { type: Type.STRING },
                    before: { type: Type.STRING },
                    after: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                  },
                },
              },
              amberQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    answer: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const result = JSON.parse((response.text ?? '{}').trim());
      const boundedScore = Math.max(0, Math.min(100, Number(result.matchScore) || 70));
      const complexity: PortalComplexity =
        result.portalComplexity === 'Multi-Step' ? 'Multi-Step' : '1-Click';

      const updatedJob: JobListing = {
        ...targetJob,
        company:
          targetJob.company === 'Target Employer' && result.inferredCompany
            ? String(result.inferredCompany)
            : targetJob.company,
        role:
          targetJob.role === 'Analyzed Role' && result.inferredRole
            ? String(result.inferredRole)
            : targetJob.role,
        location:
          targetJob.location === 'Global / Remote' && result.inferredLocation
            ? String(result.inferredLocation)
            : targetJob.location,
        salary:
          targetJob.salary === 'Not disclosed' && result.inferredSalary
            ? String(result.inferredSalary)
            : targetJob.salary,
        matchScore: boundedScore,
        portalComplexity: complexity,
        matchedKeywords: Array.isArray(result.matchedKeywords)
          ? result.matchedKeywords.map(String).slice(0, 8)
          : [],
        missingKeywords: Array.isArray(result.missingKeywords)
          ? result.missingKeywords.map(String).slice(0, 6)
          : [],
        analyzedAt: new Date().toISOString(),
        notInterested: false,
        notInterestedAt: undefined,
      };

      const existingIdx = store.jobs.findIndex((j) => j.id === updatedJob.id);
      if (existingIdx >= 0) {
        store.jobs[existingIdx] = updatedJob;
      } else {
        store.jobs.unshift(updatedJob);
      }

      const shouldQueue = boundedScore > 75 || Boolean(forceQueue);
      let queuedItem: QueueItem | null = null;

      if (shouldQueue) {
        const diffs: ResumeDiffItem[] = (Array.isArray(result.resumeDiffs) ? result.resumeDiffs : [])
          .slice(0, 4)
          .map((d: Record<string, unknown>, idx: number) => ({
            id: `diff-${Date.now()}-${idx}`,
            experienceRef: String(d.experienceRef || 'Master Profile'),
            before: String(d.before || ''),
            after: String(d.after || ''),
            rationale: String(d.rationale || 'Aligned with job description keywords.'),
          }));

        const amberAnswers: ScreeningAnswer[] = (
          Array.isArray(result.amberQuestions) ? result.amberQuestions : []
        )
          .slice(0, 2)
          .map((q: Record<string, unknown>, idx: number) => ({
            id: `sq-amber-${Date.now()}-${idx}`,
            question: String(q.question || 'Why does this role fit your background?'),
            answer: String(q.answer || ''),
            confidence: 'AMBER' as const,
            sourceLabel: 'AI draft · Review required',
            reviewed: false,
          }));

        const greenAnswers: ScreeningAnswer[] = [
          {
            id: `sq-green-ctc-${Date.now()}`,
            question: updatedJob.market === 'India' ? 'Current & Expected CTC' : 'Expected Compensation',
            answer:
              updatedJob.market === 'India'
                ? `Current: ${store.qaVault.currentCtc || 'Not set'} | Expected: ${store.qaVault.expectedCtc || 'Not set'}`
                : store.qaVault.expectedCtc || 'Open to market range',
            confidence: 'GREEN',
            sourceLabel: 'Q&A Vault · Verified fact',
            vaultField: 'expectedCtc',
            reviewed: true,
          },
          {
            id: `sq-green-notice-${Date.now()}`,
            question: 'Notice Period / Availability',
            answer: store.qaVault.noticePeriodDays
              ? `${store.qaVault.noticePeriodDays} days`
              : 'Immediate / Negotiable',
            confidence: 'GREEN',
            sourceLabel: 'Q&A Vault · Verified fact',
            vaultField: 'noticePeriodDays',
            reviewed: true,
          },
          {
            id: `sq-green-auth-${Date.now()}`,
            question: 'Work Authorization & Relocation',
            answer: [store.qaVault.workAuthorization, store.qaVault.relocationPreference]
              .filter(Boolean)
              .join(' · ') || 'Details in Master Profile',
            confidence: 'GREEN',
            sourceLabel: 'Q&A Vault · Verified fact',
            vaultField: 'workAuthorization',
            reviewed: true,
          },
        ];

        const noteText = String(result.linkedinNote || '').slice(0, 275);

        queuedItem = {
          id: `q-${updatedJob.id}-${Date.now()}`,
          jobId: updatedJob.id,
          company: updatedJob.company,
          role: updatedJob.role,
          location: updatedJob.location,
          salary: updatedJob.salary,
          workMode: updatedJob.workMode,
          portalType: updatedJob.portalType,
          portalComplexity: updatedJob.portalComplexity,
          jobUrl: updatedJob.jobUrl,
          matchScore: updatedJob.matchScore,
          hiringTeam: updatedJob.hiringTeam,
          linkedinNote: noteText,
          resumeDiffs: diffs,
          screeningQuestions: [...amberAnswers, ...greenAnswers],
          createdAt: new Date().toISOString(),
          status: 'pending',
          applicationMode: 'tailored',
          resumeLabel: 'AI-Tailored Resume (Truthfulness Lock)',
        };

        // Replace existing pending queue card for the same job if present
        store.queue = [queuedItem, ...store.queue.filter((item) => item.jobId !== updatedJob.id)];
      }

      saveStore(store);

      return res.json({
        job: updatedJob,
        queued: Boolean(queuedItem),
        queueItem: queuedItem,
        state: getClientPayload(),
      });
    } catch (err) {
      const eventId = logServerError({ context: 'api.jobs.analyze', error: err, req, statusCode: 500 });
      const message = err instanceof Error ? err.message : 'Failed to analyze job with Gemini API.';
      return res.status(500).json({ error: message, eventId });
    }
  });

  // 4B. Apply Directly with Uploaded Base Resume (bypasses AI resume rewrite, respects HITL Approval Gate)
  app.post('/api/jobs/:jobId/direct-apply', (req, res) => {
    const { jobId } = req.params;
    const jobIdx = store.jobs.findIndex((j) => j.id === jobId);
    if (jobIdx < 0) {
      return res.status(404).json({ error: 'Job listing not found.' });
    }

    if (!store.masterProfile.fullName && store.masterProfile.experience.length === 0) {
      return res.status(400).json({
        error: 'Please upload or complete your Master Profile before applying with your uploaded resume.',
      });
    }

    const targetJob: JobListing = {
      ...store.jobs[jobIdx],
      notInterested: false,
      notInterestedAt: undefined,
    };
    store.jobs[jobIdx] = targetJob;

    const now = Date.now();
    const resumeLabel =
      store.masterProfile.uploadedResumeFileName ||
      (store.masterProfile.rawResumeText
        ? 'Uploaded Base Resume (Master Profile)'
        : 'Base Master Profile Resume');

    const greenAnswers: ScreeningAnswer[] = [
      {
        id: `sq-direct-ctc-${now}`,
        question: 'Current & Expected CTC (INR)',
        answer: `Current: ${store.qaVault.currentCtc || 'Not set'} | Expected: ${store.qaVault.expectedCtc || 'Not set'}`,
        confidence: 'GREEN',
        sourceLabel: 'Q&A Vault · Verified fact',
        vaultField: 'expectedCtc',
        reviewed: true,
      },
      {
        id: `sq-direct-notice-${now}`,
        question: 'Notice Period / Availability',
        answer: store.qaVault.noticePeriodDays
          ? `${store.qaVault.noticePeriodDays} days`
          : 'Immediate / Negotiable',
        confidence: 'GREEN',
        sourceLabel: 'Q&A Vault · Verified fact',
        vaultField: 'noticePeriodDays',
        reviewed: true,
      },
      {
        id: `sq-direct-auth-${now}`,
        question: 'Work Authorization & Relocation',
        answer:
          [store.qaVault.workAuthorization, store.qaVault.relocationPreference]
            .filter(Boolean)
            .join(' · ') || 'Authorized to work in India',
        confidence: 'GREEN',
        sourceLabel: 'Q&A Vault · Verified fact',
        vaultField: 'workAuthorization',
        reviewed: true,
      },
    ];

    const linkedInVal = store.qaVault.linkedinUrl || store.masterProfile.linkedinUrl || '';
    if (linkedInVal) {
      greenAnswers.push({
        id: `sq-direct-li-${now}`,
        question: 'LinkedIn Profile URL',
        answer: linkedInVal,
        confidence: 'GREEN',
        sourceLabel: 'Q&A Vault · Verified fact',
        vaultField: 'linkedinUrl',
        reviewed: true,
      });
    }

    const firstName = (targetJob.hiringTeam.name || 'Hiring Team').split(/\s+/)[0] || 'there';
    const topSkills = store.masterProfile.skills.slice(0, 3).join(', ');
    const groundedNote = `Hi ${firstName} — I'm applying for ${targetJob.role} at ${targetJob.company} with my base resume.${
      topSkills ? ` Background in ${topSkills}.` : ''
    } Would love to connect!`.slice(0, 275);

    const queuedItem: QueueItem = {
      id: `q-direct-${targetJob.id}-${now}`,
      jobId: targetJob.id,
      company: targetJob.company,
      role: targetJob.role,
      location: targetJob.location,
      salary: targetJob.salary,
      workMode: targetJob.workMode,
      portalType: targetJob.portalType,
      portalComplexity: targetJob.portalComplexity,
      jobUrl: targetJob.jobUrl,
      matchScore: targetJob.matchScore,
      hiringTeam: targetJob.hiringTeam,
      linkedinNote: groundedNote,
      resumeDiffs: [],
      screeningQuestions: greenAnswers,
      createdAt: new Date(now).toISOString(),
      status: 'pending',
      applicationMode: 'direct_resume',
      resumeLabel,
    };

    store.queue = [queuedItem, ...store.queue.filter((item) => item.jobId !== targetJob.id)];
    saveStore(store);

    return res.json({
      job: targetJob,
      queued: true,
      queueItem: queuedItem,
      state: getClientPayload(),
    });
  });

  // 4C. Flag or Restore a Job Posting as "Not Interested"
  app.post('/api/jobs/:jobId/not-interested', (req, res) => {
    const { jobId } = req.params;
    const jobIdx = store.jobs.findIndex((j) => j.id === jobId);
    if (jobIdx < 0) {
      return res.status(404).json({ error: 'Job listing not found.' });
    }

    const body = (req.body || {}) as { notInterested?: unknown };
    const flag = typeof body.notInterested === 'boolean' ? body.notInterested : true;

    const updatedJob: JobListing = {
      ...store.jobs[jobIdx],
      notInterested: flag,
      notInterestedAt: flag ? new Date().toISOString() : undefined,
    };
    store.jobs[jobIdx] = updatedJob;

    // Remove pending item from Approval Queue if candidate marked the posting Not Interested
    if (flag) {
      store.queue = store.queue.filter((item) => item.jobId !== jobId);
    }

    saveStore(store);
    return res.json({
      job: updatedJob,
      notInterested: flag,
      state: getClientPayload(),
    });
  });

  // 5. Edit & Save Amber Screening Answer to Q&A Vault
  app.post('/api/queue/:id/save-vault', (req, res) => {
    const queueItem = store.queue.find((q) => q.id === req.params.id);
    if (!queueItem) {
      return res.status(404).json({ error: 'Queue item not found.' });
    }

    const { answers } = req.body as {
      answers?: Array<{ id: string; answer: string; question: string; confidence: 'AMBER' | 'GREEN' }>;
    };

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: 'No answers provided to save.' });
    }

    let savedCount = 0;
    queueItem.screeningQuestions = queueItem.screeningQuestions.map((sq) => {
      const updated = answers.find((a) => a.id === sq.id);
      if (!updated) return sq;
      const cleanAnswer = String(updated.answer || '').trim();
      if (sq.confidence === 'AMBER' && cleanAnswer) {
        const existingVaultIdx = store.qaVault.customQAs.findIndex(
          (v) => v.question.toLowerCase() === sq.question.toLowerCase()
        );
        const vaultEntry = {
          id: existingVaultIdx >= 0 ? store.qaVault.customQAs[existingVaultIdx].id : `cqa-${Date.now()}-${savedCount}`,
          question: sq.question,
          answer: cleanAnswer,
          savedAt: new Date().toISOString(),
        };
        if (existingVaultIdx >= 0) {
          store.qaVault.customQAs[existingVaultIdx] = vaultEntry;
        } else {
          store.qaVault.customQAs.unshift(vaultEntry);
        }
        savedCount++;
        return {
          ...sq,
          answer: cleanAnswer,
          reviewed: true,
          sourceLabel: 'Reviewed & saved to Q&A Vault',
        };
      }
      return { ...sq, answer: cleanAnswer, reviewed: true };
    });

    saveStore(store);
    return res.json({ savedCount, state: getClientPayload() });
  });

  // 6. Approve & Submit (enforces Consent, 25/day cap, 60s cooldown, HITL Sandbox handoff)
  app.post('/api/queue/:id/approve', (req, res) => {
    const queueIdx = store.queue.findIndex((q) => q.id === req.params.id);
    if (queueIdx < 0) {
      return res.status(404).json({ error: 'Application card not found in approval queue.' });
    }

    if (!store.consentAccepted) {
      return res.status(403).json({
        error:
          'Mandatory compliance consent required. Please accept the personal productivity responsibility checkbox in Profile first.',
      });
    }

    const { outcome, updatedAnswers, actionReason } = req.body as {
      outcome?: 'submitted' | 'action_required';
      updatedAnswers?: Array<{ id: string; answer: string }>;
      actionReason?: string;
    };

    const finalStatus = outcome === 'action_required' ? 'action_required' : 'submitted';

    const guardrails = computeGuardrails();
    if (finalStatus === 'submitted') {
      if (guardrails.remainingToday <= 0) {
        return res.status(429).json({
          error: `Daily anti-spam cap reached (${guardrails.dailyCap} applications per rolling 24h window). Please wait for a slot to reopen.`,
          guardrails,
        });
      }

      if (guardrails.cooldownSecondsRemaining > 0) {
        return res.status(429).json({
          error: `60-second anti-spam cooldown active. Please wait ${guardrails.cooldownSecondsRemaining}s before approving the next submission.`,
          guardrails,
        });
      }
    }

    const queueItem = store.queue[queueIdx];
    const finalQuestions = queueItem.screeningQuestions.map((sq) => {
      const edited = updatedAnswers?.find((a) => a.id === sq.id);
      return edited ? { ...sq, answer: String(edited.answer), reviewed: true } : { ...sq, reviewed: true };
    });

    const now = Date.now();

    // Only count against daily submission cap & cooldown when actually submitted to ATS
    if (finalStatus === 'submitted') {
      store.submissionTimestamps.push(now);
    }

    const tracked: TrackedApplication = {
      id: `tr-${now}`,
      queueItemId: queueItem.id,
      jobId: queueItem.jobId,
      company: queueItem.company,
      role: queueItem.role,
      location: queueItem.location,
      salary: queueItem.salary,
      portalType: queueItem.portalType,
      matchScore: queueItem.matchScore,
      status: finalStatus,
      timestamp: new Date(now).toISOString(),
      auditReceiptId: generateReceiptId(),
      actionReason:
        finalStatus === 'action_required'
          ? actionReason || 'Paused at simulated CAPTCHA / OTP verification — requires manual completion.'
          : undefined,
      tailoredBulletsCount: queueItem.resumeDiffs.length,
      applicationMode: queueItem.applicationMode || 'tailored',
      resumeLabel: queueItem.resumeLabel,
      resumeDiffs: queueItem.resumeDiffs,
      screeningQuestions: finalQuestions,
      humanVerified: true,
    };

    store.queue.splice(queueIdx, 1);
    store.tracker.unshift(tracked);
    saveStore(store);

    return res.json({
      application: tracked,
      state: getClientPayload(),
    });
  });

  // 7. Skip a queue item
  app.post('/api/queue/:id/skip', (req, res) => {
    const queueIdx = store.queue.findIndex((q) => q.id === req.params.id);
    if (queueIdx < 0) {
      return res.status(404).json({ error: 'Queue item not found.' });
    }
    const queueItem = store.queue[queueIdx];
    const now = Date.now();
    const skipped: TrackedApplication = {
      id: `tr-skip-${now}`,
      queueItemId: queueItem.id,
      jobId: queueItem.jobId,
      company: queueItem.company,
      role: queueItem.role,
      location: queueItem.location,
      salary: queueItem.salary,
      portalType: queueItem.portalType,
      matchScore: queueItem.matchScore,
      status: 'skipped',
      timestamp: new Date(now).toISOString(),
      auditReceiptId: generateReceiptId(),
      tailoredBulletsCount: queueItem.resumeDiffs.length,
      applicationMode: queueItem.applicationMode || 'tailored',
      resumeLabel: queueItem.resumeLabel,
      resumeDiffs: queueItem.resumeDiffs,
      screeningQuestions: queueItem.screeningQuestions,
      humanVerified: true,
    };

    store.queue.splice(queueIdx, 1);
    store.tracker.unshift(skipped);
    saveStore(store);

    return res.json({ state: getClientPayload() });
  });

  // 8. Resume an Action Required (CAPTCHA/OTP paused) application after human handoff
  app.post('/api/tracker/:id/resume', (req, res) => {
    const appItem = store.tracker.find((t) => t.id === req.params.id);
    if (!appItem) {
      return res.status(404).json({ error: 'Tracked application not found.' });
    }
    if (appItem.status !== 'action_required') {
      return res.status(400).json({ error: 'Only Action Required applications can be resumed.' });
    }

    const guardrails = computeGuardrails();
    if (guardrails.remainingToday <= 0) {
      return res.status(429).json({
        error: `Daily anti-spam cap reached (${guardrails.dailyCap}/24h).`,
        guardrails,
      });
    }
    if (guardrails.cooldownSecondsRemaining > 0) {
      return res.status(429).json({
        error: `60-second cooldown active (${guardrails.cooldownSecondsRemaining}s remaining).`,
        guardrails,
      });
    }

    const now = Date.now();
    store.submissionTimestamps.push(now);
    appItem.status = 'submitted';
    appItem.timestamp = new Date(now).toISOString();
    appItem.actionReason = undefined;
    saveStore(store);

    return res.json({ application: appItem, state: getClientPayload() });
  });

  // 9. Public Recruiter Opt-Out endpoints (/api/privacy/opt-out)
  app.get('/api/privacy/opt-out', (_req, res) => {
    res.json({ optOuts: store.optOuts });
  });

  app.post('/api/privacy/opt-out', (req, res) => {
    const { linkedinUrl, reason } = req.body as { linkedinUrl?: string; reason?: string };
    const cleaned = (linkedinUrl || '').trim();
    if (!cleaned || !isValidHttpUrl(cleaned) || !/linkedin\.com/i.test(cleaned)) {
      return res.status(400).json({
        error: 'Please enter a valid https://linkedin.com/in/... profile URL.',
      });
    }

    const normalizedHandle = normalizeLinkedInHandle(cleaned);
    const urlSha256 = crypto.createHash('sha256').update(normalizedHandle).digest('hex');
    const exists = store.optOuts.some(
      (r) => r.normalizedHandle === normalizedHandle || r.urlSha256 === urlSha256
    );
    if (!exists) {
      const record: OptOutRecord = {
        id: `opt-${Date.now()}`,
        linkedinUrl: cleaned,
        normalizedHandle,
        urlSha256,
        reason: reason?.trim().slice(0, 300),
        createdAt: new Date().toISOString(),
      };
      store.optOuts.unshift(record);
      saveStore(store);
    }

    return res.json({
      blocked: true,
      normalizedHandle,
      urlSha256,
      state: getClientPayload(),
    });
  });

  // 10. Update selected PPP Tier
  app.put('/api/pricing-tier', (req, res) => {
    const { tier } = req.body as { tier?: PricingTierId };
    if (!tier || !['tier1', 'tier2', 'tier3', 'tier4'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid pricing tier.' });
    }
    store.selectedTier = tier;
    saveStore(store);
    return res.json(getClientPayload());
  });

  // 11. Simulated VPN / Card BIN Country Check for PPP checkout
  app.post('/api/billing/verify-ppp', (req, res) => {
    const { tierId, ipCountry, cardBinCountry, vpnDetected } = req.body as {
      tierId: PricingTierId;
      ipCountry: string;
      cardBinCountry: string;
      vpnDetected: boolean;
    };

    const mismatch = ipCountry !== cardBinCountry;
    const isDiscountedTier = tierId === 'tier2' || tierId === 'tier3' || tierId === 'tier4';

    if (isDiscountedTier && (mismatch || vpnDetected)) {
      return res.status(403).json({
        approved: false,
        reason: vpnDetected
          ? `VPN / proxy exit node detected (${ipCountry}). Purchasing Power Parity discounts require a verified local residential IP matching your payment card issuer country.`
          : `Card BIN country (${cardBinCountry}) does not match IP country (${ipCountry}). Tier ${tierId.replace('tier', '')} PPP discount is blocked — checkout reverts to Tier 1 Global Core pricing ($29.99/month).`,
        fallbackTier: 'tier1',
      });
    }

    return res.json({
      approved: true,
      message: `Geo-pricing verified: Card BIN (${cardBinCountry}) matches IP geolocation (${ipCountry}) with no VPN anomaly. Ready for checkout.`,
    });
  });

  // 12. Delete Account & All Data (Privacy Compliance)
  app.delete('/api/account', (_req, res) => {
    const preservedOptOuts = [...store.optOuts];
    store = createEmptyUserStore(preservedOptOuts);
    saveStore(store);
    return res.json({
      deleted: true,
      state: getClientPayload(),
    });
  });

  // 13. Restore Sample Demo Data (convenience after deleting account)
  app.post('/api/account/restore-demo', (_req, res) => {
    const preservedOptOuts = [...store.optOuts];
    store = createSeedStore();
    store.optOuts = preservedOptOuts;
    saveStore(store);
    return res.json({ state: getClientPayload() });
  });

  // 14. Live Diagnostics Probe: Gemini connectivity & JSON schema validation
  app.post('/api/diagnostics/gemini', async (_req, res) => {
    try {
      const ai = getGeminiClient();
      if (!ai) {
        return res.status(503).json({
          ok: false,
          error: 'GEMINI_API_KEY is not configured on the server.',
        });
      }

      const { response, modelUsed } = await generateContentWithRetry(ai, {
        contents:
          'Return a strict JSON diagnostic probe verifying CareerPilot AI schema connectivity with matchScore 88, portalComplexity "1-Click", and linkedinNote under 280 characters.',
        config: {
          systemInstruction: TRUTHFULNESS_LOCK_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matchScore: { type: Type.INTEGER },
              portalComplexity: { type: Type.STRING },
              linkedinNote: { type: Type.STRING },
              truthfulnessLockActive: { type: Type.BOOLEAN },
            },
            required: ['matchScore', 'portalComplexity', 'linkedinNote', 'truthfulnessLockActive'],
          },
        },
      });

      const raw = (response.text ?? '').trim();
      const parsed = JSON.parse(raw) as {
        matchScore: number;
        portalComplexity: string;
        linkedinNote: string;
        truthfulnessLockActive: boolean;
      };

      if (
        typeof parsed.matchScore !== 'number' ||
        parsed.matchScore < 0 ||
        parsed.matchScore > 100 ||
        typeof parsed.linkedinNote !== 'string' ||
        parsed.linkedinNote.length > 280
      ) {
        return res.status(422).json({
          ok: false,
          error: `Schema constraint violation: ${raw}`,
        });
      }

      return res.json({
        ok: true,
        model: modelUsed,
        parsed,
      });
    } catch (err) {
      const eventId = logServerError({ context: 'api.diagnostics.gemini', error: err, req: _req, statusCode: 500 });
      return res.status(500).json({
        ok: false,
        eventId,
        error: err instanceof Error ? err.message : 'Gemini connectivity probe failed.',
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  });

  // 15. Live Diagnostics Probe: Non-destructive 1-click user data wipe dry-run
  app.get('/api/diagnostics/wipe-dry-run', (_req, res) => {
    return res.json({
      ok: true,
      dryRunOnly: true,
      preservesRecruiterOptOuts: true,
      recordsTargeted: {
        profileInitialized: Boolean(store.masterProfile.fullName),
        customVaultQAs: store.qaVault.customQAs.length,
        pendingQueueItems: store.queue.length,
        trackedApplications: store.tracker.length,
        rollingTimestamps: store.submissionTimestamps.length,
      },
      preservedOptOutHashes: store.optOuts.length,
    });
  });

  // 16. Client Crash & Error Log Ingestion (captures device model, OS, browser, date, stack trace)
  app.post('/api/logs/client', ingestClientCrashLog);

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global Express error handler — logs unhandled route exceptions with device, date & stack
  app.use(expressErrorMiddleware);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CareerPilot AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  logServerError({ level: 'fatal', context: 'server.startup', error: err });
  process.exit(1);
});
