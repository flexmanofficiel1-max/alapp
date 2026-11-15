-- 003 : bucket "medias" : envoi limité (dossier personnel, ou dossiers communs de l'app)
-- Dossiers communs utilisés par l'app : avatars (photos de profil et logos), grp (photos de groupe),
-- com (communauté), st (statuts). Les noms de fichiers sont des identifiants aléatoires.
drop policy if exists "envoi medias" on storage.objects;
create policy "envoi medias" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'medias'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[1] in ('avatars','grp','com','st')
    )
  );
