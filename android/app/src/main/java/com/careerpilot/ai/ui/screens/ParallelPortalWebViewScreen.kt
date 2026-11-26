package com.careerpilot.ai.ui.screens

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.GuardrailState
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.data.model.QAVault
import com.careerpilot.ai.data.model.ScreeningAnswer
import com.careerpilot.ai.ui.viewmodel.ParallelPortalSession
import org.json.JSONArray
import org.json.JSONObject

private enum class PortalRunState {
    LOADING,
    AUTO_FILLED,
    SUBMITTED,
    PAUSED
}

/**
 * Parallel Multi-Portal WebView Execution Workspace.
 * Keeps all selected job portals mounted concurrently so each WebView loads in parallel,
 * automatically attaches the Truthfulness-Lock tailored resume via DataTransfer onto file inputs,
 * and autofills verified Master Profile & Q&A Vault details via safely JSON-serialized JavaScript.
 * Human confirmation per portal and 60-second anti-spam pacing remain strictly enforced.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ParallelPortalWebViewScreen(
    sessions: List<ParallelPortalSession>,
    masterProfile: MasterProfile,
    qaVault: QAVault,
    guardrails: GuardrailState,
    onConfirmPortalSubmission: (
        appId: String,
        answers: List<ScreeningAnswer>,
        outcome: ApplicationStatus,
        actionReason: String
    ) -> Unit,
    onDismiss: () -> Unit
) {
    if (sessions.isEmpty()) return

    var selectedIndex by remember { mutableIntStateOf(0) }
    val safeIndex = selectedIndex.coerceIn(0, sessions.lastIndex)
    val activeSession = sessions[safeIndex]

    val portalStates = remember(sessions) {
        mutableStateMapOf<String, PortalRunState>().apply {
            sessions.forEach { put(it.application.id, PortalRunState.LOADING) }
        }
    }
    val injectionLogs = remember(sessions) {
        mutableStateMapOf<String, String>().apply {
            sessions.forEach {
                put(it.application.id, "Loading ${it.application.portalType} portal in parallel...")
            }
        }
    }
    val captchaToggleByApp = remember(sessions) {
        mutableStateMapOf<String, Boolean>().apply {
            sessions.forEach {
                put(it.application.id, it.application.portalComplexity == "Multi-Step")
            }
        }
    }
    val captchaDoneByApp = remember(sessions) {
        mutableStateMapOf<String, Boolean>().apply {
            sessions.forEach { put(it.application.id, false) }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Parallel Portals (${sessions.size} Active)",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Cap ${guardrails.usedLast24h}/${guardrails.dailyCap} · " +
                                if (guardrails.cooldownSecondsRemaining > 0)
                                    "${guardrails.cooldownSecondsRemaining}s pacing"
                                else "Ready to submit",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = "Close parallel portals")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Parallel Portal Switcher Tabs showing live background progress per portal
            ScrollableTabRow(selectedTabIndex = safeIndex, edgePadding = 12.dp) {
                sessions.forEachIndexed { idx, session ->
                    val app = session.application
                    val runState = portalStates[app.id] ?: PortalRunState.LOADING
                    val statusTag = when (runState) {
                        PortalRunState.LOADING -> "Filling..."
                        PortalRunState.AUTO_FILLED -> "Filled"
                        PortalRunState.SUBMITTED -> "Submitted"
                        PortalRunState.PAUSED -> "Paused"
                    }
                    Tab(
                        selected = idx == safeIndex,
                        onClick = { selectedIndex = idx },
                        text = {
                            Text(
                                text = "${app.company} · $statusTag",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = if (idx == safeIndex) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                val activeApp = activeSession.application
                val activeRunState = portalStates[activeApp.id] ?: PortalRunState.LOADING
                val activeCaptcha = captchaToggleByApp[activeApp.id] == true
                val activeCaptchaDone = captchaDoneByApp[activeApp.id] == true

                // Per-Portal Autofill Telemetry & CAPTCHA Handoff Controls
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "${activeApp.company} — ${activeApp.role}",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1
                                )
                                Text(
                                    text = injectionLogs[activeApp.id].orEmpty(),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            AssistChip(
                                onClick = {},
                                label = { Text(activeApp.portalType) }
                            )
                        }

                        if (activeRunState != PortalRunState.SUBMITTED && activeRunState != PortalRunState.PAUSED) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Simulate CAPTCHA / OTP Handoff",
                                    style = MaterialTheme.typography.labelMedium,
                                    modifier = Modifier.weight(1f)
                                )
                                Switch(
                                    checked = activeCaptcha,
                                    onCheckedChange = {
                                        captchaToggleByApp[activeApp.id] = it
                                        captchaDoneByApp[activeApp.id] = false
                                    }
                                )
                            }

                            if (activeCaptcha) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(
                                        checked = activeCaptchaDone,
                                        onCheckedChange = { captchaDoneByApp[activeApp.id] = it }
                                    )
                                    Text(
                                        text = "I have manually completed the CAPTCHA / OTP gate.",
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                            }
                        }
                    }
                }

                // Concurrent WebView Stack: All selected portals stay alive and execute in parallel
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                ) {
                    sessions.forEachIndexed { idx, session ->
                        val app = session.application
                        val isVisible = idx == safeIndex
                        val safeUrl = remember(app.jobUrl) {
                            if (PrivacyHashUtil.isSafeExternalUrl(app.jobUrl)) app.jobUrl else "about:blank"
                        }
                        val payloadJson = remember(app.id, masterProfile, qaVault, session.approvedAnswers) {
                            buildParallelAutofillPayload(app, masterProfile, qaVault, session.approvedAnswers)
                        }

                        AndroidView(
                            modifier = Modifier
                                .fillMaxSize()
                                .zIndex(if (isVisible) 1f else 0f)
                                .alpha(if (isVisible) 1f else 0f),
                            factory = { ctx ->
                                WebView(ctx).apply {
                                    settings.javaScriptEnabled = true
                                    settings.domStorageEnabled = true
                                    settings.allowFileAccess = false
                                    settings.allowContentAccess = false
                                    webViewClient = object : WebViewClient() {
                                        override fun shouldOverrideUrlLoading(
                                            view: WebView?,
                                            request: WebResourceRequest?
                                        ): Boolean {
                                            val target = request?.url?.toString().orEmpty()
                                            return !PrivacyHashUtil.isSafeExternalUrl(target)
                                        }

                                        override fun onPageFinished(view: WebView?, url: String?) {
                                            super.onPageFinished(view, url)
                                            val script = buildParallelAutofillJs(payloadJson)
                                            view?.evaluateJavascript(script) { resultRaw ->
                                                if (portalStates[app.id] == PortalRunState.LOADING) {
                                                    portalStates[app.id] = PortalRunState.AUTO_FILLED
                                                }
                                                injectionLogs[app.id] =
                                                    "Parallel fill complete (${resultRaw ?: "ready"}). Tailored resume attached & Vault details injected."
                                            }
                                        }
                                    }
                                    loadUrl(safeUrl)
                                }
                            }
                        )
                    }
                }

                // Per-Portal Human Final Confirmation Controls
                when (activeRunState) {
                    PortalRunState.SUBMITTED -> {
                        Text(
                            text = "Submitted ${activeApp.company} with user_approved_at audit log. Switch tabs above to finalize remaining portals.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    PortalRunState.PAUSED -> {
                        Text(
                            text = "Paused ${activeApp.company} under Action Required in Tracker.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary
                        )
                    }
                    else -> {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            if (activeCaptcha) {
                                OutlinedButton(
                                    onClick = {
                                        portalStates[activeApp.id] = PortalRunState.PAUSED
                                        onConfirmPortalSubmission(
                                            activeApp.id,
                                            activeSession.approvedAnswers,
                                            ApplicationStatus.ACTION_REQUIRED,
                                            "Paused at ${activeApp.portalType} CAPTCHA / OTP challenge during parallel portal run."
                                        )
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("Pause (CAPTCHA)")
                                }
                            }

                            val canSubmit = guardrails.canSubmitNow && (!activeCaptcha || activeCaptchaDone)
                            Button(
                                onClick = {
                                    portalStates[activeApp.id] = PortalRunState.SUBMITTED
                                    onConfirmPortalSubmission(
                                        activeApp.id,
                                        activeSession.approvedAnswers,
                                        ApplicationStatus.SUBMITTED,
                                        ""
                                    )
                                },
                                enabled = canSubmit,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    when {
                                        guardrails.remainingToday <= 0 -> "Daily Cap Reached"
                                        guardrails.cooldownSecondsRemaining > 0 -> "Pre-Filled · ${guardrails.cooldownSecondsRemaining}s"
                                        activeCaptcha && !activeCaptchaDone -> "Verify CAPTCHA First"
                                        else -> "Confirm & Submit"
                                    }
                                )
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(4.dp))
            }
        }
    }
}

private fun buildTailoredResumePlainText(profile: MasterProfile, app: ApplicationRecord): String {
    val diffLookup = app.resumeDiffs.associate { it.before.trim() to it.after.trim() }
    val sb = StringBuilder()
    sb.appendLine("${profile.fullName} — Tailored Resume for ${app.company} (${app.role})")
    sb.appendLine("${profile.headline} | ${profile.location} | ${profile.email} | ${profile.phone}")
    sb.appendLine()
    if (profile.summary.isNotBlank()) {
        sb.appendLine("SUMMARY")
        sb.appendLine(profile.summary)
        sb.appendLine()
    }
    if (profile.skills.isNotEmpty()) {
        sb.appendLine("SKILLS")
        sb.appendLine(profile.skills.joinToString(", "))
        sb.appendLine()
    }
    sb.appendLine("EXPERIENCE")
    profile.experience.forEach { exp ->
        sb.appendLine("${exp.title} — ${exp.company} (${exp.startDate} - ${exp.endDate})")
        exp.bullets.forEach { bullet ->
            sb.appendLine("  • ${diffLookup[bullet.trim()] ?: bullet}")
        }
        sb.appendLine()
    }
    return sb.toString()
}

private fun buildParallelAutofillPayload(
    app: ApplicationRecord,
    profile: MasterProfile,
    vault: QAVault,
    answers: List<ScreeningAnswer>
): String {
    val safeName = profile.fullName.replace(Regex("[^a-zA-Z0-9]+"), "_").trim('_').ifBlank { "Candidate" }
    val safeCompany = app.company.replace(Regex("[^a-zA-Z0-9]+"), "_").trim('_').ifBlank { "Role" }
    val root = JSONObject()
    root.put("fullName", profile.fullName)
    root.put("email", profile.email)
    root.put("phone", profile.phone)
    root.put("location", profile.location)
    root.put("linkedinUrl", vault.linkedinUrl)
    root.put("currentCtc", vault.currentCtc)
    root.put("expectedCtc", vault.expectedCtc)
    root.put("noticePeriodDays", vault.noticePeriodDays)
    root.put("resumeFileName", "${safeName}_${safeCompany}_Tailored_Resume.txt")
    root.put("tailoredResumeText", buildTailoredResumePlainText(profile, app))
    val answersArr = JSONArray()
    answers.forEach { sq ->
        answersArr.put(
            JSONObject()
                .put("question", sq.question)
                .put("answer", sq.answer)
        )
    }
    root.put("answers", answersArr)
    return root.toString()
}

private fun buildParallelAutofillJs(safePayloadJson: String): String = """
    (function(payload) {
      var filled = 0;
      var uploaded = 0;
      function setVal(el, val) {
        if (!val || el.value) return;
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
      var fileInputs = document.querySelectorAll('input[type="file"]');
      fileInputs.forEach(function(input) {
        try {
          if (typeof DataTransfer !== 'undefined' && payload.tailoredResumeText) {
            var dt = new DataTransfer();
            var file = new File([payload.tailoredResumeText], payload.resumeFileName, { type: 'text/plain' });
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            uploaded++;
          }
        } catch (e) {}
      });
      var inputs = document.querySelectorAll('input:not([type="file"]):not([type="hidden"]), textarea');
      inputs.forEach(function(el) {
        var key = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
        if (key.includes('linkedin')) setVal(el, payload.linkedinUrl);
        else if (key.includes('email')) setVal(el, payload.email);
        else if (key.includes('phone') || key.includes('mobile')) setVal(el, payload.phone);
        else if (key.includes('location') || key.includes('city')) setVal(el, payload.location);
        else if (key.includes('notice')) setVal(el, payload.noticePeriodDays);
        else if (key.includes('expected') && (key.includes('ctc') || key.includes('salary') || key.includes('comp'))) setVal(el, payload.expectedCtc);
        else if (key.includes('current') && (key.includes('ctc') || key.includes('salary'))) setVal(el, payload.currentCtc);
        else if (key.includes('name')) setVal(el, payload.fullName);
      });
      return uploaded + ' resume uploaded, ' + filled + ' fields filled';
    })($safePayloadJson);
""".trimIndent()
