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
## Présentation Globale et Contraintes d'Infrastructure
Ce dépôt contient un monorepo abritant une application web de suivi de prix d'ameublement, destinée à un usage privé et exclusif pour deux utilisateurs. La contrainte architecturale majeure est l'absence totale d'environnement de développement local : toutes les modifications, validations et déploiements sont pilotés exclusivement depuis l'interface web de GitHub. Par conséquent, l'infrastructure repose sur des workflows GitHub Actions automatisés, utilisant un secret FIREBASE_TOKEN pour déployer le backend, et une compilation Vite.js configurée avec le bon chemin de base pour héberger le frontend sur GitHub Pages. Le dossier frontend utilise le framework React couplé à Tailwind CSS, tandis que le dossier backend héberge des Google Cloud Functions écrites en Node.js pour interagir avec l'écosystème Firebase.

## Base de Données, Sécurité et Confidentialité
L'application s'appuie sur Firestore et impose une séparation stricte entre le contenu partagé au sein du couple et les espaces privés. Il n'existe aucun système d'inscription publique ; l'authentification se limite à deux comptes créés manuellement. La base de données gère une relation complexe de type plusieurs-à-plusieurs, permettant à un même article d'être assigné à divers tableaux. Les règles de sécurité (firestore.rules) sont le pilier de l'application : elles interdisent catégoriquement la lecture, la modification ou la suppression d'un article ou d'un tableau marqué comme privé par quiconque d'autre que son créateur unique identifié par son UID. De plus, l'ordre de tri personnalisé des articles, défini par l'utilisateur via glisser-déposer, est sauvegardé de manière persistante directement au sein du document Firestore de chaque tableau.

## Interface Utilisateur (UI) et Expérience (UX)
Le design frontend respecte une esthétique minimaliste scandinave, caractérisée par des tons blancs chauds, des pastels doux et une typographie sombre. La navigation centrale s'organise autour d'une grille asymétrique (masonry layout) inspirée de Pinterest. La barre latérale gauche sépare visuellement les tableaux partagés des tableaux privés et intègre un bouton de création de dossiers. L'interface propose des fonctionnalités interactives avancées, notamment un système de glisser-déposer pour réorganiser ou assigner les cartes produits, des options de tri multicritère, et un mode sélection modifiant temporairement le comportement des clics pour calculer dynamiquement un budget partiel basé sur les articles cochés. Un système de notification, matérialisé par une cloche dans l'en-tête, compare la date de mise à jour des articles avec le marqueur temporel de dernière consultation de l'utilisateur pour afficher un compteur dynamique de baisses de prix non lues.

## Logique Métier, Web Scraping et Automatisation
Le cœur fonctionnel du backend est un cron job orchestré par Google Cloud Scheduler, déclenchant chaque nuit à trois heures du matin un script de web scraping sur toutes les URL enregistrées. Pour éviter les erreurs de dépassement de délai (timeout), cette Cloud Function utilise une instance optimisée de Puppeteer configurée pour bloquer drastiquement le chargement des images, polices et feuilles de style. Le script impose un délai d'expiration strict de vingt secondes par page et exécute ses requêtes par petits lots concurrents. Il privilégie l'extraction des métadonnées JSON-LD des sites e-commerce avant de recourir à des sélecteurs CSS de secours. Une fois ce processus de masse terminé, le système interroge la collection sécurisée des utilisateurs pour récupérer leurs adresses e-mail respectives et utilise un service tiers comme Resend pour expédier un rapport global détaillant les variations tarifaires.
