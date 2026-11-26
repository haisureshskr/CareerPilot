package com.careerpilot.ai

import com.careerpilot.ai.data.ai.FirebaseAiService
import com.careerpilot.ai.data.ai.TailoredJobAnalysis
import com.careerpilot.ai.data.compliance.TruthfulnessLockValidator
import com.careerpilot.ai.data.model.EducationItem
import com.careerpilot.ai.data.model.ExperienceItem
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.ResumeDiffItem
import com.careerpilot.ai.data.model.ScreeningAnswer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TruthfulnessLockTest {

    private val verifiedProfile = MasterProfile(
        fullName = "Ananya Deshmukh",
        headline = "Senior Frontend Engineer",
        email = "ananya@example.com",
        skills = listOf("React", "TypeScript", "Node.js", "PostgreSQL"),
        experience = listOf(
            ExperienceItem(
                id = "exp-1",
                company = "FinStack Payments",
                title = "Senior Frontend Engineer",
                startDate = "Mar 2022",
                endDate = "Present",
                bullets = listOf(
                    "Architected a modular React & TypeScript checkout SDK handling 1.8M monthly UPI transactions."
                )
            )
        ),
        education = listOf(
            EducationItem(
                id = "edu-1",
                institution = "NIT Surathkal",
                degree = "B.Tech in Computer Science",
                graduationYear = "2019"
            )
        )
    )

    @Test
    fun geminiSystemPromptEnforcesStrictTruthfulnessLock() {
        val aiService = FirebaseAiService()
        val prompt = aiService.getTruthfulnessSystemPromptText()
        assertTrue(
            "Gemini system prompt must enforce TRUTHFULNESS LOCK against fabricating employers, degrees, and skills.",
            TruthfulnessLockValidator.assertPromptContainsTruthfulnessLock(prompt)
        )
    }

    @Test
    fun validatorRejectsFabricatedEmployerAndTitleAndStripsFakeDegreeAndSkills() {
        val hallucinatedAnalysis = TailoredJobAnalysis(
            matchScore = 92,
            matchedKeywords = listOf("React", "TypeScript", "Rust", "Kubernetes"),
            resumeDiffs = listOf(
                // Fabricated employer not in MasterProfile -> must be rejected
                ResumeDiffItem(
                    id = "fake-org",
                    experienceRef = "Meta Platforms · Staff Engineer",
                    before = "Built global distributed caching clusters.",
                    after = "Engineered Rust distributed clusters at Meta.",
                    rationale = "Hallucinated employer"
                ),
                // Real employer, fabricated job title -> must be rejected
                ResumeDiffItem(
                    id = "fake-title",
                    experienceRef = "FinStack Payments · VP of Engineering",
                    before = "Architected a modular React & TypeScript checkout SDK handling 1.8M monthly UPI transactions.",
                    after = "Led 200 engineers at FinStack Payments.",
                    rationale = "Hallucinated title"
                ),
                // Real employer, title, and before bullet — but hallucinated PhD & Rust in after -> stripped cleanly
                ResumeDiffItem(
                    id = "partial-hallucination",
                    experienceRef = "FinStack Payments · Senior Frontend Engineer",
                    before = "Architected a modular React & TypeScript checkout SDK handling 1.8M monthly UPI transactions.",
                    after = "Leveraged PhD research and Rust with React & TypeScript to scale checkout SDK to 1.8M monthly UPI transactions.",
                    rationale = "Aligned with JD"
                )
            ),
            amberQuestions = listOf(
                ScreeningAnswer(
                    id = "sq-1",
                    question = "Describe your systems experience.",
                    answer = "During my MBA and Kubernetes work alongside React & TypeScript at FinStack Payments, I shipped checkout SDKs.",
                    confidence = "AMBER"
                )
            )
        )

        val result = TruthfulnessLockValidator.validateAndSanitize(verifiedProfile, hallucinatedAnalysis)

        assertFalse(result.isCompletelyTruthful)
        assertTrue("Fake employer must be flagged & rejected", result.strippedEmployers.contains("Meta Platforms"))
        assertTrue("Fake title must be flagged & rejected", result.strippedTitles.contains("VP of Engineering"))
        assertTrue("Fake degrees (PhD, MBA) must be stripped", result.strippedDegrees.any { it.equals("PhD", true) || it.equals("MBA", true) })
        assertTrue("Unverified skills (Rust, Kubernetes) must be stripped", result.strippedSkills.any { it.equals("Rust", true) })
        assertEquals(2, result.rejectedDiffCount)

        val sanitized = result.sanitizedAnalysis
        assertEquals(listOf("React", "TypeScript"), sanitized.matchedKeywords)
        assertEquals(1, sanitized.resumeDiffs.size)
        assertFalse(sanitized.resumeDiffs.first().after.contains("PhD", ignoreCase = true))
        assertFalse(sanitized.resumeDiffs.first().after.contains("Rust", ignoreCase = true))
        assertTrue(sanitized.resumeDiffs.first().after.contains("React & TypeScript"))
        assertFalse(sanitized.amberQuestions.first().answer.contains("MBA", ignoreCase = true))
        assertFalse(sanitized.amberQuestions.first().answer.contains("Kubernetes", ignoreCase = true))
    }
}
