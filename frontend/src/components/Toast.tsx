import React from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../utils/cn';

export type ToastType = 'success' | 'info' | 'error';

export interface ToastMessage {
  message: string;
  type: ToastType;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

const STYLES: Record<ToastType, { ring: string; icon: string; Icon: typeof Info }> = {
  success: { ring: 'border-[#a8d5ba]', icon: 'text-[#4a7c59] bg-[#eef2f0]', Icon: CheckCircle2 },
  info: { ring: 'border-[#dee2e6]', icon: 'text-[#212529] bg-[#f1f3f5]', Icon: Info },
  error: { ring: 'border-red-200', icon: 'text-red-600 bg-red-50', Icon: AlertTriangle },
};

/**
 * Bandeau de confirmation global.
 *
 * Les messages de `showNotification` (tableau créé, article déplacé, couleurs
 * regroupées, échecs d'écriture…) n'étaient rendus qu'à l'intérieur de la fiche
 * article : hors de cette modale, toutes ces actions étaient silencieuses. Ce
 * composant les affiche au niveau de l'application, au-dessus de tout le reste.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null;

  const style = STYLES[toast.type];
  const Icon = style.Icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[200] inset-x-4 bottom-24 sm:inset-x-auto sm:bottom-auto sm:top-6 sm:right-6 sm:w-auto sm:max-w-sm pointer-events-none flex justify-center"
    >
      <div
        className={cn(
          'pointer-events-auto flex items-start gap-3 w-full sm:w-auto bg-white border rounded-2xl shadow-[0_18px_40px_-12px_rgb(33_37_41/0.22)] px-4 py-3 animate-in fade-in slide-in-from-top-5',
          style.ring
        )}
      >
        <span className={cn('shrink-0 rounded-full p-1.5', style.icon)}>
          <Icon className="w-4 h-4" />
        </span>
        <p className="text-sm font-medium text-[#212529] leading-snug pt-1 flex-1 min-w-0">
          {toast.message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer la notification"
          className="shrink-0 p-1 -mr-1 text-[#adb5bd] hover:text-[#212529] hover:bg-[#f1f3f5] rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
