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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.careerpilot.ai.R
import com.careerpilot.ai.data.compliance.PppGeoLockEvaluator
import com.careerpilot.ai.data.model.PricingTier
import com.careerpilot.ai.ui.theme.EmeraldText

@Composable
fun PricingSettingsScreen(
    selectedTier: PricingTier,
    onSelectTier: (PricingTier) -> Unit,
    onSubmitRecruiterOptOut: (String) -> Unit,
    onDeleteAccountAndAllData: () -> Unit,
    onSignOut: () -> Unit,
    onOpenDiagnostics: () -> Unit = {}
) {
    var simulateMismatchedCardBin by remember { mutableStateOf(true) }
    var showOptOutDialog by remember { mutableStateOf(false) }
    var optOutUrlInput by remember { mutableStateOf("") }
    var showDeleteConfirmDialog by remember { mutableStateOf(false) }

    val pppDecision = remember(selectedTier, simulateMismatchedCardBin) {
        PppGeoLockEvaluator.evaluateCheckout(
            selectedTier = selectedTier,
            ipCountryCode = selectedTier.expectedCountryCode,
            cardBinCountryCode = if (simulateMismatchedCardBin && selectedTier != PricingTier.TIER_1) "US" else selectedTier.expectedCountryCode,
            ipVsCardBinMismatchToggle = simulateMismatchedCardBin
        )
    }
    val pppCheckBlocked = pppDecision.discountBlocked

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "India PPP Pricing & Settings",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = onOpenDiagnostics,
                    modifier = Modifier.testTag("open_diagnostics_button")
                ) {
                    Icon(
                        imageVector = Icons.Outlined.BugReport,
                        contentDescription = "Open Diagnostics & Self-Test"
                    )
                }
            }
            Text(
                text = "Currently focused on India (INR PPP pricing) with anti-spam daily caps and IP/Card BIN geo-integrity verification.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // Other regions commented out — focusing on India first
        // items(PricingTier.entries) { tier ->
        items(listOf(PricingTier.TIER_4)) { tier ->
            val isSelected = tier == selectedTier
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(tier.title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = tier.multiplier,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    Text(tier.regions, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = "${tier.weeklyPrice}  |  ${tier.monthlyPrice}",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "${tier.credits} AI tailoring credits · ${tier.dailyCap}/day anti-spam cap · 60s cooldown",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    if (isSelected) {
                        Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
                            Text("Active Tier")
                        }
                    } else {
                        OutlinedButton(
                            onClick = { onSelectTier(tier) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Switch to ${tier.title}")
                        }
                    }
                }
            }
        }

        // Simulated IP vs. Card BIN Country Check
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Simulate IP vs. Card BIN Country Check",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "Toggle ON to simulate a US Card BIN attempting Tier 4 India pricing (₹299/wk | ₹749/mo).",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = simulateMismatchedCardBin,
                            onCheckedChange = { simulateMismatchedCardBin = it },
                            modifier = Modifier.testTag("ppp_mismatch_switch")
                        )
                    }

                    Text(
                        text = pppDecision.reason,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                        color = if (pppCheckBlocked) MaterialTheme.colorScheme.error else EmeraldText,
                        modifier = Modifier.testTag("ppp_decision_text")
                    )
                }
            }
        }

        // Recruiter Opt-Out Portal & Account Deletion
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "Privacy & Compliance Controls",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    OutlinedButton(
                        onClick = { showOptOutDialog = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Open Recruiter Opt-Out Portal (SHA-256)")
                    }
                    OutlinedButton(
                        onClick = onSignOut,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Sign Out")
                    }
                    HorizontalDivider()
                    Button(
                        onClick = { showDeleteConfirmDialog = true },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Delete Account & All Data")
                    }
                }
            }
        }

        // Persistent Compliance Disclaimer Footer
        item {
            Text(
                text = stringResource(id = R.string.compliance_disclaimer),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 12.dp)
            )
            Spacer(modifier = Modifier.height(16.dp))
        }
    }

    // Recruiter Opt-Out Portal Dialog (SHA-256)
    if (showOptOutDialog) {
        AlertDialog(
            onDismissRequest = { showOptOutDialog = false },
            title = { Text("Public Recruiter Opt-Out Portal") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Enter a recruiter LinkedIn URL. CareerPilot AI computes a one-way SHA-256 hash and permanently suppresses matching Hiring Team cards without storing raw PII.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedTextField(
                        value = optOutUrlInput,
                        onValueChange = { optOutUrlInput = it },
                        label = { Text("https://www.linkedin.com/in/...") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onSubmitRecruiterOptOut(optOutUrlInput)
                        optOutUrlInput = ""
                        showOptOutDialog = false
                    },
                    enabled = optOutUrlInput.contains("linkedin.com", ignoreCase = true)
                ) {
                    Text("Hash & Block")
                }
            },
            dismissButton = {
                TextButton(onClick = { showOptOutDialog = false }) { Text("Cancel") }
            }
        )
    }

    // Delete Account Confirmation Dialog
    if (showDeleteConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmDialog = false },
            title = { Text("Delete Account & All Data?") },
            text = {
                Text("This permanently deletes your Master Profile, Q&A Vault, Jobs, Approval Queue, and Tracker records from Cloud Firestore.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        onDeleteAccountAndAllData()
                        showDeleteConfirmDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Wipe All Firestore Data")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirmDialog = false }) { Text("Cancel") }
            }
        )
    }
}
