import { useState } from 'react';
import { Lock, Unlock, TrendingDown, TrendingUp, Heart, RefreshCw } from 'lucide-react';
import ItemDetailsModal from './ItemDetailsModal';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

export default function ItemCard({ item, user }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Derive trends if there is price history, but we don't fetch full history here,
  // we just look at the difference if available, or fetch later.
  // For UI simplicity, we just show the card.

  const handleRefresh = async (e) => {
    e.stopPropagation();
    setIsRefreshing(true);
    try {
      const refreshPrice = httpsCallable(functions, 'refreshPrice');
      await refreshPrice({ itemId: item.id, url: item.url });
    } catch (error) {
      console.error("Erreur lors de l'actualisation", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <>
      <div
        onClick={() => setIsModalOpen(true)}
        className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer border border-gray-100 group relative"
      >
        {/* Heart badge */}
        {item.isFavorite && (
          <div className="absolute top-4 right-4 z-10 bg-white/90 p-1.5 rounded-full shadow-sm">
            <Heart size={16} fill="currentColor" className="text-red-400" />
          </div>
        )}

        {/* Lock badge */}
        {item.isPrivate && (
          <div className="absolute top-4 left-4 z-10 bg-white/90 p-1.5 rounded-full shadow-sm">
            <Lock size={16} className="text-gray-400" />
          </div>
        )}

        <div className="relative aspect-[4/5] bg-brand-sand overflow-hidden">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              Pas d'image
            </div>
          )}

          {/* Quick action hover */}
          <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              onClick={handleRefresh}
              className="bg-white text-brand-charcoal p-3 rounded-full shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-all hover:bg-gray-50"
              title="Actualiser le prix"
            >
              <RefreshCw size={20} className={isRefreshing ? "animate-spin text-brand-sage" : ""} />
            </button>
          </div>
        </div>

        <div className="p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{item.category}</p>
          <h3 className="font-medium text-brand-charcoal mb-2 leading-tight line-clamp-2">{item.name}</h3>

          <div className="flex items-end justify-between mt-4">
            <div>
              <span className="text-2xl font-light text-brand-charcoal">
                {item.currentPrice ? `${item.currentPrice} €` : '-- €'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {item.priceDecreased && <TrendingDown size={20} className="text-brand-sage" />}
              {item.priceIncreased && <TrendingUp size={20} className="text-red-400" />}
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <ItemDetailsModal
          item={item}
          onClose={() => setIsModalOpen(false)}
          user={user}
        />
      )}
    </>
  );
}
