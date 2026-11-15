// ----- mentions @ dans les conversations de groupe -----
// Fichier indépendant : il ne modifie ni 04-messages.js, ni 05-groupes.js, ni Ella.
// Il s'accroche à la zone de saisie (#mt) et aux bulles (#ml) quand elles apparaissent.
(function(){
  const RE_TOKEN = /(^|[\s(])@([\p{L}\p{N}_]{0,30})$/u;
  const RE_MENTION = /(^|[^\p{L}\p{N}_&;@])@([\p{L}\p{N}_]{2,30})/gu;
  const known = {};     // pseudo (en minuscules) -> id
  const memCache = {};  // id du groupe -> {t, list}
  let box = null, seq = 0, raf = 0;

  const st = document.createElement("style");
  st.textContent = ".mnt{font-weight:700;color:var(--g);cursor:pointer}.b.me .mnt{color:var(--y)}" +
    "#mnbox{position:fixed;z-index:40;left:12px;right:12px;max-width:416px;margin:0 auto;background:var(--card);border:1px solid var(--bd);border-radius:18px;box-shadow:0 6px 18px rgba(15,91,58,.18);overflow:hidden}" +
    "#mnbox .mni{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer}#mnbox .mni+.mni{border-top:1px solid var(--bd)}" +
    "#mnbox .mni b{display:block;font-size:14px;line-height:1.2}#mnbox .mni small{display:block}";
  document.head.appendChild(st);

  // Groupe normal seulement : dans un groupe anonyme, personne ne voit qui est membre.
  function inGroup(){ try{ return !!(peer && peer.grp && !peer.anonyme); }catch(e){ return false; } }

  async function members(gid){
    const c = memCache[gid];
    if(c && Date.now() - c.t < 60000) return c.list;
    let list = [];
    try{
      const m = await withAuth(t => sb("/rest/v1/groupe_membres_vue?select=id&groupe=eq." + gid, {}, t));
      const ids = (m || []).map(x => x.id).filter(id => id && id !== session.id && !blocked.has(id));
      if(ids.length) list = await withAuth(t => sb("/rest/v1/profiles?select=id,nom,pseudo&id=in.(" + ids.join(",") + ")", {}, t));
    }catch(e){}
    list = (list || []).filter(u => u.pseudo);
    list.forEach(u => { known[u.pseudo.toLowerCase()] = u.id; });
    memCache[gid] = {t:Date.now(), list};
    return list;
  }

  function hide(){ if(box){ box.remove(); box = null; } }

  function show(el, list, start, end){
    hide();
    if(!list.length) return;
    box = document.createElement("div");
    box.id = "mnbox";
    box.innerHTML = list.map((u, i) => '<div class="mni" data-i="' + i + '"><div class="av s">' + esc((u.nom || u.pseudo || "?").charAt(0).toUpperCase()) + '</div><div><b>' + esc(u.nom || u.pseudo) + '</b><small>@' + esc(u.pseudo) + '</small></div></div>').join("");
    document.body.appendChild(box);
    const anchor = el.closest(".cbar") || el, r = anchor.getBoundingClientRect();
    box.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + "px";
    box.querySelectorAll(".mni").forEach(n => {
      n.addEventListener("pointerdown", ev => ev.preventDefault());
      n.addEventListener("click", () => pick(el, list[+n.dataset.i], start, end));
    });
  }

  function pick(el, u, start, end){
    const v = el.value, add = "@" + u.pseudo + " ";
    el.value = v.slice(0, start) + add + v.slice(end);
    const pos = start + add.length;
    known[u.pseudo.toLowerCase()] = u.id;
    hide(); el.focus();
    try{ el.setSelectionRange(pos, pos); }catch(e){}
    el.dispatchEvent(new Event("input", {bubbles:true}));   // met à jour le brouillon de la messagerie
  }

  async function onInput(ev){
    const el = ev.target, pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    const m = RE_TOKEN.exec(el.value.slice(0, pos));
    if(!m || !inGroup()){ hide(); return; }
    const raw = m[2], q = raw.toLowerCase(), start = pos - raw.length - 1, my = ++seq;
    const all = await members(peer.id);
    if(my !== seq) return;
    const list = all.filter(u => !q || u.pseudo.toLowerCase().startsWith(q) || (u.nom || "").toLowerCase().split(/\s+/).some(w => w.startsWith(q))).slice(0, 6);
    show(el, list, start, pos);
  }

  // Met les @pseudo en couleur dans les bulles. @Ella n'est jamais touchée.
  function paint(ml){
    ml.querySelectorAll(".b > span:not([data-mh])").forEach(s => {
      s.dataset.mh = "1";
      if(s.className) return;
      const h = s.innerHTML;
      if(h.indexOf("@") < 0) return;
      s.innerHTML = h.replace(RE_MENTION, (all, pre, name) => name.toLowerCase() === "ella" ? all : pre + '<span class="mnt" data-mn="' + name + '">@' + name + '</span>');
    });
  }

  function scan(){
    const t = document.getElementById("mt");
    if(t && !t.dataset.mn && inGroup()){
      t.dataset.mn = "1";
      t.addEventListener("input", onInput);
      t.addEventListener("blur", () => setTimeout(hide, 200));
    }
    const ml = document.getElementById("ml");
    if(ml && inGroup()) paint(ml);
    if(!t && box) hide();
  }

  // Toucher une mention ouvre le profil de la personne.
  document.addEventListener("click", async ev => {
    const m = ev.target.closest && ev.target.closest(".mnt");
    if(!m) return;
    ev.stopPropagation();
    const key = m.dataset.mn.toLowerCase();
    let id = known[key];
    if(!id){
      try{
        const r = await rp2("chercher_profils", {p_q:m.dataset.mn});
        const u = (r || []).find(x => (x.pseudo || "").toLowerCase() === key);
        if(u){ id = u.id; known[key] = id; }
      }catch(e){}
    }
    if(id && typeof openUser === "function") openUser(id);
  }, true);

  document.addEventListener("keydown", ev => { if(ev.key === "Escape") hide(); });

  new MutationObserver(() => {
    if(raf) return;
    raf = requestAnimationFrame(() => { raf = 0; try{ scan(); }catch(e){} });
  }).observe(document.body, {childList:true, subtree:true});
})();
