import * as THREE from 'three';
import { sound } from './audio.js';

/**
 * Autonomy Stack: Perception, Safety Diagnostics, Behavior Planner & Vehicle Control
 * Implements Pure Pursuit steering, Longitudinal PID speed regulation,
 * Time-To-Collision (TTC) computation, AEB triggering, and Regulatory Stop Dwell.
 */
export class AutonomyStack {
  constructor(vehicle, trackManager, actors) {
    this.ego = vehicle;
    this.track = trackManager;
    this.actors = actors; // { pedestrian, adversary, obstacle }

    // Driving Mode
    this.driveMode = 'autonomous'; // 'autonomous', 'manual', 'estop'

    // Behavior Planner States
    // 'CRUISE', 'ACC_FOLLOW', 'DECEL_STOP_SIGN', 'STOP_DWELL', 'YIELD_PEDESTRIAN', 'OVERTAKE_DEFENSE', 'AEB_EMERGENCY'
    this.state = 'CRUISE';
    this.stateTimer = 0;

    // Configuration / Parameters
    this.targetSpeedKmh = 50;  // User slider configurable
    this.safeTimeHeadway = 2.0; // seconds for ACC
    this.stopSignDwellReq = 3.0; // seconds mandatory regulatory dwell
    this.dwellTimeRemaining = 0;
    this.hasCompletedStopSign = false;

    // Safety & Diagnostics Metrics
    this.minTTC = Infinity;
    this.maxDecelG = 0;
    this.closestDistance = Infinity;
    this.lastReactionTime = 0;
    this.primaryTarget = null;
    this.fcwActive = false;

    // Pure Pursuit Parameters
    this.currentTrackU = 0.05; // Progress parameter along right lane
    this.lookaheadDist = 8.0;

    // Longitudinal PID Controller
    this.kp = 0.45;
    this.ki = 0.05;
    this.kd = 0.12;
    this.integralErr = 0;
    this.prevErr = 0;

    // Perception Tracks
    this.trackedObjects = [];
  }

  setDriveMode(mode) {
    this.driveMode = mode;
    if (mode === 'estop') {
      this.ego.throttle = 0;
      this.ego.brake = 1.0;
    }
  }

  // Main Autonomy Loop called every frame
  update(deltaTime) {
    if (this.driveMode === 'estop') {
      this.ego.throttle = 0;
      this.ego.brake = 1.0;
      this.ego.targetSteering = 0;
      this.ego.update(deltaTime);
      return;
    }

    if (this.driveMode === 'manual') {
      // Manual controls applied directly in main.js
      this.runPerception();
      this.ego.update(deltaTime);
      this.updateTrackProgress();
      return;
    }

    // 1. Perception & Sensor Fusion Scan
    this.runPerception();

    // 2. Behavior Planner Decision Matrix
    const { targetSpeedMs, brakeReq, stateLabel } = this.planBehavior(deltaTime);
    this.state = stateLabel;

    // 3. Longitudinal Control (Speed regulation & braking)
    this.controlLongitudinal(targetSpeedMs, brakeReq, deltaTime);

    // 4. Lateral Control (Pure Pursuit path following)
    this.controlLateral();

    // 5. Kinematics physics step
    this.ego.update(deltaTime);

    // 6. Update track progress u
    this.updateTrackProgress();

    // 7. Safety Metrics Recording
    this.recordSafetyMetrics();
  }

  // Updates Ego's parameter u along the track curve
  updateTrackProgress() {
    const trackLength = this.track.centerCurve.getLength();
    const deltaU = (this.ego.velocity * 0.016) / trackLength;
    this.currentTrackU = (this.currentTrackU + deltaU) % 1.0;
  }

  // Perception Layer: Scan environment and evaluate hazards
  runPerception() {
    this.trackedObjects = [];
    const egoPos = this.ego.position;
    const egoHeading = this.ego.getHeadingVector();
    const egoSpeed = this.ego.velocity; // m/s

    // Helper to evaluate target
    const evaluateTarget = (type, pos, vel, sizeRadius = 1.0) => {
      const relPos = pos.clone().sub(egoPos);
      const dist = relPos.length();
      if (dist > 85) return null; // Outside sensor range

      // Check if target is in front of Ego (FOV 140 degrees)
      const forwardDot = relPos.clone().normalize().dot(egoHeading);
      if (forwardDot < 0.2 && dist > 5.0) return null;

      // Relative velocity along line of sight
      const relVel = (egoSpeed - vel);
      let ttc = Infinity;
      if (relVel > 0.5) {
        ttc = Math.max(0.1, (dist - sizeRadius) / relVel);
      }

      // Bearing angle in degrees
      const bearing = Math.atan2(relPos.x, relPos.z) - this.ego.yaw;
      const bearingDeg = THREE.MathUtils.radToDeg(bearing);

      return {
        type,
        pos,
        dist,
        vel,
        relSpeedKmh: relVel * 3.6,
        ttc,
        bearingDeg,
        forwardDot
      };
    };

    // 1. Evaluate Pedestrian
    const ped = this.actors.pedestrian;
    if (ped && ped.state !== 'idle') {
      const pedTrack = evaluateTarget('PEDESTRIAN', ped.currentPos, 0, 1.2);
      if (pedTrack) this.trackedObjects.push(pedTrack);
    }

    // 2. Evaluate Adversary Vehicle
    const adv = this.actors.adversary;
    if (adv && adv.mode !== 'idle') {
      const advTrack = evaluateTarget('VEHICLE', adv.vehicle.position, adv.vehicle.velocity, 2.5);
      if (advTrack) this.trackedObjects.push(advTrack);
    }

    // 3. Evaluate Emergency Obstacle
    const obs = this.actors.obstacle;
    if (obs && obs.isActive) {
      const obsTrack = evaluateTarget('OBSTACLE', obs.position, 0, 1.0);
      if (obsTrack) this.trackedObjects.push(obsTrack);
    }

    // Sort by distance (closest first)
    this.trackedObjects.sort((a, b) => a.dist - b.dist);
    this.primaryTarget = this.trackedObjects.length > 0 ? this.trackedObjects[0] : null;

    // Check FCW Alert trigger
    if (this.primaryTarget && this.primaryTarget.ttc < 2.5 && this.ego.velocity > 2.0) {
      if (!this.fcwActive) {
        sound.playFCWWarning(this.primaryTarget.ttc < 1.4);
      }
      this.fcwActive = true;
    } else {
      this.fcwActive = false;
    }
  }

  // Behavior Planner: Evaluates triggers and returns speed/brake commands
  planBehavior(deltaTime) {
    const egoSpeed = this.ego.velocity;
    const egoSpeedKmh = egoSpeed * 3.6;
    let targetSpeed = (this.targetSpeedKmh / 3.6);
    let brakeReq = 0;
    let stateLabel = 'CRUISE';

    // -------------------------------------------------------------
    // PRIORITY 0: HOLD AT START LINE UNTIL SCENARIO LAUNCHED
    // -------------------------------------------------------------
    if (this.scenario && !this.scenario.isRunning && this.scenario.currentScenarioId !== 'free_drive') {
      this.ego.setStatusLED(0x00f3ff);
      return {
        targetSpeedMs: 0,
        brakeReq: 1.0,
        stateLabel: 'READY'
      };
    }

    // -------------------------------------------------------------
    // PRIORITY 1: CRITICAL AEB (Autonomous Emergency Braking)
    // -------------------------------------------------------------
    if (this.primaryTarget && this.primaryTarget.ttc < 1.4 && this.primaryTarget.dist < 22) {
      this.ego.setStatusLED(0xff0044); // Red warning LED
      sound.playBrakeSqueal();
      return {
        targetSpeedMs: 0,
        brakeReq: 1.0,
        stateLabel: 'AEB_EMERGENCY'
      };
    }

    // -------------------------------------------------------------
    // PRIORITY 2: PEDESTRIAN CROSSWALK TRIGGER & YIELD
    // -------------------------------------------------------------
    const ped = this.actors.pedestrian;
    const distToCrosswalk = this.ego.position.distanceTo(this.track.crosswalkPos);
    const isApproachingCrosswalk = (this.track.landmarks.crosswalk - this.currentTrackU + 1.0) % 1.0 < 0.08;

    if (isApproachingCrosswalk && ped && (ped.state === 'crossing' || ped.isInRoadway())) {
      // Calculate stopping distance before crosswalk (stop 3m before zebra lines)
      const stopDistance = Math.max(0.5, distToCrosswalk - 3.2);

      if (distToCrosswalk < 38) {
        stateLabel = 'YIELD_PEDESTRIAN';
        this.ego.setStatusLED(0xffb800); // Amber caution LED

        if (distToCrosswalk < 4.0 || egoSpeed < 0.2) {
          // Come to a complete stop until pedestrian safely clears road
          targetSpeed = 0;
          brakeReq = 0.85;
          if (ped.state === 'cleared') {
            // Safe to proceed!
            targetSpeed = (this.targetSpeedKmh / 3.6) * 0.6;
            brakeReq = 0;
          }
        } else {
          // Smooth graduated braking
          const smoothDecel = (egoSpeed * egoSpeed) / (2 * stopDistance);
          brakeReq = Math.min(0.9, Math.max(0.2, smoothDecel / this.ego.maxDecel));
          targetSpeed = Math.max(0, egoSpeed - 2.5 * deltaTime);
        }

        return { targetSpeedMs: targetSpeed, brakeReq, stateLabel };
      }
    }

    // -------------------------------------------------------------
    // PRIORITY 3: REGULATORY MUTCD STOP SIGN & 3S DWELL TRIGGER
    // -------------------------------------------------------------
    const distToStopSign = this.ego.position.distanceTo(this.track.stopLinePos);
    const isApproachingStop = (this.track.landmarks.stopSign - this.currentTrackU + 1.0) % 1.0 < 0.08;

    if (isApproachingStop && !this.hasCompletedStopSign) {
      if (distToStopSign < 40 && distToStopSign > 1.8 && this.dwellTimeRemaining <= 0) {
        // Approach stop line with smooth parabolic deceleration profile
        stateLabel = 'DECEL_STOP_SIGN';
        this.ego.setStatusLED(0xffb800);
        const stopDistance = Math.max(1.0, distToStopSign - 1.2);
        const smoothDecel = (egoSpeed * egoSpeed) / (2 * stopDistance);
        brakeReq = Math.min(0.85, Math.max(0.2, smoothDecel / this.ego.maxDecel));
        targetSpeed = 0;
        return { targetSpeedMs: targetSpeed, brakeReq, stateLabel };
      } else if (distToStopSign <= 2.2 || egoSpeed < 0.3) {
        // Enforce 3.0s mandatory regulatory dwell
        stateLabel = 'STOP_DWELL';
        this.ego.setStatusLED(0xff0044);
        brakeReq = 1.0;
        targetSpeed = 0;

        if (this.dwellTimeRemaining <= 0) {
          this.dwellTimeRemaining = this.stopSignDwellReq;
        }

        this.dwellTimeRemaining -= deltaTime;
        if (this.dwellTimeRemaining <= 0) {
          // Completed legal dwell time!
          this.hasCompletedStopSign = true;
          this.dwellTimeRemaining = 0;
          sound.playChime('success');
        }
        return { targetSpeedMs: 0, brakeReq: 1.0, stateLabel };
      }
    } else if (!isApproachingStop && this.hasCompletedStopSign) {
      // Reset stop sign status for next lap
      this.hasCompletedStopSign = false;
    }

    // -------------------------------------------------------------
    // PRIORITY 4: OVERTAKING & CUT-IN VEHICLE DEFENSE (ACC)
    // -------------------------------------------------------------
    const adv = this.actors.adversary;
    if (adv && adv.mode !== 'idle') {
      const advDist = this.ego.position.distanceTo(adv.vehicle.position);
      const isAheadInLane = adv.currentLaneOffset > -0.6; // Has cut into Ego's lane

      if (isAheadInLane && advDist < 30) {
        stateLabel = 'OVERTAKE_DEFENSE';
        this.ego.setStatusLED(0xffb800);

        // Desired safe following distance = v * safeTimeHeadway + 5m
        const desiredGap = Math.max(8.0, egoSpeed * this.safeTimeHeadway + 5.0);
        const gapError = advDist - desiredGap;

        if (gapError < 0) {
          // Too close! Apply defensive braking
          brakeReq = Math.min(0.75, Math.abs(gapError) / 10);
          targetSpeed = Math.max(0, adv.vehicle.velocity - 1.5);
        } else {
          // Match speed of lead car
          targetSpeed = adv.vehicle.velocity;
          brakeReq = 0;
        }

        return { targetSpeedMs: targetSpeed, brakeReq, stateLabel };
      }
    }

    // -------------------------------------------------------------
    // DEFAULT: FREE NOMINAL CRUISE (L4 Autonomy Tracking)
    // -------------------------------------------------------------
    this.ego.setStatusLED(0x00f3ff); // Cyan L4 Autonomous glow
    return {
      targetSpeedMs: targetSpeed,
      brakeReq: 0,
      stateLabel: 'CRUISE'
    };
  }

  // Longitudinal Control via PID
  controlLongitudinal(targetSpeedMs, brakeReq, deltaTime) {
    if (brakeReq > 0.05) {
      this.ego.throttle = 0;
      this.ego.brake = brakeReq;
      this.integralErr = 0;
      return;
    }

    this.ego.brake = 0;
    const currentSpeed = this.ego.velocity;
    const error = targetSpeedMs - currentSpeed;

    this.integralErr += error * deltaTime;
    this.integralErr = Math.max(-5, Math.min(5, this.integralErr));
    const derivative = (error - this.prevErr) / Math.max(0.001, deltaTime);
    this.prevErr = error;

    const output = this.kp * error + this.ki * this.integralErr + this.kd * derivative;
    this.ego.throttle = Math.max(0, Math.min(1.0, output));
  }

  // Lateral Control via Pure Pursuit
  controlLateral() {
    // Dynamic lookahead distance based on speed
    const lookahead = Math.max(6.0, this.ego.velocity * 1.25);
    const trackLength = this.track.centerCurve.getLength();
    const lookaheadU = (this.currentTrackU + lookahead / trackLength) % 1.0;

    // Target waypoint on Right Lane
    const targetPoint = this.track.getRightLanePoint(lookaheadU);

    // Transform target point to vehicle local coordinates
    const dx = targetPoint.x - this.ego.position.x;
    const dz = targetPoint.z - this.ego.position.z;

    // Rotate into vehicle frame (yaw)
    const cosY = Math.cos(this.ego.yaw);
    const sinY = Math.sin(this.ego.yaw);
    const localX = cosY * dx - sinY * dz;
    const localZ = sinY * dx + cosY * dz;

    // Pure pursuit curvature: kappa = 2 * localX / (Ld^2)
    const ldSq = localX * localX + localZ * localZ;
    const kappa = (2 * localX) / Math.max(1.0, ldSq);

    // Steering angle = atan(kappa * wheelbase)
    const desiredSteer = Math.atan(kappa * this.ego.wheelbase);
    const maxSteerRad = THREE.MathUtils.degToRad(32);
    this.ego.targetSteering = Math.max(-maxSteerRad, Math.min(maxSteerRad, desiredSteer));
  }

  recordSafetyMetrics() {
    // Record minimum TTC
    if (this.primaryTarget && this.primaryTarget.ttc < this.minTTC && this.primaryTarget.ttc > 0.05) {
      this.minTTC = this.primaryTarget.ttc;
    }

    // Record peak deceleration
    const currentDecelG = Math.abs(this.ego.acceleration) / 9.81;
    if (this.ego.acceleration < 0 && currentDecelG > this.maxDecelG) {
      this.maxDecelG = currentDecelG;
    }

    // Record closest distance to obstacle
    if (this.primaryTarget && this.primaryTarget.dist < this.closestDistance) {
      this.closestDistance = this.primaryTarget.dist;
    }
  }

  resetMetrics() {
    this.minTTC = Infinity;
    this.maxDecelG = 0;
    this.closestDistance = Infinity;
    this.dwellTimeRemaining = 0;
    this.hasCompletedStopSign = false;
    this.fcwActive = false;
  }
}
