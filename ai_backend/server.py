import io
import os
import queue
import threading
from flask import Flask, request, jsonify
from PIL import Image
import pyttsx3
from google import genai
from google.genai import types

app = Flask(__name__)

# ==========================================
# 1. Text-To-Speech (TTS) Worker Queue
# ==========================================
tts_queue = queue.Queue()

def tts_worker():
    """Background thread to process speech messages without blocking API requests."""
    engine = pyttsx3.init()
    engine.setProperty('rate', 175) # Comfortable speaking pace
    while True:
        text = tts_queue.get()
        if text is None:
            break
        try:
            print(f"[TTS Speaking]: {text}")
            engine.say(text)
            engine.runAndWait()
        except Exception as e:
            print(f"[TTS Error]: {e}")
        finally:
            tts_queue.task_done()

tts_thread = threading.Thread(target=tts_worker, daemon=True)
tts_thread.start()

# ==========================================
# 2. Initialize Gemini API Client
# ==========================================
api_key = os.environ.get("GEMINI_API_KEY")
gemini_client = None

if api_key:
    try:
        gemini_client = genai.Client(api_key=api_key)
        print("[AI Backend]: Gemini client initialized successfully.")
    except Exception as e:
        print(f"[AI Backend Error]: Failed to initialize Gemini client: {e}")
else:
    print("[WARNING]: GEMINI_API_KEY environment variable is not set! Set it via: export GEMINI_API_KEY='your_key'")

# System instruction focused on rapid mobility assistance for the visually impaired
ASSISTANT_PROMPT = (
    "You are an AI assistant for a visually impaired user navigating their surroundings. "
    "Analyze the image captured from their wearable camera. "
    "In 1 to 2 crisp, direct sentences (under 25 words total), identify: "
    "1. Immediate obstacles, tripping hazards, or elevation changes (curbs, stairs, doors, poles). "
    "2. If a prominent sign or label is visible, read it verbatim. "
    "Be concise, direct, and actionable. Do not use conversational filler."
)

@app.route("/analyze", methods=["POST"])
def analyze_frame():
    """Receives a JPEG image from ESP32-CAM and performs AI vision analysis."""
    if not request.data:
        return jsonify({"error": "No image data received"}), 400

    trigger_reason = request.headers.get("X-Trigger-Reason", "proximity")
    print(f"\n[Incoming Frame]: Received {len(request.data)} bytes (Trigger: {trigger_reason})")

    try:
        # Load and validate image
        image = Image.open(io.BytesIO(request.data))

        if not gemini_client:
            mock_text = "Obstacle ahead. Gemini API key is missing on the server."
            tts_queue.put(mock_text)
            return jsonify({"status": "warning", "message": mock_text}), 200

        # Call Gemini Vision Model
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[image, ASSISTANT_PROMPT]
        )

        # Safety rule: Never assume path is clear if AI output is empty
        guidance_text = response.text.strip() if (response.text and response.text.strip()) else "Caution: Vision inconclusive. Use cane."
        print(f"[AI Assessment]: {guidance_text}")

        # Queue speech output
        tts_queue.put(guidance_text)

        return jsonify({
            "status": "success",
            "trigger": trigger_reason,
            "guidance": guidance_text
        })

    except Exception as e:
        print(f"[Processing Error]: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "running", "gemini_configured": gemini_client is not None})

if __name__ == "__main__":
    print("=" * 60)
    print("Third Eye AI Server listening on http://0.0.0.0:5000")
    print("Ensure your ESP32-CAM and this machine are on the same Wi-Fi network.")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=False)
