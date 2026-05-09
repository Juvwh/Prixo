# Architecture et Fonctionnement de Prixo - Guide Développeur

Ce document s'adresse au(x) développeur(s) reprenant ou étendant l'application **Prixo**, afin d'expliquer l'architecture technique, les fonctionnalités existantes et le système de gestion des accès actuel, ainsi que les pistes pour l'évolution prévue (intégration de nouveaux comptes isolés).

---

## 1. Vue d'ensemble du Projet

**Prixo** est une application web responsive (destinée actuellement à un usage privé pour un couple) permettant le suivi de prix d'articles e-commerce, principalement dans le domaine de l'ameublement.

### 1.1 Stack Technique (Monorepo)

*   **Frontend (`/frontend`) :** Application Single Page (SPA) développée en **React** avec **Vite.js**. L'interface utilise **Tailwind CSS** pour le style (design scandinave minimaliste), `@dnd-kit` pour le glisser-déposer (Drag & Drop), `recharts` pour l'historique des prix et `lucide-react` pour les icônes.
*   **Backend (`/functions`) :** Logique serveur gérée par **Firebase Cloud Functions** (Node.js 20). Utilisé pour des tâches asynchrones comme le *web scraping* et l'envoi d'emails.
*   **Base de Données & Stockage :** **Firebase Firestore** (NoSQL). Les images ne sont pas stockées (on utilise l'URL source).
*   **Authentification :** **Firebase Authentication** (Email / Mot de passe). Inscription publique fermée (création manuelle des comptes dans la console Firebase).
*   **Déploiement / CI-CD :** Totalement automatisé via **GitHub Actions**. Le frontend est déployé sur **GitHub Pages** (sous le path `/Prixo/`), et le backend sur Google Cloud/Firebase via le CLI Firebase authentifié par un token. Aucun environnement de développement local lourd n'est requis pour le client (modifications directement via GitHub).

---

## 2. Fonctionnalités Principales

*   **Gestion des Articles et Tableaux :**
    *   Les articles sont organisés dans des **Tableaux** (Boards) sous forme d'une grille asymétrique (Masonry layout, style Pinterest).
    *   Les utilisateurs peuvent ajouter des articles en renseignant une URL.
    *   Système de Drag & Drop pour réorganiser manuellement les cartes au sein d'un tableau ou les déplacer d'un tableau à l'autre via une sidebar.
*   **Scraping et Suivi des Prix :**
    *   Une *Cloud Function* (`nightlyScrape`) s'exécute chaque nuit via Cloud Scheduler. Elle utilise **Puppeteer** (optimisé pour éviter les timeouts et blocages en interceptant les requêtes inutiles) pour extraire le prix (via les métadonnées JSON-LD ou des sélecteurs CSS de secours).
    *   Un bouton dans l'interface permet également de forcer le rafraîchissement des prix à la demande (par article ou par tableau complet via `refreshBoardItemsPrice`).
    *   Le statut de scraping est suivi (`scrapeStatus`: 'scraping', 'success', 'error') pour informer l'utilisateur en cas de problème (ex: produit introuvable ou site bloquant les bots).
*   **Notifications :**
    *   Notifications in-app (icône cloche) qui comparent les dates de baisse de prix avec un marqueur `lastNotificationReadAt`.
    *   Notifications par email (via l'API **Resend**) envoyées après le batch de scraping nocturne pour résumer les baisses ou hausses de prix.
*   **Budget partiel :** Mode de sélection dans l'interface permettant de cocher des articles pour calculer dynamiquement un total.

---

## 3. Modèle de Données et Sécurité (État Actuel)

Actuellement, l'application est conçue pour fonctionner avec un cercle fermé de **2 utilisateurs** (un couple).

### 3.1 Gestion de la Confidentialité (Public vs Privé)

Il n'y a pas de rôle "Admin" ou "Utilisateur standard". La distinction se fait au niveau de la **confidentialité des documents** (Articles et Tableaux) :
*   **Partagé (Public) :** Par défaut, un article ou un tableau créé est accessible en lecture à *tous les utilisateurs connectés*.
*   **Privé :** Lors de la création ou l'édition, l'utilisateur peut cocher une option "Privé" (représentée par un cadenas). Ce document devient alors exclusif.

### 3.2 Règles Firestore Actuelles

Les règles Firestore (`firestore.rules`) garantissent cette sécurité :

```javascript
match /items/{itemId} {
  // Lecture : soit l'article n'est pas privé, soit l'utilisateur en est le créateur
  allow read: if request.auth != null &&
              (!resource.data.isPrivate || resource.data.userId == request.auth.uid);
  allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
  allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
}
```
*(Les mêmes règles s'appliquent pour les collections `boards` avec le champ `ownerId` au lieu de `userId`).*

### 3.3 Récupération des Données (Frontend & Backend)

*   Dans le frontend (ex: `Dashboard.tsx`), l'application écoute la collection globale (ex: tout ce qui correspond aux règles de sécurité).
*   Dans le backend (ex: pour l'envoi d'emails), les requêtes pour récupérer "tous les articles" utilisent un `Filter.or` combinant `isPrivate == false` ou `userId == [uid utilisateur]`.

---

## 4. Évolution Prévue : Ajout de nouveaux comptes isolés

**Besoin exprimé :** Ajouter deux nouveaux utilisateurs (un autre couple) qui partageront un Dashboard vide entre eux, de façon totalement isolée et hermétique par rapport aux deux comptes existants.

### 4.1 Le Problème du Modèle Actuel
Actuellement, un article `isPrivate == false` est lisible par **TOUS** les utilisateurs authentifiés de la base de données. Si on ajoute deux nouveaux utilisateurs dans le projet Firebase actuel, ils verront tous les articles "partagés" du premier couple.

### 4.2 Solutions d'Architecture Recommandées pour le Dev

Pour implémenter cette isolation, il faudra introduire la notion de **"Foyer"**, **"Groupe"** ou **"Workspace"**. Voici les modifications majeures à prévoir :

#### A. Mise à jour de la Base de Données
1.  **Collection `users` :** Ajouter un champ `groupId` ou `workspaceId` (ex: `group_A` pour le couple 1, `group_B` pour le couple 2).
2.  **Collections `items` et `boards` :** Lors de la création, chaque document devra désormais inclure ce `groupId`.

#### B. Mise à jour des Règles Firestore
Il faudra modifier les `firestore.rules` pour que la condition "partagé" ne signifie plus "visible par tout le monde", mais "visible par les membres de mon groupe".
*Exemple de logique :*
```javascript
// Fonction utilitaire pour récupérer le groupId de l'utilisateur
function getUserGroup() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.groupId;
}

match /items/{itemId} {
  // Lecture permise si l'article appartient au même groupe ET (n'est pas privé OU m'appartient)
  allow read: if request.auth != null &&
              resource.data.groupId == getUserGroup() &&
              (!resource.data.isPrivate || resource.data.userId == request.auth.uid);
  // ...
}
```

#### C. Mise à jour du Frontend (React)
Dans les requêtes Firestore (dans le dossier `frontend/src`), il faudra systématiquement ajouter un filtre `.where('groupId', '==', currentUser.groupId)` lors des requêtes `onSnapshot` ou `getDocs`, afin de se conformer aux nouvelles règles de sécurité et de ne récupérer que les données du foyer concerné.

#### D. Mise à jour du Backend (Cloud Functions)
*   **Scraping & Emails :** Le script d'envoi d'emails regroupe actuellement les données de tout le monde. Il faudra le refactoriser pour qu'il itère par `groupId`. Ainsi, il pourra générer un e-mail de synthèse pour le Groupe A, et un e-mail séparé pour le Groupe B, en fonction de leurs articles respectifs.

---

**Conclusion pour le développeur :** La base de code est moderne et propre (React/Vite + Firebase). L'enjeu principal du prochain ticket sera de passer d'un modèle de données "Global vs Privé" à un modèle "Tenant (Workspace) -> Global (au sein du tenant) vs Privé", en sécurisant le tout via les règles Firestore.