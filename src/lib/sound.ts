// Tiny synthesized sound effects (no audio files). Silent when the setting is off.
import { settings } from './store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!settings.get().sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A soft knock for a move, a slightly sharper one for a capture. */
export function playMove(capture = false): void {
  tone(capture ? 190 : 260, 0.09, 'triangle', capture ? 0.22 : 0.16);
  if (capture) tone(120, 0.07, 'square', 0.05, 0.01);
}

export function playRight(): void {
  tone(660, 0.1, 'sine', 0.12);
  tone(880, 0.16, 'sine', 0.12, 0.09);
}

export function playWrong(): void {
  tone(180, 0.18, 'sawtooth', 0.07);
}

export function playEnd(): void {
  tone(523, 0.14, 'sine', 0.11);
  tone(392, 0.22, 'sine', 0.11, 0.13);
}
