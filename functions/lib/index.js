"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testEmailNotification = exports.nightlyScrape = exports.refreshItemPrice = exports.refreshBoardItemsPrice = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const chromium_1 = __importDefault(require("@sparticuz/chromium"));
const resend_1 = require("resend");
admin.initializeApp();
const db = admin.firestore();
// Helper to sleep for a given number of milliseconds
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Helper to scrape a single URL
async function scrapePrice(url, existingBrowser) {
    let browser = existingBrowser || null;
    let page = null;
    let ownBrowser = !existingBrowser; // Keep track of whether we launched it
    try {
        if (!browser) {
            browser = await puppeteer_core_1.default.launch({
                args: chromium_1.default.args,
                defaultViewport: { width: 1920, height: 1080 },
                executablePath: await chromium_1.default.executablePath(),
                headless: true,
            });
        }
        page = await browser.newPage();
        // Block unnecessary resources to speed up page load
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            }
            else {
                req.continue();
            }
        });
        // Simulate mobile/desktop to avoid simple bot blocks
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
        try {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            if (response && response.status() === 403) {
                return { price: null, error: "Protection anti-bot ou accès refusé (Erreur 403)" };
            }
        }
        catch (gotoError) {
            if (gotoError.message && gotoError.message.includes('Timeout')) {
                return { price: null, error: "Délai d'attente dépassé (timeout)" };
            }
            throw gotoError;
        }
        // Check for redirection
        const finalUrl = page.url();
        if (finalUrl && finalUrl !== url && finalUrl !== 'about:blank') {
            try {
                const originalUrlObj = new URL(url);
                const finalUrlObj = new URL(finalUrl);
                const normalizePath = (p) => p.replace(/\/$/, '');
                if (originalUrlObj.hostname.replace(/^www\./, '') !== finalUrlObj.hostname.replace(/^www\./, '') ||
                    normalizePath(originalUrlObj.pathname) !== normalizePath(finalUrlObj.pathname)) {
                    return { price: null, error: "Article introuvable" };
                }
            }
            catch (e) {
                // Ignore URL parsing errors and continue
            }
        }
        // 1. Try to extract from JSON-LD
        const jsonLdData = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    // Check for single product or array
                    const items = Array.isArray(data) ? data : [data];
                    for (const item of items) {
                        if (item['@type'] === 'Product' || item['@type'] === 'ItemPage' || item['@type'] === 'ProductGroup') {
                            if (item.offers) {
                                const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                                for (const offer of offers) {
                                    if (offer.price) {
                                        return parseFloat(offer.price);
                                    }
                                    else if (offer.lowPrice) {
                                        return parseFloat(offer.lowPrice);
                                    }
                                    else if (offer.offers) {
                                        const subOffers = Array.isArray(offer.offers) ? offer.offers : [offer.offers];
                                        for (const subOffer of subOffers) {
                                            if (subOffer.price)
                                                return parseFloat(subOffer.price);
                                        }
                                    }
                                }
                            }
                            // Check hasVariant for ProductGroup
                            if (item.hasVariant) {
                                const variants = Array.isArray(item.hasVariant) ? item.hasVariant : [item.hasVariant];
                                for (const variant of variants) {
                                    if (variant.offers) {
                                        const offers = Array.isArray(variant.offers) ? variant.offers : [variant.offers];
                                        for (const offer of offers) {
                                            if (offer.price) {
                                                return parseFloat(offer.price);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                catch (e) {
                    // Ignore parse errors and continue
                }
            }
            return null;
        });
        if (jsonLdData)
            return { price: jsonLdData, error: null };
        // 2. Fallback to common CSS selectors if JSON-LD fails
        const priceText = await page.evaluate(() => {
            // List of common selectors for IKEA, Maisons du Monde, Amazon etc.
            const selectors = [
                '.pip-temp-price__integer', // IKEA
                '[data-test-target="price"]',
                '.price',
                '.current-price',
                'span[itemprop="price"]',
                '.product-price',
                '.a-price .a-offscreen', // Amazon
                '.a-price.a-text-price .a-offscreen', // Amazon
                '#priceblock_ourprice', // Amazon old
                '#priceblock_dealprice', // Amazon old
                '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen' // Amazon
            ];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) {
                    return el.textContent;
                }
            }
            return null;
        });
        if (priceText) {
            // Clean string to extract number (e.g., "1 299,00 €" -> 1299.00)
            const cleaned = priceText.replace(/[^0-9,.]/g, '').replace(',', '.');
            const parsed = parseFloat(cleaned);
            if (!isNaN(parsed))
                return { price: parsed, error: null };
        }
        return { price: null, error: "Sélecteur de prix introuvable sur la page" };
    }
    catch (error) {
        console.error(`Error scraping ${url}:`, error);
        if (error.message && error.message.includes('Timeout')) {
            return { price: null, error: "Délai d'attente dépassé (timeout)" };
        }
        return { price: null, error: "Erreur technique lors du chargement de la page" };
    }
    finally {
        if (page !== null) {
            await page.close().catch(() => { });
        }
        if (ownBrowser && browser !== null) {
            await browser.close().catch(() => { });
        }
    }
}
// Callable function to refresh all items in a board
exports.refreshBoardItemsPrice = functions
    .region('europe-west1')
    .runWith({ memory: '2GB', timeoutSeconds: 540 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const { boardId } = data;
    if (!boardId) {
        throw new functions.https.HttpsError('invalid-argument', 'Board ID is required.');
    }
    let itemsSnapshot;
    if (boardId === 'all') {
        // Get all items accessible to the user (their own items + public items)
        // Since this application is intended for a very small number of users,
        // we can safely scrape all public items + the user's own items.
        itemsSnapshot = await db.collection('items')
            .where(admin.firestore.Filter.or(admin.firestore.Filter.where('isPrivate', '==', false), admin.firestore.Filter.where('userId', '==', context.auth.uid)))
            .get();
    }
    else if (boardId === 'favorites') {
        // Get all favorite items belonging to the user
        itemsSnapshot = await db.collection('items')
            .where('userId', '==', context.auth.uid)
            .where('isFavorite', '==', true)
            .get();
    }
    else {
        // Verify board existence and permissions for standard boards
        const boardRef = db.collection('boards').doc(boardId);
        const boardSnap = await boardRef.get();
        if (!boardSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Board not found.');
        }
        const boardData = boardSnap.data();
        if (boardData?.isPrivate && boardData?.ownerId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'Cannot access private board.');
        }
        // Get all items associated with this specific board
        itemsSnapshot = await db.collection('items')
            .where('boards', 'array-contains', boardId)
            .get();
    }
    const docs = itemsSnapshot.docs;
    if (docs.length === 0) {
        return { success: true, message: 'Aucun article dans ce tableau.', updatedCount: 0 };
    }
    // Launch a single browser instance for the entire batch
    let browser = null;
    try {
        browser = await puppeteer_core_1.default.launch({
            args: chromium_1.default.args,
            defaultViewport: { width: 1920, height: 1080 },
            executablePath: await chromium_1.default.executablePath(),
            headless: true,
        });
    }
    catch (err) {
        console.error("Failed to launch browser for refreshBoardItemsPrice:", err);
        throw new functions.https.HttpsError('internal', 'Failed to launch scraping browser.');
    }
    const CONCURRENCY = 3; // Process up to 3 pages concurrently
    let updatedCount = 0;
    try {
        for (let i = 0; i < docs.length; i += CONCURRENCY) {
            const batch = docs.slice(i, i + CONCURRENCY);
            const batchPromises = batch.map(async (doc, index) => {
                try {
                    // Jitter: random delay between 2 and 4 seconds between starts
                    if (index > 0) {
                        const jitter = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000);
                        await sleep(jitter * index);
                    }
                    const itemData = doc.data();
                    // Skip private items that don't belong to the user
                    if (itemData.userId !== context.auth?.uid && itemData.isPrivate) {
                        await doc.ref.update({
                            scrapeStatus: 'error',
                            lastScrapeError: "Non autorisé : article privé appartenant à un autre utilisateur"
                        });
                        return;
                    }
                    // Set scrapeStatus to 'scraping' right before attempting to scrape
                    await doc.ref.update({
                        scrapeStatus: 'scraping',
                        lastChecked: new Date().toISOString()
                    });
                    const oldPrice = itemData.currentPrice;
                    const { price: newPrice, error: scrapeError } = await scrapePrice(itemData.url, browser || undefined);
                    const updateData = {
                        lastChecked: new Date().toISOString()
                    };
                    if (newPrice !== null) {
                        updateData.scrapeStatus = 'success';
                        if (newPrice !== oldPrice) {
                            const today = new Date().toISOString().split('T')[0];
                            let history = itemData.history || [];
                            if (history.length > 0 && history[history.length - 1].date === today) {
                                history[history.length - 1] = { date: today, price: newPrice };
                            }
                            else {
                                history.push({ date: today, price: newPrice });
                            }
                            updateData.currentPrice = newPrice;
                            updateData.history = history;
                            updateData.lastScrapeError = admin.firestore.FieldValue.delete();
                            updatedCount++;
                        }
                        else {
                            updateData.lastScrapeError = admin.firestore.FieldValue.delete();
                        }
                    }
                    else {
                        // Scraping failed
                        updateData.scrapeStatus = 'error';
                        updateData.lastScrapeError = scrapeError || "Erreur inconnue lors du scraping";
                    }
                    // Clean up old scrapeError field if it exists
                    updateData.scrapeError = admin.firestore.FieldValue.delete();
                    await doc.ref.update(updateData);
                }
                catch (err) {
                    try {
                        await doc.ref.update({
                            scrapeStatus: 'error',
                            lastScrapeError: err instanceof Error ? err.message : "Erreur inattendue"
                        });
                    }
                    catch (updateErr) {
                        console.error(`Failed to update error state for doc ${doc.id}:`, updateErr);
                    }
                    console.error(`Error processing doc ${doc.id} in board scrape:`, err);
                }
            });
            await Promise.allSettled(batchPromises);
        }
    }
    finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
    return { success: true, message: `Mise à jour terminée. ${updatedCount} prix modifiés sur ${docs.length} articles.`, updatedCount };
});
// Callable function to refresh a single item (triggered from UI)
exports.refreshItemPrice = functions
    .region('europe-west1')
    .runWith({ memory: '2GB', timeoutSeconds: 300 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const { itemId } = data;
    if (!itemId) {
        throw new functions.https.HttpsError('invalid-argument', 'Item ID is required.');
    }
    const itemRef = db.collection('items').doc(itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Item not found.');
    }
    const itemData = itemSnap.data();
    if (itemData?.userId !== context.auth.uid && itemData?.isPrivate) {
        throw new functions.https.HttpsError('permission-denied', 'Cannot refresh private item.');
    }
    const { price: newPrice, error: scrapeError } = await scrapePrice(itemData?.url);
    if (newPrice !== null && newPrice !== itemData?.currentPrice) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const newHistoryEntry = { date: today, price: newPrice };
        let history = itemData?.history || [];
        // If we already have an entry for today, replace it, otherwise append
        if (history.length > 0 && history[history.length - 1].date === today) {
            history[history.length - 1] = newHistoryEntry;
        }
        else {
            history.push(newHistoryEntry);
        }
        await itemRef.update({
            currentPrice: newPrice,
            history: history,
            lastChecked: new Date().toISOString(),
            isScraping: false,
            lastScrapeError: admin.firestore.FieldValue.delete(),
            scrapeError: admin.firestore.FieldValue.delete()
        });
        return { success: true, newPrice };
    }
    else {
        // Just update the last check time, and handle potential failure
        const updateData = {
            lastChecked: new Date().toISOString(),
            isScraping: false,
            scrapeError: admin.firestore.FieldValue.delete()
        };
        if (newPrice === null) {
            updateData.lastScrapeError = scrapeError || "Erreur inconnue lors du scraping";
        }
        else {
            updateData.lastScrapeError = admin.firestore.FieldValue.delete();
        }
        await itemRef.update(updateData);
        // Do not return FieldValue.delete() to the client
        const returnError = newPrice === null ? updateData.lastScrapeError : null;
        return { success: true, message: 'Price unchanged or scraping failed.', currentPrice: itemData?.currentPrice, lastScrapeError: returnError };
    }
});
// Scheduled function to scrape all items and send summary email
exports.nightlyScrape = functions
    .region('europe-west1')
    .runWith({ memory: '2GB', timeoutSeconds: 540, secrets: ["RESEND_API_KEY"] })
    .pubsub.schedule('30 6 * * *') // Every day at 6:30 AM
    .timeZone('Europe/Paris')
    .onRun(async (context) => {
    const itemsSnapshot = await db.collection('items').get();
    const changes = [];
    const docs = itemsSnapshot.docs;
    // Launch a single browser instance for the entire batch
    let browser = null;
    try {
        browser = await puppeteer_core_1.default.launch({
            args: chromium_1.default.args,
            defaultViewport: { width: 1920, height: 1080 },
            executablePath: await chromium_1.default.executablePath(),
            headless: true,
        });
    }
    catch (err) {
        console.error("Failed to launch browser for nightlyScrape:", err);
        return null;
    }
    const CONCURRENCY = 3; // Process up to 3 pages concurrently
    for (let i = 0; i < docs.length; i += CONCURRENCY) {
        const batch = docs.slice(i, i + CONCURRENCY);
        const batchPromises = batch.map(async (doc, index) => {
            try {
                // Jitter: random delay between 2 and 4 seconds between starts
                if (index > 0) {
                    const jitter = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000);
                    await sleep(jitter * index);
                }
                const itemData = doc.data();
                const oldPrice = itemData.currentPrice;
                const { price: newPrice, error: scrapeError } = await scrapePrice(itemData.url, browser || undefined);
                const updateData = {
                    lastChecked: new Date().toISOString(),
                    scrapeError: admin.firestore.FieldValue.delete()
                };
                if (newPrice !== null) {
                    if (newPrice !== oldPrice) {
                        changes.push({
                            name: itemData.name,
                            oldPrice: oldPrice,
                            newPrice: newPrice,
                            url: itemData.url,
                            ownerId: itemData.userId,
                            diff: newPrice - oldPrice
                        });
                        const today = new Date().toISOString().split('T')[0];
                        let history = itemData.history || [];
                        if (history.length > 0 && history[history.length - 1].date === today) {
                            history[history.length - 1] = { date: today, price: newPrice };
                        }
                        else {
                            history.push({ date: today, price: newPrice });
                        }
                        updateData.currentPrice = newPrice;
                        updateData.history = history;
                        updateData.lastScrapeError = admin.firestore.FieldValue.delete();
                    }
                    else {
                        updateData.lastScrapeError = admin.firestore.FieldValue.delete();
                    }
                }
                else {
                    updateData.lastScrapeError = scrapeError || "Erreur inconnue lors du scraping";
                }
                await doc.ref.update(updateData);
            }
            catch (err) {
                try {
                    await doc.ref.update({
                        scrapeStatus: 'error',
                        lastScrapeError: err instanceof Error ? err.message : "Erreur inattendue"
                    });
                }
                catch (updateErr) {
                    console.error(`Failed to update error state for doc ${doc.id}:`, updateErr);
                }
                console.error(`Error processing doc ${doc.id}:`, err);
            }
        });
        await Promise.allSettled(batchPromises);
    }
    if (browser) {
        await browser.close().catch(() => { });
    }
    // Process and send email if there are changes
    if (changes.length > 0) {
        // Sort: Price drops first, then price increases
        changes.sort((a, b) => a.diff - b.diff);
        const resendApiKey = process.env.RESEND_API_KEY;
        if (!resendApiKey) {
            console.error("RESEND_API_KEY missing");
            return null;
        }
        const resend = new resend_1.Resend(resendApiKey);
        // Fetch the emails dynamically by getting UIDs from the 'users' collection
        const usersCollectionSnapshot = await db.collection('users').get();
        const emails = [];
        for (const userDoc of usersCollectionSnapshot.docs) {
            try {
                const userRecord = await admin.auth().getUser(userDoc.id);
                if (userRecord.email) {
                    emails.push(userRecord.email);
                }
            }
            catch (err) {
                console.error(`Failed to fetch email for user ${userDoc.id}:`, err);
            }
        }
        if (emails.length > 0) {
            let htmlContent = '<h2>Récapitulatif des changements de prix</h2><ul>';
            for (const change of changes) {
                const color = change.diff < 0 ? 'green' : 'red';
                const arrow = change.diff < 0 ? '↓' : '↑';
                htmlContent += `
            <li style="margin-bottom: 10px;">
              <strong>${change.name}</strong><br/>
              Ancien prix: ${change.oldPrice}€ | Nouveau prix: <span style="color:${color}">${change.newPrice}€ ${arrow}</span><br/>
              <a href="${change.url}">Voir sur le site</a>
            </li>
           `;
            }
            htmlContent += '</ul>';
            await resend.emails.send({
                from: 'Prixo <onboarding@resend.dev>', // Use verified domain in prod
                to: emails,
                subject: 'Prixo - Changements de prix détectés',
                html: htmlContent
            });
        }
    }
    return null;
});
exports.testEmailNotification = functions
    .region('europe-west1')
    .runWith({
    memory: '256MB',
    secrets: ['RESEND_API_KEY']
})
    .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to trigger this function.');
    }
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
        console.error("RESEND_API_KEY missing");
        throw new functions.https.HttpsError('internal', 'Configuration de messagerie manquante.');
    }
    const resend = new resend_1.Resend(resendApiKey);
    // Get the authenticated user's email
    let userEmail = context.auth.token.email;
    if (!userEmail) {
        try {
            const userRecord = await admin.auth().getUser(context.auth.uid);
            userEmail = userRecord.email;
        }
        catch (err) {
            console.error("Error fetching user email:", err);
        }
    }
    if (!userEmail) {
        throw new functions.https.HttpsError('failed-precondition', "Impossible de récupérer l'adresse email de l'utilisateur.");
    }
    // Simulated data
    const simulatedChanges = [
        {
            name: "Canapé d'angle réversible scandinave (Simulé)",
            oldPrice: 899,
            newPrice: 749,
            diff: -150,
            url: "https://example.com/canape"
        },
        {
            name: "Table basse en chêne massif (Simulé)",
            oldPrice: 120,
            newPrice: 150,
            diff: 30,
            url: "https://example.com/table"
        }
    ];
    let htmlContent = '<h2>Récapitulatif des changements de prix (TEST)</h2><ul>';
    for (const change of simulatedChanges) {
        const color = change.diff < 0 ? 'green' : 'red';
        const arrow = change.diff < 0 ? '↓' : '↑';
        htmlContent += `
        <li style="margin-bottom: 10px;">
          <strong>${change.name}</strong><br/>
          Ancien prix: ${change.oldPrice}€ | Nouveau prix: <span style="color:${color}">${change.newPrice}€ ${arrow}</span><br/>
          <a href="${change.url}">Voir sur le site</a>
        </li>
       `;
    }
    htmlContent += '</ul><p><em>Ceci est un email de test généré depuis vos paramètres Prixo.</em></p>';
    try {
        await resend.emails.send({
            from: 'Prixo <onboarding@resend.dev>', // Use verified domain in prod
            to: [userEmail],
            subject: 'Prixo - Email de test (Notification de prix)',
            html: htmlContent
        });
        return { success: true, message: 'Email de test envoyé avec succès.' };
    }
    catch (error) {
        console.error("Erreur lors de l'envoi de l'email via Resend:", error);
        throw new functions.https.HttpsError('internal', "Erreur lors de l'envoi de l'email.");
    }
});
//# sourceMappingURL=index.js.map