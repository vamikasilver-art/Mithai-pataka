  function updateVote() {
    var q = Q[qi], p = picks();
    $('#prog').innerHTML = Q.map(function (x, i) {
      var done = p[x.id] && playerName(p[x.id]);
      return '<button type="button" class="seg' + (done ? ' done' : '') + (i === qi ? ' cur' : '') + (i === 1 ? ' gap' : '') +
        '" data-i="' + i + '" aria-label="Question ' + (i + 1) + ': ' + esc(x.title) + '"></button>';
    }).join('');
    $('#cast').textContent = castCount() + ' of ' + NQ + ' votes cast';
    var inRound = Q.slice(0, qi).filter(function (x) { return x.round === q.round; }).length + 1;
    var roundTotal = Q.filter(function (x) { return x.round === q.round; }).length;
    $('#qcard').innerHTML =
      '<p class="qround">' + ROUNDS[q.round] + ' · ' + inRound + ' of ' + roundTotal + '</p>' +
      '<p class="qemoji" aria-hidden="true">' + q.emoji + '</p>' +
      '<p class="qprompt">' + (q.round === 1 ? 'Who is most like…' : esc(q.prompt)) + '</p>' +
      '<h2>' + esc(q.title) + '</h2><p class="qdesc">' + esc(q.desc) + '</p>';
    var others = S.players.filter(function (x) { return x.id !== S.me.id; });
    $('#cands').innerHTML = others.length ? others.map(function (x) {
      var on = p[q.id] === x.id;
      return '<button type="button" class="cand" data-id="' + x.id + '" aria-pressed="' + on + '"><span>' + esc(x.name) + '</span>' +
        (on ? '<span class="tick" aria-hidden="true">✓</span>' : '') + '</button>';
    }).join('') : '<p class="empty">No one else has joined yet. Share the link so the others can add their names.</p>';
    $('#backBtn').disabled = qi === 0;
    $('#nextBtn').textContent = qi === NQ - 1 ? 'See results' : (p[q.id] ? 'Next' : 'Skip');
  }
  function updateResults() {
    var rev = S.revealed || 0;
    var voted = S.players.filter(function (x) { return x.voted; }).length;
    $('#rhead').textContent = voted + ' of ' + S.players.length + ' people have voted · ' + rev + ' of ' + NQ + ' revealed';

    if (hostMode === 'on' && $('#revNext')) {
      $('#hostInfo').textContent = rev < NQ ? 'Next up: ' + Q[rev].title + '. Everyone’s screen updates within a few seconds.' : 'Everything is revealed.';
      $('#revNext').textContent = rev < NQ ? 'Reveal next' : 'All revealed';
      $('#revNext').disabled = rev >= NQ;
      $('#revAll').disabled = rev >= NQ;
      $('#revNone').disabled = rev === 0;
      $('#copyRes').disabled = rev === 0;
      $('#erase').textContent = eraseArmed ? 'Tap again to erase everything' : 'Erase all names and votes';
      $('#hostPeople').innerHTML = S.players.length ? S.players.map(function (x) {
        var n = esc(x.name);
        return x.id === armedRm
          ? '<li class="rm armed">Remove ' + n + '? <button type="button" class="x" data-rm="' + x.id + '">Yes</button></li>'
          : '<li class="rm">' + n + ' <button type="button" class="x" data-rm="' + x.id + '" aria-label="Remove ' + n + '">×</button></li>';
      }).join('') : '<li class="empty" style="background:none;padding:0">Nobody has joined.</li>';
    }

    var html = '', lastRound = -1;
    Q.forEach(function (q, i) {
      if (q.round !== lastRound) { html += '<h3 class="round">' + ROUNDS[q.round] + '</h3>'; lastRound = q.round; }
      if (i >= rev) {
        var n = (S.locked && S.locked[q.id]) || 0;
        html += '<article class="res locked" data-q="' + q.id + '"><b>' + esc(q.title) + '</b><span>Locked · ' + n + ' vote' + (n === 1 ? '' : 's') + ' in</span></article>';
        return;
      }
      var t = S.results[q.id] || { rows: [], voters: 0 };
      html += '<article class="res revealed" data-q="' + q.id + '"><p class="rl">' + q.emoji + ' ' + esc(q.title) + '</p>';
      if (!t.rows.length) {
        html += '<p class="win none">No votes</p>';
      } else {
        var top = t.rows[0].n;
        var winners = t.rows.filter(function (r) { return r.n === top; });
        var rest = t.rows.filter(function (r) { return r.n < top; }).slice(0, 3);
        html += '<p class="win">' + winners.map(function (w) { return esc(w.name); }).join(' &amp; ') + '</p>' +
          '<p class="wv">' + (winners.length > 1 ? 'Tie · ' : '') + top + ' vote' + (top === 1 ? '' : 's') + (winners.length > 1 ? ' each' : '') + '</p>';
        if (rest.length) {
          html += '<ul class="runners">' + rest.map(function (r) {
            return '<li><b>' + esc(r.name) + '</b><em>' + r.n + '</em><span class="bar"><i style="--w:' + Math.round(r.n / top * 100) + '%"></i></span></li>';
          }).join('') + '</ul>';
        }
      }
      html += '</article>';
    });
    $('#resList').innerHTML = html;

    var grew = lastRev !== null && rev > lastRev;
    lastRev = rev;
    if (grew) {
      var el = $('[data-q="' + Q[rev - 1].id + '"]');
      if (el) {
        el.classList.add('fresh');
        el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        var b = el.getBoundingClientRect();
        burst(b.left + b.width / 2, Math.min(Math.max(b.top + b.height / 2, 120), innerHeight - 120), 90);
      }
    }
  }

  // ---------- actions ----------
  function onJoin() {
    var inp = $('#nameIn'), err = $('#nameErr'), btn = $('#joinBtn');
    var name = inp.value.replace(/\s+/g, ' ').trim();
    function bad(m) { err.textContent = m; err.hidden = false; inp.focus(); }
    if (!name) return bad('Type your name to join.');
    btn.disabled = true;
    post('/api/join', { name: name, token: token }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) return bad(r.body.error || 'Could not join. Try again.');
      setToken(r.body.token); landed = false; tab = 'vote'; qi = 0; lastText = '';
      return poll().then(function () { burst(innerWidth / 2, innerHeight / 3, 80); });
    }).catch(function () { btn.disabled = false; bad('Could not reach the server. Try again.'); });
  }
  function onPick(pid) {
    var q = Q[qi];
    var p = S.me.picks;
    var next = p[q.id] === pid ? null : pid;
    if (next === null) delete p[q.id]; else p[q.id] = next;
    pending++; render();
    post('/api/vote', { token: token, q: q.id, pick: next }).then(function (r) {
      if (!r.ok) toast(r.body.error || 'That vote did not save.');
    }).catch(function () { toast('That vote did not save. Check your connection.'); })
      .then(function () { pending--; if (pending === 0) { lastText = ''; poll(); } });
  }
  function hostAct(action, extra) {
    var body = { key: hostKey, action: action };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    return post('/api/host', body).then(function (r) {
      if (!r.ok) { toast(r.body.error || 'Host action failed.'); if (r.status === 401) hostLogout(); return; }
      lastText = ''; return poll();
    }).catch(function () { toast('Could not reach the server.'); });
  }
  function hostLogout() {
    hostKey = null; try { sessionStorage.removeItem('mp-host'); } catch (e) {}
    hostMode = 'off'; buildHost(); if (S) update('results');
  }
  function copyResults() {
    var text = resultsText(), box = $('#copyBox');
    function fallback() { box.hidden = false; box.value = text; box.focus(); box.select(); toast('Select the text and copy it.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Results copied.'); }, fallback);
    } else fallback();
  }

  els.view.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'joinForm') onJoin();
    else if (e.target.id === 'hostForm') {
      var key = $('#hostIn').value, err = $('#hostErr');
      post('/api/host', { key: key, action: 'check' }).then(function (r) {
        if (!r.ok) { err.textContent = 'That key is not right.'; err.hidden = false; return; }
        hostKey = key; try { sessionStorage.setItem('mp-host', key); } catch (x) {}
        hostMode = 'on'; buildHost(); update('results');
      }).catch(function () { err.textContent = 'Could not reach the server.'; err.hidden = false; });
    }
  });
  els.view.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (armedRm && !t.dataset.rm) { armedRm = null; if (currentScreen() === 'results') update('results'); }
    if (eraseArmed && t.id !== 'erase') { eraseArmed = false; clearTimeout(eraseT); if (currentScreen() === 'results') update('results'); }

    if (t.dataset.rm) {
      if (armedRm === t.dataset.rm) { var id = armedRm; armedRm = null; hostAct('remove', { pid: id }); }
      else { armedRm = t.dataset.rm; update('results'); }
      return;
    }
    if (t.classList.contains('cand') && t.dataset.id) return onPick(t.dataset.id);
    if (t.classList.contains('seg')) { qi = +t.dataset.i; return render(); }
    switch (t.id) {
      case 'backBtn': if (qi > 0) { qi--; render(); window.scrollTo(0, 0); } break;
      case 'nextBtn':
        if (qi < NQ - 1) { qi++; render(); window.scrollTo(0, 0); }
        else { tab = 'results'; render(); window.scrollTo(0, 0); burst(innerWidth / 2, innerHeight / 3, 80); }
        break;
      case 'hostLogin': hostMode = 'form'; buildHost(); break;
      case 'hostCancel': hostMode = 'off'; buildHost(); break;
      case 'hostLogout': hostLogout(); break;
      case 'revNext': hostAct('reveal'); break;
      case 'revAll': hostAct('revealAll'); break;
      case 'revNone': hostAct('hide'); break;
      case 'copyRes': copyResults(); break;
      case 'erase':
        if (!eraseArmed) {
          eraseArmed = true; t.textContent = 'Tap again to erase everything';
          clearTimeout(eraseT); eraseT = setTimeout(function () { eraseArmed = false; if (currentScreen() === 'results') update('results'); }, 4000);
        } else {
          eraseArmed = false; clearTimeout(eraseT);
          hostAct('erase').then(function () { toast('Everything erased.'); });
        }
        break;
    }
  });
  els.tabs.addEventListener('click', function (e) {
    var t = e.target.closest('.tab'); if (!t) return;
    tab = t.dataset.tab; render(); window.scrollTo(0, 0);
  });

  // ---------- startup ----------
  fetch('/api/questions').then(function (r) { return r.json(); }).then(function (qs) {
    Q = qs; NQ = qs.length;
    render();
    poll();
    setInterval(poll, 2500);
  }).catch(function () { offline = true; chrome(); els.view.innerHTML = '<p class="muted center" style="padding:3rem 0">Cannot reach the server. Reload to try again.</p>'; });
})();
      
