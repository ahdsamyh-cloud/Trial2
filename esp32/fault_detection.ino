/*
  ESP32 Early Fault Detection Rig
  -------------------------------
  Two MPU6050 IMUs (mounted at two points on the machine/structure being
  monitored) + one DHT22 temperature/humidity sensor.

  The ESP32 samples both accelerometers at SAMPLE_RATE_HZ, computes a
  vibration RMS + peak value per WINDOW_MS window (gravity/orientation
  removed by subtracting the window mean), tracks a slow-moving baseline
  per sensor, and flags a fault when the instantaneous vibration jumps
  well above that sensor's own recent baseline. Every window it POSTs a
  JSON summary to a Node-RED "http in" endpoint for live graphing.

  Required libraries (install via Arduino Library Manager):
    - Adafruit MPU6050
    - Adafruit Unified Sensor
    - Adafruit BusIO
    - DHT sensor library (Adafruit)
    - ArduinoJson (bblanchon)

  Board: any ESP32 dev board (Arduino core for ESP32).
*/

#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>

// ---------------- USER CONFIG ----------------
const char *WIFI_SSID     = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// IP address of the Mac running Node-RED (System Settings > Wi-Fi > Details,
// or `ipconfig getifaddr en0` in Terminal). Node-RED default port is 1880.
const char *NODE_RED_HOST = "192.168.1.50";
const uint16_t NODE_RED_PORT = 1880;
const char *NODE_RED_PATH = "/vibration";

// ---------------- PINS ----------------
#define DHTPIN      4      // DHT22 data pin
#define DHTTYPE     DHT22
#define STATUS_LED  2      // onboard LED on most ESP32 dev boards

// MPU6050 addresses selected via the AD0 pin (see wiring diagram):
//   AD0 -> GND  => 0x68
//   AD0 -> 3V3  => 0x69
#define MPU1_ADDR 0x68
#define MPU2_ADDR 0x69

// ---------------- FAULT DETECTION TUNING ----------------
#define SAMPLE_RATE_HZ     100                                  // IMU samples/sec
#define WINDOW_MS          500                                  // stats window
#define WINDOW_SAMPLES     (SAMPLE_RATE_HZ * WINDOW_MS / 1000)  // samples/window
#define FAULT_MULTIPLIER   2.0f     // instantaneous RMS vs baseline trigger ratio
#define MIN_ABS_THRESHOLD  0.15f    // m/s^2, ignores sensor noise floor
#define BASELINE_ALPHA     0.05f    // EMA smoothing factor for the baseline

Adafruit_MPU6050 mpu1;
Adafruit_MPU6050 mpu2;
DHT dht(DHTPIN, DHTTYPE);

struct VibStats {
  float rms;
  float peak;
  bool fault;
};

float buf1[WINDOW_SAMPLES];
float buf2[WINDOW_SAMPLES];
int sampleIdx = 0;
unsigned long lastSampleMs = 0;

float baseline1 = 0.0f, baseline2 = 0.0f;
bool baselineInit = false;

// ---------------- HELPERS ----------------
float readMagnitude(Adafruit_MPU6050 &mpu) {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  return sqrt(a.acceleration.x * a.acceleration.x +
              a.acceleration.y * a.acceleration.y +
              a.acceleration.z * a.acceleration.z);
}

VibStats computeStats(float *buf, int n, float &baseline) {
  float mean = 0;
  for (int i = 0; i < n; i++) mean += buf[i];
  mean /= n;

  float sumSq = 0, peak = 0;
  for (int i = 0; i < n; i++) {
    float d = buf[i] - mean;   // removes gravity + sensor orientation offset
    sumSq += d * d;
    if (fabs(d) > peak) peak = fabs(d);
  }
  float rms = sqrt(sumSq / n);

  if (!baselineInit) {
    baseline = rms;
  } else {
    baseline = baseline * (1.0f - BASELINE_ALPHA) + rms * BASELINE_ALPHA;
  }

  bool fault = (rms > MIN_ABS_THRESHOLD) && (rms > baseline * FAULT_MULTIPLIER);
  return VibStats{rms, peak, fault};
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connect timed out, will retry in loop().");
  }
}

void publish(const VibStats &s1, const VibStats &s2, float temp, float hum) {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  StaticJsonDocument<512> doc;
  doc["ts"] = millis();

  JsonObject j1 = doc.createNestedObject("s1");
  j1["vib_rms"] = s1.rms;
  j1["vib_peak"] = s1.peak;
  j1["baseline"] = baseline1;
  j1["fault"] = s1.fault;

  JsonObject j2 = doc.createNestedObject("s2");
  j2["vib_rms"] = s2.rms;
  j2["vib_peak"] = s2.peak;
  j2["baseline"] = baseline2;
  j2["fault"] = s2.fault;

  doc["temp"] = temp;
  doc["hum"] = hum;

  bool anyFault = s1.fault || s2.fault;
  doc["fault"] = anyFault;
  doc["fault_reason"] = (s1.fault && s2.fault) ? "both sensors"
                       : s1.fault ? "sensor 1 (location A)"
                       : s2.fault ? "sensor 2 (location B)"
                       : "none";

  String json;
  serializeJson(doc, json);

  HTTPClient http;
  String url = String("http://") + NODE_RED_HOST + ":" + NODE_RED_PORT + NODE_RED_PATH;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(json);
  http.end();

  digitalWrite(STATUS_LED, anyFault ? HIGH : LOW);

  Serial.printf(
    "[%lu] S1 rms=%.3f pk=%.3f base=%.3f fault=%d | "
    "S2 rms=%.3f pk=%.3f base=%.3f fault=%d | T=%.1fC H=%.1f%% | HTTP=%d\n",
    millis(), s1.rms, s1.peak, baseline1, s1.fault,
    s2.rms, s2.peak, baseline2, s2.fault, temp, hum, code);
}

// ---------------- SETUP / LOOP ----------------
void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);
  Wire.begin();  // default ESP32 I2C pins: SDA=21, SCL=22

  if (!mpu1.begin(MPU1_ADDR, &Wire)) {
    Serial.println("MPU6050 #1 not found at 0x68 - check wiring/AD0.");
    while (1) delay(10);
  }
  if (!mpu2.begin(MPU2_ADDR, &Wire)) {
    Serial.println("MPU6050 #2 not found at 0x69 - check wiring/AD0.");
    while (1) delay(10);
  }

  for (Adafruit_MPU6050 *m : {&mpu1, &mpu2}) {
    m->setAccelerometerRange(MPU6050_RANGE_4_G);
    m->setGyroRange(MPU6050_RANGE_500_DEG);
    m->setFilterBandwidth(MPU6050_BAND_44_HZ);
  }

  dht.begin();
  connectWiFi();
}

void loop() {
  unsigned long now = millis();

  if (now - lastSampleMs >= (1000 / SAMPLE_RATE_HZ)) {
    lastSampleMs = now;

    buf1[sampleIdx] = readMagnitude(mpu1);
    buf2[sampleIdx] = readMagnitude(mpu2);
    sampleIdx++;

    if (sampleIdx >= WINDOW_SAMPLES) {
      VibStats s1 = computeStats(buf1, WINDOW_SAMPLES, baseline1);
      VibStats s2 = computeStats(buf2, WINDOW_SAMPLES, baseline2);
      baselineInit = true;
      sampleIdx = 0;

      float t = dht.readTemperature();
      float h = dht.readHumidity();
      if (isnan(t)) t = -999;
      if (isnan(h)) h = -999;

      publish(s1, s2, t, h);
    }
  }
}
