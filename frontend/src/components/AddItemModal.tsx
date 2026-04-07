import React, { useState } from 'react';
import { X, Lock, Heart } from 'lucide-react';
import { cn } from '../utils/cn';

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  boards: any[];
  initialBoardId: string | null;
}

export function AddItemModal({ isOpen, onClose, onSubmit, boards, initialBoardId }: AddItemModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    boards: [] as string[],
    url: '',
    imageUrl: '',
    isPrivate: false,
    isFavorite: false,
  });

  // Pre-fill board when modal opens if a specific board is selected
  React.useEffect(() => {
    if (isOpen) {
      setFormData(prev => ({
        ...prev,
        boards: (initialBoardId && initialBoardId !== 'favorites') ? [initialBoardId] : []
      }));
    }
  }, [isOpen, initialBoardId]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-6 border-b border-[#dee2e6]">
          <h2 className="text-xl font-semibold text-[#212529]">Ajouter un article</h2>
          <button onClick={onClose} className="p-2 text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa] rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">Nom de l'article</label>
            <input
              required
              type="text"
              placeholder="Ex: Canapé KIVIK"
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">Tableaux (optionnel)</label>
            <div className="max-h-32 overflow-y-auto p-2 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] space-y-2">
               {boards.length === 0 ? (
                 <p className="text-sm text-[#6c757d] p-2">Aucun tableau créé.</p>
               ) : (
                 boards.map((board) => (
                   <label key={board.id} className="flex items-center space-x-3 p-1 cursor-pointer">
                     <input
                       type="checkbox"
                       className="w-4 h-4 text-[#212529] bg-white border-gray-300 rounded focus:ring-[#212529]"
                       checked={formData.boards.includes(board.id)}
                       onChange={(e) => {
                         const checked = e.target.checked;
                         setFormData(prev => ({
                           ...prev,
                           boards: checked
                             ? [...prev.boards, board.id]
                             : prev.boards.filter(id => id !== board.id)
                         }));
                       }}
                     />
                     <span className="text-sm text-[#212529] flex-1 truncate">{board.name}</span>
                   </label>
                 ))
               )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">Lien (URL)</label>
            <input
              required
              type="url"
              placeholder="https://..."
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
              value={formData.url}
              onChange={e => setFormData({...formData, url: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">Lien de l'image (Optionnel)</label>
            <input
              type="url"
              placeholder="https://.../image.jpg"
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
              value={formData.imageUrl}
              onChange={e => setFormData({...formData, imageUrl: e.target.value})}
            />
          </div>

          <div className="flex items-center justify-between py-2 border-t border-[#dee2e6] pt-4">
            <div className="flex items-center space-x-3">
              <Lock className="w-5 h-5 text-[#6c757d]" />
              <div>
                <p className="text-sm font-medium text-[#212529]">Article privé</p>
                <p className="text-xs text-[#6c757d]">Visible uniquement par vous</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={formData.isPrivate} onChange={e => setFormData({...formData, isPrivate: e.target.checked})} />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#a8d5ba]"></div>
            </label>
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center space-x-3">
              <Heart className={cn("w-5 h-5", formData.isFavorite ? "fill-[#212529] text-[#212529]" : "text-[#6c757d]")} />
              <div>
                <p className="text-sm font-medium text-[#212529]">Coup de cœur</p>
                <p className="text-xs text-[#6c757d]">Épingler en haut de la liste</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={formData.isFavorite} onChange={e => setFormData({...formData, isFavorite: e.target.checked})} />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#212529]"></div>
            </label>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 px-4 bg-[#212529] hover:bg-black text-white text-sm font-medium rounded-xl transition-colors mt-4"
          >
            Ajouter l'article
          </button>
        </form>
      </div>
    </div>
  );
}
