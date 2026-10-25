#include <cassert>
#include <cstdio>
#include "../../firmware/third_eye_firmware/third_eye_logic.h"

using namespace te;

void test_median3() {
  Med3 med;
  // Initially filled with MAX_DISTANCE + 1 (151)
  assert(med.v[0] == 151 && med.v[1] == 151 && med.v[2] == 151);

  // Finding F3: A single spurious echo among timeouts must be rejected!
  // Pushing one reading of 30 cm into {151, 151, 151}:
  // buffer becomes {30, 151, 151} -> median is 151 (far / no obstacle)
  int m1 = med.push(30);
  assert(m1 == 151);

  // Second 30 cm ping: buffer becomes {30, 30, 151} -> median is 30 (confirmed obstacle!)
  int m2 = med.push(30);
  assert(m2 == 30);

  // Third 30 cm ping: buffer becomes {30, 30, 30} -> median is 30
  int m3 = med.push(30);
  assert(m3 == 30);

  // One timeout ping: buffer becomes {151, 30, 30} -> median is still 30
  int m4 = med.push(151);
  assert(m4 == 30);

  // Second timeout ping: buffer becomes {151, 151, 30} -> median becomes 151
  int m5 = med.push(151);
  assert(m5 == 151);

  printf("[PASS] test_median3 (Outlier rejection & timeout handling)\n");
}

void test_ground_state() {
  const int baseline = 100;
  const int margin = 25;

  // Normal ground level (100 cm)
  assert(groundState(100, baseline, margin) == GROUND_OK);
  assert(groundState(115, baseline, margin) == GROUND_OK);
  assert(groundState(85, baseline, margin) == GROUND_OK);

  // Drop-off (cliff, stairs down, curb down) -> distance increases (> 125 cm or NO_DOWN)
  assert(groundState(130, baseline, margin) == GROUND_DROP);
  assert(groundState(NO_DOWN, baseline, margin) == GROUND_DROP);

  // Low obstacle / step up -> distance decreases (< 75 cm)
  assert(groundState(70, baseline, margin) == GROUND_LOW);
  assert(groundState(40, baseline, margin) == GROUND_LOW);

  printf("[PASS] test_ground_state (Drop-off and low step detection)\n");
}

void test_motor_haptic() {
  HapticInput h = { 0, 120, false, false, false, false };

  // SOS confirmation forces continuous motor
  h.sosConfirm = true;
  assert(motorOn(h) == true);
  h.sosConfirm = false;

  // Critical distance (<= 50 cm) forces continuous motor
  h.distance = 50;
  assert(motorOn(h) == true);
  h.distance = 25;
  assert(motorOn(h) == true);

  // Far distance (> 150 cm) turns motor off
  h.distance = 151;
  assert(motorOn(h) == false);

  // Proximity zone (51 to 150 cm) pulses based on distance
  h.distance = 100;
  // Within active ON window (first ON_MS ms)
  h.now = 10;
  assert(motorOn(h) == true);

  // Drop alert has distinct pulse pattern
  h.distance = 151;
  h.drop = true;
  h.now = 50;  // in first pulse
  assert(motorOn(h) == true);
  h.now = 150; // between pulses
  assert(motorOn(h) == false);

  printf("[PASS] test_motor_haptic (Proportional vibration & priority states)\n");
}

int main() {
  printf("==========================================\n");
  printf("  RUNNING NATIVE FIRMWARE LOGIC TESTS     \n");
  printf("==========================================\n");
  test_median3();
  test_ground_state();
  test_motor_haptic();
  printf("All native logic tests passed successfully.\n");
  return 0;
}
