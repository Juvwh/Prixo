import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import puppeteer, { Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Resend } from 'resend';

admin.initializeApp();
const db = admin.firestore();

// Helper to sleep for a given number of milliseconds
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to scrape a single URL
async function scrapePrice(url: string, existingBrowser?: Browser): Promise<{ price: number | null, error: string | null }> {
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

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (response && response.status() === 403) {
        return { price: null, error: "Protection anti-bot ou accès refusé (Erreur 403)" };
      }
    } catch (gotoError: any) {
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
        const normalizePath = (p: string) => p.replace(/\/$/, '');

        if (originalUrlObj.hostname.replace(/^www\./, '') !== finalUrlObj.hostname.replace(/^www\./, '') ||
            normalizePath(originalUrlObj.pathname) !== normalizePath(finalUrlObj.pathname)) {
          return { price: null, error: "Article introuvable" };
        }
      } catch (e) {
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

    if (jsonLdData) return { price: jsonLdData, error: null };

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
      if (!isNaN(parsed)) return { price: parsed, error: null };
    }

    return { price: null, error: "Sélecteur de prix introuvable sur la page" };
  } catch (error: any) {
    console.error(`Error scraping ${url}:`, error);
    if (error.message && error.message.includes('Timeout')) {
      return { price: null, error: "Délai d'attente dépassé (timeout)" };
    }
    return { price: null, error: "Erreur technique lors du chargement de la page" };
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

    // Get user's groupId
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    const userGroupId = userDoc.data()?.groupId;

    if (!userGroupId) {
      throw new functions.https.HttpsError('failed-precondition', 'User has no groupId assigned.');
    }

    let itemsSnapshot;

    if (boardId === 'all') {
      // Get all items accessible to the user (their own items + public items) within their group
      itemsSnapshot = await db.collection('items')
        .where('groupId', '==', userGroupId)
        .where(
          admin.firestore.Filter.or(
            admin.firestore.Filter.where('isPrivate', '==', false),
            admin.firestore.Filter.where('userId', '==', context.auth.uid)
          )
        )
        .get();
    } else if (boardId === 'favorites') {
      // Get all favorite items belonging to the user within their group
      itemsSnapshot = await db.collection('items')
        .where('groupId', '==', userGroupId)
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

            const updateData: any = {
              lastChecked: new Date().toISOString()
            };

            if (newPrice !== null) {
              updateData.scrapeStatus = 'success';
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
                updateData.lastScrapeError = admin.firestore.FieldValue.delete();
                updatedCount++;
              } else {
                updateData.lastScrapeError = admin.firestore.FieldValue.delete();
              }
            } else {
              // Scraping failed
              updateData.scrapeStatus = 'error';
              updateData.lastScrapeError = scrapeError || "Erreur inconnue lors du scraping";
            }

            // Clean up old scrapeError field if it exists
            updateData.scrapeError = admin.firestore.FieldValue.delete();

            await doc.ref.update(updateData);
          } catch (err) {
            try {
              await doc.ref.update({
                scrapeStatus: 'error',
                lastScrapeError: err instanceof Error ? err.message : "Erreur inattendue"
              });
            } catch (updateErr) {
              console.error(`Failed to update error state for doc ${doc.id}:`, updateErr);
            }
            console.error(`Error processing doc ${doc.id} in board scrape:`, err);
          }
        });

        await Promise.allSettled(batchPromises);
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

    const { price: newPrice, error: scrapeError } = await scrapePrice(itemData?.url);

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
        lastScrapeError: admin.firestore.FieldValue.delete(),
        scrapeError: admin.firestore.FieldValue.delete()
      });

      return { success: true, newPrice };
    } else {
      // Just update the last check time, and handle potential failure
      const updateData: any = {
        lastChecked: new Date().toISOString(),
        isScraping: false,
        scrapeError: admin.firestore.FieldValue.delete()
      };

      if (newPrice === null) {
        updateData.lastScrapeError = scrapeError || "Erreur inconnue lors du scraping";
      } else {
        updateData.lastScrapeError = admin.firestore.FieldValue.delete();
      }

      await itemRef.update(updateData);

      // Do not return FieldValue.delete() to the client
      const returnError = newPrice === null ? updateData.lastScrapeError : null;
      return { success: true, message: 'Price unchanged or scraping failed.', currentPrice: itemData?.currentPrice, lastScrapeError: returnError };
    }
});

// Scheduled function to scrape all items and send summary email
// Helper to extract links for ImmoSearch
async function scrapeLinks(url: string, filterWord: string, existingBrowser?: Browser): Promise<{ links: string[], error: string | null }> {
  let browser = existingBrowser || null;
  let page = null;
  let ownBrowser = !existingBrowser;

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

    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || resourceType === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (response && response.status() === 403) {
        return { links: [], error: "Protection anti-bot ou accès refusé (Erreur 403)" };
      }
    } catch (gotoError: any) {
      if (gotoError.message && gotoError.message.includes('Timeout')) {
        return { links: [], error: "Délai d'attente dépassé (timeout)" };
      }
      throw gotoError;
    }

    // Scroll to bottom slowly to trigger lazy loading if any
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });

    await sleep(2000); // Give it a sec to load elements

    const baseUrl = new URL(page.url()).origin;

    const extractedLinks = await page.evaluate((filter, base) => {
      const anchors = Array.from(document.querySelectorAll('a'));
      const hrefs = anchors.map(a => a.getAttribute('href')).filter(Boolean) as string[];

      const absoluteLinks = hrefs.map(href => {
        try {
           return new URL(href, base).href;
        } catch(e) { return null; }
      }).filter(Boolean) as string[];

      // Unique links
      const uniqueLinks = Array.from(new Set(absoluteLinks));

      if (!filter) return uniqueLinks;

      return uniqueLinks.filter(l => l.toLowerCase().includes(filter.toLowerCase()));
    }, filterWord || '', baseUrl);

    return { links: extractedLinks, error: null };
  } catch (error: any) {
    console.error(`Error scraping links on ${url}:`, error);
    if (error.message && error.message.includes('Timeout')) {
      return { links: [], error: "Délai d'attente dépassé (timeout)" };
    }
    return { links: [], error: "Erreur technique lors du chargement de la page" };
  } finally {
    if (page) await page.close().catch(() => {});
    if (ownBrowser && browser) await browser.close().catch(() => {});
  }
}

export const refreshImmoSearches = functions
  .region('europe-west1')
  .runWith({ memory: '2GB', timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    const userGroupId = userDoc.data()?.groupId;
    if (!userGroupId) {
      throw new functions.https.HttpsError('failed-precondition', 'User has no groupId assigned.');
    }

    const { searchId } = data;

    let queryRef = db.collection('immo_searches').where('groupId', '==', userGroupId);
    if (searchId) {
      queryRef = queryRef.where(admin.firestore.FieldPath.documentId(), '==', searchId);
    }

    const snapshot = await queryRef.get();
    if (snapshot.empty) {
       return { success: true, message: 'Aucune recherche trouvée.' };
    }

    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1920, height: 1080 } as any,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    } catch (err) {
      console.error("Failed to launch browser:", err);
      throw new functions.https.HttpsError('internal', 'Failed to launch browser.');
    }

    let newLinksFound = 0;
    try {
      for (const docSnap of snapshot.docs) {
        const searchData = docSnap.data();
        await docSnap.ref.update({ isScraping: true, lastChecked: new Date().toISOString() });

        const { links, error } = await scrapeLinks(searchData.url, searchData.filterWord || '', browser);

        const oldLinks = searchData.links || [];
        // Only keep links from the new scrape, adding them to old links if they weren't there (we don't delete old manually kept ones during refresh from the user's perspective, but actually wait, the prompt specified: "retirer les biens qui ne sont plus disponible (soit lorsque on rescrappe et que le système remarque que le bien a été retiré)". So we will completely replace the links list with the newly scraped one.

        const updateData: any = {
           isScraping: false,
           lastChecked: new Date().toISOString()
        };

        if (error) {
           updateData.lastError = error;
        } else {
           updateData.lastError = null;
           updateData.links = links;
           const newAdditions = links.filter((l: string) => !oldLinks.includes(l));
           newLinksFound += newAdditions.length;
        }

        await docSnap.ref.update(updateData);
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    return { success: true, message: 'Actualisation terminée', newLinksCount: newLinksFound };
  });

export const hourlyImmoScrape = functions
  .region('europe-west1')
  .runWith({ memory: '2GB', timeoutSeconds: 540, secrets: ["RESEND_API_KEY"] })
  .pubsub.schedule('0 6-21 * * *') // Every hour from 6:00 to 21:00 (Paris time)
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const snapshot = await db.collection('immo_searches').get();
    if (snapshot.empty) return null;

    interface SearchAlert {
      searchName: string;
      url: string;
      newLinks: string[];
      groupId: string;
    }
    const alerts: SearchAlert[] = [];

    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1920, height: 1080 } as any,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    } catch (err) {
      console.error("Failed to launch browser:", err);
      return null;
    }

    const CONCURRENCY = 2;
    for (let i = 0; i < snapshot.docs.length; i += CONCURRENCY) {
      const batch = snapshot.docs.slice(i, i + CONCURRENCY);

      const batchPromises = batch.map(async (docSnap, index) => {
        try {
          if (index > 0) await sleep(2000 * index);

          const searchData = docSnap.data();
          const { links, error } = await scrapeLinks(searchData.url, searchData.filterWord || '', browser || undefined);

          if (!error && links.length > 0) {
            const oldLinks = searchData.links || [];
            const newLinks = links.filter(l => !oldLinks.includes(l));

            if (newLinks.length > 0) {
              alerts.push({
                searchName: searchData.name,
                url: searchData.url,
                newLinks: newLinks,
                groupId: searchData.groupId
              });
            }

            await docSnap.ref.update({
               links: links,
               lastChecked: new Date().toISOString(),
               lastError: null
            });
          } else if (error) {
            await docSnap.ref.update({
               lastChecked: new Date().toISOString(),
               lastError: error
            });
          }
        } catch (err) {
           console.error("Error hourly immo:", err);
        }
      });
      await Promise.allSettled(batchPromises);
    }

    if (browser) await browser.close().catch(() => {});

    // Send emails
    if (alerts.length > 0) {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) return null;
      const resend = new Resend(resendApiKey);

      const usersSnap = await db.collection('users').get();

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const userGroupId = userData.groupId;
        if (!userGroupId) continue;

        const userAlerts = alerts.filter(a => a.groupId === userGroupId);
        if (userAlerts.length === 0) continue;

        try {
          const userRecord = await admin.auth().getUser(userDoc.id);
          if (!userRecord.email) continue;

          let htmlContent = '<h2>Nouveaux biens immobiliers détectés !</h2><ul>';
          for (const alert of userAlerts) {
            htmlContent += `
              <li style="margin-bottom: 15px;">
                <strong>Recherche : ${alert.searchName}</strong><br/>
                <a href="${alert.url}">Voir votre recherche</a><br/>
                Nouveaux biens trouvés :
                <ul>
                  ${alert.newLinks.map((l, i) => `<li><a href="${l}">Nouveau bien #${i + 1}</a></li>`).join('')}
                </ul>
              </li>
            `;
          }
          htmlContent += '</ul>';

          await resend.emails.send({
            from: 'Prixo <onboarding@resend.dev>',
            to: [userRecord.email],
            subject: 'Prixo Immo - Nouveaux biens trouvés',
            html: htmlContent
          });
        } catch (e) {
          console.error("Email error:", e);
        }
      }
    }
    return null;
  });

export const nightlyScrape = functions
  .region('europe-west1')
  .runWith({ memory: '2GB', timeoutSeconds: 540, secrets: ["RESEND_API_KEY"] })
  .pubsub.schedule('30 6 * * *') // Every day at 6:30 AM
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const itemsSnapshot = await db.collection('items').get();

    interface ItemChange {
      name: string;
      oldPrice: number;
      newPrice: number;
      url: string;
      ownerId: string;
      groupId: string;
      isPrivate: boolean;
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

          const updateData: any = {
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
                groupId: itemData.groupId,
                isPrivate: itemData.isPrivate || false,
                diff: newPrice - oldPrice
              });

              const today = new Date().toISOString().split('T')[0];
              let history = itemData.history || [];
              if (history.length > 0 && history[history.length - 1].date === today) {
                 history[history.length - 1] = { date: today, price: newPrice };
              } else {
                 history.push({ date: today, price: newPrice });
              }

              updateData.currentPrice = newPrice;
              updateData.history = history;
              updateData.lastScrapeError = admin.firestore.FieldValue.delete();
            } else {
              updateData.lastScrapeError = admin.firestore.FieldValue.delete();
            }
          } else {
            updateData.lastScrapeError = scrapeError || "Erreur inconnue lors du scraping";
          }

          await doc.ref.update(updateData);
        } catch (err) {
          try {
            await doc.ref.update({
              scrapeStatus: 'error',
              lastScrapeError: err instanceof Error ? err.message : "Erreur inattendue"
            });
          } catch (updateErr) {
            console.error(`Failed to update error state for doc ${doc.id}:`, updateErr);
          }
          console.error(`Error processing doc ${doc.id}:`, err);
        }
      });

      await Promise.allSettled(batchPromises);
    }

    if (browser) {
      await browser.close().catch(() => {});
    }

    // Process and send email if there are changes
    if (changes.length > 0) {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.error("RESEND_API_KEY missing");
        return null;
      }

      const resend = new Resend(resendApiKey);

      // Fetch all users to determine who gets what email
      const usersCollectionSnapshot = await db.collection('users').get();

      for (const userDoc of usersCollectionSnapshot.docs) {
        const userData = userDoc.data();
        const userGroupId = userData.groupId;
        const userId = userDoc.id;

        if (!userGroupId) continue;

        try {
          const userRecord = await admin.auth().getUser(userId);
          const email = userRecord.email;

          if (!email) continue;

          // Filter changes for this specific user
          // 1. Match groupId
          // 2. Either public OR private but owned by this user
          const userChanges = changes.filter(change => {
            const isMatch = change.groupId === userGroupId && (!change.isPrivate || change.ownerId === userId);
            return isMatch;
          });

          if (userChanges.length > 0) {
            // Sort: Price drops first, then price increases
            userChanges.sort((a, b) => a.diff - b.diff);

            let htmlContent = '<h2>Récapitulatif des changements de prix</h2><ul>';

            for (const change of userChanges) {
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
              to: [email],
              subject: 'Prixo - Changements de prix détectés',
              html: htmlContent
            });
          }
        } catch (err) {
          console.error(`Failed to fetch email or send for user ${userId}:`, err);
        }
      }
    }

    return null;
});

export const testEmailNotification = functions
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

    const resend = new Resend(resendApiKey);

    // Get the authenticated user's email
    let userEmail = context.auth.token.email;
    if (!userEmail) {
      try {
        const userRecord = await admin.auth().getUser(context.auth.uid);
        userEmail = userRecord.email;
      } catch (err) {
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
    } catch (error) {
      console.error("Erreur lors de l'envoi de l'email via Resend:", error);
      throw new functions.https.HttpsError('internal', "Erreur lors de l'envoi de l'email.");
    }
  });

export const migrateToGroupA = functions
  .region('europe-west1')
  .https.onRequest(async (req, res) => {
    try {
      const defaultGroupId = 'group_A';

      // Migrate users
      const usersSnap = await db.collection('users').get();
      const userPromises = usersSnap.docs.map(doc => {
        if (!doc.data().groupId) {
          return doc.ref.update({ groupId: defaultGroupId });
        }
        return Promise.resolve();
      });
      await Promise.all(userPromises);

      // Migrate items
      const itemsSnap = await db.collection('items').get();
      const itemPromises = itemsSnap.docs.map(doc => {
        if (!doc.data().groupId) {
          return doc.ref.update({ groupId: defaultGroupId });
        }
        return Promise.resolve();
      });
      await Promise.all(itemPromises);

      // Migrate boards
      const boardsSnap = await db.collection('boards').get();
      const boardPromises = boardsSnap.docs.map(doc => {
        if (!doc.data().groupId) {
          return doc.ref.update({ groupId: defaultGroupId });
        }
        return Promise.resolve();
      });
      await Promise.all(boardPromises);

      res.status(200).send("Migration to group_A completed successfully.");
    } catch (error) {
      console.error("Migration error:", error);
      res.status(500).send("Migration failed.");
    }
  });
