package com.careerpilot.ai

import com.careerpilot.ai.data.compliance.PppGeoLockEvaluator
import com.careerpilot.ai.data.model.PricingTier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PppGeoLockTest {

    @Test
    fun tier4WithIpVsCardBinMismatchBlocksDiscountAndRevertsToTier1Pricing() {
        val decision = PppGeoLockEvaluator.evaluateCheckout(
            selectedTier = PricingTier.TIER_4,
            ipCountryCode = "IN",
            cardBinCountryCode = "US",
            ipVsCardBinMismatchToggle = true
        )

        assertTrue("Tier 4 discounted checkout must be blocked on Card BIN mismatch.", decision.discountBlocked)
        assertEquals(PricingTier.TIER_1, decision.effectiveTier)
        assertEquals("$12.99/wk", decision.effectiveWeeklyPrice)
        assertEquals("$29.99/mo", decision.effectiveMonthlyPrice)
        assertTrue(decision.reason.contains("BLOCKED"))
        assertTrue(decision.reason.contains("$29.99/mo"))
    }

    @Test
    fun tier4WithMatchingIndianIpAndIndianCardBinApprovesLocalPricing() {
        val decision = PppGeoLockEvaluator.evaluateCheckout(
            selectedTier = PricingTier.TIER_4,
            ipCountryCode = "IN",
            cardBinCountryCode = "IN",
            ipVsCardBinMismatchToggle = false
        )

        assertFalse("Matching IN IP and IN Card BIN must approve Tier 4 pricing.", decision.discountBlocked)
        assertEquals(PricingTier.TIER_4, decision.effectiveTier)
        assertEquals("₹299/wk", decision.effectiveWeeklyPrice)
        assertEquals("₹749/mo", decision.effectiveMonthlyPrice)
        assertTrue(decision.reason.contains("VERIFIED"))
    }
}
