import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

interface PriceHistory {
  date: string;
  price: number;
}

interface EditPriceHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: string, data: any) => void;
  item: any;
}

export function EditPriceHistoryModal({ isOpen, onClose, onSubmit, item }: EditPriceHistoryModalProps) {
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [history, setHistory] = useState<PriceHistory[]>([]);

  useEffect(() => {
    if (item) {
      setCurrentPrice(item.currentPrice || 0);
      setHistory(item.history ? [...item.history] : []);
    }
  }, [item]);

  if (!isOpen || !item) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Sort history by date ascending
    const sortedHistory = [...history].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    onSubmit(item.id, {
      currentPrice: currentPrice,
      history: sortedHistory
    });
    onClose();
  };

  const handleAddHistory = () => {
    setHistory([...history, { date: new Date().toISOString(), price: currentPrice }]);
  };

  const handleRemoveHistory = (index: number) => {
    const newHistory = [...history];
    newHistory.splice(index, 1);
    setHistory(newHistory);
  };

  const handleHistoryChange = (index: number, field: 'date' | 'price', value: string) => {
    const newHistory = [...history];
    if (field === 'price') {
      newHistory[index].price = Number(value);
    } else {
      newHistory[index].date = value;
    }
    setHistory(newHistory);
  };

  const handleCurrentPriceChange = (value: string) => {
    const newPrice = Number(value);
    setCurrentPrice(newPrice);

    // Si on modifie le prix actuel, on ajoute ou met à jour la ligne d'aujourd'hui dans l'historique
    const todayStr = new Date().toISOString().split('T')[0];
    const newHistory = [...history];
    const todayEntryIndex = newHistory.findIndex(h => h.date.startsWith(todayStr));

    if (todayEntryIndex !== -1) {
        newHistory[todayEntryIndex].price = newPrice;
    } else {
        newHistory.push({ date: new Date().toISOString(), price: newPrice });
    }
    setHistory(newHistory);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-6 border-b border-[#dee2e6]">
          <h2 className="text-xl font-semibold text-[#212529]">Modifier les prix</h2>
          <button onClick={onClose} className="p-2 text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa] rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">Prix actuel (€)</label>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              placeholder="Ex: 85.00"
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
              value={currentPrice || ''}
              onChange={e => handleCurrentPriceChange(e.target.value)}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-[#212529]">Historique des prix</label>
              <button
                type="button"
                onClick={handleAddHistory}
                className="text-xs flex items-center text-[#212529] hover:text-[#a8d5ba] transition-colors"
              >
                <Plus className="w-3 h-3 mr-1" /> Ajouter une ligne
              </button>
            </div>

            <div className="space-y-3">
              {history.map((entry, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="date"
                    required
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] outline-none"
                    value={entry.date.split('T')[0]}
                    onChange={(e) => {
                      // Preserve time if available, or set to start of day
                      const originalDate = new Date(entry.date);
                      const [year, month, day] = e.target.value.split('-');
                      if (year && month && day) {
                        originalDate.setFullYear(parseInt(year), parseInt(month) - 1, parseInt(day));
                        handleHistoryChange(index, 'date', originalDate.toISOString());
                      }
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className="w-24 px-3 py-2 text-sm rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] outline-none"
                    value={entry.price || ''}
                    onChange={(e) => handleHistoryChange(index, 'price', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveHistory(index)}
                    className="p-2 text-[#6c757d] hover:text-red-500 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {history.length === 0 && (
                <p className="text-sm text-[#6c757d] italic">Aucun historique de prix.</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 px-4 bg-[#212529] hover:bg-black text-white text-sm font-medium rounded-xl transition-colors mt-4"
          >
            Enregistrer
          </button>
        </form>
      </div>
    </div>
  );
}
