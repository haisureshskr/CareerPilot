package com.careerpilot.ai.data.compliance

import com.careerpilot.ai.data.ai.TailoredJobAnalysis
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.GuardrailState
import com.careerpilot.ai.data.model.HiringTeamMember
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PricingTier
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.data.model.ResumeDiffItem

class RateLimitViolationException(message: String) : IllegalStateException(message)

class InvalidApprovalTransitionException(message: String) : IllegalStateException(message)

data class TruthfulnessValidationResult(
    val sanitizedAnalysis: TailoredJobAnalysis,
    val strippedEmployers: List<String>,
    val strippedTitles: List<String>,
    val strippedDegrees: List<String>,
    val strippedSkills: List<String>,
    val rejectedDiffCount: Int
) {
    val isCompletelyTruthful: Boolean
        get() = strippedEmployers.isEmpty() &&
            strippedTitles.isEmpty() &&
            strippedDegrees.isEmpty() &&
            strippedSkills.isEmpty() &&
            rejectedDiffCount == 0
}

/**
 * Enforces the CareerPilot AI Truthfulness Lock on both Gemini prompts and structured responses.
 * Rejects or strips any employer, job title, degree, or skill not grounded in the user's MasterProfile.
 */
object TruthfulnessLockValidator {

    const val REQUIRED_PROMPT_CLAUSE: String =
        "NEVER invent, fabricate, or hallucinate any employer, job title, employment date, degree, institution, metric, or technical skill"

    private val KNOWN_UNVERIFIED_SKILL_TOKENS = listOf(
        "rust", "golang", "go", "kubernetes", "k8s", "terraform", "swift", "objective-c",
        "ruby", "rails", "scala", "elixir", "c++", "c#", ".net", "solidity", "web3",
        "pytorch", "tensorflow", "hadoop", "spark", "kafka", "snowflake", "salesforce",
        "sap", "abap", "php", "laravel", "django", "flask", "spring boot", "java",
        "angular", "vue", "svelte", "flutter", "dart", "react native", "aws", "gcp", "azure"
    )

    private val DEGREE_PATTERNS = listOf(
        Regex("\\bPh\\.?D\\.?\\b", RegexOption.IGNORE_CASE),
        Regex("\\bM\\.?B\\.?A\\.?\\b", RegexOption.IGNORE_CASE),
        Regex("\\bM\\.?S\\.?\\b", RegexOption.IGNORE_CASE),
        Regex("\\bM\\.?Tech\\b", RegexOption.IGNORE_CASE),
        Regex("\\bB\\.?S\\.?\\b", RegexOption.IGNORE_CASE),
        Regex("\\bB\\.?Tech\\b", RegexOption.IGNORE_CASE),
        Regex("\\bB\\.?E\\.?\\b", RegexOption.IGNORE_CASE),
        Regex("\\bMaster(?:'s)?\\s+in\\s+[A-Za-z &]+", RegexOption.IGNORE_CASE),
        Regex("\\bDoctorate\\b", RegexOption.IGNORE_CASE)
    )

    fun assertPromptContainsTruthfulnessLock(promptText: String): Boolean {
        val lower = promptText.lowercase()
        return lower.contains("truthfulness lock") &&
            lower.contains("never invent") &&
            lower.contains("employer") &&
            lower.contains("degree") &&
            lower.contains("skill")
    }

    fun validateAndSanitize(
        profile: MasterProfile,
        analysis: TailoredJobAnalysis
    ): TruthfulnessValidationResult {
        val allowedEmployers = profile.experience.map { it.company.trim() }.filter { it.isNotBlank() }
        val allowedProjectNames = profile.projects.map { it.name.trim() }.filter { it.isNotBlank() }
        val allowedRefs = (allowedEmployers + allowedProjectNames).map { it.lowercase() }.toSet()
        val allowedTitles = profile.experience.map { it.title.trim().lowercase() }.filter { it.isNotBlank() }.toSet()
        val allowedBullets = (
            profile.experience.flatMap { it.bullets } +
                profile.projects.map { it.description }
            ).map { it.trim().lowercase() }.toSet()

        val profileCorpus = buildString {
            append(profile.headline).append(' ')
            append(profile.summary).append(' ')
            append(profile.skills.joinToString(" ")).append(' ')
            profile.experience.forEach { exp ->
                append(exp.company).append(' ').append(exp.title).append(' ')
                append(exp.bullets.joinToString(" ")).append(' ')
            }
            profile.education.forEach { edu ->
                append(edu.institution).append(' ').append(edu.degree).append(' ').append(edu.details).append(' ')
            }
            profile.projects.forEach { proj ->
                append(proj.name).append(' ').append(proj.techStack.joinToString(" ")).append(' ').append(proj.description).append(' ')
            }
        }.lowercase()

        val strippedEmployers = mutableListOf<String>()
        val strippedTitles = mutableListOf<String>()
        val strippedDegrees = mutableListOf<String>()
        val strippedSkills = mutableListOf<String>()

        // 1. Strip any matchedKeywords not supported by MasterProfile
        val verifiedMatchedKeywords = analysis.matchedKeywords.filter { kw ->
            val clean = kw.trim().lowercase()
            val supported = clean.isNotBlank() && profileCorpus.contains(clean)
            if (!supported && kw.isNotBlank()) strippedSkills.add(kw.trim())
            supported
        }

        // 2. Validate & sanitize every ResumeDiffItem
        var rejectedDiffCount = 0
        val sanitizedDiffs = mutableListOf<ResumeDiffItem>()
        for (diff in analysis.resumeDiffs) {
            val refParts = diff.experienceRef.split("·", "|", "—", "-").map { it.trim() }.filter { it.isNotBlank() }
            val claimedOrg = refParts.firstOrNull().orEmpty()
            val claimedTitle = refParts.getOrNull(1).orEmpty()

            val orgVerified = claimedOrg.isNotBlank() && allowedRefs.any {
                it.contains(claimedOrg.lowercase()) || claimedOrg.lowercase().contains(it)
            }
            if (!orgVerified) {
                if (claimedOrg.isNotBlank()) strippedEmployers.add(claimedOrg)
                rejectedDiffCount++
                continue
            }

            if (claimedTitle.isNotBlank() &&
                !claimedTitle.equals("Project", ignoreCase = true) &&
                allowedTitles.none { it.contains(claimedTitle.lowercase()) || claimedTitle.lowercase().contains(it) }
            ) {
                strippedTitles.add(claimedTitle)
                rejectedDiffCount++
                continue
            }

            // Original "before" bullet must exist in the MasterProfile
            val beforeNormalized = diff.before.trim().lowercase()
            val beforeVerified = beforeNormalized.isNotBlank() && allowedBullets.any {
                it == beforeNormalized || it.contains(beforeNormalized) || beforeNormalized.contains(it)
            }
            if (!beforeVerified) {
                rejectedDiffCount++
                continue
            }

            // Strip any fabricated degrees or unverified technical skills from the "after" bullet
            var cleanedAfter = diff.after
            for (pattern in DEGREE_PATTERNS) {
                pattern.findAll(cleanedAfter).forEach { match ->
                    val token = match.value.trim()
                    if (!profileCorpus.contains(token.lowercase())) {
                        strippedDegrees.add(token)
                        cleanedAfter = cleanedAfter.replace(token, "").replace(Regex("\\s{2,}"), " ").trim()
                    }
                }
            }

            for (skill in KNOWN_UNVERIFIED_SKILL_TOKENS) {
                val skillRegex = Regex("(?<![A-Za-z0-9+#.])${Regex.escape(skill)}(?![A-Za-z0-9+#.])", RegexOption.IGNORE_CASE)
                if (skillRegex.containsMatchIn(cleanedAfter) && !skillRegex.containsMatchIn(profileCorpus)) {
                    strippedSkills.add(skill)
                    cleanedAfter = cleanedAfter.replace(skillRegex, "").replace(Regex("\\s{2,}"), " ").trim()
                }
            }

            // Reject if fabricated text removed everything meaningful
            if (cleanedAfter.length < 12) {
                rejectedDiffCount++
                continue
            }

            sanitizedDiffs.add(diff.copy(after = cleanedAfter))
        }

        // 3. Also scrub any fabricated degrees/skills from AI-drafted AMBER answers
        val sanitizedAmbers = analysis.amberQuestions.map { sq ->
            var cleanedAnswer = sq.answer
            for (pattern in DEGREE_PATTERNS) {
                pattern.findAll(cleanedAnswer).forEach { match ->
                    val token = match.value.trim()
                    if (!profileCorpus.contains(token.lowercase())) {
                        strippedDegrees.add(token)
                        cleanedAnswer = cleanedAnswer.replace(token, "").replace(Regex("\\s{2,}"), " ").trim()
                    }
                }
            }
            for (skill in KNOWN_UNVERIFIED_SKILL_TOKENS) {
                val skillRegex = Regex("(?<![A-Za-z0-9+#.])${Regex.escape(skill)}(?![A-Za-z0-9+#.])", RegexOption.IGNORE_CASE)
                if (skillRegex.containsMatchIn(cleanedAnswer) && !skillRegex.containsMatchIn(profileCorpus)) {
                    strippedSkills.add(skill)
                    cleanedAnswer = cleanedAnswer.replace(skillRegex, "").replace(Regex("\\s{2,}"), " ").trim()
                }
            }
            sq.copy(answer = cleanedAnswer)
        }

        return TruthfulnessValidationResult(
            sanitizedAnalysis = analysis.copy(
                matchedKeywords = verifiedMatchedKeywords,
                resumeDiffs = sanitizedDiffs,
                amberQuestions = sanitizedAmbers
            ),
            strippedEmployers = strippedEmployers.distinct(),
            strippedTitles = strippedTitles.distinct(),
            strippedDegrees = strippedDegrees.distinct(),
            strippedSkills = strippedSkills.distinct(),
            rejectedDiffCount = rejectedDiffCount
        )
    }
}

/**
 * Rolling 24-hour daily cap (25/day Tier 1–2, 20/day Tier 3–4) + 60-second inter-submission cooldown.
 */
object RateLimitGuard {
    const val HARD_MAX_DAILY_CAP = 25
    const val COOLDOWN_MS = 60_000L
    const val ROLLING_WINDOW_MS = 24L * 60L * 60L * 1000L

    fun evaluate(
        tier: PricingTier,
        submissionEpochMs: List<Long>,
        nowMs: Long = System.currentTimeMillis()
    ): GuardrailState {
        val cutoff = nowMs - ROLLING_WINDOW_MS
        val recent = submissionEpochMs.filter { it >= cutoff }
        val effectiveCap = minOf(tier.dailyCap, HARD_MAX_DAILY_CAP)
        val latest = recent.maxOrNull()
        val cooldownSec = if (latest != null && nowMs - latest < COOLDOWN_MS) {
            ((COOLDOWN_MS - (nowMs - latest) + 999) / 1000).toInt()
        } else {
            0
        }
        return GuardrailState(
            dailyCap = effectiveCap,
            usedLast24h = recent.size,
            cooldownSecondsRemaining = cooldownSec
        )
    }

    fun assertCanSubmit(
        tier: PricingTier,
        submissionEpochMs: List<Long>,
        nowMs: Long = System.currentTimeMillis()
    ): GuardrailState {
        val state = evaluate(tier, submissionEpochMs, nowMs)
        if (state.remainingToday <= 0) {
            throw RateLimitViolationException(
                "Daily anti-spam cap reached (${state.usedLast24h}/${state.dailyCap} applications in rolling 24-hour window for ${tier.title})."
            )
        }
        if (state.cooldownSecondsRemaining > 0) {
            throw RateLimitViolationException(
                "60-second inter-submission cooldown active (${state.cooldownSecondsRemaining}s remaining). Please wait before submitting the next application."
            )
        }
        return state
    }
}

data class OptOutStorageDocument(
    val documentId: String,
    val fields: Map<String, Any>
)

/**
 * Enforces 30-day Hiring Team poster TTL (`poster_expires_at`) and one-way SHA-256 Recruiter Opt-Out scrubbing.
 */
object RecruiterPrivacyFilter {
    const val THIRTY_DAYS_MS = 30L * 24L * 60L * 60L * 1000L

    fun createOptOutDocument(rawLinkedinUrl: String): OptOutStorageDocument {
        val hash = PrivacyHashUtil.sha256LinkedInUrl(rawLinkedinUrl)
        return OptOutStorageDocument(
            documentId = hash,
            fields = mapOf(
                "urlSha256" to hash,
                "active" to true
            )
        )
    }

    fun isPosterExpired(member: HiringTeamMember, nowMs: Long = System.currentTimeMillis()): Boolean {
        val expiresAt = member.posterExpiresAtEpochMs
        if (expiresAt != null && expiresAt <= nowMs) return true
        return member.autoPurgeDaysRemaining <= 0
    }

    fun isPosterOptedOut(member: HiringTeamMember, blockedHashes: Set<String>): Boolean {
        if (member.linkedinUrl.isBlank()) return false
        val hash = PrivacyHashUtil.sha256LinkedInUrl(member.linkedinUrl)
        return hash in blockedHashes
    }

    fun isPosterVisible(
        member: HiringTeamMember,
        blockedHashes: Set<String>,
        nowMs: Long = System.currentTimeMillis()
    ): Boolean {
        if (member.name.isBlank() && member.linkedinUrl.isBlank()) return false
        if (isPosterExpired(member, nowMs)) return false
        if (isPosterOptedOut(member, blockedHashes)) return false
        return true
    }

    fun scrubIfHidden(
        app: ApplicationRecord,
        blockedHashes: Set<String>,
        nowMs: Long = System.currentTimeMillis()
    ): ApplicationRecord {
        if (isPosterVisible(app.hiringTeam, blockedHashes, nowMs)) return app
        return app.copy(
            hiringTeam = app.hiringTeam.copy(
                name = "",
                title = "",
                linkedinUrl = ""
            ),
            linkedinNote = ""
        )
    }
}

data class PppCheckoutDecision(
    val requestedTier: PricingTier,
    val effectiveTier: PricingTier,
    val discountBlocked: Boolean,
    val effectiveWeeklyPrice: String,
    val effectiveMonthlyPrice: String,
    val reason: String
)

/**
 * Evaluates PPP Geo-Lock & Anti-VPN IP vs. Card BIN country integrity checks.
 */
object PppGeoLockEvaluator {
    fun evaluateCheckout(
        selectedTier: PricingTier,
        ipCountryCode: String = selectedTier.expectedCountryCode,
        cardBinCountryCode: String = selectedTier.expectedCountryCode,
        ipVsCardBinMismatchToggle: Boolean = false
    ): PppCheckoutDecision {
        val effectiveCardBin = if (ipVsCardBinMismatchToggle && selectedTier != PricingTier.TIER_1) {
            "US"
        } else {
            cardBinCountryCode.uppercase()
        }
        val normalizedIp = ipCountryCode.uppercase()
        val isDiscountedTier = selectedTier != PricingTier.TIER_1
        val mismatch = isDiscountedTier && (ipVsCardBinMismatchToggle || normalizedIp != effectiveCardBin)

        return if (mismatch) {
            PppCheckoutDecision(
                requestedTier = selectedTier,
                effectiveTier = PricingTier.TIER_1,
                discountBlocked = true,
                effectiveWeeklyPrice = PricingTier.TIER_1.weeklyPrice,
                effectiveMonthlyPrice = PricingTier.TIER_1.monthlyPrice,
                reason = "BLOCKED: Card BIN country ($effectiveCardBin) != IP geolocation country ($normalizedIp). ${selectedTier.title} discount denied — checkout reverts to ${PricingTier.TIER_1.title} (${PricingTier.TIER_1.monthlyPrice})."
            )
        } else {
            PppCheckoutDecision(
                requestedTier = selectedTier,
                effectiveTier = selectedTier,
                discountBlocked = false,
                effectiveWeeklyPrice = selectedTier.weeklyPrice,
                effectiveMonthlyPrice = selectedTier.monthlyPrice,
                reason = "VERIFIED: Card BIN ($effectiveCardBin) matches IP geolocation ($normalizedIp). ${selectedTier.title} (${selectedTier.monthlyPrice}) approved."
            )
        }
    }
}

/**
 * Deterministic Approval Queue State Machine:
 * PENDING_APPROVAL -> APPROVED (logs user_approved_at) -> ACTION_REQUIRED (on simulated CAPTCHA) -> SUBMITTED
 */
object ApprovalStateMachine {
    fun approve(
        record: ApplicationRecord,
        nowMs: Long = System.currentTimeMillis()
    ): ApplicationRecord {
        if (record.status != ApplicationStatus.PENDING_APPROVAL) {
            throw InvalidApprovalTransitionException(
                "Only PENDING_APPROVAL applications can be approved (current: ${record.status})."
            )
        }
        return record.copy(
            status = ApplicationStatus.APPROVED,
            userApprovedAtEpochMs = nowMs,
            updatedAtEpochMs = nowMs
        )
    }

    fun executePortalStep(
        record: ApplicationRecord,
        simulatedCaptcha: Boolean,
        nowMs: Long = System.currentTimeMillis(),
        actionReason: String = "Paused at portal CAPTCHA / OTP verification gate."
    ): ApplicationRecord {
        if (record.status != ApplicationStatus.APPROVED || record.userApprovedAtEpochMs == null) {
            throw InvalidApprovalTransitionException(
                "Application must be in APPROVED state with user_approved_at logged before portal execution (current: ${record.status})."
            )
        }
        return if (simulatedCaptcha) {
            record.copy(
                status = ApplicationStatus.ACTION_REQUIRED,
                actionReason = actionReason,
                updatedAtEpochMs = nowMs
            )
        } else {
            record.copy(
                status = ApplicationStatus.SUBMITTED,
                actionReason = "",
                updatedAtEpochMs = nowMs
            )
        }
    }

    fun completeManualHandoff(
        record: ApplicationRecord,
        nowMs: Long = System.currentTimeMillis()
    ): ApplicationRecord {
        if (record.status != ApplicationStatus.ACTION_REQUIRED) {
            throw InvalidApprovalTransitionException(
                "Only ACTION_REQUIRED applications can complete manual CAPTCHA/OTP handoff (current: ${record.status})."
            )
        }
        if (record.userApprovedAtEpochMs == null) {
            throw InvalidApprovalTransitionException("Missing user_approved_at audit timestamp.")
        }
        return record.copy(
            status = ApplicationStatus.SUBMITTED,
            actionReason = "",
            updatedAtEpochMs = nowMs
        )
    }
}
