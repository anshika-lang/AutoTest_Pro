import * as THREE from 'three';

/**
 * Autonomous Research Vehicle (Ego Car) Model & Kinematics Engine
 * Provides detailed 3D model, sensor rig (spinning LiDAR, cameras, radar),
 * kinematic bicycle model physics, dynamic lighting, and telemetry outputs.
 */
export class Vehicle {
  constructor(scene, isEgo = true, color = 0x00f3ff) {
    this.scene = scene;
    this.isEgo = isEgo;
    this.bodyColor = color;

    // Vehicle Group & Meshes
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Dynamic Parts
    this.wheels = [];
    this.steerWheels = [];
    this.lidarPuck = null;
    this.laserCone = null;
    this.brakeLights = [];
    this.headlights = [];
    this.turnLightsLeft = [];
    this.turnLightsRight = [];
    this.spotlights = [];

    // Kinematics & Physical Parameters
    this.wheelbase = 2.8; // meters
    this.width = 1.95;    // meters
    this.length = 4.75;   // meters
    this.height = 1.45;   // meters
    this.mass = 1950;     // kg (EV sedan with battery pack)

    // State Variables
    this.position = new THREE.Vector3();
    this.velocity = 0;       // m/s
    this.acceleration = 0;   // m/s^2
    this.prevAcceleration = 0;
    this.jerk = 0;           // m/s^3
    this.yaw = 0;            // radians
    this.steeringAngle = 0;  // radians
    this.targetSteering = 0; // radians
    this.throttle = 0;       // 0 to 1
    this.brake = 0;          // 0 to 1
    this.gear = 'D';         // P, R, N, D
    this.isBraking = false;

    // Road adherence
    this.frictionCoeff = 0.95; // mu (dry tarmac)
    this.maxDecel = 8.5;       // m/s^2 (hard AEB braking)

    // Autonomous Sensor Scan Effect
    this.lidarRotationAngle = 0;

    // Turn indicator state
    this.turnSignal = 'none'; // 'none', 'left', 'right', 'hazard'
    this.blinkTimer = 0;

    this.buildModel();
  }

  buildModel() {
    // 1. Main Chassis / Body
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.isEgo ? 0xedf2f7 : this.bodyColor, // Crisp Pearl White for Ego AV
      metalness: 0.6,
      roughness: 0.2,
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: this.isEgo ? 0x00f3ff : 0xff9f1c,
      metalness: 0.9,
      roughness: 0.1,
      emissive: this.isEgo ? 0x0088cc : 0x663300,
      emissiveIntensity: 0.4
    });

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.95,
      roughness: 0.05,
      transparent: true,
      opacity: 0.85,
    });

    // Lower body chassis
    const chassisGeom = new THREE.BoxGeometry(1.85, 0.55, 4.4);
    const chassis = new THREE.Mesh(chassisGeom, bodyMat);
    chassis.position.y = 0.45;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.group.add(chassis);

    // Front Aerodynamic Hood Slant
    const hoodGeom = new THREE.BoxGeometry(1.75, 0.25, 1.4);
    const hood = new THREE.Mesh(hoodGeom, bodyMat);
    hood.position.set(0, 0.6, 1.2);
    hood.rotation.x = -0.12;
    this.group.add(hood);

    // Cabin / Greenhouse (Upper cabin with windows)
    const cabinGeom = new THREE.BoxGeometry(1.6, 0.62, 2.3);
    const cabin = new THREE.Mesh(cabinGeom, glassMat);
    cabin.position.set(0, 0.98, -0.2);
    cabin.castShadow = true;
    this.group.add(cabin);

    // Cabin Roof Plate
    const roofGeom = new THREE.BoxGeometry(1.5, 0.08, 1.9);
    const roof = new THREE.Mesh(roofGeom, bodyMat);
    roof.position.set(0, 1.3, -0.2);
    this.group.add(roof);

    // Front Bumper & Air Dam
    const bumperGeom = new THREE.BoxGeometry(1.86, 0.35, 0.5);
    const bumper = new THREE.Mesh(bumperGeom, accentMat);
    bumper.position.set(0, 0.3, 2.15);
    this.group.add(bumper);

    // Front Radar Radome Sensor (Autonomous feature)
    const radarPod = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9 })
    );
    radarPod.position.set(0, 0.32, 2.42);
    this.group.add(radarPod);

    // Wheels (4 units)
    this.buildWheels();

    // Headlights & Tail Lights
    this.buildLights();

    // Autonomous Sensor Rig (Only on Ego car)
    if (this.isEgo) {
      this.buildAutonomousSensorRig();
    }
  }

  buildWheels() {
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.85, roughness: 0.2 });

    const wheelGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 24);
    wheelGeom.rotateZ(Math.PI / 2);

    const rimGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.27, 16);
    rimGeom.rotateZ(Math.PI / 2);

    const positions = [
      { x: -0.92, y: 0.36, z: 1.4, isFront: true },  // Front Left
      { x: 0.92, y: 0.36, z: 1.4, isFront: true },   // Front Right
      { x: -0.92, y: 0.36, z: -1.4, isFront: false }, // Rear Left
      { x: 0.92, y: 0.36, z: -1.4, isFront: false },  // Rear Right
    ];

    positions.forEach(p => {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(p.x, p.y, p.z);

      const tire = new THREE.Mesh(wheelGeom, wheelMat);
      tire.castShadow = true;
      wheelGroup.add(tire);

      const rim = new THREE.Mesh(rimGeom, rimMat);
      wheelGroup.add(rim);

      this.group.add(wheelGroup);
      this.wheels.push(wheelGroup);

      if (p.isFront) {
        this.steerWheels.push(wheelGroup);
      }
    });
  }

  buildLights() {
    // 1. Dual LED Projector Headlights
    const headLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [-0.68, 0.68].forEach(x => {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), headLightMat);
      lamp.position.set(x, 0.62, 2.22);
      this.group.add(lamp);
      this.headlights.push(lamp);

      // SpotLight projecting forward on the road
      const spot = new THREE.SpotLight(0xffffff, 2.5, 45, Math.PI / 5, 0.4, 1.2);
      spot.position.set(x, 0.65, 2.3);
      spot.target.position.set(x, 0, 15);
      this.group.add(spot);
      this.group.add(spot.target);
      this.spotlights.push(spot);
    });

    // 2. Red Tail Light / Brake Light Strip
    const brakeMat = new THREE.MeshStandardMaterial({
      color: 0x660000,
      emissive: 0x990000,
      emissiveIntensity: 0.5
    });

    const brakeBar = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.12, 0.1), brakeMat);
    brakeBar.position.set(0, 0.68, -2.22);
    this.group.add(brakeBar);
    this.brakeLights.push(brakeBar);

    // 3. Amber Turn Signals (Left / Right)
    const turnMatL = new THREE.MeshBasicMaterial({ color: 0x221100 });
    const turnMatR = new THREE.MeshBasicMaterial({ color: 0x221100 });

    const turnFL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.08), turnMatL);
    turnFL.position.set(-0.85, 0.58, 2.18);
    this.group.add(turnFL);
    this.turnLightsLeft.push(turnFL);

    const turnRL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.08), turnMatL);
    turnRL.position.set(-0.85, 0.68, -2.23);
    this.group.add(turnRL);
    this.turnLightsLeft.push(turnRL);

    const turnFR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.08), turnMatR);
    turnFR.position.set(0.85, 0.58, 2.18);
    this.group.add(turnFR);
    this.turnLightsRight.push(turnFR);

    const turnRR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.08), turnMatR);
    turnRR.position.set(0.85, 0.68, -2.23);
    this.group.add(turnRR);
    this.turnLightsRight.push(turnRR);
  }

  buildAutonomousSensorRig() {
    const sensorGroup = new THREE.Group();
    sensorGroup.position.set(0, 1.34, -0.15); // Roof center

    // Roof rack mount plate
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85 });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 1.1), rackMat);
    sensorGroup.add(rack);

    // Hesai / Velodyne style 360 LiDAR Puck
    const baseGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9 });
    const lidarBase = new THREE.Mesh(baseGeom, baseMat);
    lidarBase.position.y = 0.09;
    sensorGroup.add(lidarBase);

    // Rotating LiDAR Head
    const puckGeom = new THREE.CylinderGeometry(0.14, 0.14, 0.14, 16);
    const puckMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff,
      metalness: 0.95,
      roughness: 0.1,
      emissive: 0x0088cc,
      emissiveIntensity: 0.6
    });
    this.lidarPuck = new THREE.Mesh(puckGeom, puckMat);
    this.lidarPuck.position.y = 0.22;
    sensorGroup.add(this.lidarPuck);

    // Translucent Laser Scanning Fan
    const coneGeom = new THREE.ConeGeometry(8, 2.5, 32, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide
    });
    this.laserCone = new THREE.Mesh(coneGeom, coneMat);
    this.laserCone.position.y = 0.25;
    this.laserCone.rotation.x = Math.PI;
    sensorGroup.add(this.laserCone);

    // Forward Trifocal Camera Pod on windshield top
    const camPodGeom = new THREE.BoxGeometry(0.45, 0.12, 0.15);
    const camPod = new THREE.Mesh(camPodGeom, new THREE.MeshStandardMaterial({ color: 0x000000 }));
    camPod.position.set(0, 1.25, 0.7);
    this.group.add(camPod);

    // Status Glow Ring (Roof perimeter LED strip)
    const glowRingGeom = new THREE.BoxGeometry(1.4, 0.04, 1.8);
    this.statusLed = new THREE.Mesh(glowRingGeom, new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.8
    }));
    this.statusLed.position.set(0, 1.32, -0.2);
    this.group.add(this.statusLed);

    this.group.add(sensorGroup);
  }

  // Update vehicle kinematics & animation
  update(deltaTime) {
    if (deltaTime > 0.1) deltaTime = 0.1; // Clamp lag spikes

    // 1. Update Steering with realistic slew rate
    const steerRate = 3.5; // rad/s
    const steerDiff = this.targetSteering - this.steeringAngle;
    this.steeringAngle += Math.sign(steerDiff) * Math.min(Math.abs(steerDiff), steerRate * deltaTime);

    // Apply steering to front wheel meshes
    this.steerWheels.forEach(w => {
      w.rotation.y = this.steeringAngle;
    });

    // 2. Longitudinal Dynamics
    let netForce = 0;
    const maxThrust = 4800; // Newtons
    const rollResistance = 250;
    const dragCoeff = 0.32; // Aerodynamic drag

    if (this.brake > 0.01) {
      // Braking mode (hydraulic + regen)
      const brakeForce = this.brake * this.maxDecel * this.mass * this.frictionCoeff;
      netForce = -brakeForce;
      this.isBraking = true;
    } else if (this.throttle > 0.01 && this.gear === 'D') {
      // Throttle acceleration
      const speedKmh = this.velocity * 3.6;
      const engineFactor = Math.max(0.25, 1.0 - (speedKmh / 130)); // Torque falls off at top speed
      netForce = this.throttle * maxThrust * engineFactor - (rollResistance + dragCoeff * this.velocity * this.velocity);
      this.isBraking = false;
    } else {
      // Coasting / rolling friction
      netForce = -Math.sign(this.velocity) * (rollResistance + dragCoeff * this.velocity * this.velocity);
      this.isBraking = false;
    }

    this.prevAcceleration = this.acceleration;
    this.acceleration = netForce / this.mass;

    // Jerk calculation (rate of acceleration change)
    if (deltaTime > 0) {
      this.jerk = (this.acceleration - this.prevAcceleration) / deltaTime;
    }

    // Velocity update
    this.velocity += this.acceleration * deltaTime;
    if (this.velocity < 0) {
      this.velocity = 0; // Prevent reversing in D gear unless in R
      this.acceleration = 0;
    }

    // 3. Kinematic Bicycle Model Yaw & Position Update
    // Yaw rate: dYaw/dt = (v / L) * tan(delta)
    const yawRate = (this.velocity / this.wheelbase) * Math.tan(this.steeringAngle);
    this.yaw += yawRate * deltaTime;

    // Position update along vehicle heading
    this.position.x += Math.sin(this.yaw) * this.velocity * deltaTime;
    this.position.z += Math.cos(this.yaw) * this.velocity * deltaTime;

    // Apply to Three.js Group
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    // 4. Rotate wheels based on distance traveled
    const wheelCircumference = 2 * Math.PI * 0.36;
    const wheelRotDelta = (this.velocity * deltaTime) / wheelCircumference * (2 * Math.PI);
    this.wheels.forEach(w => {
      w.children[0].rotation.x += wheelRotDelta;
    });

    // 5. Update Lights
    this.updateLights(deltaTime);

    // 6. Rotate LiDAR Puck
    if (this.lidarPuck) {
      this.lidarRotationAngle += deltaTime * 12; // 10-15 Hz rotation
      this.lidarPuck.rotation.y = this.lidarRotationAngle;
    }
  }

  updateLights(deltaTime) {
    // Brake lights flare
    if (this.brakeLights.length > 0) {
      const mat = this.brakeLights[0].material;
      if (this.isBraking) {
        mat.emissive.setHex(0xff0022);
        mat.emissiveIntensity = 2.5;
      } else {
        mat.emissive.setHex(0x990000);
        mat.emissiveIntensity = 0.4;
      }
    }

    // Turn indicator blinker logic
    this.blinkTimer += deltaTime;
    const isBlinkOn = (Math.floor(this.blinkTimer * 3) % 2) === 0;

    const leftOn = (this.turnSignal === 'left' || this.turnSignal === 'hazard') && isBlinkOn;
    const rightOn = (this.turnSignal === 'right' || this.turnSignal === 'hazard') && isBlinkOn;

    this.turnLightsLeft.forEach(l => {
      l.material.color.setHex(leftOn ? 0xffb800 : 0x221100);
    });

    this.turnLightsRight.forEach(l => {
      l.material.color.setHex(rightOn ? 0xffb800 : 0x221100);
    });
  }

  setStatusLED(colorHex) {
    if (this.statusLed) {
      this.statusLed.material.color.setHex(colorHex);
    }
  }

  getSpeedKmh() {
    return this.velocity * 3.6;
  }

  getHeadingVector() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
  }

  reset(x = 0, y = 0, z = 0, yaw = 0) {
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.velocity = 0;
    this.acceleration = 0;
    this.steeringAngle = 0;
    this.targetSteering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.turnSignal = 'none';
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
  }
}
