package com.careerpilot.ai.util

import android.content.Context
import android.os.Build
import android.util.Log
import com.careerpilot.ai.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Production crash and error logger for CareerPilot AI Android.
 * Captures uncaught crashes and handled exceptions with device model, manufacturer,
 * Android OS/SDK version, UTC & local date/time, memory state, breadcrumbs, and stack trace.
 * Persists daily JSONL logs in app-private filesDir/crash_logs/ for the development team
 * and emits structured entries to Logcat under tag "CareerPilotCrash".
 */
object CrashLogger {
    private const val TAG = "CareerPilotCrash"
    private const val LOG_DIR_NAME = "crash_logs"
    private const val MAX_BREADCRUMBS = 20
    private const val MAX_DAILY_BYTES = 5L * 1024L * 1024L
    private const val MAX_RETENTION_DAYS = 14

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var installed = false

    private val breadcrumbsLock = Any()
    private val breadcrumbs = ArrayDeque<Pair<String, String>>(MAX_BREADCRUMBS)

    private val secretPatterns = listOf(
        Regex("""AIza[0-9A-Za-z\-_]{20,}""") to "[REDACTED_API_KEY]",
        Regex("""sk-[0-9A-Za-z\-_]{16,}""") to "[REDACTED_SECRET]",
        Regex("""(?i)(Bearer\s+)[A-Za-z0-9._\-~+/]+=*""") to "$1[REDACTED_TOKEN]",
        Regex("""(?i)(password|passwd|secret|token|apikey|api_key)\s*[:=]\s*["']?[^"'\s,}]+""") to "$1=[REDACTED]"
    )

    fun install(context: Context) {
        appContext = context.applicationContext
        if (installed) return
        installed = true

        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                writeCrashRecord(
                    level = "FATAL",
                    contextTag = "android.uncaught_exception",
                    threadName = thread.name,
                    throwable = throwable,
                    extras = mapOf("isMainThread" to (thread.id == 1L).toString())
                )
            } catch (_: Throwable) {
                // Never interfere with crash propagation
            } finally {
                previousHandler?.uncaughtException(thread, throwable)
            }
        }
        logBreadcrumb("App", "CrashLogger installed on ${Build.MANUFACTURER} ${Build.MODEL} (API ${Build.VERSION.SDK_INT})")
    }

    fun logBreadcrumb(screen: String, action: String) {
        val nowIso = formatUtcIso(Date())
        val entry = redact("$screen: $action").take(180)
        synchronized(breadcrumbsLock) {
            if (breadcrumbs.size >= MAX_BREADCRUMBS) {
                breadcrumbs.removeFirst()
            }
            breadcrumbs.addLast(nowIso to entry)
        }
    }

    fun logHandledError(
        contextTag: String,
        throwable: Throwable,
        extras: Map<String, String> = emptyMap()
    ): String {
        return writeCrashRecord(
            level = "ERROR",
            contextTag = contextTag,
            threadName = Thread.currentThread().name,
            throwable = throwable,
            extras = extras
        )
    }

    fun getRecentCrashLogFiles(context: Context): List<File> {
        val dir = File(context.applicationContext.filesDir, LOG_DIR_NAME)
        if (!dir.exists() || !dir.isDirectory) return emptyList()
        return dir.listFiles { file ->
            file.isFile && file.name.startsWith("crash-") && file.name.endsWith(".jsonl")
        }?.sortedByDescending { it.name }.orEmpty()
    }

    private fun writeCrashRecord(
        level: String,
        contextTag: String,
        threadName: String,
        throwable: Throwable,
        extras: Map<String, String>
    ): String {
        val now = Date()
        val utcDate = formatUtcDate(now)
        val utcIso = formatUtcIso(now)
        val localDateTime = formatLocalDateTime(now)
        val eventId = "AND-${System.currentTimeMillis().toString(36).uppercase(Locale.US)}-${
            UUID.randomUUID().toString().take(4).uppercase(Locale.US)
        }"

        val runtime = Runtime.getRuntime()
        val usedMemoryMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024L * 1024L)
        val maxMemoryMb = runtime.maxMemory() / (1024L * 1024L)

        val deviceJson = JSONObject().apply {
            put("manufacturer", Build.MANUFACTURER)
            put("brand", Build.BRAND)
            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            put("model", Build.MODEL)
            put("device", Build.DEVICE)
            put("hardware", Build.HARDWARE)
            put("androidVersion", Build.VERSION.RELEASE)
            put("sdkInt", Build.VERSION.SDK_INT)
            put("supportedAbis", JSONArray(Build.SUPPORTED_ABIS.toList()))
            put("locale", Locale.getDefault().toLanguageTag())
            put("timezone", TimeZone.getDefault().id)
            put("appVersionName", BuildConfig.VERSION_NAME)
            put("appVersionCode", BuildConfig.VERSION_CODE)
            put("usedMemoryMb", usedMemoryMb)
            put("maxMemoryMb", maxMemoryMb)
        }

        val breadcrumbsArray = JSONArray()
        synchronized(breadcrumbsLock) {
            breadcrumbs.forEach { (time, action) ->
                breadcrumbsArray.put(
                    JSONObject().apply {
                        put("time", time)
                        put("action", action)
                    }
                )
            }
        }

        val extrasJson = JSONObject()
        extras.forEach { (k, v) ->
            extrasJson.put(k.take(48), redact(v).take(250))
        }

        val stackTrace = redact(Log.getStackTraceString(throwable)).take(8000)

        val payload = JSONObject().apply {
            put("eventId", eventId)
            put("level", level)
            put("source", "android_client")
            put("timestamp", utcIso)
            put("date", utcDate)
            put("localDateTime", localDateTime)
            put("context", redact(contextTag).take(160))
            put("thread", threadName.take(80))
            put("errorName", throwable::class.java.name)
            put("message", redact(throwable.message ?: "Unhandled throwable").take(1000))
            put("stack", stackTrace)
            put("device", deviceJson)
            put("breadcrumbs", breadcrumbsArray)
            put("metadata", extrasJson)
        }

        val jsonLine = payload.toString()
        Log.e(TAG, jsonLine, throwable)
        persistToPrivateLogFile(utcDate, jsonLine)
        return eventId
    }

    private fun persistToPrivateLogFile(utcDate: String, jsonLine: String) {
        val ctx = appContext ?: return
        runCatching {
            val dir = File(ctx.filesDir, LOG_DIR_NAME)
            if (!dir.exists()) dir.mkdirs()

            val target = File(dir, "crash-$utcDate.jsonl")
            if (target.exists() && target.length() >= MAX_DAILY_BYTES) return

            target.appendText("$jsonLine\n", Charsets.UTF_8)

            // Rotate old files beyond retention window
            val logFiles = dir.listFiles { file ->
                file.isFile && file.name.startsWith("crash-") && file.name.endsWith(".jsonl")
            }?.sortedBy { it.name }.orEmpty()
            if (logFiles.size > MAX_RETENTION_DAYS) {
                logFiles.take(logFiles.size - MAX_RETENTION_DAYS).forEach { it.delete() }
            }
        }
    }

    private fun redact(raw: String): String {
        var result = raw
        for ((regex, replacement) in secretPatterns) {
            result = regex.replace(result, replacement)
        }
        return result
    }

    private fun formatUtcIso(date: Date): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(date)

    private fun formatUtcDate(date: Date): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(date)

    private fun formatLocalDateTime(date: Date): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss z", Locale.US).format(date)
}
