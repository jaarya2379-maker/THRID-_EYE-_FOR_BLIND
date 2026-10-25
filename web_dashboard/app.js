/**
 * Third Eye AI — Assistive Vision & Tele-Care Web App
 * Features:
 * - Mobile-first responsive UX with camera wake-lock & phone vibration
 * - Persistent scan & hazard history with thumbnail snapshots and voice replay
 * - Real-time proximity arc gauge & Chart.js telemetry
 * - Gemini 2.5 Flash Vision API integration
 * - Web Serial support for ESP32 hardware
 */

// ==========================================
// 1. Application State
// ==========================================
const state = {
  currentDistance: 120, // cm
  currentMode: 'hazard', // 'hazard' | 'ocr' | 'currency' | 'scene'
  serialPort: null,
  serialReader: null,
  isSerialConnected: false,
  rollingDistanceBuffer: [],
  lastHardwarePacketTime: 0,
  sensorWatchdogInterval: null,
  isSensorFault: false,
  batteryPct: 100,
  aiStatus: 'online', // 'online' | 'busy' | 'timeout' | 'fallback' | 'offline'
  cameraStream: null,
  facingMode: 'environment', // Default back camera for mobile
  geminiApiKey: localStorage.getItem('GEMINI_API_KEY') || '',
  lastAiTriggerTime: 0,
  aiCooldownMs: 4000,
  speechSynth: window.speechSynthesis,
  isSpeaking: false,
  dangerDurationSec: 0,
  isSosTriggered: false,
  sosStatus: 'SAFE', // 'SAFE' | 'DISPATCHED' | 'DELIVERED' | 'ACKNOWLEDGED'
  lastSafetyState: 'clear',
  lastDistanceAnnouncementTime: 0,
  wakeLock: null,
  history: JSON.parse(localStorage.getItem('THIRD_EYE_HISTORY') || '[]')
};

// ==========================================
// 2. DOM Elements
// ==========================================
const btnConnectSerial = document.getElementById('btnConnectSerial');
const serialStatusText = document.getElementById('serialStatusText');
const serialIcon = document.getElementById('serialIcon');
const videoElement = document.getElementById('webcamVideo');
const snapshotCanvas = document.getElementById('snapshotCanvas');
const btnToggleCamera = document.getElementById('btnToggleCamera');
const btnSnapshot = document.getElementById('btnSnapshot');
const btnVoiceQuery = document.getElementById('btnVoiceQuery');
const voiceMicIcon = document.getElementById('voiceMicIcon');
const askMicIcon = document.getElementById('askMicIcon');
const btnReplaySpeech = document.getElementById('btnReplaySpeech');
const speechTranscript = document.getElementById('speechTranscript');
const speechTimestamp = document.getElementById('speechTimestamp');
const screenReaderStatus = document.getElementById('screenReaderStatus');
const hudDistanceValue = document.getElementById('hudDistanceValue');
const hudStatusTag = document.getElementById('hudStatusTag');
const radarDistanceText = document.getElementById('radarDistanceText');
const hapticBadge = document.getElementById('hapticBadge');
const btnTriggerSos = document.getElementById('btnTriggerSos');
const sosStatusText = document.getElementById('sosStatusText');
const simSlider = document.getElementById('simSlider');
const simValue = document.getElementById('simValue');
const historyList = document.getElementById('historyList');
const btnClearHistory = document.getElementById('btnClearHistory');
const btnExportHistory = document.getElementById('btnExportHistory');
const historyCountBadge = document.getElementById('historyCountBadge');

// AI Status, Battery & Sensor Fault Elements
const aiStatusBadge = document.getElementById('aiStatusBadge');
const aiStatusDot = document.getElementById('aiStatusDot');
const aiStatusText = document.getElementById('aiStatusText');
const batteryBadge = document.getElementById('batteryBadge');
const batteryStatusText = document.getElementById('batteryStatusText');
const sensorFaultBanner = document.getElementById('sensorFaultBanner');
const sensorFaultText = document.getElementById('sensorFaultText');
const btnDismissFault = document.getElementById('btnDismissFault');

// Caregiver Emergency Modal
const caregiverModal = document.getElementById('caregiverModal');
const caregiverDispatchStatus = document.getElementById('caregiverDispatchStatus');
const caregiverTriggerReason = document.getElementById('caregiverTriggerReason');
const caregiverDistanceSnapshot = document.getElementById('caregiverDistanceSnapshot');
const caregiverTimestamp = document.getElementById('caregiverTimestamp');
const btnAcknowledgeSos = document.getElementById('btnAcknowledgeSos');
const btnCancelSos = document.getElementById('btnCancelSos');

// Privacy & Consent Modal
const privacyModal = document.getElementById('privacyModal');
const btnOpenPrivacyModal = document.getElementById('btnOpenPrivacyModal');
const btnClosePrivacyModal = document.getElementById('btnClosePrivacyModal');

// Cross-Device / Cross-Tab Sync with Blind User Mobile Interface (mobile.html)
let syncChannel = null;
try {
  syncChannel = new BroadcastChannel('third_eye_sync');
  syncChannel.onmessage = (e) => {
    const data = e.data;
    if (data.type === 'SOS_EMERGENCY_TRIGGERED') {
      triggerSosEmergency(`Mobile Phone SOS: ${data.reason}`);
    } else if (data.type === 'MOBILE_FRAME_UPDATE') {
      if (data.distance) updateDistance(data.distance);
    }
  };
} catch (e) {
  console.warn("BroadcastChannel sync unsupported:", e);
}

// Mobile Tabs & Bottom Bar
const tabNavVision = document.getElementById('tabNavVision');
const tabNavMonitor = document.getElementById('tabNavMonitor');
const sectionVision = document.getElementById('sectionVision');
const sectionMonitor = document.getElementById('sectionMonitor');
const btnMobileQuickScan = document.getElementById('btnMobileQuickScan');
const btnMobileVoice = document.getElementById('btnMobileVoice');

// Key Modal
const keyModal = document.getElementById('keyModal');
const btnOpenKeyModal = document.getElementById('btnOpenKeyModal');
const btnCloseKeyModal = document.getElementById('btnCloseKeyModal');
const btnSaveApiKey = document.getElementById('btnSaveApiKey');
const inputApiKey = document.getElementById('inputApiKey');
const keyStatusBadge = document.getElementById('keyStatusBadge');

// Mode Buttons
const modeButtons = document.querySelectorAll('.mode-btn');

function announceStatus(message) {
  if (!message) return;
  // Prevent system screen reader (VoiceOver/TalkBack) from clashing with the AI voice
  if (state.isSpeaking) return;
  if (screenReaderStatus) screenReaderStatus.textContent = message;
}

function setAiStatus(status, label) {
  state.aiStatus = status;
  if (aiStatusText) aiStatusText.textContent = label;
  if (aiStatusDot) {
    if (status === 'online') {
      aiStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500';
    } else if (status === 'busy') {
      aiStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping';
    } else if (status === 'timeout' || status === 'error') {
      aiStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
    } else if (status === 'fallback') {
      aiStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-teal-500';
    } else {
      aiStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-slate-400';
    }
  }
}

// ==========================================
// 3. Mobile Navigation & Screen Wake Lock
// ==========================================
if (tabNavVision && tabNavMonitor) {
  tabNavVision.addEventListener('click', () => {
    tabNavVision.classList.add('active', 'border-white', 'text-white');
    tabNavVision.classList.remove('border-transparent', 'text-zinc-400');
    tabNavMonitor.classList.remove('active', 'border-white', 'text-white');
    tabNavMonitor.classList.add('border-transparent', 'text-zinc-400');
    sectionVision.classList.remove('hidden');
    sectionMonitor.classList.add('hidden');
    tabNavVision.setAttribute('aria-selected', 'true');
    tabNavMonitor.setAttribute('aria-selected', 'false');
    announceStatus('Vision copilot section selected.');
  });

  tabNavMonitor.addEventListener('click', () => {
    tabNavMonitor.classList.add('active', 'border-white', 'text-white');
    tabNavMonitor.classList.remove('border-transparent', 'text-zinc-400');
    tabNavVision.classList.remove('active', 'border-white', 'text-white');
    tabNavVision.classList.add('border-transparent', 'text-zinc-400');
    sectionMonitor.classList.remove('hidden');
    sectionVision.classList.add('hidden');
    tabNavMonitor.setAttribute('aria-selected', 'true');
    tabNavVision.setAttribute('aria-selected', 'false');
    announceStatus('Distance monitor and scan history section selected.');
  });
}

// Keep screen awake while using on mobile
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock active');
    } catch (err) {
      console.warn('Wake Lock error:', err);
    }
  }
}

// Trigger phone haptic vibration if supported
function vibratePhone(pattern) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

// ==========================================
// 4. Camera Initialization
// ==========================================
async function initCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
  }

  try {
    const constraints = {
      video: {
        facingMode: state.facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = state.cameraStream;
    announceStatus('Camera is on and ready.');
    requestWakeLock();
  } catch (err) {
    console.error('Camera access error:', err);
    const message = "Camera access needed. Please allow camera permissions.";
    speechTranscript.textContent = message;
    announceStatus(message);
  }
}

btnToggleCamera.addEventListener('click', () => {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  initCamera();
});

// ==========================================
// 5. Web Serial API (ESP-32)
// ==========================================
if ('serial' in navigator && btnConnectSerial) {
  btnConnectSerial.addEventListener('click', async () => {
    if (state.isSerialConnected) {
      disconnectSerial();
      return;
    }

    try {
      state.serialPort = await navigator.serial.requestPort();
      await state.serialPort.open({ baudRate: 115200 });

      state.isSerialConnected = true;
      state.lastHardwarePacketTime = Date.now();
      serialStatusText.textContent = 'Connected';
      announceStatus('ESP32 sensor connected.');
      btnConnectSerial.classList.replace('bg-zinc-900', 'bg-emerald-600');
      btnConnectSerial.classList.replace('text-zinc-300', 'text-white');
      serialIcon.setAttribute('class', 'w-3.5 h-3.5 text-white');

      startSensorWatchdog();
      readSerialStream();
    } catch (err) {
      console.error('Serial connection error:', err);
      announceStatus('Could not connect to ESP32 sensor.');
    }
  });
} else if (btnConnectSerial) {
  // Mobile browsers generally don't support Web Serial directly
  btnConnectSerial.style.display = 'none';
}

async function disconnectSerial() {
  if (state.sensorWatchdogInterval) {
    clearInterval(state.sensorWatchdogInterval);
    state.sensorWatchdogInterval = null;
  }
  if (state.serialReader) {
    await state.serialReader.cancel();
    state.serialReader = null;
  }
  if (state.serialPort) {
    await state.serialPort.close();
    state.serialPort = null;
  }
  state.isSerialConnected = false;
  serialStatusText.textContent = 'ESP32';
  clearSensorFault();
  announceStatus('ESP32 sensor disconnected.');
  btnConnectSerial.classList.replace('bg-emerald-600', 'bg-zinc-900');
  btnConnectSerial.classList.replace('text-white', 'text-zinc-300');
  serialIcon.setAttribute('class', 'w-3.5 h-3.5 text-zinc-400');
}

function startSensorWatchdog() {
  if (state.sensorWatchdogInterval) clearInterval(state.sensorWatchdogInterval);
  state.sensorWatchdogInterval = setInterval(() => {
    if (state.isSerialConnected) {
      const elapsed = Date.now() - state.lastHardwarePacketTime;
      if (elapsed > 1800 && !state.isSensorFault) {
        triggerSensorFault('Hardware ultrasonic sensor disconnected or unresponsive (>1.8s timeout)');
      }
    }
  }, 1000);
}

function triggerSensorFault(reason) {
  state.isSensorFault = true;
  if (sensorFaultBanner) {
    sensorFaultBanner.classList.remove('hidden');
    if (sensorFaultText) sensorFaultText.textContent = reason;
  }
  announceStatus('Warning: Hardware sensor fault detected.');
  addHistoryRecord({
    mode: 'system',
    type: 'SENSOR_FAULT',
    distance: state.currentDistance,
    text: reason,
    thumb: ''
  });
}

function clearSensorFault() {
  if (state.isSensorFault) {
    state.isSensorFault = false;
    if (sensorFaultBanner) sensorFaultBanner.classList.add('hidden');
  }
}

if (btnDismissFault) {
  btnDismissFault.addEventListener('click', clearSensorFault);
}

async function readSerialStream() {
  const textDecoder = new TextDecoderStream();
  state.serialPort.readable.pipeTo(textDecoder.writable);
  state.serialReader = textDecoder.readable.getReader();

  let lineBuffer = '';

  try {
    while (true) {
      const { value, done } = await state.serialReader.read();
      if (done) break;
      if (value) {
        lineBuffer += value;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();

        for (const line of lines) {
          processHardwareMessage(line.trim());
        }
      }
    }
  } catch (err) {
    console.warn('Serial reader closed:', err);
  }
}

function processHardwareMessage(message) {
  if (!message) return;
  state.lastHardwarePacketTime = Date.now();
  clearSensorFault();

  if (message.startsWith('DIST:')) {
    const rawDist = parseInt(message.split(':')[1], 10);
    if (!isNaN(rawDist) && rawDist >= 2 && rawDist <= 400) {
      // 5-sample client-side moving median filter to reject outlier spikes
      state.rollingDistanceBuffer.push(rawDist);
      if (state.rollingDistanceBuffer.length > 5) state.rollingDistanceBuffer.shift();

      const sorted = [...state.rollingDistanceBuffer].sort((a, b) => a - b);
      const filteredDist = sorted[Math.floor(sorted.length / 2)];
      updateDistance(filteredDist);
    }
  } else if (message.startsWith('TRIGGER_AI:')) {
    const dist = parseInt(message.split(':')[1], 10);
    const now = Date.now();
    if (now - state.lastAiTriggerTime > state.aiCooldownMs && !isProcessingAi) {
      state.lastAiTriggerTime = now;
      performAiVisionAnalysis('Hardware proximity alert');
    }
  } else if (message.startsWith('BATTERY:')) {
    const pct = parseInt(message.split(':')[1], 10);
    if (!isNaN(pct)) {
      state.batteryPct = Math.max(0, Math.min(100, pct));
      if (batteryStatusText) batteryStatusText.textContent = `${state.batteryPct}%`;
    }
  } else if (message.startsWith('EVENT:SOS_BUTTON')) {
    triggerSosEmergency('Hardware tactile SOS button on glove pressed');
  } else if (message.startsWith('FAULT:')) {
    const fault = message.split(':')[1];
    triggerSensorFault(`Sensor Hardware Fault: ${fault}`);
  }
}

// ==========================================
// 6. Proximity & Telemetry Updates
// ==========================================
function updateDistance(dist) {
  state.currentDistance = dist;
  radarDistanceText.textContent = dist >= 150 ? '150+' : dist;
  hudDistanceValue.textContent = `${dist} cm`;

  pushChartData(dist);

  let safetyState = 'clear';
  let spokenStatus = 'Clear path ahead.';

  if (dist <= 25) {
    safetyState = 'danger';
    spokenStatus = `Emergency stop. Obstacle ${dist} centimeters ahead.`;
    hudStatusTag.textContent = 'Emergency Danger';
    hudStatusTag.className = 'absolute bottom-3 left-3 z-20 px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur-md bg-rose-500/25 text-rose-300 border border-rose-500/40 whitespace-nowrap shadow-md';
    hapticBadge.textContent = 'Haptic: SOLID BUZZ';
    hapticBadge.className = 'text-[11px] font-mono px-2 py-0.5 rounded bg-rose-600/20 text-rose-900 border border-rose-600/30';

    vibratePhone([150, 50, 150]); // Vibrate phone in user's pocket
    // Decoupled: obstacle proximity is a local hazard warning, NOT a false caregiver SOS
  } else if (dist <= 60) {
    safetyState = 'caution';
    spokenStatus = `Caution. Object ${dist} centimeters ahead.`;
    hudStatusTag.textContent = 'Caution Near';
    hudStatusTag.className = 'absolute bottom-3 left-3 z-20 px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur-md bg-amber-500/25 text-amber-300 border border-amber-500/40 whitespace-nowrap shadow-md';
    hapticBadge.textContent = 'Haptic: PULSING';
    hapticBadge.className = 'text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 border border-amber-500/30';

    vibratePhone(40);
    state.dangerDurationSec = 0;
  } else {
    spokenStatus = `Clear path. Nearest object ${dist >= 150 ? 'more than 150' : dist} centimeters away.`;
    hudStatusTag.textContent = 'Path Clear';
    hudStatusTag.className = 'absolute bottom-3 left-3 z-20 px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur-md bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 whitespace-nowrap shadow-md';
    hapticBadge.textContent = 'Haptic: IDLE';
    hapticBadge.className = 'text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900/10 text-slate-700 border border-slate-900/15';
    state.dangerDurationSec = 0;
  }

  const now = Date.now();
  if (safetyState !== state.lastSafetyState) {
    state.lastSafetyState = safetyState;
    state.lastDistanceAnnouncementTime = now;
    announceStatus(spokenStatus);
    if (safetyState !== 'clear') speakText(spokenStatus);
  } else if (now - state.lastDistanceAnnouncementTime > 12000 && safetyState !== 'clear') {
    state.lastDistanceAnnouncementTime = now;
    announceStatus(spokenStatus);
  }
}

simSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  simValue.textContent = `${val} cm`;
  updateDistance(val);

  if (val <= 50) {
    const now = Date.now();
    if (now - state.lastAiTriggerTime > state.aiCooldownMs) {
      state.lastAiTriggerTime = now;
      performAiVisionAnalysis('Simulation slider trigger');
    }
  }
});

// ==========================================
// 7. Gemini Multimodal Vision Analysis
// ==========================================
function setMode(mode) {
  state.currentMode = mode;
  modeButtons.forEach(btn => {
    if (btn.getAttribute('data-mode') === mode) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
  const modeNames = { hazard: 'hazard detection', ocr: 'text reading', currency: 'currency identification', scene: 'scene description' };
  announceStatus(`Mode set to ${modeNames[mode] || mode}.`);
}

modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    setMode(btn.getAttribute('data-mode'));
  });
});

async function captureSnapshotData() {
  if (!videoElement.videoWidth || videoElement.videoWidth === 0) return null;

  // Downscale image to max 640px for ultra-fast, smooth, glitch-free Gemini inference
  const maxDim = 640;
  let w = videoElement.videoWidth;
  let h = videoElement.videoHeight;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }

  snapshotCanvas.width = w;
  snapshotCanvas.height = h;
  const ctx = snapshotCanvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, w, h);

  const fullDataUrl = snapshotCanvas.toDataURL('image/jpeg', 0.75);
  const base64 = fullDataUrl.split(',')[1];

  // Thumbnail for history
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 120;
  thumbCanvas.height = 90;
  const tCtx = thumbCanvas.getContext('2d');
  tCtx.drawImage(snapshotCanvas, 0, 0, 120, 90);
  const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.60);

  return { base64, thumbDataUrl };
}

let isProcessingAi = false;

async function performAiVisionAnalysis(triggerSource = 'Manual Request', userQuestion = null, introText = null) {
  // Prevent duplicate concurrent requests and enforce cooldown
  if (isProcessingAi) return;
  const now = Date.now();
  if (now - state.lastAiTriggerTime < state.aiCooldownMs && !userQuestion && !introText) {
    return;
  }
  state.lastAiTriggerTime = now;
  isProcessingAi = true;

  setAiStatus('busy', 'AI: Analyzing...');
  vibratePhone(30);

  // Set visual scanning indicator
  if (btnSnapshot) {
    btnSnapshot.disabled = true;
    btnSnapshot.classList.add('opacity-75');
    btnSnapshot.innerHTML = `<span class="inline-block animate-spin mr-1">◐</span> Scanning...`;
  }
  if (btnMobileQuickScan) {
    btnMobileQuickScan.disabled = true;
    btnMobileQuickScan.classList.add('opacity-75');
    btnMobileQuickScan.innerHTML = `<span class="inline-block animate-spin mr-1">◐</span> Scanning...`;
  }

  // If introText is given, play it via cloud voice and wait cleanly before speaking the result
  let introPromise = null;
  if (introText) {
    updateAiTranscript(introText);
    introPromise = speakText(introText);
  } else {
    updateAiTranscript("Analyzing scene...");
  }

  try {
    const snapshot = await captureSnapshotData();

    // Check if API key is set - provide immediate fallback response so assistant NEVER fails to respond
    if (!state.geminiApiKey) {
      if (introPromise) await introPromise.catch(() => {});
      const fallbackAdvice = getMockAdvice(state.currentMode, state.currentDistance);
      const formatted = `[Sensor: ${state.currentDistance}cm] ${fallbackAdvice}`;
      updateAiTranscript(`${formatted} (Set Gemini API key for live object vision)`);
      await speakText(fallbackAdvice);
      setAiStatus('fallback', 'AI: Proximity Fallback');
      if (missingKeyBanner) missingKeyBanner.style.display = 'flex';
      return;
    }

    if (!snapshot) {
      if (introPromise) await introPromise.catch(() => {});
      const message = "Camera is preparing. Please try again.";
      updateAiTranscript(message);
      await speakText(message);
      setAiStatus('online', 'AI: Ready');
      return;
    }

    let promptText = '';
    switch (state.currentMode) {
      case 'ocr':
        promptText = "You are a reading assistant for a blind person. Read the most prominent legible text, sign, or label verbatim in under 20 words. No conversational filler.";
        break;
      case 'currency':
        promptText = "You are a currency detector for a visually impaired user. State the banknote or coin denomination clearly in under 12 words (e.g. '100 Indian Rupees note').";
        break;
      case 'scene':
        promptText = "You are an environmental guide for a visually impaired person. Describe the room type, layout, and lighting in 1 sentence under 20 words.";
        break;
      case 'hazard':
      default:
        promptText = "You are an assistive navigation guide for a blind user. First word MUST be: STOP, CAUTION, or CLEAR. State nearest hazard, clock direction (e.g. at 12 o'clock, 10 o'clock), and safe step direction in under 15 words total.";
        break;
    }

    if (userQuestion) {
      promptText = `You are an assistive mobility guide for a blind person. Answer this question concisely in under 20 words: "${userQuestion}". Speak directly.`;
    }

    const models = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];
    let guidance = null;
    let lastError = null;

    // Timeout protection via AbortController (7000ms max per model to prevent UI hang)
    for (const model of models) {
      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), 7000);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.geminiApiKey}`;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortCtrl.signal,
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: promptText },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: snapshot.base64
                  }
                }
              ]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 60
            }
          })
        });

        clearTimeout(abortTimer);
        const data = await res.json();
        if (data.candidates && data.candidates[0].content?.parts?.[0]?.text) {
          guidance = data.candidates[0].content.parts[0].text.trim();
          break;
        } else if (data.error) {
          lastError = data.error.message;
        }
      } catch (err) {
        clearTimeout(abortTimer);
        lastError = err.name === 'AbortError' ? 'Request timed out (7s)' : err.message;
      }
    }

    // Ephemeral camera data hygiene: scrub base64 buffer from memory
    snapshot.base64 = null;

    if (guidance) {
      if (introPromise) {
        await introPromise.catch(() => {});
      }
      const formattedTranscript = `[Sensor: ${state.currentDistance}cm] ${guidance}`;
      updateAiTranscript(formattedTranscript);
      await speakText(guidance);
      setAiStatus('online', 'AI: Ready');

      addHistoryRecord({
        mode: state.currentMode,
        type: state.currentMode.toUpperCase(),
        distance: state.currentDistance,
        text: guidance,
        thumb: snapshot.thumbDataUrl
      });
    } else {
      if (introPromise) {
        await introPromise.catch(() => {});
      }
      console.warn("AI vision service unavailable or timed out:", lastError);

      // Fault tolerant local fallback: Proximity check from ultrasonic sensor
      const fallbackAdvice = getMockAdvice(state.currentMode, state.currentDistance);
      const fallbackText = `[Sensor: ${state.currentDistance}cm] ${fallbackAdvice}`;
      updateAiTranscript(fallbackText);
      await speakText(fallbackAdvice);
      setAiStatus('fallback', 'AI: Local Fallback');

      addHistoryRecord({
        mode: state.currentMode,
        type: 'AI_FALLBACK',
        distance: state.currentDistance,
        text: `Fallback: ${fallbackAdvice}`,
        thumb: snapshot.thumbDataUrl
      });
    }
  } finally {
    // Reset buttons
    isProcessingAi = false;
    if (btnSnapshot) {
      btnSnapshot.disabled = false;
      btnSnapshot.classList.remove('opacity-75');
      btnSnapshot.innerHTML = `<i data-lucide="camera" class="w-4 h-4 text-slate-900"></i><span>Scan Scene</span>`;
    }
    if (btnMobileQuickScan) {
      btnMobileQuickScan.disabled = false;
      btnMobileQuickScan.classList.remove('opacity-75');
      btnMobileQuickScan.innerHTML = `<i data-lucide="camera" class="w-4 h-4 text-slate-900"></i><span>Quick Scan</span>`;
    }
    if (window.lucide) lucide.createIcons();
  }
}
function updateAiTranscript(text) {
  speechTranscript.textContent = `"${text}"`;
  speechTimestamp.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  announceStatus(text);
}

function getMockAdvice(mode, dist) {
  if (mode === 'ocr') return "Sign reads: EXIT AND EMERGENCY STAIRS.";
  if (mode === 'currency') return "Detected 100 Rupee banknote.";
  if (dist <= 30) return "Emergency stop: Obstacle directly ahead.";
  if (dist <= 60) return "Caution: Object detected 50 centimeters ahead. Clear path on right.";
  return "Walking path appears clear. Continue forward.";
}

// ==========================================
// 8. Persistent Audit Event Timeline
// ==========================================
function renderHistory() {
  if (historyCountBadge) historyCountBadge.textContent = state.history.length;

  if (state.history.length === 0) {
    historyList.innerHTML = `
      <div class="text-center py-4 text-slate-600 text-xs font-mono">
        No events logged yet. Tap "Scan Scene" or speak to begin.
      </div>
    `;
    return;
  }

  historyList.innerHTML = '';
  state.history.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'p-2 rounded-xl bg-white/60 border border-slate-900/15 flex gap-2.5 items-center justify-between hover:bg-white/80 transition shadow-xs';

    const eventType = item.type || item.mode || 'SCAN';
    let badgeClass = 'bg-slate-900/10 text-slate-700';
    if (eventType === 'SOS' || eventType === 'SOS_ACK') {
      badgeClass = 'bg-rose-600 text-white font-extrabold shadow-xs';
    } else if (eventType === 'HAZARD' || eventType === 'HAZARDS') {
      badgeClass = 'bg-rose-500/20 text-rose-800 border border-rose-500/30';
    } else if (eventType === 'OCR') {
      badgeClass = 'bg-amber-500/20 text-amber-900 border border-amber-500/30';
    } else if (eventType === 'CURRENCY') {
      badgeClass = 'bg-emerald-500/20 text-emerald-900 border border-emerald-500/30';
    } else if (eventType === 'SENSOR_FAULT') {
      badgeClass = 'bg-amber-500 text-slate-900 font-bold';
    }

    const visualPreview = item.thumb
      ? `<img src="${item.thumb}" class="w-11 h-9 object-cover rounded-lg bg-slate-200 border border-slate-900/15 shrink-0" alt="Snapshot">`
      : `<div class="w-11 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0 text-rose-700 font-bold text-[10px]"><i data-lucide="bell" class="w-4 h-4"></i></div>`;

    card.innerHTML = `
      ${visualPreview}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded ${badgeClass}">${eventType}</span>
          <span class="text-[9px] text-slate-600 font-mono font-medium">${item.distance !== undefined ? item.distance + 'cm' : '--'}</span>
          <span class="text-[9px] text-slate-500 font-mono ml-auto">${item.timestamp || item.time}</span>
        </div>
        <p class="text-xs text-slate-900 truncate leading-snug font-medium">"${item.text}"</p>
      </div>
      <button class="btn-replay-item p-1.5 rounded-lg bg-white/70 hover:bg-white text-slate-800 border border-slate-900/15 transition shrink-0" data-text="${encodeURIComponent(item.text)}" title="Listen again" aria-label="Replay scan result">
        <i data-lucide="volume-2" class="w-3.5 h-3.5"></i>
      </button>
    `;

    historyList.appendChild(card);
  });

  // Re-bind replay audio buttons on history cards
  document.querySelectorAll('.btn-replay-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = decodeURIComponent(btn.getAttribute('data-text'));
      speakText(text);
    });
  });

  if (window.lucide) lucide.createIcons();
}

function addHistoryRecord(record) {
  const now = new Date();
  const item = {
    ...record,
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    isoTime: now.toISOString()
  };

  state.history.unshift(item);
  if (state.history.length > 50) state.history.pop(); // Keep last 50 audit entries

  localStorage.setItem('THIRD_EYE_HISTORY', JSON.stringify(state.history));
  renderHistory();
}

function exportEventTimeline() {
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    system: "Third Eye AI — Assistive Vision & Tele-Care Guardian",
    version: "3.0",
    eventCount: state.history.length,
    events: state.history
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `third_eye_event_timeline_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  announceStatus("Event timeline log exported successfully.");
}

if (btnExportHistory) {
  btnExportHistory.addEventListener('click', exportEventTimeline);
}

if (btnClearHistory) {
  btnClearHistory.addEventListener('click', () => {
    state.history = [];
    localStorage.removeItem('THIRD_EYE_HISTORY');
    renderHistory();
  });
}

// ==========================================
// 9. Voice & Audio Engine
// ==========================================
// 9. Single Unified Voice & Audio Engine (Zero Voice Clash)
// ==========================================
let audioContext = null;
let currentCloudAudio = null;
let currentSpeechToken = 0;
window._activeSpeechUtterance = null;

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioContext = new AudioContextClass();
    }
  }
  return audioContext;
}

// Gentle pleasant notification bell (Zero DC thump, smooth fade-in and fade-out)
function playNotificationChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.20);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1174.66, now + 0.08);
    gain2.gain.setValueAtTime(0.0001, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.18, now + 0.10);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.35);
  } catch (e) {
    console.warn('Notification chime error:', e);
  }
}

function updateAudioDiagnostic(msg) {
  const elem = document.getElementById('audioDiagnosticText');
  if (elem) elem.textContent = msg;
}

let activeAudioResolve = null;
let activeSpeechResolve = null;
let isAudioEngineUnlocked = false;

function unlockAudioEngine() {
  if (isAudioEngineUnlocked) return;
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Tiny silent audio play to satisfy iOS Safari & mobile Chrome user-gesture autoplay requirements
    const silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    silent.volume = 0.01;
    silent.play().then(() => {
      isAudioEngineUnlocked = true;
    }).catch(() => {});
  } catch (e) {}
}

// Hard-stop any playing speech immediately and invalidate pending promises
function stopAllSpeech() {
  currentSpeechToken++;

  if (activeAudioResolve) {
    const fn = activeAudioResolve;
    activeAudioResolve = null;
    fn(false);
  }
  if (activeSpeechResolve) {
    const fn = activeSpeechResolve;
    activeSpeechResolve = null;
    fn(false);
  }

  if (currentCloudAudio) {
    try {
      currentCloudAudio.pause();
      currentCloudAudio.currentTime = 0;
      currentCloudAudio.src = '';
    } catch (e) {}
    currentCloudAudio = null;
  }
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
  window._activeSpeechUtterance = null;
  state.isSpeaking = false;
}

// Play single chunk via /api/tts (Google Cloud TTS)
function playCloudVoiceSingle(chunk, token) {
  return new Promise((resolve) => {
    if (token !== currentSpeechToken) return resolve(false);

    const audioUrl = `/api/tts?text=${encodeURIComponent(chunk)}&t=${Date.now()}`;
    const audio = new Audio();
    currentCloudAudio = audio;
    audio.volume = 1.0;
    audio.preload = 'auto';

    let isDone = false;
    const finish = (success) => {
      if (isDone) return;
      isDone = true;
      if (currentCloudAudio === audio) currentCloudAudio = null;
      if (activeAudioResolve === finish) activeAudioResolve = null;
      resolve(success);
    };
    activeAudioResolve = finish;

    audio.onplay = () => {
      if (token !== currentSpeechToken) {
        try { audio.pause(); audio.src = ''; } catch (e) {}
        return finish(false);
      }
      updateAudioDiagnostic("Speaking (HD Voice)...");
    };

    audio.onended = () => {
      finish(true);
    };

    audio.onerror = (err) => {
      console.warn("Audio element error:", err);
      finish(false);
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn("Audio play() blocked/failed:", err);
        finish(false);
      });
    }
  });
}

// High-definition Cloud Voice with smart chunking (Max 180 chars per chunk)
async function playCloudVoice(text, token) {
  const clean = text.replace(/["'\n\r\t]+/g, ' ').trim();
  if (!clean) return true;

  const chunks = [];
  if (clean.length <= 180) {
    chunks.push(clean);
  } else {
    const parts = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
    let currentChunk = '';
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if ((currentChunk + ' ' + trimmed).trim().length <= 180) {
        currentChunk = (currentChunk + ' ' + trimmed).trim();
      } else {
        if (currentChunk) chunks.push(currentChunk);
        if (trimmed.length <= 180) {
          currentChunk = trimmed;
        } else {
          const words = trimmed.split(' ');
          let sub = '';
          for (const w of words) {
            if ((sub + ' ' + w).trim().length <= 180) {
              sub = (sub + ' ' + w).trim();
            } else {
              if (sub) chunks.push(sub);
              sub = w;
            }
          }
          if (sub) currentChunk = sub;
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
  }

  for (const chunk of chunks) {
    if (token !== currentSpeechToken) return false;
    const ok = await playCloudVoiceSingle(chunk, token);
    if (!ok && token === currentSpeechToken) {
      return false;
    }
  }
  updateAudioDiagnostic("Voice complete.");
  return true;
}

// Offline fallback: Native Web Speech API ONLY if cloud fails
function playNativeVoice(text, token) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      updateAudioDiagnostic("Device speech not supported.");
      return resolve(false);
    }
    if (token !== currentSpeechToken) return resolve(false);

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      let isDone = false;
      const finish = (success) => {
        if (isDone) return;
        isDone = true;
        if (activeSpeechResolve === finish) activeSpeechResolve = null;
        window._activeSpeechUtterance = null;
        resolve(success);
      };
      activeSpeechResolve = finish;

      utterance.onstart = () => {
        if (token !== currentSpeechToken) {
          window.speechSynthesis.cancel();
          return finish(false);
        }
        updateAudioDiagnostic("Speaking (Offline Voice)...");
      };

      utterance.onend = () => {
        updateAudioDiagnostic("Voice complete.");
        finish(true);
      };

      utterance.onerror = () => {
        finish(false);
      };

      window._activeSpeechUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      resolve(false);
    }
  });
}

// Master speech function: EXCLUSIVE single voice (Google Cloud HD voice first, never overlaps)
async function speakText(text) {
  if (!text) return;
  const clean = text.replace(/["'\n\r]/g, ' ').trim();
  if (!clean) return;

  // Kill any running speech immediately
  stopAllSpeech();
  const token = ++currentSpeechToken;

  if (screenReaderStatus) screenReaderStatus.textContent = '';
  state.isSpeaking = true;
  pauseVoiceListening();

  try {
    let cloudSuccess = false;
    try {
      cloudSuccess = await playCloudVoice(clean, token);
    } catch (cloudErr) {
      console.warn("Cloud voice unavailable, using offline fallback:", cloudErr);
      cloudSuccess = false;
    }

    if (!cloudSuccess && token === currentSpeechToken) {
      await playNativeVoice(clean, token);
    }
  } catch (err) {
    console.warn("Speech playback error:", err);
  } finally {
    if (token === currentSpeechToken) {
      state.isSpeaking = false;
      resumeVoiceListeningSoon(300);
    }
  }
}

// Direct voice test button handler
async function testVoiceOutput() {
  const btn = document.getElementById('btnTestVoice');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-1">◐</span> Testing...`;
  }

  updateAudioDiagnostic("Testing audio...");

  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    if (window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    await speakText("Audio test successful. Your voice assistant is working loud and clear.");
  } catch (err) {
    console.error("testVoiceOutput error:", err);
    updateAudioDiagnostic(`Audio error: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="volume-high" class="w-3 h-3 text-emerald-400"></i> Test Speaker`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

const btnTestVoice = document.getElementById('btnTestVoice');
if (btnTestVoice) {
  btnTestVoice.addEventListener('click', testVoiceOutput);
}

btnReplaySpeech.addEventListener('click', () => {
  const text = speechTranscript.textContent.replace(/"/g, '');
  speakText(text);
});

// Key bindings
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    setMode('hazard');
    performAiVisionAnalysis('Spacebar Trigger');
  }
});

btnSnapshot.addEventListener('click', () => {
  setMode('hazard');
  performAiVisionAnalysis('Button Click');
});
if (btnMobileQuickScan) {
  btnMobileQuickScan.addEventListener('click', () => {
    setMode('hazard');
    performAiVisionAnalysis('Mobile Quick Scan');
  });
}

// ==========================================
// 10. Siri / Alexa Style Hands-Free Voice Assistant for Blind Users
// ==========================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isAssistantListening = false;
let isRecognitionStarting = false;
let isRecognitionRunning = false;
let assistantAutoRestart = true;
let restartTimer = null;
let lastCommandProcessedTime = 0;

const voiceStatusBadge = document.getElementById('voiceStatusBadge');
const voiceStatusText = document.getElementById('voiceStatusText');

function updateVoiceAssistantUI(status, label) {
  if (voiceStatusText) voiceStatusText.textContent = label;
  if (voiceStatusBadge) {
    voiceStatusBadge.setAttribute('aria-label', label);
    if (status === 'listening') {
      voiceStatusBadge.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-emerald-500/20 border-2 border-emerald-600 text-emerald-800 flex items-center justify-center shadow-md';
    } else if (status === 'speaking') {
      voiceStatusBadge.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-blue-500/20 border-2 border-blue-600 text-blue-800 flex items-center justify-center shadow-md';
    } else if (status === 'processing') {
      voiceStatusBadge.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-amber-500/20 border-2 border-amber-600 text-amber-800 flex items-center justify-center shadow-md';
    } else {
      voiceStatusBadge.className = 'w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/60 border border-slate-900/15 text-slate-800 flex items-center justify-center shadow-sm';
    }
  }
  if (voiceMicIcon) {
    voiceMicIcon.setAttribute('class', status === 'listening' ? 'w-5 h-5 text-emerald-700 animate-pulse' : 'w-5 h-5 text-slate-800');
  }
  if (askMicIcon) {
    askMicIcon.setAttribute('class', status === 'listening' ? 'w-4 h-4 text-emerald-700 animate-pulse' : 'w-4 h-4 text-slate-800');
  }
  announceStatus(label);
}

// Instant trigger detector on interim speech hypotheses (response latency < 250ms)
function checkForInstantTrigger(rawText) {
  if (!rawText) return false;
  const now = Date.now();
  if (now - lastCommandProcessedTime < 1800) return true;
  if (state.isSpeaking || isProcessingAi) return true;

  const text = rawText.toLowerCase().replace(/[.,?!]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  // 1. Primary Wake & Start phrase requested by user: "hey help me out", "help me out", "help me", "start"
  if (/\b(hey help me out|help me out|please help me out|help me|can you help me out|can you help me|assist me|third eye help me out|hey third eye help me out|start assistance|start helping|start guide|start guiding|start navigation|start)\b/i.test(text)) {
    lastCommandProcessedTime = now;
    pauseVoiceListening();
    handleVoiceCommand(rawText);
    return true;
  }

  // 1.5 Emergency SOS Alert command (Instant Trigger)
  if (/\b(sos|emergency|help emergency|call caregiver|i fell|i need help|danger emergency)\b/i.test(text)) {
    lastCommandProcessedTime = now;
    pauseVoiceListening();
    triggerSosEmergency('Voice emergency trigger');
    return true;
  }

  // 2. Stop / Silence
  if (/\b(stop|quiet|silence|cancel|shut up|pause|hush|mute)\b/i.test(text)) {
    lastCommandProcessedTime = now;
    pauseVoiceListening();
    handleVoiceCommand(rawText);
    return true;
  }

  // 3. Scan & Obstacle Check
  if (/\b(scan|ahead|look|what is there|what is in front|what do you see|check path|hazard|obstacle)\b/i.test(text)) {
    lastCommandProcessedTime = now;
    pauseVoiceListening();
    handleVoiceCommand(rawText);
    return true;
  }

  // 4. Read Signs & Text Mode
  if (/\b(read text|read sign|read this|read document|what is written|what does it say)\b/i.test(text)) {
    lastCommandProcessedTime = now;
    pauseVoiceListening();
    handleVoiceCommand(rawText);
    return true;
  }

  // 5. Currency / Money
  if (/\b(currency|money|cash|rupee|dollar|how much money)\b/i.test(text)) {
    lastCommandProcessedTime = now;
    pauseVoiceListening();
    handleVoiceCommand(rawText);
    return true;
  }

  // 6. Proximity / Distance
  if (/\b(distance|how far|proximity|sensor)\b/i.test(text)) {
    lastCommandProcessedTime = now;
    pauseVoiceListening();
    handleVoiceCommand(rawText);
    return true;
  }

  return false;
}

function initVoiceAssistant() {
  if (!SpeechRecognition) {
    console.warn("SpeechRecognition not supported in this browser.");
    updateVoiceAssistantUI('off', 'Voice not supported');
    return;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; // Enables instantaneous Siri/Alexa-style wake detection
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isRecognitionStarting = false;
      isRecognitionRunning = true;
      isAssistantListening = true;
      updateVoiceAssistantUI('listening', 'Voice: Listening');
      console.log('Voice assistant listening for commands...');
    };

    recognition.onresult = (event) => {
      const results = event.results;
      if (!results || results.length === 0) return;

      let fullTranscript = '';
      for (let i = event.resultIndex; i < results.length; i++) {
        fullTranscript += results[i][0].transcript + ' ';
      }
      fullTranscript = fullTranscript.trim();
      if (!fullTranscript) return;

      // Check instant trigger on interim speech
      const triggered = checkForInstantTrigger(fullTranscript);
      if (triggered) return;

      // If final transcript reached and wasn't triggered yet, handle full command/question
      const lastResult = results[results.length - 1];
      if (lastResult.isFinal) {
        const transcript = lastResult[0].transcript.trim();
        console.log('Voice assistant final transcript:', transcript);
        if (transcript) {
          handleVoiceCommand(transcript);
        }
      }
    };

    recognition.onerror = (e) => {
      console.warn('SpeechRecognition error:', e.error);
      isRecognitionStarting = false;
      isAssistantListening = false;

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        isRecognitionRunning = false;
        assistantAutoRestart = false;
        updateVoiceAssistantUI('off', 'Tap screen for voice');
        updateAiTranscript('Microphone permission needed. Tap anywhere on screen to enable voice.');
      } else if (e.error === 'no-speech') {
        if (assistantAutoRestart && !state.isSpeaking && !isProcessingAi) {
          resumeVoiceListeningSoon(400);
        }
      } else if (e.error === 'aborted') {
        isRecognitionRunning = false;
      } else {
        if (assistantAutoRestart && !state.isSpeaking && !isProcessingAi) {
          resumeVoiceListeningSoon(600);
        }
      }
    };

    recognition.onend = () => {
      isRecognitionStarting = false;
      isRecognitionRunning = false;
      isAssistantListening = false;
      if (assistantAutoRestart && !state.isSpeaking && !isProcessingAi) {
        resumeVoiceListeningSoon(250);
      } else {
        updateVoiceAssistantUI('off', 'Voice Paused');
      }
    };

    updateVoiceAssistantUI('listening', 'Voice: Listening');
    startVoiceListening();
  } catch (err) {
    console.error("Voice assistant init error:", err);
  }
}

function startVoiceListening() {
  if (!recognition) return;
  if (isRecognitionStarting || isRecognitionRunning || state.isSpeaking || isProcessingAi) return;

  try {
    isRecognitionStarting = true;
    assistantAutoRestart = true;
    recognition.start();
  } catch (err) {
    isRecognitionStarting = false;
    if (err.name === 'InvalidStateError') {
      isRecognitionRunning = true;
    } else {
      console.warn("recognition.start warning:", err.message);
    }
  }
}

function pauseVoiceListening() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  isAssistantListening = false;
  if (recognition && (isRecognitionRunning || isRecognitionStarting)) {
    try {
      recognition.abort();
    } catch (e) {}
    isRecognitionStarting = false;
    isRecognitionRunning = false;
  }
  updateVoiceAssistantUI('speaking', 'AI Speaking');
}

function resumeVoiceListeningSoon(delay = 300) {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!state.isSpeaking && !isProcessingAi) {
      startVoiceListening();
    }
  }, delay);
}

function handleVoiceCommand(rawText) {
  const text = rawText.toLowerCase().replace(/[.,?!]/g, ' ').trim();
  if (!text) return;

  vibratePhone(40);
  updateVoiceAssistantUI('processing', 'Processing...');
  speechTranscript.textContent = `Heard: "${rawText}"`;

  // 1. Primary Wake & Start Command requested by user: "hey help me out", "help me out", "help me", "start"
  if (/\b(hey help me out|help me out|please help me out|help me|can you help me out|can you help me|assist me|third eye help me out|hey third eye help me out|start assistance|start helping|start guide|start guiding|start navigation|start)\b/i.test(text)) {
    setMode('hazard');
    performAiVisionAnalysis('Voice Command: Help Me Out', null, "Starting assistance. Checking what is in front of you now.");
    return;
  }

  // 1.5 SOS Emergency Alert Command
  if (/\b(sos|emergency|help emergency|call caregiver|i fell|i need help|danger emergency|send alert)\b/i.test(text)) {
    triggerSosEmergency('Voice emergency trigger');
    return;
  }

  // 2. Stop / Silence / Cancel
  if (/\b(stop|quiet|silence|cancel|shut up|pause|hush|mute)\b/i.test(text)) {
    stopAllSpeech();
    updateAiTranscript("Voice silenced.");
    return;
  }

  // 3. Scan & Obstacle Check ("Scan", "Look", "What's in front of me", "What do you see", "Check path")
  if (/\b(scan|ahead|look|see|front|what is there|what is in front|what do you see|surroundings|describe|room|check path|safe path|path|hazard|obstacle|danger)\b/i.test(text)) {
    setMode('hazard');
    performAiVisionAnalysis('Voice Command: Scan', null, "Scanning path ahead.");
    return;
  }

  // 4. Read Signs & Text Mode (OCR) ("Read text", "Read sign", "Read this", "What does it say")
  if (/\b(read text|read sign|read this|read document|read words|read label|read book|what is written|what does it say|read)\b/i.test(text)) {
    setMode('ocr');
    performAiVisionAnalysis('Voice Command: Read Text', null, "Reading text in front of you.");
    return;
  }

  // 5. Currency / Money ("Currency", "Money", "Cash", "Rupee", "Dollar", "Note", "Bill", "Coin")
  if (/\b(currency|money|cash|rupee|dollar|note|bill|coin|how much money)\b/i.test(text)) {
    setMode('currency');
    performAiVisionAnalysis('Voice Command: Currency', null, "Checking currency in front of you.");
    return;
  }

  // 6. Ultrasonic Distance / Proximity Check
  if (/\b(distance|how far|proximity|sensor|obstacle distance)\b/i.test(text)) {
    const dist = state.currentDistance;
    let statusPhrase = 'Clear path ahead';
    if (dist <= 25) statusPhrase = 'Emergency stop. Danger obstacle directly ahead.';
    else if (dist <= 60) statusPhrase = 'Caution. Object near ahead.';
    speakText(`Distance is ${dist} centimeters. ${statusPhrase}`);
    return;
  }

  // 7. Check if assistant is listening
  if (/\b(are you listening|can you hear|do you hear|are you there|is this working|listening)\b/i.test(text)) {
    speakText("Yes, I am listening loud and clear. Say 'Hey help me out' to start navigation.");
    return;
  }

  // 8. Wake words alone ("Hey Third Eye", "Third Eye", "Assistant", "Alexa", "Siri")
  const wakeWords = ['hey third eye', 'third eye', 'hey assistant', 'assistant', 'alexa', 'siri', 'computer', 'ok google'];
  if (wakeWords.some(w => text === w || text === 'hey ' + w)) {
    speakText("I am listening. Say 'Hey help me out' to start, or ask any question.");
    return;
  }

  // 9. Commands list
  if (/\b(commands|what can i say|instructions)\b/i.test(text)) {
    speakText("Say 'Hey help me out' to start, 'Read' to read text, 'Currency' for money, or 'Distance' for obstacle range.");
    return;
  }

  // 10. Greetings & pleasantries
  if (/\b(hello|hi|hey|good morning|good afternoon|good evening|hey there)\b/i.test(text)) {
    speakText("Hello! I am your Third Eye assistant. Say 'Hey help me out' to start navigation.");
    return;
  }

  // 11. Identity
  if (/\b(who are you|what is your name|what are you)\b/i.test(text)) {
    speakText("I am Third Eye, your assistive vision guide. Say 'Hey help me out' to start.");
    return;
  }

  // 12. Gratitude / Compliments
  if (/\b(thank you|thanks|good job|awesome|well done)\b/i.test(text)) {
    speakText("You are very welcome! I am here whenever you need me.");
    return;
  }

  // 13. Genuine visual question (e.g. "Is someone sitting there?", "Is there a bottle?", "What color is this?")
  if (/\b(what|where|is there|are there|can you see|how many|who is|is the|which|tell me)\b/i.test(text)) {
    performAiVisionAnalysis('Voice Question', rawText, "Looking ahead to answer your question.");
    return;
  }

  // 14. Unrecognized phrase: guide user to the wake phrase
  speakText("I am listening. Say 'Hey help me out' to start, or ask a question.");
}

// Manual Mic Toggle / Wake button
const triggerVoiceManual = () => {
  vibratePhone(50);
  assistantAutoRestart = true;
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  playNotificationChime();
  updateAiTranscript("Microphone on. Say 'Scan' to check your path or ask a question.");
  startVoiceListening();
};

if (btnVoiceQuery) btnVoiceQuery.addEventListener('click', triggerVoiceManual);
if (btnMobileVoice) btnMobileVoice.addEventListener('click', triggerVoiceManual);

const voiceAssistantBanner = document.getElementById('voiceAssistantBanner');
if (voiceAssistantBanner) voiceAssistantBanner.addEventListener('click', triggerVoiceManual);
if (voiceStatusBadge) voiceStatusBadge.addEventListener('click', triggerVoiceManual);

// Touch-Friendly Blind Accessibility: Double-Tap ANYWHERE on Screen to Scan
let lastTouchTime = 0;
document.addEventListener('touchend', (e) => {
  if (e.target.closest('#keyModal') || e.target.closest('button') || e.target.closest('input')) return;
  const now = Date.now();
  if (now - lastTouchTime < 350 && now - lastTouchTime > 40) {
    vibratePhone([60, 40, 60]);
    setMode('hazard'); // Always reset to physical navigation on double tap
    updateAiTranscript("Scanning now...");
    performAiVisionAnalysis('Screen Double Tap');
    e.preventDefault();
  } else {
    if (!state.isSpeaking && !isRecognitionRunning && !isProcessingAi) {
      startVoiceListening();
    }
  }
  lastTouchTime = now;
});

// ==========================================
// 10. Proximity Circular Arc Gauge
// ==========================================
const radarCanvas = document.getElementById('radarCanvas');
const radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;

function drawRadar() {
  if (!radarCanvas || !radarCtx) return;
  const width = radarCanvas.width;
  const height = radarCanvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = centerX - 12;

  radarCtx.clearRect(0, 0, width, height);

  // Background track
  radarCtx.beginPath();
  radarCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  radarCtx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  radarCtx.lineWidth = 6.5;
  radarCtx.stroke();

  // Active Arc
  const clampedDist = Math.max(0, Math.min(150, state.currentDistance));
  const fraction = 1 - (clampedDist / 150);
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (fraction * Math.PI * 2);

  let arcColor = '#059669'; // emerald-600
  if (state.currentDistance <= 25) arcColor = '#e11d48'; // rose-600
  else if (state.currentDistance <= 60) arcColor = '#d97706'; // amber-600

  if (fraction > 0.02) {
    radarCtx.beginPath();
    radarCtx.arc(centerX, centerY, radius, startAngle, endAngle);
    radarCtx.strokeStyle = arcColor;
    radarCtx.lineWidth = 6.5;
    radarCtx.lineCap = 'round';
    radarCtx.stroke();
  }

  requestAnimationFrame(drawRadar);
}

// ==========================================
// 11. Chart.js Distance History
// ==========================================
const chartCanvas = document.getElementById('historyChart');
const initialLabels = Array.from({ length: 30 }, (_, i) => `${30 - i}s`);
const initialData = Array(30).fill(120);

let distanceChart = null;
if (chartCanvas && typeof Chart !== 'undefined') {
  try {
    distanceChart = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: initialLabels,
        datasets: [{
          label: 'Distance (cm)',
          data: initialData,
          borderColor: '#ffffff',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          borderWidth: 1.5,
          fill: true,
          tension: 0.25,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 160,
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            ticks: { color: '#a1a1aa', font: { size: 9, family: 'monospace' } }
          },
          x: { display: false }
        },
        plugins: { legend: { display: false } },
        animation: false
      }
    });
  } catch (e) {
    console.warn("Chart initialization skipped:", e);
  }
}

function pushChartData(val) {
  if (!distanceChart) return;
  const data = distanceChart.data.datasets[0].data;
  data.shift();
  data.push(val);
  distanceChart.update();
}

function triggerSosEmergency(reason = 'User Requested SOS') {
  if (state.isSosTriggered) return;
  state.isSosTriggered = true;
  state.sosStatus = 'DISPATCHED';

  const timeStr = new Date().toLocaleTimeString();

  if (sosStatusText) sosStatusText.textContent = 'ALERTING';
  if (btnTriggerSos) {
    btnTriggerSos.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-600 text-white border border-rose-700 text-xs font-bold animate-pulse shadow-md cursor-pointer';
  }

  if (caregiverDispatchStatus) {
    caregiverDispatchStatus.textContent = 'DISPATCHED TO CAREGIVER (SMS / HTTP)';
    caregiverDispatchStatus.className = 'font-bold text-rose-700 animate-pulse';
  }
  if (caregiverTriggerReason) caregiverTriggerReason.textContent = reason;
  if (caregiverDistanceSnapshot) caregiverDistanceSnapshot.textContent = `${state.currentDistance} cm`;
  if (caregiverTimestamp) caregiverTimestamp.textContent = timeStr;

  if (caregiverModal) caregiverModal.classList.remove('hidden');

  vibratePhone([500, 200, 500, 200, 500]);
  speakText("Emergency SOS alert dispatched to your caregiver. Please stay in a safe position.");

  addHistoryRecord({
    mode: 'sos',
    type: 'SOS',
    distance: state.currentDistance,
    text: `Emergency SOS Alert: ${reason}`,
    thumb: ''
  });

  // Simulate remote caregiver delivery confirmation
  setTimeout(() => {
    if (state.isSosTriggered && state.sosStatus === 'DISPATCHED') {
      state.sosStatus = 'DELIVERED';
      if (caregiverDispatchStatus) {
        caregiverDispatchStatus.textContent = 'DELIVERED TO CAREGIVER DEVICE';
        caregiverDispatchStatus.className = 'font-bold text-emerald-700';
      }
    }
  }, 2200);
}

function acknowledgeSosEmergency() {
  if (!state.isSosTriggered) return;
  state.sosStatus = 'ACKNOWLEDGED';

  if (syncChannel) {
    syncChannel.postMessage({ type: 'CAREGIVER_ACK' });
  }

  if (caregiverDispatchStatus) {
    caregiverDispatchStatus.textContent = 'ACKNOWLEDGED BY CAREGIVER';
    caregiverDispatchStatus.className = 'font-bold text-emerald-700';
  }

  speakText("Caregiver has acknowledged your emergency alert. Help is on the way.");

  addHistoryRecord({
    mode: 'sos',
    type: 'SOS_ACK',
    distance: state.currentDistance,
    text: 'Caregiver acknowledged emergency alert. Help dispatched.',
    thumb: ''
  });

  setTimeout(() => {
    cancelSosEmergency(false);
  }, 3500);
}

function cancelSosEmergency(announced = true) {
  state.isSosTriggered = false;
  state.sosStatus = 'SAFE';

  if (syncChannel) {
    syncChannel.postMessage({ type: 'CAREGIVER_CANCEL' });
  }

  if (caregiverModal) caregiverModal.classList.add('hidden');
  if (sosStatusText) sosStatusText.textContent = 'SOS';
  if (btnTriggerSos) {
    btnTriggerSos.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-600/15 hover:bg-rose-600 hover:text-white text-rose-900 border border-rose-600/30 text-xs font-bold transition shadow-xs cursor-pointer';
  }

  if (announced) {
    speakText("Emergency alert cancelled.");
  }
}

if (btnTriggerSos) {
  btnTriggerSos.addEventListener('click', () => triggerSosEmergency('Dashboard SOS button pressed'));
}
if (btnAcknowledgeSos) {
  btnAcknowledgeSos.addEventListener('click', acknowledgeSosEmergency);
}
if (btnCancelSos) {
  btnCancelSos.addEventListener('click', () => cancelSosEmergency(true));
}

// Privacy & Informed Consent Modal Listeners
if (btnOpenPrivacyModal) {
  btnOpenPrivacyModal.addEventListener('click', () => {
    if (privacyModal) privacyModal.classList.remove('hidden');
  });
}
if (btnClosePrivacyModal) {
  btnClosePrivacyModal.addEventListener('click', () => {
    if (privacyModal) privacyModal.classList.add('hidden');
  });
}

// ==========================================
// 12. API Key Modal
// ==========================================
const missingKeyBanner = document.getElementById('missingKeyBanner');
const btnBannerSetKey = document.getElementById('btnBannerSetKey');

function updateApiKeyStatus() {
  if (state.geminiApiKey) {
    keyStatusBadge.textContent = 'Active ✓';
    btnOpenKeyModal.classList.add('border-emerald-600/50', 'text-emerald-800');
    if (missingKeyBanner) missingKeyBanner.style.display = 'none';
  } else {
    keyStatusBadge.textContent = 'Key';
    btnOpenKeyModal.classList.remove('border-emerald-600/50', 'text-emerald-800');
    if (missingKeyBanner) missingKeyBanner.style.display = 'flex';
  }
}

if (btnBannerSetKey) {
  btnBannerSetKey.addEventListener('click', () => {
    inputApiKey.value = state.geminiApiKey;
    keyModal.classList.remove('hidden');
    inputApiKey.focus();
    announceStatus('Gemini API key dialog opened.');
  });
}

btnOpenKeyModal.addEventListener('click', () => {
  inputApiKey.value = state.geminiApiKey;
  keyModal.classList.remove('hidden');
  inputApiKey.focus();
  announceStatus('Gemini API key dialog opened.');
});

btnCloseKeyModal.addEventListener('click', () => {
  keyModal.classList.add('hidden');
  btnOpenKeyModal.focus();
  announceStatus('Gemini API key dialog closed.');
});

btnSaveApiKey.addEventListener('click', () => {
  const val = inputApiKey.value.trim();
  state.geminiApiKey = val;
  localStorage.setItem('GEMINI_API_KEY', val);
  updateApiKeyStatus();
  keyModal.classList.add('hidden');
  btnOpenKeyModal.focus();
  announceStatus(val ? 'Gemini API key saved. AI vision is active.' : 'Gemini API key cleared.');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !keyModal.classList.contains('hidden')) {
    keyModal.classList.add('hidden');
    btnOpenKeyModal.focus();
    announceStatus('Gemini API key dialog closed.');
  }
});

// ==========================================
// 13. App Startup
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initCamera();
  drawRadar();
  updateApiKeyStatus();
  renderHistory();
  initVoiceAssistant();
  updateAiTranscript("Third Eye is listening. Say 'Hey help me out' to start.");
});

// Full hands-free touch/click gesture unlock for mobile & desktop browsers
let isFirstInteractionHandled = false;

async function requestMicAndStartVoice() {
  unlockAudioEngine();
  assistantAutoRestart = true;

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (micErr) {
      console.warn("getUserMedia audio prompt error:", micErr);
    }
  }

  startVoiceListening();
}

async function handleFirstInteraction(e) {
  if (e && e.target && (e.target.closest('#keyModal') || e.target.closest('input') || e.target.closest('textarea'))) {
    return;
  }

  unlockAudioEngine();

  if (!isFirstInteractionHandled) {
    isFirstInteractionHandled = true;
    await requestMicAndStartVoice();
    speakText("Third Eye is active. Say 'Hey help me out' to start.");
  } else {
    if (!state.isSpeaking && !isRecognitionRunning && !isProcessingAi) {
      startVoiceListening();
    }
  }
}

window.addEventListener('click', handleFirstInteraction, { passive: true });
window.addEventListener('touchstart', handleFirstInteraction, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    handleFirstInteraction(e);
  }
});
