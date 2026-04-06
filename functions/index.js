const functions = require('firebase-functions');
const admin = require('firebase-admin');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { Resend } = require('resend');

admin.initializeApp();
const db = admin.firestore();

// Fallback selectors for specific stores
const STORE_SELECTORS = {
  'ikea': [
    '.pip-temp-price__integer',
    '.pip-price__integer',
    '[data-testid="price"]'
  ],
  'jysk': [
    '.product-price-value',
    '.price-amount'
  ],
  'maisonsdumonde': [
    '.price__value',
    '[data-testid="product-price"]'
  ]
};

async function scrapePrice(url) {
  let browser = null;
  try {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath || '/usr/bin/google-chrome',
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // 1. Try JSON-LD first
    const jsonLdData = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.innerText);
          // Look for price in Product or nested offers
          if (data['@type'] === 'Product' && data.offers && data.offers.price) {
            return parseFloat(data.offers.price);
          }
          if (data['@type'] === 'Product' && data.offers && data.offers[0] && data.offers[0].price) {
            return parseFloat(data.offers[0].price);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      return null;
    });

    if (jsonLdData) return jsonLdData;

    // 2. Fallback to CSS selectors
    let domain = '';
    try {
      domain = new URL(url).hostname.replace('www.', '').split('.')[0];
    } catch(e) {}

    const selectorsToTry = STORE_SELECTORS[domain] || [
      '[itemprop="price"]',
      '.price',
      '.product-price'
    ];

    for (const selector of selectorsToTry) {
      const priceText = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.innerText : null;
      }, selector);

      if (priceText) {
        // Clean price text (e.g. "129,99 €" -> 129.99)
        const cleaned = priceText.replace(/[^0-9,.]/g, '').replace(',', '.');
        const price = parseFloat(cleaned);
        if (!isNaN(price)) return price;
      }
    }

    return null;
  } catch (error) {
    console.error(`Scrape error for ${url}:`, error);
    return null;
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}

exports.refreshPrice = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { itemId, url } = data;
    if (!itemId || !url) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing itemId or url.');
    }

    const price = await scrapePrice(url);
    if (price !== null) {
      const timestamp = admin.firestore.FieldValue.serverTimestamp();

      const itemRef = db.collection('items').doc(itemId);
      const itemDoc = await itemRef.get();

      let updateData = {
        currentPrice: price,
        lastUpdated: timestamp
      };

      if (itemDoc.exists) {
        const data = itemDoc.data();
        if (data.currentPrice && price < data.currentPrice) {
          updateData.priceDecreased = true;
          updateData.priceIncreased = false;
        } else if (data.currentPrice && price > data.currentPrice) {
          updateData.priceDecreased = false;
          updateData.priceIncreased = true;
        } else if (data.currentPrice && price === data.currentPrice) {
          updateData.priceDecreased = false;
          updateData.priceIncreased = false;
        }
      }

      // Update item with current price
      await itemRef.update(updateData);

      // Add to price history
      await db.collection('items').doc(itemId).collection('prices').add({
        price: price,
        timestamp: timestamp
      });

      return { success: true, price };
    } else {
      throw new functions.https.HttpsError('internal', 'Could not extract price.');
    }
  });

exports.scheduledScrape = functions
  .region('europe-west1')
  .pubsub.schedule('0 3 * * *')
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    console.log('Starting scheduled scrape...');
    const itemsSnapshot = await db.collection('items').get();

    let priceDecreases = [];
    let priceIncreases = [];

    for (const doc of itemsSnapshot.docs) {
      const item = doc.data();
      if (!item.url) continue;

      const newPrice = await scrapePrice(item.url);
      if (newPrice !== null && newPrice !== item.currentPrice) {
        const diff = newPrice - item.currentPrice;

        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        let updateData = {
          currentPrice: newPrice,
          lastUpdated: timestamp
        };

        if (diff < 0) {
          updateData.priceDecreased = true;
          updateData.priceIncreased = false;
        } else {
          updateData.priceDecreased = false;
          updateData.priceIncreased = true;
        }

        await db.collection('items').doc(doc.id).update(updateData);
        await db.collection('items').doc(doc.id).collection('prices').add({
          price: newPrice,
          timestamp: timestamp
        });

        const reportItem = {
          name: item.name,
          oldPrice: item.currentPrice,
          newPrice: newPrice,
          diff: Math.abs(diff).toFixed(2),
          url: item.url
        };

        if (diff < 0) {
          priceDecreases.push(reportItem);
        } else {
          priceIncreases.push(reportItem);
        }
      }
    }

    if (priceDecreases.length > 0 || priceIncreases.length > 0) {
      await sendReportEmail(priceDecreases, priceIncreases);
    }

    console.log('Scheduled scrape finished.');
  });

async function sendReportEmail(decreases, increases) {
  // Use Resend API key stored in functions config or env
  const resendApiKey = process.env.RESEND_API_KEY || functions.config().resend.apikey;
  if (!resendApiKey) {
    console.error('Missing Resend API Key');
    return;
  }

  const resend = new Resend(resendApiKey);

  // Fetch users
  const usersSnapshot = await db.collection('users').get();
  const emails = usersSnapshot.docs.map(doc => doc.data().email).filter(e => e);

  if (emails.length === 0) {
    console.error('No user emails found in Users collection.');
    return;
  }

  let html = '<h2>Rapport Quotidien Prixo</h2>';

  if (decreases.length > 0) {
    html += '<h3 style="color: green;">📉 Baisses de prix !</h3><ul>';
    decreases.forEach(item => {
      html += `<li><a href="${item.url}">${item.name}</a> : <s>${item.oldPrice}€</s> <strong>${item.newPrice}€</strong> (-${item.diff}€)</li>`;
    });
    html += '</ul>';
  }

  if (increases.length > 0) {
    html += '<h3 style="color: red;">📈 Hausses de prix</h3><ul>';
    increases.forEach(item => {
      html += `<li><a href="${item.url}">${item.name}</a> : <s>${item.oldPrice}€</s> <strong>${item.newPrice}€</strong> (+${item.diff}€)</li>`;
    });
    html += '</ul>';
  }

  try {
    await resend.emails.send({
      from: 'Prixo <onboarding@resend.dev>', // Needs proper domain if configured
      to: emails,
      subject: 'Vos alertes de prix - Prixo',
      html: html
    });
    console.log('Email sent successfully.');
  } catch (error) {
    console.error('Error sending email:', error);
  }
}
