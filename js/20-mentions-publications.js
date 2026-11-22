// ----- mentions @ et hashtags # dans les publications et les commentaires -----
// Fichier indépendant : il ne modifie aucun autre fichier.
// - pmRich(texte)  : renvoie le texte avec les @pseudo et les #hashtags en couleur et cliquables
//                    (déjà appelée par 09-profil-mur.js pour les commentaires)
// - pmAttach(champ, rappel) : ajoute la liste de suggestions quand on tape @ dans un champ
//                    (déjà appelée par 09-profil-mur.js pour « Nouvelle publication »)
// Il s'occupe aussi tout seul : du champ de commentaire (#fci) et du texte des publications du fil.
(function(){
  const RE_TOKEN = /(^|[\s(])@([\p{L}\p{N}_]{0,30})$/u;
  const RE_RICH = /(^|[^\p{L}\p{N}_&;@#])([@#])([\p{L}\p{N}_]{2,30})/gu;
  let box = null, seq = 0, tmr = 0, raf = 0;

  const st = document.createElement("style");
  st.textContent = ".pmn,.pmh{font-weight:700;cursor:pointer}.pmn{color:var(--g)}.pmh{color:#1e88e5}.b.me .pmn,.b.me .pmh{color:var(--y)}" +
    "#pmbox{position:fixed;z-index:70;background:var(--card);border:1px solid var(--bd);border-radius:18px;box-shadow:0 6px 18px rgba(15,91,58,.18);overflow:hidden}" +
    "#pmbox .pmi{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer}#pmbox .pmi+.pmi{border-top:1px solid var(--bd)}" +
    "#pmbox .pmi b{display:block;font-size:14px;line-height:1.2}#pmbox .pmi small{display:block}" +
    ".pmrow{display:block;width:100%;text-align:left;padding:10px 0;border:0;border-bottom:1px solid var(--bd);background:none;color:inherit;font:inherit;cursor:pointer}" +
    ".pmrow b{display:block;font-size:14px}.pmrow small{display:block;color:var(--mu)}.pmrow span{display:block;margin-top:2px;font-size:14px;line-height:1.35}";
  document.head.appendChild(st);

  // ---------- mise en forme du texte ----------
  window.pmRich = function(texte){
    const s = esc(String(texte == null ? "" : texte));
    return s.replace(RE_RICH, (all, pre, sym, nom) => pre + (sym === "@"
      ? '<span class="pmn" data-pmn="' + nom + '">@' + nom + '</span>'
      : '<span class="pmh" data-pmh="' + nom + '">#' + nom + '</span>'));
  };

  // ---------- suggestions quand on tape @ ----------
  function hide(){ if(box){ box.remove(); box = null; } }

  async function chercher(q){
    let list = [];
    try{ list = await rp2("chercher_profils", {p_q:q}); }
    catch(e){
      try{ list = await withAuth(t => sb("/rest/v1/profiles?select=id,nom,pseudo&pseudo=ilike." + encodeURIComponent(q) + "*&limit=8", {}, t)); }catch(e2){ list = []; }
    }
    const ql = q.toLowerCase(), vu = {};
    return (list || []).filter(u => u && u.pseudo && u.id !== session.id && !blocked.has(u.id) && (u.pseudo || "").toLowerCase() !== "ella" && !vu[u.id] && (vu[u.id] = 1))
      .sort((a, b) => ((a.pseudo || "").toLowerCase().startsWith(ql) ? 0 : 1) - ((b.pseudo || "").toLowerCase().startsWith(ql) ? 0 : 1)).slice(0, 6);
  }

  function show(el, list, start, end, rappel){
    hide();
    if(!list.length) return;
    box = document.createElement("div");
    box.id = "pmbox";
    box.innerHTML = list.map((u, i) => '<div class="pmi" data-i="' + i + '"><div class="av s">' + esc((u.nom || u.pseudo || "?").charAt(0).toUpperCase()) + '</div><div><b>' + esc(u.nom || u.pseudo) + '</b><small>@' + esc(u.pseudo) + '</small></div></div>').join("");
    document.body.appendChild(box);
    const r = el.getBoundingClientRect(), h = box.offsetHeight, w = Math.min(Math.max(r.width, 240), 416);
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
    box.style.width = w + "px";
    if(r.top > h + 20) box.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + "px";
    else box.style.top = Math.min(window.innerHeight - h - 8, r.bottom + 6) + "px";
    box.querySelectorAll(".pmi").forEach(n => {
      n.addEventListener("pointerdown", ev => ev.preventDefault());
      n.addEventListener("click", () => choisir(el, list[+n.dataset.i], start, end, rappel));
    });
  }

  function choisir(el, u, start, end, rappel){
    const v = el.value, add = "@" + u.pseudo + " ";
    el.value = v.slice(0, start) + add + v.slice(end);
    const pos = start + add.length;
    hide(); el.focus();
    try{ el.setSelectionRange(pos, pos); }catch(e){}
    el.dispatchEvent(new Event("input", {bubbles:true}));
    if(typeof rappel === "function"){ try{ rappel(el.value); }catch(e){} }
  }

  function surSaisie(el, rappel){
    const pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    const m = RE_TOKEN.exec(el.value.slice(0, pos));
    if(!m || !m[2]){ hide(); return; }
    const raw = m[2], start = pos - raw.length - 1, mine = ++seq;
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const list = await chercher(raw);
      if(mine !== seq) return;
      show(el, list, start, pos, rappel);
    }, 180);
  }

  window.pmAttach = function(el, rappel){
    if(!el || el.dataset.pm) return;
    el.dataset.pm = "1";
    el.addEventListener("input", () => surSaisie(el, rappel));
    el.addEventListener("blur", () => setTimeout(hide, 200));
  };

  // ---------- toucher un @pseudo ou un #hashtag ----------
  async function ouvrirProfil(pseudo){
    let id = null;
    try{ const r = await withAuth(t => sb("/rest/v1/profiles?select=id,pseudo&pseudo=ilike." + encodeURIComponent(pseudo) + "&limit=1", {}, t)); if(r && r[0]) id = r[0].id; }catch(e){}
    if(!id){ try{ const r = await rp2("chercher_profils", {p_q:pseudo}); const u = (r || []).find(x => (x.pseudo || "").toLowerCase() === pseudo.toLowerCase()); if(u) id = u.id; }catch(e){} }
    if(id && typeof openUser === "function") openUser(id);
  }

  async function ouvrirHashtag(tag){
    const d = document.createElement("div"); d.className = "sheet";
    d.innerHTML = '<div class="sc"><b>#' + esc(tag) + '</b><div id="pmres" style="max-height:55vh;overflow:auto;text-align:left"><p class="pt c">Chargement…</p></div><button class="t" id="pmx">Fermer</button></div>';
    document.body.appendChild(d);
    const fermer = () => d.remove();
    d.addEventListener("click", e => { if(e.target === d) fermer(); });
    d.querySelector("#pmx").onclick = fermer;
    let rows = [];
    try{
      rows = await withAuth(t => sb("/rest/v1/statuts?select=id,auteur,texte,created_at,profiles!statuts_auteur_fkey(nom,pseudo)&texte=ilike.*%23" + encodeURIComponent(tag) + "*&order=created_at.desc&limit=40", {}, t));
    }catch(e){ rows = null; }
    const zone = d.querySelector("#pmres"); if(!zone) return;
    if(rows === null){ zone.innerHTML = '<p class="pt c">Impossible de charger les publications.</p>'; return; }
    const re = new RegExp("(^|[^\\p{L}\\p{N}_&;])#" + tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}\\p{N}_])", "iu");
    rows = rows.filter(x => re.test(x.texte || "") && !blocked.has(x.auteur));
    zone.innerHTML = rows.length ? rows.map(x => '<button class="pmrow" data-id="' + esc(x.id) + '"><b>' + esc((x.profiles && (x.profiles.nom || x.profiles.pseudo)) || "Étudiant") + '</b><small>' + esc(ago(x.created_at)) + '</small><span>' + pmRich((x.texte || "").slice(0, 160)) + '</span></button>').join("") : '<p class="pt c">Aucune publication avec ce hashtag pour l’instant.</p>';
    zone.querySelectorAll(".pmrow").forEach(b => b.onclick = () => { fermer(); if(typeof openStatut === "function") openStatut(b.dataset.id); });
  }

  document.addEventListener("click", ev => {
    const n = ev.target.closest && ev.target.closest("[data-pmn],[data-pmh]");
    if(!n) return;
    ev.stopPropagation();
    if(n.dataset.pmn) ouvrirProfil(n.dataset.pmn); else ouvrirHashtag(n.dataset.pmh);
  }, true);

  document.addEventListener("keydown", ev => { if(ev.key === "Escape") hide(); });

  // ---------- branchement automatique ----------
  function scan(){
    const c = document.getElementById("fci");
    if(c) pmAttach(c, v => { try{ fcd = v; }catch(e){} });
    document.querySelectorAll(".card.post > p:not([data-pmd])").forEach(p => {
      p.dataset.pmd = "1";
      if(p.children.length) return;
      const h = p.innerHTML;
      if(h.indexOf("@") < 0 && h.indexOf("#") < 0) return;
      p.innerHTML = h.replace(RE_RICH, (all, pre, sym, nom) => pre + (sym === "@"
        ? '<span class="pmn" data-pmn="' + nom + '">@' + nom + '</span>'
        : '<span class="pmh" data-pmh="' + nom + '">#' + nom + '</span>'));
    });
    if(box && !(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.pm)) hide();
  }
  new MutationObserver(() => {
    if(raf) return;
    raf = requestAnimationFrame(() => { raf = 0; try{ scan(); }catch(e){} });
  }).observe(document.body, {childList:true, subtree:true});
})();
