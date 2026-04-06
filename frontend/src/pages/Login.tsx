import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/config';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setError('Identifiants incorrects.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden p-8 border border-[#dee2e6]">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-[#212529] tracking-tight mb-2">Prixo</h1>
          <p className="text-[#6c757d]">Connectez-vous pour suivre vos articles</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#212529] mb-1.5">Adresse e-mail</label>
            <input
              id="email"
              required
              type="email"
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#212529] mb-1.5">Mot de passe</label>
            <input
              id="password"
              required
              type="password"
              className="w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 px-4 bg-[#212529] hover:bg-black text-white text-sm font-medium rounded-xl transition-colors mt-8"
          >
            Se connecter
          </button>
        </form>
      </div>
    </div>
  );
}
