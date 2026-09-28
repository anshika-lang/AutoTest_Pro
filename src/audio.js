/**
 * Web Audio API Sound Synthesizer for Autonomous Vehicle Simulation
 * Provides realistic electric vehicle propulsion sounds, collision warning alarms,
 * turn signals, and test completion audio cues without requiring external audio assets.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isInitialized = false;

    // Propulsion sound nodes
    this.motorOsc = null;
    this.motorGain = null;
    this.motorFilter = null;

    // Alert timers
    this.fcwInterval = null;
    this.isWarningBeeping = false;
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();

      // Create continuous EV motor oscillator
      this.motorOsc = this.ctx.createOscillator();
      this.motorOsc.type = 'triangle';
      this.motorOsc.frequency.setValueAtTime(45, this.ctx.currentTime);

      this.motorFilter = this.ctx.createBiquadFilter();
      this.motorFilter.type = 'lowpass';
      this.motorFilter.frequency.setValueAtTime(220, this.ctx.currentTime);

      this.motorGain = this.ctx.createGain();
      this.motorGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

      this.motorOsc.connect(this.motorFilter);
      this.motorFilter.connect(this.motorGain);
      this.motorGain.connect(this.ctx.destination);

      this.motorOsc.start();
      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio could not be initialized:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.motorGain && this.ctx) {
      if (this.isMuted) {
        this.motorGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
    }
    return this.isMuted;
  }

  updateMotorSound(speedKmh, throttle) {
    if (!this.isInitialized || this.isMuted || !this.ctx) return;
    this.resume();

    const speedRatio = Math.min(speedKmh / 100, 1.2);
    const targetFreq = 45 + speedRatio * 180 + throttle * 40;
    const targetGain = 0.02 + speedRatio * 0.05 + throttle * 0.04;
    const filterFreq = 180 + speedRatio * 600;

    const t = this.ctx.currentTime;
    this.motorOsc.frequency.setTargetAtTime(targetFreq, t, 0.1);
    this.motorFilter.frequency.setTargetAtTime(filterFreq, t, 0.1);
    this.motorGain.gain.setTargetAtTime(targetGain, t, 0.08);
  }

  playFCWWarning(isCritical = false) {
    if (!this.isInitialized || this.isMuted || !this.ctx) return;
    this.resume();

    const freq = isCritical ? 980 : 750;
    const duration = isCritical ? 0.08 : 0.12;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isCritical ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    gain.gain.setValueAtTime(isCritical ? 0.18 : 0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playBrakeSqueal() {
    if (!this.isInitialized || this.isMuted || !this.ctx) return;
    this.resume();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.35);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, this.ctx.currentTime);

    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  playChime(type = 'success') {
    if (!this.isInitialized || this.isMuted || !this.ctx) return;
    this.resume();

    const notes = type === 'success' ? [523.25, 659.25, 783.99, 1046.50] : [400, 320, 250];
    const stepTime = 0.08;

    notes.forEach((freq, idx) => {
      const startTime = this.ctx.currentTime + idx * stepTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.25);
    });
  }

  playClick() {
    if (!this.isInitialized || this.isMuted || !this.ctx) return;
    this.resume();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);

    gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.03);
  }
}

export const sound = new SoundEngine();
