package com.careerpilot.ai.data.model

import kotlinx.serialization.Serializable
import java.net.URI
import java.security.MessageDigest

@Serializable
data class ExperienceItem(
    val id: String = "",
    val company: String = "",
    val title: String = "",
    val location: String = "",
    val startDate: String = "",
    val endDate: String = "",
    val bullets: List<String> = emptyList()
)

@Serializable
data class EducationItem(
    val id: String = "",
    val institution: String = "",
    val degree: String = "",
    val graduationYear: String = "",
    val details: String = ""
)

@Serializable
data class ProjectItem(
    val id: String = "",
    val name: String = "",
    val techStack: List<String> = emptyList(),
    val description: String = ""
)

@Serializable
data class SavedCustomQA(
    val id: String = "",
    val question: String = "",
    val answer: String = "",
    val savedAt: String = ""
)

@Serializable
data class QAVault(
    val currentCtc: String = "",
    val expectedCtc: String = "",
    val noticePeriodDays: String = "30",
    val workAuthorization: String = "",
    val relocationPreference: String = "",
    val linkedinUrl: String = "",
    val customQAs: List<SavedCustomQA> = emptyList(),
    val notInterestedJobIds: List<String> = emptyList()
)

@Serializable
data class MasterProfile(
    val fullName: String = "",
    val headline: String = "",
    val email: String = "",
    val phone: String = "",
    val location: String = "",
    val linkedinUrl: String = "",
    val summary: String = "",
    val skills: List<String> = emptyList(),
    val experience: List<ExperienceItem> = emptyList(),
    val education: List<EducationItem> = emptyList(),
    val projects: List<ProjectItem> = emptyList()
)

@Serializable
data class HiringTeamMember(
    val name: String = "",
    val title: String = "",
    val linkedinUrl: String = "",
    val postedAgo: String = "2 days ago",
    val autoPurgeDaysRemaining: Int = 30,
    val posterExpiresAtEpochMs: Long? = null
)

@Serializable
data class JobListing(
    val id: String = "",
    val ownerId: String = "",
    val company: String = "",
    val role: String = "",
    val location: String = "",
    val market: String = "India", // India | Global
    val salary: String = "",
    val workMode: String = "Hybrid", // Remote | Hybrid | On-site
    val portalType: String = "Greenhouse", // Greenhouse | Lever | Ashby | Workday | Naukri
    val portalComplexity: String = "1-Click", // 1-Click | Multi-Step
    val matchScore: Int = 0,
    val matchedKeywords: List<String> = emptyList(),
    val missingKeywords: List<String> = emptyList(),
    val description: String = "",
    val jobUrl: String = "",
    val hiringTeam: HiringTeamMember = HiringTeamMember()
)

@Serializable
data class ResumeDiffItem(
    val id: String = "",
    val experienceRef: String = "",
    val before: String = "",
    val after: String = "",
    val rationale: String = ""
)

@Serializable
data class ScreeningAnswer(
    val id: String = "",
    val question: String = "",
    val answer: String = "",
    val confidence: String = "AMBER", // AMBER | GREEN
    val sourceLabel: String = "AI draft · Review required",
    val reviewed: Boolean = false
)

enum class ApplicationStatus {
    PENDING_APPROVAL,
    APPROVED,
    SUBMITTED,
    ACTION_REQUIRED,
    SKIPPED
}

data class ApplicationRecord(
    val id: String = "",
    val ownerId: String = "",
    val jobId: String = "",
    val company: String = "",
    val role: String = "",
    val location: String = "",
    val salary: String = "",
    val workMode: String = "Remote",
    val portalType: String = "Greenhouse",
    val portalComplexity: String = "1-Click",
    val jobUrl: String = "",
    val matchScore: Int = 0,
    val status: ApplicationStatus = ApplicationStatus.PENDING_APPROVAL,
    val hiringTeam: HiringTeamMember = HiringTeamMember(),
    val linkedinNote: String = "",
    val resumeDiffs: List<ResumeDiffItem> = emptyList(),
    val screeningQuestions: List<ScreeningAnswer> = emptyList(),
    val auditReceiptId: String = "",
    val actionReason: String = "",
    val userApprovedAtEpochMs: Long? = null,
    val updatedAtEpochMs: Long = System.currentTimeMillis()
)

enum class PricingTier(
    val id: String,
    val title: String,
    val regions: String,
    val multiplier: String,
    val weeklyPrice: String,
    val monthlyPrice: String,
    val credits: Int,
    val dailyCap: Int,
    val expectedCountryCode: String
) {
    TIER_1(
        id = "tier1",
        title = "Tier 1 · Global Core",
        regions = "US / UK / EU / SG / UAE",
        multiplier = "1.0x",
        weeklyPrice = "$12.99/wk",
        monthlyPrice = "$29.99/mo",
        credits = 400,
        dailyCap = 25,
        expectedCountryCode = "US"
    ),
    TIER_2(
        id = "tier2",
        title = "Tier 2 · Developed APAC & CEE",
        regions = "JP / KR / Eastern Europe",
        multiplier = "0.65x",
        weeklyPrice = "$8.49/wk",
        monthlyPrice = "$19.49/mo",
        credits = 350,
        dailyCap = 25,
        expectedCountryCode = "JP"
    ),
    TIER_3(
        id = "tier3",
        title = "Tier 3 · Emerging Growth",
        regions = "BR / MX / MY / TH",
        multiplier = "0.45x",
        weeklyPrice = "$5.99/wk",
        monthlyPrice = "$13.49/mo",
        credits = 250,
        dailyCap = 20,
        expectedCountryCode = "BR"
    ),
    TIER_4(
        id = "tier4",
        title = "Tier 4 · India & South/SE Asia",
        regions = "India / ID / PH / VN",
        multiplier = "0.30x",
        weeklyPrice = "₹299/wk",
        monthlyPrice = "₹749/mo",
        credits = 200,
        dailyCap = 20,
        expectedCountryCode = "IN"
    );

    companion object {
        fun fromId(id: String): PricingTier = entries.firstOrNull { it.id == id } ?: TIER_4
    }
}

data class GuardrailState(
    val dailyCap: Int = 20,
    val usedLast24h: Int = 0,
    val cooldownSecondsRemaining: Int = 0
) {
    val remainingToday: Int get() = (dailyCap - usedLast24h).coerceAtLeast(0)
    val canSubmitNow: Boolean get() = remainingToday > 0 && cooldownSecondsRemaining <= 0
}

object PrivacyHashUtil {
    fun normalizeLinkedInUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim().lowercase()
        return runCatching {
            val uri = URI(if (trimmed.startsWith("http")) trimmed else "https://$trimmed")
            val host = (uri.host ?: "").removePrefix("www.")
            val path = (uri.path ?: "").trimEnd('/')
            "$host$path"
        }.getOrElse {
            trimmed.removePrefix("https://").removePrefix("http://").removePrefix("www.").trimEnd('/')
        }
    }

    fun sha256LinkedInUrl(rawUrl: String): String {
        val normalized = normalizeLinkedInUrl(rawUrl)
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest(normalized.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun isSafeExternalUrl(rawUrl: String): Boolean {
        return runCatching {
            val uri = URI(rawUrl.trim())
            uri.scheme == "https" || uri.scheme == "http"
        }.getOrDefault(false)
    }
}

object LinkedInProfileExtractor {
    private val fullUrlRegex = Regex(
        """(?:https?://)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com/(in|pub)/([A-Za-z0-9._%/-]+)""",
        RegexOption.IGNORE_CASE
    )
    private val labeledRegex = Regex(
        """linkedin(?:\s+profile)?\s*[:|–—-]\s*(?:https?://)?(?:(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com/)?(?:/?in/)?@?([A-Za-z0-9][A-Za-z0-9-]{2,80})""",
        RegexOption.IGNORE_CASE
    )
    private val uriParenRegex = Regex("""/URI\s*\(((?:\\.|[^()\\]){4,450})\)""")
    private val uriHexRegex = Regex("""/URI\s*<([0-9A-Fa-f\s]{8,900})>""")

    fun normalizeCandidateLinkedInUrl(rawInput: String?): String? {
        if (rawInput.isNullOrBlank()) return null
        val cleaned = rawInput.trim()
            .removePrefix("<")
            .removeSuffix(">")
            .trimEnd('.', ',', ';', ':', '!', '?', ')', ']', '\'', '"', '`')
            .replace(Regex("\\s+"), "")
        if (cleaned.isBlank()) return null

        val match = fullUrlRegex.find(cleaned)
        if (match != null) {
            val section = match.groupValues[1].lowercase()
            val rawSlugPath = match.groupValues[2].substringBefore('?').substringBefore('#').trimEnd('/')
            val segments = rawSlugPath.split('/').filter { it.isNotBlank() }
            val slug = segments.firstOrNull() ?: return null
            if (slug.length !in 2..120) return null
            if (slug.lowercase() in setOf("jobs", "company", "feed", "learning", "school", "messaging", "login", "signup")) {
                return null
            }
            return if (section == "pub") {
                "https://www.linkedin.com/pub/${segments.joinToString("/")}"
            } else {
                "https://www.linkedin.com/in/$slug"
            }
        }

        val shortMatch = Regex("""^/?in/([A-Za-z0-9][A-Za-z0-9._%-]{1,119})$""", RegexOption.IGNORE_CASE).find(cleaned)
        if (shortMatch != null) {
            return "https://www.linkedin.com/in/${shortMatch.groupValues[1]}"
        }
        return null
    }

    fun extractFromText(text: String?): String? {
        if (text.isNullOrBlank()) return null
        val repaired = text
            .replace(Regex("""(linkedin\.com/(?:in|pub)/)\s*\r?\n\s*([A-Za-z0-9._%-]+)""", RegexOption.IGNORE_CASE), "$1$2")
            .replace(Regex("""(linkedin\.com/)\s*\r?\n\s*(in/[A-Za-z0-9._%-]+)""", RegexOption.IGNORE_CASE), "$1$2")

        fullUrlRegex.findAll(repaired).forEach { m ->
            normalizeCandidateLinkedInUrl(m.value)?.let { return it }
        }
        labeledRegex.find(repaired)?.let { m ->
            val slug = m.groupValues[1].trimEnd('.', ',', ';', ':', '!', '?', ')')
            if (slug.lowercase() !in setOf("profile", "link", "url", "account", "page", "com", "www", "http", "https", "linkedin")) {
                return "https://www.linkedin.com/in/$slug"
            }
        }
        return null
    }

    private fun scanPdfChunk(chunk: String): String? {
        uriParenRegex.findAll(chunk).forEach { m ->
            val decoded = m.groupValues[1]
                .replace("\\(", "(")
                .replace("\\)", ")")
                .replace("\\\\", "\\")
            normalizeCandidateLinkedInUrl(decoded)?.let { return it }
        }
        uriHexRegex.findAll(chunk).forEach { m ->
            val hex = m.groupValues[1].replace(Regex("\\s+"), "")
            val padded = if (hex.length % 2 == 1) "${hex}0" else hex
            val decoded = runCatching {
                val bytes = ByteArray(padded.length / 2) { i ->
                    padded.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                }
                String(bytes, Charsets.UTF_8)
            }.getOrDefault("")
            normalizeCandidateLinkedInUrl(decoded)?.let { return it }
        }
        return extractFromText(chunk)
    }

    fun extractFromPdfBytes(pdfBytes: ByteArray?): String? {
        if (pdfBytes == null || pdfBytes.isEmpty()) return null
        val latin1 = String(pdfBytes, Charsets.ISO_8859_1)
        scanPdfChunk(latin1)?.let { return it }

        var pos = 0
        var inspected = 0
        val streamMarker = "stream"
        val endMarker = "endstream"
        while (inspected < 64) {
            val sIdx = latin1.indexOf(streamMarker, pos)
            if (sIdx < 0) break
            var start = sIdx + streamMarker.length
            if (start + 1 < pdfBytes.size && pdfBytes[start] == 0x0d.toByte() && pdfBytes[start + 1] == 0x0a.toByte()) {
                start += 2
            } else if (start < pdfBytes.size && (pdfBytes[start] == 0x0a.toByte() || pdfBytes[start] == 0x0d.toByte())) {
                start += 1
            } else {
                pos = start
                continue
            }
            val eIdx = latin1.indexOf(endMarker, start)
            if (eIdx < 0) break
            pos = eIdx + endMarker.length
            inspected++
            val len = eIdx - start
            if (len <= 4 || len > 2 * 1024 * 1024) continue

            val inflated = runCatching {
                val inflater = java.util.zip.Inflater()
                try {
                    inflater.setInput(pdfBytes, start, len)
                    val out = java.io.ByteArrayOutputStream()
                    val buf = ByteArray(4096)
                    var total = 0
                    while (!inflater.finished() && total < 2 * 1024 * 1024) {
                        val count = inflater.inflate(buf)
                        if (count == 0) break
                        out.write(buf, 0, count)
                        total += count
                    }
                    out.toString(Charsets.ISO_8859_1.name())
                } finally {
                    inflater.end()
                }
            }.getOrNull()

            if (!inflated.isNullOrBlank()) {
                scanPdfChunk(inflated)?.let { return it }
            }
        }
        return null
    }
}

object CountryFilterMatcher {
    val SUPPORTED_COUNTRIES: List<String> = listOf(
        // Other regions commented out — focusing on India first
        // "All",
        "India"
        // "United States",
        // "United Kingdom",
        // "Canada",
        // "Germany",
        // "Singapore",
        // "Australia",
        // "United Arab Emirates",
        // "Netherlands",
        // "Ireland"
    )

    private val locationPatterns: Map<String, Regex> = mapOf(
        "India" to Regex("""\bindia\b|\bbengaluru\b|\bbangalore\b|\bmumbai\b|\bhyderabad\b|\bpune\b|\bchennai\b|\bdelhi\b|\bnoida\b|\bgurugram\b|\bgurgaon\b|\bkolkata\b|\bahmedabad\b|\bkochi\b|\bcoimbatore\b|\bjaipur\b|\bchandigarh\b""", RegexOption.IGNORE_CASE)
        /* Other regions commented out — focusing on India first
        "United States" to Regex("""\bunited states\b|\bu\.s\.a\.?\b|\busa\b|\b(?:remote\s*\(?\s*us\b|us\s*only|us\s*remote|us\s*/|/\s*us\b)|\bnew york\b|\bnyc\b|\bsan francisco\b|\bseattle\b|\baustin\b|\bboston\b|\bchicago\b|\blos angeles\b|\bdenver\b|\batlanta\b|\bmiami\b|\bdallas\b|\bhouston\b|\bsilicon valley\b|\bcalifornia\b|\btexas\b|\bwashington,?\s*dc\b|,\s*(?:ca|ny|tx|wa|ma|il|co|ga|fl|va|nc|nj|pa|oh|az|ut)\b""", RegexOption.IGNORE_CASE),
        "United Kingdom" to Regex("""\bunited kingdom\b|\bu\.k\.?\b|\buk\b|\bengland\b|\bscotland\b|\bwales\b|\blondon\b|\bmanchester\b|\bedinburgh\b|\bbristol\b|\bbirmingham\b|\bglasgow\b|\bleeds\b""", RegexOption.IGNORE_CASE),
        "Canada" to Regex("""\bcanada\b|\btoronto\b|\bvancouver\b|\bmontreal\b|\bottawa\b|\bcalgary\b|\bwaterloo\b|\bedmonton\b|\bontario\b""", RegexOption.IGNORE_CASE),
        "Germany" to Regex("""\bgermany\b|\bdeutschland\b|\bberlin\b|\bmunich\b|\bmünchen\b|\bhamburg\b|\bfrankfurt\b|\bcologne\b|\bköln\b|\bstuttgart\b|\bdüsseldorf\b|\bleipzig\b|\bkarlsruhe\b""", RegexOption.IGNORE_CASE),
        "Singapore" to Regex("""\bsingapore\b""", RegexOption.IGNORE_CASE),
        "Australia" to Regex("""\baustralia\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b|\bperth\b|\badelaide\b|\bcanberra\b""", RegexOption.IGNORE_CASE),
        "United Arab Emirates" to Regex("""\bunited arab emirates\b|\buae\b|\bdubai\b|\babu dhabi\b|\bsharjah\b""", RegexOption.IGNORE_CASE),
        "Netherlands" to Regex("""\bnetherlands\b|\bholland\b|\bamsterdam\b|\brotterdam\b|\butrecht\b|\beindhoven\b|\bthe hague\b""", RegexOption.IGNORE_CASE),
        "Ireland" to Regex("""\bireland\b|\bdublin\b|\bcork\b|\bgalway\b|\blimerick\b""", RegexOption.IGNORE_CASE)
        */
    )

    private val salaryPatterns: Map<String, Regex> = mapOf(
        "India" to Regex("""₹|\binr\b|\blpa\b""", RegexOption.IGNORE_CASE)
        /* Other regions commented out — focusing on India first
        "United Kingdom" to Regex("""£|\bgbp\b""", RegexOption.IGNORE_CASE),
        "Canada" to Regex("""\bcad\b|c\$""", RegexOption.IGNORE_CASE),
        "Singapore" to Regex("""\bsgd\b|s\$""", RegexOption.IGNORE_CASE),
        "Australia" to Regex("""\baud\b|a\$""", RegexOption.IGNORE_CASE),
        "United Arab Emirates" to Regex("""\baed\b""", RegexOption.IGNORE_CASE)
        */
    )

    fun inferCountry(location: String, market: String = "", salary: String = ""): String {
        for ((country, regex) in locationPatterns) {
            if (regex.containsMatchIn(location)) return country
        }
        for ((country, regex) in salaryPatterns) {
            if (regex.containsMatchIn(salary)) return country
        }
        if (market.equals("India", ignoreCase = true)) return "India"
        return "Global"
    }

    fun matchesCountry(job: JobListing, country: String): Boolean {
        // Other regions commented out — focusing on India first
        val targetCountry = "India" // if (country == "All" || country.isBlank()) return true
        val locPattern = locationPatterns[targetCountry]
        if (locPattern != null && locPattern.containsMatchIn(job.location)) return true
        val salPattern = salaryPatterns[targetCountry]
        if (salPattern != null && salPattern.containsMatchIn(job.salary)) return true
        if (targetCountry == "India" && job.portalType.equals("Naukri", ignoreCase = true)) return true
        return inferCountry(job.location, job.market, job.salary) == targetCountry
    }
}
