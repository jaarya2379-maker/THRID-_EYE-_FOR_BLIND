#!/usr/bin/env python3
"""
Third Eye AI — System Logic & Simulation Benchmark Suite
NOTE (Finding F1): This suite tests software state machines, statistical noise rejection models,
and failure-recovery invariants in simulation. For physical hardware tests with a real tape measure,
use `tools/measure.py`.
"""

import unittest
import time
import math
import random

class UltrasonicFilter3:
    """Python reference of the C++ Med3 sliding median filter in third_eye_logic.h."""
    def __init__(self, max_dist=150):
        self.max_dist = max_dist
        self.buffer = [max_dist + 1, max_dist + 1, max_dist + 1]
        self.idx = 0

    def push(self, raw_cm):
        # Push timeouts or out-of-bounds as MAX_DISTANCE + 1
        val = (self.max_dist + 1) if (raw_cm is None or raw_cm < 2 or raw_cm > self.max_dist) else raw_cm
        self.buffer[self.idx] = val
        self.idx = (self.idx + 1) % 3
        # Fast 3-element median
        s = sorted(self.buffer)
        return s[1]

class HapticZoneClassifier:
    """Classifies distance into tactile vibration zones matching third_eye_logic.h."""
    CRITICAL_DIST = 50 # 50 cm continuous vibration
    MAX_DIST = 150     # 150 cm proportional pulsing boundary

    @classmethod
    def classify(cls, dist_cm):
        if dist_cm is None or dist_cm > cls.MAX_DIST:
            return "SAFE_IDLE"
        if dist_cm <= cls.CRITICAL_DIST:
            return "DANGER_SOLID_BUZZ"
        else:
            return "CAUTION_PULSING"

class CaregiverSosStateMachine:
    """Models the user-triggered SOS emergency dispatch & acknowledgment lifecycle."""
    STATES = ["IDLE", "DISPATCHED", "DELIVERED", "ACKNOWLEDGED", "CANCELLED"]

    def __init__(self):
        self.state = "IDLE"
        self.trigger_timestamp = None
        self.ack_timestamp = None
        self.reason = None

    def trigger_sos(self, reason="Manual Button Press"):
        self.state = "DISPATCHED"
        self.trigger_timestamp = time.time()
        self.reason = reason
        return self.state

    def mark_delivered(self):
        if self.state == "DISPATCHED":
            self.state = "DELIVERED"
        return self.state

    def acknowledge_by_caregiver(self):
        if self.state in ["DISPATCHED", "DELIVERED"]:
            self.state = "ACKNOWLEDGED"
            self.ack_timestamp = time.time()
        return self.state

    def cancel_alarm(self):
        self.state = "CANCELLED"
        return self.state

class SensorWatchdog:
    """Detects missing or stuck echo telemetry."""
    def __init__(self, timeout_seconds=1.8):
        self.timeout_seconds = timeout_seconds
        self.last_reading_time = time.time()
        self.fault_active = False

    def on_reading_received(self):
        self.last_reading_time = time.time()
        self.fault_active = False

    def check_health(self, current_time=None):
        now = current_time if current_time is not None else time.time()
        if now - self.last_reading_time > self.timeout_seconds:
            self.fault_active = True
        return not self.fault_active

# ==========================================
# Unit Tests for System Logic
# ==========================================
class TestSystemLogic(unittest.TestCase):

    def test_median_filter_outlier_rejection(self):
        """Verifies that single-sample multipath noise is rejected (Finding F3)."""
        filt = UltrasonicFilter3(max_dist=150)
        # Initially filled with 151
        self.assertEqual(filt.push(151), 151)

        # Single spurious echo (30cm) among timeouts (151cm) must be rejected
        self.assertEqual(filt.push(30), 151)

        # Second confirmed reading -> median becomes 30
        self.assertEqual(filt.push(30), 30)

        # Third reading -> median stays 30
        self.assertEqual(filt.push(30), 30)

        # One timeout reading -> median still 30
        self.assertEqual(filt.push(151), 30)

        # Second timeout reading -> median becomes 151
        self.assertEqual(filt.push(151), 151)

    def test_haptic_zone_boundaries(self):
        """Validates tactile safety zones matching firmware v3.2."""
        self.assertEqual(HapticZoneClassifier.classify(15), "DANGER_SOLID_BUZZ")
        self.assertEqual(HapticZoneClassifier.classify(50), "DANGER_SOLID_BUZZ")
        self.assertEqual(HapticZoneClassifier.classify(51), "CAUTION_PULSING")
        self.assertEqual(HapticZoneClassifier.classify(100), "CAUTION_PULSING")
        self.assertEqual(HapticZoneClassifier.classify(150), "CAUTION_PULSING")
        self.assertEqual(HapticZoneClassifier.classify(151), "SAFE_IDLE")
        self.assertEqual(HapticZoneClassifier.classify(200), "SAFE_IDLE")

    def test_caregiver_emergency_loop(self):
        """Validates that SOS transitions correctly through acknowledgment loop."""
        sos = CaregiverSosStateMachine()
        self.assertEqual(sos.state, "IDLE")

        sos.trigger_sos("Hold Button 1.5s")
        self.assertEqual(sos.state, "DISPATCHED")

        sos.mark_delivered()
        self.assertEqual(sos.state, "DELIVERED")

        sos.acknowledge_by_caregiver()
        self.assertEqual(sos.state, "ACKNOWLEDGED")
        self.assertIsNotNone(sos.ack_timestamp)

    def test_watchdog_timeout_recovery(self):
        """Verifies that sensor failure is flagged when telemetry stops."""
        watchdog = SensorWatchdog(timeout_seconds=1.5)
        start_t = 1000.0
        watchdog.last_reading_time = start_t

        # Normal condition (< 1.5s)
        self.assertTrue(watchdog.check_health(current_time=start_t + 0.5))

        # Timeout condition (> 1.5s)
        self.assertFalse(watchdog.check_health(current_time=start_t + 2.0))
        self.assertTrue(watchdog.fault_active)

        # Recovery when new reading arrives
        watchdog.on_reading_received()
        self.assertFalse(watchdog.fault_active)

def print_simulation_benchmarks():
    print("=" * 65)
    print("   THIRD EYE AI — SYSTEM LOGIC & SIMULATION BENCHMARK REPORT")
    print("   (Synthetic Model Evaluation — for hardware testing use tools/measure.py)")
    print("=" * 65)

    distances = [10, 25, 50, 100, 150]
    print("\n[Simulated Model: Gaussian Noise Rejection (50 trials/dist)]")
    print("True (cm)  | Mean Meas (cm)  | Abs Error (cm)  | Std Dev (cm)")
    print("-" * 58)
    random.seed(42)
    for d in distances:
        filt = UltrasonicFilter3(max_dist=150)
        filt.buffer = [d, d, d]
        trials = [filt.push(d + random.gauss(0, 0.4 + (d * 0.008))) for _ in range(50)]
        mean_meas = sum(trials) / len(trials)
        abs_err = abs(mean_meas - d)
        std_dev = math.sqrt(sum((x - mean_meas) ** 2 for x in trials) / len(trials))
        print(f"{d:<10} | {mean_meas:<15.2f} | {abs_err:<15.2f} | {std_dev:<12.2f}")

    print("\n[Timing Specifications from Architecture (Tiers 1-4)]")
    print("  - Tier 1: Ultrasonic Echo -> Motor Vibration:  25 to 60 ms  (ESP32 local)")
    print("  - Tier 2: BLE UART DIST -> Phone Beep:          15 to 30 ms  (BLE transmission)")
    print("  - Tier 3: On-Device Detector -> Spoken Label:   200 to 400 ms (Local model)")
    print("  - Tier 4: Gemini Multimodal Vision API:        1 to 3 s      (Cloud network)")
    print("=" * 65 + "\n")

if __name__ == '__main__':
    print_simulation_benchmarks()
    unittest.main()
