import type { PricingTierConfig } from '../types';

export const PPP_TIERS: PricingTierConfig[] = [
  /* Other regions commented out — focusing on India first
  {
    id: 'tier1',
    name: 'Tier 1 · Global Core',
    regions: 'US / UK / EU / SG / UAE',
    multiplier: '1.0x',
    weeklyPrice: '$12.99',
    monthlyPrice: '$29.99',
    currency: 'USD',
    credits: 400,
    dailyCap: 25,
    expectedCountryCode: 'US',
    audience: 'For candidates targeting US, UK, EU, Singapore, and UAE markets',
    sampleCountries: [
      { code: 'US', label: 'United States (US)' },
      { code: 'GB', label: 'United Kingdom (UK)' },
      { code: 'DE', label: 'Germany (EU)' },
      { code: 'SG', label: 'Singapore (SG)' },
      { code: 'AE', label: 'United Arab Emirates (UAE)' },
    ],
  },
  {
    id: 'tier2',
    name: 'Tier 2 · Developed APAC & CEE',
    regions: 'JP / KR / Eastern Europe',
    multiplier: '0.65x',
    weeklyPrice: '$8.49',
    monthlyPrice: '$19.49',
    currency: 'USD',
    credits: 350,
    dailyCap: 25,
    expectedCountryCode: 'JP',
    audience: 'For engineers and operators across Japan, Korea, and Eastern Europe',
    sampleCountries: [
      { code: 'JP', label: 'Japan (JP)' },
      { code: 'KR', label: 'South Korea (KR)' },
      { code: 'PL', label: 'Poland (PL)' },
      { code: 'CZ', label: 'Czechia (CZ)' },
    ],
  },
  {
    id: 'tier3',
    name: 'Tier 3 · Emerging Growth',
    regions: 'BR / MX / MY / TH',
    multiplier: '0.45x',
    weeklyPrice: '$5.99',
    monthlyPrice: '$13.49',
    currency: 'USD',
    credits: 250,
    dailyCap: 20,
    expectedCountryCode: 'BR',
    audience: 'For remote-ready talent in Latin America and Southeast Asia hubs',
    sampleCountries: [
      { code: 'BR', label: 'Brazil (BR)' },
      { code: 'MX', label: 'Mexico (MX)' },
      { code: 'MY', label: 'Malaysia (MY)' },
      { code: 'TH', label: 'Thailand (TH)' },
    ],
  },
  */
  {
    id: 'tier4',
    name: 'India Plan · Tier 4 PPP',
    regions: 'India (INR)',
    multiplier: '0.30x',
    weeklyPrice: '₹299',
    monthlyPrice: '₹749',
    currency: 'INR',
    credits: 200,
    dailyCap: 20,
    expectedCountryCode: 'IN',
    audience: 'For Bengaluru, Mumbai, Hyderabad, Pune, Delhi NCR, Chennai, and India remote talent',
    sampleCountries: [
      { code: 'IN', label: 'India (IN)' },
      // Other regions commented out — focusing on India first
      // { code: 'ID', label: 'Indonesia (ID)' },
      // { code: 'PH', label: 'Philippines (PH)' },
      // { code: 'VN', label: 'Vietnam (VN)' },
    ],
  },
];

export const COMPLIANCE_DISCLAIMER =
  'CareerPilot AI is an independent productivity tool and is not affiliated with, endorsed by, or sponsored by LinkedIn, Naukri, Workday, Greenhouse, or Indeed.';
