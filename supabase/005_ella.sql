-- 005 : Ella, l'assistante IA des groupes (appelée avec @Ella)
--
-- AVANT de lancer ce script :
--   Authentication > Users > Add user > Create new user
--   e-mail : celui écrit ci-dessous (v_email), mot de passe long et aléatoire, « Auto Confirm User » coché.
--   Ella ne se connecte jamais : c'est la fonction serveur « ella » qui écrit ses messages.
--
-- Ce script :
--   1. crée la table « bots » (liste des comptes robots, en lecture seule pour l'appli) ;
--   2. crée la table « ella_appels » (journal des appels, réservé au serveur) ;
--   3. crée le profil d'Ella et l'enregistre comme robot ;
--   4. met à jour la vue des messages de groupe : Ella garde son nom (même dans un groupe anonyme)
--      et une nouvelle colonne « est_ella » permet à l'appli de lui donner son style ;
--   5. retire Ella des résultats de recherche de profils.
-- Il peut être relancé sans risque.

-- ============================================================
-- 1. Comptes robots
-- ============================================================
create table if not exists public.bots (
  id uuid primary key references public.profiles(id) on delete cascade,
  nom text not null,
  created_at timestamptz not null default now()
);

alter table public.bots enable row level security;

-- Savoir qu'Ella est un robot n'est pas secret : les connectés peuvent lire la liste.
-- Personne ne peut s'y ajouter depuis l'appli (aucune règle d'écriture + droits retirés).
drop policy if exists bots_lecture on public.bots;
create policy bots_lecture on public.bots for select to authenticated using (true);
revoke all on public.bots from anon;
revoke insert, update, delete, truncate on public.bots from authenticated;

-- ============================================================
-- 2. Journal des appels à Ella (limites et anti-doublon)
-- ============================================================
-- Une ligne par message « @Ella » traité : le même message ne peut pas déclencher deux réponses.
-- Réservé à la fonction serveur (clé de service) : aucune règle RLS, aucun droit pour l'appli.
create table if not exists public.ella_appels (
  message uuid primary key references public.groupe_messages(id) on delete cascade,
  groupe uuid not null references public.groupes(id) on delete cascade,
  demandeur uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ella_appels_groupe_date on public.ella_appels (groupe, created_at);
create index if not exists ella_appels_demandeur_date on public.ella_appels (demandeur, created_at);

alter table public.ella_appels enable row level security;
revoke all on public.ella_appels from anon, authenticated;

-- ============================================================
-- 3. Profil d'Ella
-- ============================================================
do $$
declare
  v_email text := 'ella@alapp-bot.fr';   -- doit être identique à l'e-mail créé dans Authentication
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'Utilisateur % introuvable : crée-le d''abord dans Authentication > Users.', v_email;
  end if;

  if exists (select 1 from public.profiles
             where lower(btrim(pseudo)) = 'ella' and id <> v_id) then
    raise exception 'Le pseudo "ella" est déjà pris par un étudiant : change-le dans ce script.';
  end if;

  insert into public.profiles (id, nom, pseudo, bio)
  values (v_id, 'Ella', 'ella',
          'Assistante IA d''ALapp. Dans un groupe, écris @Ella suivi de ta question.')
  on conflict (id) do update
    set nom = excluded.nom, pseudo = excluded.pseudo, bio = excluded.bio;

  insert into public.bots (id, nom) values (v_id, 'Ella')
  on conflict (id) do update set nom = excluded.nom;
end $$;

-- ============================================================
-- 4. Vue des messages de groupe
-- ============================================================
-- Identique à la version précédente, avec deux changements :
--   - le nom d'un robot s'affiche toujours (sinon Ella serait « Ancien membre » dans un groupe anonyme) ;
--   - nouvelle colonne « est_ella » (ajoutée à la fin, comme l'exige PostgreSQL).
create or replace view public.groupe_messages_vue as
select
  x.id,
  x.groupe,
  x.texte,
  x.media_url,
  x.media_type,
  x.modifie,
  x.supprime,
  x.created_at,
  x.auteur = auth.uid() as est_moi,
  case
    when b.id is not null then b.nom
    when g.anonyme then coalesce('Anonyme '::text || mm.num, 'Ancien membre'::text)
    else pr.nom
  end as nom,
  b.id is not null as est_ella
from public.groupe_messages x
  join public.groupes g on g.id = x.groupe
  left join public.profiles pr on pr.id = x.auteur
  left join public.groupe_membres mm on mm.groupe = x.groupe and mm.membre = x.auteur
  left join public.bots b on b.id = x.auteur
where exists (
  select 1 from public.groupe_membres m
  where m.groupe = x.groupe and m.membre = auth.uid()
);

-- ============================================================
-- 5. Recherche de profils : Ella n'y apparaît pas
-- ============================================================
-- Identique à la version précédente, avec une seule condition en plus (« not exists ... bots »).
create or replace function public.chercher_profils(p_q text default ''::text, p_uni text default ''::text, p_fil text default ''::text, p_niv text default ''::text)
 returns table(id uuid, nom text, pseudo text, universite text, filiere text, niveau text, afficher_filiere boolean)
 language sql
 stable
 set search_path to 'public', 'extensions'
as $function$
  select p.id, p.nom::text, p.pseudo::text, p.universite::text, p.filiere::text, p.niveau::text, p.afficher_filiere
    from profiles p
   where p.id <> auth.uid()
     and not exists (select 1 from bots b where b.id = p.id)
     and (coalesce(p_q, '') = '' or unaccent(lower(coalesce(p.nom, ''))) like '%' || unaccent(lower(p_q)) || '%' or unaccent(lower(coalesce(p.pseudo, ''))) like '%' || unaccent(lower(p_q)) || '%')
     and (coalesce(p_uni, '') = '' or unaccent(lower(coalesce(p.universite, ''))) like '%' || unaccent(lower(p_uni)) || '%')
     and (coalesce(p_fil, '') = '' or unaccent(lower(coalesce(p.filiere, ''))) like '%' || unaccent(lower(p_fil)) || '%')
     and (coalesce(p_niv, '') = '' or p.niveau::text = p_niv)
   order by p.nom
   limit 30;
$function$;

-- ============================================================
-- Résultat : l'identifiant d'Ella (à mettre dans le secret ELLA_ID de la fonction serveur)
-- ============================================================
select id as ella_id, nom from public.bots;