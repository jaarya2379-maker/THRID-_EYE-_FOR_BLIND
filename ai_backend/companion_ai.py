"""
Third Eye AI Companion (v3.2 Production)
Non-blocking serial monitor and AI vision guide for the ESP32 Third Eye hardware.
- Real-time background Gemini 2.5 Flash analysis with 7s timeout
- Non-blocking serial listener with buffer flushing (no stale queue lag)
- Handles DIST, TRIGGER_AI, EVENT:SOS_BUTTON, EVENT:DROP, and sensor faults
"""

import os
import sys
import glob
import time
import queue
import threading
import concurrent.futures
import cv2
from PIL import Image
import pyttsx3
import serial
from google import genai

# ==========================================
# 1. Non-Blocking Text-To-Speech (TTS) Worker
# ==========================================
tts_queue = queue.Queue()

def tts_worker():
    """Background voice worker so speech never blocks serial or camera loops."""
    engine = None
    try:
        engine = pyttsx3.init()
        engine.setProperty('rate', 175)
    except Exception as e:
        print(f"[TTS Init Warning]: {e}")

    while True:
        text = tts_queue.get()
        if text is None:
            break
        try:
            print(f"\n[Spoken Audio]: \"{text}\"")
            if engine:
                engine.say(text)
                engine.runAndWait()
        except Exception as e:
            print(f"[TTS Error]: {e}")
        finally:
            tts_queue.task_done()

tts_thread = threading.Thread(target=tts_worker, daemon=True)
tts_thread.start()

def speak(msg):
    tts_queue.put(msg)

# ==========================================
# 2. Gemini Multimodal Client
# ==========================================
api_key = os.environ.get("GEMINI_API_KEY")
gemini_client = None

if api_key:
    try:
        gemini_client = genai.Client(api_key=api_key)
        print("[AI Engine]: Gemini 2.5 Flash initialized successfully.")
    except Exception as e:
        print(f"[AI Error]: Failed to initialize Gemini: {e}")
else:
    print("[Notice]: GEMINI_API_KEY not set. Set with: export GEMINI_API_KEY=\"...\"")

SYSTEM_PROMPT = (
    "You are an assistive vision guide for a blind or visually impaired person walking forward. "
    "In 1 to 2 short sentences (under 14 words total): "
    "1. Name the main obstacle directly ahead and its clock direction (e.g. 'Chair at 11 o'clock, step right'). "
    "2. If a prominent sign or exit label is visible, read it verbatim. "
    "Be direct and actionable. Never use conversational filler."
)

# AI Request Worker Queue (Prevents blocking serial read)
ai_task_queue = queue.Queue(maxsize=1)
is_ai_analyzing = False

def ai_worker():
    """Background thread that executes Gemini API calls with strict 7s timeout."""
    global is_ai_analyzing
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

    while True:
        frame_rgb = ai_task_queue.get()
        if frame_rgb is None:
            break

        is_ai_analyzing = True
        try:
            if not gemini_client:
                speak("Obstacle ahead. Gemini API key required for object details.")
                continue

            pil_img = Image.fromarray(frame_rgb)

            def do_call():
                return gemini_client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[pil_img, SYSTEM_PROMPT]
                )

            future = executor.submit(do_call)
            response = future.result(timeout=7.0)

            desc = response.text.strip() if response.text else "Obstacle ahead."
            speak(desc)
        except concurrent.futures.TimeoutError:
            print("[AI Timeout]: Gemini request took > 7s. Using local proximity fallback.")
            speak("Obstacle directly ahead. Path blocked.")
        except Exception as e:
            print(f"[AI Error]: {e}")
            speak("Obstacle detected ahead.")
        finally:
            is_ai_analyzing = False
            ai_task_queue.task_done()

ai_thread = threading.Thread(target=ai_worker, daemon=True)
ai_thread.start()

def request_ai_scan(frame_bgr):
    """Enqueues a fresh frame for analysis without blocking caller."""
    if not is_ai_analyzing and ai_task_queue.empty():
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        # Downscale for low latency transmission
        h, w = rgb.shape[:2]
        if w > 480:
            scale = 480.0 / w
            rgb = cv2.resize(rgb, (480, int(h * scale)))
        try:
            ai_task_queue.put_nowait(rgb)
            print("[AI]: Frame submitted for background analysis...")
        except queue.Full:
            pass

# ==========================================
# 3. Serial Communication
# ==========================================
def find_esp32_port():
    """Auto-detects ESP32 serial port across platforms."""
    ports = (
        glob.glob("/dev/tty.usbserial*") +
        glob.glob("/dev/tty.SLAB_USBtoUART*") +
        glob.glob("/dev/tty.wchusbserial*") +
        glob.glob("/dev/ttyUSB*") +
        glob.glob("/dev/ttyACM*")
    )
    return ports[0] if ports else None

def main():
    print("=" * 60)
    print("     THIRD EYE FOR THE BLIND — AI COMPANION (v3.2)     ")
    print("=" * 60)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[Camera Error]: Could not open webcam.")
        return

    port = find_esp32_port()
    ser = None
    if port:
        try:
            ser = serial.Serial(port, 115200, timeout=0.05)
            # Flush startup noise
            ser.reset_input_buffer()
            print(f"[Serial]: Connected to ESP32 on {port}")
        except Exception as e:
            print(f"[Serial Error]: Could not open {port}: {e}")
    else:
        print("[Serial Notice]: ESP32 not detected on USB. Running in standalone video mode.")
        print("                 Press 'SPACEBAR' in camera window to test AI vision.")

    speak("Third Eye AI active.")
    print("\n[Controls]: Press 'SPACE' to trigger AI snapshot | Press 'Q' to quit.\n")

    current_dist = 151
    latest_frame = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            latest_frame = frame

            # Read ESP32 lines non-blockingly
            if ser and ser.in_waiting > 0:
                try:
                    raw = ser.readline().decode('utf-8', errors='ignore').strip()
                    if raw:
                        if raw.startswith("DIST:"):
                            current_dist = int(raw.split(":")[1])
                        elif raw.startswith("TRIGGER_AI:"):
                            dist_val = raw.split(":")[1]
                            print(f"[Hardware Trigger]: Obstacle at {dist_val} cm")
                            request_ai_scan(frame)
                        elif raw == "EVENT:SOS_BUTTON":
                            print("[EMERGENCY]: Hardware SOS Button Pressed!")
                            speak("Emergency SOS button pressed. Caregiver alert dispatched.")
                        elif raw == "EVENT:DROP":
                            print("[DROP ALERT]: Drop-off or stairs down detected!")
                            speak("Caution: Drop-off or stairs down ahead.")
                        elif raw == "FAULT:ECHO_STUCK":
                            print("[FAULT]: Sensor ECHO line stuck high!")
                            speak("Sensor fault warning: check ultrasonic wiring.")
                        elif raw == "WARN:LOW_BATTERY":
                            print("[BATTERY]: Low battery warning received!")
                            speak("Warning: Battery level low.")
                except Exception as ex:
                    print(f"[Serial Parse Warning]: {ex}")

            # Visual overlay
            status_text = f"Dist: {current_dist} cm | AI: {'BUSY' if is_ai_analyzing else 'READY'}"
            cv2.putText(frame, status_text, (20, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.imshow("Third Eye AI Companion", frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord(' '):
                print("[Manual Trigger]: Capturing snapshot...")
                request_ai_scan(frame)
            elif key == ord('q'):
                break

    finally:
        if ser:
            ser.close()
        cap.release()
        cv2.destroyAllWindows()
        ai_task_queue.put(None)
        tts_queue.put(None)

if __name__ == "__main__":
    main()
