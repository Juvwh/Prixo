# Guide de Configuration et de Déploiement - Prixo

Ce document liste toutes les étapes manuelles que vous devez effectuer pour configurer correctement votre projet Firebase et votre dépôt GitHub afin de permettre le déploiement automatisé et le bon fonctionnement de l'application.

## 1. Configuration sur la Console Firebase

### A. Passage au Plan Blaze (Payant à l'usage)
Le scraping externe via Puppeteer nécessite des connexions réseaux sortantes qui ne sont autorisées que sur le plan Blaze de Firebase.
1. Allez sur la [Console Firebase](https://console.firebase.google.com/).
2. Sélectionnez votre projet **prixo-46167**.
3. En bas à gauche dans le menu de navigation, cliquez sur le bouton **"Mettre à jour"** (Upgrade).
4. Sélectionnez le plan **"Blaze (Paiement à l'usage)"**.
5. Suivez les instructions pour associer une carte bancaire et un compte de facturation Google Cloud (il y a un quota gratuit généreux, vous ne serez facturé que si l'usage le dépasse).

### B. Configuration de l'Authentification et des Domaines Autorisés
Afin que la page hébergée sur GitHub Pages puisse se connecter à Firebase Auth sans être bloquée :
1. Dans la console Firebase, allez dans la section **"Authentication"** > onglet **"Settings"** (Paramètres).
2. Dans la liste des **"Authorized domains"** (Domaines autorisés), cliquez sur **"Add domain"** (Ajouter un domaine).
3. Entrez l'URL de votre domaine GitHub Pages. Par exemple : `votre-nom-utilisateur.github.io`.
4. Cliquez sur **"Add"**.

### C. Initialisation de Firestore en Mode Production
1. Dans la console Firebase, allez dans **"Firestore Database"**.
2. Cliquez sur **"Create database"**.
3. Choisissez l'emplacement (Location) de votre base de données (ex: `eur3` ou `europe-west`). Notez qu'on ne peut pas changer ce choix plus tard.
4. Sélectionnez **"Start in production mode"** (Démarrer en mode production). *Les règles de sécurité que j'ai configurées dans le code source seront automatiquement déployées par la suite et remplaceront les règles par défaut.*
5. Cliquez sur **"Enable"** (Activer).

### D. Obtenir un Token Firebase (FIREBASE_TOKEN)
Pour que GitHub Actions puisse déployer vos fonctions et vos règles de sécurité, il lui faut une autorisation.
1. Ouvrez un terminal sur votre machine locale.
2. Si vous n'avez pas Firebase CLI d'installé : `npm install -g firebase-tools`
3. Tapez la commande : `firebase login:ci`
4. Une page web va s'ouvrir pour vous connecter à votre compte Google.
5. Une fois connecté, le terminal affichera un long token (ex: `1//0cxxxxxxxx...`). **Copiez ce token**, vous en aurez besoin à l'étape suivante.

---

## 2. Configuration sur GitHub

### A. Ajout du Secret Firebase
1. Allez sur la page de votre dépôt sur **GitHub**.
2. Cliquez sur **"Settings"** (Paramètres) > **"Secrets and variables"** > **"Actions"**.
3. Cliquez sur le bouton vert **"New repository secret"**.
4. Dans le champ **Name**, écrivez exactement : `FIREBASE_TOKEN`
5. Dans le champ **Secret**, collez le token obtenu à l'étape 1.D.
6. Cliquez sur **"Add secret"**.

### B. Activation de GitHub Pages avec Actions
1. Toujours dans les **"Settings"** de votre dépôt GitHub, allez dans la section **"Pages"** (dans le menu de gauche).
2. Sous la section **"Build and deployment"** > **"Source"**, sélectionnez l'option **"GitHub Actions"** dans le menu déroulant (au lieu de "Deploy from a branch").
3. Assurez-vous que le paramètre `base` dans le fichier `frontend/vite.config.ts` correspond bien à `'/Prixo/'` (ou le nom exact de votre dépôt, s'il est différent de Prixo, il faudra modifier le code).

Une fois toutes ces étapes réalisées, chaque modification poussée sur la branche `main` déclenchera automatiquement la compilation du site, son déploiement sur GitHub Pages, ainsi que le déploiement de vos fonctions Cloud et de vos règles Firestore !
