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
exports.nightlyScrape = exports.refreshItemPrice = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const chromium_1 = __importDefault(require("@sparticuz/chromium"));
const resend_1 = require("resend");
admin.initializeApp();
const db = admin.firestore();
// Helper to scrape a single URL
async function scrapePrice(url) {
    let browser = null;
    try {
        browser = await puppeteer_core_1.default.launch({
            args: chromium_1.default.args,
            defaultViewport: { width: 1920, height: 1080 },
            executablePath: await chromium_1.default.executablePath(),
            headless: true,
        });
        const page = await browser.newPage();
        // Simulate mobile/desktop to avoid simple bot blocks
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
            return jsonLdData;
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
                return parsed;
        }
        return null;
    }
    catch (error) {
        console.error(`Error scraping ${url}:`, error);
        return null;
    }
    finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}
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
    const newPrice = await scrapePrice(itemData?.url);
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
            scrapeError: admin.firestore.FieldValue.delete()
        });
        return { success: true, newPrice };
    }
    else {
        // Just update the last check time, and handle potential failure
        const updateData = {
            lastChecked: new Date().toISOString(),
            isScraping: false
        };
        if (newPrice === null) {
            if (itemData?.url && itemData.url.toLowerCase().includes('amazon.')) {
                updateData.scrapeError = "Impossible de récupérer le prix sur Amazon en raison de leurs protections anti-bots.";
            }
            else if (itemData?.url && itemData.url.toLowerCase().includes('maisonsdumonde.')) {
                updateData.scrapeError = "Impossible de récupérer le prix sur Maisons du Monde en raison de leurs protections anti-bots.";
            }
            else {
                updateData.scrapeError = "Impossible de récupérer le prix sur ce site.";
            }
        }
        else {
            updateData.scrapeError = admin.firestore.FieldValue.delete();
        }
        await itemRef.update(updateData);
        return { success: true, message: 'Price unchanged or scraping failed.', currentPrice: itemData?.currentPrice, scrapeError: updateData.scrapeError };
    }
});
// Scheduled function to scrape all items and send summary email
exports.nightlyScrape = functions
    .region('europe-west1')
    .runWith({ memory: '2GB', timeoutSeconds: 540, secrets: ["RESEND_API_KEY"] })
    .pubsub.schedule('0 3 * * *') // Every day at 3:00 AM
    .timeZone('Europe/Paris')
    .onRun(async (context) => {
    const itemsSnapshot = await db.collection('items').get();
    const changes = [];
    for (const doc of itemsSnapshot.docs) {
        const itemData = doc.data();
        const oldPrice = itemData.currentPrice;
        const newPrice = await scrapePrice(itemData.url);
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
                await doc.ref.update({
                    currentPrice: newPrice,
                    history: history,
                    lastChecked: new Date().toISOString()
                });
            }
            else {
                await doc.ref.update({
                    lastChecked: new Date().toISOString()
                });
            }
        }
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
        // Fetch the two hardcoded users
        const usersSnapshot = await admin.auth().listUsers(2);
        const emails = usersSnapshot.users.map(u => u.email).filter((e) => !!e);
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
//# sourceMappingURL=index.js.map