/* Teraminds Academy tests: static, offline-capable, no personal data leaves the device.
   Routes:  #                     hub (index.json): Mock Papers + readiness tests
            #profile              combined subject profile across every test taken on this device
            #<id>                 test intro
            #<id>/test            take the test
            #<id>/mark/<attempt>  self-marking (mock papers: written answers against the rubric)
            #<id>/report/<attempt>          report
            #<id>/report/<attempt>/print    print-optimised report (calls window.print)          */
(function () {
  "use strict";

  var LS = { nick: "tm.nick", hist: "tm.history.v1", prog: "tm.progress." };
  var LINKS = {
    youtube: "https://www.youtube.com/@TeramindsLearningAcademy",
    worksheets: "https://drive.google.com/drive/folders/1fHevoVaogsYQGLGq00K5iakx-DyG2SFS"
  };
  var REPEAT_TEXT = "Repeat this test any time: your report tracks your progress across attempts on this device.";
  var APP_ID = "teraminds-readiness-tests";
  var app = document.getElementById("app");
  var topRight = document.getElementById("topbar-right");
  var cache = { index: null, tests: {} };
  var timerId = null;
  var bundleTried = false;

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // keep short expressions together on narrow screens: glue spaces around operators
  // long chains (> 22 chars) may still break before an operator, so nothing runs wider than a 390 px phone
  function mt(s) {
    return esc(s).replace(/ ([×÷=+−<>≤≥≠→]|&lt;|&gt;) /g, "\u00a0$1\u00a0").split(" ").map(function (tok) {
      return tok.length > 22 ? tok.replace(/\u00a0([×÷=+−≤≥≠→]|&lt;|&gt;)\u00a0/g, " $1\u00a0") : tok;
    }).join(" ");
  }
  // multi-line text (passages, model answers): blank line = paragraph, single newline = line break
  function para(s, cl) {
    return String(s == null ? "" : s).split(/\n{2,}/).map(function (p) {
      return "<p" + (cl ? ' class="' + cl + '"' : "") + ">" + (p.length < 70 ? mt(p) : esc(p)).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function lsGet(k, dflt) { try { var v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function pct(c, t) { return t ? Math.round((c / t) * 100) : 0; }
  function fm(x) { x = Math.round(x * 2) / 2; return x % 1 ? x.toFixed(1) : String(x); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }
  function fmtDur(sec) { var m = Math.round(sec / 60); return m < 1 ? "under a minute" : m + " min"; }
  function fmtDate(iso, withTime) {
    var d = new Date(iso);
    var o = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) { o.hour = "numeric"; o.minute = "2-digit"; }
    try { return d.toLocaleString("en-IN", o); } catch (e) { return d.toISOString().slice(0, 16).replace("T", " "); }
  }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function letter(i) { return String.fromCharCode(65 + i); }
  function cls(p) { return p >= 75 ? "hi" : p >= 50 ? "mid" : "lo"; }
  function setTitle(t) { document.title = t ? t + " · Teraminds Academy" : "Tests · Teraminds Academy"; }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function nick() { return (lsGet(LS.nick, "") || "").slice(0, 24); }
  function isMock(t) { return t && t.kind === "mock"; }
  function extLink(url, label, cl) { return '<a class="' + (cl || "") + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>"; }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ---------- data loading (fetch, then bundle.js fallback for file://) ---------- */
  function loadBundle() {
    if (window.TM_BUNDLE || bundleTried) return Promise.resolve(window.TM_BUNDLE || null);
    bundleTried = true;
    return new Promise(function (res) {
      var s = document.createElement("script");
      s.src = "bundle.js";
      s.onload = function () { res(window.TM_BUNDLE || null); };
      s.onerror = function () { res(null); };
      document.head.appendChild(s);
    });
  }
  function getJSON(path) {
    return fetch(path, { cache: "no-cache", credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error(r.status); return r.json();
    });
  }
  function loadIndex() {
    if (cache.index) return Promise.resolve(cache.index);
    return getJSON("index.json").catch(function () {
      return loadBundle().then(function (b) { if (!b) throw new Error("no index"); return b.index; });
    }).then(function (ix) { ix.subjects = ix.subjects || {}; cache.index = ix; return ix; });
  }
  function loadTest(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) return Promise.reject(new Error("bad id"));
    if (cache.tests[id]) return Promise.resolve(cache.tests[id]);
    return getJSON("" + id + ".json").catch(function () {
      return loadBundle().then(function (b) { if (!b || !b.tests[id]) throw new Error("not found"); return b.tests[id]; });
    }).then(function (t) { cache.tests[id] = t; return t; });
  }
  function manifest(id) { return ((cache.index && cache.index.tests) || []).filter(function (m) { return m.id === id; })[0] || {}; }
  function subjectOf(test) { return test.subject_key || manifest(test.id).subject_key || ""; }

  /* ---------- history ---------- */
  function history() { var h = lsGet(LS.hist, null); return h && Array.isArray(h.attempts) ? h : { schema: 1, attempts: [] }; }
  function saveHistory(h) { return lsSet(LS.hist, h); }
  function attemptsFor(testId) {
    return history().attempts.filter(function (a) { return a.testId === testId; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function findAttempt(id) { return history().attempts.filter(function (a) { return a.id === id; })[0]; }
  function updateAttempt(att) {
    var h = history();
    h.attempts = h.attempts.map(function (a) { return a.id === att.id ? att : a; });
    return saveHistory(h);
  }

  function exportHistory() {
    var h = history();
    var data = { app: APP_ID, schema: 2, exported: new Date().toISOString(), nickname: nick() || undefined, attempts: h.attempts };
    download("teraminds-test-history-" + today() + ".json", JSON.stringify(data, null, 1), "application/json");
  }
  function cleanMap(o, valFn, max) {
    var out = {}, n = 0;
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    Object.keys(o).forEach(function (k) {
      if (n >= (max || 400) || !/^[A-Za-z0-9_|.-]{1,60}$/.test(k)) return;
      var v = valFn(o[k]); if (v !== undefined) { out[k] = v; n++; }
    });
    return out;
  }
  function numOrU(v) { return typeof v === "number" && isFinite(v) ? v : undefined; }
  function strOrU(v) { return v == null ? undefined : String(v).slice(0, 4000); }
  function sanitizeAttempt(a) {
    return {
      id: a.id.slice(0, 40), testId: a.testId.slice(0, 80), testVersion: +a.testVersion || 1, date: String(a.date).slice(0, 40),
      kind: a.kind === "mock" ? "mock" : undefined,
      durationSec: +a.durationSec || 0, answers: cleanMap(a.answers, strOrU), score: +a.score || 0, total: +a.total || 0,
      overall: +a.overall || 0, subs: cleanMap(a.subs, numOrU), levels: cleanMap(a.levels, numOrU),
      choice: cleanMap(a.choice, numOrU), paper: cleanMap(a.paper, function (v) { return v ? 1 : undefined; }),
      self: cleanMap(a.self, function (v) { return Array.isArray(v) ? v.slice(0, 20).map(function (x) { return +x || 0; }) : undefined; }),
      secTime: cleanMap(a.secTime, numOrU), sections: cleanMap(a.sections, numOrU), marked: a.marked ? 1 : undefined
    };
  }
  function importHistory(file, done) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (!d || d.app !== APP_ID || !Array.isArray(d.attempts)) throw new Error("format");
        var h = history(), have = {}, added = 0;
        h.attempts.forEach(function (a) { have[a.id] = 1; });
        d.attempts.forEach(function (a) {
          if (a && typeof a.id === "string" && typeof a.testId === "string" && a.answers && typeof a.answers === "object" && !have[a.id]) {
            h.attempts.push(sanitizeAttempt(a)); have[a.id] = 1; added++;
          }
        });
        if (d.nickname && !nick()) lsSet(LS.nick, String(d.nickname).replace(/[<>]/g, "").slice(0, 24));
        saveHistory(h);
        done(added + " attempt" + (added === 1 ? "" : "s") + " imported.");
      } catch (e) { done("That file doesn't look like a Teraminds test history export."); }
    };
    r.onerror = function () { done("Couldn't read that file."); };
    r.readAsText(file);
  }
  function clearHistory() {
    history().attempts.forEach(function (a) { lsDel(LS.prog + a.testId); });
    lsDel(LS.hist);
  }

  /* ---------- scoring: readiness tests (1 mark per question) ---------- */
  function normNum(v) {
    if (v == null) return null;
    var s = String(v).trim().replace(/[\u2212\u2012\u2013\u2014]/g, "-").replace(/[\s,]/g, "");
    var f = /^([-+]?\d+)\/(\d+)$/.exec(s);
    if (f) return +f[2] ? Number(f[1]) / Number(f[2]) : null;
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  function isAnswered(q, a) { return a != null && String(a).trim() !== ""; }
  function isCorrect(q, a) {
    if (!isAnswered(q, a)) return false;
    if (q.type === "numeric") { var x = normNum(a), y = normNum(q.answer); return x !== null && y !== null && Math.abs(x - y) < 1e-9; }
    return String(a).toUpperCase() === String(q.answer).toUpperCase();
  }
  function score(test, answers) {
    var subs = {}, levels = {}, correct = 0, wrong = [];
    Object.keys(test.subtopics).forEach(function (k) { subs[k] = { c: 0, t: 0 }; });
    Object.keys(test.levels).forEach(function (k) { levels[k] = { c: 0, t: 0 }; });
    test.questions.forEach(function (q, i) {
      var ok = isCorrect(q, answers[q.id]);
      subs[q.subtopic] = subs[q.subtopic] || { c: 0, t: 0 }; levels[q.level] = levels[q.level] || { c: 0, t: 0 };
      subs[q.subtopic].t++; levels[q.level].t++;
      if (ok) { correct++; subs[q.subtopic].c++; levels[q.level].c++; } else wrong.push({ q: q, n: i + 1 });
    });
    return { correct: correct, total: test.questions.length, overall: pct(correct, test.questions.length), subs: subs, levels: levels, wrong: wrong };
  }
  function band(s, test) {
    var hard = { c: 0, t: 0 };
    ["L3", "L4"].forEach(function (k) { if (s.levels[k]) { hard.c += s.levels[k].c; hard.t += s.levels[k].t; } });
    var hp = hard.t ? pct(hard.c, hard.t) : 100;
    if (s.overall >= 80 && hp >= 60) return { k: "b3", name: "Board-ready", text: "You're handling most of the repeated board-pattern question types, including the multi-step ones. Keep it sharp with timed practice and the worksheet's hard questions." };
    if (s.overall >= 50) return { k: "b2", name: "Getting there", text: s.overall >= 80
      ? "Strong overall, but the multi-step board-pattern and HOTS questions need more work before you can call this chapter done. Start with “Focus next”."
      : "You have a working base. Fix the subtopics under “Focus next”, then repeat the test to see the gap close." };
    return { k: "b1", name: "Building", text: c12(test) ? "The basics need another pass. Revise the units under “Focus next” from the NCERT sections listed, then try again." : "The basics need another pass. Re-watch the video parts named under “Focus next”, do the NCERT exercises listed, then try again." };
  }
  // readiness subtopic stats pooled by registry chapter (for the subject profile)
  function readinessChapters(test, att) {
    var s = score(test, att.answers || {}), map = manifest(test.id).sub_chapter || {}, out = {};
    Object.keys(s.subs).forEach(function (k) {
      var ck = map[k]; if (!ck || !s.subs[k].t) return;
      out[ck] = out[ck] || { e: 0, m: 0 }; out[ck].e += s.subs[k].c; out[ck].m += s.subs[k].t;
    });
    return out;
  }

  /* ---------- scoring: mock papers (marks, sections, choices, self-marking) ---------- */
  // a question with alternative passages/extracts (galts) resolves to the chosen one
  function view(Q, choice) {
    if (!Q.galts) return Q;
    var g = Q.galts[(choice || {})[Q.id] | 0] || Q.galts[0];
    return { n: Q.n, id: Q.id, section: Q.section, marks: Q.marks, qtype: Q.qtype, galts: Q.galts, stem: g.stem, parts: g.parts, best_of: g.best_of, blocks: g.blocks };
  }
  function units(Q) { return Q.parts || [Q]; }
  // "answer any N of M" blocks: [{n: parts in block, best: N, title}]
  function blocksOf(V) { return V.blocks || (V.best_of ? [{ n: V.parts.length, best: V.best_of }] : null); }
  function chosen(u, choice) { return u.alts ? (u.alts[(choice || {})[u.id] | 0] || u.alts[0]) : u; }
  function itemDone(it, p) { return isAnswered(it, (p.answers || {})[it.id]) || (it.type === "self" && !!(p.paper || {})[it.id]); }
  function unitDone(u, p) { return itemDone(chosen(u, p.choice), p); }
  function qDone(Q, p) {
    var V = view(Q, p.choice), us = units(V), bl = blocksOf(V) || [{ n: us.length, best: us.length }], i = 0, full = true, any = false;
    bl.forEach(function (b) {
      var n = us.slice(i, i + b.n).filter(function (u) { return unitDone(u, p); }).length; i += b.n;
      if (n) any = true; if (n < Math.min(b.best, b.n)) full = false;
    });
    return full ? 2 : any ? 1 : 0;
  }
  function selfItems(test, att) {
    var out = [];
    test.questions.forEach(function (Q0) {
      var Q = view(Q0, att.choice);
      units(Q).forEach(function (u) { var it = chosen(u, att.choice); if (it.type === "self") out.push({ Q: Q, it: it }); });
    });
    return out;
  }
  function evalItem(it, att) {
    var m = it.marks || 1, a = (att.answers || {})[it.id], ev = { it: it, m: m, e: 0, objective: it.type !== "self", pending: false };
    ev.answered = itemDone(it, att);
    if (ev.objective) { ev.correct = isCorrect(it, a); ev.e = ev.correct ? m : 0; }
    else {
      var s = (att.self || {})[it.id];
      if (!Array.isArray(s)) ev.pending = true;
      else ev.e = Math.max(0, Math.min(m, s.reduce(function (x, y) { return x + (+y || 0); }, 0)));
    }
    return ev;
  }
  function scoreMock(test, att) {
    var r = { e: 0, m: 0, objE: 0, objM: 0, selfE: 0, selfM: 0, pending: 0, sections: {}, chapters: {}, topics: {}, rows: [] };
    (test.sections || []).forEach(function (s) { r.sections[s.id] = { e: 0, m: 0 }; });
    test.questions.forEach(function (Q0) {
      var Q = view(Q0, att.choice);
      var evs = units(Q).map(function (u) { return evalItem(chosen(u, att.choice), att); });
      var keep = evs.map(function () { return true; }), bl = blocksOf(Q), start = 0;
      (bl || []).forEach(function (b) {
        var idx = []; for (var j = start; j < start + b.n; j++) idx.push(j);
        start += b.n; if (b.best >= b.n) return;
        idx.sort(function (a, c) { return (evs[c].e - evs[a].e) || ((evs[c].answered ? 1 : 0) - (evs[a].answered ? 1 : 0)) || (a - c); });
        idx.forEach(function (j, k) { keep[j] = k < b.best; });
      });
      evs.forEach(function (ev, i) {
        ev.counted = keep[i]; if (!keep[i]) return;
        var it = ev.it, sec = r.sections[Q.section] = r.sections[Q.section] || { e: 0, m: 0 };
        r.e += ev.e; r.m += ev.m; sec.e += ev.e; sec.m += ev.m;
        if (ev.objective) { r.objE += ev.e; r.objM += ev.m; } else { r.selfE += ev.e; r.selfM += ev.m; if (ev.pending) r.pending++; }
        var ck = it.chapter || "_", tk = ck + "|" + (it.topic || "");
        r.chapters[ck] = r.chapters[ck] || { e: 0, m: 0 }; r.chapters[ck].e += ev.e; r.chapters[ck].m += ev.m;
        r.topics[tk] = r.topics[tk] || { e: 0, m: 0, ch: ck, name: it.topic || "" }; r.topics[tk].e += ev.e; r.topics[tk].m += ev.m;
      });
      r.rows.push({ Q: Q, evs: evs });
    });
    r.overall = pct(r.e, r.m);
    return r;
  }
  function mockBand(r) {
    if (r.overall >= 80) return { k: "b3", name: "Board-ready on this paper", text: "You handled most of this full board-pattern paper. Keep it sharp: repeat under the full 3-hour timer and fix the few topics listed below." };
    if (r.overall >= 50) return { k: "b2", name: "Getting there", text: "A working base across the paper. The top 3 focus areas below are where most of your lost marks sit: fix those first, then retake." };
    return { k: "b1", name: "Building", text: "Several chapters need another pass. Start with the top 3 focus areas, watch the linked video parts, do the worksheet, then retake this paper." };
  }
  function chapterName(test, ck) {
    var c = (test.chapters || {})[ck]; if (c) return c.name;
    var s = cache.index && cache.index.subjects[subjectOf(test)];
    return s && s.chapters[ck] ? s.chapters[ck].name : ck;
  }
  function chapterInfo(subjKey, ck, test) {
    var c = (test && test.chapters || {})[ck];
    if (c) return c;
    var s = cache.index && cache.index.subjects[subjKey];
    return s && s.chapters[ck] || null;
  }
  function linksHTML(info) {
    if (!info) return "";
    var v = (info.videos || []).map(function (x) { return extLink(x.url, "▶ " + x.label, "lnk"); }).join("");
    var w = extLink(info.worksheet || LINKS.worksheets, "Worksheet", "lnk ws");
    return '<div class="linkrow no-print-hide">' + v + w + "</div>";
  }

  /* ---------- rendering pieces ---------- */
  function topbarTimer(html) { topRight.innerHTML = html || ""; }
  function c12(test) { return test && String(test["class"]) === "12"; }
  function subLabel(test) { return (test && test.subtopic_label) || "subtopic"; }
  function footerLinks(test) {
    if (test && test.links && test.links.length) return '<div class="row no-print">' + test.links.map(function (l) {
      return '<a class="btn secondary" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label) + "</a>";
    }).join("") + "</div>";
    var v = test && test.video_url ? '<a class="btn secondary" href="' + esc(test.video_url) + '" target="_blank" rel="noopener noreferrer">Watch the video</a>' :
      '<a class="btn secondary" href="' + LINKS.youtube + '" target="_blank" rel="noopener noreferrer">Video lessons on YouTube</a>';
    var w = '<a class="btn secondary" href="' + esc((test && test.worksheet_url) || LINKS.worksheets) + '" target="_blank" rel="noopener noreferrer">Free worksheets</a>';
    return '<div class="row no-print">' + v + w + "</div>";
  }
  function qBody(q) {
    var h = "";
    if (q.type === "ar") {
      h += '<div class="ar math"><p><b>Assertion (A):</b> ' + mt(q.assertion) + '</p><p><b>Reason (R):</b> ' + mt(q.reason) + "</p></div>";
      h += '<p class="muted small">' + esc(q.question) + "</p>";
    } else h += '<div class="qtext math">' + para(q.question) + "</div>";
    return h;
  }
  function answerText(q, a) {
    if (!isAnswered(q, a)) return "Not answered";
    if (q.type === "numeric") return String(a).trim().replace(/^-/, "−");
    if (q.type === "self") return String(a);
    var i = String(a).toUpperCase().charCodeAt(0) - 65;
    return "(" + String(a).toUpperCase() + ") " + ((q.options || [])[i] || "");
  }
  function barRow(label, c, t, sub, right) {
    var p = pct(c, t);
    return "<tr><td>" + esc(label) + (sub ? '<div class="muted small">' + esc(sub) + "</div>" : "") +
      '<div class="bar"><i class="' + cls(p) + '" style="width:' + p + '%"></i></div></td><td class="n"><b>' + p + "%</b><div class=\"muted small\">" + (right || (fm(c) + "/" + fm(t))) + "</div></td></tr>";
  }

  /* ---------- hub ---------- */
  var SUBJ_ORDER = ["maths", "science", "sst", "english", "hindi", "marathi", "ai"];
  function renderHome() {
    stopTimer(); topbarTimer(); setTitle(); document.body.classList.remove("print-view");
    loadIndex().then(function (ix) {
      var mocks = ix.tests.filter(function (t) { return t.kind === "mock"; });
      var ready = ix.tests.filter(function (t) { return t.kind !== "mock" && String(t["class"]) !== "12"; });
      var ready12 = ix.tests.filter(function (t) { return t.kind !== "mock" && String(t["class"]) === "12"; });
      var nAtt = history().attempts.length;
      function card(t, mock) {
        var n = attemptsFor(t.id).length;
        return '<li class="card' + (mock ? " mockcard" : "") + '"><div class="eyebrow">' + esc(t.subject || "Readiness test") + (t["class"] ? " · Class " + esc(t["class"]) : "") + "</div>" +
          "<h2>" + esc(mock ? t.title : (t.short_title || t.chapter)) + "</h2><p class=\"muted small\">" +
          (mock ? t.max_marks + " marks · " + Math.round(t.duration_minutes / 60) + " hours · " + t.questions + " questions" : t.questions + " questions" + (t.suggested_minutes ? " · about " + t.suggested_minutes + " min" : "")) +
          (n ? " · " + n + " attempt" + (n > 1 ? "s" : "") + " on this device" : "") + "</p>" +
          '<a class="btn" href="#' + esc(t.id) + '">' + (mock ? "Open paper" : "Open test") + "</a></li>";
      }
      var mh = "";
      SUBJ_ORDER.concat(Object.keys(ix.subjects)).filter(function (k, i, a) { return a.indexOf(k) === i; }).forEach(function (k) {
        var list = mocks.filter(function (t) { return t.subject_key === k; });
        if (!list.length) return;
        mh += '<h3 class="subhead">' + esc((ix.subjects[k] || {}).name || list[0].subject) + "</h3>" +
          '<ul class="plain">' + list.map(function (t) { return card(t, true); }).join("") + "</ul>";
      });
      app.innerHTML = '<section class="card hero"><div class="eyebrow">Teraminds Academy</div><h1>Board-pattern tests</h1>' +
        '<p class="tagline">Practice questions modelled on past CBSE papers; not predictions of this year\'s paper.</p>' +
        '<nav class="row jump"><a class="btn secondary" href="#mocks">Mock Papers</a><a class="btn secondary" href="#readiness-list">Readiness tests</a>' +
        (ready12.length ? '<a class="btn secondary" href="#class12-list">Class 12</a>' : "") +
        (nAtt ? '<a class="btn" href="#profile">My subject profile</a>' : "") + "</nav></section>" +
        (mocks.length ? '<section id="mock-papers" class="hubsec"><h2 class="sechead">Board-pattern Mock Papers</h2>' +
          '<p class="muted small">Full-length papers in the CBSE 2026-27 sample-paper structure: sections, question types, marks and internal choice. Objective parts are marked for you; for written answers you compare with the model answer and award your own marks point by point.</p>' + mh + "</section>" : "") +
        '<section id="readiness" class="hubsec"><h2 class="sechead">Readiness tests</h2><p class="muted small">Short tests of the most-repeated question types, one per video.</p>' +
        '<ul class="plain">' + ready.map(function (t) { return card(t, false); }).join("") + "</ul></section>" +
        (ready12.length ? '<section id="class12" class="hubsec"><h2 class="sechead">Class 12</h2><p class="muted small">Board-pattern readiness tests for Class 12 CBSE (2026-27 syllabus): original questions on every unit, weighted by its marks, with a unit-wise report.</p>' +
          '<ul class="plain">' + ready12.map(function (t) { return card(t, false); }).join("") + "</ul></section>" : "");
      $all(".jump a").forEach(function (a) {
        var tgt = { "#mocks": "mock-papers", "#readiness-list": "readiness", "#class12-list": "class12" }[a.getAttribute("href")];
        if (tgt) a.addEventListener("click", function (e) { e.preventDefault(); var el = document.getElementById(tgt); if (el) el.scrollIntoView({ behavior: "smooth" }); });
      });
    }).catch(function () { app.innerHTML = '<div class="card"><h2>Couldn\'t load the tests</h2><p>Check your connection and reload the page.</p></div>'; });
  }

  /* ---------- readiness test intro ---------- */
  function renderIntro(test) {
    if (isMock(test)) return renderMockIntro(test);
    stopTimer(); topbarTimer(); setTitle(test.short_title); document.body.classList.remove("print-view");
    var prog = lsGet(LS.prog + test.id, null);
    var atts = attemptsFor(test.id);
    var counts = {}; test.questions.forEach(function (q) { counts[q.level] = (counts[q.level] || 0) + 1; });
    var lv = Object.keys(test.levels).map(function (k) {
      return "<div><b>" + esc(k) + " · " + esc(test.levels[k].label) + "</b>" + (counts[k] || 0) + " questions</div>";
    }).join("");
    var answered = prog ? Object.keys(prog.answers || {}).filter(function (k) { return isAnswered(null, prog.answers[k]); }).length : 0;
    var h = '<section class="card hero"><div class="eyebrow">' + esc(test.short_title || test.chapter) + "</div>" +
      "<h1>" + esc(test.title) + '</h1><p class="tagline">' + esc(test.tagline || "") + "</p></section>" +
      '<section class="card"><h2>How it works</h2><p>' + esc(test.instructions) + "</p>" +
      '<div class="levels-grid">' + lv + "</div>" +
      '<p class="muted small">' + (test.suggested_minutes ? "Suggested time: about " + test.suggested_minutes + " minutes. The timer is only a guide; nothing is cut off. " : "") +
      "Your report shows your score by level and " + esc(subLabel(test)) + ", what you've got, where you missed, and what to focus on next.</p>" +
      nickField() +
      '<div class="stack" style="margin-top:1rem">' +
      (prog && answered ? '<button class="btn full" id="resume">Resume attempt (' + answered + "/" + test.questions.length + ' answered)</button><button class="btn secondary full" id="start">Start a fresh attempt</button>'
        : '<button class="btn full" id="start">Start the test</button>') + "</div>" +
      '<p class="muted small" style="margin-top:.8rem">Private by design: no sign-up, no tracking. Answers are checked on this phone and never sent anywhere.</p></section>';
    h += attemptsList(test, atts) + historyTools() + '<section class="card">' + footerLinks(test) + "</section>";
    app.innerHTML = h;
    wireNick();
    $("#start").addEventListener("click", function () {
      if (prog && answered && !confirm("Start again? Your unfinished answers will be cleared.")) return;
      lsSet(LS.prog + test.id, { testId: test.id, answers: {}, cur: 0, elapsed: 0, started: new Date().toISOString() });
      go("#" + test.id + "/test");
    });
    if ($("#resume")) $("#resume").addEventListener("click", function () { go("#" + test.id + "/test"); });
    wireHistoryTools(function () { renderIntro(test); });
  }
  function nickField() {
    return '<label class="field" for="nick">Nickname <span class="muted small">(optional)</span></label>' +
      '<input class="text" id="nick" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. MathsTiger" value="' + esc(nick()) + '">' +
      '<p class="warn">Don\'t use your real full name. It is saved only on this device and shown on your report.</p>';
  }
  function wireNick() {
    $("#nick").addEventListener("input", function (e) {
      var v = e.target.value.replace(/[<>]/g, "").slice(0, 24); if (v.trim()) lsSet(LS.nick, v.trim()); else lsDel(LS.nick);
    });
  }
  function attemptsList(test, atts) {
    if (!atts.length) return "";
    return '<section class="card"><h2>Your attempts on this device</h2><ul class="attempts">' + atts.slice().reverse().map(function (a) {
      var pend = a.kind === "mock" && !a.marked;
      return "<li><span>" + esc(fmtDate(a.date, true)) + '</span><span><b>' + (a.kind === "mock" ? fm(a.score) + "/" + fm(a.total) : a.overall + "%") + "</b> · " +
        (pend ? '<a href="#' + esc(test.id) + "/mark/" + esc(a.id) + '">Finish marking</a>' : '<a href="#' + esc(test.id) + "/report/" + esc(a.id) + '">Report</a>') + "</span></li>";
    }).join("") + "</ul></section>";
  }

  function historyTools() {
    return '<section class="card no-print"><h2>Move or clear your history</h2>' +
      '<p class="muted small">Your attempts live only in this browser. Export them to a file to keep a copy or move to another device, then import it there.</p>' +
      '<div class="row"><button class="btn ghost" id="exp">Export history</button>' +
      '<label class="btn ghost" for="imp" style="margin:0">Import history</label><input type="file" id="imp" accept=".json,application/json" hidden>' +
      '<button class="btn danger" id="clr">Clear history</button></div><p class="small" id="histmsg" role="status"></p></section>';
  }
  function wireHistoryTools(refresh) {
    $("#exp").addEventListener("click", function () {
      if (!history().attempts.length) { $("#histmsg").textContent = "No attempts saved yet."; return; } exportHistory();
    });
    $("#imp").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      importHistory(f, function (msg) { refresh(); var m = $("#histmsg"); if (m) m.textContent = msg; });
    });
    $("#clr").addEventListener("click", function () {
      if (!confirm("Delete every saved attempt and report on this device? This can't be undone.")) return;
      clearHistory(); refresh(); var m = $("#histmsg"); if (m) m.textContent = "History cleared.";
    });
  }

  /* ---------- readiness test player ---------- */
  function renderTest(test) {
    if (isMock(test)) return renderMockTest(test);
    document.body.classList.remove("print-view"); setTitle(test.short_title);
    var key = LS.prog + test.id;
    var p = lsGet(key, null);
    if (!p) { p = { testId: test.id, answers: {}, cur: 0, elapsed: 0, started: new Date().toISOString() }; lsSet(key, p); }
    var N = test.questions.length, showPal = false;
    p.cur = Math.min(Math.max(0, p.cur | 0), N - 1);

    function save() { lsSet(key, p); }
    function answeredCount() { return test.questions.filter(function (q) { return isAnswered(q, p.answers[q.id]); }).length; }
    function tick() {
      if (document.visibilityState === "visible") { p.elapsed = (p.elapsed || 0) + 1; if (p.elapsed % 5 === 0) save(); }
      var t = $("#timer"); if (t) {
        t.textContent = "⏱ " + fmtTime(p.elapsed);
        t.classList.toggle("over", !!test.suggested_minutes && p.elapsed > test.suggested_minutes * 60);
      }
    }
    stopTimer();
    topbarTimer('<span class="timer" id="timer" role="timer" aria-label="Time taken">⏱ ' + fmtTime(p.elapsed || 0) + "</span>");
    timerId = setInterval(tick, 1000);

    function draw() {
      var q = test.questions[p.cur], a = p.answers[q.id], done = answeredCount();
      var h = '<div class="qhead"><span class="qno">Question ' + (p.cur + 1) + " of " + N + '</span><span class="muted small">' + done + " answered</span></div>" +
        '<div class="progressbar" aria-hidden="true"><i style="width:' + pct(done, N) + '%"></i></div>' +
        '<section class="card"><div class="row" style="gap:.35rem">' +
        '<span class="chip">' + esc(q.level) + " · " + esc((test.levels[q.level] || {}).label || "") + "</span>" +
        (q.pattern && test.patterns && test.patterns[q.pattern] ? '<span class="chip exam">Board pattern: ' + esc(test.patterns[q.pattern]) + "</span>" : "") +
        "</div>" + qBody(q);
      if (q.type === "numeric") {
        h += '<label class="field" for="num">Your answer</label><div class="numrow">' +
          '<input class="text" id="num" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next" placeholder="Type a whole number" value="' + esc(a || "") + '">' +
          '<button class="btn ghost" id="neg" type="button" aria-label="Make negative or positive">±</button></div>' +
          '<p class="muted small" style="margin-top:.4rem">Whole number only; use ± for a negative answer.</p>';
      } else {
        h += '<div class="opts" role="radiogroup" aria-label="Options">' + q.options.map(function (o, i) {
          var L = letter(i), sel = a === L;
          return '<label class="opt' + (sel ? " sel" : "") + '"><input type="radio" name="opt" value="' + L + '"' + (sel ? " checked" : "") + '><span class="letter">' + L + '</span><span class="math">' + mt(o) + "</span></label>";
        }).join("") + "</div>";
        if (isAnswered(q, a)) h += '<p style="margin:.6rem 0 0"><button class="btn ghost" id="clearans" type="button" style="min-height:36px;padding:.3rem .8rem;font-size:.85rem">Clear answer</button></p>';
      }
      h += '<div class="qnav"><button class="btn secondary" id="prev"' + (p.cur === 0 ? " disabled" : "") + ">← Previous</button>" +
        (p.cur < N - 1 ? '<button class="btn" id="next">Next →</button>' : '<button class="btn" id="submit">Submit test</button>') + "</div></section>" +
        '<section class="card"><div class="row" style="justify-content:space-between"><button class="btn ghost" id="pal" aria-expanded="' + showPal + '">' + (showPal ? "Hide" : "Show") + ' all questions</button>' +
        (p.cur < N - 1 ? '<button class="btn secondary" id="submit2">Submit test</button>' : "") + "</div>" +
        (showPal ? '<div class="palette">' + test.questions.map(function (qq, i) {
          return '<button data-i="' + i + '" class="' + (isAnswered(qq, p.answers[qq.id]) ? "done " : "") + (i === p.cur ? "cur" : "") + '" aria-label="Question ' + (i + 1) + '">' + (i + 1) + "</button>";
        }).join("") + '</div><p class="legend">Teal = answered. Tap a number to jump.</p>' : "") + "</section>";
      app.innerHTML = h;

      $all('input[name="opt"]').forEach(function (r) {
        r.addEventListener("change", function () { p.answers[q.id] = r.value; save(); draw(); });
      });
      var num = $("#num");
      if (num) {
        num.addEventListener("input", function () {
          var v = num.value.replace(/[\u2212\u2013]/g, "-").replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "");
          if (v !== num.value) num.value = v;
          if (v && v !== "-") p.answers[q.id] = v; else delete p.answers[q.id];
          save(); var c = $(".qhead .muted"); if (c) c.textContent = answeredCount() + " answered";
          var bar = $(".progressbar i"); if (bar) bar.style.width = pct(answeredCount(), N) + "%";
        });
        num.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (p.cur < N - 1) { p.cur++; save(); draw(); } } });
        $("#neg").addEventListener("click", function () {
          var v = num.value; num.value = v.charAt(0) === "-" ? v.slice(1) : "-" + v; num.dispatchEvent(new Event("input")); num.focus();
        });
      }
      if ($("#clearans")) $("#clearans").addEventListener("click", function () { delete p.answers[q.id]; save(); draw(); });
      $("#prev").addEventListener("click", function () { if (p.cur > 0) { p.cur--; save(); draw(); scrollTo(0, 0); } });
      if ($("#next")) $("#next").addEventListener("click", function () { p.cur++; save(); draw(); scrollTo(0, 0); });
      $("#pal").addEventListener("click", function () { showPal = !showPal; draw(); });
      $all(".palette button").forEach(function (b) { b.addEventListener("click", function () { p.cur = +b.dataset.i; save(); showPal = false; draw(); scrollTo(0, 0); }); });
      ["#submit", "#submit2"].forEach(function (s) { if ($(s)) $(s).addEventListener("click", confirmSubmit); });
    }

    function confirmSubmit() {
      var left = N - answeredCount();
      submitModal(left ? "You have <b>" + left + "</b> unanswered question" + (left > 1 ? "s" : "") + ". They will count as not correct." : "All " + N + " questions answered.", finish);
    }
    function finish() {
      stopTimer();
      var s = score(test, p.answers);
      var subs = {}; Object.keys(s.subs).forEach(function (k) { subs[k] = pct(s.subs[k].c, s.subs[k].t); });
      var levels = {}; Object.keys(s.levels).forEach(function (k) { levels[k] = pct(s.levels[k].c, s.levels[k].t); });
      var att = {
        id: newId(), testId: test.id, testVersion: test.version || 1,
        date: new Date().toISOString(), durationSec: p.elapsed || 0, answers: p.answers,
        score: s.correct, total: s.total, overall: s.overall, subs: subs, levels: levels
      };
      var h = history(); h.attempts.push(att);
      if (!saveHistory(h)) alert("Your phone's storage for this site is full, so this attempt couldn't be saved to history. Download the report to keep it.");
      lsDel(key);
      go("#" + test.id + "/report/" + att.id);
    }
    draw();
  }
  function newId() { return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function submitModal(msg, ok) {
    var back = document.createElement("div"); back.className = "modal-back";
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">Submit your test?</h2><p>' + msg +
      '</p><div class="row end"><button class="btn ghost" id="mcancel">Keep working</button><button class="btn" id="mok">Submit</button></div></div>';
    document.body.appendChild(back);
    $("#mcancel").addEventListener("click", function () { back.remove(); });
    $("#mok").addEventListener("click", function () { back.remove(); ok(); });
    $("#mok").focus();
  }

  /* ---------- mock paper: intro ---------- */
  function secOf(test, id) { return (test.sections || []).filter(function (s) { return s.id === id; })[0] || { id: id, name: "Section " + id }; }
  function secRange(test, sid) {
    var ns = test.questions.filter(function (Q) { return Q.section === sid; }).map(function (Q) { return Q.n; });
    return ns.length ? (ns.length > 1 ? "Q" + ns[0] + "–" + ns[ns.length - 1] : "Q" + ns[0]) : "";
  }
  function newMockProg(test) { return { testId: test.id, kind: "mock", answers: {}, choice: {}, paper: {}, secTime: {}, cur: 0, elapsed: 0, started: new Date().toISOString() }; }
  function renderMockIntro(test) {
    stopTimer(); topbarTimer(); setTitle(test.short_title); document.body.classList.remove("print-view");
    var prog = lsGet(LS.prog + test.id, null), atts = attemptsFor(test.id);
    var answered = prog ? test.questions.filter(function (Q) { return qDone(Q, prog); }).length : 0;
    var rows = (test.sections || []).map(function (s) {
      return "<tr><td><b>" + esc(s.name) + "</b>" + (s.title ? '<div class="muted small">' + esc(s.title) + "</div>" : "") + '</td><td class="n">' + esc(secRange(test, s.id)) +
        '</td><td class="n">' + fm(s.marks) + '</td><td class="n">' + (s.minutes ? "~" + s.minutes + " min" : "") + "</td></tr>";
    }).join("");
    var h = '<section class="card hero"><div class="eyebrow">' + esc(test.subject) + " · Class " + esc(test["class"] || "10") + "</div>" +
      "<h1>" + esc(test.title) + '</h1><p class="tagline">' + esc(test.tagline || "") + '</p>' +
      '<p class="meta">' + fm(test.max_marks) + " marks · " + fmtDur(test.duration_minutes * 60).replace("180 min", "3 hours") + " · " + test.questions.length + " questions</p></section>" +
      '<section class="card"><h2>Paper structure</h2><div class="table-wrap"><table class="hist struct"><tr><th>Section</th><th>Questions</th><th>Marks</th><th>Pace</th></tr>' + rows + "</table></div>" +
      (test.structure_source ? '<p class="muted small" style="margin-top:.5rem">Structure follows ' + extLink(test.structure_source.url, test.structure_source.label) + ". Suggested pace is our guide, not CBSE's.</p>" : "") +
      "</section>" +
      '<section class="card"><h2>How it works</h2><ul class="howto">' + (test.instructions || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      nickField() +
      '<div class="stack" style="margin-top:1rem">' +
      (prog && answered ? '<button class="btn full" id="resume">Resume paper (' + answered + "/" + test.questions.length + ' questions started)</button><button class="btn secondary full" id="start">Start a fresh attempt</button>'
        : '<button class="btn full" id="start">Start the paper</button>') + "</div>" +
      '<p class="muted small" style="margin-top:.8rem">Private by design: no sign-up, no tracking. Answers and marks stay on this device.</p></section>';
    h += attemptsList(test, atts) + historyTools() + '<section class="card">' + footerLinks(test) + "</section>";
    app.innerHTML = h;
    wireNick();
    $("#start").addEventListener("click", function () {
      if (prog && answered && !confirm("Start again? Your unfinished answers will be cleared.")) return;
      lsSet(LS.prog + test.id, newMockProg(test)); go("#" + test.id + "/test");
    });
    if ($("#resume")) $("#resume").addEventListener("click", function () { go("#" + test.id + "/test"); });
    wireHistoryTools(function () { renderMockIntro(test); });
  }

  /* ---------- mock paper: player ---------- */
  function renderMockTest(test) {
    document.body.classList.remove("print-view"); setTitle(test.short_title);
    var key = LS.prog + test.id, p = lsGet(key, null);
    if (!p || p.kind !== "mock") { p = newMockProg(test); lsSet(key, p); }
    ["answers", "choice", "paper", "secTime"].forEach(function (k) { p[k] = p[k] || {}; });
    var QS = test.questions, N = QS.length, showPal = false, limit = (test.duration_minutes || 180) * 60;
    p.cur = Math.min(Math.max(0, p.cur | 0), N - 1);
    function save() { lsSet(key, p); }
    function doneCount() { return QS.filter(function (Q) { return qDone(Q, p) === 2; }).length; }
    function tick() {
      if (document.visibilityState === "visible") {
        p.elapsed = (p.elapsed || 0) + 1; var s = QS[p.cur].section; p.secTime[s] = (p.secTime[s] || 0) + 1;
        if (p.elapsed % 5 === 0) save();
      }
      var t = $("#timer"); if (t) { t.textContent = "⏱ " + fmtTime(p.elapsed) + " / " + fmtTime(limit); t.classList.toggle("over", p.elapsed > limit); }
    }
    stopTimer();
    topbarTimer('<span class="timer" id="timer" role="timer" aria-label="Time taken">⏱ ' + fmtTime(p.elapsed || 0) + " / " + fmtTime(limit) + "</span>");
    timerId = setInterval(tick, 1000);

    function inputHTML(it) {
      var a = p.answers[it.id];
      if (it.type === "numeric") {
        return '<div class="numrow"><input class="text" data-num="' + esc(it.id) + '" type="text" inputmode="decimal" autocomplete="off" placeholder="Type the number" value="' + esc(a || "") + '"></div>';
      }
      if (it.type === "self") {
        return '<textarea class="text ans" data-self="' + esc(it.id) + '" rows="' + (it.marks >= 5 ? 7 : it.marks >= 3 ? 5 : 3) + '" placeholder="Write on paper or type here (optional)">' + esc(a || "") + "</textarea>" +
          '<label class="paperchk"><input type="checkbox" data-paper="' + esc(it.id) + '"' + (p.paper[it.id] ? " checked" : "") + "> I've written this answer on paper</label>";
      }
      return '<div class="opts" role="radiogroup">' + it.options.map(function (o, i) {
        var L = letter(i), sel = a === L;
        return '<label class="opt' + (sel ? " sel" : "") + '"><input type="radio" name="o_' + esc(it.id) + '" data-opt="' + esc(it.id) + '" value="' + L + '"' + (sel ? " checked" : "") + '><span class="letter">' + L + '</span><span class="math">' + mt(o) + "</span></label>";
      }).join("") + "</div>" + (isAnswered(it, a) ? '<button class="linkbtn" type="button" data-clear="' + esc(it.id) + '">Clear answer</button>' : "");
    }
    function itemHTML(it, label) {
      var h = '<div class="part">' + (label ? '<div class="plabel"><b>' + esc(label) + "</b><span class=\"muted small\">" + fm(it.marks) + " mark" + (it.marks === 1 ? "" : "s") + "</span></div>" : "");
      h += qBody(it);
      if (it.words) h += '<p class="muted small">Answer in about ' + esc(it.words) + " words.</p>";
      return h + inputHTML(it) + "</div>";
    }
    function unitHTML(u, label) {
      if (!u.alts) return itemHTML(u, label);
      var ci = p.choice[u.id] | 0;
      return '<div class="choice"><div class="seg" role="group" aria-label="Internal choice">' + u.alts.map(function (alt, i) {
        return '<button type="button" data-choice="' + esc(u.id) + '" data-ci="' + i + '" class="' + (i === ci ? "on" : "") + '">Option ' + esc(alt.label || letter(i)) + "</button>";
      }).join('<span class="or">OR</span>') + '</div><p class="muted small">Internal choice: attempt either option. Only the option shown is marked.</p>' +
        itemHTML(u.alts[ci] || u.alts[0], label) + "</div>";
    }
    function draw() {
      var Q0 = QS[p.cur], Q = view(Q0, p.choice), sec = secOf(test, Q.section), done = doneCount();
      var h = '<div class="qhead"><span class="qno">' + esc(sec.name) + " · Q" + Q.n + " of " + N + '</span><span class="muted small" id="donec">' + done + " done</span></div>" +
        '<div class="progressbar" aria-hidden="true"><i style="width:' + pct(done, N) + '%"></i></div>' +
        '<section class="card"><div class="row" style="gap:.35rem"><span class="chip">' + fm(Q.marks) + " mark" + (Q.marks === 1 ? "" : "s") + "</span>" +
        (Q.qtype ? '<span class="chip exam">' + esc(Q.qtype) + "</span>" : "") + "</div>";
      if (Q.galts) {
        var gi = p.choice[Q.id] | 0;
        h += '<div class="seg" role="group" aria-label="Choose one">' + Q.galts.map(function (g, i) {
          return '<button type="button" data-choice="' + esc(Q.id) + '" data-ci="' + i + '" class="' + (i === gi ? "on" : "") + '">' + esc(g.label || ("Option " + letter(i))) + "</button>";
        }).join('<span class="or">OR</span>') + '</div><p class="muted small">Answer any one: only the one shown is marked.</p>';
      }
      if (Q.stem) h += '<div class="stem math">' + para(Q.stem) + "</div>";
      var us = units(Q), bl = blocksOf(Q), bstart = {}, k0 = 0;
      (bl || []).forEach(function (b) { if (b.best < b.n || b.title) bstart[k0] = b; k0 += b.n; });
      us.forEach(function (u, i) {
        var b = bstart[i];
        if (b) h += '<p class="note">' + (b.title ? esc(b.title) + " · " : "") + (b.best < b.n ? "Answer any " + b.best + " of " + b.n + ". If you answer more, your best " + b.best + " count." : "") + "</p>";
        h += unitHTML(u, Q.parts ? (u.label || "(" + romanLow(i + 1) + ")") : "");
      });
      h += '<div class="qnav"><button class="btn secondary" id="prev"' + (p.cur === 0 ? " disabled" : "") + ">← Previous</button>" +
        (p.cur < N - 1 ? '<button class="btn" id="next">Next →</button>' : '<button class="btn" id="submit">Submit paper</button>') + "</div></section>" +
        '<section class="card"><div class="row" style="justify-content:space-between"><button class="btn ghost" id="pal" aria-expanded="' + showPal + '">' + (showPal ? "Hide" : "Show") + ' all questions</button>' +
        (p.cur < N - 1 ? '<button class="btn secondary" id="submit2">Submit paper</button>' : "") + "</div>" +
        (showPal ? (test.sections || []).map(function (s) {
          return '<div class="palsec"><div class="muted small"><b>' + esc(s.name) + "</b> · " + fm(s.marks) + ' marks</div><div class="palette">' + QS.map(function (qq, i) {
            if (qq.section !== s.id) return "";
            var d = qDone(qq, p);
            return '<button data-i="' + i + '" class="' + (d === 2 ? "done " : d === 1 ? "half " : "") + (i === p.cur ? "cur" : "") + '" aria-label="Question ' + qq.n + '">' + qq.n + "</button>";
          }).join("") + "</div></div>";
        }).join("") + '<p class="legend">Teal = done, light = partly done. Tap a number to jump.</p>' : "") + "</section>";
      app.innerHTML = h;
      wire();
    }
    function refreshCount() {
      var c = $("#donec"); if (c) c.textContent = doneCount() + " done";
      var bar = $(".progressbar i"); if (bar) bar.style.width = pct(doneCount(), N) + "%";
    }
    function wire() {
      $all("input[data-opt]").forEach(function (r) { r.addEventListener("change", function () { p.answers[r.dataset.opt] = r.value; save(); draw(); }); });
      $all("[data-clear]").forEach(function (b) { b.addEventListener("click", function () { delete p.answers[b.dataset.clear]; save(); draw(); }); });
      $all("input[data-num]").forEach(function (inp) {
        inp.addEventListener("input", function () {
          var v = inp.value.replace(/[\u2212\u2013]/g, "-").replace(/[^0-9.\-\/]/g, "");
          if (v !== inp.value) inp.value = v;
          if (v && v !== "-") p.answers[inp.dataset.num] = v; else delete p.answers[inp.dataset.num];
          save(); refreshCount();
        });
      });
      $all("textarea[data-self]").forEach(function (ta) {
        ta.addEventListener("input", function () {
          var v = ta.value.slice(0, 4000); if (v.trim()) p.answers[ta.dataset.self] = v; else delete p.answers[ta.dataset.self];
          save(); refreshCount();
        });
      });
      $all("input[data-paper]").forEach(function (c) {
        c.addEventListener("change", function () { if (c.checked) p.paper[c.dataset.paper] = 1; else delete p.paper[c.dataset.paper]; save(); refreshCount(); });
      });
      $all("[data-choice]").forEach(function (b) { b.addEventListener("click", function () { p.choice[b.dataset.choice] = +b.dataset.ci; save(); draw(); }); });
      $("#prev").addEventListener("click", function () { if (p.cur > 0) { p.cur--; save(); draw(); scrollTo(0, 0); } });
      if ($("#next")) $("#next").addEventListener("click", function () { p.cur++; save(); draw(); scrollTo(0, 0); });
      $("#pal").addEventListener("click", function () { showPal = !showPal; draw(); });
      $all(".palette button").forEach(function (b) { b.addEventListener("click", function () { p.cur = +b.dataset.i; save(); showPal = false; draw(); scrollTo(0, 0); }); });
      ["#submit", "#submit2"].forEach(function (s) { if ($(s)) $(s).addEventListener("click", confirmSubmit); });
    }
    function confirmSubmit() {
      var left = QS.filter(function (Q) { return qDone(Q, p) < 2; }).length;
      submitModal((left ? "<b>" + left + "</b> question" + (left > 1 ? "s are" : " is") + " not fully answered. Unanswered parts score zero. " : "All " + N + " questions answered. ") +
        "Next you'll mark your written answers against the model answers.", finish);
    }
    function finish() {
      stopTimer();
      var att = { id: newId(), testId: test.id, testVersion: test.version || 1, kind: "mock", date: new Date().toISOString(),
        durationSec: p.elapsed || 0, answers: p.answers, choice: p.choice, paper: p.paper, secTime: p.secTime, self: {} };
      stampMock(test, att);
      var h = history(); h.attempts.push(att);
      if (!saveHistory(h)) alert("Your phone's storage for this site is full, so this attempt couldn't be saved to history. Download the report to keep it.");
      lsDel(key);
      go("#" + test.id + (selfItems(test, att).length ? "/mark/" : "/report/") + att.id);
    }
    draw();
  }
  function romanLow(n) { return ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv"][n - 1] || String(n); }
  // store summary numbers on the attempt (history table, progress, export)
  function stampMock(test, att) {
    var r = scoreMock(test, att);
    att.score = r.e; att.total = r.m; att.overall = r.overall;
    att.sections = {}; Object.keys(r.sections).forEach(function (k) { att.sections[k] = pct(r.sections[k].e, r.sections[k].m); });
    att.subs = {}; Object.keys(r.chapters).forEach(function (k) { att.subs[k] = pct(r.chapters[k].e, r.chapters[k].m); });
    att.marked = r.pending ? undefined : 1;
    if (!selfItems(test, att).length) att.marked = 1;
    return r;
  }

  /* ---------- mock paper: self-marking ---------- */
  function renderMarking(test, att) {
    stopTimer(); topbarTimer(); setTitle("Mark your answers · " + (test.short_title || "")); document.body.classList.remove("print-view");
    var items = selfItems(test, att), self = JSON.parse(JSON.stringify(att.self || {}));
    var h = '<section class="card hero"><div class="eyebrow">Step 2 of 2 · Self-marking</div><h1>Mark your written answers</h1>' +
      '<p>For each answer, read the model answer, then tick every rubric point your answer really covers. Be strict: a board examiner gives a mark only when the point is clearly there.</p>' +
      '<p class="muted small">Objective questions are already marked. ' + items.length + " written answer" + (items.length === 1 ? "" : "s") + " to mark. You can come back and change these marks later from your report.</p></section>";
    items.forEach(function (x, i) {
      var it = x.it, a = (att.answers || {})[it.id], prev = self[it.id], done = itemDone(it, att);
      h += '<section class="card markcard" data-item="' + esc(it.id) + '"><div class="qhead"><span class="qno">Q' + x.Q.n + (x.Q.parts ? " · part" : "") + "</span>" +
        '<span class="chip" data-tot="' + esc(it.id) + '">0/' + fm(it.marks) + "</span></div>" +
        (x.Q.stem && x.Q.parts ? '<details class="stemfold"><summary>Show the passage / case</summary><div class="stem">' + para(x.Q.stem) + "</div></details>" : "") +
        qBody(it) +
        '<div class="yourans"><b>Your answer:</b> ' + (isAnswered(it, a) ? para(a) : (done ? "<i>Written on paper</i>" : "<i>Not attempted</i>")) + "</div>" +
        '<details class="model" open><summary>Model answer</summary>' + para(it.model_answer) + "</details>" +
        '<div class="rubric"><b>Marking scheme</b>' + (it.rubric || []).map(function (rp, j) {
          var v = Array.isArray(prev) ? +prev[j] || 0 : 0;
          if (rp.m <= 1) {
            return '<label class="rp"><input type="checkbox" data-rp="' + esc(it.id) + '" data-j="' + j + '" data-m="' + rp.m + '"' + (v >= rp.m ? " checked" : "") + '><span>' + mt(rp.p) + ' <b class="muted">(' + fm(rp.m) + ")</b></span></label>";
          }
          var opts = ""; for (var k = 0; k <= rp.m * 2; k++) { var val = k / 2; opts += '<option value="' + val + '"' + (val === v ? " selected" : "") + ">" + fm(val) + "</option>"; }
          return '<label class="rp"><select data-rp="' + esc(it.id) + '" data-j="' + j + '" data-m="' + rp.m + '">' + opts + "</select><span>" + mt(rp.p) + ' <b class="muted">(up to ' + fm(rp.m) + ")</b></span></label>";
        }).join("") + "</div>" + (!done ? '<p class="muted small">Not attempted: leave every box empty (0 marks).</p>' : "") + "</section>";
    });
    h += '<section class="card no-print"><div class="stack"><button class="btn full" id="savemarks">Save marks and see my report</button>' +
      '<a class="btn secondary full" href="#' + esc(test.id) + '">Do this later</a></div></section>';
    app.innerHTML = h;
    function collect(id) {
      var arr = [];
      $all('[data-rp="' + id + '"]').forEach(function (el) {
        var j = +el.dataset.j, m = +el.dataset.m; arr[j] = el.tagName === "SELECT" ? +el.value : (el.checked ? m : 0);
      });
      for (var i = 0; i < arr.length; i++) arr[i] = arr[i] || 0;
      return arr;
    }
    function upd(id) {
      var it = items.filter(function (x) { return x.it.id === id; })[0].it, arr = collect(id), s = arr.reduce(function (a, b) { return a + b; }, 0);
      var chip = $('[data-tot="' + id + '"]'); if (chip) chip.textContent = fm(Math.min(s, it.marks)) + "/" + fm(it.marks);
    }
    items.forEach(function (x) { upd(x.it.id); });
    $all("[data-rp]").forEach(function (el) { el.addEventListener("change", function () { upd(el.dataset.rp); }); });
    $("#savemarks").addEventListener("click", function () {
      items.forEach(function (x) { self[x.it.id] = collect(x.it.id); });
      att.self = self; stampMock(test, att); att.marked = 1;
      if (!updateAttempt(att)) alert("Couldn't save to this phone's storage.");
      go("#" + test.id + "/report/" + att.id);
    });
    scrollTo(0, 0);
  }

  /* ---------- progress chart (shared) ---------- */
  function lineChart(points, curId, labelOffset) {
    var W = 360, H = 210, L = 34, R = 22, T = 24, B = 30, n = points.length;
    var xs = function (i) { return L + 18 + (i * (W - L - R - 18)) / Math.max(1, n - 1); };
    var ys = function (v) { return T + (1 - v / 100) * (H - T - B); };
    var g = "";
    [0, 25, 50, 75, 100].forEach(function (v) {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ys(v) + '" y2="' + ys(v) + '" stroke="#e3e1d8" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (ys(v) + 4) + '" font-size="11" text-anchor="end" fill="#4a5572">' + v + "</text>";
    });
    g += '<polyline points="' + points.map(function (a, i) { return xs(i) + "," + ys(a.overall); }).join(" ") + '" fill="none" stroke="#0f7c78" stroke-width="3" stroke-linejoin="round"/>';
    points.forEach(function (a, i) {
      var cur = a.id === curId;
      g += '<circle cx="' + xs(i) + '" cy="' + ys(a.overall) + '" r="' + (cur ? 6 : 4.5) + '" fill="' + (cur ? "#14213d" : "#0f7c78") + '"/>' +
        '<text x="' + xs(i) + '" y="' + (ys(a.overall) - 10) + '" font-size="13" font-weight="700" text-anchor="middle" fill="#14213d">' + a.overall + "%</text>" +
        '<text x="' + xs(i) + '" y="' + (H - 12) + '" font-size="11" text-anchor="middle" fill="#4a5572">#' + (labelOffset + i + 1) + "</text>";
    });
    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Overall score across attempts">' + g + "</svg>";
  }
  function progressTable(shown, upto, rows) {
    var n = shown.length;
    var head = "<tr><th>Attempt</th>" + shown.map(function (a, i) {
      return "<th>#" + (upto.length - n + i + 1) + '<div class="muted small" style="font-weight:400">' + esc(fmtDate(a.date)) + "</div></th>";
    }).join("") + "</tr>";
    function rowCells(get) {
      return shown.map(function (a, i) {
        var v = get(a), prev = i > 0 ? get(shown[i - 1]) : null, c = "";
        if (v == null) return "<td>–</td>";
        if (prev != null) c = v > prev ? "up" : v < prev ? "down" : "";
        return '<td class="' + c + '">' + v + "%</td>";
      }).join("");
    }
    return '<div class="table-wrap"><table class="hist">' + head + rows.map(function (r) {
      return "<tr><td>" + (r.bold ? "<b>" + esc(r.label) + "</b>" : esc(r.label)) + "</td>" + rowCells(r.get) + "</tr>";
    }).join("") + "</table></div>";
  }

  /* ---------- readiness report ---------- */
  function progressSection(test, att) {
    var atts = attemptsFor(test.id);
    var idx = atts.map(function (a) { return a.id; }).indexOf(att.id);
    var upto = idx >= 0 ? atts.slice(0, idx + 1) : atts.concat([att]);
    var shown = upto.slice(-6);
    var h = '<section class="card allow-break"><h2>Your progress on this test</h2>';
    if (upto.length < 2) {
      h += "<p>This is your first saved attempt of this test on this device. Your next attempt will show here as a chart, so you can see what moved.</p>";
    } else {
      h += lineChart(shown, att.id, upto.length - shown.length);
      var rows = [{ label: "Overall", bold: 1, get: function (a) { return a.overall; } }];
      Object.keys(test.subtopics).forEach(function (k) {
        rows.push({ label: test.subtopics[k].name, get: function (a) { return a.subs && a.subs[k] != null ? a.subs[k] : null; } });
      });
      h += progressTable(shown, upto, rows) +
        '<p class="muted small" style="margin-top:.5rem">Green = up on the previous attempt, red = down.' + (upto.length > 6 ? " Showing your latest 6 of " + upto.length + " attempts." : "") + "</p>";
    }
    h += '<p class="repeat">' + esc(REPEAT_TEXT) + "</p></section>";
    return h;
  }

  function reportHTML(test, att) {
    var s = score(test, att.answers || {}), b = band(s, test), nk = nick(), sk = subjectOf(test), smap = manifest(test.id).sub_chapter || {};
    var h = '<article class="report" id="report">';
    h += '<section class="card hero"><div class="report-head"><img src="logo-192.png" alt="Teraminds Academy" id="rlogo"><div>' +
      '<div class="eyebrow">Readiness report · ' + esc(test.short_title || test.chapter) + "</div><h1>" + esc(test.title) + "</h1></div></div>" +
      '<p class="tagline">' + esc(test.tagline || "") + "</p>" +
      '<p class="meta">' + (nk ? "Prepared for <b>" + esc(nk) + "</b> · " : "") + esc(fmtDate(att.date, true)) + " · Time taken " + esc(fmtDur(att.durationSec || 0)) + "</p></section>";

    h += '<section class="card"><div class="score-card"><div class="ring" style="--p:' + s.overall + '"><span>' + s.overall + "%<small>" + s.correct + " / " + s.total + "</small></span></div>" +
      '<div><div class="band ' + b.k + '">' + esc(b.name) + "</div><p>" + esc(b.text) + "</p>" +
      '<p class="muted small" style="margin:0">Readiness bands: Building (below 50%) · Getting there (50–79%) · Board-ready (80%+ and at least 60% on board-pattern and HOTS questions). They describe this practice attempt only, not a prediction of board marks.</p></div></div></section>';

    var weak = Object.keys(test.subtopics).filter(function (k) { var v = s.subs[k]; return v && v.t && pct(v.c, v.t) < 75; })
      .sort(function (a, b2) {
        var pa = pct(s.subs[a].c, s.subs[a].t), pb = pct(s.subs[b2].c, s.subs[b2].t);
        return pa - pb || (s.subs[b2].t - s.subs[b2].c) - (s.subs[a].t - s.subs[a].c);
      });
    var strong = Object.keys(test.subtopics).filter(function (k) { var v = s.subs[k]; return v && v.t && pct(v.c, v.t) >= 75; });

    // personalised summary: top 3 focus areas with the matching video part and worksheet
    h += '<section class="card summary"><h2>Your top 3 focus areas</h2>';
    if (weak.length) {
      h += '<ol class="top3">' + weak.slice(0, 3).map(function (k) {
        var v = s.subs[k], info = chapterInfo(sk, smap[k], null);
        return "<li><b>" + esc(test.subtopics[k].name) + '</b> <span class="chip bad">' + pct(v.c, v.t) + "%</span>" +
          (info ? linksHTML(info) : test.links && test.links.length ? '<div class="linkrow">' + test.links.map(function (l, i) { return extLink(l.url, (/youtu/.test(l.url) ? "▶ " : "") + l.label, /youtu/.test(l.url) ? "lnk" : "lnk ws"); }).join("") + "</div>" : '<div class="linkrow">' + (test.video_url ? extLink(test.video_url, "▶ Watch the video", "lnk") : "") + extLink(test.worksheet_url || LINKS.worksheets, "Worksheet", "lnk ws") + "</div>") + "</li>";
      }).join("") + "</ol>";
    } else h += c12(test) ? "<p>No weak " + subLabel(test) + " on this attempt. Next: timed practice with full-length board-pattern papers.</p>" : "<p>No weak subtopic on this attempt. Next: a full Board-pattern Mock Paper for this subject.</p>";
    h += '<p class="muted small">Strengths: ' + (strong.length ? strong.map(function (k) { return esc(test.subtopics[k].name); }).join(", ") : "none at 75% yet") + "</p></section>";

    h += '<section class="card"><h2>By difficulty level</h2><table class="bars">' + Object.keys(test.levels).map(function (k) {
      var v = s.levels[k] || { c: 0, t: 0 }; if (!v.t) return "";
      var nm = test.levels[k].name; return barRow(k + " · " + test.levels[k].label, v.c, v.t, nm && nm.toLowerCase() !== test.levels[k].label.toLowerCase() ? nm : "");
    }).join("") + "</table></section>";

    h += '<section class="card allow-break"><h2>By ' + esc(subLabel(test)) + '</h2><table class="bars">' + Object.keys(test.subtopics).map(function (k) {
      var v = s.subs[k] || { c: 0, t: 0 }; if (!v.t) return ""; return barRow(test.subtopics[k].name, v.c, v.t);
    }).join("") + "</table></section>";

    h += "<section class=\"card\"><h2>What you've got</h2>" + (strong.length ? '<ul class="good-list">' + strong.map(function (k) {
      var v = s.subs[k]; return "<li>" + esc(test.subtopics[k].name) + ' <span class="muted small">(' + v.c + "/" + v.t + ")</span></li>";
    }).join("") + "</ul>" : "<p>No subtopic at 75% or above yet. That's what this test is for: the plan below shows where to start.</p>") + "</section>";

    h += '<section class="card allow-break"><h2>Focus next</h2>';
    if (weak.length) {
      h += '<p class="muted small">Weakest first. Fix these, then repeat the test.</p><ol class="focus-list">' + weak.map(function (k, i) {
        var v = s.subs[k], st = test.subtopics[k];
        var parts = [], tips = [];
        s.wrong.forEach(function (w) {
          if (w.q.subtopic !== k || !w.q.remediation) return;
          var r = w.q.remediation.replace(/Video parts? ([\d]+(?:\s*(?:,|and)\s*\d+)*)/i, function (m0, nums) {
            nums.split(/\s*(?:,|and)\s*/).forEach(function (n) { if (parts.indexOf(n) < 0) parts.push(n); }); return "";
          }).replace(/^[\s;:,.]+|[\s;:,.]+$/g, "").replace(/^\((.*)\)$/, "$1");
          if (r && tips.indexOf(r) < 0) tips.push(r.charAt(0).toUpperCase() + r.slice(1));
        });
        parts.sort(function (a, b3) { return a - b3; });
        tips = tips.slice(0, 3);
        if (parts.length) tips.unshift("Re-watch video part" + (parts.length > 1 ? "s " : " ") + parts.join(", "));
        return '<li><div><span class="rank">' + (i + 1) + ".</span><b>" + esc(st.name) + '</b> <span class="chip bad">' + pct(v.c, v.t) + "% · " + v.c + "/" + v.t + "</span></div>" +
          (st.tip ? '<p style="margin:.4rem 0 0">' + esc(st.tip) + "</p>" : "") +
          (st.ncert ? '<div class="ncert"><b>Book practice:</b> ' + esc(st.ncert) + "</div>" : "") +
          (tips.length ? "<ul>" + tips.map(function (t) { return "<li>" + mt(t) + "</li>"; }).join("") + "</ul>" : "") + "</li>";
      }).join("") + "</ol>";
    } else h += c12(test) ? "<p>Every " + subLabel(test) + " is at 75% or above. Next step: timed full-length board-pattern papers.</p>" : "<p>Every subtopic is at 75% or above. Next step: the hard questions in the worksheet, then a timed full paper.</p>";
    h += footerLinks(test) + "</section>";

    h += '<section class="card allow-break"><h2>Where you missed</h2>';
    if (s.wrong.length) {
      h += '<p class="muted small">' + s.wrong.length + " question" + (s.wrong.length > 1 ? "s" : "") + " to review, with the correct answer and why.</p>" + s.wrong.map(function (w) {
        var q = w.q, a = (att.answers || {})[q.id];
        return '<div class="miss"><div class="row" style="gap:.35rem"><b>Q' + w.n + '</b><span class="chip">' + esc(q.level) + "</span>" +
          '<span class="chip">' + esc(test.subtopics[q.subtopic].name) + "</span></div>" + qBody(q) +
          '<div class="ans"><span>Your answer:</span><span class="yours math">' + mt(answerText(q, a)) + "</span>" +
          '<span>Correct:</span><span class="right math">' + mt(answerText(q, q.answer)) + "</span></div>" +
          '<div class="why math"><b>Why:</b> ' + mt(q.explanation) + "</div>" +
          (q.remediation ? '<div class="tip">Revise: ' + esc(q.remediation) + "</div>" : "") + "</div>";
      }).join("");
    } else h += "<p>Nothing missed. Full marks on this attempt.</p>";
    h += "</section>";

    h += progressSection(test, att);
    h += '<section class="card allow-break" id="profile-slot" data-subject="' + esc(sk) + '"></section>';
    h += '<section class="card print-only"><p class="small">' + esc(test.disclaimer || "") + '</p><p class="small">Video lessons: youtube.com/@TeramindsLearningAcademy · Free worksheets: ' + esc(LINKS.worksheets) + "</p></section>";
    h += "</article>";
    return h;
  }

  /* ---------- mock report ---------- */
  function mockReportHTML(test, att) {
    var r = scoreMock(test, att), b = mockBand(r), nk = nick(), sk = subjectOf(test);
    var h = '<article class="report" id="report">';
    h += '<section class="card hero"><div class="report-head"><img src="logo-192.png" alt="Teraminds Academy" id="rlogo"><div>' +
      '<div class="eyebrow">Mock paper report · ' + esc(test.subject) + "</div><h1>" + esc(test.title) + "</h1></div></div>" +
      '<p class="tagline">' + esc(test.tagline || "") + "</p>" +
      '<p class="meta">' + (nk ? "Prepared for <b>" + esc(nk) + "</b> · " : "") + esc(fmtDate(att.date, true)) + " · Time taken " + esc(fmtDur(att.durationSec || 0)) +
      " of " + esc(fmtDur((test.duration_minutes || 180) * 60)) + "</p></section>";
    if (r.pending) {
      h += '<section class="card pendingbox no-print"><b>' + r.pending + " written answer" + (r.pending > 1 ? "s" : "") + " not marked yet.</b> They count as 0 until you mark them." +
        '<div style="margin-top:.5rem"><a class="btn" href="#' + esc(test.id) + "/mark/" + esc(att.id) + '">Finish self-marking</a></div></section>';
    }
    h += '<section class="card"><div class="score-card"><div class="ring" style="--p:' + r.overall + '"><span>' + r.overall + "%<small>" + fm(r.e) + " / " + fm(r.m) + "</small></span></div>" +
      '<div><div class="band ' + b.k + '">' + esc(b.name) + "</div><p>" + esc(b.text) + "</p>" +
      '<p class="small" style="margin:0"><b>' + fm(r.objE) + "/" + fm(r.objM) + "</b> objective (auto-marked) · <b>" + fm(r.selfE) + "/" + fm(r.selfM) + "</b> written (self-marked)</p>" +
      '<p class="muted small" style="margin:.3rem 0 0">This describes one practice attempt with your own marking; it is not a prediction of board marks.</p></div></div></section>';

    // section-wise marks + time per section
    var totalT = 0; Object.keys(att.secTime || {}).forEach(function (k) { totalT += att.secTime[k]; });
    h += '<section class="card"><h2>Section-wise marks and time</h2><table class="bars">' + (test.sections || []).map(function (s) {
      var v = r.sections[s.id] || { e: 0, m: 0 }, t = (att.secTime || {})[s.id] || 0;
      var tline = totalT ? "Time " + fmtDur(t) + (s.minutes ? " (pace guide ~" + s.minutes + " min)" : "") : "";
      return barRow(s.name + (s.title ? " · " + s.title : ""), v.e, v.m, tline);
    }).join("") + "</table>" + (totalT ? '<p class="muted small" style="margin-top:.4rem">Time is counted while that section\'s question is on screen.</p>' : "") + "</section>";

    // chapters + strengths/weaknesses
    var chs = Object.keys(r.chapters).filter(function (k) { return r.chapters[k].m > 0; });
    var chSorted = chs.slice().sort(function (a, b2) { return pct(r.chapters[a].e, r.chapters[a].m) - pct(r.chapters[b2].e, r.chapters[b2].m); });
    var strong = chs.filter(function (k) { return pct(r.chapters[k].e, r.chapters[k].m) >= 75; });
    var weakCh = chSorted.filter(function (k) { return pct(r.chapters[k].e, r.chapters[k].m) < 60; });
    var focus = chs.filter(function (k) { return pct(r.chapters[k].e, r.chapters[k].m) < 75; }).sort(function (a, b2) {
      var la = r.chapters[a].m - r.chapters[a].e, lb = r.chapters[b2].m - r.chapters[b2].e;
      return lb - la || pct(r.chapters[a].e, r.chapters[a].m) - pct(r.chapters[b2].e, r.chapters[b2].m);
    }).slice(0, 3);
    var topicList = Object.keys(r.topics).map(function (k) { return r.topics[k]; }).filter(function (t) { return t.m > 0; });

    h += '<section class="card summary"><h2>Your top 3 focus areas</h2>';
    if (focus.length) {
      h += '<p class="muted small">Ranked by marks lost on this paper. Fix these first.</p><ol class="top3">' + focus.map(function (k) {
        var v = r.chapters[k], weakT = topicList.filter(function (t) { return t.ch === k && pct(t.e, t.m) < 75; }).map(function (t) { return t.name; });
        return "<li><b>" + esc(chapterName(test, k)) + '</b> <span class="chip bad">' + pct(v.e, v.m) + "% · lost " + fm(v.m - v.e) + " mark" + (v.m - v.e === 1 ? "" : "s") + "</span>" +
          (weakT.length ? '<div class="small">Weak topics: ' + esc(weakT.join("; ")) + "</div>" : "") + linksHTML(chapterInfo(sk, k, test)) + "</li>";
      }).join("") + "</ol>";
    } else h += "<p>Every chapter on this paper is at 75% or above. Next: retake under the full timer, or try the other mock paper.</p>";
    h += '<div class="sw"><div><h3>Strengths</h3>' + (strong.length ? '<ul class="good-list">' + strong.map(function (k) {
      return "<li>" + esc(chapterName(test, k)) + ' <span class="muted small">(' + pct(r.chapters[k].e, r.chapters[k].m) + "%)</span></li>";
    }).join("") + "</ul>" : "<p class=\"muted small\">No chapter at 75% or above yet.</p>") + "</div>" +
      '<div><h3>Weaknesses</h3>' + (weakCh.length ? '<ul class="bad-list">' + weakCh.map(function (k) {
        return "<li>" + esc(chapterName(test, k)) + ' <span class="muted small">(' + pct(r.chapters[k].e, r.chapters[k].m) + "%)</span></li>";
      }).join("") + "</ul>" : "<p class=\"muted small\">No chapter below 60%.</p>") + "</div></div></section>";

    h += '<section class="card allow-break"><h2>Chapter-wise accuracy</h2><p class="muted small">Marks earned out of marks asked from each chapter on this paper.</p><table class="bars">' +
      chSorted.slice().sort(function (a, b2) { return (test.chapter_order || []).indexOf(a) - (test.chapter_order || []).indexOf(b2); }).map(function (k) {
        return barRow(chapterName(test, k), r.chapters[k].e, r.chapters[k].m);
      }).join("") + "</table></section>";

    // topic-wise, weak topics with links
    var weakTopics = topicList.filter(function (t) { return pct(t.e, t.m) < 60; }).sort(function (a, b2) { return (b2.m - b2.e) - (a.m - a.e); });
    h += '<section class="card allow-break"><h2>Weak topics: what to watch and practise</h2>';
    if (weakTopics.length) {
      h += '<ul class="weaktopics">' + weakTopics.map(function (t) {
        return "<li><div><b>" + esc(t.name) + '</b> <span class="muted small">' + esc(chapterName(test, t.ch)) + ' · </span><span class="chip bad">' + fm(t.e) + "/" + fm(t.m) + "</span></div>" + linksHTML(chapterInfo(sk, t.ch, test)) + "</li>";
      }).join("") + "</ul>";
    } else h += "<p>No topic below 60% on this attempt.</p>";
    h += '<details class="topics"><summary>All topics (' + topicList.length + ")</summary><table class=\"bars\">" + topicList.sort(function (a, b2) { return pct(a.e, a.m) - pct(b2.e, b2.m); }).map(function (t) {
      return barRow(t.name, t.e, t.m, chapterName(test, t.ch));
    }).join("") + "</table></details></section>";

    // question review
    h += '<section class="card allow-break"><h2>Question-by-question review</h2><p class="muted small">Every question where you lost marks, with the key or model answer.</p>';
    var rev = "";
    r.rows.forEach(function (row) {
      row.evs.forEach(function (ev, i) {
        if (!ev.counted || ev.e >= ev.m) return;
        var it = ev.it, a = (att.answers || {})[it.id], lab = "Q" + row.Q.n + (row.Q.parts ? " (" + romanLow(i + 1) + ")" : "");
        rev += '<div class="miss"><div class="row" style="gap:.35rem"><b>' + lab + '</b><span class="chip">' + esc(chapterName(test, it.chapter)) + "</span>" +
          '<span class="chip bad">' + fm(ev.e) + "/" + fm(ev.m) + "</span></div>" + qBody(it);
        if (ev.objective) {
          rev += '<div class="ans"><span>Your answer:</span><span class="yours math">' + mt(answerText(it, a)) + "</span>" +
            '<span>Correct:</span><span class="right math">' + mt(answerText(it, it.answer)) + "</span></div>" +
            (it.explanation ? '<div class="why math"><b>Why:</b> ' + mt(it.explanation) + "</div>" : "");
        } else {
          rev += '<details class="model"><summary>Model answer and marking points</summary>' + para(it.model_answer) +
            '<ul class="small">' + (it.rubric || []).map(function (rp, j) {
              var got = ((att.self || {})[it.id] || [])[j] || 0;
              return "<li>" + (got >= rp.m ? "✓ " : "✗ ") + mt(rp.p) + " (" + fm(got) + "/" + fm(rp.m) + ")</li>";
            }).join("") + "</ul></details>";
        }
        rev += '<div class="tip">Topic: ' + esc(it.topic || "") + "</div></div>";
      });
    });
    h += (rev || "<p>Full marks on every question. Excellent.</p>") + "</section>";

    h += mockProgressSection(test, att);
    h += '<section class="card allow-break" id="profile-slot" data-subject="' + esc(sk) + '"></section>';
    h += '<section class="card print-only"><p class="small">' + esc(test.disclaimer || "") + '</p><p class="small">Video lessons: youtube.com/@TeramindsLearningAcademy · Free worksheets: ' + esc(LINKS.worksheets) + "</p></section>";
    return h + "</article>";
  }
  function mockProgressSection(test, att) {
    var atts = attemptsFor(test.id), idx = atts.map(function (a) { return a.id; }).indexOf(att.id);
    var upto = idx >= 0 ? atts.slice(0, idx + 1) : atts.concat([att]), shown = upto.slice(-6);
    var h = '<section class="card allow-break"><h2>Your progress on this paper</h2>';
    if (upto.length < 2) h += "<p>This is your first saved attempt of this paper on this device. Retake it after fixing your focus areas: your next report will chart what moved.</p>";
    else {
      h += lineChart(shown, att.id, upto.length - shown.length);
      var rows = [{ label: "Overall", bold: 1, get: function (a) { return a.overall; } }];
      (test.sections || []).forEach(function (s) { rows.push({ label: s.name, get: function (a) { return a.sections && a.sections[s.id] != null ? a.sections[s.id] : null; } }); });
      (test.chapter_order || Object.keys(test.chapters || {})).forEach(function (k) {
        if (!shown.some(function (a) { return a.subs && a.subs[k] != null; })) return;
        rows.push({ label: chapterName(test, k), get: function (a) { return a.subs && a.subs[k] != null ? a.subs[k] : null; } });
      });
      h += progressTable(shown, upto, rows) + '<p class="muted small" style="margin-top:.5rem">Green = up on the previous attempt, red = down.' + (upto.length > 6 ? " Showing your latest 6 of " + upto.length + " attempts." : "") + "</p>";
    }
    return h + '<p class="repeat">' + esc(REPEAT_TEXT) + "</p></section>";
  }

  /* ---------- combined subject profile (all tests taken on this device) ---------- */
  function subjectProfile(sk) {
    var ix = cache.index, tests = ix.tests.filter(function (t) { return t.subject_key === sk; });
    var taken = tests.filter(function (t) { return attemptsFor(t.id).length; });
    return Promise.all(taken.map(function (t) { return loadTest(t.id).catch(function () { return null; }); })).then(function (loaded) {
      var pooled = {}, rows = [];
      loaded.forEach(function (test, i) {
        if (!test) return;
        var atts = attemptsFor(test.id), last = atts[atts.length - 1], best = 0;
        atts.forEach(function (a) { best = Math.max(best, a.overall || 0); });
        rows.push({ t: taken[i], n: atts.length, last: last, best: best });
        var ch = isMock(test) ? scoreMock(test, last).chapters : readinessChapters(test, last);
        Object.keys(ch).forEach(function (k) {
          if (!ch[k].m) return; pooled[k] = pooled[k] || { e: 0, m: 0, n: 0 }; pooled[k].e += ch[k].e; pooled[k].m += ch[k].m; pooled[k].n++;
        });
      });
      return { sk: sk, name: (ix.subjects[sk] || {}).name || sk, rows: rows, pooled: pooled };
    });
  }
  function profileHTML(pf, compact) {
    if (!pf.rows.length) return "";
    var subj = cache.index.subjects[pf.sk] || { chapters: {} };
    var h = "<h2>" + esc(pf.name) + ": combined profile on this device</h2>" +
      '<p class="muted small">Pools your latest attempt of every ' + esc(pf.name) + " test and mock paper taken on this device.</p>" +
      '<div class="table-wrap"><table class="hist"><tr><th>Test</th><th>Attempts</th><th>Latest</th><th>Best</th></tr>' + pf.rows.map(function (r) {
        return '<tr><td><a href="#' + esc(r.t.id) + '">' + esc(r.t.kind === "mock" ? r.t.title : r.t.short_title) + "</a></td><td>" + r.n + "</td><td>" + (r.last.overall || 0) + "%</td><td>" + r.best + "%</td></tr>";
      }).join("") + "</table></div>";
    var keys = Object.keys(pf.pooled);
    var order = Object.keys(subj.chapters || {});
    keys.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    if (keys.length) {
      h += '<h3 style="margin-top:1rem">Chapter accuracy across tests</h3><table class="bars">' + keys.map(function (k) {
        var v = pf.pooled[k], c = subj.chapters[k];
        return barRow(c ? c.name : k, v.e, v.m, v.n > 1 ? "from " + v.n + " tests" : "");
      }).join("") + "</table>";
      var weakest = keys.filter(function (k) { return pct(pf.pooled[k].e, pf.pooled[k].m) < 75; })
        .sort(function (a, b) { return pct(pf.pooled[a].e, pf.pooled[a].m) - pct(pf.pooled[b].e, pf.pooled[b].m); }).slice(0, 3);
      if (weakest.length) h += '<h3 style="margin-top:1rem">Weakest chapters overall</h3><ol class="top3">' + weakest.map(function (k) {
        var c = subj.chapters[k]; return "<li><b>" + esc(c ? c.name : k) + '</b> <span class="chip bad">' + pct(pf.pooled[k].e, pf.pooled[k].m) + "%</span>" + linksHTML(c) + "</li>";
      }).join("") + "</ol>";
    }
    if (compact) h += '<p class="no-print" style="margin-top:.6rem"><a href="#profile">See your profile for every subject →</a></p>';
    return h;
  }
  function fillProfileSlot() {
    var slot = $("#profile-slot"); if (!slot) return;
    var sk = slot.dataset.subject; if (!sk) { slot.remove(); return; }
    subjectProfile(sk).then(function (pf) { if (pf.rows.length) slot.innerHTML = profileHTML(pf, true); else slot.remove(); }).catch(function () { slot.remove(); });
  }
  function renderProfile() {
    stopTimer(); topbarTimer(); setTitle("My subject profile"); document.body.classList.remove("print-view");
    loadIndex().then(function (ix) {
      var keys = SUBJ_ORDER.filter(function (k) { return ix.subjects[k]; });
      return Promise.all(keys.map(subjectProfile));
    }).then(function (pfs) {
      var any = pfs.filter(function (p) { return p.rows.length; });
      app.innerHTML = '<article class="report" id="report"><section class="card hero"><div class="eyebrow">Teraminds Academy</div><h1>My subject profile</h1>' +
        '<p class="tagline">Everything you have taken on this device, combined per subject. Nothing leaves this device.</p>' +
        (nick() ? '<p class="meta">Prepared for <b>' + esc(nick()) + "</b> · " + esc(fmtDate(new Date().toISOString())) + "</p>" : "") + "</section>" +
        (any.length ? any.map(function (pf) { return '<section class="card allow-break">' + profileHTML(pf, false) + "</section>"; }).join("")
          : '<section class="card"><p>No attempts on this device yet. Take a test or mock paper and your profile builds here.</p><a class="btn" href="#">See all tests</a></section>') +
        "</article>" + '<section class="card no-print"><div class="row"><button class="btn" id="ppdf">Download profile (PDF)</button><a class="btn secondary" href="#">All tests</a></div></section>' + historyTools();
      $("#ppdf").addEventListener("click", function () { document.body.classList.add("print-view"); $all("details").forEach(function (d) { d.open = true; }); window.print(); });
      wireHistoryTools(renderProfile);
    });
  }

  function renderReport(test, att, printMode) {
    stopTimer(); topbarTimer(); setTitle("Report · " + (test.short_title || ""));
    document.body.classList.toggle("print-view", !!printMode);
    var base = "#" + test.id + "/report/" + att.id, mock = isMock(test);
    var body = mock ? mockReportHTML(test, att) : reportHTML(test, att);
    var actions = '<section class="card no-print"><h2>Save or share this report</h2><div class="stack">' +
      '<button class="btn full" id="pdf">Download report (PDF)</button>' +
      '<button class="btn secondary full" id="htmldl">Download report (.html)</button>' +
      '<p class="muted small">PDF: your phone opens its print screen. Choose “Save as PDF”. If that doesn\'t work on your phone, use the .html download, which opens in any browser.</p>' +
      (mock && selfItems(test, att).length ? '<a class="btn ghost full" href="#' + esc(test.id) + "/mark/" + esc(att.id) + '">Change my self-marks</a>' : "") +
      '<div class="qnav"><a class="btn secondary" href="#' + esc(test.id) + '">Test home</a><button class="btn" id="retake">Retake ' + (mock ? "paper" : "test") + "</button></div></div></section>";
    if (printMode) {
      app.innerHTML = '<div class="no-print card"><div class="row"><a class="btn secondary" href="' + base + '">← Back to report</a><button class="btn" id="printnow">Print / Save as PDF</button></div>' +
        '<p class="muted small" style="margin:.5rem 0 0">In the print screen choose “Save as PDF” as the printer.</p></div>' + body;
      $all("#report details").forEach(function (d) { d.open = true; });
      fillProfileSlot();
      $("#printnow").addEventListener("click", function () { window.print(); });
      setTimeout(function () { try { window.print(); } catch (e) {} }, 650);
      return;
    }
    app.innerHTML = body + actions + historyTools();
    fillProfileSlot();
    $("#pdf").addEventListener("click", function () { go(base + "/print"); });
    $("#htmldl").addEventListener("click", function () { downloadReportHTML(test, att); });
    $("#retake").addEventListener("click", function () {
      lsSet(LS.prog + test.id, mock ? newMockProg(test) : { testId: test.id, answers: {}, cur: 0, elapsed: 0, started: new Date().toISOString() });
      go("#" + test.id + "/test");
    });
    wireHistoryTools(function () {
      if (findAttempt(att.id)) renderReport(test, att, false); else go("#" + test.id);
    });
    scrollTo(0, 0);
  }

  function collectCSS() {
    var out = "";
    try {
      $all('link[rel="stylesheet"]').forEach(function (l) {
        Array.prototype.forEach.call(l.sheet.cssRules, function (r) { if (!/^@font-face/.test(r.cssText)) out += r.cssText + "\n"; });
      });
    } catch (e) { out = ""; }
    if (!out) out = "body{font-family:system-ui,sans-serif;color:#14213d;background:#fff;max-width:760px;margin:0 auto;padding:12px}.card{border:1px solid #ddd;border-radius:12px;padding:12px;margin:0 0 12px}.no-print{display:none}.chip{font-size:12px;padding:2px 8px;border-radius:99px;background:#e3f2f1}.right{color:#1e8a4c;font-weight:600}.yours{color:#c0392b}.bar{height:8px;background:#eee;border-radius:9px}.bar i{display:block;height:8px;background:#0f7c78;border-radius:9px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #eee;padding:4px}";
    return out;
  }
  function logoDataURL() {
    try {
      var img = $("#rlogo"); if (!img || !img.complete) return null;
      var c = document.createElement("canvas"); c.width = 88; c.height = 88;
      c.getContext("2d").drawImage(img, 0, 0, 88, 88); return c.toDataURL("image/png");
    } catch (e) { return null; }
  }
  function downloadReportHTML(test, att) {
    var node = $("#report").cloneNode(true);
    var logo = logoDataURL(), li = node.querySelector("#rlogo");
    if (li) { if (logo) li.setAttribute("src", logo); else li.remove(); }
    $all(".no-print", node).forEach(function (n) { n.remove(); });
    $all(".print-only", node).forEach(function (n) { n.classList.remove("print-only"); });
    $all("details", node).forEach(function (d) { d.setAttribute("open", ""); });
    $all('a[href^="#"]', node).forEach(function (a) { a.removeAttribute("href"); });
    var html = '<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Report · " + esc(test.short_title || test.id) + " · " + esc(fmtDate(att.date)) + "</title><style>" + collectCSS() +
      "</style></head><body><main>" + node.outerHTML + '<footer class="site-footer"><p>Independent revision aid, not an official CBSE resource. Produced with AI assistance.</p>' +
      '<p><a href="' + LINKS.youtube + '">YouTube @TeramindsLearningAcademy</a> · <a href="' + LINKS.worksheets + '">Free worksheets</a></p></footer></main></body></html>';
    download("teraminds-report-" + test.id + "-" + att.date.slice(0, 10) + ".html", html, "text/html");
  }

  /* ---------- router ---------- */
  function notFound(msg) {
    stopTimer(); topbarTimer();
    app.innerHTML = '<div class="card"><h2>' + esc(msg || "Test not found") + '</h2><p>The link may be old or mistyped.</p><a class="btn" href="#">See all tests</a></div>';
  }
  function route() {
    var parts = decodeURIComponent((location.hash || "").replace(/^#\/?/, "")).split("/").filter(Boolean);
    if (!parts.length) return renderHome();
    var id = parts[0].toLowerCase();
    if (id === "profile") return renderProfile();
    if (id === "mocks" || id === "readiness-list") return renderHome();
    app.innerHTML = '<p class="loading">Loading…</p>';
    loadIndex().catch(function () { return null; }).then(function () { return loadTest(id); }).then(function (test) {
      if (parts[1] === "test") return renderTest(test);
      if (parts[1] === "report" || parts[1] === "mark") {
        var att = findAttempt(parts[2] || "");
        if (!att || att.testId !== test.id) return notFound("Report not found on this device");
        if (parts[1] === "mark") return isMock(test) ? renderMarking(test, att) : renderReport(test, att, false);
        return renderReport(test, att, parts[3] === "print");
      }
      renderIntro(test);
    }).catch(function () { notFound(); });
    try { app.focus({ preventScroll: true }); } catch (e) {}
  }
  window.addEventListener("hashchange", route);

  /* offline cache (only on https or localhost; service workers don't run on file://) */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
  // test hook (headless checks); exposes nothing personal
  window.TM = { score: score, band: band, isCorrect: isCorrect, scoreMock: scoreMock };
  route();
})();
