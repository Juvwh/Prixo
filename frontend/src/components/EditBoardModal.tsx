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
}

export function EditBoardModal({ isOpen, onClose, onSubmit, onDelete, onRefresh, board, isRefreshing }: EditBoardModalProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (board) {
      setName(board.name);
    } else {
      setName('');
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
    await onRefresh(board.id);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#fafafa]">
          <h2 className="text-xl font-bold text-[#212529]">Modifier le tableau</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            disabled={isSubmitting || isRefreshing}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
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

          <div className="flex flex-col gap-3 mb-6 pt-4 border-t border-gray-100">
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
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSubmitting || isRefreshing}
              className="flex items-center px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Supprimer
            </button>

            <div className="flex gap-3">
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
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
