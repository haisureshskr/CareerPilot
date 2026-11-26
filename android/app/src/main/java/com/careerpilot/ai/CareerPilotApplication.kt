package com.careerpilot.ai

import android.app.Application
import com.careerpilot.ai.util.CrashLogger

class CareerPilotApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashLogger.install(this)
    }
}
