import React from 'react';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { useAuth } from './hooks/useAuth';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">Chargement...</div>;
  }

  return user ? (
    <Dashboard />
  ) : (
    <Login />
  );
}

export default App;
