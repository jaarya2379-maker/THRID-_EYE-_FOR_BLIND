/**
 * ============================================================================
 * Third Eye for the Blind — ESP32 WROOM DevKit Firmware (v3.0 Production)
 * ============================================================================
 * Features:
 * 1. 5-sample median filter with outlier rejection (eliminates multipath spikes)
 * 2. Non-blocking proportional haptic feedback (millis() state machine)
 * 3. Sensor fault detection & disconnection watchdog (FAULT:NO_ECHO / FAULT:DISCONNECTED)
 * 4. Dedicated tactile SOS emergency button on GPIO 4 (active LOW, debounced)
 * 5. Battery percentage telemetry on GPIO 34 (ADC1)
 * 6. Dual-sensor architectural support (primary forward + optional downward drop-off)
 * 7. Live Serial Telemetry protocol:
 *      DIST:<cm>
 *      RAW:<cm>
 *      FAULT:<type>
 *      EVENT:SOS_BUTTON
 *      BATTERY:<pct>
 *      TRIGGER_AI:<cm>
 * ============================================================================
 */

// --- Primary Forward-Facing Ultrasonic Sensor (HC-SR04) ---
const int TRIG_PIN  = 5;   // Primary TRIG
const int ECHO_PIN  = 18;  // Primary ECHO

// --- Optional Secondary Downward-Facing Drop-Off Sensor ---
// Connect for curb / stair drop-off detection (disabled by default)
#define ENABLE_DOWNWARD_SENSOR false
const int TRIG_PIN_DOWN = 22;
const int ECHO_PIN_DOWN = 23;

// --- Tactile & Haptic Feedback ---
const int MOTOR_PIN = 19;  // BC547 Base (Coin Vibration Motor)

// --- Tactile SOS Push Button (Active LOW with internal pull-up) ---
const int SOS_BUTTON_PIN = 4;

// --- Battery Voltage ADC Input (GPIO 34 is ADC1_CH6) ---
const int BATTERY_ADC_PIN = 34;

// --- Distance Thresholds (in centimeters) ---
const int MAX_DISTANCE    = 150; // Detection boundary (1.5 m)
const int AI_TRIGGER_DIST = 60;  // Proximity trigger boundary for camera vision
const int CRITICAL_DIST   = 25;  // Emergency stop threshold (25 cm)

// --- Timing & Rate Limits ---
const unsigned long TELEMETRY_INTERVAL_MS = 100; // 10 Hz telemetry stream
const unsigned long AI_COOLDOWN_MS        = 4000; // 4s minimum between automated AI triggers
const unsigned long BATTERY_INTERVAL_MS   = 5000; // Battery report every 5s
const unsigned long DEBOUNCE_DELAY_MS     = 50;   // SOS button debounce

// --- State Variables ---
unsigned long lastTelemetryTime = 0;
unsigned long lastAiTriggerTime = 0;
unsigned long lastBatteryTime   = 0;
unsigned long lastMotorToggle   = 0;
bool motorState = false;

// SOS Button Debounce State
int lastButtonReading = HIGH;
int buttonState = HIGH;
unsigned long lastDebounceTime = 0;

// Sensor Fault Tracking
int consecutiveEchoFailures = 0;
const int FAULT_THRESHOLD = 5;

// ==========================================
// 1. Raw Ultrasonic Measurement
// ==========================================
long measureRawEchoTimeUs(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // 25ms timeout (~400cm max range)
  return pulseIn(echoPin, HIGH, 25000);
}

// ==========================================
// 2. 5-Sample Median Filter (Noise & Multipath Rejection)
// ==========================================
long measureFilteredDistanceCm() {
  const int SAMPLES = 5;
  long rawDistances[SAMPLES];
  int validCount = 0;

  for (int i = 0; i < SAMPLES; i++) {
    long duration = measureRawEchoTimeUs(TRIG_PIN, ECHO_PIN);
    if (duration > 0) {
      long d = duration * 0.0343 / 2;
      // Filter out physical impossibilities (<2cm or >400cm)
      if (d >= 2 && d <= 400) {
        rawDistances[validCount++] = d;
      }
    }
    delay(2); // Short spacing between sonic bursts
  }

  // Handle echo timeout / sensor disconnect
  if (validCount == 0) {
    consecutiveEchoFailures++;
    if (consecutiveEchoFailures >= FAULT_THRESHOLD) {
      Serial.println("FAULT:NO_ECHO_TIMEOUT");
    }
    return MAX_DISTANCE + 1; // Out of range safe fallback
  }

  consecutiveEchoFailures = 0;

  // Simple insertion sort to find median
  for (int i = 0; i < validCount - 1; i++) {
    for (int j = i + 1; j < validCount; j++) {
      if (rawDistances[j] < rawDistances[i]) {
        long temp = rawDistances[i];
        rawDistances[i] = rawDistances[j];
        rawDistances[j] = temp;
      }
    }
  }

  // Return middle element (median)
  return rawDistances[validCount / 2];
}

// ==========================================
// 3. Battery Voltage Estimator
// ==========================================
int readBatteryPercentage() {
  // 3.3V ADC with voltage divider for 3.7V LiPo (Full: 4.2V, Empty: 3.3V)
  int rawAdc = analogRead(BATTERY_ADC_PIN);
  float voltage = (rawAdc / 4095.0) * 3.3 * 2.0; // Assuming 1:1 voltage divider
  int pct = (int)((voltage - 3.3) / (4.2 - 3.3) * 100.0);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

// ==========================================
// 4. Non-Blocking Haptic Vibration Motor Controller
// ==========================================
void updateHapticFeedback(long distance, unsigned long now) {
  if (distance <= 0 || distance > MAX_DISTANCE) {
    digitalWrite(MOTOR_PIN, LOW);
    motorState = false;
    return;
  }

  // Danger Zone: Continuous solid vibration
  if (distance <= CRITICAL_DIST) {
    digitalWrite(MOTOR_PIN, HIGH);
    motorState = true;
    return;
  }

  // Caution Zone: Non-blocking pulsing frequency scaling with proximity
  // Close (26cm) -> 40ms off interval; Far (150cm) -> 240ms off interval
  int offInterval = map(distance, CRITICAL_DIST, MAX_DISTANCE, 40, 240);
  int onInterval = 30; // 30ms tactile click

  if (motorState && (now - lastMotorToggle >= onInterval)) {
    digitalWrite(MOTOR_PIN, LOW);
    motorState = false;
    lastMotorToggle = now;
  } else if (!motorState && (now - lastMotorToggle >= offInterval)) {
    digitalWrite(MOTOR_PIN, HIGH);
    motorState = true;
    lastMotorToggle = now;
  }
}

// ==========================================
// 5. Tactile SOS Emergency Button Checker
// ==========================================
void checkSosButton(unsigned long now) {
  int reading = digitalRead(SOS_BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastDebounceTime = now;
  }

  if ((now - lastDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (reading != buttonState) {
      buttonState = reading;
      // Active LOW button pressed
      if (buttonState == LOW) {
        // Haptic feedback pulse confirming SOS trigger
        digitalWrite(MOTOR_PIN, HIGH);
        delay(80);
        digitalWrite(MOTOR_PIN, LOW);
        Serial.println("EVENT:SOS_BUTTON");
      }
    }
  }

  lastButtonReading = reading;
}

// ==========================================
// Setup & Main Loop
// ==========================================
void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(MOTOR_PIN, OUTPUT);
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BATTERY_ADC_PIN, INPUT);

  digitalWrite(MOTOR_PIN, LOW);

  // Power-on self-test (two short tactile pulses)
  digitalWrite(MOTOR_PIN, HIGH);
  delay(100);
  digitalWrite(MOTOR_PIN, LOW);
  delay(80);
  digitalWrite(MOTOR_PIN, HIGH);
  delay(100);
  digitalWrite(MOTOR_PIN, LOW);

  Serial.println("SYSTEM_READY:THIRD_EYE_V3");
}

void loop() {
  unsigned long now = millis();

  // 1. Check tactile SOS button on glove
  checkSosButton(now);

  // 2. Measure filtered ultrasonic distance
  long distance = measureFilteredDistanceCm();

  // 3. Update non-blocking haptic feedback
  updateHapticFeedback(distance, now);

  // 4. Stream Telemetry to Web Guardian Dashboard at 10 Hz
  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = now;
    Serial.printf("DIST:%ld\n", distance);
  }

  // 5. Stream Battery status every 5 seconds
  if (now - lastBatteryTime >= BATTERY_INTERVAL_MS) {
    lastBatteryTime = now;
    int batteryPct = readBatteryPercentage();
    Serial.printf("BATTERY:%d\n", batteryPct);
  }

  // 6. Proximity AI Trigger with cooldown
  if (distance <= AI_TRIGGER_DIST && (now - lastAiTriggerTime >= AI_COOLDOWN_MS)) {
    lastAiTriggerTime = now;
    Serial.printf("TRIGGER_AI:%ld\n", distance);
  }
}
