package com.careerpilot.ai

import com.careerpilot.ai.data.compliance.RecruiterPrivacyFilter
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.HiringTeamMember
import com.careerpilot.ai.data.model.PrivacyHashUtil
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecruiterTtlAndOptOutTest {

    @Test
    fun expiredPosterExpiresAtHidesAndScrubsLinkedInPosterCard() {
        val now = 1_800_000_000_000L
        val expiredMember = HiringTeamMember(
            name = "Siddharth Kulkarni",
            title = "Engineering Manager",
            linkedinUrl = "https://www.linkedin.com/in/siddharth-kulkarni-checkout",
            postedAgo = "31 days ago",
            autoPurgeDaysRemaining = 1, // Even if counter stale, poster_expires_at in the past must hide it
            posterExpiresAtEpochMs = now - 3_600_000L
        )
        val app = ApplicationRecord(
            id = "app-expired",
            company = "Razorpay",
            role = "Senior Frontend Engineer",
            hiringTeam = expiredMember,
            linkedinNote = "Hi Siddharth, would love to connect!"
        )

        assertTrue(RecruiterPrivacyFilter.isPosterExpired(expiredMember, now))
        assertFalse(RecruiterPrivacyFilter.isPosterVisible(expiredMember, emptySet(), now))

        val scrubbed = RecruiterPrivacyFilter.scrubIfHidden(app, emptySet(), now)
        assertEquals("", scrubbed.hiringTeam.linkedinUrl)
        assertEquals("", scrubbed.hiringTeam.name)
        assertEquals("", scrubbed.linkedinNote)
    }

    @Test
    fun recruiterOptOutStoresOnlySha256HashAndImmediatelyScrubsMatchingJobCards() {
        val now = 1_800_000_000_000L
        val rawUrl = "https://www.linkedin.com/in/Elena-Rostova-Recruiting/"
        val optOutDoc = RecruiterPrivacyFilter.createOptOutDocument(rawUrl)

        // Verify document stores ONLY 64-char hex SHA-256 hash and zero raw LinkedIn URL / PII
        assertTrue(optOutDoc.documentId.matches(Regex("^[a-f0-9]{64}$")))
        assertEquals(optOutDoc.documentId, optOutDoc.fields["urlSha256"])
        assertEquals(true, optOutDoc.fields["active"])
        assertEquals(setOf("urlSha256", "active"), optOutDoc.fields.keys)
        assertFalse(optOutDoc.fields.values.any { it.toString().contains("linkedin", ignoreCase = true) })
        assertFalse(optOutDoc.fields.values.any { it.toString().contains("elena", ignoreCase = true) })

        // Active (non-expired) job card matching normalized LinkedIn URL must be immediately scrubbed
        val activeMember = HiringTeamMember(
            name = "Elena Rostova",
            title = "Staff Recruiting Partner",
            linkedinUrl = "http://linkedin.com/in/elena-rostova-recruiting",
            autoPurgeDaysRemaining = 29,
            posterExpiresAtEpochMs = now + 29L * 24L * 3600_000L
        )
        val app = ApplicationRecord(
            id = "app-stripe",
            company = "Stripe",
            role = "Full-Stack Product Engineer",
            hiringTeam = activeMember,
            linkedinNote = "Hi Elena, excited about Stripe!"
        )

        // Visible before opt-out
        assertTrue(RecruiterPrivacyFilter.isPosterVisible(activeMember, emptySet(), now))

        // Immediately hidden & scrubbed once SHA-256 hash is in blocklist
        val blockedSet = setOf(PrivacyHashUtil.sha256LinkedInUrl(rawUrl))
        assertFalse(RecruiterPrivacyFilter.isPosterVisible(activeMember, blockedSet, now))

        val scrubbed = RecruiterPrivacyFilter.scrubIfHidden(app, blockedSet, now)
        assertEquals("", scrubbed.hiringTeam.linkedinUrl)
        assertEquals("", scrubbed.hiringTeam.name)
        assertEquals("", scrubbed.linkedinNote)
    }
}
