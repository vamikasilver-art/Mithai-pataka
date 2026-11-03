(function () {
  'use strict';

  var ROUNDS = ['Costume round', 'Pataka round'];
  var Q = [], NQ = 0;
  var S = null;                 // latest state from the server
  var token = null;
  var tab = 'vote', qi = 0, built = '', landed = false, lastRev = null;
  var pending = 0;              // votes being sent; hold off on server picks while > 0
  var offline = false, lastText = '';
  var hostKey = null, hostMode = 'off', armedRm = null, eraseArmed = false, eraseT = 0;

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = { view: $('#view'), tabs: $('#tabs'), banner: $('#banner'), toast: $('#toast'), meName: $('#meName') };

  try { token = localStorage.getItem('mp-token'); } catch (e) {}
  try { hostKey = sessionStorage.getItem('mp-host'); } catch (e) {}
  function setToken(t) { token = t; try { localStorage.setItem('mp-token', t); } catch (e) {} }

  // ---------- effects ----------
  var cv = $('#fx'), cx = cv.getContext('2d'), parts = [], raf = 0;
  function fit() { var r = window.devicePixelRatio || 1; cv.width = innerWidth * r; cv.height = innerHeight * r; }
  addEventListener('resize', fit); fit();
  function burst(x, y, n) {
    if (reduced) return;
    var r = window.devicePixelRatio || 1, cols = ['#ffb020', '#ff4d8d', '#5ed6a4', '#fbf1dc'];
    for (var i = 0; i < (n || 70); i++) {
      var a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      parts.push({ x: x * r, y: y * r, vx: Math.cos(a) * s * r, vy: Math.sin(a) * s * r, life: 1, c: cols[i % 4], r: (1.5 + Math.random() * 2) * r });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    var g = window.devicePixelRatio || 1;
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter(function (p) { return p.life > 0; });
    parts.forEach(function (p) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06 * g; p.vx *= 0.985; p.life -= 0.014;
      cx.globalAlpha = Math.max(p.life, 0); cx.fillStyle = p.c;
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.fill();
    });
    cx.globalAlpha = 1;
    if (parts.length) raf = requestAnimationFrame(tick); else { raf = 0; cx.clearRect(0, 0, cv.width, cv.height); }
  }
  var toastT = 0;
  function toast(m) {
    els.toast.textContent = m; els.toast.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { els.toast.classList.remove('on'); }, 3000);
  }

  // ---------- server ----------
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }
  function poll() {
    return fetch('/api/state', { headers: { 'x-token': token || '' }, cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        offline = false;
        if (pending > 0) return;
        if (text === lastText && S) { chrome(); return; }
        lastText = text; S = JSON.parse(text); render();
      })
      .catch(function () { offline = true; chrome(); });
  }

  // ---------- helpers ----------
  function picks() { return (S && S.me && S.me.picks) || {}; }
  function playerName(id) { for (var i = 0; i < S.players.length; i++) if (S.players[i].id === id) return S.players[i].name; return null; }
  function castCount() {
    var p = picks();
    return Q.filter(function (q) { return p[q.id] && playerName(p[q.id]); }).length;
  }
  function resultsText() {
    var lines = ['Mithai & Pataka results'];
    Q.forEach(function (q, i) {
      if (i >= S.revealed) return;
      var t = S.results[q.id];
      if (!t || !t.rows.length) { lines.push(q.title + ': no votes'); return; }
      var top = t.rows[0].n;
      var w = t.rows.filter(function (r) { return r.n === top; }).map(function (r) { return r.name; }).join(' & ');
      lines.push(q.title + ': ' + w + ' (' + top + ' vote' + (top === 1 ? '' : 's') + ')');
    });
    return lines.join('\n');
  }

  // ---------- screens ----------
  function currentScreen() {
    if (!S) return 'loading';
    if (!S.me) return 'join';
    return tab;
  }
  function render() {
    var s = currentScreen();
    if (!S || !S.me) { if (token && S) { try { localStorage.removeItem('mp-token'); } catch (e) {} token = null; } landed = false; }
    if ((s === 'vote' || s === 'results') && !landed) {
      landed = true;
      var p = picks(), first = -1;
      for (var i = 0; i < NQ; i++) { if (!p[Q[i].id]) { first = i; break; } }
      if (first === -1) tab = 'results'; else { qi = first; tab = 'vote'; }
      s = currentScreen();
    }
    if (s !== built) { build(s); built = s; }
    chrome(s);
    update(s);
  }
  function chrome(s) {
    s = s || currentScreen();
    var tabbed = s === 'vote' || s === 'results';
    els.tabs.hidden = !tabbed;
    if (tabbed) {
      els.tabs.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.tab === s)); });
      els.meName.textContent = S.me.name;
    }
    els.banner.hidden = !offline;
    els.banner.textContent = offline ? 'Cannot reach the server. Retrying…' : '';
  }
  function build(s) {
    var v = els.view;
    hostMode = hostKey ? 'on' : 'off';
    if (s === 'loading') {
      v.innerHTML = '<p class="muted center" style="padding:3rem 0">Getting the party ready…</p>';
    } else if (s === 'join') {
      v.innerHTML =
        '<div class="card"><p class="lede">Dress as your favourite mithai. Vote for the best and the lamest, then pick who is most like each pataka.</p>' +
        '<form id="joinForm" novalidate><label for="nameIn">Your name</label>' +
        '<input type="text" id="nameIn" maxlength="24" autocomplete="off" autocapitalize="words" placeholder="First name and last initial">' +
        '<p class="err" id="nameErr" hidden></p></form>' +
        '<button class="btn primary block" type="submit" form="joinForm" id="joinBtn">Join the party</button></div>' +
        '<section class="who"><h2 class="round" id="whoCount"></h2><ul class="chips" id="whoList"></ul></section>';
    } else if (s === 'vote') {
      v.innerHTML =
        '<div class="progress" id="prog"></div><p class="cast" id="cast"></p>' +
        '<article class="qcard" id="qcard"></article><div class="cands" id="cands"></div>' +
        '<div class="votebar"><button class="btn ghost" type="button" id="backBtn">Back</button>' +
        '<button class="btn primary" type="button" id="nextBtn">Next</button></div>';
    } else if (s === 'results') {
      v.innerHTML = '<p class="rhead" id="rhead"></p><div id="hostArea"></div><div id="resList"></div>' +
        '<p class="center" style="margin-top:1.5rem" id="hostLinkRow"><button class="linkbtn" type="button" id="hostLogin">Host login</button></p>';
      buildHost();
    }
  }
  function buildHost() {
    var a = $('#hostArea'); if (!a) return;
    $('#hostLinkRow').hidden = hostMode === 'on';
    if (hostMode === 'on') {
      a.innerHTML =
        '<details class="host" open><summary>Host controls</summary><div class="hostBody">' +
        '<p class="note" id="hostInfo"></p><div class="row"><button class="btn primary sm" type="button" id="revNext"></button>' +
        '<button class="btn ghost sm" type="button" id="revAll">Reveal all</button>' +
        '<button class="btn ghost sm" type="button" id="revNone">Hide all</button>' +
        '<button class="btn ghost sm" type="button" id="copyRes">Copy results</button></div>' +
        '<textarea id="copyBox" readonly hidden aria-label="Results text"></textarea>' +
        '<h3 class="round" style="margin:.5rem 0 0">People (tap × to remove)</h3><ul class="chips" id="hostPeople"></ul>' +
        '<div class="row"><button class="btn danger sm" type="button" id="erase">Erase all names and votes</button>' +
        '<button class="btn ghost sm" type="button" id="hostLogout">Log out</button></div></div></details>';
    } else if (hostMode === 'form') {
      a.innerHTML = '<form class="hostForm" id="hostForm"><label for="hostIn">Host key</label>' +
        '<input type="password" id="hostIn" autocomplete="off"><p class="err" id="hostErr" hidden></p>' +
        '<div class="row" style="display:flex;gap:.5rem"><button class="btn primary sm" type="submit">Log in</button>' +
        '<button class="btn ghost sm" type="button" id="hostCancel">Cancel</button></div></form>';
      $('#hostIn').focus();
    } else a.innerHTML = '';
  }
  function update(s) {
    if (s === 'join') updateJoin();
    else if (s === 'vote') updateVote();
    else if (s === 'results') updateResults();
  }
  function updateJoin() {
    $('#whoCount').textContent = S.players.length === 1 ? '1 person in the room' : S.players.length + ' people in the room';
    $('#whoList').innerHTML = S.players.length
      ? S.players.map(function (p) { return '<li>' + esc(p.name) + '</li>'; }).join('')
      : '<li class="empty" style="background:none;padding:0">Nobody yet. You are first.</li>';
      }
        
