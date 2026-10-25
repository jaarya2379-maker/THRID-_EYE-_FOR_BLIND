# Third Eye AI — Assistive Electronic Mobility & Dual-Sensor Navigation System

[![Vercel Deployment](https://img.shields.io/badge/Deployment-Live%20on%20Vercel-success?style=flat&logo=vercel)](https://third-eye-ai-five.vercel.app)
[![Hardware Firmware](https://img.shields.io/badge/Firmware-ESP32%20v3.2%20BLE-blue?style=flat&logo=arduino)](firmware/third_eye_firmware/third_eye_firmware.ino)
[![CI Tests](https://img.shields.io/badge/CI-Passing-brightgreen?style=flat&logo=githubactions)](.github/workflows/tests.yml)
[![Web Speech API](https://img.shields.io/badge/Web%20Speech-Active-purple?style=flat)](https://third-eye-ai-five.vercel.app/mobile)

An assistive electronic mobility aid and vision companion designed for visually impaired individuals. The system integrates dual ultrasonic sensors (forward obstacle detection and downward drop-off/stair detection) on an ESP32 wearable unit, a low-latency talking smartphone companion with Gemini 2.5 Flash, and a caregiver tele-care dashboard.

> [!IMPORTANT]
> **Orientation & Mobility (O&M) Protocol:** Third Eye is an experimental secondary mobility aid. It must **never** replace a white cane or guide dog.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ESP32 WEARABLE UNIT                             │
│                                                                        │
│   [Forward HC-SR04] ───┐                                               │
│   (Obstacles 0-150cm)  ├───► [Med3 Sliding Filter] ───► [Vibration]   │
│   [Downward HC-SR04] ──┤     (Rejects outliers)         (Palm Coin)    │
│   (Ground 45° drops)   │                                               │
│   [SOS Button (1.5s)] ─┘                                               │
│            │                                                           │
│            │ BLE UART (Nordic UART Service) or USB Serial              │
│            ▼                                                           │
│   ┌────────────────────────────────────────────────────────────┐       │
│   │               SMARTPHONE TALKING COMPANION                 │       │
│   │   • Rear Camera (Downscaled 440x330 ~18KB)                 │       │
│   │   • Hands-Free Continuous Voice Assistant                  │       │
│   │   • Instant Double-Tap SOS Dispatch                        │       │
│   │   • 0.58s Gemini 2.5 Flash Vision Analysis                 │       │
│   └────────────────────────────┬───────────────────────────────┘       │
└────────────────────────────────┼───────────────────────────────────────┘
                                 │ Real-time Cross-Sync
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     CAREGIVER TELE-CARE DASHBOARD                      │
│        Live Telemetry • SOS Dispatch & Ack • Map Link • Audit Log      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Repository Structure

```
.
├── README.md                                  # Complete architecture & setup documentation
├── TEST_REPORT.md                             # Benchmark evaluation & empirical test methodology
├── .github/workflows/
│   └── tests.yml                              # GitHub Actions CI for firmware logic & benchmarks
├── firmware/
│   └── third_eye_firmware/
│       ├── third_eye_firmware.ino             # Canonical ESP32 v3.2 firmware (BLE UART, Watchdog)
│       └── third_eye_logic.h                  # Hardware-independent logic (Med3, motorOn, groundState)
├── tools/
│   └── measure.py                             # Real physical distance measurement & calibration logger
├── tests/
│   ├── native/
│   │   └── test_logic.cpp                     # C++ unit tests for firmware logic & state machines
│   └── test_system_benchmarks.py              # Statistical simulation & failure-recovery tests
├── web_dashboard/
│   ├── index.html                             # Caregiver dashboard matching eye mockup
│   ├── app.js                                 # Web Serial, cross-device sync & telemetry engine
│   ├── mobile.html                            # Minimalist talking mobile companion (no visual clutter)
│   ├── mobile.js                              # Gesture engine, BLE client, autonomous vision co-pilot
│   ├── style.css                              # Glassmorphism dark theme with eye artwork
│   ├── assets/                                # Eye artwork and mockup references
│   ├── package.json                           # Web dashboard configuration
│   └── vercel.json                            # Serverless edge deployment settings
└── ai_backend/
    ├── companion_ai.py                        # Python client with non-blocking Gemini queue & serial reader
    ├── server.py                              # Flask backend with authenticated endpoints
    └── requirements.txt                       # Python dependencies
```

---

## 3. Hardware Schematics & Wiring

### 3.1 Pin Map

| Peripheral | Component Pin | ESP32 GPIO | Wiring Details |
|---|---|---|---|
| **Forward HC-SR04** | VCC | 5V (VIN) | 5V Power Supply (add 100nF decoupling capacitor) |
| | GND | GND | Ground |
| | TRIG | **GPIO 5** | 10 $\mu$s Sonic Trigger Pulse |
| | ECHO | **GPIO 18** | Voltage divided to 3.3V (1k$\Omega$ in series, 2k$\Omega$ to GND) |
| **Downward HC-SR04** | TRIG_DOWN | **GPIO 22** | Angled 45° toward ground for drop-off detection |
| | ECHO_DOWN | **GPIO 23** | Voltage divided to 3.3V (1k$\Omega$ in series, 2k$\Omega$ to GND) |
| **Haptic Vibration Motor** | Transistor Base | **GPIO 19** | BC547 NPN base via 1k$\Omega$; 1N4148 diode + 100nF cap across motor |
| **Tactile SOS Button** | Pin 1 | **GPIO 4** | Active LOW (internal pull-up enabled; 1.5s hold to fire) |
| | Pin 2 | GND | Ground reference |
| **Battery Divider** | Midpoint | **GPIO 34** | 100k$\Omega$ / 100k$\Omega$ voltage divider from LiPo+ (ADC1_CH6) |

### 3.2 Power Subsystem
* **Battery:** 3.7 V LiPo battery with protection circuit.
* **Charge-and-Boost:** A 5V step-up booster module powers the ESP32 VIN pin and HC-SR04 sensors. *Never connect a 3.7V/4.2V LiPo directly to the 3.3V pin.*
* **Decoupling:** Place a **470 $\mu$F electrolytic capacitor** across the 5V rail near the ESP32 and **100 nF ceramic capacitors** at each ultrasonic sensor to prevent brownouts during BLE transmit bursts.

### 3.3 Mounting & Ergonomics
* **Mounting:** Wear the unit in a **chest harness or belt clip**, positioning the phone camera and forward sensor along the same optical axis.
* **Sensor Angles:** The forward sensor points straight ahead at torso height. The downward sensor points down at $\approx 45^\circ$ toward the walking path to detect stairs, curbs, and drop-offs.
* **Haptics:** Place the vibration coin motor firmly against the body or palm. Isolate the sensors from the motor using foam to avoid acoustic feedback.

---

## 4. Boot Sequence & Tactile Vibration Codes

| Event | Pattern | Meaning |
|---|---|---|
| **Boot Complete** | Two short pulses (100 ms on / 80 ms off) | ESP32 initialized and BLE advertising. |
| **Forward Sensor Test** | 1 long pulse (400 ms) | Pass: Palm detected within 3s of boot. |
| | 5 rapid pulses (60 ms on / 60 ms off) | Fault: Forward sensor echo timeout. |
| **Ground Calibration** | 1 long pulse (400 ms) | Pass: Ground baseline calibrated. |
| | 5 rapid pulses | Fault: Ground reflection missing, drop detection disabled. |
| **150 to 50 cm** | Proportional light pulses (70 ms on) | Pulse interval speeds up as object approaches. |
| **$\le$ 50 cm** | **Continuous Solid Vibration** | **Critical Danger Zone: Stop immediately.** |
| **Drop-Off Detected** | Triple pulse every second | Curb, cliff, or stairs going down ahead. |
| **SOS Dispatched** | 0.6 s solid buzz | Hardware button held for 1.5 s. |
| **Stuck Echo Fault** | 5 rapid pulses every 6 seconds | ECHO line stuck high (wiring defect). |
| **Low Battery (< 3.5V)** | Double pulse every 30 seconds | Battery low warning. |

---

## 5. Communications Protocol (USB Serial & BLE UART)

The firmware emits ASCII lines at 115200 baud over USB and broadcasts them over the **Nordic UART Service (NUS)**:
* **Service UUID:** `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
* **TX Characteristic:** `6e400003-b5a3-f393-e0a9-e50e24dcca9e` (Notify)

| Line | Meaning |
|---|---|
| `DIST:<n>` | Forward distance in cm. `151` indicates clear path beyond 150 cm. |
| `DOWN:<n>` | Ground distance in cm. `999` indicates no echo. |
| `BATTERY:<pct>` | Battery percentage (0–100%), emitted every 5 s. |
| `TRIGGER_AI:<n>` | Obstacle entered the 60 cm zone, triggering visual analysis. |
| `EVENT:SOS_BUTTON` | Tactile push button held for 1.5 seconds. |
| `EVENT:DROP` | Ground distance jump detected (curb or stair drop-off). |
| `WARN:LOW_BATTERY` | LiPo voltage fell below 3.5 V. |
| `FAULT:ECHO_STUCK` | Forward ECHO line stuck high (hardware wiring fault). |
| `SYSTEM_READY:V3_2` | Boot and sensor calibration completed. |

---

## 6. Quick Start Guide

### Step 1: Flash Firmware via Arduino IDE
1. Install the **ESP32 Board Package** and **NimBLE-Arduino** library in Arduino IDE.
2. Open [`firmware/third_eye_firmware/third_eye_firmware.ino`](firmware/third_eye_firmware/third_eye_firmware.ino).
3. Select **Tools $\to$ Board $\to$ ESP32 Dev Module**.
4. Set Upload Speed to `115200` and click **Upload**.

### Step 2: Open Mobile Companion
On the blind user's smartphone:
1. Open **[https://third-eye-ai-five.vercel.app/mobile](https://third-eye-ai-five.vercel.app/mobile)** in Chrome (Android) or Bluefy (iOS).
2. Tap the **Bluetooth icon** at the top right to pair wirelessly with `ThirdEye`.
3. The phone continuously speaks path descriptions and listens for questions hands-free.
4. **Emergency:** Double-tap the screen anywhere or hold the glove button for 1.5s to dispatch SOS.

### Step 3: Open Caregiver Dashboard
On the caregiver's device:
1. Open **[https://third-eye-ai-five.vercel.app](https://third-eye-ai-five.vercel.app)** to view live telemetry, acknowledge SOS alerts, and inspect the safety audit trail.

---

## 7. Testing & Verification

* **Native Logic Tests:** Run `./test_logic` (compiled from [`tests/native/test_logic.cpp`](tests/native/test_logic.cpp)) to verify `Med3` outlier rejection, ground state classification, and haptic state machines.
* **Simulation Benchmarks:** Run `python3 tests/test_system_benchmarks.py` to evaluate the software state machine under synthetic Gaussian noise models.
* **Real Hardware Measurements:** Run `python3 tools/measure.py --distance 50` while connected to the ESP32 to record real physical distance error, mean, and standard deviation.

---

## 8. Privacy & Data Protection

* **Ephemeral Frame Transmission:** Camera frames captured for obstacle and hazard detection are downscaled to 440×330 px ($\approx 18\text{ KB}$) and transmitted over encrypted TLS to the Google Gemini API. No camera frames or video streams are stored on remote servers.
* **Local Storage:** API keys are stored exclusively in the user's browser `localStorage` and are never logged or proxied.
* **Secondary Aid Disclaimer:** Ultrasonic sensors have physical limits (absorption by soft fabrics, specular acoustic reflections from smooth angles, narrow 30° acoustic beam). Users must always maintain primary white cane scanning.
