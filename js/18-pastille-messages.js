// ----- pastille rouge sur l'onglet Messages (barre du bas) : s'affiche quand il y a des messages non lus -----
(function(){
  "use strict";
  var INTERVAL = 10000, count = 0, busy = false, tmr = null;

  function ready(){
    try{ return typeof session !== "undefined" && !!session && !!session.id && typeof withAuth === "function" && typeof sb === "function"; }
    catch(e){ return false; }
  }

  function cachePerso(m){
    try{
      var p = (typeof prefs !== "undefined" && prefs) ? prefs[m.expediteur] : null;
      return !!(p && p.masque_avant && new Date(m.created_at) <= new Date(p.masque_avant));
    }catch(e){ return false; }
  }

  async function compter(){
    var n = 0, me = session.id;
    // conversations privées : messages reçus et pas encore lus
    try{
      var rows = await withAuth(function(t){
        return sb("/rest/v1/messages?select=id,expediteur,created_at,expire_at,supprime&destinataire=eq." + me + "&lu_at=is.null&order=created_at.desc&limit=100", {}, t);
      });
      (rows || []).forEach(function(m){
        if(m.supprime) return;
        if(m.expire_at && new Date(m.expire_at) < Date.now()) return;
        try{ if(typeof blocked !== "undefined" && blocked && blocked.has(m.expediteur)) return; }catch(e){}
        if(cachePerso(m)) return;
        n++;
      });
    }catch(e){}
    // groupes : messages non lus
    try{
      var gs = await withAuth(function(t){
        return sb("/rest/v1/groupes_vue?select=id,non_lus&non_lus=gt.0", {}, t);
      });
      (gs || []).forEach(function(g){ n += g.non_lus || 0; });
    }catch(e){}
    return n;
  }

  function trouverOnglet(){
    var nav = document.getElementById("tabs");
    if(!nav || nav.hidden) return null;
    var els = nav.querySelectorAll("button, a, [role=tab], [data-t], [data-tab]");
    if(!els.length) els = nav.children;
    for(var i = 0; i < els.length; i++){
      var el = els[i], d = el.dataset || {};
      if(d.t === "msg" || d.tab === "msg" || d.k === "msg") return el;
      var txt = (el.textContent || "").replace(/\s+/g, " ");
      if(/messag/i.test(txt)) return el;
    }
    return null;
  }

  function afficher(){
    var onglet = trouverOnglet();
    if(!onglet) return;
    document.querySelectorAll(".alapp-dot").forEach(function(d){ if(d.parentNode !== onglet) d.remove(); });
    var dot = onglet.querySelector(".alapp-dot");
    if(count > 0 && !dot){
      try{ if(getComputedStyle(onglet).position === "static") onglet.style.position = "relative"; }catch(e){}
      dot = document.createElement("span");
      dot.className = "alapp-dot";
      dot.setAttribute("role", "status");
      dot.setAttribute("aria-label", "Nouveaux messages");
      dot.style.cssText = "position:absolute;top:6px;left:calc(50% + 8px);width:12px;height:12px;box-sizing:border-box;border-radius:50%;background:#E5322D;border:2px solid #fff;pointer-events:none;z-index:2";
      onglet.appendChild(dot);
    }else if(count <= 0 && dot){
      dot.remove();
    }
  }

  async function rafraichir(){
    if(busy || document.hidden) return;
    if(!ready()){ if(count){ count = 0; afficher(); } return; }
    busy = true;
    try{ count = await compter(); afficher(); }catch(e){}
    busy = false;
  }

  function bientot(ms){ clearTimeout(tmr); tmr = setTimeout(rafraichir, ms); }

  // la barre du bas est redessinée par l'application : on remet la pastille si besoin
  var nav = document.getElementById("tabs");
  if(nav && window.MutationObserver){
    new MutationObserver(afficher).observe(nav, {childList:true, subtree:true, attributes:true, attributeFilter:["hidden"]});
  }
  document.addEventListener("click", function(){ bientot(2000); }, true);
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) rafraichir(); });
  setInterval(rafraichir, INTERVAL);
  bientot(2500);
})();
