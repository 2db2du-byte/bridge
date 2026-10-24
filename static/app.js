// The Bridge — front end. Talks to server.py on 127.0.0.1:1701.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('bridge.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bridge.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const settings = { era: store.get('era', 'tng'), sound: store.get('sound', true), voice: store.get('voice', true) };

async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge': 'engage' }, body: JSON.stringify(body),
  };
  const r = await fetch(path, opt);
  return r.json();
}

/* ============================================================
   Viewscreen: a fragment shader on the GPU.
   Nebula (fractal noise), a warp starfield that streaks with speed,
   a turning planet with clouds and atmosphere, and a distant sun.
   ============================================================ */
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uWarp; uniform float uRed; uniform float uTos; uniform float uPlanet;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; mat2 r = mat2(.8,-.6,.6,.8);
  for (int i = 0; i < 6; i++){ v += a*noise(p); p = r*p*2.03 + 1.7; a *= .5; } return v; }

vec3 stars(vec2 uv){
  vec3 col = vec3(0.);
  float speed = .015 + uWarp*.55;
  vec2 rdir = normalize(uv + 1e-4);
  for (float i = 0.; i < 14.; i++){
    float z = fract(i/14. + uTime*speed);
    float scale = mix(30., .7, z);
    float fade = smoothstep(0., .35, z) * smoothstep(1., .82, z);
    vec2 p = uv*scale + i*453.2;
    vec2 id = floor(p); vec2 f = fract(p) - .5;
    float h = hash(id);
    if (h < .72) continue;
    vec2 off = vec2(hash(id+7.1), hash(id+3.3)) - .5;
    vec2 q = f - off*.7;
    float along = dot(q, rdir) / (1. + pow(uWarp, 1.6)*60.*z);
    float perp = dot(q, vec2(-rdir.y, rdir.x));
    float d = length(vec2(along, perp));
    float sz = .05*(.35+h)*pow(scale/30., .8);
    float s = smoothstep(sz, 0., d) + .25*smoothstep(sz*3., 0., d);
    vec3 tint = mix(vec3(.65,.8,1.), vec3(1.,.85,.65), hash(id+11.));
    col += tint * s * fade * (1.2 + uWarp*1.5);
  }
  return col;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - .5*uRes) / uRes.y;
  float t = uTime;

  // nebula, domain-warped fractal noise
  vec2 nq = uv*1.5 + vec2(t*.006, t*.002);
  float w = fbm(nq*1.3 + vec2(t*.015, -t*.01));
  float n = fbm(nq + w*1.4);
  float n2 = fbm(nq*2.2 - 3.1 + w);
  vec3 deep = mix(vec3(.01,.005,.03), vec3(.18,.05,.30), smoothstep(.25,.85,n));
  vec3 teal = vec3(.0,.22,.32) * pow(n2, 3.) * 2.6;
  vec3 rose = vec3(.40,.10,.18) * pow(smoothstep(.45,.9,n*n2*1.6), 2.);
  vec3 neb = deep + teal + rose;
  neb = mix(neb, neb.gbr*vec3(1.3,.8,.6), uTos*.6);
  vec3 col = neb * (1. - uWarp*.55);

  col += stars(uv);

  // distant sun with soft rays
  vec2 sp = vec2(.78, .34) - uv;
  float sd = length(sp);
  float rays = .5 + .5*sin(atan(sp.y, sp.x)*14. + t*.2);
  col += vec3(1.,.82,.6) * (.012/sd + .004*rays/sd) * (1. - uWarp) ;

  // planet
  vec2 pc = vec2(-.66, -.42); float R = .40;
  vec2 d = uv - pc; float r = length(d);
  vec3 L = normalize(vec3(.75, .55, .45));
  float vis = uPlanet;
  if (r < R) {
    float z = sqrt(R*R - r*r);
    vec3 nrm = normalize(vec3(d, z));
    float lon = atan(nrm.x, nrm.z) + t*.025;
    float lat = asin(nrm.y);
    float s = fbm(vec2(lon*1.6, lat*2.4)*1.8);
    vec3 ocean = mix(vec3(.02,.07,.22), vec3(.32,.10,.06), uTos);
    vec3 land = mix(mix(vec3(.18,.33,.14), vec3(.55,.45,.28), smoothstep(.55,.7,s)), vec3(.75,.35,.15), uTos);
    vec3 surf = mix(ocean, land, smoothstep(.47,.52,s));
    float cl = smoothstep(.52,.75, fbm(vec2(lon*2.4 + t*.04, lat*3.6)*1.6));
    float diff = max(dot(nrm, L), 0.);
    float night = smoothstep(.1, -.1, dot(nrm, L)) * smoothstep(.5, .56, s) * smoothstep(.62, .95, fbm(vec2(lon, lat)*38.)) * 1.4;
    vec3 pcol = mix(surf, vec3(1.), cl*.85) * (diff*1.15 + .03) + vec3(1.,.75,.4)*night;
    float rim = pow(1. - nrm.z, 3.);
    pcol += vec3(.3,.6,1.) * rim * (diff*.9 + .1);
    float spec = pow(max(dot(reflect(-L, nrm), vec3(0,0,1)), 0.), 30.) * (1. - step(.5, s)) * (1. - cl);
    pcol += vec3(.8,.9,1.) * spec * .6;
    float edge = smoothstep(R, R - .004, r);
    col = mix(col, pcol, edge * vis);
  }
  float lit = dot(normalize(d), normalize(L.xy))*.5 + .5;
  col += vec3(.25,.5,1.) * exp(-(r - R)*22.) * step(R*.985, r) * (lit*.9 + .1) * vis * .9;

  // red alert
  float pulse = .5 + .5*sin(t*4.);
  col = mix(col, col*vec3(1.5,.35,.3) + vec3(.22,0.,0.)*pulse, uRed);

  // vignette + tone map
  col *= 1. - .45*dot(uv*.65, uv*.65);
  col = 1. - exp(-col*1.5);
  gl_FragColor = vec4(col, 1.);
}`;

function makeScene(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) return fallbackScene(canvas);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uRes', 'uTime', 'uWarp', 'uRed', 'uTos', 'uPlanet'].map(n => [n, gl.getUniformLocation(prog, n)]));
  const state = { warp: .05, warpTarget: .05, red: 0, redTarget: 0, tos: 0, planet: 1, running: true, t0: performance.now() };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  function frame(now) {
    if (!state.running) return;
    resize();
    state.warp += (state.warpTarget - state.warp) * .025;
    state.red += (state.redTarget - state.red) * .05;
    state.tos += ((settings.era === 'tos' ? 1 : 0) - state.tos) * .05;
    state.planet += ((state.warp > .35 ? 0 : 1) - state.planet) * .03;
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, (now - state.t0) / 1000);
    gl.uniform1f(u.uWarp, state.warp); gl.uniform1f(u.uRed, state.red);
    gl.uniform1f(u.uTos, state.tos); gl.uniform1f(u.uPlanet, state.planet);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  state.resume = () => requestAnimationFrame(frame);
  return state;
}

function fallbackScene(canvas) {  // no WebGL: simple 2D stars so the screen is never blank
  const ctx = canvas.getContext('2d');
  const st = Array.from({ length: 300 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
  const state = { warp: .05, warpTarget: .05, red: 0, redTarget: 0, running: true };
  state.resume = () => requestAnimationFrame(frame);
  (function frame() {
    if (!state.running) return;
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    state.warp += (state.warpTarget - state.warp) * .03;
    ctx.fillStyle = state.redTarget ? '#200' : '#01030a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    for (const s of st) {
      s.z -= .002 + state.warp * .03; if (s.z <= .01) { s.z = 1; s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; }
      const k = 1 / s.z, x = cx + s.x * cx * k * .5, y = cy + s.y * cy * k * .5;
      ctx.fillStyle = `rgba(200,220,255,${1 - s.z})`; ctx.fillRect(x, y, 2, 2);
    }
    requestAnimationFrame(frame);
  })();
  return state;
}

/* ============================================================
   Sound: every beep is made right here (Web Audio), no sound files.
   ============================================================ */
let ac = null;
function audio() { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; }
function tone(freq, dur, { type = 'sine', vol = .12, at = 0, slide = 0 } = {}) {
  if (!settings.sound) return;
  const a = audio(), t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
}
const sfx = {
  chirp() { tone(1480, .07, { vol: .08 }); tone(1975, .09, { vol: .07, at: .07 }); },
  press() { tone(880, .05, { type: 'triangle', vol: .09 }); tone(1320, .08, { type: 'triangle', vol: .07, at: .05 }); },
  tick() { tone(2400, .025, { vol: .025 }); },
  deny() { tone(330, .18, { type: 'square', vol: .05 }); tone(247, .25, { type: 'square', vol: .05, at: .16 }); },
  log() { [988, 1319, 1760].forEach((f, i) => tone(f, .1, { vol: .07, at: i * .08 })); },
  klaxon(times = 3) { for (let i = 0; i < times; i++) tone(420, .62, { type: 'sawtooth', vol: .09, at: i * .82, slide: 2.1 }); },
  yellow() { tone(660, .3, { type: 'triangle', vol: .08 }); tone(660, .3, { type: 'triangle', vol: .08, at: .45 }); },
  warp() {
    if (!settings.sound) return;
    const a = audio(), t = a.currentTime, len = 2.4;
    const buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(120, t); f.frequency.exponentialRampToValueAtTime(3200, t + 1.1); f.frequency.exponentialRampToValueAtTime(300, t + len);
    const g = a.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.35, t + .9); g.gain.exponentialRampToValueAtTime(.001, t + len);
    src.connect(f).connect(g).connect(a.destination); src.start(t);
    tone(110, 1.6, { type: 'sine', vol: .2, slide: 4 }); tone(55, 2.2, { type: 'sine', vol: .18, at: .2, slide: 2 });
  },
};
function speak(text, voice = 'computer') { if (settings.voice) api('/api/speak', { text, voice }).catch(() => {}); }

/* ============================================================
   Decoration: LCARS number cascade, TOS blinking lights, clock
   ============================================================ */
function buildCascade() {
  const el = $('#cascade'); el.innerHTML = '';
  for (let i = 0; i < 4 * 34; i++) { const s = document.createElement('span'); s.textContent = rnd(); el.appendChild(s); }
  setInterval(() => {
    const kids = el.children;
    for (let k = 0; k < 6; k++) {
      const s = kids[Math.floor(Math.random() * kids.length)];
      s.textContent = rnd(); s.className = Math.random() < .2 ? 'hot' : Math.random() < .3 ? 'cool' : '';
    }
  }, 220);
  function rnd() { const n = [2, 3, 4, 5, 6][Math.floor(Math.random() * 5)]; return String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0'); }
}
function buildTosLights() {
  const colors = ['#e8402a', '#f2c230', '#49c46a', '#3c7be8', '#ffffff', '#e87a2a'];
  const el = $('#tos-lights');
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    s.style.setProperty('--l', colors[Math.floor(Math.random() * colors.length)]);
    s.style.setProperty('--d', (0.6 + Math.random() * 2.4).toFixed(2) + 's');
    el.appendChild(s);
  }
}
function stardate(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 1);
  const day = (d - start) / 864e5;
  return (1000 * (d.getFullYear() - 1946) + day / 365.25 * 1000).toFixed(1);
}
function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#stardate').textContent = $('#log-sd').textContent = stardate(d);
  const h = d.getHours();
  $('#greeting').textContent = (h < 5 ? 'BURNING THE MIDNIGHT OIL' : h < 12 ? 'GOOD MORNING' : h < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING') + ', CAPTAIN';
}

/* ============================================================
   Static stations: comms channels
   ============================================================ */
const COMMS = [
  ['🌐', 'HOMEPAGE', '2db2du-byte.github.io', 'https://2db2du-byte.github.io', 'c-orange'],
  ['🐙', 'GITHUB', '2db2du-byte', 'https://github.com/2db2du-byte', 'c-peach'],
  ['🤗', 'HUGGING FACE', 'RabbidRaccoon', 'https://huggingface.co/RabbidRaccoon', 'c-gold'],
  ['🦋', 'BLUESKY', 'rabbid-raccoon', 'https://bsky.app/profile/rabbid-raccoon.bsky.social', 'c-blue'],
  ['𝕏', 'X', 'IKAGTKAGRabbid', 'https://x.com/IKAGTKAGRabbid', 'c-peri'],
  ['🎵', 'TIKTOK', 'rabbidsraccoons', 'https://www.tiktok.com/@rabbidsraccoons', 'c-rose'],
  ['💬', 'DISCORD', 'RabbidsRaccoons', 'https://discord.com/users/1083894691541553223', 'c-lilac'],
  ['✍️', 'BLOG', 'dev.to/rabbidraccoon', 'https://dev.to/rabbidraccoon', 'c-tan'],
  ['🦙', 'OLLAMA', '2db2du', 'https://ollama.com/2db2du', 'c-orange'],
];
function buildComms() {
  $('#comms-list').innerHTML = COMMS.map(([ico, name, handle, url, c], i) =>
    `<a class="freq ${c}" href="${url}" target="_blank" rel="noopener"><span class="fq-ico">${ico}</span>` +
    `<span><b>${name}</b><small>${handle}</small></span><span class="fq-ch">CH ${String(i + 1).padStart(2, '0')}<br>${(1400 + i * 37.5).toFixed(1)} MHz</span></a>`).join('');
}

/* The officer who reports each station's alerts (Rabbid's TNG crew, 2026-10-21) */
const OFFICER = { ops: "Chief O'Brien", engineering: 'Mister La Forge', science: 'Mister Data', tactical: 'Mister Worf', security: 'Lieutenant Yar' };
const VOICE_OF = { ops: 'obrien', engineering: 'geordi', science: 'data', tactical: 'worf', security: 'yar' };
const TUTOR = { 'Learn Linux': 'ENSIGN CRUSHER', 'Learn Cybersecurity': 'LT. WORF' };

/* ============================================================
   Live readouts
   ============================================================ */
const GB = 1024 ** 3;
const fmtGB = b => (b / GB >= 1000 ? (b / GB / 1024).toFixed(1) + ' TB' : (b / GB).toFixed(0) + ' GB');
function bar(el, pct, warnAt = 75, badAt = 90) {
  el.style.width = Math.max(0, Math.min(100, pct)) + '%';
  el.className = pct >= badAt ? 'bad' : pct >= warnAt ? 'warn' : '';
}
function ago(ts) {
  if (!ts) return 'never';
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let scene = null, lastRedSig = '', ackedSig = '', lastYellowSig = '', firstStatus = true;

function render(st) {
  const e = st.engineering;
  $('#cpu-pct').textContent = e.cpu_pct.toFixed(0) + '%'; bar($('#cpu-bar'), e.cpu_pct, 80, 95);
  $('#cpu-temp').textContent = (e.cpu_temp ?? 0).toFixed(0) + '°C'; bar($('#cpu-temp-bar'), e.cpu_temp ?? 0, 80, 90);
  const ramUsed = e.ram_total - e.ram_avail, ramPct = 100 * ramUsed / e.ram_total;
  $('#ram').textContent = `${(ramUsed / GB).toFixed(1)} / ${(e.ram_total / GB).toFixed(0)} GB`; bar($('#ram-bar'), ramPct, 80, 92);
  let load = e.cpu_pct;
  if (e.gpu) {
    $('#gpu-name').textContent = e.gpu.name;
    $('#gpu-util').textContent = (e.gpu.util ?? 0).toFixed(0) + '%'; bar($('#gpu-bar'), e.gpu.util ?? 0, 101, 101);
    $('#gpu-temp').textContent = (e.gpu.temp ?? 0).toFixed(0) + '°C'; bar($('#gpu-temp-bar'), e.gpu.temp ?? 0, 75, 85);
    $('#vram').textContent = `${((e.gpu.mem_used ?? 0) / 1024).toFixed(1)} / ${((e.gpu.mem_total ?? 0) / 1024).toFixed(0)} GB`;
    bar($('#vram-bar'), 100 * (e.gpu.mem_used ?? 0) / (e.gpu.mem_total || 1), 85, 95);
    $('#gpu-power').textContent = (e.gpu.power ?? 0).toFixed(0) + ' W';
    load = Math.max(load, e.gpu.util ?? 0);
  }
  $('#uptime').textContent = e.uptime_h + ' H';
  const warp = 1 + load / 100 * 8;
  $('#warp-factor').textContent = warp.toFixed(1);
  $('#warp-core').style.setProperty('--speed', (2.6 - load / 100 * 2.1).toFixed(2) + 's');
  $('#warp-label').textContent = load < 20 ? 'FULL IMPULSE' : `WARP ${warp.toFixed(1)}`;
  if (scene && !scene.jumping) scene.warpTarget = .04 + Math.min(load, 100) / 100 * .5;

  // ops
  const b = st.ops.backup, light = $('#bk-light');
  if (b.running) { light.className = 'bk-light run'; $('#bk-main').textContent = 'BACKUP RUNNING…'; }
  else if (b.result === 'success') { light.className = 'bk-light ok'; $('#bk-main').textContent = 'ALL SAFE'; }
  else { light.className = 'bk-light bad'; $('#bk-main').textContent = 'BACKUP FAILED'; }
  $('#bk-sub').textContent = `Last: ${ago(b.last)} · Next: ${b.next ? new Date(b.next * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}`;
  $('#drives').innerHTML = st.drives.map(d => d.mounted
    ? `<div class="drive"><div class="d-lbl"><span>${esc(d.name)} <small>${esc(d.kind)}</small></span><b>${fmtGB(d.used)} / ${fmtGB(d.size)}</b></div><div class="m-bar"><i style="width:${d.pct}%" class="${d.pct >= 90 ? 'bad' : d.pct >= 80 ? 'warn' : ''}"></i></div></div>`
    : `<div class="drive"><div class="d-lbl"><span>${esc(d.name)} <small>${esc(d.kind)}</small></span><b style="color:#ff6b6b">NOT CONNECTED</b></div><div class="m-bar"><i class="bad" style="width:100%"></i></div></div>`).join('');

  // Claude usage (plan meter)
  const cu = st.claude;
  const resetIn = iso => {
    if (!iso) return '';
    const m = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
    return m < 60 ? `resets in ${m} min` : m < 1440 ? `resets in ${Math.floor(m / 60)} h ${m % 60} m` : `resets ${new Date(iso).toLocaleDateString([], { weekday: 'short' })}`;
  };
  for (const [k, id] of [['five_hour', 'five'], ['seven_day', 'week']]) {
    const u = cu && !cu.error ? cu[k] : null;
    $(`#u-${id}-pct`).textContent = u ? Math.round(u.pct) + '%' : '—';
    bar($(`#u-${id}`), u ? u.pct : 0, 75, 90);
    $(`#u-${id}-reset`).textContent = u ? (resetIn(u.resets_at) || 'fresh, not started') : (cu && cu.error ? cu.error : 'checking…');
  }

  // science
  $('#kiwix-dot').className = 'dot ' + (st.science.kiwix ? 'on' : 'off');
  $('#maps-dot').className = 'dot ' + (st.science.maps ? 'on' : 'off');
  $('#courses').innerHTML = st.science.courses.map(c => {
    const pct = c.total ? 100 * c.done / c.total : 0;
    return `<a class="course" href="${esc(c.link)}"><div class="c-top">${esc(c.name.toUpperCase())}<span>${c.done}/${c.total}</span></div>` +
      `<div class="m-bar c2"><i style="width:${pct}%"></i></div><div class="c-next"><b class="tutor">${TUTOR[c.name] || ''}</b> NEXT: ${esc(c.next || 'Course complete!')}</div></a>`;
  }).join('');

  // tactical
  const sh = st.tactical.shields;
  $('#shields').className = 'shields ' + sh;
  $('#shields-val').textContent = sh === 'up' ? 'SHIELDS UP' : sh === 'down' ? 'SHIELDS DOWN' : 'UNKNOWN';

  // orders
  const o = st.orders;
  $('#orders-date').textContent = o.title ? o.title.toUpperCase() : '';
  const shown = o.items, extra = 0;  // the left-column list scrolls, so show every order
  const ordersHtml = (shown.length ? shown.map(i =>
    `<li class="${i.done ? 'done' : ''}" title="${esc(i.detail)}"><b>${esc(i.title)}</b><small>${esc(i.detail)}</small></li>`).join('')
    : '<li><b>No orders logged</b><small>Ask Claude to add some to the to-do list.</small></li>')
    + (extra > 0 ? `<li class="more"><b>+ ${extra} MORE ORDER${extra > 1 ? 'S' : ''}</b><small>${esc(o.items.slice(shown.length).map(i => i.title).join(' · '))}</small></li>` : '');
  // only redraw when the orders change, so a scrolled list doesn't jump back to the top every refresh
  if ($('#orders').dataset.html !== ordersHtml) { $('#orders').innerHTML = ordersHtml; $('#orders').dataset.html = ordersHtml; }
  $('#todo-count').textContent = o.open;
  $('#inbox-count').textContent = o.inbox;
  $('#inbox').classList.toggle('has', o.inbox > 0);

  alerts(st.alerts);
  if (firstStatus) { firstStatus = false; }
}

function alerts(list) {
  const reds = list.filter(a => a.level === 'red'), yellows = list.filter(a => a.level === 'yellow');
  const level = reds.length ? 'red' : yellows.length ? 'yellow' : 'green';
  const badge = $('#cond-badge');
  badge.className = 'cond-badge ' + level;
  badge.textContent = { red: 'RED ALERT', yellow: 'YELLOW ALERT', green: 'CONDITION GREEN' }[level];
  const cl = $('#condition-line');
  cl.className = 'cond-line ' + level;
  cl.textContent = level === 'green' ? 'ALL SYSTEMS NOMINAL' : `${list.length} ${list.length === 1 ? 'ISSUE' : 'ISSUES'} · SEE CONDITION PANEL`;
  $('#alert-list').innerHTML = list.length ? list.map(a => `<li class="${a.level}"><small class="rep">${esc((OFFICER[a.station] || 'Computer').toUpperCase())}:</small> ${esc(a.msg)}</li>`).join('')
    : '<li>Backups, drives, temperatures and library all check out.</li>';
  for (const part of ['eng', 'ops', 'sci']) {
    const station = { eng: 'engineering', ops: 'ops', sci: 'science' }[part];
    const mine = list.filter(a => a.station === station);
    $('#msd-' + part).setAttribute('class', 'msd-part ' + (mine.some(a => a.level === 'red') ? 'bad' : mine.length ? 'warn' : ''));
  }
  document.body.classList.toggle('red-alert', !!reds.length);
  if (scene && !scene.drill) scene.redTarget = reds.length ? 1 : 0;

  const rsig = reds.map(a => a.msg).join('|');
  if (rsig && rsig !== lastRedSig && rsig !== ackedSig) showRedAlert(reds.map(a => `${OFFICER[a.station] || 'Computer'}: ${a.msg}`), false, reds[0]);
  lastRedSig = rsig;
  const ysig = yellows.map(a => a.msg).join('|');
  if (ysig && ysig !== lastYellowSig && engaged) { sfx.yellow(); speak('Yellow alert.'); speak(`${OFFICER[yellows[0].station] || 'Computer'} here. ${yellows[0].msg}`, VOICE_OF[yellows[0].station]); }
  lastYellowSig = ysig;
}

function showRedAlert(msgs, drill = false, first = null) {
  $('#ra-list').innerHTML = msgs.map(m => `<li>${esc(m)}</li>`).join('');
  $('#red-overlay').hidden = false;
  if (!engaged) return;
  sfx.klaxon(3);
  if (drill) { speak('Red alert. This is a drill.'); speak('Worf here. Battle stations, Captain. It is only a drill.', 'worf'); }
  else { speak('Red alert.'); if (first) speak(`${OFFICER[first.station] || 'Computer'} here. ${first.msg}`, VOICE_OF[first.station]); }
}

async function poll() {
  try { render(await api('/api/status')); }
  catch { $('#condition-line').textContent = 'LOST CONTACT WITH THE SHIP\'S COMPUTER'; }
}

/* ============================================================
   Controls
   ============================================================ */
let engaged = false;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

function applySettings() {
  document.body.classList.toggle('tos', settings.era === 'tos');
  document.body.classList.toggle('tng', settings.era !== 'tos');
  $('#sw-era').textContent = 'ERA: ' + settings.era.toUpperCase();
  $('#sw-sound').textContent = 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'); $('#sw-sound').classList.toggle('off', !settings.sound);
  $('#sw-voice').textContent = 'VOICE: ' + (settings.voice ? 'ON' : 'OFF'); $('#sw-voice').classList.toggle('off', !settings.voice);
}

function wire() {
  $$('#nav .pill').forEach(p => {
    p.addEventListener('mouseenter', sfx.tick);
    p.addEventListener('click', () => go(p.dataset.go, p));
  });
  document.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT') return;
    const n = parseInt(ev.key, 10);
    if (n >= 1 && n <= 9) { const p = $$('#nav .pill')[n - 1]; if (p) go(p.dataset.go, p); }
  });
  $$('[data-launch]').forEach(b => b.addEventListener('click', async () => {
    sfx.press();
    try { await api('/api/launch', { app: b.dataset.launch }); toast('Helm: course laid in for ' + $('b', b).textContent); }
    catch { sfx.deny(); toast('Helm not responding'); }
  }));
  $$('a.lk, a.freq, a.sci-tile, a.course, a.q-tile').forEach(a => a.addEventListener('click', sfx.press));
  // every web link on the Bridge opens in Firefox (Rabbid's browser) instead of the Chrome app window
  document.addEventListener('click', async ev => {
    const a = ev.target.closest('a[target="_blank"]');
    if (!a || !/^https?:/.test(a.href)) return;
    ev.preventDefault();
    const r = await api('/api/open', { url: a.href }).catch(() => null);
    if (r && r.ok) toast('Opening in Firefox'); else window.open(a.href, '_blank', 'noopener');
  });
  $('#backup-now').addEventListener('click', async () => {
    sfx.press(); await api('/api/backup', {}); toast('Ops: backup started'); setTimeout(poll, 1500);
  });
  $('#drill').addEventListener('click', () => {
    sfx.press(); scene.drill = true; scene.redTarget = 1; document.body.classList.add('red-alert');
    showRedAlert(['DRILL — this is only a test. All systems are fine.'], true);
  });
  $('#ra-ack').addEventListener('click', () => {
    sfx.chirp(); $('#red-overlay').hidden = true; ackedSig = lastRedSig;
    if (scene.drill) { scene.drill = false; scene.redTarget = 0; poll(); }
  });
  $('#log-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const inp = $('#log-input'), text = inp.value.trim();
    if (!text) { sfx.deny(); return; }
    const r = await api('/api/log', { text }).catch(() => ({}));
    if (r.ok) { sfx.log(); toast('Log entry recorded in your second brain'); inp.value = ''; }
    else { sfx.deny(); toast('Could not save the log entry'); }
  });
  $('#sw-era').addEventListener('click', () => {
    settings.era = settings.era === 'tos' ? 'tng' : 'tos'; store.set('era', settings.era); applySettings(); sfx.chirp();
    toast(settings.era === 'tos' ? 'Welcome to Kirk\'s bridge' : 'Welcome to Picard\'s bridge');
  });
  $('#sw-sound').addEventListener('click', () => { settings.sound = !settings.sound; store.set('sound', settings.sound); applySettings(); sfx.chirp(); });
  $('#sw-voice').addEventListener('click', () => { settings.voice = !settings.voice; store.set('voice', settings.voice); applySettings(); sfx.chirp(); });
}

function go(id, pill) {
  sfx.chirp();
  const el = document.getElementById(id); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const c = getComputedStyle($('.st-head', el)).getPropertyValue('--c');
  el.style.setProperty('--c', c);
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  if (pill) { pill.classList.remove('active'); void pill.offsetWidth; pill.classList.add('active'); }
}

function engage() {
  if (engaged) return;
  engaged = true;
  audio(); sfx.warp();
  const intro = engageScene;
  intro.warpTarget = 1;
  scene.jumping = true; scene.warp = 1; scene.warpTarget = 1;
  setTimeout(() => { $('#engage').classList.add('gone'); }, 900);
  setTimeout(() => { intro.running = false; scene.jumping = false; poll(); }, 2200);
  const cond = $('#cond-badge').textContent;
  setTimeout(() => speak(cond === 'CONDITION GREEN'
    ? 'Captain on the bridge. All systems are nominal.'
    : 'Captain on the bridge. ' + ($('#alert-list li')?.textContent || '')), 1600);
}

/* ============================================================
   ON SCREEN: the webcam on the main viewscreen (Rabbid 2026-10-21).
   Only runs while the button is on. Nothing is recorded or saved;
   the mic only drives the level meter (it is never played out loud).
   ============================================================ */
const cam = { stream: null, raf: 0 };
async function onScreen() {
  const btn = $('#onscreen');
  if (cam.stream) return offScreen();
  sfx.chirp();
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    sfx.deny();
    toast(e.name === 'NotAllowedError' ? 'Camera blocked: allow the camera and mic for the Bridge' : 'No camera found: is the webcam plugged in?');
    cam.stream = null; return;
  }
  const v = $('#cam');
  v.srcObject = cam.stream; v.hidden = false; $('#cam-hud').hidden = false;
  document.querySelector('.viewscreen').classList.add('on-screen');
  const vt = cam.stream.getVideoTracks()[0];
  $('#cam-src').textContent = vt ? vt.label.replace(/\s*\(.*\)$/, '').toUpperCase() : '';
  btn.textContent = 'OFF SCREEN'; btn.classList.add('live');
  if (scene) scene.running = false;  // pause the space shader while the camera is up
  speak('On screen.');
  const at = cam.stream.getAudioTracks()[0];
  if (at) {
    const a = audio(), an = a.createAnalyser(); an.fftSize = 512;
    a.createMediaStreamSource(cam.stream).connect(an);  // analyser only: never connected to the speakers
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0; for (const x of buf) peak = Math.max(peak, Math.abs(x - 128));
      $('#mic-level').style.width = Math.min(100, peak / 128 * 160) + '%';
      cam.raf = requestAnimationFrame(tick);
    };
    tick();
  }
}
function offScreen() {
  if (cam.stream) cam.stream.getTracks().forEach(tr => tr.stop());
  cam.stream = null; cancelAnimationFrame(cam.raf);
  const v = $('#cam'); v.srcObject = null; v.hidden = true; $('#cam-hud').hidden = true;
  document.querySelector('.viewscreen').classList.remove('on-screen');
  const btn = $('#onscreen'); btn.textContent = 'ON SCREEN'; btn.classList.remove('live');
  if (scene && !scene.running) { scene.running = true; scene.resume(); }
  sfx.chirp();
}

/* ============================================================
   Boot
   ============================================================ */
let engageScene;
applySettings();
buildCascade(); buildTosLights(); buildComms(); wire();
tickClock(); setInterval(tickClock, 1000);
scene = makeScene($('#stars'));
engageScene = makeScene($('#engage-stars')); engageScene.warpTarget = .12;
$('#engage-btn').addEventListener('click', engage);
$('#onscreen').addEventListener('click', onScreen);
/* Free AIs panel: Ten Forward, Vane and Open Notebook in a drawer on the left, one tab each. Ten Forward only runs
   on demand, so the first open starts it and waits for it; hiding just slides the drawer away. */
const AI_PAGES = { tenforward: 'http://127.0.0.1:3080/', vane: 'http://127.0.0.1:3005/', notebook: 'http://127.0.0.1:8502/' };
const ap = { tab: 'tenforward', loaded: {} };
function hideAIs() {
  const panel = $('#ai-panel');
  panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
}
async function showAI(name) {
  ap.tab = name;
  document.querySelectorAll('#ai-panel [data-ai]').forEach(el => el.classList.toggle('on', el.dataset.ai === name));
  const frame = $(`#ai-panel iframe[data-ai="${name}"]`);
  if (!ap.loaded[name]) {
    ap.loaded[name] = true;
    if (name === 'tenforward') {
      const r = await api('/api/freeai', { firefox: false }).catch(() => null);
      if (!r) { sfx.deny(); toast('Could not reach the ship\'s computer'); ap.loaded[name] = false; return; }
      if (!r.running) {
        toast('Starting Ten Forward… about 20 seconds');
        for (let i = 0; i < 40; i++) {
          await new Promise(res => setTimeout(res, 1000));
          const s = await api('/api/freeai/status').catch(() => null);
          if (s && s.running) break;
        }
      }
    }
    frame.src = AI_PAGES[name];
  }
  setTimeout(() => frame.focus(), 400);
}
async function toggleAIs() {
  const panel = $('#ai-panel');
  sfx.press();
  if (panel.classList.contains('open')) { hideAIs(); return; }
  panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
  if (!Object.keys(ap.loaded).length) speak('Mister Data here. Bringing the free A.I. systems online.', 'data');
  showAI(ap.tab);
}
$('#freeai').addEventListener('click', toggleAIs);
$('#ap-hide').addEventListener('click', hideAIs);
document.querySelectorAll('.ap-tabs [data-ai]').forEach(b => b.addEventListener('click', () => { sfx.press(); showAI(b.dataset.ai); }));
$('#ap-pop').addEventListener('click', async () => {
  sfx.press();
  const r = await api('/api/open', { url: AI_PAGES[ap.tab] }).catch(() => null);
  if (!r || !r.ok) { sfx.deny(); toast('Could not reach the ship\'s computer'); return; }
  hideAIs();
  toast('Opened in Firefox');
});
/* Claude panel: Claude Code in a drawer on the Bridge (ttyd + tmux behind server.py's lock). Hiding it
   only slides it away; Claude keeps running in tmux, so the same conversation is there next time. */
const cp = { loaded: false };
function hideClaude() {
  const panel = $('#claude-panel');
  panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
}
async function toggleClaude() {
  const panel = $('#claude-panel');
  sfx.press();
  if (panel.classList.contains('open')) { hideClaude(); return; }
  panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
  if (!cp.loaded) {
    toast('Hailing Commander Riker');
    const r = await api('/api/term/start', {}).catch(() => null);
    if (!r || !r.ok) { sfx.deny(); toast('Could not start the Claude panel'); hideClaude(); return; }
    $('#cp-frame').src = '/term/';
    cp.loaded = true;
    speak('Riker here. Standing by, Captain.', 'riker');
  }
  setTimeout(() => $('#cp-frame').focus(), 400);
}
$('#claude-btn').addEventListener('click', toggleClaude);
$('#cp-hide').addEventListener('click', hideClaude);
$('#cp-pop').addEventListener('click', async () => {
  sfx.press();
  const r = await api('/api/launch', { app: 'claude' }).catch(() => null);
  if (!r) { sfx.deny(); toast('Could not reach the ship\'s computer'); return; }
  hideClaude();
  toast('Same Claude, its own window');
});
/* YouTube on the right side of the main viewscreen (Rabbid 2026-10-22). Search goes through Rabbid's own SearXNG;
   videos play in YouTube's privacy-mode embed. FIREFOX hands the same video to his real YouTube account. */
const yt = { id: null, feed: 'subs', lists: {} };
const ytRecent = () => store.get('ytRecent', []);
function ytThumb(id) { return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; }
function ytShowList(videos, emptyMsg) {
  const list = $('#yt-list');
  list.replaceChildren();
  if (!videos.length) {
    const m = document.createElement('div'); m.className = 'yt-msg'; m.textContent = emptyMsg; list.append(m);
  }
  for (const v of videos) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'yt-item';
    const img = document.createElement('img'); img.src = ytThumb(v.id); img.alt = ''; img.loading = 'lazy';
    const t = document.createElement('span'); const tb = document.createElement('b'); tb.textContent = v.title;
    const sm = document.createElement('small'); sm.textContent = [v.author, v.length].filter(Boolean).join(' · ');
    t.append(tb, sm); b.append(img, t);
    b.addEventListener('click', () => ytPlay(v));
    list.append(b);
  }
  $('#yt-player').hidden = true; $('#yt-player').src = 'about:blank'; $('#yt-blocked').hidden = true;
  list.hidden = false; $('#yt-back').hidden = true; $('#yt-tabs').hidden = false;
}
// Feeds from Rabbid's own YouTube (through the Bridge server + his Firefox login), plus what he watched on the Bridge
async function ytFeed(name) {
  yt.feed = name;
  $$('#yt-tabs button').forEach(b => b.classList.toggle('on', b.dataset.feed === name));
  if (name === 'recent') { ytShowList(ytRecent(), 'Nothing watched on the Bridge yet.'); return; }
  if (name === 'search') { ytShowList(yt.last || [], 'No videos found.'); return; }
  ytShowList([], 'Tuning in to your YouTube…');
  const r = await api('/api/youtube/feed?name=' + name).catch(() => null);
  if (yt.feed !== name || yt.id) return;  // he moved on while it loaded
  if (!r || !r.ok) { ytShowList([], (r && r.error) || 'Could not reach the ship\'s computer'); return; }
  yt.lists[name] = r.videos;
  ytShowList(r.videos, 'Nothing here.');
}
$$('#yt-tabs button').forEach(b => b.addEventListener('click', () => { sfx.press(); ytFeed(b.dataset.feed); }));
function ytPlay(v) {
  sfx.press();
  yt.id = v.id;
  const p = $('#yt-player');
  p.src = `https://www.youtube.com/embed/${v.id}?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  $('#yt-blocked').hidden = true;
  p.hidden = false; $('#yt-list').hidden = true; $('#yt-back').hidden = false; $('#yt-tabs').hidden = true;
  if (v.title) store.set('ytRecent', [v, ...ytRecent().filter(r => r.id !== v.id)].slice(0, 12));
}
// Some owners block their videos from playing outside YouTube (error 101/150): play it on his real YouTube in a new
// Firefox tab right away (Rabbid 2026-10-22), and say so on the viewscreen
$('#yt-player').addEventListener('load', () => {
  const w = $('#yt-player').contentWindow;
  [300, 1500].forEach(ms => setTimeout(() => w && w.postMessage(JSON.stringify({ event: 'listening', id: 'bridge', channel: 'widget' }), '*'), ms));
});
window.addEventListener('message', ev => {
  if (!/^https:\/\/www\.youtube\.com$/.test(ev.origin) || typeof ev.data !== 'string') return;
  let d; try { d = JSON.parse(ev.data); } catch { return; }
  if (d.event !== 'onError' || !yt.id || yt.handedOff === yt.id) return;
  yt.handedOff = yt.id;
  $('#yt-player').src = 'about:blank';
  $('#yt-blocked').hidden = false;
  api('/api/open', { url: `https://www.youtube.com/watch?v=${yt.id}` })
    .then(r => toast(r && r.ok ? 'Locked to YouTube: playing it in Firefox' : 'Could not reach Firefox'))
    .catch(() => toast('Could not reach Firefox'));
});
function ytOpen() {
  sfx.chirp();
  $('#yt').hidden = false; document.querySelector('.viewscreen').classList.add('yt-on');
  if ($('#yt-player').hidden) ytFeed(yt.feed);
  setTimeout(() => $('#yt-q').focus(), 50);
}
function ytClose() {
  sfx.chirp();
  $('#yt-player').src = 'about:blank'; yt.id = null; $('#yt-blocked').hidden = true;
  $('#yt').hidden = true; document.querySelector('.viewscreen').classList.remove('yt-on');
}
$('#yt-open').addEventListener('click', ev => { ev.preventDefault(); $('#yt').hidden ? ytOpen() : $('#yt-q').focus(); });
$('#yt-close').addEventListener('click', ytClose);
const ytBackToList = () => { yt.id = null; const l = yt.feed === 'search' ? yt.last : yt.feed === 'recent' ? ytRecent() : yt.lists[yt.feed]; l ? ytShowList(l, 'Nothing here.') : ytFeed(yt.feed); };
$('#yt-back').addEventListener('click', () => { sfx.press(); ytBackToList(); });
$('#yt-blocked-ff').addEventListener('click', () => $('#yt-ff').click());
$('#yt-ff').addEventListener('click', async () => {
  sfx.press();
  const url = yt.id ? `https://www.youtube.com/watch?v=${yt.id}` : 'https://www.youtube.com/';
  if (yt.id) { $('#yt-player').src = 'about:blank'; ytBackToList(); }
  const r = await api('/api/open', { url }).catch(() => null);
  toast(r && r.ok ? 'Opening in Firefox' : 'Could not reach the ship\'s computer');
});
$('#yt-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const q = $('#yt-q').value.trim();
  if (!q) return;
  const link = q.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (link) { ytPlay({ id: link[1], title: '' }); return; }
  sfx.press();
  ytShowList([], 'Scanning subspace…');
  const r = await api('/api/youtube?q=' + encodeURIComponent(q)).catch(() => null);
  if (!r || !r.ok) { sfx.deny(); ytShowList([], 'Search is not answering (is the internet up?)'); return; }
  yt.last = r.videos;
  $('#yt-tabs [data-feed="search"]').hidden = false;
  ytFeed('search');
});
/* Deep Space Nine (Rabbid 2026-10-22): the Promenade. Every shop door opens one of his crew agents (the same agents
   as the `riker` command, ~/.claude/agents) in the crew drawer. Each keeps its own tmux session, so a conversation
   is still there the next time that door opens. */
const DOORS = [
  ['riker', 'OPS', 'COMMANDER RIKER', 'First officer · runs the crew', 'upper'],
  ['guinan', "QUARK'S BAR", 'GUINAN', 'Second brain · notes', 'upper'],
  ['barclay', 'HOLOSUITES', 'LT. BARCLAY', 'Web · Firefox · searches', 'upper'],
  ['troi', "GARAK'S TAILOR", 'COUNSELOR TROI', 'Public face · socials', 'upper'],
  ['data', 'BAJORAN ARCHIVES', 'LT. CMDR. DATA', 'Free AIs · offline library', 'upper'],
  ['q', 'CELESTIAL TEMPLE', 'Q', 'Creative studio · pictures, songs, video', 'upper'],
  ['worf', 'SECURITY OFFICE', 'LT. WORF', 'PC firewall · cyber school', 'lower'],
  ['yar', 'DOCKING RING', 'LT. YAR', 'House security · scam checks', 'lower'],
  ['crusher', 'INFIRMARY', 'DR. CRUSHER', 'Home lab apps', 'lower'],
  ['geordi', 'ENGINEERING', 'LT. CMDR. LA FORGE', 'Hardware · devices · network', 'lower'],
  ['obrien', 'CARGO BAY', "CHIEF O'BRIEN", 'Backups · drives', 'lower'],
  ['wesley', "KEIKO'S SCHOOL", 'ENSIGN CRUSHER', 'Linux tutor', 'lower'],
  ['ensign', 'REPLIMAT', 'THE ENSIGN', 'Any quick job', 'lower'],
];
const crew = { who: null };
sfx.door = () => { tone(180, .45, { type: 'sawtooth', vol: .035, slide: .45 }); tone(520, .3, { type: 'triangle', vol: .04, at: .04, slide: .5 }); };
function buildPromenade() {
  for (const [id, shop, who, role, level] of DOORS) {
    const b = document.createElement('button');
    b.className = 'shop'; b.dataset.crew = id; b.title = `${who}: ${role}`;
    b.innerHTML = `<div class="shop-sign"></div><div class="doorway"><div class="door-in"><b></b><small></small></div>` +
                  `<div class="leaf l"></div><div class="leaf r"></div></div><div class="shop-plate"></div>`;
    $('.shop-sign', b).textContent = shop;
    $('.door-in b', b).textContent = who; $('.door-in small', b).textContent = role;
    $('.shop-plate', b).textContent = who;
    b.addEventListener('click', () => openDoor(id));
    $(level === 'upper' ? '#ds9-upper' : '#ds9-lower').append(b);
  }
}
function showPromenade() { sfx.chirp(); $('#ds9').hidden = false; }
function hidePromenade() { sfx.chirp(); $('#ds9').hidden = true; hideCrew(); }
function hideCrew() {
  const panel = $('#crew-panel');
  panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
  $$('.shop').forEach(s => s.classList.remove('open', 'here'));
}
async function openDoor(id) {
  const [, shop, who] = DOORS.find(d => d[0] === id);
  const btn = $(`.shop[data-crew="${id}"]`);
  $$('.shop').forEach(s => s.classList.toggle('here', s === btn));
  $$('.shop.open').forEach(s => s !== btn && s.classList.remove('open'));
  btn.classList.add('open'); sfx.door();
  // every knock makes sure the crew service is up (cheap if it already is), so a stopped service never jams the doors
  const r = await api('/api/crew/start', {}).catch(() => null);
  if (!r || !r.ok) { sfx.deny(); toast('The Promenade doors are stuck (crew service did not start)'); btn.classList.remove('open'); return; }
  const title = $('#crew-title');
  title.firstChild.textContent = who + ' ';
  $('small', title).textContent = shop;
  $('#crew-frame').src = '/crew/?arg=' + encodeURIComponent(id);  // re-attach: tmux keeps the conversation
  crew.who = id;
  const panel = $('#crew-panel');
  setTimeout(() => { panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); $('#crew-frame').focus(); }, 450);
}
buildPromenade();
$('#ds9-btn').addEventListener('click', showPromenade);
$('#ds9-close').addEventListener('click', hidePromenade);
$('#crew-hide').addEventListener('click', () => { sfx.chirp(); hideCrew(); });
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || $('#ds9').hidden) return;
  $('#crew-panel').classList.contains('open') ? hideCrew() : hidePromenade();
});
$('#rollcall').addEventListener('click', () => { sfx.press(); if (!settings.voice) { toast('Turn VOICE on to hear the crew'); return; } api('/api/rollcall', {}); toast('Roll call: all officers, report'); });
window.addEventListener('pagehide', () => { if (cam.stream) offScreen(); });
document.addEventListener('keydown', ev => { if (!engaged && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); engage(); } });
poll(); setInterval(poll, 4000);
