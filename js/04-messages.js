// ----- fichiers en messagerie : envoyés en qualité d'origine (jamais compressés) -----
const MSG_MAX = 50 * 1024 * 1024;
const MSG_ACCEPT = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";
const MSG_MIME = {pdf:"application/pdf", doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls:"application/vnd.ms-excel", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt:"application/vnd.ms-powerpoint", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation", txt:"text/plain", csv:"text/csv", zip:"application/zip", mp3:"audio/mpeg", m4a:"audio/mp4", aac:"audio/aac", wav:"audio/wav", ogg:"audio/ogg", opus:"audio/ogg"};
function msgMime(f){ const e = ((f.name || "").split(".").pop() || "").toLowerCase(); return f.type || MSG_MIME[e] || "application/octet-stream"; }
function msgKind(f){ const t = msgMime(f); return t.startsWith("image/") ? "image" : t.startsWith("video/") ? "video" : t.startsWith("audio/") ? "audio" : "fichier"; }
function msgPath(f){
  const ext = ((f.name || "").split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const base = (f.name || "").replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "fichier";
  return session.id + "/" + crypto.randomUUID() + "__" + base + "." + ext;
}
function msgFileName(u){ const b = String(u || "").split("?")[0].split("/").pop() || "", i = b.indexOf("__"); return i >= 0 ? b.slice(i + 2) : "Document"; }
const msgPreview = t => t === "video" ? "🎥 Vidéo" : t === "audio" ? "🎵 Audio" : t === "fichier" ? "📎 Document" : "📷 Photo";
function msgMediaHtml(x){
  if(!x.media_url) return "";
  const u = esc(localBlob[x.media_url] || x.mu || x.media_url);
  if(x.media_type === "video") return '<video preload="metadata" src="' + u + '" controls playsinline></video>';
  if(x.media_type === "audio") return '<audio src="' + u + '" controls preload="metadata" style="display:block;width:240px;max-width:100%;margin-top:4px"></audio>';
  if(x.media_type === "fichier") return '<a class="fl" href="' + u + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">📎 ' + esc(msgFileName(x.media_url)) + '</a>';
  return '<img src="' + u + '" alt="">';
}

// ----- envoi instantané : la bulle s'affiche tout de suite et le média est lisible aussitôt (fichier local) -----
const localBlob = {};
let pendingMsgs = [], pendSeq = 0;
const pendList = () => pendingMsgs.filter(p => peer && p.peerId === peer.id);
function pendKey(){ return pendList().map(p => p.id).join(","); }
function pendMsgHtml(){
  return pendList().map(p => {
    const u = esc(p.url || "");
    const media = p.kind === "video" ? '<video src="' + u + '" controls playsinline preload="auto"></video>'
      : p.kind === "audio" ? '<audio src="' + u + '" controls preload="auto" style="display:block;width:240px;max-width:100%;margin-top:4px"></audio>'
      : p.kind === "fichier" ? '<span class="fl" style="color:inherit">📎 ' + esc(p.name) + '</span>'
      : p.kind === "image" ? '<img src="' + u + '" alt="">' : "";
    return '<div class="b me">' + (p.texte ? '<span>' + esc(p.texte) + '</span>' : '') + media + '<small>Envoi…</small></div>';
  }).join("");
}

const EMO = ["😀","😂","🥰","😍","😎","🤔","😭","😡","👍","👏","🙏","🔥","💯","🎉","❤️","💪","📚","🎓"];
const clean = q => q.replace(/[,()*%\\]/g, "").trim();
const other = x => x.expediteur === session.id ? x.destinataire : x.expediteur;
const visible = x => {
  if(x.expire_at && new Date(x.expire_at) < Date.now()) return false;
  const p = prefs[other(x)];
  return !(p && p.masque_avant && new Date(x.created_at) <= new Date(p.masque_avant));
};
async function setPref(pid, patch){
  const cur = prefs[pid] || {};
  try{ await withAuth(t => sb("/rest/v1/conv_prefs", {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify({user_id:session.id, peer:pid, ...patch})}, t)); prefs[pid] = {...cur, ...patch}; msgMsg = ""; }
  catch(e){ msgMsg = e.message; }
  await loadConvs();
}
function sheet(c){
  const pid = c.peer.id, pinned = !!(prefs[pid] && prefs[pid].epingle);
  const d = document.createElement("div"); d.className = "sheet";
  d.innerHTML = '<div class="sc"><b>' + esc(c.peer.nom || "Étudiant") + '</b><button id="sp">' + (pinned ? "📌 Désépingler" : "📌 Épingler") + '</button><button class="dg" id="sd">🗑 Supprimer la conversation</button><button class="t" id="sx">Annuler</button></div>';
  document.body.appendChild(d);
  const close = () => d.remove();
  d.onclick = e => { if(e.target === d) close(); };
  d.querySelector("#sx").onclick = close;
  d.querySelector("#sp").onclick = async () => { close(); await setPref(pid, {epingle: !pinned}); };
  d.querySelector("#sd").onclick = async () => { close(); if(!confirm("Supprimer cette conversation pour toi ? Elle réapparaîtra si l’autre étudiant t’écrit.")) return; await setPref(pid, {masque_avant:new Date().toISOString()}); };
}
const decided = () => !chatLoaded || !!eph || msgs.length > 0;
const lu = id => (prefs[id] && prefs[id].lu_le) ? new Date(prefs[id].lu_le) : new Date(0);
async function markRead(pid){
  prefs[pid] = {...(prefs[pid] || {}), lu_le:new Date().toISOString()};
  try{ await withAuth(t => sb("/rest/v1/conv_prefs", {method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify({user_id:session.id, peer:pid, lu_le:prefs[pid].lu_le})}, t)); }catch(e){}
}
let invits = [];
async function loadInvits(){
  if(!session) return;
  try{
    const r = await withAuth(t => sb("/rest/v1/evenement_participants?membre=eq." + session.id + "&select=evenement,evenements(id,titre,lieu,date_debut,auteur,gratuit,profiles!evenements_auteur_fkey(nom,pseudo))", {}, t));
    const lim = Date.now() - 864e5;
    invits = (r || []).map(x => x.evenements).filter(e => e && e.gratuit !== false && new Date(e.date_debut).getTime() >= lim).map(e => ({...e, org:e.profiles})).sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut));
  }catch(e){ invits = []; }
  if(tab === "msg" && !peer && !dmnew && !gcreate) render();
}
function invHtml(){
  if(!invits.length) return '<div class="empty">Aucune invitation pour l’instant. Quand tu appuies sur « Je participe » pour un événement gratuit, ton invitation arrive ici.</div>';
  return invits.map(v => { const d = new Date(v.date_debut), o = v.org || {};
    return '<div class="tkt"><div class="tkd"><b>' + d.getDate() + '</b><small>' + d.toLocaleDateString("fr-FR", {month:"short"}).replace(".", "").toUpperCase() + '</small></div><div class="tkm"><span class="tkh">' + ico20(PIC.ticket) + 'Invitation</span><b>' + esc(v.titre) + '</b><small>' + d.toLocaleDateString("fr-FR", {weekday:"long", day:"numeric", month:"long"}) + (v.lieu ? " · " + esc(v.lieu) : "") + '</small><small>Organisé par ' + esc(o.nom || o.pseudo || "un étudiant") + '</small><div class="tkb"><button class="sm" data-iv="' + v.id + '">Voir</button><button class="sm g" data-ic="' + v.id + '">Annuler</button></div></div></div>'; }).join("");
}
async function loadConvs(){
  loadInvits();
  try{
    const [rows0, pr, er, gs] = await Promise.all([withAuth(t => sb("/rest/v1/messages?select=*&order=created_at.desc&limit=300", {}, t)), withAuth(t => sb("/rest/v1/conv_prefs?select=*", {}, t)), withAuth(t => sb("/rest/v1/eph?select=*", {}, t)), withAuth(t => sb("/rest/v1/groupes_vue?select=*", {}, t)).catch(() => [])]);
    prefs = {}; pr.forEach(x => { prefs[x.peer] = x; });
    ephAll = {}; er.forEach(x => { ephAll[x.a === session.id ? x.b : x.a] = x; });
    const rows = rows0.filter(visible);
    withAuth(t => sb("/rest/v1/messages?expediteur=eq." + session.id + "&expire_at=lt." + new Date().toISOString(), {method:"DELETE", headers:{Prefer:"return=minimal"}}, t)).catch(() => {});
    const last = {}; rows.forEach(x => { const o = other(x); if(!last[o]) last[o] = x; });
    const ids = Object.keys(last).filter(id => !blocked.has(id)); let ps = [];
    if(ids.length) ps = await withAuth(t => sb("/rest/v1/profiles?select=id,nom,pseudo&id=in.(" + ids.join(",") + ")", {}, t));
    convs = ids.map(id => ({peer: ps.find(p => p.id === id) || {id, nom:"Étudiant", pseudo:""}, last:last[id], unread: rows.filter(x => x.expediteur === id && x.destinataire === session.id && new Date(x.created_at) > lu(id)).length}));
    gs.forEach(g => {
      const pf = prefs[g.id];
      if(pf && pf.masque_avant && g.dernier_at && new Date(g.dernier_at) <= new Date(pf.masque_avant)) return;
      convs.push({unread:g.non_lus || 0, peer:{id:g.id, nom:g.nom, pseudo:"", grp:true, anonyme:g.anonyme, nb:g.nb, photo:g.photo_url, admin:g.est_admin}, last:{expediteur:g.dernier_moi ? session.id : "x", texte:g.dernier_at ? g.dernier_texte : "Groupe créé", media_type:g.dernier_media_type, supprime:g.dernier_supprime, created_at:g.dernier_at || g.created_at}});
    });
    convs.sort((a, b) => ((prefs[b.peer.id] && prefs[b.peer.id].epingle) ? 1 : 0) - ((prefs[a.peer.id] && prefs[a.peer.id].epingle) ? 1 : 0) || new Date(b.last.created_at) - new Date(a.last.created_at));
    msgMsg = "";
  }catch(e){ msgMsg = e.message; }
  if(tab === "msg" && !peer) render();
  else if(tab === "msg" && peer && isDesk() && !gcreate && !dmnew && !gadd) repaintListDesk();
}
async function searchUsers(q){
  q = clean(q);
  if(q.length < 2) sres = [];
  else{ try{ const e = encodeURIComponent(q); sres = await rp2("chercher_profils", {p_q:q}).then(r => (r || []).slice(0, 8)).then(r => r.filter(u => !blocked.has(u.id))); }catch(err){ sres = []; } }
  const el = $("#sr"); if(!el) return;
  el.innerHTML = sres.map((u, i) => '<div class="cv" data-p="' + i + '"><div class="av s">' + esc((u.nom || u.pseudo || "?").charAt(0).toUpperCase()) + '</div><div><b>' + esc(u.nom) + '</b><div class="pt">@' + esc(u.pseudo) + '</div></div></div>').join("");
  el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => openChat(sres[b.dataset.p]));
}
function openChat(p){
  if(isDesk() && peer && peer.id !== p.id){ purge(); markRead(peer.id); }
  peer = p; dmnew = false; mtab = "dm"; markRead(p.id); msgs = []; mdraft = ""; msgReply = null; msgEdit = null; mfile = null; msgMsg = ""; dk = ""; eph = ephAll[p.id] || null; sel = null; chatLoaded = false;
  render(); loadChat();
  clearInterval(poll); poll = setInterval(() => { if(tab === "msg" && peer) loadChat(); }, 4000);
  clearInterval(tpoll); tpoll = setInterval(checkTyping, 2000);
}
async function loadChat(){
  if(!peer) return;
  if(peer.grp) return loadGChat();
  const me = session.id, o = peer.id, a = me < o ? me : o, b = me < o ? o : me;
  try{
    const [m, e] = await Promise.all([
      withAuth(t => sb("/rest/v1/messages?select=*&or=(and(expediteur.eq." + me + ",destinataire.eq." + o + "),and(expediteur.eq." + o + ",destinataire.eq." + me + "))&order=created_at.asc&limit=200", {}, t)),
      withAuth(t => sb("/rest/v1/eph?select=*&a=eq." + a + "&b=eq." + b, {}, t))
    ]);
    const was = !!(eph && eph.actif), wd = decided();
    msgs = m.filter(visible); eph = e[0] || null; chatLoaded = true;
    await signMsgs(msgs);
    if(!document.hidden && msgs.some(x => x.destinataire === me && !x.lu_at)) rp2("marquer_lus", {p_autre:o}).catch(() => {});
    if(was !== !!(eph && eph.actif) || wd !== decided()){ render(); return; }
  }catch(err){ return; }
  drawMsgs();
}
async function patchMsg(id, patch){
  try{ await withAuth(t => sb("/rest/v1/messages?id=eq." + id, {method:"PATCH", headers:{Prefer:"return=minimal"}, body:JSON.stringify(patch)}, t)); await loadChat(); }
  catch(e){ msgMsg = e.message; render(); }
}
async function purge(ka){
  if(!peer || !eph || !eph.actif || !session) return;
  const ids = msgs.filter(x => x.destinataire === session.id).map(x => x.id);
  if(!ids.length) return;
  try{ await withAuth(t => sb("/rest/v1/messages?id=in.(" + ids.join(",") + ")", {method:"DELETE", keepalive:!!ka, headers:{Prefer:"return=minimal"}}, t)); msgs = msgs.filter(x => !ids.includes(x.id)); dk = ""; }catch(e){}
}
document.addEventListener("visibilitychange", () => { if(document.hidden) purge(true); });
async function chooseMode(on){
  const me = session.id, o = peer.id, a = me < o ? me : o, b = me < o ? o : me;
  try{ await withAuth(t => sb("/rest/v1/eph", {method:"POST", headers:{Prefer:"resolution=ignore-duplicates,return=minimal"}, body:JSON.stringify({a, b, actif:on, par:me, depuis:new Date().toISOString()})}, t)); msgMsg = ""; }
  catch(e){ msgMsg = e.message; }
  await loadChat(); render();
}
const sigCache = {};
async function signMsgs(list){
  await Promise.all(list.filter(x => x.media_url && x.media_url.startsWith("prive/")).map(async x => {
    const pth = x.media_url.slice(6), c = sigCache[pth];
    if(c && c.exp > Date.now()){ x.mu = c.url; return; }
    try{
      const r = await withAuth(t => sb("/storage/v1/object/sign/prive/" + pth, {method:"POST", body:JSON.stringify({expiresIn:21600})}, t));
      const u = SUPABASE_URL + "/storage/v1" + r.signedURL;
      sigCache[pth] = {url:u, exp:Date.now() + 5 * 3600 * 1000}; x.mu = u;
    }catch(e){}
  }));
}

let lastTyp = 0, tpoll = null, typingFrom = new Set(), lcount = 0;
const EYE_O = '<svg class="ey r" viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_C = '<svg class="ey" viewBox="0 0 24 24"><path d="M2 9c3 4.5 7 6.5 10 6.5S19 13.500 22 9"/><path d="M12 16v3M6.500 14l-2 2.500M17.500 14l2 2.500"/></svg>';
function prevHtml(c){
  if(!c.peer.grp && typingFrom.has(c.peer.id)) return '<span class="wr">En train d’écrire<i class="dt"><b></b><b></b><b></b></i></span>';
  const mine = c.last.expediteur === session.id;
  const txt = esc(c.last.supprime ? "🚫 Message supprimé" : c.last.texte || msgPreview(c.last.media_type));
  const eye = mine && !c.peer.grp && !c.last.supprime ? (c.last.lu_at ? EYE_O : EYE_C) + " " : "";
  return mine ? eye + "Toi : " + txt : (c.unread ? '<b class="nw">Nouveau · </b>' : "") + txt;
}
function paintList(){
  document.querySelectorAll(".mr2[data-c]").forEach(r => { const c = convs[r.dataset.c], m = r.querySelector(".mp"); if(c && m) m.innerHTML = prevHtml(c); });
}
async function pollList(){
  if(!session || tab !== "msg" || (peer && !isDesk()) || gcreate || dmnew || gadd) return;
  try{
    const r = await rp2("ecrivent"), n = new Set(r || []);
    if(n.size !== typingFrom.size || [...n].some(i => !typingFrom.has(i))){ typingFrom = n; paintList(); }
  }catch(e){}
  lcount++;
  if(lcount % 3 === 0 && !(document.activeElement && document.activeElement.tagName === "INPUT")) loadConvs();
}
function rp2(n, a){ return withAuth(t => sb("/rest/v1/rpc/" + n, {method:"POST", body:JSON.stringify(a || {})}, t)); }
async function checkTyping(){
  if(!peer || peer.grp || tab !== "msg") return;
  try{ const r = await rp2("ecrit_maintenant", {p_de:peer.id}), el = $("#tp"); if(el){ const h = r ? '<span class="wr">' + esc(peer.nom || "Il/elle") + ' est en train d’écrire<i class="dt"><b></b><b></b><b></b></i></span>' : ""; if(el.dataset.h !== h){ el.dataset.h = h; el.innerHTML = h; } } }catch(e){}
}
async function saveEph(id){
  const x = msgs.find(y => y.id === id); if(!x) return;
  try{ await rp2("enregistrer_photo", {p_msg:id}); }catch(e){ msgMsg = e.message; return render(); }
  try{ const r = await fetch(x.mu || x.media_url), bl = await r.blob(), a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = "alapp-" + id.slice(0, 8) + ".jpg"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  catch(e){ window.open(x.mu || x.media_url, "_blank"); }
  await loadChat();
}

// ===== Mises à jour messagerie : réponse à un message, menu du message (appui long), mode éphémère modifiable =====
let msgReply = null, msgEdit = null;
(function(){
  const s = document.createElement("style");
  s.textContent = [
    ".ml .b[data-b]{touch-action:manipulation;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}",
    ".qr{border-left:3px solid currentColor;background:rgba(127,127,127,.16);border-radius:8px;padding:4px 8px;margin:0 0 6px;font-size:.85em;cursor:pointer;text-align:left}",
    ".qr b{display:block;font-size:.9em}",
    ".qr span{display:block;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".qr.x{cursor:default;font-style:italic}",
    ".b.fl2{outline:2px solid currentColor;outline-offset:2px}",
    ".rbar{display:flex;align-items:center;gap:8px;margin:0 0 6px}",
    ".rbar .qr{flex:1;min-width:0;margin:0;cursor:default}",
    ".rbar button{font-size:22px;line-height:1;padding:2px 10px}",
    ".msw{position:relative;display:flex;flex:none;width:62px;min-width:62px;height:32px;padding:2px;margin:0 6px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.14);cursor:pointer;box-shadow:none}",
    ".msw .msi{flex:1;display:grid;place-items:center;position:relative;z-index:1;color:var(--mu);transition:color .2s}",
    ".msw .mth{position:absolute;top:2px;left:2px;width:calc(50% - 2px);height:26px;border-radius:999px;background:var(--g);transition:transform .22s}",
    ".msw .a{color:#fff}.msw.on .mth{transform:translateX(100%)}.msw.on .a{color:var(--mu)}.msw.on .b{color:#fff}"
  ].join("\n");
  document.head.appendChild(s);
})();
const SV_BASE = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const SV_CHAT = '<svg ' + SV_BASE + '><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
const SV_HOUR = '<svg ' + SV_BASE + '><path d="M7 3h10M7 21h10M8 3v4l4 5-4 5v4M16 3v4l-4 5 4 5v4"/></svg>';
const EBN = '<div class="demo" id="ebn">⏳ Mode éphémère activé : les messages disparaissent une fois lus.</div>';

// interrupteur éphémère / normal (entre le nom et le pseudo)
function msgSwitch(on){
  return '<button type="button" class="msw' + (on ? ' on' : '') + '" id="mm" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="Mode éphémère"><span class="mth"></span><span class="msi a">' + SV_CHAT + '</span><span class="msi b">' + SV_HOUR + '</span></button>';
}
async function toggleMode(){
  if(!peer || peer.grp || !session) return;
  const on = !(eph && eph.actif);
  try{ await rp2("changer_mode", {p_autre:peer.id, p_actif:on}); msgMsg = ""; }
  catch(e){ msgMsg = /changer_mode/.test(e.message) ? "Le changement de mode n’est pas encore activé sur ce site." : e.message; }
  await loadChat(); render();
}
// le texte « Mode éphémère activé » ne s'affiche qu'une fois et part dès qu'un message est envoyé ou reçu
function ephBanOn(){
  if(!peer || peer.grp || !chatLoaded || !eph || !eph.actif) return false;
  const k = "alapp_eb_" + peer.id, dep = String(eph.depuis || "");
  try{ if(localStorage.getItem(k) === dep) return false; }catch(e){}
  const t0 = eph.depuis ? new Date(eph.depuis).getTime() : 0;
  if(pendList().length || msgs.some(x => new Date(x.created_at).getTime() > t0)){ try{ localStorage.setItem(k, dep); }catch(e){} return false; }
  return true;
}
function ebnSync(el){
  const bn = $("#ebn"), on = ephBanOn();
  if(bn && !on) bn.remove(); else if(!bn && on) el.insertAdjacentHTML("beforebegin", EBN);
}
// information reçue quand l'autre étudiant change le mode (simple information, bouton OK)
function ephNote(){
  if(!peer || peer.grp || !session || !eph || !eph.depuis || eph.par === session.id) return "";
  const k = "alapp_es_" + peer.id; let seen = null;
  try{ seen = localStorage.getItem(k); }catch(e){}
  if(seen === null){ try{ localStorage.setItem(k, String(eph.depuis)); }catch(e){} return ""; }
  if(seen === String(eph.depuis)) return "";
  return '<div class="demo" id="ech">' + esc(peer.nom || "L’autre étudiant") + (eph.actif ? " a activé le mode éphémère." : " a activé le mode normal.") + ' <button class="t" id="eok">OK</button></div>';
}
// réponse à un message / modification : bandeau au-dessus de la barre d'écriture
function msgBar(){
  if(msgEdit) return '<div class="rbar"><div class="qr"><b>Modifier le message</b><span>' + esc(msgEdit.texte || "") + '</span></div><button type="button" class="t" id="rbx" aria-label="Annuler">×</button></div>';
  if(msgReply) return '<div class="rbar"><div class="qr"><b>' + esc(msgReply.expediteur === session.id ? "Toi" : (peer.nom || "Étudiant")) + '</b><span>' + esc(msgReply.texte || msgPreview(msgReply.media_type)) + '</span></div><button type="button" class="t" id="rbx" aria-label="Annuler la réponse">×</button></div>';
  return "";
}
function quoteHtml(x){
  if(peer.grp || !x.reponse_a) return "";
  const q = msgs.find(y => y.id === x.reponse_a), ok = q && !q.supprime;
  return '<div class="qr' + (ok ? "" : " x") + '"' + (ok ? ' data-q="' + q.id + '"' : "") + '><b>' + esc(q ? (q.expediteur === session.id ? "Toi" : (peer.nom || "Étudiant")) : "Message") + '</b><span>' + esc(q ? (q.supprime ? "Message supprimé" : (q.texte || msgPreview(q.media_type))) : "Message indisponible") + '</span></div>';
}
function bindMsgChrome(){
  const m = $("#mm"); if(m) m.onclick = toggleMode;
  const x = $("#rbx"); if(x) x.onclick = () => { if(msgEdit){ msgEdit = null; mdraft = ""; } msgReply = null; render(); };
  const k = $("#eok"); if(k) k.onclick = () => { try{ localStorage.setItem("alapp_es_" + peer.id, String(eph.depuis)); }catch(e){} const c = $("#ech"); if(c) c.remove(); };
}
function goQuote(id){
  const t = document.querySelector('[data-mid="' + id + '"]'); if(!t) return;
  t.scrollIntoView({block:"center", behavior:"smooth"}); t.classList.add("fl2"); setTimeout(() => t.classList.remove("fl2"), 1200);
}
function startReply(x){
  if(!x || x.supprime || !peer || peer.grp) return;
  msgEdit = null; msgReply = x; render();
  const t = $("#mt"); if(t) t.focus();
}
function startEdit(x){
  if(!x || x.supprime || !peer || peer.grp) return;
  msgReply = null; msgEdit = x; mdraft = x.texte || ""; render();
  const t = $("#mt"); if(t){ t.focus(); try{ t.setSelectionRange(t.value.length, t.value.length); }catch(e){} }
}
async function sendEdit(){
  const x = msgEdit, n = mdraft.trim();
  if(!x) return;
  if(!n && !x.media_url){ msgMsg = "Écris un message."; return render(); }
  msgEdit = null; mdraft = ""; msgMsg = "";
  if(n === (x.texte || "")) return render();
  render();
  await patchMsg(x.id, {texte:n || null, modifie:true});
}
async function copyTxt(t){
  try{ await navigator.clipboard.writeText(t); }
  catch(e){ const a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(a); a.select(); try{ document.execCommand("copy"); }catch(_){} a.remove(); }
}
function reportMsg(x){
  const ml = $("#ml"); if(!ml) return;
  const t = document.createElement("button");
  t.type = "button"; t.hidden = true; t.setAttribute("data-rp", "message:" + x.id); t.setAttribute("data-ex", (x.texte || "").slice(0, 200));
  ml.appendChild(t); t.click(); setTimeout(() => t.remove(), 500);
}
function askDelete(x){
  const d = document.createElement("div"); d.className = "sheet";
  d.innerHTML = '<div class="sc"><b>Supprimer ce message pour tous ?</b><p class="pt" style="margin:0 0 8px">Il sera remplacé par « Ce message a été supprimé » chez les deux personnes. Cette action est définitive.</p><button class="dg" id="dy">Supprimer pour tous</button><button class="t" id="dn">Annuler</button></div>';
  document.body.appendChild(d);
  const close = () => d.remove();
  d.onclick = e => { if(e.target === d) close(); };
  d.querySelector("#dn").onclick = close;
  d.querySelector("#dy").onclick = async () => {
    close();
    if(msgEdit && msgEdit.id === x.id){ msgEdit = null; mdraft = ""; render(); }
    if(msgReply && msgReply.id === x.id){ msgReply = null; render(); }
    await patchMsg(x.id, {supprime:true, texte:null, media_url:null, media_type:null});
  };
}
// menu du message (appui long) : Répondre, Copier, Modifier, Supprimer pour tous, Signaler
function msgMenu(id){
  const x = msgs.find(y => y.id === id);
  if(!x || x.supprime || !peer || peer.grp || !session) return;
  const mine = x.expediteur === session.id, pv = (x.texte || msgPreview(x.media_type)).slice(0, 60);
  const d = document.createElement("div"); d.className = "sheet";
  d.innerHTML = '<div class="sc"><b>' + esc(pv) + '</b><button id="mq">Répondre</button>' + (x.texte ? '<button id="mc">Copier</button>' : '') +
    (mine ? (x.texte ? '<button id="me2">Modifier</button>' : '') + '<button class="dg" id="md2">Supprimer pour tous</button>' : '<button class="dg" id="mrp">Signaler</button>') +
    '<button class="t" id="mxc">Annuler</button></div>';
  document.body.appendChild(d);
  const close = () => d.remove(), on = (s, f) => { const b = d.querySelector(s); if(b) b.onclick = () => { close(); f(); }; };
  d.onclick = e => { if(e.target === d) close(); };
  on("#mxc", () => {}); on("#mq", () => startReply(x)); on("#mc", () => copyTxt(x.texte || "")); on("#me2", () => startEdit(x)); on("#md2", () => askDelete(x)); on("#mrp", () => reportMsg(x));
}
// double clic / double toucher = répondre ; appui long = menu
function bindMsgTouch(el){
  el.querySelectorAll("[data-b]").forEach(b => {
    let tm = null, held = false, sx = 0, sy = 0, last = 0;
    const stop = () => clearTimeout(tm), skip = t => t.closest("button,a,video,audio,.qr");
    b.onpointerdown = e => { if(skip(e.target)) return; held = false; sx = e.clientX; sy = e.clientY; tm = setTimeout(() => { held = true; if(navigator.vibrate) navigator.vibrate(20); msgMenu(b.dataset.b); }, 450); };
    b.onpointermove = e => { if(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) stop(); };
    b.onpointerup = stop; b.onpointerleave = stop; b.onpointercancel = stop;
    b.oncontextmenu = e => { e.preventDefault(); stop(); if(!held){ held = true; msgMenu(b.dataset.b); } };
    b.onclick = e => {
      if(held){ held = false; return; }
      if(skip(e.target)) return;
      const n = Date.now();
      if(n - last < 350){ last = 0; startReply(msgs.find(y => y.id === b.dataset.b)); } else last = n;
    };
  });
  el.querySelectorAll("[data-q]").forEach(q => q.onclick = () => goQuote(q.dataset.q));
}

function drawMsgs(){
  const el = $("#ml"); if(!el) return;
  ebnSync(el);
  const key = msgs.map(x => x.id + (x.modifie ? "m" : "") + (x.supprime ? "d" : "") + (x.lu_at ? "v" : "") + (x.enregistre_at ? "s" : "")).join("|") + "#" + sel + (eph && eph.actif ? "e" : "") + "#" + pendKey();
  if(key === dk) return;
  const first = dk === ""; dk = key;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const lastMine = (msgs.filter(y => y.expediteur === session.id && !y.supprime).pop() || {}).id;
  el.innerHTML = msgs.map(x => {
    const mine = x.expediteur === session.id, live = mine && !x.supprime, rpt = !mine && !x.supprime;
    const body = x.supprime ? '<span class="del">🚫 Ce message a été supprimé</span>' : quoteHtml(x) + (x.texte ? '<span>' + esc(x.texte) + '</span>' : '') +
      msgMediaHtml(x);
    const act = !peer.grp ? '' : live && sel === x.id ? '<div class="ma"><button data-me="' + x.id + '">✏️ Modifier</button><button data-md="' + x.id + '">🗑 Supprimer pour tous</button></div>' : (rpt && sel === x.id ? '<div class="ma"><button data-rp="' + (peer.grp ? "message_groupe" : "message") + ':' + x.id + '" data-ex="' + esc((x.texte || "").slice(0, 200)) + '">⚑ Signaler</button></div>' : '');
    return '<div class="b' + (mine ? " me" : "") + '"' + (live || rpt ? ' data-b="' + x.id + '"' : '') + ' data-mid="' + x.id + '">' + body + '<small>' + (x.modifie && !x.supprime ? "modifié · " : "") + new Date(x.created_at).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}) + '</small>' + (mine && x.id === lastMine && !x.supprime ? '<small class="vu">' + (x.lu_at ? EYE_O + " " + new Date(x.lu_at).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}) : EYE_C) + '</small>' : '') + (mine && x.enregistre_at ? '<small class="vu">💾 Photo enregistrée</small>' : '') + (!mine && !x.supprime && x.media_type === "image" && x.media_url && eph && eph.actif && !x.enregistre_at ? '<button class="t" data-sv="' + x.id + '">💾 Enregistrer</button>' : '') + act + '</div>';
  }).join("") + pendMsgHtml() || '<p class="pt c">Dis bonjour 👋</p>';
  if(near || first) el.scrollTop = el.scrollHeight;
  if(!peer.grp) bindMsgTouch(el);
  else el.querySelectorAll("[data-b]").forEach(b => b.onclick = ev => { if(ev.target.closest("button")) return; sel = sel === b.dataset.b ? null : b.dataset.b; drawMsgs(); });
  el.querySelectorAll("[data-me]").forEach(b => b.onclick = async () => {
    const x = msgs.find(y => y.id === b.dataset.me), n = prompt("Modifier le message", x.texte || "");
    if(n === null || (!n.trim() && !x.media_url)) return;
    sel = null; await patchMsg(x.id, {texte:n.trim() || null, modifie:true});
  });
  el.querySelectorAll("[data-md]").forEach(b => b.onclick = async () => {
    if(!confirm("Supprimer ce message pour tout le monde ?")) return;
    sel = null; await patchMsg(b.dataset.md, {supprime:true, texte:null, media_url:null, media_type:null});
  });
  el.querySelectorAll("[data-sv]").forEach(b => b.onclick = () => saveEph(b.dataset.sv));
}
async function sendMsg(){
  if(msgEdit) return sendEdit();
  const texte = mdraft.trim(), f = mfile;
  if(!texte && !f){ msgMsg = "Écris un message ou ajoute un média."; return render(); }
  if(f && f.size > MSG_MAX){ msgMsg = "Fichier trop lourd (50 Mo maximum)."; return render(); }
  const to = peer, isG = !!peer.grp, rid = !isG && msgReply ? msgReply.id : null;
  const pr = {id:++pendSeq, peerId:to.id, texte, kind:f ? msgKind(f) : null, name:f ? f.name : "", url:f ? URL.createObjectURL(f) : ""};
  pendingMsgs.push(pr);
  mdraft = ""; mfile = null; msgMsg = ""; msgReply = null; render();
  const ml = $("#ml"); if(ml) ml.scrollTop = ml.scrollHeight;
  try{
    await withAuth(async t => {
      let media_url = null, media_type = null;
      if(f){
        const path = msgPath(f);
        const r = await fetch(SUPABASE_URL + "/storage/v1/object/prive/" + path, {method:"POST", headers:{apikey:SUPABASE_KEY, Authorization:"Bearer " + t, "Content-Type":msgMime(f)}, body:f});
        if(!r.ok){ let d = null; try{ d = await r.json(); }catch(e){} throw new Error((d && (d.message || d.error)) || "Envoi du média impossible"); }
        media_url = "prive/" + path;
        media_type = msgKind(f);
        localBlob[media_url] = pr.url;
      }
      await sb(isG ? "/rest/v1/groupe_messages" : "/rest/v1/messages", {method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify(isG ? {groupe:to.id, texte, media_url, media_type} : {expediteur:session.id, destinataire:to.id, texte, media_url, media_type, ...(rid ? {reponse_a:rid} : {})})}, t);
    });
    if(peer && peer.id === to.id) await loadChat();
    pendingMsgs = pendingMsgs.filter(x => x !== pr);
    if(isG && MENTION_ELLA.test(texte)) appelerElla(to.id);   // Ella répond dans le groupe (05-groupes.js)
  }catch(e){
    pendingMsgs = pendingMsgs.filter(x => x !== pr);
    if(pr.url){ try{ URL.revokeObjectURL(pr.url); }catch(_){} }
    if(peer && peer.id === to.id){ if(!mdraft && !mfile){ mdraft = texte; mfile = f; } if(rid && !msgReply) msgReply = msgs.find(y => y.id === rid) || null; msgMsg = /reponse_a/.test(e.message) ? "Les réponses aux messages ne sont pas encore activées sur ce site." : e.message; }
  }
  render();
}
function renderDmNew(){
  app.innerHTML = topbar("Nouveau message") + '<div class="card"><input id="sq" placeholder="Chercher un étudiant (nom ou pseudo)" autocomplete="off"><div id="sr"></div></div>';
  $("#cb").onclick = () => { dmnew = false; sres = []; render(); };
  $("#sq").oninput = e => searchUsers(e.target.value);
}
function renderMsgList(err){
  const list = mtab === "inv" ? [] : convs.filter(c => mtab === "grp" ? c.peer.grp : !c.peer.grp);
  const row = c => {
    const pf = prefs[c.peer.id] || {}, ph = c.peer.grp ? c.peer.photo : photos[c.peer.id];
    const inner = ph ? "" : (c.peer.grp && c.peer.anonyme ? "🎭" : esc((c.peer.nom || c.peer.pseudo || "?").trim().split(/\s+/).map(w => w.charAt(0)).slice(0, 2).join("").toUpperCase()));
    return '<div class="mr2" data-c="' + convs.indexOf(c) + '"><div class="av l"' + (ph ? ' style="background-image:url(' + esc(ph) + ')"' : '') + '>' + inner + '</div><div class="mi"><b>' + (pf.epingle ? "📌 " : "") + ((ephAll[c.peer.id] || {}).actif ? "⏳ " : "") + esc(c.peer.nom || "Étudiant") + (c.peer.grp ? (c.peer.anonyme ? '<span class="tg">Anonyme</span>' : "") : badge(c.peer.id)) + '</b><span class="mp">' + prevHtml(c) + '</span></div><div class="mt"><span>' + tmsg(c.last.created_at) + '</span>' + (c.unread ? '<i class="ub">' + c.unread + '</i>' : '') + '</div></div>';
  };
  app.innerHTML = '<div class="top2"><b style="font:800 26px var(--ffh)">Messages</b><button class="ib pl" id="np" aria-label="Nouveau">' + ic("p") + '</button></div><div class="fch"><span class="fc' + (mtab === "dm" ? " on" : "") + '" data-mt="dm">Privés</span><span class="fc' + (mtab === "grp" ? " on" : "") + '" data-mt="grp">Groupes</span><span class="fc' + (mtab === "inv" ? " on" : "") + '" data-mt="inv">Invitations' + (invits.length ? ' <i class="ub">' + invits.length + '</i>' : '') + '</span></div>' +
    (mtab === "inv" ? invHtml() : list.length ? list.map(row).join("") : '<div class="empty">' + (mtab === "grp" ? "Aucun groupe pour l’instant. Appuie sur + pour en créer un." : "Aucune conversation. Appuie sur + pour écrire à un étudiant.") + '</div>') + err;
  $("#np").onclick = () => { if(mtab === "grp"){ gnew = {nom:"", anon:false, sel:[]}; gcreate = true; } else { dmnew = true; sres = []; } msgMsg = ""; render(); };
  document.querySelectorAll("[data-mt]").forEach(b => b.onclick = () => { mtab = b.dataset.mt; render(); });
  document.querySelectorAll("[data-iv]").forEach(b => b.onclick = () => { cf = "ev"; go("com"); });
  document.querySelectorAll("[data-ic]").forEach(b => b.onclick = async () => { b.disabled = true; try{ await withAuth(t => sb("/rest/v1/evenement_participants?evenement=eq." + b.dataset.ic + "&membre=eq." + session.id, {method:"DELETE", headers:{Prefer:"return=minimal"}}, t)); }catch(e){ alert(e.message); } await loadInvits(); });
  document.querySelectorAll("[data-c]").forEach(b => {
    const c = convs[b.dataset.c]; let tm = null, held = false, sx = 0, sy = 0;
    const stop = () => clearTimeout(tm);
    b.onpointerdown = e => { held = false; sx = e.clientX; sy = e.clientY; tm = setTimeout(() => { held = true; if(navigator.vibrate) navigator.vibrate(30); sheet(c); }, 500); };
    b.onpointermove = e => { if(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) stop(); };
    b.onpointerup = stop; b.onpointerleave = stop; b.onpointercancel = stop;
    b.oncontextmenu = e => e.preventDefault();
    b.onclick = () => { if(held){ held = false; return; } (c.peer.grp ? openGChat(c.peer) : openChat(c.peer)); };
  });
}
function renderMsgOne(){
  const err = msgMsg ? '<div class="msg">' + esc(msgMsg) + '</div>' : '';
  if(gcreate) return renderGNew();
  if(gadd && peer && peer.grp) return renderGAdd();
  if(dmnew) return renderDmNew();
  if(peer && peer.grp) return renderGChat();
  if(!peer) return renderMsgList(err);
  const pf = prefs[peer.id] || {}, ea = !!(eph && eph.actif);
  const choice = decided() ? '' : '<div class="card c"><h2>Comment veux-tu discuter ?</h2><p class="s">Ce choix est fixé pour toute la conversation, pour vous deux.</p><button id="mn">💬 Conversation normale</button><button id="mx" class="x">⏳ Éphémère</button><p class="pt hint">En mode éphémère, chaque message disparaît une fois lu.</p></div>';
  const ban = (ephBanOn() ? EBN : '') + ephNote();
  app.innerHTML = '<div class="nav"><button class="t" id="bk">← Retour</button><b>' + esc(peer.nom || "Étudiant") + badge(peer.id) + '</b>' + (decided() ? msgSwitch(ea) : '') + '<span class="pt">@' + esc(peer.pseudo || "") + '</span></div>' + ban + '<div id="ml" class="ml"></div><div id="tp" class="pt tpi"></div>' +
    choice + '<div class="cbar" id="cp"' + (decided() ? '' : ' hidden') + '><div id="em" class="em" hidden>' + EMO.map(e => '<button class="t" data-e="' + e + '">' + e + '</button>').join("") + '</div>' + (mfile ? '<div class="pt fn">📎 ' + esc(mfile.name) + '</div>' : '') + msgBar() + '<div class="row"><button class="ib t" id="eb">😊</button><label class="ib">📎<input type="file" id="mf" accept="' + MSG_ACCEPT + '" hidden></label><textarea id="mt" rows="1" placeholder="Message">' + esc(mdraft) + '</textarea><button class="ib send" id="ms">➤</button></div>' + err + '</div>';
  dk = ""; drawMsgs();
  $("#bk").onclick = async () => { await purge(); await markRead(peer.id); clearInterval(poll); clearInterval(tpoll); peer = null; eph = null; msgReply = null; msgEdit = null; render(); loadConvs(); };
  bindMsgChrome();
  $("#mt").oninput = e => { mdraft = e.target.value; if(Date.now() - lastTyp > 2500){ lastTyp = Date.now(); rp2("ecrit_a", {p_vers:peer.id}).catch(() => {}); } e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; };
  if($("#mn")){ $("#mn").onclick = () => chooseMode(false); $("#mx").onclick = () => chooseMode(true); }
  $("#eb").onclick = () => { $("#em").hidden = !$("#em").hidden; };
  document.querySelectorAll("[data-e]").forEach(b => b.onclick = () => { const t = $("#mt"); t.value += b.dataset.e; mdraft = t.value; });
  $("#mf").onchange = e => { const f = e.target.files[0]; if(f && f.size > MSG_MAX){ msgMsg = "Fichier trop lourd (50 Mo maximum)."; mfile = null; } else { mfile = f || null; msgMsg = ""; } render(); };
  $("#ms").onclick = sendMsg;
}
/* ===== Affichage PC : liste des conversations à gauche, conversation à droite ===== */
function renderMsg(){
  if(!isDesk() || gcreate || gadd || dmnew) return renderMsgOne();
  const err = msgMsg ? '<div class="msg">' + esc(msgMsg) + '</div>' : '';
  const p = peer;
  peer = null; renderMsgList(err);
  const L = document.createElement("div"); L.className = "mlistp";
  while(app.firstChild) L.appendChild(app.firstChild);
  peer = p;
  const C = document.createElement("div"); C.className = "mchatp";
  if(peer){ renderMsgOne(); while(app.firstChild) C.appendChild(app.firstChild); }
  else C.innerHTML = '<div class="empty mnone">Choisis une conversation à gauche pour écrire.</div>';
  markActiveRow(L);
  const W = document.createElement("div"); W.className = "msplit"; W.appendChild(L); W.appendChild(C);
  app.innerHTML = ""; app.appendChild(W);
  if(peer){ const ml = $("#ml"); if(ml) ml.scrollTop = ml.scrollHeight; }
}
function markActiveRow(L){
  if(!peer) return;
  L.querySelectorAll(".mr2[data-c]").forEach(r => { const c = convs[r.dataset.c]; if(c && c.peer.id === peer.id) r.classList.add("act"); });
}
function repaintListDesk(){
  const L = document.querySelector(".mlistp"), W = app.firstChild;
  if(!L || !W || !W.classList || !W.classList.contains("msplit")) return;
  const p = peer; peer = null; app.removeChild(W);
  try{ renderMsgList(""); }catch(e){}
  peer = p;
  while(L.firstChild) L.removeChild(L.firstChild);
  while(app.firstChild) L.appendChild(app.firstChild);
  markActiveRow(L);
  app.innerHTML = ""; app.appendChild(W);
}
