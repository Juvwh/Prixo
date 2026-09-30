import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import puppeteer, { Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Resend } from 'resend';

admin.initializeApp();
const db = admin.firestore();

// Helper to sleep for a given number of milliseconds
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Navigateur partagé -----------------------------------------------------
//
// Chromium est de loin l'élément le plus coûteux d'un scraping : on le lance une
// seule fois par exécution et on le relance automatiquement s'il meurt en route
// (OOM, crash du renderer). Sans ce filet, un seul crash faisait échouer tous
// les articles restants du passage automatique.

const LAUNCH_ARGS = [
  ...chromium.args,
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--mute-audio',
  '--no-first-run',
];

async function launchBrowser(): Promise<Browser> {
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1366, height: 900 } as any,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

/** Instance Chromium réutilisable, relancée à la demande si elle s'est déconnectée. */
class BrowserSession {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  async get(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      const dead = this.browser;
      this.browser = null;
      if (dead) await dead.close().catch(() => {});
      this.browser = await launchBrowser();
      return this.browser;
    })();

    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => {});
  }
}

/**
 * Exécute `worker` sur tous les éléments avec N tâches parallèles.
 * Contrairement au découpage en tranches précédent, un élément lent ne bloque
 * plus les suivants : dès qu'une tâche se libère elle prend l'élément suivant.
 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (err) {
        console.error('Erreur non gérée dans le pool de scraping:', err);
      }
    }
  });
  await Promise.all(runners);
}

/**
 * Limite le nombre d'opérations simultanées.
 * Utilisé pour plafonner les onglets Chromium ouverts en même temps, toutes
 * fonctions confondues : au-delà, les pages se volent le CPU et expirent.
 */
class Semaphore {
  private readonly waiters: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}


// --- Politesse par domaine --------------------------------------------------
//
// Plusieurs articles pointent vers le même site (Ikea, Jysk...). Taper trois
// pages simultanées sur un même domaine déclenchait des 403 : on espace les
// requêtes d'un même hôte sans ralentir les autres.

const HOST_MIN_INTERVAL_MS = 1500;
const nextHostSlot = new Map<string, number>();

async function politeWait(url: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const now = Date.now();
  const slot = Math.max(now, nextHostSlot.get(host) || 0);
  nextHostSlot.set(host, slot + HOST_MIN_INTERVAL_MS);
  if (slot > now) await sleep(slot - now);
}

// --- Lecture d'un prix ------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ACCEPT_LANGUAGE = 'fr-BE,fr;q=0.9,nl-BE;q=0.8,en;q=0.7';

const PAGE_TIMEOUT_MS = 25000;
// Deuxième tentative : on laisse franchement plus de temps. La plupart des
// « timeouts » du mail quotidien venaient de sites lents (Ikea, Jysk) qui
// n'avaient besoin que de quelques secondes de plus.
const PAGE_TIMEOUT_RETRY_MS = 40000;
const PRICE_WAIT_MS = 8000;
const MAX_ATTEMPTS = 2;

// Chaque article charge sa page belge ET sa page française en parallèle, et le
// passage quotidien traite plusieurs articles à la fois : sans plafond global on
// se retrouvait avec 8 onglets Chromium concurrents sur un seul cœur. Les pages
// ne timeoutaient pas parce que les sites étaient lents, mais parce que le CPU
// était saturé. On borne donc le nombre d'onglets réellement ouverts.
const MAX_CONCURRENT_PAGES = 6;

const pageSlots = new Semaphore(MAX_CONCURRENT_PAGES);

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'stylesheet', 'font', 'media']);

// Trackers et régies publicitaires : inutiles pour le prix, et souvent très lents.
const BLOCKED_HOST_PATTERNS = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /doubleclick\.net/i,
  /connect\.facebook\.net/i,
  /hotjar\.com/i,
  /clarity\.ms/i,
  /criteo\./i,
  /adservice\.google\./i,
  /trustpilot\.com/i,
  /cdn\.cookielaw\.org/i,
  /googlesyndication\.com/i,
  /googleadservices\.com/i,
  /bat\.bing\.com/i,
  /snap\.licdn\.com/i,
  /analytics\.tiktok\.com/i,
  /segment\.(io|com)/i,
  /newrelic\.com/i,
  /nr-data\.net/i,
  /dynamicyield\.com/i,
  /monetate\.net/i,
  /optimizely\.com/i,
  /qualtrics\.com/i,
  /usercentrics\.eu/i,
  /cookiebot\.com/i,
  /\.sitecore(cloud|)\.io\/.*analytics/i,
];

// Du plus spécifique au plus générique : le premier candidat exploitable gagne.
const PRICE_SELECTORS = [
  '[data-testid="price"]',
  '[data-test="product-price"]',
  '[data-test-target="price"]',
  '.pip-temp-price__integer',
  '.pip-price__integer',
  '.product-price__current',
  '.price__current',
  '.current-price',
  '.product-price',
  '.price-value',
  '.sales-price',
  '.price-sales',
  '.a-price .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  'span[itemprop="price"]',
  '.price',
];

/**
 * Convertit un prix affiché en nombre.
 * Gère « 1.299,00 € », « 1,299.00 », « 1 299,- » et « 149€90 ».
 * L'ancienne version faisait un simple `replace(',', '.')`, ce qui transformait
 * « 1.299,00 € » en 1,29 € et polluait l'historique.
 */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 && raw < 1000000 ? Math.round(raw * 100) / 100 : null;
  }
  if (typeof raw !== 'string') return null;

  let text = raw.replace(/[\u00a0\u202f\u2009]/g, ' ').trim();
  if (!text) return null;

  // Formes courtes des sites belges : « 149€90 », « 1 299,- »
  text = text.replace(/(\d)\s*[€$£]\s*(\d{2})(?!\d)/, '$1,$2').replace(/,-/g, '');

  const match = text.match(/\d[\d\s.,']*/);
  if (!match) return null;

  let num = match[0].replace(/[\s']/g, '').replace(/[.,]+$/, '');
  const lastComma = num.lastIndexOf(',');
  const lastDot = num.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // Les deux séparateurs sont présents : le dernier est le séparateur décimal.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    num = num.split(thousandSep).join('');
    const groups = num.split(decimalSep);
    num = `${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`;
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const groups = num.split(sep);
    const decimals = groups[groups.length - 1].length;
    if (decimals === 3 && groups[0].length <= 3) {
      num = groups.join(''); // « 1.299 » / « 1,299 » = séparateur de milliers
    } else {
      num = `${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`;
    }
  }

  const value = parseFloat(num);
  if (!Number.isFinite(value) || value <= 0 || value > 1000000) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Remonte tous les prix plausibles trouvés sur la page, par ordre de fiabilité :
 * JSON-LD (schema.org), puis microdonnées / Open Graph, puis sélecteurs CSS.
 */
async function extractPriceCandidates(page: any): Promise<Array<string | number>> {
  return page.evaluate((selectors: string[]) => {
    // Une fiche « ProductGroup » (Jysk, Maisons du Monde...) déclare toutes les
    // couleurs d'un coup. Prendre la première offre venue donnait le prix d'une
    // autre variante : on remonte d'abord celles dont la référence correspond à
    // l'URL relevée.
    const priority: Array<string | number> = [];
    const rest: Array<string | number> = [];

    const articleHints: string[] = [];
    new URLSearchParams(location.search).forEach(value => {
      if (/^\d{4,}$/.test(value)) articleHints.push(value);
    });
    (location.pathname.match(/\d{5,}/g) || []).forEach(id => articleHints.push(id));

    const matchesPage = (node: any): boolean => {
      if (!node || typeof node !== 'object') return false;
      const ids = [node.sku, node.gtin, node.gtin13, node.mpn, node.productID, node.url]
        .filter(Boolean)
        .map(String);
      if (ids.some(id => id === location.href)) return true;
      return ids.some(id => articleHints.some(hint => id.includes(hint)));
    };

    const push = (v: any, preferred: boolean) => {
      const target = preferred ? priority : rest;
      if (typeof v === 'number' && isFinite(v)) target.push(v);
      else if (typeof v === 'string' && v.trim()) target.push(v);
    };

    const typesOf = (node: any): string[] => {
      const t = node && node['@type'];
      if (!t) return [];
      return (Array.isArray(t) ? t : [t]).map((x: any) => String(x));
    };

    const fromOffer = (offer: any, depth: number, preferred: boolean): void => {
      if (!offer || typeof offer !== 'object' || depth > 5) return;
      if (Array.isArray(offer)) {
        offer.forEach(o => fromOffer(o, depth + 1, preferred));
        return;
      }
      const isPreferred = preferred || matchesPage(offer);
      push(offer.price, isPreferred);
      if (offer.priceSpecification) {
        const specs = Array.isArray(offer.priceSpecification)
          ? offer.priceSpecification
          : [offer.priceSpecification];
        specs.forEach((s: any) => s && push(s.price, isPreferred));
      }
      push(offer.lowPrice, isPreferred);
      if (offer.offers) fromOffer(offer.offers, depth + 1, isPreferred);
    };

    const visit = (node: any, depth: number): void => {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) {
        node.forEach(n => visit(n, depth + 1));
        return;
      }
      const types = typesOf(node);
      if (types.some(t => /Product|ItemPage/i.test(t))) {
        if (node.offers) fromOffer(node.offers, 0, matchesPage(node));
        if (node.hasVariant) visit(node.hasVariant, depth + 1);
      } else if (types.some(t => /Offer/i.test(t))) {
        fromOffer(node, 0, false);
      }
      if (node['@graph']) visit(node['@graph'], depth + 1);
      if (node.mainEntity) visit(node.mainEntity, depth + 1);
    };

    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        visit(JSON.parse(script.textContent || ''), 0);
      } catch (e) {
        // JSON-LD malformé : on passe au bloc suivant
      }
    });

    const metaSelectors = [
      '[itemprop="price"]',
      'meta[itemprop="lowPrice"]',
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
    ];
    metaSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        push(el.getAttribute('content') || el.getAttribute('value') || el.textContent, false);
      });
    });

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const attr = el.getAttribute('content') || el.getAttribute('data-price');
        push(attr || (el as HTMLElement).innerText || el.textContent, false);
      });
    }

    return [...priority, ...rest];
  }, PRICE_SELECTORS);
}

/** Détecte une redirection qui nous a sortis de la fiche produit (accueil, 404, recherche). */
function looksRedirectedAway(originalUrl: string, finalUrl: string): boolean {
  try {
    const from = new URL(originalUrl);
    const to = new URL(finalUrl);
    // Changement de domaine (be -> com, redirection marketing) : on tente quand même
    // de lire la page plutôt que de déclarer l'article introuvable.
    if (from.hostname.replace(/^www\./, '') !== to.hostname.replace(/^www\./, '')) return false;

    const fromSegments = from.pathname.split('/').filter(Boolean);
    const segments = to.pathname.split('/').filter(Boolean);

    // Accueil, ou simple racine de langue type /fr, /be/fr
    if (segments.length === 0 || segments.every(s => /^[a-z]{2}(-[a-z]{2})?$/i.test(s))) return true;
    if (segments.some(s => /^(404|410|not-found|page-not-found|error|notfound)$/i.test(s))) return true;

    const wasSearch = /\/(search|recherche|zoeken)(\/|$)/i.test(from.pathname);
    if (!wasSearch && /\/(search|recherche|zoeken)(\/|$)/i.test(to.pathname)) return true;

    // Cas typique d'une URL FR déduite qui n'existe pas : le site renvoie vers
    // une catégorie. La référence produit de l'URL d'origine a alors disparu.
    const productId = (fromSegments[fromSegments.length - 1] || '').match(/\d{5,}/);
    if (productId && !to.pathname.includes(productId[0])) return true;

    const PRODUCT_MARKERS = /^(p|product|products|produit|produits|dp|item|artikel|pip)$/i;
    const fromHasMarker = fromSegments.some(s => PRODUCT_MARKERS.test(s));
    if (fromHasMarker && !segments.some(s => PRODUCT_MARKERS.test(s))) return true;

    return false;
  } catch {
    return false;
  }
}

interface ScrapeAttemptResult {
  price: number | null;
  error: string | null;
  retryable: boolean;
}

async function scrapePriceAttempt(url: string, browser: Browser, attempt: number): Promise<ScrapeAttemptResult> {
  let page: any = null;
  try {
    const navTimeout = attempt === 0 ? PAGE_TIMEOUT_MS : PAGE_TIMEOUT_RETRY_MS;

    page = await browser.newPage();
    page.setDefaultTimeout(navTimeout);
    page.setDefaultNavigationTimeout(navTimeout);
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': ACCEPT_LANGUAGE });

    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      // Un `continue()` sur une requête déjà traitée lève une exception : sans ce
      // try/catch elle remontait en rejet non géré et pouvait tuer l'exécution.
      try {
        if (
          BLOCKED_RESOURCE_TYPES.has(req.resourceType()) ||
          BLOCKED_HOST_PATTERNS.some(re => re.test(req.url()))
        ) {
          req.abort();
        } else {
          req.continue();
        }
      } catch (e) {
        /* requête déjà résolue */
      }
    });

    // On attend uniquement `domcontentloaded`. L'ancienne deuxième tentative
    // utilisait `networkidle2`, jamais atteint sur les sites marchands qui
    // gardent des connexions ouvertes (chat, tracking, lazy-loading) : elle
    // expirait systématiquement et transformait un site simplement lent en
    // « Délai d'attente dépassé ».
    let response: any = null;
    let navTimedOut = false;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (navError: any) {
      if (!/Timeout|timed out/i.test(String(navError?.message || navError))) throw navError;
      // La navigation n'a pas « fini », mais le document est le plus souvent
      // déjà rendu : c'est une ressource tierce qui traîne. On tente la lecture
      // du prix avant de déclarer l'article en échec.
      navTimedOut = true;
    }

    // Rien n'a été chargé du tout : inutile d'attendre un prix sur about:blank.
    if (navTimedOut && !/^https?:/i.test(page.url())) {
      return { price: null, error: "Délai d'attente dépassé (timeout)", retryable: true };
    }

    const status = response ? response.status() : 0;
    if (status === 403 || status === 429) {
      return { price: null, error: `Protection anti-bot ou accès refusé (erreur ${status})`, retryable: true };
    }
    if (status === 404 || status === 410) {
      return { price: null, error: 'Article introuvable (page supprimée)', retryable: false };
    }
    if (status >= 500) {
      return { price: null, error: `Le site a renvoyé une erreur ${status}`, retryable: true };
    }

    if (looksRedirectedAway(url, page.url())) {
      return { price: null, error: 'Article introuvable (redirection hors de la fiche produit)', retryable: false };
    }

    // Beaucoup de sites injectent le prix en JavaScript après le DOM : on attend
    // qu'une valeur apparaisse au lieu de lire une page encore vide.
    await page
      .waitForFunction(
        (selectors: string[]) => {
          const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
          if (scripts.some(s => /"(?:price|lowPrice)"\s*:/.test(s.textContent || ''))) return true;
          if (document.querySelector('meta[property="product:price:amount"], [itemprop="price"]')) return true;
          return selectors.some(sel => {
            const el = document.querySelector(sel);
            return !!el && !!((el as HTMLElement).innerText || el.textContent || '').trim();
          });
        },
        { timeout: PRICE_WAIT_MS, polling: 400 },
        PRICE_SELECTORS
      )
      .catch(() => {
        /* on tente quand même l'extraction */
      });

    const candidates = await extractPriceCandidates(page);
    for (const candidate of candidates) {
      const price = parsePrice(candidate);
      if (price !== null) return { price, error: null, retryable: false };
    }

    if (navTimedOut) {
      return { price: null, error: "Délai d'attente dépassé (timeout)", retryable: true };
    }
    return { price: null, error: 'Prix introuvable sur la page', retryable: true };
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/Timeout|timed out/i.test(message)) {
      return { price: null, error: "Délai d'attente dépassé (timeout)", retryable: true };
    }
    if (/net::ERR_NAME_NOT_RESOLVED/i.test(message)) {
      return { price: null, error: 'Domaine introuvable', retryable: false };
    }
    if (/net::ERR_/i.test(message)) {
      return { price: null, error: 'Page inaccessible (erreur réseau)', retryable: true };
    }
    console.error(`Erreur de scraping sur ${url}:`, message);
    return { price: null, error: 'Erreur technique lors du chargement de la page', retryable: true };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * Relève le prix d'une page produit, avec une nouvelle tentative en cas d'échec
 * transitoire (timeout, 403, prix pas encore rendu).
 */
async function scrapePrice(
  url: string,
  existingSession?: BrowserSession
): Promise<{ price: number | null; error: string | null }> {
  const ownSession = existingSession ? null : new BrowserSession();
  const session = existingSession || (ownSession as BrowserSession);

  try {
    let last: ScrapeAttemptResult = { price: null, error: 'Erreur inconnue', retryable: false };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(1500);
      await politeWait(url);

      let browser: Browser;
      try {
        browser = await session.get();
      } catch (err) {
        console.error('Impossible de lancer Chromium:', err);
        return { price: null, error: 'Navigateur indisponible sur le serveur' };
      }

      // Le sémaphore est pris ici, et jamais autour de `politeWait` : attendre
      // son tour de politesse ne doit pas immobiliser un onglet.
      last = await pageSlots.run(() => scrapePriceAttempt(url, browser, attempt));
      if (last.price !== null || !last.retryable) break;
    }

    return { price: last.price, error: last.error };
  } finally {
    if (ownSession) await ownSession.close();
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

/** Bilan d'un article : couleurs relevées, en échec, ou reportées faute de temps. */
interface ScrapeStats {
  ok: number;
  failed: number;
  skipped: number;
}

/**
 * Relève les prix de toutes les couleurs d'un article (Belgique + France) et
 * construit la mise à jour Firestore correspondante.
 * Les changements retournés sont exclusivement belges : la France n'alimente
 * ni le mail quotidien ni la cloche.
 */
async function scrapeItemVariants(
  itemData: any,
  session: BrowserSession,
  deadline?: number
): Promise<{ updateData: any; changes: VariantPriceChange[]; stats: ScrapeStats }> {
  const variants = normalizeVariants(itemData);
  const changes: VariantPriceChange[] = [];
  const stats: ScrapeStats = { ok: 0, failed: 0, skipped: 0 };

  for (const variant of variants) {
    if (!variant.url) {
      variant.lastScrapeError = 'Aucun lien belge enregistré pour cette couleur';
      stats.failed++;
      continue;
    }

    // Plus de temps pour cette couleur : on la laisse intacte plutôt que de la
    // marquer en erreur, elle sera relevée au prochain passage.
    if (deadline && Date.now() > deadline) {
      stats.skipped++;
      continue;
    }

    // Belgique (source de vérité pour les alertes) et France (comparatif) sont
    // sur deux domaines différents : les charger en parallèle divise par deux le
    // temps passé sur chaque couleur.
    const candidateFr = variant.urlFr || deriveFrUrl(variant.url);
    const [resultBe, resultFr] = await Promise.all([
      scrapePrice(variant.url, session),
      candidateFr
        ? scrapePrice(candidateFr, session)
        : Promise.resolve({ price: null as number | null, error: null as string | null }),
    ]);

    // --- Belgique
    if (resultBe.price !== null) {
      stats.ok++;
      const previousPrice = variant.currentPrice;
      if (resultBe.price !== previousPrice) {
        variant.history = pushPricePoint(variant.history, resultBe.price);
        variant.currentPrice = resultBe.price;
        // Un premier relevé (prix précédent absent) n'est pas une variation :
        // l'annoncer comme une hausse polluait le mail quotidien.
        if (previousPrice > 0) {
          changes.push({
            color: variant.color,
            oldPrice: previousPrice,
            newPrice: resultBe.price,
            url: variant.url,
            diff: Math.round((resultBe.price - previousPrice) * 100) / 100,
          });
        }
      }
      variant.lastScrapeError = null;
    } else {
      stats.failed++;
      variant.lastScrapeError = resultBe.error || 'Erreur inconnue lors du scraping';
    }

    // --- France (comparaison seulement, historique séparé, jamais notifiée)
    if (candidateFr) {
      if (resultFr.price !== null) {
        // On ne mémorise une URL déduite qu'une fois qu'elle a fait ses preuves,
        // pour ne pas enregistrer un lien mort dans la fiche article.
        variant.urlFr = candidateFr;
        if (resultFr.price !== variant.currentPriceFr) {
          variant.historyFr = pushPricePoint(variant.historyFr, resultFr.price);
          variant.currentPriceFr = resultFr.price;
        }
        variant.lastScrapeErrorFr = null;
      } else {
        variant.lastScrapeErrorFr = resultFr.error || 'Page française introuvable';
      }
    }
  }

  const active = variants.find(v => v.id === itemData?.activeVariantId) || variants[0];

  const updateData: any = {
    variants,
    activeVariantId: active?.id || '',
    isScraping: false,
    scrapeError: admin.firestore.FieldValue.delete(),
    ...(active ? mirrorOfVariant(active) : {}),
  };

  if (stats.ok > 0 || stats.failed > 0) {
    // Le statut affiché suit la variante active, mais un échec sur une autre
    // couleur ne doit pas passer inaperçu.
    updateData.scrapeStatus = active?.lastScrapeError || stats.failed > 0 ? 'error' : 'success';
  } else if (itemData?.scrapeStatus === 'scraping') {
    // Rien n'a été tenté (budget épuisé) : on ne laisse pas l'article figé sur
    // « recherche en cours » dans l'interface.
    updateData.scrapeStatus = active?.lastScrapeError ? 'error' : 'success';
  }

  // `lastChecked` n'avance que si toutes les couleurs ont été vues : un article
  // partiellement relevé doit repasser en tête de file au prochain passage.
  if (stats.skipped === 0) {
    updateData.lastChecked = new Date().toISOString();
  }

  return { updateData, changes, stats };
}

// Callable function to refresh all items in a board
export const refreshBoardItemsPrice = functions
  .region('europe-west1')
  // 4GB : en gen1 le CPU alloué suit la mémoire. Rendre plusieurs fiches
  // produit en parallèle à 2GB saturait le processeur et provoquait des
  // timeouts qui n'avaient rien à voir avec la lenteur des sites.
  .runWith({ memory: '4GB', timeoutSeconds: 540 })
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

    // Un seul Chromium pour tout le lot, relancé tout seul s'il crashe.
    const session = new BrowserSession();

    // Budget de temps : la fonction est tuée à 540 s. On s'arrête avant pour
    // renvoyer un résultat exploitable à l'interface au lieu d'un timeout.
    const deadline = Date.now() + 440000;

    const CONCURRENCY = 4;
    let updatedCount = 0;
    let skipped = 0;

    try {
      await runPool(docs, CONCURRENCY, async (doc) => {
        try {
          const itemData = doc.data();

          // Skip private items that don't belong to the user
          if (itemData.userId !== context.auth?.uid && itemData.isPrivate) {
              await doc.ref.update({
                isScraping: false,
                scrapeStatus: 'error',
                lastScrapeError: "Non autorisé : article privé appartenant à un autre utilisateur"
              });
              return;
          }

          if (Date.now() > deadline - 45000) {
            skipped++;
            return;
          }

          // Set scrapeStatus to 'scraping' right before attempting to scrape
          await doc.ref.update({
              scrapeStatus: 'scraping',
              lastChecked: new Date().toISOString()
          });

          const { updateData, changes } = await scrapeItemVariants(itemData, session, deadline);

          if (changes.length > 0) {
            updatedCount += changes.length;
          }

          await doc.ref.update(updateData);
        } catch (err) {
          try {
            await doc.ref.update({
              isScraping: false,
              scrapeStatus: 'error',
              lastScrapeError: err instanceof Error ? err.message : "Erreur inattendue"
            });
          } catch (updateErr) {
            console.error(`Failed to update error state for doc ${doc.id}:`, updateErr);
          }
          console.error(`Error processing doc ${doc.id} in board scrape:`, err);
        }
      });
    } finally {
      await session.close();
    }

    const suffix = skipped > 0 ? ` ${skipped} articles n'ont pas pu être traités dans le temps imparti.` : '';

    return {
      success: true,
      message: `Mise à jour terminée. ${updatedCount} prix modifiés sur ${docs.length} articles.${suffix}`,
      updatedCount
    };
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
    const session = new BrowserSession();
    let updateData: any;
    let changes: VariantPriceChange[];

    try {
      ({ updateData, changes } = await scrapeItemVariants(itemData, session, Date.now() + 240000));
    } catch (err) {
      console.error("Failed to scrape item:", err);
      // L'article restait bloqué sur « recherche en cours » quand le scraping
      // échouait : on remet toujours l'indicateur à zéro.
      await itemRef.update({
        isScraping: false,
        scrapeStatus: 'error',
        lastChecked: new Date().toISOString(),
        lastScrapeError: err instanceof Error ? err.message : 'Erreur inattendue',
      }).catch(() => {});
      throw new functions.https.HttpsError('internal', "Impossible de relever les prix de cet article.");
    } finally {
      await session.close();
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

// Expéditeur des mails. `onboarding@resend.dev` est l'adresse de test de
// Resend : elle ne délivre QU'À l'adresse du propriétaire du compte Resend,
// d'où le second compte qui ne recevait jamais rien. Définir EMAIL_FROM
// (variable GitHub, voir deploy-functions.yml) avec une adresse d'un domaine
// vérifié dans Resend, ex. « Prixo <alertes@mondomaine.be> ».
const EMAIL_FROM = process.env.EMAIL_FROM || 'Prixo <onboarding@resend.dev>';

// Le SDK Resend ne lève pas d'exception en cas de refus : il renvoie `{ error }`.
// Sans cette vérification, un envoi refusé passait pour un succès.
async function sendEmail(resend: Resend, to: string, subject: string, html: string): Promise<void> {
  const { error } = await resend.emails.send({ from: EMAIL_FROM, to: [to], subject, html });
  if (error) {
    throw new Error(`Resend a refusé l'envoi à ${to} : ${error.message}`);
  }
}

// Scheduled function to scrape all items and send summary email
// Helper to extract links for ImmoSearch
async function scrapeLinksAttempt(
  url: string,
  filterWord: string,
  browser: Browser
): Promise<{ links: string[]; error: string | null; retryable: boolean }> {
  let page: any = null;

  try {
    page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': ACCEPT_LANGUAGE });

    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      try {
        if (
          BLOCKED_RESOURCE_TYPES.has(req.resourceType()) ||
          BLOCKED_HOST_PATTERNS.some(re => re.test(req.url()))
        ) {
          req.abort();
        } else {
          req.continue();
        }
      } catch (e) {
        /* requête déjà résolue */
      }
    });

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    const status = response ? response.status() : 0;
    if (status === 403 || status === 429) {
      return { links: [], error: `Protection anti-bot ou accès refusé (erreur ${status})`, retryable: true };
    }
    if (status === 404 || status === 410) {
      return { links: [], error: 'Page de recherche introuvable (404)', retryable: false };
    }
    if (status >= 500) {
      return { links: [], error: `Le site a renvoyé une erreur ${status}`, retryable: true };
    }

    // Défilement progressif pour déclencher le chargement paresseux des annonces.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const started = Date.now();
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          // Garde-fou : certaines listes en défilement infini ne s'arrêtent jamais.
          if (totalHeight >= scrollHeight - window.innerHeight || Date.now() - started > 10000) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    }).catch(() => {
      /* le défilement n'est qu'un bonus */
    });

    await sleep(1500); // Give it a sec to load elements

    const baseUrl = new URL(page.url()).origin;

    const extractedLinks = await page.evaluate((filter: string, base: string) => {
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
           const u = new URL(href, base);
           // Les ancres et les liens de suivi créent de faux « nouveaux biens »
           // à chaque passage horaire : on normalise avant de dédupliquer.
           u.hash = '';
           return u.href;
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

    if (extractedLinks.length === 0) {
      return { links: [], error: 'Aucune annonce trouvée sur la page', retryable: true };
    }

    return { links: extractedLinks, error: null, retryable: false };
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/Timeout|timed out/i.test(message)) {
      return { links: [], error: "Délai d'attente dépassé (timeout)", retryable: true };
    }
    console.error(`Error scraping links on ${url}:`, message);
    return { links: [], error: 'Erreur technique lors du chargement de la page', retryable: true };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function scrapeLinks(
  url: string,
  filterWord: string,
  existingSession?: BrowserSession
): Promise<{ links: string[]; error: string | null }> {
  const ownSession = existingSession ? null : new BrowserSession();
  const session = existingSession || (ownSession as BrowserSession);

  try {
    let last = { links: [] as string[], error: 'Erreur inconnue' as string | null, retryable: false };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(2000);
      await politeWait(url);

      let browser: Browser;
      try {
        browser = await session.get();
      } catch (err) {
        console.error('Impossible de lancer Chromium:', err);
        return { links: [], error: 'Navigateur indisponible sur le serveur' };
      }

      last = await scrapeLinksAttempt(url, filterWord, browser);
      if (last.links.length > 0 || !last.retryable) break;
    }

    return { links: last.links, error: last.error };
  } finally {
    if (ownSession) await ownSession.close();
  }
}

// Paramètres de suivi qui changent d'un chargement à l'autre sans changer le
// bien (immoweb ajoute par exemple un `searchId` différent à chaque recherche).
// Liste volontairement courte : certains sites d'agence identifient le bien par
// un paramètre (`?ref=`, `?id=`), qu'il ne faut surtout pas retirer.
const IMMO_TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|msclkid|searchid|search_id|sessionid|position|pos|rank|timestamp)$/i;
const IMMO_SEEN_URLS_MAX = 2000;

// Clé stable d'une annonce : sert uniquement à comparer, l'URL affichée reste celle scrapée.
function immoLinkKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const kept = Array.from(u.searchParams.entries())
      .filter(([name]) => !IMMO_TRACKING_PARAMS.test(name))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length ? '?' + new URLSearchParams(kept).toString() : '';
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${query}`;
  } catch (e) {
    return rawUrl.trim();
  }
}

// Fusionne le résultat d'un scraping avec les liens déjà connus d'une recherche.
//
// `links` ne contient que les annonces visibles au dernier passage : une annonce
// qui disparaissait une heure (pub tournante, tri, chargement paresseux) puis
// revenait était annoncée à nouveau par mail à chaque passage. `seenUrls` garde
// la mémoire de toutes les annonces déjà signalées, indépendamment de `links`
// (que le frontend réécrit aussi quand on marque un bien comme lu).
function mergeImmoLinks(searchData: any, scrapedLinks: string[]) {
  const now = new Date().toISOString();
  const oldLinksMap = new Map<string, any>();
  for (const item of searchData.links || []) {
    if (typeof item === 'string') {
      // Migrate old string arrays on the fly
      oldLinksMap.set(immoLinkKey(item), { url: item, isRead: false, isFavorite: false, isIgnored: false, addedAt: now });
    } else if (item && typeof item === 'object' && item.url) {
      oldLinksMap.set(immoLinkKey(item.url), item);
    }
  }

  const seenKeys: string[] = Array.isArray(searchData.seenUrls) ? searchData.seenUrls.slice() : [];
  const seenSet = new Set(seenKeys);
  for (const key of oldLinksMap.keys()) {
    if (!seenSet.has(key)) {
      seenSet.add(key);
      seenKeys.push(key);
    }
  }

  const updatedLinks: any[] = [];
  const newLinks: string[] = [];
  const scrapedKeys = new Set<string>();

  for (const urlStr of scrapedLinks) {
    const key = immoLinkKey(urlStr);
    if (scrapedKeys.has(key)) continue;
    scrapedKeys.add(key);

    if (oldLinksMap.has(key)) {
      updatedLinks.push(oldLinksMap.get(key));
    } else if (seenSet.has(key)) {
      // Annonce déjà signalée qui réapparaît : on la réaffiche sans la renotifier.
      updatedLinks.push({ url: urlStr, isRead: true, isFavorite: false, isIgnored: false, addedAt: now });
    } else {
      updatedLinks.push({ url: urlStr, isRead: false, isFavorite: false, isIgnored: false, addedAt: now });
      newLinks.push(urlStr);
      seenSet.add(key);
      seenKeys.push(key);
    }
  }

  // Also preserve old links that weren't found in the current scrape if they are favorites or ignored, so users don't lose them
  for (const [key, itemData] of oldLinksMap.entries()) {
    if ((itemData.isFavorite || itemData.isIgnored) && !scrapedKeys.has(key)) {
      updatedLinks.push(itemData);
    }
  }

  return { updatedLinks, newLinks, seenUrls: seenKeys.slice(-IMMO_SEEN_URLS_MAX) };
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

      const session = new BrowserSession();

      let newLinksFound = 0;
      try {
        for (const docSnap of snapshot.docs) {
          const searchData = docSnap.data();
          await docSnap.ref.update({ isScraping: true, lastChecked: new Date().toISOString() });

          const { links, error } = await scrapeLinks(searchData.url, searchData.filterWord || '', session);

          const updateData: any = {
             isScraping: false,
             lastChecked: new Date().toISOString()
          };

          if (error) {
             updateData.lastError = error;
          } else {
             updateData.lastError = null;

             const { updatedLinks, newLinks, seenUrls } = mergeImmoLinks(searchData, links);
             updateData.links = updatedLinks;
             updateData.seenUrls = seenUrls;
             newLinksFound += newLinks.length;
          }

          await docSnap.ref.update(updateData);
        }
      } finally {
        await session.close();
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

    const session = new BrowserSession();
    // Même garde-fou que pour les prix : on s'arrête avant que la fonction ne
    // soit tuée, sinon aucun mail n'est envoyé et rien n'est enregistré.
    const deadline = Date.now() + 420000;

    const CONCURRENCY = 3;
    try {
      await runPool(snapshot.docs, CONCURRENCY, async (docSnap) => {
        try {
          if (Date.now() > deadline) return;

          const searchData = docSnap.data();
          const { links, error } = await scrapeLinks(searchData.url, searchData.filterWord || '', session);

          if (!error && links.length > 0) {
            const { updatedLinks, newLinks, seenUrls } = mergeImmoLinks(searchData, links);

            // Enregistrer avant d'alerter : si l'écriture échoue, mieux vaut
            // rater un mail que renvoyer les mêmes biens toutes les heures.
            await docSnap.ref.update({
               links: updatedLinks,
               seenUrls,
               lastChecked: new Date().toISOString(),
               lastError: null
            });

            if (newLinks.length > 0) {
              alerts.push({
                searchName: searchData.name,
                url: searchData.url,
                newLinks,
                groupId: searchData.groupId
              });
            }
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
    } finally {
      await session.close();
    }

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

          await sendEmail(resend, userRecord.email, 'Prixo Immo - Nouveaux biens trouvés', htmlContent);
        } catch (e) {
          console.error("Email error:", e);
        }
      }
    }
    return null;
  });

// Passage automatique quotidien : relève tous les prix puis envoie la synthèse.
//
// Contrainte forte : une Cloud Function gen1 est tuée à 540 s. L'ancienne
// version scrapait sans regarder l'heure, si bien qu'un catalogue un peu fourni
// était interrompu en plein vol : aucun mail n'était envoyé et des articles
// restaient bloqués en statut « scraping ». On travaille désormais avec un
// budget de temps explicite, et les articles les plus anciennement relevés
// passent en premier pour que la couverture tourne d'un jour à l'autre.
const NIGHTLY_TIME_BUDGET_MS = 430000; // 7 min 10 s de scraping
const NIGHTLY_ITEM_RESERVE_MS = 80000; // marge pour terminer l'article en cours (2 tentatives)
const NIGHTLY_CONCURRENCY = 4;

export const nightlyScrape = functions
  .region('europe-west1')
  // 4GB : voir refreshBoardItemsPrice, le CPU suit la mémoire en gen1.
  .runWith({ memory: '4GB', timeoutSeconds: 540, secrets: ["RESEND_API_KEY"] })
  .pubsub.schedule('30 6 * * *') // Every day at 6:30 AM
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const startedAt = Date.now();
    const deadline = startedAt + NIGHTLY_TIME_BUDGET_MS;

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

    interface ItemFailure {
      name: string;
      reason: string;
      url: string;
      ownerId: string;
      groupId: string;
      isPrivate: boolean;
    }

    const changes: ItemChange[] = [];
    const failures: ItemFailure[] = [];

    // Les articles les plus anciennement vérifiés d'abord : si le budget de
    // temps est épuisé, ce sont ceux déjà à jour qui sautent, pas toujours les
    // mêmes en fin de liste.
    const docs = itemsSnapshot.docs.slice().sort((a, b) => {
      const da = a.data().lastChecked || '';
      const db_ = b.data().lastChecked || '';
      return String(da).localeCompare(String(db_));
    });

    if (docs.length === 0) {
      console.log('nightlyScrape: aucun article à relever.');
      return null;
    }

    const session = new BrowserSession();
    let processed = 0;
    let skipped = 0;

    try {
      await runPool(docs, NIGHTLY_CONCURRENCY, async (doc) => {
        const itemData = doc.data();

        if (Date.now() > deadline - NIGHTLY_ITEM_RESERVE_MS) {
          skipped++;
          return;
        }

        try {
          const { updateData, changes: variantChanges, stats } = await scrapeItemVariants(
            itemData,
            session,
            deadline
          );

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

          if (stats.failed > 0) {
            const firstError =
              (updateData.variants || []).map((v: ScrapeVariant) => v.lastScrapeError).find(Boolean) ||
              'Erreur inconnue';
            failures.push({
              name: itemData.name,
              reason: firstError,
              url: updateData.url || itemData.url || '',
              ownerId: itemData.userId,
              groupId: itemData.groupId,
              isPrivate: itemData.isPrivate || false,
            });
          }

          await doc.ref.update(updateData);
          processed++;
        } catch (err) {
          console.error(`Error processing doc ${doc.id}:`, err);
          failures.push({
            name: itemData.name,
            reason: err instanceof Error ? err.message : 'Erreur inattendue',
            url: itemData.url || '',
            ownerId: itemData.userId,
            groupId: itemData.groupId,
            isPrivate: itemData.isPrivate || false,
          });
          try {
            await doc.ref.update({
              isScraping: false,
              scrapeStatus: 'error',
              lastChecked: new Date().toISOString(),
              lastScrapeError: err instanceof Error ? err.message : "Erreur inattendue"
            });
          } catch (updateErr) {
            console.error(`Failed to update error state for doc ${doc.id}:`, updateErr);
          }
        }
      });
    } finally {
      await session.close();
    }

    const durationSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `nightlyScrape terminé en ${durationSec}s — ${processed}/${docs.length} articles relevés, ` +
      `${skipped} reportés (budget de temps), ${changes.length} variations, ${failures.length} en erreur.`
    );

    // Process and send email if there are changes
    if (changes.length > 0 || failures.length > 0) {
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
          const visibleTo = (entry: { groupId: string; isPrivate: boolean; ownerId: string }) =>
            entry.groupId === userGroupId && (!entry.isPrivate || entry.ownerId === userId);

          const userChanges = changes.filter(visibleTo);
          const userFailures = failures.filter(visibleTo);

          if (userChanges.length === 0 && userFailures.length === 0) continue;

          // Sort: Price drops first, then price increases
          userChanges.sort((a, b) => a.diff - b.diff);

          let htmlContent = `
            <div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; color:#212529;">
              <h2 style="font-weight:600;">Récapitulatif des changements de prix</h2>
              <p style="color:#6c757d; font-size:13px; margin-top:-8px;">
                Prix relevés sur les sites belges 🇧🇪
              </p>
          `;

          if (userChanges.length > 0) {
            htmlContent += '<table style="width:100%; border-collapse:collapse;">';

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

            htmlContent += '</table>';
          } else {
            htmlContent += '<p style="font-size:14px;">Aucun changement de prix aujourd\'hui.</p>';
          }

          // Rendre les échecs visibles : sans cette section, un article dont le
          // lien est cassé restait silencieusement figé pendant des semaines.
          if (userFailures.length > 0) {
            htmlContent += `
              <h3 style="font-weight:600; font-size:15px; margin-top:28px;">Articles non relevés (${userFailures.length})</h3>
              <ul style="font-size:13px; color:#6c757d; padding-left:18px;">
            `;
            for (const failure of userFailures.slice(0, 20)) {
              htmlContent += `<li style="margin-bottom:6px;"><a href="${failure.url}" style="color:#212529;">${failure.name}</a> — ${failure.reason}</li>`;
            }
            htmlContent += '</ul>';
          }

          htmlContent += `
            <p style="color:#adb5bd; font-size:11px; margin-top:24px;">
              ${processed}/${docs.length} articles vérifiés en ${durationSec}s${skipped > 0 ? `, ${skipped} reportés au prochain passage` : ''}.
            </p>
          </div>`;

          await sendEmail(
            resend,
            email,
            userChanges.length > 0
              ? 'Prixo - Changements de prix détectés'
              : 'Prixo - Rapport de relevé quotidien',
            htmlContent
          );
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
      await sendEmail(resend, userEmail, 'Prixo - Email de test (Notification de prix)', htmlContent);
      return { success: true, message: 'Email de test envoyé avec succès.' };
    } catch (error) {
      console.error("Erreur lors de l'envoi de l'email via Resend:", error);
      const detail = error instanceof Error ? error.message : '';
      throw new functions.https.HttpsError('internal', `Erreur lors de l'envoi de l'email. ${detail}`.trim());
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
