import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { ItemCard } from '../components/ItemCard';
import { AddItemModal } from '../components/AddItemModal';
import { ItemDetailModal } from '../components/ItemDetailModal';
import Masonry from 'react-masonry-css';
import { auth, db, functions } from '../firebase/config';
import { signOut } from 'firebase/auth';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, orderBy, where, or } from 'firebase/firestore';
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
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
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
      await addDoc(collection(db, 'items'), {
        ...data,
        userId: user.uid,
        currentPrice: 0, // Will be updated by initial scrape
        history: [],
        createdAt: serverTimestamp(),
        lastChecked: new Date().toISOString()
      });
      // Optionally call refresh function immediately here
    } catch (error) {
      console.error("Error adding document: ", error);
    }
  };

  const handleRefreshItem = async (id: string) => {
    setIsRefreshing(true);
    try {
      const refreshItemPrice = httpsCallable(functions, 'refreshItemPrice');
      await refreshItemPrice({ itemId: id });
    } catch (error) {
      console.error("Error refreshing item: ", error);
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

  const breakpointColumnsObj = {
    default: 4,
    1536: 4, // 2xl
    1280: 3, // xl
    1024: 2, // lg
    768: 2,  // md
    640: 1   // sm
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex">
      <Sidebar
        onAddClick={() => setIsAddModalOpen(true)}
        onLogout={handleLogout}
      />

      <main className="flex-1 md:ml-64 p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8">
            <h2 className="text-3xl font-bold text-[#212529] tracking-tight">Mes Articles</h2>
            <p className="text-[#6c757d] mt-2">Suivez l'évolution des prix de vos articles favoris.</p>
          </header>

          <Masonry
            breakpointCols={breakpointColumnsObj}
            className="flex w-auto -ml-6"
            columnClassName="pl-6 bg-clip-padding"
          >
            {items.length === 0 ? (
              <div className="col-span-full text-center py-20 text-[#6c757d]">
                Aucun article suivi. Commencez par en ajouter un !
              </div>
            ) : (
              items.map(item => (
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
        isRefreshing={isRefreshing}
      />
    </div>
  );
}
