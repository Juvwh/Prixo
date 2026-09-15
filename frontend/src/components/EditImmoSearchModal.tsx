import React, { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { useModalBehavior, backdropClose } from '../hooks/useModalBehavior';

interface EditImmoSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: string, data: { name: string; url: string; filterWord: string }) => void;
  search: any;
}

export function EditImmoSearchModal({ isOpen, onClose, onSubmit, search }: EditImmoSearchModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [filterWord, setFilterWord] = useState('');

  useEffect(() => {
    if (search) {
      setName(search.name || '');
      setUrl(search.url || '');
      setFilterWord(search.filterWord || '');
    }
  }, [search]);

  useModalBehavior(isOpen, onClose);

  if (!isOpen || !search) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(search.id, { name, url, filterWord });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 z-[60]"
      onClick={backdropClose(onClose)}
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-[#212529] flex items-center">
            <Search className="w-5 h-5 mr-2" />
            Modifier la recherche
          </h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#212529] mb-1.5">Nom de la recherche</label>
              <input
                type="text"
                required
                placeholder="Ex: Paris 11ème, 2 pièces..."
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent transition-all text-sm"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#212529] mb-1.5">URL de recherche</label>
              <input
                type="url"
                required
                placeholder="https://..."
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent transition-all text-sm"
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
              <p className="text-xs text-[#6c757d] mt-1.5">Modifiez l'URL pour ajuster vos filtres (prix, surface, etc.) sans perdre l'historique des annonces déjà vues.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#212529] mb-1.5">Filtres de lien (optionnel)</label>
              <input
                type="text"
                placeholder="Ex: location, appartement..."
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent transition-all text-sm"
                value={filterWord}
                onChange={e => setFilterWord(e.target.value)}
              />
              <p className="text-xs text-[#6c757d] mt-1.5">Séparez les mots par des virgules. Le lien doit contenir <strong>tous</strong> ces mots pour être conservé.</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-[#6c757d] hover:text-[#212529] hover:bg-gray-100 rounded-xl transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-sm font-medium text-white bg-[#212529] hover:bg-black rounded-xl transition-colors shadow-md flex items-center"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
