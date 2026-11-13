// === À REMPLIR avec tes accès Supabase (Project Settings > API) ===
const SUPABASE_URL = "https://tylnzfckkierwalomjuy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5bG56ZmNra2llcndhbG9tanV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAxNzQsImV4cCI6MjEwODI2NjE3NH0.N4P3YBIDu9mnaYqwMxYFY2tmDsn8GXyJZdXCngVb_Zg";
// ================================================================
const DEMO = !SUPABASE_URL || !SUPABASE_KEY;
const NIVEAUX = ["Licence 1","Licence 2","Licence 3","Master 1","Master 2","Doctorat"];
const $ = s => document.querySelector(s);
const app = $("#app");
let mode = "splash", msg = "", ok = false, busy = false, session = null, profile = null, editing = false, tab = "feed", posts = [], draft = "", file = null, feedMsg = "", loading = false, msgs = [], convs = [], peer = null, sres = [], poll = null, mdraft = "", mfile = null, msgMsg = "", dk = "", sending = false, prefs = {}, eph = null, ephAll = {}, sel = null, chatLoaded = false;

const store = {
  get(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function sb(path, opts = {}, token){
  const r = await fetch(SUPABASE_URL + path, {...opts, headers:{apikey:SUPABASE_KEY, "Content-Type":"application/json", Authorization:"Bearer " + (token || SUPABASE_KEY), ...(opts.headers||{})}});
  const t = await r.text(); let d = null; try{ d = t ? JSON.parse(t) : null; }catch(e){}
  if(!r.ok){
    let m = (d && (d.msg || d.message || d.error_description || d.error)) || "Erreur " + r.status;
    if(/profiles_pseudo_unique/.test(String(m))) m = "Ce pseudo est déjà pris.";
    throw new Error(m);
  }
  return d;
}

