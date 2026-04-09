import React, { useState, useEffect } from 'react';
import { X, Trash2, RefreshCw } from 'lucide-react';
import { BoardData } from './Sidebar';

interface EditBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: string, data: { name: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  board: BoardData | null;
  isRefreshing?: boolean;
  boardItems?: any[];
}

export function EditBoardModal({ isOpen, onClose, onSubmit, onDelete, onRefresh, board, isRefreshing, boardItems = [] }: EditBoardModalProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showStatusList, setShowStatusList] = useState(false);
  const [refreshStartTime, setRefreshStartTime] = useState<number | null>(null);
  const [initialLastChecked, setInitialLastChecked] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (board) {
      setName(board.name);
    } else {
      setName('');
    }
    // Reset showStatusList when modal is opened/closed
    if (!isOpen) {
      setShowStatusList(false);
      setRefreshStartTime(null);
      setInitialLastChecked({});
    }
  }, [board, isOpen]);

  if (!isOpen || !board) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    await onSubmit(board.id, { name: name.trim() });
    setIsSubmitting(false);
    onClose();
  };

  const handleDelete = async () => {
    if (window.confirm("Êtes-vous sûr de vouloir supprimer ce tableau ? Cette action est irréversible, mais ne supprimera pas les articles qu'il contient.")) {
      setIsSubmitting(true);
      await onDelete(board.id);
      setIsSubmitting(false);
      onClose();
    }
  };

  const handleRefresh = async () => {
    setShowStatusList(true);
    setRefreshStartTime(Date.now());

    // Store the initial lastChecked values to compare against later
    const initialValues: Record<string, string | null> = {};
    if (boardItems) {
      boardItems.forEach(item => {
        initialValues[item.id] = item.lastChecked || null;
      });
    }
    setInitialLastChecked(initialValues);

    await onRefresh(board.id);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#fafafa]">
          <h2 className="text-xl font-bold text-[#212529]">{board.isSpecial ? "Options" : "Modifier le tableau"}</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            disabled={isSubmitting || isRefreshing}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {!board.isSpecial && (
            <div className="mb-6">
              <label htmlFor="board-name" className="block text-sm font-semibold text-[#495057] mb-2">
                Nom du tableau
              </label>
              <input
                id="board-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent transition-all bg-[#fafafa]"
                placeholder="Ex: Salon, Wishlist..."
                required
                disabled={isSubmitting || isRefreshing}
              />
            </div>
          )}

          <div className={`flex flex-col gap-3 mb-6 ${!board.isSpecial ? 'pt-4 border-t border-gray-100' : ''}`}>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isSubmitting || isRefreshing}
              className="w-full flex items-center justify-center px-4 py-3 text-sm font-medium text-white bg-[#a8d5ba] rounded-xl hover:bg-[#92c5a5] transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-5 h-5 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Mise à jour en cours...' : 'Actualiser les prix du tableau'}
            </button>
            <p className="text-xs text-[#6c757d] text-center px-4">
              Cette action va récupérer les prix à jour pour tous les articles de ce tableau. Cela peut prendre quelques minutes.
            </p>
            {showStatusList && (
              <div className="mt-4 max-h-48 overflow-y-auto border border-gray-100 rounded-xl p-2 bg-white">
                {boardItems.length === 0 ? (
                  <p className="text-xs text-center text-gray-500 py-2">Aucun article dans ce tableau.</p>
                ) : (
                  <ul className="space-y-2">
                    {boardItems.map((item) => {
                      let statusText = 'En attente';
                      let statusColor = 'text-gray-500 bg-gray-100';

                      // Determine if the status is stale by comparing against the original lastChecked string
                      const hasStartedRefresh = refreshStartTime !== null;
                      const isStale = hasStartedRefresh && item.lastChecked === initialLastChecked[item.id];

                      if (!isStale) {
                        if (item.scrapeStatus === 'scraping') {
                          statusText = 'En cours...';
                          statusColor = 'text-blue-600 bg-blue-50';
                        } else if (item.scrapeStatus === 'success') {
                          statusText = 'Succès';
                          statusColor = 'text-green-600 bg-green-50';
                        } else if (item.scrapeStatus === 'error') {
                          statusText = 'Erreur';
                          statusColor = 'text-red-600 bg-red-50';
                        }
                      }

                      return (
                        <li key={item.id} className="flex justify-between items-center text-xs p-2 rounded hover:bg-gray-50">
                          <span className="truncate pr-2 font-medium text-[#495057]" title={item.name}>{item.name}</span>
                          <span className={`px-2 py-1 rounded-md whitespace-nowrap ${statusColor}`}>
                            {statusText}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            {!board.isSpecial ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSubmitting || isRefreshing}
                className="flex items-center px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer
              </button>
            ) : (
              <div /> // Placeholder to keep the flex layout balanced
            )}

            <div className="flex gap-3">
              {board.isSpecial ? (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting || isRefreshing}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-[#212529] rounded-xl hover:bg-black transition-colors disabled:opacity-50"
                >
                  Fermer
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting || isRefreshing}
                    className="px-6 py-2.5 text-sm font-medium text-[#495057] bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={!name.trim() || isSubmitting || isRefreshing || name === board.name}
                    className="px-6 py-2.5 text-sm font-medium text-white bg-[#212529] rounded-xl hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
