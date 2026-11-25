// 외부 파일 없이 WebAudio 로 만든 짧은 효과음
let ac: AudioContext | null = null;
function beep(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.08) {
  try {
    ac ??= new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
  } catch { /* 소리 없이 진행 */ }
}
export function sfx(ev: string) {
  const m: Record<string, [number, number, OscillatorType?]> = {
    fire: [180, 0.08, 'sawtooth'], dry: [900, 0.03], eject: [300, 0.06], insert: [420, 0.08],
    rack: [600, 0.05], 'rack-waste': [700, 0.07], fill: [1200, 0.02], dead: [80, 0.6, 'sawtooth'],
  };
  const v = m[ev]; if (v) beep(v[0], v[1], v[2]);
}
