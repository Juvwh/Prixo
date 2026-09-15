import React, { useState, useEffect } from 'react';
import { Home, PlusSquare, LogOut, Heart, Menu, Lock, Settings, Search, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { useDroppable } from '@dnd-kit/core';

export interface BoardData {
  id: string;
  name: string;
  isPrivate: boolean;
  ownerId?: string;
  isSpecial?: boolean; // Indique un tableau "Tous les articles" ou "Coups de cœur"
}

interface SidebarProps {
  onAddClick: () => void;
  onAddBoardClick: () => void;
  onEditBoardClick: (board: BoardData) => void;
  onLogout: () => void;
  className?: string;
  boards: BoardData[];
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string | null) => void;
  userEmail?: string | null;
}

export function Sidebar({ onAddClick, onAddBoardClick, onEditBoardClick, onLogout, className, boards, selectedBoardId, onSelectBoard, userEmail }: SidebarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Le tiroir mobile ne se fermait qu'au clic sur le voile, et le fond
  // continuait de défiler derrière lui.
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden fixed top-0 left-0 w-full bg-white border-b border-[#dee2e6] px-4 py-3 flex justify-between items-center z-40">
        <h1 className="text-xl font-bold text-[#212529] tracking-tight">Prixo</h1>
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 -mr-2 text-[#212529] rounded-lg hover:bg-[#eef2f0] transition-colors"
          aria-label="Ouvrir le menu"
          aria-expanded={isMobileMenuOpen}
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40 animate-in fade-in"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed md:flex flex-col w-3/4 max-w-sm md:w-64 h-screen bg-[#fafafa] md:bg-white border-r border-[#f0f0f0] left-0 top-0 z-50 transition-transform duration-300 ease-in-out",
        !isMobileMenuOpen && "-translate-x-full md:translate-x-0",
        className
      )}>
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#212529] tracking-tight">Prixo</h1>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden p-2 -mr-2 text-[#6c757d] hover:text-[#212529] hover:bg-[#eef2f0] rounded-lg transition-colors"
            aria-label="Fermer le menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          <div
            className={cn(
              "group flex items-center justify-between w-full px-4 py-3 text-sm font-medium rounded-xl transition-colors cursor-pointer",
              selectedBoardId === null
                ? "text-[#212529] bg-[#eef2f0]"
                : "text-[#6c757d] hover:bg-[#eef2f0]/50"
            )}
            onClick={() => { onSelectBoard(null); setIsMobileMenuOpen(false); }}
          >
            <div className="flex items-center">
              <Home className="w-5 h-5 mr-3" />
              Tous les articles
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditBoardClick({ id: 'all', name: 'Tous les articles', isPrivate: false, isSpecial: true });
              }}
              className="ml-2 p-1.5 text-[#adb5bd] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 hover:text-[#212529] transition-all rounded-md hover:bg-black/5 shrink-0"
              title="Options"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          <div
            className={cn(
              "group flex items-center justify-between w-full px-4 py-3 text-sm font-medium rounded-xl transition-colors cursor-pointer mt-2",
              selectedBoardId === 'immo_search'
                ? "text-[#212529] bg-[#eef2f0]"
                : "text-[#6c757d] hover:bg-[#eef2f0]/50"
            )}
            onClick={() => { onSelectBoard('immo_search'); setIsMobileMenuOpen(false); }}
          >
            <div className="flex items-center">
              <Search className="w-5 h-5 mr-3" />
              Recherche Immo
            </div>
          </div>

          <div
            className={cn(
              "group flex items-center justify-between w-full px-4 py-3 text-sm font-medium rounded-xl transition-colors cursor-pointer",
              selectedBoardId === 'favorites'
                ? "text-[#212529] bg-[#eef2f0]"
                : "text-[#6c757d] hover:bg-[#eef2f0]/50"
            )}
            onClick={() => { onSelectBoard('favorites'); setIsMobileMenuOpen(false); }}
          >
            <div className="flex items-center">
              <Heart className="w-5 h-5 mr-3" />
              Coups de cœur
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditBoardClick({ id: 'favorites', name: 'Coups de cœur', isPrivate: false, isSpecial: true });
              }}
              className="ml-2 p-1.5 text-[#adb5bd] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 hover:text-[#212529] transition-all rounded-md hover:bg-black/5 shrink-0"
              title="Options"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          <div className="pt-6 pb-2 flex items-center justify-between px-4">
            <p className="text-xs font-semibold text-[#adb5bd] uppercase tracking-wider">Tableaux Partagés</p>
            <button
              onClick={onAddBoardClick}
              className="text-[#6c757d] hover:text-[#212529] transition-colors p-1 -m-1 rounded-md"
              title="Créer un tableau"
              aria-label="Créer un tableau partagé"
            >
              <PlusSquare className="w-4 h-4" />
            </button>
          </div>

          {boards.filter(b => !b.isPrivate).length === 0 ? (
            <p className="px-4 text-xs text-[#adb5bd] italic">Aucun tableau partagé</p>
          ) : (
            boards.filter(b => !b.isPrivate).map((board) => (
              <DroppableBoard
                key={board.id}
                board={board}
                selectedBoardId={selectedBoardId}
                onClick={() => { onSelectBoard(board.id); setIsMobileMenuOpen(false); }}
                onEditClick={() => onEditBoardClick(board)}
              />
            ))
          )}

          <div className="pt-6 pb-2 flex items-center justify-between px-4">
            <p className="text-xs font-semibold text-[#adb5bd] uppercase tracking-wider flex items-center">
              Tableaux Privés <Lock className="w-3 h-3 ml-1" />
            </p>
            <button
              onClick={onAddBoardClick}
              className="text-[#6c757d] hover:text-[#212529] transition-colors p-1 -m-1 rounded-md"
              title="Créer un tableau"
              aria-label="Créer un tableau privé"
            >
              <PlusSquare className="w-4 h-4" />
            </button>
          </div>

          {boards.filter(b => b.isPrivate).length === 0 ? (
            <p className="px-4 text-xs text-[#adb5bd] italic">Aucun tableau privé</p>
          ) : (
            boards.filter(b => b.isPrivate).map((board) => (
              <DroppableBoard
                key={board.id}
                board={board}
                selectedBoardId={selectedBoardId}
                onClick={() => { onSelectBoard(board.id); setIsMobileMenuOpen(false); }}
                onEditClick={() => onEditBoardClick(board)}
              />
            ))
          )}

          <div className="pt-6">
            <button
              onClick={onAddClick}
              className="flex items-center w-full px-4 py-3 text-sm font-medium text-white bg-[#212529] rounded-xl hover:bg-black transition-colors"
            >
              <PlusSquare className="w-5 h-5 mr-3" />
              Ajouter un article
            </button>
          </div>
        </nav>

        <div className="p-4 border-t border-[#f0f0f0] bg-white">
          <div className="flex items-center mb-4 px-2">
            <div className="w-8 h-8 rounded-full bg-[#eef2f0] flex items-center justify-center text-[#212529] font-bold text-xs uppercase shrink-0">
               {userEmail ? userEmail.charAt(0) : 'U'}
            </div>
            <div className="ml-3 overflow-hidden">
               <p className="text-sm font-medium text-[#212529] truncate">{userEmail || 'Utilisateur'}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={onLogout}
              className="flex items-center flex-1 px-2 py-2 text-sm font-medium text-[#6c757d] hover:text-[#212529] transition-colors rounded-lg"
            >
              <LogOut className="w-5 h-5 mr-3" />
              Déconnexion
            </button>
            <button
              onClick={() => document.dispatchEvent(new CustomEvent('open-settings-modal'))}
              className="p-2 text-[#6c757d] hover:text-[#212529] hover:bg-[#eef2f0] rounded-lg transition-colors"
              title="Paramètres globaux"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Action (Floating Add Button) */}
      <div className="md:hidden fixed bottom-6 right-6 z-40">
        <button
          onClick={onAddClick}
          className="flex items-center justify-center w-14 h-14 text-white bg-[#212529] rounded-full shadow-lg hover:scale-105 transition-transform"
        >
          <PlusSquare className="w-6 h-6" />
        </button>
      </div>
    </>
  );
}

// Wrapper for Droppable board
function DroppableBoard({ board, selectedBoardId, onClick, onEditClick }: { board: BoardData, selectedBoardId: string | null, onClick: () => void, onEditClick: () => void }) {
  const { isOver, setNodeRef } = useDroppable({
    id: board.id,
    data: {
      type: 'board',
      board
    }
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center justify-between w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-colors cursor-pointer",
        selectedBoardId === board.id
          ? "text-[#212529] bg-[#eef2f0]"
          : "text-[#6c757d] hover:bg-[#eef2f0]/50",
        isOver && "ring-2 ring-[#a8d5ba] bg-[#eef2f0]" // Visual feedback when dragging over
      )}
      onClick={onClick}
    >
      <div className="flex items-center min-w-0 flex-1">
        <span className="truncate">{board.name}</span>
        {board.isPrivate && <Lock className="w-3.5 h-3.5 ml-2 shrink-0 opacity-50" />}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation(); // Prevent board selection when clicking settings
          onEditClick();
        }}
        className="ml-2 p-1.5 text-[#adb5bd] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 hover:text-[#212529] transition-all rounded-md hover:bg-black/5 shrink-0"
        title="Modifier le tableau"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}
