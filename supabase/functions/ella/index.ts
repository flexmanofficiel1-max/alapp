import { createClient } from "npm:@supabase/supabase-js@2";

const ELLA_ID = Deno.env.get("ELLA_ID") ?? "";
const ELLA_API_URL = Deno.env.get("ELLA_API_URL") ?? "";
const ELLA_TOKEN = Deno.env.get("ELLA_TOKEN") ?? "";

const LIMITE_GROUPE_PAR_HEURE = 20;  // réponses d'Ella maximum par groupe et par heure
const LIMITE_MEMBRE_PAR_HEURE = 10;  // appels maximum par étudiant et par heure
const DELAI_APPEL_SECONDES = 120;    // le message @Ella doit dater de moins de 2 minutes
const NB_MESSAGES_CONTEXTE = 30;
const LONGUEUR_MAX_REPONSE = 4000;

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENTION_ELLA = /(^|[^\p{L}\p{N}_])@ella(?![\p{L}\p{N}_])/iu;

function repondre(statut: number, corps: Record<string, unknown>) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type Message = {
  id: string;
  auteur: string;
  texte: string | null;
  media_url: string | null;
  created_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return repondre(405, { erreur: "méthode non autorisée" });

  if (!ELLA_ID || !ELLA_API_URL || !ELLA_TOKEN) {
    console.error("[ella] Secrets manquants (ELLA_ID, ELLA_API_URL ou ELLA_TOKEN)");
    return repondre(503, { erreur: "Ella n'est pas configurée" });
  }

  // 1. Utilisateur connecté
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: errAuth } = await admin.auth.getUser(jwt);
  if (errAuth || !auth?.user) return repondre(401, { erreur: "non connecté" });
  const moi = auth.user.id;

  let groupeId = "";
  try {
    groupeId = String((await req.json())?.groupe ?? "");
  } catch { /* corps invalide */ }
  if (!UUID.test(groupeId)) return repondre(400, { erreur: "groupe invalide" });

  // ... et membre du groupe
  const { data: membres, error: errMembres } = await admin
    .from("groupe_membres").select("membre, num").eq("groupe", groupeId);
  if (errMembres) return repondre(500, { erreur: "lecture des membres impossible" });
  if (!membres?.some((m) => m.membre === moi)) return repondre(403, { erreur: "pas membre du groupe" });

  const { data: groupe } = await admin
    .from("groupes").select("id, nom, anonyme").eq("id", groupeId).maybeSingle();
  if (!groupe) return repondre(404, { erreur: "groupe introuvable" });

  // 2. Le message « @Ella » de l'utilisateur
  const { data: dernier } = await admin
    .from("groupe_messages").select("id, texte, created_at")
    .eq("groupe", groupeId).eq("auteur", moi).eq("supprime", false)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const age = dernier ? (Date.now() - new Date(dernier.created_at).getTime()) / 1000 : Infinity;
  if (!dernier || !MENTION_ELLA.test(dernier.texte ?? "") || age > DELAI_APPEL_SECONDES) {
    return repondre(400, { erreur: "aucun message récent adressé à Ella" });
  }

  // 3. Limites
  const ilYaUneHeure = new Date(Date.now() - 3600_000).toISOString();
  const [{ count: nbGroupe }, { count: nbMembre }] = await Promise.all([
    admin.from("ella_appels").select("*", { count: "exact", head: true })
      .eq("groupe", groupeId).gte("created_at", ilYaUneHeure),
    admin.from("ella_appels").select("*", { count: "exact", head: true })
      .eq("demandeur", moi).gte("created_at", ilYaUneHeure),
  ]);
  if ((nbGroupe ?? 0) >= LIMITE_GROUPE_PAR_HEURE) {
    return repondre(429, { erreur: "Ella a déjà beaucoup répondu dans ce groupe. Réessayez dans un moment." });
  }
  if ((nbMembre ?? 0) >= LIMITE_MEMBRE_PAR_HEURE) {
    return repondre(429, { erreur: "Tu as beaucoup sollicité Ella cette heure-ci. Réessaie un peu plus tard." });
  }

  // ... et anti-doublon : un message @Ella ne déclenche qu'une seule réponse
  const { error: errAppel } = await admin
    .from("ella_appels").insert({ message: dernier.id, groupe: groupeId, demandeur: moi });
  if (errAppel) {
    if (errAppel.code === "23505") return repondre(409, { erreur: "déjà traité" });
    return repondre(500, { erreur: "enregistrement de l'appel impossible" });
  }
  const annulerAppel = () => admin.from("ella_appels").delete().eq("message", dernier.id);

  // 4. Contexte : les derniers messages, avec les noms tels que le groupe les affiche
  const { data: recents } = await admin
    .from("groupe_messages").select("id, auteur, texte, media_url, created_at")
    .eq("groupe", groupeId).eq("supprime", false)
    .order("created_at", { ascending: false }).limit(NB_MESSAGES_CONTEXTE);
  const messages = ((recents ?? []) as Message[]).reverse();

  const numeros = new Map(membres.map((m) => [m.membre as string, m.num as number | null]));
  const noms = new Map<string, string>();
  if (!groupe.anonyme) {
    const ids = [...new Set(messages.map((m) => m.auteur).concat(moi))].filter((id) => id !== ELLA_ID);
    const { data: profils } = await admin.from("profiles").select("id, nom").in("id", ids);
    for (const p of profils ?? []) noms.set(p.id, p.nom ?? "Étudiant");
  }
  const nomDe = (id: string) => {
    if (groupe.anonyme) {
      const n = numeros.get(id);
      return n ? `Anonyme ${n}` : "Ancien membre";
    }
    return noms.get(id) ?? "Étudiant";
  };

  // 5. Appel du serveur Ella (Render)
  let texteReponse = "";
  try {
    const r = await fetch(ELLA_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${ELLA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        groupe_nom: groupe.nom,
        anonyme: groupe.anonyme,
        demandeur: nomDe(moi),
        messages: messages.map((m) => ({
          auteur: m.auteur === ELLA_ID ? "Ella" : nomDe(m.auteur),
          ella: m.auteur === ELLA_ID,
          texte: m.texte ?? "",
          media: Boolean(m.media_url),
        })),
      }),
      signal: AbortSignal.timeout(55_000),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 429 && d?.reponse) {
      texteReponse = String(d.reponse);   // limite journalière : Ella le dit dans le groupe
    } else if (!r.ok || !d?.reponse) {
      console.error(`[ella] Serveur Ella : statut ${r.status}`);
      await annulerAppel();
      return repondre(502, { erreur: "Ella est indisponible pour le moment" });
    } else {
      texteReponse = String(d.reponse);
    }
  } catch (e) {
    console.error(`[ella] Serveur Ella injoignable : ${(e as Error).name}`);
    await annulerAppel();
    return repondre(504, { erreur: "Ella met trop de temps à répondre" });
  }

  // 6. Réponse publiée dans le groupe au nom d'Ella
  const { error: errEnvoi } = await admin.from("groupe_messages").insert({
    groupe: groupeId,
    auteur: ELLA_ID,
    texte: texteReponse.slice(0, LONGUEUR_MAX_REPONSE),
  });
  if (errEnvoi) {
    console.error(`[ella] Publication impossible : ${errEnvoi.code}`);
    await annulerAppel();
    return repondre(500, { erreur: "publication de la réponse impossible" });
  }

  return repondre(200, { ok: true });
});