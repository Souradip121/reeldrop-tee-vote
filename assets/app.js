/* reeldrop tee vote, one page: choose your name, rate each design (like / dislike) one at a time,
   review, submit once (locked), then see your vote and the results. No scores are shown before submitting.
   Talks to Supabase only through tee_vote2_status / tee_vote2_submit / tee_vote2_results (supabase/ballot.sql). */
(function () {
  "use strict";
  const CFG = window.VOTE_CONFIG || {};
  const ALL = window.DESIGNS || [];
  const STORE_KEY = "tee_ballot2";
  const configured = !!(CFG.supabaseUrl && CFG.supabaseKey && !/YOUR_/.test(CFG.supabaseUrl + CFG.supabaseKey));

  let designs = ALL.slice();
  const byId = () => Object.fromEntries(designs.map((d) => [d.id, d]));
  const st = { status: null, voter: null, idx: 0, votes: {}, tee: {}, fromReview: false, busy: false, results: null, timer: null };

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const imgOf = (d, tee) => d.imgs[tee || d.tees[0]];
  const nameOf = (id) => ((st.status && st.status.voters) || []).find((v) => v.id === id)?.name || id;
  const fmtNet = (n) => (n > 0 ? `+${n}` : String(n));
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- local draft (per voter) ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null") || { drafts: {}, done: null }; }
    catch (e) { return { drafts: {}, done: null }; }
  }
  function save(fn) {
    const s = load();
    fn(s);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked: the vote still works this session */ }
  }
  const saveDraft = () => save((s) => { s.drafts[st.voter] = { idx: st.idx, votes: st.votes }; s.last = st.voter; });

  /* ---------- Supabase ---------- */
  async function rpc(fn, args) {
    const r = await fetch(`${CFG.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!r.ok) throw new Error((body && body.message) || `Request failed (${r.status})`);
    return body;
  }

  /* ---------- screens ---------- */
  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
    window.scrollTo({ top: 0 });
  }
  const rated = () => designs.filter((d) => st.votes[d.id]).length;

  /* 1. start */
  function renderStart() {
    const sel = $("#who");
    const voters = (st.status && st.status.voters) || [];
    const s = load();
    sel.replaceChildren(el("option", { value: "" }, "Choose your name"),
      ...voters.map((v) => el("option", { value: v.id, disabled: v.submitted }, v.submitted ? `${v.name} · already voted` : v.name)));
    const keep = s.last && voters.some((v) => v.id === s.last && !v.submitted) ? s.last : "";
    sel.value = keep;
    $("#n-designs").textContent = String(designs.length);
    updateStartBtn();
  }
  function updateStartBtn() {
    const id = $("#who").value;
    const d = id && load().drafts[id];
    const n = d ? Object.keys(d.votes || {}).filter((k) => designs.some((x) => x.id === k)).length : 0;
    const b = $("#start");
    b.disabled = !id || st.busy;
    b.textContent = n ? `Continue (${n} of ${designs.length} rated)` : "Start voting";
  }
  function start() {
    const id = $("#who").value;
    if (!id) return;
    st.voter = id;
    const d = load().drafts[id] || {};
    st.votes = d.votes || {};
    const firstOpen = designs.findIndex((x) => !st.votes[x.id]);
    st.idx = firstOpen === -1 ? designs.length - 1 : firstOpen;
    st.fromReview = false;
    saveDraft();
    if (firstOpen === -1) renderReview(); else renderVote(true);
  }

  /* 2. vote */
  function renderVote(animate) {
    const d = designs[st.idx];
    const tee = st.tee[d.id] || d.tees[0];
    show("s-vote");
    $("#count").textContent = `${st.idx + 1} / ${designs.length}`;
    $("#bar").style.width = `${(rated() / designs.length) * 100}%`;
    $("#to-review").hidden = rated() < designs.length;
    $("#tee-seg").hidden = d.tees.length < 2;
    $("#tee-seg").replaceChildren(...d.tees.map((t) => el("button", {
      type: "button", "aria-pressed": String(t === tee),
      onclick: () => { st.tee[d.id] = t; renderVote(false); },
    }, `${t[0].toUpperCase()}${t.slice(1)} tee`)));
    const img = $("#shot-img");
    img.src = imgOf(d, tee);
    img.alt = `${d.title} on a ${tee} tee`;
    $("#c-num").textContent = d.num;
    $("#c-style").textContent = d.style;
    $("#c-title").textContent = d.title;
    $("#c-feat").textContent = d.features;
    const v = st.votes[d.id] || 0;
    $("#btn-up").setAttribute("aria-pressed", String(v === 1));
    $("#btn-down").setAttribute("aria-pressed", String(v === -1));
    const card = $("#card");
    card.classList.remove("go-left", "go-right", "come-in");
    if (animate && !reduce()) { void card.offsetWidth; card.classList.add("come-in"); }
    // preload the next design
    const nx = designs[st.idx + 1];
    if (nx) for (const t of nx.tees) { const p = new Image(); p.src = imgOf(nx, t); }
  }
  function choose(value) {
    if (st.busy || $("#s-vote").hidden) return;
    const d = designs[st.idx];
    st.votes[d.id] = value;
    saveDraft();
    $("#btn-up").setAttribute("aria-pressed", String(value === 1));
    $("#btn-down").setAttribute("aria-pressed", String(value === -1));
    st.busy = true;
    const next = () => {
      st.busy = false;
      if (st.fromReview) { st.fromReview = false; renderReview(); return; }
      if (st.idx + 1 >= designs.length) { renderReview(); return; }
      st.idx += 1; saveDraft(); renderVote(true);
    };
    if (reduce()) { next(); return; }
    $("#card").classList.add(value === 1 ? "go-right" : "go-left");
    setTimeout(next, 200);
  }
  function back() {
    if (st.idx === 0) { st.voter = null; renderStart(); show("s-start"); return; }
    st.idx -= 1; st.fromReview = false; saveDraft(); renderVote(true);
  }

  /* 3. review */
  function renderReview() {
    show("s-review");
    const n = rated(), ups = designs.filter((d) => st.votes[d.id] === 1).length;
    $("#review-who").textContent = `Voting as ${nameOf(st.voter)}`;
    $("#review-sum").textContent = n < designs.length
      ? `${designs.length - n} still to rate. Tap a design to rate or change it.`
      : `${ups} likes, ${n - ups} dislikes. Tap any design to change it before you submit.`;
    $("#review-list").replaceChildren(...designs.map((d, i) => {
      const v = st.votes[d.id] || 0;
      return el("li", {}, el("button", { type: "button", onclick: () => { st.idx = i; st.fromReview = true; renderVote(true); } },
        el("img", { src: imgOf(d), alt: "", loading: "lazy" }),
        el("span", { class: "t" }, el("b", {}, d.title), el("span", {}, d.num)),
        el("span", { class: "chip " + (v === 1 ? "up" : v === -1 ? "down" : "none") },
          v === 1 ? "\u{1F44D} Like" : v === -1 ? "\u{1F44E} Dislike" : "Not rated")));
    }));
    $("#submit").disabled = n < designs.length;
    $("#submit").hidden = false;
    $("#confirm").hidden = true;
    $("#submit-note").textContent = "";
    $("#submit-note").className = "note";
  }
  async function submit() {
    if (st.busy) return;
    st.busy = true;
    $("#confirm-yes").disabled = true;
    $("#confirm-yes").textContent = "Submitting…";
    const votes = Object.fromEntries(designs.map((d) => [d.id, st.votes[d.id]]));
    try {
      st.results = await rpc("tee_vote2_submit", { p_voter: st.voter, p_votes: votes });
      save((s) => { delete s.drafts[st.voter]; s.done = st.voter; });
      renderDone();
    } catch (e) {
      if (/already been submitted/.test(e.message)) {
        save((s) => { s.done = st.voter; });
        await openDone(st.voter);
      } else {
        $("#submit-note").textContent = `${e.message} Your answers are saved on this phone, so you can try again.`;
        $("#submit-note").className = "note err";
      }
    } finally {
      st.busy = false;
      $("#confirm-yes").disabled = false;
      $("#confirm-yes").textContent = "Yes, submit";
    }
  }

  /* 4. done */
  async function openDone(id) {
    st.voter = id;
    try { st.results = await rpc("tee_vote2_results", { p_voter: id }); } catch (e) { st.results = null; }
    renderDone();
  }
  function renderDone() {
    show("s-done");
    const r = st.results;
    const map = byId();
    $("#done-name").textContent = nameOf(st.voter);
    const mine = (r && r.mine) || {};
    const ups = designs.filter((d) => mine[d.id] === 1), downs = designs.filter((d) => mine[d.id] === -1);
    $("#done-lede").textContent = `Your vote is saved and locked: ${ups.length} likes, ${downs.length} dislikes.`;
    const group = (list, cls, label) => list.length ? el("div", {}, el("h3", { class: cls }, `${label} (${list.length})`),
      el("div", { class: "thumbs" }, ...list.map((d) => el("img", { src: imgOf(d), alt: d.title, title: d.title, loading: "lazy" })))) : null;
    $("#mine").replaceChildren(group(ups, "up", "\u{1F44D} Liked") || "", group(downs, "down", "\u{1F44E} Disliked") || "");
    if (!r) { $("#board").replaceChildren(); $("#res-note").textContent = "Couldn't load results. Pull to refresh."; return; }
    const sub = r.submitted || [];
    $("#res-note").textContent = `${sub.length} of ${r.voters} have voted`;
    $("#people").replaceChildren(...((st.status && st.status.voters) || []).map((v) =>
      el("span", { class: "person" + (sub.includes(v.name) ? " done" : "") }, sub.includes(v.name) ? `✓ ${v.name}` : `${v.name} · waiting`)));
    const rows = (r.designs || []).filter((x) => map[x.id]).map((x) => ({ ...x, d: map[x.id], net: x.up - x.down }))
      .sort((a, b) => b.net - a.net || b.up - a.up || a.d.num.localeCompare(b.d.num));
    $("#board").replaceChildren(...rows.map((x, i) => el("li", { class: "row-r" + (i === 0 && x.net > 0 ? " lead" : "") },
      el("span", { class: "pos" }, String(i + 1)),
      el("img", { src: imgOf(x.d), alt: "", loading: "lazy" }),
      el("span", { class: "t" }, el("b", {}, x.d.title),
        el("small", {}, [x.ups.length ? `\u{1F44D} ${x.ups.join(", ")}` : "", x.downs.length ? `\u{1F44E} ${x.downs.join(", ")}` : ""].filter(Boolean).join("  ·  ") || "No votes yet")),
      el("span", { class: "net " + (x.net > 0 ? "pos-n" : x.net < 0 ? "neg-n" : "") }, fmtNet(x.net), el("small", {}, `+${x.up} / −${x.down}`)))));
    clearInterval(st.timer);
    st.timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || $("#s-done").hidden) return;
      try { st.results = await rpc("tee_vote2_results", { p_voter: st.voter }); renderDone(); } catch (e) { /* keep last */ }
    }, 20000);
  }

  /* ---------- lightbox ---------- */
  function openLb() {
    const d = designs[st.idx];
    const draw = (tee) => {
      $("#lb-title").textContent = `${d.num} · ${d.title}`;
      $("#lb-img").src = imgOf(d, tee);
      $("#lb-img").alt = `${d.title} on a ${tee} tee`;
      $("#lb-seg").hidden = d.tees.length < 2;
      $("#lb-seg").replaceChildren(...d.tees.map((t) => el("button", { type: "button", "aria-pressed": String(t === tee), onclick: () => draw(t) }, `${t[0].toUpperCase()}${t.slice(1)} tee`)));
    };
    draw(st.tee[d.id] || d.tees[0]);
    $("#lb").showModal();
  }

  /* ---------- swipe on the picture ---------- */
  function wireSwipe() {
    const shot = $("#shot");
    let x0 = null, y0 = 0, moved = false;
    shot.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; moved = false; });
    shot.addEventListener("pointermove", (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - y0)) {
        moved = true;
        if (!reduce()) $("#card").style.transform = `translateX(${dx * 0.4}px) rotate(${dx * 0.02}deg)`;
      }
    });
    const end = (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0;
      x0 = null;
      $("#card").style.transform = "";
      if (moved && Math.abs(dx) > 70) choose(dx > 0 ? 1 : -1);
    };
    shot.addEventListener("pointerup", end);
    shot.addEventListener("pointercancel", () => { x0 = null; $("#card").style.transform = ""; });
    shot.addEventListener("click", (e) => { if (moved) { e.preventDefault(); moved = false; return; } openLb(); });
  }

  /* ---------- boot ---------- */
  async function boot() {
    $("#who").addEventListener("change", updateStartBtn);
    $("#start").addEventListener("click", start);
    $("#btn-up").addEventListener("click", () => choose(1));
    $("#btn-down").addEventListener("click", () => choose(-1));
    $("#back").addEventListener("click", back);
    $("#to-review").addEventListener("click", renderReview);
    $("#submit").addEventListener("click", () => { $("#submit").hidden = true; $("#confirm").hidden = false; $("#confirm-yes").focus(); });
    $("#cancel").addEventListener("click", () => { $("#confirm").hidden = true; $("#submit").hidden = false; });
    $("#confirm-yes").addEventListener("click", submit);
    $("#lb-close").addEventListener("click", () => $("#lb").close());
    $("#lb").addEventListener("click", (e) => { if (e.target.id === "lb") $("#lb").close(); });
    document.addEventListener("keydown", (e) => {
      if ($("#s-vote").hidden || $("#lb").open || e.target.tagName === "SELECT") return;
      if (e.key === "ArrowRight") { e.preventDefault(); choose(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); choose(-1); }
    });
    wireSwipe();
    show("s-start");
    if (!configured) { $("#start-note").textContent = "This page isn't connected to its database yet."; return; }
    $("#start-note").textContent = "Loading names…";
    try {
      st.status = await rpc("tee_vote2_status");
      const ids = st.status.designs || [];
      if (ids.length) designs = ids.map((id) => ALL.find((d) => d.id === id)).filter(Boolean);
    } catch (e) {
      $("#start-note").textContent = "Couldn't reach the vote. Check your connection and reload.";
      $("#start-note").className = "note err";
      return;
    }
    $("#start-note").textContent = "";
    if (st.status.closed) {
      $("#start-lede").textContent = "Voting is closed. Pick your name to see the results.";
    }
    const s = load();
    const me = s.done && st.status.voters.find((v) => v.id === s.done);
    if (me && me.submitted) { await openDone(me.id); return; }
    if (s.done && !(me && me.submitted)) save((x) => { x.done = null; });
    renderStart();
    if (st.status.closed) {
      $("#start").textContent = "See the results";
      $("#start").onclick = (e) => { e.stopImmediatePropagation(); const id = $("#who").value; if (id) openDone(id); };
      for (const o of $("#who").options) o.disabled = false;
    }
  }
  boot();
})();
