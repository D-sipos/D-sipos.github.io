/* TILQE 3-gang interactive viewer.
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
    '@media (prefers-reduced-motion:reduce){.tqv-pulse{animation:none;opacity:.6}}';

  var VS = 'attribute vec2 aPos;uniform float uZoom;varying vec2 vUv;void main(){vUv=vec2(aPos.x,-aPos.y)*0.5/uZoom+0.5;gl_Position=vec4(aPos,0.0,1.0);}';
  var FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uA,uB,uLut;',
    'uniform float uMix,uState,uPerRow,uLK,uK;',
    'uniform vec4 uWt,uMaxv;',
    'uniform vec2 uRectA,uRectB,uFrame,uAtlas,uCell;',
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
    '  vec3 lin=shade(uA,uRectA);',
    '  if(uMix>0.001)lin=mix(lin,shade(uB,uRectB),uMix);',
    '  vec3 c=tm(lin)+(hash(gl_FragCoord.xy)-0.5)/255.0;',
    '  gl_FragColor=vec4(c,1.0);',
    '}'].join('\n');

  function mount(el, opts) {
    opts = opts || {};
    var base = opts.base || el.getAttribute('data-base') || SCRIPT_BASE;
    var zoom = parseFloat(opts.zoom || el.getAttribute('data-zoom') || '1') || 1;
    var hintText = opts.hint || el.getAttribute('data-hint') || 'Drag to rotate · press the switches · turn the dimmer';
    if (!document.getElementById('tqv-css')) {
      var st = document.createElement('style'); st.id = 'tqv-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    el.classList.add('tqv');
    el.innerHTML = '<img alt="" src="' + base + 'poster.webp"><canvas tabindex="0" role="img" aria-label="TILQE 3-gang brass plate with dimmer, double switch and socket. Drag or use arrow keys to rotate; keys 1 and 2 press the switches; up and down turn the dimmer."></canvas>' +
      '<svg xmlns="http://www.w3.org/2000/svg"><g class="tqv-g"><circle class="tqv-pulse"/><circle class="tqv-pulse"/><circle class="tqv-pulse"/>' +
      '<g class="tqv-ring"><path fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2.4" stroke-linecap="round"/><path fill="none" stroke="#f6e7c6" stroke-width="2.4" stroke-linecap="round"/>' +
      '<text text-anchor="middle" fill="#f6e7c6" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="13" font-weight="600"></text></g></g></svg>' +
      '<div class="tqv-hint"></div><div class="tqv-bar"></div>';
    var canvas = el.querySelector('canvas'), svg = el.querySelector('svg'), gEl = el.querySelector('.tqv-g');
    var pulses = el.querySelectorAll('.tqv-pulse'), ring = el.querySelector('.tqv-ring');
    var ringBg = ring.children[0], ringFg = ring.children[1], ringTx = ring.children[2];
    var bar = el.querySelector('.tqv-bar');
    el.querySelector('.tqv-hint').textContent = hintText;
    if (zoom !== 1) el.querySelector('img').style.transform = 'scale(' + zoom + ')';

    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' }) || canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) return;
    var isGL2 = (typeof WebGL2RenderingContext !== 'undefined') && gl instanceof WebGL2RenderingContext;
    var man = null, prog = null, U = {}, lutTex = null;
    var blobs = {}, loaded = [], texCache = {}, decoding = {}, nDecoding = 0, clock = 0;
    var pos = 0, vel = 0, dragging = false, settleTo = null;
    var sw = [1, 1], dim = 1, lastDim = 1;      // targets
    var cur = [1, 1, 1];                         // animated: dimmer, L, R
    var lastPair = null, raf = 0, lastT = 0, ringUntil = 0, hoverKnob = false, started = false, live = false;
    var MAXTEX = 18, csW = 0, ovI = -1, ovInit = false;

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
      ['uA', 'uB', 'uLut', 'uMix', 'uState', 'uPerRow', 'uLK', 'uK', 'uWt', 'uMaxv', 'uRectA', 'uRectB', 'uFrame', 'uAtlas', 'uCell', 'uLutP', 'uZoom'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      gl.uniform1i(U.uA, 0); gl.uniform1i(U.uB, 1); gl.uniform1i(U.uLut, 2);
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
    function makeTex(src, mip) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (mip && isGL2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return t;
    }
    function decodeBlob(blob) {
      if (window.createImageBitmap) {
        return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(function () { return createImageBitmap(blob); });
      }
      return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = URL.createObjectURL(blob); });
    }
    function wantTex(i) {
      if (texCache[i]) { texCache[i].t = ++clock; return texCache[i].tex; }
      if (!decoding[i] && blobs[i] && nDecoding < 4) {
        decoding[i] = true; nDecoding++;
        decodeBlob(blobs[i]).then(function (bm) {
          delete decoding[i]; nDecoding--;
          if (gl.isContextLost()) return;
          texCache[i] = { tex: makeTex(bm, false), t: ++clock };
          if (bm.close) bm.close();
          evict(); kick();
        }, function () { delete decoding[i]; nDecoding--; });
      }
      return null;
    }
    function evict() {
      var keys = Object.keys(texCache);
      if (keys.length <= MAXTEX) return;
      keys.sort(function (a, b) { return texCache[a].t - texCache[b].t; });
      for (var j = 0; j < keys.length - MAXTEX; j++) {
        var k = +keys[j];
        if (lastPair && (k === lastPair.a || k === lastPair.b)) continue;
        gl.deleteTexture(texCache[k].tex); delete texCache[k];
      }
    }
    function pair(p) {
      // nearest loaded frames below / above p
      var lo = -1, hi = -1;
      for (var j = 0; j < loaded.length; j++) { var f = loaded[j]; if (f <= p) lo = f; if (f >= p && hi < 0) hi = f; }
      if (lo < 0) lo = hi; if (hi < 0) hi = lo;
      return { a: lo, b: hi, mix: hi > lo ? (p - lo) / (hi - lo) : 0 };
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
    function draw() {
      if (!prog || gl.isContextLost()) return;
      var want = pair(pos), ta = wantTex(want.a), tb = want.b === want.a ? ta : wantTex(want.b), p = null;
      if (ta && tb) p = want;
      else if (ta) p = { a: want.a, b: want.a, mix: 0 };
      else if (tb) p = { a: want.b, b: want.b, mix: 0 };
      else {
        var nc = null, bd = 1e9;                       // show the closest frame we already have instead of freezing
        for (var kk in texCache) { var dd = Math.abs(+kk - pos); if (dd < bd) { bd = dd; nc = +kk; } }
        if (nc !== null) p = { a: nc, b: nc, mix: 0 };
        else if (lastPair && texCache[lastPair.a] && texCache[lastPair.b]) p = lastPair;
      }
      if (!p) return;
      lastPair = p;
      // prefetch in the direction of travel
      var dir = vel >= 0 ? 1 : -1, idx = loaded.indexOf(dir > 0 ? want.b : want.a);
      for (var s = 1; s <= 4 && idx >= 0; s++) { var q = loaded[idx + dir * s]; if (q !== undefined) wantTex(q); }
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texCache[p.a].tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texCache[p.b].tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, lutTex);
      var w = weights(), R = man.patch.rects;
      gl.uniform4f(U.uWt, w[0], w[1], w[2], w[3]);
      gl.uniform1f(U.uMix, p.mix); gl.uniform1f(U.uState, stateIndex());
      gl.uniform2f(U.uRectA, R[p.a][0], R[p.a][1]); gl.uniform2f(U.uRectB, R[p.b][0], R[p.b][1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!live) { live = true; el.classList.add('tqv-live'); }
      overlay();
    }
    function gi() { return Math.max(0, Math.min(man.n - 1, Math.round(pos))); }
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
      var busy = false, lim = loaded.length ? [loaded[0], loaded[loaded.length - 1]] : [0, 0];
      if (!dragging) {
        if (Math.abs(vel) > 0.004) {
          pos += vel * dt; vel *= Math.exp(-dt / 300); busy = true;
          if (pos < lim[0]) { pos = lim[0]; vel = 0; } if (pos > lim[1]) { pos = lim[1]; vel = 0; }
          settleTo = null;
        } else {
          vel = 0;
          if (settleTo === null) settleTo = Math.round(pos);
          var d = settleTo - pos;
          if (Math.abs(d) > 0.003) { pos += d * (1 - Math.exp(-dt / 110)); busy = true; } else pos = settleTo;
        }
      }
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
    var mode = null, pid = null, sx = 0, sy = 0, sPos = 0, sDim = 0, moved = 0, pend = null, lastX = 0, lastMT = 0;
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
      var vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy, tt = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / l2)) : 0;
      var dx = p[0] - ax - tt * vx, dy = p[1] - ay - tt * vy, pad = Math.max(k[4] * man.h + 5, 16 * man.w / p[2] / zoom);
      if (dx * dx + dy * dy < pad * pad) return 'knob';
      if (inQuad(g.capL[i], p[0], p[1])) return 'L';
      if (inQuad(g.capR[i], p[0], p[1])) return 'R';
      return null;
    }
    function used() { el.classList.add('tqv-used'); }
    function toggle(side) { var j = side === 'L' ? 0 : 1; sw[j] = sw[j] ? 0 : 1; used(); kick(); }
    function setDim(v) { dim = Math.max(0, Math.min(1, v)); ringUntil = performance.now() + 1400; used(); kick(); }
    canvas.addEventListener('pointerdown', function (ev) {
      if (!man || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      pid = ev.pointerId; try { canvas.setPointerCapture(pid); } catch (e) {}
      sx = lastX = ev.clientX; sy = ev.clientY; sPos = pos; sDim = dim; moved = 0; lastMT = ev.timeStamp;
      var h = hit(ev);
      if (h === 'knob') mode = 'knob';
      else { mode = 'rotate'; pend = h; dragging = true; vel = 0; settleTo = null; }
      canvas.style.cursor = mode === 'knob' ? 'ew-resize' : 'grabbing';
      kick();
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!man) return;
      if (mode === null) {
        var h = hit(ev), hk = h === 'knob';
        canvas.style.cursor = hk ? 'ew-resize' : (h ? 'pointer' : 'grab');
        if (hk !== hoverKnob) { hoverKnob = hk; kick(); }
        return;
      }
      if (ev.pointerId !== pid) return;
      var dx = ev.clientX - sx, dy = ev.clientY - sy, w = csW || canvas.getBoundingClientRect().width;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (mode === 'knob') { if (moved > 4) setDim(sDim + (dx - dy) / 150); }
      else {
        if (moved > 6) { pend = null; used(); }
        var fpp = (man.n - 1) / (w * 1.5), np = sPos - dx * fpp;
        var lim = [loaded[0], loaded[loaded.length - 1]];
        np = Math.max(lim[0], Math.min(lim[1], np));
        var dtm = Math.max(1, ev.timeStamp - lastMT);
        vel = 0.6 * vel + 0.4 * (-(ev.clientX - lastX) * fpp / dtm);
        lastX = ev.clientX; lastMT = ev.timeStamp; pos = np;
      }
      kick();
    });
    function up(ev) {
      if (ev.pointerId !== pid || mode === null) return;
      if (ev.type === 'pointerup') {
        if (mode === 'knob' && moved <= 4) { if (dim > 0.02) { lastDim = dim; setDim(0); } else setDim(lastDim > 0.05 ? lastDim : 1); }
        if (mode === 'rotate' && pend && moved <= 6) toggle(pend);
      }
      if (mode === 'rotate' && (moved <= 6 || ev.timeStamp - lastMT > 90)) vel = 0;
      mode = null; dragging = false; pend = null; pid = null; canvas.style.cursor = 'grab'; kick();
    }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', function () { hoverKnob = false; kick(); });
    canvas.addEventListener('keydown', function (ev) {
      var k = ev.key, ok = true;
      if (k === 'ArrowLeft') { settleTo = Math.max(loaded[0], Math.round(pos) - 3); used(); }
      else if (k === 'ArrowRight') { settleTo = Math.min(loaded[loaded.length - 1], Math.round(pos) + 3); used(); }
      else if (k === 'ArrowUp') setDim(dim + 0.1);
      else if (k === 'ArrowDown') setDim(dim - 0.1);
      else if (k === '1') toggle('L'); else if (k === '2') toggle('R');
      else ok = false;
      if (ok) { ev.preventDefault(); vel = 0; kick(); }
    });
    canvas.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); texCache = {}; lastPair = null; prog = null; });
    canvas.addEventListener('webglcontextrestored', function () { boot(); });
    if (window.ResizeObserver) new ResizeObserver(function () { csW = 0; if (man) kick(); }).observe(el);
    else window.addEventListener('resize', function () { csW = 0; if (man) kick(); });

    // ---------- loading ----------
    function order() {
      var fr = man.frames.slice(), home = man.home, seen = {}, out = [];
      [16, 8, 4, 2, 1].forEach(function (step) {
        var lvl = fr.filter(function (f) { return !seen[f] && (f - home) % step === 0; });
        lvl.sort(function (a, b) { return Math.abs(a - home) - Math.abs(b - home); });
        lvl.forEach(function (f) { seen[f] = 1; out.push(f); });
      });
      return out;
    }
    function loadFrames() {
      var q = order(), total = q.length, got = 0, active = 0;
      function next() {
        while (active < 4 && q.length) (function (i) {
          active++;
          fetch(base + 'frames/f_' + ('00' + i).slice(-3) + '.webp').then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(function (b) {
            blobs[i] = b; loaded.push(i); loaded.sort(function (a, c) { return a - c; });
          }).catch(function () {}).then(function () {
            active--; got++; bar.style.width = (100 * got / total) + '%'; if (got === total) bar.classList.add('done');
            kick(); next();
          });
        })(q.shift());
      }
      next();
    }
    function boot() {
      initGL();
      var im = new Image();
      im.onload = function () { gl.activeTexture(gl.TEXTURE2); lutTex = makeTex(im, false); kick(); };
      im.src = base + 'lut.png';
    }
    function start() {
      if (started) return; started = true;
      fetch(base + 'manifest.json').then(function (r) { return r.json(); }).then(function (m) {
        man = m; pos = m.home; canvas.style.cursor = 'grab';
        boot(); loadFrames();
      }).catch(function (e) { if (window.console) console.error('TILQE viewer:', e); });
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '300px' });
      io.observe(el);
    } else start();
    return { el: el };
  }

  window.TilqeViewer = { mount: mount };
  function auto() { Array.prototype.forEach.call(document.querySelectorAll('[data-tilqe-viewer]'), function (e) { if (!e.classList.contains('tqv')) mount(e); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
