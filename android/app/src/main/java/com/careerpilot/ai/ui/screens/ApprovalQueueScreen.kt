package com.careerpilot.ai.ui.screens

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Preview
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.careerpilot.ai.data.compliance.RecruiterPrivacyFilter
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.GuardrailState
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.PrivacyHashUtil
import com.careerpilot.ai.data.model.ScreeningAnswer
import com.careerpilot.ai.ui.theme.AmberBg
import com.careerpilot.ai.ui.theme.AmberBorder
import com.careerpilot.ai.ui.theme.AmberText
import com.careerpilot.ai.ui.theme.EmeraldBg
import com.careerpilot.ai.ui.theme.EmeraldBorder
import com.careerpilot.ai.ui.theme.EmeraldText
import com.careerpilot.ai.ui.viewmodel.ParallelPortalSession

@Composable
fun ApprovalQueueScreen(
    applications: List<ApplicationRecord>,
    masterProfile: MasterProfile,
    blockedRecruiterHashes: Set<String>,
    warrantyAccepted: Boolean,
    guardrails: GuardrailState,
    onApproveAndLaunchWebView: (ApplicationRecord, List<ScreeningAnswer>) -> Unit,
    onLaunchParallelPortals: (List<ParallelPortalSession>) -> Unit,
    onSaveEditToVault: (String, List<ScreeningAnswer>) -> Unit,
    onSkip: (String) -> Unit
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val pending = remember(applications) {
        applications.filter { it.status == ApplicationStatus.PENDING_APPROVAL }
    }
    val editedAnswers = remember { mutableStateMapOf<String, String>() }
    val selectedParallelIds = remember { mutableStateListOf<String>() }
    var previewApp by remember { mutableStateOf<ApplicationRecord?>(null) }

    fun resolveAnswersFor(app: ApplicationRecord): List<ScreeningAnswer> =
        app.screeningQuestions.map { sq ->
            sq.copy(answer = editedAnswers["${app.id}:${sq.id}"] ?: sq.answer)
        }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Human Approval Queue",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Zero blind auto-submit. Inspect every truthful resume diff and AMBER AI draft before tapping Approve & Submit.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (pending.isEmpty()) {
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text("Approval Queue is Clear", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            "Open Discover to score jobs or use Quick Tailor Any JD.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        if (pending.size >= 2) {
            item {
                val activeSelected = pending.filter { it.id in selectedParallelIds }
                val targetList = if (activeSelected.isNotEmpty()) activeSelected else pending.take(3)
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "Parallel Multi-Portal Runner",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = "Open multiple job portals concurrently to attach your tailored resume and auto-fill details in parallel, while keeping final human submit & 60s pacing active.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Button(
                            onClick = {
                                onLaunchParallelPortals(
                                    targetList.take(4).map { app ->
                                        ParallelPortalSession(app, resolveAnswersFor(app))
                                    }
                                )
                            },
                            enabled = warrantyAccepted,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Open ${targetList.size} Portals in Parallel")
                        }
                    }
                }
            }
        }

        items(pending, key = { it.id }) { app ->
            val nowMs = remember(app.id) { System.currentTimeMillis() }
            val isPosterExpired = remember(app.hiringTeam, nowMs) {
                RecruiterPrivacyFilter.isPosterExpired(app.hiringTeam, nowMs)
            }
            val isRecruiterBlocked = remember(app.hiringTeam, blockedRecruiterHashes) {
                RecruiterPrivacyFilter.isPosterOptedOut(app.hiringTeam, blockedRecruiterHashes)
            }
            val isPosterVisible = remember(app.hiringTeam, blockedRecruiterHashes, nowMs) {
                RecruiterPrivacyFilter.isPosterVisible(app.hiringTeam, blockedRecruiterHashes, nowMs)
            }
            val orderedQuestions = remember(app.screeningQuestions) {
                app.screeningQuestions.filter { it.confidence == "AMBER" } +
                    app.screeningQuestions.filter { it.confidence != "AMBER" }
            }

            fun resolveCurrentAnswers(): List<ScreeningAnswer> =
                orderedQuestions.map { sq ->
                    sq.copy(answer = editedAnswers["${app.id}:${sq.id}"] ?: sq.answer)
                }

            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Header with Parallel Runner Checkbox
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top
                    ) {
                        Checkbox(
                            checked = app.id in selectedParallelIds,
                            onCheckedChange = { checked ->
                                if (checked && selectedParallelIds.size < 4) {
                                    selectedParallelIds.add(app.id)
                                } else if (!checked) {
                                    selectedParallelIds.remove(app.id)
                                }
                            }
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${app.company} · ${app.portalType} · ${app.portalComplexity}",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = app.role,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "${app.location} · ${app.salary}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Text(
                            text = "${app.matchScore}%",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }

                    HorizontalDivider()

                    // Hiring Team / Job Poster Section (Hidden on 30-day TTL expiry or SHA-256 Opt-Out)
                    if (isPosterVisible) {
                        Column(
                            modifier = Modifier.testTag("poster_card_${app.id}"),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Hiring Team / Job Poster",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold
                                )
                                AssistChip(
                                    onClick = {},
                                    label = { Text("30-Day Auto-Purge (${app.hiringTeam.autoPurgeDaysRemaining}d)") }
                                )
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(app.hiringTeam.name, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        app.hiringTeam.title,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                OutlinedButton(
                                    onClick = {
                                        if (PrivacyHashUtil.isSafeExternalUrl(app.hiringTeam.linkedinUrl)) {
                                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(app.hiringTeam.linkedinUrl))
                                            context.startActivity(intent)
                                        }
                                    },
                                    modifier = Modifier.testTag("view_linkedin_${app.id}")
                                ) {
                                    Text("View on LinkedIn")
                                    Spacer(modifier = Modifier.padding(horizontal = 2.dp))
                                    Icon(Icons.Outlined.OpenInNew, contentDescription = null)
                                }
                            }

                            Text(
                                text = "Outreach Note (${app.linkedinNote.length}/280 chars): ${app.linkedinNote}",
                                style = MaterialTheme.typography.bodySmall
                            )
                            OutlinedButton(
                                onClick = { clipboard.setText(AnnotatedString(app.linkedinNote)) }
                            ) {
                                Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                                Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                                Text("Copy Note")
                            }
                        }
                    } else if (isRecruiterBlocked || isPosterExpired) {
                        Text(
                            text = if (isRecruiterBlocked) {
                                "Recruiter profile suppressed via public SHA-256 Privacy Opt-Out."
                            } else {
                                "Hiring team link automatically purged (30-day TTL expired)."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = EmeraldText,
                            modifier = Modifier.testTag("poster_suppressed_${app.id}")
                        )
                    }

                    HorizontalDivider()

                    // Transparent Resume Diff Preview
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Resume Diff (${app.resumeDiffs.size} truthful edits)",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.SemiBold
                            )
                            TextButton(onClick = { previewApp = app }) {
                                Icon(Icons.Outlined.Preview, contentDescription = null)
                                Spacer(modifier = Modifier.padding(horizontal = 2.dp))
                                Text("Preview Resume")
                            }
                        }

                        app.resumeDiffs.forEachIndexed { idx, diff ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                                    .padding(10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(
                                    text = "${idx + 1}. ${diff.experienceRef}",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "Before: ${diff.before}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = "After: ${diff.after}",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }

                    HorizontalDivider()

                    // Confidence-Scored Q&A List (AMBER pinned above GREEN)
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            text = "Confidence-Scored Screening Q&A",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold
                        )

                        orderedQuestions.forEach { sq ->
                            val isAmber = sq.confidence == "AMBER"
                            val key = "${app.id}:${sq.id}"
                            val currentVal = editedAnswers[key] ?: sq.answer

                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(
                                        if (isAmber) AmberBg else EmeraldBg,
                                        RoundedCornerShape(12.dp)
                                    )
                                    .border(
                                        1.dp,
                                        if (isAmber) AmberBorder else EmeraldBorder,
                                        RoundedCornerShape(12.dp)
                                    )
                                    .padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(
                                    text = if (isAmber) "AMBER · Mandatory Review (AI Draft)" else "GREEN · Deterministic Q&A Vault",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isAmber) AmberText else EmeraldText
                                )
                                Text(
                                    text = sq.question,
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.SemiBold
                                )
                                OutlinedTextField(
                                    value = currentVal,
                                    onValueChange = { editedAnswers[key] = it },
                                    minLines = if (isAmber) 2 else 1,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                    }

                    // Action Buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = { onSaveEditToVault(app.id, resolveCurrentAnswers()) },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Outlined.Save, contentDescription = null)
                            Spacer(modifier = Modifier.padding(horizontal = 2.dp))
                            Text("Save to Vault")
                        }
                        OutlinedButton(onClick = { onSkip(app.id) }) {
                            Icon(Icons.Outlined.SkipNext, contentDescription = null)
                            Text("Skip")
                        }
                    }

                    Button(
                        onClick = { onApproveAndLaunchWebView(app, resolveCurrentAnswers()) },
                        enabled = warrantyAccepted && guardrails.canSubmitNow,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Outlined.Send, contentDescription = null)
                        Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                        Text(
                            when {
                                !warrantyAccepted -> "Accept Warranty in Profile First"
                                guardrails.remainingToday <= 0 -> "Daily Cap Reached (${guardrails.dailyCap}/24h)"
                                guardrails.cooldownSecondsRemaining > 0 -> "Cooldown (${guardrails.cooldownSecondsRemaining}s)"
                                else -> "Approve & Submit"
                            }
                        )
                    }
                }
            }
        }

        item { Spacer(modifier = Modifier.height(24.dp)) }
    }

    // Tailored Resume Preview Dialog
    previewApp?.let { app ->
        val diffLookup = app.resumeDiffs.associate { it.before.trim() to it.after.trim() }
        AlertDialog(
            onDismissRequest = { previewApp = null },
            title = { Text("Tailored Resume · ${app.company}") },
            text = {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        Text(masterProfile.fullName, fontWeight = FontWeight.Bold)
                        Text(masterProfile.headline, style = MaterialTheme.typography.bodySmall)
                        HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                        Text("SKILLS: ${masterProfile.skills.joinToString(" · ")}", style = MaterialTheme.typography.bodySmall)
                    }
                    items(masterProfile.experience) { exp ->
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("${exp.title} — ${exp.company}", fontWeight = FontWeight.SemiBold)
                            exp.bullets.forEach { bullet ->
                                val tailored = diffLookup[bullet.trim()]
                                Text(
                                    text = "• ${tailored ?: bullet}",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = if (tailored != null) FontWeight.Bold else FontWeight.Normal,
                                    color = if (tailored != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { previewApp = null }) { Text("Close") }
            }
        )
    }
}
