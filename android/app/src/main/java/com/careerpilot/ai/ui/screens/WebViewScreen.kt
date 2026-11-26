package com.careerpilot.ai.ui.screens

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.data.model.ScreeningAnswer
import com.careerpilot.ai.data.pdf.ResumePdfGenerator
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reusable WebView JavaScript autofill bridge & WebChromeClient onShowFileChooser tailored PDF hook.
 */
object WebViewAutofillBridge {
    fun serializePayload(masterProfile: MasterProfile, approvedAnswers: List<ScreeningAnswer>): String {
        val root = JSONObject()
        root.put("fullName", masterProfile.fullName)
        root.put("email", masterProfile.email)
        root.put("phone", masterProfile.phone)
        val answersArr = JSONArray()
        approvedAnswers.forEach { sq ->
            answersArr.put(
                JSONObject()
                    .put("question", sq.question)
                    .put("answer", sq.answer)
            )
        }
        root.put("answers", answersArr)
        return root.toString()
    }

    fun buildAutofillJavaScript(safePayloadJson: String): String = """
        (function(payload) {
          var filled = 0;
          var inputs = document.querySelectorAll('input, textarea');
          inputs.forEach(function(el) {
            var key = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')).toLowerCase();
            if (key.includes('name') && payload.fullName && !el.value) { el.value = payload.fullName; filled++; }
            else if (key.includes('email') && payload.email && !el.value) { el.value = payload.email; filled++; }
            else if (key.includes('phone') && payload.phone && !el.value) { el.value = payload.phone; filled++; }
          });
          return filled;
        })($safePayloadJson);
    """.trimIndent()

    fun createPdfFileChooserChromeClient(
        tailoredPdfUriProvider: () -> Uri?,
        onPdfAttached: (Uri) -> Unit = {}
    ): WebChromeClient = object : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?
        ): Boolean {
            val uri = tailoredPdfUriProvider()
            return if (uri != null && filePathCallback != null) {
                filePathCallback.onReceiveValue(arrayOf(uri))
                onPdfAttached(uri)
                true
            } else {
                filePathCallback?.onReceiveValue(null)
                false
            }
        }
    }
}

/**
 * In-app Android WebView Execution Sheet.
 * Loads the application URL, injects user-approved Master Profile & Q&A Vault values via safely JSON-serialized
 * JavaScript, hooks WebChromeClient.onShowFileChooser to attach the local PdfDocument from cacheDir,
 * and provides a Simulate CAPTCHA/OTP Handoff toggle for human intervention.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewScreen(
    application: ApplicationRecord,
    masterProfile: MasterProfile,
    approvedAnswers: List<ScreeningAnswer>,
    onConfirmSubmission: (outcome: ApplicationStatus, actionReason: String) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var simulateCaptchaHandoff by remember { mutableStateOf(application.portalComplexity == "Multi-Step") }
    var humanCompletedSecurityCheck by remember { mutableStateOf(false) }
    var jsInjectionLog by remember { mutableStateOf("Ready to inject verified answers & PDF hook on page load...") }

    val tailoredPdfUri = remember(application.id, masterProfile) {
        runCatching {
            ResumePdfGenerator.generateTailoredResumePdf(context, masterProfile, application).uri
        }.getOrNull()
    }

    val safePayloadJson = remember(masterProfile, approvedAnswers) {
        WebViewAutofillBridge.serializePayload(masterProfile, approvedAnswers)
    }

    val safeUrl = remember(application.jobUrl) {
        if (PrivacyHashUtil.isSafeExternalUrl(application.jobUrl)) application.jobUrl else "about:blank"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "${application.company} · ${application.portalType}",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = safeUrl,
                            style = MaterialTheme.typography.labelSmall,
                            maxLines = 1
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = "Close WebView sheet")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Controls Card: CAPTCHA / OTP Manual Handoff Toggle
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Simulate CAPTCHA / OTP Handoff",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "Pauses automated form fill whenever an ATS requires human security verification.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = simulateCaptchaHandoff,
                            onCheckedChange = {
                                simulateCaptchaHandoff = it
                                humanCompletedSecurityCheck = false
                            }
                        )
                    }

                    Text(
                        text = jsInjectionLog,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )

                    if (simulateCaptchaHandoff) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = humanCompletedSecurityCheck,
                                onCheckedChange = { humanCompletedSecurityCheck = it }
                            )
                            Text(
                                text = "I have manually completed the ATS CAPTCHA / OTP challenge.",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }

            // Live Android WebView loading the ATS application URL
            AndroidView(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        webChromeClient = WebViewAutofillBridge.createPdfFileChooserChromeClient(
                            tailoredPdfUriProvider = { tailoredPdfUri },
                            onPdfAttached = { uri ->
                                jsInjectionLog = "Attached tailored PDF via onShowFileChooser: ${uri.lastPathSegment}"
                            }
                        )
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
                                val safeJs = WebViewAutofillBridge.buildAutofillJavaScript(safePayloadJson)
                                view?.evaluateJavascript(safeJs) { filledCount ->
                                    jsInjectionLog = "Autofilled $filledCount detected field(s) with verified Vault data. Review and confirm below."
                                }
                            }
                        }
                        loadUrl(safeUrl)
                    }
                }
            )

            // Bottom Human Confirmation Controls
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (simulateCaptchaHandoff) {
                    OutlinedButton(
                        onClick = {
                            onConfirmSubmission(
                                ApplicationStatus.ACTION_REQUIRED,
                                "Paused at ${application.portalType} CAPTCHA / OTP challenge — awaiting manual completion."
                            )
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Pause (Action Required)")
                    }
                }
                Button(
                    onClick = {
                        onConfirmSubmission(ApplicationStatus.SUBMITTED, "")
                    },
                    enabled = !simulateCaptchaHandoff || humanCompletedSecurityCheck,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Confirm Submission")
                }
            }
            Spacer(modifier = Modifier.height(4.dp))
        }
    }
}
