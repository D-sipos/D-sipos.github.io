/* TILQE 3-gang interactive viewer, 2D orbit (azimuth + elevation).
   Pre-rendered Cycles frames stored as separate light passes; the page re-lights them live.
   Usage:  <div data-tilqe-viewer></div> <script src="tilqe-viewer/viewer.js"></script>
   Options (data attributes): data-zoom="1.25"  data-hint="Drag to rotate ..."  data-base="path/to/tilqe-viewer/" */
(function () {
  'use strict';
  var SCRIPT_BASE = ((document.currentScript && document.currentScript.src) || '').replace(/[^\/]*$/, '');

  var CSS = '.tqv{position:relative;aspect-ratio:4/5;overflow:hidden;background:#2f2e2c;border-radius:inherit;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}' +
    '.tqv>img,.tqv>canvas,.tqv>svg{position:absolute;inset:0;width:100%;height:100%;display:block}' +
    '.tqv>img{object-fit:cover}' +
    '.tqv>canvas{touch-action:pan-y;outline:none;opacity:0;transition:opacity .35s}' +
    '@media (pointer:fine){.tqv>canvas{touch-action:none}}' +
    '.tqv.tqv-live>canvas{opacity:1}' +
    '.tqv>canvas:focus-visible{box-shadow:inset 0 0 0 2px rgba(243,227,192,.7)}' +
    '.tqv>svg{pointer-events:none}' +
    '.tqv-ring{opacity:0;transition:opacity .25s}.tqv-ring.on{opacity:1}' +
    '.tqv-pulse{fill:none;stroke:rgba(255,244,220,.75);stroke-width:1.5;transform-box:fill-box;transform-origin:center;animation:tqvp 2.2s ease-out infinite}' +
    '.tqv-used .tqv-pulse{display:none}' +
    '@keyframes tqvp{0%{transform:scale(.55);opacity:0}25%{opacity:.9}100%{transform:scale(1.5);opacity:0}}' +
    '.tqv-hint{position:absolute;left:0;right:0;bottom:4.5%;text-align:center;font:500 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.06em;color:rgba(255,246,228,.72);pointer-events:none;transition:opacity .6s;padding:0 8px}' +
    '.tqv-used .tqv-hint{opacity:0}' +
    '.tqv-bar{position:absolute;left:0;bottom:0;height:2px;width:0;background:rgba(243,227,192,.55);transition:width .2s,opacity .6s}' +
    '.tqv-bar.done{opacity:0}' +
    '.tqv-tilt{position:absolute;right:10px;top:50%;transform:translateY(-50%);display:none;flex-direction:column;gap:8px}' +
    '@media (pointer:coarse){.tqv-tilt{display:flex}}' +
    '.tqv-tilt button{all:unset;box-sizing:border-box;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-size:13px;color:rgba(255,246,228,.9);background:rgba(20,18,14,.45);border:1px solid rgba(255,246,228,.28);cursor:pointer;touch-action:manipulation}' +
    '.tqv-tilt button:active{background:rgba(243,227,192,.35)}' +
    '@media (prefers-reduced-motion:reduce){.tqv-pulse{animation:none;opacity:.6}}';

  var VS = 'attribute vec2 aPos;uniform float uZoom;varying vec2 vUv;void main(){vUv=vec2(aPos.x,-aPos.y)*0.5/uZoom+0.5;gl_Position=vec4(aPos,0.0,1.0);}';
  var FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uA,uB,uC,uD,uLut;',
    'uniform float uState,uPerRow,uLK,uK;',
    'uniform vec4 uWt,uMaxv,uBw;',
    'uniform vec2 uRectA,uRectB,uRectC,uRectD,uFrame,uAtlas,uCell;',
    'uniform vec3 uLutP;',
    'vec3 dec(vec3 p,float m){return (exp(p*uLK)-1.0)*(m/uK);}',
    'vec3 shade(sampler2D t,vec2 rect){',
    '  vec2 px=vUv*uFrame;',
    '  vec2 pc=clamp(px,vec2(1.0),uFrame-1.0);',
    '  vec2 q=px-rect;',
    '  float e=min(min(q.x,uCell.x-q.x),min(q.y,uCell.y-q.y));',
    '  float m=smoothstep(3.0,9.0,e);',
    '  vec2 qc=clamp(q,vec2(1.0),uCell-1.0);',
    '  vec3 lin=vec3(0.0);',
    '  for(int k=0;k<4;k++){',
    '    float fk=float(k);',
    '    float row=floor(fk*0.5+0.01);float col=fk-row*2.0;',
    '    float mv=k==0?uMaxv.x:(k==1?uMaxv.y:(k==2?uMaxv.z:uMaxv.w));',
    '    float w=k==0?uWt.x:(k==1?uWt.y:(k==2?uWt.z:uWt.w));',
    '    vec3 v=dec(texture2D(t,(pc+vec2(col,row)*uFrame)/uAtlas).rgb,mv);',
    '    if(uState>0.5){',
    '      float n=(uState-1.0)*4.0+fk;',
    '      float r2=floor((n+0.5)/uPerRow);',
    '      vec2 o=vec2((n-r2*uPerRow)*uCell.x,2.0*uFrame.y+r2*uCell.y);',
    '      v=mix(v,dec(texture2D(t,(qc+o)/uAtlas).rgb,mv),m);',
    '    }',
    '    lin+=w*v;',
    '  }',
    '  return lin;',
    '}',
    'vec3 tm(vec3 x){',
    '  float n=uLutP.x;',
    '  vec3 t=clamp((log2(max(x,vec3(1e-10))/0.18)-uLutP.y)/uLutP.z,0.0,1.0);',
    '  float b=t.b*(n-1.0);float b0=floor(b);float b1=min(b0+1.0,n-1.0);',
    '  vec2 uv=vec2((0.5+t.r*(n-1.0))/(n*n),(0.5+t.g*(n-1.0))/n);',
    '  return mix(texture2D(uLut,uv+vec2(b0/n,0.0)).rgb,texture2D(uLut,uv+vec2(b1/n,0.0)).rgb,b-b0);',
    '}',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}',
    'void main(){',
    '  vec3 lin=vec3(0.0);',
    '  if(uBw.x>0.0)lin+=uBw.x*shade(uA,uRectA);',
    '  if(uBw.y>0.0)lin+=uBw.y*shade(uB,uRectB);',
    '  if(uBw.z>0.0)lin+=uBw.z*shade(uC,uRectC);',
    '  if(uBw.w>0.0)lin+=uBw.w*shade(uD,uRectD);',
    '  vec3 c=tm(lin)+(hash(gl_FragCoord.xy)-0.5)/255.0;',
    '  gl_FragColor=vec4(c,1.0);',
    '}'].join('\n');

  // load stages, coarse to fine: [azimuth stride, elevation stride] in grid nodes (the home node is in every stage)
  var STAGES = [[16, 4], [8, 2], [4, 1], [2, 1], [1, 1]];

  function mount(el, opts) {
    opts = opts || {};
    var base = opts.base || el.getAttribute('data-base') || SCRIPT_BASE;
    var zoom = parseFloat(opts.zoom || el.getAttribute('data-zoom') || '1') || 1;
    var hintText = opts.hint || el.getAttribute('data-hint') || 'Drag to rotate · press the switches · turn the dimmer';
    if (!document.getElementById('tqv-css')) {
      var st = document.createElement('style'); st.id = 'tqv-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    el.classList.add('tqv');
    el.innerHTML = '<img alt="" src="' + base + 'poster.webp"><canvas tabindex="0" role="img" aria-label="TILQE 3-gang brass plate with dimmer, double switch and socket. Drag or use the arrow keys to rotate; keys 1 and 2 press the switches; plus and minus turn the dimmer."></canvas>' +
      '<svg xmlns="http://www.w3.org/2000/svg"><g class="tqv-g"><circle class="tqv-pulse"/><circle class="tqv-pulse"/><circle class="tqv-pulse"/>' +
      '<g class="tqv-ring"><path fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2.4" stroke-linecap="round"/><path fill="none" stroke="#f6e7c6" stroke-width="2.4" stroke-linecap="round"/>' +
      '<text text-anchor="middle" fill="#f6e7c6" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="13" font-weight="600"></text></g></g></svg>' +
      '<div class="tqv-hint"></div><div class="tqv-bar"></div>' +
      '<div class="tqv-tilt"><button type="button" data-d="1" aria-label="Look from higher up">&#9650;</button><button type="button" data-d="-1" aria-label="Look from lower down">&#9660;</button></div>';
    var canvas = el.querySelector('canvas'), svg = el.querySelector('svg'), gEl = el.querySelector('.tqv-g');
    var pulses = el.querySelectorAll('.tqv-pulse'), ring = el.querySelector('.tqv-ring');
    var ringBg = ring.children[0], ringFg = ring.children[1], ringTx = ring.children[2];
    var bar = el.querySelector('.tqv-bar');
    el.querySelector('.tqv-hint').textContent = hintText;
    if (zoom !== 1) el.querySelector('img').style.transform = 'scale(' + zoom + ')';

    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' }) || canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) return;
    var man = null, prog = null, U = {}, lutTex = null;
    var NX = 0, NY = 0, HX = 0, HY = 0, AXs = [], AEs = [], avail = {};
    var blobs = {}, nstate = {}, queue = [], active = 0, bGot = 0, bTot = 0, sched = -1, pendStage = -1;
    var texCache = {}, decoding = {}, nDecoding = 0, clock = 0, freeTex = [], lastSet = [];
    var px = 0, py = 0, tx = 0, ty = 0, vx = 0, vy = 0, holdT = 0, dragging = false, settle = null;   // position and target in grid nodes (x: azimuth, y: elevation)
    var MAXA = 0.1, MAXE = 0.067;     // fastest the picture may turn: nodes per millisecond (about 200 degrees per second)
    var sw = [1, 1], dim = 1, lastDim = 1;      // targets
    var cur = [1, 1, 1];                         // animated: dimmer, L, R
    var raf = 0, lastT = 0, ringUntil = 0, hoverKnob = false, started = false, live = false;
    var MAXTEX = 20, csW = 0, ovI = -1, ovInit = false;
    var LET = 'ABCD';

    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function initGL() {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['uA', 'uB', 'uC', 'uD', 'uLut', 'uState', 'uPerRow', 'uLK', 'uK', 'uWt', 'uMaxv', 'uBw', 'uRectA', 'uRectB', 'uRectC', 'uRectD', 'uFrame', 'uAtlas', 'uCell', 'uLutP', 'uZoom'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      gl.uniform1i(U.uA, 0); gl.uniform1i(U.uB, 1); gl.uniform1i(U.uC, 2); gl.uniform1i(U.uD, 3); gl.uniform1i(U.uLut, 4);
      gl.uniform1f(U.uZoom, zoom);
      gl.uniform2f(U.uFrame, man.w, man.h); gl.uniform2f(U.uAtlas, man.atlas[0], man.atlas[1]);
      gl.uniform2f(U.uCell, man.patch.cw, man.patch.ch); gl.uniform1f(U.uPerRow, man.patch.perRow);
      gl.uniform1f(U.uK, man.k); gl.uniform1f(U.uLK, Math.log(1 + man.k));
      gl.uniform4f(U.uMaxv, man.maxv[0], man.maxv[1], man.maxv[2], man.maxv[3]);
      gl.uniform3f(U.uLutP, man.lut.n, man.lut.lo, man.lut.range);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    }
    function makeTex(src, reuse) {
      var t = reuse && freeTex.length ? freeTex.pop() : null;
      if (t) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src); return t; }
      t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return t;
    }
    function decodeBlob(blob) {
      if (window.createImageBitmap) {
        return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(function () { return createImageBitmap(blob); });
      }
      return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = URL.createObjectURL(blob); });
    }
    function wantTex(n) {
      if (texCache[n]) { texCache[n].t = ++clock; return texCache[n].tex; }
      if (!decoding[n] && blobs[n] && nDecoding < 5) {
        decoding[n] = true; nDecoding++;
        decodeBlob(blobs[n]).then(function (bm) {
          delete decoding[n]; nDecoding--;
          if (gl.isContextLost()) return;
          texCache[n] = { tex: makeTex(bm, true), t: ++clock };
          if (bm.close) bm.close();
          evict(); kick();
        }, function () { delete decoding[n]; nDecoding--; });
      }
      return null;
    }
    function evict() {
      var keys = Object.keys(texCache);
      if (keys.length <= MAXTEX) return;
      keys.sort(function (a, b) { return texCache[a].t - texCache[b].t; });
      for (var j = 0; j < keys.length - MAXTEX; j++) {
        var k = +keys[j];
        if (lastSet.indexOf(k) >= 0) continue;
        if (freeTex.length < 3) freeTex.push(texCache[k].tex); else gl.deleteTexture(texCache[k].tex);
        delete texCache[k];
      }
    }

    // ---------- the grid: azimuth nodes 0..NX-1 (2 deg), elevation nodes 0..NY-1 (3 deg) ----------
    function axisSet(len, home, s) {
      var o = [];
      for (var j = 0; j < len; j++) if ((((j - home) % s) + s) % s === 0 || j === 0 || j === len - 1) o.push(j);
      return o;
    }
    function bracket(arr, v) {
      var lo = arr[0], hi = arr[arr.length - 1];
      for (var j = 0; j < arr.length; j++) { var f = arr[j]; if (f <= v) lo = f; if (f >= v) { hi = f; break; } }
      return [lo, hi];
    }
    // the four surrounding nodes at the finest stage whose nodes are all there (fetched, or decoded when needTex)
    function find(x, y, needTex) {
      for (var s = STAGES.length - 1; s >= 0; s--) {
        var a = bracket(AXs[s], x), e = bracket(AEs[s], y);
        var ns = [e[0] * NX + a[0], e[0] * NX + a[1], e[1] * NX + a[0], e[1] * NX + a[1]], ok = true;
        for (var j = 0; j < 4; j++) if (!(needTex ? texCache[ns[j]] : blobs[ns[j]])) { ok = false; break; }
        if (ok) return { n: ns, wx: a[1] > a[0] ? (x - a[0]) / (a[1] - a[0]) : 0, wy: e[1] > e[0] ? (y - e[0]) / (e[1] - e[0]) : 0 };
      }
      return null;
    }
    function ready(x, y) {
      var w = find(x, y, false);
      if (!w) return true;
      var ok = true;
      for (var j = 0; j < 4; j++) if (!wantTex(w.n[j])) ok = false;
      return ok;
    }
    function weights() {
      var c = [cur[0] * cur[0], cur[1], cur[2]], m = 0.5;   // m: how much each control also dims the shared light
      var mean = (c[0] + c[1] + c[2]) / 3;
      var w = [1 + 1.6 * (1 - mean) * (1 - mean)];
      for (var j = 0; j < 3; j++) w.push((1 - m) * c[j] + m * mean);
      return w;
    }
    function stateIndex() { return sw[0] && sw[1] ? 0 : (sw[0] ? 1 : (sw[1] ? 2 : 3)); }
    function resize() {
      if (!csW) csW = canvas.getBoundingClientRect().width || man.w;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      // never below the visible source pixels (no minification), never above the source size (nothing to gain)
      var w = Math.max(Math.round(man.w / zoom), Math.min(Math.round(csW * dpr), man.w));
      var h = Math.round(w * man.h / man.w);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    function bumpAround(x, y) {
      var x0 = Math.floor(x), x1 = Math.ceil(x), y0 = Math.floor(y), y1 = Math.ceil(y);
      bump(y0 * NX + x0); bump(y0 * NX + x1); bump(y1 * NX + x0); bump(y1 * NX + x1);
    }
    function draw() {
      if (!prog || gl.isContextLost()) return;
      bumpAround(px, py);
      var want = find(px, py, false), set = null, j;
      if (want) { var all = true; for (j = 0; j < 4; j++) if (!wantTex(want.n[j])) all = false; if (all) set = want; }
      if (!set) set = find(px, py, true);
      if (!set) {                                      // show the closest node we already have instead of freezing
        var nc = -1, bd = 1e9;
        for (var kk in texCache) { var n = +kk, d = Math.hypot((n % NX) - px, (Math.floor(n / NX) - py) * 1.5); if (d < bd) { bd = d; nc = n; } }
        if (nc >= 0) set = { n: [nc, nc, nc, nc], wx: 0, wy: 0 };
      }
      if (!set) return;
      lastSet = set.n;
      // fetch and decode ahead, along the way to the target
      var ddx = tx - px, ddy = ty - py, dl = Math.hypot(ddx, ddy);
      if (dl > 0.01) {
        var steps = Math.min(6, Math.ceil(dl));
        for (var s = 1; s <= steps; s++) {
          var qx = px + ddx * s / steps, qy = py + ddy * s / steps;
          bumpAround(qx, qy);
          if (s <= 3) { var q = find(qx, qy, false); if (q) for (j = 0; j < 4; j++) wantTex(q.n[j]); }
        }
      }
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      for (j = 0; j < 4; j++) { gl.activeTexture(gl.TEXTURE0 + j); gl.bindTexture(gl.TEXTURE_2D, texCache[set.n[j]].tex); }
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, lutTex);
      var bw = [(1 - set.wx) * (1 - set.wy), set.wx * (1 - set.wy), (1 - set.wx) * set.wy, set.wx * set.wy], sum = 0;
      for (j = 0; j < 4; j++) { if (bw[j] < 0.003) bw[j] = 0; sum += bw[j]; }
      for (j = 0; j < 4; j++) bw[j] /= sum;
      var w = weights(), R = man.patch.rects;
      gl.uniform4f(U.uWt, w[0], w[1], w[2], w[3]);
      gl.uniform4f(U.uBw, bw[0], bw[1], bw[2], bw[3]);
      gl.uniform1f(U.uState, stateIndex());
      for (j = 0; j < 4; j++) gl.uniform2f(U['uRect' + LET.charAt(j)], R[set.n[j]][0], R[set.n[j]][1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!live) { live = true; el.classList.add('tqv-live'); }
      overlay();
    }
    function gi() { return clamp(Math.round(py), 0, NY - 1) * NX + clamp(Math.round(px), 0, NX - 1); }
    function arc(cx, cy, r, a0, a1) {
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      return 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + 'A' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1);
    }
    function overlay() {
      var i = gi(), g = man.geom, k = g.knob[i], W = man.w, H = man.h;
      if (!ovInit) {
        ovInit = true;
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        gEl.setAttribute('transform', 'translate(' + W / 2 + ' ' + H / 2 + ') scale(' + zoom + ') translate(' + (-W / 2) + ' ' + (-H / 2) + ')');
      }
      var kx = k[0] * W, ky = k[1] * H, kr = k[4] * H;
      if (i !== ovI && !el.classList.contains('tqv-used')) {
        ovI = i;
        var pts = [[kx, ky, kr + 9]];
        ['capL', 'capR'].forEach(function (n) { var c = g[n][i]; pts.push([(c[0] + c[2] + c[4] + c[6]) / 4 * W, (c[1] + c[3] + c[5] + c[7]) / 4 * H, 13]); });
        for (var j = 0; j < 3; j++) { pulses[j].setAttribute('cx', pts[j][0].toFixed(1)); pulses[j].setAttribute('cy', pts[j][1].toFixed(1)); pulses[j].setAttribute('r', pts[j][2]); pulses[j].style.animationDelay = (j * 0.35) + 's'; }
      }
      var show = hoverKnob || mode === 'knob' || performance.now() < ringUntil;
      ring.classList.toggle('on', show);
      if (show) {
        var r = kr + 8, a0 = Math.PI * 0.75, span = Math.PI * 1.5;
        ringBg.setAttribute('d', arc(kx, ky, r, a0, a0 + span));
        ringFg.setAttribute('d', dim > 0.004 ? arc(kx, ky, r, a0, a0 + span * dim) : '');
        ringTx.setAttribute('x', kx.toFixed(1)); ringTx.setAttribute('y', (ky + r + 17).toFixed(1));
        ringTx.textContent = Math.round(dim * 100) + '%';
      }
    }
    function tick(t) {
      raf = 0;
      var dt = Math.min(50, t - (lastT || t)); lastT = t;
      var busy = false;
      if (!dragging) {
        if (Math.abs(vx) > 0.002 || Math.abs(vy) > 0.003) {
          tx += vx * dt; ty += vy * dt; var dk = Math.exp(-dt / 300); vx *= dk; vy *= dk; busy = true;
          if (tx < 0) { tx = 0; vx = 0; } if (tx > NX - 1) { tx = NX - 1; vx = 0; }
          if (ty < 0) { ty = 0; vy = 0; } if (ty > NY - 1) { ty = NY - 1; vy = 0; }
          settle = null;
        } else {
          vx = vy = 0;
          if (settle === null) settle = [Math.round(tx), Math.round(ty)];
          tx = settle[0]; ty = settle[1];
        }
      }
      // the picture glides after the target at a limited speed and only moves on once the next frames are ready,
      // so the motion stays continuous even when the decoding cannot keep up with a fast drag
      var dx = tx - px, dy = ty - py;
      if (Math.abs(dx) > 0.003 || Math.abs(dy) > 0.003) {
        var kf = 1 - Math.exp(-dt / (dragging ? 7 : 45)), sx = dx * kf, sy = dy * kf, mx = MAXA * dt, my = MAXE * dt;
        sx = sx > mx ? mx : sx < -mx ? -mx : sx; sy = sy > my ? my : sy < -my ? -my : sy;
        if (!dt) { sx = 0; sy = 0; }
        var nx = px + sx, ny = py + sy;
        if (ready(nx, ny) || (holdT += dt) > 35) { px = nx; py = ny; holdT = 0; }
        busy = true;
      } else { px = tx; py = ty; }
      var tg = [dim, sw[0], sw[1]];
      for (var j = 0; j < 3; j++) {
        var e = tg[j] - cur[j];
        if (Math.abs(e) > 0.002) { cur[j] += e * (1 - Math.exp(-dt / (j === 0 ? 70 : 150))); busy = true; } else cur[j] = tg[j];
      }
      draw();
      if (performance.now() < ringUntil) busy = true;
      if (busy || dragging || nDecoding > 0) kick(); else lastT = 0;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    // ---------- interaction ----------
    var mode = null, pid = null, sx0 = 0, sy0 = 0, sPx = 0, sPy = 0, sDim = 0, moved = 0, pend = null, lastX = 0, lastY = 0, lastMT = 0;
    function toFrame(ev) {
      var r = canvas.getBoundingClientRect();
      return [(((ev.clientX - r.left) / r.width - 0.5) / zoom + 0.5) * man.w, (((ev.clientY - r.top) / r.height - 0.5) / zoom + 0.5) * man.h, r.width];
    }
    function inQuad(c, x, y) {
      var sign = 0;
      for (var j = 0; j < 4; j++) {
        var x0 = c[j * 2] * man.w, y0 = c[j * 2 + 1] * man.h, x1 = c[(j * 2 + 2) % 8] * man.w, y1 = c[(j * 2 + 3) % 8] * man.h;
        var cr = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
        if (Math.abs(cr) < 1e-9) continue;
        if (sign === 0) sign = cr > 0 ? 1 : -1; else if ((cr > 0 ? 1 : -1) !== sign) return false;
      }
      return true;
    }
    function hit(ev) {
      var p = toFrame(ev), i = gi(), g = man.geom, k = g.knob[i];
      var ax = k[0] * man.w, ay = k[1] * man.h, bx = k[2] * man.w, by = k[3] * man.h;
      var vx2 = bx - ax, vy2 = by - ay, l2 = vx2 * vx2 + vy2 * vy2, tt = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * vx2 + (p[1] - ay) * vy2) / l2)) : 0;
      var dx = p[0] - ax - tt * vx2, dy = p[1] - ay - tt * vy2, pad = Math.max(k[4] * man.h + 5, 16 * man.w / p[2] / zoom);
      if (dx * dx + dy * dy < pad * pad) return 'knob';
      if (inQuad(g.capL[i], p[0], p[1])) return 'L';
      if (inQuad(g.capR[i], p[0], p[1])) return 'R';
      return null;
    }
    function used() { el.classList.add('tqv-used'); }
    function toggle(side) { var j = side === 'L' ? 0 : 1; sw[j] = sw[j] ? 0 : 1; used(); kick(); }
    function setDim(v) { dim = Math.max(0, Math.min(1, v)); ringUntil = performance.now() + 1400; used(); kick(); }
    function step(dxn, dyn) { settle = [clamp(Math.round(tx) + dxn, 0, NX - 1), clamp(Math.round(ty) + dyn, 0, NY - 1)]; vx = vy = 0; used(); kick(); }
    function engage() { want(4); }
    canvas.addEventListener('pointerdown', function (ev) {
      if (!man || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      engage();
      pid = ev.pointerId; try { canvas.setPointerCapture(pid); } catch (e) {}
      sx0 = lastX = ev.clientX; sy0 = lastY = ev.clientY; sPx = px; sPy = py; sDim = dim; moved = 0; lastMT = ev.timeStamp;
      var h = hit(ev);
      if (h === 'knob') mode = 'knob';
      else { mode = 'rotate'; pend = h; dragging = true; vx = vy = 0; settle = null; tx = px; ty = py; }
      canvas.style.cursor = mode === 'knob' ? 'ew-resize' : 'grabbing';
      kick();
    });
    canvas.addEventListener('pointerenter', function () { if (man) engage(); });
    canvas.addEventListener('pointermove', function (ev) {
      if (!man) return;
      if (mode === null) {
        var h = hit(ev), hk = h === 'knob';
        canvas.style.cursor = hk ? 'ew-resize' : (h ? 'pointer' : 'grab');
        if (hk !== hoverKnob) { hoverKnob = hk; kick(); }
        return;
      }
      if (ev.pointerId !== pid) return;
      var dx = ev.clientX - sx0, dy = ev.clientY - sy0, w = csW || canvas.getBoundingClientRect().width;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (mode === 'knob') { if (moved > 4) setDim(sDim + (dx - dy) / 150); }
      else {
        if (moved > 6) { pend = null; used(); }
        // the same angular speed on both axes; dragging down brings the camera up
        var ax = (NX - 1) / (w * 1.5), ay = ax * (man.azStep / man.elStep);
        tx = clamp(sPx - dx * ax, 0, NX - 1); ty = clamp(sPy + dy * ay, 0, NY - 1);
        var dtm = Math.max(1, ev.timeStamp - lastMT);
        vx = 0.6 * vx + 0.4 * (-(ev.clientX - lastX) * ax / dtm);
        vy = 0.6 * vy + 0.4 * ((ev.clientY - lastY) * ay / dtm);
        lastX = ev.clientX; lastY = ev.clientY; lastMT = ev.timeStamp;
      }
      kick();
    });
    function up(ev) {
      if (ev.pointerId !== pid || mode === null) return;
      if (ev.type === 'pointerup') {
        if (mode === 'knob' && moved <= 4) { if (dim > 0.02) { lastDim = dim; setDim(0); } else setDim(lastDim > 0.05 ? lastDim : 1); }
        if (mode === 'rotate' && pend && moved <= 6) toggle(pend);
      }
      if (mode === 'rotate' && (moved <= 6 || ev.timeStamp - lastMT > 90)) { vx = 0; vy = 0; }
      mode = null; dragging = false; pend = null; pid = null; canvas.style.cursor = 'grab'; kick();
    }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', function () { hoverKnob = false; kick(); });
    canvas.addEventListener('keydown', function (ev) {
      if (!man) return;
      var k = ev.key, ok = true;
      engage();
      if (k === 'ArrowLeft') step(-2, 0);
      else if (k === 'ArrowRight') step(2, 0);
      else if (k === 'ArrowUp') step(0, 1);
      else if (k === 'ArrowDown') step(0, -1);
      else if (k === '+' || k === '=' || k === 'PageUp') setDim(dim + 0.1);
      else if (k === '-' || k === '_' || k === 'PageDown') setDim(dim - 0.1);
      else if (k === '1') toggle('L'); else if (k === '2') toggle('R');
      else ok = false;
      if (ok) { ev.preventDefault(); kick(); }
    });
    Array.prototype.forEach.call(el.querySelectorAll('.tqv-tilt button'), function (b) {
      b.addEventListener('click', function () { if (man) { engage(); step(0, +b.getAttribute('data-d')); } });
    });
    canvas.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); texCache = {}; freeTex = []; lastSet = []; prog = null; });
    canvas.addEventListener('webglcontextrestored', function () { boot(); });
    if (window.ResizeObserver) new ResizeObserver(function () { csW = 0; if (man) kick(); }).observe(el);
    else window.addEventListener('resize', function () { csW = 0; if (man) kick(); });

    // ---------- loading ----------
    function stageNodes(s) {
      var have = {}, out = [], a, e;
      if (s > 0) for (e = 0; e < AEs[s - 1].length; e++) for (a = 0; a < AXs[s - 1].length; a++) have[AEs[s - 1][e] * NX + AXs[s - 1][a]] = 1;
      for (e = 0; e < AEs[s].length; e++) for (a = 0; a < AXs[s].length; a++) {
        var n = AEs[s][e] * NX + AXs[s][a];
        if (!have[n] && avail[n]) out.push(n);
      }
      out.sort(function (m, n) {
        return Math.hypot(((m % NX) - HX) * 2, (Math.floor(m / NX) - HY) * 3) - Math.hypot(((n % NX) - HX) * 2, (Math.floor(n / NX) - HY) * 3);
      });
      return out;
    }
    function updBar() { bar.style.width = (100 * bGot / Math.max(1, bTot)) + '%'; bar.classList.toggle('done', bGot >= bTot); }
    function pump() {
      while (active < 4 && queue.length) {
        var n = queue.shift();
        if (nstate[n] >= 2) continue;
        (function (n) {
          nstate[n] = 2; active++;
          var ky = Math.floor(n / NX), ix = n - ky * NX;
          fetch(base + 'frames/f_k' + ky + '_i' + ('00' + ix * 2).slice(-3) + '.webp').then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (b) {
            blobs[n] = b; nstate[n] = 3;
          }).catch(function () { nstate[n] = 4; }).then(function () {
            active--; bGot++; updBar(); kick(); pump();
          });
        })(n);
      }
    }
    function bump(n) {                                  // a node is needed right now: it goes to the front of the queue
      if (!avail[n] || nstate[n] >= 2) return;
      var q = queue.indexOf(n);
      if (q === 0) { pump(); return; }
      if (q > 0) queue.splice(q, 1); else bTot++;
      nstate[n] = 1; queue.unshift(n); updBar(); pump();
    }
    function want(s) {                                  // load every stage up to s
      if (!man) { pendStage = Math.max(pendStage, s); return; }
      while (sched < s) {
        sched++;
        stageNodes(sched).forEach(function (n) { if (!nstate[n]) { nstate[n] = 1; queue.push(n); bTot++; } });
      }
      updBar(); pump();
    }
    function boot() {
      initGL();
      var im = new Image();
      im.onload = function () { gl.activeTexture(gl.TEXTURE4); lutTex = makeTex(im, false); kick(); };
      im.src = base + 'lut.png';
    }
    function start() {
      if (started) return; started = true;
      fetch(base + 'manifest.json').then(function (r) { return r.json(); }).then(function (m) {
        man = m; NX = m.nx; NY = m.ny; HX = m.home[0]; HY = m.home[1];
        m.frames.forEach(function (n) { avail[n] = 1; });
        AXs = STAGES.map(function (s) { return axisSet(NX, HX, s[0]); });
        AEs = STAGES.map(function (s) { return axisSet(NY, HY, s[1]); });
        px = tx = HX; py = ty = HY; canvas.style.cursor = 'grab';
        boot(); want(Math.max(1, pendStage));
      }).catch(function (e) { if (window.console) console.error('TILQE viewer:', e); });
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); start(); want(2); } }, { rootMargin: '300px' });
      io.observe(el);
    } else { start(); want(2); }
    var idleStart = function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1200); })(start); };
    if (document.readyState === 'complete') idleStart(); else window.addEventListener('load', idleStart);
    el._tqvState = function () { return { px: px, py: py, tx: tx, ty: ty, nx: NX, ny: NY, tex: Object.keys(texCache).length, blobs: Object.keys(blobs).length }; };
    return { el: el };
  }

  window.TilqeViewer = { mount: mount };
  function auto() { Array.prototype.forEach.call(document.querySelectorAll('[data-tilqe-viewer]'), function (e) { if (!e.classList.contains('tqv')) mount(e); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
