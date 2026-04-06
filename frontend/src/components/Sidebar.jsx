import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { LogOut } from 'lucide-react';

export default function Sidebar({ categories, activeCategory, setActiveCategory, user }) {
  const handleLogout = () => {
    signOut(auth);
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-100 flex flex-col hidden md:flex">
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-brand-charcoal tracking-wide">Prixo.</h1>
      </div>

      <div className="flex-1 px-4 py-2 overflow-y-auto">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 px-4">Boards</h2>
        <nav className="space-y-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`w-full text-left px-4 py-2 rounded-lg transition-colors font-medium text-sm ${
                activeCategory === cat
                  ? 'bg-brand-gray text-brand-charcoal'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-brand-charcoal'
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-gray-100">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-brand-charcoal w-full px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <LogOut size={16} />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
