import React from 'react';
import { Home, PlusSquare, LogOut, Settings } from 'lucide-react';
import { cn } from '../utils/cn';

interface SidebarProps {
  onAddClick: () => void;
  onLogout: () => void;
  className?: string;
}

export function Sidebar({ onAddClick, onLogout, className }: SidebarProps) {
  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={cn("hidden md:flex flex-col w-64 h-screen bg-white border-r border-[#dee2e6] fixed left-0 top-0", className)}>
        <div className="p-6">
          <h1 className="text-2xl font-bold text-[#212529] tracking-tight">Prixo</h1>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <button className="flex items-center w-full px-4 py-3 text-sm font-medium text-[#212529] bg-[#f8f9fa] rounded-xl">
            <Home className="w-5 h-5 mr-3" />
            Accueil
          </button>

          <button
            onClick={onAddClick}
            className="flex items-center w-full px-4 py-3 text-sm font-medium text-white bg-[#212529] rounded-xl hover:bg-black transition-colors"
          >
            <PlusSquare className="w-5 h-5 mr-3" />
            Ajouter un article
          </button>
        </nav>

        <div className="p-4 border-t border-[#dee2e6]">
          <button
            onClick={onLogout}
            className="flex items-center w-full px-4 py-2 text-sm font-medium text-[#6c757d] hover:text-[#212529] transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t border-[#dee2e6] flex justify-around p-3 z-50">
        <button className="flex flex-col items-center p-2 text-[#212529]">
          <Home className="w-6 h-6" />
          <span className="text-[10px] mt-1 font-medium">Accueil</span>
        </button>
        <button
          onClick={onAddClick}
          className="flex flex-col items-center p-2 text-white bg-[#212529] rounded-full -mt-6 shadow-lg border-4 border-[#f8f9fa]"
        >
          <PlusSquare className="w-6 h-6" />
        </button>
        <button
          onClick={onLogout}
          className="flex flex-col items-center p-2 text-[#6c757d]"
        >
          <LogOut className="w-6 h-6" />
          <span className="text-[10px] mt-1 font-medium">Quitter</span>
        </button>
      </nav>
    </>
  );
}
