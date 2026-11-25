// 외부 파일 없이 WebAudio 로 만든 짧은 효과음
let ac: AudioContext | null = null;
function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.07, slide = 0) {
  try {
    ac ??= new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), ac.currentTime + dur);
    g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
  } catch { /* 소리 없이 진행 */ }
}
function noise(dur: number, vol = 0.12) {
  try {
    ac ??= new AudioContext();
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ac.createBufferSource(), g = ac.createGain(); g.gain.value = vol;
    src.buffer = buf; src.connect(g).connect(ac.destination); src.start();
  } catch { /* 무시 */ }
}
export function sfx(ev: string) {
  switch (ev) {
    case 'fire': noise(0.12, 0.18); tone(140, 0.1, 'sawtooth', 0.06, 0.4); break;
    case 'jam': noise(0.12, 0.18); tone(900, 0.05, 'square', 0.05); break;
    case 'enemy-fire': noise(0.1, 0.07); break;
    case 'dry': case 'jammed': tone(1100, 0.025, 'square', 0.05); break;
    case 'eject': tone(300, 0.06); break;
    case 'insert': tone(420, 0.05); tone(620, 0.05); break;
    case 'rack': case 'rack-waste': case 'unjam': tone(700, 0.04); tone(500, 0.05); break;
    case 'pickup': tone(880, 0.06, 'triangle'); break;
    case 'hit': tone(200, 0.15, 'sawtooth', 0.08, 0.5); break;
    case 'dead': tone(120, 0.6, 'sawtooth', 0.08, 0.3); break;
    case 'kill': tone(240, 0.08, 'square', 0.05, 0.5); break;
    case 'takedown': noise(0.08, 0.12); tone(160, 0.1, 'square', 0.06); break;
    case 'trigger': tone(1500, 0.015, 'square', 0.03); break;
    case 'door': tone(523, 0.08, 'triangle'); setTimeout(() => tone(784, 0.1, 'triangle'), 80); break;
  }
}
