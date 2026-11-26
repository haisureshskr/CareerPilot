import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  FileUp,
  Loader2,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { MasterProfile, QAVault } from '../types';

interface ProfileViewProps {
  profile: MasterProfile;
  qaVault: QAVault;
  consentAccepted: boolean;
  onSaveProfile: (
    nextProfile: MasterProfile,
    nextVault: QAVault,
    nextConsent: boolean
  ) => Promise<void>;
  onParseResume: (payload: {
    resumeText?: string;
    fileBase64?: string;
    mimeType?: string;
  }) => Promise<{ extractedLinkedInUrl?: string | null } | void>;
  onNavigate: (path: string) => void;
}

const SAMPLE_PASTE_RESUME = `ROHAN KULKARNI
Senior Backend & Full-Stack Engineer | Bengaluru, India
rohan.kulkarni@example.com | +91 98801 44512 | linkedin.com/in/rohan-kulkarni-dev

SUMMARY
Software engineer with 5 years of experience designing payment microservices, TypeScript web applications, and PostgreSQL data pipelines for fintech and SaaS products.

SKILLS
TypeScript, React, Node.js, Go, PostgreSQL, Redis, AWS, Docker, Kubernetes, GraphQL, Playwright

EXPERIENCE
PayPulse Technologies — Senior Software Engineer (Bengaluru, India | Apr 2022 – Present)
- Built real-time UPI settlement APIs in Node.js and PostgreSQL handling 1.1M daily transactions at p99 latency under 120ms.
- Developed merchant analytics dashboards in React and TypeScript used by 22,000 active businesses.
- Automated regression test suites with Playwright, reducing production release defects by 48%.

KiteCloud SaaS — Software Engineer (Mumbai, India | Jun 2020 – Mar 2022)
- Implemented multi-tenant billing exports and webhook delivery retries in TypeScript and Redis.
- Migrated legacy reporting pages to React, improving page load time by 35%.

EDUCATION
BITS Pilani — B.E. in Computer Science (2020)

PROJECTS
LedgerSync CLI — Open-source PostgreSQL schema diff and audit verification tool written in TypeScript.`;

export const ProfileView: React.FC<ProfileViewProps> = ({
  profile,
  qaVault,
  consentAccepted,
  onSaveProfile,
  onParseResume,
  onNavigate,
}) => {
  const [localProfile, setLocalProfile] = useState<MasterProfile>(profile);
  const [localVault, setLocalVault] = useState<QAVault>(qaVault);
  const [localConsent, setLocalConsent] = useState<boolean>(consentAccepted);
  const [resumeInput, setResumeInput] = useState<string>(profile.rawResumeText || '');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedBase64, setUploadedBase64] = useState<string>('');
  const [uploadedMime, setUploadedMime] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setLocalProfile(profile);
  }, [profile]);

  React.useEffect(() => {
    setLocalVault(qaVault);
  }, [qaVault]);

  React.useEffect(() => {
    setLocalConsent(consentAccepted);
  }, [consentAccepted]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatusMessage({ type: 'error', text: 'Resume file must be under 5 MB.' });
      return;
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');

    if (!isPdf && !isTxt) {
      setStatusMessage({ type: 'error', text: 'Please upload a PDF (.pdf) or plain text (.txt) resume.' });
      return;
    }

    setUploadedFileName(file.name);
    setStatusMessage(null);

    if (isTxt) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        setResumeInput(text);
        setUploadedBase64('');
        setUploadedMime('');
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        setUploadedBase64(base64);
        setUploadedMime('application/pdf');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleParseClick = async () => {
    if (!resumeInput.trim() && !uploadedBase64) {
      setStatusMessage({
        type: 'error',
        text: 'Paste resume text or select a PDF/TXT file first.',
      });
      return;
    }
    setParsing(true);
    setStatusMessage(null);
    try {
      const result = await onParseResume({
        resumeText: resumeInput.trim() || undefined,
        fileBase64: uploadedBase64 || undefined,
        mimeType: uploadedMime || undefined,
      });
      const fetchedLinkedIn = result && 'extractedLinkedInUrl' in result ? result.extractedLinkedInUrl : null;
      setStatusMessage({
        type: 'success',
        text: fetchedLinkedIn
          ? `Resume parsed into Master Profile. Fetched LinkedIn profile (${fetchedLinkedIn}) and synced to your Q&A Vault.`
          : 'Resume parsed into your structured Master Profile. No LinkedIn URL was embedded in the file — you can enter it below.',
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to parse resume.',
      });
    } finally {
      setParsing(false);
    }
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      await onSaveProfile(localProfile, localVault, localConsent);
      setStatusMessage({
        type: 'success',
        text: 'Master Profile, Screening Q&A Vault, and compliance consent saved.',
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save profile.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomQA = (id: string) => {
    setLocalVault((prev) => ({
      ...prev,
      customQAs: prev.customQAs.filter((item) => item.id !== id),
    }));
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-indigo-600">Onboarding & Master Profile</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Your Verified Career Source of Truth
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Upload or paste your base resume. Gemini structures your verified facts so every tailored application strictly obeys our Truthfulness Lock.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <Code2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
            {showJson ? 'Hide JSON' : 'Inspect JSON'}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2.5 ${
            statusMessage.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* 1. Resume Upload & Gemini Parser */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">1. Parse Base Resume (PDF or Text)</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Never fabricates employers, dates, degrees, or skills. Only extracts facts present in your document.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setResumeInput(SAMPLE_PASTE_RESUME);
              setUploadedFileName('');
              setUploadedBase64('');
              setUploadedMime('');
            }}
            className="self-start sm:self-auto min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors whitespace-nowrap"
          >
            Load Sample Resume Text
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 flex flex-col justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                onChange={handleFileChange}
                className="sr-only"
                id="resume-file-input"
              />
              <label
                htmlFor="resume-file-input"
                className="flex flex-col items-center justify-center text-center cursor-pointer py-5"
              >
                <FileUp className="h-7 w-7 text-indigo-600" aria-hidden="true" />
                <span className="mt-2 text-sm font-semibold text-slate-900">
                  Upload PDF or TXT Resume
                </span>
                <span className="mt-1 text-xs text-slate-500">Up to 5 MB · Parsed via Gemini API</span>
              </label>
            </div>
            {uploadedFileName && (
              <div className="mt-2 rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs text-slate-700 flex items-center justify-between gap-2">
                <span className="truncate font-medium">{uploadedFileName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setUploadedFileName('');
                    setUploadedBase64('');
                    setUploadedMime('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="text-slate-400 hover:text-rose-600"
                  aria-label="Remove uploaded file"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-8 flex flex-col gap-3">
            <label htmlFor="resume-paste-area" className="sr-only">
              Paste resume text
            </label>
            <textarea
              id="resume-paste-area"
              rows={6}
              value={resumeInput}
              onChange={(e) => setResumeInput(e.target.value)}
              placeholder="Or paste your complete plain-text resume here (Experience, Skills, Education, Projects)..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/40 p-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                {profile.lastParsedAt
                  ? `Last parsed ${new Date(profile.lastParsedAt).toLocaleString()}`
                  : 'Not yet parsed'}
              </span>
              <button
                type="button"
                disabled={parsing}
                onClick={handleParseClick}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                {parsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Parsing with Gemini...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Parse Resume with Gemini
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {showJson && (
        <section className="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-slate-100 overflow-x-auto">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <span className="text-xs font-medium text-slate-300">Structured Master Profile JSON</span>
            <span className="font-mono text-xs text-slate-400">
              {localProfile.experience.length} roles · {localProfile.skills.length} skills
            </span>
          </div>
          <pre className="mt-3 font-mono text-xs leading-relaxed text-indigo-200 max-h-80 overflow-y-auto">
            {JSON.stringify(localProfile, null, 2)}
          </pre>
        </section>
      )}

      {/* Main Editable Form */}
      <form onSubmit={handleSaveAll} className="space-y-8">
        {/* 2. Structured Master Profile Preview & Editor */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">2. Structured Master Profile</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Review your parsed facts. Resume tailoring strictly pulls from these records.
          </p>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Full Name</label>
              <input
                type="text"
                value={localProfile.fullName}
                onChange={(e) => setLocalProfile({ ...localProfile, fullName: e.target.value })}
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Headline</label>
              <input
                type="text"
                value={localProfile.headline}
                onChange={(e) => setLocalProfile({ ...localProfile, headline: e.target.value })}
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Location</label>
              <input
                type="text"
                value={localProfile.location}
                onChange={(e) => setLocalProfile({ ...localProfile, location: e.target.value })}
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={localProfile.email}
                onChange={(e) => setLocalProfile({ ...localProfile, email: e.target.value })}
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-slate-700">
                  LinkedIn Profile URL (auto-fetched from resume text &amp; PDF hyperlinks)
                </label>
                {(localProfile.linkedinUrl || localVault.linkedinUrl) && (
                  <span className="text-[11px] font-medium text-emerald-700">Synced with Q&amp;A Vault</span>
                )}
              </div>
              <input
                type="text"
                value={localVault.linkedinUrl || localProfile.linkedinUrl || ''}
                onChange={(e) => {
                  const nextUrl = e.target.value;
                  setLocalProfile({ ...localProfile, linkedinUrl: nextUrl });
                  setLocalVault({ ...localVault, linkedinUrl: nextUrl });
                }}
                placeholder="https://www.linkedin.com/in/your-handle"
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-slate-700">
              Verified Skills (comma-separated)
            </label>
            <input
              type="text"
              value={localProfile.skills.join(', ')}
              onChange={(e) =>
                setLocalProfile({
                  ...localProfile,
                  skills: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Experience, Education, Projects summary */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 border-t border-slate-100 pt-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Experience ({localProfile.experience.length})
              </h3>
              {localProfile.experience.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  No experience parsed yet. Paste or upload a resume above to populate.
                </p>
              ) : (
                <div className="mt-3 space-y-4">
                  {localProfile.experience.map((exp) => (
                    <div key={exp.id} className="border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {exp.title} · {exp.company}
                        </p>
                        <span className="font-mono text-xs text-slate-500 tabular-nums">
                          {exp.startDate} – {exp.endDate}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{exp.location}</p>
                      <ul className="mt-2 space-y-1.5 text-xs text-slate-700 list-disc pl-4 leading-relaxed">
                        {exp.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Education ({localProfile.education.length})
                </h3>
                {localProfile.education.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No education parsed yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {localProfile.education.map((edu) => (
                      <div key={edu.id} className="border-b border-slate-100 pb-3 last:border-b-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{edu.institution}</p>
                          <span className="font-mono text-xs text-slate-500 tabular-nums">
                            {edu.graduationYear}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {edu.degree}
                          {edu.details ? ` · ${edu.details}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Projects ({localProfile.projects.length})
                </h3>
                {localProfile.projects.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No projects parsed yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {localProfile.projects.map((proj) => (
                      <div key={proj.id} className="border-b border-slate-100 pb-3 last:border-b-0">
                        <p className="text-sm font-semibold text-slate-900">{proj.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{proj.techStack.join(' · ')}</p>
                        <p className="text-xs text-slate-700 mt-1 leading-relaxed">{proj.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 3. Screening Q&A Vault */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900">3. Screening Q&A Vault</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Deterministic HR facts automatically pre-filled as GREEN verified answers in your Approval Queue.
              </p>
            </div>
            <span className="text-xs font-medium text-emerald-700">Deterministic · Zero AI Hallucination</span>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Current CTC (INR)</label>
              <input
                type="text"
                value={localVault.currentCtc}
                onChange={(e) => setLocalVault({ ...localVault, currentCtc: e.target.value })}
                placeholder="e.g. ₹28 LPA Fixed"
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Expected CTC (INR)</label>
              <input
                type="text"
                value={localVault.expectedCtc}
                onChange={(e) => setLocalVault({ ...localVault, expectedCtc: e.target.value })}
                placeholder="e.g. ₹40–45 LPA"
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Notice Period (days)</label>
              <input
                type="number"
                min={0}
                max={180}
                value={localVault.noticePeriodDays}
                onChange={(e) => setLocalVault({ ...localVault, noticePeriodDays: e.target.value })}
                placeholder="30"
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Work Authorization</label>
              <input
                type="text"
                value={localVault.workAuthorization}
                onChange={(e) => setLocalVault({ ...localVault, workAuthorization: e.target.value })}
                placeholder="e.g. Indian Citizen · Authorized to work in India"
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Relocation Preference</label>
              <input
                type="text"
                value={localVault.relocationPreference}
                onChange={(e) => setLocalVault({ ...localVault, relocationPreference: e.target.value })}
                placeholder="e.g. Bengaluru / Mumbai / Hyderabad / Remote (India)"
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">LinkedIn Profile URL</label>
              <input
                type="text"
                value={localVault.linkedinUrl}
                onChange={(e) => {
                  const nextUrl = e.target.value;
                  setLocalVault({ ...localVault, linkedinUrl: nextUrl });
                  setLocalProfile({ ...localProfile, linkedinUrl: nextUrl });
                }}
                placeholder="https://www.linkedin.com/in/your-handle"
                className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          {localVault.customQAs.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Saved Custom Answers ({localVault.customQAs.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Captured from your reviewed Amber answers in the Approval Queue.
              </p>
              <div className="mt-3 space-y-3">
                {localVault.customQAs.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900">{item.question}</p>
                      <p className="mt-1 text-xs text-slate-700 leading-relaxed">{item.answer}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomQA(item.id)}
                      aria-label="Delete saved answer"
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 4. Mandatory Human Responsibility Checkbox */}
        <section
          className={`rounded-2xl border p-5 sm:p-6 ${
            localConsent
              ? 'border-emerald-200 bg-emerald-50/50'
              : 'border-amber-300 bg-amber-50/60'
          }`}
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              className={`h-5 w-5 mt-0.5 shrink-0 ${
                localConsent ? 'text-emerald-700' : 'text-amber-700'
              }`}
              aria-hidden="true"
            />
            <div className="flex-1">
              <h2 className="text-base font-bold text-slate-900">
                User-Agent & Applicant Accuracy Warranty
              </h2>
              <label className="mt-3 flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={localConsent}
                  onChange={(e) => setLocalConsent(e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 shrink-0"
                />
                <span className="text-sm text-slate-800 leading-relaxed font-medium">
                  I warrant that CareerPilot AI acts solely as my personal productivity user-agent, all Master Profile facts are accurate, and I am responsible for reviewing all drafted applications before submitting.
                </span>
              </label>
              <p className="mt-2 text-xs text-slate-600">
                {localConsent
                  ? 'Active — Approval Queue submission gate is unlocked for your manual review.'
                  : 'Required — Approve & Submit actions remain locked until you accept this warranty.'}
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onNavigate('/discover')}
            className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Go to Job Discovery
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Save Profile & Q&A Vault
          </button>
        </div>
      </form>
    </div>
  );
};
