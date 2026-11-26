import { signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import type {
  JobListing,
  MasterProfile,
  PricingTierId,
  QAVault,
  QueueItem,
  TrackedApplication,
} from '../types';
import { normalizeLinkedInHandle } from '../utils/security';

export async function sha256LinkedInUrl(rawUrl: string): Promise<string> {
  const normalized = normalizeLinkedInHandle(rawUrl);
  const encoded = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signInWithGooglePopup(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
}

/**
 * Ensures the signed-in user's private workspace document exists in Firestore
 * adhering strictly to firebase-blueprint.json & firestore.rules.
 */
export async function syncWorkspaceToFirestore(
  user: User,
  profile: MasterProfile,
  qaVault: QAVault,
  warrantyAccepted: boolean,
  selectedTier: PricingTierId,
  submissionEpochMs: number[]
): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    const safePayload = {
      ownerId: user.uid,
      email: (profile.email || user.email || '').slice(0, 200),
      fullName: (profile.fullName || user.displayName || '').slice(0, 120),
      headline: (profile.headline || '').slice(0, 240),
      phone: (profile.phone || '').slice(0, 40),
      location: (profile.location || '').slice(0, 120),
      summary: (profile.summary || '').slice(0, 2000),
      skills: profile.skills.slice(0, 40),
      experience: profile.experience.slice(0, 15),
      education: profile.education.slice(0, 10),
      projects: profile.projects.slice(0, 15),
      qaVault,
      warrantyAccepted,
      selectedTier,
      submissionEpochMs: submissionEpochMs.slice(-25),
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      await setDoc(userRef, {
        ...safePayload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        email: safePayload.email,
        fullName: safePayload.fullName,
        headline: safePayload.headline,
        phone: safePayload.phone,
        location: safePayload.location,
        summary: safePayload.summary,
        skills: safePayload.skills,
        experience: safePayload.experience,
        education: safePayload.education,
        projects: safePayload.projects,
        qaVault: safePayload.qaVault,
        warrantyAccepted: safePayload.warrantyAccepted,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncDiscoveredJobsToFirestore(
  user: User,
  jobs: JobListing[]
): Promise<void> {
  const userRef = doc(db, 'users', user.uid);
  const basePath = `users/${user.uid}/jobs`;
  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    for (const job of jobs.slice(0, 12)) {
      const safeJobId = job.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      if (!safeJobId) continue;
      const jobRef = doc(db, 'users', user.uid, 'jobs', safeJobId);
      const existing = await getDoc(jobRef);
      const safeScore = Math.max(0, Math.min(100, Math.round(job.matchScore)));
      if (existing.exists()) {
        await updateDoc(jobRef, {
          matchScore: safeScore,
          portalComplexity: job.portalComplexity === 'Multi-Step' ? 'Multi-Step' : '1-Click',
          matchedKeywords: job.matchedKeywords.slice(0, 12),
          missingKeywords: job.missingKeywords.slice(0, 12),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(jobRef, {
          ownerId: user.uid,
          company: (job.company || 'Employer').slice(0, 120),
          role: (job.role || 'Open Role').slice(0, 160),
          location: (job.location || '').slice(0, 120),
          market: job.market === 'India' ? 'India' : 'Global',
          salary: (job.salary || '').slice(0, 100),
          workMode: ['Remote', 'Hybrid', 'On-site'].includes(job.workMode) ? job.workMode : 'Remote',
          portalType: ['Greenhouse', 'Lever', 'Ashby', 'Workday', 'Naukri'].includes(job.portalType)
            ? job.portalType
            : 'Greenhouse',
          portalComplexity: job.portalComplexity === 'Multi-Step' ? 'Multi-Step' : '1-Click',
          matchScore: safeScore,
          matchedKeywords: job.matchedKeywords.slice(0, 12),
          missingKeywords: job.missingKeywords.slice(0, 12),
          description: (job.description || 'Resume-matched open position.').slice(0, 6000),
          jobUrl: (job.jobUrl || '').slice(0, 500),
          hiringTeam: job.hiringTeam,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, basePath);
  }
}

export async function logApprovalToFirestore(
  user: User,
  queueItem: QueueItem,
  tracked: TrackedApplication
): Promise<void> {
  const safeAppId = tracked.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const safeJobId = tracked.jobId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const appPath = `users/${user.uid}/applications/${safeAppId}`;
  try {
    await setDoc(doc(db, 'users', user.uid, 'applications', safeAppId), {
      ownerId: user.uid,
      jobId: safeJobId,
      company: tracked.company.slice(0, 120),
      role: tracked.role.slice(0, 160),
      location: tracked.location.slice(0, 120),
      salary: tracked.salary.slice(0, 100),
      workMode: queueItem.workMode,
      portalType: tracked.portalType,
      portalComplexity: queueItem.portalComplexity,
      jobUrl: (queueItem.jobUrl || '').slice(0, 500),
      matchScore: Math.max(0, Math.min(100, Math.round(tracked.matchScore))),
      status:
        tracked.status === 'submitted'
          ? 'SUBMITTED'
          : tracked.status === 'action_required'
            ? 'ACTION_REQUIRED'
            : 'SKIPPED',
      hiringTeam: queueItem.hiringTeam,
      linkedinNote: queueItem.linkedinNote.slice(0, 280),
      resumeDiffs: tracked.resumeDiffs.slice(0, 8),
      screeningQuestions: tracked.screeningQuestions.slice(0, 15),
      auditReceiptId: tracked.auditReceiptId.slice(0, 64),
      actionReason: (tracked.actionReason || '').slice(0, 400),
      user_approved_at: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, appPath);
  }
}

/**
 * Public zero-PII SHA-256 recruiter opt-out write to /recruiterOptOuts/{sha256Hash}
 */
export async function submitRecruiterOptOutHashToFirestore(linkedinUrl: string): Promise<string> {
  const hash = await sha256LinkedInUrl(linkedinUrl);
  const docPath = `recruiterOptOuts/${hash}`;
  try {
    const ref = doc(db, 'recruiterOptOuts', hash);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        urlSha256: hash,
        active: true,
        createdAt: serverTimestamp(),
      });
    }
    return hash;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function checkRecruiterOptOutInFirestore(linkedinUrl: string): Promise<boolean> {
  if (!linkedinUrl) return false;
  const hash = await sha256LinkedInUrl(linkedinUrl);
  const docPath = `recruiterOptOuts/${hash}`;
  try {
    const snap = await getDoc(doc(db, 'recruiterOptOuts', hash));
    return snap.exists() && snap.data()?.active === true;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }
}

/**
 * 1-click Delete Account & All Data: batch-deletes all user subcollections and profile doc in Firestore.
 */
export async function wipeUserFirestoreData(user: User): Promise<void> {
  const basePath = `users/${user.uid}`;
  try {
    const batch = writeBatch(db);
    const jobsSnap = await getDocs(
      query(collection(db, 'users', user.uid, 'jobs'), where('ownerId', '==', user.uid))
    );
    jobsSnap.forEach((d) => batch.delete(d.ref));

    const appsSnap = await getDocs(
      query(collection(db, 'users', user.uid, 'applications'), where('ownerId', '==', user.uid))
    );
    appsSnap.forEach((d) => batch.delete(d.ref));

    batch.delete(doc(db, 'users', user.uid));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, basePath);
  }
}

/**
 * Non-destructive dry-run verification auditing exact Firestore paths targeted by 1-click wipe.
 */
export async function dryRunUserFirestoreWipe(user: User): Promise<{
  userDocPath: string;
  userDocExists: boolean;
  jobsCount: number;
  applicationsCount: number;
  totalDocumentsToDelete: number;
}> {
  const basePath = `users/${user.uid}`;
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const jobsSnap = await getDocs(
      query(collection(db, 'users', user.uid, 'jobs'), where('ownerId', '==', user.uid))
    );
    const appsSnap = await getDocs(
      query(collection(db, 'users', user.uid, 'applications'), where('ownerId', '==', user.uid))
    );
    const total = (userSnap.exists() ? 1 : 0) + jobsSnap.size + appsSnap.size;
    return {
      userDocPath: basePath,
      userDocExists: userSnap.exists(),
      jobsCount: jobsSnap.size,
      applicationsCount: appsSnap.size,
      totalDocumentsToDelete: total,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, basePath);
  }
}
