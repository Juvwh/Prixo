import React from 'react';
import { X, RefreshCw, ExternalLink, Edit2, Trash2, AlertTriangle, CheckCircle2, Settings } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { cn } from '../utils/cn';
import { DualPrice } from './DualPrice';
import { ColorSwatches } from './ColorSwatches';
import { getVariants, getActiveVariant, PricePoint } from '../utils/variants';

interface ItemDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: any; // Type properly later based on Firestore data
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: () => void;
  onEditPriceHistory: () => void;
  onSelectVariant?: (itemId: string, variantId: string) => void;
  isRefreshing?: boolean;
  notification?: { message: string, type: 'success' | 'info' | 'error' } | null;
}

/**
 * Fusionne les deux historiques en une série unique indexée par date, en
 * reportant la dernière valeur connue de chaque pays (les relevés belges et
 * français ne tombent pas forcément les mêmes jours).
 */
function mergeHistories(be: PricePoint[], fr: PricePoint[]) {
  const dates = Array.from(new Set([...be, ...fr].map(p => p.date))).sort();
  const byDateBe = new Map(be.map(p => [p.date, p.price]));
  const byDateFr = new Map(fr.map(p => [p.date, p.price]));

  let lastBe: number | null = null;
  let lastFr: number | null = null;

  return dates.map(date => {
    if (byDateBe.has(date)) lastBe = byDateBe.get(date) as number;
    if (byDateFr.has(date)) lastFr = byDateFr.get(date) as number;
    return { date, priceBe: lastBe, priceFr: lastFr };
  });
}

export function ItemDetailModal({ isOpen, onClose, item, onRefresh, onDelete, onEdit, onEditPriceHistory, onSelectVariant, isRefreshing, notification }: ItemDetailModalProps) {
  if (!isOpen || !item) return null;

  const variants = getVariants(item);
  const active = getActiveVariant(item);

  const shownImage = active?.imageUrl || item.imageUrl;
  const shownUrl = active?.url || item.url;
  const shownUrlFr = active?.urlFr || item.urlFr;
  const historyBe = active?.history || item.history || [];
  const historyFr = active?.historyFr || item.historyFr || [];
  const shownError = active?.lastScrapeError || item.lastScrapeError;

  const chartData = mergeHistories(historyBe, historyFr);
  const hasFrSeries = historyFr.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex justify-between items-center p-4 sm:p-6 border-b border-[#dee2e6] shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            {item.brand && (
              <span className="bg-[#eef2f0] text-[#212529] text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0">
                {item.brand}
              </span>
            )}
            <h2 className="text-xl sm:text-2xl font-semibold text-[#212529] line-clamp-1">{item.name}</h2>
            {item.isFavorite && <span className="bg-[#f8f9fa] text-[#212529] text-xs font-bold px-2 py-1 rounded-full border border-[#dee2e6] shrink-0">COUP DE CŒUR</span>}
            {item.isPrivate && <span className="bg-[#f8f9fa] text-[#6c757d] text-xs font-bold px-2 py-1 rounded-full border border-[#dee2e6] shrink-0">PRIVÉ</span>}
          </div>
          <button onClick={onClose} className="p-2 text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa] rounded-full transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left: Image & Actions */}
            <div className="space-y-6">
              <div className="aspect-square rounded-2xl overflow-hidden bg-[#f8f9fa] border border-[#dee2e6]">
                <img
                  src={shownImage || "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"}
                  alt={item.name}
                  className="w-full h-full object-contain"
                />
              </div>

              {variants.length > 1 && onSelectVariant && (
                <div className="rounded-2xl border border-[#dee2e6] p-4">
                  <p className="text-sm font-semibold text-[#212529] mb-3">
                    {variants.length} couleurs disponibles
                  </p>
                  <ColorSwatches
                    variants={variants}
                    activeId={active?.id || variants[0].id}
                    onSelect={(variantId) => onSelectVariant(item.id, variantId)}
                    size="md"
                  />
                </div>
              )}

              <div className="flex gap-3">
                <a
                  href={shownUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center py-3 px-4 bg-[#212529] hover:bg-black text-white text-sm font-medium rounded-xl transition-colors"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  <span aria-hidden="true" className="mr-1.5">🇧🇪</span> Site belge
                </a>
                {shownUrlFr && (
                  <a
                    href={shownUrlFr}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center py-3 px-4 bg-white border border-[#dee2e6] hover:bg-[#f8f9fa] text-[#212529] text-sm font-medium rounded-xl transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    <span aria-hidden="true" className="mr-1.5">🇫🇷</span> Site français
                  </a>
                )}
              </div>

              <button
                onClick={() => onRefresh(item.id)}
                disabled={isRefreshing}
                className="w-full flex items-center justify-center py-3 px-4 bg-white border border-[#dee2e6] hover:bg-[#f8f9fa] text-[#212529] text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin")} />
                Actualiser les prix
              </button>

              {/* Notification Message */}
              {notification && (
                <div className={cn(
                  "p-3 rounded-xl text-sm font-medium flex items-center animate-in fade-in slide-in-from-top-2",
                  notification.type === 'success' && "bg-green-50 text-green-700 border border-green-200",
                  notification.type === 'info' && "bg-blue-50 text-blue-700 border border-blue-200",
                  notification.type === 'error' && "bg-red-50 text-red-700 border border-red-200"
                )}>
                  {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 mr-2" />}
                  {notification.type === 'info' && <RefreshCw className="w-4 h-4 mr-2" />}
                  {notification.type === 'error' && <AlertTriangle className="w-4 h-4 mr-2" />}
                  {notification.message}
                </div>
              )}

              <div className="flex justify-end space-x-2 mt-4">
                 <button onClick={onEdit} className="p-2 text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa] rounded-lg transition-colors" title="Modifier">
                    <Edit2 className="w-5 h-5" />
                 </button>
                 <button onClick={() => onDelete(item.id)} className="p-2 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Supprimer">
                    <Trash2 className="w-5 h-5" />
                 </button>
              </div>
            </div>

            {/* Right: Price & Chart */}
            <div className="space-y-8 flex flex-col">
              <div>
                {item.boards && item.boards.length > 0 && (
                   <p className="text-sm font-medium text-[#6c757d] uppercase tracking-wider mb-3">{item.boards.join(', ')}</p>
                )}

                <DualPrice
                  priceBe={active ? active.currentPrice : item.currentPrice}
                  priceFr={active?.currentPriceFr ?? null}
                  errorBe={shownError}
                  errorFr={active?.lastScrapeErrorFr}
                  size="detail"
                />

                {shownError && (
                   <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4">
                     <div className="flex items-start">
                       <AlertTriangle className="w-5 h-5 text-amber-500 mr-3 shrink-0 mt-0.5" />
                       <div>
                         <h4 className="text-sm font-semibold text-amber-800">
                           {shownError === "Article introuvable" ? "Article introuvable" : "Erreur lors de la récupération du prix"}
                         </h4>
                         {shownError !== "Article introuvable" && (
                           <p className="text-sm text-amber-700 mt-1">{shownError}</p>
                         )}
                         {shownError === "Article introuvable" && (
                           <p className="text-sm text-amber-700 mt-1">L'article semble avoir été retiré du site ou redirige vers une autre page (probablement en rupture de stock).</p>
                         )}
                       </div>
                     </div>
                   </div>
                )}

                <p className="text-sm text-[#6c757d] mt-3">Dernière vérification : {new Date(item.lastChecked).toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>

              <div className="flex-1 min-h-[300px] border border-[#dee2e6] rounded-2xl p-4 sm:p-6 bg-[#f8f9fa]">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-[#212529]">Historique des prix</h4>
                  <button onClick={onEditPriceHistory} className="p-1.5 text-[#6c757d] hover:text-[#212529] hover:bg-[#dee2e6] rounded-lg transition-colors" title="Modifier l'historique des prix">
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
                <div className="w-full h-[200px] sm:h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dee2e6" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(val) => new Date(val).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6c757d', fontSize: 12 }}
                        dy={10}
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6c757d', fontSize: 12 }}
                        tickFormatter={(val) => `${val}€`}
                        dx={-10}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number, name: string) => [`${value} €`, name]}
                        labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                      />
                      {hasFrSeries && (
                        <Legend
                          verticalAlign="top"
                          height={28}
                          iconType="plainline"
                          wrapperStyle={{ fontSize: 12, color: '#6c757d' }}
                        />
                      )}
                      <Line
                        type="stepAfter"
                        dataKey="priceBe"
                        name="🇧🇪 Belgique"
                        stroke="#212529"
                        strokeWidth={2}
                        connectNulls
                        dot={{ r: 4, fill: '#212529', strokeWidth: 0 }}
                        activeDot={{ r: 6, fill: '#a8d5ba', strokeWidth: 0 }}
                      />
                      {hasFrSeries && (
                        <Line
                          type="stepAfter"
                          dataKey="priceFr"
                          name="🇫🇷 France"
                          stroke="#7f9cf5"
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          connectNulls
                          dot={{ r: 3, fill: '#7f9cf5', strokeWidth: 0 }}
                          activeDot={{ r: 5, fill: '#7f9cf5', strokeWidth: 0 }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
