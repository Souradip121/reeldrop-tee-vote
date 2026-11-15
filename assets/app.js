/* reeldrop tee vote: thumbs up / down on every design, live scores for everyone.
   Talks to Supabase only through three RPCs (see supabase/schema.sql). */
(function () {
  "use strict";
  const CFG = window.VOTE_CONFIG || {};
  const DESIGNS = window.DESIGNS || [];
  const byId = Object.fromEntries(DESIGNS.map((d) => [d.id, d]));
  const AUTH_KEY = "tee_vote_auth";
  const SORT_KEY = "tee_vote_sort";
  const configured = !!(CFG.supabaseUrl && CFG.supabaseKey && !/YOUR_/.test(CFG.supabaseUrl + CFG.supabaseKey));

  const state = { voter: null, code: null, me: null, mine: {}, ab: null, results: null, error: "", pending: 0, sort: "order", view: "main" };
  const AB = [
    { id: "original", letter: "A", title: "Original", desc: "Navy line-art Lolo on the coral circle" },
    { id: "colour", letter: "B", title: "Coloured Lolo", desc: "Full-colour pink Lolo on the coral circle" },
  ];
  try { state.sort = localStorage.getItem(SORT_KEY) || "order"; } catch (e) { /* storage blocked */ }

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const THUMB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 21h3.5V9.5H2V21Zm19.6-9.7c.2-.4.3-.9.3-1.3 0-1.5-1.2-2.7-2.7-2.7h-4.6l.7-3.3v-.3c0-.5-.2-.9-.5-1.2L13.6 1 7.4 7.2c-.4.4-.6.9-.6 1.4V19c0 1.1.9 2 2 2h8.5c.8 0 1.6-.5 1.9-1.2l2.7-6.3c.1-.3.2-.6.2-.9v-1.3h-.5Z"/></svg>';
  const fmtNet = (n) => (n > 0 ? `+${n}` : String(n));

  /* ---------- personal link ---------- */
  function readAuth() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (h.get("v") && h.get("k")) {
      const a = { v: h.get("v").toLowerCase(), k: h.get("k") };
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) { /* ignore */ }
      history.replaceState(null, "", location.pathname + location.search); // hide the code from the address bar
      return a;
    }
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) { return null; }
  }
  function forget() {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
    state.voter = state.code = state.me = null; state.mine = {}; state.ab = null;
    render();
  }

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
  async function loadResults() {
    if (!configured || state.pending) return;
    try { state.results = await rpc("tee_vote_results"); renderScores(); }
    catch (e) { /* keep showing the last tally */ }
  }

  /* ---------- helpers ---------- */
  let toastT;
  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = el("div", { class: "toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const canVote = () => configured && !!state.me && !(state.results && state.results.closed);
  const scoreOf = (id) => {
    const r = state.results && (state.results.designs || []).find((x) => x.id === id);
    return r ? { up: r.up, down: r.down, net: r.up - r.down, ups: r.ups || [], downs: r.downs || [] } : { up: 0, down: 0, net: 0, ups: [], downs: [] };
  };
  const rated = () => Object.keys(state.mine).filter((k) => byId[k]).length;
  function ordered() {
    const list = DESIGNS.slice();
    if (state.sort === "top") list.sort((a, b) => scoreOf(b.id).net - scoreOf(a.id).net || scoreOf(b.id).up - scoreOf(a.id).up || a.num.localeCompare(b.num));
    return list;
  }

  /* ---------- voting (optimistic) ---------- */
  function applyLocal(id, from, to) {
    const r = state.results && (state.results.designs || []).find((x) => x.id === id);
    if (!r || !state.me) return;
    const name = state.me.name;
    if (from === 1) { r.up--; r.ups = r.ups.filter((n) => n !== name); }
    if (from === -1) { r.down--; r.downs = r.downs.filter((n) => n !== name); }
    if (to === 1) { r.up++; r.ups = [...r.ups, name].sort(); }
    if (to === -1) { r.down++; r.downs = [...r.downs, name].sort(); }
    const v = (state.results.voters || []).find((x) => x.id === state.voter);
    if (v) v.rated = rated();
  }
  async function vote(id, value) {
    if (!canVote()) return;
    const from = state.mine[id] || 0;
    const to = from === value ? 0 : value; // tapping your current vote again clears it
    if (to) state.mine[id] = to; else delete state.mine[id];
    applyLocal(id, from, to);
    renderCard(id); renderDock(); renderLeaders(); renderPeople(); if (lbId === id) drawLb();
    state.pending++;
    try {
      const res = await rpc("tee_vote_set", { p_voter: state.voter, p_code: state.code, p_design: id, p_value: to });
      if (state.pending === 1) { state.results = res; renderScores(); }
    } catch (e) {
      if (from) state.mine[id] = from; else delete state.mine[id];
      applyLocal(id, to, from);
      renderScores(); toast(`Couldn't save that vote. ${e.message}`);
    } finally {
      state.pending--;
    }
  }
  /* ---------- vote 2: original vs coloured Lolo (one pick each) ---------- */
  const abData = () => (state.results && state.results.ab) || { closed: false, original: 0, colour: 0, originals: [], colours: [] };
  const canVoteAB = () => configured && !!state.me && !abData().closed;
  function applyLocalAB(from, to) {
    const ab = state.results && state.results.ab;
    if (!ab || !state.me) return;
    const name = state.me.name;
    if (from) { ab[from]--; ab[from + "s"] = ab[from + "s"].filter((n) => n !== name); }
    if (to) { ab[to]++; ab[to + "s"] = [...ab[to + "s"], name].sort(); }
  }
  async function voteAB(choice) {
    if (!canVoteAB()) return;
    const from = state.ab;
    const to = from === choice ? null : choice; // tap your pick again to undo it
    state.ab = to; applyLocalAB(from, to); renderAB(); renderTabs();
    state.pending++;
    try {
      const res = await rpc("tee_vote_ab_set", { p_voter: state.voter, p_code: state.code, p_choice: to || "" });
      if (state.pending === 1) { state.results = res; renderAB(); }
    } catch (e) {
      state.ab = from; applyLocalAB(to, from); renderAB(); renderTabs();
      toast(`Couldn't save that pick. ${e.message}`);
    } finally {
      state.pending--;
    }
  }
  function renderAB() {
    const ab = abData();
    const total = ab.original + ab.colour;
    const lead = ab.original === ab.colour ? null : ab.original > ab.colour ? AB[0] : AB[1];
    $("#ab-sum").replaceChildren(!configured ? "" : !total ? "No picks yet."
      : lead ? el("span", {}, el("span", { class: "lead-tag" }, `${lead.letter} · ${lead.title}`), ` leads, ${Math.max(ab.original, ab.colour)} to ${Math.min(ab.original, ab.colour)}`)
      : `Tied, ${ab.original} each`);
    $("#ab-grid").replaceChildren(...AB.map((o) => {
      const n = ab[o.id] || 0;
      const names = ab[o.id + "s"] || [];
      const mine = state.ab === o.id;
      return el("article", { class: "opt" + (mine ? " picked" : "") },
        el("button", { class: "thumb", type: "button", "aria-label": `Open option ${o.letter} larger`, onclick: () => openAbLb(o.id) },
          el("img", { src: `assets/img/ab-${o.id}.jpg`, alt: `We're reeldrop on a black tee, ${o.title.toLowerCase()}`, width: 900, height: 1012 })),
        el("div", { class: "opt-body" },
          el("div", { class: "opt-top" }, el("span", { class: "letter" }, o.letter), el("h3", {}, o.title)),
          el("p", { class: "opt-desc" }, o.desc),
          el("div", { class: "opt-count" }, el("b", {}, String(n)), el("span", {}, total ? `${Math.round((n / total) * 100)}%` : "0%")),
          el("div", { class: "meter", "aria-hidden": "true" }, el("i", { style: `width:${total ? (n / total) * 100 : 0}%` })),
          el("p", { class: "opt-names" }, names.join(", ")),
          state.me ? el("button", { class: "pick", type: "button", disabled: !canVoteAB(), "aria-pressed": String(mine), onclick: () => voteAB(o.id) },
            mine ? `Picked ${o.letter} ✓` : `Pick ${o.letter}`) : null));
    }));
    const res = state.results;
    const picked = new Set([...(ab.originals || []), ...(ab.colours || [])]);
    $("#ab-people").replaceChildren(...((res && res.voters) || []).filter((v) => v.id !== "claude-test").map((v) =>
      el("span", { class: "person" + (picked.has(v.name) ? " done" : "") }, v.name, el("span", {}, picked.has(v.name) ? "✓ picked" : "waiting"))));
  }
  function openAbLb(id) {
    const o = AB.find((x) => x.id === id);
    lbId = null;
    $("#lb-title").textContent = `Vote 2 · ${o.letter} · ${o.title}`;
    $("#lb-body").replaceChildren(el("div", { class: "lb" },
      el("div", { class: "lb-img" }, el("img", { src: `assets/img/ab-${o.id}.jpg`, alt: `We're reeldrop on a black tee, ${o.title.toLowerCase()}`, width: 900, height: 1012 })),
      el("div", { class: "lb-side" },
        el("h3", {}, `${o.letter} · ${o.title}`),
        el("p", { class: "lede" }, o.desc + ". Printed on a black tee, 10.2 × 16 in on the back."),
        state.me ? el("button", { class: "pick", type: "button", disabled: !canVoteAB(), "aria-pressed": String(state.ab === o.id), onclick: () => { voteAB(o.id); openAbLb(o.id); } },
          state.ab === o.id ? `Picked ${o.letter} ✓` : `Pick ${o.letter}`) : null)));
    const dlg = $("#lb");
    if (!dlg.open) dlg.showModal();
  }

  /* ---------- tabs ---------- */
  function setView(v, push) {
    state.view = v === "ab" ? "ab" : "main";
    if (push) history.replaceState(null, "", location.pathname + location.search + (state.view === "ab" ? "#ab" : ""));
    renderTabs(); renderDock();
    window.scrollTo({ top: 0 });
  }
  function renderTabs() {
    for (const a of document.querySelectorAll("#tabs a")) {
      if (a.dataset.view === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    $("#view-main").hidden = state.view !== "main";
    $("#view-ab").hidden = state.view !== "ab";
    $("#ab-new").hidden = !(state.me && !state.ab && !abData().closed && state.view !== "ab");
  }

  function nextUnrated() {
    const d = ordered().find((x) => !state.mine[x.id]);
    if (!d) { toast("You've rated every design. Thank you!"); return; }
    const n = document.getElementById(`d-${d.id}`);
    if (n) { n.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); n.querySelector(".vote")?.focus({ preventScroll: true }); }
  }

  /* ---------- rendering ---------- */
  function renderWho() {
    const who = $("#who");
    who.replaceChildren();
    if (!configured) return;
    if (state.me) who.append(el("span", { class: "chip" }, "Voting as ", el("b", {}, state.me.name)), el("button", { class: "linkbtn", type: "button", onclick: forget }, "Not you?"));
    else who.append(el("span", { class: "chip" }, "View only"));
  }
  function renderBanner() {
    const b = $("#banner");
    let msg = "";
    if (!configured) msg = "This page isn't connected to its database yet, so votes can't be saved.";
    else if (state.error) msg = state.error;
    else if (state.results && state.results.closed) msg = "Voting is closed. These are the final scores.";
    else if (!state.me) msg = "To vote, open the personal link you were sent. You can still see the live scores here.";
    b.textContent = msg; b.hidden = !msg;
  }
  function voteButtons(d, compact) {
    const mine = state.mine[d.id] || 0;
    const dis = !canVote();
    return el("div", { class: "votes", role: "group", "aria-label": `Vote on ${d.title}` },
      el("button", { class: "vote up", type: "button", disabled: dis, "aria-pressed": String(mine === 1), onclick: () => vote(d.id, 1), html: THUMB + `<span>${mine === 1 ? "Liked" : "Like"}</span>` }),
      el("button", { class: "vote down", type: "button", disabled: dis, "aria-pressed": String(mine === -1), onclick: () => vote(d.id, -1), html: THUMB.replace("<svg", '<svg style="transform:rotate(180deg)"') + `<span>${mine === -1 ? "Disliked" : "Dislike"}</span>` }));
  }
  function cardNode(d) {
    const s = scoreOf(d.id);
    const mine = state.mine[d.id] || 0;
    const total = s.up + s.down;
    return el("article", { class: "card" + (mine === 1 ? " mine-up" : mine === -1 ? " mine-down" : ""), id: `d-${d.id}`, "data-sig": sigOf(d.id) },
      el("button", { class: "thumb", type: "button", "aria-label": `Open ${d.title} larger`, onclick: () => openLb(d.id) },
        el("img", { src: `assets/img/${d.id}.jpg`, alt: `${d.title} on a white tee and a black tee`, loading: "lazy", width: 1200, height: 675 })),
      el("div", { class: "card-body" },
        el("div", { class: "meta" }, el("span", { class: "num" }, d.num), el("span", { class: "style" }, d.style)),
        el("div", { class: "title-row" },
          el("h3", {}, d.title),
          el("div", { class: "score", "aria-label": `Score ${fmtNet(s.net)}: ${s.up} likes, ${s.down} dislikes` },
            el("span", { class: "net " + (s.net > 0 ? "pos-n" : s.net < 0 ? "neg-n" : "") }, fmtNet(s.net)),
            el("small", {}, `+${s.up} / −${s.down}`))),
        el("div", { class: "split", "aria-hidden": "true" },
          total ? el("i", { class: "u", style: `width:${(s.up / total) * 100}%` }) : null,
          total ? el("i", { class: "d", style: `width:${(s.down / total) * 100}%` }) : null),
        el("p", { class: "feat" }, d.features),
        (s.ups.length || s.downs.length) ? el("div", { class: "names" },
          s.ups.length ? el("p", {}, el("span", { class: "k u" }, "LIKE"), s.ups.join(", ")) : null,
          s.downs.length ? el("p", {}, el("span", { class: "k d" }, "NOPE"), s.downs.join(", ")) : null) : null,
        configured && state.me ? voteButtons(d) : null));
  }
  const sigOf = (id) => {
    const s = scoreOf(id);
    return [s.up, s.down, s.ups.join(","), s.downs.join(","), state.mine[id] || 0, canVote() ? 1 : 0, state.me ? 1 : 0].join("|");
  };
  function renderCard(id) {
    const old = document.getElementById(`d-${id}`);
    if (!old || old.dataset.sig === sigOf(id)) return; // untouched cards keep their DOM (and any tap in progress)
    const hadFocus = old.contains(document.activeElement) ? document.activeElement.className : null;
    const n = cardNode(byId[id]);
    old.replaceWith(n);
    if (hadFocus) n.querySelector("." + hadFocus.split(" ").join("."))?.focus({ preventScroll: true });
  }
  function renderGrid() { $("#grid").replaceChildren(...ordered().map(cardNode)); }
  function renderLeaders() {
    const box = $("#leaders");
    if (!configured || !state.results) { box.hidden = true; return; }
    const any = (state.results.designs || []).some((r) => r.up || r.down);
    box.hidden = false;
    const top = DESIGNS.slice().sort((a, b) => scoreOf(b.id).net - scoreOf(a.id).net || scoreOf(b.id).up - scoreOf(a.id).up || a.num.localeCompare(b.num)).slice(0, 3);
    $("#lead-list").replaceChildren(...(any ? top.map((d, i) => {
      const s = scoreOf(d.id);
      return el("button", { class: "lead", type: "button", onclick: () => document.getElementById(`d-${d.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) },
        el("span", { class: "pos" }, String(i + 1)),
        el("img", { src: `assets/img/${d.id}.jpg`, alt: "" }),
        el("span", { class: "lead-title" }, d.title),
        el("span", { class: "net " + (s.net > 0 ? "pos-n" : s.net < 0 ? "neg-n" : "") }, fmtNet(s.net)));
    }) : [el("p", { class: "lede" }, "No votes yet. The top three will show here.")]));
  }
  function renderPeople() {
    const box = $("#people");
    const res = state.results;
    if (!res) { box.replaceChildren(); return; }
    const total = res.total || DESIGNS.length;
    box.replaceChildren(...(res.voters || []).filter((v) => v.id !== "claude-test").map((v) =>
      el("span", { class: "person" + (v.rated >= total ? " done" : "") }, v.name, el("span", {}, v.rated >= total ? "✓ done" : `${v.rated}/${total}`))));
  }
  function renderDock() {
    const dock = $("#dock");
    dock.hidden = !canVote() || state.view !== "main";
    if (dock.hidden) return;
    const n = rated(), t = DESIGNS.length;
    $("#prog-t").replaceChildren(n >= t ? "All done, thank you!" : `${n} of ${t} rated`, el("span", {}, n >= t ? "" : " · votes save as you tap"));
    $("#prog-bar").style.width = `${(n / t) * 100}%`;
    $("#next").hidden = n >= t;
  }
  function renderSort() {
    for (const b of document.querySelectorAll("#sort button")) b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort));
  }
  function renderScores() {
    const want = ordered().map((d) => `d-${d.id}`).join(",");
    const have = [...document.querySelectorAll("#grid > .card")].map((n) => n.id).join(",");
    if (want !== have) renderGrid();
    else for (const d of DESIGNS) renderCard(d.id);
    renderLeaders(); renderPeople(); renderDock(); renderBanner(); renderAB(); renderTabs();
    if (lbId) drawLb();
  }
  function render() { renderWho(); renderBanner(); renderSort(); renderGrid(); renderLeaders(); renderPeople(); renderAB(); renderTabs(); renderDock(); }

  /* ---------- lightbox ---------- */
  let lbId = null, lbTee = "white";
  function openLb(id) { lbId = id; lbTee = "white"; drawLb(); const dlg = $("#lb"); if (!dlg.open) dlg.showModal(); }
  function drawLb() {
    const d = byId[lbId];
    if (!d) return;
    const s = scoreOf(d.id);
    $("#lb-title").textContent = `${d.num} · ${d.title}`;
    $("#lb-body").replaceChildren(el("div", { class: "lb" },
      el("div", { class: "lb-img" }, el("img", { src: `assets/img/${d.id}-${lbTee}.jpg`, alt: `${d.title} on a ${lbTee} tee`, width: 960, height: 1080 })),
      el("div", { class: "lb-side" },
        el("div", { class: "seg", role: "group", "aria-label": "Tee colour" },
          ...["white", "black"].map((t) => el("button", { type: "button", "aria-pressed": String(lbTee === t), onclick: () => { lbTee = t; drawLb(); } }, `${t[0].toUpperCase()}${t.slice(1)} tee`))),
        el("h3", {}, d.title),
        el("div", { class: "title-row" },
          el("span", { class: "label" }, "Live score"),
          el("div", { class: "score" }, el("span", { class: "net " + (s.net > 0 ? "pos-n" : s.net < 0 ? "neg-n" : "") }, fmtNet(s.net)), el("small", {}, `+${s.up} / −${s.down}`))),
        configured && state.me ? voteButtons(d) : null,
        el("dl", { class: "kv" },
          el("dt", {}, "Style"), el("dd", {}, d.style),
          el("dt", {}, "Shows"), el("dd", {}, d.features),
          el("dt", {}, "Print"), el("dd", {}, d.method)))));
  }

  /* ---------- boot ---------- */
  async function boot() {
    render();
    $("#lb-close").addEventListener("click", () => $("#lb").close());
    $("#lb").addEventListener("close", () => { lbId = null; });
    $("#next").addEventListener("click", nextUnrated);
    for (const b of document.querySelectorAll("#sort button")) {
      b.addEventListener("click", () => {
        state.sort = b.dataset.sort;
        try { localStorage.setItem(SORT_KEY, state.sort); } catch (e) { /* ignore */ }
        renderSort(); renderGrid();
      });
    }
    for (const a of document.querySelectorAll("#tabs a")) {
      a.addEventListener("click", (e) => { e.preventDefault(); setView(a.dataset.view, true); });
    }
    window.addEventListener("hashchange", () => { if (!/[?&]?v=/.test(location.hash)) setView(location.hash === "#ab" ? "ab" : "main", false); });
    if (!configured) return;
    const wantAB = /(^#|&)(ab|tab=ab)(&|$)/.test(location.hash);
    const auth = readAuth();
    if (wantAB) setView("ab", true);
    const jobs = [rpc("tee_vote_results").then((r) => { state.results = r; }).catch(() => {})];
    if (auth) {
      jobs.push(rpc("tee_vote_me", { p_voter: auth.v, p_code: auth.k }).then((me) => {
        state.voter = auth.v; state.code = auth.k; state.me = me; state.mine = me.votes || {}; state.ab = me.ab || null;
      }).catch((e) => {
        state.error = `${e.message} Ask Souradip to resend your personal link.`;
        try { localStorage.removeItem(AUTH_KEY); } catch (er) { /* ignore */ }
      }));
    }
    await Promise.all(jobs);
    render();
    setInterval(() => { if (document.visibilityState === "visible") loadResults(); }, 15000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadResults(); });
  }
  boot();
})();
