# Forla — les dépenses du foyer, 100 % hors ligne

Application web progressive (PWA) de gestion du budget familial. Elle s'installe sur téléphone et ordinateur
et fonctionne **sans connexion**. Les données restent **sur l'appareil** (IndexedDB) : aucun compte, aucun serveur.

**👉 Utiliser Forla : https://toucandesile.github.io/forla/** — ouvrez le lien puis « Installer » / « Ajouter à l'écran d'accueil ».
Chaque personne a ses propres données, stockées uniquement sur son appareil.

## Démarrer (développement)

```bash
npm install      # une seule fois
npm start        # construit l'appli et l'ouvre sur http://localhost:4173
npm run dev      # mode développement (rechargement à chaud)
```

Dans Chrome ou Edge, cliquez sur l'icône « Installer » de la barre d'adresse (ou Réglages → Application → Installer).
Une fois installée, Forla s'ouvre comme une appli normale, même hors ligne.

### Publication

```bash
npm run deploy   # tests + build, puis envoi du dossier dist/ sur la branche gh-pages
```

GitHub Pages publie la branche `gh-pages` en une à deux minutes. Les appareils déjà installés proposent alors
« Nouvelle version disponible ». L'hébergeur ne sert que les fichiers de l'application : les données ne transitent jamais par lui.

- **Android (Chrome)** : menu ⋮ → « Installer l'application »
- **iPhone (Safari)** : Partager → « Sur l'écran d'accueil »
- **Ordinateur (Chrome/Edge)** : icône « Installer » dans la barre d'adresse

## Fonctionnalités

| Domaine | Ce que fait Forla |
|---|---|
| **Accueil** | Reste à vivre du mois (revenus attendus − dépenses − charges à venir − épargne) et montant par jour, rythme de dépenses vs mois dernier, alertes intelligentes |
| **Saisie** | Saisie en 3 secondes (touche **N**), calculs dans le champ (`12,40+7,90`), catégorie devinée (règles + historique), photo du ticket, opérations récurrentes |
| **Budget** | Enveloppes mensuelles reconduites automatiquement, report du reste (positif ou négatif), « reste à budgéter », remplissage auto (moyenne 3 mois) |
| **Échéancier** | Charges fixes, abonnements (coût mensuel/annuel), échéances à valider, **détection automatique** des dépenses régulières, solde prévisionnel à 60 jours |
| **Foyer** | Qui a payé quoi, partage égal / au prorata des revenus / sur mesure, équilibrage en un minimum de remboursements |
| **Comptes** | Courant, joint, épargne, espèces, crédit ; virements ; rapprochement bancaire ; patrimoine net sur 12 mois |
| **Objectifs** | Épargne par versements ou liée au solde d'un compte, effort mensuel nécessaire, date d'atteinte estimée |
| **Analyses** | Revenus/dépenses par mois, dépenses par catégorie, règle 50/30/20, principaux bénéficiaires, taux d'épargne |
| **Import** | Relevés **CSV, OFX, QIF** de toutes les banques françaises, nettoyage des libellés, détection des doublons |
| **Sécurité** | Code PIN, mode discret (montants floutés), sauvegardes chiffrées AES-256 |
| **Synchronisation** | Export/partage de la sauvegarde puis **fusion** sur l'autre appareil (la version la plus récente de chaque élément gagne, suppressions comprises) |

## Tests

```bash
npm test          # tests unitaires (calculs, partage, import, fusion, chiffrement)
npm run test:e2e  # parcours complets dans Chromium (ordinateur + mobile, dont mode hors ligne)
```

## Architecture

- `src/lib/` — logique métier pure et testée : montants en centimes entiers, budget, partage, récurrences, import, sauvegarde
- `src/db/` — schéma IndexedDB (Dexie), données par défaut et démo
- `src/pages/` — écrans ; `src/components/` — interface et graphiques SVG faits main
- PWA : `vite-plugin-pwa` (Workbox) précache toute l'application
