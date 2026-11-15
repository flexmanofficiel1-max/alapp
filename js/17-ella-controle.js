// ----- Ella par groupe : activation et désactivation partagées (minuteur de 5 minutes côté serveur) -----
// Fichier indépendant : il ne modifie pas le code d'Ella. Il ajoute un bouton dans les infos du groupe
// et vérifie, avant chaque appel à Ella, qu'elle est bien active.
(function(){
  const cache = {};   // id du groupe -> {actif, until, t}
  let busy = false;

  function gid(){ try{ return peer && peer.grp ? peer.id : null; }catch(e){ return null; } }

  async function etat(id){
    const r = await rp2("ella_etat", {p_groupe:id});
    const x = Array.isArray(r) ? r[0] : r;
    const e = {actif:!!(x && x.actif), until:Date.now() + ((x && x.secondes) || 0) * 1000, t:Date.now()};
    cache[id] = e;
    return e;
  }

  // Utilisé par la liste des mentions (16-mentions.js) : Ella n'y apparaît que si elle est active.
  window.ellaDansGroupe = id => { const e = cache[id]; return !!(e && e.actif && Date.now() < e.until); };

  // Avant chaque appel à Ella : vérifier qu'elle est active et remettre le minuteur à 5 minutes.
  const orig = window.appelerElla;
  if(typeof orig === "function"){
    window.appelerElla = async function(id){
      let ok = false;
      try{
        const r = await rp2("ella_mention", {p_groupe:id});
        ok = r === true || (Array.isArray(r) && r[0] === true);
      }catch(e){
        // Le script SQL n'est pas encore installé : Ella continue de marcher comme avant.
        if(/ella_mention|schema cache|Could not find/i.test((e && e.message) || "")) return orig(id);
        try{ if(peer && peer.id === id){ msgMsg = (e && e.message) || "Impossible de joindre Ella."; render(); } }catch(_){}
        return;
      }
      if(!ok){
        cache[id] = {actif:false, until:0, t:Date.now()};
        try{ if(peer && peer.id === id){ msgMsg = "Ella n’est pas activée dans ce groupe. Ouvre les infos du groupe (ⓘ) pour l’activer."; render(); } }catch(_){}
        return;
      }
      cache[id] = {actif:true, until:Date.now() + 5 * 60000, t:Date.now()};
      return orig(id);
    };
  }

  // Bloc « Ella (IA) » dans la fenêtre d'infos du groupe
  function infoBlock(sc){
    const id = gid(), anchor = sc.querySelector("#gx2");
    if(!id || !anchor || sc.querySelector("#ellb")) return;
    const box = document.createElement("div");
    box.id = "ellb";
    box.style.margin = "12px 0 4px";
    box.innerHTML = '<b>Ella (IA)</b><small class="pt" id="ells" style="display:block;margin-top:2px">Chargement…</small><button id="ellt" disabled>…</button>';
    anchor.parentNode.insertBefore(box, anchor);
    const s = box.querySelector("#ells"), b = box.querySelector("#ellt");
    let cur = null;
    const paint = e => {
      cur = e;
      if(e.actif){
        const m = Math.max(1, Math.ceil((e.until - Date.now()) / 60000));
        s.textContent = "Active · se désactive dans " + m + " min sans mention. Écris @Ella pour lui parler.";
        b.textContent = "Désactiver Ella"; b.className = "g";
      }else{
        s.textContent = "En attente · elle n’est pas membre du groupe. Une fois activée, elle répond seulement quand on la mentionne.";
        b.textContent = "Activer Ella"; b.className = "";
      }
      b.disabled = false;
    };
    etat(id).then(paint).catch(() => box.remove());
    b.onclick = async () => {
      b.disabled = true;
      try{
        await rp2(cur && cur.actif ? "ella_desactiver" : "ella_activer", {p_groupe:id});
        paint(await etat(id));
      }catch(err){ s.textContent = (err && err.message) || "Action impossible."; b.disabled = false; }
    };
    const tick = setInterval(() => {
      if(!document.body.contains(box)){ clearInterval(tick); return; }
      etat(id).then(paint).catch(() => {});
    }, 20000);
  }

  // Liste des membres : Ella y figure quand elle est active
  function membersBlock(sc){
    const id = gid(), list = sc.querySelector('div[style*="max-height"]');
    if(!id || !list || sc.dataset.ell) return;
    sc.dataset.ell = "1";
    etat(id).then(e => {
      if(e.actif && !sc.querySelector(".ellm")) list.insertAdjacentHTML("afterbegin", '<div class="cv ellm"><div><b>Ella</b> <span class="tg">IA</span></div></div>');
    }).catch(() => {});
  }

  function scan(){
    document.querySelectorAll(".sheet .sc").forEach(sc => {
      if(sc.querySelector("#gx2")) infoBlock(sc);
      else if(sc.querySelector("#gx3")) membersBlock(sc);
    });
    // garder l'état à jour quand une conversation de groupe est ouverte (pour la liste du @)
    const id = gid();
    if(id && document.getElementById("mt") && !busy && (!cache[id] || Date.now() - cache[id].t > 20000)){
      busy = true;
      etat(id).catch(() => { cache[id] = {actif:false, until:0, t:Date.now()}; }).then(() => { busy = false; });
    }
  }

  let raf = 0;
  new MutationObserver(() => {
    if(raf) return;
    raf = requestAnimationFrame(() => { raf = 0; try{ scan(); }catch(e){} });
  }).observe(document.body, {childList:true, subtree:true});
})();
