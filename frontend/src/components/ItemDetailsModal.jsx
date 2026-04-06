import { useState, useEffect } from 'react';
import { db, functions } from '../firebase';
import { collection, query, onSnapshot, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { X, ExternalLink, Trash2, RefreshCw } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function ItemDetailsModal({ item, onClose, user }) {
  const [history, setHistory] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [editName, setEditName] = useState(item.name || '');
  const [editCategory, setEditCategory] = useState(item.category || '');
  const [editUrl, setEditUrl] = useState(item.url || '');
  const [editImageUrl, setEditImageUrl] = useState(item.imageUrl || '');

  useEffect(() => {
    const q = query(
      collection(db, `items/${item.id}/prices`),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = [];
      snapshot.forEach((doc) => {
        const p = doc.data();
        if (p.timestamp) {
          data.push({
            date: format(p.timestamp.toDate(), 'dd MMM', { locale: fr }),
            price: p.price
          });
        }
      });
      setHistory(data);
    });

    return () => unsubscribe();
  }, [item.id]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const refreshPrice = httpsCallable(functions, 'refreshPrice');
      await refreshPrice({ itemId: item.id, url: item.url });
    } catch (error) {
      console.error("Erreur lors de l'actualisation", error);
      alert("Erreur lors de la récupération du prix.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Voulez-vous vraiment supprimer cet article ?")) {
      setIsDeleting(true);
      try {
        await deleteDoc(doc(db, 'items', item.id));
        onClose();
      } catch (error) {
        console.error("Erreur de suppression", error);
        alert("Erreur lors de la suppression.");
        setIsDeleting(false);
      }
    }
  };

  const handleEditSave = async () => {
    try {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'items', item.id), {
        name: editName,
        category: editCategory,
        url: editUrl,
        imageUrl: editImageUrl
      });
      setIsEditing(false);
      // Wait for re-render via snapshot
    } catch(err) {
      alert("Erreur lors de la modification");
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl relative flex flex-col md:flex-row">

        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-white/80 p-2 rounded-full text-gray-500 hover:text-brand-charcoal transition-colors"
        >
          <X size={20} />
        </button>

        {/* Image Side */}
        <div className="w-full md:w-2/5 bg-brand-sand min-h-[300px] flex items-center justify-center">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-gray-400">Aucune image</span>
          )}
        </div>

        {/* Content Side */}
        <div className="w-full md:w-3/5 p-8 flex flex-col">
          <div className="mb-2">
            <span className="text-xs font-semibold bg-gray-100 text-gray-500 px-3 py-1 rounded-full uppercase tracking-wider">
              {item.category}
            </span>
            {item.isPrivate && (
              <span className="text-xs font-semibold bg-brand-sage/20 text-brand-sage px-3 py-1 rounded-full ml-2">
                Privé
              </span>
            )}
          </div>

          {!isEditing ? (
            <h2 className="text-3xl font-light text-brand-charcoal mb-4 mt-2">{item.name}</h2>
          ) : (
            <input
              type="text"
              className="text-3xl font-light text-brand-charcoal mb-4 mt-2 w-full border-b border-gray-200 focus:outline-none focus:border-brand-mint"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          )}

          {isEditing && (
            <div className="mb-4 space-y-3">
               <input
                  type="text" placeholder="Catégorie"
                  className="w-full p-2 border border-gray-200 rounded"
                  value={editCategory} onChange={e=>setEditCategory(e.target.value)}
               />
               <input
                  type="text" placeholder="URL Site"
                  className="w-full p-2 border border-gray-200 rounded"
                  value={editUrl} onChange={e=>setEditUrl(e.target.value)}
               />
               <input
                  type="text" placeholder="URL Image"
                  className="w-full p-2 border border-gray-200 rounded"
                  value={editImageUrl} onChange={e=>setEditImageUrl(e.target.value)}
               />
            </div>
          )}

          <div className="flex items-end gap-4 mb-8">
            <span className="text-5xl font-light text-brand-charcoal">
              {item.currentPrice ? `${item.currentPrice} €` : '-- €'}
            </span>
          </div>

          <div className="flex gap-3 mb-10">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 bg-brand-charcoal text-white py-3 px-4 rounded-xl hover:bg-gray-800 transition-colors font-medium"
            >
              Voir sur le site
              <ExternalLink size={18} />
            </a>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center justify-center gap-2 bg-gray-100 text-brand-charcoal py-3 px-6 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={18} className={isRefreshing ? "animate-spin" : ""} />
              Actualiser
            </button>
          </div>

          <div className="flex-1 min-h-[200px] mb-8">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Évolution du prix</h3>
            {history.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8F9E8B" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8F9E8B" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#9ca3af'}} />
                  <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#9ca3af'}} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="price" stroke="#8F9E8B" strokeWidth={3} fillOpacity={1} fill="url(#colorPrice)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm bg-gray-50 rounded-xl">
                Pas assez de données pour afficher le graphique.
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-gray-100 mt-auto">
            {isEditing ? (
              <div className="flex gap-4 w-full">
                <button onClick={() => setIsEditing(false)} className="flex-1 py-2 text-gray-500 bg-gray-100 rounded-lg">Annuler</button>
                <button onClick={handleEditSave} className="flex-1 py-2 text-white bg-brand-charcoal rounded-lg">Enregistrer</button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 text-gray-500 hover:text-brand-charcoal transition-colors text-sm font-medium"
                >
                  Modifier
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 text-red-400 hover:text-red-500 transition-colors text-sm font-medium"
                >
                  <Trash2 size={16} />
                  Supprimer
                </button>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
