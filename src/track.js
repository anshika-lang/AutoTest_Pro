import * as THREE from 'three';

/**
 * Proving Ground Test Track Geometry & Waypoint Engine
 * Generates high-fidelity 3D test track, asphalt markings, zebra crosswalk,
 * MUTCD 3D stop sign, guardrails, and spline trajectory curves.
 */
export class TrackManager {
  constructor(scene) {
    this.scene = scene;
    this.trackGroup = new THREE.Group();
    this.scene.add(this.trackGroup);

    // Track dimensions
    this.laneWidth = 4.2; // meters (standard highway / proving ground lane)
    this.roadWidth = this.laneWidth * 2; // 8.4m dual lane

    // Spline curves
    this.centerCurve = null;
    this.rightLaneCurve = null;
    this.leftLaneCurve = null;

    // Key Landmark Waypoints (t in [0, 1])
    this.landmarks = {
      straightStart: 0.05,
      overtakeZone: 0.18,
      northCurve: 0.42,
      chicane: 0.55,
      crosswalk: 0.72,
      stopSign: 0.86,
      finishLine: 0.98
    };

    // Landmark positions in 3D world
    this.crosswalkPos = null;
    this.crosswalkDir = null;
    this.stopSignPos = null;
    this.stopLinePos = null;

    this.initCurves();
    this.buildTrack();
    this.buildEnvironment();
    this.buildLandmarks();
  }

  initCurves() {
    // Proving ground layout: A large rounded elongated loop with a straight, curves, and chicanes
    // Total perimeter approx ~700 meters
    const controlPoints = [
      new THREE.Vector3(-140, 0, -50), // Start of straight
      new THREE.Vector3(-60, 0, -50),  // Straightaway acceleration
      new THREE.Vector3(40, 0, -50),   // High speed straightaway
      new THREE.Vector3(120, 0, -50),  // End of straightaway / braking zone
      new THREE.Vector3(170, 0, -30),  // Turn 1 entry
      new THREE.Vector3(190, 0, 20),   // Turn 1 apex
      new THREE.Vector3(170, 0, 70),   // Turn 1 exit
      new THREE.Vector3(110, 0, 65),   // Chicane entry
      new THREE.Vector3(70, 0, 85),    // Chicane S-curve
      new THREE.Vector3(30, 0, 65),    // Chicane exit
      new THREE.Vector3(-20, 0, 65),   // Urban sector approach (Crosswalk)
      new THREE.Vector3(-80, 0, 65),   // Urban sector intersection (Stop Sign)
      new THREE.Vector3(-150, 0, 65),  // South sweeper entry
      new THREE.Vector3(-190, 0, 30),  // South sweeper apex
      new THREE.Vector3(-180, 0, -20), // South sweeper exit
    ];

    this.centerCurve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal', 0.5);

    // Compute parallel lane curves (Right lane = Ego normal, Left lane = Passing/Adversary)
    const samples = 200;
    const rightPts = [];
    const leftPts = [];

    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const pt = this.centerCurve.getPointAt(u);
      const tangent = this.centerCurve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

      // Right lane offset is -laneWidth/2, Left lane offset is +laneWidth/2
      const rPt = pt.clone().add(normal.clone().multiplyScalar(this.laneWidth * 0.5));
      const lPt = pt.clone().add(normal.clone().multiplyScalar(-this.laneWidth * 0.5));

      rightPts.push(rPt);
      leftPts.push(lPt);
    }

    this.rightLaneCurve = new THREE.CatmullRomCurve3(rightPts, true, 'centripetal', 0.5);
    this.leftLaneCurve = new THREE.CatmullRomCurve3(leftPts, true, 'centripetal', 0.5);
  }

  buildTrack() {
    // Generate asphalt road geometry along center curve
    const segments = 350;
    const roadGeom = new THREE.BufferGeometry();
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];

    const up = new THREE.Vector3(0, 1, 0);
    const halfWidth = this.roadWidth * 0.5 + 0.6; // Include shoulder

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const pt = this.centerCurve.getPointAt(u);
      const tangent = this.centerCurve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

      // Left edge, Center, Right edge
      const pLeft = pt.clone().add(normal.clone().multiplyScalar(-halfWidth));
      const pRight = pt.clone().add(normal.clone().multiplyScalar(halfWidth));

      // Slightly lift above ground to avoid z-fighting
      pLeft.y = 0.04;
      pRight.y = 0.04;

      positions.push(pLeft.x, pLeft.y, pLeft.z);
      positions.push(pRight.x, pRight.y, pRight.z);

      normals.push(0, 1, 0, 0, 1, 0);

      const v = u * 40; // Texture repeat along track
      uvs.push(0, v);
      uvs.push(1, v);

      if (i < segments) {
        const row1 = i * 2;
        const row2 = (i + 1) * 2;
        // Winding order pointing upwards (+Y)
        indices.push(row1, row2, row1 + 1);
        indices.push(row1 + 1, row2, row2 + 1);
      }
    }

    roadGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    roadGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeom.setIndex(indices);
    roadGeom.computeVertexNormals();

    // Procedural Dark Asphalt Texture
    const roadTexture = this.createRoadTexture();
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTexture,
      roughness: 0.75,
      metalness: 0.15,
      side: THREE.DoubleSide
    });

    const roadMesh = new THREE.Mesh(roadGeom, roadMat);
    roadMesh.receiveShadow = true;
    this.trackGroup.add(roadMesh);

    // Add Red/White Apex Curbs on curves
    this.buildApexCurbs();

    // Add Guardrails on the outer perimeter
    this.buildGuardrails();
  }

  createRoadTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Dark asphalt base
    ctx.fillStyle = '#1c202a';
    ctx.fillRect(0, 0, 512, 1024);

    // Asphalt noise / aggregate specks
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 1024;
      const brightness = Math.floor(25 + Math.random() * 25);
      ctx.fillStyle = `rgb(${brightness}, ${brightness + 4}, ${brightness + 8})`;
      ctx.fillRect(x, y, Math.random() * 2 + 1, Math.random() * 2 + 1);
    }

    // Outer Solid White Shoulder Lines
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(28, 0, 10, 1024); // Left edge line
    ctx.fillRect(512 - 38, 0, 10, 1024); // Right edge line

    // Center Dashed Yellow Lane Divider
    ctx.fillStyle = '#f59e0b'; // Amber yellow
    const dashLength = 48;
    const gapLength = 48;
    const totalDashes = Math.ceil(1024 / (dashLength + gapLength));
    for (let i = 0; i < totalDashes; i++) {
      const y = i * (dashLength + gapLength);
      ctx.fillRect(256 - 5, y, 10, dashLength);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 35);
    return tex;
  }

  buildApexCurbs() {
    // Red and white curbs along sharp turn corners
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0xff3344,
      roughness: 0.6,
      metalness: 0.2
    });

    const segments = 60;
    const up = new THREE.Vector3(0, 1, 0);

    // Add curbs along Turn 1 (around t = 0.40 to 0.45)
    for (let i = 0; i < segments; i++) {
      const u = 0.38 + (i / segments) * 0.08;
      const pt = this.centerCurve.getPointAt(u);
      const tangent = this.centerCurve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const curbPt = pt.clone().add(normal.clone().multiplyScalar(this.roadWidth * 0.5 + 0.5));
      curbPt.y = 0.12;

      const curbGeom = new THREE.BoxGeometry(0.6, 0.15, 1.2);
      const curbMesh = new THREE.Mesh(curbGeom, curbMat.clone());
      curbMesh.material.color.setHex(i % 2 === 0 ? 0xff2233 : 0xffffff);
      curbMesh.position.copy(curbPt);
      curbMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      this.trackGroup.add(curbMesh);
    }
  }

  buildGuardrails() {
    // Add modern corrugated steel guardrails on high-speed outer curves
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.3
    });

    const up = new THREE.Vector3(0, 1, 0);
    const outerOffset = this.roadWidth * 0.5 + 1.8;

    // North outer curve
    for (let u = 0.35; u <= 0.48; u += 0.008) {
      const pt = this.centerCurve.getPointAt(u);
      const tangent = this.centerCurve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const railPt = pt.clone().add(normal.clone().multiplyScalar(-outerOffset));
      railPt.y = 0.4;

      const postGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8);
      const post = new THREE.Mesh(postGeom, railMat);
      post.position.set(railPt.x, 0.4, railPt.z);
      this.trackGroup.add(post);

      const railBeamGeom = new THREE.BoxGeometry(0.12, 0.3, 2.5);
      const railBeam = new THREE.Mesh(railBeamGeom, railMat);
      railBeam.position.set(railPt.x, 0.65, railPt.z);
      railBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      this.trackGroup.add(railBeam);
    }
  }

  buildEnvironment() {
    // Infield & Outfield Grass Ground
    const groundGeom = new THREE.PlaneGeometry(700, 550);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1e382b, // Lush proving ground green turf
      roughness: 0.9,
      metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.0;
    ground.receiveShadow = true;
    this.trackGroup.add(ground);

    // Subtle Proving Ground Coordinate Grid
    const gridHelper = new THREE.GridHelper(500, 50, 0x00f3ff, 0x224433);
    gridHelper.position.y = 0.01;
    gridHelper.material.opacity = 0.15;
    gridHelper.material.transparent = true;
    this.trackGroup.add(gridHelper);

    // Skid Pad / Autonomous Dynamics Area (Asphalt circle with markings)
    const skidGeom = new THREE.CircleGeometry(45, 64);
    const skidMat = new THREE.MeshStandardMaterial({
      color: 0x1e2430,
      roughness: 0.9
    });
    const skidPad = new THREE.Mesh(skidGeom, skidMat);
    skidPad.rotation.x = -Math.PI / 2;
    skidPad.position.set(-60, 0.02, 10);
    skidPad.receiveShadow = true;
    this.trackGroup.add(skidPad);

    // Skid Pad concentric rings
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
    const ring1 = new THREE.Mesh(new THREE.RingGeometry(15, 15.3, 48), ringMat);
    ring1.rotation.x = -Math.PI / 2;
    ring1.position.set(-60, 0.03, 10);
    this.trackGroup.add(ring1);

    const ring2 = new THREE.Mesh(new THREE.RingGeometry(30, 30.3, 48), ringMat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.set(-60, 0.03, 10);
    this.trackGroup.add(ring2);

    // Test Facility Buildings & Control Tower
    this.buildControlTower();

    // Floodlight Poles along the track
    this.buildTrackLights();

    // Start / Finish Line Overhead Telemetry Gantry
    this.buildTelemetryGantry(this.landmarks.finishLine, 'START / FINISH &middot; TELEMETRY LOOP');
    this.buildTelemetryGantry(this.landmarks.overtakeZone, 'RADAR ACC & OVERTAKING SECTOR');
  }

  buildControlTower() {
    const towerGroup = new THREE.Group();
    towerGroup.position.set(-30, 0, -90);

    // Main building body
    const baseGeom = new THREE.BoxGeometry(28, 12, 18);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x222a38, roughness: 0.7 });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 6;
    base.castShadow = true;
    base.receiveShadow = true;
    towerGroup.add(base);

    // Glass Observation Deck
    const deckGeom = new THREE.BoxGeometry(22, 5, 14);
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.75
    });
    const deck = new THREE.Mesh(deckGeom, deckMat);
    deck.position.y = 14.5;
    towerGroup.add(deck);

    // Roof radar dish
    const dishGeom = new THREE.CylinderGeometry(3, 0.5, 1, 16);
    const dishMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9 });
    const dish = new THREE.Mesh(dishGeom, dishMat);
    dish.position.set(0, 18, 0);
    dish.rotation.z = 0.4;
    towerGroup.add(dish);

    this.trackGroup.add(towerGroup);
  }

  buildTrackLights() {
    // Elegant Proving Ground stadium floodlights
    const lightPositions = [
      new THREE.Vector3(-100, 0, -65),
      new THREE.Vector3(0, 0, -65),
      new THREE.Vector3(100, 0, -65),
      new THREE.Vector3(180, 0, 0),
      new THREE.Vector3(130, 0, 95),
      new THREE.Vector3(20, 0, 95),
      new THREE.Vector3(-90, 0, 95),
      new THREE.Vector3(-170, 0, 0)
    ];

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    lightPositions.forEach(pos => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 16, 8), poleMat);
      pole.position.set(pos.x, 8, pos.z);
      this.trackGroup.add(pole);

      const lampHead = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.8, 1.2), headMat);
      lampHead.position.set(pos.x, 16, pos.z);
      this.trackGroup.add(lampHead);
    });
  }

  buildTelemetryGantry(u, labelText) {
    const pt = this.centerCurve.getPointAt(u);
    const tangent = this.centerCurve.getTangentAt(u).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const gantry = new THREE.Group();
    gantry.position.copy(pt);

    const span = this.roadWidth + 4;
    const height = 6.5;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 });

    // Left and right pillars
    const pLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, height, 8), frameMat);
    pLeft.position.copy(normal.clone().multiplyScalar(-span * 0.5));
    pLeft.position.y = height * 0.5;
    gantry.add(pLeft);

    const pRight = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, height, 8), frameMat);
    pRight.position.copy(normal.clone().multiplyScalar(span * 0.5));
    pRight.position.y = height * 0.5;
    gantry.add(pRight);

    // Cross truss
    const truss = new THREE.Mesh(new THREE.BoxGeometry(span, 0.6, 0.6), frameMat);
    truss.position.y = height;
    gantry.add(truss);

    // Signboard
    const signGeom = new THREE.BoxGeometry(span * 0.7, 1.2, 0.15);
    const signMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
    const sign = new THREE.Mesh(signGeom, signMat);
    sign.position.y = height - 0.2;
    gantry.add(sign);

    // Rotate gantry to face along tangent
    gantry.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal);

    this.trackGroup.add(gantry);
  }

  buildLandmarks() {
    // -------------------------------------------------------------
    // 1. ZEBRA PEDESTRIAN CROSSWALK (Urban Sector at t = landmarks.crosswalk)
    // -------------------------------------------------------------
    const cwT = this.landmarks.crosswalk;
    const cwPt = this.centerCurve.getPointAt(cwT);
    const cwTangent = this.centerCurve.getTangentAt(cwT).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const cwNormal = new THREE.Vector3().crossVectors(cwTangent, up).normalize();

    this.crosswalkPos = cwPt.clone();
    this.crosswalkDir = cwNormal.clone();

    // Create 10 white zebra crossing stripes
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    const numStripes = 9;
    const stripeWidth = 0.55;
    const stripeLength = 3.6; // Length along traffic direction

    for (let i = 0; i < numStripes; i++) {
      const offset = (i - (numStripes - 1) / 2) * (this.roadWidth / numStripes);
      const stripePos = cwPt.clone().add(cwNormal.clone().multiplyScalar(offset));
      stripePos.y = 0.055;

      const stripeGeom = new THREE.PlaneGeometry(stripeWidth, stripeLength);
      const stripe = new THREE.Mesh(stripeGeom, stripeMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.copy(stripePos);
      stripe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cwTangent);
      stripe.rotation.x = -Math.PI / 2;
      this.trackGroup.add(stripe);
    }

    // Pedestrian Waiting Islands / Sidewalk pads on both sides
    const padMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
    [-1, 1].forEach(side => {
      const padPos = cwPt.clone().add(cwNormal.clone().multiplyScalar(side * (this.roadWidth * 0.5 + 2.5)));
      padPos.y = 0.08;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(4, 0.16, 6), padMat);
      pad.position.copy(padPos);
      this.trackGroup.add(pad);

      // Yellow tactile paving / warning line
      const tactile = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.4), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      tactile.rotation.x = -Math.PI / 2;
      tactile.position.copy(padPos);
      tactile.position.y = 0.17;
      tactile.position.add(cwNormal.clone().multiplyScalar(-side * 1.5));
      this.trackGroup.add(tactile);

      // Pedestrian Crossing Signpost
      this.buildPedestrianSign(padPos, side, cwTangent);
    });

    // -------------------------------------------------------------
    // 2. REGULATORY MUTCD STOP SIGN (Intersection at t = landmarks.stopSign)
    // -------------------------------------------------------------
    const ssT = this.landmarks.stopSign;
    const ssPt = this.centerCurve.getPointAt(ssT);
    const ssTangent = this.centerCurve.getTangentAt(ssT).normalize();
    const ssNormal = new THREE.Vector3().crossVectors(ssTangent, up).normalize();

    this.stopSignPos = ssPt.clone();
    this.stopLinePos = ssPt.clone().add(ssTangent.clone().multiplyScalar(-2.0)); // 2m before intersection

    // White Solid Stop Bar line across Ego's lane (Right lane)
    const stopLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stopLineGeom = new THREE.PlaneGeometry(this.laneWidth, 0.6);
    const stopLine = new THREE.Mesh(stopLineGeom, stopLineMat);
    stopLine.rotation.x = -Math.PI / 2;
    // Position on right lane
    const stopLinePos = this.stopLinePos.clone().add(ssNormal.clone().multiplyScalar(this.laneWidth * 0.5));
    stopLinePos.y = 0.055;
    stopLine.position.copy(stopLinePos);
    stopLine.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ssNormal);
    stopLine.rotation.x = -Math.PI / 2;
    this.trackGroup.add(stopLine);

    // 3D Octagonal Stop Sign Mesh on right shoulder
    this.build3DStopSign(ssPt, ssNormal, ssTangent);
  }

  buildPedestrianSign(pos, side, tangent) {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), postMat);
    post.position.set(pos.x, 1.6, pos.z);
    this.trackGroup.add(post);

    // Diamond yellow warning sign
    const signMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const signMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.05), signMat);
    signMesh.rotation.z = Math.PI / 4; // Diamond shape
    signMesh.position.set(pos.x, 2.7, pos.z);
    this.trackGroup.add(signMesh);

    // Solar blinking amber hazard beacon on top
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb800 })
    );
    beacon.position.set(pos.x, 3.3, pos.z);
    this.trackGroup.add(beacon);
  }

  build3DStopSign(centerPt, normal, tangent) {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
    const signGroup = new THREE.Group();

    // Position sign on right shoulder (normal * (roadWidth/2 + 2.0))
    const signPos = centerPt.clone().add(normal.clone().multiplyScalar(this.roadWidth * 0.5 + 2.0));
    signGroup.position.copy(signPos);

    // Post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 8), postMat);
    post.position.y = 1.75;
    signGroup.add(post);

    // Octagonal Stop Sign Board (Cylinder with 8 segments)
    const octagonGeom = new THREE.CylinderGeometry(0.65, 0.65, 0.05, 8);
    const octMat = new THREE.MeshStandardMaterial({ color: 0xd90429, roughness: 0.4 });
    const octagon = new THREE.Mesh(octagonGeom, octMat);
    octagon.rotation.x = Math.PI / 2;
    octagon.position.y = 2.8;
    signGroup.add(octagon);

    // White text / inner border simulation
    const innerBorder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.06, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
    );
    innerBorder.rotation.x = Math.PI / 2;
    innerBorder.position.y = 2.8;
    signGroup.add(innerBorder);

    // Red LED flasher beacon on top of post
    const flasher = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff0044 })
    );
    flasher.position.y = 3.6;
    signGroup.add(flasher);

    // Orient sign to face approaching traffic (-tangent)
    signGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.clone().negate());

    this.trackGroup.add(signGroup);
  }

  // Get point on right lane (Ego vehicle path)
  getRightLanePoint(u) {
    return this.rightLaneCurve.getPointAt((u % 1 + 1) % 1);
  }

  // Get point on left lane (Passing vehicle path)
  getLeftLanePoint(u) {
    return this.leftLaneCurve.getPointAt((u % 1 + 1) % 1);
  }

  // Get centerline point
  getCenterPoint(u) {
    return this.centerCurve.getPointAt((u % 1 + 1) % 1);
  }

  // Get tangent at progress u
  getTangent(u) {
    return this.centerCurve.getTangentAt((u % 1 + 1) % 1).normalize();
  }

  // Convert distance in meters along track to progress parameter delta
  metersToProgress(meters) {
    const totalLength = this.centerCurve.getLength();
    return meters / totalLength;
  }

  progressToMeters(deltaU) {
    return deltaU * this.centerCurve.getLength();
  }
}
