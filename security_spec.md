# CareerPilot AI — Firestore Security Specification

## 1. Data Invariants
1. **Strict PII Isolation**: All candidate resumes, Q&A Vault values (CTC, phone, email, notice period), jobs, and application records live strictly under `/users/{userId}` and its subcollections, readable and writable ONLY by the verified authenticated owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. **Master Gate**: Every subcollection write under `/users/{userId}/jobs/{jobId}` and `/users/{userId}/applications/{applicationId}` verifies that the parent `/users/{userId}` document exists and belongs to `request.auth.uid`.
3. **Terminal State Locking**: Once an `ApplicationRecord` transitions to `SUBMITTED` or `SKIPPED`, no further updates are permitted (only owner deletion for "Delete Account & All Data").
4. **Hard Anti-Spam Array Bound**: `submissionEpochMs` on `/users/{userId}` is strictly bounded to `<= 25` entries (`size() <= 25`), enforcing the 25/day rolling window at the database rule layer.
5. **Zero-PII Recruiter Opt-Out**: `/recruiterOptOuts/{hashId}` accepts ONLY 64-character lowercase hex SHA-256 document IDs matching `urlSha256 == hashId`, allows single-document `get` lookups (never `list` enumeration), allows immutable `create`, and denies `update`/`delete`.
6. **Temporal & Identity Integrity**: `ownerId` and `createdAt` are immutable after creation; `createdAt` and `updatedAt` are validated against `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Cross-Tenant Profile Read**: User B attempts `get('/users/userA')`.
2. **Unverified Email Write**: User A with `email_verified: false` attempts `create('/users/userA')`.
3. **Shadow Field Injection**: User A creates `/users/userA` with extra ghost field `isAdmin: true`.
4. **Identity Spoofing**: User A creates `/users/userA/jobs/job1` with `ownerId: 'userB'`.
5. **ID Poisoning**: User A writes `/users/userA/jobs/invalid$id!with*spaces` or a 200-char doc ID.
6. **Anti-Spam Cap Overflow**: User A updates `/users/userA` with 26 items in `submissionEpochMs`.
7. **LinkedIn Note Length Overflow**: User A writes `/users/userA/applications/app1` with a 350-character `linkedinNote` (>280 chars).
8. **Terminal State Tampering**: User A attempts to update an `ApplicationRecord` whose existing `status` is `'SUBMITTED'`.
9. **Immutable Field Mutation**: User A attempts to modify `createdAt` or `ownerId` during an update.
10. **Client Timestamp Forgery**: User A creates a document with a backdated client timestamp instead of `request.time`.
11. **Opt-Out Enumeration (`list`)**: Anyone attempts `list('/recruiterOptOuts')` to harvest hashes.
12. **Opt-Out Hash Poisoning / PII Injection**: Anyone creates `/recruiterOptOuts/not-a-sha256` or injects an extra `rawLinkedinUrl` field.
