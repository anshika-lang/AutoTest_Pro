# AutoTest Pro — Autonomous Vehicle Proving Ground & Scenario Testing Suite

An advanced, interactive 3D web-based Autonomous Vehicle (AV) Proving Ground simulator built with Three.js, Vanilla CSS, and modern ES6 JavaScript. Designed for ADAS and Autonomous Driving validation following ISO 26262 and Euro NCAP safety benchmarks.

---

## 🚀 Quick Start

The Vite development server is running locally:
```bash
# To start the dev server anytime:
npm run dev

# Open in browser:
http://localhost:5173/
```

To build a production bundle:
```bash
npm run build
npm run preview
```

---

## 🌟 Key Features & Scenario Triggers

### 1. 🚶 Pedestrian Crossing Scenario (Euro NCAP Urban Crosswalk)
- **Actor:** 3D articulated humanoid mannequin with high-visibility reflective vest and realistic walking stride cadence.
- **Trigger Modes:**
  - **Automated Proximity Trigger:** Steps onto the crosswalk when Ego vehicle is within 34 meters.
  - **Manual Real-Time Injection:** Click **"Pedestrian Crossing"** or press <kbd>P</kbd>.
- **Autonomous Response:** Forward camera and LiDAR detect pedestrian entering crosswalk zone, calculate closure rate and Time-to-Collision (TTC), initiate graduated smooth braking, halt 3.2m before crosswalk, wait until pedestrian completely clears road boundary, and resume cruising smoothly.

### 2. 🛑 Regulatory Stop Sign & Intersection Dwell Scenario
- **Actor:** MUTCD standard octagonal 3D Stop Sign, stop post, flasher beacon, and road stop bar marking.
- **Trigger Modes:**
  - **Scenario Route:** Triggered approaching the urban intersection sector.
  - **Manual Real-Time Injection:** Click **"Stop Sign Challenge"** or press <kbd>S</kbd>.
- **Autonomous Response:** Detects Stop Sign symbol at 40m, initiates parabolic deceleration profile ($a \approx -1.8\text{ m/s}^2$), stops precisely at white stop line ($v = 0.0\text{ km/h}$), enforces mandatory **3.0-second legal dwell countdown** with circular HUD timer, performs cross-traffic clearance scan, and sounds departure chime.

### 3. 🏎️ High-Speed Overtaking & Cut-In Scenario
- **Actor:** Adversary sports sedan running parallel trajectory on the left passing lane.
- **Trigger Modes:**
  - **Scenario Route:** Highway straightaway sector.
  - **Manual Real-Time Injection:** Click **"Overtaking Cut-In"** or press <kbd>O</kbd>.
- **Autonomous Response:** Adversary car accelerates from behind in adjacent lane at 85 km/h, passes Ego car, activates right turn signal blinker, and abruptly cuts in at a 10m gap. Ego radar detects rapid closure, sounds Forward Collision Warning (FCW) chime, modulates throttle, and applies proportional braking to restore a 2.0-second safe following distance.

### 4. ⚠️ Emergency Pop-Up Road Barrel / Hazard
- **Actor:** Heavy-duty reflective orange construction barrel.
- **Trigger:** Click **"Pop-up Obstacle"** or press <kbd>B</kbd> to drop obstacle 25m ahead of Ego car to test emergency swerve or maximum AEB braking ($-8.5\text{ m/s}^2$).

---

## 🎛️ Cockpit & Sensor HUD

- **360° Hesai 128-Beam LiDAR Radar Scope:** Live circular radar display with range rings (18m, 37m, 56m, 75m), rotating sweep beam, object blips with distance tags, and safety envelopes.
- **Forward AI Vision Viewport:** Windshield camera perspective with real-time 3D bounding boxes (`[PEDESTRIAN 18.2m | TTC: 2.1s]`).
- **Telemetry Cluster:**
  - Digital glowing speedometer arc (km/h & mph toggle).
  - Throttle % and Brake / AEB pressure bars.
  - Steering angle gauge with center indicator.
  - 2-Axis G-force accelerometer ball.
  - Instantaneous Time-to-Collision (TTC) bar.
  - Diagnostic Terminal with millisecond-precision event logs.

---

## 🎥 Camera Views & Weather Control

| Key | Mode | Description |
|---|---|---|
| <kbd>1</kbd> | **Chase Cam** | Smooth dynamic 3rd-person follow camera |
| <kbd>2</kbd> | **Cockpit Cam** | Driver / Bumper windshield POV |
| <kbd>3</kbd> | **Top-Down (BEV)** | Bird's-Eye View orthographic track map |
| <kbd>4</kbd> | **Free Orbit** | Mouse drag to rotate, scroll wheel to zoom |

### Atmospheric Weather Modes:
- ☀️ **Clear Day:** Crisp sunlight with sharp shadows (Dry tarmac, $\mu = 0.95$).
- 🌧️ **Rain & Wet Track:** Overcast reflections, reduced tire grip ($\mu = 0.65$).
- 🌫️ **Dense Sensor Fog:** Heavy optical mist challenging camera and LiDAR ranges.
- 🌙 **Night Driving:** Dark proving ground with dual LED projector headlights illuminating the road.

---

## 📄 OpenSCENARIO & Data Export

- **Export OpenSCENARIO (.xosc):** Exports ASAM OpenSCENARIO 1.2 compliant XML definitions containing Catalogs, Storyboard, Entities, Maneuvers, and Event Condition Groups ready for import into CARLA, esmini, VIRES VTD, or IPG CarMaker.
- **Export Telemetry Blackbox (.json):** Exports full frame-by-frame sensor and kinematic recordings (speed, TTC, deceleration G, brake/throttle actuation, timestamps, and pass/fail evaluation).

---

## 🎮 Keyboard Reference

- <kbd>P</kbd> — Trigger Pedestrian Crossing
- <kbd>S</kbd> — Trigger Regulatory Stop Sign Challenge
- <kbd>O</kbd> — Trigger High-Speed Overtaking Cut-In
- <kbd>B</kbd> — Deploy Pop-up Road Barrel
- <kbd>Space</kbd> — Pause / Resume Simulation
- <kbd>R</kbd> — Reset Vehicle to Start Line
- <kbd>W</kbd> / <kbd>A</kbd> / <kbd>S</kbd> / <kbd>D</kbd> — Manual Driving Override
- <kbd>E</kbd> — Emergency Stop (E-STOP)
- <kbd>M</kbd> — Toggle Audio Mute
