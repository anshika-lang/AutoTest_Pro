import * as THREE from 'three';
import { TrackManager } from './track.js';
import { Vehicle } from './vehicle.js';
import { PedestrianActor, AdversaryVehicleActor, RoadObstacleActor } from './adversary.js';
import { AutonomyStack } from './autonomy.js';
import { ScenarioManager } from './scenario.js';
import { SensorVisualizer } from './radar.js';
import { sound } from './audio.js';

// ============================================================================
// MAIN APPLICATION ENGINE
// ============================================================================
class AutoTestApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.scene = null;
    this.renderer = null;
    this.lastTime = performance.now();

    // Cameras
    this.activeCameraMode = 'chase'; // 'chase', 'cockpit', 'bev', 'orbit'
    this.camera = null;
    this.visionCamera = null; // Secondary camera for forward AI vision viewport

    // Orbit controls state
    this.orbitRadius = 18;
    this.orbitTheta = 0;
    this.orbitPhi = Math.PI / 4;
    this.isDragging = false;
    this.prevMousePos = { x: 0, y: 0 };

    // Weather & Atmosphere
    this.currentWeather = 'day';
    this.sunLight = null;
    this.ambientLight = null;

    // Simulation State
    this.isPaused = false;
    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsUpdate = 0;

    // Manual input state
    this.keys = {};

    this.initThree();
    this.initSimulation();
    this.applyWeather('day');
    this.initUI();
    this.bindEvents();
    this.animate();
  }

  initThree() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1d);
    this.scene.fog = new THREE.FogExp2(0x0a0f1d, 0.0018);

    // 2. Main Camera
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 800);
    this.camera.position.set(0, 15, 30);

    // 3. Forward Vision AI Camera (Windshield POV)
    this.visionCamera = new THREE.PerspectiveCamera(70, 300 / 170, 0.4, 150);

    // 4. Renderer with shadow maps
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 5. Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(this.ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xb1e1ff, 0x224433, 0.85);
    hemiLight.position.set(0, 80, 0);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff8ee, 1.8);
    this.sunLight.position.set(80, 140, 60);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 400;
    const d = 120;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Initial camera snap flag
    this.isCameraSnapped = false;
  }

  initSimulation() {
    // 1. Build Proving Ground Track
    this.track = new TrackManager(this.scene);

    // 2. Build Autonomous Research Vehicle (Ego Car)
    this.ego = new Vehicle(this.scene, true, 0x00f3ff);

    // 3. Dynamic Actors
    this.actors = {
      pedestrian: new PedestrianActor(this.scene, this.track),
      adversary: new AdversaryVehicleActor(this.scene, this.track),
      obstacle: new RoadObstacleActor(this.scene, this.track)
    };

    // 4. Autonomy Stack
    this.autonomy = new AutonomyStack(this.ego, this.track, this.actors);

    // 5. Scenario Manager
    this.scenario = new ScenarioManager(
      this.ego,
      this.track,
      this.actors,
      this.autonomy,
      (msg, type) => this.addDiagnosticLog(msg, type)
    );
    this.autonomy.scenario = this.scenario;

    // 6. Sensor Visualization HUD
    const radarCanvas = document.getElementById('radar-canvas');
    const visionCanvas = document.getElementById('vision-canvas');
    const aiOverlay = document.getElementById('ai-boxes-overlay');
    this.sensorVis = new SensorVisualizer(radarCanvas, visionCanvas, aiOverlay);

    // Position Ego at initial scenario start
    this.scenario.setScenario('pedestrian');
  }

  // ============================================================================
  // WEATHER & ATMOSPHERE SYSTEM
  // ============================================================================
  applyWeather(type) {
    this.currentWeather = type;

    const weatherIcon = document.getElementById('weather-icon');
    const weatherLabel = document.getElementById('weather-label');

    switch (type) {
      case 'day':
        this.scene.background.setHex(0x0a101d);
        this.scene.fog.color.setHex(0x0a101d);
        this.scene.fog.density = 0.0018;
        this.ambientLight.intensity = 0.65;
        this.sunLight.intensity = 1.8;
        this.sunLight.color.setHex(0xfff5e6);
        if (this.ego) this.ego.frictionCoeff = 0.95; // Dry tarmac
        if (weatherIcon) weatherIcon.textContent = '☀️';
        if (weatherLabel) weatherLabel.textContent = 'Clear Day';
        this.addDiagnosticLog('Atmospheric condition set to: Clear Proving Ground (Dry Tarmac, μ=0.95)', 'info');
        break;

      case 'rain':
        this.scene.background.setHex(0x080c14);
        this.scene.fog.color.setHex(0x080c14);
        this.scene.fog.density = 0.005;
        this.ambientLight.intensity = 0.35;
        this.sunLight.intensity = 0.7;
        this.sunLight.color.setHex(0x8899aa);
        if (this.ego) this.ego.frictionCoeff = 0.65; // Wet slick tarmac
        if (weatherIcon) weatherIcon.textContent = '🌧️';
        if (weatherLabel) weatherLabel.textContent = 'Rain & Wet Track';
        this.addDiagnosticLog('Weather condition set to: Wet Slick Surface (Friction reduced to μ=0.65)', 'warn');
        break;

      case 'fog':
        this.scene.background.setHex(0x1a2332);
        this.scene.fog.color.setHex(0x1a2332);
        this.scene.fog.density = 0.018; // Dense sensor fog
        this.ambientLight.intensity = 0.45;
        this.sunLight.intensity = 0.6;
        if (this.ego) this.ego.frictionCoeff = 0.85;
        if (weatherIcon) weatherIcon.textContent = '🌫️';
        if (weatherLabel) weatherLabel.textContent = 'Dense Sensor Fog';
        this.addDiagnosticLog('Sensor Challenge: Dense Fog (Challenging optical & LiDAR penetration)', 'warn');
        break;

      case 'night':
        this.scene.background.setHex(0x020408);
        this.scene.fog.color.setHex(0x020408);
        this.scene.fog.density = 0.003;
        this.ambientLight.intensity = 0.12;
        this.sunLight.intensity = 0.15;
        this.sunLight.color.setHex(0x334466);
        if (this.ego) this.ego.frictionCoeff = 0.92;
        if (weatherIcon) weatherIcon.textContent = '🌙';
        if (weatherLabel) weatherLabel.textContent = 'Night Proving Ground';
        this.addDiagnosticLog('Lighting mode set to: Night Testing with LED Headlights', 'info');
        break;
    }
  }

  // ============================================================================
  // CAMERA CONTROLLER
  // ============================================================================
  updateCamera(deltaTime) {
    const egoPos = this.ego.position;
    const egoYaw = this.ego.yaw;

    // Windshield POV for secondary Vision AI camera
    const camOffset = new THREE.Vector3(0, 1.25, 0.8);
    camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), egoYaw);
    this.visionCamera.position.copy(egoPos).add(camOffset);
    const forwardPt = egoPos.clone().add(this.ego.getHeadingVector().multiplyScalar(40));
    forwardPt.y = 1.2;
    this.visionCamera.lookAt(forwardPt);

    // Primary User Camera
    switch (this.activeCameraMode) {
      case 'chase': {
        // Smooth 3rd person trailing camera
        const followDist = 13.0;
        const followHeight = 5.2;
        const targetPos = new THREE.Vector3(
          egoPos.x - Math.sin(egoYaw) * followDist,
          egoPos.y + followHeight,
          egoPos.z - Math.cos(egoYaw) * followDist
        );

        if (!this.isCameraSnapped) {
          this.camera.position.copy(targetPos);
          this.isCameraSnapped = true;
        } else {
          this.camera.position.lerp(targetPos, Math.min(1.0, deltaTime * 8));
        }

        const lookTarget = egoPos.clone().add(new THREE.Vector3(0, 1.2, 0));
        this.camera.lookAt(lookTarget);
        break;
      }

      case 'cockpit': {
        // Driver / Bumper POV
        const eyeOffset = new THREE.Vector3(0, 1.35, 0.4);
        eyeOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), egoYaw);
        this.camera.position.copy(egoPos).add(eyeOffset);
        const lookAtPt = egoPos.clone().add(this.ego.getHeadingVector().multiplyScalar(50));
        lookAtPt.y = 1.2;
        this.camera.lookAt(lookAtPt);
        break;
      }

      case 'bev': {
        // Bird's Eye View (Orthogonal top-down)
        const targetPos = new THREE.Vector3(egoPos.x, 85, egoPos.z);
        this.camera.position.lerp(targetPos, Math.min(1.0, deltaTime * 8));
        this.camera.lookAt(egoPos.x, 0, egoPos.z);
        break;
      }

      case 'orbit': {
        // Free orbital rotation around Ego car
        const ox = egoPos.x + this.orbitRadius * Math.sin(this.orbitTheta) * Math.cos(this.orbitPhi);
        const oy = egoPos.y + this.orbitRadius * Math.sin(this.orbitPhi);
        const oz = egoPos.z + this.orbitRadius * Math.cos(this.orbitTheta) * Math.cos(this.orbitPhi);
        this.camera.position.set(ox, oy, oz);
        this.camera.lookAt(egoPos.x, egoPos.y + 1.2, egoPos.z);
        break;
      }
    }
  }

  // ============================================================================
  // ANIMATION LOOP
  // ============================================================================
  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const deltaTime = Math.min(0.08, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    // FPS counter calculation
    this.frameCount++;
    if (now - this.lastFpsUpdate >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      const fpsEl = document.getElementById('fps-counter');
      if (fpsEl) fpsEl.textContent = `${this.fps} FPS`;
    }

    if (!this.isPaused) {
      // 1. Process Manual Keyboard Control if active
      this.processManualInput(deltaTime);

      // 2. Update Autonomy Stack
      this.autonomy.update(deltaTime);

      // 3. Update Dynamic Actors
      this.actors.pedestrian.update(deltaTime);
      this.actors.adversary.update(deltaTime, this.ego, this.autonomy.currentTrackU);

      // 4. Update Scenario Execution & Compliance
      this.scenario.update(deltaTime);

      // 5. Sound synthesis update
      sound.updateMotorSound(this.ego.getSpeedKmh(), this.ego.throttle);
    }

    // 6. Update Camera
    this.updateCamera(deltaTime);

    // 7. Update UI HUD & Cockpit Instruments
    this.updateHUD();

    // 8. Render Main Viewport
    this.renderer.render(this.scene, this.camera);

    // 9. Render Secondary Vision AI Camera into Vision Canvas
    this.renderVisionFeed();

    // 10. Render 360 LiDAR Radar Scope
    const distToStop = this.ego.position.distanceTo(this.track.stopLinePos);
    this.sensorVis.renderRadar(this.ego, this.autonomy.trackedObjects, distToStop);

    // 11. Update AI Bounding Box Overlays
    this.sensorVis.updateAIBoundingBoxes(this.visionCamera, this.autonomy.trackedObjects);
  }

  renderVisionFeed() {
    const visionCanvas = document.getElementById('vision-canvas');
    if (!visionCanvas) return;

    // Temporarily resize renderer to secondary camera aspect and draw
    const ctx = visionCanvas.getContext('2d');
    // Draw directly from WebGL renderer viewport or capture
    // Since WebGLRenderer is full screen, we can draw a stylized camera scan representation
    // or set a small sub-viewport. For highest performance and crispness:
    ctx.fillStyle = '#050a12';
    ctx.fillRect(0, 0, 300, 170);

    // Simulated camera horizon and road lines
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 95);
    ctx.lineTo(300, 95);
    ctx.stroke();

    // Vanishing perspective lane lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo(150, 95);
    ctx.lineTo(50, 170);
    ctx.moveTo(150, 95);
    ctx.lineTo(250, 170);
    ctx.stroke();

    // Scanline effect
    const scanY = (performance.now() * 0.08) % 170;
    ctx.fillStyle = 'rgba(0, 243, 255, 0.15)';
    ctx.fillRect(0, scanY, 300, 2);
  }

  // ============================================================================
  // HUD & INSTRUMENTS REFRESH
  // ============================================================================
  updateHUD() {
    const speedKmh = Math.round(this.ego.getSpeedKmh());
    const speedDialBar = document.getElementById('speed-gauge-bar');
    const speedNum = document.getElementById('telemetry-speed');

    if (speedNum) speedNum.textContent = speedKmh;

    // Speedometer circle progress (circumference = 263.8)
    if (speedDialBar) {
      const maxDisplaySpeed = 120;
      const speedRatio = Math.min(speedKmh / maxDisplaySpeed, 1.0);
      const offset = 263.8 - (speedRatio * 193.8); // Sweep 270 deg
      speedDialBar.style.strokeDashoffset = offset;
    }

    // Pedals
    const throttlePct = Math.round(this.ego.throttle * 100);
    const brakePct = Math.round(this.ego.brake * 100);
    const steerDeg = Math.round(THREE.MathUtils.radToDeg(this.ego.steeringAngle) * 10) / 10;

    const elThrottle = document.getElementById('bar-throttle');
    const txtThrottle = document.getElementById('txt-throttle');
    if (elThrottle) elThrottle.style.width = `${throttlePct}%`;
    if (txtThrottle) txtThrottle.textContent = `${throttlePct}%`;

    const elBrake = document.getElementById('bar-brake');
    const txtBrake = document.getElementById('txt-brake');
    if (elBrake) elBrake.style.width = `${brakePct}%`;
    if (txtBrake) txtBrake.textContent = `${brakePct}%`;

    const txtSteer = document.getElementById('txt-steer');
    const markerSteer = document.getElementById('marker-steer');
    if (txtSteer) txtSteer.textContent = `${steerDeg > 0 ? '+' : ''}${steerDeg}°`;
    if (markerSteer) {
      const steerPct = (steerDeg / 32) * 50; // -50% to +50%
      markerSteer.style.left = `${50 + steerPct}%`;
    }

    // G-Force Ball
    const gBall = document.getElementById('g-dot');
    const gReadout = document.getElementById('g-readout');
    const longG = this.ego.acceleration / 9.81;
    const latG = (this.ego.velocity * this.ego.velocity * Math.tan(this.ego.steeringAngle) / this.ego.wheelbase) / 9.81;
    const totalG = Math.hypot(longG, latG);

    if (gBall) {
      const clampX = Math.max(-26, Math.min(26, latG * 35));
      const clampY = Math.max(-26, Math.min(26, -longG * 35));
      gBall.style.transform = `translate(calc(-50% + ${clampX}px), calc(-50% + ${clampY}px))`;
    }
    if (gReadout) {
      gReadout.textContent = `${Math.round(totalG * 100) / 100} G`;
    }

    // Safety Stats
    const elMaxDecel = document.getElementById('telemetry-max-decel');
    const elMinTTC = document.getElementById('telemetry-min-ttc');
    const elStopDist = document.getElementById('telemetry-stop-dist');

    if (elMaxDecel) elMaxDecel.textContent = `-${Math.round(this.autonomy.maxDecelG * 100) / 100} g`;
    if (elMinTTC) elMinTTC.textContent = this.autonomy.minTTC === Infinity ? '-- s' : `${Math.round(this.autonomy.minTTC * 10) / 10} s`;
    if (elStopDist) {
      const stopDist = (this.ego.velocity * this.ego.velocity) / (2 * this.ego.maxDecel * this.ego.frictionCoeff);
      elStopDist.textContent = `${Math.round(stopDist * 10) / 10} m`;
    }

    // Forward Collision Warning (FCW) Banner
    const fcwBanner = document.getElementById('fcw-banner');
    const fcwTtc = document.getElementById('fcw-ttc');
    if (fcwBanner && fcwTtc) {
      if (this.autonomy.fcwActive && this.autonomy.primaryTarget) {
        fcwBanner.classList.remove('hidden');
        fcwTtc.textContent = `${Math.round(this.autonomy.primaryTarget.ttc * 10) / 10}s`;
      } else {
        fcwBanner.classList.add('hidden');
      }
    }

    // State Machine HUD flow highlights
    this.updateStateFlowHUD();

    // Regulatory Stop Dwell Timer Ring
    this.updateStopDwellHUD();

    // Primary Target Card
    this.updateTargetCard();

    // Simulation timer
    const timeEl = document.getElementById('sim-time');
    if (timeEl) {
      const t = this.scenario.scenarioTimer;
      const mins = Math.floor(t / 60).toString().padStart(2, '0');
      const secs = (t % 60).toFixed(1).padStart(4, '0');
      timeEl.textContent = `${mins}:${secs}`;
    }
  }

  updateStateFlowHUD() {
    const states = ['st-cruise', 'st-detect', 'st-brake', 'st-dwell', 'st-proceed'];
    states.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.className = 'state-step';
    });

    const activeState = this.autonomy.state;
    if (activeState === 'CRUISE') {
      const el = document.getElementById('st-cruise');
      if (el) el.classList.add('active');
    } else if (activeState === 'ACC_FOLLOW' || activeState === 'OVERTAKE_DEFENSE') {
      const el = document.getElementById('st-detect');
      if (el) el.classList.add('active', 'warning');
    } else if (activeState === 'YIELD_PEDESTRIAN' || activeState === 'DECEL_STOP_SIGN' || activeState === 'AEB_EMERGENCY') {
      const el = document.getElementById('st-brake');
      if (el) el.classList.add('active', activeState === 'AEB_EMERGENCY' ? 'danger' : 'warning');
    } else if (activeState === 'STOP_DWELL') {
      const el = document.getElementById('st-dwell');
      if (el) el.classList.add('active', 'danger');
    }
  }

  updateStopDwellHUD() {
    const dwellBox = document.getElementById('dwell-countdown-box');
    const dwellText = document.getElementById('dwell-sec-text');
    const dwellCircle = document.getElementById('dwell-circle-bar');

    if (!dwellBox) return;

    if (this.autonomy.state === 'STOP_DWELL' && this.autonomy.dwellTimeRemaining > 0) {
      dwellBox.classList.remove('hidden');
      const rem = Math.max(0, this.autonomy.dwellTimeRemaining);
      dwellText.textContent = `${rem.toFixed(1)}s`;

      // Circle circumference = 213.6
      const pct = rem / this.autonomy.stopSignDwellReq;
      const offset = 213.6 * (1 - pct);
      dwellCircle.style.strokeDashoffset = offset;
    } else {
      dwellBox.classList.add('hidden');
    }
  }

  updateTargetCard() {
    const target = this.autonomy.primaryTarget;
    const nameEl = document.getElementById('track-lead-name');
    const threatEl = document.getElementById('track-lead-threat');
    const distEl = document.getElementById('track-dist');
    const speedEl = document.getElementById('track-rel-speed');
    const ttcEl = document.getElementById('track-ttc');
    const bearingEl = document.getElementById('track-bearing');

    if (!nameEl) return;

    if (target) {
      nameEl.textContent = `PRIMARY: ${target.type}`;
      distEl.textContent = `${Math.round(target.dist * 10) / 10} m`;
      speedEl.textContent = `${Math.round(target.relSpeedKmh * 10) / 10} km/h`;
      ttcEl.textContent = target.ttc < 99 ? `${Math.round(target.ttc * 10) / 10} s` : '--';
      bearingEl.textContent = `${Math.round(target.bearingDeg)}°`;

      if (target.ttc < 1.4) {
        threatEl.textContent = 'CRITICAL';
        threatEl.className = 'track-threat critical';
      } else if (target.ttc < 2.5) {
        threatEl.textContent = 'CAUTION';
        threatEl.className = 'track-threat caution';
      } else {
        threatEl.textContent = 'MONITORED';
        threatEl.className = 'track-threat safe';
      }
    } else {
      nameEl.textContent = 'PRIMARY TARGET: NONE';
      threatEl.textContent = 'CLEAR';
      threatEl.className = 'track-threat safe';
      distEl.textContent = '-- m';
      speedEl.textContent = '-- km/h';
      ttcEl.textContent = '-- s';
      bearingEl.textContent = '0.0°';
    }
  }

  addDiagnosticLog(message, type = 'info') {
    const logBox = document.getElementById('terminal-log');
    if (!logBox) return;

    const row = document.createElement('div');
    row.className = `log-line ${type}`;

    const t = this.scenario.scenarioTimer;
    const mins = Math.floor(t / 60).toString().padStart(2, '0');
    const secs = (t % 60).toFixed(1).padStart(4, '0');

    row.innerHTML = `<span class="time">[${mins}:${secs}]</span> ${message}`;
    logBox.appendChild(row);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // ============================================================================
  // MANUAL KEYBOARD DRIVE
  // ============================================================================
  processManualInput(deltaTime) {
    if (this.autonomy.driveMode !== 'manual') return;

    // Steering
    const maxSteerRad = THREE.MathUtils.degToRad(32);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      this.ego.targetSteering = maxSteerRad;
    } else if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      this.ego.targetSteering = -maxSteerRad;
    } else {
      this.ego.targetSteering = 0;
    }

    // Throttle & Brake
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.ego.throttle = 1.0;
      this.ego.brake = 0;
    } else if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      this.ego.throttle = 0;
      this.ego.brake = 0.85;
    } else {
      this.ego.throttle = 0;
      this.ego.brake = 0.05; // Rolling drag
    }
  }

  // ============================================================================
  // UI & BUTTON BINDINGS
  // ============================================================================
  initUI() {
    // 1. Scenario Selector
    const select = document.getElementById('scenario-select');
    const desc = document.getElementById('scenario-description');
    if (select) {
      select.addEventListener('change', (e) => {
        const meta = this.scenario.setScenario(e.target.value);
        if (desc) desc.textContent = meta.description;
        this.isCameraSnapped = false;
      });
    }

    // 2. Run / Reset / Pause Buttons
    const btnStart = document.getElementById('btn-start-scenario');
    const btnReset = document.getElementById('btn-reset-scenario');
    const btnPause = document.getElementById('btn-pause-sim');

    if (btnStart) {
      btnStart.addEventListener('click', () => {
        this.scenario.startScenario();
        this.isCameraSnapped = false;
        const badge = document.getElementById('scenario-stage-badge');
        if (badge) {
          badge.textContent = 'RUNNING';
          badge.className = 'badge-status online';
        }
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.scenario.reset();
        this.isCameraSnapped = false;
        this.addDiagnosticLog('Scenario & Vehicle reset to starting gate.', 'info');
      });
    }

    if (btnPause) {
      btnPause.addEventListener('click', () => {
        this.isPaused = !this.isPaused;
        const icon = document.getElementById('pause-icon');
        if (icon) icon.textContent = this.isPaused ? '▶' : '⏸';
        this.addDiagnosticLog(this.isPaused ? 'Simulation PAUSED.' : 'Simulation RESUMED.', 'info');
      });
    }

    // 3. Interactive Manual Event Injector Buttons
    const btnPed = document.getElementById('btn-trigger-pedestrian');
    const btnStop = document.getElementById('btn-trigger-stop');
    const btnOvertake = document.getElementById('btn-trigger-overtake');
    const btnObstacle = document.getElementById('btn-trigger-obstacle');

    if (btnPed) {
      btnPed.addEventListener('click', () => {
        this.actors.pedestrian.triggerCrossing();
        this.addDiagnosticLog('USER TRIGGER: Pedestrian stepping onto crosswalk!', 'warn');
        sound.playClick();
      });
    }

    if (btnStop) {
      btnStop.addEventListener('click', () => {
        this.autonomy.hasCompletedStopSign = false;
        this.addDiagnosticLog('USER TRIGGER: Stop Sign challenge enforced at intersection!', 'warn');
        sound.playClick();
      });
    }

    if (btnOvertake) {
      btnOvertake.addEventListener('click', () => {
        this.actors.adversary.setupOvertakeScenario(this.autonomy.currentTrackU);
        this.addDiagnosticLog('USER TRIGGER: High-Speed Overtaking cut-in adversary launched!', 'danger');
        sound.playClick();
      });
    }

    if (btnObstacle) {
      btnObstacle.addEventListener('click', () => {
        this.actors.obstacle.deployAhead(this.autonomy.currentTrackU, 28);
        this.addDiagnosticLog('USER TRIGGER: Emergency road barrel deployed 28m ahead!', 'danger');
        sound.playClick();
      });
    }

    // 4. Parameter Sliders
    this.bindSliders();

    // 5. Camera Views
    const camButtons = document.querySelectorAll('.cam-btn');
    camButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        camButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeCameraMode = btn.dataset.cam;
        this.addDiagnosticLog(`Camera switched to: ${btn.textContent.trim()}`, 'info');
      });
    });

    // 6. Weather Dropdown
    const btnWeather = document.getElementById('btn-weather');
    const weatherMenu = document.getElementById('weather-menu');
    if (btnWeather && weatherMenu) {
      btnWeather.addEventListener('click', (e) => {
        e.stopPropagation();
        weatherMenu.classList.toggle('show');
      });

      document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          document.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          this.applyWeather(item.dataset.weather);
          weatherMenu.classList.remove('show');
        });
      });

      window.addEventListener('click', () => {
        weatherMenu.classList.remove('show');
      });
    }

    // 7. Drive Mode Toggles (Autonomous vs Manual vs E-Stop)
    const btnAuto = document.getElementById('mode-btn-auto');
    const btnManual = document.getElementById('mode-btn-manual');
    const btnEstop = document.getElementById('mode-btn-estop');
    const pillAuto = document.getElementById('pill-autonomy');
    const txtAuto = document.getElementById('autonomy-mode-text');

    if (btnAuto) {
      btnAuto.addEventListener('click', () => {
        btnAuto.classList.add('active');
        btnManual.classList.remove('active');
        btnEstop.classList.remove('active');
        this.autonomy.setDriveMode('autonomous');
        if (pillAuto) { pillAuto.className = 'status-pill status-autonomy'; }
        if (txtAuto) { txtAuto.textContent = 'L4 AUTONOMOUS'; }
        this.addDiagnosticLog('Drive mode switched to: L4 Full Autonomy', 'info');
      });
    }

    if (btnManual) {
      btnManual.addEventListener('click', () => {
        btnManual.classList.add('active');
        btnAuto.classList.remove('active');
        btnEstop.classList.remove('active');
        this.autonomy.setDriveMode('manual');
        if (pillAuto) { pillAuto.className = 'status-pill status-autonomy manual'; }
        if (txtAuto) { txtAuto.textContent = 'MANUAL OVERRIDE [WASD]'; }
        this.addDiagnosticLog('Drive mode switched to: Manual Override (Use WASD / Arrows to drive)', 'warn');
      });
    }

    if (btnEstop) {
      btnEstop.addEventListener('click', () => {
        btnEstop.classList.add('active');
        btnAuto.classList.remove('active');
        btnManual.classList.remove('active');
        this.autonomy.setDriveMode('estop');
        if (pillAuto) { pillAuto.className = 'status-pill status-autonomy danger'; }
        if (txtAuto) { txtAuto.textContent = 'E-STOP ACTIVATED'; }
        this.addDiagnosticLog('EMERGENCY STOP (E-STOP) ENGAGED. Full hydraulic brakes locked.', 'danger');
        sound.playFCWWarning(true);
      });
    }

    // 8. Sound Toggle
    const btnAudio = document.getElementById('btn-audio');
    const iconAudio = document.getElementById('audio-icon');
    if (btnAudio) {
      btnAudio.addEventListener('click', () => {
        sound.init();
        const isMuted = sound.toggleMute();
        if (iconAudio) iconAudio.textContent = isMuted ? '🔇' : '🔊';
        this.addDiagnosticLog(isMuted ? 'Audio Muted.' : 'Audio Enabled.', 'info');
      });
    }

    // 9. Export Buttons
    const btnExportXosc = document.getElementById('btn-export-openscenario');
    const btnExportJson = document.getElementById('btn-export-telemetry');
    if (btnExportXosc) btnExportXosc.addEventListener('click', () => this.scenario.exportOpenScenarioFile());
    if (btnExportJson) btnExportJson.addEventListener('click', () => this.scenario.exportTelemetryJSON());

    // 10. Modals
    const modalResult = document.getElementById('modal-result');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnRetry = document.getElementById('btn-modal-retry');
    const btnModalXosc = document.getElementById('btn-modal-export-xosc');
    const btnModalJson = document.getElementById('btn-modal-export-json');

    if (btnCloseModal) btnCloseModal.addEventListener('click', () => modalResult.classList.add('hidden'));
    if (btnRetry) {
      btnRetry.addEventListener('click', () => {
        modalResult.classList.add('hidden');
        this.scenario.startScenario();
      });
    }
    if (btnModalXosc) btnModalXosc.addEventListener('click', () => this.scenario.exportOpenScenarioFile());
    if (btnModalJson) btnModalJson.addEventListener('click', () => this.scenario.exportTelemetryJSON());

    const modalHelp = document.getElementById('modal-help');
    const btnHelp = document.getElementById('btn-help');
    const btnCloseHelp = document.getElementById('btn-close-help');

    if (btnHelp) btnHelp.addEventListener('click', () => modalHelp.classList.remove('hidden'));
    if (btnCloseHelp) btnCloseHelp.addEventListener('click', () => modalHelp.classList.add('hidden'));

    // Clear Terminal Log
    const btnClear = document.getElementById('btn-clear-log');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        const log = document.getElementById('terminal-log');
        if (log) log.innerHTML = '';
      });
    }
  }

  bindSliders() {
    const toggle = document.getElementById('params-toggle');
    const body = document.getElementById('params-body');
    if (toggle && body) {
      toggle.addEventListener('click', () => body.classList.toggle('collapsed'));
    }

    // Target Speed Slider
    const sSpeed = document.getElementById('slider-target-speed');
    const vSpeed = document.getElementById('val-target-speed');
    if (sSpeed) {
      sSpeed.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        this.autonomy.targetSpeedKmh = val;
        if (vSpeed) vSpeed.textContent = `${val} km/h`;
      });
    }

    // Pedestrian Speed Slider
    const sPed = document.getElementById('slider-ped-speed');
    const vPed = document.getElementById('val-ped-speed');
    if (sPed) {
      sPed.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.actors.pedestrian.speed = val;
        if (vPed) vPed.textContent = `${val.toFixed(1)} m/s`;
      });
    }

    // Cut-In Gap Slider
    const sGap = document.getElementById('slider-cutin-gap');
    const vGap = document.getElementById('val-cutin-gap');
    if (sGap) {
      sGap.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        this.actors.adversary.cutInTriggerDistance = val;
        if (vGap) vGap.textContent = `${val} m`;
      });
    }

    // Surface Friction Slider
    const sFric = document.getElementById('slider-friction');
    const vFric = document.getElementById('val-friction');
    if (sFric) {
      sFric.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.ego.frictionCoeff = val;
        let label = 'Dry Tarmac';
        if (val < 0.5) label = 'Icy / Packed Snow';
        else if (val < 0.75) label = 'Wet Slick';
        if (vFric) vFric.textContent = `${val.toFixed(2)} (${label})`;
      });
    }
  }

  bindEvents() {
    // Window Resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // Audio init on first gesture
      sound.init();

      // Trigger Pedestrian [P]
      if (e.code === 'KeyP') {
        this.actors.pedestrian.triggerCrossing();
        this.addDiagnosticLog('SHORTCUT [P]: Pedestrian crossing triggered!', 'warn');
        sound.playClick();
      }

      // Trigger Stop Sign [S]
      if (e.code === 'KeyS' && !e.ctrlKey) {
        this.autonomy.hasCompletedStopSign = false;
        this.addDiagnosticLog('SHORTCUT [S]: Regulatory Stop Sign challenge placed!', 'warn');
        sound.playClick();
      }

      // Trigger Overtaking Cut-in [O]
      if (e.code === 'KeyO') {
        this.actors.adversary.setupOvertakeScenario(this.autonomy.currentTrackU);
        this.addDiagnosticLog('SHORTCUT [O]: High-Speed Overtaking cut-in initiated!', 'danger');
        sound.playClick();
      }

      // Trigger Road Barrel [B]
      if (e.code === 'KeyB') {
        this.actors.obstacle.deployAhead(this.autonomy.currentTrackU, 25);
        this.addDiagnosticLog('SHORTCUT [B]: Road hazard barrel deployed!', 'danger');
        sound.playClick();
      }

      // Pause [Space]
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        this.isPaused = !this.isPaused;
        const icon = document.getElementById('pause-icon');
        if (icon) icon.textContent = this.isPaused ? '▶' : '⏸';
      }

      // Reset [R]
      if (e.code === 'KeyR' && !e.ctrlKey) {
        this.scenario.reset();
        this.addDiagnosticLog('SHORTCUT [R]: Reset to scenario start.', 'info');
      }

      // Camera views [1, 2, 3, 4]
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        const modes = ['chase', 'cockpit', 'bev', 'orbit'];
        const idx = parseInt(e.code.replace('Digit', '')) - 1;
        this.activeCameraMode = modes[idx];
        document.querySelectorAll('.cam-btn').forEach((b, i) => {
          b.classList.toggle('active', i === idx);
        });
      }

      // E-Stop [E]
      if (e.code === 'KeyE') {
        document.getElementById('mode-btn-estop')?.click();
      }

      // Audio Mute [M]
      if (e.code === 'KeyM') {
        document.getElementById('btn-audio')?.click();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Orbit Mouse Drag Controls
    window.addEventListener('mousedown', (e) => {
      if (e.target.tagName !== 'CANVAS' && e.target.id !== 'canvas-container') return;
      this.isDragging = true;
      this.prevMousePos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.prevMousePos.x;
      const dy = e.clientY - this.prevMousePos.y;

      this.orbitTheta -= dx * 0.008;
      this.orbitPhi = Math.max(0.1, Math.min(Math.PI / 2.2, this.orbitPhi + dy * 0.008));

      this.prevMousePos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('wheel', (e) => {
      if (e.target.tagName !== 'CANVAS' && e.target.id !== 'canvas-container') return;
      this.orbitRadius = Math.max(6, Math.min(60, this.orbitRadius + e.deltaY * 0.02));
    });
  }
}

// Start application immediately or on readyState
function initAutoTest() {
  try {
    console.log('[AutoTest Pro] Initializing simulation engine...');
    window.autoTestApp = new AutoTestApp();
    console.log('[AutoTest Pro] Simulation running successfully!');
  } catch (err) {
    console.error('[AutoTest Pro] Initialization error:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAutoTest);
} else {
  initAutoTest();
}
