package com.careerpilot.ai.data.repository

import com.careerpilot.ai.BuildConfig
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.CountryFilterMatcher
import com.careerpilot.ai.data.model.EducationItem
import com.careerpilot.ai.data.model.ExperienceItem
import com.careerpilot.ai.data.model.GuardrailState
import com.careerpilot.ai.data.model.HiringTeamMember
import com.careerpilot.ai.data.model.JobListing
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PricingTier
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.data.model.ProjectItem
import com.careerpilot.ai.data.model.QAVault
import com.careerpilot.ai.data.model.ResumeDiffItem
import com.careerpilot.ai.data.model.SavedCustomQA
import com.careerpilot.ai.data.model.ScreeningAnswer
import com.google.firebase.Firebase
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.firestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.util.UUID

data class DryRunWipeReport(
    val userDocPath: String,
    val userDocExists: Boolean,
    val jobsCount: Int,
    val applicationsCount: Int
) {
    val totalDocumentsToDelete: Int
        get() = (if (userDocExists) 1 else 0) + jobsCount + applicationsCount
}

data class UserWorkspaceSnapshot(
    val profile: MasterProfile = MasterProfile(),
    val qaVault: QAVault = QAVault(),
    val warrantyAccepted: Boolean = false,
    val selectedTier: PricingTier = PricingTier.TIER_4,
    val submissionEpochMs: List<Long> = emptyList()
)

class CareerPilotRepository {

    val auth: FirebaseAuth = FirebaseAuth.getInstance()
    val db: FirebaseFirestore = Firebase.firestore(BuildConfig.FIRESTORE_DATABASE_ID)

    companion object {
        const val HARD_MAX_DAILY_CAP = 25
        const val COOLDOWN_MS = 60_000L
        const val ROLLING_WINDOW_MS = 24L * 60L * 60L * 1000L
    }

    fun authStateFlow(): Flow<FirebaseUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { firebaseAuth ->
            trySend(firebaseAuth.currentUser)
        }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    suspend fun signInWithGoogleCredential(credential: AuthCredential): FirebaseUser {
        val result = auth.signInWithCredential(credential).await()
        return requireNotNull(result.user) { "Google Sign-In did not return a Firebase user." }
    }

    suspend fun signInWithEmail(email: String, password: String): FirebaseUser {
        val result = auth.signInWithEmailAndPassword(email.trim(), password).await()
        return requireNotNull(result.user) { "Email Sign-In failed." }
    }

    suspend fun registerWithEmail(email: String, password: String): FirebaseUser {
        val result = auth.createUserWithEmailAndPassword(email.trim(), password).await()
        val user = requireNotNull(result.user) { "Account creation failed." }
        user.sendEmailVerification().await()
        return user
    }

    fun signOut() {
        auth.signOut()
    }

    /**
     * Initializes user workspace and seeds 8 realistic India/Global sample jobs + pending approval cards
     * if the user has no Firestore workspace document yet.
     */
    suspend fun ensureSeededWorkspace(user: FirebaseUser) {
        val uid = user.uid
        val userRef = db.collection("users").document(uid)
        val existing = userRef.get().await()
        if (existing.exists()) return

        val seededProfile = defaultSeedProfile(user.email ?: "candidate@example.com")
        val seededVault = defaultSeedVault()

        val userDoc = hashMapOf(
            "ownerId" to uid,
            "email" to seededProfile.email,
            "fullName" to seededProfile.fullName,
            "headline" to seededProfile.headline,
            "phone" to seededProfile.phone,
            "location" to seededProfile.location,
            "summary" to seededProfile.summary,
            "skills" to seededProfile.skills,
            "experience" to seededProfile.experience.map { it.toMap() },
            "education" to seededProfile.education.map { it.toMap() },
            "projects" to seededProfile.projects.map { it.toMap() },
            "qaVault" to seededVault.toMap(),
            "warrantyAccepted" to false,
            "selectedTier" to PricingTier.TIER_4.id,
            "submissionEpochMs" to emptyList<Long>(),
            "createdAt" to FieldValue.serverTimestamp(),
            "updatedAt" to FieldValue.serverTimestamp()
        )
        userRef.set(userDoc).await()

        val jobs = createEightSampleJobs(uid)
        val batch = db.batch()
        jobs.forEach { job ->
            val jobRef = userRef.collection("jobs").document(job.id)
            batch.set(jobRef, job.toFirestoreMap(isCreate = true))
        }
        createInitialPendingApplications(uid, jobs, seededVault).forEach { app ->
            val appRef = userRef.collection("applications").document(app.id)
            batch.set(appRef, app.toFirestoreMap(isCreate = true))
        }
        batch.commit().await()
    }

    fun observeWorkspace(uid: String): Flow<UserWorkspaceSnapshot> = callbackFlow {
        val reg = db.collection("users").document(uid).addSnapshotListener { snap, err ->
            if (err != null) {
                close(err)
                return@addSnapshotListener
            }
            if (snap != null && snap.exists()) {
                trySend(parseWorkspace(snap))
            } else {
                trySend(UserWorkspaceSnapshot())
            }
        }
        awaitClose { reg.remove() }
    }

    fun observeJobs(uid: String): Flow<List<JobListing>> = callbackFlow {
        val reg = db.collection("users").document(uid)
            .collection("jobs")
            .whereEqualTo("ownerId", uid)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    close(err)
                    return@addSnapshotListener
                }
                val items = snap?.documents?.map { parseJob(it) }
                    ?.sortedByDescending { it.matchScore }
                    .orEmpty()
                trySend(items)
            }
        awaitClose { reg.remove() }
    }

    fun observeApplications(uid: String): Flow<List<ApplicationRecord>> = callbackFlow {
        val reg = db.collection("users").document(uid)
            .collection("applications")
            .whereEqualTo("ownerId", uid)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    close(err)
                    return@addSnapshotListener
                }
                val items = snap?.documents?.map { parseApplication(it) }
                    ?.sortedByDescending { it.updatedAtEpochMs }
                    .orEmpty()
                trySend(items)
            }
        awaitClose { reg.remove() }
    }

    suspend fun saveProfileAndVault(
        uid: String,
        profile: MasterProfile,
        vault: QAVault,
        warrantyAccepted: Boolean
    ) {
        val userRef = db.collection("users").document(uid)
        userRef.update(
            mapOf(
                "email" to profile.email.take(200),
                "fullName" to profile.fullName.take(120),
                "headline" to profile.headline.take(240),
                "phone" to profile.phone.take(40),
                "location" to profile.location.take(120),
                "summary" to profile.summary.take(2000),
                "skills" to profile.skills.take(40),
                "experience" to profile.experience.take(15).map { it.toMap() },
                "education" to profile.education.take(10).map { it.toMap() },
                "projects" to profile.projects.take(15).map { it.toMap() },
                "qaVault" to vault.toMap(),
                "warrantyAccepted" to warrantyAccepted,
                "updatedAt" to FieldValue.serverTimestamp()
            )
        ).await()
    }

    suspend fun updatePricingTier(uid: String, tier: PricingTier) {
        db.collection("users").document(uid).update(
            mapOf(
                "selectedTier" to tier.id,
                "updatedAt" to FieldValue.serverTimestamp()
            )
        ).await()
    }

    suspend fun upsertJobAndQueueIfQualified(
        uid: String,
        job: JobListing,
        applicationDraft: ApplicationRecord?
    ) {
        val userRef = db.collection("users").document(uid)
        val jobRef = userRef.collection("jobs").document(job.id)
        val existingJob = jobRef.get().await()
        if (existingJob.exists()) {
            jobRef.update(
                mapOf(
                    "matchScore" to job.matchScore.coerceIn(0, 100),
                    "portalComplexity" to job.portalComplexity,
                    "matchedKeywords" to job.matchedKeywords.take(12),
                    "missingKeywords" to job.missingKeywords.take(12),
                    "updatedAt" to FieldValue.serverTimestamp()
                )
            ).await()
        } else {
            jobRef.set(job.toFirestoreMap(isCreate = true)).await()
        }

        if (applicationDraft != null) {
            userRef.collection("applications")
                .document(applicationDraft.id)
                .set(applicationDraft.toFirestoreMap(isCreate = true))
                .await()
        }
    }

    /**
     * Persists resume-discovered jobs in Firestore /users/{uid}/jobs/{jobId} conforming to firestore.rules.
     */
    suspend fun saveDiscoveredJobs(uid: String, jobs: List<JobListing>) {
        val userRef = db.collection("users").document(uid)
        jobs.take(12).forEach { job ->
            val safeId = job.id.replace(Regex("[^a-zA-Z0-9_-]"), "_").take(128)
            val jobRef = userRef.collection("jobs").document(safeId)
            val existing = jobRef.get().await()
            if (existing.exists()) {
                jobRef.update(
                    mapOf(
                        "matchScore" to job.matchScore.coerceIn(0, 100),
                        "portalComplexity" to job.portalComplexity,
                        "matchedKeywords" to job.matchedKeywords.take(12),
                        "missingKeywords" to job.missingKeywords.take(12),
                        "updatedAt" to FieldValue.serverTimestamp()
                    )
                ).await()
            } else {
                jobRef.set(job.copy(id = safeId, ownerId = uid).toFirestoreMap(isCreate = true)).await()
            }
        }
    }

    /**
     * Executes job search and filtering against the Firestore backend collection /users/{uid}/jobs.
     */
    suspend fun searchJobsInBackend(
        uid: String,
        query: String = "",
        country: String = "All",
        market: String = "All",
        workMode: String = "All",
        portalType: String = "All",
        minMatchScore: Int = 0
    ): List<JobListing> {
        val snap = db.collection("users")
            .document(uid)
            .collection("jobs")
            .whereEqualTo("ownerId", uid)
            .get()
            .await()

        val tokens = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
        return snap.documents
            .map { parseJob(it) }
            .filter { job ->
                (country == "All" || CountryFilterMatcher.matchesCountry(job, country)) &&
                    (country != "All" || market == "All" || job.market == market) &&
                    (workMode == "All" || job.workMode == workMode) &&
                    (portalType == "All" || job.portalType == portalType) &&
                    job.matchScore >= minMatchScore &&
                    (tokens.isEmpty() || tokens.all { tok ->
                        val haystack = listOf(
                            job.company,
                            job.role,
                            job.location,
                            CountryFilterMatcher.inferCountry(job.location, job.market, job.salary),
                            job.description,
                            job.portalType,
                            job.matchedKeywords.joinToString(" ")
                        ).joinToString(" ").lowercase()
                        haystack.contains(tok)
                    })
            }
            .sortedByDescending { it.matchScore }
    }

    suspend fun saveEditedAnswersToVault(
        uid: String,
        appId: String,
        updatedAnswers: List<ScreeningAnswer>,
        currentVault: QAVault
    ) {
        val mergedCustomQAs = currentVault.customQAs.toMutableList()
        val reviewedList = updatedAnswers.map { sq ->
            if (sq.confidence == "AMBER" && sq.answer.isNotBlank()) {
                val existingIdx = mergedCustomQAs.indexOfFirst {
                    it.question.equals(sq.question, ignoreCase = true)
                }
                val entry = SavedCustomQA(
                    id = if (existingIdx >= 0) mergedCustomQAs[existingIdx].id else "cqa-${System.currentTimeMillis()}",
                    question = sq.question,
                    answer = sq.answer.trim(),
                    savedAt = System.currentTimeMillis().toString()
                )
                if (existingIdx >= 0) mergedCustomQAs[existingIdx] = entry else mergedCustomQAs.add(0, entry)
                sq.copy(reviewed = true, sourceLabel = "Reviewed & saved to Q&A Vault")
            } else {
                sq.copy(reviewed = true)
            }
        }

        val nextVault = currentVault.copy(customQAs = mergedCustomQAs.take(25))
        val userRef = db.collection("users").document(uid)

        val batch = db.batch()
        batch.update(
            userRef.collection("applications").document(appId),
            mapOf(
                "screeningQuestions" to reviewedList.map { it.toMap() },
                "updatedAt" to FieldValue.serverTimestamp()
            )
        )
        batch.update(
            userRef,
            mapOf(
                "qaVault" to nextVault.toMap(),
                "updatedAt" to FieldValue.serverTimestamp()
            )
        )
        batch.commit().await()
    }

    fun computeGuardrails(tier: PricingTier, submissionEpochMs: List<Long>, nowMs: Long = System.currentTimeMillis()): GuardrailState {
        val cutoff = nowMs - ROLLING_WINDOW_MS
        val recent = submissionEpochMs.filter { it >= cutoff }
        val effectiveCap = minOf(tier.dailyCap, HARD_MAX_DAILY_CAP)
        val latest = recent.maxOrNull()
        val cooldownSec = if (latest != null && nowMs - latest < COOLDOWN_MS) {
            ((COOLDOWN_MS - (nowMs - latest) + 999) / 1000).toInt()
        } else 0
        return GuardrailState(
            dailyCap = effectiveCap,
            usedLast24h = recent.size,
            cooldownSecondsRemaining = cooldownSec
        )
    }

    /**
     * Enforces Warranty consent, Rolling 24h Daily Cap (25/day or 20/day), and 60-second Cooldown,
     * then logs user_approved_at = FieldValue.serverTimestamp() in Firestore.
     */
    suspend fun approveAndRecordSubmission(
        uid: String,
        workspace: UserWorkspaceSnapshot,
        appId: String,
        finalAnswers: List<ScreeningAnswer>,
        outcome: ApplicationStatus,
        actionReason: String = ""
    ) {
        require(workspace.warrantyAccepted) {
            "Accept the User-Agent & Applicant Accuracy Warranty in Profile before submitting."
        }
        val nowMs = System.currentTimeMillis()
        val guardrails = computeGuardrails(workspace.selectedTier, workspace.submissionEpochMs, nowMs)
        if (outcome == ApplicationStatus.SUBMITTED) {
            require(guardrails.remainingToday > 0) {
                "Daily anti-spam cap reached (${guardrails.dailyCap} applications per rolling 24h window)."
            }
            require(guardrails.cooldownSecondsRemaining <= 0) {
                "60-second anti-spam cooldown active (${guardrails.cooldownSecondsRemaining}s remaining)."
            }
        }

        val receiptId = "CP-2026-${UUID.randomUUID().toString().take(6).uppercase()}"
        val userRef = db.collection("users").document(uid)
        val appRef = userRef.collection("applications").document(appId)

        val batch = db.batch()
        batch.update(
            appRef,
            mapOf(
                "status" to outcome.name,
                "screeningQuestions" to finalAnswers.map { it.copy(reviewed = true).toMap() },
                "auditReceiptId" to receiptId,
                "actionReason" to actionReason.take(400),
                "user_approved_at" to FieldValue.serverTimestamp(),
                "updatedAt" to FieldValue.serverTimestamp()
            )
        )

        if (outcome == ApplicationStatus.SUBMITTED) {
            val cutoff = nowMs - ROLLING_WINDOW_MS
            val updatedEpochs = (workspace.submissionEpochMs.filter { it >= cutoff } + nowMs)
                .takeLast(HARD_MAX_DAILY_CAP)
            batch.update(
                userRef,
                mapOf(
                    "submissionEpochMs" to updatedEpochs,
                    "updatedAt" to FieldValue.serverTimestamp()
                )
            )
        }
        batch.commit().await()
    }

    suspend fun skipApplication(uid: String, appId: String) {
        val receiptId = "CP-SKIP-${UUID.randomUUID().toString().take(6).uppercase()}"
        db.collection("users").document(uid)
            .collection("applications").document(appId)
            .update(
                mapOf(
                    "status" to ApplicationStatus.SKIPPED.name,
                    "auditReceiptId" to receiptId,
                    "updatedAt" to FieldValue.serverTimestamp()
                )
            ).await()
    }

    suspend fun resumeActionRequired(
        uid: String,
        workspace: UserWorkspaceSnapshot,
        appId: String
    ) {
        val nowMs = System.currentTimeMillis()
        val guardrails = computeGuardrails(workspace.selectedTier, workspace.submissionEpochMs, nowMs)
        require(guardrails.canSubmitNow) {
            if (guardrails.remainingToday <= 0) "Daily cap reached." else "Wait ${guardrails.cooldownSecondsRemaining}s cooldown."
        }
        val cutoff = nowMs - ROLLING_WINDOW_MS
        val updatedEpochs = (workspace.submissionEpochMs.filter { it >= cutoff } + nowMs)
            .takeLast(HARD_MAX_DAILY_CAP)
        val userRef = db.collection("users").document(uid)

        val batch = db.batch()
        batch.update(
            userRef.collection("applications").document(appId),
            mapOf(
                "status" to ApplicationStatus.SUBMITTED.name,
                "actionReason" to "",
                "updatedAt" to FieldValue.serverTimestamp()
            )
        )
        batch.update(
            userRef,
            mapOf(
                "submissionEpochMs" to updatedEpochs,
                "updatedAt" to FieldValue.serverTimestamp()
            )
        )
        batch.commit().await()
    }

    /**
     * Public Recruiter Opt-Out: stores ONLY a one-way SHA-256 hash of the normalized LinkedIn URL.
     */
    suspend fun submitRecruiterOptOut(linkedinUrl: String): String {
        require(PrivacyHashUtil.isSafeExternalUrl(linkedinUrl) && linkedinUrl.contains("linkedin.com", ignoreCase = true)) {
            "Enter a valid https://www.linkedin.com/in/... profile URL."
        }
        val sha256 = PrivacyHashUtil.sha256LinkedInUrl(linkedinUrl)
        db.collection("recruiterOptOuts").document(sha256).set(
            mapOf(
                "urlSha256" to sha256,
                "active" to true,
                "createdAt" to FieldValue.serverTimestamp()
            )
        ).await()
        return sha256
    }

    suspend fun isRecruiterBlocked(linkedinUrl: String): Boolean {
        if (linkedinUrl.isBlank()) return false
        val sha256 = PrivacyHashUtil.sha256LinkedInUrl(linkedinUrl)
        val snap = db.collection("recruiterOptOuts").document(sha256).get().await()
        return snap.exists() && snap.getBoolean("active") == true
    }

    /**
     * 1-Click Delete Account & All Data: wipes all Firestore documents under /users/{uid}.
     */
    suspend fun deleteAccountAndAllData(uid: String) {
        val userRef = db.collection("users").document(uid)
        val jobsSnap = userRef.collection("jobs").whereEqualTo("ownerId", uid).get().await()
        val appsSnap = userRef.collection("applications").whereEqualTo("ownerId", uid).get().await()

        val batch = db.batch()
        jobsSnap.documents.forEach { batch.delete(it.reference) }
        appsSnap.documents.forEach { batch.delete(it.reference) }
        batch.delete(userRef)
        batch.commit().await()
    }

    /**
     * Non-destructive dry-run verification for Diagnostics Check 6.
     * Audits the exact Firestore document paths that 1-click deletion would wipe without modifying live data.
     */
    suspend fun dryRunUserDataWipe(uid: String): DryRunWipeReport {
        val userRef = db.collection("users").document(uid)
        val userSnap = userRef.get().await()
        val jobsSnap = userRef.collection("jobs").whereEqualTo("ownerId", uid).get().await()
        val appsSnap = userRef.collection("applications").whereEqualTo("ownerId", uid).get().await()
        return DryRunWipeReport(
            userDocPath = "users/$uid",
            userDocExists = userSnap.exists(),
            jobsCount = jobsSnap.size(),
            applicationsCount = appsSnap.size()
        )
    }

    // --- Serialization Helpers ---
    private fun ExperienceItem.toMap() = mapOf(
        "id" to id, "company" to company, "title" to title,
        "location" to location, "startDate" to startDate, "endDate" to endDate, "bullets" to bullets
    )

    private fun EducationItem.toMap() = mapOf(
        "id" to id, "institution" to institution, "degree" to degree,
        "graduationYear" to graduationYear, "details" to details
    )

    private fun ProjectItem.toMap() = mapOf(
        "id" to id, "name" to name, "techStack" to techStack, "description" to description
    )

    private fun QAVault.toMap() = mapOf(
        "currentCtc" to currentCtc,
        "expectedCtc" to expectedCtc,
        "noticePeriodDays" to noticePeriodDays,
        "workAuthorization" to workAuthorization,
        "relocationPreference" to relocationPreference,
        "linkedinUrl" to linkedinUrl,
        "customQAs" to customQAs.map {
            mapOf("id" to it.id, "question" to it.question, "answer" to it.answer, "savedAt" to it.savedAt)
        }
    )

    private fun HiringTeamMember.toMap() = mapOf(
        "name" to name, "title" to title, "linkedinUrl" to linkedinUrl,
        "postedAgo" to postedAgo, "autoPurgeDaysRemaining" to autoPurgeDaysRemaining
    )

    private fun ResumeDiffItem.toMap() = mapOf(
        "id" to id, "experienceRef" to experienceRef,
        "before" to before, "after" to after, "rationale" to rationale
    )

    private fun ScreeningAnswer.toMap() = mapOf(
        "id" to id, "question" to question, "answer" to answer,
        "confidence" to confidence, "sourceLabel" to sourceLabel, "reviewed" to reviewed
    )

    private fun JobListing.toFirestoreMap(isCreate: Boolean): Map<String, Any> {
        val m = mutableMapOf<String, Any>(
            "ownerId" to ownerId,
            "company" to company.take(120),
            "role" to role.take(160),
            "location" to location.take(120),
            "market" to market,
            "salary" to salary.take(100),
            "workMode" to workMode,
            "portalType" to portalType,
            "portalComplexity" to portalComplexity,
            "matchScore" to matchScore.coerceIn(0, 100),
            "matchedKeywords" to matchedKeywords.take(12),
            "missingKeywords" to missingKeywords.take(12),
            "description" to description.take(6000),
            "jobUrl" to jobUrl.take(500),
            "hiringTeam" to hiringTeam.toMap(),
            "updatedAt" to FieldValue.serverTimestamp()
        )
        if (isCreate) m["createdAt"] = FieldValue.serverTimestamp()
        return m
    }

    private fun ApplicationRecord.toFirestoreMap(isCreate: Boolean): Map<String, Any> {
        val m = mutableMapOf<String, Any>(
            "ownerId" to ownerId,
            "jobId" to jobId,
            "company" to company.take(120),
            "role" to role.take(160),
            "location" to location.take(120),
            "salary" to salary.take(100),
            "workMode" to workMode,
            "portalType" to portalType,
            "portalComplexity" to portalComplexity,
            "jobUrl" to jobUrl.take(500),
            "matchScore" to matchScore.coerceIn(0, 100),
            "status" to status.name,
            "hiringTeam" to hiringTeam.toMap(),
            "linkedinNote" to linkedinNote.take(280),
            "resumeDiffs" to resumeDiffs.take(8).map { it.toMap() },
            "screeningQuestions" to screeningQuestions.take(15).map { it.toMap() },
            "auditReceiptId" to auditReceiptId.take(64),
            "actionReason" to actionReason.take(400),
            "updatedAt" to FieldValue.serverTimestamp()
        )
        if (isCreate) m["createdAt"] = FieldValue.serverTimestamp()
        return m
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseWorkspace(doc: DocumentSnapshot): UserWorkspaceSnapshot {
        val expList = (doc.get("experience") as? List<Map<String, Any?>>).orEmpty().map { m ->
            ExperienceItem(
                id = m["id"] as? String ?: "",
                company = m["company"] as? String ?: "",
                title = m["title"] as? String ?: "",
                location = m["location"] as? String ?: "",
                startDate = m["startDate"] as? String ?: "",
                endDate = m["endDate"] as? String ?: "",
                bullets = (m["bullets"] as? List<String>).orEmpty()
            )
        }
        val eduList = (doc.get("education") as? List<Map<String, Any?>>).orEmpty().map { m ->
            EducationItem(
                id = m["id"] as? String ?: "",
                institution = m["institution"] as? String ?: "",
                degree = m["degree"] as? String ?: "",
                graduationYear = m["graduationYear"] as? String ?: "",
                details = m["details"] as? String ?: ""
            )
        }
        val projList = (doc.get("projects") as? List<Map<String, Any?>>).orEmpty().map { m ->
            ProjectItem(
                id = m["id"] as? String ?: "",
                name = m["name"] as? String ?: "",
                techStack = (m["techStack"] as? List<String>).orEmpty(),
                description = m["description"] as? String ?: ""
            )
        }
        val vaultMap = doc.get("qaVault") as? Map<String, Any?> ?: emptyMap()
        val customQAs = (vaultMap["customQAs"] as? List<Map<String, Any?>>).orEmpty().map { m ->
            SavedCustomQA(
                id = m["id"] as? String ?: "",
                question = m["question"] as? String ?: "",
                answer = m["answer"] as? String ?: "",
                savedAt = m["savedAt"] as? String ?: ""
            )
        }
        val epochs = (doc.get("submissionEpochMs") as? List<Number>).orEmpty().map { it.toLong() }

        return UserWorkspaceSnapshot(
            profile = MasterProfile(
                fullName = doc.getString("fullName") ?: "",
                headline = doc.getString("headline") ?: "",
                email = doc.getString("email") ?: "",
                phone = doc.getString("phone") ?: "",
                location = doc.getString("location") ?: "",
                linkedinUrl = vaultMap["linkedinUrl"] as? String ?: "",
                summary = doc.getString("summary") ?: "",
                skills = (doc.get("skills") as? List<String>).orEmpty(),
                experience = expList,
                education = eduList,
                projects = projList
            ),
            qaVault = QAVault(
                currentCtc = vaultMap["currentCtc"] as? String ?: "",
                expectedCtc = vaultMap["expectedCtc"] as? String ?: "",
                noticePeriodDays = vaultMap["noticePeriodDays"] as? String ?: "30",
                workAuthorization = vaultMap["workAuthorization"] as? String ?: "",
                relocationPreference = vaultMap["relocationPreference"] as? String ?: "",
                linkedinUrl = vaultMap["linkedinUrl"] as? String ?: "",
                customQAs = customQAs
            ),
            warrantyAccepted = doc.getBoolean("warrantyAccepted") ?: false,
            selectedTier = PricingTier.fromId(doc.getString("selectedTier") ?: "tier4"),
            submissionEpochMs = epochs
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseJob(doc: DocumentSnapshot): JobListing {
        val ht = doc.get("hiringTeam") as? Map<String, Any?> ?: emptyMap()
        return JobListing(
            id = doc.id,
            ownerId = doc.getString("ownerId") ?: "",
            company = doc.getString("company") ?: "",
            role = doc.getString("role") ?: "",
            location = doc.getString("location") ?: "",
            market = doc.getString("market") ?: "India",
            salary = doc.getString("salary") ?: "",
            workMode = doc.getString("workMode") ?: "Hybrid",
            portalType = doc.getString("portalType") ?: "Greenhouse",
            portalComplexity = doc.getString("portalComplexity") ?: "1-Click",
            matchScore = (doc.getLong("matchScore") ?: 0L).toInt(),
            matchedKeywords = (doc.get("matchedKeywords") as? List<String>).orEmpty(),
            missingKeywords = (doc.get("missingKeywords") as? List<String>).orEmpty(),
            description = doc.getString("description") ?: "",
            jobUrl = doc.getString("jobUrl") ?: "",
            hiringTeam = HiringTeamMember(
                name = ht["name"] as? String ?: "",
                title = ht["title"] as? String ?: "",
                linkedinUrl = ht["linkedinUrl"] as? String ?: "",
                postedAgo = ht["postedAgo"] as? String ?: "2 days ago",
                autoPurgeDaysRemaining = (ht["autoPurgeDaysRemaining"] as? Number)?.toInt() ?: 30
            )
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseApplication(doc: DocumentSnapshot): ApplicationRecord {
        val ht = doc.get("hiringTeam") as? Map<String, Any?> ?: emptyMap()
        val diffs = (doc.get("resumeDiffs") as? List<Map<String, Any?>>).orEmpty().map { m ->
            ResumeDiffItem(
                id = m["id"] as? String ?: "",
                experienceRef = m["experienceRef"] as? String ?: "",
                before = m["before"] as? String ?: "",
                after = m["after"] as? String ?: "",
                rationale = m["rationale"] as? String ?: ""
            )
        }
        val sqs = (doc.get("screeningQuestions") as? List<Map<String, Any?>>).orEmpty().map { m ->
            ScreeningAnswer(
                id = m["id"] as? String ?: "",
                question = m["question"] as? String ?: "",
                answer = m["answer"] as? String ?: "",
                confidence = m["confidence"] as? String ?: "AMBER",
                sourceLabel = m["sourceLabel"] as? String ?: "",
                reviewed = m["reviewed"] as? Boolean ?: false
            )
        }
        val statusStr = doc.getString("status") ?: ApplicationStatus.PENDING_APPROVAL.name
        return ApplicationRecord(
            id = doc.id,
            ownerId = doc.getString("ownerId") ?: "",
            jobId = doc.getString("jobId") ?: "",
            company = doc.getString("company") ?: "",
            role = doc.getString("role") ?: "",
            location = doc.getString("location") ?: "",
            salary = doc.getString("salary") ?: "",
            workMode = doc.getString("workMode") ?: "Remote",
            portalType = doc.getString("portalType") ?: "Greenhouse",
            portalComplexity = doc.getString("portalComplexity") ?: "1-Click",
            jobUrl = doc.getString("jobUrl") ?: "",
            matchScore = (doc.getLong("matchScore") ?: 0L).toInt(),
            status = runCatching { ApplicationStatus.valueOf(statusStr) }.getOrDefault(ApplicationStatus.PENDING_APPROVAL),
            hiringTeam = HiringTeamMember(
                name = ht["name"] as? String ?: "",
                title = ht["title"] as? String ?: "",
                linkedinUrl = ht["linkedinUrl"] as? String ?: "",
                postedAgo = ht["postedAgo"] as? String ?: "2 days ago",
                autoPurgeDaysRemaining = (ht["autoPurgeDaysRemaining"] as? Number)?.toInt() ?: 30
            ),
            linkedinNote = doc.getString("linkedinNote") ?: "",
            resumeDiffs = diffs,
            screeningQuestions = sqs,
            auditReceiptId = doc.getString("auditReceiptId") ?: "",
            actionReason = doc.getString("actionReason") ?: "",
            userApprovedAtEpochMs = doc.getTimestamp("user_approved_at")?.toDate()?.time,
            updatedAtEpochMs = doc.getTimestamp("updatedAt")?.toDate()?.time ?: System.currentTimeMillis()
        )
    }

    private fun defaultSeedProfile(email: String) = MasterProfile(
        fullName = "Ananya Deshmukh",
        headline = "Senior Android & Full-Stack Engineer (Kotlin, Compose, TypeScript, Fintech)",
        email = email,
        phone = "+91 98450 11204",
        location = "Bengaluru, India",
        summary = "Product-focused engineer with 6+ years shipping high-throughput UPI checkout SDKs, Jetpack Compose consumer apps, and resilient cloud APIs.",
        skills = listOf("Kotlin", "Jetpack Compose", "Material 3", "Firebase", "TypeScript", "React", "Coroutines", "GraphQL", "PostgreSQL"),
        experience = listOf(
            ExperienceItem(
                id = "exp-1",
                company = "FinStack Payments",
                title = "Senior Mobile & Frontend Engineer",
                location = "Bengaluru, India",
                startDate = "Mar 2022",
                endDate = "Present",
                bullets = listOf(
                    "Architected a modular Kotlin & Compose UPI checkout SDK handling 1.8M monthly transactions at 99.96% crash-free sessions.",
                    "Cut cold start latency by 41% through baseline profiles, lazy graph loading, and offline Room caching.",
                    "Led a 4-engineer Material 3 design system guild standardizing 38 accessible UI components across merchant apps."
                )
            ),
            ExperienceItem(
                id = "exp-2",
                company = "CloudLedger Labs",
                title = "Software Engineer",
                location = "Mumbai, India",
                startDate = "Jul 2019",
                endDate = "Feb 2022",
                bullets = listOf(
                    "Built multi-currency invoicing and GST reconciliation flows serving 14,000+ SMB merchants.",
                    "Designed idempotent webhook pipelines and rate-limited REST APIs processing 250k daily ledger events."
                )
            )
        ),
        education = listOf(
            EducationItem("edu-1", "NIT Surathkal", "B.Tech in Computer Science & Engineering", "2019", "CGPA 8.7 / 10")
        ),
        projects = listOf(
            ProjectItem("proj-1", "PayGrid Offline POS", listOf("Kotlin", "Compose", "Firestore"), "Offline-first merchant POS with queued transaction sync and sub-100ms touch response.")
        )
    )

    private fun defaultSeedVault() = QAVault(
        currentCtc = "₹31 LPA (Fixed) + ESOPs",
        expectedCtc = "₹42–48 LPA (India)",
        noticePeriodDays = "30",
        workAuthorization = "Indian Citizen · Authorized to work in India",
        relocationPreference = "Bengaluru / Mumbai / Hyderabad Hybrid or Remote (India)",
        linkedinUrl = "https://www.linkedin.com/in/ananya-deshmukh-eng"
    )

    private fun createEightSampleJobs(uid: String): List<JobListing> = listOf(
        JobListing("job_razorpay", uid, "Razorpay", "Senior Android Engineer — Checkout SDK", "Bengaluru, India", "India", "₹34L – ₹46L CTC", "Hybrid", "Greenhouse", "1-Click", 92, listOf("Kotlin", "Jetpack Compose", "UPI Checkout", "Material 3"), listOf("NDK"), "Own ultra-fast UPI & card checkout SDKs powering millions of daily Indian transactions. Optimize cold start latency, accessibility, and crash-free rate.", "https://boards.greenhouse.io/razorpay/jobs/checkout-android", HiringTeamMember("Siddharth Kulkarni", "Engineering Manager, Checkout", "https://www.linkedin.com/in/siddharth-kulkarni-checkout", "2 days ago", 28)),
        // Other regions commented out — focusing on India first
        // JobListing("job_stripe", uid, "Stripe", "Mobile & Product Engineer — Global Billing", "Remote (US / EU / Global)", "Global", "$168k – $208k USD", "Remote", "Ashby", "1-Click", 89, listOf("Kotlin", "Multi-currency Invoicing", "REST APIs", "Design Systems"), listOf("Ruby"), "Build developer-first billing, checkout, and multi-currency merchant surfaces with high reliability and idempotent API workflows.", "https://jobs.ashbyhq.com/stripe/global-billing-eng", HiringTeamMember("Elena Rostova", "Staff Recruiting Partner", "https://www.linkedin.com/in/elena-rostova-recruiting", "1 day ago", 29)),
        JobListing("job_swiggy", uid, "Swiggy", "Staff Android Engineer — Consumer App", "Bengaluru, India", "India", "₹42L – ₹56L CTC", "Hybrid", "Naukri", "Multi-Step", 85, listOf("Kotlin", "Jetpack Compose", "Cold Start", "Offline Caching"), listOf("KMM"), "Lead Jetpack Compose migration and performance optimization for Swiggy food and Instamart flows across millions of Android devices. Requires Notice Period details.", "https://www.naukri.com/swiggy-staff-android-bengaluru", HiringTeamMember("Pranav Mehta", "Principal Talent Partner", "https://www.linkedin.com/in/pranav-mehta-talent", "4 days ago", 26)),
        // Other regions commented out — focusing on India first
        // JobListing("job_linear", uid, "Linear", "Senior Mobile Product Engineer", "Remote (US / EU)", "Global", "$175k – $215k USD", "Remote", "Ashby", "1-Click", 86, listOf("Kotlin", "Offline-first", "Material 3", "Coroutines"), listOf("Sync Engine"), "Craft snappy, offline-capable mobile productivity experiences with sub-50ms touch response and clean visual restraint.", "https://jobs.ashbyhq.com/linear/mobile-product-eng", HiringTeamMember("Marcus Lindqvist", "Head of Engineering Recruiting", "https://www.linkedin.com/in/marcus-lindqvist-linear", "3 days ago", 27)),
        JobListing("job_zepto", uid, "Zepto", "Lead Android & Compose Engineer", "Mumbai, India", "India", "₹36L – ₹48L CTC", "Hybrid", "Lever", "1-Click", 82, listOf("Kotlin", "Jetpack Compose", "Material 3", "UPI Checkout"), listOf("Hilt"), "Own rapid-commerce Android checkout and dark-store operator workflows in Mumbai. Notice period & current CTC required.", "https://jobs.lever.co/zepto/lead-android-mumbai", HiringTeamMember("Kavya Nair", "Technical Recruiter", "https://www.linkedin.com/in/kavya-nair-zepto", "5 days ago", 25)),
        // Other regions commented out — focusing on India first
        // JobListing("job_vercel", uid, "Vercel", "Senior Software Engineer — Mobile & DX", "Remote (Global)", "Global", "$170k – $210k USD", "Remote", "Greenhouse", "1-Click", 83, listOf("TypeScript", "React", "Firebase", "Design Systems"), listOf("Rust"), "Build deployment observability apps and developer experience surfaces for engineering teams globally.", "https://boards.greenhouse.io/vercel/jobs/senior-swe-dx", HiringTeamMember("Jordan Brooks", "Senior Technical Recruiter", "https://www.linkedin.com/in/jordan-brooks-dx", "2 days ago", 28)),
        JobListing("job_atlassian", uid, "Atlassian", "Principal Android Architect — Jira Mobile", "Bengaluru, India", "India", "₹55L – ₹72L CTC", "Remote", "Workday", "Multi-Step", 71, listOf("Kotlin", "Jetpack Compose", "GraphQL", "Material 3"), listOf("10+ yrs enterprise"), "Set multi-year Android architecture across Jira Cloud mobile modules and accessibility systems.", "https://atlassian.wd5.myworkdayjobs.com/en-US/careers/principal-android", HiringTeamMember("Deepak Sharma", "Director of Engineering", "https://www.linkedin.com/in/deepak-sharma-workmgmt", "6 days ago", 24)),
        JobListing("job_cred", uid, "CRED", "Senior Android Platform Engineer", "Bengaluru, India", "India", "₹38L – ₹52L CTC", "On-site", "Lever", "Multi-Step", 74, listOf("Kotlin", "Jetpack Compose", "UPI Checkout", "Coroutines"), listOf("OpenGL"), "Build high-craft financial member experiences with smooth 120Hz Compose animations and strict reliability.", "https://jobs.lever.co/cred/senior-android-platform", HiringTeamMember("Rohan Malhotra", "Staff Engineering Manager", "https://www.linkedin.com/in/rohan-malhotra-cred", "3 days ago", 27))
    )

    private fun createInitialPendingApplications(
        uid: String,
        jobs: List<JobListing>,
        vault: QAVault
    ): List<ApplicationRecord> {
        val rzp = jobs[0]
        return listOf(
            ApplicationRecord(
                id = "app_razorpay_seed",
                ownerId = uid,
                jobId = rzp.id,
                company = rzp.company,
                role = rzp.role,
                location = rzp.location,
                salary = rzp.salary,
                workMode = rzp.workMode,
                portalType = rzp.portalType,
                portalComplexity = rzp.portalComplexity,
                jobUrl = rzp.jobUrl,
                matchScore = rzp.matchScore,
                status = ApplicationStatus.PENDING_APPROVAL,
                hiringTeam = rzp.hiringTeam,
                linkedinNote = "Hi Siddharth — saw your Checkout SDK Android opening at Razorpay. At FinStack Payments I built a Kotlin/Compose UPI SDK (1.8M monthly txns, 99.96% crash-free) and cut cold start by 41%. Would love to connect!",
                resumeDiffs = listOf(
                    ResumeDiffItem("d1", "FinStack Payments · Senior Engineer", "Architected a modular Kotlin & Compose UPI checkout SDK handling 1.8M monthly transactions at 99.96% crash-free sessions.", "Architected a high-throughput Kotlin & Jetpack Compose UPI checkout SDK powering 1.8M monthly transactions at 99.96% crash-free stability (pinned #1 for Checkout SDK).", "Elevated verified UPI SDK impact to lead bullet."),
                    ResumeDiffItem("d2", "FinStack Payments · Senior Engineer", "Cut cold start latency by 41% through baseline profiles, lazy graph loading, and offline Room caching.", "Reduced Android cold start latency by 41% using Baseline Profiles, lazy DI graph loading, and offline Room caching.", "Aligned verified performance metric directly with JD focus."),
                    ResumeDiffItem("d3", "FinStack Payments · Senior Engineer", "Led a 4-engineer Material 3 design system guild standardizing 38 accessible UI components across merchant apps.", "Led a 4-engineer Material 3 design system guild unifying 38 WCAG-accessible Compose components across checkout & merchant apps.", "Surfaced accessibility and Material 3 overlap strictly from profile.")
                ),
                screeningQuestions = listOf(
                    ScreeningAnswer("sq1", "Why are you excited about Razorpay Checkout SDK, and what mobile latency challenge have you solved?", "Over the last 3 years at FinStack Payments I architected a Kotlin & Compose UPI checkout SDK serving 1.8M monthly transactions at 99.96% crash-free rate and cut cold start latency by 41% via Baseline Profiles.", "AMBER", "AI draft · Review required", false),
                    ScreeningAnswer("sq2", "Current & Expected CTC (INR)", "Current: ${vault.currentCtc} | Expected: ${vault.expectedCtc}", "GREEN", "Q&A Vault · Verified fact", true),
                    ScreeningAnswer("sq3", "Notice Period (days)", "${vault.noticePeriodDays} days", "GREEN", "Q&A Vault · Verified fact", true)
                )
            )
            /* Other regions commented out — focusing on India first
            ApplicationRecord(
                id = "app_stripe_seed",
                ownerId = uid,
                jobId = "job_stripe",
                company = "Stripe",
                role = "Mobile & Product Engineer — Global Billing",
                location = "Remote (US / EU / Global)",
                salary = "$168k – $208k USD",
                workMode = "Remote",
                portalType = "Ashby",
                portalComplexity = "1-Click",
                jobUrl = "https://jobs.ashbyhq.com/stripe/global-billing-eng",
                matchScore = 89,
                status = ApplicationStatus.PENDING_APPROVAL,
                hiringTeam = HiringTeamMember("Elena Rostova", "Staff Recruiting Partner", "https://www.linkedin.com/in/elena-rostova-recruiting", "1 day ago", 29),
                linkedinNote = "Hi Elena — applied for Stripe Global Billing. I previously built multi-currency invoicing & idempotent webhook pipelines (250k daily events) at CloudLedger Labs and checkout SDKs at FinStack. Happy to connect!",
                resumeDiffs = listOf(
                    ResumeDiffItem("d4", "CloudLedger Labs · Software Engineer", "Built multi-currency invoicing and GST reconciliation flows serving 14,000+ SMB merchants.", "Engineered multi-currency invoicing and tax reconciliation surfaces for 14,000+ SMB merchants (elevated for Global Billing).", "Highlighted verified multi-currency billing work."),
                    ResumeDiffItem("d5", "CloudLedger Labs · Software Engineer", "Designed idempotent webhook pipelines and rate-limited REST APIs processing 250k daily ledger events.", "Designed idempotent webhook ingestion pipelines and rate-limited REST APIs reliably handling 250k daily financial events.", "Matched Stripe idempotent API reliability focus."),
                    ResumeDiffItem("d6", "FinStack Payments · Senior Engineer", "Led a 4-engineer Material 3 design system guild standardizing 38 accessible UI components across merchant apps.", "Led a 4-engineer design system guild standardizing 38 accessible UI components across merchant & checkout surfaces.", "Aligned verified design systems craftsmanship.")
                ),
                screeningQuestions = listOf(
                    ScreeningAnswer("sq4", "Describe a financial or billing workflow you built end-to-end and how you ensured reliability.", "At CloudLedger Labs, I built multi-currency invoicing for 14,000+ SMBs paired with idempotent webhook ingestion pipelines processing 250k daily ledger events.", "AMBER", "AI draft · Review required", false),
                    ScreeningAnswer("sq5", "Work Authorization / Visa Status", vault.workAuthorization, "GREEN", "Q&A Vault · Verified fact", true),
                    ScreeningAnswer("sq6", "Relocation / Remote Preference", vault.relocationPreference, "GREEN", "Q&A Vault · Verified fact", true)
                )
            )
            */
        )
    }
}
