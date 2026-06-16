function colorFor(v) {
  return v < 30 ? '#ffd500' : v >= 70 ? '#00d4ff' : '#00ffcc';
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  return Uint8Array.from([...rawData].map(function(c) { return c.charCodeAt(0); }));
}

// Moisture descriptive label (replaces raw %)
function moistureLabel(m) {
  if (m < 15) return 'Bone dry';
  if (m < 30) return 'Thirsty';
  if (m < 45) return 'Getting there';
  if (m < 65) return 'Happy';
  if (m < 80) return 'Lush';
  return 'Soaked';
}

// Recalculate moisture % from raw ADC using calibration values
// dry_value = ADC reading in air (high), wet_value = ADC reading in water (low)
function recalcMoisture(rawAdc, dryValue, wetValue) {
  if (dryValue === wetValue) return 0;
  var pct = (dryValue - rawAdc) / (dryValue - wetValue) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

// Compute trend from array of moisture values (oldest → newest)
// Returns 'drying' | 'wetting' | 'stable'
function computeTrend(moistures) {
  if (!moistures || moistures.length < 2) return 'stable';
  var delta = moistures[moistures.length - 1] - moistures[0];
  if (delta < -5) return 'drying';
  if (delta > 5) return 'wetting';
  return 'stable';
}

// Assign health grade from okPct (0–100) and whether we have enough data
function healthGrade(okPct, readingCount, hasRecentReading) {
  if (readingCount < 10) return 'insufficient';
  if (!hasRecentReading) return 'F';
  if (okPct >= 90) return 'A';
  if (okPct >= 75) return 'B';
  if (okPct >= 50) return 'C';
  if (okPct >= 25) return 'D';
  return 'F';
}

// Predict hours until moisture hits dryThreshold given drying rate (% per hour)
// Returns { kind: 'now'|'hydrated'|'insufficient'|'hours', hours: number }
function watringPrediction(moistures, timestamps, dryThreshold) {
  if (!moistures || moistures.length < 5) return { kind: 'insufficient' };
  var current = moistures[moistures.length - 1];
  if (current <= dryThreshold) return { kind: 'now' };

  var oldest = moistures[0];
  var newest = moistures[moistures.length - 1];
  var tOldest = new Date(timestamps[0]).getTime();
  var tNewest = new Date(timestamps[timestamps.length - 1]).getTime();
  var hoursSpan = (tNewest - tOldest) / 3600000;
  if (hoursSpan <= 0) return { kind: 'insufficient' };

  var dropPerHour = (oldest - newest) / hoursSpan;
  if (dropPerHour <= 0) return { kind: 'hydrated' };

  var hoursLeft = (current - dryThreshold) / dropPerHour;
  return { kind: 'hours', hours: Math.round(hoursLeft) };
}

// WiFi signal quality label from RSSI dBm
function signalQuality(rssi) {
  if (rssi >= -55) return 'Excellent';
  if (rssi >= -65) return 'Good';
  if (rssi >= -75) return 'Fair';
  return 'Weak';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    colorFor,
    urlBase64ToUint8Array,
    moistureLabel,
    recalcMoisture,
    computeTrend,
    healthGrade,
    watringPrediction,
    signalQuality,
  };
}
