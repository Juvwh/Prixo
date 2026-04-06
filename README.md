# Prixo

Application web responsive de suivi de prix d'articles e-commerce d'ameublement.

## Structure du Monorepo

- `frontend/` : Application React avec Vite.js et Tailwind CSS.
- `functions/` : Backend avec Firebase Cloud Functions (Scraping, Emails).

## Configuration Firebase Manuelle

Pour que le projet fonctionne correctement, il faut configurer manuellement certains services sur la console Firebase.

### 1. Authentication
- Aller dans la console Firebase -> Build -> Authentication.
- Activer la méthode de connexion par Email/Mot de passe.
- Créer **uniquement** 2 utilisateurs avec des adresses email et mots de passe.
- Le projet ne permet pas l'inscription d'autres utilisateurs. L'authentification est fermée.

### 2. Firestore Database
- Aller dans Firebase -> Build -> Firestore Database.
- Créer la base de données.
- Utiliser les règles de sécurité suivantes pour assurer la confidentialité :

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /items/{itemId} {
      // Lecture permise si l'utilisateur est authentifié et
      // (l'article n'est pas privé OU c'est le sien)
      allow read: if request.auth != null &&
                  (!resource.data.isPrivate || resource.data.userId == request.auth.uid);

      // Création permise si l'utilisateur est authentifié
      allow create: if request.auth != null;

      // Modification / Suppression permises si c'est l'auteur de l'article
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
  }
}
```

### 3. Cloud Functions (Plan Blaze requis)
- Le projet Firebase doit être sur le plan **Blaze** (Pay as you go) pour utiliser les Cloud Functions avec Node.js 18+ (ou 20+).
- L'utilisation de puppeteer et `@sparticuz/chromium` nécessite ce plan.

### 4. Resend API Key (Envoi d'emails)
- Pour l'envoi d'emails récapitulatifs, une clé API Resend est nécessaire.
- Configurer le secret dans Google Cloud Secret Manager (ou Firebase Functions config) :
  `firebase functions:secrets:set RESEND_API_KEY`

### 5. Déploiement

#### Frontend
Le frontend est configuré pour se déployer automatiquement via GitHub Actions sur GitHub Pages lors d'un push sur `main`. L'application sera accessible sous `/Prixo/`.

#### Backend
Les Cloud Functions sont configurées pour se déployer via GitHub Actions.
Il faut ajouter la variable secrète `FIREBASE_TOKEN` dans les secrets du repository GitHub pour l'authentification du déploiement. (Obtenu via `firebase login:ci`).

## Développement local

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend (Functions)
```bash
cd functions
npm install
npm run serve
```
