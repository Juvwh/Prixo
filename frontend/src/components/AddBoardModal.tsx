import React, { useState } from 'react';
import { X, Lock } from 'lucide-react';

interface AddBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string, isPrivate: boolean }) => void;
}

export function AddBoardModal({ isOpen, onClose, onSubmit }: AddBoardModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    isPrivate: false,
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    setFormData({ name: '', isPrivate: false });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-6 border-b border-[#dee2e6]">
          <h2 className="text-xl font-semibold text-[#212529]">Créer un tableau</h2>
          <button onClick={onClose} className="p-2 text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa] rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">Nom du tableau</label>
            <input
              required
              type="text"
              placeholder="Ex: Salon, Chambre..."
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div className="flex items-center justify-between py-2 border-t border-[#dee2e6] pt-4">
            <div className="flex items-center space-x-3">
              <Lock className="w-5 h-5 text-[#6c757d]" />
              <div>
                <p className="text-sm font-medium text-[#212529]">Tableau privé</p>
                <p className="text-xs text-[#6c757d]">Visible uniquement par vous</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={formData.isPrivate} onChange={e => setFormData({...formData, isPrivate: e.target.checked})} />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#a8d5ba]"></div>
            </label>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 px-4 bg-[#212529] hover:bg-black text-white text-sm font-medium rounded-xl transition-colors mt-4"
          >
            Créer
          </button>
        </form>
      </div>
    </div>
  );
}
