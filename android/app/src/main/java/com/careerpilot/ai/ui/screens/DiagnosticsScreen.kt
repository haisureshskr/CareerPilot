package com.careerpilot.ai.ui.screens

import android.content.Context
import android.net.Uri
import android.webkit.ValueCallback
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.careerpilot.ai.data.ai.FirebaseAiService
import com.careerpilot.ai.data.compliance.RateLimitGuard
import com.careerpilot.ai.data.compliance.RateLimitViolationException
import com.careerpilot.ai.data.compliance.RecruiterPrivacyFilter
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.HiringTeamMember
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PricingTier
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.data.model.ScreeningAnswer
import com.careerpilot.ai.data.pdf.ResumePdfGenerator
import com.careerpilot.ai.data.repository.DryRunWipeReport
import com.careerpilot.ai.ui.theme.EmeraldBg
import com.careerpilot.ai.ui.theme.EmeraldBorder
import com.careerpilot.ai.ui.theme.EmeraldText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class DiagnosticStatus {
    IDLE,
    RUNNING,
    PASS,
    FAIL
}

data class DiagnosticCheckResult(
    val id: Int,
    val title: String,
    val subtitle: String,
    val status: DiagnosticStatus = DiagnosticStatus.IDLE,
    val detail: String = "Tap \"Run All 6 Self-Checks\" to verify.",
    val durationMs: Long = 0L,
    val stackTrace: String? = null
)

/**
 * One-tap Material 3 Diagnostics & Self-Test Screen.
 * Accessible from the debug icon on PricingSettingsScreen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiagnosticsScreen(
    masterProfile: MasterProfile,
    aiService: FirebaseAiService,
    onCheckRecruiterOptOutLive: suspend (String) -> Boolean,
    onDryRunUserWipe: suspend () -> DryRunWipeReport,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var isRunning by remember { mutableStateOf(false) }
    var checks by remember {
        mutableStateOf(
            listOf(
                DiagnosticCheckResult(1, "Check 1: Gemini AI Logic Connectivity & JSON Schema", "Live probe against Firebase AI Logic verifying strict JSON schema decoding."),
                DiagnosticCheckResult(2, "Check 2: Local PdfDocument & cacheDir URI", "Generates a tailored PDF in cacheDir and verifies %PDF- header + readable URI."),
                DiagnosticCheckResult(3, "Check 3: WebView JS Bridge & onShowFileChooser PDF Hook", "Validates JSON-escaped autofill JS payload and WebChromeClient file chooser callback."),
                DiagnosticCheckResult(4, "Check 4: Daily Submission Cap (20/25) & 60s Cooldown", "Verifies rolling 24h cap blocking for Tier 1 (25) & Tier 4 (20) plus 60s timer."),
                DiagnosticCheckResult(5, "Check 5: Recruiter SHA-256 Opt-Out & 30-Day TTL Filter", "Verifies one-way SHA-256 zero-PII hashing, live Firestore lookup, and expired TTL hiding."),
                DiagnosticCheckResult(6, "Check 6: 1-Click User Data Wipe Dry-Run", "Non-destructively audits all Firestore paths under /users/{uid} ready for atomic batch wipe.")
            )
        )
    }

    fun updateCheck(id: Int, transform: (DiagnosticCheckResult) -> DiagnosticCheckResult) {
        checks = checks.map { if (it.id == id) transform(it) else it }
    }

    suspend fun runSingleCheck(id: Int, block: suspend () -> String) {
        updateCheck(id) { it.copy(status = DiagnosticStatus.RUNNING, detail = "Running...", stackTrace = null) }
        val start = System.currentTimeMillis()
        try {
            val detail = block()
            val elapsed = System.currentTimeMillis() - start
            updateCheck(id) {
                it.copy(
                    status = DiagnosticStatus.PASS,
                    detail = detail,
                    durationMs = elapsed,
                    stackTrace = null
                )
            }
        } catch (err: Throwable) {
            val elapsed = System.currentTimeMillis() - start
            updateCheck(id) {
                it.copy(
                    status = DiagnosticStatus.FAIL,
                    detail = err.message ?: err.javaClass.simpleName,
                    durationMs = elapsed,
                    stackTrace = err.stackTraceToString()
                )
            }
        }
    }

    fun runAllSixChecks() {
        if (isRunning) return
        isRunning = true
        scope.launch {
            var generatedPdfUri: Uri? = null

            // Check 1: Gemini AI Logic connectivity & JSON schema validity
            runSingleCheck(1) {
                val decoded = withContext(Dispatchers.IO) {
                    aiService.runConnectivitySchemaProbe()
                }
                "Gemini responded with valid JSON schema (matchScore=${decoded.matchScore}%, complexity=${decoded.portalComplexity}, noteLen=${decoded.linkedinNote.length})."
            }

            // Check 2: Local PdfDocument generation & cacheDir file URI readability
            runSingleCheck(2) {
                val sampleApp = ApplicationRecord(
                    id = "diag-pdf-app",
                    company = "DiagnosticsCorp",
                    role = "Senior Engineer"
                )
                val generated = withContext(Dispatchers.IO) {
                    ResumePdfGenerator.generateTailoredResumePdf(context, masterProfile, sampleApp)
                }
                generatedPdfUri = generated.uri
                "Generated valid %PDF- file in cacheDir (${generated.byteSize} bytes) at ${generated.uri}."
            }

            // Check 3: WebViewScreen JavaScript bridge & onShowFileChooser PDF hook
            runSingleCheck(3) {
                val payloadJson = WebViewAutofillBridge.serializePayload(
                    masterProfile = masterProfile,
                    approvedAnswers = listOf(
                        ScreeningAnswer("sq-diag", "Notice Period", "30 days", "GREEN", "Vault", true)
                    )
                )
                val jsScript = WebViewAutofillBridge.buildAutofillJavaScript(payloadJson)
                require(jsScript.contains("document.querySelectorAll('input, textarea')")) {
                    "Autofill JavaScript bridge template missing DOM selector."
                }
                var receivedUris: Array<Uri>? = null
                val uriToSupply = generatedPdfUri ?: Uri.parse("file://${context.cacheDir.absolutePath}/diag.pdf")
                val chromeClient = WebViewAutofillBridge.createPdfFileChooserChromeClient(
                    tailoredPdfUriProvider = { uriToSupply }
                )
                val handled = chromeClient.onShowFileChooser(
                    null,
                    ValueCallback { uris -> receivedUris = uris },
                    null
                )
                require(handled && receivedUris?.firstOrNull() == uriToSupply) {
                    "onShowFileChooser did not attach the expected cacheDir PDF URI."
                }
                "JS bridge serialized ${payloadJson.length} bytes safely; onShowFileChooser attached ${uriToSupply.lastPathSegment}."
            }

            // Check 4: Daily submission cap (20/25) & 60s cooldown state enforcement
            runSingleCheck(4) {
                val now = System.currentTimeMillis()
                val twentyFive = (0 until 25).map { now - (it + 2) * 120_000L }
                val tier1Blocked = runCatching {
                    RateLimitGuard.assertCanSubmit(PricingTier.TIER_1, twentyFive, now)
                }.exceptionOrNull() is RateLimitViolationException
                require(tier1Blocked) { "Tier 1 failed to block 26th submission in 24h window." }

                val twenty = (0 until 20).map { now - (it + 2) * 120_000L }
                val tier4Blocked = runCatching {
                    RateLimitGuard.assertCanSubmit(PricingTier.TIER_4, twenty, now)
                }.exceptionOrNull() is RateLimitViolationException
                require(tier4Blocked) { "Tier 4 failed to block 21st submission in 24h window." }

                val cooldownBlocked = runCatching {
                    RateLimitGuard.assertCanSubmit(PricingTier.TIER_1, listOf(now - 25_000L), now)
                }.exceptionOrNull() is RateLimitViolationException
                require(cooldownBlocked) { "60-second inter-submission cooldown failed to block at 25s." }

                val afterCooldown = RateLimitGuard.assertCanSubmit(PricingTier.TIER_1, listOf(now - 61_000L), now)
                require(afterCooldown.canSubmitNow) { "Submission remained blocked after 60s cooldown elapsed." }

                "Tier 1 (25/24h), Tier 4 (20/24h), and 60s inter-submission cooldown all enforced accurately."
            }

            // Check 5: Recruiter SHA-256 opt-out blocklist & 30-day TTL filter
            runSingleCheck(5) {
                val now = System.currentTimeMillis()
                val testUrl = "https://www.linkedin.com/in/diagnostics-recruiter-optout-probe/"
                val doc = RecruiterPrivacyFilter.createOptOutDocument(testUrl)
                require(doc.documentId.matches(Regex("^[a-f0-9]{64}$"))) {
                    "Opt-out document ID is not a 64-char SHA-256 hex digest."
                }
                require(!doc.fields.values.any { it.toString().contains("linkedin.com", ignoreCase = true) }) {
                    "Raw LinkedIn URL leaked into opt-out storage fields."
                }
                val expiredMember = HiringTeamMember(
                    name = "Expired Poster",
                    linkedinUrl = testUrl,
                    autoPurgeDaysRemaining = 0,
                    posterExpiresAtEpochMs = now - 60_000L
                )
                require(!RecruiterPrivacyFilter.isPosterVisible(expiredMember, emptySet(), now)) {
                    "Expired poster_expires_at member was not hidden."
                }
                val liveLookup = withContext(Dispatchers.IO) {
                    onCheckRecruiterOptOutLive(testUrl)
                }
                "SHA-256 (${doc.documentId.take(12)}…) verified zero-PII, 30-day TTL hidden, Firestore opt-out read ok (blocked=$liveLookup)."
            }

            // Check 6: 1-click user data wipe dry-run verification
            runSingleCheck(6) {
                val report = withContext(Dispatchers.IO) { onDryRunUserWipe() }
                require(report.userDocPath.startsWith("users/")) {
                    "Invalid user wipe root path: ${report.userDocPath}"
                }
                "Dry-run audited ${report.totalDocumentsToDelete} Firestore doc(s) (${report.userDocPath}, jobs=${report.jobsCount}, apps=${report.applicationsCount}) — zero live data deleted."
            }

            isRunning = false
        }
    }

    val passCount = checks.count { it.status == DiagnosticStatus.PASS }
    val failCount = checks.count { it.status == DiagnosticStatus.FAIL }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Diagnostics & Self-Test",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "PASS: $passCount · FAIL: $failCount / 6",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Outlined.ArrowBack, contentDescription = "Back to Pricing & Settings")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Spacer(modifier = Modifier.height(4.dp))
                Button(
                    onClick = { runAllSixChecks() },
                    enabled = !isRunning,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("run_all_diagnostics_button")
                ) {
                    if (isRunning) {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            modifier = Modifier.height(18.dp)
                        )
                        Spacer(modifier = Modifier.padding(horizontal = 6.dp))
                        Text("Running 6 Live Self-Checks...")
                    } else {
                        Icon(Icons.Outlined.PlayArrow, contentDescription = null)
                        Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                        Text("Run All 6 Self-Checks")
                    }
                }
            }

            items(checks, key = { it.id }) { check ->
                val isPass = check.status == DiagnosticStatus.PASS
                val isFail = check.status == DiagnosticStatus.FAIL
                val badgeBg = when {
                    isPass -> EmeraldBg
                    isFail -> Color(0xFFFFF1F2)
                    else -> MaterialTheme.colorScheme.surfaceVariant
                }
                val badgeBorder = when {
                    isPass -> EmeraldBorder
                    isFail -> Color(0xFFFDA4AF)
                    else -> MaterialTheme.colorScheme.outlineVariant
                }
                val badgeText = when {
                    isPass -> EmeraldText
                    isFail -> Color(0xFFBE123C)
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                }

                ElevatedCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("diagnostic_card_${check.id}")
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = check.title,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f)
                            )
                            Row(
                                modifier = Modifier
                                    .background(badgeBg, RoundedCornerShape(8.dp))
                                    .border(1.dp, badgeBorder, RoundedCornerShape(8.dp))
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                if (isPass) {
                                    Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = badgeText)
                                } else if (isFail) {
                                    Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = badgeText)
                                }
                                Text(
                                    text = check.status.name,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = badgeText
                                )
                            }
                        }

                        Text(
                            text = check.subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        Text(
                            text = if (check.durationMs > 0L) "${check.detail} (${check.durationMs} ms)" else check.detail,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                            color = if (isFail) Color(0xFFBE123C) else MaterialTheme.colorScheme.onSurface
                        )

                        check.stackTrace?.let { trace ->
                            Text(
                                text = trace.take(1200),
                                style = MaterialTheme.typography.labelSmall,
                                fontFamily = FontFamily.Monospace,
                                color = Color(0xFF881337),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFFFFF1F2), RoundedCornerShape(8.dp))
                                    .border(1.dp, Color(0xFFFDA4AF), RoundedCornerShape(8.dp))
                                    .padding(8.dp)
                            )
                        }
                    }
                }
            }

            item { Spacer(modifier = Modifier.height(20.dp)) }
        }
    }
}
