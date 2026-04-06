import { useState } from 'react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { X, Heart } from 'lucide-react';

export default function AddItemModal({ onClose, user }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [url, setUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await addDoc(collection(db, 'items'), {
        name,
        category: category || 'Général',
        url,
        imageUrl: imageUrl || null,
        isFavorite,
        isPrivate,
        creatorId: user.uid,
        currentPrice: null,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });
      onClose();
    } catch (error) {
      console.error("Erreur lors de l'ajout", error);
      alert("Erreur lors de l'ajout de l'article.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-lg p-8 shadow-xl relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-400 hover:text-brand-charcoal transition-colors"
        >
          <X size={24} />
        </button>

        <h2 className="text-2xl font-light text-brand-charcoal mb-8">Nouvel article</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <input
              type="text"
              placeholder="Nom de l'article"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-brand-gray/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-mint transition-all"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <input
              type="text"
              placeholder="Catégorie (ex: Salon, Bureau...)"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-brand-gray/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-mint transition-all"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          <div>
            <input
              type="url"
              placeholder="URL de la page produit"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-brand-gray/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-mint transition-all"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div>
            <input
              type="url"
              placeholder="URL de l'image (facultatif)"
              className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-brand-gray/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-mint transition-all"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between pt-4 pb-2 border-t border-gray-100">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isFavorite ? 'bg-red-50 text-red-400' : 'bg-gray-50 text-gray-400 group-hover:bg-red-50 group-hover:text-red-300'}`}
              >
                <Heart size={20} fill={isFavorite ? "currentColor" : "none"} />
              </div>
              <span className="text-sm font-medium text-gray-600">Coup de cœur</span>
              <input
                type="checkbox"
                className="hidden"
                checked={isFavorite}
                onChange={(e) => setIsFavorite(e.target.checked)}
              />
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <span className="text-sm font-medium text-gray-600">Article privé</span>
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-sage"></div>
              </div>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 px-4 bg-brand-charcoal text-white rounded-xl hover:bg-gray-800 transition-colors font-medium mt-4 disabled:opacity-50"
          >
            {loading ? 'Ajout en cours...' : 'Ajouter à ma liste'}
          </button>
        </form>
      </div>
    </div>
  );
}
