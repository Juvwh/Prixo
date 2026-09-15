import React, { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Heart, AlertTriangle, CheckCircle2, Minus, ImageOff } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { cn } from '../utils/cn';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DualPrice } from './DualPrice';
import { ColorSwatches } from './ColorSwatches';
import { LowestPrice } from './LowestPrice';
import { getVariants, getActiveVariant, formatPrice, FALLBACK_IMAGE } from '../utils/variants';

interface ItemCardProps {
  id: string;
  name: string;
  brand?: string;
  boards?: string[];
  currentPrice: number;
  imageUrl?: string;
  url?: string;
  isPrivate: boolean;
  isFavorite: boolean;
  history: { date: string; price: number }[];
  isScraping?: boolean;
  lastScrapeError?: string;
  isSelected?: boolean;
  isSelectionModeActive?: boolean;
  onClick: () => void;
  onSelectVariant?: (itemId: string, variantId: string) => void;
}

export function ItemCard(props: ItemCardProps) {
  const {
    id, name, brand, boards, currentPrice, imageUrl, url, isPrivate, isFavorite,
    history, isScraping, lastScrapeError, isSelected, isSelectionModeActive,
    onClick, onSelectVariant,
  } = props;

  const [imageFailed, setImageFailed] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: id,
    data: {
      type: 'item',
      item: { id, name, boards, currentPrice, imageUrl, url, isPrivate, isFavorite, history, isScraping, lastScrapeError }
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Tout l'affichage (image, prix, historique) suit la couleur sélectionnée.
  const variants = getVariants(props);
  const active = getActiveVariant(props);
  const shownImage = active?.imageUrl || imageUrl;
  const shownUrl = active?.url || url;
  const shownHistory = active?.history || history || [];
  const shownPrice = active ? active.currentPrice : currentPrice;
  const shownError = active?.lastScrapeError || lastScrapeError;

  // Variation lors du dernier relevé, en valeur et en pourcentage : un écart de
  // 4 € ne se lit pas de la même façon sur un article à 40 € et sur un canapé
  // à 900 €.
  const previous = shownHistory.length > 1 ? shownHistory[shownHistory.length - 2].price : null;
  const latest = shownHistory.length > 0 ? shownHistory[shownHistory.length - 1].price : null;
  const diff = previous !== null && latest !== null ? latest - previous : 0;
  const percent = previous ? (diff / previous) * 100 : 0;

  const priceDropped = diff < 0;
  const priceIncreased = diff > 0;

  // Une ligne demande au moins deux points : en dessous, Recharts dessinait un
  // cadre vide qui se lisait comme un bug d'affichage.
  const hasSparkline = shownHistory.length > 1;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "group bg-white rounded-3xl overflow-hidden shadow-[0_1px_2px_rgb(33_37_41/0.04),0_1px_3px_rgb(33_37_41/0.06)] transition-all duration-300 cursor-pointer border break-inside-avoid mb-6 touch-manipulation",
        !isDragging && "hover:shadow-[0_10px_20px_-8px_rgb(33_37_41/0.14),0_2px_6px_rgb(33_37_41/0.05)] hover:-translate-y-0.5",
        isSelected ? "border-[#a8d5ba] ring-2 ring-[#a8d5ba]/30" : "border-[#dee2e6]",
        isDragging && "shadow-[0_18px_40px_-12px_rgb(33_37_41/0.22)] scale-[1.02] z-50 relative border-[#a8d5ba]"
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#f8f9fa]">
        {imageFailed ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-[#adb5bd] gap-2">
            <ImageOff className="w-7 h-7" />
            <span className="text-[11px] font-medium">Image indisponible</span>
          </div>
        ) : (
          <img
            src={shownImage || FALLBACK_IMAGE}
            alt={name}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={cn(
              "w-full h-full object-contain transition-transform duration-500 group-hover:scale-105",
              isSelectionModeActive && !isSelected && "opacity-75"
            )}
          />
        )}

        <div className="absolute top-4 left-4 flex gap-2">
          {isPrivate && (
            <div className="bg-white/90 backdrop-blur px-2.5 py-1.5 rounded-full flex items-center shadow-sm" title="Article privé">
              <Lock className="w-3.5 h-3.5 text-[#212529]" />
            </div>
          )}
          {isFavorite && (
            <div className="bg-white/90 backdrop-blur px-2.5 py-1.5 rounded-full flex items-center shadow-sm" title="Coup de cœur">
              <Heart className="w-3.5 h-3.5 text-[#212529] fill-[#212529]" />
            </div>
          )}
        </div>

        {/* Pastille de variation : le repère qu'on cherche en balayant la grille. */}
        {!isSelected && !isScraping && !shownError && (priceDropped || priceIncreased) && (
          <div
            className={cn(
              'absolute top-4 right-4 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold shadow-sm backdrop-blur tabular-nums',
              priceDropped ? 'bg-[#4a7c59] text-white' : 'bg-white/90 text-red-600'
            )}
            title={`${priceDropped ? 'Baisse' : 'Hausse'} de ${formatPrice(Math.abs(diff))} au dernier relevé`}
          >
            {priceDropped ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
            {percent ? `${Math.abs(percent).toFixed(0)} %` : formatPrice(Math.abs(diff))}
          </div>
        )}

        {isSelected && (
          <div className="absolute top-4 right-4 bg-white rounded-full shadow-sm">
            <CheckCircle2 className="w-6 h-6 text-[#a8d5ba] fill-[#a8d5ba]/20" />
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {brand ? (
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#212529] bg-[#eef2f0] px-2.5 py-1 rounded-full truncate max-w-[60%]">
              {brand}
            </span>
          ) : <span />}
          {shownUrl && (
            <a
              href={shownUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-xs font-medium text-[#6c757d] hover:text-[#212529] uppercase tracking-wider transition-colors duration-200 shrink-0"
            >
              Voir sur le site
            </a>
          )}
        </div>

        <h3 className="text-lg font-semibold text-[#212529] leading-tight mb-3 line-clamp-2">{name}</h3>

        {variants.length > 1 && onSelectVariant && (
          <div className="mb-4">
            <ColorSwatches
              variants={variants}
              activeId={active?.id || variants[0].id}
              onSelect={(variantId) => onSelectVariant(id, variantId)}
            />
          </div>
        )}

        {isScraping ? (
          <div className="space-y-2" aria-live="polite">
            <div className="skeleton h-7 w-28 rounded-lg" />
            <p className="text-sm text-[#6c757d]">Recherche du prix en cours...</p>
          </div>
        ) : (
          <>
            <DualPrice
              priceBe={shownPrice}
              priceFr={active?.currentPriceFr ?? null}
              errorBe={shownError}
              errorFr={active?.lastScrapeErrorFr}
            />

            <LowestPrice
              history={shownHistory}
              currentPrice={shownPrice}
              className="mt-2.5"
            />

            <div className="flex items-end justify-between gap-3 mt-3">
              <div className="min-w-0">
                {shownError ? (
                  <div className="flex items-center text-amber-600" title={shownError}>
                    <AlertTriangle className="w-4 h-4 mr-1 shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {shownError === "Article introuvable" ? "Article introuvable" : "Erreur de prix"}
                    </span>
                  </div>
                ) : priceDropped ? (
                  <div className="flex items-center text-[#4a7c59] text-sm font-semibold">
                    <ArrowDownRight className="w-4 h-4 mr-1 shrink-0" />
                    <span className="tabular-nums">Baisse de {formatPrice(Math.abs(diff))}</span>
                  </div>
                ) : priceIncreased ? (
                  <div className="flex items-center text-red-500 text-sm font-semibold">
                    <ArrowUpRight className="w-4 h-4 mr-1 shrink-0" />
                    <span className="tabular-nums">Hausse de {formatPrice(diff)}</span>
                  </div>
                ) : hasSparkline ? (
                  <div className="flex items-center text-[#6c757d] text-sm font-medium">
                    <Minus className="w-4 h-4 mr-1 shrink-0" />
                    <span>Prix stable</span>
                  </div>
                ) : (
                  <span className="text-xs text-[#adb5bd]">En attente d'un second relevé</span>
                )}
              </div>

              {hasSparkline && (
                <div className="w-20 h-12 shrink-0" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={shownHistory}>
                      <YAxis domain={['dataMin', 'dataMax']} hide />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke={priceDropped ? "#4a7c59" : priceIncreased ? "#f87171" : "#adb5bd"}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
