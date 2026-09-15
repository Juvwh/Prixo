import React from 'react';
import { TrendingDown } from 'lucide-react';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { useAuth } from './hooks/useAuth';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    // Un « Chargement... » nu sur fond gris donnait l'impression d'une page
    // cassée. L'écran d'attente porte désormais l'identité de l'application.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-canvas gap-4">
        <span className="inline-flex w-14 h-14 rounded-2xl bg-[#eef2f0] items-center justify-center animate-pulse-ring">
          <TrendingDown className="w-7 h-7 text-[#4a7c59]" />
        </span>
        <p className="text-2xl font-bold text-[#212529] tracking-tight">Prixo</p>
        <p className="text-sm text-[#6c757d]">Chargement de vos articles…</p>
      </div>
    );
  }

  return user ? (
    <Dashboard />
  ) : (
    <Login />
  );
}

export default App;
