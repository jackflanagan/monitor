/*
 * plant_monitor.ino — Moist soil moisture monitor for ESP32
 *
 * Reads soil moisture via ADC, posts to Supabase, then either loops every
 * 10 seconds (BATTERY_MODE false) or deep-sleeps for 10 minutes (BATTERY_MODE true).
 *
 * Libraries required (install via Arduino Library Manager):
 *   - WiFiManager by tzapu
 *   - ArduinoJson
 *   - HTTPClient (built-in ESP32)
 *
 * Board: ESP32 Dev Module
 */

// ─── Configuration ────────────────────────────────────────────────────────────

// Set to true to enable deep sleep (battery mode).
// Set to false for continuous readings every READING_INTERVAL_MS.
#define BATTERY_MODE false

// Supabase project settings — replace with your own
#define SUPABASE_URL   "https://usoirglmgylpyokmusez.supabase.co"
#define SUPABASE_KEY   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzb2lyZ2xtZ3lscHlva211c2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDY1MTgsImV4cCI6MjA5MjMyMjUxOH0.MOtJbBJP3WpqD7EZFnrRGUM-zuR4nyR02qIF-FK4Ncg"

// Unique device identifier — change per device
#define DEVICE_ID      "ESP32-ABCD"

// ADC pin connected to moisture sensor (GPIO 34 on most ESP32 boards)
#define MOISTURE_PIN   34

// Thresholds (ADC counts, 0–4095)
// Higher ADC = drier soil (capacitive sensors)
#define DRY_THRESHOLD  2800   // Above this → DRY
#define WET_THRESHOLD  1200   // Below this → WET

// Continuous mode: reading interval in milliseconds
#define READING_INTERVAL_MS 10000

// Battery mode: deep sleep duration in seconds (10 minutes)
#define SLEEP_SECONDS  600

// WiFiManager AP credentials (shown when no WiFi is saved)
#define AP_SSID        "Moist Setup"
#define AP_PASSWORD    "moistplant"

// ─── RTC memory (survives deep sleep) ────────────────────────────────────────

// We store the WiFi credentials in RTC memory so the device can reconnect
// after wake-up without launching the captive portal again.
RTC_DATA_ATTR char rtc_ssid[64]     = {0};
RTC_DATA_ATTR char rtc_password[64] = {0};
RTC_DATA_ATTR int  boot_count       = 0;

// ─── Includes ─────────────────────────────────────────────────────────────────

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_sleep.h"

// ─── Globals ──────────────────────────────────────────────────────────────────

WiFiManager wifiManager;

// ─── Setup ────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(100);

  boot_count++;

  // Print wake reason in battery mode
  if (BATTERY_MODE) {
    printWakeReason();
  }

  Serial.printf("\n[Moist] Boot #%d  Device: %s\n", boot_count, DEVICE_ID);

  // ── WiFi Connection ──────────────────────────────────────────────────────────

  bool usedSavedCreds = false;

  if (BATTERY_MODE && boot_count > 1 && strlen(rtc_ssid) > 0) {
    // After first boot, use credentials saved in RTC memory for fast reconnect
    Serial.printf("[WiFi] Reconnecting to saved SSID: %s\n", rtc_ssid);
    WiFi.begin(rtc_ssid, rtc_password);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
      delay(500);
      Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());
      usedSavedCreds = true;
    } else {
      Serial.println("\n[WiFi] Fast reconnect failed, falling back to WiFiManager");
    }
  }

  if (!usedSavedCreds) {
    // First boot or reconnect failed: use WiFiManager captive portal
    wifiManager.setConfigPortalTimeout(180); // 3 minutes to configure
    wifiManager.setAPStaticIPConfig(IPAddress(192,168,4,1), IPAddress(192,168,4,1), IPAddress(255,255,255,0));

    if (!wifiManager.autoConnect(AP_SSID, AP_PASSWORD)) {
      Serial.println("[WiFi] Config portal timed out, restarting...");
      ESP.restart();
    }

    Serial.printf("[WiFi] Connected — IP: %s  SSID: %s\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.SSID().c_str());

    // Save credentials to RTC memory for fast reconnects after sleep
    WiFi.SSID().toCharArray(rtc_ssid, sizeof(rtc_ssid));
    WiFi.psk().toCharArray(rtc_password, sizeof(rtc_password));
  }

  // ── Take reading and post ────────────────────────────────────────────────────

  int rawAdc    = readMoisture();
  int moisture  = adcToPercent(rawAdc);
  String status = getStatus(rawAdc);

  Serial.printf("[Sensor] Raw ADC: %d  Moisture: %d%%  Status: %s\n", rawAdc, moisture, status.c_str());

  bool posted = postReading(rawAdc, moisture, status);
  Serial.printf("[Supabase] Post %s\n", posted ? "OK" : "FAILED");

  // ── Sleep or wait ────────────────────────────────────────────────────────────

  if (BATTERY_MODE) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.printf("[Sleep] Entering deep sleep for %d seconds (%d min)\n",
                  SLEEP_SECONDS, SLEEP_SECONDS / 60);
    Serial.flush();
    esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_SECONDS * 1000000ULL);
    esp_deep_sleep_start();
    // Code after this line never executes in battery mode
  }

  // Continuous mode: loop() handles the timing
}

// ─── Loop (continuous mode only) ──────────────────────────────────────────────

void loop() {
  if (BATTERY_MODE) return; // Should never reach here in battery mode

  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Lost connection, reconnecting...");
    WiFi.reconnect();
    delay(5000);
    return;
  }

  int rawAdc   = readMoisture();
  int moisture = adcToPercent(rawAdc);
  String status = getStatus(rawAdc);

  Serial.printf("[Sensor] Raw ADC: %d  Moisture: %d%%  Status: %s\n", rawAdc, moisture, status.c_str());

  bool posted = postReading(rawAdc, moisture, status);
  Serial.printf("[Supabase] Post %s\n", posted ? "OK" : "FAILED");

  delay(READING_INTERVAL_MS);
}

// ─── Sensor helpers ───────────────────────────────────────────────────────────

int readMoisture() {
  // Average 16 samples to reduce noise
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(MOISTURE_PIN);
    delay(10);
  }
  return (int)(sum / 16);
}

int adcToPercent(int raw) {
  // Capacitive sensors: high ADC = dry, low ADC = wet
  // Clamp and invert
  int clamped = constrain(raw, WET_THRESHOLD, DRY_THRESHOLD);
  return map(clamped, DRY_THRESHOLD, WET_THRESHOLD, 0, 100);
}

String getStatus(int raw) {
  if (raw >= DRY_THRESHOLD) return "DRY";
  if (raw <= WET_THRESHOLD) return "WET";
  return "OK";
}

// ─── Supabase POST ────────────────────────────────────────────────────────────

bool postReading(int rawAdc, int moisture, String status) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(String(SUPABASE_URL) + "/rest/v1/readings");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["raw_adc"]   = rawAdc;
  doc["moisture"]  = moisture;
  doc["status"]    = status;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  http.end();

  return (code == 201 || code == 200);
}

// ─── Deep sleep helpers ───────────────────────────────────────────────────────

void printWakeReason() {
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  switch (cause) {
    case ESP_SLEEP_WAKEUP_TIMER:
      Serial.printf("[Wake] Timer — slept for %d seconds\n", SLEEP_SECONDS);
      break;
    case ESP_SLEEP_WAKEUP_EXT0:
    case ESP_SLEEP_WAKEUP_EXT1:
      Serial.println("[Wake] External pin");
      break;
    default:
      Serial.printf("[Wake] Power-on / reset (cause: %d)\n", (int)cause);
      break;
  }
}
