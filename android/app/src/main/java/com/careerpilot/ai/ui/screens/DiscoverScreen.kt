package com.careerpilot.ai.ui.screens

import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.careerpilot.ai.data.model.CountryFilterMatcher
import com.careerpilot.ai.data.model.JobListing
import com.careerpilot.ai.data.model.MasterProfile
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiscoverScreen(
    jobs: List<JobListing>,
    masterProfile: MasterProfile,
    onSearchBackendJobs: (query: String, country: String, market: String, workMode: String, portalType: String, minMatchScore: Int) -> Unit,
    onDiscoverFromResume: (query: String, country: String, market: String, workMode: String, portalType: String, minMatchScore: Int) -> Unit,
    onTailorJob: (JobListing) -> Unit,
    onQuickTailorRawJd: (rawJd: String, recruiterName: String, companyHint: String, portalType: String) -> Unit
) {
    var searchQuery by remember { mutableStateOf("") }
    // Other regions commented out — focusing on India first
    var selectedCountry by remember { mutableStateOf("India") }
    var selectedWorkMode by remember { mutableStateOf("All") }
    var selectedPortal by remember { mutableStateOf("All") }
    var selectedMarket by remember { mutableStateOf("India") }
    var minMatchScore by remember { mutableFloatStateOf(0f) }

    var showQuickTailorSheet by remember { mutableStateOf(false) }
    var rawJdInput by remember { mutableStateOf("") }
    var recruiterNameInput by remember { mutableStateOf("") }
    var companyHintInput by remember { mutableStateOf("") }
    var portalInput by remember { mutableStateOf("Greenhouse") }

    // Execute all job search & filtering in the Firestore backend whenever filters or query change
    LaunchedEffect(searchQuery, selectedCountry, selectedMarket, selectedWorkMode, selectedPortal, minMatchScore) {
        if (searchQuery.isNotBlank()) delay(250L)
        onSearchBackendJobs(
            searchQuery,
            selectedCountry,
            selectedMarket,
            selectedWorkMode,
            selectedPortal,
            minMatchScore.roundToInt()
        )
    }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showQuickTailorSheet = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            ) {
                Icon(Icons.Outlined.Add, contentDescription = "Quick Tailor Any JD")
            }
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Resume-Based Job Discovery",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Backend Firestore & Gemini search matched strictly against your parsed Master Profile.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Active Resume Basis Card
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            text = "Active Resume: ${masterProfile.fullName.ifBlank { "Upload resume in Profile" }}",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                        if (masterProfile.headline.isNotBlank()) {
                            Text(
                                text = masterProfile.headline,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (masterProfile.skills.isNotEmpty()) {
                            Text(
                                text = "Skills indexed: ${masterProfile.skills.take(8).joinToString(" · ")}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Button(
                            onClick = {
                                onDiscoverFromResume(
                                    searchQuery,
                                    selectedCountry,
                                    selectedMarket,
                                    selectedWorkMode,
                                    selectedPortal,
                                    minMatchScore.roundToInt()
                                )
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Outlined.Public, contentDescription = null)
                            Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                            Text(
                                if (selectedCountry != "All") "Search Jobs in $selectedCountry (Resume)"
                                else "Search Jobs from My Resume (Backend)"
                            )
                        }
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    label = { Text("Search all backend jobs by role, skill, or city") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Strict Country Filter Row
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    CountryFilterMatcher.SUPPORTED_COUNTRIES.forEach { country ->
                        FilterChip(
                            selected = selectedCountry == country,
                            onClick = {
                                selectedCountry = country
                                selectedMarket = when (country) {
                                    "India" -> "India"
                                    "All" -> "All"
                                    else -> "Global"
                                }
                            },
                            label = { Text(if (country == "All") "All Countries" else country) }
                        )
                    }
                }
            }

            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf(
                        // Other regions commented out — focusing on India first
                        // "All",
                        "India"
                        // "Global"
                    ).forEach { market ->
                        FilterChip(
                            selected = selectedMarket == market,
                            onClick = {
                                selectedMarket = market
                                selectedCountry = "India"
                            },
                            label = { Text("$market Only") }
                        )
                    }
                    listOf("All", "Remote", "Hybrid", "On-site").forEach { mode ->
                        FilterChip(
                            selected = selectedWorkMode == mode,
                            onClick = { selectedWorkMode = mode },
                            label = { Text(if (mode == "All") "Any Mode" else mode) }
                        )
                    }
                }
            }

            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf("All", "Greenhouse", "Lever", "Ashby", "Workday", "Naukri").forEach { portal ->
                        FilterChip(
                            selected = selectedPortal == portal,
                            onClick = { selectedPortal = portal },
                            label = { Text(portal) }
                        )
                    }
                }
            }

            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Minimum ATS Match Score", style = MaterialTheme.typography.labelMedium)
                        Text("${minMatchScore.roundToInt()}%", fontWeight = FontWeight.Bold)
                    }
                    Slider(
                        value = minMatchScore,
                        onValueChange = { minMatchScore = it },
                        valueRange = 0f..95f,
                        steps = 18
                    )
                }
            }

            if (jobs.isEmpty()) {
                item {
                    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = if (selectedCountry != "All") "No backend jobs in $selectedCountry yet" else "No backend jobs match current filters",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold
                            )
                            OutlinedButton(
                                onClick = {
                                    onDiscoverFromResume(
                                        searchQuery,
                                        selectedCountry,
                                        selectedMarket,
                                        selectedWorkMode,
                                        selectedPortal,
                                        0
                                    )
                                }
                            ) {
                                Text(
                                    if (selectedCountry != "All") "Discover Jobs in $selectedCountry"
                                    else "Run Live Resume Discovery"
                                )
                            }
                        }
                    }
                }
            }

            items(jobs, key = { it.id }) { job ->
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Top
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "${job.company} · ${job.portalType} · ${job.portalComplexity}",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = job.role,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "${job.location} · ${job.workMode} · ${job.salary}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                text = "${job.matchScore}%",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }

                        Text(
                            text = job.description,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 3
                        )

                        if (job.matchedKeywords.isNotEmpty()) {
                            Text(
                                text = "Verified resume match: ${job.matchedKeywords.joinToString(" · ")}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }

                        Button(
                            onClick = { onTailorJob(job) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Outlined.AutoAwesome, contentDescription = null)
                            Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                            Text("Score, Tailor & Queue for Approval")
                        }
                    }
                }
            }

            item { Spacer(modifier = Modifier.height(72.dp)) }
        }
    }

    if (showQuickTailorSheet) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { showQuickTailorSheet = false },
            sheetState = sheetState
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Quick Tailor Any JD",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Paste any raw job description and recruiter name for instant Gemini ATS scoring, truthful bullet tailoring, and queuing.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                OutlinedTextField(
                    value = companyHintInput,
                    onValueChange = { companyHintInput = it },
                    label = { Text("Company Name (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = recruiterNameInput,
                    onValueChange = { recruiterNameInput = it },
                    label = { Text("Recruiter / Hiring Manager Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf("Greenhouse", "Lever", "Ashby", "Workday", "Naukri").forEach { portal ->
                        FilterChip(
                            selected = portalInput == portal,
                            onClick = { portalInput = portal },
                            label = { Text(portal) }
                        )
                    }
                }

                OutlinedTextField(
                    value = rawJdInput,
                    onValueChange = { rawJdInput = it },
                    label = { Text("Paste Raw Job Description") },
                    minLines = 5,
                    maxLines = 8,
                    modifier = Modifier.fillMaxWidth()
                )

                Button(
                    onClick = {
                        onQuickTailorRawJd(rawJdInput, recruiterNameInput, companyHintInput, portalInput)
                        rawJdInput = ""
                        recruiterNameInput = ""
                        companyHintInput = ""
                        showQuickTailorSheet = false
                    },
                    enabled = rawJdInput.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Score & Queue with Gemini")
                }

                Spacer(modifier = Modifier.height(20.dp))
            }
        }
    }
}
