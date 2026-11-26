package com.careerpilot.ai.ui.screens

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
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.ApplicationStatus
import com.careerpilot.ai.data.model.GuardrailState
import com.careerpilot.ai.ui.theme.AmberText
import com.careerpilot.ai.ui.theme.EmeraldText
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun TrackerScreen(
    applications: List<ApplicationRecord>,
    guardrails: GuardrailState,
    onResumeActionRequired: (String) -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf(
        "Submitted" to ApplicationStatus.SUBMITTED,
        "Action Required" to ApplicationStatus.ACTION_REQUIRED,
        "Skipped" to ApplicationStatus.SKIPPED
    )
    val formatter = remember { SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault()) }

    val activeStatus = tabs[selectedTab].second
    val filtered = remember(applications, activeStatus) {
        applications.filter { it.status == activeStatus }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Text(
                text = "Applied Tracker & Audit Log",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Audit receipts with user_approved_at timestamps and ATS match scores.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        PrimaryTabRow(selectedTabIndex = selectedTab) {
            tabs.forEachIndexed { idx, (label, status) ->
                val count = applications.count { it.status == status }
                Tab(
                    selected = selectedTab == idx,
                    onClick = { selectedTab = idx },
                    text = { Text("$label ($count)") }
                )
            }
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (filtered.isEmpty()) {
                item {
                    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(20.dp)) {
                            Text(
                                text = "No ${tabs[selectedTab].first.lowercase()} applications yet.",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "Human-approved applications from the Queue will appear here with audit proof.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            items(filtered, key = { it.id }) { app ->
                val displayTime = formatter.format(Date(app.userApprovedAtEpochMs ?: app.updatedAtEpochMs))
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = app.auditReceiptId.ifBlank { "AUDIT-LOGGED" },
                                style = MaterialTheme.typography.labelSmall,
                                color = when (app.status) {
                                    ApplicationStatus.SUBMITTED -> EmeraldText
                                    ApplicationStatus.ACTION_REQUIRED -> AmberText
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                },
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "${app.matchScore}% Match",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }

                        Text(
                            text = "${app.company} — ${app.role}",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "${app.location} · ${app.salary} · ${app.portalType}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = "Recorded: $displayTime · ${app.resumeDiffs.size} tailored bullets",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        if (app.actionReason.isNotBlank()) {
                            Text(
                                text = app.actionReason,
                                style = MaterialTheme.typography.bodySmall,
                                color = AmberText
                            )
                        }

                        if (app.status == ApplicationStatus.ACTION_REQUIRED) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Button(
                                onClick = { onResumeActionRequired(app.id) },
                                enabled = guardrails.canSubmitNow,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    if (guardrails.cooldownSecondsRemaining > 0)
                                        "Cooldown (${guardrails.cooldownSecondsRemaining}s)"
                                    else "Confirm Manual CAPTCHA/OTP Completed"
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
