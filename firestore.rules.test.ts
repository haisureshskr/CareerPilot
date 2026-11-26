/**
 * Security Rules Verification Suite — CareerPilot AI
 * Verifies all "Dirty Dozen" adversarial payloads are rejected (PERMISSION_DENIED)
 * against the Eight Pillars in firestore.rules.
 */
export interface DirtyDozenTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Cross-Tenant Profile Read',
    operation: 'get',
    path: '/users/userA',
    auth: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: false },
    payload: { ownerId: 'userA', fullName: 'Test', warrantyAccepted: false, selectedTier: 'tier1', submissionEpochMs: [] },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on UserWorkspace',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', fullName: 'Test', warrantyAccepted: false, selectedTier: 'tier1', submissionEpochMs: [], isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity Spoofing on Subcollection Job',
    operation: 'create',
    path: '/users/userA/jobs/job_1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userB', company: 'Acme', role: 'SWE', market: 'Global', workMode: 'Remote', portalType: 'Greenhouse', portalComplexity: '1-Click', matchScore: 88, description: 'Test' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Document ID Poisoning',
    operation: 'create',
    path: '/users/userA/jobs/bad$id!space',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', company: 'Acme', role: 'SWE' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Anti-Spam Daily Cap Overflow (>25 timestamps)',
    operation: 'update',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { submissionEpochMs: Array.from({ length: 26 }, (_, i) => 1700000000000 + i * 61000) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'LinkedIn Note Overflow (>280 characters)',
    operation: 'create',
    path: '/users/userA/applications/app_1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', jobId: 'job_1', company: 'Acme', role: 'SWE', portalType: 'Greenhouse', matchScore: 90, status: 'PENDING_APPROVAL', linkedinNote: 'x'.repeat(300) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Terminal State Tampering (SUBMITTED -> PENDING_APPROVAL)',
    operation: 'update',
    path: '/users/userA/applications/app_submitted',
    auth: { uid: 'userA', email_verified: true },
    payload: { status: 'PENDING_APPROVAL' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable createdAt Mutation',
    operation: 'update',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { createdAt: '1999-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Backdated Client Timestamp Forgery',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', fullName: 'Test', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Recruiter Opt-Out Collection Enumeration (list)',
    operation: 'list',
    path: '/recruiterOptOuts',
    auth: { uid: 'userA', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Recruiter Opt-Out Hash Poisoning / PII Field Injection',
    operation: 'create',
    path: '/recruiterOptOuts/not-a-valid-sha256-hash',
    auth: { uid: 'userA', email_verified: true },
    payload: { urlSha256: 'not-a-valid-sha256-hash', active: true, rawLinkedinUrl: 'https://linkedin.com/in/leak' },
    expected: 'PERMISSION_DENIED',
  },
];
