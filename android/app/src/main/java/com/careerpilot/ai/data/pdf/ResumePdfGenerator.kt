package com.careerpilot.ai.data.pdf

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.net.Uri
import com.careerpilot.ai.data.model.ApplicationRecord
import com.careerpilot.ai.data.model.MasterProfile
import java.io.File
import java.io.FileOutputStream

data class GeneratedResumePdf(
    val file: File,
    val uri: Uri,
    val byteSize: Long
)

/**
 * Generates a real tailored resume PDF via Android's native PdfDocument API into context.cacheDir.
 * Strictly renders MasterProfile fields with Truthfulness-Lock diffs applied.
 */
object ResumePdfGenerator {

    fun generateTailoredResumePdf(
        context: Context,
        profile: MasterProfile,
        application: ApplicationRecord
    ): GeneratedResumePdf {
        val safeName = profile.fullName.replace(Regex("[^a-zA-Z0-9]+"), "_").trim('_').ifBlank { "Candidate" }
        val safeCompany = application.company.replace(Regex("[^a-zA-Z0-9]+"), "_").trim('_').ifBlank { "Role" }
        val outFile = File(context.cacheDir, "${safeName}_${safeCompany}_Tailored.pdf")

        val diffLookup = application.resumeDiffs.associate { it.before.trim() to it.after.trim() }

        val pdf = PdfDocument()
        try {
            val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create()
            val page = pdf.startPage(pageInfo)
            val canvas = page.canvas

            val titlePaint = Paint().apply {
                color = Color.rgb(15, 23, 42)
                textSize = 18f
                isFakeBoldText = true
                isAntiAlias = true
            }
            val headerPaint = Paint().apply {
                color = Color.rgb(79, 70, 229)
                textSize = 12f
                isFakeBoldText = true
                isAntiAlias = true
            }
            val bodyPaint = Paint().apply {
                color = Color.rgb(30, 41, 59)
                textSize = 10f
                isAntiAlias = true
            }

            var y = 48f
            canvas.drawText(profile.fullName.ifBlank { "CareerPilot Candidate" }, 36f, y, titlePaint)
            y += 18f
            canvas.drawText(
                listOf(profile.headline, profile.location, profile.email, profile.phone)
                    .filter { it.isNotBlank() }
                    .joinToString(" | ")
                    .take(105),
                36f,
                y,
                bodyPaint
            )
            y += 26f

            if (profile.skills.isNotEmpty()) {
                canvas.drawText("SKILLS", 36f, y, headerPaint)
                y += 16f
                canvas.drawText(profile.skills.joinToString(" · ").take(105), 36f, y, bodyPaint)
                y += 24f
            }

            canvas.drawText("EXPERIENCE (Tailored for ${application.company})", 36f, y, headerPaint)
            y += 18f
            for (exp in profile.experience) {
                if (y > 760f) break
                canvas.drawText("${exp.title} — ${exp.company} (${exp.startDate} - ${exp.endDate})", 36f, y, titlePaint.apply { textSize = 11f })
                y += 15f
                for (bullet in exp.bullets) {
                    if (y > 780f) break
                    val text = "• ${diffLookup[bullet.trim()] ?: bullet}".take(102)
                    canvas.drawText(text, 44f, y, bodyPaint)
                    y += 14f
                }
                y += 8f
            }

            pdf.finishPage(page)
            FileOutputStream(outFile).use { fos ->
                pdf.writeTo(fos)
                fos.flush()
            }
        } finally {
            pdf.close()
        }

        val size = outFile.length()
        require(outFile.exists() && outFile.canRead() && size > 0L) {
            "Generated PDF at ${outFile.absolutePath} is empty or unreadable."
        }
        val header = outFile.inputStream().use { stream ->
            val buf = ByteArray(5)
            val read = stream.read(buf)
            if (read > 0) String(buf, 0, read, Charsets.US_ASCII) else ""
        }
        require(header.startsWith("%PDF-")) {
            "Generated file does not have a valid %PDF- signature."
        }

        return GeneratedResumePdf(
            file = outFile,
            uri = Uri.fromFile(outFile),
            byteSize = size
        )
    }
}
