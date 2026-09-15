import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';

/** Nombre de modales actuellement ouvertes : le verrou de défilement ne doit
 *  être levé que par la dernière à se fermer. */
let openModalCount = 0;

function lockBodyScroll() {
  openModalCount += 1;
  if (openModalCount > 1) return;

  // La disparition de la barre de défilement élargit la page : on compense sa
  // largeur pour que le contenu ne sursaute pas au moment de l'ouverture.
  const compensation = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.setProperty('--scrollbar-compensation', `${compensation}px`);
  document.body.setAttribute('data-scroll-locked', '');
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount > 0) return;

  document.body.removeAttribute('data-scroll-locked');
  document.body.style.removeProperty('--scrollbar-compensation');
}

/**
 * Comportements attendus de toute modale : la touche Échap ferme, et l'arrière-plan
 * cesse de défiler tant qu'elle est ouverte.
 *
 * Seule la modale la plus haute réagit à Échap : chacune vérifie qu'aucune autre
 * ne s'est ouverte après elle avant de se fermer.
 */
export function useModalBehavior(isOpen: boolean, onClose: () => void) {
  // `onClose` est presque toujours une fonction fléchée créée à chaque rendu du
  // parent. La faire figurer dans les dépendances relancerait l'effet à chaque
  // instantané Firestore : le verrou de défilement serait posé et levé en
  // boucle, et la page sursauterait. On garde la dernière version dans une ref.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    lockBodyScroll();
    const depthAtOpen = openModalCount;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (depthAtOpen !== openModalCount) return; // une modale est ouverte par-dessus
      event.stopPropagation();
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();
    };
  }, [isOpen]);
}

/**
 * Handler de clic sur le fond noir d'une modale : ne ferme que si le clic a
 * commencé sur ce fond, et pas au terme d'une sélection de texte partie de
 * l'intérieur du panneau.
 */
export function backdropClose(onClose: () => void) {
  return (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
}
