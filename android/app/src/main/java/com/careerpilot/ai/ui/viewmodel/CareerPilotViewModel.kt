package com.careerpilot.ai.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.careerpilot.ai.data.ai.FirebaseAiService
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.GuardrailState
import com.careerpilot.ai.data.model.HiringTeamMember
import com.careerpilot.ai.data.model.JobListing
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PricingTier
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.data.model.QAVault
import com.careerpilot.ai.data.model.ScreeningAnswer
import com.careerpilot.ai.data.repository.CareerPilotRepository
import com.careerpilot.ai.data.repository.UserWorkspaceSnapshot
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class ParallelPortalSession(
    val application: ApplicationRecord,
    val approvedAnswers: List<ScreeningAnswer>
)

data class CareerPilotUiState(
    val user: FirebaseUser? = null,
    val authLoading: Boolean = true,
    val workspace: UserWorkspaceSnapshot = UserWorkspaceSnapshot(),
    val jobs: List<JobListing> = emptyList(),
    val searchedJobs: List<JobListing>? = null,
    val applications: List<ApplicationRecord> = emptyList(),
    val blockedRecruiterHashes: Set<String> = emptySet(),
    val guardrails: GuardrailState = GuardrailState(),
    val busyMessage: String? = null,
    val bannerMessage: String? = null,
    val errorMessage: String? = null,
    val activeWebViewApp: ApplicationRecord? = null,
    val activeWebViewAnswers: List<ScreeningAnswer> = emptyList(),
    val activeParallelPortals: List<ParallelPortalSession> = emptyList(),
    val showDiagnostics: Boolean = false
)

class CareerPilotViewModel(
    private val repo: CareerPilotRepository = CareerPilotRepository(),
    val aiService: FirebaseAiService = FirebaseAiService()
) : ViewModel() {

    private val _uiState = MutableStateFlow(CareerPilotUiState())
    val uiState: StateFlow<CareerPilotUiState> = _uiState.asStateFlow()

    private var dataJobs: List<Job> = emptyList()

    init {
        viewModelScope.launch {
            repo.authStateFlow().collect { user ->
                dataJobs.forEach { it.cancel() }
                dataJobs = emptyList()
                _uiState.update { it.copy(user = user, authLoading = false) }
                if (user != null) {
                    initializeUserStreams(user)
                }
            }
        }

        // Live 1-second ticker for the 60-second anti-spam cooldown countdown
        viewModelScope.launch {
            while (true) {
                delay(1000L)
                _uiState.update { state ->
                    val refreshed = repo.computeGuardrails(
                        state.workspace.selectedTier,
                        state.workspace.submissionEpochMs
                    )
                    state.copy(guardrails = refreshed)
                }
            }
        }
    }

    private fun initializeUserStreams(user: FirebaseUser) {
        viewModelScope.launch {
            runCatching { repo.ensureSeededWorkspace(user) }
                .onFailure { err -> _uiState.update { it.copy(errorMessage = err.message) } }

            val uid = user.uid
            dataJobs = listOf(
                launch {
                    repo.observeWorkspace(uid)
                        .catch { err -> _uiState.update { it.copy(errorMessage = err.message) } }
                        .collect { ws ->
                            val guardrails = repo.computeGuardrails(ws.selectedTier, ws.submissionEpochMs)
                            _uiState.update { it.copy(workspace = ws, guardrails = guardrails) }
                        }
                },
                launch {
                    repo.observeJobs(uid)
                        .catch { err -> _uiState.update { it.copy(errorMessage = err.message) } }
                        .collect { jobs -> _uiState.update { it.copy(jobs = jobs) } }
                },
                launch {
                    repo.observeApplications(uid)
                        .catch { err -> _uiState.update { it.copy(errorMessage = err.message) } }
                        .collect { apps ->
                            _uiState.update { it.copy(applications = apps) }
                            refreshRecruiterOptOutChecks(apps)
                        }
                }
            )
        }
    }

    private fun refreshRecruiterOptOutChecks(apps: List<ApplicationRecord>) {
        viewModelScope.launch {
            val blocked = mutableSetOf<String>()
            apps.map { it.hiringTeam.linkedinUrl }.distinct().forEach { url ->
                if (url.isNotBlank() && runCatching { repo.isRecruiterBlocked(url) }.getOrDefault(false)) {
                    blocked.add(PrivacyHashUtil.sha256LinkedInUrl(url))
                }
            }
            _uiState.update { it.copy(blockedRecruiterHashes = blocked) }
        }
    }

    fun signInWithGoogle(credential: AuthCredential) = launchGuarded("Signing in with Google...") {
        repo.signInWithGoogleCredential(credential)
    }

    fun signInWithEmail(email: String, password: String) = launchGuarded("Signing in...") {
        repo.signInWithEmail(email, password)
    }

    fun registerWithEmail(email: String, password: String) = launchGuarded("Creating account...") {
        repo.registerWithEmail(email, password)
        _uiState.update { it.copy(bannerMessage = "Verification email sent. Please verify your email before writing to Firestore.") }
    }

    fun signOut() = repo.signOut()

    fun parseResumeWithGemini(resumeText: String?, pdfBytes: ByteArray?) =
        launchGuarded("Parsing resume via Firebase AI Logic (Gemini)...") {
            val uid = requireNotNull(_uiState.value.user?.uid) { "Sign in first." }
            val currentWs = _uiState.value.workspace
            val parsed = aiService.parseResume(resumeText = resumeText, pdfBytes = pdfBytes)
            val prevName = currentWs.profile.fullName.trim()
            val nextName = parsed.fullName.trim()
            val candidateChanged = prevName.isNotBlank() && nextName.isNotBlank() && !prevName.equals(nextName, ignoreCase = true)
            val syncedVault = when {
                parsed.linkedinUrl.isNotBlank() -> currentWs.qaVault.copy(linkedinUrl = parsed.linkedinUrl)
                candidateChanged -> currentWs.qaVault.copy(linkedinUrl = "")
                else -> currentWs.qaVault
            }
            repo.saveProfileAndVault(
                uid = uid,
                profile = parsed,
                vault = syncedVault,
                warrantyAccepted = currentWs.warrantyAccepted
            )
            // Automatically discover resume-matched jobs in the backend after parsing a new resume
            runCatching {
                val discovered = aiService.discoverJobsForResume(
                    ownerId = uid,
                    profile = parsed,
                    vault = syncedVault
                )
                repo.saveDiscoveredJobs(uid, discovered)
            }
            val linkedInMsg = if (parsed.linkedinUrl.isNotBlank()) {
                " LinkedIn fetched: ${parsed.linkedinUrl}."
            } else {
                ""
            }
            _uiState.update {
                it.copy(
                    searchedJobs = null,
                    bannerMessage = "Resume parsed cleanly and backend job discovery refreshed.$linkedInMsg"
                )
            }
        }

    fun searchJobsInBackend(
        query: String,
        country: String,
        market: String,
        workMode: String,
        portalType: String,
        minMatchScore: Int
    ) = viewModelScope.launch {
        val uid = _uiState.value.user?.uid ?: return@launch
        runCatching {
            repo.searchJobsInBackend(
                uid = uid,
                query = query,
                country = country,
                market = market,
                workMode = workMode,
                portalType = portalType,
                minMatchScore = minMatchScore
            )
        }.onSuccess { results ->
            _uiState.update { it.copy(searchedJobs = results) }
        }.onFailure { err ->
            _uiState.update { it.copy(errorMessage = err.message ?: "Backend job search failed.") }
        }
    }

    fun discoverJobsFromResume(
        query: String = "",
        country: String = "All",
        market: String = "All",
        workMode: String = "All",
        portalType: String = "All",
        minMatchScore: Int = 0
    ) = launchGuarded(
        if (country != "All") "Searching backend jobs in $country matching your resume..."
        else "Searching backend jobs matching your resume..."
    ) {
        val uid = requireNotNull(_uiState.value.user?.uid) { "Sign in first." }
        val ws = _uiState.value.workspace
        require(ws.profile.fullName.isNotBlank() || ws.profile.skills.isNotEmpty()) {
            "Upload or parse your resume in Profile before running job discovery."
        }
        val discovered = aiService.discoverJobsForResume(
            ownerId = uid,
            profile = ws.profile,
            vault = ws.qaVault,
            query = query,
            country = country,
            market = market,
            workMode = workMode,
            portalType = portalType
        )
        repo.saveDiscoveredJobs(uid, discovered)
        val results = repo.searchJobsInBackend(
            uid = uid,
            query = query,
            country = country,
            market = market,
            workMode = workMode,
            portalType = portalType,
            minMatchScore = minMatchScore
        )
        val countryLabel = if (country != "All") " in $country" else ""
        _uiState.update {
            it.copy(
                searchedJobs = results,
                bannerMessage = "Discovered ${discovered.size} roles$countryLabel tailored to ${ws.profile.fullName}'s resume."
            )
        }
    }

    fun saveProfileAndVault(profile: MasterProfile, vault: QAVault, warrantyAccepted: Boolean) =
        launchGuarded("Saving Master Profile & Q&A Vault...") {
            val uid = requireNotNull(_uiState.value.user?.uid)
            repo.saveProfileAndVault(uid, profile, vault, warrantyAccepted)
            _uiState.update { it.copy(bannerMessage = "Profile, Q&A Vault, and warranty consent saved.") }
        }

    fun quickTailorRawJd(
        rawJd: String,
        recruiterName: String,
        companyHint: String,
        portalType: String
    ) = launchGuarded("Scoring & tailoring JD with Gemini...") {
        val uid = requireNotNull(_uiState.value.user?.uid)
        val ws = _uiState.value.workspace
        val jobId = "job_custom_${UUID.randomUUID().toString().take(8)}"
        val isIndia = Regex("india|bengaluru|bangalore|mumbai|hyderabad|₹|lpa", RegexOption.IGNORE_CASE).containsMatchIn(rawJd)
        val seedJob = JobListing(
            id = jobId,
            ownerId = uid,
            company = companyHint.ifBlank { "Target Employer" },
            role = "Analyzed Role",
            location = if (isIndia) "Bengaluru, India" else "Remote (Global)",
            market = if (isIndia) "India" else "Global",
            salary = "Not disclosed",
            workMode = if (isIndia) "Hybrid" else "Remote",
            portalType = portalType,
            portalComplexity = if (portalType in listOf("Workday", "Naukri")) "Multi-Step" else "1-Click",
            description = rawJd.take(6000),
            jobUrl = "https://careers.example.com/$jobId",
            hiringTeam = HiringTeamMember(
                name = recruiterName.ifBlank { "Hiring Team Contact" },
                title = "Talent Partner",
                linkedinUrl = "https://www.linkedin.com/jobs/",
                postedAgo = "Analyzed just now",
                autoPurgeDaysRemaining = 30
            )
        )

        val analysis = aiService.analyzeAndTailorJob(ws.profile, ws.qaVault, seedJob)
        val enrichedJob = seedJob.copy(
            company = if (seedJob.company == "Target Employer" && analysis.inferredCompany.isNotBlank()) analysis.inferredCompany else seedJob.company,
            role = if (analysis.inferredRole.isNotBlank()) analysis.inferredRole else seedJob.role,
            location = if (analysis.inferredLocation.isNotBlank()) analysis.inferredLocation else seedJob.location,
            salary = if (analysis.inferredSalary.isNotBlank()) analysis.inferredSalary else seedJob.salary,
            matchScore = analysis.matchScore,
            portalComplexity = analysis.portalComplexity,
            matchedKeywords = analysis.matchedKeywords,
            missingKeywords = analysis.missingKeywords
        )

        val greenAnswers = listOf(
            ScreeningAnswer("sq-g1", "Current & Expected CTC", "Current: ${ws.qaVault.currentCtc} | Expected: ${ws.qaVault.expectedCtc}", "GREEN", "Q&A Vault · Verified fact", true),
            ScreeningAnswer("sq-g2", "Notice Period (days)", "${ws.qaVault.noticePeriodDays} days", "GREEN", "Q&A Vault · Verified fact", true),
            ScreeningAnswer("sq-g3", "Work Authorization & Relocation", "${ws.qaVault.workAuthorization} · ${ws.qaVault.relocationPreference}", "GREEN", "Q&A Vault · Verified fact", true)
        )

        val draft = ApplicationRecord(
            id = "app_${jobId}",
            ownerId = uid,
            jobId = enrichedJob.id,
            company = enrichedJob.company,
            role = enrichedJob.role,
            location = enrichedJob.location,
            salary = enrichedJob.salary,
            workMode = enrichedJob.workMode,
            portalType = enrichedJob.portalType,
            portalComplexity = enrichedJob.portalComplexity,
            jobUrl = enrichedJob.jobUrl,
            matchScore = enrichedJob.matchScore,
            status = ApplicationStatus.PENDING_APPROVAL,
            hiringTeam = enrichedJob.hiringTeam,
            linkedinNote = analysis.linkedinNote,
            resumeDiffs = analysis.resumeDiffs,
            screeningQuestions = analysis.amberQuestions + greenAnswers
        )

        repo.upsertJobAndQueueIfQualified(uid, enrichedJob, draft)
        _uiState.update {
            it.copy(bannerMessage = "Scored ${enrichedJob.company} (${enrichedJob.matchScore}% ATS match) and added to Approval Queue.")
        }
    }

    fun tailorExistingJob(job: JobListing) = launchGuarded("Tailoring ${job.company} with Gemini...") {
        val uid = requireNotNull(_uiState.value.user?.uid)
        val ws = _uiState.value.workspace
        val analysis = aiService.analyzeAndTailorJob(ws.profile, ws.qaVault, job)
        val updatedJob = job.copy(
            matchScore = analysis.matchScore,
            portalComplexity = analysis.portalComplexity,
            matchedKeywords = analysis.matchedKeywords,
            missingKeywords = analysis.missingKeywords
        )
        val greenAnswers = listOf(
            ScreeningAnswer("sq-g1", "Expected CTC / Comp", ws.qaVault.expectedCtc, "GREEN", "Q&A Vault · Verified fact", true),
            ScreeningAnswer("sq-g2", "Notice Period (days)", "${ws.qaVault.noticePeriodDays} days", "GREEN", "Q&A Vault · Verified fact", true),
            ScreeningAnswer("sq-g3", "Work Authorization", ws.qaVault.workAuthorization, "GREEN", "Q&A Vault · Verified fact", true)
        )
        val draft = ApplicationRecord(
            id = "app_${job.id}_${System.currentTimeMillis()}",
            ownerId = uid,
            jobId = job.id,
            company = job.company,
            role = job.role,
            location = job.location,
            salary = job.salary,
            workMode = job.workMode,
            portalType = job.portalType,
            portalComplexity = analysis.portalComplexity,
            jobUrl = job.jobUrl,
            matchScore = analysis.matchScore,
            status = ApplicationStatus.PENDING_APPROVAL,
            hiringTeam = job.hiringTeam,
            linkedinNote = analysis.linkedinNote,
            resumeDiffs = analysis.resumeDiffs,
            screeningQuestions = analysis.amberQuestions + greenAnswers
        )
        repo.upsertJobAndQueueIfQualified(uid, updatedJob, draft)
        _uiState.update { it.copy(bannerMessage = "Added ${job.company} (${analysis.matchScore}% match) to Approval Queue.") }
    }

    fun saveEditToVault(appId: String, answers: List<ScreeningAnswer>) =
        launchGuarded("Syncing reviewed answers to Q&A Vault...") {
            val uid = requireNotNull(_uiState.value.user?.uid)
            repo.saveEditedAnswersToVault(uid, appId, answers, _uiState.value.workspace.qaVault)
            _uiState.update { it.copy(bannerMessage = "Saved edits to Q&A Vault for future applications.") }
        }

    fun openWebViewExecution(app: ApplicationRecord, currentAnswers: List<ScreeningAnswer>) {
        val state = _uiState.value
        if (!state.workspace.warrantyAccepted) {
            _uiState.update { it.copy(errorMessage = "Accept the User-Agent & Applicant Accuracy Warranty in Profile first.") }
            return
        }
        if (!state.guardrails.canSubmitNow) {
            val msg = if (state.guardrails.remainingToday <= 0) {
                "Daily cap reached (${state.guardrails.dailyCap}/24h)."
            } else {
                "60s cooldown active (${state.guardrails.cooldownSecondsRemaining}s left)."
            }
            _uiState.update { it.copy(errorMessage = msg) }
            return
        }
        _uiState.update { it.copy(activeWebViewApp = app, activeWebViewAnswers = currentAnswers) }
    }

    fun closeWebViewExecution() {
        _uiState.update { it.copy(activeWebViewApp = null, activeWebViewAnswers = emptyList()) }
    }

    fun completeWebViewExecution(outcome: ApplicationStatus, actionReason: String = "") =
        launchGuarded("Logging human-approved audit record...") {
            val uid = requireNotNull(_uiState.value.user?.uid)
            val app = requireNotNull(_uiState.value.activeWebViewApp)
            repo.approveAndRecordSubmission(
                uid = uid,
                workspace = _uiState.value.workspace,
                appId = app.id,
                finalAnswers = _uiState.value.activeWebViewAnswers,
                outcome = outcome,
                actionReason = actionReason
            )
            _uiState.update {
                it.copy(
                    activeWebViewApp = null,
                    activeWebViewAnswers = emptyList(),
                    bannerMessage = if (outcome == ApplicationStatus.SUBMITTED) {
                        "Submitted ${app.company} with user_approved_at timestamp. 60s cooldown active."
                    } else {
                        "Paused ${app.company} under Action Required for CAPTCHA/OTP completion."
                    }
                )
            }
        }

    fun openParallelPortalExecution(sessions: List<ParallelPortalSession>) {
        val state = _uiState.value
        if (!state.workspace.warrantyAccepted) {
            _uiState.update { it.copy(errorMessage = "Accept the User-Agent & Applicant Accuracy Warranty in Profile first.") }
            return
        }
        val capped = sessions.take(4)
        if (capped.isEmpty()) return
        _uiState.update { it.copy(activeParallelPortals = capped) }
    }

    fun closeParallelPortalExecution() {
        _uiState.update { it.copy(activeParallelPortals = emptyList()) }
    }

    fun completeParallelPortalSubmission(
        appId: String,
        answers: List<ScreeningAnswer>,
        outcome: ApplicationStatus,
        actionReason: String = ""
    ) = launchGuarded("Recording parallel portal confirmation...") {
        val uid = requireNotNull(_uiState.value.user?.uid)
        val target = _uiState.value.activeParallelPortals.find { it.application.id == appId }?.application
        repo.approveAndRecordSubmission(
            uid = uid,
            workspace = _uiState.value.workspace,
            appId = appId,
            finalAnswers = answers,
            outcome = outcome,
            actionReason = actionReason
        )
        _uiState.update {
            it.copy(
                bannerMessage = if (outcome == ApplicationStatus.SUBMITTED) {
                    "Submitted ${target?.company ?: "application"} with user_approved_at timestamp. Remaining portals stay pre-filled."
                } else {
                    "Paused ${target?.company ?: "application"} under Action Required."
                }
            )
        }
    }

    fun skipApplication(appId: String) = launchGuarded("Skipping application...") {
        val uid = requireNotNull(_uiState.value.user?.uid)
        repo.skipApplication(uid, appId)
    }

    fun resumeActionRequired(appId: String) = launchGuarded("Finalizing manual handoff...") {
        val uid = requireNotNull(_uiState.value.user?.uid)
        repo.resumeActionRequired(uid, _uiState.value.workspace, appId)
        _uiState.update { it.copy(bannerMessage = "Manual CAPTCHA/OTP handoff confirmed and logged.") }
    }

    fun selectPricingTier(tier: PricingTier) = launchGuarded("Updating PPP tier...") {
        val uid = requireNotNull(_uiState.value.user?.uid)
        repo.updatePricingTier(uid, tier)
    }

    fun submitRecruiterOptOut(linkedinUrl: String) = launchGuarded("Recording SHA-256 privacy opt-out...") {
        val hash = repo.submitRecruiterOptOut(linkedinUrl)
        _uiState.update {
            it.copy(
                blockedRecruiterHashes = it.blockedRecruiterHashes + hash,
                bannerMessage = "Opt-out active. Stored as SHA-256 hash: ${hash.take(16)}…"
            )
        }
    }

    fun deleteAccountAndAllData() = launchGuarded("Wiping all Firestore documents...") {
        val uid = requireNotNull(_uiState.value.user?.uid)
        repo.deleteAccountAndAllData(uid)
        _uiState.update {
            it.copy(
                workspace = UserWorkspaceSnapshot(),
                jobs = emptyList(),
                applications = emptyList(),
                bannerMessage = "All Firestore user documents have been permanently deleted."
            )
        }
    }

    fun openDiagnostics() {
        _uiState.update { it.copy(showDiagnostics = true) }
    }

    fun closeDiagnostics() {
        _uiState.update { it.copy(showDiagnostics = false) }
    }

    suspend fun checkRecruiterOptOutLive(linkedinUrl: String): Boolean =
        repo.isRecruiterBlocked(linkedinUrl)

    suspend fun dryRunUserDataWipe(): com.careerpilot.ai.data.repository.DryRunWipeReport {
        val uid = requireNotNull(_uiState.value.user?.uid) { "User must be signed in for Firestore wipe dry-run." }
        return repo.dryRunUserDataWipe(uid)
    }

    fun clearMessages() {
        _uiState.update { it.copy(bannerMessage = null, errorMessage = null) }
    }

    private fun launchGuarded(busyLabel: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(busyMessage = busyLabel, errorMessage = null) }
            try {
                block()
            } catch (err: Exception) {
                _uiState.update { it.copy(errorMessage = err.message ?: "Operation failed.") }
            } finally {
                _uiState.update { it.copy(busyMessage = null) }
            }
        }
    }
}
