/* Frame Spotify
 * Viser det som spilles på Spotify som et innrammet verk, og egne bilder når ingenting spilles.
 * Ren nettleserapp: Spotify-innlogging med PKCE, ingen server og ingen client secret.
 * Holdt til ES2017 slik at den kjører i eldre Samsung-nettlesere.
 */
(function () {
  'use strict';

  var CFG = window.FRAME_CONFIG || {};
  var QS = parseQuery(location.search);
  var DEMO = QS.demo === '1';
  var CLIENT_ID = QS.client_id || CFG.spotifyClientId || '';
  var REDIRECT_URI = CFG.redirectUri || (location.origin + location.pathname.replace(/index\.html$/, ''));
  var SCOPES = 'user-read-currently-playing user-read-playback-state user-top-read';
  var API = 'https://api.spotify.com/v1';
  var ACCOUNTS = 'https://accounts.spotify.com';

  // ---------------------------------------------------------------- lagring

  var store = {
    get: function (k, fallback) {
      try {
        var v = window.localStorage.getItem(k);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) {
      try { window.localStorage.removeItem(k); } catch (e) {}
    }
  };

  // ---------------------------------------------------------------- innstillinger

  var DEFAULTS = {
    mat: 'warm',
    label: 'signature',
    size: 'large',
    idle: 3,
    idleShow: 'top',
    topRange: 'short_term',
    topMin: 2,
    artMin: 30,
    dim: 0,
    awake: true
  };

  var OPTIONS = [
    { key: 'mat', label: 'Passepartout', values: [
      ['warm', 'Varm hvit'], ['paper', 'Papirhvit'], ['stone', 'Steingrå'],
      ['tinted', 'Tonet etter bildet'], ['charcoal', 'Antrasitt'], ['black', 'Sort']] },
    { key: 'label', label: 'Tekst', values: [
      ['signature', 'Signatur under bildet'], ['museum', 'Museumsetikett'], ['none', 'Ingen']] },
    { key: 'size', label: 'Bildestørrelse', values: [
      ['small', 'Liten'], ['medium', 'Middels'], ['large', 'Stor']] },
    { key: 'idleShow', label: 'Når ingenting spilles', values: [
      ['top', 'Mest spilte album'], ['blank', 'Tom passepartout'], ['black', 'Svart skjerm'], ['art', 'Egne bilder']] },
    { key: 'idle', label: 'Bytt etter pause på', values: [
      [1, '1 min'], [3, '3 min'], [10, '10 min'], [30, '30 min']] },
    { key: 'topRange', label: 'Mest spilt', when: function () { return settings.idleShow === 'top'; }, values: [
      ['short_term', 'Siste 4 uker'], ['medium_term', 'Siste 6 måneder'], ['long_term', 'Siste år']] },
    { key: 'topMin', label: 'Bytt album hvert', when: function () { return settings.idleShow === 'top'; }, values: [
      [0.5, '30 sek'], [1, '1 min'], [2, '2 min'], [5, '5 min'], [10, '10 min']] },
    { key: 'artMin', label: 'Bytt eget bilde hvert', when: function () { return settings.idleShow === 'art'; }, values: [
      [1, '1 min'], [5, '5 min'], [10, '10 min'], [30, '30 min'], [60, '1 time'], [240, '4 timer']] },
    { key: 'dim', label: 'Lysstyrke', values: [
      [0, '100 %'], [0.2, '80 %'], [0.4, '60 %'], [0.6, '40 %']] },
    { key: 'awake', label: 'Hold skjermen våken', values: [
      [true, 'På'], [false, 'Av']] }
  ];

  var SIZE = { small: 0.56, medium: 0.66, large: 0.76 };

  var settings = Object.assign({}, DEFAULTS, store.get('fs.settings', {}));
  // URL-parametre overstyrer, nyttig for å teste: ?mat=black&label=museum
  OPTIONS.forEach(function (o) {
    if (QS[o.key] !== undefined) {
      var raw = QS[o.key];
      o.values.forEach(function (v) { if (String(v[0]) === raw) settings[o.key] = v[0]; });
    }
  });

  function saveSettings() { store.set('fs.settings', settings); }

  // ---------------------------------------------------------------- tilstand

  var state = {
    mode: null,          // 'music' | 'art'
    key: null,           // hva som vises nå
    piece: null,         // data for det som vises (for ny layout ved resize)
    lastActive: 0,       // sist Spotify spilte
    pollTimer: null,
    artTimer: null,
    art: [],
    top: [],
    topIdx: 0,
    topLoadedAt: 0,
    topRangeLoaded: null,
    scopePrompted: false,
    artOrder: [],
    artLoadedAt: 0,
    failures: 0,
    loggedIn: false,
    renderSeq: 0
  };

  var $stage = document.getElementById('stage');
  var $dim = document.getElementById('dim');
  var $toast = document.getElementById('toast');
  var $login = document.getElementById('login');
  var $menu = document.getElementById('menu');
  var $menuList = document.getElementById('menu-list');

  // ---------------------------------------------------------------- hjelpere

  function parseQuery(q) {
    var out = {};
    (q || '').replace(/^\?/, '').split('&').forEach(function (p) {
      if (!p) return;
      var i = p.indexOf('=');
      var k = decodeURIComponent(i < 0 ? p : p.slice(0, i));
      var v = i < 0 ? '' : decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' '));
      out[k] = v;
    });
    return out;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var toastTimer = null;
  function toast(msg, ms) {
    $toast.textContent = msg;
    $toast.className = 'show';
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { $toast.className = ''; }

  // ---------------------------------------------------------------- PKCE

  function randomString(len) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var a = new Uint8Array(len);
    window.crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < len; i++) s += chars[a[i] % chars.length];
    return s;
  }

  function base64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function sha256(str) {
    var data = new TextEncoder().encode(str);
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      return window.crypto.subtle.digest('SHA-256', data).then(function (b) { return new Uint8Array(b); });
    }
    return Promise.resolve(sha256Fallback(data));
  }

  // Reserve for nettlesere uten crypto.subtle
  function sha256Fallback(msg) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var l = msg.length, nBlocks = ((l + 9 + 63) >> 6);
    var buf = new Uint8Array(nBlocks * 64);
    buf.set(msg); buf[l] = 0x80;
    var bits = l * 8;
    buf[buf.length - 4] = (bits >>> 24) & 255; buf[buf.length - 3] = (bits >>> 16) & 255;
    buf[buf.length - 2] = (bits >>> 8) & 255; buf[buf.length - 1] = bits & 255;
    var W = new Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var b = 0; b < nBlocks; b++) {
      for (var t = 0; t < 16; t++) {
        var j = b * 64 + t * 4;
        W[t] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = new Uint8Array(32);
    for (var i = 0; i < 8; i++) {
      out[i * 4] = (H[i] >>> 24) & 255; out[i * 4 + 1] = (H[i] >>> 16) & 255;
      out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255;
    }
    return out;
  }

  // ---------------------------------------------------------------- Spotify-innlogging

  function AuthError(msg) { this.auth = true; this.message = msg; }

  function tokens() { return store.get('fs.token', null); }

  function saveTokens(j) {
    var old = tokens() || {};
    store.set('fs.token', {
      access: j.access_token,
      refresh: j.refresh_token || old.refresh,   // Spotify roterer refresh-token
      scope: j.scope || old.scope || '',
      exp: Date.now() + (j.expires_in || 3600) * 1000
    });
  }

  function startLogin() {
    if (!CLIENT_ID) return;
    var verifier = randomString(64);
    var st = randomString(16);
    store.set('fs.pkce', { v: verifier, s: st });
    sha256(verifier).then(function (hash) {
      var params = {
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge_method: 'S256',
        code_challenge: base64url(hash),
        state: st
      };
      location.href = ACCOUNTS + '/authorize?' + Object.keys(params).map(function (k) {
        return k + '=' + encodeURIComponent(params[k]);
      }).join('&');
    });
  }

  function tokenRequest(params) {
    var body = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(ACCOUNTS + '/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.ok, status: r.status, json: j };
      });
    });
  }

  // Kalles når Spotify sender oss tilbake med ?code=...
  function handleCallback() {
    if (!QS.code && !QS.error) return Promise.resolve(false);
    var pkce = store.get('fs.pkce', null);
    store.del('fs.pkce');
    history.replaceState(null, '', REDIRECT_URI);
    if (QS.error) {
      toast('Spotify-innloggingen ble avbrutt.', 6000);
      return Promise.resolve(false);
    }
    if (!pkce || pkce.s !== QS.state) {
      toast('Innloggingen kunne ikke bekreftes. Prøv igjen.', 6000);
      return Promise.resolve(false);
    }
    return tokenRequest({
      grant_type: 'authorization_code',
      code: QS.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pkce.v
    }).then(function (res) {
      if (!res.ok) {
        toast('Spotify avviste innloggingen (' + (res.json.error_description || res.status) + ').', 8000);
        return false;
      }
      saveTokens(res.json);
      return true;
    });
  }

  var refreshing = null;
  function refreshAccess() {
    if (refreshing) return refreshing;
    var t = tokens();
    if (!t || !t.refresh) return Promise.reject(new AuthError('no refresh token'));
    refreshing = tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: t.refresh,
      client_id: CLIENT_ID
    }).then(function (res) {
      if (res.ok) { saveTokens(res.json); return tokens().access; }
      if (res.status === 400 || res.status === 401) {
        store.del('fs.token');
        throw new AuthError(res.json.error || 'invalid_grant');
      }
      throw new Error('token ' + res.status);
    });
    refreshing.then(clear, clear);
    function clear() { refreshing = null; }
    return refreshing;
  }

  function accessToken() {
    var t = tokens();
    if (!t) return Promise.reject(new AuthError('not logged in'));
    if (Date.now() < t.exp - 60000) return Promise.resolve(t.access);
    return refreshAccess();
  }

  function logout() {
    store.del('fs.token');
    state.loggedIn = false;
    clearTimeout(state.pollTimer);
    enterArt();
    showLogin();
  }

  // ---------------------------------------------------------------- hva spilles nå

  function fetchNowPlaying(retried) {
    return accessToken().then(function (tok) {
      return fetch(API + '/me/player/currently-playing?additional_types=episode', {
        headers: { Authorization: 'Bearer ' + tok }
      });
    }).then(function (r) {
      if (r.status === 204) return { none: true };
      if (r.status === 401 && !retried) {
        var t = tokens(); if (t) { t.exp = 0; store.set('fs.token', t); }
        return fetchNowPlaying(true);
      }
      if (r.status === 429) {
        var ra = parseInt(r.headers.get('Retry-After'), 10);
        var err = new Error('rate limited'); err.retryAfter = isNaN(ra) ? 30 : ra;
        throw err;
      }
      if (r.status === 403) {
        var e403 = new Error('forbidden'); e403.forbidden = true; throw e403;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().then(normalize);
    });
  }

  function largestImage(images) {
    if (!images || !images.length) return null;
    var best = images[0];
    images.forEach(function (i) { if ((i.width || 0) > (best.width || 0)) best = i; });
    return best.url;
  }

  function normalize(j) {
    if (!j) return { none: true };
    if (j.currently_playing_type === 'ad') return { ad: true };
    var it = j.item;
    if (!it) return { none: true, isPlaying: !!j.is_playing };
    var ep = j.currently_playing_type === 'episode' || it.type === 'episode';
    var images = ep
      ? ((it.images && it.images.length) ? it.images : (it.show && it.show.images) || [])
      : (it.album && it.album.images) || [];
    var date = ep ? it.release_date : (it.album && it.album.release_date);
    return {
      item: true,
      id: it.uri || it.id || it.name,
      title: it.name || '',
      artist: ep ? (it.show ? it.show.name : '') : (it.artists || []).map(function (a) { return a.name; }).join(', '),
      album: ep ? '' : (it.album ? it.album.name : ''),
      year: (date || '').slice(0, 4),
      image: largestImage(images),
      isPlaying: !!j.is_playing,
      progress: j.progress_ms || 0,
      duration: it.duration_ms || 0
    };
  }

  // Demomodus: ?demo=1 viser oppdiktet avspilling, uten Spotify
  var demoStart = Date.now();
  var DEMO_TRACKS = [
    { item: true, id: 'demo-a', title: 'Slow Light Over the Fjord', artist: 'Ingrid Sol & The Low Tide',
      album: 'Harbour Hours', year: '2024', image: 'demo/cover-a.jpg', isPlaying: true, progress: 0, duration: 20000 },
    { item: true, id: 'demo-b', title: 'Kitchen Table Geometry', artist: 'Mareld', album: 'Small Architecture',
      year: '2019', image: 'demo/cover-b.jpg', isPlaying: true, progress: 0, duration: 20000 }
  ];
  var DEMO_TOP = [
    { album: { id: 'b', name: 'Small Architecture', release_date: '2019', artists: [{ name: 'Mareld' }],
      images: [{ url: 'demo/cover-b.jpg', width: 640 }] } },
    { album: { id: 'a', name: 'Harbour Hours', release_date: '2024', artists: [{ name: 'Ingrid Sol & The Low Tide' }],
      images: [{ url: 'demo/cover-a.jpg', width: 640 }] } }
  ];

  function fetchDemo() {
    if (QS.demostate === 'art') return Promise.resolve({ none: true });
    if (QS.demostate === 'a') return Promise.resolve(DEMO_TRACKS[0]);
    if (QS.demostate === 'b') return Promise.resolve(DEMO_TRACKS[1]);
    var t = ((Date.now() - demoStart) / 1000) % 70;
    if (t < 20) return Promise.resolve(DEMO_TRACKS[0]);
    if (t < 40) return Promise.resolve(DEMO_TRACKS[1]);
    return Promise.resolve({ none: true });
  }

  function idleMs() { return DEMO ? 4000 : settings.idle * 60000; }

  function schedulePoll(ms) {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(poll, ms);
  }

  function poll() {
    if (!state.loggedIn && !DEMO) return;
    (DEMO ? fetchDemo() : fetchNowPlaying()).then(function (now) {
      var t = Date.now();
      var next = 8000;
      if (state.failures >= 3) hideToast();
      state.failures = 0;

      if (now.ad) {
        state.lastActive = t;
        next = 5000;
      } else if (now.item && now.isPlaying) {
        state.lastActive = t;
        showTrack(now);
        var remaining = now.duration - now.progress;
        next = Math.max(1500, Math.min(5000, remaining + 800));
      } else if (state.mode === 'music' && t - state.lastActive < idleMs()) {
        next = 5000;   // kort pause eller sporbytte: la albumet stå en stund
      } else {
        enterArt();
        next = 10000;
      }
      schedulePoll(next);
    }).catch(function (err) {
      if (err && err.auth) {
        state.loggedIn = false;
        enterArt();
        showLogin('Spotify-tilgangen er utløpt. Koble til på nytt.');
        return;
      }
      var next;
      if (err && err.retryAfter) {
        next = err.retryAfter * 1000;
      } else if (err && err.forbidden) {
        next = 60000;
        toast('Spotify nekter tilgang. Er kontoen lagt til under User Management i Spotify-appen?');
      } else {
        state.failures++;
        next = Math.min(60000, 5000 * state.failures);
        if (state.failures >= 3) toast('Får ikke kontakt med Spotify. Prøver igjen …');
      }
      if (!state.mode || t0expired()) enterArt();
      schedulePoll(next);
    });
  }

  function t0expired() {
    return state.mode === 'music' && Date.now() - state.lastActive > idleMs();
  }

  // ---------------------------------------------------------------- visning

  function showTrack(n) {
    var key = 'track:' + n.id + '|' + n.image;
    if (state.mode === 'music' && state.key === key) return;
    state.mode = 'music';
    stopArtTimer();
    document.body.classList.remove('idle-black');
    render(key, {
      src: n.image,
      left: n.title,
      mid: [n.album, n.year].filter(Boolean).join(' · '),
      right: n.artist,
      cardArtist: n.artist,
      cardTitle: n.title,
      cardMeta: [n.album, n.year].filter(Boolean).join(', ')
    });
  }

  function render(key, data, instant) {
    state.key = key;
    state.piece = data;
    var seq = ++state.renderSeq;
    var load = data.src ? loadImage(data.src) : Promise.resolve(null);
    if (data.blank && settings.mat === 'tinted') applyTint(null);
    load.then(function (img) {
      if (seq !== state.renderSeq) return;
      if (settings.mat === 'tinted') applyTint(img);
      var piece = buildPiece(data, img, instant);
      var old = $stage.querySelectorAll('.piece');
      $stage.appendChild(piece);
      piece.offsetWidth;   // tving reflow før overgangen
      piece.className += ' in';
      Array.prototype.forEach.call(old, function (o) {
        o.className = o.className.replace(/\bin\b/, '');
        setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, instant ? 0 : 1700);
      });
    }).catch(function () {
      if (seq !== state.renderSeq) return;
      // Bildet kunne ikke lastes. Vis tom ramme med tekst fremfor ingenting.
      var piece = buildPiece(data, null, instant);
      $stage.innerHTML = '';
      $stage.appendChild(piece);
      piece.offsetWidth;
      piece.className += ' in';
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        // Prøv uten CORS (da virker ikke tonet passepartout, men bildet vises)
        var img2 = new Image();
        img2.onload = function () { resolve(img2); };
        img2.onerror = reject;
        img2.src = src;
      };
      img.src = src;
    });
  }

  function buildPiece(data, img, instant) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var aspect = img ? (img.naturalWidth / img.naturalHeight) : 1;
    var maxH = vh * (SIZE[settings.size] || SIZE.large);
    var maxW = vw * 0.80;
    var h = maxH, w = h * aspect;
    if (w > maxW) { w = maxW; h = w / aspect; }
    w = Math.round(w); h = Math.round(h);

    var bevel = Math.max(4, Math.round(vh * 0.0062));
    var labelRoom = settings.label === 'signature' ? vh * 0.07 : 0;
    // Litt over midten, slik verk henges, og med plass til påskriften under
    var top = Math.round((vh - h - labelRoom) / 2 - vh * 0.012);
    var left = Math.round((vw - w) / 2);

    var piece = el('div', 'piece' + (instant ? ' instant' : ''));
    if (data.blank) return piece;

    var cut = el('div', 'cut' + (img ? '' : ' empty'));
    cut.style.left = (left - bevel) + 'px';
    cut.style.top = (top - bevel) + 'px';
    cut.style.width = w + 'px';
    cut.style.height = h + 'px';
    cut.style.borderWidth = bevel + 'px';
    if (img) {
      img.removeAttribute('width'); img.removeAttribute('height');
      img.alt = '';
      cut.appendChild(img);
    }
    cut.appendChild(el('div', 'shade'));
    piece.appendChild(cut);

    // Signatur
    var ins = el('div', 'inscription');
    ins.style.left = left + 'px';
    ins.style.width = w + 'px';
    ins.style.top = Math.round(top + h + bevel + vh * 0.022) + 'px';
    var row = el('div', 'i-row');
    var leftCol = el('div', 'i-left');
    leftCol.appendChild(el('div', 'i-title', data.left || ''));
    leftCol.appendChild(el('div', 'i-sub', data.mid || ''));
    row.appendChild(leftCol);
    row.appendChild(el('div', 'i-right', data.right || ''));
    ins.appendChild(row);
    if (data.left || data.right) piece.appendChild(ins);

    // Museumsetikett: til høyre for verket, nederst. Under hvis det ikke er plass.
    if (data.cardTitle) {
      var card = el('div', 'label-card');
      card.appendChild(el('div', 'l-artist', data.cardArtist || ''));
      card.appendChild(el('div', 'l-title', data.cardTitle));
      card.appendChild(el('div', 'l-meta', data.cardMeta || ''));
      var cardW = vw * 0.145, gap = vw * 0.03;
      var rightEdge = left + w + bevel;
      if (rightEdge + gap + cardW < vw - vw * 0.025) {
        card.style.left = Math.round(rightEdge + gap) + 'px';
        card.style.bottom = Math.round(vh - (top + h + bevel)) + 'px';
      } else {
        card.style.left = Math.round(rightEdge - cardW) + 'px';
        card.style.top = Math.round(top + h + bevel + vh * 0.03) + 'px';
      }
      piece.appendChild(card);
    }
    return piece;
  }

  function relayout() {
    if (!state.piece) return;
    render(state.key, state.piece, true);
  }

  // ---------------------------------------------------------------- passepartout

  var MAT_CLASSES = ['warm', 'paper', 'stone', 'tinted', 'charcoal', 'black'];
  var TINT_VARS = ['--mat', '--ink', '--ink-soft', '--bevel-top', '--bevel-right', '--bevel-left', '--bevel-bottom', '--card', '--card-ink', '--accent'];

  function applyMat() {
    var body = document.body;
    MAT_CLASSES.forEach(function (m) { body.classList.remove('mat-' + m); });
    body.classList.add('mat-' + settings.mat);
    if (settings.mat !== 'tinted') {
      TINT_VARS.forEach(function (v) { document.documentElement.style.removeProperty(v); });
    } else {
      var img = $stage.querySelector('.piece:last-child img');
      applyTint(img);
    }
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', getComputedStyle(body).backgroundColor);
  }

  function applyTint(img) {
    var hsl = img ? dominantHsl(img) : null;
    if (!hsl) hsl = [38, 0.12, 0.5];
    var h = Math.round(hsl[0]);
    var s = Math.max(0.06, Math.min(0.26, hsl[1] * 0.6));
    var root = document.documentElement.style;
    function c(sat, light) { return 'hsl(' + h + ',' + Math.round(sat * 100) + '%,' + light + '%)'; }
    root.setProperty('--mat', c(s, 86));
    root.setProperty('--ink', c(Math.min(0.2, s), 36));
    root.setProperty('--ink-soft', c(Math.min(0.16, s), 52));
    root.setProperty('--bevel-top', c(s * 0.8, 78));
    root.setProperty('--bevel-right', c(s * 0.7, 84));
    root.setProperty('--bevel-left', c(s * 0.6, 89));
    root.setProperty('--bevel-bottom', c(s * 0.4, 94));
    root.setProperty('--card', c(s * 0.6, 93));
    root.setProperty('--card-ink', c(Math.min(0.2, s), 22));
    root.setProperty('--accent', c(Math.min(0.2, s), 22));
  }

  // Gjennomsnittsfarge vektet mot de mettede pikslene
  function dominantHsl(img) {
    try {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 24;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, 24, 24);
      var d = cx.getImageData(0, 0, 24, 24).data;
      var r = 0, g = 0, b = 0, wsum = 0;
      for (var i = 0; i < d.length; i += 4) {
        var max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
        var w = 0.15 + (max - min) / 255;
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; wsum += w;
      }
      return rgbToHsl(r / wsum, g / wsum, b / wsum);
    } catch (e) { return null; }   // bilde uten CORS
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  function applyLabel() {
    var body = document.body;
    ['signature', 'museum', 'none'].forEach(function (m) { body.classList.remove('label-' + m); });
    body.classList.add('label-' + settings.label);
  }

  function applyDim() { $dim.style.opacity = settings.dim; }

  // ---------------------------------------------------------------- egne bilder

  // Lista over egne bilder: art/art.json når den finnes (GitHub Pages lager den),
  // ellers mappeinnholdet fra GitHub-repoet (f.eks. ved publisering på Vercel).
  var IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

  function fetchArtJson() {
    var bucket = Math.floor(Date.now() / 600000);
    return fetch('art/art.json?v=' + bucket, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('no art.json');
      return r.json();
    }).then(function (list) {
      if (list && list.images) list = list.images;
      if (!Array.isArray(list)) throw new Error('bad art.json');
      return list;
    });
  }

  function fetchArtFromGitHub() {
    if (!CFG.githubRepo) return Promise.reject(new Error('no repo'));
    var url = 'https://api.github.com/repos/' + CFG.githubRepo + '/contents/art' +
      (CFG.githubBranch ? '?ref=' + encodeURIComponent(CFG.githubBranch) : '');
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) {
      if (!r.ok) throw new Error('github ' + r.status);
      return r.json();
    }).then(function (items) {
      return items.filter(function (i) { return i.type === 'file' && IMAGE_RE.test(i.name); })
        .map(function (i) { return i.name; })
        .sort();
    });
  }

  function loadArtList() {
    return fetchArtJson().catch(fetchArtFromGitHub).then(function (list) {
      state.art = list.map(function (entry) {
        if (typeof entry === 'string') {
          var meta = parseArtName(entry);
          return { src: 'art/' + encodeURIComponent(entry), title: meta.title, byline: meta.byline };
        }
        return { src: entry.src, title: entry.title || '', byline: entry.byline || '' };
      });
      // Fjern bilder som ikke lenger finnes fra køen
      var srcs = state.art.map(function (a) { return a.src; });
      state.artOrder = state.artOrder.filter(function (i) { return i < srcs.length; });
      state.artLoadedAt = Date.now();
      return state.art;
    }).catch(function () {
      // Behold forrige liste hvis begge kildene feiler; prøv igjen om et par minutter
      state.artLoadedAt = Date.now() - 480000;
      return state.art;
    });
  }

  // «Tittel - Kunstner, år.jpg» blir tittel og byline. Kameranavn som IMG_1234 får ingen tekst.
  function parseArtName(file) {
    var base = file.replace(/\.[A-Za-z0-9]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    base = base.replace(/^\d{1,3}[.)]\s+/, '');
    if (/^(img|dsc|dscn|dscf|pxl|photo|image|screenshot|skjermbilde)[\s-]?\d/i.test(base)) {
      return { title: '', byline: '' };
    }
    var parts = base.split(/\s+[-–—]\s+/);
    return { title: parts[0], byline: parts.slice(1).join(' – ') };
  }

  function nextArt() {
    if (!state.art.length) return null;
    if (!state.artOrder.length) {
      var order = state.art.map(function (_, i) { return i; });
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      // Unngå samme bilde to ganger på rad når rekkefølgen starter på nytt
      if (order.length > 1 && state.key === 'art:' + state.art[order[0]].src) order.push(order.shift());
      state.artOrder = order;
    }
    return state.art[state.artOrder.shift()];
  }

  // «Art» er hvilemodus: det som vises når ingenting spilles (se innstillingen idleShow)
  function enterArt() {
    if (state.mode === 'art') return;
    state.mode = 'art';
    showNextArt();
  }

  function restartIdle() {
    if (state.mode !== 'art') return;
    state.mode = null;
    enterArt();
  }

  function showNextArt() {
    stopArtTimer();
    var show = settings.idleShow;
    document.body.classList.toggle('idle-black', show === 'black');
    if (show === 'blank' || show === 'black') {
      render('idle:blank', { blank: true });
      return;
    }
    if (show === 'top') { showNextTopAlbum(); return; }
    showNextOwnImage();
  }

  function showNextOwnImage() {
    var stale = Date.now() - state.artLoadedAt > 600000;
    var ready = (stale || !state.art.length) ? loadArtList() : Promise.resolve(state.art);
    ready.then(function () {
      if (state.mode !== 'art' || settings.idleShow !== 'art') return;
      var a = nextArt();
      if (!a) {
        render('art:empty', {
          src: null, left: 'Ingen egne bilder ennå', right: 'Legg dem i art-mappen',
          cardTitle: 'Ingen egne bilder ennå', cardMeta: 'Legg bilder i art-mappen i GitHub-repoet.'
        });
      } else {
        render('art:' + a.src, {
          src: a.src, left: a.title, mid: '', right: a.byline,
          cardArtist: a.byline, cardTitle: a.title, cardMeta: ''
        });
      }
      state.artTimer = setTimeout(showNextArt, settings.artMin * 60000);
    });
  }

  // ---------------------------------------------------------------- mest spilte album

  function hasTopScope() {
    if (DEMO) return true;
    var t = tokens();
    return !!(t && t.scope && t.scope.indexOf('user-top-read') >= 0);
  }

  function needTopScope() {
    render('idle:blank', { blank: true });
    if (state.loggedIn && !state.scopePrompted) {
      state.scopePrompted = true;
      showLogin('For å vise de mest spilte albumene dine trenger appen én ny tillatelse fra Spotify. Koble til på nytt for å gi den.');
    }
  }

  function loadTopAlbums() {
    var fresh = Date.now() - state.topLoadedAt < 6 * 3600000 && state.topRangeLoaded === settings.topRange;
    if (fresh && state.top.length) return Promise.resolve(state.top);
    var range = settings.topRange;
    var req = DEMO ? Promise.resolve({ items: DEMO_TOP }) :
      accessToken().then(function (tok) {
        return fetch(API + '/me/top/tracks?limit=50&time_range=' + range, {
          headers: { Authorization: 'Bearer ' + tok }
        });
      }).then(function (r) {
        if (r.status === 403 || r.status === 401) { var e = new Error('scope'); e.scope = true; throw e; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    return req.then(function (j) {
      state.top = rankAlbums(j.items || []);
      state.topLoadedAt = Date.now();
      state.topRangeLoaded = range;
      state.topIdx = 0;
      return state.top;
    });
  }

  // Album rangeres etter hvor høyt og hvor mange av sporene deres ligger på topplisten
  function rankAlbums(tracks) {
    var byId = {}, list = [];
    tracks.forEach(function (t, i) {
      var a = t.album;
      if (!a || !a.images || !a.images.length) return;
      var id = a.id || a.uri || a.name;
      if (!byId[id]) {
        byId[id] = {
          score: 0,
          title: a.name || '',
          artist: ((a.artists && a.artists.length ? a.artists : t.artists) || []).map(function (x) { return x.name; }).join(', '),
          year: (a.release_date || '').slice(0, 4),
          image: largestImage(a.images)
        };
        list.push(byId[id]);
      }
      byId[id].score += tracks.length - i;
    });
    list.sort(function (x, y) { return y.score - x.score; });
    return list.slice(0, 24);
  }

  function showNextTopAlbum() {
    if (!hasTopScope()) { needTopScope(); return; }
    loadTopAlbums().then(function (albums) {
      if (state.mode !== 'art' || settings.idleShow !== 'top') return;
      if (!albums.length) {
        render('idle:blank', { blank: true });
      } else {
        var a = albums[state.topIdx % albums.length];
        state.topIdx = (state.topIdx + 1) % albums.length;
        render('top:' + a.image, {
          src: a.image,
          left: a.title,
          mid: a.year,
          right: a.artist,
          cardArtist: a.artist,
          cardTitle: a.title,
          cardMeta: a.year
        });
      }
      state.artTimer = setTimeout(showNextArt, settings.topMin * 60000);
    }).catch(function (err) {
      if (err && (err.scope || err.auth)) { needTopScope(); return; }
      // Nettverksfeil: vis tom passepartout og prøv igjen om litt
      if (!state.top.length) render('idle:blank', { blank: true });
      state.artTimer = setTimeout(showNextArt, 60000);
    });
  }

  function stopArtTimer() { clearTimeout(state.artTimer); state.artTimer = null; }

  // ---------------------------------------------------------------- skjermen våken

  var wakeLock = null;
  function keepAwake() {
    var v = document.getElementById('keepawake');
    if (!settings.awake) {
      if (v) v.pause();
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
      return;
    }
    if (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    if (navigator.wakeLock && !wakeLock && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () {});
    }
    // Pakket Tizen-app: slå av TV-ens skjermsparer
    try {
      if (window.webapis && webapis.appcommon) {
        webapis.appcommon.setScreenSaver(webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
      }
    } catch (e) {}
  }

  function goFullscreen() {
    var d = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      var p = d.requestFullscreen ? d.requestFullscreen() : (d.webkitRequestFullscreen ? d.webkitRequestFullscreen() : null);
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------- innlogging-overlegg

  function showLogin(msg) {
    var text = document.getElementById('login-text');
    var btn = document.getElementById('login-btn');
    if (!CLIENT_ID) {
      text.innerHTML = 'Mangler Spotify Client ID. Legg den inn i <code>config.js</code>, eller åpne siden med <code>?client_id=…</code>.';
      btn.style.display = 'none';
    } else {
      text.textContent = msg || 'Koble til Spotify-kontoen din for å vise det som spilles.';
    }
    $login.hidden = false;
    loginFocus = CLIENT_ID ? 0 : 1;
    updateLoginFocus();
  }
  function hideLogin() { $login.hidden = true; }

  var loginFocus = 0;
  function loginButtons() {
    return [document.getElementById('login-btn'), document.getElementById('login-skip')].filter(function (b) {
      return b.style.display !== 'none';
    });
  }
  function updateLoginFocus() {
    var bs = loginButtons();
    if (loginFocus >= bs.length) loginFocus = bs.length - 1;
    bs.forEach(function (b, i) { b.classList.toggle('focus', i === loginFocus); });
  }

  document.getElementById('login-btn').addEventListener('click', function (e) { e.stopPropagation(); startLogin(); });
  document.getElementById('login-skip').addEventListener('click', function (e) { e.stopPropagation(); hideLogin(); });

  // ---------------------------------------------------------------- meny

  var menuFocus = 0;
  var menuItems = [];

  function buildMenu() {
    menuItems = OPTIONS.filter(function (o) { return !o.when || o.when(); })
      .map(function (o) { return { type: 'option', opt: o }; });
    var nextLabel = settings.idleShow === 'top' ? 'Vis neste album' : (settings.idleShow === 'art' ? 'Vis neste eget bilde' : null);
    if (nextLabel) {
      menuItems.push({ type: 'action', label: nextLabel, run: function () {
        closeMenu(); state.mode = 'art'; stopArtTimer(); showNextArt();
      }, sep: true });
    }
    if (!DEMO) {
      if (state.loggedIn) {
        menuItems.push({ type: 'action', label: 'Koble til Spotify på nytt', sep: !nextLabel,
          run: function () { closeMenu(); startLogin(); } });
        menuItems.push({ type: 'action', label: 'Logg ut av Spotify', run: function () { closeMenu(); logout(); } });
      } else {
        menuItems.push({ type: 'action', label: 'Koble til Spotify', sep: !nextLabel,
          run: function () { closeMenu(); showLogin(); } });
      }
    }
    menuItems.push({ type: 'action', label: 'Lukk', run: closeMenu });

    $menuList.innerHTML = '';
    menuItems.forEach(function (item, i) {
      var li = el('li', item.type === 'action' ? 'action' : '');
      if (item.sep) li.className += ' sep';
      li.appendChild(el('span', 'm-label', item.type === 'option' ? item.opt.label : item.label));
      li.appendChild(el('span', 'm-value', item.type === 'option' ? currentLabel(item.opt) : ''));
      li.addEventListener('click', function (e) {
        e.stopPropagation();
        menuFocus = i;
        activate(1);
      });
      $menuList.appendChild(li);
    });
    updateMenuFocus();
  }

  function currentLabel(o) {
    for (var i = 0; i < o.values.length; i++) if (o.values[i][0] === settings[o.key]) return o.values[i][1];
    return o.values[0][1];
  }

  function updateMenuFocus() {
    Array.prototype.forEach.call($menuList.children, function (li, i) {
      li.classList.toggle('focus', i === menuFocus);
    });
  }

  function activate(dir) {
    var item = menuItems[menuFocus];
    if (item.type === 'action') { item.run(); return; }
    var o = item.opt;
    var idx = 0;
    for (var i = 0; i < o.values.length; i++) if (o.values[i][0] === settings[o.key]) idx = i;
    idx = (idx + dir + o.values.length) % o.values.length;
    settings[o.key] = o.values[idx][0];
    saveSettings();
    onSettingChanged(o.key);
    $menuList.children[menuFocus].querySelector('.m-value').textContent = o.values[idx][1];
  }

  function onSettingChanged(key) {
    if (key === 'mat') applyMat();
    if (key === 'label' || key === 'size') { applyLabel(); relayout(); }
    if (key === 'dim') applyDim();
    if (key === 'awake') keepAwake();
    if ((key === 'artMin' || key === 'topMin') && state.mode === 'art') {
      stopArtTimer();
      state.artTimer = setTimeout(showNextArt, settings[key] * 60000);
    }
    if (key === 'topRange') { state.topLoadedAt = 0; restartIdle(); }
    if (key === 'idleShow') {
      state.scopePrompted = false;
      restartIdle();
      // Menyen viser bare valgene som hører til det som er valgt
      var focusKey = menuItems[menuFocus] && menuItems[menuFocus].opt && menuItems[menuFocus].opt.key;
      buildMenu();
      menuItems.forEach(function (it, i) { if (it.opt && it.opt.key === focusKey) menuFocus = i; });
      updateMenuFocus();
    }
  }

  function openMenu() {
    buildMenu();
    menuFocus = 0;
    updateMenuFocus();
    $menu.hidden = false;
  }
  function closeMenu() { $menu.hidden = true; }

  // ---------------------------------------------------------------- fjernkontroll og mus

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8 };

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    goFullscreen();
    keepAwake();

    if (!$menu.hidden) {
      if (k === KEY.UP) menuFocus = (menuFocus - 1 + menuItems.length) % menuItems.length;
      else if (k === KEY.DOWN) menuFocus = (menuFocus + 1) % menuItems.length;
      else if (k === KEY.LEFT) activate(-1);
      else if (k === KEY.RIGHT || k === KEY.ENTER) activate(1);
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) closeMenu();
      else return;
      updateMenuFocus();
      e.preventDefault();
      return;
    }

    if (!$login.hidden) {
      var bs = loginButtons();
      if (k === KEY.UP) loginFocus = Math.max(0, loginFocus - 1);
      else if (k === KEY.DOWN) loginFocus = Math.min(bs.length - 1, loginFocus + 1);
      else if (k === KEY.ENTER) bs[loginFocus].click();
      else if (k === KEY.BACK || k === KEY.ESC) hideLogin();
      else return;
      updateLoginFocus();
      e.preventDefault();
      return;
    }

    if (k === KEY.ENTER || k === KEY.UP || k === KEY.DOWN) { openMenu(); e.preventDefault(); }
    else if (k === KEY.RIGHT && state.mode === 'art') { showNextArt(); e.preventDefault(); }
  });

  // Samsung-nettleseren styres ofte med en peker; klikk hvor som helst åpner menyen
  document.getElementById('wall').addEventListener('click', function () {
    goFullscreen();
    keepAwake();
    if ($login.hidden) openMenu();
  });
  $menu.addEventListener('click', function (e) { if (e.target === $menu) closeMenu(); });

  var pointerTimer = null;
  function pointerActivity() {
    document.body.classList.remove('pointer-idle');
    clearTimeout(pointerTimer);
    pointerTimer = setTimeout(function () { document.body.classList.add('pointer-idle'); }, 2500);
  }
  document.addEventListener('mousemove', pointerActivity);
  pointerActivity();

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 250);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      keepAwake();
      if (state.loggedIn || DEMO) schedulePoll(200);
    }
  });

  // Tizen: registrer fargeknappene så de ikke lukker appen ved et uhell
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    }
  } catch (e) {}

  // ---------------------------------------------------------------- oppstart

  function start() {
    applyMat();
    applyLabel();
    applyDim();
    keepAwake();

    if (DEMO) {
      state.loggedIn = true;
      poll();
      return;
    }

    handleCallback().then(function () {
      state.loggedIn = !!tokens();
      if (state.loggedIn) {
        hideLogin();
        poll();
      } else {
        enterArt();
        showLogin();
      }
    });
  }

  start();
})();
