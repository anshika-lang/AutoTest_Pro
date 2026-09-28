import * as THREE from 'three';
import { Vehicle } from './vehicle.js';

/**
 * Test Track Actors & Dynamic Adversary Engine
 * Models Euro NCAP Pedestrian Target with walking kinematics,
 * Overtaking/Cut-In Adversary Vehicle with autonomous trajectory planner,
 * and deployable Emergency Obstacles.
 */

// ============================================================================
// 1. EURO NCAP TEST PEDESTRIAN TARGET
// ============================================================================
export class PedestrianActor {
  constructor(scene, trackManager) {
    this.scene = scene;
    this.track = trackManager;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Body parts for walking animation
    this.leftLeg = null;
    this.rightLeg = null;
    this.leftArm = null;
    this.rightArm = null;

    // Movement state
    this.state = 'idle'; // 'idle', 'crossing', 'cleared'
    this.speed = 1.4;    // m/s (standard walking pace)
    this.progress = 0;   // 0 (curb A) to 1 (curb B)
    this.walkCycle = 0;

    // Position coordinates
    this.startPos = new THREE.Vector3();
    this.endPos = new THREE.Vector3();
    this.currentPos = new THREE.Vector3();
    this.isTriggered = false;

    this.buildModel();
    this.initPositions();
  }

  buildModel() {
    const vestMat = new THREE.MeshStandardMaterial({
      color: 0xccff00, // High-vis fluorescent yellow/lime
      roughness: 0.3,
      emissive: 0x445500,
      emissiveIntensity: 0.4
    });

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.7 });
    const clothesMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.9 });

    // Torso (Upper body)
    const torsoGeom = new THREE.BoxGeometry(0.48, 0.65, 0.28);
    const torso = new THREE.Mesh(torsoGeom, vestMat);
    torso.position.y = 1.15;
    torso.castShadow = true;
    this.group.add(torso);

    // Reflective Silver Safety Stripes across vest
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.1, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc })
    );
    stripe.position.y = 1.18;
    this.group.add(stripe);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), skinMat);
    head.position.y = 1.62;
    head.castShadow = true;
    this.group.add(head);

    // Legs (Pivot at hip level y = 0.85)
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.14, 0.85, 0);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.18), clothesMat);
    legL.position.y = -0.41;
    legL.castShadow = true;
    this.leftLeg.add(legL);
    const footL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.28), shoeMat);
    footL.position.set(0, -0.8, 0.05);
    this.leftLeg.add(footL);
    this.group.add(this.leftLeg);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.14, 0.85, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.18), clothesMat);
    legR.position.y = -0.41;
    legR.castShadow = true;
    this.rightLeg.add(legR);
    const footR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.28), shoeMat);
    footR.position.set(0, -0.8, 0.05);
    this.rightLeg.add(footR);
    this.group.add(this.rightLeg);

    // Arms (Pivot at shoulder y = 1.4)
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.3, 1.4, 0);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.14), skinMat);
    armL.position.y = -0.3;
    this.leftArm.add(armL);
    this.group.add(this.leftArm);

    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.3, 1.4, 0);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.14), skinMat);
    armR.position.y = -0.3;
    this.rightArm.add(armR);
    this.group.add(this.rightArm);
  }

  initPositions() {
    // Crosswalk location on track
    const cwPos = this.track.crosswalkPos.clone();
    const cwDir = this.track.crosswalkDir.clone(); // Perpendicular to road

    // Curb A (Sidewalk right side) to Curb B (Sidewalk left side)
    const curbOffset = this.track.roadWidth * 0.5 + 2.0;
    this.startPos.copy(cwPos).add(cwDir.clone().multiplyScalar(curbOffset));
    this.endPos.copy(cwPos).add(cwDir.clone().multiplyScalar(-curbOffset));

    this.currentPos.copy(this.startPos);
    this.group.position.copy(this.currentPos);

    // Face towards crossing direction
    const walkDir = this.endPos.clone().sub(this.startPos).normalize();
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), walkDir);
  }

  triggerCrossing() {
    this.state = 'crossing';
    this.isTriggered = true;
  }

  reset() {
    this.state = 'idle';
    this.isTriggered = false;
    this.progress = 0;
    this.walkCycle = 0;
    this.initPositions();
    if (this.leftLeg) {
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.leftArm.rotation.x = 0;
      this.rightArm.rotation.x = 0;
    }
  }

  update(deltaTime) {
    if (this.state === 'crossing') {
      const totalDist = this.startPos.distanceTo(this.endPos);
      this.progress += (this.speed * deltaTime) / totalDist;

      if (this.progress >= 1.0) {
        this.progress = 1.0;
        this.state = 'cleared';
      }

      this.currentPos.lerpVectors(this.startPos, this.endPos, this.progress);
      this.group.position.copy(this.currentPos);

      // Natural Human Walking Animation
      this.walkCycle += deltaTime * this.speed * 4.2;
      const legAngle = Math.sin(this.walkCycle) * 0.65;
      const armAngle = -Math.sin(this.walkCycle) * 0.55;

      this.leftLeg.rotation.x = legAngle;
      this.rightLeg.rotation.x = -legAngle;
      this.leftArm.rotation.x = armAngle;
      this.rightArm.rotation.x = -armAngle;
    }
  }

  // Check if pedestrian is inside road boundaries (Ego lane)
  isInRoadway() {
    return this.progress > 0.15 && this.progress < 0.85;
  }
}

// ============================================================================
// 2. OVERTAKING & CUT-IN ADVERSARY VEHICLE
// ============================================================================
export class AdversaryVehicleActor {
  constructor(scene, trackManager) {
    this.scene = scene;
    this.track = trackManager;

    // Build vehicle with vibrant metallic orange body
    this.vehicle = new Vehicle(scene, false, 0xff7b00);

    // Scenario AI State Machine
    this.mode = 'idle'; // 'idle', 'stalking', 'overtaking', 'cutting_in', 'leading'
    this.trackProgress = 0.1; // Track parameter u in [0, 1]
    this.targetSpeedKmh = 75; // Overtaking delta speed
    this.currentLaneOffset = 0; // -1 (left passing lane) to 0 (right cruise lane)
    this.laneTransitionT = 0;

    // Cut-in parameters
    this.cutInTriggerDistance = 10.0; // Cut-in when 10m ahead of Ego
    this.isCutInInitiated = false;
  }

  setupOvertakeScenario(egoProgress) {
    this.mode = 'stalking';
    // Start slightly behind Ego in the left lane
    this.trackProgress = (egoProgress - 0.05 + 1.0) % 1.0;
    this.currentLaneOffset = -1.0; // Left passing lane
    this.targetSpeedKmh = 80;
    this.vehicle.velocity = 22.2; // 80 km/h
    this.isCutInInitiated = false;
    this.vehicle.turnSignal = 'none';
  }

  setupLeadVehicleScenario(egoProgress) {
    this.mode = 'leading';
    // Position ahead of Ego in the same lane moving slowly
    this.trackProgress = (egoProgress + 0.04) % 1.0;
    this.currentLaneOffset = 0.0; // Same right lane
    this.targetSpeedKmh = 30;
    this.vehicle.velocity = 8.33; // 30 km/h
    this.isCutInInitiated = false;
  }

  reset() {
    this.mode = 'idle';
    this.trackProgress = 0.12;
    this.currentLaneOffset = -1.0;
    this.isCutInInitiated = false;
    this.vehicle.velocity = 0;
    this.vehicle.reset(0, 0, 0, 0);
  }

  update(deltaTime, egoVehicle, egoProgress) {
    if (this.mode === 'idle') return;

    const trackLength = this.track.centerCurve.getLength();
    const speedMs = (this.targetSpeedKmh / 3.6);

    // Maintain target speed
    this.vehicle.velocity = speedMs;

    // Advance along track
    const deltaU = (this.vehicle.velocity * deltaTime) / trackLength;
    this.trackProgress = (this.trackProgress + deltaU) % 1.0;

    // Calculate position based on current lane offset
    // Left lane = getLeftLanePoint, Right lane = getRightLanePoint
    const leftPt = this.track.getLeftLanePoint(this.trackProgress);
    const rightPt = this.track.getRightLanePoint(this.trackProgress);

    // Handle lane change transition during Cut-In
    if (this.mode === 'cutting_in') {
      this.laneTransitionT += deltaTime * 0.6; // ~1.6 second lane change maneuver
      if (this.laneTransitionT >= 1.0) {
        this.laneTransitionT = 1.0;
        this.mode = 'leading';
        this.vehicle.turnSignal = 'none';
      }
      // Lerp from Left lane (-1) to Right lane (0)
      this.currentLaneOffset = -1.0 + this.laneTransitionT;
    }

    const currentPos = new THREE.Vector3().lerpVectors(leftPt, rightPt, this.currentLaneOffset + 1.0);
    this.vehicle.position.copy(currentPos);

    // Compute heading from track tangent
    const tangent = this.track.getTangent(this.trackProgress);
    const baseAngle = Math.atan2(tangent.x, tangent.z);

    // Add slight steering angle during lane change
    let steerOffset = 0;
    if (this.mode === 'cutting_in') {
      steerOffset = Math.sin(this.laneTransitionT * Math.PI) * 0.15;
    }

    this.vehicle.yaw = baseAngle + steerOffset;
    this.vehicle.group.position.copy(this.vehicle.position);
    this.vehicle.group.rotation.y = this.vehicle.yaw;

    // Update wheel animations
    this.vehicle.update(deltaTime);

    // Check Trigger Condition for Cut-In
    if (this.mode === 'stalking') {
      // Calculate distance ahead of Ego
      const distToEgo = this.vehicle.position.distanceTo(egoVehicle.position);
      const isAhead = (this.trackProgress - egoProgress + 1.0) % 1.0 < 0.2;

      // When adversary vehicle has overtaken and is at configured cut-in distance
      if (isAhead && distToEgo >= this.cutInTriggerDistance && !this.isCutInInitiated) {
        this.mode = 'cutting_in';
        this.isCutInInitiated = true;
        this.laneTransitionT = 0;
        this.vehicle.turnSignal = 'right'; // Right blinker on cut-in!
      }
    }
  }
}

// ============================================================================
// 3. DEPLOYABLE EMERGENCY ROAD OBSTACLE
// ============================================================================
export class RoadObstacleActor {
  constructor(scene, trackManager) {
    this.scene = scene;
    this.track = trackManager;

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.isActive = false;
    this.position = new THREE.Vector3();

    this.buildBarrelModel();
  }

  buildBarrelModel() {
    // Reflective Orange Traffic Safety Barrel with reflective white bands
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0xff5500,
      roughness: 0.5
    });

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.1, 16), barrelMat);
    barrel.position.y = 0.55;
    barrel.castShadow = true;
    this.group.add(barrel);

    // Reflective white rings
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const band1 = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.15, 16), bandMat);
    band1.position.y = 0.45;
    this.group.add(band1);

    const band2 = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.15, 16), bandMat);
    band2.position.y = 0.75;
    this.group.add(band2);

    this.group.visible = false;
  }

  deployAhead(egoProgress, distanceAheadMeters = 30) {
    const deltaU = this.track.metersToProgress(distanceAheadMeters);
    const targetU = (egoProgress + deltaU) % 1.0;
    const pt = this.track.getRightLanePoint(targetU);

    this.position.copy(pt);
    this.group.position.copy(this.position);
    this.group.visible = true;
    this.isActive = true;
  }

  reset() {
    this.isActive = false;
    this.group.visible = false;
  }
}
