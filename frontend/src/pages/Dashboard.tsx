import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { ItemCard } from '../components/ItemCard';
import { AddItemModal } from '../components/AddItemModal';
import { EditItemModal } from '../components/EditItemModal';
import { ItemDetailModal } from '../components/ItemDetailModal';
import { AddBoardModal } from '../components/AddBoardModal';
import { EditPriceHistoryModal } from '../components/EditPriceHistoryModal';
import { EditBoardModal } from '../components/EditBoardModal';
import { SettingsModal } from '../components/SettingsModal';
import { BoardData } from '../components/Sidebar';
import { ImmoSearch } from '../components/ImmoSearch';
import Masonry from 'react-masonry-css';
import { auth, db, functions } from '../firebase/config';
import { signOut } from 'firebase/auth';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, setDoc, serverTimestamp, orderBy, where, or, and } from 'firebase/firestore';
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
import { Trash2, ListChecks, Bell, ChevronDown } from 'lucide-react';

export function Dashboard() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAddBoardModalOpen, setIsAddBoardModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEditPriceModalOpen, setIsEditPriceModalOpen] = useState(false);
  const [isEditBoardModalOpen, setIsEditBoardModalOpen] = useState(false);
  const [selectedBoardToEdit, setSelectedBoardToEdit] = useState<BoardData | null>(null);
  const [isBoardRefreshing, setIsBoardRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [boardsData, setBoardsData] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [showPrivateItems, setShowPrivateItems] = useState(false);
  const [isSelectionModeActive, setIsSelectionModeActive] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const { user } = useAuth();
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isBellOpen, setIsBellOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'custom' | 'date_desc' | 'favorites_first' | 'last_change_desc' | 'price_asc' | 'price_desc'>('custom');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);

  // Fetch User Profile for notifications
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile(docSnap.data());
      } else {
        setUserProfile({ lastNotificationReadAt: null });
      }
    });
    return unsubscribe;
  }, [user]);

  // Fetch Items
  useEffect(() => {
    if (!user || !userProfile?.groupId) return;
    const q = query(
      collection(db, 'items'),
      and(
        where('groupId', '==', userProfile.groupId),
        or(
          where('isPrivate', '==', false),
          where('userId', '==', user.uid)
        )
      )
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Skip sorting here, it's handled by the display logic.
      setItems(fetchedItems);
    });
    return unsubscribe;
  }, [user, userProfile]);

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

  // Settings modal listener
  useEffect(() => {
    const handleOpenSettings = () => setIsSettingsModalOpen(true);
    document.addEventListener('open-settings-modal', handleOpenSettings);
    return () => document.removeEventListener('open-settings-modal', handleOpenSettings);
  }, []);

  // Fetch Boards
  useEffect(() => {
    if (!user || !userProfile?.groupId) return;
    const q = query(
      collection(db, 'boards'),
      and(
        where('groupId', '==', userProfile.groupId),
        or(
          where('isPrivate', '==', false),
          where('ownerId', '==', user.uid)
        )
      )
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedBoards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort alphabetically by name
      fetchedBoards.sort((a, b) => a.name.localeCompare(b.name));
      setBoardsData(fetchedBoards);
    });
    return unsubscribe;
  }, [user, userProfile]);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleAddBoard = async (data: { name: string, isPrivate: boolean }) => {
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'boards'), {
        ...data,
        ownerId: user.uid,
        groupId: userProfile?.groupId || '',
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
        groupId: userProfile?.groupId || '',
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
          let errorMsg = null;
          if (typeof data.lastScrapeError === 'string') {
             errorMsg = data.lastScrapeError;
          } else if (data.newPrice === null) {
             errorMsg = "Impossible de récupérer le prix sur ce site.";
          }

          return {
            ...prev,
            currentPrice: data.newPrice !== undefined ? data.newPrice : prev.currentPrice,
            lastChecked: new Date().toISOString(),
            isScraping: false,
            lastScrapeError: errorMsg
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

  const handleDeleteBoard = async (boardId: string) => {
    try {
      // 1. Delete the board document
      await deleteDoc(doc(db, 'boards', boardId));

      // 2. Remove this board from all items that have it
      const itemsToUpdate = items.filter(item => item.boards && item.boards.includes(boardId));

      for (const item of itemsToUpdate) {
        const newBoards = item.boards.filter((bId: string) => bId !== boardId);
        await updateDoc(doc(db, 'items', item.id), { boards: newBoards });
      }

      // 3. Reset selection if the deleted board was selected
      if (selectedBoardId === boardId) {
        setSelectedBoardId(null);
      }
      showNotification("Tableau supprimé avec succès.", 'success');
    } catch (error) {
      console.error("Error deleting board: ", error);
      showNotification("Erreur lors de la suppression du tableau.", 'error');
    }
  };

  const handleEditBoard = async (boardId: string, data: { name: string }) => {
    try {
      await updateDoc(doc(db, 'boards', boardId), data);
      showNotification("Tableau mis à jour.", 'success');
    } catch (error) {
      console.error("Error updating board: ", error);
      showNotification("Erreur lors de la mise à jour.", 'error');
    }
  };

  const handleRefreshBoardPrice = async (boardId: string) => {
    setIsBoardRefreshing(true);
    setNotification(null);
    try {
      const refreshBoardItemsPrice = httpsCallable(functions, 'refreshBoardItemsPrice');
      const result = await refreshBoardItemsPrice({ boardId });
      const data = result.data as any;

      if (data.success) {
        showNotification(data.message || `Actualisation terminée. ${data.updatedCount || 0} prix mis à jour.`, 'success');
        // We DO NOT close the modal here to let the user inspect the real-time visual tracking
        // setIsEditBoardModalOpen(false);
      } else {
        showNotification(data.message || "Erreur lors de l'actualisation.", 'error');
      }
    } catch (error) {
      console.error("Error refreshing board: ", error);
      showNotification("Erreur lors de l'actualisation du tableau.", 'error');
    } finally {
      setIsBoardRefreshing(false);
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

  // Calculate unread items for notifications
  const getLastPriceChangeDate = (item: any) => {
    if (!item.history || item.history.length < 2) return null;
    for (let i = item.history.length - 1; i > 0; i--) {
      if (item.history[i].price !== item.history[i - 1].price) {
        return item.history[i].date;
      }
    }
    return null;
  };

  const getPriceDifference = (item: any) => {
    if (!item.history || item.history.length < 2) return 0;
    for (let i = item.history.length - 1; i > 0; i--) {
      if (item.history[i].price !== item.history[i - 1].price) {
        return item.history[i].price - item.history[i - 1].price;
      }
    }
    return 0;
  };

  // Refactored notification history logic
  const notificationHistory = items
    .filter(item => item.userId === user?.uid)
    .map(item => {
      const lastChangeDate = getLastPriceChangeDate(item);
      return { item, lastChangeDate };
    })
    .filter(entry => entry.lastChangeDate !== null)
    .sort((a, b) => new Date(b.lastChangeDate!).getTime() - new Date(a.lastChangeDate!).getTime())
    .slice(0, 10)
    .map(entry => entry.item);

  const getUnreadCount = () => {
    let count = 0;
    for (const item of notificationHistory) {
      const lastChangeDate = getLastPriceChangeDate(item);
      if (!lastChangeDate) continue;

      const changeDateMs = new Date(lastChangeDate).getTime();

      if (!userProfile?.lastNotificationReadAt) {
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          if (changeDateMs > sevenDaysAgo) count++;
      } else {
          const readAtMs = userProfile.lastNotificationReadAt.toMillis ? userProfile.lastNotificationReadAt.toMillis() : new Date(userProfile.lastNotificationReadAt).getTime();
          if (changeDateMs > readAtMs) count++;
      }
    }
    return count;
  };

  const unreadCount = getUnreadCount();

  // Filter and sort items based on selected board
  let displayedItems = items.filter(item => {
    let matchesBoard = true;
    if (selectedBoardId === 'favorites') matchesBoard = item.isFavorite;
    else if (selectedBoardId !== null) matchesBoard = item.boards?.includes(selectedBoardId);

    if (!matchesBoard) return false;

    if (item.isPrivate && item.userId === user?.uid && !showPrivateItems) {
       return false;
    }

    return true;
  });

  // Apply sorting
  if (sortBy === 'custom') {
    if (selectedBoardId && selectedBoardId !== 'favorites') {
      const boardDoc = boardsData.find(b => b.id === selectedBoardId);
      if (boardDoc && boardDoc.itemOrder) {
        displayedItems.sort((a, b) => {
          const indexA = boardDoc.itemOrder.indexOf(a.id);
          const indexB = boardDoc.itemOrder.indexOf(b.id);
          const posA = indexA === -1 ? Infinity : indexA;
          const posB = indexB === -1 ? Infinity : indexB;
          return posA - posB;
        });
      }
    } else {
        // Fallback for custom sort in 'Tous les articles' or 'Coups de coeur'
        displayedItems.sort((a, b) => {
          if (a.isFavorite === b.isFavorite) {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
          }
          return a.isFavorite ? -1 : 1;
        });
    }
  } else if (sortBy === 'date_desc') {
    displayedItems.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return timeB - timeA;
    });
  } else if (sortBy === 'favorites_first') {
    displayedItems.sort((a, b) => {
      if (a.isFavorite === b.isFavorite) {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      }
      return a.isFavorite ? -1 : 1;
    });
  } else if (sortBy === 'last_change_desc') {
    displayedItems.sort((a, b) => {
      const dateA = getLastPriceChangeDate(a);
      const dateB = getLastPriceChangeDate(b);
      const timeA = dateA ? new Date(dateA).getTime() : 0;
      const timeB = dateB ? new Date(dateB).getTime() : 0;
      return timeB - timeA;
    });
  } else if (sortBy === 'price_asc') {
    displayedItems.sort((a, b) => (a.currentPrice || 0) - (b.currentPrice || 0));
  } else if (sortBy === 'price_desc') {
    displayedItems.sort((a, b) => (b.currentPrice || 0) - (a.currentPrice || 0));
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
    if (selectedBoardId === 'immo_search') return "Recherche Immo";
    if (selectedBoardId) {
      const board = boardsData.find(b => b.id === selectedBoardId);
      return board ? board.name : "Tableau inconnu";
    }
    return "Tous les articles";
  };

  const isSelectionActive = isSelectionModeActive && selectedItemIds.length > 0;

  const totalValue = isSelectionActive
    ? displayedItems
        .filter(item => selectedItemIds.includes(item.id))
        .reduce((sum, item) => sum + (item.currentPrice || 0), 0)
    : displayedItems.reduce((sum, item) => sum + (item.currentPrice || 0), 0);

  const formattedTotal = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(totalValue);

  const handleToggleSelectionMode = () => {
    setIsSelectionModeActive(!isSelectionModeActive);
  };

  const handleSelectAll = () => {
    setSelectedItemIds(displayedItems.map(item => item.id));
  };

  const handleClearSelection = () => {
    setSelectedItemIds([]);
  };

  const [frozenReadAtMs, setFrozenReadAtMs] = useState<number | null>(null);

  const handleBellClick = async () => {
    if (!isBellOpen) {
      // Opening the bell: freeze the current read timestamp to maintain styling
      if (userProfile?.lastNotificationReadAt) {
        setFrozenReadAtMs(
          userProfile.lastNotificationReadAt.toMillis
            ? userProfile.lastNotificationReadAt.toMillis()
            : new Date(userProfile.lastNotificationReadAt).getTime()
        );
      } else {
        setFrozenReadAtMs(Date.now() - 7 * 24 * 60 * 60 * 1000);
      }
      setIsBellOpen(true);

      // Update the timestamp in DB to clear the badge
      if (user && unreadCount > 0) {
        try {
          await setDoc(doc(db, 'users', user.uid), {
            lastNotificationReadAt: serverTimestamp()
          }, { merge: true });
        } catch (error) {
          console.error("Error updating read status", error);
        }
      }
    } else {
      // Closing the bell: unfreeze
      setIsBellOpen(false);
      setFrozenReadAtMs(null);
    }
  };

  const handleItemClick = (item: any) => {
    if (isSelectionModeActive) {
      setSelectedItemIds(prev =>
        prev.includes(item.id)
          ? prev.filter(id => id !== item.id)
          : [...prev, item.id]
      );
    } else {
      setSelectedItem(item);
    }
  };

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
        onEditBoardClick={(board) => {
          setSelectedBoardToEdit(board);
          setIsEditBoardModalOpen(true);
        }}
        onLogout={handleLogout}
        boards={boardsData}
        selectedBoardId={selectedBoardId}
        onSelectBoard={setSelectedBoardId}
        userEmail={user?.email}
      />

      <main className="flex-1 md:ml-64 p-4 sm:p-6 lg:p-8 pt-20 md:pt-8 pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto">
          {selectedBoardId === 'immo_search' ? (
             <ImmoSearch />
          ) : (
             <>
          <header className="mb-8">
            <div className="flex items-center gap-4 mb-2">
              <h2 className="text-3xl font-bold text-[#212529] tracking-tight">{getPageTitle()}</h2>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="inline-flex items-center px-4 py-2 bg-[#eef2f0] rounded-xl text-[#212529]">
                <span className="text-sm font-medium mr-2">
                  {isSelectionActive ? "Valeur sélectionnée :" : "Valeur cumulée :"}
                </span>
                <span className="text-lg font-bold">{formattedTotal}</span>
              </div>

              <div className="flex items-center gap-4">
                {/* Sort Menu */}
                <div className="relative">
                  <button
                    onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#6c757d] hover:text-[#212529] hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Trier
                    <ChevronDown size={16} />
                  </button>

                  {isSortMenuOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                      <div className="py-1">
                        <button
                          onClick={() => { setSortBy('custom'); setIsSortMenuOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortBy === 'custom' ? 'bg-[#eef2f0] font-medium text-[#212529]' : 'text-[#6c757d] hover:bg-gray-50'}`}
                        >
                          Ordre personnalisé
                        </button>
                        <button
                          onClick={() => { setSortBy('date_desc'); setIsSortMenuOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortBy === 'date_desc' ? 'bg-[#eef2f0] font-medium text-[#212529]' : 'text-[#6c757d] hover:bg-gray-50'}`}
                        >
                          Date d'ajout
                        </button>
                        <button
                          onClick={() => { setSortBy('favorites_first'); setIsSortMenuOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortBy === 'favorites_first' ? 'bg-[#eef2f0] font-medium text-[#212529]' : 'text-[#6c757d] hover:bg-gray-50'}`}
                        >
                          Coups de cœur en premier
                        </button>
                        <button
                          onClick={() => { setSortBy('last_change_desc'); setIsSortMenuOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortBy === 'last_change_desc' ? 'bg-[#eef2f0] font-medium text-[#212529]' : 'text-[#6c757d] hover:bg-gray-50'}`}
                        >
                          Dernier changement de prix
                        </button>
                        <button
                          onClick={() => { setSortBy('price_asc'); setIsSortMenuOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortBy === 'price_asc' ? 'bg-[#eef2f0] font-medium text-[#212529]' : 'text-[#6c757d] hover:bg-gray-50'}`}
                        >
                          Prix croissant
                        </button>
                        <button
                          onClick={() => { setSortBy('price_desc'); setIsSortMenuOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-sm ${sortBy === 'price_desc' ? 'bg-[#eef2f0] font-medium text-[#212529]' : 'text-[#6c757d] hover:bg-gray-50'}`}
                        >
                          Prix décroissant
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bell Icon */}
                <div className="relative">
                  <button
                    onClick={handleBellClick}
                    className="p-2 rounded-full text-[#6c757d] hover:bg-gray-100 transition-colors relative"
                    title="Notifications de prix"
                  >
                    <Bell size={20} />
                    {unreadCount > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-[#f8f9fa]">
                        {unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Bell Popover */}
                  {isBellOpen && (
                    <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                      <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                        <span className="font-semibold text-sm text-[#212529]">Historique des prix</span>
                        <span className="text-xs text-[#6c757d]">10 derniers</span>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-2">
                        {notificationHistory.length === 0 ? (
                          <div className="text-center py-6 text-sm text-[#6c757d]">
                            Aucun historique disponible.
                          </div>
                        ) : (
                          notificationHistory.map((item) => {
                            const diff = getPriceDifference(item);
                            const isDrop = diff < 0;
                            const lastChangeDate = getLastPriceChangeDate(item);
                            const changeDateMs = lastChangeDate ? new Date(lastChangeDate).getTime() : 0;
                            const isUnread = frozenReadAtMs !== null && changeDateMs > frozenReadAtMs;

                            return (
                              <div
                                key={item.id}
                                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors mb-1
                                  ${isUnread
                                    ? 'bg-yellow-50 hover:bg-yellow-100 ring-1 ring-yellow-400 shadow-sm'
                                    : 'hover:bg-gray-50 opacity-75 grayscale-[0.3]'
                                  }
                                `}
                                onClick={() => { setIsBellOpen(false); setFrozenReadAtMs(null); setSelectedItem(item); }}
                              >
                                <img src={item.imageUrl} alt={item.name} className="w-12 h-12 object-contain rounded bg-white border border-gray-200" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-[#212529] truncate">{item.name}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-sm font-bold ${isUnread ? 'text-[#212529]' : 'text-[#495057]'}`}>{item.currentPrice}€</span>
                                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isDrop ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} ${!isUnread && 'opacity-80'}`}>
                                      {isDrop ? '' : '+'}{diff.toFixed(2)}€
                                    </span>
                                  </div>
                                </div>
                                {isUnread && (
                                  <div className="w-2 h-2 rounded-full bg-yellow-500 shrink-0 self-start mt-2"></div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

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

                <button
                  onClick={handleToggleSelectionMode}
                  className={`p-2 rounded-full transition-colors flex items-center justify-center ${
                    isSelectionModeActive ? 'bg-[#a8d5ba] text-white shadow-md' : 'text-[#6c757d] hover:bg-gray-100'
                  }`}
                  title="Mode sélection"
                >
                  <ListChecks size={20} />
                </button>
              </div>
            </div>

            {isSelectionModeActive && (
              <div className="flex items-center gap-4 mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <button
                  onClick={handleSelectAll}
                  className="text-sm font-medium text-[#212529] bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                  Tout sélectionner
                </button>
                <button
                  onClick={handleClearSelection}
                  className="text-sm font-medium text-[#6c757d] hover:text-[#212529] px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Tout désélectionner
                </button>
                <span className="text-sm text-[#6c757d] ml-auto">
                  {selectedItemIds.length} article(s) sélectionné(s)
                </span>
              </div>
            )}

            {!isSelectionModeActive && (
               <p className="text-[#6c757d] mt-4">Suivez l'évolution des prix de vos articles favoris.</p>
            )}
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
                    isSelected={isSelectionModeActive && selectedItemIds.includes(item.id)}
                    isSelectionModeActive={isSelectionModeActive}
                    onClick={() => handleItemClick(item)}
                  />
                ))
              )}
            </Masonry>
          </SortableContext>
             </>
          )}
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
        onEditPriceHistory={() => setIsEditPriceModalOpen(true)}
        isRefreshing={isRefreshing}
        notification={notification}
      />

      <EditPriceHistoryModal
        isOpen={isEditPriceModalOpen}
        onClose={() => setIsEditPriceModalOpen(false)}
        onSubmit={handleEditItem}
        item={selectedItem}
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

      <EditBoardModal
        isOpen={isEditBoardModalOpen}
        onClose={() => setIsEditBoardModalOpen(false)}
        onSubmit={handleEditBoard}
        onDelete={handleDeleteBoard}
        onRefresh={handleRefreshBoardPrice}
        board={selectedBoardToEdit}
        isRefreshing={isBoardRefreshing}
        boardItems={selectedBoardToEdit ? (
          selectedBoardToEdit.id === 'all' ? items :
          selectedBoardToEdit.id === 'favorites' ? items.filter(item => item.isFavorite) :
          items.filter(item => item.boards?.includes(selectedBoardToEdit.id))
        ) : []}
      />

      {isSettingsModalOpen && (
        <SettingsModal onClose={() => setIsSettingsModalOpen(false)} />
      )}
    </div>
    </DndContext>
  );
}
