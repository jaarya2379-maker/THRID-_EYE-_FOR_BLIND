/*
 * Third Eye for the Blind — ESP32 firmware v3.2
 * Library: NimBLE-Arduino. Board: ESP32 Dev Module.
 * Output lines (USB serial and BLE UART) are listed in section 3 of the handoff.
 */

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <esp_task_wdt.h>
#include "third_eye_logic.h"

using namespace te;

const int TRIG_PIN           = 5;
const int ECHO_PIN           = 18; // via 1k/2k divider
const int TRIG_PIN_DOWN      = 22;
const int ECHO_PIN_DOWN      = 23; // via 1k/2k divider
const int MOTOR_PIN          = 19; // BC547 base via 1k
const int SOS_BUTTON_PIN     = 4;  // active LOW
const int BATTERY_ADC_PIN    = 34;

#define ENABLE_DOWNWARD_SENSOR true // false if the down sensor is not wired

const int AI_TRIGGER_DIST       = 60;    // cm
const uint32_t FWD_TIMEOUT_US   = 9500;  // about 160 cm round trip
const uint32_t DWN_TIMEOUT_US   = 12000; // about 2 m, slanted path to ground
const uint32_t STEP_MS          = 25;    // spacing between pings
const int GROUND_MARGIN         = 25;    // cm change counts as drop or step
const uint32_t SOS_HOLD_MS      = 1500;
const uint32_t AI_COOLDOWN_MS   = 4000;
const uint32_t TELEMETRY_MS     = 100;
const uint32_t BATTERY_MS       = 5000;
const int DIV_RATIO             = 2;     // two equal battery resistors
const int BATT_LOW_MV           = 3500;

// ---------- BLE UART (Nordic UART service) ----------
#define NUS_SERVICE "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

NimBLEServer* bleServer;
NimBLECharacteristic* bleTx;

void bleInit() {
  NimBLEDevice::init("ThirdEye");
  bleServer = NimBLEDevice::createServer();
  NimBLEService* svc = bleServer->createService(NUS_SERVICE);
  bleTx = svc->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE);
  adv->start();
}

void emit(const char* line) { // line must end with a newline
  Serial.print(line);
  if (bleServer && bleServer->getConnectedCount() > 0) {
    bleTx->setValue((const uint8_t*)line, strlen(line));
    bleTx->notify();
  }
}

void emitf(const char* fmt, int v) {
  char b[24];
  snprintf(b, sizeof(b), fmt, v);
  emit(b);
}

// ---------- State ----------
Med3 fMed, dMed;
int fwd = MAX_DISTANCE + 1, dwn = NO_DOWN, baseline = 0;
uint8_t stepIdx = 0, stuckCnt = 0, dropCnt = 0, lowCnt = 0;
bool echoStuck = false, dropAlert = false, lowObstacle = false, lowBatt = false;
bool downEnabled = false, lowBattSent = false, prevDrop = false, sosFired = false;
int battMv = 0, battPct = 100, prevAiDist = MAX_DISTANCE + 1;
uint32_t confirmUntil = 0, sosPressStart = 0, lastAi = 0;

// ---------- Ultrasonic ----------
int readCm(int trig, int echo, uint32_t timeoutUs) { // -1 on timeout
  digitalWrite(trig, LOW);  delayMicroseconds(3);
  digitalWrite(trig, HIGH); delayMicroseconds(10);
  digitalWrite(trig, LOW);
  uint32_t t = pulseIn(echo, HIGH, timeoutUs);
  if (t == 0) return -1;
  int cm = t / 58;
  return cm < 2 ? 2 : cm;
}

int calibrateGround() { // median of 15 readings, 0 = failed
  int s[15];
  for (int i = 0; i < 15; i++) {
    int c = readCm(TRIG_PIN_DOWN, ECHO_PIN_DOWN, DWN_TIMEOUT_US);
    s[i] = c < 0 ? NO_DOWN : c;
    delay(40);
  }
  for (int i = 0; i < 15; i++) {
    for (int j = i; j > 0 && s[j - 1] > s[j]; j--) {
      int t = s[j]; s[j] = s[j - 1]; s[j - 1] = t;
    }
  }
  return s[7] >= NO_DOWN ? 0 : s[7];
}

void evalGround() {
  if (baseline == 0) { dropAlert = lowObstacle = false; return; }
  GroundState g = groundState(dwn, baseline, GROUND_MARGIN);
  if (g == GROUND_DROP) { if (dropCnt < 5) dropCnt++; } else dropCnt = 0;
  if (g == GROUND_LOW)  { if (lowCnt < 5)  lowCnt++;  } else lowCnt = 0;
  dropAlert = dropCnt >= 2; // two readings in a row
  lowObstacle = lowCnt >= 2;
}

void doStep() { // one ping per call: forward, forward, down
  static const uint8_t SEQ[3] = {0, 0, 1};
  uint8_t kind = downEnabled ? SEQ[stepIdx] : 0;
  stepIdx = (stepIdx + 1) % 3;

  if (kind == 0) {
    if (digitalRead(ECHO_PIN) == HIGH) { if (stuckCnt < 255) stuckCnt++; }
    else stuckCnt = 0;
    echoStuck = stuckCnt >= 10;
    int cm = readCm(TRIG_PIN, ECHO_PIN, FWD_TIMEOUT_US);
    if (cm < 0 || cm > MAX_DISTANCE) cm = MAX_DISTANCE + 1; // timeout counts as far
    fwd = fMed.push(cm);
  } else {
    int cm = readCm(TRIG_PIN_DOWN, ECHO_PIN_DOWN, DWN_TIMEOUT_US);
    dwn = dMed.push(cm < 0 ? NO_DOWN : cm);
    evalGround();
  }
}

void updateBattery() {
  int mv = analogReadMilliVolts(BATTERY_ADC_PIN) * DIV_RATIO;
  battMv = battMv == 0 ? mv : (battMv * 3 + mv) / 4;
  battPct = constrain(map(battMv, 3300, 4200, 0, 100), 0, 100);
  lowBatt = battMv < BATT_LOW_MV;
}

void handleSos(uint32_t now) { // hold 1.5 s, non-blocking
  if (digitalRead(SOS_BUTTON_PIN) == LOW) {
    if (sosPressStart == 0) sosPressStart = now;
    else if (!sosFired && now - sosPressStart >= SOS_HOLD_MS) {
      sosFired = true;
      confirmUntil = now + 600;
      emit("EVENT:SOS_BUTTON\n");
    }
  } else {
    sosPressStart = 0;
    sosFired = false;
  }
}

void pulses(int n, int onMs, int offMs) { // blocking, setup only
  for (int k = 0; k < n; k++) {
    digitalWrite(MOTOR_PIN, HIGH); delay(onMs);
    digitalWrite(MOTOR_PIN, LOW);  delay(offMs);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);           pinMode(ECHO_PIN, INPUT);
  pinMode(TRIG_PIN_DOWN, OUTPUT);      pinMode(ECHO_PIN_DOWN, INPUT);
  pinMode(MOTOR_PIN, OUTPUT);          digitalWrite(MOTOR_PIN, LOW);
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_11db);
  dMed.fill(NO_DOWN);
  bleInit();
  updateBattery();

  pulses(2, 100, 80); // booted
  bool ok = false;    // cover forward sensor with palm within 3 s
  uint32_t t0 = millis();
  while (millis() - t0 < 3000) {
    int cm = readCm(TRIG_PIN, ECHO_PIN, FWD_TIMEOUT_US);
    if (cm >= 0 && cm <= 15) { ok = true; break; }
    delay(30);
  }
  if (ok) pulses(1, 400, 0); else pulses(5, 60, 60);
  delay(2000); // hand away, normal pose

  if (ENABLE_DOWNWARD_SENSOR) {
    baseline = calibrateGround();
    downEnabled = baseline > 0;
    if (downEnabled) pulses(1, 400, 0); else pulses(5, 60, 60);
  }

  emit("SYSTEM_READY:V3_2\n");

#if ESP_ARDUINO_VERSION_MAJOR < 3
  esp_task_wdt_init(5, true); // 5 s watchdog
#endif
  esp_task_wdt_add(NULL);
}

void loop() {
  static uint32_t lastStep = 0, lastTele = 0, lastBatt = 0;
  uint32_t now = millis();
  esp_task_wdt_reset();

  handleSos(now);

  if (now - lastStep >= STEP_MS) {
    lastStep = now;
    doStep();
  }

  int effective = fwd;
  if (lowObstacle && effective > 60) effective = 60;

  HapticInput h = { now, effective, dropAlert, echoStuck, lowBatt, now < confirmUntil };
  digitalWrite(MOTOR_PIN, motorOn(h) ? HIGH : LOW); // local, no phone needed

  if (now - lastTele >= TELEMETRY_MS) {
    lastTele = now;
    emitf("DIST:%d\n", fwd);
    if (downEnabled) emitf("DOWN:%d\n", dwn);
    if (echoStuck) emit("FAULT:ECHO_STUCK\n");
  }

  if (dropAlert && !prevDrop) emit("EVENT:DROP\n");
  prevDrop = dropAlert;

  if (now - lastBatt >= BATTERY_MS) {
    lastBatt = now;
    updateBattery();
    emitf("BATTERY:%d\n", battPct);
    if (lowBatt && !lowBattSent) {
      emit("WARN:LOW_BATTERY\n");
      lowBattSent = true;
    }
    if (!lowBatt) lowBattSent = false;
  }

  bool inZone = fwd <= AI_TRIGGER_DIST; // fire on zone entry, then every 4 s
  bool entered = inZone && prevAiDist > AI_TRIGGER_DIST + 20;
  if (inZone && (entered || now - lastAi >= AI_COOLDOWN_MS)) {
    lastAi = now;
    emitf("TRIGGER_AI:%d\n", fwd);
  }
  prevAiDist = fwd;

  if (bleServer->getConnectedCount() == 0) { // keep advertising after a disconnect
    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    if (!adv->isAdvertising()) adv->start();
  }
}
