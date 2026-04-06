import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import Sidebar from './Sidebar';
import MasonryGrid from './MasonryGrid';
import AddItemModal from './AddItemModal';
import { Plus } from 'lucide-react';

export default function Dashboard({ user }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState(['Tous']);
  const [activeCategory, setActiveCategory] = useState('Tous');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'items'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems = [];
      const cats = new Set(['Tous']);

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (!data.isPrivate || data.creatorId === user.uid) {
          fetchedItems.push({ id: doc.id, ...data });
          if (data.category) {
            cats.add(data.category);
          }
        }
      });

      fetchedItems.sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return 0;
      });

      setItems(fetchedItems);
      setCategories(Array.from(cats));
    });

    return () => unsubscribe();
  }, [user]);

  const filteredItems = activeCategory === 'Tous'
    ? items
    : items.filter(item => item.category === activeCategory);

  return (
    <div className="flex h-screen bg-brand-gray overflow-hidden font-sans">
      <Sidebar
        categories={categories}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        user={user}
      />

      <main className="flex-1 overflow-y-auto p-4 md:p-8 relative">
        <div className="max-w-7xl mx-auto">
          <header className="mb-12 flex justify-between items-end">
            <div>
              <h1 className="text-4xl font-light text-brand-charcoal mb-2">{activeCategory}</h1>
              <p className="text-gray-500 font-light">{filteredItems.length} article{filteredItems.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 bg-brand-charcoal text-white px-5 py-3 rounded-full hover:bg-gray-800 transition-all shadow-md hover:shadow-lg"
            >
              <Plus size={20} />
              <span className="hidden sm:inline">Ajouter</span>
            </button>
          </header>

          {filteredItems.length > 0 ? (
            <MasonryGrid items={filteredItems} user={user} />
          ) : (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg mb-4">Aucun article dans cette catégorie.</p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="text-brand-sage hover:underline"
              >
                Ajouter un premier article
              </button>
            </div>
          )}
        </div>
      </main>

      {isAddModalOpen && (
        <AddItemModal
          onClose={() => setIsAddModalOpen(false)}
          user={user}
        />
      )}
    </div>
  );
}