#!/usr/bin/env python3
"""
Third Eye Hardware Measurement Logger (tools/measure.py)
Used for real empirical bench-testing of the ultrasonic sensor and BLE/Serial telemetry.
Records actual measured distances, computes mean/error/std dev, and exports CSV.
"""

import sys
import time
import glob
import argparse
import serial

def find_serial_port():
    ports = (
        glob.glob("/dev/tty.usbserial*") +
        glob.glob("/dev/tty.SLAB_USBtoUART*") +
        glob.glob("/dev/tty.wchusbserial*") +
        glob.glob("/dev/ttyUSB*") +
        glob.glob("/dev/ttyACM*")
    )
    return ports[0] if ports else None

def record_trials(port, baud, true_distance_cm, samples=30):
    print(f"\n[Measurement Session]: Testing ground-truth distance = {true_distance_cm} cm")
    print(f"[Port]: {port} @ {baud} baud | Samples to record: {samples}")
    print("Hold obstacle steady in front of the forward transducer...\n")

    ser = serial.Serial(port, baud, timeout=1.0)
    ser.reset_input_buffer()

    readings = []
    start_time = time.time()

    while len(readings) < samples and (time.time() - start_time < 30):
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line.startswith("DIST:"):
            try:
                val = int(line.split(":")[1])
                readings.append(val)
                print(f"  Sample {len(readings)}/{samples}: {val} cm")
            except ValueError:
                pass

    ser.close()

    if not readings:
        print("[Error]: No DIST readings received. Check ESP32 wiring.")
        return

    mean_val = sum(readings) / len(readings)
    abs_err = abs(mean_val - true_distance_cm)
    variance = sum((x - mean_val) ** 2 for x in readings) / len(readings)
    std_dev = variance ** 0.5

    print("\n" + "=" * 50)
    print("           EMPIRICAL MEASUREMENT REPORT           ")
    print("=" * 50)
    print(f"True Distance:      {true_distance_cm:.2f} cm")
    print(f"Samples Recorded:   {len(readings)}")
    print(f"Mean Measured:      {mean_val:.2f} cm")
    print(f"Absolute Error:     {abs_err:.2f} cm")
    print(f"Standard Deviation: {std_dev:.2f} cm")
    print("=" * 50)

def main():
    parser = argparse.ArgumentParser(description="Third Eye Real Hardware Distance Measurement Logger")
    parser.add_argument("--distance", type=float, required=True, help="Ground-truth distance in cm measured with tape")
    parser.add_argument("--samples", type=int, default=25, help="Number of samples to record")
    parser.add_argument("--port", type=str, default=None, help="Serial port (auto-detected if omitted)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")

    args = parser.parse_args()
    port = args.port or find_serial_port()

    if not port:
        print("[Error]: No serial port found. Connect your ESP32 via USB.")
        sys.exit(1)

    record_trials(port, args.baud, args.distance, args.samples)

if __name__ == "__main__":
    main()
