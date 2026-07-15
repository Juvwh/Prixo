import React, { useState, useEffect } from 'react';
import { PlusSquare, RefreshCw, Trash2, ExternalLink, Home, X, Heart, CheckCircle2 } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, where } from 'firebase/firestore';
import { db, functions } from '../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../hooks/useAuth';
import { AddImmoSearchModal } from './AddImmoSearchModal';

interface ImmoLink {
  url: string;
  isRead: boolean;
  isFavorite: boolean;
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

export function ImmoSearch() {
  const { user } = useAuth();
  const [searches, setSearches] = useState<ImmoSearchDoc[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isGlobalRefreshing, setIsGlobalRefreshing] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

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

  const handleDeleteSearch = async (id: string) => {
    if (window.confirm("Supprimer cette recherche ?")) {
      try {
        await deleteDoc(doc(db, 'immo_searches', id));
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleDeleteLink = async (searchId: string, linkUrlToRemove: string) => {
    try {
      const search = searches.find(s => s.id === searchId);
      if (search) {
        const newLinks = search.links.filter(l => {
           if (typeof l === 'string') return l !== linkUrlToRemove;
           return l.url !== linkUrlToRemove;
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

  // Derive global unread and favorites for the dashboard header sections
  const allUnreadLinks: { searchId: string, searchName: string, link: ImmoLink }[] = [];
  const allFavoriteLinks: { searchId: string, searchName: string, link: ImmoLink }[] = [];

  searches.forEach(search => {
     search.links.forEach(l => {
        const linkObj = typeof l === 'string' ? { url: l, isRead: false, isFavorite: false, addedAt: new Date().toISOString() } : l;
        if (!linkObj.isRead && !linkObj.isFavorite) {
           allUnreadLinks.push({ searchId: search.id, searchName: search.name, link: linkObj });
        }
        if (linkObj.isFavorite) {
           allFavoriteLinks.push({ searchId: search.id, searchName: search.name, link: linkObj });
        }
     });
  });

  allUnreadLinks.sort((a, b) => new Date(b.link.addedAt).getTime() - new Date(a.link.addedAt).getTime());
  allFavoriteLinks.sort((a, b) => new Date(b.link.addedAt).getTime() - new Date(a.link.addedAt).getTime());


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
      {notification && (
        <div className={`fixed top-6 right-6 p-4 rounded-xl shadow-lg z-[100] animate-in fade-in slide-in-from-top-5 duration-300 ${
          notification.type === 'success' ? 'bg-[#a8d5ba] text-[#212529]' :
          notification.type === 'error' ? 'bg-red-500 text-white' :
          'bg-[#212529] text-white'
        }`}>
          {notification.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-[#212529] tracking-tight">Recherche Immo</h2>
          <p className="text-[#6c757d] mt-2">Suivez automatiquement l'apparition de nouveaux biens immobiliers.</p>
        </div>

        <div className="flex gap-3">
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

      {allUnreadLinks.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xl font-bold text-[#212529] mb-4 flex items-center">
            <CheckCircle2 className="w-5 h-5 text-blue-500 mr-2" /> Nouveaux biens ({allUnreadLinks.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {allUnreadLinks.map((item, idx) => (
              <div key={idx} className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                 <div className="text-xs text-gray-500 mb-1">{item.searchName}</div>
                 <a href={item.link.url} target="_blank" rel="noopener noreferrer" onClick={() => handleMarkAsRead(item.searchId, item.link.url)} className="text-sm font-medium text-[#212529] hover:text-blue-600 line-clamp-2 break-all mb-3">
                    {item.link.url}
                 </a>
                 <div className="mt-auto flex justify-between items-center border-t border-gray-100 pt-3">
                    <span className="text-xs text-gray-400">{new Date(item.link.addedAt).toLocaleDateString('fr-FR')}</span>
                    <div className="flex gap-2">
                       <button onClick={() => handleMarkAsRead(item.searchId, item.link.url)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded" title="Marquer comme lu">
                          Lu
                       </button>
                       <button onClick={() => handleToggleFavorite(item.searchId, item.link.url)} className="text-xs bg-red-50 hover:bg-red-100 text-red-500 px-2 py-1 rounded flex items-center" title="Ajouter aux favoris">
                          <Heart className="w-3.5 h-3.5" />
                       </button>
                    </div>
                 </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allFavoriteLinks.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xl font-bold text-[#212529] mb-4 flex items-center">
            <Heart className="w-5 h-5 text-red-500 mr-2 fill-current" /> Vos favoris ({allFavoriteLinks.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {allFavoriteLinks.map((item, idx) => (
              <div key={idx} className="bg-red-50 p-4 rounded-xl border border-red-100 shadow-sm flex flex-col">
                 <div className="text-xs text-gray-500 mb-1">{item.searchName}</div>
                 <a href={item.link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[#212529] hover:text-red-600 line-clamp-2 break-all mb-3">
                    {item.link.url}
                 </a>
                 <div className="mt-auto flex justify-end pt-3">
                    <button onClick={() => handleToggleFavorite(item.searchId, item.link.url)} className="text-xs bg-white border border-red-200 hover:bg-red-100 text-red-600 px-2 py-1 rounded flex items-center" title="Retirer des favoris">
                       <Heart className="w-3.5 h-3.5 mr-1 fill-current" /> Retirer
                    </button>
                 </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <div className="flex gap-2">
                    <button onClick={() => handleRefresh(search.id)} className="p-1.5 text-gray-500 hover:text-[#212529] hover:bg-white rounded-md" title="Rafraîchir">
                      <RefreshCw className={`w-4 h-4 ${search.isScraping ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => handleDeleteSearch(search.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md" title="Supprimer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="p-5 flex-1 overflow-y-auto max-h-64">
                  {search.lastError && (
                     <div className="text-xs bg-red-50 text-red-600 p-2 rounded mb-3">Erreur : {search.lastError}</div>
                  )}
                  <div className="text-xs text-gray-500 mb-3">
                    {search.links.length} biens trouvés (Dernière vérif. : {new Date(search.lastChecked).toLocaleString('fr-FR')})
                  </div>
                  <ul className="space-y-2">
                    {search.links.map((l, idx) => {
                      const linkObj = typeof l === 'string' ? { url: l, isRead: false, isFavorite: false } : l;
                      return (
                        <li key={idx} className="flex items-center justify-between group text-sm">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                             <a href={linkObj.url} onClick={() => handleMarkAsRead(search.id, linkObj.url)} target="_blank" rel="noopener noreferrer" className={`hover:text-blue-600 hover:underline truncate pr-2 ${linkObj.isRead ? 'text-gray-400' : 'text-[#212529] font-medium'}`}>
                               Bien #{idx + 1}
                             </a>
                             {linkObj.isFavorite && <Heart className="w-3 h-3 text-red-500 fill-current shrink-0" />}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button onClick={() => handleToggleFavorite(search.id, linkObj.url)} className="text-gray-400 hover:text-red-500 p-1" title="Favori">
                               <Heart className="w-4 h-4" />
                             </button>
                             <button onClick={() => handleDeleteLink(search.id, linkObj.url)} className="text-gray-400 hover:text-red-500 p-1" title="Supprimer">
                               <X className="w-4 h-4" />
                             </button>
                          </div>
                        </li>
                      );
                    })}
                    {search.links.length === 0 && !search.isScraping && (
                      <li className="text-sm text-gray-400 italic">Aucun bien trouvé.</li>
                    )}
                  </ul>
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
    </div>
  );
}
