package com.careerpilot.ai

import com.careerpilot.ai.data.compliance.ApprovalStateMachine
import com.careerpilot.ai.data.compliance.InvalidApprovalTransitionException
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ApprovalStateMachineTest {

    @Test
    fun transitionsPendingToApprovedToActionRequiredOnCaptchaToSubmitted() {
        val t1 = 1_800_000_100_000L
        val t2 = 1_800_000_105_000L
        val t3 = 1_800_000_170_000L

        val initial = ApplicationRecord(
            id = "app-state-1",
            company = "Swiggy",
            role = "Staff UI Engineer",
            status = ApplicationStatus.PENDING_APPROVAL,
            userApprovedAtEpochMs = null
        )
        assertNull(initial.userApprovedAtEpochMs)

        // Step 1: PENDING_APPROVAL -> APPROVED (must log user_approved_at)
        val approved = ApprovalStateMachine.approve(initial, nowMs = t1)
        assertEquals(ApplicationStatus.APPROVED, approved.status)
        assertNotNull("user_approved_at must be logged upon human approval.", approved.userApprovedAtEpochMs)
        assertEquals(t1, approved.userApprovedAtEpochMs)

        // Step 2: APPROVED -> ACTION_REQUIRED (on simulated CAPTCHA / OTP challenge)
        val actionRequired = ApprovalStateMachine.executePortalStep(
            record = approved,
            simulatedCaptcha = true,
            nowMs = t2,
            actionReason = "Simulated CAPTCHA / OTP gate encountered."
        )
        assertEquals(ApplicationStatus.ACTION_REQUIRED, actionRequired.status)
        assertEquals(t1, actionRequired.userApprovedAtEpochMs)
        assertTrue(actionRequired.actionReason.contains("CAPTCHA"))

        // Step 3: ACTION_REQUIRED -> SUBMITTED (after manual human handoff)
        val submitted = ApprovalStateMachine.completeManualHandoff(actionRequired, nowMs = t3)
        assertEquals(ApplicationStatus.SUBMITTED, submitted.status)
        assertEquals(t1, submitted.userApprovedAtEpochMs)
        assertEquals("", submitted.actionReason)
    }

    @Test
    fun rejectsDirectPortalExecutionWithoutPriorHumanApproval() {
        val pending = ApplicationRecord(
            id = "app-unapproved",
            company = "Razorpay",
            status = ApplicationStatus.PENDING_APPROVAL,
            userApprovedAtEpochMs = null
        )

        try {
            ApprovalStateMachine.executePortalStep(pending, simulatedCaptcha = false)
            fail("Expected InvalidApprovalTransitionException when bypassing human APPROVED state.")
        } catch (ex: InvalidApprovalTransitionException) {
            assertTrue(ex.message.orEmpty().contains("APPROVED"))
        }
    }
}
