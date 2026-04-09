# Instructions de Déploiement et Configuration

Suite à la mise en place de l'édition des tableaux et du rafraîchissement groupé des prix, voici les étapes nécessaires pour déployer et configurer le backend sur Google Cloud / Firebase.

## 1. Déploiement de la nouvelle Cloud Function

La nouvelle fonction s'appelle `refreshBoardItemsPrice`. Pour la déployer sur Firebase, vous (ou votre workflow d'intégration continue GitHub Actions) devez exécuter la commande suivante depuis le répertoire `functions` :

```bash
cd functions
npm install
npm run build
firebase deploy --only functions:refreshBoardItemsPrice
```
*(Si votre déploiement est entièrement automatisé via GitHub Actions, il vous suffit de valider et de pousser ces modifications sur la branche principale)*

## 2. Configuration des ressources (Mémoire et Timeout)

La fonction est configurée dans le code pour demander **2 Go de RAM** (`memory: '2GB'`) et un **délai d'expiration de 540 secondes** (9 minutes) (`timeoutSeconds: 540`).

Cependant, il est **fortement recommandé** de vérifier ces paramètres dans la console Google Cloud après le déploiement, car les instances Firebase peuvent parfois limiter ces valeurs selon votre plan de facturation ou les quotas par défaut.

**Vérification manuelle via la console Google Cloud :**
1. Allez sur la [Console Google Cloud](https://console.cloud.google.com/).
2. Sélectionnez votre projet Prixo.
3. Dans le menu de navigation à gauche, allez dans **Cloud Run** (les fonctions Firebase Gen 1 / Gen 2 sont souvent visibles ici ou sous *Cloud Functions*).
4. Cliquez sur la fonction `refreshBoardItemsPrice`.
5. Cliquez sur **MODIFIER** en haut de la page.
6. Dans la section *Capacité allouée* (ou *Ressources*), vérifiez que la **Mémoire allouée** est bien à **2 Gio**.
7. Défilez vers le bas jusqu'à la section *Délai d'expiration de la requête*, et assurez-vous qu'il est réglé sur **540 secondes** (ou plus si les tableaux deviennent très grands à l'avenir).
8. Si vous avez fait des modifications, cliquez sur **Déployer** ou **Enregistrer** en bas de page.

## 3. Règles de sécurité Firestore (Aucune modification requise)

L'édition du nom des tableaux utilise la méthode standard `updateDoc` sur la collection `boards`. Les règles existantes (dans `firestore.rules`) sont déjà correctement configurées pour permettre la mise à jour :

```javascript
match /boards/{boardId} {
  allow read: if request.auth != null &&
              (!resource.data.isPrivate || resource.data.ownerId == request.auth.uid);
  allow create: if request.auth != null && request.resource.data.ownerId == request.auth.uid;
  allow update, delete: if request.auth != null && resource.data.ownerId == request.auth.uid;
}
```

La règle `allow update` s'assure que seul le propriétaire du tableau (`ownerId == request.auth.uid`) peut en modifier le nom, ce qui sécurise parfaitement la nouvelle fonctionnalité. Vous n'avez donc **aucune modification manuelle** à apporter aux règles Firestore.

## 4. Vérification post-déploiement

Une fois le code poussé et déployé :
1. Connectez-vous à Prixo.
2. Survolez un tableau dans la barre latérale gauche ; l'icône "Roue dentée" doit apparaître.
3. Cliquez dessus, modifiez le nom du tableau, et sauvegardez pour vérifier la mise à jour instantanée.
4. Rouvrez la modale et cliquez sur **Actualiser les prix du tableau**. Une icône de chargement s'affichera le temps que la fonction Puppeteer scrape tous les articles du tableau. La modale se fermera automatiquement si tout s'est bien passé, ou vous affichera une erreur le cas échéant.
