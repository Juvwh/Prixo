import React from 'react';
import { TrendingDown } from 'lucide-react';
import { cn } from '../utils/cn';
import {
  PricePoint,
  formatPrice,
  getLowestPoint,
  formatHistoryDate,
} from '../utils/variants';

interface LowestPriceProps {
  /** Historique belge de la couleur affichée. */
  history: PricePoint[];
  /** Historique français, affiché en complément sur la fiche article. */
  historyFr?: PricePoint[];
  /** Prix belge actuel, pour signaler que l'article est au plus bas. */
  currentPrice?: number | null;
  /** 'card' pour la grille du dashboard, 'detail' pour la fiche article. */
  size?: 'card' | 'detail';
  className?: string;
}

/**
 * Rappelle le prix plancher jamais relevé et la date de ce relevé.
 * C'est le repère qui manque devant une promotion : savoir si l'article a
 * déjà été moins cher, et depuis quand il ne l'a plus été.
 */
export function LowestPrice({
  history,
  historyFr,
  currentPrice,
  size = 'card',
  className,
}: LowestPriceProps) {
  const lowestBe = getLowestPoint(history);
  const lowestFr = getLowestPoint(historyFr);

  if (!lowestBe && !lowestFr) return null;

  const isAtLowest =
    !!lowestBe &&
    typeof currentPrice === 'number' &&
    currentPrice > 0 &&
    currentPrice <= lowestBe.price;

  if (size === 'card') {
    if (!lowestBe) return null;
    return (
      <p
        className={cn(
          'flex items-center gap-1.5 text-[11px] text-[#6c757d] tabular-nums',
          className
        )}
        title={`Prix le plus bas relevé le ${formatHistoryDate(lowestBe.date)}`}
      >
        <TrendingDown className="w-3.5 h-3.5 shrink-0 text-[#4a7c59]" />
        <span>
          Plus bas&nbsp;: <span className="font-semibold text-[#212529]">{formatPrice(lowestBe.price)}</span>
          {' · '}
          {formatHistoryDate(lowestBe.date, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        {isAtLowest && (
          <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide text-[#4a7c59]">
            Au plus bas
          </span>
        )}
      </p>
    );
  }

  return (
    <div className={cn('rounded-2xl border border-[#dee2e6] bg-[#f8f9fa] p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown className="w-4 h-4 text-[#4a7c59]" />
        <h4 className="text-sm font-semibold text-[#212529]">Prix le plus bas jamais relevé</h4>
        {isAtLowest && (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-[#4a7c59] bg-[#eef2f0] px-2 py-0.5 rounded-full">
            Atteint aujourd'hui
          </span>
        )}
      </div>

      <div className="space-y-2">
        {lowestBe && (
          <LowestRow flag="🇧🇪" country="Belgique" point={lowestBe} />
        )}
        {lowestFr && (
          <LowestRow flag="🇫🇷" country="France" point={lowestFr} />
        )}
      </div>
    </div>
  );
}

function LowestRow({ flag, country, point }: { flag: string; country: string; point: PricePoint }) {
  return (
    <div className="flex items-baseline gap-2">
      <span aria-hidden="true" className="text-xs leading-none">{flag}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#6c757d] w-16 shrink-0">
        {country}
      </span>
      <span className="text-lg font-bold text-[#212529] tabular-nums">{formatPrice(point.price)}</span>
      <span className="text-xs text-[#6c757d]">le {formatHistoryDate(point.date)}</span>
    </div>
  );
}
