import * as THREE from 'three';

/**
 * Sensor Visualization HUD:
 * 1. 360° LiDAR Radar Scope Canvas
 * 2. Forward AI Vision Viewport with Dynamic Object Bounding Boxes
 */
export class SensorVisualizer {
  constructor(radarCanvas, visionCanvas, aiOverlayEl) {
    this.radarCanvas = radarCanvas;
    this.radarCtx = radarCanvas.getContext('2d');
    this.visionCanvas = visionCanvas;
    this.aiOverlay = aiOverlayEl;

    // Sweep angle for 360 LiDAR animation
    this.sweepAngle = 0;
    this.radarRange = 75; // meters
  }

  // Draw 360 LiDAR Radar Scope
  renderRadar(egoVehicle, trackedObjects, stopLineDist) {
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2 + 10;
    const radius = Math.min(w, h) * 0.44;

    // Fade background to create phosphor afterglow
    ctx.fillStyle = 'rgba(5, 10, 18, 0.28)';
    ctx.fillRect(0, 0, w, h);

    // Draw range rings
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.18)';
    ctx.lineWidth = 1;
    const rings = [0.25, 0.5, 0.75, 1.0];
    rings.forEach((r, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
      ctx.stroke();

      // Range text (18m, 37m, 56m, 75m)
      ctx.fillStyle = 'rgba(0, 243, 255, 0.4)';
      ctx.font = '9px monospace';
      ctx.fillText(`${Math.round(this.radarRange * r)}m`, cx + 4, cy - radius * r + 10);
    });

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    // Danger & Caution Zone Envelopes
    ctx.strokeStyle = 'rgba(255, 51, 102, 0.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, (radius * 15) / this.radarRange, 0, Math.PI * 2);
    ctx.stroke();

    // 360-degree rotating sweep line
    this.sweepAngle = (this.sweepAngle + 0.08) % (Math.PI * 2);
    const sweepX = cx + Math.cos(this.sweepAngle) * radius;
    const sweepY = cy + Math.sin(this.sweepAngle) * radius;

    const grad = ctx.createLinearGradient(cx, cy, sweepX, sweepY);
    grad.addColorStop(0, 'rgba(0, 243, 255, 0.8)');
    grad.addColorStop(1, 'rgba(0, 243, 255, 0.0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sweepX, sweepY);
    ctx.stroke();

    // Draw Ego Car at center
    ctx.fillStyle = '#00f3ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Ego heading tip
    ctx.strokeStyle = '#00f3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 10); // Facing straight up on scope
    ctx.stroke();

    // Render Tracked Objects on Radar Scope
    const egoPos = egoVehicle.position;
    const egoYaw = egoVehicle.yaw;

    trackedObjects.forEach(obj => {
      // Relative vector in vehicle local coordinates
      const dx = obj.pos.x - egoPos.x;
      const dz = obj.pos.z - egoPos.z;

      // Rotate into Ego vehicle reference frame
      const cosY = Math.cos(egoYaw);
      const sinY = Math.sin(egoYaw);
      const localX = cosY * dx - sinY * dz;
      const localZ = sinY * dx + cosY * dz;

      // Project onto radar circle (Forward is -Z on world, Up on radar)
      const scale = radius / this.radarRange;
      const radarX = cx + localX * scale;
      const radarY = cy - localZ * scale;

      if (Math.hypot(radarX - cx, radarY - cy) <= radius) {
        // Draw object blip
        let color = '#ffd166';
        if (obj.type === 'VEHICLE') color = '#ff9f1c';
        if (obj.type === 'OBSTACLE') color = '#e63946';

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(radarX, radarY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px monospace';
        ctx.fillText(`${Math.round(obj.dist)}m`, radarX + 6, radarY + 3);
      }
    });

    // Render Stop Line if within range
    if (stopLineDist && stopLineDist < this.radarRange && stopLineDist > 0) {
      const scale = radius / this.radarRange;
      const lineY = cy - stopLineDist * scale;
      ctx.strokeStyle = '#ff3366';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 15, lineY);
      ctx.lineTo(cx + 15, lineY);
      ctx.stroke();
    }
  }

  // Update AI Vision Bounding Boxes Overlay
  updateAIBoundingBoxes(camera, trackedObjects, stopSignObj) {
    if (!this.aiOverlay) return;

    // Clear previous boxes
    this.aiOverlay.innerHTML = '';
    const rect = this.aiOverlay.getBoundingClientRect();
    const width = rect.width || 300;
    const height = rect.height || 170;

    let count = 0;

    // Helper to project 3D point to overlay 2D screen coordinate
    const projectToScreen = (worldPos) => {
      const p = worldPos.clone().project(camera);
      // Behind camera check
      if (p.z > 1.0) return null;
      const screenX = (p.x * 0.5 + 0.5) * width;
      const screenY = (-(p.y * 0.5) + 0.5) * height;
      return { x: screenX, y: screenY, z: p.z };
    };

    trackedObjects.forEach(obj => {
      const screenPt = projectToScreen(obj.pos);
      if (!screenPt) return;

      // Only display if inside viewport bounds
      if (screenPt.x < 10 || screenPt.x > width - 10 || screenPt.y < 10 || screenPt.y > height - 10) {
        return;
      }

      count++;
      const dist = Math.max(1, obj.dist);
      const boxW = Math.max(22, Math.min(120, (140 / dist) * 12));
      const boxH = Math.max(30, Math.min(160, (180 / dist) * 12));

      const isWarning = obj.ttc < 2.5;
      const isCritical = obj.ttc < 1.4;

      const boxDiv = document.createElement('div');
      boxDiv.className = `ai-bbox ${isCritical ? 'critical' : isWarning ? 'warning' : ''}`;
      boxDiv.style.left = `${screenPt.x - boxW / 2}px`;
      boxDiv.style.top = `${screenPt.y - boxH / 2}px`;
      boxDiv.style.width = `${boxW}px`;
      boxDiv.style.height = `${boxH}px`;

      const label = document.createElement('div');
      label.className = 'ai-bbox-label';
      label.textContent = `${obj.type} ${Math.round(obj.dist * 10) / 10}m [TTC:${obj.ttc < 99 ? (Math.round(obj.ttc * 10) / 10 + 's') : '--'}]`;
      boxDiv.appendChild(label);

      this.aiOverlay.appendChild(boxDiv);
    });

    const countBadge = document.getElementById('ai-objects-count');
    if (countBadge) {
      countBadge.textContent = `${count} OBJECT${count === 1 ? '' : 'S'}`;
    }
  }
}
