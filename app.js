/* Teraminds Academy readiness tests: static, offline-capable, no personal data leaves the device.
   Routes:  #            catalogue (index.json)
            #<id>        test intro
            #<id>/test   take the test
            #<id>/report/<attemptId>          report
            #<id>/report/<attemptId>/print    print-optimised report (calls window.print)          */
(function () {
  "use strict";

  var LS = { nick: "tm.nick", hist: "tm.history.v1", prog: "tm.progress." };
  var LINKS = {
    youtube: "https://www.youtube.com/@TeramindsLearningAcademy",
    worksheets: "https://drive.google.com/drive/folders/1fHevoVaogsYQGLGq00K5iakx-DyG2SFS"
  };
  var REPEAT_TEXT = "Repeat this test any time: your report tracks your progress across attempts on this device.";
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
  function mt(s) { return esc(s).replace(/ ([×÷=+−<>≤≥≠→]|&lt;|&gt;) /g, "\u00a0$1\u00a0"); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function lsGet(k, dflt) { try { var v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function pct(c, t) { return t ? Math.round((c / t) * 100) : 0; }
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
  function setTitle(t) { document.title = t ? t + " · Teraminds Academy" : "Readiness test · Teraminds Academy"; }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function nick() { return (lsGet(LS.nick, "") || "").slice(0, 24); }
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
    }).then(function (ix) { cache.index = ix; return ix; });
  }
  function loadTest(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) return Promise.reject(new Error("bad id"));
    if (cache.tests[id]) return Promise.resolve(cache.tests[id]);
    return getJSON("" + id + ".json").catch(function () {
      return loadBundle().then(function (b) { if (!b || !b.tests[id]) throw new Error("not found"); return b.tests[id]; });
    }).then(function (t) { cache.tests[id] = t; return t; });
  }

  /* ---------- history ---------- */
  function history() { var h = lsGet(LS.hist, null); return h && Array.isArray(h.attempts) ? h : { schema: 1, attempts: [] }; }
  function saveHistory(h) { return lsSet(LS.hist, h); }
  function attemptsFor(testId) {
    return history().attempts.filter(function (a) { return a.testId === testId; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function findAttempt(id) { return history().attempts.filter(function (a) { return a.id === id; })[0]; }

  function exportHistory() {
    var h = history();
    var data = { app: "teraminds-readiness-tests", schema: 1, exported: new Date().toISOString(), nickname: nick() || undefined, attempts: h.attempts };
    download("teraminds-test-history-" + today() + ".json", JSON.stringify(data, null, 1), "application/json");
  }
  function importHistory(file, done) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (!d || d.app !== "teraminds-readiness-tests" || !Array.isArray(d.attempts)) throw new Error("format");
        var h = history(), have = {}, added = 0;
        h.attempts.forEach(function (a) { have[a.id] = 1; });
        d.attempts.forEach(function (a) {
          if (a && typeof a.id === "string" && typeof a.testId === "string" && a.answers && typeof a.answers === "object" && !have[a.id]) {
            h.attempts.push({
              id: a.id.slice(0, 40), testId: a.testId.slice(0, 80), testVersion: a.testVersion || 1, date: String(a.date),
              durationSec: +a.durationSec || 0, answers: a.answers, score: +a.score || 0, total: +a.total || 0,
              overall: +a.overall || 0, subs: a.subs || {}, levels: a.levels || {}
            });
            have[a.id] = 1; added++;
          }
        });
        if (d.nickname && !nick()) lsSet(LS.nick, String(d.nickname).slice(0, 24));
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

  /* ---------- scoring ---------- */
  function normNum(v) {
    if (v == null) return null;
    var s = String(v).trim().replace(/[\u2212\u2012\u2013\u2014]/g, "-").replace(/[\s,]/g, "");
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
  function band(s) {
    var hard = { c: 0, t: 0 };
    ["L3", "L4"].forEach(function (k) { if (s.levels[k]) { hard.c += s.levels[k].c; hard.t += s.levels[k].t; } });
    var hp = hard.t ? pct(hard.c, hard.t) : 100;
    if (s.overall >= 80 && hp >= 60) return { k: "b3", name: "Board-ready", text: "You're handling most of the repeated board-pattern question types, including the multi-step ones. Keep it sharp with timed practice and the worksheet's hard questions." };
    if (s.overall >= 50) return { k: "b2", name: "Getting there", text: s.overall >= 80
      ? "Strong overall, but the multi-step board-pattern and HOTS questions need more work before you can call this chapter done. Start with “Focus next”."
      : "You have a working base. Fix the subtopics under “Focus next”, then repeat the test to see the gap close." };
    return { k: "b1", name: "Building", text: "The basics need another pass. Re-watch the video parts named under “Focus next”, do the NCERT exercises listed, then try again." };
  }

  /* ---------- rendering pieces ---------- */
  function topbarTimer(html) { topRight.innerHTML = html || ""; }
  function footerLinks(test) {
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
    } else h += '<p class="qtext math">' + mt(q.question) + "</p>";
    return h;
  }
  function answerText(q, a) {
    if (!isAnswered(q, a)) return "Not answered";
    if (q.type === "numeric") return String(a).trim().replace(/^-/, "−");
    var i = String(a).toUpperCase().charCodeAt(0) - 65;
    return "(" + String(a).toUpperCase() + ") " + ((q.options || [])[i] || "");
  }
  function barRow(label, c, t, sub) {
    var p = pct(c, t);
    return "<tr><td>" + esc(label) + (sub ? '<div class="muted small">' + esc(sub) + "</div>" : "") +
      '<div class="bar"><i class="' + cls(p) + '" style="width:' + p + '%"></i></div></td><td class="n"><b>' + p + "%</b><div class=\"muted small\">" + c + "/" + t + "</div></td></tr>";
  }

  /* ---------- screens ---------- */
  function renderHome() {
    stopTimer(); topbarTimer(); setTitle(); document.body.classList.remove("print-view");
    loadIndex().then(function (ix) {
      var list = ix.tests.map(function (t) {
        var n = attemptsFor(t.id).length;
        return '<li class="card"><div class="eyebrow">' + esc(t.subject || "Readiness test") + (t["class"] ? " · Class " + esc(t["class"]) : "") + "</div>" +
          "<h2>" + esc(t.short_title || t.chapter) + "</h2><p class=\"muted small\">" + t.questions + " questions" +
          (t.suggested_minutes ? " · about " + t.suggested_minutes + " min" : "") + (n ? " · " + n + " attempt" + (n > 1 ? "s" : "") + " on this device" : "") + "</p>" +
          '<a class="btn" href="#' + esc(t.id) + '">Open test</a></li>';
      }).join("");
      app.innerHTML = '<section class="card hero"><div class="eyebrow">Teraminds Academy</div><h1>Board-pattern readiness tests</h1>' +
        '<p class="tagline">Practice questions modelled on past CBSE papers; not predictions of this year\'s paper.</p></section>' +
        '<ul style="list-style:none;padding:0;margin:0">' + list + "</ul>";
    }).catch(function () { app.innerHTML = '<div class="card"><h2>Couldn\'t load the tests</h2><p>Check your connection and reload the page.</p></div>'; });
  }

  function renderIntro(test) {
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
      "Your report shows your score by level and subtopic, what you've got, where you missed, and what to focus on next.</p>" +
      '<label class="field" for="nick">Nickname <span class="muted small">(optional)</span></label>' +
      '<input class="text" id="nick" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. MathsTiger" value="' + esc(nick()) + '">' +
      '<p class="warn">Don\'t use your real full name. It is saved only on this device and shown on your report.</p>' +
      '<div class="stack" style="margin-top:1rem">' +
      (prog && answered ? '<button class="btn full" id="resume">Resume attempt (' + answered + "/" + test.questions.length + ' answered)</button><button class="btn secondary full" id="start">Start a fresh attempt</button>'
        : '<button class="btn full" id="start">Start the test</button>') + "</div>" +
      '<p class="muted small" style="margin-top:.8rem">Private by design: no sign-up, no tracking. Answers are checked on this phone and never sent anywhere.</p></section>';
    if (atts.length) {
      h += '<section class="card"><h2>Your attempts on this device</h2><ul class="attempts">' + atts.slice().reverse().map(function (a) {
        return "<li><span>" + esc(fmtDate(a.date, true)) + '</span><span><b>' + a.overall + '%</b> · <a href="#' + esc(test.id) + "/report/" + esc(a.id) + '">Report</a></span></li>';
      }).join("") + "</ul></section>";
    }
    h += historyTools() + '<section class="card">' + footerLinks(test) + "</section>";
    app.innerHTML = h;
    $("#nick").addEventListener("input", function (e) {
      var v = e.target.value.replace(/[<>]/g, "").slice(0, 24); if (v.trim()) lsSet(LS.nick, v.trim()); else lsDel(LS.nick);
    });
    $("#start").addEventListener("click", function () {
      if (prog && answered && !confirm("Start again? Your unfinished answers will be cleared.")) return;
      lsSet(LS.prog + test.id, { testId: test.id, answers: {}, cur: 0, elapsed: 0, started: new Date().toISOString() });
      go("#" + test.id + "/test");
    });
    if ($("#resume")) $("#resume").addEventListener("click", function () { go("#" + test.id + "/test"); });
    wireHistoryTools(function () { renderIntro(test); });
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

  function renderTest(test) {
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
      var back = document.createElement("div"); back.className = "modal-back";
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">Submit your test?</h2><p>' +
        (left ? "You have <b>" + left + "</b> unanswered question" + (left > 1 ? "s" : "") + ". They will count as not correct." : "All " + N + " questions answered.") +
        '</p><div class="row end"><button class="btn ghost" id="mcancel">Keep working</button><button class="btn" id="mok">Submit</button></div></div>';
      document.body.appendChild(back);
      $("#mcancel").addEventListener("click", function () { back.remove(); });
      $("#mok").addEventListener("click", function () { back.remove(); finish(); });
      $("#mok").focus();
    }
    function finish() {
      stopTimer();
      var s = score(test, p.answers);
      var subs = {}; Object.keys(s.subs).forEach(function (k) { subs[k] = pct(s.subs[k].c, s.subs[k].t); });
      var levels = {}; Object.keys(s.levels).forEach(function (k) { levels[k] = pct(s.levels[k].c, s.levels[k].t); });
      var att = {
        id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), testId: test.id, testVersion: test.version || 1,
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

  /* ---------- report ---------- */
  function progressSection(test, att) {
    var atts = attemptsFor(test.id);
    var idx = atts.map(function (a) { return a.id; }).indexOf(att.id);
    var upto = idx >= 0 ? atts.slice(0, idx + 1) : atts.concat([att]);
    var shown = upto.slice(-6);
    var h = '<section class="card allow-break"><h2>Your progress on this test</h2>';
    if (upto.length < 2) {
      h += "<p>This is your first saved attempt of this test on this device. Your next attempt will show here as a chart, so you can see what moved.</p>";
    } else {
      // SVG line chart of overall %
      var W = 360, H = 210, L = 34, R = 22, T = 24, B = 30, n = shown.length;
      var xs = function (i) { return L + 18 + (i * (W - L - R - 18)) / Math.max(1, n - 1); };
      var ys = function (v) { return T + (1 - v / 100) * (H - T - B); };
      var g = "";
      [0, 25, 50, 75, 100].forEach(function (v) {
        g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ys(v) + '" y2="' + ys(v) + '" stroke="#e3e1d8" stroke-width="1"/>' +
          '<text x="' + (L - 6) + '" y="' + (ys(v) + 4) + '" font-size="11" text-anchor="end" fill="#4a5572">' + v + "</text>";
      });
      var pts = shown.map(function (a, i) { return xs(i) + "," + ys(a.overall); }).join(" ");
      g += '<polyline points="' + pts + '" fill="none" stroke="#0f7c78" stroke-width="3" stroke-linejoin="round"/>';
      shown.forEach(function (a, i) {
        var cur = a.id === att.id;
        g += '<circle cx="' + xs(i) + '" cy="' + ys(a.overall) + '" r="' + (cur ? 6 : 4.5) + '" fill="' + (cur ? "#14213d" : "#0f7c78") + '"/>' +
          '<text x="' + xs(i) + '" y="' + (ys(a.overall) - 10) + '" font-size="13" font-weight="700" text-anchor="middle" fill="#14213d">' + a.overall + "%</text>" +
          '<text x="' + xs(i) + '" y="' + (H - 12) + '" font-size="11" text-anchor="middle" fill="#4a5572">#' + (upto.length - n + i + 1) + "</text>";
      });
      h += '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Overall score across attempts">' + g + "</svg>";
      // table: overall + per subtopic
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
      var body = "<tr><td><b>Overall</b></td>" + rowCells(function (a) { return a.overall; }) + "</tr>";
      Object.keys(test.subtopics).forEach(function (k) {
        body += "<tr><td>" + esc(test.subtopics[k].name) + "</td>" + rowCells(function (a) { return a.subs && a.subs[k] != null ? a.subs[k] : null; }) + "</tr>";
      });
      h += '<div class="table-wrap"><table class="hist">' + head + body + "</table></div>" +
        '<p class="muted small" style="margin-top:.5rem">Green = up on the previous attempt, red = down.' + (upto.length > 6 ? " Showing your latest 6 of " + upto.length + " attempts." : "") + "</p>";
    }
    h += '<p class="repeat">' + esc(REPEAT_TEXT) + "</p></section>";
    return h;
  }

  function reportHTML(test, att) {
    var s = score(test, att.answers || {}), b = band(s), nk = nick();
    var h = '<article class="report" id="report">';
    h += '<section class="card hero"><div class="report-head"><img src="logo-192.png" alt="Teraminds Academy" id="rlogo"><div>' +
      '<div class="eyebrow">Readiness report · ' + esc(test.short_title || test.chapter) + "</div><h1>" + esc(test.title) + "</h1></div></div>" +
      '<p class="tagline">' + esc(test.tagline || "") + "</p>" +
      '<p class="meta">' + (nk ? "Prepared for <b>" + esc(nk) + "</b> · " : "") + esc(fmtDate(att.date, true)) + " · Time taken " + esc(fmtDur(att.durationSec || 0)) + "</p></section>";

    h += '<section class="card"><div class="score-card"><div class="ring" style="--p:' + s.overall + '"><span>' + s.overall + "%<small>" + s.correct + " / " + s.total + "</small></span></div>" +
      '<div><div class="band ' + b.k + '">' + esc(b.name) + "</div><p>" + esc(b.text) + "</p>" +
      '<p class="muted small" style="margin:0">Readiness bands: Building (below 50%) · Getting there (50–79%) · Board-ready (80%+ and at least 60% on board-pattern and HOTS questions). They describe this practice attempt only, not a prediction of board marks.</p></div></div></section>';

    h += '<section class="card"><h2>By difficulty level</h2><table class="bars">' + Object.keys(test.levels).map(function (k) {
      var v = s.levels[k] || { c: 0, t: 0 }; if (!v.t) return "";
      var nm = test.levels[k].name; return barRow(k + " · " + test.levels[k].label, v.c, v.t, nm && nm.toLowerCase() !== test.levels[k].label.toLowerCase() ? nm : "");
    }).join("") + "</table></section>";

    h += '<section class="card allow-break"><h2>By subtopic</h2><table class="bars">' + Object.keys(test.subtopics).map(function (k) {
      var v = s.subs[k] || { c: 0, t: 0 }; if (!v.t) return ""; return barRow(test.subtopics[k].name, v.c, v.t);
    }).join("") + "</table></section>";

    var strong = Object.keys(test.subtopics).filter(function (k) { var v = s.subs[k]; return v && v.t && pct(v.c, v.t) >= 75; });
    h += "<section class=\"card\"><h2>What you've got</h2>" + (strong.length ? '<ul class="good-list">' + strong.map(function (k) {
      var v = s.subs[k]; return "<li>" + esc(test.subtopics[k].name) + ' <span class="muted small">(' + v.c + "/" + v.t + ")</span></li>";
    }).join("") + "</ul>" : "<p>No subtopic at 75% or above yet. That's what this test is for: the plan below shows where to start.</p>") + "</section>";

    var weak = Object.keys(test.subtopics).filter(function (k) { var v = s.subs[k]; return v && v.t && pct(v.c, v.t) < 75; })
      .sort(function (a, b2) {
        var pa = pct(s.subs[a].c, s.subs[a].t), pb = pct(s.subs[b2].c, s.subs[b2].t);
        return pa - pb || (s.subs[b2].t - s.subs[b2].c) - (s.subs[a].t - s.subs[a].c);
      });
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
    } else h += "<p>Every subtopic is at 75% or above. Next step: the hard questions in the worksheet, then a timed full paper.</p>";
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
    h += '<section class="card print-only"><p class="small">' + esc(test.disclaimer || "") + '</p><p class="small">Video lessons: youtube.com/@TeramindsLearningAcademy · Free worksheets: ' + esc(LINKS.worksheets) + "</p></section>";
    h += "</article>";
    return h;
  }

  function renderReport(test, att, printMode) {
    stopTimer(); topbarTimer(); setTitle("Report · " + (test.short_title || ""));
    document.body.classList.toggle("print-view", !!printMode);
    var base = "#" + test.id + "/report/" + att.id;
    var actions = '<section class="card no-print"><h2>Save or share this report</h2><div class="stack">' +
      '<button class="btn full" id="pdf">Download report (PDF)</button>' +
      '<button class="btn secondary full" id="htmldl">Download report (.html)</button>' +
      '<p class="muted small">PDF: your phone opens its print screen. Choose “Save as PDF”. If that doesn\'t work on your phone, use the .html download, which opens in any browser.</p>' +
      '<div class="qnav"><a class="btn secondary" href="#' + esc(test.id) + '">Test home</a><button class="btn" id="retake">Retake test</button></div></div></section>';
    if (printMode) {
      app.innerHTML = '<div class="no-print card"><div class="row"><a class="btn secondary" href="' + base + '">← Back to report</a><button class="btn" id="printnow">Print / Save as PDF</button></div>' +
        '<p class="muted small" style="margin:.5rem 0 0">In the print screen choose “Save as PDF” as the printer.</p></div>' + reportHTML(test, att);
      $("#printnow").addEventListener("click", function () { window.print(); });
      setTimeout(function () { try { window.print(); } catch (e) {} }, 450);
      return;
    }
    app.innerHTML = reportHTML(test, att) + actions + historyTools();
    $("#pdf").addEventListener("click", function () { go(base + "/print"); });
    $("#htmldl").addEventListener("click", function () { downloadReportHTML(test, att); });
    $("#retake").addEventListener("click", function () {
      lsSet(LS.prog + test.id, { testId: test.id, answers: {}, cur: 0, elapsed: 0, started: new Date().toISOString() });
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
    var html = '<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Readiness report · " + esc(test.short_title || test.id) + " · " + esc(fmtDate(att.date)) + "</title><style>" + collectCSS() +
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
    app.innerHTML = '<p class="loading">Loading…</p>';
    loadTest(id).then(function (test) {
      if (parts[1] === "test") return renderTest(test);
      if (parts[1] === "report") {
        var att = findAttempt(parts[2] || "");
        if (!att || att.testId !== test.id) return notFound("Report not found on this device");
        return renderReport(test, att, parts[3] === "print");
      }
      renderIntro(test);
    }).catch(function () { notFound(); });
    try { app.focus({ preventScroll: true }); } catch (e) {}
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("afterprint", function () { /* stay on the print view; user taps Back */ });

  /* offline cache (only on https or localhost; service workers don't run on file://) */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
  // test hook (headless checks); exposes nothing personal
  window.TM = { score: score, band: band, isCorrect: isCorrect };
  route();
})();
