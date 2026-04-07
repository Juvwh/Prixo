import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Resend } from 'resend';
import cors from 'cors';

const corsHandler = cors({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// Helper to scrape a single URL
async function scrapePrice(url: string): Promise<number | null> {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080 } as any,
      executablePath: await chromium.executablePath(),
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
            if (item['@type'] === 'Product' || item['@type'] === 'ItemPage') {
              if (item.offers) {
                const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                for(const offer of offers) {
                  if (offer.price) return parseFloat(offer.price);
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
      // List of common selectors for IKEA, Maisons du Monde, etc.
      const selectors = [
        '.pip-temp-price__integer', // IKEA
        '[data-test-target="price"]',
        '.price',
        '.current-price',
        'span[itemprop="price"]',
        '.product-price'
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
    if (browser !== null) {
      await browser.close();
    }
  }
}

// Callable function to refresh a single item (triggered from UI)
export const refreshItemPrice = functions
  .region('europe-west1')
  .runWith({ memory: '2GB', timeoutSeconds: 300 })
  .https.onRequest((req, res) => {
    return corsHandler(req, res, async () => {
      try {
        // Parse the token from the Authorization header
        const authHeader = req.headers.authorization;
        let idToken;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          idToken = authHeader.split('Bearer ')[1];
        } else {
          res.status(401).json({ error: { message: 'User must be logged in.', status: 'UNAUTHENTICATED' } });
          return;
        }

        let decodedIdToken;
        try {
          decodedIdToken = await admin.auth().verifyIdToken(idToken);
        } catch (error) {
          res.status(401).json({ error: { message: 'Invalid token.', status: 'UNAUTHENTICATED' } });
          return;
        }

        const data = req.body.data;
        if (!data || !data.itemId) {
          res.status(400).json({ error: { message: 'Item ID is required.', status: 'INVALID_ARGUMENT' } });
          return;
        }

        const { itemId } = data;

        const itemRef = db.collection('items').doc(itemId);
        const itemSnap = await itemRef.get();

        if (!itemSnap.exists) {
          res.status(404).json({ error: { message: 'Item not found.', status: 'NOT_FOUND' } });
          return;
        }

        const itemData = itemSnap.data();
        if (itemData?.userId !== decodedIdToken.uid && itemData?.isPrivate) {
          res.status(403).json({ error: { message: 'Cannot refresh private item.', status: 'PERMISSION_DENIED' } });
          return;
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

          res.status(200).json({ data: { success: true, newPrice } });
        } else {
          // Just update the last check time, and handle potential failure
          const updateData: any = {
            lastChecked: new Date().toISOString(),
            isScraping: false
          };

          if (newPrice === null) {
            updateData.scrapeError = "Impossible de récupérer le prix sur ce site.";
          } else {
            updateData.scrapeError = admin.firestore.FieldValue.delete();
          }

          await itemRef.update(updateData);
          res.status(200).json({ data: { success: true, message: 'Price unchanged or scraping failed.', currentPrice: itemData?.currentPrice } });
        }
      } catch (error) {
        console.error("Error in refreshItemPrice:", error);
        res.status(500).json({ error: { message: 'Internal server error.', status: 'INTERNAL' } });
      }
    });
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
