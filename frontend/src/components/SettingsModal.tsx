import React, { useState } from 'react';
import { X, Mail, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { functions } from '../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { useModalBehavior, backdropClose } from '../hooks/useModalBehavior';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [isSending, setIsSending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useModalBehavior(true, onClose);

  const handleTestEmail = async () => {
    setIsSending(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      // La fonction était bien construite, mais l'appel portait sur un nom
      // inexistant (`testEmailFunction`) : le bouton échouait systématiquement
      // sur une ReferenceError, affichée à l'utilisateur comme une erreur
      // d'envoi incompréhensible.
      const testEmailNotification = httpsCallable(functions, 'testEmailNotificationV2');
      const result = await testEmailNotification();
      setSuccessMessage((result.data as any)?.message || 'E-mail de test envoyé avec succès !');
    } catch (error: any) {
      console.error("Erreur d'envoi:", error);
      setErrorMessage(error?.message || "Une erreur est survenue lors de l'envoi de l'e-mail.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in"
      onClick={backdropClose(onClose)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="bg-white rounded-3xl w-full max-w-md shadow-[0_18px_40px_-12px_rgb(33_37_41/0.22)] overflow-hidden animate-in fade-in zoom-in-95"
      >
        <div className="px-6 py-4 border-b border-[#f0f0f0] flex justify-between items-center bg-[#fafafa]">
          <h2 id="settings-title" className="text-xl font-bold text-[#212529]">Paramètres</h2>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-[#adb5bd] hover:text-[#212529] transition-colors p-2 rounded-full hover:bg-[#eef2f0]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-[#6c757d] uppercase tracking-wider mb-4 flex items-center">
              <Mail className="w-4 h-4 mr-2" />
              Notifications par e-mail
            </h3>

            <div className="bg-[#f8f9fa] rounded-2xl p-4 border border-[#e9ecef]">
              <p className="text-sm text-[#495057] mb-4">
                Recevez un récapitulatif nocturne des changements de prix pour vos articles suivis.
                Testez l'apparence de cet e-mail en recevant un exemple immédiat avec des données simulées.
              </p>

              <button
                onClick={handleTestEmail}
                disabled={isSending}
                className="w-full flex items-center justify-center px-4 py-2.5 bg-white border border-[#dee2e6] text-[#212529] text-sm font-medium rounded-xl hover:bg-[#eef2f0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  <>Envoyer un e-mail de test</>
                )}
              </button>

              {successMessage && (
                <div className="mt-3 flex items-start text-sm text-green-700 bg-green-50 p-3 rounded-xl border border-green-200 animate-in fade-in slide-in-from-top-2">
                  <CheckCircle2 className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              {errorMessage && (
                <div className="mt-3 flex items-start text-sm text-red-700 bg-red-50 p-3 rounded-xl border border-red-200 animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
