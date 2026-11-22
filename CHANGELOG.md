# Journal des mises à jour

## 2026-11-22
- Affichage ordinateur (écrans de 900 px ou plus) : menu à gauche, accueil avec colonne de droite, messages en deux panneaux (liste + conversation), profil large avec mosaïque à 4 colonnes, Communauté en grille de cartes. Nouveau fichier `css/desktop.css`. Le téléphone n'est pas modifié (rendu identique vérifié). Fichiers modifiés : `index.html`, `css/desktop.css`, `js/01-core.js`, `03-feed.js`, `04-messages.js`, `05-groupes.js`, `06-communaute-evenements.js`, `15-routeur-demarrage.js`.

## 2026-11-12 (v2)
- Code découpé : `index.html` allégé, `css/style.css`, un fichier JavaScript par partie du site.
- Sécurité : plus de script en ligne, CSP renforcée (`script-src 'self'`).
- Pseudo unique garanti par la base (`supabase/001`), message « Ce pseudo est déjà pris ».
- Messagerie : photos, vidéos, audio et documents envoyés en qualité d'origine, jusqu'à 50 Mo (`supabase/002`, `004`).
- Stockage `medias` : envoi limité au dossier de l'utilisateur ou aux dossiers communs avatars, grp, com, st (`supabase/003`).
- Publication instantanée : le post s'affiche tout de suite (« Envoi en cours… »), l'envoi des médias se fait en parallèle et en arrière-plan.
- Messagerie instantanée : la bulle et le média (photo, vidéo, audio) s'affichent et se lisent tout de suite depuis le fichier local, l'envoi se fait en arrière-plan. Lecteur audio corrigé (largeur).
- Apparence : chaque étudiant choisit mode clair, sombre ou auto, sa couleur principale et sa couleur de fond (Paramètres, Apparence). Choix gardé sur l'appareil.
- Ajout du README, du CHANGELOG et du dossier `supabase/`.
- Audit de sécurité Supabase réalisé : aucune faille ouverte relevée (tables, vues, fonctions, buckets).
