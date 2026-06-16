package com.plantmoist.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.graphics.Color
import android.widget.RemoteViews
import androidx.work.*
import org.json.JSONObject
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection

/**
 * MoistWidget — 2×1 home screen widget
 *
 * Shows plant name, moisture label, status colour, and last-updated time.
 * Fetches the latest reading from Supabase every 30 minutes via WorkManager.
 *
 * SharedPreferences keys written by the Capacitor app:
 *   moist_supabase_url    — Supabase project URL
 *   moist_supabase_key    — anon key
 *   moist_device_id       — active device ID
 *   moist_plant_name      — active plant name
 *   moist_last_moisture   — cached moisture label
 *   moist_last_status     — cached status (OK/DRY/WET)
 *   moist_last_seen       — cached last-updated ISO string
 */
class MoistWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (id in appWidgetIds) {
            updateWidget(context, appWidgetManager, id)
        }
        scheduleWorker(context)
    }

    override fun onEnabled(context: Context) {
        scheduleWorker(context)
    }

    override fun onDisabled(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    companion object {
        const val PREFS_NAME  = "com.plantmoist.app.widget"
        const val WORK_NAME   = "moist_widget_refresh"

        fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            widgetId: Int
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val plantName   = prefs.getString("moist_plant_name",   "My Plant") ?: "My Plant"
            val moisture    = prefs.getString("moist_last_moisture", "—")        ?: "—"
            val status      = prefs.getString("moist_last_status",   "OK")       ?: "OK"
            val lastSeen    = prefs.getString("moist_last_seen",     "")         ?: ""

            val moistureColor = when (status) {
                "DRY" -> Color.parseColor("#FF4081")
                "WET" -> Color.parseColor("#0288D1")
                else  -> Color.parseColor("#00E676")
            }

            val lastUpdated = if (lastSeen.isNotEmpty()) {
                try {
                    val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
                    sdf.timeZone = TimeZone.getDefault()
                    val date = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                        .also { it.timeZone = TimeZone.getTimeZone("UTC") }
                        .parse(lastSeen.take(19))
                    if (date != null) "Updated ${sdf.format(date)}" else "—"
                } catch (_: Exception) { "—" }
            } else "—"

            val views = RemoteViews(context.packageName, R.layout.moist_widget_layout)
            views.setTextViewText(R.id.widget_plant_name,   plantName)
            views.setTextViewText(R.id.widget_moisture,     moisture)
            views.setTextViewText(R.id.widget_status,       status)
            views.setTextViewText(R.id.widget_last_updated, lastUpdated)
            views.setTextColor(R.id.widget_moisture, moistureColor)
            views.setTextColor(R.id.widget_status,   moistureColor and 0x80FFFFFF.toInt())

            appWidgetManager.updateAppWidget(widgetId, views)
        }

        fun scheduleWorker(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }
}

/** WorkManager job: fetches latest reading from Supabase, caches in SharedPreferences */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(
            MoistWidget.PREFS_NAME, Context.MODE_PRIVATE
        )
        val url      = prefs.getString("moist_supabase_url", null) ?: return Result.success()
        val key      = prefs.getString("moist_supabase_key", null) ?: return Result.success()
        val deviceId = prefs.getString("moist_device_id",    null) ?: return Result.success()

        return try {
            val endpoint = "$url/rest/v1/readings" +
                "?device_id=eq.$deviceId" +
                "&select=moisture,raw_adc,status,created_at" +
                "&order=created_at.desc" +
                "&limit=1"

            val conn = URL(endpoint).openConnection() as HttpsURLConnection
            conn.setRequestProperty("apikey", key)
            conn.setRequestProperty("Authorization", "Bearer $key")
            conn.connectTimeout = 10_000
            conn.readTimeout    = 10_000

            val body = conn.inputStream.bufferedReader().readText()
            conn.disconnect()

            val arr = org.json.JSONArray(body)
            if (arr.length() == 0) return Result.success()

            val row      = arr.getJSONObject(0)
            val moisture = row.optInt("moisture", -1)
            val status   = row.optString("status", "OK")
            val seenAt   = row.optString("created_at", "")

            // Convert moisture int to descriptive label
            val label = when {
                moisture < 0  -> "—"
                moisture < 15 -> "Bone dry"
                moisture < 30 -> "Thirsty"
                moisture < 45 -> "Getting there"
                moisture < 65 -> "Happy"
                moisture < 80 -> "Lush"
                else          -> "Soaked"
            }

            prefs.edit()
                .putString("moist_last_moisture", label)
                .putString("moist_last_status",   status)
                .putString("moist_last_seen",      seenAt)
                .apply()

            // Push update to all widget instances
            val manager = AppWidgetManager.getInstance(applicationContext)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(applicationContext, MoistWidget::class.java)
            )
            for (id in ids) {
                MoistWidget.updateWidget(applicationContext, manager, id)
            }

            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
