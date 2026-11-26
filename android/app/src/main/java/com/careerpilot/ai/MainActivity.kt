package com.careerpilot.ai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.lifecycle.viewmodel.compose.viewModel
import com.careerpilot.ai.ui.screens.ApprovalQueueScreen
import com.careerpilot.ai.ui.screens.DiagnosticsScreen
import com.careerpilot.ai.ui.screens.DiscoverScreen
import com.careerpilot.ai.ui.screens.ParallelPortalWebViewScreen
import com.careerpilot.ai.ui.screens.PricingSettingsScreen
import com.careerpilot.ai.ui.screens.ProfileScreen
import com.careerpilot.ai.ui.screens.TrackerScreen
import com.careerpilot.ai.ui.screens.WebViewScreen
import com.careerpilot.ai.ui.theme.CareerPilotTheme
import com.careerpilot.ai.ui.viewmodel.CareerPilotViewModel
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CareerPilotTheme {
                CareerPilotRoot()
            }
        }
    }
}

private data class NavDestination(
    val label: String,
    val icon: ImageVector
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CareerPilotRoot(vm: CareerPilotViewModel = viewModel()) {
    val state by vm.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by remember { mutableIntStateOf(2) } // Default to Human Approval Queue

    val destinations = remember {
        listOf(
            NavDestination("Profile", Icons.Outlined.Person),
            NavDestination("Discover", Icons.Outlined.Explore),
            NavDestination("Queue", Icons.Outlined.CheckBox),
            NavDestination("Tracker", Icons.Outlined.TaskAlt),
            NavDestination("Pricing", Icons.Outlined.Public)
        )
    }

    LaunchedEffect(state.bannerMessage, state.errorMessage) {
        val msg = state.errorMessage ?: state.bannerMessage
        if (!msg.isNullOrBlank()) {
            snackbarHostState.showSnackbar(msg)
            vm.clearMessages()
        }
    }

    if (state.authLoading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    if (state.user == null) {
        AuthGateScreen(
            onGoogleSignIn = { vm.signInWithGoogle(it) },
            onEmailSignIn = { email, pass -> vm.signInWithEmail(email, pass) },
            onEmailRegister = { email, pass -> vm.registerWithEmail(email, pass) },
            onSubmitRecruiterOptOut = { vm.submitRecruiterOptOut(it) },
            busyMessage = state.busyMessage
        )
        return
    }

    // Full-screen One-Tap Diagnostics & Self-Test Screen
    if (state.showDiagnostics) {
        DiagnosticsScreen(
            masterProfile = state.workspace.profile,
            aiService = vm.aiService,
            onCheckRecruiterOptOutLive = { vm.checkRecruiterOptOutLive(it) },
            onDryRunUserWipe = { vm.dryRunUserDataWipe() },
            onBack = { vm.closeDiagnostics() }
        )
        return
    }

    // Full-screen Parallel Multi-Portal WebView Workspace
    if (state.activeParallelPortals.isNotEmpty()) {
        ParallelPortalWebViewScreen(
            sessions = state.activeParallelPortals,
            masterProfile = state.workspace.profile,
            qaVault = state.workspace.qaVault,
            guardrails = state.guardrails,
            onConfirmPortalSubmission = { appId, answers, outcome, reason ->
                vm.completeParallelPortalSubmission(appId, answers, outcome, reason)
            },
            onDismiss = { vm.closeParallelPortalExecution() }
        )
        return
    }

    // Full-screen in-app WebView Execution Sheet when user approves a single application
    state.activeWebViewApp?.let { activeApp ->
        WebViewScreen(
            application = activeApp,
            masterProfile = state.workspace.profile,
            approvedAnswers = state.activeWebViewAnswers,
            onConfirmSubmission = { outcome, reason ->
                vm.completeWebViewExecution(outcome, reason)
            },
            onDismiss = { vm.closeWebViewExecution() }
        )
        return
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "CareerPilot AI",
                        fontWeight = FontWeight.Bold
                    )
                },
                actions = {
                    // Live daily cap counter & 60-second cooldown countdown chip
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(end = 8.dp)
                    ) {
                        AssistChip(
                            onClick = { selectedTab = 4 },
                            label = {
                                Text("${state.guardrails.usedLast24h}/${state.guardrails.dailyCap} today")
                            }
                        )
                        AssistChip(
                            onClick = {},
                            label = {
                                Text(
                                    if (state.guardrails.cooldownSecondsRemaining > 0)
                                        "${state.guardrails.cooldownSecondsRemaining}s wait"
                                    else "Ready"
                                )
                            }
                        )
                    }
                }
            )
        },
        bottomBar = {
            NavigationBar {
                destinations.forEachIndexed { idx, dest ->
                    NavigationBarItem(
                        selected = selectedTab == idx,
                        onClick = { selectedTab = idx },
                        icon = { Icon(dest.icon, contentDescription = dest.label) },
                        label = { Text(dest.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            if (state.busyMessage != null) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            Box(modifier = Modifier.weight(1f)) {
                when (selectedTab) {
                    0 -> ProfileScreen(
                        workspace = state.workspace,
                        onParseResume = { text, bytes -> vm.parseResumeWithGemini(text, bytes) },
                        onSaveProfile = { profile, vault, warranty ->
                            vm.saveProfileAndVault(profile, vault, warranty)
                        }
                    )
                    1 -> DiscoverScreen(
                        jobs = state.searchedJobs ?: state.jobs,
                        masterProfile = state.workspace.profile,
                        onSearchBackendJobs = { query, country, market, mode, portal, minScore ->
                            vm.searchJobsInBackend(query, country, market, mode, portal, minScore)
                        },
                        onDiscoverFromResume = { query, country, market, mode, portal, minScore ->
                            vm.discoverJobsFromResume(query, country, market, mode, portal, minScore)
                        },
                        onTailorJob = { vm.tailorExistingJob(it) },
                        onQuickTailorRawJd = { jd, recruiter, company, portal ->
                            vm.quickTailorRawJd(jd, recruiter, company, portal)
                        }
                    )
                    2 -> ApprovalQueueScreen(
                        applications = state.applications,
                        masterProfile = state.workspace.profile,
                        blockedRecruiterHashes = state.blockedRecruiterHashes,
                        warrantyAccepted = state.workspace.warrantyAccepted,
                        guardrails = state.guardrails,
                        onApproveAndLaunchWebView = { app, answers ->
                            vm.openWebViewExecution(app, answers)
                        },
                        onLaunchParallelPortals = { sessions ->
                            vm.openParallelPortalExecution(sessions)
                        },
                        onSaveEditToVault = { appId, answers ->
                            vm.saveEditToVault(appId, answers)
                        },
                        onSkip = { vm.skipApplication(it) }
                    )
                    3 -> TrackerScreen(
                        applications = state.applications,
                        guardrails = state.guardrails,
                        onResumeActionRequired = { vm.resumeActionRequired(it) }
                    )
                    4 -> PricingSettingsScreen(
                        selectedTier = state.workspace.selectedTier,
                        onSelectTier = { vm.selectPricingTier(it) },
                        onSubmitRecruiterOptOut = { vm.submitRecruiterOptOut(it) },
                        onDeleteAccountAndAllData = { vm.deleteAccountAndAllData() },
                        onSignOut = { vm.signOut() },
                        onOpenDiagnostics = { vm.openDiagnostics() }
                    )
                }
            }
        }
    }
}

@Composable
private fun AuthGateScreen(
    onGoogleSignIn: (com.google.firebase.auth.AuthCredential) -> Unit,
    onEmailSignIn: (String, String) -> Unit,
    onEmailRegister: (String, String) -> Unit,
    onSubmitRecruiterOptOut: (String) -> Unit,
    busyMessage: String?
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val webClientId = stringResource(id = R.string.default_web_client_id)

    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var optOutUrl by remember { mutableStateOf("") }
    var authError by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "CareerPilot AI",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "Compliance-first AI job search, truthful resume tailoring, and human-approved applications.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(20.dp))

        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Button(
                    onClick = {
                        scope.launch {
                            runCatching {
                                val credentialManager = CredentialManager.create(context)
                                val googleIdOption = GetGoogleIdOption.Builder()
                                    .setFilterByAuthorizedAccounts(false)
                                    .setServerClientId(webClientId)
                                    .build()
                                val request = GetCredentialRequest.Builder()
                                    .addCredentialOption(googleIdOption)
                                    .build()
                                val result = credentialManager.getCredential(context, request)
                                val googleIdToken = GoogleIdTokenCredential.createFrom(result.credential.data)
                                onGoogleSignIn(GoogleAuthProvider.getCredential(googleIdToken.idToken, null))
                            }.onFailure { err ->
                                authError = err.message
                            }
                        }
                    },
                    enabled = busyMessage == null,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Continue with Google")
                }

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = { onEmailSignIn(email, password) },
                        enabled = email.isNotBlank() && password.length >= 6 && busyMessage == null,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Sign In")
                    }
                    OutlinedButton(
                        onClick = { onEmailRegister(email, password) },
                        enabled = email.isNotBlank() && password.length >= 6 && busyMessage == null,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Register")
                    }
                }

                authError?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Public Recruiter Opt-Out accessible without sign-in
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Recruiter? Public Privacy Opt-Out (No Login Required)",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )
                OutlinedTextField(
                    value = optOutUrl,
                    onValueChange = { optOutUrl = it },
                    label = { Text("LinkedIn URL (stored as SHA-256 hash)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedButton(
                    onClick = {
                        onSubmitRecruiterOptOut(optOutUrl)
                        optOutUrl = ""
                    },
                    enabled = optOutUrl.contains("linkedin.com", ignoreCase = true),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Block My Profile")
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = stringResource(id = R.string.compliance_disclaimer),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
