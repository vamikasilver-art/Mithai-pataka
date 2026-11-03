'use strict';
// Mithai & Pataka voting server. No dependencies: needs Node 16 or newer.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const QUESTIONS = [
 {
  "id": "best",
  "round": 0,
  "emoji": "🏆",
  "title": "Best Dressed Mithai",
  "prompt": "Who nailed their mithai costume?",
  "desc": "The outfit that made everyone hungry."
 },
 {
  "id": "lame",
  "round": 0,
  "emoji": "😂",
  "title": "Lamest Dressed Mithai",
  "prompt": "Whose mithai costume fell flat?",
  "desc": "Least effort, biggest laugh. All in good fun."
 },
 {
  "id": "fuljhari",
  "round": 1,
  "emoji": "✨",
  "title": "Fuljhari",
  "desc": "Small, sparkly, and effortlessly charming. Always happy and optimistic, even on the most stressful day."
 },
 {
  "id": "atombomb",
  "round": 1,
  "emoji": "💣",
  "title": "Atom Bomb",
  "desc": "Quietly sits in a corner, then drops one comment that leaves the entire room in splits."
 },
 {
  "id": "ladi",
  "round": 1,
  "emoji": "🎊",
  "title": "Ladi (Chain Cracker)",
  "desc": "The team connector. Starts one conversation and suddenly the whole department is buzzing and building on each other’s ideas."
 },
 {
  "id": "anar",
  "round": 1,
  "emoji": "🌸",
  "title": "Anar",
  "desc": "Silent for the first 40 minutes of the meeting, then drops the idea everyone ends up building on."
 },
 {
  "id": "chakri",
  "round": 1,
  "emoji": "🌀",
  "title": "Chakri",
  "desc": "Never sits still. Spinning between conversations, snack tables, and the dance floor, and nobody knows how they got there."
 },
 {
  "id": "tikli",
  "round": 1,
  "emoji": "🔫",
  "title": "Tikli Roll (Cap Gun)",
  "desc": "Always stressed. Pop, pop, pop: “I’m so behind,” “so much on my plate,” “I haven’t even looked at that yet.” Constant, tiny, and somehow never runs out."
 },
 {
  "id": "saanp",
  "round": 1,
  "emoji": "🐍",
  "title": "Saanp Goli (Snake Tablet)",
  "desc": "Tiny brief goes in, a massive 40-slide deck comes out. Nobody knows how it happened, but it’s impressive and slightly alarming."
 },
 {
  "id": "lakshmi",
  "round": 1,
  "emoji": "🪔",
  "title": "Lakshmi Bomb",
  "desc": "The dependable one. Deadlines met, decks formatted, every action item followed up. Loud about it too."
 },
 {
  "id": "bijli",
  "round": 1,
  "emoji": "⚡",
  "title": "Bijli Pataka",
  "desc": "Rapid-fire jokes, one after another, so fast you only realise how funny they were five minutes later."
 },
 {
  "id": "phuss",
  "round": 1,
  "emoji": "💤",
  "title": "Phuss Pataka",
  "desc": "Big buildup (“I have a huge idea”), full drumroll, and then… “let’s circle back next week.” Loved anyway."
 }
];
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const PAGE = read('index.html');
const APP = read('app-1.js') + '\n' + read('app-2.js');
const QIDS = new Set(QUESTIONS.map((q) => q.id));
const NQ = QUESTIONS.length;

// ---------- storage: memory, mirrored to a JSON file ----------
let db = { players: {}, tokens: {}, ballots: {}, revealed: 0 };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(db), (err) => {
      if (!err) fs.rename(DATA_FILE + '.tmp', DATA_FILE, () => {});
    });
  }, 200);
}

// ---------- helpers ----------
const newId = (n) => crypto.randomBytes(n).toString('hex');
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 10000) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
function castCount(pid) {
  const picks = (db.ballots[pid] && db.ballots[pid].picks) || {};
  return QUESTIONS.filter((q) => picks[q.id] && db.players[picks[q.id]]).length;
}
function tally(qid) {
  const counts = {};
  let voters = 0;
  Object.keys(db.ballots).forEach((bid) => {
    const p = (db.ballots[bid].picks || {})[qid];
    if (!p || p === bid || !db.players[p] || !db.players[bid]) return;
    counts[p] = (counts[p] || 0) + 1;
    voters++;
  });
  const rows = Object.keys(counts)
    .map((id) => ({ name: db.players[id].name, n: counts[id] }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { rows, voters };
}
function stateFor(token) {
  const pid = token && db.tokens[token];
  const me = pid && db.players[pid] ? pid : null;
  const players = Object.keys(db.players)
    .map((id) => ({ id, name: db.players[id].name, voted: castCount(id) > 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const results = {};
  const locked = {};
  QUESTIONS.forEach((q, i) => {
    const t = tally(q.id);
    if (i < db.revealed) results[q.id] = t; else locked[q.id] = t.voters;
  });
  return {
    players,
    revealed: db.revealed,
    results,
    locked,
    me: me ? { id: me, name: db.players[me].name, picks: (db.ballots[me] && db.ballots[me].picks) || {} } : null
  };
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && p === '/app.js') return send(res, 200, APP, 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && p === '/api/questions') return send(res, 200, QUESTIONS);
  if (req.method === 'GET' && p === '/api/state') return send(res, 200, stateFor(req.headers['x-token']));

  if (req.method === 'POST' && p === '/api/join') {
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'Bad request.' });
    if (b.token && db.tokens[b.token] && db.players[db.tokens[b.token]]) {
      return send(res, 200, { token: b.token, id: db.tokens[b.token] });
    }
    const name = String(b.name || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!name) return send(res, 400, { error: 'Type your name to join.' });
    const dup = Object.keys(db.players).some((id) => db.players[id].name.toLowerCase() === name.toLowerCase());
    if (dup) return send(res, 409, { error: name + ' already joined. Add your last initial.' });
    if (Object.keys(db.players).length >= 400) return send(res, 429, { error: 'The room is full.' });
    const id = 'p' + newId(4);
    const token = newId(16);
    db.players[id] = { name, at: Date.now() };
    db.tokens[token] = id;
    save();
    return send(res, 200, { token, id });
  }

  if (req.method === 'POST' && p === '/api/vote') {
    const b = await readBody(req);
    const pid = b && db.tokens[b.token];
    if (!pid || !db.players[pid]) return send(res, 401, { error: 'Join first.' });
    if (!QIDS.has(b.q)) return send(res, 400, { error: 'Unknown question.' });
    if (b.pick !== null && (typeof b.pick !== 'string' || !db.players[b.pick] || b.pick === pid)) {
      return send(res, 400, { error: 'Pick someone else from the list.' });
    }
    if (!db.ballots[pid]) db.ballots[pid] = { picks: {} };
    if (b.pick === null) delete db.ballots[pid].picks[b.q]; else db.ballots[pid].picks[b.q] = b.pick;
    save();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/host') {
    const b = await readBody(req);
    if (!b || !safeEq(b.key || '', HOST_KEY)) return send(res, 401, { error: 'Wrong host key.' });
    switch (b.action) {
      case 'check': break;
      case 'reveal': db.revealed = Math.min(NQ, db.revealed + 1); break;
      case 'revealAll': db.revealed = NQ; break;
      case 'hide': db.revealed = 0; break;
      case 'remove':
        if (db.players[b.pid]) {
          delete db.players[b.pid];
          delete db.ballots[b.pid];
          Object.keys(db.tokens).forEach((t) => { if (db.tokens[t] === b.pid) delete db.tokens[t]; });
        }
        break;
      case 'erase': db = { players: {}, tokens: {}, ballots: {}, revealed: 0 }; break;
      default: return send(res, 400, { error: 'Unknown action.' });
    }
    save();
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found.' });
}

http.createServer((req, res) => {
  handle(req, res).catch(() => send(res, 500, { error: 'Server error.' }));
}).listen(PORT, () => {
  console.log('Mithai & Pataka is running on port ' + PORT);
  console.log('Host key: ' + HOST_KEY + (process.env.HOST_KEY ? '' : '  (random; set HOST_KEY to choose your own)'));
});
                                    
