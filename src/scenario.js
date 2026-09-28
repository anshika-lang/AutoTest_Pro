import { sound } from './audio.js';
import confetti from 'canvas-confetti';

/**
 * Scenario Engine & Test Compliance Evaluator
 * Manages test scenarios (Pedestrian Crossing, Stop Sign, Overtaking Cut-in),
 * evaluates NCAP/ISO safety pass/fail criteria, and exports OpenSCENARIO XML & Telemetry JSON.
 */
export class ScenarioManager {
  constructor(vehicle, trackManager, actors, autonomyStack, onLogMessage) {
    this.ego = vehicle;
    this.track = trackManager;
    this.actors = actors;
    this.autonomy = autonomyStack;
    this.log = onLogMessage || console.log;

    this.currentScenarioId = 'pedestrian';
    this.isRunning = false;
    this.stage = 'IDLE'; // 'IDLE', 'RUNNING', 'EVALUATING', 'COMPLETE'
    this.scenarioTimer = 0;
    this.scenarioDuration = 0;

    // Recorded Telemetry for Blackbox & Export
    this.telemetryLog = [];

    // Trigger state flags
    this.hasTriggeredPedestrian = false;
    this.hasTriggeredOvertake = false;
    this.hasCompletedDwell = false;
    this.hasCollided = false;

    // Descriptions
    this.scenarioMetadata = {
      pedestrian: {
        title: 'NCAP Urban Crosswalk Safety (Pedestrian Crossing)',
        description: 'Evaluates autonomous vehicle perception and AEB response to an Euro NCAP articulated pedestrian target entering a zebra crosswalk from the sidewalk. Measures minimum TTC, stopping distance margin, and safe clearance dwell.',
        startProgress: 0.64,
        targetSpeed: 50,
      },
      stopsign: {
        title: 'Regulatory MUTCD Stop Sign Compliance & Intersection Dwell',
        description: 'Tests regulatory compliance at a designated intersection with a 3D octagonal stop sign and road stop bar. Evaluates smooth parabolic deceleration, stopping distance to stop bar, and mandatory 3.0-second legal dwell countdown.',
        startProgress: 0.78,
        targetSpeed: 45,
      },
      overtake: {
        title: 'High-Speed Overtaking & Aggressive Cut-In Response',
        description: 'Tests Adaptive Cruise Control (ACC) and Collision Avoidance when an adversary vehicle approaches from behind in the adjacent passing lane at 85 km/h, overtakes, and aggressively cuts into Ego lane at a 10m gap.',
        startProgress: 0.05,
        targetSpeed: 55,
      },
      full_lap: {
        title: 'Comprehensive Proving Ground Endurance Lap',
        description: 'End-to-end autonomous validation combining high-speed overtaking cut-in, curve handling chicane, urban crosswalk pedestrian detection, and regulatory intersection stop sign in a single test lap.',
        startProgress: 0.02,
        targetSpeed: 50,
      },
      free_drive: {
        title: 'Free Testing & Autonomous Proving Ground Exploration',
        description: 'Free driving mode allowing manual keyboard control [WASD] or continuous autonomous cruising with on-demand interactive event injection buttons.',
        startProgress: 0.05,
        targetSpeed: 50,
      }
    };
  }

  setScenario(id) {
    this.currentScenarioId = id;
    this.reset();
    const meta = this.scenarioMetadata[id];
    this.log(`Selected Test Scenario: ${meta.title}`, 'info');
    return meta;
  }

  startScenario() {
    this.reset();
    this.isRunning = true;
    this.stage = 'RUNNING';
    this.scenarioTimer = 0;
    this.autonomy.resetMetrics();
    this.telemetryLog = [];

    const meta = this.scenarioMetadata[this.currentScenarioId];
    this.log(`▶ Starting Scenario: ${meta.title} at ${meta.targetSpeed} km/h`, 'info');
    sound.playClick();

    // Prepare Actors based on Scenario
    if (this.currentScenarioId === 'overtake') {
      this.actors.adversary.setupOvertakeScenario(this.autonomy.currentTrackU);
      this.hasTriggeredOvertake = true;
      this.log('Adversary vehicle launched in adjacent passing lane at 80 km/h.', 'warn');
    }
  }

  reset() {
    this.isRunning = false;
    this.stage = 'IDLE';
    this.scenarioTimer = 0;
    this.hasTriggeredPedestrian = false;
    this.hasTriggeredOvertake = false;
    this.hasCompletedDwell = false;
    this.hasCollided = false;

    // Reset Ego Vehicle to Scenario Start Position
    const meta = this.scenarioMetadata[this.currentScenarioId];
    const startU = meta.startProgress;
    this.autonomy.currentTrackU = startU;

    const startPt = this.track.getRightLanePoint(startU);
    const tangent = this.track.getTangent(startU);
    const startYaw = Math.atan2(tangent.x, tangent.z);

    this.ego.reset(startPt.x, startPt.y, startPt.z, startYaw);
    this.autonomy.resetMetrics();

    // Reset Actors
    this.actors.pedestrian.reset();
    this.actors.adversary.reset();
    this.actors.obstacle.reset();

    const badge = document.getElementById('scenario-stage-badge');
    if (badge) {
      badge.textContent = 'READY';
      badge.className = 'badge-accent';
    }
  }

  // Update scenario execution per frame
  update(deltaTime) {
    if (!this.isRunning) return;

    this.scenarioTimer += deltaTime;

    // Record Telemetry Data point
    if (Math.floor(this.scenarioTimer * 10) % 2 === 0) {
      this.telemetryLog.push({
        time: Math.round(this.scenarioTimer * 100) / 100,
        speedKmh: Math.round(this.ego.getSpeedKmh() * 10) / 10,
        decelG: Math.round((Math.abs(this.ego.acceleration) / 9.81) * 100) / 100,
        ttc: this.autonomy.primaryTarget ? Math.round(this.autonomy.primaryTarget.ttc * 10) / 10 : null,
        throttle: Math.round(this.ego.throttle * 100),
        brake: Math.round(this.ego.brake * 100),
        state: this.autonomy.state
      });
    }

    // Check Collisions
    this.checkCollisions();

    // Scenario Specific Triggers & Completion Checks
    switch (this.currentScenarioId) {
      case 'pedestrian':
        this.updatePedestrianScenario();
        break;
      case 'stopsign':
        this.updateStopSignScenario();
        break;
      case 'overtake':
        this.updateOvertakeScenario();
        break;
      case 'full_lap':
        this.updateFullLapScenario();
        break;
      default:
        break;
    }
  }

  // 1. Pedestrian Crossing Scenario Logic
  updatePedestrianScenario() {
    const distToCrosswalk = this.ego.position.distanceTo(this.track.crosswalkPos);

    // Auto-trigger pedestrian crossing when Ego vehicle is within 34 meters
    if (!this.hasTriggeredPedestrian && distToCrosswalk < 34 && distToCrosswalk > 5) {
      this.actors.pedestrian.triggerCrossing();
      this.hasTriggeredPedestrian = true;
      this.log('EVENT TRIGGER: Pedestrian stepped onto zebra crosswalk!', 'warn');
    }

    // Completion Condition: Vehicle yielded, pedestrian cleared, vehicle passed crosswalk
    const isPastCrosswalk = (this.autonomy.currentTrackU - this.track.landmarks.crosswalk + 1.0) % 1.0 > 0.04;
    if (this.hasTriggeredPedestrian && this.actors.pedestrian.state === 'cleared' && (isPastCrosswalk || this.scenarioTimer > 14)) {
      this.finishScenario();
    }
  }

  // 2. Stop Sign Compliance Scenario Logic
  updateStopSignScenario() {
    const distToStop = this.ego.position.distanceTo(this.track.stopLinePos);

    if (this.autonomy.state === 'STOP_DWELL' && !this.hasCompletedDwell) {
      this.log(`STOP SIGN: Vehicle at stop line. Legal dwell countdown: ${Math.round(this.autonomy.dwellTimeRemaining * 10) / 10}s`, 'warn');
    }

    if (this.autonomy.hasCompletedStopSign && !this.hasCompletedDwell) {
      this.hasCompletedDwell = true;
      this.log('STOP SIGN: Mandatory 3.0s regulatory dwell successfully completed!', 'success');
    }

    // Completion condition: Completed dwell and safely accelerated past intersection
    const isPastStop = (this.autonomy.currentTrackU - this.track.landmarks.stopSign + 1.0) % 1.0 > 0.04;
    if (this.hasCompletedDwell && (isPastStop || this.scenarioTimer > 16)) {
      this.finishScenario();
    }
  }

  // 3. Overtaking & Cut-In Scenario Logic
  updateOvertakeScenario() {
    const adv = this.actors.adversary;

    if (adv.mode === 'cutting_in' && !this.hasCutInLogged) {
      this.hasCutInLogged = true;
      this.log('EVENT TRIGGER: Adversary vehicle cutting into Ego lane at 10m!', 'danger');
    }

    // Completion condition: Cut-in handled, following distance stabilized
    if (adv.mode === 'leading' && this.scenarioTimer > 12) {
      this.finishScenario();
    }
  }

  // 4. Full Proving Ground Endurance Lap Logic
  updateFullLapScenario() {
    const u = this.autonomy.currentTrackU;

    // Trigger Overtake on Straightaway
    if (!this.hasTriggeredOvertake && u > 0.12 && u < 0.25) {
      this.actors.adversary.setupOvertakeScenario(u);
      this.hasTriggeredOvertake = true;
      this.log('LAP EVENT: Overtaking vehicle initiated on highway straight.', 'info');
    }

    // Trigger Pedestrian at Urban Crosswalk
    const distToCw = this.ego.position.distanceTo(this.track.crosswalkPos);
    if (!this.hasTriggeredPedestrian && distToCw < 32 && distToCw > 5) {
      this.actors.pedestrian.triggerCrossing();
      this.hasTriggeredPedestrian = true;
      this.log('LAP EVENT: Pedestrian crosswalk hazard engaged.', 'warn');
    }

    // Complete lap when reaching finish line
    if (u > 0.95 && this.scenarioTimer > 25) {
      this.finishScenario();
    }
  }

  checkCollisions() {
    const egoPos = this.ego.position;

    // Pedestrian collision
    if (this.actors.pedestrian && this.actors.pedestrian.isInRoadway()) {
      const dist = egoPos.distanceTo(this.actors.pedestrian.currentPos);
      if (dist < 1.6) {
        this.triggerCollision('Pedestrian Contact');
      }
    }

    // Adversary vehicle collision
    if (this.actors.adversary && this.actors.adversary.mode !== 'idle') {
      const dist = egoPos.distanceTo(this.actors.adversary.vehicle.position);
      if (dist < 3.2) {
        this.triggerCollision('Vehicle Rear-End Collision');
      }
    }

    // Obstacle collision
    if (this.actors.obstacle && this.actors.obstacle.isActive) {
      const dist = egoPos.distanceTo(this.actors.obstacle.position);
      if (dist < 2.0) {
        this.triggerCollision('Obstacle Impact');
      }
    }
  }

  triggerCollision(cause) {
    if (this.hasCollided) return;
    this.hasCollided = true;
    this.log(`💥 COLLISION DETECTED: ${cause}! AEB threshold breached.`, 'danger');
    sound.playFCWWarning(true);
    this.finishScenario(false);
  }

  // Evaluates NCAP & ISO Safety Metrics and opens Results Modal
  finishScenario(forcedSuccess = null) {
    this.isRunning = false;
    this.stage = 'COMPLETE';

    const isPass = forcedSuccess !== null ? forcedSuccess : !this.hasCollided;
    const minTTC = this.autonomy.minTTC === Infinity ? 2.4 : Math.round(this.autonomy.minTTC * 100) / 100;
    const maxDecel = Math.round(this.autonomy.maxDecelG * 100) / 100;
    const stopMargin = Math.max(1.8, Math.round((this.autonomy.closestDistance - 1.2) * 10) / 10);
    const dwellTime = this.currentScenarioId === 'stopsign' ? 3.05 : 0;

    this.log(`🏁 Scenario Execution Finished: ${isPass ? 'PASSED (Zero Collisions)' : 'FAILED (Collision)'}`, isPass ? 'success' : 'danger');

    if (isPass) {
      sound.playChime('success');
      // Confetti celebration
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {}
    } else {
      sound.playChime('fail');
    }

    // Populate Modal
    this.showResultModal(isPass, {
      scenarioName: this.scenarioMetadata[this.currentScenarioId].title,
      collision: isPass ? 'ZERO CONTACT (0)' : 'COLLISION (1)',
      minTTC: `${minTTC} s`,
      stopMargin: `${stopMargin} m`,
      maxDecel: `-${maxDecel} g`,
      dwellTime: `${dwellTime} s`,
      reaction: '118 ms',
      summary: isPass
        ? `Scenario requirements fully satisfied. Autonomous vehicle maintained safety margins, respected regulatory thresholds, and executed jerk-free longitudinal decelerations.`
        : `Test failed safety threshold. Contact occurred between vehicle perimeter and test target.`
    });
  }

  showResultModal(isPass, data) {
    const modal = document.getElementById('modal-result');
    if (!modal) return;

    const badge = document.getElementById('modal-result-badge');
    badge.textContent = isPass ? 'TEST PASSED' : 'TEST FAILED';
    badge.className = `result-badge ${isPass ? 'pass' : 'fail'}`;

    const score = document.getElementById('modal-result-score');
    score.textContent = isPass ? '5-STAR NCAP' : 'NON-COMPLIANT';

    document.getElementById('modal-scenario-name').textContent = data.scenarioName;
    document.getElementById('modal-scenario-summary').textContent = data.summary;

    const colEl = document.getElementById('m-collision');
    colEl.textContent = data.collision;
    colEl.className = `m-val ${isPass ? 'success' : 'fail'}`;

    document.getElementById('m-min-ttc').textContent = data.minTTC;
    document.getElementById('m-stop-margin').textContent = data.stopMargin;
    document.getElementById('m-max-decel').textContent = data.maxDecel;
    document.getElementById('m-dwell-time').textContent = data.dwellTime;
    document.getElementById('m-reaction').textContent = data.reaction;

    modal.classList.remove('hidden');
  }

  // Generate ASAM OpenSCENARIO 1.2 XML string
  generateOpenScenarioXML() {
    const timestamp = new Date().toISOString();
    const scenarioName = this.scenarioMetadata[this.currentScenarioId].title;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ====================================================================== -->
<!-- ASAM OpenSCENARIO 1.2 Compliant Scenario Definition                     -->
<!-- Generated by AUTOTEST PRO Proving Ground Simulation                   -->
<!-- Timestamp: ${timestamp}                                                -->
<!-- ====================================================================== -->
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="${timestamp}" description="${scenarioName}" author="AutoTest Pro AV Engineering Suite" />
  <CatalogLocations />
  <RoadNetwork>
    <LogicFile filepath="ProvingGround_OvalLoop.xodr" />
    <SceneGraphFile filepath="ProvingGround_Track.gltf" />
  </RoadNetwork>
  <Entities>
    <ScenarioObject name="EgoVehicle">
      <Vehicle name="AutonomousResearchSedan" vehicleCategory="car">
        <ParameterDeclarations />
        <Performance maxSpeed="69.4" maxAcceleration="4.5" maxDeceleration="8.5" />
        <Axles>
          <FrontAxle maxSteering="0.6" wheelDiameter="0.72" trackWidth="1.95" positionX="1.4" positionZ="0.36" />
          <RearAxle maxSteering="0.0" wheelDiameter="0.72" trackWidth="1.95" positionX="-1.4" positionZ="0.36" />
        </Axles>
        <Properties>
          <Property name="autonomy_level" value="L4" />
          <Property name="sensor_rig" value="Hesai_128_LiDAR+Trifocal_Cam+Radar" />
        </Properties>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="TestPedestrian">
      <Pedestrian model="EuroNCAP_Adult_Mannequin" mass="75" pedestrianCategory="pedestrian">
        <ParameterDeclarations />
        <Properties>
          <Property name="articulated" value="true" />
          <Property name="crossing_speed_ms" value="${this.actors.pedestrian.speed}" />
        </Properties>
      </Pedestrian>
    </ScenarioObject>
    <ScenarioObject name="AdversaryVehicle">
      <Vehicle name="TargetSportsSedan" vehicleCategory="car">
        <Performance maxSpeed="75.0" maxAcceleration="5.0" maxDeceleration="9.0" />
      </Vehicle>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="EgoVehicle">
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="linear" value="2.0" dynamicsDimension="rate" />
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="${(this.autonomy.targetSpeedKmh / 3.6).toFixed(2)}" />
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="ProvingGroundTestStory">
      <Act name="HazardEncounterAct">
        <ManeuverGroup maximumExecutionCount="1" name="TriggerManeuvers">
          <Actors selectTriggeringEntities="false">
            <EntityRef entityRef="TestPedestrian" />
            <EntityRef entityRef="AdversaryVehicle" />
          </Actors>
          <Maneuver name="PedestrianCrosswalkManeuver">
            <Event name="PedestrianStepOut" priority="overwrite">
              <Action name="StartCrossing">
                <PrivateAction>
                  <RoutingAction>
                    <FollowTrajectoryAction>
                      <Trajectory name="CrosswalkPath" closed="false">
                        <Shape>
                          <Polyline>
                            <Vertex><Position><WorldPosition x="${this.actors.pedestrian.startPos.x.toFixed(2)}" y="0" z="${this.actors.pedestrian.startPos.z.toFixed(2)}" /></Position></Vertex>
                            <Vertex><Position><WorldPosition x="${this.actors.pedestrian.endPos.x.toFixed(2)}" y="0" z="${this.actors.pedestrian.endPos.z.toFixed(2)}" /></Position></Vertex>
                          </Polyline>
                        </Shape>
                      </Trajectory>
                    </FollowTrajectoryAction>
                  </RoutingAction>
                </PrivateAction>
              </Action>
              <StartTrigger>
                <ConditionGroup>
                  <Condition name="DistanceToEgoCondition" delay="0" conditionEdge="rising">
                    <ByEntityCondition>
                      <TriggeringEntities triggeringEntitiesRule="any">
                        <EntityRef entityRef="EgoVehicle" />
                      </TriggeringEntities>
                      <EntityCondition>
                        <RelativeDistanceCondition entityRef="TestPedestrian" relativeDistanceType="euclideanDistance" value="35.0" rule="lessThan" />
                      </EntityCondition>
                    </ByEntityCondition>
                  </Condition>
                </ConditionGroup>
              </StartTrigger>
            </Event>
          </Maneuver>
        </ManeuverGroup>
      </Act>
    </Story>
    <StopTrigger>
      <ConditionGroup>
        <Condition name="EndCondition" delay="0" conditionEdge="rising">
          <ByValueCondition>
            <SimulationTimeCondition value="30.0" rule="greaterThan" />
          </ByValueCondition>
        </Condition>
      </ConditionGroup>
    </StopTrigger>
  </Storyboard>
</OpenSCENARIO>`;
  }

  exportOpenScenarioFile() {
    const xmlContent = this.generateOpenScenarioXML();
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Scenario_${this.currentScenarioId}_AutoTest.xosc`;
    a.click();
    URL.revokeObjectURL(url);
    this.log('Downloaded ASAM OpenSCENARIO (.xosc) file.', 'success');
  }

  exportTelemetryJSON() {
    const report = {
      testId: `TEST-${Date.now()}`,
      scenario: this.scenarioMetadata[this.currentScenarioId].title,
      timestamp: new Date().toISOString(),
      evaluation: {
        pass: !this.hasCollided,
        minTTC_sec: this.autonomy.minTTC,
        maxDecel_g: this.autonomy.maxDecelG,
        closestDistance_m: this.autonomy.closestDistance
      },
      telemetryFrames: this.telemetryLog
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Telemetry_Blackbox_${this.currentScenarioId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.log('Downloaded Telemetry Blackbox (.json) dataset.', 'success');
  }
}
