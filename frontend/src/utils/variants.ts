// Modèle de données des variantes de couleur et des prix multi-pays.
//
// Un article peut regrouper plusieurs couleurs du même produit. Chaque variante
// porte ses propres URLs (Belgique + France), sa propre image et ses propres
// historiques de prix. Les champs de premier niveau de l'article (currentPrice,
// history, url, imageUrl...) restent un miroir de la variante active, afin que
// le tri, le budget cumulé et la cloche de notifications continuent de
// fonctionner sans connaître les variantes.

export interface PricePoint {
  date: string;
  price: number;
}

export interface Variant {
  id: string;
  color: string;
  colorHex: string;
  url: string;
  urlFr: string;
  imageUrl: string;
  currentPrice: number;
  currentPriceFr: number | null;
  history: PricePoint[];
  historyFr: PricePoint[];
  lastScrapeError?: string | null;
  lastScrapeErrorFr?: string | null;
}

export const DEFAULT_VARIANT_ID = 'default';

export function newVariantId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Déduit l'URL de la version française à partir d'une URL belge.
 * Retourne '' si le site ne suit aucun schéma reconnu : l'URL FR devra alors
 * être collée à la main dans le formulaire.
 */
export function deriveFrUrl(url: string): string {
  if (!url) return '';

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }

  // Cas 1 : domaine national — jysk.be/fr/... -> jysk.fr/...
  if (u.hostname.endsWith('.be')) {
    u.hostname = `${u.hostname.slice(0, -3)}.fr`;
    // Le préfixe de langue devient redondant sur un domaine .fr
    if (u.pathname === '/fr' || u.pathname === '/fr/') {
      u.pathname = '/';
    } else if (u.pathname.startsWith('/fr/')) {
      u.pathname = u.pathname.slice(3);
    }
    return u.toString();
  }

  // Cas 2 : pays dans le chemin — ikea.com/be/fr/... -> ikea.com/fr/fr/...
  const segments = u.pathname.split('/');
  const localeIndex = segments.findIndex(s => /^(be|be-fr|fr-be)$/i.test(s));
  if (localeIndex !== -1) {
    const segment = segments[localeIndex];
    const isUpper = segment === segment.toUpperCase();
    let replacement: string;
    if (/^be$/i.test(segment)) replacement = 'fr';
    else replacement = 'fr-fr';
    segments[localeIndex] = isUpper ? replacement.toUpperCase() : replacement;
    u.pathname = segments.join('/');
    return u.toString();
  }

  return '';
}

/** Déduit une marque probable à partir du domaine, pour pré-remplir le formulaire. */
export function guessBrand(url: string): string {
  if (!url) return '';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.')[0];
    if (!name) return '';
    // maisonsdumonde -> Maisonsdumonde ; ikea -> Ikea
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return '';
  }
}

/**
 * Normalise un article en liste de variantes. Les articles créés avant cette
 * fonctionnalité n'ont pas de tableau `variants` : ils sont vus comme une
 * variante unique construite à partir de leurs champs de premier niveau.
 */
export function getVariants(item: any): Variant[] {
  if (!item) return [];

  if (Array.isArray(item.variants) && item.variants.length > 0) {
    return item.variants.map((v: any, i: number) => ({
      id: v.id || `${DEFAULT_VARIANT_ID}_${i}`,
      color: v.color || '',
      colorHex: v.colorHex || '',
      url: v.url || '',
      urlFr: v.urlFr || '',
      imageUrl: v.imageUrl || '',
      currentPrice: typeof v.currentPrice === 'number' ? v.currentPrice : 0,
      currentPriceFr: typeof v.currentPriceFr === 'number' ? v.currentPriceFr : null,
      history: Array.isArray(v.history) ? v.history : [],
      historyFr: Array.isArray(v.historyFr) ? v.historyFr : [],
      lastScrapeError: v.lastScrapeError ?? null,
      lastScrapeErrorFr: v.lastScrapeErrorFr ?? null,
    }));
  }

  return [{
    id: DEFAULT_VARIANT_ID,
    color: '',
    colorHex: '',
    url: item.url || '',
    urlFr: item.urlFr || '',
    imageUrl: item.imageUrl || '',
    currentPrice: typeof item.currentPrice === 'number' ? item.currentPrice : 0,
    currentPriceFr: typeof item.currentPriceFr === 'number' ? item.currentPriceFr : null,
    history: Array.isArray(item.history) ? item.history : [],
    historyFr: Array.isArray(item.historyFr) ? item.historyFr : [],
    lastScrapeError: item.lastScrapeError ?? null,
    lastScrapeErrorFr: item.lastScrapeErrorFr ?? null,
  }];
}

/** La variante actuellement sélectionnée, ou la première si la sélection est obsolète. */
export function getActiveVariant(item: any): Variant | null {
  const variants = getVariants(item);
  if (variants.length === 0) return null;
  return variants.find(v => v.id === item?.activeVariantId) || variants[0];
}

/** Vrai dès que l'article regroupe plusieurs couleurs. */
export function hasColorVariants(item: any): boolean {
  return Array.isArray(item?.variants) && item.variants.length > 1;
}

/**
 * Champs de premier niveau à écrire pour refléter la variante active.
 * Utilisé au changement de couleur côté UI et après chaque scraping côté serveur.
 */
export function mirrorOfVariant(variant: Variant) {
  return {
    url: variant.url,
    urlFr: variant.urlFr || '',
    imageUrl: variant.imageUrl || '',
    currentPrice: variant.currentPrice || 0,
    currentPriceFr: variant.currentPriceFr === null ? null : variant.currentPriceFr,
    history: variant.history || [],
    historyFr: variant.historyFr || [],
    lastScrapeError: variant.lastScrapeError || null,
    lastScrapeErrorFr: variant.lastScrapeErrorFr || null,
  };
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

/**
 * Convertit les variantes saisies dans un formulaire en variantes persistables,
 * en réutilisant prix et historiques des variantes déjà connues (appariement
 * par identifiant). Une variante inédite démarre à zéro et sera renseignée au
 * premier scraping.
 */
export function draftsToVariants(
  drafts: Array<{ id: string; color: string; colorHex: string; url: string; urlFr: string; urlFrManual?: boolean; imageUrl: string }>,
  existing: Variant[] = []
): Variant[] {
  const byId = new Map(existing.map(v => [v.id, v]));

  return drafts.map(draft => {
    const previous = byId.get(draft.id);
    // Changer l'URL d'une variante repart d'un historique vierge : ce n'est
    // plus le même produit suivi.
    const sameUrl = previous?.url === draft.url;

    // Une URL française seulement déduite n'est pas enregistrée : le scraper la
    // recalculera et ne la mémorisera qu'après un relevé réussi. Sans cela, la
    // fiche article proposerait un lien vers une page qui n'existe pas.
    const urlFr = draft.urlFrManual === false ? '' : (draft.urlFr || '');

    const sameFrUrl = sameUrl && previous?.urlFr === urlFr;

    // Firestore rejette `undefined`, y compris dans les objets imbriqués :
    // les erreurs absentes sont écrites à null.
    return {
      id: draft.id,
      color: draft.color || '',
      colorHex: draft.colorHex || '',
      url: draft.url,
      urlFr,
      imageUrl: draft.imageUrl || '',
      currentPrice: sameUrl ? (previous?.currentPrice ?? 0) : 0,
      currentPriceFr: sameFrUrl ? (previous?.currentPriceFr ?? null) : null,
      history: sameUrl ? (previous?.history ?? []) : [],
      historyFr: sameFrUrl ? (previous?.historyFr ?? []) : [],
      lastScrapeError: (sameUrl ? previous?.lastScrapeError : null) ?? null,
      lastScrapeErrorFr: (sameFrUrl ? previous?.lastScrapeErrorFr : null) ?? null,
    } as Variant;
  });
}

/** Retire les clés `undefined`, que Firestore refuse. */
export function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/**
 * Le point le plus bas jamais relevé dans un historique.
 * Les relevés à zéro (article jamais scrapé, page en erreur) sont ignorés :
 * ce ne sont pas des prix. En cas d'égalité, on retient la date la plus
 * récente — c'est la question qu'on se pose devant la fiche : « à quand
 * remonte la dernière fois qu'il était à ce prix ? ».
 */
export function getLowestPoint(history: PricePoint[] | null | undefined): PricePoint | null {
  if (!Array.isArray(history) || history.length === 0) return null;

  let best: PricePoint | null = null;
  for (const point of history) {
    const price = Number(point?.price);
    if (!Number.isFinite(price) || price <= 0 || !point?.date) continue;
    if (!best || price < best.price || (price === best.price && point.date >= best.date)) {
      best = { date: point.date, price };
    }
  }
  return best;
}

/**
 * Formate une date d'historique. Les relevés automatiques sont stockés en
 * `AAAA-MM-JJ`, les corrections manuelles en ISO complet : les deux doivent
 * s'afficher sans décalage de fuseau.
 */
export function formatHistoryDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
): string {
  if (!date) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('fr-FR', options);
}
