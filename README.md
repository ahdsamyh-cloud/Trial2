# ESP32 Early Fault Detection Rig

Two MPU6050 IMUs + one DHT22 temperature/humidity sensor on an ESP32,
streaming vibration and environmental data to a Node-RED dashboard for
live graphing. Vibration is scored against each sensor's own recent
baseline so a sudden increase (loose mount, bearing wear, imbalance,
impact) trips a fault flag automatically.

## Contents

- `esp32/fault_detection.ino` — firmware (Arduino core for ESP32)
- `nodered/flow.json` — importable Node-RED flow (chart + gauges + fault status)

## How it works

1. Both MPU6050s share the ESP32's one I2C bus; `AD0` selects each
   sensor's address (`0x68` / `0x69`) so they can coexist.
2. The ESP32 samples acceleration magnitude from both sensors at 100 Hz,
   and every 500 ms computes, per sensor: RMS vibration (gravity/tilt
   removed), peak deviation, and a slow exponential-moving-average
   baseline.
3. A fault is flagged when the instantaneous RMS exceeds both an
   absolute noise floor and 2× that sensor's own baseline — so it adapts
   to each mounting location instead of using one fixed global threshold.
4. Every window, the ESP32 POSTs a JSON summary over Wi-Fi to a Node-RED
   `http in` node running on your Mac. Node-RED plots vibration RMS for
   both sensors on one live chart, shows temperature/humidity gauges,
   and lights up a fault indicator.

## Wiring diagram

See the published wiring diagram: it covers power/ground, the shared
I2C bus, `AD0` address selection for the two MPU6050s, the DHT22 data
line (with pull-up), and the fault LED — with a full pin table and
color-coded wiring legend.

### Pin summary (ESP32 dev board)

| Signal              | ESP32 pin | Goes to                          |
|---------------------|-----------|-----------------------------------|
| 3V3                 | 3V3       | MPU1 VCC, MPU2 VCC, MPU2 AD0, DHT22 VCC |
| GND                 | GND       | MPU1 GND, MPU2 GND, MPU1 AD0, DHT22 GND, LED cathode (via resistor) |
| I2C SDA             | GPIO21    | MPU1 SDA, MPU2 SDA (same bus)    |
| I2C SCL             | GPIO22    | MPU1 SCL, MPU2 SCL (same bus)    |
| DHT22 data          | GPIO4     | DHT22 DATA (10kΩ pull-up to 3V3) |
| Fault LED           | GPIO2     | LED anode (via ~220Ω resistor)   |

MPU6050 #1 has `AD0` tied to GND (address `0x68`); MPU6050 #2 has `AD0`
tied to 3V3 (address `0x69`) — this is what lets both share the SDA/SCL
bus without conflicting.

## 1. Flash the ESP32

1. In Arduino IDE, install: **Adafruit MPU6050**, **Adafruit Unified
   Sensor**, **Adafruit BusIO**, **DHT sensor library** (Adafruit),
   **ArduinoJson** (via Library Manager).
2. Open `esp32/fault_detection.ino` and edit the top of the file:
   - `WIFI_SSID` / `WIFI_PASSWORD`
   - `NODE_RED_HOST` — your Mac's IP address on the same Wi-Fi network
     (find it in System Settings → Wi-Fi → Details, or run
     `ipconfig getifaddr en0` in Terminal).
3. Select your ESP32 board + port, then upload.
4. Open the Serial Monitor at 115200 baud — you should see per-window
   lines like:
   `S1 rms=0.041 pk=0.09 base=0.043 fault=0 | S2 ... | T=23.4C H=41.0% | HTTP=200`

## 2. Set up Node-RED on your Mac

```bash
# install Node.js first if you don't have it (nodejs.org), then:
npm install -g --unsafe-perm node-red
node-red
```

Node-RED starts on `http://localhost:1880` (and `http://<your-mac-ip>:1880`,
which is what the ESP32 talks to). Then, in the Node-RED palette manager
(hamburger menu → Manage palette → Install), install:

- `node-red-dashboard`

Import the flow:

1. Hamburger menu → Import → select `nodered/flow.json` from this repo.
2. Deploy.
3. Open the dashboard at `http://localhost:1880/ui` — you'll see the
   **Machine Health** tab with the live vibration chart, temperature and
   humidity gauges, and the fault status/indicator.

Make sure macOS Firewall allows incoming connections for Node-RED
(node) so the ESP32 on your LAN can reach port 1880.

## Tuning fault sensitivity

In `fault_detection.ino`:

- `FAULT_MULTIPLIER` (default `2.0`) — how many multiples of a sensor's
  own baseline RMS counts as a fault. Lower = more sensitive.
- `MIN_ABS_THRESHOLD` (default `0.15` m/s²) — noise floor; prevents
  false triggers when the machine is idle and baseline is near zero.
- `BASELINE_ALPHA` (default `0.05`) — how fast the baseline adapts.
  Lower = slower-adapting baseline, more sensitive to sustained change.

Let the rig run for a minute or two after power-up so each baseline
settles before relying on fault flags.
