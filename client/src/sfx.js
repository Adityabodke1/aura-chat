let audioContext = null;

function context() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function blip({ frequency = 660, duration = 0.09, volume = 0.035, type = 'sine', delay = 0, slide = 0 }) {
  if (!sfx.enabled) return;
  try {
    const ac = context();
    if (!ac) return;
    const start = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + slide), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  } catch {
    /* audio is a nice-to-have */
  }
}

export const sfx = {
  enabled: (() => {
    try {
      return localStorage.getItem('aura.sound') !== 'off';
    } catch {
      return true;
    }
  })(),

  setEnabled(value) {
    this.enabled = Boolean(value);
    try {
      localStorage.setItem('aura.sound', this.enabled ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  },

  message() {
    blip({ frequency: 740, duration: 0.07, volume: 0.022, slide: 180 });
  },

  sent() {
    blip({ frequency: 520, duration: 0.06, volume: 0.016, slide: 120 });
  },

  join() {
    blip({ frequency: 440, duration: 0.1, volume: 0.03 });
    blip({ frequency: 660, duration: 0.12, volume: 0.03, delay: 0.09 });
  },

  leave() {
    blip({ frequency: 560, duration: 0.1, volume: 0.025 });
    blip({ frequency: 380, duration: 0.14, volume: 0.025, delay: 0.09 });
  },

  mute() {
    blip({ frequency: 320, duration: 0.07, volume: 0.02, type: 'triangle' });
  },

  error() {
    blip({ frequency: 220, duration: 0.12, volume: 0.03, type: 'square' });
  },

  ring() {
    let stopped = false;
    const pattern = () => {
      if (stopped) return;
      blip({ frequency: 880, duration: 0.16, volume: 0.045 });
      blip({ frequency: 1046, duration: 0.16, volume: 0.045, delay: 0.2 });
      blip({ frequency: 880, duration: 0.16, volume: 0.045, delay: 0.4 });
    };
    pattern();
    const timer = setInterval(pattern, 2200);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  },
};
