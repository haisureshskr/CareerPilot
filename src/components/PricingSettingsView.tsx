import React, { useState } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  CreditCard,
  Globe,
  LogIn,
  LogOut,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { PPP_TIERS } from '../constants/pricing';
import type { PricingTierConfig, PricingTierId } from '../types';
import { PWAInstallButton } from './PWAControls';

interface PricingSettingsViewProps {
  selectedTier: PricingTierId;
  onSelectTier: (tier: PricingTierId) => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onRestoreDemo: () => Promise<void>;
  onNavigate: (path: string) => void;
  firebaseUserEmail?: string | null;
  authBusy?: boolean;
  onGoogleSignIn?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
}

const ALL_COUNTRIES = [
  { code: 'IN', label: 'India (IN · Active Region)' },
  // Kept solely to test foreign Card BIN / VPN mismatch blocking against India PPP pricing
  { code: 'US', label: 'Foreign Card / Non-India (US · Mismatch Test)' },
  /* Other regions commented out — focusing on India first
  { code: 'ID', label: 'Indonesia (ID · Tier 4)' },
  { code: 'PH', label: 'Philippines (PH · Tier 4)' },
  { code: 'VN', label: 'Vietnam (VN · Tier 4)' },
  { code: 'BR', label: 'Brazil (BR · Tier 3)' },
  { code: 'MX', label: 'Mexico (MX · Tier 3)' },
  { code: 'JP', label: 'Japan (JP · Tier 2)' },
  { code: 'PL', label: 'Poland (PL · Tier 2)' },
  { code: 'GB', label: 'United Kingdom (UK · Tier 1)' },
  { code: 'SG', label: 'Singapore (SG · Tier 1)' },
  { code: 'AE', label: 'UAE (AE · Tier 1)' },
  */
];

export const PricingSettingsView: React.FC<PricingSettingsViewProps> = ({
  selectedTier,
  onSelectTier,
  onDeleteAccount,
  onRestoreDemo,
  onNavigate,
  firebaseUserEmail,
  authBusy = false,
  onGoogleSignIn,
  onSignOut,
}) => {
  const [cadence, setCadence] = useState<'monthly' | 'weekly'>('monthly');
  const [checkoutTier, setCheckoutTier] = useState<PricingTierConfig | null>(null);
  const [ipCountry, setIpCountry] = useState<string>('IN');
  const [cardBinCountry, setCardBinCountry] = useState<string>('US');
  const [vpnDetected, setVpnDetected] = useState<boolean>(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    approved: boolean;
    message: string;
  } | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  const activeTierObj = PPP_TIERS.find((t) => t.id === selectedTier) ?? PPP_TIERS[0];

  const openCheckoutModal = (tier: PricingTierConfig) => {
    setCheckoutTier(tier);
    setIpCountry(tier.expectedCountryCode);
    // Default Tier 4 checkout to mismatched Card BIN (US card on IN IP) so the user can immediately test or toggle!
    setCardBinCountry(tier.id === 'tier4' ? 'US' : tier.expectedCountryCode);
    setVpnDetected(false);
    setVerifyResult(null);
  };

  const handleRunPPPCheck = async () => {
    if (!checkoutTier) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch('/api/billing/verify-ppp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierId: checkoutTier.id,
          ipCountry,
          cardBinCountry,
          vpnDetected,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyResult({
          approved: false,
          message: data.reason || 'PPP discount blocked due to geo mismatch.',
        });
      } else {
        setVerifyResult({
          approved: true,
          message: data.message,
        });
      }
    } catch {
      setVerifyResult({
        approved: false,
        message: 'Could not reach server to verify Card BIN / IP country.',
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleDeleteAllData = async () => {
    setDeleting(true);
    setSettingsFeedback(null);
    try {
      await onDeleteAccount();
      setConfirmDelete(false);
      setSettingsFeedback(
        'Account and all personal data (Master Profile, Q&A Vault, Queue, Tracker, and submission logs) have been permanently deleted.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-indigo-600">India PPP Pricing & Settings</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            India Plan & Privacy Controls
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Currently focused on India (INR PPP pricing) while enforcing strict anti-spam daily caps and Card BIN/IP integrity checks.
          </p>
        </div>

        {/* Billing Cadence Switcher + Debug Diagnostics Icon */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setCadence('weekly')}
              className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                cadence === 'weekly'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setCadence('monthly')}
              className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                cadence === 'monthly'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly
            </button>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/diagnostics')}
            title="Open Diagnostics & Self-Test"
            aria-label="Open Diagnostics & Self-Test"
            className="min-h-[42px] min-w-[42px] inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
          >
            <Bug className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Interactive PPP Country Tier Switcher */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              India PPP Plan (Other Regions Paused)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              India-first launch pricing in INR with a 20/day anti-spam cap and Card BIN/IP geo-integrity verification.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <Globe className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            Active: <strong>{activeTierObj.name}</strong> ({activeTierObj.multiplier})
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PPP_TIERS.map((tier) => {
            const isSelected = tier.id === selectedTier;
            const displayedPrice = cadence === 'weekly' ? tier.weeklyPrice : tier.monthlyPrice;
            const alternatePrice =
              cadence === 'weekly'
                ? `${tier.monthlyPrice}/month`
                : `${tier.weeklyPrice}/week`;

            return (
              <div
                key={tier.id}
                className={`flex flex-col justify-between rounded-2xl border p-5 transition-colors ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-50/30 ring-1 ring-indigo-600'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-indigo-700">{tier.multiplier} PPP</span>
                    <span className="font-mono text-slate-500 tabular-nums">{tier.currency}</span>
                  </div>
                  <h3 className="mt-1.5 text-base font-bold text-slate-900">{tier.name}</h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-600">{tier.regions}</p>

                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {displayedPrice}
                      <span className="text-xs font-sans font-normal text-slate-500">
                        /{cadence === 'weekly' ? 'week' : 'month'}
                      </span>
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                      or {alternatePrice}
                    </p>
                  </div>

                  <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs">
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">AI Tailoring Credits</dt>
                      <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                        {tier.credits} / cycle
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Anti-Spam Cap</dt>
                      <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                        {tier.dailyCap} / 24h
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Pacing Cooldown</dt>
                      <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                        60s min
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-5 space-y-2">
                  <button
                    type="button"
                    onClick={() => onSelectTier(tier.id)}
                    className={`w-full min-h-[42px] rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                      isSelected
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {isSelected ? 'Active Region Tier' : 'Switch to This Tier'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openCheckoutModal(tier)}
                    className="w-full min-h-[42px] rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                  >
                    Test Checkout & BIN Check
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* PWA, Privacy & Account Data Controls */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Privacy, PWA & Account Settings</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Zero behind-login scraping, zero third-party password storage, and full one-click data erasure.
          </p>
        </div>

        {settingsFeedback && (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            {settingsFeedback}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-slate-100 pt-5">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Install Progressive Web App</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Install CareerPilot AI on your phone or desktop for native-style bottom navigation, standalone launch, and offline access to your Master Profile and Approval Queue.
            </p>
            <div className="pt-1">
              <PWAInstallButton showFallbackHint />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Public Recruiter Opt-Out Portal</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Recruiters and hiring managers can opt out at any time using their LinkedIn URL (stored as a one-way SHA-256 hash), suppressing their details immediately across CareerPilot AI.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('/privacy/opt-out')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
            >
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Open /privacy/opt-out
            </button>
          </div>
        </div>

        {/* Cloud Sync / Firebase Authentication (Mobile & Desktop) */}
        {(onGoogleSignIn || onSignOut) && (
          <div className="border-t border-slate-100 pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Cloud Account Sync</h3>
              <p className="mt-0.5 text-xs text-slate-600">
                {firebaseUserEmail
                  ? `Signed in as ${firebaseUserEmail}. Master Profile, Q&A Vault, and approval logs sync securely across web and Android.`
                  : 'Sign in with Google to sync your Master Profile, Q&A Vault, and approval timestamps with Cloud Firestore.'}
              </p>
            </div>
            {firebaseUserEmail ? (
              <button
                type="button"
                onClick={() => void onSignOut?.()}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shrink-0"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void onGoogleSignIn?.()}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 shrink-0"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                {authBusy ? 'Signing in...' : 'Sign in with Google'}
              </button>
            )}
          </div>
        )}

        {/* Delete Account & All Data */}
        <div className="border-t border-slate-100 pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
            <div>
              <h3 className="text-sm font-bold text-rose-950">Delete Account & All Data</h3>
              <p className="mt-0.5 text-xs text-rose-900/80 max-w-xl">
                Permanently removes your Master Profile, Q&A Vault, pending Approval Queue, Tracker audit logs, and cached local storage immediately.
              </p>
            </div>

            {!confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition-colors whitespace-nowrap"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete Account & All Data
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDeleteAllData}
                  className="min-h-[42px] rounded-xl bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
                >
                  {deleting ? 'Deleting...' : 'Confirm Permanent Wipe'}
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={async () => {
                await onRestoreDemo();
                setSettingsFeedback('Sample India demo profile, jobs, and approval queue restored.');
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Restore Sample Demo Workspace
            </button>
          </div>
        </div>
      </section>

      {/* Checkout Modal with Simulated VPN / Card BIN Country Check */}
      {checkoutTier && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ppp-checkout-title"
        >
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs font-medium text-indigo-600">
                  PPP Geo-Integrity Checkout Simulator
                </p>
                <h3 id="ppp-checkout-title" className="text-base font-bold text-slate-900 mt-0.5">
                  {checkoutTier.name} ·{' '}
                  {cadence === 'weekly'
                    ? `${checkoutTier.weeklyPrice}/week`
                    : `${checkoutTier.monthlyPrice}/month`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutTier(null)}
                aria-label="Close checkout modal"
                className="min-h-[44px] min-w-[44px] -mt-1 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                To keep Tier 4 ({checkoutTier.id === 'tier4' ? '₹299/wk · ₹749/mo' : '0.30x'}) and emerging-market PPP discounts sustainable, CareerPilot AI validates that your payment card BIN country matches your local residential IP country.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Simulated IP Geolocation Country
                  </label>
                  <select
                    value={ipCountry}
                    onChange={(e) => {
                      setIpCountry(e.target.value);
                      setVerifyResult(null);
                    }}
                    className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                  >
                    {ALL_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Simulated Card BIN Issuer Country
                  </label>
                  <select
                    value={cardBinCountry}
                    onChange={(e) => {
                      setCardBinCountry(e.target.value);
                      setVerifyResult(null);
                    }}
                    className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                  >
                    {ALL_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
                <div>
                  <span className="text-xs font-semibold text-slate-900 block">
                    VPN / Card BIN Country Check — Simulate VPN Exit Node
                  </span>
                  <span className="text-xs text-slate-600 block mt-0.5">
                    Toggle ON to simulate a commercial VPN tunneling through {ipCountry} while paying with a {cardBinCountry} card.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={vpnDetected}
                  onChange={(e) => {
                    setVpnDetected(e.target.checked);
                    setVerifyResult(null);
                  }}
                  className="mt-0.5 h-5 w-5 rounded border-slate-300 text-indigo-600 shrink-0"
                />
              </label>

              {verifyResult && (
                <div
                  role="status"
                  className={`rounded-xl border p-3.5 text-xs flex items-start gap-2.5 leading-relaxed ${
                    verifyResult.approved
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
                  }`}
                >
                  {verifyResult.approved ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-bold">
                      {verifyResult.approved ? 'PPP Verification Passed' : 'PPP Discount Blocked'}
                    </p>
                    <p className="mt-0.5">{verifyResult.message}</p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIpCountry(checkoutTier.expectedCountryCode);
                    setCardBinCountry(checkoutTier.expectedCountryCode);
                    setVpnDetected(false);
                    setVerifyResult(null);
                  }}
                  className="min-h-[42px] rounded-xl px-3 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                >
                  Match Local Card & IP
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCheckoutTier(null)}
                    className="min-h-[42px] rounded-xl px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={verifying}
                    onClick={handleRunPPPCheck}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    <CreditCard className="h-4 w-4" aria-hidden="true" />
                    {verifying ? 'Checking BIN & IP...' : 'Run VPN / BIN Check'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
