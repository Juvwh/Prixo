import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../utils/cn';
import { formatPrice } from '../utils/variants';

interface DualPriceProps {
  priceBe: number;
  priceFr: number | null;
  errorBe?: string | null;
  errorFr?: string | null;
  /** 'card' pour la grille du dashboard, 'detail' pour la fiche article. */
  size?: 'card' | 'detail';
}

/**
 * Affiche côte à côte le prix belge et le prix français.
 * Le pays est porté par un drapeau + un code à deux lettres, et le pays le
 * moins cher est mis en avant par un liseré vert et un badge "meilleur prix".
 */
export function DualPrice({ priceBe, priceFr, errorBe, errorFr, size = 'card' }: DualPriceProps) {
  const hasFr = priceFr !== null && priceFr !== undefined && !errorFr;
  const beValid = !errorBe && typeof priceBe === 'number' && priceBe > 0;

  // On ne désigne un gagnant que si les deux prix sont exploitables et différents.
  const comparable = hasFr && beValid && priceFr !== priceBe;
  const beIsCheapest = comparable && priceBe < (priceFr as number);
  const frIsCheapest = comparable && (priceFr as number) < priceBe;

  const gap = comparable ? Math.abs((priceFr as number) - priceBe) : 0;

  if (!hasFr) {
    // Pas d'équivalent français connu : on garde l'affichage simple d'origine.
    return (
      <div>
        <p className={cn(
          'font-bold',
          size === 'detail' ? 'text-4xl sm:text-5xl' : 'text-2xl',
          errorBe ? 'text-[#adb5bd] line-through' : 'text-[#212529]'
        )}>
          {formatPrice(priceBe)}
        </p>
        <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold uppercase tracking-wider text-[#6c757d]">
          <span aria-hidden="true">🇧🇪</span> Belgique
        </span>
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-2', size === 'detail' && 'gap-3')}>
      <PriceTile
        flag="🇧🇪"
        country="Belgique"
        code="BE"
        price={priceBe}
        error={errorBe}
        isCheapest={beIsCheapest}
        size={size}
      />
      <PriceTile
        flag="🇫🇷"
        country="France"
        code="FR"
        price={priceFr as number}
        error={errorFr}
        isCheapest={frIsCheapest}
        size={size}
      />
      {comparable && (
        <p className="col-span-2 text-[11px] text-[#6c757d]">
          {frIsCheapest ? 'La France' : 'La Belgique'} est moins chère de{' '}
          <span className="font-semibold text-[#212529]">{formatPrice(gap)}</span>
        </p>
      )}
    </div>
  );
}

interface PriceTileProps {
  flag: string;
  country: string;
  code: string;
  price: number;
  error?: string | null;
  isCheapest: boolean;
  size: 'card' | 'detail';
}

function PriceTile({ flag, country, code, price, error, isCheapest, size }: PriceTileProps) {
  return (
    <div
      title={error || country}
      className={cn(
        'relative rounded-xl border px-3 py-2 transition-colors',
        isCheapest
          ? 'border-[#a8d5ba] bg-[#eef2f0]'
          : 'border-[#dee2e6] bg-[#f8f9fa]'
      )}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span aria-hidden="true" className="text-xs leading-none">{flag}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#6c757d]">{code}</span>
        {isCheapest && (
          <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-[#4a7c59]">
            Meilleur prix
          </span>
        )}
      </div>

      {error ? (
        <div className="flex items-center text-amber-500">
          <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
          <span className="text-xs font-medium truncate">Indisponible</span>
        </div>
      ) : (
        <p className={cn(
          'font-bold text-[#212529] tabular-nums',
          size === 'detail' ? 'text-2xl sm:text-3xl' : 'text-lg'
        )}>
          {formatPrice(price)}
        </p>
      )}
    </div>
  );
}
