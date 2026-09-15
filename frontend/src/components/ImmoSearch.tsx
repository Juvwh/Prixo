import React, { useState, useEffect } from 'react';
import { PlusSquare, RefreshCw, Trash2, ExternalLink, Home, X, Heart, CheckCircle2, RotateCcw, Edit2 } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, where } from 'firebase/firestore';
import { db, functions } from '../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../hooks/useAuth';
import { AddImmoSearchModal } from './AddImmoSearchModal';
import { EditImmoSearchModal } from './EditImmoSearchModal';
import { Toast, ToastMessage } from './Toast';

interface ImmoLink {
  url: string;
  isRead: boolean;
  isFavorite: boolean;
  isIgnored?: boolean;
  addedAt: string;
}

interface ImmoSearchDoc {
  id: string;
  name: string;
  url: string;
  filterWord: string;
  groupId: string;
  links: (string | ImmoLink)[]; // Handle legacy string arrays seamlessly
  createdAt: any;
  lastChecked: string;
  isScraping: boolean;
  lastError: string | null;
}

/** Dates de relevé : absentes ou mal formées sur les documents anciens, elles
 *  affichaient « Invalid Date » au lieu de rester discrètes. */
function formatDate(value?: string): string {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('fr-FR') : '—';
}

function formatDateTime(value?: string): string {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'jamais';
}

export function ImmoSearch() {
  const { user } = useAuth();
  const [searches, setSearches] = useState<ImmoSearchDoc[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [searchToEdit, setSearchToEdit] = useState<ImmoSearchDoc | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isGlobalRefreshing, setIsGlobalRefreshing] = useState(false);
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const notificationTimer = React.useRef<number | undefined>(undefined);
  const [showIgnored, setShowIgnored] = useState(false);

  const showNotification = (message: string, type: ToastMessage['type'] = 'info') => {
    setNotification({ message, type });
    window.clearTimeout(notificationTimer.current);
    notificationTimer.current = window.setTimeout(() => setNotification(null), 4500);
  };

  useEffect(() => () => window.clearTimeout(notificationTimer.current), []);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) setUserProfile(docSnap.data());
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user || !userProfile?.groupId) return;
    const q = query(
      collection(db, 'immo_searches'),
      where('groupId', '==', userProfile.groupId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedSearches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImmoSearchDoc));
      fetchedSearches.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      setSearches(fetchedSearches);
    });
    return unsubscribe;
  }, [user, userProfile]);

  const handleAddSearch = async (data: { name: string; url: string; filterWord: string }) => {
    if (!userProfile?.groupId) return;
    try {
      const docRef = await addDoc(collection(db, 'immo_searches'), {
        ...data,
        groupId: userProfile.groupId,
        links: [],
        createdAt: serverTimestamp(),
        lastChecked: new Date().toISOString(),
        isScraping: true,
        lastError: null
      });

      try {
        const refreshImmoSearches = httpsCallable(functions, 'refreshImmoSearchesV2');
        await refreshImmoSearches({ searchId: docRef.id });
      } catch (err) {
        console.error("Error refreshing new search: ", err);
      }

      showNotification("Recherche ajoutée avec succès", 'success');
    } catch (err) {
      console.error(err);
      showNotification("Erreur lors de l'ajout", 'error');
    }
  };

  const handleEditSearch = async (id: string, data: { name: string; url: string; filterWord: string }) => {
    try {
      await updateDoc(doc(db, 'immo_searches', id), data);
      showNotification("Recherche modifiée avec succès", 'success');

      const refreshImmoSearches = httpsCallable(functions, 'refreshImmoSearchesV2');
      await refreshImmoSearches({ searchId: id });
    } catch (err) {
      console.error(err);
      showNotification("Erreur lors de la modification", 'error');
    }
  };

  const handleDeleteSearch = async (id: string) => {
    if (window.confirm("Supprimer cette recherche ?")) {
      try {
        await deleteDoc(doc(db, 'immo_searches', id));
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleIgnoreLink = async (searchId: string, linkUrl: string) => {
    try {
      const search = searches.find(s => s.id === searchId);
      if (search) {
        const newLinks = search.links.map(l => {
           if (typeof l === 'string') {
              if (l === linkUrl) return { url: l, isRead: true, isFavorite: false, isIgnored: true, addedAt: new Date().toISOString() };
              return l;
           }
           if (l.url === linkUrl) return { ...l, isRead: true, isFavorite: false, isIgnored: true };
           return l;
        });
        await updateDoc(doc(db, 'immo_searches', searchId), { links: newLinks });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestoreLink = async (searchId: string, linkUrl: string) => {
    try {
      const search = searches.find(s => s.id === searchId);
      if (search) {
        const newLinks = search.links.map(l => {
           if (typeof l === 'string') return l;
           if (l.url === linkUrl) return { ...l, isIgnored: false, isRead: false };
           return l;
        });
        await updateDoc(doc(db, 'immo_searches', searchId), { links: newLinks });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAsRead = async (searchId: string, linkUrl: string) => {
    try {
      const search = searches.find(s => s.id === searchId);
      if (search) {
        const newLinks = search.links.map(l => {
           if (typeof l === 'string') {
              if (l === linkUrl) return { url: l, isRead: true, isFavorite: false, addedAt: new Date().toISOString() };
              return l;
           }
           if (l.url === linkUrl) return { ...l, isRead: true };
           return l;
        });
        await updateDoc(doc(db, 'immo_searches', searchId), { links: newLinks });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleFavorite = async (searchId: string, linkUrl: string) => {
    try {
      const search = searches.find(s => s.id === searchId);
      if (search) {
        const newLinks = search.links.map(l => {
           if (typeof l === 'string') {
              if (l === linkUrl) return { url: l, isRead: true, isFavorite: true, addedAt: new Date().toISOString() };
              return l;
           }
           if (l.url === linkUrl) return { ...l, isFavorite: !l.isFavorite };
           return l;
        });
        await updateDoc(doc(db, 'immo_searches', searchId), { links: newLinks });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Derive global aggregated links
  const allUnreadLinks: { searchId: string, searchName: string, link: ImmoLink }[] = [];
  const allFavoriteLinks: { searchId: string, searchName: string, link: ImmoLink }[] = [];
  const allKeptLinks: { searchId: string, searchName: string, link: ImmoLink }[] = [];
  const allIgnoredLinks: { searchId: string, searchName: string, link: ImmoLink }[] = [];

  searches.forEach(search => {
     search.links.forEach(l => {
        const linkObj = typeof l === 'string' ? { url: l, isRead: false, isFavorite: false, isIgnored: false, addedAt: new Date().toISOString() } : l;

        if (linkObj.isIgnored) {
           allIgnoredLinks.push({ searchId: search.id, searchName: search.name, link: linkObj });
        } else if (linkObj.isFavorite) {
           allFavoriteLinks.push({ searchId: search.id, searchName: search.name, link: linkObj });
        } else if (linkObj.isRead) {
           allKeptLinks.push({ searchId: search.id, searchName: search.name, link: linkObj });
        } else {
           allUnreadLinks.push({ searchId: search.id, searchName: search.name, link: linkObj });
        }
     });
  });

  allUnreadLinks.sort((a, b) => new Date(b.link.addedAt).getTime() - new Date(a.link.addedAt).getTime());
  allFavoriteLinks.sort((a, b) => new Date(b.link.addedAt).getTime() - new Date(a.link.addedAt).getTime());
  allKeptLinks.sort((a, b) => new Date(b.link.addedAt).getTime() - new Date(a.link.addedAt).getTime());
  allIgnoredLinks.sort((a, b) => new Date(b.link.addedAt).getTime() - new Date(a.link.addedAt).getTime());

  // Combined list for the right column: favorites first, then kept items
  const favoritesAndKeptLinks = [...allFavoriteLinks, ...allKeptLinks];


  const handleRefresh = async (searchId?: string) => {
    if (!searchId) setIsGlobalRefreshing(true);
    try {
      const refreshImmoSearches = httpsCallable(functions, 'refreshImmoSearchesV2');
      const result = await refreshImmoSearches({ searchId });
      const data = result.data as any;
      if (data.success) {
        showNotification(data.message || "Recherche(s) actualisée(s)", 'success');
      } else {
        showNotification(data.message || "Erreur d'actualisation", 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification("Erreur de connexion", 'error');
    } finally {
      if (!searchId) setIsGlobalRefreshing(false);
    }
  };

  return (
    <div className="w-full">
      <Toast toast={notification} onDismiss={() => setNotification(null)} />

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-[#212529] tracking-tight">Recherche Immo</h2>
          <p className="text-[#6c757d] mt-2">Suivez automatiquement l'apparition de nouveaux biens immobiliers.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleRefresh()}
            disabled={isGlobalRefreshing}
            className={`flex items-center px-4 py-2 bg-white border border-gray-200 text-[#212529] text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors shadow-sm ${isGlobalRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isGlobalRefreshing ? 'animate-spin' : ''}`} />
            Chercher Maintenant
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center px-4 py-2 bg-[#212529] text-white text-sm font-medium rounded-xl hover:bg-black transition-colors shadow-md"
          >
            <PlusSquare className="w-4 h-4 mr-2" />
            Nouvelle URL
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Left column: Unread Links */}
        <div>
          <h3 className="text-xl font-bold text-[#212529] mb-4 flex items-center">
            <CheckCircle2 className="w-5 h-5 text-blue-500 mr-2" /> Nouveaux biens ({allUnreadLinks.length})
          </h3>
          {allUnreadLinks.length > 0 ? (
            <div className="space-y-3">
              {allUnreadLinks.map((item, idx) => (
                <div key={`${item.searchId}:${item.link.url}`} className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                   <div className="flex justify-between items-center mb-2 gap-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-sm font-bold text-[#212529] whitespace-nowrap">Bien {idx + 1}</span>
                        <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full truncate">{item.searchName}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDate(item.link.addedAt)}</span>
                   </div>

                   <a href={item.link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-600 hover:text-blue-600 truncate mb-3">
                      {item.link.url}
                   </a>

                   <div className="flex items-center gap-2 mt-auto">
                      <button onClick={() => handleToggleFavorite(item.searchId, item.link.url)} className="flex-1 flex items-center justify-center text-xs bg-red-50 hover:bg-red-100 text-red-500 py-1.5 rounded-lg font-medium transition-colors" title="Ajouter aux favoris">
                         <Heart className="w-3.5 h-3.5 mr-1" /> Favoris
                      </button>
                      <button onClick={() => handleMarkAsRead(item.searchId, item.link.url)} className="flex-1 flex items-center justify-center text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-1.5 rounded-lg font-medium transition-colors" title="Garder dans l'historique">
                         <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Garder
                      </button>
                      <button onClick={() => handleIgnoreLink(item.searchId, item.link.url)} className="flex-1 flex items-center justify-center text-xs bg-white border border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-gray-500 py-1.5 rounded-lg font-medium transition-colors" title="Ignorer définitivement">
                         <X className="w-3.5 h-3.5 mr-1" /> Ignorer
                      </button>
                   </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic p-4 bg-gray-50 rounded-xl border border-gray-100">
              Aucun nouveau bien pour le moment.
            </div>
          )}
        </div>

        {/* Right column: Favorites and Kept Links */}
        <div>
          <h3 className="text-xl font-bold text-[#212529] mb-4 flex items-center">
            <Heart className="w-5 h-5 text-red-500 mr-2 fill-current" /> Favoris & Gardés ({favoritesAndKeptLinks.length})
          </h3>
          {favoritesAndKeptLinks.length > 0 ? (
            <div className="space-y-3">
              {favoritesAndKeptLinks.map((item, idx) => (
                <div key={`${item.searchId}:${item.link.url}`} className={`p-4 rounded-xl border shadow-sm flex flex-col ${item.link.isFavorite ? 'bg-red-50 border-red-100' : 'bg-white border-gray-200'}`}>
                   <div className="flex justify-between items-center mb-2 gap-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-sm font-bold text-[#212529] whitespace-nowrap">Bien {idx + 1}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full truncate ${item.link.isFavorite ? 'text-red-600 bg-red-100' : 'text-gray-600 bg-gray-100'}`}>{item.searchName}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDate(item.link.addedAt)}</span>
                   </div>

                   <a href={item.link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-600 hover:text-blue-600 truncate mb-3">
                      {item.link.url}
                   </a>

                   <div className="flex items-center gap-2 mt-auto justify-end">
                      {item.link.isFavorite ? (
                        <button onClick={() => handleToggleFavorite(item.searchId, item.link.url)} className="flex items-center text-xs bg-white border border-red-200 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-medium transition-colors" title="Retirer des favoris">
                           <Heart className="w-3.5 h-3.5 mr-1 fill-current" /> Retirer des favoris
                        </button>
                      ) : (
                        <button onClick={() => handleToggleFavorite(item.searchId, item.link.url)} className="flex items-center text-xs bg-red-50 hover:bg-red-100 text-red-500 px-3 py-1.5 rounded-lg font-medium transition-colors" title="Ajouter aux favoris">
                           <Heart className="w-3.5 h-3.5 mr-1" /> Favoris
                        </button>
                      )}
                      <button onClick={() => handleIgnoreLink(item.searchId, item.link.url)} className="flex items-center text-xs bg-white border border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-gray-500 px-3 py-1.5 rounded-lg font-medium transition-colors" title="Ignorer">
                         <X className="w-3.5 h-3.5 mr-1" /> Ignorer
                      </button>
                   </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic p-4 bg-gray-50 rounded-xl border border-gray-100">
              Aucun bien favori ou gardé.
            </div>
          )}
        </div>
      </div>

      {/* Ignored Links Section */}
      <div className="mb-12 border-t border-gray-200 pt-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-[#212529] flex items-center">
            <Trash2 className="w-5 h-5 text-gray-500 mr-2" /> Logements ignorés ({allIgnoredLinks.length})
          </h3>
          {allIgnoredLinks.length > 0 && (
            <button
              onClick={() => setShowIgnored(!showIgnored)}
              className="text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors"
            >
              {showIgnored ? 'Masquer' : 'Afficher'} les logements ignorés
            </button>
          )}
        </div>

        {showIgnored && allIgnoredLinks.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {allIgnoredLinks.map((item, idx) => (
              <div key={`${item.searchId}:${item.link.url}`} className="bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col opacity-75 hover:opacity-100 transition-opacity">
                 <div className="flex justify-between items-center mb-2 gap-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="text-sm font-bold text-gray-500 whitespace-nowrap">Bien {idx + 1}</span>
                      <span className="text-[10px] font-semibold text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full truncate">{item.searchName}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDate(item.link.addedAt)}</span>
                 </div>

                 <a href={item.link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-500 line-through hover:text-blue-600 truncate mb-3">
                    {item.link.url}
                 </a>

                 <div className="flex items-center gap-2 mt-auto justify-end">
                    <button onClick={() => handleRestoreLink(item.searchId, item.link.url)} className="flex items-center text-xs bg-white border border-gray-300 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 text-gray-600 px-3 py-1.5 rounded-lg font-medium transition-colors" title="Restaurer ce bien">
                       <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restaurer
                    </button>
                 </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {searches.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <Home className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[#212529]">Aucune recherche immobilière</h3>
          <p className="text-[#6c757d] mt-2">Ajoutez l'URL d'une recherche sur un site immobilier (Leboncoin, SeLoger...) pour être alerté des nouveaux biens.</p>
        </div>
      ) : (
        <div>
          <h3 className="text-xl font-bold text-[#212529] mb-4">Vos configurations ({searches.length})</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {searches.map((search) => (
              <div key={search.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg text-[#212529] line-clamp-1" title={search.name}>{search.name}</h3>
                    <a href={search.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center mt-1 truncate max-w-[200px]">
                      <ExternalLink className="w-3 h-3 mr-1" /> Lien de recherche
                    </a>
                    {search.filterWord && (
                      <span className="text-[10px] bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full mt-2 inline-block">Filtre: {search.filterWord}</span>
                    )}
                  </div>
                  <div className="flex gap-1 sm:gap-2">
                    <button onClick={() => handleRefresh(search.id)} className="p-1.5 text-gray-500 hover:text-[#212529] hover:bg-white rounded-md" title="Rafraîchir">
                      <RefreshCw className={`w-4 h-4 ${search.isScraping ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => { setSearchToEdit(search); setIsEditModalOpen(true); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Modifier">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteSearch(search.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md" title="Supprimer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col justify-center">
                  {search.lastError && (
                     <div className="text-xs bg-red-50 text-red-600 p-2 rounded mb-3">Erreur : {search.lastError}</div>
                  )}
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600 font-medium">{search.links.length} biens trouvés</span>
                    <span className="text-xs text-gray-400">MàJ : {formatDateTime(search.lastChecked)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddImmoSearchModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddSearch}
      />

      <EditImmoSearchModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={handleEditSearch}
        search={searchToEdit}
      />
    </div>
  );
}
