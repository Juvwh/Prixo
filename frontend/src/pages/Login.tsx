import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { AlertCircle, Loader2, Eye, EyeOff, TrendingDown } from 'lucide-react';
import { auth } from '../firebase/config';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      // Un réseau coupé et un mot de passe erroné ne se corrigent pas de la
      // même façon : le message générique d'origine envoyait l'utilisateur
      // ressaisir un mot de passe pourtant juste.
      setError(
        err?.code === 'auth/network-request-failed'
          ? 'Connexion au serveur impossible. Vérifiez votre connexion internet.'
          : err?.code === 'auth/too-many-requests'
            ? 'Trop de tentatives. Réessayez dans quelques minutes.'
            : 'Identifiants incorrects.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_18px_40px_-12px_rgb(33_37_41/0.14)] overflow-hidden p-8 border border-[#dee2e6] animate-in fade-in slide-in-from-bottom-4">
        <div className="text-center mb-8">
          <span className="inline-flex w-12 h-12 rounded-2xl bg-[#eef2f0] items-center justify-center mb-4">
            <TrendingDown className="w-6 h-6 text-[#4a7c59]" />
          </span>
          <h1 className="text-4xl font-bold text-[#212529] tracking-tight mb-2">Prixo</h1>
          <p className="text-[#6c757d]">Connectez-vous pour suivre vos articles</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 animate-in fade-in slide-in-from-top-2"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#212529] mb-1.5">Adresse e-mail</label>
            <input
              id="email"
              required
              type="email"
              autoComplete="email"
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all disabled:opacity-60"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#212529] mb-1.5">Mot de passe</label>
            <div className="relative">
              <input
                id="password"
                required
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                disabled={loading}
                className="w-full pl-4 pr-12 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all disabled:opacity-60"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#6c757d] hover:text-[#212529] rounded-lg transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center py-3.5 px-4 bg-[#212529] hover:bg-black text-white text-sm font-medium rounded-xl transition-colors mt-8 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Connexion...
              </>
            ) : (
              'Se connecter'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
