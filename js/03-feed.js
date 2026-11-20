const rpc = (fn, body) => withAuth(t => sb("/rest/v1/rpc/" + fn, {method:"POST", body:JSON.stringify(body || {})}, t));
async function attachOrig(list){
  list = list || [];
  const ids = [...new Set(list.filter(x => x.repost_de).map(x => x.repost_de))];
  if(ids.length){
    try{
      const o = await withAuth(t => sb("/rest/v1/statuts?id=in.(" + ids.join(",") + ")&select=id,auteur,texte,media_url,media_type,medias,profiles!statuts_auteur_fkey(nom,pseudo,niveau,filiere)", {}, t));
      const m = {}; (o || []).forEach(y => { m[y.id] = y; });
      list.forEach(x => { if(x.repost_de) x.original = m[x.repost_de] || null; });
    }catch(e){}
  }
  const cids = [...new Set(list.filter(x => x.repost_club).map(x => x.repost_club))];
  if(cids.length){
    try{
      const o = await rpc("club_posts_par_ids", {p_ids:cids});
      const m = {}; (o || []).forEach(y => { m[y.id] = y; });
      list.forEach(x => { if(x.repost_club) x.clubOrig = m[x.repost_club] || null; });
    }catch(e){}
  }
  return list;
}
let myFollows = new Set(), ftab = null;
async function loadFollows(){
  try{ const r = await withAuth(t => sb("/rest/v1/abonnements?suiveur=eq." + session.id + "&select=suivi", {}, t)); myFollows = new Set((r || []).map(x => x.suivi)); }catch(e){}
  if(!ftab) ftab = store.get("ftab") || (myFollows.size ? "abo" : "dec");
}
const feedFilter = () => { if(pmTag) return "&texte=ilike.*" + encodeURIComponent("#" + pmTag) + "*"; const ids = [session.id, ...myFollows].join(","); return ftab === "abo" ? "&auteur=in.(" + ids + ")" : "&auteur=not.in.(" + ids + ")"; };
const fsegHtml = () => '<div class="wseg" style="margin:6px 0 4px"><button data-ft="dec" class="' + (ftab === "dec" ? "on" : "") + '">Découverte</button><button data-ft="abo" class="' + (ftab === "abo" ? "on" : "") + '">Abonnements</button></div>';
// ----- mentions @ et hashtags # dans les publications et commentaires -----
let pmTag = null, pmBox = null, pmTimer = null;
const PM_MN = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*)/gu;
const PM_HT = /(^|[^\p{L}\p{N}_&\/])#([\p{L}\p{N}_]{2,40})/gu;
(function(){ const st = document.createElement("style"); st.textContent = ".pm-mn,.pm-ht{font-weight:700;cursor:pointer;color:#1f8a52;text-decoration:none}.pm-ht{color:#b07d00}"; document.head.appendChild(st); })();
function pmRich(t){
  return esc(t || "").replace(PM_MN, (m, b, p, off, all) => { const c = /^[ \t]+([\p{L}\p{N}'’-]+)(?:[ \t]+([\p{L}\p{N}'’-]+))?/u.exec(all.slice(off + m.length)); return b + '<a class="pm-mn" data-pmn="' + p + '"' + (c ? ' data-pmc="' + c[1] + (c[2] ? " " + c[2] : "") + '"' : '') + '>@' + p + '</a>'; }).replace(PM_HT, (m, b, h) => b + '<a class="pm-ht" data-pht="' + h + '">#' + h + '</a>');
}
function pmHasTag(t, tag){ return new RegExp("(^|[^\\p{L}\\p{N}_&/])#" + tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}\\p{N}_])", "iu").test(t || ""); }
const pmNorm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
async function pmByName(words){
  const first = encodeURIComponent(words[0].replace(/[%*,()]/g, ""));
  const r = await withAuth(t => sb("/rest/v1/profiles?select=id,nom,pseudo&pseudo=not.is.null&nom=ilike.*" + first + "*&limit=25", {}, t));
  const needle = pmNorm(words.join(" "));
  return (r || []).filter(x => x.pseudo && !blocked.has(x.id) && pmNorm(x.nom).includes(needle));
}
async function pmOpen(pseudo, ctx){
  try{
    const r = await withAuth(t => sb("/rest/v1/profiles?pseudo=ilike." + encodeURIComponent(pseudo) + "&select=id,pseudo&limit=5", {}, t));
    const u = (r || []).find(x => (x.pseudo || "").toLowerCase() === pseudo.toLowerCase());
    if(u) return openUser(u.id);
    const w = [pseudo].concat(String(ctx || "").split(/\s+/).filter(Boolean));
    for(let k = w.length; k >= 2; k--){
      const c = await pmByName(w.slice(0, k));
      if(c.length === 1) return openUser(c[0].id);
      if(c.length > 1){ feedMsg = "Plusieurs étudiants correspondent à « " + w.slice(0, k).join(" ") + " ». Cherche-le avec la loupe."; return render(); }
    }
    feedMsg = "Profil introuvable."; render();
  }catch(e){ feedMsg = "Impossible d’ouvrir ce profil (" + ((e && e.message) || "erreur") + ")."; render(); }
}
// À l'envoi : un « @Marc Williams » écrit à la main devient « @pseudo » quand un seul étudiant correspond.
async function pmResolve(texte){
  if(!texte || texte.indexOf("@") < 0) return texte;
  try{
    const re = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*)((?:[ \t]+[\p{L}\p{N}'’-]+){0,2})/gu, found = [];
    let m;
    while((m = re.exec(texte))) found.push({at:m.index + m[1].length, token:m[2], raw:m[3] || "", tail:(m[3] || "").trim().split(/\s+/).filter(Boolean)});
    let out = texte;
    for(const f of found.reverse()){
      const rr = await withAuth(t => sb("/rest/v1/profiles?pseudo=ilike." + encodeURIComponent(f.token) + "&select=id,pseudo&limit=5", {}, t));
      if((rr || []).some(x => (x.pseudo || "").toLowerCase() === f.token.toLowerCase())) continue;
      const w = [f.token].concat(f.tail);
      for(let k = w.length; k >= 2; k--){
        const c = await pmByName(w.slice(0, k));
        if(c.length === 1){
          let len = 1 + f.token.length, rest = f.raw;
          for(const word of w.slice(1, k)){ const i = rest.indexOf(word) + word.length; len += i; rest = rest.slice(i); }
          out = out.slice(0, f.at) + "@" + c[0].pseudo + out.slice(f.at + len);
          break;
        }
        if(c.length > 1) break;
      }
    }
    return out;
  }catch(e){ return texte; }
}
function pmBind(root){
  (root || document).querySelectorAll("[data-pmn]").forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); pmOpen(a.dataset.pmn, a.dataset.pmc); });
  (root || document).querySelectorAll("[data-pht]").forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); pmTag = a.dataset.pht.toLowerCase(); solo = null; tab = "feed"; loadPosts(); render(); });
}
function pmClose(){ if(pmBox){ pmBox.remove(); pmBox = null; } }
function pmAttach(inp, onChange){
  if(!inp) return;
  inp.addEventListener("input", () => {
    const pos = inp.selectionStart, m = /(?:^|\s)@([\p{L}\p{N}_.]{1,30})$/u.exec(inp.value.slice(0, pos));
    clearTimeout(pmTimer);
    if(!m){ pmClose(); return; }
    pmTimer = setTimeout(() => pmSearch(inp, m[1], pos, onChange), 150);
  });
  inp.addEventListener("blur", () => setTimeout(pmClose, 300));
}
async function pmSearch(inp, q, pos, onChange){
  if(!inp.isConnected) return;
  let r = [], err = "";
  try{ r = await withAuth(t => sb("/rest/v1/profiles?select=id,nom,pseudo&pseudo=not.is.null&or=(pseudo.ilike.*" + encodeURIComponent(q) + "*,nom.ilike.*" + encodeURIComponent(q) + "*)&limit=6", {}, t)); }catch(e){ err = (e && e.message) || "erreur"; }
  if(!inp.isConnected) return;
  r = (r || []).filter(x => x.pseudo && !blocked.has(x.id));
  pmClose();
  const b = inp.getBoundingClientRect(), box = document.createElement("div"), up = b.top > window.innerHeight / 2;
  box.style.cssText = "position:fixed;z-index:99999;left:" + Math.max(6, b.left) + "px;width:" + Math.min(Math.max(b.width, 240), window.innerWidth - 12) + "px;" + (up ? "bottom:" + (window.innerHeight - b.top + 4) : "top:" + (b.bottom + 4)) + "px;max-height:40vh;overflow:auto;background:#fff;color:#111;border:1px solid #ccc;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.25)";
  box.innerHTML = r.length ? r.map(x => '<div data-pp="' + esc(x.pseudo) + '" style="padding:10px 12px;border-bottom:1px solid #eee;cursor:pointer"><b>' + esc(x.nom || x.pseudo) + '</b> <span style="color:#666">@' + esc(x.pseudo) + '</span></div>').join("") : '<div style="padding:10px 12px;color:#666">' + (err ? "Recherche impossible : " + esc(err) : "Aucun étudiant trouvé") + '</div>';
  document.body.appendChild(box); pmBox = box;
  box.querySelectorAll("[data-pp]").forEach(d => d.addEventListener("pointerdown", e => {
    e.preventDefault();
    const v = inp.value, start = pos - q.length - 1, ins = "@" + d.dataset.pp + " ";
    inp.value = v.slice(0, start) + ins + v.slice(pos);
    inp.selectionStart = inp.selectionEnd = start + ins.length;
    if(onChange) onChange(inp.value);
    pmClose(); inp.focus();
  }));
}
async function loadPosts(){
  validerPartage();
  await loadFollows();
  if(clubShared){ const cid = clubShared; clubShared = null; openClub(cid); return; }
  if(groupShared){ const gc = groupShared; groupShared = null; try{ history.replaceState(null, "", location.pathname); }catch(e){} joinGroupFlow(gc); }
  if(DEMO || !session) return;
  loadStories();
  try{
    try{ posts = await withAuth(t => sb("/rest/v1/statuts?select=*,profiles!statuts_auteur_fkey(nom,pseudo,niveau,filiere),likes(membre),commentaires(count)&order=created_at.desc&limit=50" + feedFilter(), {}, t)); }
    catch(e){ posts = await withAuth(t => sb("/rest/v1/statuts?select=*,profiles!statuts_auteur_fkey(nom,pseudo)&order=created_at.desc&limit=50" + feedFilter(), {}, t)); }
    if(pmTag) posts = (posts || []).filter(x => pmHasTag(x.texte, pmTag));
    await attachOrig(posts);
    feedMsg = "";
    const pin = solo || sharedId;
    if(pin){
      let one = posts.find(x => x.id === pin);
      if(!one){ try{ const r1 = await withAuth(t => sb("/rest/v1/statuts?id=eq." + pin + "&select=*,profiles!statuts_auteur_fkey(nom,pseudo,niveau,filiere),likes(membre),commentaires(count)", {}, t)); one = r1 && r1[0]; if(one) await attachOrig([one]); }catch(e){} }
      if(solo) posts = one ? [one] : []; else if(one) posts = [one, ...posts.filter(x => x.id !== pin)];
    }
  }catch(e){ feedMsg = "Impossible de charger le fil : " + e.message; }
  soloBusy = false;
  render();
}
function ago(t){
  const s = (Date.now() - new Date(t)) / 1000;
  if(s < 60) return "à l’instant";
  if(s < 3600) return Math.floor(s / 60) + " min";
  if(s < 86400) return Math.floor(s / 3600) + " h";
  return new Date(t).toLocaleDateString("fr-FR");
}
// ----- publication instantanée : le post s'affiche tout de suite, l'envoi se fait en arrière-plan -----
let pendingPosts = [];
function pendHtml(){
  const nm = esc((profile && (profile.nom || profile.pseudo)) || "Toi");
  return pendingPosts.map(p => '<div class="card post"><div class="ph">' + avh(session.id, (profile && (profile.nom || profile.pseudo)) || "Toi", "s") + '<div><b>' + nm + '</b><div class="pt">Envoi en cours…</div></div></div>' +
    (p.texte ? '<p>' + esc(p.texte) + '</p>' : '') +
    (p.previews.length > 1 ? '<div class="pg">' + p.previews.map(u => '<img src="' + esc(u) + '" alt="">').join("") + '</div>' : p.previews.length ? (p.isVideo ? '<video src="' + esc(p.previews[0]) + '" preload="metadata" muted playsinline></video>' : '<img src="' + esc(p.previews[0]) + '" alt="">') : '') + '</div>').join("");
}
async function publish(){
  let texte = draft.trim();
  if(!texte && !pfiles.length){ feedMsg = "Écris quelque chose ou ajoute un média."; return render(); }
  texte = await pmResolve(texte);
  const files = pfiles.slice();
  const item = {texte, previews: files.map(f => URL.createObjectURL(f)), isVideo: !!files.length && (files[0].type || "").startsWith("video")};
  pendingPosts.unshift(item);
  draft = ""; file = null; pfiles = []; feedMsg = ""; tab = "feed"; pmTag = null; render();
  const fin = () => { pendingPosts = pendingPosts.filter(p => p !== item); item.previews.forEach(u => { try{ URL.revokeObjectURL(u); }catch(e){} }); };
  try{
    const res = await withAuth(async t => {
      const ups = await Promise.all(files.map(async f0 => {
        const f = await shrink(f0);
        const ext = (f.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const path = session.id + "/" + crypto.randomUUID() + "." + ext;
        const r = await fetch(SUPABASE_URL + "/storage/v1/object/medias/" + path, {method:"POST", headers:{apikey:SUPABASE_KEY, Authorization:"Bearer " + t, "Content-Type":f.type || "application/octet-stream"}, body:f});
        if(!r.ok){ let d = null; try{ d = await r.json(); }catch(e){} throw new Error((d && (d.message || d.error)) || "Envoi du média impossible"); }
        return {url:SUPABASE_URL + "/storage/v1/object/public/medias/" + path, type:(f.type || "").startsWith("video") ? "video" : "image"};
      }));
      const urls = ups.map(u => u.url), media_type = ups.length ? ups[0].type : null;
      const body = {auteur:session.id, texte, media_url:urls[0] || null, media_type};
      if(urls.length > 1) body.medias = urls;
      return await sb("/rest/v1/statuts", {method:"POST", headers:{Prefer:"return=representation"}, body:JSON.stringify(body)}, t);
    });
    const row = res && res[0];
    if(row){
      const pf = profile || {};
      row.profiles = {nom:pf.nom, pseudo:pf.pseudo, niveau:pf.niveau, filiere:pf.filiere};
      row.likes = []; row.commentaires = [{count:0}];
      if(ftab !== "abo"){ ftab = "abo"; store.set("ftab", ftab); posts = []; }
      posts = [row, ...posts.filter(x => x.id !== row.id)];
      fin(); render();
      loadPosts();
    }else{ await loadPosts(); fin(); render(); }
  }catch(e){
    fin(); draft = texte; pfiles = files; feedMsg = "Publication non envoyée (" + e.message + "). Ton texte est conservé dans « Nouvelle publication ».";
    render();
  }
}
function renderFeed(demo){
  if(DEMO){ app.innerHTML = demo + '<div class="card"><h2>Fil de statuts</h2><p class="s">Connecte Supabase pour utiliser le fil.</p><button class="t" id="pf">Mon profil</button></div>'; $("#pf").onclick = () => { tab = "profile"; render(); }; return; }
  const items = posts.filter(x => !blocked.has(x.auteur) && !(x.repost_de && (!x.original || blocked.has(x.original.auteur))) && !(x.repost_club && !x.clubOrig)).map(x => {
    const co = x.clubOrig, src = x.original || (co ? {id:co.id, auteur:null, texte:co.texte, media_url:co.media_url, media_type:co.media_type, medias:co.medias, profiles:{nom:co.club_nom}, isClub:true, club:co.club, club_photo:co.club_photo} : x), a = src.profiles || {}, rp = x.profiles || {}, mine = x.auteur === session.id, ini = (a.nom || a.pseudo || "?").charAt(0).toUpperCase(), ls = x.likes || [], liked = ls.some(l => l.membre === session.id), nl = ls.length, nc = fopen === x.id ? fcoms.length : (x.commentaires && x.commentaires[0] ? x.commentaires[0].count : 0);
    return '<div class="card post' + (x.id === sharedId ? ' shared' : '') + '">' + ((x.repost_de || x.repost_club) ? '<div class="pt" style="margin-bottom:8px">' + REPOST_SVG + '<b>' + (mine ? "Tu as" : esc(rp.nom || rp.pseudo || "Un étudiant") + " a") + ' republié</b></div>' : '') + '<div class="ph">' + (src.isClub ? clubAv(src.club_photo, a.nom, "s") : avh(src.auteur, a.nom || a.pseudo, "s")) + '<div><b class="un" ' + (src.isClub ? 'data-co="' + src.club + '"' : 'data-u="' + src.auteur + '"') + '>' + esc(a.nom || "Étudiant") + (src.isClub ? "" : badge(src.auteur)) + '</b><div class="pt">' + esc(src.isClub ? "Club" : ([a.niveau, a.filiere].filter(Boolean).join(" · ") || "@" + (a.pseudo || ""))) + ' · ' + ago(x.created_at) + '</div></div></div>' +
      (src.texte ? '<p>' + pmRich(src.texte) + '</p>' : '') +
      (src.medias && src.medias.length > 1 ? '<div class="pg">' + src.medias.map(u => '<img src="' + esc(u) + '" alt="">').join("") + '</div>' : src.media_url ? (src.media_type === "video" ? '<video preload="metadata" src="' + esc(src.media_url) + '" controls playsinline></video>' : '<img src="' + esc(src.media_url) + '" alt="">') : '') +
      '<div class="ac ai"><button class="t' + (liked ? " lk" : "") + '" data-l="' + x.id + '" aria-label="J’aime" title="J’aime">' + pico(PIC.heart, liked) + (nl ? '<span>' + nl + '</span>' : '') + '</button><button class="t" data-fc="' + x.id + '" aria-label="Commentaires" title="Commentaires">' + pico(PIC.comment) + (nc ? '<span>' + nc + '</span>' : '') + '</button><button class="t" data-sh="' + x.id + '" aria-label="Partager" title="Partager">' + pico(PIC.share) + '</button>' + (src.isClub ? '<button class="t" data-rbc="' + x.repost_club + '" aria-label="Republier" title="Republier">' + pico(PIC.repost) + '</button>' : src.auteur !== session.id ? '<button class="t" data-rb="' + (x.repost_de || x.id) + '" aria-label="Republier" title="Republier">' + pico(PIC.repost) + '</button>' : '') + (mine ? ((x.repost_de || x.repost_club) ? '' : '<button class="t" data-e="' + x.id + '" aria-label="Modifier" title="Modifier">' + pico(PIC.edit) + '</button>') + '<button class="t" data-d="' + x.id + '" aria-label="Supprimer" title="Supprimer">' + pico(PIC.trash) + '</button>' : '<button class="t" data-rp="publication:' + x.id + '" aria-label="Signaler" title="Signaler">' + pico(PIC.flag) + '</button>') + '</div>' + (fopen === x.id ? fcomHtml(x) : '') + '</div>';
  }).join("");
  app.innerHTML = (solo ? '<div class="nav"><button class="t" id="sob">← Retour</button></div>' : pmTag ? '<div class="nav"><button class="t" id="htb">← Retour</button><b style="margin-left:8px">#' + esc(pmTag) + '</b></div>' : storiesHtml() + brainCard() + fsegHtml()) + (feedMsg ? '<div class="msg">' + esc(feedMsg) + '</div>' : '') +
    (solo ? "" : pendHtml()) + (items || (solo ? '<p class="pt c">' + (soloBusy ? "Chargement…" : "Publication introuvable (supprimée ?).") + '</p>' : '<p class="pt c">' + (pmTag ? "Aucune publication avec ce hashtag." : ftab === "abo" ? "Tu ne vois pas encore de publications ici. Abonne-toi à des étudiants depuis l’onglet Découverte." : "Aucune nouvelle publication à découvrir pour l’instant. Reviens bientôt !") + '</p>'));
  document.querySelectorAll("[data-u]").forEach(b => b.onclick = () => openUser(b.dataset.u));
  document.querySelectorAll("[data-co]").forEach(b => b.onclick = () => openClub(b.dataset.co));
  document.querySelectorAll("[data-rbc]").forEach(b => b.onclick = async () => { b.disabled = true; await repostClub(b.dataset.rbc); });
  if(!solo) bindStories();
  pmBind(app);
  const htb = $("#htb"); if(htb) htb.onclick = () => { pmTag = null; loadPosts(); render(); };
  document.querySelectorAll("[data-ft]").forEach(b => b.onclick = () => { ftab = b.dataset.ft; store.set("ftab", ftab); loadPosts(); render(); });
  const bcd = $("#brc"); if(bcd) bcd.onclick = () => go("brain");
  const sob = $("#sob"); if(sob) sob.onclick = () => { solo = null; if(soloBack && soloBack.t === "user"){ tab = "profile"; openUser(soloBack.id); } else go("profile"); };
  document.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { const x = posts.find(y => y.id === b.dataset.l), liked = (x.likes || []).some(l => l.membre === session.id); fdo(t => liked ? sb("/rest/v1/likes?statut=eq." + x.id + "&membre=eq." + session.id, {method:"DELETE", headers:{Prefer:"return=minimal"}}, t) : sb("/rest/v1/likes", {method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify({statut:x.id})}, t), loadPosts); });
  document.querySelectorAll("[data-fc]").forEach(b => b.onclick = () => { noterActivite(); if(fopen === b.dataset.fc){ fopen = null; render(); } else { fopen = b.dataset.fc; fcoms = []; fcd = ""; render(); loadFcoms(); } });
  document.querySelectorAll("[data-rb]").forEach(b => b.onclick = async () => {
    b.disabled = true; let m = "";
    try{ await withAuth(t => sb("/rest/v1/statuts", {method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify({repost_de:b.dataset.rb})}, t)); m = "Publication republiée ✓"; }
    catch(e){ m = /duplicate|23505|unique/i.test(e.message) ? "Tu as déjà republié cette publication." : /propre/i.test(e.message) ? "Tu ne peux pas republier ta propre publication." : "Impossible de republier : " + e.message; }
    await loadPosts(); feedMsg = m; render(); setTimeout(() => { if(feedMsg === m){ feedMsg = ""; render(); } }, 3000);
  });
  document.querySelectorAll("[data-sh]").forEach(b => b.onclick = async () => {
    const x = posts.find(y => y.id === b.dataset.sh); if(!x) return;
    const rc = await rpc("partage_creer", {p_type:"publication", p_cible:x.id}).catch(() => null), url = location.origin + location.pathname + "#p=" + x.id + (rc ? "&r=" + rc : "");
    const txt = ((x.texte || "").slice(0, 100) + ((x.texte || "").length > 100 ? "…" : "")).trim();
    const text = (txt ? "« " + txt + " » " : "") + "Une publication sur ALapp";
    if(navigator.share){ try{ await navigator.share({title:"ALapp", text, url}); return; }catch(e){ if(e && e.name === "AbortError") return; } }
    try{ await navigator.clipboard.writeText(url); feedMsg = "Lien copié ✓"; }catch(e){ feedMsg = "Copie ce lien : " + url; }
    render(); setTimeout(() => { if(feedMsg.startsWith("Lien copié")){ feedMsg = ""; render(); } }, 2500);
  });
  const fci = $("#fci"); if(fci){ fci.oninput = e => { fcd = e.target.value; }; pmAttach(fci, v => { fcd = v; }); }
  const fall = async () => { await loadFcoms(); await loadPosts(); };
  document.querySelectorAll("[data-fcs]").forEach(b => b.onclick = async () => { let texte = fcd.trim(); if(!texte) return; fcd = ""; texte = await pmResolve(texte); fdo(t => sb("/rest/v1/commentaires", {method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify({statut:b.dataset.fcs, texte})}, t), fall); });
  document.querySelectorAll("[data-fe]").forEach(b => b.onclick = async () => { const c = fcoms.find(y => y.id === b.dataset.fe), n = prompt("Modifier le commentaire", c.texte); if(n === null || !n.trim()) return; const nt = await pmResolve(n.trim()); fdo(t => sb("/rest/v1/commentaires?id=eq." + c.id, {method:"PATCH", headers:{Prefer:"return=minimal"}, body:JSON.stringify({texte:nt, modifie:true})}, t), fall); });
  document.querySelectorAll("[data-fd]").forEach(b => b.onclick = () => { if(confirm("Supprimer ce commentaire ?")) fdo(t => sb("/rest/v1/commentaires?id=eq." + b.dataset.fd, {method:"DELETE", headers:{Prefer:"return=minimal"}}, t), fall); });
  document.querySelectorAll("[data-e]").forEach(b => b.onclick = async () => {
    const x = posts.find(y => y.id === b.dataset.e); const n = prompt("Modifier le statut", x.texte || ""); if(n === null) return;
    try{ const nt = await pmResolve(n.trim()); await withAuth(t => sb("/rest/v1/statuts?id=eq." + x.id, {method:"PATCH", headers:{Prefer:"return=minimal"}, body:JSON.stringify({texte:nt})}, t)); await loadPosts(); }catch(e){ feedMsg = e.message; render(); }
  });
  document.querySelectorAll("[data-d]").forEach(b => b.onclick = async () => {
    if(!confirm("Supprimer ce statut ?")) return;
    try{ await withAuth(t => sb("/rest/v1/statuts?id=eq." + b.dataset.d, {method:"DELETE", headers:{Prefer:"return=minimal"}}, t)); await loadPosts(); }catch(e){ feedMsg = e.message; render(); }
  });
}

