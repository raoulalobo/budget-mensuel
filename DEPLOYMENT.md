# Déploiement — Convex (prod) + Vercel

L'app est prête pour Vercel : le plugin **Nitro** (`vite.config.ts`) produit la
sortie serveur (`.output/`) que **Vercel détecte en zéro-config** et publie en
Vercel Functions. Convex héberge la base + les fonctions serveur.

> ⚠️ Deux connexions **interactives** sont nécessaires (compte Convex et compte
> Vercel). Elles doivent être faites par toi — dans ce terminal, préfixe la
> commande par `!` pour que la sortie revienne dans la conversation, ex.
> `! npx convex login`.

---

## 1) Convex en production

```bash
# a. Connexion au compte Convex (ouvre le navigateur)
npx convex login

# b. Créer/lier un projet cloud et pousser les fonctions en production
npx convex deploy
#    -> note l'URL de production affichée (https://<nom>.convex.cloud)

# c. Variables d'environnement de PRODUCTION
npx convex env set ANTHROPIC_API_KEY sk-ant-... --prod
#    (optionnel) npx convex env set ANTHROPIC_MODEL claude-sonnet-4-6 --prod

# d. Clés d'authentification (Convex Auth) pour la prod
npx @convex-dev/auth --prod
#    -> génère/positionne JWKS, JWT_PRIVATE_KEY, SITE_URL sur le déploiement prod
```

Puis, dans le **dashboard Convex** : *Settings → Deploy Keys* → générer une
**Production Deploy Key** (servira à Vercel). Garde-la secrète.

## 2) Vercel

Le plus simple : **importer le dépôt GitHub** `budget-mensuel` sur
https://vercel.com/new (le code est déjà poussé).

Dans la configuration du projet Vercel :

- **Build Command** (override) :
  ```
  npx convex deploy --cmd 'npm run build'
  ```
  Cette commande déploie les fonctions Convex en prod **et** injecte
  automatiquement `VITE_CONVEX_URL` dans le build du frontend.
- **Variable d'environnement** :
  ```
  CONVEX_DEPLOY_KEY = <la Production Deploy Key générée à l'étape 1>
  ```
- Output / Install : laisser par défaut (Vercel détecte Nitro/TanStack Start).

Déclenche le déploiement. Récupère l'URL de prod (`https://<app>.vercel.app`).

## 3) Finaliser l'authentification

L'URL du site doit être connue de Convex Auth (redirections). Après le 1er
déploiement Vercel :

```bash
npx convex env set SITE_URL https://<app>.vercel.app --prod
```

(Re-déclenche un déploiement Vercel si besoin pour reprendre la valeur.)

---

## Notes

- **Secrets** : `ANTHROPIC_API_KEY` et les clés JWT vivent **uniquement** dans
  l'environnement Convex (jamais en `VITE_*`, jamais committés).
- **Base vierge en prod** : le seed (données de Janvier) n'est PAS automatique —
  il se déclenche via le bouton « Importer les données de démo ». La base de prod
  démarre donc vide.
- **CLI Vercel (alternative au dashboard)** : `vercel login` puis `vercel --prod`,
  en définissant la même Build Command et la variable `CONVEX_DEPLOY_KEY`.
- **Local vs prod** : `.env.local` (déploiement local anonyme) est ignoré par git
  et n'affecte pas la prod ; Vercel utilise `CONVEX_DEPLOY_KEY` + `VITE_CONVEX_URL`.
