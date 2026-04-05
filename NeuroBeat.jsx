import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════
   NEUROBEAT v2.0
   Binaural Beats + Isochronic Tones · Web Audio API · React
═══════════════════════════════════════════════════════════ */

// ── Preset Definitions ───────────────────────────────────
const PRESETS = [
  {
    id: "focus",
    label: "Focus",
    icon: "◈",
    tag: "Beta",
    hz: "14–30 Hz",
    baseFreq: 200,
    beatFreq: 20,
    isoFreq: 20,
    description: "Sharpen concentration and mental clarity. Ideal for deep work, studying, and problem-solving.",
    gradient: ["#00d4ff", "#0066ff"],
    glow: "#00aaff",
    bgAccent: "rgba(0,102,255,0.12)",
  },
  {
    id: "relax",
    label: "Relax",
    icon: "◉",
    tag: "Alpha",
    hz: "8–13 Hz",
    baseFreq: 180,
    beatFreq: 10,
    isoFreq: 10,
    description: "Ease into a calm, present state. Perfect for unwinding, light reading, or creative flow.",
    gradient: ["#a78bfa", "#6d28d9"],
    glow: "#8b5cf6",
    bgAccent: "rgba(109,40,217,0.12)",
  },
  {
    id: "sleep",
    label: "Sleep",
    icon: "◑",
    tag: "Delta",
    hz: "1–4 Hz",
    baseFreq: 160,
    beatFreq: 2,
    isoFreq: 2,
    description: "Guide your brain into deep, restorative sleep. Use in a quiet, dark environment.",
    gradient: ["#3b82f6", "#1e3a5f"],
    glow: "#2563eb",
    bgAccent: "rgba(13,27,42,0.3)",
  },
  {
    id: "meditation",
    label: "Meditate",
    icon: "◎",
    tag: "Theta",
    hz: "4–8 Hz",
    baseFreq: 170,
    beatFreq: 6,
    isoFreq: 6,
    description: "Enter a deeply meditative, introspective state. Enhances creativity and emotional processing.",
    gradient: ["#f472b6", "#7c3aed"],
    glow: "#c026d3",
    bgAccent: "rgba(124,58,237,0.12)",
  },
];

const BG_SOUNDS = [
  { id: "none",  label: "None",        icon: "✕" },
  { id: "rain",  label: "Rain",        icon: "🌧" },
  { id: "ocean", label: "Ocean",       icon: "🌊" },
  { id: "white", label: "White Noise", icon: "∿"  },
];

const TIMERS = [0, 5, 10, 30, 60];

const AUDIO_MODES = [
  { id: "binaural",    label: "Binaural",    desc: "Two tones · headphones" },
  { id: "isochronic",  label: "Isochronic",  desc: "Pulsing tone · speakers" },
  { id: "both",        label: "Both",        desc: "Maximum effect" },
];

/* ═══════════════════════════════════════════════════════════
   UPGRADED BINAURAL ENGINE v2
   Graph: leftOsc/rightOsc → merger → binauralGain ─┐
          isoOsc × isoLFO (AM)     → isoGain     ─── masterGain → destination
          bgAudio (HTML Audio)     → bgGain       ─┘
═══════════════════════════════════════════════════════════ */
class BinauralEngine {
  constructor() {
    this.ctx          = null;
    // Binaural nodes
    this.leftOsc      = null;
    this.rightOsc     = null;
    this.merger       = null;
    // Isochronic nodes
    this.isoOsc       = null;
    this.isoAMGain    = null;
    this.isoLFO       = null;
    this.isoLFOGain   = null;
    this._dcOffset    = null;
    // Gain buses
    this.masterGain   = null;
    this.binauralGain = null;
    this.isoGain      = null;
    this.bgGain       = null;
    // Background audio
    this.bgAudio      = null;
    this.bgSource     = null;

    this.running = false;
  }

  /* ── Build audio graph ───────────────────────────────── */
  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.ctx.destination);

    this.binauralGain = this.ctx.createGain();
    this.binauralGain.gain.value = 0;
    this.binauralGain.connect(this.masterGain);

    this.isoGain = this.ctx.createGain();
    this.isoGain.gain.value = 0;
    this.isoGain.connect(this.masterGain);

    this.bgGain = this.ctx.createGain();
    this.bgGain.gain.value = 0.3;
    this.bgGain.connect(this.masterGain);
  }

  /* ── Start tones ─────────────────────────────────────── */
  async start(leftFreq, rightFreq, isoFreq, volume, mode) {
    await this.init();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this._stopBinaural();
    this._stopIsochronic();

    const t = this.ctx.currentTime;

    // ── Binaural path ──────────────────────────────────
    if (mode === "binaural" || mode === "both") {
      this.merger = this.ctx.createChannelMerger(2);
      this.merger.connect(this.binauralGain);

      this.leftOsc = this.ctx.createOscillator();
      this.leftOsc.type = "sine";
      this.leftOsc.frequency.value = leftFreq;
      const lGain = this.ctx.createGain();
      lGain.gain.value = 1;
      this.leftOsc.connect(lGain);
      lGain.connect(this.merger, 0, 0);

      this.rightOsc = this.ctx.createOscillator();
      this.rightOsc.type = "sine";
      this.rightOsc.frequency.value = rightFreq;
      const rGain = this.ctx.createGain();
      rGain.gain.value = 1;
      this.rightOsc.connect(rGain);
      rGain.connect(this.merger, 0, 1);

      this.binauralGain.gain.setValueAtTime(0, t);
      this.binauralGain.gain.linearRampToValueAtTime(Math.min(volume, 0.7), t + 1.5);

      this.leftOsc.start();
      this.rightOsc.start();
    } else {
      this.binauralGain.gain.setValueAtTime(0, t);
    }

    // ── Isochronic path (AM synthesis) ────────────────
    // Carrier sine wave multiplied by a rectified LFO creates
    // distinct on/off pulses at the target brainwave frequency.
    if (mode === "isochronic" || mode === "both") {
      const carrierFreq = (leftFreq + rightFreq) / 2;

      // Carrier oscillator
      this.isoOsc = this.ctx.createOscillator();
      this.isoOsc.type = "sine";
      this.isoOsc.frequency.value = carrierFreq;

      // AM gain — its gain param is driven by the LFO
      this.isoAMGain = this.ctx.createGain();
      this.isoAMGain.gain.value = 0;

      // LFO at beat frequency
      this.isoLFO = this.ctx.createOscillator();
      this.isoLFO.type = "sine";
      this.isoLFO.frequency.value = isoFreq;

      // Scale LFO to 0.5 amplitude
      this.isoLFOGain = this.ctx.createGain();
      this.isoLFOGain.gain.value = 0.5;

      // DC offset node shifts LFO center from 0 to 0.5
      // so AM gain oscillates between 0 and 1
      if (this.ctx.createConstantSource) {
        this._dcOffset = this.ctx.createConstantSource();
        this._dcOffset.offset.value = 0.5;
        this._dcOffset.connect(this.isoAMGain.gain);
        this._dcOffset.start();
      }

      this.isoLFO.connect(this.isoLFOGain);
      this.isoLFOGain.connect(this.isoAMGain.gain);

      this.isoOsc.connect(this.isoAMGain);
      this.isoAMGain.connect(this.isoGain);

      this.isoGain.gain.setValueAtTime(0, t);
      this.isoGain.gain.linearRampToValueAtTime(Math.min(volume, 0.7), t + 1.5);

      this.isoOsc.start();
      this.isoLFO.start();
    } else {
      this.isoGain.gain.setValueAtTime(0, t);
    }

    this.running = true;
  }

  /* ── Stop with fade ──────────────────────────────────── */
  stop(fade = true) {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;

    if (fade) {
      [this.binauralGain, this.isoGain].forEach(g => {
        if (!g) return;
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 1.2);
      });
      setTimeout(() => { this._stopBinaural(); this._stopIsochronic(); }, 1300);
    } else {
      this._stopBinaural();
      this._stopIsochronic();
    }

    this.stopBg();
    this.running = false;
  }

  _stopBinaural() {
    try { this.leftOsc?.stop();  } catch (_) {}
    try { this.rightOsc?.stop(); } catch (_) {}
    try { this.merger?.disconnect(); } catch (_) {}
    this.leftOsc = this.rightOsc = this.merger = null;
  }

  _stopIsochronic() {
    try { this.isoOsc?.stop();    } catch (_) {}
    try { this.isoLFO?.stop();    } catch (_) {}
    try { this._dcOffset?.stop(); } catch (_) {}
    try { this.isoAMGain?.disconnect(); } catch (_) {}
    this.isoOsc = this.isoLFO = this.isoAMGain = this.isoLFOGain = this._dcOffset = null;
  }

  /* ── Live controls ───────────────────────────────────── */
  setVolume(v) {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.linearRampToValueAtTime(Math.min(v, 0.9), this.ctx.currentTime + 0.1);
  }

  setFrequencies(left, right) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.leftOsc?.frequency.linearRampToValueAtTime(left, t + 0.3);
    this.rightOsc?.frequency.linearRampToValueAtTime(right, t + 0.3);
  }

  setIsoFrequency(freq) {
    if (!this.isoLFO || !this.ctx) return;
    this.isoLFO.frequency.linearRampToValueAtTime(freq, this.ctx.currentTime + 0.3);
  }

  /* ── Background audio (real files, routed through graph) */
  async startBg(type, volume) {
    this.stopBg();
    if (type === "none") return;
    await this.init();

    const urls = { rain: "/sounds/rain.mp3", ocean: "/sounds/ocean.mp3", white: "/sounds/white.mp3" };
    this.bgAudio = new Audio(urls[type]);
    this.bgAudio.loop = true;
    this.bgAudio.crossOrigin = "anonymous";

    try {
      // Route through Web Audio graph so masterGain controls it
      this.bgSource = this.ctx.createMediaElementSource(this.bgAudio);
      this.bgSource.connect(this.bgGain);
    } catch (_) {
      // Fallback: direct HTML audio volume if source already connected
      this.bgAudio.volume = volume;
    }

    this.bgGain.gain.value = volume;

    try {
      await this.bgAudio.play();
    } catch (e) {
      console.warn("BG audio blocked by browser:", e);
    }
  }

  stopBg() {
    if (this.bgAudio) { this.bgAudio.pause(); this.bgAudio = null; }
    try { this.bgSource?.disconnect(); } catch (_) {}
    this.bgSource = null;
  }

  setBgVolume(v) {
    if (this.bgGain && this.ctx)
      this.bgGain.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.1);
    if (this.bgAudio) this.bgAudio.volume = v;
  }

  destroy() {
    this.stop(false);
    this.stopBg();
    this.ctx?.close();
    this.ctx = null;
  }
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */
function fmt(s) {
  return `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED ORB
═══════════════════════════════════════════════════════════ */
function WaveOrb({ playing, beatFreq, preset, mode }) {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const phaseRef  = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      if (!playing) {
        ctx.beginPath(); ctx.arc(cx, cy, 88, 0, Math.PI*2);
        ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1.5; ctx.stroke();
        animRef.current = requestAnimationFrame(draw); return;
      }

      phaseRef.current += beatFreq * 0.006;
      const p = phaseRef.current;

      // Isochronic: sharp concentric pulse rings
      if (mode === "isochronic" || mode === "both") {
        const pulse = (Math.sin(p * 2) + 1) / 2;
        for (let r = 0; r < 4; r++) {
          ctx.beginPath();
          ctx.arc(cx, cy, 38 + r * 24 + pulse * 18, 0, Math.PI*2);
          ctx.strokeStyle = `rgba(255,255,255,${(0.15 - r*0.03) * pulse})`;
          ctx.lineWidth = 7 - r * 1.2; ctx.stroke();
        }
      }

      // Aura rings
      for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        ctx.arc(cx, cy, 76 + r*20 + Math.sin(p + r*1.1)*(6+r*2), 0, Math.PI*2);
        ctx.strokeStyle = `rgba(255,255,255,${0.05-r*0.012})`;
        ctx.lineWidth = 10-r*2; ctx.stroke();
      }

      // Organic blob
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i/72)*Math.PI*2;
        const noise = Math.sin(a*3+p)*11 + Math.sin(a*5-p*0.7)*6 + Math.sin(a*8+p*1.4)*3.5;
        const rad = 68+noise;
        i===0 ? ctx.moveTo(cx+Math.cos(a)*rad, cy+Math.sin(a)*rad)
              : ctx.lineTo(cx+Math.cos(a)*rad, cy+Math.sin(a)*rad);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(cx,cy,0,cx,cy,88);
      grad.addColorStop(0, preset.gradient[0]+"66");
      grad.addColorStop(0.5, preset.gradient[1]+"33");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = preset.glow+"88"; ctx.lineWidth = 1.2; ctx.stroke();

      // Centre dot with isochronic pulse
      const dotR = (mode==="isochronic"||mode==="both")
        ? 5 + ((Math.sin(p*2)+1)/2)*6 : 4+Math.sin(p)*2;
      ctx.beginPath(); ctx.arc(cx, cy, dotR, 0, Math.PI*2);
      ctx.fillStyle = preset.gradient[0];
      ctx.shadowColor = preset.glow; ctx.shadowBlur = 14;
      ctx.fill(); ctx.shadowBlur = 0;

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, beatFreq, preset, mode]);

  return (
    <canvas ref={canvasRef} width={240} height={240}
      style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)" }} />
  );
}

/* ═══════════════════════════════════════════════════════════
   SLIDER
═══════════════════════════════════════════════════════════ */
function Slider({ label, value, min, max, step=1, onChange, unit="", color }) {
  const pct = ((value-min)/(max-min))*100;
  const display = typeof value==="number"&&!Number.isInteger(value) ? value.toFixed(1) : value;
  return (
    <div style={{ marginBottom:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{ fontSize:11, letterSpacing:"0.1em", color:"rgba(255,255,255,0.4)", textTransform:"uppercase" }}>{label}</span>
        <span style={{ fontSize:13, fontWeight:600, color:color||"rgba(255,255,255,0.9)", fontVariantNumeric:"tabular-nums" }}>{display}{unit}</span>
      </div>
      <div style={{ position:"relative", height:36, display:"flex", alignItems:"center" }}>
        <div style={{ position:"absolute", left:0, right:0, height:3, background:"rgba(255,255,255,0.08)", borderRadius:2 }} />
        <div style={{ position:"absolute", left:0, width:`${pct}%`, height:3, background:color||"rgba(255,255,255,0.6)", borderRadius:2, transition:"width 0.05s" }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(parseFloat(e.target.value))}
          style={{ position:"absolute", left:0, right:0, width:"100%", height:"100%", opacity:0, cursor:"pointer", margin:0 }} />
        <div style={{ position:"absolute", left:`calc(${pct}% - 8px)`, width:16, height:16, borderRadius:"50%", background:color||"#fff", boxShadow:`0 0 10px ${color||"#fff"}99`, transition:"left 0.05s", pointerEvents:"none" }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════ */
export default function NeuroBeat() {
  const [screen,       setScreen]       = useState("home");
  const [activePreset, setActivePreset] = useState(PRESETS[0]);
  const [audioMode,    setAudioMode]    = useState("binaural");
  const [playing,      setPlaying]      = useState(false);
  const [volume,       setVolume]       = useState(0.6);
  const [leftFreq,     setLeftFreq]     = useState(200);
  const [rightFreq,    setRightFreq]    = useState(220);
  const [isoFreq,      setIsoFreq]      = useState(20);
  const [bgSound,      setBgSound]      = useState("none");
  const [bgVol,        setBgVol]        = useState(0.3);
  const [timerMin,     setTimerMin]     = useState(0);
  const [timeLeft,     setTimeLeft]     = useState(0);
  const [tab,          setTab]          = useState("preset");
  const [streak]                        = useState(3);
  const [totalMins]                     = useState(47);

  const engineRef = useRef(new BinauralEngine());
  const timerRef  = useRef(null);

  const preset   = activePreset;
  const beatFreq = Math.abs(rightFreq - leftFreq);

  const selectPreset = useCallback((p) => {
    setActivePreset(p);
    const lf = p.baseFreq, rf = p.baseFreq + p.beatFreq;
    setLeftFreq(lf); setRightFreq(rf); setIsoFreq(p.isoFreq);
    if (playing) {
      engineRef.current.setFrequencies(lf, rf);
      engineRef.current.setIsoFrequency(p.isoFreq);
    }
  }, [playing]);

  const togglePlay = async () => {
    const eng = engineRef.current;
    if (playing) {
      eng.stop(true); setPlaying(false); clearInterval(timerRef.current);
    } else {
      try {
        await eng.start(leftFreq, rightFreq, isoFreq, volume, audioMode);
        if (bgSound !== "none") await eng.startBg(bgSound, bgVol);
        setPlaying(true);
        if (timerMin > 0) {
          setTimeLeft(timerMin * 60);
          timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
              if (prev <= 1) { eng.stop(true); setPlaying(false); clearInterval(timerRef.current); return 0; }
              return prev - 1;
            });
          }, 1000);
        }
      } catch (e) { console.error("Audio start failed:", e); }
    }
  };

  useEffect(() => { if (playing) engineRef.current.setVolume(volume); }, [volume, playing]);
  useEffect(() => {
    if (playing) {
      if (bgSound === "none") engineRef.current.stopBg();
      else engineRef.current.startBg(bgSound, bgVol);
    }
  }, [bgSound, playing]);
  useEffect(() => { if (playing) engineRef.current.setBgVolume(bgVol); }, [bgVol, playing]);
  useEffect(() => () => { engineRef.current.destroy(); clearInterval(timerRef.current); }, []);

  const updateLeft  = v => { setLeftFreq(v);  if (playing) engineRef.current.setFrequencies(v, rightFreq); };
  const updateRight = v => { setRightFreq(v); if (playing) engineRef.current.setFrequencies(leftFreq, v); };
  const updateIso   = v => { setIsoFreq(v);   if (playing) engineRef.current.setIsoFrequency(v); };

  const hour = new Date().getHours();
  const suggested = hour<9 ? PRESETS[3] : hour<14 ? PRESETS[0] : hour<18 ? PRESETS[1] : hour<22 ? PRESETS[3] : PRESETS[2];

  const S = {
    app: { fontFamily:"'DM Sans','SF Pro Display',-apple-system,sans-serif", background:"#060912", minHeight:"100vh", maxWidth:430, margin:"0 auto", position:"relative", overflow:"hidden", color:"#fff", userSelect:"none" },
    header: { padding:"52px 24px 0", display:"flex", justifyContent:"space-between", alignItems:"center" },
    logo: { fontSize:18, fontWeight:700, letterSpacing:"-0.02em", background:`linear-gradient(135deg,${preset.gradient[0]},${preset.gradient[1]})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" },
    navBtn: { background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.7)", borderRadius:12, padding:"8px 14px", fontSize:12, cursor:"pointer", letterSpacing:"0.05em" },
    card: { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:20, padding:"20px", marginBottom:12 },
    sectionLabel: { fontSize:11, letterSpacing:"0.1em", color:"rgba(255,255,255,0.35)", textTransform:"uppercase", marginBottom:12 },
  };

  const css = `
    input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:1px;height:1px;}
    ::-webkit-scrollbar{display:none;}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
    body{margin:0;background:#060912;}
  `;

  /* ── HOME ──────────────────────────────────────────── */
  if (screen === "home") return (
    <div style={S.app}>
      <style>{css}</style>
      <div style={{ position:"fixed", inset:0, zIndex:0, background:`radial-gradient(ellipse 60% 40% at 50% 0%,${preset.bgAccent},transparent)`, transition:"background 1s ease", pointerEvents:"none" }} />
      <div style={{ position:"relative", zIndex:1 }}>

        <div style={S.header}>
          <span style={S.logo}>◈ NeuroBeat</span>
          <button style={S.navBtn} onClick={() => setScreen("settings")}>⚙ Settings</button>
        </div>

        {/* AI suggestion */}
        <div style={{ margin:"20px 24px 0" }}>
          <div style={{ background:`linear-gradient(135deg,${suggested.gradient[0]}22,${suggested.gradient[1]}22)`, border:`1px solid ${suggested.glow}33`, borderRadius:16, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:10, letterSpacing:"0.12em", color:"rgba(255,255,255,0.4)", marginBottom:4, textTransform:"uppercase" }}>✦ AI Suggestion</div>
              <div style={{ fontSize:14, fontWeight:600 }}>{suggested.icon} {suggested.label} · {suggested.hz}</div>
            </div>
            <button onClick={() => { selectPreset(suggested); setScreen("player"); }} style={{ background:`linear-gradient(135deg,${suggested.gradient[0]},${suggested.gradient[1]})`, border:"none", color:"#fff", borderRadius:10, padding:"8px 14px", fontSize:12, fontWeight:600, cursor:"pointer" }}>Try →</button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:"flex", gap:10, margin:"14px 24px 0" }}>
          {[{label:"Day Streak",value:`${streak} 🔥`},{label:"Total Mins",value:totalMins}].map(s=>(
            <div key={s.label} style={{ flex:1, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"14px 16px" }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>{s.label}</div>
              <div style={{ fontSize:22, fontWeight:700 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Audio mode */}
        <div style={{ margin:"20px 24px 0" }}>
          <div style={S.sectionLabel}>Audio Mode</div>
          <div style={{ display:"flex", gap:8 }}>
            {AUDIO_MODES.map(m=>(
              <button key={m.id} onClick={()=>setAudioMode(m.id)} style={{ flex:1, padding:"10px 6px", background:audioMode===m.id?`linear-gradient(135deg,${preset.gradient[0]}33,${preset.gradient[1]}33)`:"rgba(255,255,255,0.04)", border:audioMode===m.id?`1px solid ${preset.glow}66`:"1px solid rgba(255,255,255,0.07)", borderRadius:12, cursor:"pointer", textAlign:"center", transition:"all 0.2s" }}>
                <div style={{ fontSize:12, fontWeight:700, color:audioMode===m.id?preset.glow:"rgba(255,255,255,0.7)", marginBottom:3 }}>{m.label}</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", lineHeight:1.3 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Presets grid */}
        <div style={{ margin:"20px 24px 0" }}>
          <div style={S.sectionLabel}>Modes</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {PRESETS.map(p=>(
              <button key={p.id} onClick={()=>{selectPreset(p);setScreen("player");}} style={{ background:activePreset.id===p.id?`linear-gradient(135deg,${p.gradient[0]}33,${p.gradient[1]}33)`:"rgba(255,255,255,0.04)", border:activePreset.id===p.id?`1px solid ${p.glow}55`:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:"18px 16px", cursor:"pointer", textAlign:"left", transition:"all 0.3s" }}>
                <div style={{ fontSize:22, marginBottom:8 }}>{p.icon}</div>
                <div style={{ fontSize:15, fontWeight:700, marginBottom:4, background:`linear-gradient(135deg,${p.gradient[0]},${p.gradient[1]})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>{p.label}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{p.tag} · {p.hz}</div>
              </button>
            ))}
          </div>
        </div>

        {playing && (
          <div style={{ margin:"16px 24px 0" }}>
            <button onClick={()=>setScreen("player")} style={{ width:"100%", background:`linear-gradient(135deg,${preset.gradient[0]},${preset.gradient[1]})`, border:"none", color:"#fff", borderRadius:16, padding:"16px", fontSize:15, fontWeight:700, cursor:"pointer" }}>
              ▶ Now Playing: {preset.label} · {audioMode} ···
            </button>
          </div>
        )}
        <div style={{ height:48 }} />
      </div>
    </div>
  );

  /* ── PLAYER ─────────────────────────────────────────── */
  if (screen === "player") return (
    <div style={S.app}>
      <style>{css}</style>
      <div style={{ position:"fixed", inset:0, zIndex:0, background:`radial-gradient(ellipse 80% 60% at 50% -10%,${preset.bgAccent},transparent 70%),radial-gradient(ellipse 50% 30% at 80% 80%,${preset.gradient[1]}18,transparent)`, transition:"background 1.5s ease" }} />

      <div style={{ position:"relative", zIndex:1, minHeight:"100vh", display:"flex", flexDirection:"column" }}>

        <div style={{ ...S.header, paddingBottom:0 }}>
          <button onClick={()=>setScreen("home")} style={{...S.navBtn,fontSize:14}}>← Home</button>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:16, fontWeight:700, background:`linear-gradient(135deg,${preset.gradient[0]},${preset.gradient[1]})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>{preset.icon} {preset.label}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", textTransform:"uppercase" }}>{preset.tag} · {preset.hz}</div>
          </div>
          <button onClick={()=>setScreen("settings")} style={S.navBtn}>⚙</button>
        </div>

        {/* Orb */}
        <div style={{ position:"relative", height:250, margin:"8px 0" }}>
          <WaveOrb playing={playing} beatFreq={audioMode==="isochronic"?isoFreq:beatFreq} preset={preset} mode={audioMode} />
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center", pointerEvents:"none" }}>
            <div style={{ fontSize:30, fontWeight:800, letterSpacing:"-0.03em" }}>
              {audioMode==="isochronic" ? isoFreq.toFixed(1) : beatFreq.toFixed(1)}
            </div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.12em", textTransform:"uppercase" }}>Hz · {audioMode}</div>
          </div>
        </div>

        <div style={{ textAlign:"center", padding:"0 32px 10px", color:"rgba(255,255,255,0.4)", fontSize:12, lineHeight:1.6 }}>{preset.description}</div>

        {/* Mode pills */}
        <div style={{ display:"flex", gap:6, margin:"0 24px 12px", justifyContent:"center" }}>
          {AUDIO_MODES.map(m=>(
            <button key={m.id} onClick={()=>setAudioMode(m.id)} style={{ padding:"6px 14px", fontSize:11, fontWeight:700, background:audioMode===m.id?preset.glow+"33":"rgba(255,255,255,0.05)", border:audioMode===m.id?`1px solid ${preset.glow}77`:"1px solid rgba(255,255,255,0.07)", borderRadius:20, color:audioMode===m.id?preset.glow:"rgba(255,255,255,0.45)", cursor:"pointer", transition:"all 0.2s" }}>{m.label}</button>
          ))}
        </div>

        {/* Play */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}>
          <button onClick={togglePlay} style={{ width:72, height:72, borderRadius:"50%", background:playing?"rgba(255,255,255,0.08)":`linear-gradient(135deg,${preset.gradient[0]},${preset.gradient[1]})`, border:playing?`2px solid ${preset.glow}66`:"none", color:"#fff", fontSize:24, cursor:"pointer", boxShadow:playing?"none":`0 0 32px ${preset.glow}66`, transition:"all 0.4s cubic-bezier(0.34,1.56,0.64,1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {playing ? "⏸" : "▶"}
          </button>
        </div>

        {playing && timerMin > 0 && (
          <div style={{ textAlign:"center", marginBottom:10 }}>
            <span style={{ fontSize:13, color:preset.glow, fontVariantNumeric:"tabular-nums", fontWeight:600 }}>⏱ {fmt(timeLeft)} remaining</span>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:"flex", margin:"0 24px 12px", background:"rgba(255,255,255,0.05)", borderRadius:14, padding:4 }}>
          {["preset","manual"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{ flex:1, padding:"10px", fontSize:11, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", background:tab===t?"rgba(255,255,255,0.1)":"transparent", border:"none", color:tab===t?"#fff":"rgba(255,255,255,0.35)", borderRadius:10, cursor:"pointer", transition:"all 0.2s" }}>
              {t==="preset" ? "Presets" : "Manual"}
            </button>
          ))}
        </div>

        <div style={{ padding:"0 24px", flex:1, overflowY:"auto" }}>

          {tab === "preset" ? (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              {PRESETS.map(p=>(
                <button key={p.id} onClick={()=>selectPreset(p)} style={{ background:activePreset.id===p.id?`linear-gradient(135deg,${p.gradient[0]}44,${p.gradient[1]}44)`:"rgba(255,255,255,0.04)", border:activePreset.id===p.id?`1px solid ${p.glow}66`:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"12px 14px", cursor:"pointer", textAlign:"left", transition:"all 0.2s" }}>
                  <div style={{ fontSize:18, marginBottom:4 }}>{p.icon}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#fff" }}>{p.label}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{p.beatFreq} Hz</div>
                </button>
              ))}
            </div>
          ) : (
            <div>
              {/* Binaural controls */}
              {(audioMode==="binaural"||audioMode==="both") && (
                <div style={{ ...S.card, marginBottom:12 }}>
                  <div style={S.sectionLabel}>◈ Binaural Frequencies</div>
                  <Slider label="Left Ear"  value={leftFreq}  min={80} max={500} onChange={updateLeft}  unit=" Hz" color={preset.gradient[0]} />
                  <Slider label="Right Ear" value={rightFreq} min={80} max={500} onChange={updateRight} unit=" Hz" color={preset.gradient[1]} />
                  <div style={{ background:preset.bgAccent, border:`1px solid ${preset.glow}33`, borderRadius:10, padding:"10px 14px", textAlign:"center" }}>
                    <span style={{ fontSize:11, color:"rgba(255,255,255,0.45)" }}>Beat Frequency: </span>
                    <span style={{ fontSize:14, fontWeight:700, color:preset.glow }}>{beatFreq.toFixed(1)} Hz</span>
                  </div>
                </div>
              )}
              {/* Isochronic controls */}
              {(audioMode==="isochronic"||audioMode==="both") && (
                <div style={{ ...S.card, marginBottom:12 }}>
                  <div style={S.sectionLabel}>◉ Isochronic Pulse Rate</div>
                  <Slider label="Pulse Frequency" value={isoFreq} min={0.5} max={40} step={0.5} onChange={updateIso} unit=" Hz" color={preset.glow} />
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", lineHeight:1.6, marginTop:8 }}>
                    AM sine wave pulsing at {isoFreq.toFixed(1)} Hz. Works on speakers — no headphones required.
                  </div>
                </div>
              )}
            </div>
          )}

          <Slider label="Volume" value={volume} min={0} max={1} step={0.01} onChange={setVolume} color={preset.glow} />

          {/* Timer */}
          <div style={{ marginBottom:18 }}>
            <div style={S.sectionLabel}>Session Timer</div>
            <div style={{ display:"flex", gap:8 }}>
              {TIMERS.map(t=>(
                <button key={t} onClick={()=>{setTimerMin(t);if(t===0)setTimeLeft(0);}} style={{ flex:1, padding:"9px 4px", background:timerMin===t?preset.glow+"33":"rgba(255,255,255,0.05)", border:timerMin===t?`1px solid ${preset.glow}66`:"1px solid rgba(255,255,255,0.07)", borderRadius:10, color:timerMin===t?preset.glow:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:600, cursor:"pointer" }}>
                  {t===0 ? "∞" : `${t}m`}
                </button>
              ))}
            </div>
          </div>

          {/* Background sounds */}
          <div style={{ marginBottom:24 }}>
            <div style={S.sectionLabel}>Background Sound</div>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              {BG_SOUNDS.map(s=>(
                <button key={s.id} onClick={()=>setBgSound(s.id)} style={{ flex:1, padding:"10px 4px", background:bgSound===s.id?preset.glow+"33":"rgba(255,255,255,0.05)", border:bgSound===s.id?`1px solid ${preset.glow}66`:"1px solid rgba(255,255,255,0.07)", borderRadius:10, cursor:"pointer", textAlign:"center" }}>
                  <div style={{ fontSize:16, marginBottom:2 }}>{s.icon}</div>
                  <div style={{ fontSize:9, color:bgSound===s.id?preset.glow:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:"0.08em" }}>{s.label}</div>
                </button>
              ))}
            </div>
            {bgSound !== "none" && (
              <Slider label="BG Volume" value={bgVol} min={0} max={1} step={0.01} onChange={setBgVol} color="rgba(255,255,255,0.5)" />
            )}
          </div>
          <div style={{ height:48 }} />
        </div>
      </div>
    </div>
  );

  /* ── SETTINGS ───────────────────────────────────────── */
  return (
    <div style={S.app}>
      <style>{css}</style>
      <div style={{ position:"fixed", inset:0, zIndex:0, background:"radial-gradient(ellipse 60% 40% at 50% 0%,rgba(100,60,200,0.12),transparent)" }} />
      <div style={{ position:"relative", zIndex:1 }}>
        <div style={S.header}>
          <button onClick={()=>setScreen("home")} style={{...S.navBtn,fontSize:14}}>← Back</button>
          <span style={{ fontSize:17, fontWeight:700 }}>Settings</span>
          <div style={{ width:72 }} />
        </div>
        <div style={{ padding:"24px" }}>
          <div style={S.sectionLabel}>Your Stats</div>
          <div style={{ display:"flex", gap:10, marginBottom:24 }}>
            {[{label:"Day Streak",value:`${streak} 🔥`},{label:"Total Mins",value:`${totalMins} ⏱`},{label:"Sessions",value:"12"}].map(s=>(
              <div key={s.label} style={{ flex:1, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"14px 10px", textAlign:"center" }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.08em" }}>{s.label}</div>
                <div style={{ fontSize:18, fontWeight:700 }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={S.sectionLabel}>Audio Modes Explained</div>
          <div style={S.card}>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", lineHeight:1.8 }}>
              <b style={{color:"#fff"}}>Binaural Beats</b> — Two slightly different frequencies in each ear. Your brain perceives the difference as a phantom beat, gradually synchronising neural oscillations.<br/><br/>
              <b style={{color:"#fff"}}>Isochronic Tones</b> — A single carrier wave rapidly amplitude-modulated (switched on/off) at the target frequency. Creates sharp, distinct pulses. Works on speakers — no headphones required. Generally considered more potent than binaural beats.<br/><br/>
              <b style={{color:"#fff"}}>Both</b> — Combines both methods simultaneously for maximum brainwave entrainment.
            </div>
          </div>

          <div style={{...S.sectionLabel, marginTop:20}}>Safety</div>
          <div style={{ ...S.card, borderColor:"rgba(255,200,0,0.15)", background:"rgba(255,200,0,0.04)" }}>
            <div style={{ fontSize:12, color:"rgba(255,220,100,0.7)", lineHeight:1.7 }}>
              ⚠️ Not recommended for people with epilepsy or photosensitive conditions. Do not use while driving or operating machinery. Consult a doctor if you have neurological conditions.
            </div>
          </div>

          <div style={{ textAlign:"center", marginTop:32, color:"rgba(255,255,255,0.15)", fontSize:11 }}>NeuroBeat v2.0 · Web Audio API</div>
          <div style={{ height:48 }} />
        </div>
      </div>
    </div>
  );
}
