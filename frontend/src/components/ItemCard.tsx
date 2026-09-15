import React from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Heart, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { cn } from '../utils/cn';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DualPrice } from './DualPrice';
import { ColorSwatches } from './ColorSwatches';
import { LowestPrice } from './LowestPrice';
import { getVariants, getActiveVariant } from '../utils/variants';

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

  // Determine if price went down based on last two records
  const priceDropped = shownHistory.length > 1 && shownHistory[shownHistory.length - 1].price < shownHistory[shownHistory.length - 2].price;
  const priceIncreased = shownHistory.length > 1 && shownHistory[shownHistory.length - 1].price > shownHistory[shownHistory.length - 2].price;

  const defaultImage = "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "group bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border break-inside-avoid mb-6 touch-manipulation",
        isSelected ? "border-2 border-[#a8d5ba] shadow-md ring-2 ring-[#a8d5ba]/20" : "border-[#dee2e6]",
        isDragging && "shadow-2xl scale-[1.02] z-50 relative border-[#a8d5ba]"
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#f8f9fa]">
        <img
          src={shownImage || defaultImage}
          alt={name}
          className={cn(
            "w-full h-full object-contain transition-transform duration-500 group-hover:scale-105",
            isSelectionModeActive && !isSelected && "opacity-75"
          )}
        />
        <div className="absolute top-4 left-4 flex gap-2">
          {isPrivate && (
            <div className="bg-white/90 backdrop-blur px-2.5 py-1.5 rounded-full flex items-center shadow-sm">
              <Lock className="w-3.5 h-3.5 text-[#212529]" />
            </div>
          )}
          {isFavorite && (
            <div className="bg-white/90 backdrop-blur px-2.5 py-1.5 rounded-full flex items-center shadow-sm">
              <Heart className="w-3.5 h-3.5 text-[#212529] fill-[#212529]" />
            </div>
          )}
        </div>
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
          <p className="text-sm text-[#6c757d] animate-pulse">Recherche en cours...</p>
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

            <div className="flex items-end justify-between mt-3">
              <div>
                {shownError ? (
                  <div className="flex items-center text-amber-500" title={shownError}>
                    <AlertTriangle className="w-4 h-4 mr-1" />
                    <span className="text-sm font-medium">{shownError === "Article introuvable" ? "Article introuvable" : "Erreur de prix"}</span>
                  </div>
                ) : (
                  <>
                    {priceDropped && (
                      <div className="flex items-center text-[#a8d5ba] text-sm font-medium">
                        <ArrowDownRight className="w-4 h-4 mr-1" />
                        <span>Baisse de prix</span>
                      </div>
                    )}
                    {priceIncreased && (
                      <div className="flex items-center text-red-400 text-sm font-medium">
                        <ArrowUpRight className="w-4 h-4 mr-1" />
                        <span>Hausse de prix</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="w-20 h-12 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={shownHistory}>
                    <YAxis domain={['dataMin', 'dataMax']} hide />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke={priceDropped ? "#a8d5ba" : priceIncreased ? "#f87171" : "#dee2e6"}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
