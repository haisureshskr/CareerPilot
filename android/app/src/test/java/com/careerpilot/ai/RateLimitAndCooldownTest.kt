package com.careerpilot.ai

import com.careerpilot.ai.data.compliance.RateLimitGuard
import com.careerpilot.ai.data.compliance.RateLimitViolationException
import com.careerpilot.ai.data.model.PricingTier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RateLimitAndCooldownTest {

    @Test
    fun tier1Blocks26thSubmissionInRolling24Hours() {
        val now = 1_800_000_000_000L
        // 25 submissions spaced 10 minutes apart within the last 24h
        val twentyFiveTimestamps = (1..25).map { idx -> now - idx * 10L * 60_000L }

        val state = RateLimitGuard.evaluate(PricingTier.TIER_1, twentyFiveTimestamps, now)
        assertEquals(25, state.dailyCap)
        assertEquals(25, state.usedLast24h)
        assertEquals(0, state.remainingToday)
        assertFalse(state.canSubmitNow)

        try {
            RateLimitGuard.assertCanSubmit(PricingTier.TIER_1, twentyFiveTimestamps, now)
            fail("Expected RateLimitViolationException when Tier 1 hits 25/24h daily cap.")
        } catch (ex: RateLimitViolationException) {
            assertTrue(ex.message.orEmpty().contains("25/25"))
            assertTrue(ex.message.orEmpty().contains("cap", ignoreCase = true))
        }
    }

    @Test
    fun tier4Blocks21stSubmissionInRolling24Hours() {
        val now = 1_800_000_000_000L
        // 20 submissions spaced 10 minutes apart within the last 24h
        val twentyTimestamps = (1..20).map { idx -> now - idx * 10L * 60_000L }

        val state = RateLimitGuard.evaluate(PricingTier.TIER_4, twentyTimestamps, now)
        assertEquals(20, state.dailyCap)
        assertEquals(20, state.usedLast24h)
        assertEquals(0, state.remainingToday)
        assertFalse(state.canSubmitNow)

        try {
            RateLimitGuard.assertCanSubmit(PricingTier.TIER_4, twentyTimestamps, now)
            fail("Expected RateLimitViolationException when Tier 4 hits 20/24h daily cap.")
        } catch (ex: RateLimitViolationException) {
            assertTrue(ex.message.orEmpty().contains("20/20"))
            assertTrue(ex.message.orEmpty().contains("cap", ignoreCase = true))
        }
    }

    @Test
    fun enforcesStrict60SecondInterSubmissionCooldown() {
        val now = 1_800_000_000_000L

        // 42 seconds since last submission -> 18s cooldown remaining
        val recentList = listOf(now - 42_000L)
        val blockedState = RateLimitGuard.evaluate(PricingTier.TIER_1, recentList, now)
        assertEquals(18, blockedState.cooldownSecondsRemaining)
        assertFalse(blockedState.canSubmitNow)

        try {
            RateLimitGuard.assertCanSubmit(PricingTier.TIER_1, recentList, now)
            fail("Expected RateLimitViolationException during 60s cooldown.")
        } catch (ex: RateLimitViolationException) {
            assertTrue(ex.message.orEmpty().contains("60-second"))
            assertTrue(ex.message.orEmpty().contains("18s"))
        }

        // 60 seconds elapsed -> unlocked
        val unlockedList = listOf(now - 60_000L)
        val unlockedState = RateLimitGuard.assertCanSubmit(PricingTier.TIER_1, unlockedList, now)
        assertEquals(0, unlockedState.cooldownSecondsRemaining)
        assertTrue(unlockedState.canSubmitNow)
    }
}
