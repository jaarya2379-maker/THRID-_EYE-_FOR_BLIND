// Hardware-independent logic shared by the firmware and the native tests.
#pragma once
#include <stdint.h>

namespace te {

constexpr int MAX_DISTANCE = 150; // cm; beyond this is clear
constexpr int CRITICAL_DIST = 50; // cm; continuous vibration at or below
constexpr uint32_t ON_MS = 70; // pulse length; coin motors need spin-up time
constexpr int NO_DOWN = 999; // downward sensor: no echo

// Median of the last 3 readings. Push timeouts as MAX_DISTANCE + 1.
struct Med3 {
  int v[3];
  int i;
  Med3() : i(0) { fill(MAX_DISTANCE + 1); }
  void fill(int x) { v[0] = v[1] = v[2] = x; }
  int push(int x) {
    v[i] = x;
    i = (i + 1) % 3;
    int a = v[0], b = v[1], c = v[2], t;
    if (a > b) { t = a; a = b; b = t; }
    if (b > c) { t = b; b = c; c = t; }
    if (a > b) { t = a; a = b; b = t; }
    return b;
  }
};

inline long mapLong(long x, long inMin, long inMax, long outMin, long outMax) {
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

enum GroundState { GROUND_OK, GROUND_DROP, GROUND_LOW };

inline GroundState groundState(int dwn, int baseline, int margin) {
  if (dwn >= NO_DOWN || dwn > baseline + margin) return GROUND_DROP;
  if (dwn + margin < baseline) return GROUND_LOW;
  return GROUND_OK;
}

struct HapticInput {
  uint32_t now;
  int distance;
  bool drop, echoStuck, lowBatt, sosConfirm;
};

// Stateless: the motor state is a pure function of time and inputs.
inline bool motorOn(const HapticInput& h) {
  if (h.sosConfirm) return true;
  if (h.echoStuck) {
    uint32_t p = h.now % 6000;
    return p < 600 && (p % 120) < 60;
  }
  if (h.drop) {
    uint32_t p = h.now % 1000;
    return p < 100 || (p >= 200 && p < 300) || (p >= 400 && p < 500);
  }
  if (h.distance <= CRITICAL_DIST) return true;
  if (h.distance <= MAX_DISTANCE) {
    uint32_t off = (uint32_t)mapLong(h.distance, CRITICAL_DIST, MAX_DISTANCE, 60, 300);
    return (h.now % (ON_MS + off)) < ON_MS;
  }
  if (h.lowBatt) {
    uint32_t p = h.now % 30000;
    return p < 100 || (p >= 200 && p < 300);
  }
  return false;
}

} // namespace te
