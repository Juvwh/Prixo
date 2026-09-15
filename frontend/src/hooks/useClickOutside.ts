import { useEffect, useRef } from 'react';

/**
 * Ferme un panneau flottant (menu de tri, cloche) au clic à l'extérieur ou sur
 * Échap. Sans cela, les deux menus du tableau de bord restaient ouverts tant
 * qu'on ne recliquait pas exactement sur leur bouton.
 *
 * Retourne la ref à poser sur le conteneur qui englobe le bouton et le panneau.
 */
export function useClickOutside<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void
) {
  const ref = useRef<T | null>(null);

  // `onClose` est recréé à chaque rendu par l'appelant : le garder hors des
  // dépendances évite de réinscrire les écouteurs à chaque instantané Firestore.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) onCloseRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return ref;
}
