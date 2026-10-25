# Third Eye AI — Assistive Vision & Tele-Care Guardian

An assistive navigation and tele-care ecosystem designed for blind and visually impaired individuals. It combines an **ESP32 ultrasonic reflex glove** for instantaneous sub-15ms haptic obstacle warnings, **multimodal AI vision (Google Gemini 2.5 Flash)** for environmental hazard identification and text/currency reading, hands-free **voice wake activation**, and an interactive **caregiver tele-care guardian dashboard**.

---

## 1. System Architecture

Third Eye operates as a layered safety architecture to ensure that **local tactile reflexes operate independently of cloud connectivity**:

```
+----------------------------------------------------------------------------------------------------+
|                                      THIRD EYE AI ECOSYSTEM                                        |
+----------------------------------------------------------------------------------------------------+
         |                                       |                                    |
         v                                       v                                    v
  [ Layer 1: Reflex Glove ]             [ Layer 2: AI Copilot ]            [ Layer 3: Tele-Care Portal ]
  (ESP32 + Ultrasonic + Haptic)         (Phone / WebCam + Gemini AI)       (Interactive Web Dashboard)
  - 5-sample median filter              - Hazard-first spatial guidance    - Live proximity sonar radar
  - Non-blocking haptic buzz            - Rapid OCR (Signs & menus)        - Timestamped audit timeline
  - Sub-15ms local latency              - Banknote currency recognition    - Decoupled Caregiver SOS
  - Hardware tactile SOS button         - 7s timeout & offline fallback    - Hardware distance simulator
  - Operates 100% offline               - Ephemeral frame processing       - JSON audit log export
```

### Decoupled Safety Logic
- **Obstacle Proximity Warnings:** When an obstacle is detected within $\le 25\text{ cm}$, the glove triggers an immediate continuous haptic buzz and localized speech warning (*"Emergency stop. Obstacle 20 cm ahead"*). This is a **local navigational hazard alert**, not a panic alert.
- **Caregiver SOS Emergency System:** Separated from obstacle proximity. Triggered exclusively by user intent: physical button on glove (`EVENT:SOS_BUTTON`), voice emergency command (*"SOS"*, *"Call caregiver"*, *"I fell"*), or the dashboard emergency button. Tracks delivery status through a caregiver acknowledgement loop.

---

## 2. Repository Structure

```
.
├── README.md                          # Project documentation and setup guide
├── TEST_REPORT.md                     # Measured benchmarks, latency and error tables
├── firmware/
│   ├── third_eye_firmware.ino         # ESP32 v3.0 production firmware (Median filter, non-blocking)
│   └── third_eye_firmware/
│       └── third_eye_firmware.ino     # Arduino IDE sketch compatibility copy
├── web_dashboard/
│   ├── index.html                     # Responsive Guardian dashboard HUD
│   ├── app.js                         # Web Serial, Web Speech voice assistant, Gemini AI flow
│   ├── style.css                      # Clean, accessible styling & layout
│   ├── server.py                      # Local lightweight Python development server
│   ├── package.json                   # Web dashboard metadata & scripts
│   ├── vercel.json                    # Serverless deployment configuration
│   └── api/
│       └── tts.js                     # Google Cloud HD Speech serverless endpoint
├── ai_backend/
│   ├── server.py                      # Standalone Python Flask backend (alternative to browser AI)
│   ├── companion_ai.py                # Python Gemini client & local pyttsx3 worker
│   ├── requirements.txt               # Python backend dependencies
│   └── .env.example                   # Backend environment variables
└── tests/
    └── test_system_benchmarks.py      # Automated benchmark suite and unit tests
```

---

## 3. Hardware Schematics & Pinout

### ESP32 WROOM DevKit Wiring

| Peripheral | Component Pin | ESP32 GPIO Pin | Function |
|---|---|---|---|
| **HC-SR04 Ultrasonic (Forward)** | VCC | 5V (VIN) | 5V Power Supply |
| | GND | GND | Ground |
| | TRIG | **GPIO 5** | 10 $\mu$s Sonic Trigger Pulse |
| | ECHO | **GPIO 18** | Echo Duration Input (Voltage divided to 3.3V) |
| **Optional Downward Drop-Off** | TRIG_DOWN | **GPIO 22** | Secondary curb/stair drop-off detection |
| | ECHO_DOWN | **GPIO 23** | Secondary echo receiver |
| **Haptic Coin Vibration Motor** | Transistor Base | **GPIO 19** | BC547 NPN driver through 1k$\Omega$ resistor |
| **Tactile SOS Emergency Button** | Pin 1 | **GPIO 4** | Active LOW (internal pull-up enabled) |
| | Pin 2 | GND | Ground reference |
| **Battery Voltage Monitor** | Voltage Divider Out | **GPIO 34** | ADC1 input (3.7V LiPo scaled to 0–3.3V) |

---

## 4. Quick Start Guide

### Step 1: Flash the ESP32 Hardware Firmware
1. Open [`firmware/third_eye_firmware.ino`](firmware/third_eye_firmware.ino) in **Arduino IDE**.
2. Select your board: **Tools $\to$ Board $\to$ ESP32 Arduino $\to$ ESP32 Dev Module**.
3. Connect your ESP32 via USB and select the serial port: **Tools $\to$ Port $\to$ `/dev/ttyUSB0`** (Linux) or **`/dev/cu.usbserial-...`** (macOS).
4. Set Upload Speed to **`115200`** and click **Upload**.
5. Once uploaded, the coin motor will pulse twice to signal successful initialization (`SYSTEM_READY:THIRD_EYE_V3`).

### Step 2: Launch the Web Guardian Dashboard
From the root of the project directory:

```bash
# Navigate to web dashboard directory
cd web_dashboard

# Start the local server
python3 server.py
```

The server opens automatically at **`http://localhost:8080`**.  
*Alternatively, access the live cloud deployment at:* **[https://third-eye-ai-five.vercel.app](https://third-eye-ai-five.vercel.app)**.

### Step 3: Connect Hardware via Web Serial
1. Open Google Chrome or Microsoft Edge.
2. In the top right of the dashboard, click **"Connect ESP32"**.
3. Select your ESP32 USB Serial port from the browser prompt.
4. The dashboard will display live sonar telemetry, haptic states, and battery level.

### Step 4: Open Blind User Mobile Companion
On the visually impaired person's smartphone:
1. Open **[https://third-eye-ai-five.vercel.app/mobile](https://third-eye-ai-five.vercel.app/mobile)** in **Safari (iOS)** or **Chrome (Android)**.
2. Tap the screen once to authorize camera and microphone permissions.
3. The app is completely autonomous:
   - **Continuous Autonomous Co-Pilot**: Looks ahead continuously and speaks obstacles, doors, and path clearance.
   - **Two-Way Voice Interaction**: User talks naturally (e.g. *"What is ahead?"*, *"Read the sign"*, *"What currency is this?"*); the assistant listens and replies immediately.
   - **Zero-Sight Emergency SOS**: **Tapping the screen twice anywhere** immediately sounds the alert and notifies the caregiver dashboard.
   - **Sub-Second Latency**: Downscaled 18KB frame encoding + Gemini 2.5 Flash + native speech synthesis.

---

## 5. Browser Compatibility & Secure Context

The Web Guardian Dashboard utilizes modern web capabilities that require specific browser support:

| Feature | Supported Browsers | Security Requirement | Notes |
|---|---|---|---|
| **Web Serial API** | Google Chrome (89+), MS Edge (89+), Opera | **Secure Context** (`https://` or `localhost`) | **Unsupported on iOS Safari and Mozilla Firefox** due to browser engine policies. Use Chrome on Android or Desktop. |
| **Camera (`getUserMedia`)** | All modern browsers | **HTTPS** or `localhost` | High-definition rear camera (`facingMode: environment`). |
| **Web Speech API** | Chrome, Edge, Safari | **HTTPS** or `localhost` | Instantaneous speech recognition with `interimResults = true`. |
| **Cloud HD Audio (`/api/tts`)** | All modern HTML5 browsers | None | Google Cloud Neural TTS voice output with mutex lock. |

### Serial Connection Troubleshooting
- **Port not appearing in prompt:** Verify USB data cable (charge-only cables will not show up) and install CP2102 / CH340 USB drivers if needed.
- **Access Denied on Linux:** Grant dialout group permission: `sudo usermod -a -G dialout $USER` and restart terminal.
- **Permission Blocked in Browser:** Ensure site permissions allow Serial devices under `chrome://settings/content/serialPorts`.

---

## 6. Standout Features & Capabilities

### P0: Core Safety & Filtered Telemetry
- **5-Sample Median Filter:** Rejects ultrasonic multipath anomalies and sporadic zero readings.
- **Hardware Watchdog:** If serial communication drops for $> 1.8\text{ seconds}$, the dashboard flags a sensor fault, alerts the user verbally, and switches to the software simulator.
- **Non-Blocking Haptic State Machine:** Proportional tactile buzzing that scales with proximity without blocking sensor loops.

### P1: Actionable Guidance & Caregiver Tele-Care
- **Hazard-First Directional Audio:** Prompts force immediate actionable outputs (e.g. *"STOP: chair at 11 o'clock. Step right"* in under 15 words).
- **Decoupled Caregiver SOS:** User-triggered SOS alerts display an emergency banner, trigger phone vibration, and enter an acknowledgement loop. When a caregiver clicks **"Acknowledge Alert"**, the system verbally confirms: *"Caregiver has acknowledged your emergency alert. Help is on the way."*
- **Audit Event Timeline:** Every proximity hazard, AI scan, sensor fault, and SOS dispatch is timestamped and auditable. Exportable as JSON for clinical mobility evaluations.

### P2: Hands-Free Voice Assistant
Say any of the following commands hands-free:
- **"Hey help me out"** or **"Start"** $\to$ Initiates full hazard assessment ahead.
- **"Scan"** $\to$ Scans path for physical obstacles.
- **"Read text"** $\to$ OCR mode for signs, menus, labels.
- **"Currency"** $\to$ Identifies banknotes and coins.
- **"Distance"** $\to$ Announces ultrasonic range in centimeters.
- **"SOS"** / **"Emergency"** $\to$ Dispatches emergency alert to caregiver.
- **"Stop"** $\to$ Silences audio immediately.

---

## 7. Measured Benchmark Results

Full benchmarking methodology and data are available in [`TEST_REPORT.md`](TEST_REPORT.md).

- **Distance Accuracy:** $\pm 0.10\text{ cm}$ absolute error between 10 cm and 50 cm; $< 0.30\text{ cm}$ up to 200 cm.
- **Response Latency:**
  - Ultrasonic Echo to Coin Motor Vibration: **11.8 ms** (immediate tactile reflex).
  - Web Serial Telemetry to Dashboard Radar: **14.2 ms**.
  - Voice Command to Gemini Spoken Guidance: **1.14 s**.
- **Obstacle Detection Reliability:**
  - Drywall / Solid Walls: **98.0%** detection.
  - Smooth Wood (Doors / Chairs): **97.0%** detection.
  - Soft Clothing / Fabric: **86.0%** detection (acoustic absorption).
  - Clear Glass Windows: **71.0%** detection (specular deflection).
  - Low Curbs / Drop-Offs (Forward Sensor): **24.0%** (indicates physical requirement for downward sensor).
- **Battery Life:** $\approx 14.2\text{ hours}$ continuous operation on 1200mAh LiPo battery.

---

## 8. Privacy, Data Minimization & Safety Policy

1. **Ephemeral Image Processing:** Camera frames captured during AI scans are processed in-memory only. Full-resolution frames are transmitted over encrypted TLS directly to Google Gemini and are wiped from browser memory immediately after inference. Raw images are never saved to disk or third-party servers.
2. **Local Storage Privacy:** Your Gemini API key, scan history, and custom preferences are stored exclusively on your device's browser `localStorage`.
3. **Emergency Alert Limitations:** SOS alerts rely on active network connectivity. In remote areas without cellular or Wi-Fi coverage, the system acts as an audio-visual beacon locally.
4. **Orientation & Mobility Disclaimer:** Third Eye AI is an **experimental secondary aid**. It is not certified as a medical device and must **never** replace a primary white cane or guide dog. Users should test in controlled environments under the supervision of certified Orientation & Mobility (O&M) specialists.
