# AGENTS.md - Contexte et Architecture du Projet "Price Tracker"

## 🎯 Objectif du Projet
Développer une application web responsive (desktop/mobile) de suivi de prix d'articles e-commerce, principalement axée sur l'ameublement (Ikea, Jysk, Maisons du Monde, etc.). L'application est destinée à un usage privé pour un couple (deux utilisateurs). Elle permet de surveiller l'évolution des prix, de classer les articles dans des tableaux (façon Pinterest) et d'envoyer des alertes par e-mail.

## 🛠 Stack Technique Exigée
* **Backend & Base de données :** Firebase (Firestore pour la base de données NoSQL).
* **Authentification :** Firebase Authentication (Email/Mot de passe ou Google).
* **Logique Serveur / API :** Firebase Cloud Functions (Node.js).
* **Automatisation (Cron Jobs) :** Google Cloud Scheduler.
* **Scraping Web :** Outil robuste capable de lire le rendu dynamique (JavaScript) ou les métadonnées (JSON-LD), tel que Puppeteer ou équivalent.
* **Frontend :** Au choix (React, Vue, etc.), mais doit être responsive, léger et intégrer des graphiques (ex: Chart.js ou Recharts).

## 👤 Rôles et Sécurité (Firestore Rules)
* **Comptes distincts :** Chaque membre du couple a son propre compte.
* **Confidentialité des données :** Le système doit gérer des articles "Partagés" (visibles par les deux) et "Privés" (visibles uniquement par le créateur). Ceci est crucial pour gérer des listes de cadeaux surprises.
* **Règles Firestore :** Les `firestore.rules` doivent être strictement configurées pour empêcher un utilisateur d'accéder aux articles marqués comme `private` par l'autre utilisateur.

## ⚙️ Fonctionnalités Principales
1.  **Ajout d'articles simplifié :** Formulaire minimaliste. Champs requis : Nom, Catégorie (Tableau/Sous-tableau), URL de la page produit, URL de l'image (optionnelle, pas de stockage de fichier), et un toggle booléen "Coup de cœur".
2.  **Affichage et Navigation :** * Organisation en tableaux et sous-tableaux.
    * Les articles marqués "Coup de cœur" (icône cœur plein) s'affichent en tête de liste.
    * Les articles privés sont identifiables par une petite icône de cadenas.
3.  **Page de Détail de l'Article :**
    * Affiche l'image, le prix actuel, et un graphique interactif de l'historique des prix.
    * Bouton **"Actualiser"** : Déclenche une Cloud Function unitaire pour scrapper l'URL à la demande et mettre à jour le prix immédiatement.
    * Options pour modifier les données de l'article (nom, catégorie, URLs).
4.  **Scraping Nocturne (Batch) :**
    * Exécuté chaque jour à 03h00 AM via Cloud Scheduler.
    * Parcourt toutes les URL actives en base de données, extrait les prix, et met à jour l'historique de chaque article.
5.  **Notifications par E-mail :**
    * Envoyé à la fin du scraping nocturne.
    * Regroupe tous les changements dans un seul e-mail de synthèse pour les deux utilisateurs (en respectant la visibilité des articles privés).
    * Structure de l'e-mail : 1. Les articles dont le prix a baissé (mis en avant). 2. Les articles dont le prix a augmenté.

## 🎨 Directives de Design (UI/UX)
* **Style :** Minimaliste scandinave, épuré, professionnel.
* **Palette de couleurs :** Neutres (blancs chauds), pastels doux (vert menthe, gris clair), typographie sombre pour le contraste et la lisibilité.
* **Layout :** Grille asymétrique (Masonry layout) inspirée de Pinterest pour le tableau de bord.
* **Indicateurs visuels :** * Flèche verte descendante explicite lors d'une baisse de prix sur la carte produit.
    * Mini-graphique d'évolution intégré directement sur chaque carte produit (Sparkline).
    * Ombres portées subtiles pour créer de la profondeur (Flat design moderne).
