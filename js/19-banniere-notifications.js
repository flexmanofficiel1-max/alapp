// ----- bannière d'activation des notifications (sans passer par Paramètres) + guide iPhone + réabonnement automatique -----
// S'appuie sur pushState(), pushOn(true) et pushOff() déjà présentes dans l'application.
(function(){
  "use strict";
  var LATER = "alapp_push_plus_tard", FLAG = "alapp_push_actif", DELAY = 3 * 864e5, shown = false;

  function ls(k, v){
    try{
      if(v === undefined) return localStorage.getItem(k);
      if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    }catch(e){}
    return null;
  }
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  function ready(){
    try{ return typeof session !== "undefined" && !!session && !!session.id && typeof pushState === "function" && typeof pushOn === "function"; }
    catch(e){ return false; }
  }

  // on retient si la personne a activé (ou coupé) les notifications, pour ne réabonner que ceux qui les veulent
  try{
    var o1 = window.pushOn, o2 = window.pushOff;
    if(typeof o1 === "function") window.pushOn = async function(){ var r = await o1.apply(this, arguments); ls(FLAG, "1"); return r; };
    if(typeof o2 === "function") window.pushOff = async function(){ var r = await o2.apply(this, arguments); ls(FLAG, null); return r; };
  }catch(e){}

  // réabonnement silencieux à chaque ouverture si l'autorisation est déjà donnée
  async function renouveler(){
    if(ls(FLAG) !== "1" || !("Notification" in window) || Notification.permission !== "granted") return;
    try{ if((await pushState()) !== "actif") await pushOn(true); }catch(e){}
  }

  function montrer(mode){
    if(shown || document.getElementById("alapp-push-bar")) return;
    shown = true;
    var nav = document.getElementById("tabs"), bas = (nav && nav.offsetHeight ? nav.offsetHeight : 64) + 10;
    var bar = document.createElement("div");
    bar.id = "alapp-push-bar";
    bar.setAttribute("role", "dialog");
    bar.style.cssText = "position:fixed;left:12px;right:12px;bottom:" + bas + "px;max-width:480px;margin:0 auto;background:#0F5B3A;color:#fff;border-radius:14px;padding:12px 14px;z-index:60;box-shadow:0 6px 24px rgba(0,0,0,.28);font:inherit";
    var titre = document.createElement("b"), txt = document.createElement("div"), btns = document.createElement("div");
    titre.style.cssText = "display:block;font-size:15px;margin-bottom:4px";
    txt.style.cssText = "font-size:13px;line-height:1.4;opacity:.95";
    btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:10px";
    function bouton(label, jaune, fn){
      var b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.style.cssText = "border:0;border-radius:10px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer;" + (jaune ? "background:#F6C945;color:#1d1d1d" : "background:rgba(255,255,255,.16);color:#fff");
      b.onclick = fn; btns.appendChild(b); return b;
    }
    function fermer(plusTard){ if(plusTard) ls(LATER, String(Date.now())); bar.remove(); }

    if(mode === "activer"){
      titre.textContent = "🔔 Ne rate aucun message";
      txt.textContent = "Active les notifications pour être prévenu(e) des nouveaux messages, mentions et J’aime, même quand ALapp est fermée.";
      bouton("Plus tard", false, function(){ fermer(true); });
      var ok = bouton("Activer", true, async function(){
        ok.disabled = true; ok.textContent = "…";
        try{
          await pushOn(true);
          var st = await pushState();
          if(st === "actif"){
            ls(FLAG, "1");
            titre.textContent = "✅ Notifications activées"; txt.textContent = "Tu seras prévenu(e) des nouveaux messages."; btns.remove();
            setTimeout(function(){ bar.remove(); }, 2200);
          }else{
            titre.textContent = "Notifications non activées"; txt.textContent = "Autorisation non accordée. Tu pourras réessayer depuis Paramètres.";
            btns.innerHTML = ""; bouton("OK", true, function(){ fermer(true); });
          }
        }catch(e){
          titre.textContent = "Activation impossible"; txt.textContent = (e && e.message) || "Réessaie depuis Paramètres.";
          btns.innerHTML = ""; bouton("OK", true, function(){ fermer(true); });
        }
      });
    }else if(mode === "ios"){
      titre.textContent = "🔔 Notifications sur iPhone";
      txt.textContent = "Appuie sur Partager (le carré avec une flèche), puis sur « Sur l’écran d’accueil ». Ouvre ensuite ALapp depuis cette icône et active les notifications.";
      bouton("Compris", true, function(){ fermer(true); });
    }else{
      titre.textContent = "🔕 Notifications bloquées";
      txt.textContent = "Autorise-les dans les réglages de ton navigateur (cadenas ou ⋮ puis Paramètres du site, Notifications), puis rouvre ALapp.";
      bouton("Compris", true, function(){ fermer(true); });
    }
    bar.appendChild(titre); bar.appendChild(txt); bar.appendChild(btns);
    document.body.appendChild(bar);
  }

  async function decider(){
    if(shown || document.hidden || !ready()) return;
    if(Date.now() - (+ls(LATER) || 0) < DELAY) return;
    if(ios && !standalone) return montrer("ios");
    if(!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if(Notification.permission === "denied") return montrer("refuse");
    var st;
    try{ st = await pushState(); }catch(e){ return; }
    if(st === "actif") return;
    montrer("activer");
  }

  // on attend que la personne soit connectée et que la barre du bas soit affichée
  var iv = setInterval(function(){
    if(document.hidden || !ready()) return;
    var nav = document.getElementById("tabs");
    if(!nav || nav.hidden) return;
    clearInterval(iv);
    renouveler();
    setTimeout(decider, 6000);
  }, 2000);
})();
