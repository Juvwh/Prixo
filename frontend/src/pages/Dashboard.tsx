import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { ItemCard } from '../components/ItemCard';
import { AddItemModal } from '../components/AddItemModal';
import { EditItemModal } from '../components/EditItemModal';
import { ItemDetailModal } from '../components/ItemDetailModal';
import Masonry from 'react-masonry-css';
import { auth, db, functions } from '../firebase/config';
import { signOut } from 'firebase/auth';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, orderBy, where, or } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

// --- MOCK DATA FOR UI DEVELOPMENT ---
const mockHistory = [
  { date: '2023-10-01', price: 599 },
  { date: '2023-10-15', price: 599 },
  { date: '2023-11-01', price: 549 },
  { date: '2023-11-15', price: 549 },
  { date: '2023-11-24', price: 499 }, // Black Friday drop
];

const mockItems = [
  {
    id: '1',
    name: 'Canapé 3 places KIVIK, avec méridienne, beige clair',
    category: 'Salon',
    currentPrice: 499,
    imageUrl: 'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    isPrivate: false,
    isFavorite: true,
    lastChecked: '2023-11-25T08:00:00Z',
    url: '#',
    history: mockHistory
  },
  {
    id: '2',
    name: 'Table à manger extensible LISABO, plaqué frêne',
    category: 'Salle à manger',
    currentPrice: 179,
    imageUrl: 'https://images.unsplash.com/photo-1533090481720-856c6e3c1fdc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    isPrivate: true,
    isFavorite: false,
    lastChecked: '2023-11-25T08:00:00Z',
    url: '#',
    history: [
      { date: '2023-10-01', price: 149 },
      { date: '2023-11-01', price: 179 }, // Price went up
    ]
  },
   {
    id: '3',
    name: 'Fauteuil STRANDMON, jaune moutarde',
    category: 'Salon',
    currentPrice: 249,
    imageUrl: 'https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    isPrivate: false,
    isFavorite: false,
    lastChecked: '2023-11-25T08:00:00Z',
    url: '#',
    history: [
      { date: '2023-10-01', price: 249 },
      { date: '2023-11-01', price: 249 },
    ]
  },
  {
    id: '4',
    name: 'Lampe de table TÄLLBYN, verre opalin/nickelé',
    category: 'Éclairage',
    currentPrice: 39.99,
    imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80',
    isPrivate: true,
    isFavorite: true,
    lastChecked: '2023-11-25T08:00:00Z',
    url: '#',
    history: [
      { date: '2023-10-01', price: 49.99 },
      { date: '2023-11-01', price: 39.99 }, // Drop
    ]
  }
];
// ------------------------------------

export function Dashboard() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'items'),
      or(
        where('isPrivate', '==', false),
        where('userId', '==', user.uid)
      )
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort in memory: favorites first, then by creation date (descending)
      fetchedItems.sort((a, b) => {
        if (a.isFavorite === b.isFavorite) {
           const timeA = a.createdAt?.toMillis() || 0;
           const timeB = b.createdAt?.toMillis() || 0;
           return timeB - timeA;
        }
        return a.isFavorite ? -1 : 1;
      });
      setItems(fetchedItems);
    });
    return unsubscribe;
  }, [user]);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleAddItem = async (data: any) => {
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'items'), {
        ...data,
        userId: user.uid,
        currentPrice: 0, // Will be updated by initial scrape
        history: [],
        createdAt: serverTimestamp(),
        lastChecked: new Date().toISOString(),
        isScraping: true // Indicateur visuel "Recherche en cours"
      });

      // Call refresh function immediately here
      try {
        const refreshItemPrice = httpsCallable(functions, 'refreshItemPrice');
        await refreshItemPrice({ itemId: docRef.id });
      } catch (err) {
        console.error("Error refreshing new item: ", err);
      } finally {
        // Au cas où la cloud function ne mettrait pas à jour isScraping si elle plante en plein milieu
        // updateDoc(docRef, { isScraping: false }) serait utile, mais le rafraîchissement peut être géré par l'événement onChange onSnapshot
      }
    } catch (error) {
      console.error("Error adding document: ", error);
    }
  };

  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'info' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleRefreshItem = async (id: string) => {
    setIsRefreshing(true);
    setNotification(null);
    try {
      const refreshItemPrice = httpsCallable(functions, 'refreshItemPrice');
      const result = await refreshItemPrice({ itemId: id });
      const data = result.data as any;

      // Mettre à jour l'élément sélectionné avec les nouvelles données
      setSelectedItem((prev: any) => {
        if (prev && prev.id === id) {
          return {
            ...prev,
            currentPrice: data.newPrice !== undefined ? data.newPrice : prev.currentPrice,
            lastChecked: new Date().toISOString(),
            isScraping: false,
            scrapeError: data.newPrice === null ? "Impossible de récupérer le prix sur ce site." : null
          };
        }
        return prev;
      });

      // Afficher un message de confirmation
      if (data.success && data.newPrice !== undefined) {
         showNotification(`Prix mis à jour : ${data.newPrice}€`, 'success');
      } else if (data.success && data.message) {
         showNotification(`Le prix n'a pas changé (${data.currentPrice}€).`, 'info');
      }

    } catch (error) {
      console.error("Error refreshing item: ", error);
      showNotification("Erreur lors de l'actualisation.", 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if(window.confirm("Êtes-vous sûr de vouloir supprimer cet article ?")) {
      try {
        await deleteDoc(doc(db, 'items', id));
        setSelectedItem(null);
      } catch (error) {
         console.error("Error deleting document: ", error);
      }
    }
  };

  const handleEditItem = async (id: string, data: any) => {
    try {
      await updateDoc(doc(db, 'items', id), data);

      // Update selectedItem state to reflect changes in ItemDetailModal if it's open
      setSelectedItem((prev: any) => prev && prev.id === id ? { ...prev, ...data } : prev);
    } catch (error) {
      console.error("Error updating document: ", error);
    }
  };

  // Calculate dynamic categories from items
  const categoriesMap = new Map<string, { total: number; privateCount: number }>();
  items.forEach(item => {
    if (!item.category) return;
    const cat = item.category.trim();
    if (!categoriesMap.has(cat)) {
      categoriesMap.set(cat, { total: 0, privateCount: 0 });
    }
    const data = categoriesMap.get(cat)!;
    data.total += 1;
    if (item.isPrivate) {
      data.privateCount += 1;
    }
  });

  const categoriesData = Array.from(categoriesMap.entries()).map(([name, data]) => ({
    name,
    isAllPrivate: data.total > 0 && data.total === data.privateCount
  })).sort((a, b) => a.name.localeCompare(b.name));

  // Filter items based on selected category
  const displayedItems = items.filter(item => {
    if (selectedCategory === 'favorites') return item.isFavorite;
    if (selectedCategory !== null) return item.category?.trim() === selectedCategory;
    return true; // null means 'All'
  });

  const breakpointColumnsObj = {
    default: 4,
    1536: 4, // 2xl
    1280: 3, // xl
    1024: 2, // lg
    768: 2,  // md
    640: 1   // sm
  };

  const getPageTitle = () => {
    if (selectedCategory === 'favorites') return "Coups de cœur";
    if (selectedCategory) return selectedCategory;
    return "Tous les articles";
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex">
      <Sidebar
        onAddClick={() => setIsAddModalOpen(true)}
        onLogout={handleLogout}
        categories={categoriesData}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        userEmail={user?.email}
      />

      <main className="flex-1 md:ml-64 p-4 sm:p-6 lg:p-8 pt-20 md:pt-8 pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8">
            <h2 className="text-3xl font-bold text-[#212529] tracking-tight">{getPageTitle()}</h2>
            <p className="text-[#6c757d] mt-2">Suivez l'évolution des prix de vos articles favoris.</p>
          </header>

          <Masonry
            breakpointCols={breakpointColumnsObj}
            className="flex w-auto -ml-6"
            columnClassName="pl-6 bg-clip-padding"
          >
            {displayedItems.length === 0 ? (
              <div className="col-span-full text-center py-20 text-[#6c757d]">
                Aucun article dans cette catégorie.
              </div>
            ) : (
              displayedItems.map(item => (
                <ItemCard
                  key={item.id}
                  {...item}
                  onClick={() => setSelectedItem(item)}
                />
              ))
            )}
          </Masonry>
        </div>
      </main>

      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddItem}
      />

      <ItemDetailModal
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        item={selectedItem}
        onRefresh={handleRefreshItem}
        onDelete={handleDeleteItem}
        onEdit={() => setIsEditModalOpen(true)}
        isRefreshing={isRefreshing}
        notification={notification}
      />

      <EditItemModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={handleEditItem}
        item={selectedItem}
      />
    </div>
  );
}
