package com.careerpilot.ai.data.ai

import com.careerpilot.ai.data.compliance.TruthfulnessLockValidator
import com.careerpilot.ai.data.model.CountryFilterMatcher
import com.careerpilot.ai.data.model.JobListing
import com.careerpilot.ai.data.model.LinkedInProfileExtractor
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.QAVault
import com.careerpilot.ai.data.model.ResumeDiffItem
import com.careerpilot.ai.data.model.ScreeningAnswer
import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.UUID

@Serializable
data class TailoredJobAnalysis(
    val inferredCompany: String = "",
    val inferredRole: String = "",
    val inferredLocation: String = "",
    val inferredSalary: String = "",
    val matchScore: Int = 75,
    val portalComplexity: String = "1-Click",
    val matchedKeywords: List<String> = emptyList(),
    val missingKeywords: List<String> = emptyList(),
    val linkedinNote: String = "",
    val resumeDiffs: List<ResumeDiffItem> = emptyList(),
    val amberQuestions: List<ScreeningAnswer> = emptyList()
)

class FirebaseAiService {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val truthfulnessPromptText = """
            TRUTHFULNESS LOCK (STRICT, NON-NEGOTIABLE):
            - ${TruthfulnessLockValidator.REQUIRED_PROMPT_CLAUSE} not explicitly present in the candidate's Master Profile or Q&A Vault.
            - You may ONLY reorder existing bullet points and align phrasing to target Job Description terminology using strictly verified facts from the Master Profile.
            - Output strictly valid JSON matching the requested schema with no markdown code fences.
            """.trimIndent()

    fun getTruthfulnessSystemPromptText(): String = truthfulnessPromptText

    private val truthfulnessLockSystemPrompt = content {
        text(truthfulnessPromptText)
    }

    private val model by lazy {
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = "gemini-4-hydrogen",
            systemInstruction = truthfulnessLockSystemPrompt,
            generationConfig = generationConfig {
                responseMimeType = "application/json"
            }
        )
    }

    suspend fun parseResume(
        resumeText: String? = null,
        pdfBytes: ByteArray? = null
    ): MasterProfile {
        val pdfLinkedIn = LinkedInProfileExtractor.extractFromPdfBytes(pdfBytes)
        val textLinkedIn = LinkedInProfileExtractor.extractFromText(resumeText)

        val promptContent = content {
            if (pdfBytes != null && pdfBytes.isNotEmpty()) {
                inlineData(bytes = pdfBytes, mimeType = "application/pdf")
            }
            text(
                """
                Extract the candidate's resume strictly into JSON matching:
                {
                  "fullName": "string",
                  "headline": "string",
                  "email": "string",
                  "phone": "string",
                  "location": "string",
                  "linkedinUrl": "string (https://www.linkedin.com/in/... if present, else empty string)",
                  "summary": "string",
                  "skills": ["string"],
                  "experience": [{"id": "exp-1", "company": "string", "title": "string", "location": "string", "startDate": "string", "endDate": "string", "bullets": ["string"]}],
                  "education": [{"id": "edu-1", "institution": "string", "degree": "string", "graduationYear": "string", "details": "string"}],
                  "projects": [{"id": "proj-1", "name": "string", "techStack": ["string"], "description": "string"}]
                }
                Only include facts explicitly written in the resume. Carefully extract the candidate's LinkedIn profile URL if present anywhere in contact info or hyperlinks.
                ${if (!pdfLinkedIn.isNullOrBlank()) "\nDetected embedded PDF hyperlink: $pdfLinkedIn" else ""}
                ${if (!resumeText.isNullOrBlank()) "\n--- RESUME TEXT ---\n${resumeText.take(25000)}" else ""}
                """.trimIndent()
            )
        }

        val response = model.generateContent(promptContent)
        val raw = response.text?.trim().orEmpty()
        require(raw.isNotBlank()) { "Gemini returned an empty resume parse response." }
        val parsed = json.decodeFromString<MasterProfile>(raw)
        val geminiLinkedIn = LinkedInProfileExtractor.normalizeCandidateLinkedInUrl(parsed.linkedinUrl)
        val resolvedLinkedIn = pdfLinkedIn ?: textLinkedIn ?: geminiLinkedIn ?: ""
        return parsed.copy(linkedinUrl = resolvedLinkedIn)
    }

    suspend fun analyzeAndTailorJob(
        profile: MasterProfile,
        vault: QAVault,
        job: JobListing
    ): TailoredJobAnalysis {
        val profileJson = json.encodeToString(MasterProfile.serializer(), profile)
        val vaultJson = json.encodeToString(QAVault.serializer(), vault)

        val prompt = """
            Analyze the candidate Master Profile & Q&A Vault against this Job Description.
            
            MASTER PROFILE:
            $profileJson
            
            Q&A VAULT:
            $vaultJson
            
            TARGET JOB:
            Company: ${job.company}
            Role: ${job.role}
            Location: ${job.location}
            Salary: ${job.salary}
            Portal: ${job.portalType}
            Hiring Manager / Recruiter: ${job.hiringTeam.name} (${job.hiringTeam.title})
            Description:
            ${job.description.take(6000)}
            
            Return strictly valid JSON:
            {
              "inferredCompany": "string",
              "inferredRole": "string",
              "inferredLocation": "string",
              "inferredSalary": "string",
              "matchScore": 0-100 integer,
              "portalComplexity": "1-Click" or "Multi-Step",
              "matchedKeywords": ["verified skill"],
              "missingKeywords": ["missing JD requirement"],
              "linkedinNote": "strictly under 270 characters addressed to ${job.hiringTeam.name} citing only real profile experience",
              "resumeDiffs": [
                {"id": "diff-1", "experienceRef": "Company · Role", "before": "exact verbatim bullet from profile", "after": "truthful keyword-aligned bullet", "rationale": "why reordered/aligned"}
              ],
              "amberQuestions": [
                {"id": "sq-1", "question": "subjective screening question", "answer": "truthful AI draft citing only Master Profile facts", "confidence": "AMBER", "sourceLabel": "AI draft · Review required", "reviewed": false}
              ]
            }
            Include 3 to 4 resumeDiffs and 1 to 2 amberQuestions. Obey the TRUTHFULNESS LOCK strictly.
        """.trimIndent()

        val response = model.generateContent(prompt)
        val raw = response.text?.trim().orEmpty()
        require(raw.isNotBlank()) { "Gemini returned an empty ATS analysis response." }
        val parsed = json.decodeFromString<TailoredJobAnalysis>(raw)
        val validated = TruthfulnessLockValidator.validateAndSanitize(profile, parsed).sanitizedAnalysis

        return validated.copy(
            matchScore = validated.matchScore.coerceIn(0, 100),
            linkedinNote = validated.linkedinNote.take(275),
            resumeDiffs = validated.resumeDiffs.take(4).mapIndexed { idx, item ->
                item.copy(id = item.id.ifBlank { "diff-${UUID.randomUUID()}-$idx" })
            },
            amberQuestions = validated.amberQuestions.take(2).mapIndexed { idx, item ->
                item.copy(
                    id = item.id.ifBlank { "sq-amber-${UUID.randomUUID()}-$idx" },
                    confidence = "AMBER",
                    sourceLabel = "AI draft · Review required",
                    reviewed = false
                )
            }
        )
    }

    /**
     * Discovers resume-tailored job openings across Greenhouse, Lever, Ashby, Workday, and Naukri
     * strictly grounded in the candidate's MasterProfile and QAVault.
     */
    suspend fun discoverJobsForResume(
        ownerId: String,
        profile: MasterProfile,
        vault: QAVault,
        query: String = "",
        country: String = "India",
        market: String = "India",
        workMode: String = "All",
        portalType: String = "All"
    ): List<JobListing> {
        val profileJson = json.encodeToString(MasterProfile.serializer(), profile)
        val vaultJson = json.encodeToString(QAVault.serializer(), vault)
        // Other regions commented out — focusing on India first
        val targetCountry = "India"
        val countryRule = """
            STRICT COUNTRY LOCK (MANDATORY — INDIA ONLY):
            - Every single returned job MUST be located in or explicitly hiring in $targetCountry (e.g., Bengaluru, Mumbai, Hyderabad, Pune, Chennai, Delhi NCR, Noida, Gurugram, or "Remote (India)").
            - Every job's "location" MUST include "$targetCountry" (e.g. "Bengaluru, India" or "Remote (India)").
            - Set "market" to "India" and use INR LPA salary ranges.
            - NEVER return jobs from other countries or generic "Worldwide / Global" roles.
        """.trimIndent()
        /* Other regions commented out — focusing on India first
        val countryRule = if (country != "All" && country.isNotBlank()) {
            """
            STRICT COUNTRY LOCK (MANDATORY):
            - Every single returned job MUST be located in or explicitly hiring in $country.
            - Every job's "location" MUST include "$country" (e.g. "<Real City>, $country" or "Remote ($country)").
            - Set "market" to "${if (country == "India") "India" else "Global"}".
            - NEVER return jobs from other countries or generic "Worldwide / Global" roles.
            """.trimIndent()
        } else {
            "Include jobs matching the candidate's location (${profile.location.ifBlank { "Global" }}) and Market filter ($market)."
        }
        */

        val prompt = """
            Discover 8 realistic, high-relevance public job openings matching this candidate's actual resume.
            
            MASTER PROFILE:
            $profileJson
            
            Q&A VAULT:
            $vaultJson
            
            FILTERS:
            - Optional Query: ${query.ifBlank { "(Derive target roles strictly from the resume)" }}
            - Selected Country: $country
            - Market: $market
            - Work Mode: $workMode
            - Portal: $portalType

            $countryRule
            
            Return strictly valid JSON:
            {
              "jobs": [
                {
                  "company": "string",
                  "role": "string",
                  "location": "string",
                  "market": "India" or "Global",
                  "salary": "string",
                  "workMode": "Remote" or "Hybrid" or "On-site",
                  "portalType": "Greenhouse" or "Lever" or "Ashby" or "Workday" or "Naukri",
                  "portalComplexity": "1-Click" or "Multi-Step",
                  "matchScore": 0-100,
                  "matchedKeywords": ["verified resume skill"],
                  "missingKeywords": ["missing JD requirement"],
                  "description": "concise role summary",
                  "jobUrl": "https://...",
                  "hiringTeamName": "string",
                  "hiringTeamTitle": "string",
                  "postedAgo": "string"
                }
              ]
            }
            Obey TRUTHFULNESS LOCK strictly: matchedKeywords MUST exist in MASTER PROFILE.
        """.trimIndent()

        val response = model.generateContent(prompt)
        val raw = response.text?.trim().orEmpty()
        require(raw.isNotBlank()) { "Gemini returned an empty resume job discovery response." }
        val payload = json.decodeFromString<DiscoveredJobsResponse>(raw)
        val resumeCorpus = buildString {
            append(profile.headline).append(' ')
            append(profile.summary).append(' ')
            append(profile.skills.joinToString(" ")).append(' ')
            profile.experience.forEach { exp ->
                append(exp.company).append(' ').append(exp.title).append(' ')
                append(exp.bullets.joinToString(" ")).append(' ')
            }
            profile.projects.forEach { p ->
                append(p.name).append(' ').append(p.techStack.joinToString(" ")).append(' ')
            }
        }.lowercase()

        val validPortals = setOf("Greenhouse", "Lever", "Ashby", "Workday", "Naukri")
        val validModes = setOf("Remote", "Hybrid", "On-site")

        val mapped = payload.jobs.take(10).mapIndexed { idx, item ->
            val safePortal = if (item.portalType in validPortals) item.portalType else "Greenhouse"
            val safeMode = if (item.workMode in validModes) item.workMode else "Remote"
            val safeMarket = if (country == "India" || item.market == "India") "India" else "Global"
            val safeComplexity = if (item.portalComplexity == "Multi-Step" || safePortal in listOf("Workday", "Naukri")) "Multi-Step" else "1-Click"
            val verifiedMatched = item.matchedKeywords.filter { kw ->
                kw.isNotBlank() && resumeCorpus.contains(kw.trim().lowercase())
            }.take(10)
            val unverified = item.matchedKeywords.filter { kw ->
                kw.isNotBlank() && !resumeCorpus.contains(kw.trim().lowercase())
            }
            val safeMissing = (item.missingKeywords + unverified).distinct().take(10)
            val safeUrl = if (com.careerpilot.ai.data.model.PrivacyHashUtil.isSafeExternalUrl(item.jobUrl)) {
                item.jobUrl.take(500)
            } else {
                val encodedQuery = java.net.URLEncoder.encode("${item.company} ${item.role} careers", "UTF-8")
                "https://www.google.com/search?q=$encodedQuery"
            }
            val slug = "${item.company}_${item.role}"
                .lowercase()
                .replace(Regex("[^a-z0-9]+"), "_")
                .trim('_')
                .take(48)

            JobListing(
                id = "job_res_${slug}_$idx",
                ownerId = ownerId,
                company = item.company.ifBlank { "Employer" }.take(120),
                role = item.role.ifBlank { "Open Role" }.take(160),
                location = item.location.ifBlank { if (country != "All") country else profile.location }.take(120),
                market = safeMarket,
                salary = item.salary.ifBlank { "Not disclosed" }.take(100),
                workMode = safeMode,
                portalType = safePortal,
                portalComplexity = safeComplexity,
                matchScore = item.matchScore.coerceIn(0, 100),
                matchedKeywords = verifiedMatched,
                missingKeywords = safeMissing,
                description = item.description.ifBlank { "Resume-matched opportunity." }.take(6000),
                jobUrl = safeUrl,
                hiringTeam = com.careerpilot.ai.data.model.HiringTeamMember(
                    name = item.hiringTeamName.ifBlank { "${item.company} Talent Team" },
                    title = item.hiringTeamTitle.ifBlank { "Hiring Team" },
                    linkedinUrl = "https://www.linkedin.com/jobs/",
                    postedAgo = item.postedAgo.ifBlank { "Live search" },
                    autoPurgeDaysRemaining = 30
                )
            )
        }
        return if (country == "All" || country.isBlank()) {
            mapped
        } else {
            mapped.filter { CountryFilterMatcher.matchesCountry(it, country) }
        }
    }

    /**
     * Live diagnostics probe verifying Firebase AI Logic connectivity and strict JSON schema parsing.
     */
    suspend fun runConnectivitySchemaProbe(): TailoredJobAnalysis {
        val probePrompt = """
            Return strictly valid JSON with no markdown:
            {
              "inferredCompany": "DiagnosticCheck",
              "inferredRole": "Verification Engineer",
              "inferredLocation": "Remote",
              "inferredSalary": "Verified",
              "matchScore": 88,
              "portalComplexity": "1-Click",
              "matchedKeywords": ["Kotlin"],
              "missingKeywords": [],
              "linkedinNote": "Diagnostic connectivity note under 280 chars.",
              "resumeDiffs": [],
              "amberQuestions": []
            }
        """.trimIndent()
        val response = model.generateContent(probePrompt)
        val raw = response.text?.trim().orEmpty()
        require(raw.isNotBlank()) { "Empty response from Firebase AI Logic (Gemini)." }
        val decoded = json.decodeFromString<TailoredJobAnalysis>(raw)
        require(decoded.matchScore in 0..100) { "Invalid matchScore schema value: ${decoded.matchScore}" }
        require(decoded.linkedinNote.length <= 280) { "linkedinNote exceeded 280-char schema constraint." }
        return decoded
    }
}

@Serializable
data class DiscoveredJobsResponse(
    val jobs: List<DiscoveredJobDto> = emptyList()
)

@Serializable
data class DiscoveredJobDto(
    val company: String = "",
    val role: String = "",
    val location: String = "",
    val market: String = "Global",
    val salary: String = "Not disclosed",
    val workMode: String = "Remote",
    val portalType: String = "Greenhouse",
    val portalComplexity: String = "1-Click",
    val matchScore: Int = 75,
    val matchedKeywords: List<String> = emptyList(),
    val missingKeywords: List<String> = emptyList(),
    val description: String = "",
    val jobUrl: String = "",
    val hiringTeamName: String = "",
    val hiringTeamTitle: String = "",
    val postedAgo: String = "Recently posted"
)
