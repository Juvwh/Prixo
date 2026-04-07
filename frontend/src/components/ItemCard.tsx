import React from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Heart, AlertTriangle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { cn } from '../utils/cn';

interface PriceHistory {
  date: string;
  price: number;
}

interface ItemCardProps {
  id: string;
  name: string;
  category: string;
  currentPrice: number;
  imageUrl?: string;
  isPrivate: boolean;
  isFavorite: boolean;
  history: PriceHistory[];
  isScraping?: boolean;
  scrapeError?: string;
  onClick: () => void;
}

export function ItemCard({ name, category, currentPrice, imageUrl, isPrivate, isFavorite, history, isScraping, scrapeError, onClick }: ItemCardProps) {
  // Determine if price went down based on last two records
  const priceDropped = history.length > 1 && history[history.length - 1].price < history[history.length - 2].price;
  const priceIncreased = history.length > 1 && history[history.length - 1].price > history[history.length - 2].price;

  // Formatting price to French locale
  const formattedPrice = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(currentPrice);

  const defaultImage = "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80";

  return (
    <div
      onClick={onClick}
      className="group bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-[#dee2e6] break-inside-avoid mb-6"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#f8f9fa]">
        <img
          src={imageUrl || defaultImage}
          alt={name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
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
      </div>

      <div className="p-5">
        <p className="text-xs font-medium text-[#6c757d] uppercase tracking-wider mb-1">{category}</p>
        <h3 className="text-lg font-semibold text-[#212529] leading-tight mb-4 line-clamp-2">{name}</h3>

        <div className="flex items-end justify-between">
          <div>
            {isScraping ? (
              <p className="text-sm text-[#6c757d] animate-pulse">Recherche en cours...</p>
            ) : scrapeError ? (
              <div className="flex items-center text-amber-500" title={scrapeError}>
                <AlertTriangle className="w-6 h-6 mr-2" />
                <span className="text-sm font-medium">Erreur de prix</span>
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold text-[#212529]">{formattedPrice}</p>
                {priceDropped && (
                  <div className="flex items-center text-[#a8d5ba] mt-1 text-sm font-medium">
                    <ArrowDownRight className="w-4 h-4 mr-1" />
                    <span>Baisse de prix</span>
                  </div>
                )}
                {priceIncreased && (
                  <div className="flex items-center text-red-400 mt-1 text-sm font-medium">
                    <ArrowUpRight className="w-4 h-4 mr-1" />
                    <span>Hausse de prix</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="w-20 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
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
      </div>
    </div>
  );
}
