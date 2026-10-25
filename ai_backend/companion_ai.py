"""
Third Eye AI Companion
Monitors serial signals from ESP32, captures live webcam snapshots on obstacle alerts,
queries Gemini Multimodal AI, and speaks audio descriptions to the user.
"""

import os
import sys
import glob
import time
import queue
import threading
import cv2
from PIL import Image
import pyttsx3
import serial
from google import genai

# ==========================================
# 1. Text-To-Speech (TTS) Engine
# ==========================================
tts_queue = queue.Queue()

def tts_worker():
    """Background voice worker so speech doesn't block the video/serial loop."""
    engine = pyttsx3.init()
    engine.setProperty('rate', 170)
    while True:
        text = tts_queue.get()
        if text is None:
            break
        try:
            print(f"\n[Voice Output]: \"{text}\"")
            engine.say(text)
            engine.runAndWait()
        except Exception as e:
            print(f"[TTS Error]: {e}")
        finally:
            tts_queue.task_done()

tts_thread = threading.Thread(target=tts_worker, daemon=True)
tts_thread.start()

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
    print("[WARNING]: GEMINI_API_KEY environment variable not set.")
    print("Run: export GEMINI_API_KEY=\"your_key_here\"")

SYSTEM_PROMPT = (
    "You are an assistive vision guide for a blind or visually impaired person walking forward. "
    "In 1 to 2 short, crisp sentences (under 20 words): "
    "1. Name the main obstacle directly ahead (e.g., 'Wooden chair', 'Stairs going down', 'Closed door', 'Person walking'). "
    "2. If a prominent sign or exit label is visible, read it verbatim. "
    "Be direct and actionable. Never use introductory filler."
)

def analyze_and_narrate(frame_bgr):
    """Processes webcam image through Gemini and triggers voice description."""
    if not gemini_client:
        tts_queue.put("Obstacle detected. Please configure your Gemini API key.")
        return

    try:
        # Convert BGR (OpenCV) to RGB (PIL)
        rgb_img = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb_img)

        print("[AI]: Analyzing scene with Gemini...")
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[pil_img, SYSTEM_PROMPT]
        )

        description = response.text.strip() if response.text else "Object ahead."
        tts_queue.put(description)
    except Exception as e:
        print(f"[AI Analysis Error]: {e}")

# ==========================================
# 3. Find Connected ESP32 Serial Port
# ==========================================
def find_esp32_port():
    """Scans for USB Serial ports on macOS / Linux."""
    ports = glob.glob("/dev/tty.usbserial*") + glob.glob("/dev/tty.SLAB_USBtoUART*") + glob.glob("/dev/tty.wchusbserial*") + glob.glob("/dev/ttyUSB*")
    return ports[0] if ports else None

def main():
    print("=" * 60)
    print("     THIRD EYE FOR THE BLIND - AI COMPANION")
    print("=" * 60)

    # Initialize Camera
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[Camera Error]: Could not open webcam. Ensure camera permissions are granted.")
        return

    # Check Serial Port
    port = find_esp32_port()
    ser = None
    if port:
        try:
            ser = serial.Serial(port, 115200, timeout=0.1)
            print(f"[Serial]: Connected to ESP32 on {port}")
        except Exception as e:
            print(f"[Serial Warning]: Could not open {port}: {e}")
    else:
        print("[Serial Notice]: ESP32 not detected on USB. You can press SPACEBAR in the camera window to test AI vision manually.")

    tts_queue.put("Third Eye AI system active.")

    print("\n[Controls]: Press 'SPACE' to trigger AI snapshot manually | Press 'Q' to quit.\n")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Listen for ESP32 trigger line
            if ser and ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("TRIGGER_AI:"):
                    print(f"\n[Hardware Event]: {line}")
                    analyze_and_narrate(frame)

            # Display Preview Window
            cv2.putText(frame, "Third Eye AI Assistant Active", (20, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.imshow("Third Eye AI Companion", frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord(' '):  # Manual spacebar trigger for testing
                print("\n[Manual Trigger]: Capturing snapshot...")
                analyze_and_narrate(frame)
            elif key == ord('q'):
                break

    finally:
        if ser:
            ser.close()
        cap.release()
        cv2.destroyAllWindows()
        tts_queue.put(None)

if __name__ == "__main__":
    main()
