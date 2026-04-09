import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import puppeteer, { Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Resend } from 'resend';

admin.initializeApp();
const db = admin.firestore();

// Helper to scrape a single URL
async function scrapePrice(url: string, existingBrowser?: Browser): Promise<number | null> {
  let browser = existingBrowser || null;
  let page = null;
  let ownBrowser = !existingBrowser; // Keep track of whether we launched it

  try {
    if (!browser) {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1920, height: 1080 } as any,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    }

    page = await browser.newPage();

    // Block unnecessary resources to speed up page load
    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || resourceType === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Simulate mobile/desktop to avoid simple bot blocks
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

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
                for(const offer of offers) {
                  if (offer.price) {
                    return parseFloat(offer.price);
                  } else if (offer.lowPrice) {
                    return parseFloat(offer.lowPrice);
                  } else if (offer.offers) {
                    const subOffers = Array.isArray(offer.offers) ? offer.offers : [offer.offers];
                    for(const subOffer of subOffers) {
                      if (subOffer.price) return parseFloat(subOffer.price);
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
        } catch (e) {
          // Ignore parse errors and continue
        }
      }
      return null;
    });

    if (jsonLdData) return jsonLdData;

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
      if (!isNaN(parsed)) return parsed;
    }

    return null;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return null;
  } finally {
    if (page !== null) {
      await page.close().catch(() => {});
    }
    if (ownBrowser && browser !== null) {
      await browser.close().catch(() => {});
    }
  }
}

// Callable function to refresh all items in a board
export const refreshBoardItemsPrice = functions
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
      // Since scraping takes time and we only want to scrape what's relevant to the user's dashboard,
      // it's safer and more performant to only refresh the user's OWN items, or items they have access to.
      // But scraping someone else's public item from User A's session might be unwanted side effect.
      // To match the frontend "Tous les articles" logic which queries for:
      // (isPrivate == false) OR (userId == user.uid)
      // Since Admin SDK bypasses rules, we must explicitly query.
      // Firestore doesn't easily support OR queries in Node.js SDK without multiple queries.
      // Simplest robust solution: only scrape the user's OWN items when doing a global refresh
      // to avoid scraping the entire global database of public items.
      itemsSnapshot = await db.collection('items')
        .where('userId', '==', context.auth.uid)
        .get();
    } else if (boardId === 'favorites') {
      // Get all favorite items belonging to the user
      itemsSnapshot = await db.collection('items')
        .where('userId', '==', context.auth.uid)
        .where('isFavorite', '==', true)
        .get();
    } else {
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
    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1920, height: 1080 } as any,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    } catch (err) {
      console.error("Failed to launch browser for refreshBoardItemsPrice:", err);
      throw new functions.https.HttpsError('internal', 'Failed to launch scraping browser.');
    }

    const CONCURRENCY = 4; // Process up to 4 pages concurrently
    let updatedCount = 0;

    try {
      for (let i = 0; i < docs.length; i += CONCURRENCY) {
        const batch = docs.slice(i, i + CONCURRENCY);

        const batchPromises = batch.map(async (doc) => {
          try {
            const itemData = doc.data();

            // Skip private items that don't belong to the user
            if (itemData.userId !== context.auth?.uid && itemData.isPrivate) {
                return;
            }

            const oldPrice = itemData.currentPrice;
            const newPrice = await scrapePrice(itemData.url, browser || undefined);

            const updateData: any = {
              lastChecked: new Date().toISOString()
            };

            if (newPrice !== null) {
              if (newPrice !== oldPrice) {
                const today = new Date().toISOString().split('T')[0];
                let history = itemData.history || [];
                if (history.length > 0 && history[history.length - 1].date === today) {
                   history[history.length - 1] = { date: today, price: newPrice };
                } else {
                   history.push({ date: today, price: newPrice });
                }

                updateData.currentPrice = newPrice;
                updateData.history = history;
                updateData.scrapeError = admin.firestore.FieldValue.delete();
                updatedCount++;
              } else {
                updateData.scrapeError = admin.firestore.FieldValue.delete();
              }
            } else {
              // Scraping failed
              if (itemData.url && itemData.url.toLowerCase().includes('amazon.')) {
                 updateData.scrapeError = "Impossible de récupérer le prix sur Amazon en raison de leurs protections anti-bots.";
              } else if (itemData.url && itemData.url.toLowerCase().includes('maisonsdumonde.')) {
                 updateData.scrapeError = "Impossible de récupérer le prix sur Maisons du Monde en raison de leurs protections anti-bots.";
              } else {
                 updateData.scrapeError = "Impossible de récupérer le prix sur ce site.";
              }
            }

            await doc.ref.update(updateData);
          } catch (err) {
            console.error(`Error processing doc ${doc.id} in board scrape:`, err);
          }
        });

        await Promise.all(batchPromises);
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    return { success: true, message: `Mise à jour terminée. ${updatedCount} prix modifiés sur ${docs.length} articles.`, updatedCount };
});

// Callable function to refresh a single item (triggered from UI)
export const refreshItemPrice = functions
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
      } else {
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
    } else {
      // Just update the last check time, and handle potential failure
      const updateData: any = {
        lastChecked: new Date().toISOString(),
        isScraping: false
      };

      if (newPrice === null) {
        if (itemData?.url && itemData.url.toLowerCase().includes('amazon.')) {
           updateData.scrapeError = "Impossible de récupérer le prix sur Amazon en raison de leurs protections anti-bots.";
        } else if (itemData?.url && itemData.url.toLowerCase().includes('maisonsdumonde.')) {
           updateData.scrapeError = "Impossible de récupérer le prix sur Maisons du Monde en raison de leurs protections anti-bots.";
        } else {
           updateData.scrapeError = "Impossible de récupérer le prix sur ce site.";
        }
      } else {
        updateData.scrapeError = admin.firestore.FieldValue.delete();
      }

      await itemRef.update(updateData);
      return { success: true, message: 'Price unchanged or scraping failed.', currentPrice: itemData?.currentPrice, scrapeError: updateData.scrapeError };
    }
});

// Scheduled function to scrape all items and send summary email
export const nightlyScrape = functions
  .region('europe-west1')
  .runWith({ memory: '2GB', timeoutSeconds: 540, secrets: ["RESEND_API_KEY"] })
  .pubsub.schedule('0 3 * * *') // Every day at 3:00 AM
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const itemsSnapshot = await db.collection('items').get();

    interface ItemChange {
      name: string;
      oldPrice: number;
      newPrice: number;
      url: string;
      ownerId: string;
      diff: number;
    }

    const changes: ItemChange[] = [];
    const docs = itemsSnapshot.docs;

    // Launch a single browser instance for the entire batch
    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1920, height: 1080 } as any,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    } catch (err) {
      console.error("Failed to launch browser for nightlyScrape:", err);
      return null;
    }

    const CONCURRENCY = 4; // Process up to 4 pages concurrently

    for (let i = 0; i < docs.length; i += CONCURRENCY) {
      const batch = docs.slice(i, i + CONCURRENCY);

      const batchPromises = batch.map(async (doc) => {
        try {
          const itemData = doc.data();
          const oldPrice = itemData.currentPrice;
          const newPrice = await scrapePrice(itemData.url, browser || undefined);

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
              } else {
                 history.push({ date: today, price: newPrice });
              }

              await doc.ref.update({
                currentPrice: newPrice,
                history: history,
                lastChecked: new Date().toISOString()
              });
            } else {
              await doc.ref.update({
                lastChecked: new Date().toISOString()
              });
            }
          }
        } catch (err) {
          console.error(`Error processing doc ${doc.id}:`, err);
        }
      });

      await Promise.all(batchPromises);
    }

    if (browser) {
      await browser.close().catch(() => {});
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

      const resend = new Resend(resendApiKey);

      // Fetch the two hardcoded users
      const usersSnapshot = await admin.auth().listUsers(2);
      const emails = usersSnapshot.users.map(u => u.email).filter((e): e is string => !!e);

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
