package com.careerpilot.ai

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.GuardrailState
import com.careerpilot.ai.data.model.HiringTeamMember
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PricingTier
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.ui.screens.ApprovalQueueScreen
import com.careerpilot.ai.ui.screens.PricingSettingsScreen
import com.careerpilot.ai.ui.theme.CareerPilotTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class CareerPilotComplianceUiTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun expiredPosterExpiresAtHidesLinkedInPosterCardInApprovalQueue() {
        val pastMs = System.currentTimeMillis() - 86_400_000L
        val expiredApp = ApplicationRecord(
            id = "app_expired_ui",
            company = "Razorpay",
            role = "Senior Frontend Engineer",
            status = ApplicationStatus.PENDING_APPROVAL,
            hiringTeam = HiringTeamMember(
                name = "Siddharth Kulkarni",
                title = "Engineering Manager",
                linkedinUrl = "https://www.linkedin.com/in/siddharth-kulkarni",
                autoPurgeDaysRemaining = 0,
                posterExpiresAtEpochMs = pastMs
            ),
            linkedinNote = "Hi Siddharth!"
        )

        composeRule.setContent {
            CareerPilotTheme {
                ApprovalQueueScreen(
                    applications = listOf(expiredApp),
                    masterProfile = MasterProfile(fullName = "Ananya Deshmukh"),
                    blockedRecruiterHashes = emptySet(),
                    warrantyAccepted = true,
                    guardrails = GuardrailState(dailyCap = 25, usedLast24h = 0, cooldownSecondsRemaining = 0),
                    onApproveAndLaunchWebView = { _, _ -> },
                    onLaunchParallelPortals = {},
                    onSaveEditToVault = { _, _ -> },
                    onSkip = {}
                )
            }
        }

        composeRule.onNodeWithTag("poster_card_app_expired_ui").assertDoesNotExist()
        composeRule.onNodeWithTag("view_linkedin_app_expired_ui").assertDoesNotExist()
        composeRule.onNodeWithTag("poster_suppressed_app_expired_ui").assertIsDisplayed()
    }

    @Test
    fun optedOutRecruiterSha256HashImmediatelyHidesPosterCardInApprovalQueue() {
        val recruiterUrl = "https://www.linkedin.com/in/elena-rostova-recruiting"
        val blockedHash = PrivacyHashUtil.sha256LinkedInUrl(recruiterUrl)
        val app = ApplicationRecord(
            id = "app_optout_ui",
            company = "Stripe",
            role = "Full-Stack Product Engineer",
            status = ApplicationStatus.PENDING_APPROVAL,
            hiringTeam = HiringTeamMember(
                name = "Elena Rostova",
                title = "Staff Recruiting Partner",
                linkedinUrl = recruiterUrl,
                autoPurgeDaysRemaining = 28,
                posterExpiresAtEpochMs = System.currentTimeMillis() + 28L * 86_400_000L
            ),
            linkedinNote = "Hi Elena!"
        )

        composeRule.setContent {
            CareerPilotTheme {
                ApprovalQueueScreen(
                    applications = listOf(app),
                    masterProfile = MasterProfile(fullName = "Ananya Deshmukh"),
                    blockedRecruiterHashes = setOf(blockedHash),
                    warrantyAccepted = true,
                    guardrails = GuardrailState(dailyCap = 25, usedLast24h = 0, cooldownSecondsRemaining = 0),
                    onApproveAndLaunchWebView = { _, _ -> },
                    onLaunchParallelPortals = {},
                    onSaveEditToVault = { _, _ -> },
                    onSkip = {}
                )
            }
        }

        composeRule.onNodeWithTag("poster_card_app_optout_ui").assertDoesNotExist()
        composeRule.onNodeWithTag("poster_suppressed_app_optout_ui")
            .assertIsDisplayed()
            .assertTextContains("SHA-256", substring = true)
    }

    @Test
    fun tier4WithIpVsCardBinMismatchBlocksCheckoutAndFallsBackToTier1AndOpensDiagnostics() {
        var diagnosticsOpened = false

        composeRule.setContent {
            CareerPilotTheme {
                PricingSettingsScreen(
                    selectedTier = PricingTier.TIER_4,
                    onSelectTier = {},
                    onSubmitRecruiterOptOut = {},
                    onDeleteAccountAndAllData = {},
                    onSignOut = {},
                    onOpenDiagnostics = { diagnosticsOpened = true }
                )
            }
        }

        // Default mismatch toggle is ON for Tier 4 -> must block and revert to Tier 1 ($29.99/mo)
        composeRule.onNodeWithTag("ppp_decision_text")
            .assertIsDisplayed()
            .assertTextContains("BLOCKED", substring = true)
            .assertTextContains("$29.99/mo", substring = true)

        // Tap debug icon on PricingSettingsScreen -> opens DiagnosticsScreen
        composeRule.onNodeWithTag("open_diagnostics_button").performClick()
        assertTrue("Tapping debug icon must invoke onOpenDiagnostics.", diagnosticsOpened)
    }

    @Test
    fun dailyCapReachedDisablesApproveButtonWithClearCapMessage() {
        val pendingApp = ApplicationRecord(
            id = "app_cap_ui",
            company = "Linear",
            role = "Senior Product Engineer",
            status = ApplicationStatus.PENDING_APPROVAL
        )

        composeRule.setContent {
            CareerPilotTheme {
                ApprovalQueueScreen(
                    applications = listOf(pendingApp),
                    masterProfile = MasterProfile(fullName = "Ananya Deshmukh"),
                    blockedRecruiterHashes = emptySet(),
                    warrantyAccepted = true,
                    guardrails = GuardrailState(dailyCap = 20, usedLast24h = 20, cooldownSecondsRemaining = 0),
                    onApproveAndLaunchWebView = { _, _ -> },
                    onLaunchParallelPortals = {},
                    onSaveEditToVault = { _, _ -> },
                    onSkip = {}
                )
            }
        }

        composeRule.onNodeWithText("Daily Cap Reached (20/24h)")
            .assertIsDisplayed()
            .assertIsNotEnabled()
    }
}
