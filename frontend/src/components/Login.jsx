import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError('Identifiants incorrects.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-gray px-4">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <h1 className="text-3xl font-light mb-6 text-center text-brand-charcoal">Prixo</h1>
        <p className="text-center text-gray-500 mb-8 font-light">Connexion requise pour accéder à la liste.</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <input
              type="email"
              placeholder="Adresse e-mail"
              className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-brand-gray/30 focus:outline-none focus:ring-2 focus:ring-brand-mint transition-all"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="Mot de passe"
              className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-brand-gray/30 focus:outline-none focus:ring-2 focus:ring-brand-mint transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button
            type="submit"
            className="w-full py-3 px-4 bg-brand-charcoal text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
          >
            Se connecter
          </button>
        </form>
      </div>
    </div>
  );
}
