import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { ItemCard } from '../components/ItemCard';
import { AddItemModal } from '../components/AddItemModal';
import { EditItemModal } from '../components/EditItemModal';
import { ItemDetailModal } from '../components/ItemDetailModal';
import { AddBoardModal } from '../components/AddBoardModal';
import Masonry from 'react-masonry-css';
import { auth, db, functions } from '../firebase/config';
import { signOut } from 'firebase/auth';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, orderBy, where, or } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable';
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
  const [isAddBoardModalOpen, setIsAddBoardModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [boardsData, setBoardsData] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [showPrivateItems, setShowPrivateItems] = useState(false);
  const { user } = useAuth();

  // Fetch Items
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

  // Default showPrivateItems based on board privacy
  useEffect(() => {
    if (selectedBoardId && selectedBoardId !== 'favorites') {
      const boardDoc = boardsData.find(b => b.id === selectedBoardId);
      if (boardDoc) {
        setShowPrivateItems(boardDoc.isPrivate);
      }
    } else {
      setShowPrivateItems(false);
    }
  }, [selectedBoardId, boardsData]);

  // Fetch Boards
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'boards'),
      or(
        where('isPrivate', '==', false),
        where('ownerId', '==', user.uid)
      )
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedBoards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort alphabetically by name
      fetchedBoards.sort((a, b) => a.name.localeCompare(b.name));
      setBoardsData(fetchedBoards);
    });
    return unsubscribe;
  }, [user]);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleAddBoard = async (data: { name: string, isPrivate: boolean }) => {
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'boards'), {
        ...data,
        ownerId: user.uid,
        itemOrder: [],
        createdAt: serverTimestamp(),
      });
      setSelectedBoardId(docRef.id);
      showNotification("Tableau créé avec succès.", 'success');
    } catch (error) {
      console.error("Error adding board: ", error);
      showNotification("Erreur lors de la création du tableau.", 'error');
    }
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

      // If the item was added to specific boards, we might want to update their itemOrder
      // In a real robust app, we'd use a batch write, but since itemOrder isn't strictly required
      // immediately for the item to appear (it just appears at the end), we can handle it via the UI logic later
      // Actually, since default is at the end, and we render items not in order if order is missing,
      // it's okay to just leave it. If we wanted, we could append the ID to the board's itemOrder.

      // Let's add it to the boards' itemOrder to be safe
      if (data.boards && data.boards.length > 0) {
        data.boards.forEach(async (boardId: string) => {
          const boardRef = doc(db, 'boards', boardId);
          const boardDoc = boardsData.find(b => b.id === boardId);
          if (boardDoc) {
             const currentOrder = boardDoc.itemOrder || [];
             // Add to beginning if favorite, else at the end
             const newOrder = data.isFavorite ? [docRef.id, ...currentOrder] : [...currentOrder, docRef.id];
             await updateDoc(boardRef, { itemOrder: newOrder });
          }
        });
      }

      // Call refresh function immediately here
      try {
        const refreshItemPrice = httpsCallable(functions, 'refreshItemPrice');
        await refreshItemPrice({ itemId: docRef.id });
      } catch (err) {
        console.error("Error refreshing new item: ", err);
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

  // Filter and sort items based on selected board
  let displayedItems = items.filter(item => {
    let matchesBoard = true;
    if (selectedBoardId === 'favorites') matchesBoard = item.isFavorite;
    else if (selectedBoardId !== null) matchesBoard = item.boards?.includes(selectedBoardId);

    if (!matchesBoard) return false;

    // Privacy filter
    if (item.isPrivate && item.userId === user?.uid && !showPrivateItems) {
       return false;
    }

    return true;
  });

  // If a specific board is selected, sort items according to the board's itemOrder
  if (selectedBoardId && selectedBoardId !== 'favorites') {
    const boardDoc = boardsData.find(b => b.id === selectedBoardId);
    if (boardDoc && boardDoc.itemOrder) {
      displayedItems.sort((a, b) => {
        const indexA = boardDoc.itemOrder.indexOf(a.id);
        const indexB = boardDoc.itemOrder.indexOf(b.id);
        // If not in order array, push to end
        const posA = indexA === -1 ? Infinity : indexA;
        const posB = indexB === -1 ? Infinity : indexB;
        return posA - posB;
      });
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require dragging at least 8px before activation to distinguish from clicks
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    // 1. Drag Item over Sidebar Board
    if (activeType === 'item' && overType === 'board') {
       const targetBoardId = overId;
       const draggedItem = items.find(i => i.id === activeId);

       if (!draggedItem) return;

       const currentBoards = draggedItem.boards || [];
       const targetBoardDoc = boardsData.find(b => b.id === targetBoardId);
       if (!targetBoardDoc) return;

       const targetOrder = targetBoardDoc.itemOrder || [];

       if (selectedBoardId && selectedBoardId !== 'favorites') {
         // Déplacement : On retire de l'actuel, on ajoute au nouveau
         if (selectedBoardId !== targetBoardId) {
            const newBoards = currentBoards.filter((b: string) => b !== selectedBoardId);
            if (!newBoards.includes(targetBoardId)) newBoards.push(targetBoardId);

            await updateDoc(doc(db, 'items', activeId), { boards: newBoards });

            // Mise à jour de l'ordre du nouveau tableau (ajout à la fin)
            if (!targetOrder.includes(activeId)) {
               await updateDoc(doc(db, 'boards', targetBoardId), {
                 itemOrder: [...targetOrder, activeId]
               });
            }

            // On pourrait aussi nettoyer itemOrder de l'ancien tableau, mais ce n'est pas strict.
            showNotification(`Article déplacé vers ${targetBoardDoc.name}`, 'success');
         }
       } else {
         // Ajout simple au nouveau tableau
         if (!currentBoards.includes(targetBoardId)) {
            await updateDoc(doc(db, 'items', activeId), {
               boards: [...currentBoards, targetBoardId]
            });
            // Mise à jour de l'ordre du nouveau tableau
            if (!targetOrder.includes(activeId)) {
               await updateDoc(doc(db, 'boards', targetBoardId), {
                 itemOrder: [...targetOrder, activeId]
               });
            }
            showNotification(`Article ajouté à ${targetBoardDoc.name}`, 'success');
         } else {
            showNotification(`L'article est déjà dans ${targetBoardDoc.name}`, 'info');
         }
       }
       return;
    }

    // 2. Reordering Items within a Board
    if (activeId !== overId && selectedBoardId && selectedBoardId !== 'favorites') {
      const boardDoc = boardsData.find(b => b.id === selectedBoardId);
      if (!boardDoc) return;

      const itemsInBoard = displayedItems.map(i => i.id);
      const oldIndex = itemsInBoard.indexOf(activeId);
      const newIndex = itemsInBoard.indexOf(overId);

      const newOrder = arrayMove(itemsInBoard, oldIndex, newIndex);

      // Save new order to Firestore
      try {
        await updateDoc(doc(db, 'boards', selectedBoardId), {
          itemOrder: newOrder
        });
      } catch (error) {
        console.error("Error updating board order: ", error);
        showNotification("Erreur lors de la sauvegarde de l'ordre.", 'error');
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

  const getPageTitle = () => {
    if (selectedBoardId === 'favorites') return "Coups de cœur";
    if (selectedBoardId) {
      const board = boardsData.find(b => b.id === selectedBoardId);
      return board ? board.name : "Tableau inconnu";
    }
    return "Tous les articles";
  };

  const totalValue = displayedItems.reduce((sum, item) => sum + (item.currentPrice || 0), 0);
  const formattedTotal = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(totalValue);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
    <div className="min-h-screen bg-[#f8f9fa] flex">
      <Sidebar
        onAddClick={() => setIsAddModalOpen(true)}
        onAddBoardClick={() => setIsAddBoardModalOpen(true)}
        onLogout={handleLogout}
        boards={boardsData}
        selectedBoardId={selectedBoardId}
        onSelectBoard={setSelectedBoardId}
        userEmail={user?.email}
      />

      <main className="flex-1 md:ml-64 p-4 sm:p-6 lg:p-8 pt-20 md:pt-8 pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8">
            <h2 className="text-3xl font-bold text-[#212529] tracking-tight mb-2">{getPageTitle()}</h2>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="inline-flex items-center px-4 py-2 bg-[#eef2f0] rounded-xl text-[#212529]">
                <span className="text-sm font-medium mr-2">Valeur cumulée :</span>
                <span className="text-lg font-bold">{formattedTotal}</span>
              </div>

              {selectedBoardId && selectedBoardId !== 'favorites' && (
                <div className="flex items-center">
                  <span className="text-sm font-medium text-[#6c757d] mr-3">Afficher mes articles privés</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={showPrivateItems}
                      onChange={e => setShowPrivateItems(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#a8d5ba]"></div>
                  </label>
                </div>
              )}
            </div>

            <p className="text-[#6c757d] mt-4">Suivez l'évolution des prix de vos articles favoris.</p>
          </header>

          <SortableContext
             items={displayedItems.map(i => i.id)}
             strategy={verticalListSortingStrategy}
          >
            <Masonry
              breakpointCols={breakpointColumnsObj}
              className="flex w-auto -ml-6"
              columnClassName="pl-6 bg-clip-padding"
            >
              {displayedItems.length === 0 ? (
                <div className="col-span-full text-center py-20 text-[#6c757d]">
                  Aucun article dans ce tableau.
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
          </SortableContext>
        </div>
      </main>

      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddItem}
        boards={boardsData}
        initialBoardId={selectedBoardId}
      />

      <ItemDetailModal
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        item={{
           ...selectedItem,
           // Pour l'affichage dans le modal : remplacer les IDs par les noms des tableaux
           boards: selectedItem?.boards?.map((id: string) => boardsData.find(b => b.id === id)?.name).filter(Boolean)
        }}
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
        boards={boardsData}
      />

      <AddBoardModal
        isOpen={isAddBoardModalOpen}
        onClose={() => setIsAddBoardModalOpen(false)}
        onSubmit={handleAddBoard}
      />
    </div>
    </DndContext>
  );
}
