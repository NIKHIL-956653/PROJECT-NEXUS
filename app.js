/* =============================================================================
   PROJECT NEXUS — voice-first project log
   Vanilla JS. State in localStorage. Voice via Web Speech API.
   ========================================================================== */
'use strict';

var ENV = window.NEXUS_ENV || 'standalone';
var KEY = 'nexus.state.v1';
var DAY = 86400000;
var IDLE_DAYS = 3;        // project considered idle after this many days
var CLEAN_DAYS = 10;      // auto-cleanup window
var UNDO_MS = 5000;
var HUES = ['#00d4ff', '#b377ff', '#3ddc97', '#ffb13d', '#ff5775', '#49a7ff'];

/* ---- tiny helpers -------------------------------------------------------- */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function startOfDay(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function daysAgo(t) { return Math.floor((startOfDay(Date.now()) - startOfDay(t)) / DAY); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function hhmmss(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function dayLabel(t) {
  var d = daysAgo(t);
  if (d === 0) return 'TODAY';
  if (d === 1) return 'YESTERDAY';
  var dt = new Date(t);
  var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return days[dt.getDay()] + ' ' + dt.getDate() + ' ' + mon[dt.getMonth()];
}
function agoLabel(t) {
  if (!t) return 'NEVER';
  var d = daysAgo(t);
  if (d === 0) return 'TODAY';
  if (d === 1) return '1D AGO';
  return d + 'D AGO';
}
function idleClass(t) {
  if (!t) return 'hot';
  var d = daysAgo(t);
  if (d <= 1) return 'live';
  if (d < IDLE_DAYS) return 'cool';
  if (d < 7) return 'warm';
  return 'hot';
}
function initials(name) {
  var parts = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return 'PRJ';
  if (parts.length === 1) return parts[0].slice(0, 3);
  return (parts[0][0] + parts[1][0] + (parts[2] ? parts[2][0] : '')).slice(0, 3);
}

/* ---- state --------------------------------------------------------------- */
var S = null;

function defaults() {
  return {
    seq: 1,
    projects: [],
    notes: [],
    settings: { sound: true, sysNotify: false, lang: 'en-US' },
    ui: { active: null, q: '', fproj: '', fvoice: false, pane: 'roster' }
  };
}

function load() {
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var p = JSON.parse(raw);
      if (p && p.projects && p.notes) {
        var d = defaults();
        p.settings = Object.assign(d.settings, p.settings || {});
        p.ui = Object.assign(d.ui, p.ui || {});
        p.seq = p.seq || p.projects.length + 1;
        purgeSampleRecords(p);
        return p;
      }
    }
  } catch (e) { /* unreadable storage — start empty */ }
  return defaults();
}

/* Earlier builds shipped sample records flagged demo:true. Remove them from saved state.
   A sample project that has since received a real (unflagged) entry is kept, minus the flag. */
var purgedSamples = false;
function purgeSampleRecords(st) {
  var realPids = Object.create(null);
  st.notes.forEach(function (n) { if (!n.demo) realPids[n.pid] = 1; });
  var before = st.projects.length + st.notes.length;
  st.notes = st.notes.filter(function (n) { return !n.demo; });
  st.projects = st.projects.filter(function (p) {
    if (!p.demo) return true;
    if (realPids[p.id]) { delete p.demo; return true; }
    return false;
  });
  st.notes.forEach(function (n) { delete n.demo; });
  var ids = Object.create(null);
  st.projects.forEach(function (p) { ids[p.id] = 1; });
  if (st.ui && st.ui.active && !ids[st.ui.active]) st.ui.active = null;
  if (st.ui && st.ui.fproj && !ids[st.ui.fproj]) st.ui.fproj = '';
  if (st.projects.length + st.notes.length !== before) purgedSamples = true;
}

var saveTimer = null;
var storageOK = true;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
      if (!storageOK) { storageOK = true; }
    } catch (e) {
      if (storageOK) { storageOK = false; popup('crit', 'STORAGE FAULT', 'Entries cannot be saved in this browser session. Copy anything important out before closing.'); }
    }
  }, 120);
}

/* ---- lookups ------------------------------------------------------------- */
function proj(id) { for (var i = 0; i < S.projects.length; i++) if (S.projects[i].id === id) return S.projects[i]; return null; }
function active() { return proj(S.ui.active); }
function notesOf(id) { return S.notes.filter(function (n) { return n.pid === id; }); }
function sortedNotes() { return S.notes.slice().sort(function (a, b) { return b.at - a.at; }); }

/* ---- rendering: status bar ---------------------------------------------- */
function renderStatus() {
  var on = navigator.onLine;
  var link = $('#rd-link');
  link.textContent = on ? 'SECURE' : 'LOCAL';
  link.className = on ? 'ok' : 'warn';
  $('#linkword').textContent = on ? 'ONLINE' : 'OFFLINE';
  $('#pulsedot').className = 'pulsedot' + (on ? '' : ' off');
  $('#rd-count').textContent = S.notes.length;
  var badge = $('#nav-badge');
  if (badge) { badge.hidden = S.notes.length === 0; badge.textContent = S.notes.length; }
}
function setVoiceStatus(text, cls) {
  var el = $('#rd-voice');
  el.textContent = text;
  el.className = cls || '';
}
function setCacheStatus(text, cls) {
  var el = $('#rd-cache');
  el.textContent = text;
  el.className = cls || '';
}

var ICON_HEX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7"/><path d="M12 22V12M3 7l9 5 9-5"/></svg>';
var ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';

/* ---- rendering: roster --------------------------------------------------- */
function renderRoster() {
  var list = $('#rosterlist');
  if (!S.projects.length) {
    list.innerHTML = '<div class="empty mini"><div class="inner">' + ICON_HEX +
      '<h3>NO PROJECTS YET</h3>' +
      '<p>Hit <b style="color:var(--cyan)">+ NEW</b> to register your first one. Each project keeps its own log.</p></div></div>';
  } else {
    var order = S.projects.slice().sort(function (a, b) { return (b.lastWorked || b.createdAt) - (a.lastWorked || a.createdAt); });
    list.innerHTML = order.map(function (p) {
      var n = notesOf(p.id).length;
      var ic = idleClass(p.lastWorked);
      return '<button class="proj' + (p.id === S.ui.active ? ' active' : '') + '" data-pid="' + p.id + '" style="--pc:' + p.hue + '">' +
        '<span class="pname">' + esc(p.name) + '</span>' +
        '<span class="pmeta">' +
          '<span class="n">' + n + ' LOG' + (n === 1 ? '' : 'S') + '</span>' +
          '<span class="idle ' + ic + '">' + agoLabel(p.lastWorked) + '</span>' +
          (p.autoClean ? '<span class="idle cool" title="Auto-delete after 10 days">AC</span>' : '') +
        '</span></button>';
    }).join('');
  }
  $('#roster-count').textContent = S.projects.length + ' ACTIVE';

  var sel = $('#fproj'), cur = S.ui.fproj;
  sel.innerHTML = '<option value="">ALL PROJECTS</option>' + S.projects.map(function (p) {
    return '<option value="' + p.id + '">' + esc(p.name.toUpperCase()) + '</option>';
  }).join('');
  sel.value = cur;
}

/* ---- rendering: console -------------------------------------------------- */
function renderConsole() {
  var p = active();
  $('#console-empty').hidden = !!p;
  $('#console-scroll').hidden = !p;
  if (!p) { $('#console-code').textContent = 'NO PROJECT SELECTED'; return; }

  var ns = notesOf(p.id).sort(function (a, b) { return b.at - a.at; });
  var voice = ns.filter(function (n) { return n.src === 'voice'; });
  var week = ns.filter(function (n) { return n.at > Date.now() - 7 * DAY; });

  $('#console-code').textContent = p.code + ' · ' + agoLabel(p.lastWorked);
  $('#c-name').textContent = p.name;
  $('#c-sub').textContent = p.code + '  ·  OPENED ' + new Date(p.createdAt).toISOString().slice(0, 10) + '  ·  LAST ENTRY ' + agoLabel(p.lastWorked);
  $('#cap-target').textContent = p.name.toUpperCase();
  $('#autoclean').checked = !!p.autoClean;

  $('#c-stats').innerHTML =
    tile(ns.length, 'TOTAL ENTRIES') +
    tile(voice.length, 'VOICE', 'voice') +
    tile(week.length, 'LAST 7 DAYS') +
    tile(agoLabel(p.lastWorked), 'LAST WORKED');

  // 14-day activity
  var counts = [], max = 0;
  for (var i = 13; i >= 0; i--) {
    var d0 = startOfDay(Date.now() - i * DAY), d1 = d0 + DAY;
    var c = ns.filter(function (n) { return n.at >= d0 && n.at < d1; }).length;
    counts.push(c); if (c > max) max = c;
  }
  $('#spark-max').textContent = 'PEAK ' + max;
  $('#spark').innerHTML = counts.map(function (c, i) {
    var h = max ? Math.max(3, Math.round(c / max * 40)) : 3;
    return '<span class="' + (c ? (i === 13 ? 'today' : '') : 'zero') + '" style="height:' + h + 'px" title="' + c + ' on day -' + (13 - i) + '"></span>';
  }).join('');

  $('#recentlist').innerHTML = ns.length
    ? ns.slice(0, 4).map(function (n) {
        return '<div class="rnote' + (n.src === 'voice' ? ' v' : '') + '">' +
          '<div class="rt"><span>' + dayLabel(n.at) + ' ' + hhmm(n.at) + '</span><span>' +
          (n.src === 'voice' ? 'VOICE' + (n.conf ? ' · ' + Math.round(n.conf * 100) + '%' : '') : 'TYPED') + '</span></div>' +
          '<div class="txt">' + esc(n.text) + '</div></div>';
      }).join('')
    : '<div style="font-size:13px;color:var(--ink-faint)">Nothing logged yet. Hit the mic or type below.</div>';
}
function tile(v, k, cls) {
  return '<div class="tile"><div class="v ' + (cls || '') + '">' + esc(v) + '</div><div class="k">' + k + '</div></div>';
}

/* ---- rendering: history -------------------------------------------------- */
var selectMode = false;
var selected = Object.create(null);

function filteredNotes() {
  var q = S.ui.q.trim().toLowerCase();
  return sortedNotes().filter(function (n) {
    if (S.ui.fvoice && n.src !== 'voice') return false;
    if (S.ui.fproj && n.pid !== S.ui.fproj) return false;
    if (q) {
      var p = proj(n.pid);
      var hay = (n.text + ' ' + (p ? p.name : '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function renderHistory() {
  var list = filteredNotes();
  var tl = $('#timeline');
  $('#log-count').textContent = list.length + ' ENTR' + (list.length === 1 ? 'Y' : 'IES') +
    (list.length !== S.notes.length ? ' / ' + S.notes.length : '');

  if (!list.length) {
    tl.innerHTML = '<div class="empty mini"><div class="inner">' + ICON_CLOCK +
      (S.notes.length
        ? '<h3>NO MATCHES</h3><p>No entries fit this filter. Clear the search or switch project.</p>'
        : '<h3>LOG IS CLEAR</h3><p>Everything you speak or type, across all projects, lands here as a timeline.</p>') +
      '</div></div>';
    updateBulk();
    return;
  }

  var html = '', lastDay = '';
  for (var i = 0; i < list.length; i++) {
    var n = list[i], p = proj(n.pid) || { name: 'REMOVED', hue: '#5a6782', code: '—' };
    var dl = dayLabel(n.at);
    if (dl !== lastDay) { html += '<div class="daysep">' + dl + '</div>'; lastDay = dl; }
    var cf = '';
    if (n.src === 'voice' && typeof n.conf === 'number' && n.conf > 0) {
      var cc = n.conf >= 0.85 ? 'good' : n.conf >= 0.6 ? 'mid' : 'low';
      cf = '<span class="cf ' + cc + '">' + Math.round(n.conf * 100) + '%</span>';
    }
    html += '<div class="ewrap">' +
      '<div class="delback">DELETE</div>' +
      '<div class="entry' + (n.src === 'voice' ? ' v' : '') + (selected[n.id] ? ' sel' : '') + '" data-id="' + n.id + '" style="--pc:' + p.hue + '">' +
        (selectMode ? '<input type="checkbox" class="box" ' + (selected[n.id] ? 'checked' : '') + ' aria-label="Select entry">' : '') +
        '<span class="src">' + (n.src === 'voice' ? ICON_MIC : ICON_TXT) + '</span>' +
        '<div class="ebody">' +
          '<div class="emeta"><span class="pn">' + esc(p.name.toUpperCase()) + '</span><span>' + hhmm(n.at) + '</span>' + cf + '</div>' +
          '<div class="etext">' + esc(n.text) + '</div>' +
        '</div>' +
      '</div></div>';
  }
  tl.innerHTML = html;
  updateBulk();
}
var ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>';
var ICON_TXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M4 12h11M4 17h7"/></svg>';

function updateBulk() {
  var ids = Object.keys(selected);
  $('#bulkbar').hidden = !selectMode;
  $('#bulkcount').textContent = ids.length + ' SELECTED';
  $('#btn-select').classList.toggle('on', selectMode);
}

function renderAll() { renderRoster(); renderConsole(); renderHistory(); renderStatus(); }

/* ---- audio --------------------------------------------------------------- */
var actx = null, gestured = false;
function markGesture() { gestured = true; }
function audio() {
  if (!S.settings.sound || !gestured) return null;
  try {
    if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch (e) { return null; }
}
function beep(kind) {
  var ctx = audio(); if (!ctx) return;
  var t0 = ctx.currentTime;
  var seq = kind === 'alert' ? [[880, 0], [660, 0.1]]
    : kind === 'ok' ? [[520, 0], [780, 0.07]]
    : kind === 'bad' ? [[300, 0], [190, 0.1]]
    : [[660, 0]];
  var filt = ctx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = 2600;
  filt.connect(ctx.destination);
  seq.forEach(function (s) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(s[0], t0 + s[1]);
    g.gain.setValueAtTime(0.0001, t0 + s[1]);
    g.gain.exponentialRampToValueAtTime(0.085, t0 + s[1] + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + s[1] + 0.16);
    o.connect(g); g.connect(filt);
    o.start(t0 + s[1]); o.stop(t0 + s[1] + 0.2);
  });
}

/* ---- holographic notifications ------------------------------------------- */
function popup(kind, title, body, opts) {
  opts = opts || {};
  var life = opts.life || 9000;
  var el = document.createElement('div');
  el.className = 'hpop ' + (kind === 'alert' ? 'warn' : kind);
  el.innerHTML = '<button class="px" aria-label="Dismiss">&times;</button>' +
    '<div class="ptitle"><span class="pdot"></span>' + esc(title) + '</div>' +
    '<div class="pbody">' + body + '</div>' +
    (opts.foot ? '<div class="pfoot">' + esc(opts.foot) + '</div>' : '') +
    '<div class="life"></div>';
  $('.life', el).style.animationDuration = life + 'ms';
  $('#popups').appendChild(el);

  var done = false;
  function close() {
    if (done) return; done = true;
    el.classList.add('out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }
  var timer = setTimeout(close, life);
  $('.px', el).addEventListener('click', function (e) { e.stopPropagation(); clearTimeout(timer); close(); });
  el.addEventListener('click', function () { clearTimeout(timer); close(); if (opts.onClick) opts.onClick(); });
  if (kind !== 'ok') beep(kind === 'crit' ? 'bad' : 'alert'); else beep('ok');

  if (opts.system && S.settings.sysNotify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('NEXUS · ' + title, { body: String(body).replace(/<[^>]+>/g, ''), tag: opts.tag || title }); } catch (e) {}
  }
  return close;
}

/* ---- notes --------------------------------------------------------------- */
function addNote(pid, text, src, conf) {
  text = String(text).trim();
  if (!text) return null;
  var p = proj(pid); if (!p) return null;
  var n = { id: uid(), pid: pid, text: text, src: src, conf: (typeof conf === 'number' && conf > 0) ? conf : null, at: Date.now() };
  S.notes.unshift(n);
  p.lastWorked = n.at;
  save();
  return n;
}

/* ---- delete + undo ------------------------------------------------------- */
var pending = null;
function deleteNotes(ids, label) {
  if (!ids.length) return;
  var removed = [];
  S.notes = S.notes.filter(function (n) {
    if (ids.indexOf(n.id) > -1) { removed.push(n); return false; }
    return true;
  });
  if (!removed.length) return;
  save(); renderAll();
  offerUndo({ notes: removed, projects: [] }, label || (removed.length + ' ENTR' + (removed.length === 1 ? 'Y' : 'IES') + ' DELETED'));
}
function deleteProject(pid) {
  var p = proj(pid); if (!p) return;
  var removedNotes = S.notes.filter(function (n) { return n.pid === pid; });
  S.notes = S.notes.filter(function (n) { return n.pid !== pid; });
  S.projects = S.projects.filter(function (x) { return x.id !== pid; });
  if (S.ui.active === pid) S.ui.active = S.projects.length ? S.projects[0].id : null;
  if (S.ui.fproj === pid) S.ui.fproj = '';
  save(); renderAll();
  offerUndo({ notes: removedNotes, projects: [p] }, 'PROJECT ' + p.code + ' DELETED');
}
function offerUndo(payload, label) {
  commitPending();
  pending = payload;
  var t = $('#toast');
  t.hidden = false;
  t.innerHTML =
    '<svg class="ring" viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15"/>' +
    '<circle class="fg" cx="18" cy="18" r="15" stroke-dasharray="94.2" stroke-dashoffset="0"/></svg>' +
    '<div class="msg">' + esc(label) + '<small>RESTORE WITHIN 5 SECONDS</small></div>' +
    '<button class="minibtn" id="btn-undo">UNDO</button>';
  var ring = $('.fg', t);
  try { ring.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 94.2 }], { duration: UNDO_MS, easing: 'linear', fill: 'forwards' }); } catch (e) {}
  $('#btn-undo').onclick = undoDelete;
  clearTimeout(offerUndo._t);
  offerUndo._t = setTimeout(commitPending, UNDO_MS);
  beep('soft');
}
function commitPending() { pending = null; $('#toast').hidden = true; clearTimeout(offerUndo._t); }
function undoDelete() {
  if (!pending) return;
  pending.projects.forEach(function (p) { if (!proj(p.id)) S.projects.push(p); });
  pending.notes.forEach(function (n) { if (!S.notes.some(function (x) { return x.id === n.id; })) S.notes.push(n); });
  S.projects.forEach(function (p) {
    var ns = notesOf(p.id);
    p.lastWorked = ns.length ? Math.max.apply(null, ns.map(function (n) { return n.at; })) : p.lastWorked;
  });
  commitPending(); save(); renderAll();
  popup('ok', 'RESTORED', 'Entries are back in the log.', { life: 3500 });
}

/* ---- auto cleanup -------------------------------------------------------- */
function runAutoClean() {
  var cutoff = Date.now() - CLEAN_DAYS * DAY;
  var ids = S.notes.filter(function (n) {
    var p = proj(n.pid);
    return p && p.autoClean && n.at < cutoff;
  }).map(function (n) { return n.id; });
  if (!ids.length) return;
  S.notes = S.notes.filter(function (n) { return ids.indexOf(n.id) === -1; });
  save();
  popup('alert', 'AUTO-CLEANUP', '<b>' + ids.length + '</b> entr' + (ids.length === 1 ? 'y' : 'ies') + ' older than ' + CLEAN_DAYS + ' days were purged from flagged projects.', { life: 7000 });
}

/* ---- idle project alerts -------------------------------------------------- */
var alertedToday = Object.create(null);
function scanAlerts() {
  S.projects.forEach(function (p) {
    if (!p.lastWorked) return;
    var d = daysAgo(p.lastWorked);
    if (d < IDLE_DAYS) return;
    var key = p.id + ':' + startOfDay(Date.now());
    if (alertedToday[key]) return;
    alertedToday[key] = 1;
    popup(d >= 7 ? 'crit' : 'alert', 'PROJECT ALERT',
      '<b>' + esc(p.name) + '</b> — last worked ' + d + ' days ago.',
      { foot: 'CLICK TO OPEN CONSOLE', life: 11000, system: true, tag: 'idle-' + p.id, onClick: function () { selectProject(p.id); goPane('console'); } });
  });
}

/* ---- voice --------------------------------------------------------------- */
var Voice = {
  SR: window.SpeechRecognition || window.webkitSpeechRecognition,
  rec: null,
  on: false,
  manualStop: false,
  restarts: 0,
  restartWindow: 0,
  confs: [],
  sim: null,

  supported: function () { return !!this.SR; },

  init: function () {
    if (!this.SR || this.rec) return;
    var r = new this.SR();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.lang = S.settings.lang || 'en-US';
    var self = this;

    r.onstart = function () { self.paint(true, 'LISTENING'); };
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i];
        var txt = res[0].transcript;
        if (res.isFinal) {
          var c = res[0].confidence;
          if (typeof c === 'number' && c > 0) { self.confs.push(c); self.conf(c); }
          self.commitSegment(txt);
        } else {
          interim += txt;
        }
      }
      $('#interim').textContent = interim.trim();
    };
    r.onerror = function (e) {
      var code = e.error || 'unknown';
      if (code === 'no-speech' || code === 'aborted') return;
      self.stop(true);
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        $('#mic').classList.add('denied');
        self.paint(false, 'MIC BLOCKED', true);
        setVoiceStatus('BLOCKED', 'crit');
        popup('crit', 'MICROPHONE BLOCKED',
          ENV === 'artifact'
            ? 'This preview frame cannot open a microphone. Install the downloadable build for live capture — or hit <b>SIMULATE</b> to watch the pipeline run.'
            : 'Grant microphone access in the site permissions, then try again.',
          { life: 10000 });
      } else if (code === 'network') {
        self.paint(false, 'NO LINK', true);
        popup('alert', 'VOICE OFFLINE', 'Speech recognition needs a connection. Typed entries still work offline.', { life: 7000 });
      } else {
        self.paint(false, 'ERROR', true);
        popup('alert', 'VOICE FAULT', 'Recognition stopped: ' + esc(code), { life: 6000 });
      }
    };
    r.onend = function () {
      if (!self.on || self.manualStop) { self.finish(); return; }
      var now = Date.now();
      if (now - self.restartWindow > 60000) { self.restartWindow = now; self.restarts = 0; }
      self.restarts++;
      if (self.restarts > 24) { self.on = false; self.finish(); popup('alert', 'VOICE PAUSED', 'Recognition kept dropping. Start it again when ready.', { life: 6000 }); return; }
      try { r.start(); } catch (e) { self.on = false; self.finish(); }
    };
    this.rec = r;
  },

  paint: function (on, label, bad) {
    $('#mic').classList.toggle('listening', !!on);
    $('#wave').classList.toggle('on', !!on);
    var ms = $('#micstate');
    ms.textContent = label;
    ms.className = 'micstate' + (on ? ' on' : bad ? ' bad' : '');
    $('#rd-capture').textContent = on ? 'LIVE' : 'IDLE';
    $('#rd-capture').className = on ? 'live' : '';
    if (!on) $('#interim').textContent = '';
  },

  conf: function (c) {
    var pct = Math.round(c * 100);
    var bar = $('#confbar');
    bar.style.width = pct + '%';
    bar.className = c >= 0.85 ? '' : c >= 0.6 ? 'mid' : 'low';
    $('#confval').textContent = pct + '%';
  },

  commitSegment: function (txt) {
    txt = txt.trim();
    if (!txt) return;
    var ta = $('#buffer');
    var sep = ta.value && !/\s$/.test(ta.value) ? ' ' : '';
    ta.value += sep + txt.charAt(0).toUpperCase() + txt.slice(1) + (/[.!?]$/.test(txt) ? '' : '.');
    ta.scrollTop = ta.scrollHeight;
  },

  start: function () {
    if (!active()) { popup('alert', 'NO TARGET', 'Select a project before capturing.', { life: 4500 }); return; }
    if (!this.supported()) {
      popup('alert', 'VOICE UNAVAILABLE', 'This browser has no Web Speech API. Chrome, Edge or Safari support it — or type the entry instead.', { life: 8000 });
      return;
    }
    this.init();
    this.rec.lang = S.settings.lang || 'en-US';
    this.on = true; this.manualStop = false; this.confs = [];
    $('#confbar').style.width = '0%'; $('#confval').textContent = '—';
    audio();
    try { this.rec.start(); this.paint(true, 'LISTENING'); setVoiceStatus('LIVE', 'live'); beep('ok'); }
    catch (e) { this.on = false; this.paint(false, 'READY'); }
  },

  stop: function (silent) {
    if (!this.on) return;
    this.on = false; this.manualStop = true;
    try { this.rec && this.rec.stop(); } catch (e) {}
    if (silent) { this.paint(false, 'READY'); setVoiceStatus(this.supported() ? 'READY' : 'N/A', ''); }
    else this.finish();
  },

  toggle: function () { if (this.sim) { this.stopSim(); } else if (this.on) { this.stop(); } else { this.start(); } },

  finish: function () {
    this.paint(false, 'READY');
    setVoiceStatus(this.supported() ? 'READY' : 'N/A', '');
    var ta = $('#buffer');
    var text = ta.value.trim();
    if (!text) return;
    var avg = this.confs.length ? this.confs.reduce(function (a, b) { return a + b; }, 0) / this.confs.length : null;
    commitBuffer('voice', avg);
  },

  /* Scripted playback so the capture pipeline can be seen without a mic.
     Nothing is recorded; the text below is canned. */
  simulate: function () {
    if (this.on || this.sim) return;
    if (!active()) { popup('alert', 'NO TARGET', 'Select a project first.', { life: 4000 }); return; }
    var script = [
      ['Reviewed the overnight run', 0.96],
      ['two nodes dropped out at around three a.m.', 0.88],
      ['Retry logic handled it but the alert never fired', 0.91],
      ['Next step is wiring the alert into the on-call channel', 0.94]
    ];
    var self = this, i = 0;
    this.paint(true, 'SIMULATING');
    setVoiceStatus('SIM', 'live');
    this.confs = [];
    audio();
    function phrase() {
      if (!self.sim) return;
      if (i >= script.length) {
        clearInterval(self.sim); self.sim = null;
        $('#interim').textContent = '';
        self.finish();
        return;
      }
      var words = script[i][0].split(' '), w = 0;
      var typer = setInterval(function () {
        if (!self.sim) { clearInterval(typer); return; }
        w++;
        $('#interim').textContent = words.slice(0, w).join(' ');
        if (w >= words.length) {
          clearInterval(typer);
          self.conf(script[i][1]); self.confs.push(script[i][1]);
          self.commitSegment(script[i][0]);
          $('#interim').textContent = '';
          i++;
          setTimeout(phrase, 320);
        }
      }, 95);
    }
    this.sim = setInterval(function () {}, 1000); // liveness flag
    phrase();
  },

  stopSim: function () {
    if (!this.sim) return;
    clearInterval(this.sim); this.sim = null;
    $('#interim').textContent = '';
    this.finish();
  }
};

function commitBuffer(src, conf) {
  var p = active(); if (!p) return;
  var ta = $('#buffer');
  var text = ta.value.trim();
  if (!text) return;
  var n = addNote(p.id, text, src, conf);
  if (!n) return;
  ta.value = '';
  renderAll();
  popup('ok', 'ENTRY LOGGED',
    (src === 'voice' ? 'Voice note' : 'Note') + ' filed to <b>' + esc(p.name) + '</b>' +
    (conf ? ' at ' + Math.round(conf * 100) + '% confidence' : '') + '.',
    { life: 4200 });
}

/* ---- navigation ---------------------------------------------------------- */
function selectProject(id) {
  S.ui.active = id;
  save();
  renderRoster(); renderConsole();
}
function goPane(name) {
  S.ui.pane = name;
  $$('.pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === name); });
  $$('#bottombar button').forEach(function (b) { b.classList.toggle('on', b.dataset.go === name); });
  save();
}

/* ---- context menu -------------------------------------------------------- */
var ctxFor = null;
function openCtx(x, y, id) {
  ctxFor = id;
  var m = $('#ctxmenu');
  m.innerHTML =
    '<button data-act="expand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5"/></svg>EXPAND</button>' +
    '<button data-act="copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/></svg>COPY TEXT</button>' +
    '<button data-act="delete" class="danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>DELETE</button>';
  m.hidden = false;
  var r = m.getBoundingClientRect();
  m.style.left = clamp(x, 8, window.innerWidth - r.width - 8) + 'px';
  m.style.top = clamp(y, 8, window.innerHeight - r.height - 8) + 'px';
}
function closeCtx() { $('#ctxmenu').hidden = true; ctxFor = null; }

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      popup('ok', 'COPIED', 'Entry text is on the clipboard.', { life: 2800 });
    }, selectFallback);
  } else selectFallback();
  function selectFallback() {
    popup('alert', 'CLIPBOARD BLOCKED', 'Select the text in the expanded entry and copy it manually.', { life: 5000 });
  }
}

/* ---- swipe to delete ------------------------------------------------------ */
function wireSwipe(root) {
  var drag = null, press = null;
  root.addEventListener('pointerdown', function (e) {
    var entry = e.target.closest('.entry');
    if (!entry || e.button === 2 || selectMode) return;
    drag = { el: entry, x: e.clientX, y: e.clientY, dx: 0, locked: false, id: entry.dataset.id };
    if (e.pointerType === 'touch') {
      press = setTimeout(function () {
        if (drag && !drag.locked) { openCtx(drag.x, drag.y, drag.id); drag = null; }
      }, 520);
    }
  });
  root.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { drag = null; clearTimeout(press); return; }
      drag.locked = true; clearTimeout(press);
      drag.el.classList.add('dragging');
      try { drag.el.setPointerCapture(e.pointerId); } catch (err) {}
    }
    drag.dx = Math.min(0, dx);
    drag.el.style.transform = 'translateX(' + drag.dx + 'px)';
  });
  function end() {
    clearTimeout(press);
    if (!drag) return;
    var d = drag; drag = null;
    d.el.classList.remove('dragging');
    d.el.style.transform = '';
    if (d.locked && d.dx < -92) { d.el.classList.add('vanish'); setTimeout(function () { deleteNotes([d.id]); }, 150); }
  }
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('pointerleave', end);
}

/* ---- wiring --------------------------------------------------------------- */
function wire() {
  // roster
  $('#rosterlist').addEventListener('click', function (e) {
    var b = e.target.closest('.proj');
    if (!b) return;
    selectProject(b.dataset.pid);
    if (window.matchMedia('(max-width:900px)').matches) goPane('console');
    beep('soft');
  });
  $('#btn-newproj').addEventListener('click', function () {
    var f = $('#newproj'); f.hidden = !f.hidden;
    if (!f.hidden) $('#newproj-name').focus();
  });
  $('#newproj').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#newproj-name'), name = input.value.trim();
    if (!name) return;
    var p = {
      id: uid(), name: name, code: initials(name) + '-' + pad(S.seq++),
      hue: HUES[S.projects.length % HUES.length],
      createdAt: Date.now(), lastWorked: null, autoClean: false
    };
    S.projects.push(p);
    S.ui.active = p.id;
    input.value = ''; $('#newproj').hidden = true;
    save(); renderAll();
    popup('ok', 'PROJECT CREATED', '<b>' + esc(p.name) + '</b> registered as ' + p.code + '.', { life: 4000 });
  });
  $('#btn-first').addEventListener('click', function () {
    goPane('roster');
    var f = $('#newproj'); f.hidden = false;
    $('#newproj-name').focus();
  });

  // console
  $('#mic').addEventListener('click', function () { Voice.toggle(); });
  $('#btn-sim').addEventListener('click', function () { Voice.sim ? Voice.stopSim() : Voice.simulate(); });
  $('#btn-log').addEventListener('click', function () { commitBuffer('text', null); });
  $('#btn-clear').addEventListener('click', function () { $('#buffer').value = ''; $('#buffer').focus(); });
  $('#autoclean').addEventListener('change', function (e) {
    var p = active(); if (!p) return;
    p.autoClean = e.target.checked;
    save(); renderRoster();
    popup(p.autoClean ? 'alert' : 'ok', 'AUTO-CLEANUP ' + (p.autoClean ? 'ARMED' : 'DISARMED'),
      p.autoClean
        ? 'Entries in <b>' + esc(p.name) + '</b> older than ' + CLEAN_DAYS + ' days will be removed permanently at startup.'
        : '<b>' + esc(p.name) + '</b> will keep every entry.',
      { life: 6000 });
  });
  $('#btn-rename').addEventListener('click', function () {
    var p = active(); if (!p) return;
    var f = $('#newproj'), input = $('#newproj-name');
    f.hidden = false; input.value = p.name; input.dataset.rename = p.id;
    goPane('roster'); input.focus(); input.select();
  });
  $('#newproj-name').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !this.dataset.rename) return;
    e.preventDefault();
    var p = proj(this.dataset.rename);
    if (p && this.value.trim()) { p.name = this.value.trim(); p.code = initials(p.name) + '-' + p.code.split('-')[1]; }
    delete this.dataset.rename; this.value = ''; $('#newproj').hidden = true;
    save(); renderAll();
  });
  $('#btn-delproj').addEventListener('click', function () {
    var p = active(); if (!p) return;
    deleteProject(p.id);
  });

  // history filters
  var qt = null;
  $('#q').addEventListener('input', function (e) {
    S.ui.q = e.target.value;
    clearTimeout(qt); qt = setTimeout(function () { renderHistory(); save(); }, 90);
  });
  $('#fproj').addEventListener('change', function (e) { S.ui.fproj = e.target.value; renderHistory(); save(); });
  $('#fvoice').addEventListener('change', function (e) { S.ui.fvoice = e.target.checked; renderHistory(); save(); });

  // history entries
  $('#timeline').addEventListener('click', function (e) {
    var entry = e.target.closest('.entry');
    if (!entry) return;
    var id = entry.dataset.id;
    if (selectMode) {
      if (selected[id]) delete selected[id]; else selected[id] = 1;
      entry.classList.toggle('sel', !!selected[id]);
      var box = $('.box', entry); if (box) box.checked = !!selected[id];
      updateBulk();
      return;
    }
    entry.classList.toggle('open');
  });
  $('#timeline').addEventListener('contextmenu', function (e) {
    var entry = e.target.closest('.entry');
    if (!entry) return;
    e.preventDefault();
    openCtx(e.clientX, e.clientY, entry.dataset.id);
  });
  wireSwipe($('#timeline'));

  $('#ctxmenu').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !ctxFor) return;
    var id = ctxFor, act = b.dataset.act;
    closeCtx();
    var n = S.notes.filter(function (x) { return x.id === id; })[0];
    if (act === 'delete') { deleteNotes([id]); }
    else if (act === 'copy' && n) { copyText(n.text); }
    else if (act === 'expand') {
      var el = $('.entry[data-id="' + id + '"]');
      if (el) { el.classList.add('open'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#ctxmenu')) closeCtx(); }, true);
  window.addEventListener('blur', closeCtx);
  window.addEventListener('resize', closeCtx);

  // bulk
  $('#btn-select').addEventListener('click', function () {
    selectMode = !selectMode; selected = Object.create(null); renderHistory();
  });
  $('#btn-selcancel').addEventListener('click', function () {
    selectMode = false; selected = Object.create(null); renderHistory();
  });
  $('#btn-selall').addEventListener('click', function () {
    filteredNotes().forEach(function (n) { selected[n.id] = 1; });
    renderHistory();
  });
  $('#btn-bulkdel').addEventListener('click', function () {
    var ids = Object.keys(selected);
    if (!ids.length) { popup('alert', 'NOTHING SELECTED', 'Tick the entries to remove first.', { life: 3500 }); return; }
    selected = Object.create(null); selectMode = false;
    deleteNotes(ids);
  });

  // top bar
  $('#btn-sound').addEventListener('click', function () {
    S.settings.sound = !S.settings.sound;
    this.setAttribute('aria-pressed', String(S.settings.sound));
    this.title = S.settings.sound ? 'Alert tones on' : 'Alert tones muted';
    save();
    if (S.settings.sound) beep('ok');
  });
  $('#btn-notify').addEventListener('click', function () {
    var btn = this;
    if (!('Notification' in window)) { popup('alert', 'UNSUPPORTED', 'This browser has no notification API.', { life: 4500 }); return; }
    if (Notification.permission === 'granted') {
      S.settings.sysNotify = !S.settings.sysNotify;
      btn.setAttribute('aria-pressed', String(S.settings.sysNotify));
      save();
      popup('ok', 'SYSTEM ALERTS ' + (S.settings.sysNotify ? 'ON' : 'OFF'), 'Idle-project alerts will ' + (S.settings.sysNotify ? 'reach you outside the app.' : 'stay inside the console.'), { life: 4500 });
      return;
    }
    Notification.requestPermission().then(function (p) {
      var ok = p === 'granted';
      S.settings.sysNotify = ok;
      btn.setAttribute('aria-pressed', String(ok));
      save();
      popup(ok ? 'ok' : 'alert', ok ? 'SYSTEM ALERTS ON' : 'PERMISSION DENIED',
        ok ? 'Idle-project alerts will reach you outside the app.' : 'Alerts will stay inside the console.', { life: 5000 });
    }).catch(function () {});
  });

  // recognition language
  var ls = $('#lang');
  ls.value = S.settings.lang || 'en-US';
  if (ls.selectedIndex < 0) ls.value = 'en-US';
  ls.addEventListener('change', function (e) {
    S.settings.lang = e.target.value;
    save();
    if (Voice.rec) Voice.rec.lang = S.settings.lang;
    if (Voice.on) { Voice.stop(true); Voice.start(); }
  });

  // bottom nav
  $('#bottombar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-go]'); if (!b) return;
    goPane(b.dataset.go); beep('soft');
  });

  // keyboard
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape') { closeCtx(); if (!$('#toast').hidden) commitPending(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitBuffer('text', null); return; }
    if (e.altKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); Voice.toggle(); return; }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); goPane('log'); $('#q').focus(); }
  });

  // connectivity + clock
  window.addEventListener('online', function () { renderStatus(); popup('ok', 'LINK RESTORED', 'Voice recognition is available again.', { life: 3500 }); });
  window.addEventListener('offline', function () { renderStatus(); popup('alert', 'LINK LOST', 'Running offline. Typed entries still save locally; voice needs a connection.', { life: 6000 }); });
  setInterval(function () { $('#rd-clock').textContent = hhmmss(Date.now()); }, 1000);
  $('#rd-clock').textContent = hhmmss(Date.now());

  // periodic idle sweep
  setInterval(scanAlerts, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { renderStatus(); scanAlerts(); } });

  // first gesture unlocks audio
  document.addEventListener('pointerdown', function () { markGesture(); audio(); }, { once: true });
  document.addEventListener('keydown', function () { markGesture(); }, { once: true });

  // keep holographic pop-ups clear of the top bar at any wrap height
  function measureTop() {
    var h = $('.topbar').offsetHeight;
    document.documentElement.style.setProperty('--topbar-h', h + 'px');
  }
  measureTop();
  window.addEventListener('resize', measureTop);
  if (window.ResizeObserver) new ResizeObserver(measureTop).observe($('.topbar'));
}

/* ---- PWA plumbing --------------------------------------------------------- */
function pwa() {
  if (ENV === 'artifact') { setCacheStatus('SANDBOX', 'warn'); return; }
  if (location.protocol === 'file:') { setCacheStatus('FILE MODE', 'warn'); return; }
  if ('serviceWorker' in navigator) {
    setCacheStatus('SYNCING', 'warn');
    navigator.serviceWorker.register('sw.js').then(function () {
      setCacheStatus('ARMED', 'ok');
    }).catch(function () { setCacheStatus('UNAVAILABLE', 'warn'); });
  } else setCacheStatus('N/A', 'warn');

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    var btn = $('#btn-install');
    btn.hidden = false;
    btn.onclick = function () {
      btn.hidden = true;
      e.prompt();
      e.userChoice.then(function (c) {
        if (c.outcome === 'accepted') popup('ok', 'NEXUS INSTALLED', 'Launch it from your home screen or app list.', { life: 5000 });
      });
    };
  });
}

/* ---- boot ----------------------------------------------------------------- */
function boot() {
  S = load();
  if (!proj(S.ui.active)) S.ui.active = S.projects.length ? S.projects[0].id : null;
  if (purgedSamples) save();

  $('#q').value = S.ui.q || '';
  $('#fvoice').checked = !!S.ui.fvoice;
  $('#btn-sound').setAttribute('aria-pressed', String(S.settings.sound));
  $('#btn-notify').setAttribute('aria-pressed', String(S.settings.sysNotify && 'Notification' in window && Notification.permission === 'granted'));

  runAutoClean();
  renderAll();
  goPane(window.matchMedia('(max-width:900px)').matches ? (S.ui.pane || 'roster') : 'roster');
  wire();
  pwa();

  setVoiceStatus(Voice.supported() ? 'READY' : 'N/A', Voice.supported() ? '' : 'warn');
  if (!Voice.supported()) $('#micstate').textContent = 'NO SPEECH API';
  renderStatus();

  setTimeout(scanAlerts, 1400);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
