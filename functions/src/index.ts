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

// --- Variantes de couleur et prix multi-pays -------------------------------
//
// Un article peut regrouper plusieurs couleurs, chacune avec sa page produit.
// Pour chaque couleur on relève le prix belge et, quand une page française
// existe, le prix français. Seul le prix belge alimente les notifications.

interface ScrapeVariant {
  id: string;
  color: string;
  colorHex: string;
  url: string;
  urlFr: string;
  imageUrl: string;
  currentPrice: number;
  currentPriceFr: number | null;
  history: Array<{ date: string; price: number }>;
  historyFr: Array<{ date: string; price: number }>;
  lastScrapeError: string | null;
  lastScrapeErrorFr: string | null;
}

/**
 * Déduit l'URL française d'une URL belge.
 * Doit rester alignée sur frontend/src/utils/variants.ts (deriveFrUrl).
 * Retourne '' si le site ne suit aucun schéma reconnu.
 */
function deriveFrUrl(url: string): string {
  if (!url) return '';

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }

  // jysk.be/fr/... -> jysk.fr/...
  if (u.hostname.endsWith('.be')) {
    u.hostname = `${u.hostname.slice(0, -3)}.fr`;
    if (u.pathname === '/fr' || u.pathname === '/fr/') {
      u.pathname = '/';
    } else if (u.pathname.startsWith('/fr/')) {
      u.pathname = u.pathname.slice(3);
    }
    return u.toString();
  }

  // ikea.com/be/fr/... -> ikea.com/fr/fr/...
  const segments = u.pathname.split('/');
  const localeIndex = segments.findIndex(seg => /^(be|be-fr|fr-be)$/i.test(seg));
  if (localeIndex !== -1) {
    const segment = segments[localeIndex];
    const isUpper = segment === segment.toUpperCase();
    const replacement = /^be$/i.test(segment) ? 'fr' : 'fr-fr';
    segments[localeIndex] = isUpper ? replacement.toUpperCase() : replacement;
    u.pathname = segments.join('/');
    return u.toString();
  }

  return '';
}

/** Normalise un article en variantes, y compris les articles antérieurs aux couleurs. */
function normalizeVariants(itemData: any): ScrapeVariant[] {
  const raw = Array.isArray(itemData?.variants) && itemData.variants.length > 0
    ? itemData.variants
    : [{
        id: 'default',
        url: itemData?.url,
        urlFr: itemData?.urlFr,
        imageUrl: itemData?.imageUrl,
        currentPrice: itemData?.currentPrice,
        currentPriceFr: itemData?.currentPriceFr,
        history: itemData?.history,
        historyFr: itemData?.historyFr,
        lastScrapeError: itemData?.lastScrapeError,
        lastScrapeErrorFr: itemData?.lastScrapeErrorFr,
      }];

  return raw.map((v: any, i: number) => ({
    id: v.id || `default_${i}`,
    color: v.color || '',
    colorHex: v.colorHex || '',
    url: v.url || '',
    urlFr: v.urlFr || '',
    imageUrl: v.imageUrl || '',
    currentPrice: typeof v.currentPrice === 'number' ? v.currentPrice : 0,
    currentPriceFr: typeof v.currentPriceFr === 'number' ? v.currentPriceFr : null,
    history: Array.isArray(v.history) ? v.history : [],
    historyFr: Array.isArray(v.historyFr) ? v.historyFr : [],
    lastScrapeError: v.lastScrapeError || null,
    lastScrapeErrorFr: v.lastScrapeErrorFr || null,
  }));
}

/** Ajoute un relevé daté, en écrasant celui du jour s'il existe déjà. */
function pushPricePoint(history: Array<{ date: string; price: number }>, price: number) {
  const today = new Date().toISOString().split('T')[0];
  const next = [...history];
  if (next.length > 0 && next[next.length - 1].date === today) {
    next[next.length - 1] = { date: today, price };
  } else {
    next.push({ date: today, price });
  }
  return next;
}

/** Champs de premier niveau reflétant la variante affichée. */
function mirrorOfVariant(variant: ScrapeVariant) {
  return {
    url: variant.url,
    urlFr: variant.urlFr || '',
    imageUrl: variant.imageUrl || '',
    currentPrice: variant.currentPrice || 0,
    currentPriceFr: variant.currentPriceFr,
    history: variant.history || [],
    historyFr: variant.historyFr || [],
    lastScrapeError: variant.lastScrapeError,
    lastScrapeErrorFr: variant.lastScrapeErrorFr,
  };
}

interface VariantPriceChange {
  color: string;
  oldPrice: number;
  newPrice: number;
  url: string;
  diff: number;
}

/**
 * Relève les prix de toutes les couleurs d'un article (Belgique + France) et
 * construit la mise à jour Firestore correspondante.
 * Les changements retournés sont exclusivement belges : la France n'alimente
 * ni le mail quotidien ni la cloche.
 */
async function scrapeItemVariants(
  itemData: any,
  browser?: Browser
): Promise<{ updateData: any; changes: VariantPriceChange[] }> {
  const variants = normalizeVariants(itemData);
  const changes: VariantPriceChange[] = [];

  for (const variant of variants) {
    if (!variant.url) {
      variant.lastScrapeError = 'Aucun lien belge enregistré pour cette couleur';
      continue;
    }

    // --- Belgique (source de vérité pour les alertes)
    const { price: priceBe, error: errorBe } = await scrapePrice(variant.url, browser);

    if (priceBe !== null) {
      if (priceBe !== variant.currentPrice) {
        changes.push({
          color: variant.color,
          oldPrice: variant.currentPrice,
          newPrice: priceBe,
          url: variant.url,
          diff: priceBe - variant.currentPrice,
        });
        variant.history = pushPricePoint(variant.history, priceBe);
        variant.currentPrice = priceBe;
      }
      variant.lastScrapeError = null;
    } else {
      variant.lastScrapeError = errorBe || 'Erreur inconnue lors du scraping';
    }

    // --- France (comparaison seulement, historique séparé)
    const candidateFr = variant.urlFr || deriveFrUrl(variant.url);
    if (candidateFr) {
      const { price: priceFr, error: errorFr } = await scrapePrice(candidateFr, browser);

      if (priceFr !== null) {
        // On ne mémorise une URL déduite qu'une fois qu'elle a fait ses preuves,
        // pour ne pas enregistrer un lien mort dans la fiche article.
        variant.urlFr = candidateFr;
        if (priceFr !== variant.currentPriceFr) {
          variant.historyFr = pushPricePoint(variant.historyFr, priceFr);
          variant.currentPriceFr = priceFr;
        }
        variant.lastScrapeErrorFr = null;
      } else {
        variant.lastScrapeErrorFr = errorFr || 'Page française introuvable';
      }
    }
  }

  const active = variants.find(v => v.id === itemData?.activeVariantId) || variants[0];

  const updateData: any = {
    variants,
    activeVariantId: active?.id || '',
    lastChecked: new Date().toISOString(),
    isScraping: false,
    scrapeStatus: active?.lastScrapeError ? 'error' : 'success',
    scrapeError: admin.firestore.FieldValue.delete(),
    ...(active ? mirrorOfVariant(active) : {}),
  };

  return { updateData, changes };
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

            const { updateData, changes } = await scrapeItemVariants(itemData, browser || undefined);

            if (changes.length > 0) {
              updatedCount += changes.length;
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

    // Un article peut demander plusieurs pages (une par couleur, et une par
    // pays) : on partage une seule instance de navigateur pour toutes.
    let browser: Browser | null = null;
    let updateData: any;
    let changes: VariantPriceChange[];

    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1920, height: 1080 } as any,
        executablePath: await chromium.executablePath(),
        headless: true,
      });

      ({ updateData, changes } = await scrapeItemVariants(itemData, browser));
    } catch (err) {
      console.error("Failed to scrape item:", err);
      throw new functions.https.HttpsError('internal', "Impossible de relever les prix de cet article.");
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    await itemRef.update(updateData);

    const activeChange = changes.find(c => c.url === updateData.url);

    if (activeChange) {
      return { success: true, newPrice: activeChange.newPrice, updatedCount: changes.length };
    }

    return {
      success: true,
      message: 'Price unchanged or scraping failed.',
      currentPrice: updateData.currentPrice,
      lastScrapeError: updateData.lastScrapeError,
      updatedCount: changes.length,
    };
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

      // Odoo / Aryes specific: Some listings use data-building-id instead of standard links
      const buildingElements = Array.from(document.querySelectorAll('[data-building-id]'));
      buildingElements.forEach(el => {
         const buildingId = el.getAttribute('data-building-id');
         if (buildingId) {
            hrefs.push('/buildings/' + buildingId);
         }
      });

      const absoluteLinks = hrefs.map(href => {
        try {
           return new URL(href, base).href;
        } catch(e) { return null; }
      }).filter(Boolean) as string[];

      // Unique links
      const uniqueLinks = Array.from(new Set(absoluteLinks));

      if (!filter) return uniqueLinks;

      const filterWords = filter.split(',').map((w: string) => w.trim().toLowerCase()).filter(Boolean);
      if (filterWords.length === 0) return uniqueLinks;

      return uniqueLinks.filter(l => {
         const lowerLink = l.toLowerCase();
         return filterWords.every((word: string) => lowerLink.includes(word));
      });
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

export const refreshImmoSearchesV2 = functions
  .region('europe-west1')
  .runWith({ memory: '2GB', timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    try {
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
        throw new functions.https.HttpsError('internal', 'Impossible de lancer le navigateur (vérifiez la RAM sur GCP).');
      }

      let newLinksFound = 0;
      try {
        for (const docSnap of snapshot.docs) {
          const searchData = docSnap.data();
          await docSnap.ref.update({ isScraping: true, lastChecked: new Date().toISOString() });

          const { links, error } = await scrapeLinks(searchData.url, searchData.filterWord || '', browser);

          const oldLinks = searchData.links || [];

          const updateData: any = {
             isScraping: false,
             lastChecked: new Date().toISOString()
          };

          if (error) {
             updateData.lastError = error;
          } else {
             updateData.lastError = null;

             // Convert old links to map for quick lookup
             const oldLinksMap = new Map();
             for (const item of oldLinks) {
                if (typeof item === 'string') {
                   // Migrate old string arrays on the fly
                   oldLinksMap.set(item, { url: item, isRead: false, isFavorite: false, isIgnored: false, addedAt: new Date().toISOString() });
                } else if (item && typeof item === 'object') {
                   oldLinksMap.set(item.url, item);
                }
             }

             const updatedLinks: any[] = [];

             for (const urlStr of links) {
                if (oldLinksMap.has(urlStr)) {
                   updatedLinks.push(oldLinksMap.get(urlStr));
                } else {
                   updatedLinks.push({
                     url: urlStr,
                     isRead: false,
                     isFavorite: false,
                     isIgnored: false,
                     addedAt: new Date().toISOString()
                   });
                   newLinksFound++;
                }
             }

             // Also preserve old links that weren't found in the current scrape if they are favorites or ignored, so users don't lose them
             for (const [urlStr, itemData] of oldLinksMap.entries()) {
                if ((itemData.isFavorite || itemData.isIgnored) && !links.includes(urlStr)) {
                   updatedLinks.push(itemData);
                }
             }

             updateData.links = updatedLinks;
          }

          await docSnap.ref.update(updateData);
        }
      } finally {
        if (browser) await browser.close().catch(() => {});
      }

      return { success: true, message: 'Actualisation terminée', newLinksCount: newLinksFound };
    } catch (e: any) {
      console.error("Erreur critique dans refreshImmoSearchesV2:", e);
      if (e instanceof functions.https.HttpsError) throw e;
      throw new functions.https.HttpsError('internal', 'Erreur interne au serveur lors du rafraîchissement.', e.message);
    }
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
            const oldLinksMap = new Map();
            for (const item of oldLinks) {
               if (typeof item === 'string') {
                  oldLinksMap.set(item, { url: item, isRead: false, isFavorite: false, isIgnored: false, addedAt: new Date().toISOString() });
               } else if (item && typeof item === 'object') {
                  oldLinksMap.set(item.url, item);
               }
            }

            const updatedLinks: any[] = [];
            const newLinksForAlert: string[] = [];

            for (const urlStr of links) {
               if (oldLinksMap.has(urlStr)) {
                  updatedLinks.push(oldLinksMap.get(urlStr));
               } else {
                  updatedLinks.push({
                    url: urlStr,
                    isRead: false,
                    isFavorite: false,
                    isIgnored: false,
                    addedAt: new Date().toISOString()
                  });
                  newLinksForAlert.push(urlStr);
               }
            }

            for (const [urlStr, itemData] of oldLinksMap.entries()) {
               if ((itemData.isFavorite || itemData.isIgnored) && !links.includes(urlStr)) {
                  updatedLinks.push(itemData);
               }
            }

            if (newLinksForAlert.length > 0) {
              alerts.push({
                searchName: searchData.name,
                url: searchData.url,
                newLinks: newLinksForAlert,
                groupId: searchData.groupId
              });
            }

            await docSnap.ref.update({
               links: updatedLinks,
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
      brand: string;
      color: string;
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
          const { updateData, changes: variantChanges } = await scrapeItemVariants(itemData, browser || undefined);

          // Seuls les prix belges déclenchent une notification.
          for (const change of variantChanges) {
            changes.push({
              name: itemData.name,
              brand: itemData.brand || '',
              color: change.color,
              oldPrice: change.oldPrice,
              newPrice: change.newPrice,
              url: change.url,
              ownerId: itemData.userId,
              groupId: itemData.groupId,
              isPrivate: itemData.isPrivate || false,
              diff: change.diff,
            });
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

            let htmlContent = `
              <div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; color:#212529;">
                <h2 style="font-weight:600;">Récapitulatif des changements de prix</h2>
                <p style="color:#6c757d; font-size:13px; margin-top:-8px;">
                  Prix relevés sur les sites belges 🇧🇪
                </p>
                <table style="width:100%; border-collapse:collapse;">
            `;

            for (const change of userChanges) {
               const accent = change.diff < 0 ? '#2f8f5b' : '#c0392b';
               const arrow = change.diff < 0 ? '↓' : '↑';
               const brandTag = change.brand
                 ? `<span style="display:inline-block; background:#eef2f0; color:#212529; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; padding:2px 8px; border-radius:999px; margin-right:8px;">${change.brand}</span>`
                 : '';
               const colorTag = change.color
                 ? `<span style="color:#6c757d; font-size:13px;"> — ${change.color}</span>`
                 : '';

               htmlContent += `
                <tr>
                  <td style="padding:14px 0; border-bottom:1px solid #dee2e6;">
                    <div style="margin-bottom:6px;">${brandTag}<strong>${change.name}</strong>${colorTag}</div>
                    <div style="font-size:14px;">
                      <span style="color:#6c757d; text-decoration:line-through;">${change.oldPrice}€</span>
                      <span style="color:${accent}; font-weight:700; margin-left:8px;">${change.newPrice}€ ${arrow}</span>
                      <span style="color:${accent}; font-size:12px; margin-left:6px;">
                        (${change.diff > 0 ? '+' : ''}${change.diff.toFixed(2)}€)
                      </span>
                    </div>
                    <a href="${change.url}" style="font-size:13px; color:#6c757d;">Voir sur le site</a>
                  </td>
                </tr>
               `;
            }

            htmlContent += '</table></div>';

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

export const testEmailNotificationV2 = functions
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

export const migrateToGroupAV2 = functions
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
