package com.careerpilot.ai.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.careerpilot.ai.data.model.MasterProfile
import com.careerpilot.ai.data.model.QAVault
import com.careerpilot.ai.data.repository.UserWorkspaceSnapshot

@Composable
fun ProfileScreen(
    workspace: UserWorkspaceSnapshot,
    onParseResume: (resumeText: String?, pdfBytes: ByteArray?) -> Unit,
    onSaveProfile: (MasterProfile, QAVault, Boolean) -> Unit
) {
    val context = LocalContext.current
    var profile by remember { mutableStateOf(workspace.profile) }
    var vault by remember { mutableStateOf(workspace.qaVault) }
    var warrantyAccepted by remember { mutableStateOf(workspace.warrantyAccepted) }
    var pastedResume by remember { mutableStateOf("") }
    var selectedPdfName by remember { mutableStateOf<String?>(null) }
    var selectedPdfBytes by remember { mutableStateOf<ByteArray?>(null) }

    LaunchedEffect(workspace) {
        profile = workspace.profile
        vault = workspace.qaVault
        warrantyAccepted = workspace.warrantyAccepted
    }

    val pdfPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            selectedPdfName = uri.lastPathSegment ?: "resume.pdf"
            selectedPdfBytes = context.contentResolver.openInputStream(uri)?.use { stream ->
                stream.readBytes()
            }
        }
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
                text = "Master Profile & Q&A Vault",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Truthfulness Lock: Gemini strictly uses facts parsed from your resume and Q&A Vault—never inventing employers, titles, dates, degrees, or skills.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // 1. Resume PDF Upload & Gemini Parser
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "1. Base Resume Parser (PDF or Text)",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = { pdfPicker.launch("application/pdf") },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Outlined.UploadFile, contentDescription = null)
                            Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                            Text(selectedPdfName ?: "Pick PDF Resume")
                        }
                    }

                    OutlinedTextField(
                        value = pastedResume,
                        onValueChange = { pastedResume = it },
                        label = { Text("Or paste plain-text resume") },
                        minLines = 4,
                        maxLines = 8,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Button(
                        onClick = {
                            onParseResume(
                                pastedResume.takeIf { it.isNotBlank() },
                                selectedPdfBytes
                            )
                        },
                        enabled = pastedResume.isNotBlank() || selectedPdfBytes != null,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Outlined.AutoAwesome, contentDescription = null)
                        Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                        Text("Parse Resume with Gemini")
                    }
                }
            }
        }

        // 2. Parsed Master Profile Summary
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "2. Verified Master Profile",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    OutlinedTextField(
                        value = profile.fullName,
                        onValueChange = { profile = profile.copy(fullName = it) },
                        label = { Text("Full Name") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = profile.headline,
                        onValueChange = { profile = profile.copy(headline = it) },
                        label = { Text("Headline") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = profile.location,
                        onValueChange = { profile = profile.copy(location = it) },
                        label = { Text("Location") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = profile.skills.joinToString(", "),
                        onValueChange = { raw ->
                            profile = profile.copy(
                                skills = raw.split(",").map { it.trim() }.filter { it.isNotBlank() }
                            )
                        },
                        label = { Text("Verified Skills (comma-separated)") },
                        modifier = Modifier.fillMaxWidth()
                    )

                    if (profile.experience.isNotEmpty()) {
                        HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                        Text(
                            text = "Experience (${profile.experience.size} roles)",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                        profile.experience.forEach { exp ->
                            Text(
                                text = "${exp.title} · ${exp.company} (${exp.startDate} – ${exp.endDate})",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }

                    if (profile.education.isNotEmpty()) {
                        HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                        Text(
                            text = "Education (${profile.education.size})",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                        profile.education.forEach { edu ->
                            Text(
                                text = "${edu.institution} — ${edu.degree} (${edu.graduationYear})",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }

        // 3. Screening Q&A Vault
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "3. Screening Q&A Vault (GREEN Facts)",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    OutlinedTextField(
                        value = vault.currentCtc,
                        onValueChange = { vault = vault.copy(currentCtc = it) },
                        label = { Text("Current CTC (INR / USD)") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = vault.expectedCtc,
                        onValueChange = { vault = vault.copy(expectedCtc = it) },
                        label = { Text("Expected CTC (INR / USD)") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = vault.noticePeriodDays,
                        onValueChange = { vault = vault.copy(noticePeriodDays = it.filter { ch -> ch.isDigit() }) },
                        label = { Text("Notice Period (in days)") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = vault.workAuthorization,
                        onValueChange = { vault = vault.copy(workAuthorization = it) },
                        label = { Text("Work Authorization / Visa Status") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = vault.relocationPreference,
                        onValueChange = { vault = vault.copy(relocationPreference = it) },
                        label = { Text("Relocation Preference") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = vault.linkedinUrl,
                        onValueChange = { vault = vault.copy(linkedinUrl = it) },
                        label = { Text("LinkedIn Profile URL") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }

        // 4. Mandatory User-Agent & Applicant Accuracy Warranty
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "User-Agent & Applicant Accuracy Warranty",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Row(
                        verticalAlignment = Alignment.Top,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = warrantyAccepted,
                            onCheckedChange = { warrantyAccepted = it }
                        )
                        Text(
                            text = "I warrant that CareerPilot AI acts solely as my personal productivity user-agent, all Master Profile facts are accurate, and I am responsible for reviewing every drafted application before approving submission.",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 12.dp)
                        )
                    }
                    Button(
                        onClick = { onSaveProfile(profile, vault, warrantyAccepted) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Outlined.Save, contentDescription = null)
                        Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                        Text("Save Profile, Vault & Warranty")
                    }
                }
            }
        }

        item { Spacer(modifier = Modifier.height(24.dp)) }
    }
}
