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
import {
  ListChecks, Bell, ChevronDown, Combine, Search, X, Check,
  TrendingDown, PackagePlus, Inbox, ArrowDownUp, Eye, EyeOff,
} from 'lucide-react';
import { Toast, ToastMessage } from '../components/Toast';
import { useClickOutside } from '../hooks/useClickOutside';
import { cn } from '../utils/cn';
import {
  getVariants,
  getActiveVariant,
  getLowestPoint,
  formatPrice,
  FALLBACK_IMAGE,
  draftsToVariants,
  mirrorOfVariant,
  newVariantId,
} from '../utils/variants';

type SortKey =
  | 'custom'
  | 'date_desc'
  | 'favorites_first'
  | 'last_change_desc'
  | 'price_asc'
  | 'price_desc';

/** Les tris proposés, dans l'ordre du menu. Une seule source pour le menu et
 *  pour le libellé rappelé sur le bouton. */
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'custom', label: 'Ordre personnalisé' },
  { key: 'date_desc', label: "Date d'ajout" },
  { key: 'favorites_first', label: 'Coups de cœur en premier' },
  { key: 'last_change_desc', label: 'Dernier changement de prix' },
  { key: 'price_asc', label: 'Prix croissant' },
  { key: 'price_desc', label: 'Prix décroissant' },
];

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
  const [sortBy, setSortBy] = useState<SortKey>('custom');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Tant que le premier instantané Firestore n'est pas arrivé, une grille vide
  // et « aucun article » sont indiscernables : on affiche des squelettes.
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  const sortMenuRef = useClickOutside<HTMLDivElement>(isSortMenuOpen, () => setIsSortMenuOpen(false));
  const bellRef = useClickOutside<HTMLDivElement>(isBellOpen, () => setIsBellOpen(false));

  // Couleur affichée par article. La sélection est propre à chaque utilisateur :
  // les règles Firestore réservent l'écriture d'un article à son créateur, et un
  // article partagé doit rester consultable dans la couleur de son choix par les
  // deux comptes.
  const [variantSelection, setVariantSelection] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('prixo.variantSelection') || '{}');
    } catch {
      return {};
    }
  });

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
      setIsLoadingItems(false);
    }, (error) => {
      console.error('Error loading items: ', error);
      setIsLoadingItems(false);
      showNotification("Impossible de charger les articles.", 'error');
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
      const fetchedBoards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      // Sort alphabetically by name
      fetchedBoards.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
      const { variants: drafts, ...rest } = data;
      const variants = draftsToVariants(drafts || []);
      const active = variants[0];

      const docRef = await addDoc(collection(db, 'items'), {
        ...rest,
        variants,
        activeVariantId: active?.id || '',
        // Miroir de la variante active : conserve le tri par prix, le budget
        // cumulé et la cloche qui lisent les champs de premier niveau.
        ...(active ? mirrorOfVariant(active) : {}),
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

  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const notificationTimer = React.useRef<number | undefined>(undefined);

  const showNotification = (message: string, type: ToastMessage['type'] = 'info') => {
    setNotification({ message, type });
    // Un message chassant l'autre, le minuteur précédent doit être annulé :
    // sinon le second bandeau disparaissait au bout du reliquat du premier.
    window.clearTimeout(notificationTimer.current);
    notificationTimer.current = window.setTimeout(() => setNotification(null), 4500);
  };

  useEffect(() => () => window.clearTimeout(notificationTimer.current), []);

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

  /**
   * Un article non privé est partagé par le foyer : les deux comptes peuvent
   * l'écrire. Un article privé reste réservé à son créateur. Ce test doit
   * rester le miroir exact de firestore.rules, sous peine de laisser partir des
   * écritures que le serveur refusera.
   */
  const canWriteItem = (item: any) =>
    !!item && (!item.isPrivate || item.userId === user?.uid);

  const handleEditItem = async (id: string, data: any) => {
    try {
      const found = items.find(i => i.id === id);
      const item = found ? withSelectedVariant(found) : found;
      let payload: any = data;

      if (Array.isArray(data.variants)) {
        // Édition depuis le formulaire : on recolle prix et historiques connus.
        const { variants: drafts, ...rest } = data;
        const variants = draftsToVariants(drafts, getVariants(item));
        const active = variants.find(v => v.id === item?.activeVariantId) || variants[0];

        payload = {
          ...rest,
          variants,
          activeVariantId: active?.id || '',
          ...(active ? mirrorOfVariant(active) : {}),
        };
      } else if (item && Array.isArray(item.variants) && item.variants.length > 0
                 && (data.history !== undefined || data.currentPrice !== undefined)) {
        // Correction manuelle de l'historique : elle porte sur la couleur affichée.
        const active = getActiveVariant(item);
        const variants = getVariants(item).map(v =>
          v.id === active?.id ? { ...v, ...data } : v
        );
        const updated = variants.find(v => v.id === active?.id) || variants[0];

        payload = { variants, ...mirrorOfVariant(updated) };
      }

      await updateDoc(doc(db, 'items', id), payload);

      // Update selectedItem state to reflect changes in ItemDetailModal if it's open
      setSelectedItem((prev: any) => prev && prev.id === id ? { ...prev, ...payload } : prev);
    } catch (error: any) {
      console.error("Error updating document: ", error);
      // Un message générique rendait ces échecs indébogables : on distingue le
      // refus de Firestore du reste, et on montre le code d'erreur sinon.
      if (error?.code === 'permission-denied') {
        showNotification(
          "Modification refusée : cet article est privé et appartient à l'autre compte.",
          'error'
        );
      } else {
        showNotification(
          `Erreur lors de la mise à jour de l'article${error?.code ? ` (${error.code})` : ''}.`,
          'error'
        );
      }
    }
  };

  /** Bascule la couleur affichée pour un article. */
  const handleSelectVariant = async (itemId: string, variantId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const variant = getVariants(item).find(v => v.id === variantId);
    if (!variant) return;

    // Le changement est immédiat et purement local : aucun aller-retour réseau.
    setVariantSelection(prev => {
      const next = { ...prev, [itemId]: variantId };
      try {
        localStorage.setItem('prixo.variantSelection', JSON.stringify(next));
      } catch {
        // Stockage indisponible (navigation privée) : la sélection vaut pour la session.
      }
      return next;
    });

    // Quand l'article est modifiable, on aligne aussi les champs de premier
    // niveau : ce sont eux qui alimentent le tri par prix, le budget et le mail
    // du matin.
    if (!canWriteItem(item)) return;

    try {
      await updateDoc(doc(db, 'items', itemId), {
        activeVariantId: variantId,
        ...mirrorOfVariant(variant),
      });
    } catch (error) {
      console.error("Error switching variant: ", error);
    }
  };

  /** L'article vu dans la couleur choisie par cet utilisateur. */
  const withSelectedVariant = (item: any) =>
    variantSelection[item.id] && variantSelection[item.id] !== item.activeVariantId
      ? { ...item, activeVariantId: variantSelection[item.id] }
      : item;

  /**
   * Regroupe plusieurs articles en un seul : chaque article sélectionné devient
   * une couleur du premier d'entre eux, puis les doublons sont supprimés.
   */
  const handleMergeSelectedItems = async () => {
    const selected = items.filter(i => selectedItemIds.includes(i.id));
    if (selected.length < 2) return;

    const notWritable = selected.filter(i => !canWriteItem(i));
    if (notWritable.length > 0) {
      showNotification("Un article privé de l'autre compte ne peut pas être regroupé.", 'error');
      return;
    }

    const names = selected.map(i => i.name).join('\n• ');
    if (!window.confirm(
      `Regrouper ces ${selected.length} articles en un seul, avec une couleur par article ?\n\n• ${names}\n\n` +
      `Le nom et la marque du premier article seront conservés.`
    )) return;

    // Le premier article sélectionné (dans l'ordre affiché) devient le porteur.
    const ordered = displayedItems.filter(i => selectedItemIds.includes(i.id));
    const target = ordered[0] || selected[0];
    const others = ordered.slice(1);

    // Chaque article apporte ses variantes ; celles sans nom de couleur héritent
    // du nom de l'article pour rester identifiables dans le sélecteur.
    const mergedVariants = ordered.flatMap(item =>
      getVariants(item).map(v => ({
        ...v,
        id: newVariantId(),
        color: v.color || item.name,
      }))
    );

    const active = mergedVariants[0];

    try {
      await updateDoc(doc(db, 'items', target.id), {
        variants: mergedVariants,
        activeVariantId: active.id,
        ...mirrorOfVariant(active),
        boards: Array.from(new Set(ordered.flatMap(i => i.boards || []))),
        isFavorite: ordered.some(i => i.isFavorite),
      });

      for (const item of others) {
        await deleteDoc(doc(db, 'items', item.id));
      }

      setSelectedItemIds([]);
      setIsSelectionModeActive(false);
      showNotification(`${ordered.length} articles regroupés en ${mergedVariants.length} couleurs.`, 'success');
    } catch (error) {
      console.error("Error merging items: ", error);
      showNotification("Erreur lors du regroupement des articles.", 'error');
    }
  };

  // Calculate unread items for notifications
  // Dernier changement de prix belge dans un historique donné.
  // Les prix français sont volontairement ignorés ici : ils servent à comparer,
  // pas à notifier.
  const findLastChange = (history: any[]) => {
    if (!history || history.length < 2) return null;
    for (let i = history.length - 1; i > 0; i--) {
      if (history[i].price !== history[i - 1].price) {
        return {
          date: history[i].date,
          price: history[i].price,
          diff: history[i].price - history[i - 1].price,
        };
      }
    }
    return null;
  };

  /**
   * Changement le plus récent de l'article, toutes couleurs confondues : une
   * baisse sur une couleur non affichée doit remonter dans la cloche.
   */
  const getLastPriceChange = (item: any) => {
    let best: { date: string; price: number; diff: number; color: string } | null = null;

    for (const variant of getVariants(item)) {
      const change = findLastChange(variant.history);
      if (!change) continue;
      if (!best || new Date(change.date).getTime() > new Date(best.date).getTime()) {
        best = { ...change, color: variant.color };
      }
    }
    return best;
  };

  const getLastPriceChangeDate = (item: any) => getLastPriceChange(item)?.date ?? null;

  const getPriceDifference = (item: any) => getLastPriceChange(item)?.diff ?? 0;

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

  // La recherche porte sur le nom, la marque et les noms de couleurs : c'est
  // ainsi qu'on retrouve un article dans un tableau qui en compte cinquante.
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const matchesSearch = (item: any) => {
    if (!normalizedQuery) return true;
    const haystack = [
      item.name,
      item.brand,
      ...getVariants(item).map(v => v.color),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  };

  // Filter and sort items based on selected board
  let displayedItems = items.filter(item => {
    let matchesBoard = true;
    if (selectedBoardId === 'favorites') matchesBoard = item.isFavorite;
    else if (selectedBoardId !== null) matchesBoard = item.boards?.includes(selectedBoardId);

    if (!matchesBoard) return false;

    if (item.isPrivate && item.userId === user?.uid && !showPrivateItems) {
       return false;
    }

    return matchesSearch(item);
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

  const currentSortLabel =
    SORT_OPTIONS.find(option => option.key === sortBy)?.label ?? 'Trier';

  const isSelectionActive = isSelectionModeActive && selectedItemIds.length > 0;

  const totalValue = isSelectionActive
    ? displayedItems
        .filter(item => selectedItemIds.includes(item.id))
        .reduce((sum, item) => sum + (item.currentPrice || 0), 0)
    : displayedItems.reduce((sum, item) => sum + (item.currentPrice || 0), 0);

  const formattedTotal = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(totalValue);

  // Deux repères lus d'un coup d'œil au-dessus de la grille :
  //  - combien d'articles ont baissé lors de leur dernier relevé ;
  //  - ce que coûterait aujourd'hui le tableau si chaque article retrouvait son
  //    prix plancher — c'est la marge de négociation qu'il reste à attendre.
  const droppedCount = displayedItems.filter(item => getPriceDifference(item) < 0).length;

  const gapToLowest = displayedItems.reduce((sum, item) => {
    const shown = withSelectedVariant(item);
    const variant = getActiveVariant(shown);
    const lowest = getLowestPoint(variant?.history || shown.history);
    const current = variant ? variant.currentPrice : shown.currentPrice;
    if (!lowest || typeof current !== 'number' || current <= 0) return sum;
    return sum + Math.max(0, current - lowest.price);
  }, 0);

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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
              <h2 className="text-2xl sm:text-3xl font-bold text-[#212529] tracking-tight">{getPageTitle()}</h2>
              {!isLoadingItems && (
                <span className="text-sm font-medium text-[#6c757d] bg-white border border-[#dee2e6] px-2.5 py-1 rounded-full">
                  {displayedItems.length} article{displayedItems.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Bandeau de repères : valeur cumulée, baisses récentes, écart au plus bas. */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
              <div className="col-span-2 lg:col-span-1 flex flex-col justify-center px-4 py-3 bg-[#eef2f0] rounded-2xl">
                <span className="text-xs font-medium text-[#4a7c59] uppercase tracking-wider">
                  {isSelectionActive ? 'Valeur sélectionnée' : 'Valeur cumulée'}
                </span>
                <span className="text-2xl font-bold text-[#212529] tabular-nums mt-0.5">{formattedTotal}</span>
              </div>

              <div className="flex flex-col justify-center px-4 py-3 bg-white border border-[#dee2e6] rounded-2xl">
                <span className="text-xs font-medium text-[#6c757d] uppercase tracking-wider">Baisses récentes</span>
                <span className="flex items-center gap-1.5 text-2xl font-bold text-[#212529] tabular-nums mt-0.5">
                  {droppedCount > 0 && <TrendingDown className="w-5 h-5 text-[#4a7c59]" />}
                  {droppedCount}
                </span>
              </div>

              <div
                className="flex flex-col justify-center px-4 py-3 bg-white border border-[#dee2e6] rounded-2xl"
                title="Somme des écarts entre le prix actuel et le prix le plus bas jamais relevé"
              >
                <span className="text-xs font-medium text-[#6c757d] uppercase tracking-wider">Écart au plus bas</span>
                <span className="text-2xl font-bold text-[#212529] tabular-nums mt-0.5">{formatPrice(gapToLowest)}</span>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              {/* Recherche */}
              <div className="relative flex-1 lg:max-w-xs">
                <Search className="w-4 h-4 text-[#6c757d] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un article, une marque..."
                  aria-label="Rechercher un article"
                  className="w-full pl-10 pr-9 py-2.5 text-sm rounded-xl border border-[#dee2e6] bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    aria-label="Effacer la recherche"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#adb5bd] hover:text-[#212529] rounded-md transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 lg:ml-auto">
                {/* Sort Menu */}
                <div className="relative" ref={sortMenuRef}>
                  <button
                    onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                    aria-haspopup="menu"
                    aria-expanded={isSortMenuOpen}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors',
                      isSortMenuOpen
                        ? 'bg-[#eef2f0] border-[#a8d5ba] text-[#212529]'
                        : 'bg-white border-[#dee2e6] text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa]'
                    )}
                  >
                    <ArrowDownUp size={16} className="shrink-0" />
                    <span className="hidden sm:inline max-w-[11rem] truncate">{currentSortLabel}</span>
                    <ChevronDown size={16} className={cn('shrink-0 transition-transform', isSortMenuOpen && 'rotate-180')} />
                  </button>

                  {isSortMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 w-60 bg-white border border-[#dee2e6] rounded-2xl shadow-[0_18px_40px_-12px_rgb(33_37_41/0.22)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-2"
                    >
                      <div className="py-1.5">
                        {SORT_OPTIONS.map(option => (
                          <button
                            key={option.key}
                            role="menuitemradio"
                            aria-checked={sortBy === option.key}
                            onClick={() => { setSortBy(option.key); setIsSortMenuOpen(false); }}
                            className={cn(
                              'w-full flex items-center justify-between gap-2 text-left px-4 py-2.5 text-sm transition-colors',
                              sortBy === option.key
                                ? 'bg-[#eef2f0] font-semibold text-[#212529]'
                                : 'text-[#6c757d] hover:bg-[#f8f9fa] hover:text-[#212529]'
                            )}
                          >
                            {option.label}
                            {sortBy === option.key && <Check size={16} className="text-[#4a7c59] shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bell Icon */}
                <div className="relative" ref={bellRef}>
                  <button
                    onClick={handleBellClick}
                    className={cn(
                      'p-2.5 rounded-xl border transition-colors relative',
                      isBellOpen
                        ? 'bg-[#eef2f0] border-[#a8d5ba] text-[#212529]'
                        : 'bg-white border-[#dee2e6] text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa]'
                    )}
                    aria-label={`Notifications de prix${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
                    title="Notifications de prix"
                  >
                    <Bell size={20} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-5 px-1 bg-[#4a7c59] text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-[#f8f9fa]">
                        {unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Bell Popover */}
                  {isBellOpen && (
                    <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] bg-white border border-[#dee2e6] rounded-2xl shadow-[0_18px_40px_-12px_rgb(33_37_41/0.22)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                      <div className="p-3 border-b border-[#f1f3f5] bg-[#fafafa] flex justify-between items-center">
                        <span className="font-semibold text-sm text-[#212529]">Historique des prix</span>
                        <span className="text-xs text-[#6c757d]">10 derniers</span>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-2">
                        {notificationHistory.length === 0 ? (
                          <div className="text-center py-8 px-4">
                            <Bell className="w-8 h-8 text-[#dee2e6] mx-auto mb-2" />
                            <p className="text-sm text-[#6c757d]">Aucun changement de prix pour l'instant.</p>
                          </div>
                        ) : (
                          notificationHistory.map((item) => {
                            const change = getLastPriceChange(item);
                            const diff = change?.diff ?? 0;
                            const isDrop = diff < 0;
                            const lastChangeDate = change?.date ?? null;
                            const changeDateMs = lastChangeDate ? new Date(lastChangeDate).getTime() : 0;
                            const isUnread = frozenReadAtMs !== null && changeDateMs > frozenReadAtMs;

                            return (
                              <button
                                key={item.id}
                                type="button"
                                className={cn(
                                  'w-full text-left flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors mb-1',
                                  isUnread
                                    ? 'bg-[#eef2f0] hover:bg-[#e3ebe6] ring-1 ring-[#a8d5ba]'
                                    : 'hover:bg-[#f8f9fa]'
                                )}
                                onClick={() => { setIsBellOpen(false); setFrozenReadAtMs(null); setSelectedItem(item); }}
                              >
                                <img
                                  src={item.imageUrl || FALLBACK_IMAGE}
                                  alt=""
                                  loading="lazy"
                                  className="w-12 h-12 object-contain rounded-lg bg-white border border-[#dee2e6] shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  {item.brand && (
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#6c757d] truncate">{item.brand}</p>
                                  )}
                                  <p className="text-sm font-medium text-[#212529] truncate">
                                    {item.name}
                                    {change?.color && <span className="text-[#6c757d] font-normal"> — {change.color}</span>}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-sm font-bold text-[#212529] tabular-nums">
                                      {formatPrice(change?.price ?? item.currentPrice)}
                                    </span>
                                    <span className={cn(
                                      'text-xs font-semibold px-1.5 py-0.5 rounded-md tabular-nums',
                                      isDrop ? 'bg-[#eef2f0] text-[#4a7c59]' : 'bg-red-50 text-red-600'
                                    )}>
                                      {isDrop ? '' : '+'}{diff.toFixed(2)}€
                                    </span>
                                  </div>
                                </div>
                                {isUnread && (
                                  <span className="w-2 h-2 rounded-full bg-[#4a7c59] shrink-0 self-start mt-2" />
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Articles privés */}
                <button
                  onClick={() => setShowPrivateItems(!showPrivateItems)}
                  aria-pressed={showPrivateItems}
                  title={showPrivateItems ? 'Masquer mes articles privés' : 'Afficher mes articles privés'}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors',
                    showPrivateItems
                      ? 'bg-[#eef2f0] border-[#a8d5ba] text-[#212529]'
                      : 'bg-white border-[#dee2e6] text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa]'
                  )}
                >
                  {showPrivateItems ? <Eye size={20} /> : <EyeOff size={20} />}
                  <span className="hidden xl:inline">Articles privés</span>
                </button>

                <button
                  onClick={handleToggleSelectionMode}
                  aria-pressed={isSelectionModeActive}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors',
                    isSelectionModeActive
                      ? 'bg-[#212529] border-[#212529] text-white'
                      : 'bg-white border-[#dee2e6] text-[#6c757d] hover:text-[#212529] hover:bg-[#f8f9fa]'
                  )}
                  title="Mode sélection"
                >
                  <ListChecks size={20} />
                  <span className="hidden xl:inline">Sélection</span>
                </button>
              </div>
            </div>

            {isSelectionModeActive && (
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4 p-3 bg-white border border-[#dee2e6] rounded-2xl animate-in fade-in slide-in-from-top-2">
                <button
                  onClick={handleSelectAll}
                  className="text-sm font-medium text-[#212529] bg-[#f8f9fa] border border-[#dee2e6] px-3 py-1.5 rounded-lg hover:bg-[#eef2f0] transition-colors"
                >
                  Tout sélectionner
                </button>
                <button
                  onClick={handleClearSelection}
                  className="text-sm font-medium text-[#6c757d] hover:text-[#212529] px-3 py-1.5 rounded-lg hover:bg-[#f8f9fa] transition-colors"
                >
                  Tout désélectionner
                </button>
                <button
                  onClick={handleMergeSelectedItems}
                  disabled={selectedItemIds.length < 2}
                  title="Regrouper les articles sélectionnés en un seul, une couleur par article"
                  className="flex items-center gap-2 text-sm font-medium text-[#212529] bg-[#f8f9fa] border border-[#dee2e6] px-3 py-1.5 rounded-lg hover:bg-[#eef2f0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Combine size={16} />
                  Regrouper les couleurs
                </button>
                <span className="text-sm text-[#6c757d] w-full sm:w-auto sm:ml-auto">
                  {selectedItemIds.length} article{selectedItemIds.length > 1 ? 's' : ''} sélectionné{selectedItemIds.length > 1 ? 's' : ''}
                </span>
              </div>
            )}

            {!isSelectionModeActive && (
               <p className="text-[#6c757d] text-sm mt-4">
                 Suivez l'évolution des prix de vos articles favoris.
                 <span className="hidden md:inline"> Glissez une carte sur un tableau de la barre latérale pour l'y ranger.</span>
               </p>
            )}
          </header>

          {isLoadingItems ? (
            <ItemsSkeleton breakpointCols={breakpointColumnsObj} />
          ) : displayedItems.length === 0 ? (
            /* L'état vide était rendu *dans* la grille Masonry, qui est un
               conteneur flex de colonnes : le message atterrissait dans une
               colonne étroite, décalé sur la gauche. Il vit désormais en dehors
               de la grille, centré, et propose l'action attendue. */
            <EmptyState
              hasQuery={!!normalizedQuery}
              onClearQuery={() => setSearchQuery('')}
              onAdd={() => setIsAddModalOpen(true)}
            />
          ) : (
            <SortableContext
               items={displayedItems.map(i => i.id)}
               strategy={verticalListSortingStrategy}
            >
              <Masonry
                breakpointCols={breakpointColumnsObj}
                className="flex w-auto -ml-6"
                columnClassName="pl-6 bg-clip-padding"
              >
                {displayedItems.map(item => (
                  <ItemCard
                    key={item.id}
                    {...withSelectedVariant(item)}
                    isSelected={isSelectionModeActive && selectedItemIds.includes(item.id)}
                    isSelectionModeActive={isSelectionModeActive}
                    onClick={() => handleItemClick(item)}
                    onSelectVariant={handleSelectVariant}
                  />
                ))}
              </Masonry>
            </SortableContext>
          )}
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
           ...(selectedItem ? withSelectedVariant(selectedItem) : selectedItem),
           // Pour l'affichage dans le modal : remplacer les IDs par les noms des tableaux
           boards: selectedItem?.boards?.map((id: string) => boardsData.find(b => b.id === id)?.name).filter(Boolean)
        }}
        onRefresh={handleRefreshItem}
        onDelete={handleDeleteItem}
        onEdit={() => setIsEditModalOpen(true)}
        onEditPriceHistory={() => setIsEditPriceModalOpen(true)}
        onSelectVariant={handleSelectVariant}
        isRefreshing={isRefreshing}
      />

      <EditPriceHistoryModal
        isOpen={isEditPriceModalOpen}
        onClose={() => setIsEditPriceModalOpen(false)}
        onSubmit={handleEditItem}
        item={selectedItem ? withSelectedVariant(selectedItem) : selectedItem}
      />

      <EditItemModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={handleEditItem}
        item={selectedItem ? withSelectedVariant(selectedItem) : selectedItem}
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

      <Toast toast={notification} onDismiss={() => setNotification(null)} />
    </div>
    </DndContext>
  );
}

/**
 * Grille de squelettes affichée le temps du premier instantané Firestore.
 * Elle reprend la trame de la grille réelle pour éviter le saut de mise en page.
 */
function ItemsSkeleton({ breakpointCols }: { breakpointCols: Record<string, number> }) {
  const heights = ['h-64', 'h-80', 'h-72', 'h-96', 'h-72', 'h-64', 'h-80', 'h-72'];

  return (
    <Masonry
      breakpointCols={breakpointCols}
      className="flex w-auto -ml-6"
      columnClassName="pl-6 bg-clip-padding"
    >
      {heights.map((height, index) => (
        <div
          key={index}
          className={cn(
            'skeleton rounded-3xl mb-6 border border-[#dee2e6]',
            height
          )}
          aria-hidden="true"
        />
      ))}
    </Masonry>
  );
}

interface EmptyStateProps {
  hasQuery: boolean;
  onClearQuery: () => void;
  onAdd: () => void;
}

/** Ce qui s'affiche quand la grille ne contient rien : la raison, puis l'issue. */
function EmptyState({ hasQuery, onClearQuery, onAdd }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center py-16 sm:py-24 px-6 bg-white border border-dashed border-[#dee2e6] rounded-3xl animate-in fade-in zoom-in-98">
      <div className="w-16 h-16 rounded-2xl bg-[#eef2f0] flex items-center justify-center mb-5">
        {hasQuery ? (
          <Search className="w-7 h-7 text-[#4a7c59]" />
        ) : (
          <Inbox className="w-7 h-7 text-[#4a7c59]" />
        )}
      </div>

      <h3 className="text-lg font-semibold text-[#212529]">
        {hasQuery ? 'Aucun article ne correspond' : 'Ce tableau est encore vide'}
      </h3>
      <p className="text-sm text-[#6c757d] mt-2 max-w-sm">
        {hasQuery
          ? 'Essayez un autre mot-clé, ou vérifiez que le tableau sélectionné est bien le bon.'
          : "Ajoutez un premier article pour suivre son prix jour après jour et être prévenu dès qu'il baisse."}
      </p>

      {hasQuery ? (
        <button
          onClick={onClearQuery}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#dee2e6] text-[#212529] text-sm font-medium rounded-xl hover:bg-[#f8f9fa] transition-colors"
        >
          <X className="w-4 h-4" />
          Effacer la recherche
        </button>
      ) : (
        <button
          onClick={onAdd}
          className="mt-6 inline-flex items-center gap-2 px-5 py-3 bg-[#212529] text-white text-sm font-medium rounded-xl hover:bg-black transition-colors"
        >
          <PackagePlus className="w-4 h-4" />
          Ajouter un article
        </button>
      )}
    </div>
  );
}
