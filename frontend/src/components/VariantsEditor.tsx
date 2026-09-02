import React from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { cn } from '../utils/cn';
import { deriveFrUrl, newVariantId } from '../utils/variants';

/** Forme d'une variante telle que manipulée dans les formulaires. */
export interface VariantDraft {
  id: string;
  color: string;
  colorHex: string;
  url: string;
  urlFr: string;
  /** L'URL française a-t-elle été saisie à la main ? Si oui, on cesse de la déduire. */
  urlFrManual: boolean;
  imageUrl: string;
}

export function emptyVariantDraft(): VariantDraft {
  return {
    id: newVariantId(),
    color: '',
    colorHex: '#d9d9d9',
    url: '',
    urlFr: '',
    urlFrManual: false,
    imageUrl: '',
  };
}

const inputClass =
  'w-full px-4 py-3 rounded-xl border border-[#dee2e6] bg-[#f8f9fa] focus:bg-white focus:ring-2 focus:ring-[#a8d5ba] focus:border-transparent outline-none transition-all';

interface VariantsEditorProps {
  variants: VariantDraft[];
  onChange: (variants: VariantDraft[]) => void;
}

export function VariantsEditor({ variants, onChange }: VariantsEditorProps) {
  const isMulti = variants.length > 1;

  const update = (index: number, patch: Partial<VariantDraft>) => {
    const next = variants.map((v, i) => (i === index ? { ...v, ...patch } : v));
    onChange(next);
  };

  const handleUrlChange = (index: number, url: string) => {
    const variant = variants[index];
    // Tant que l'utilisateur n'a pas repris la main sur l'URL française, on la déduit.
    const patch: Partial<VariantDraft> = { url };
    if (!variant.urlFrManual) {
      patch.urlFr = deriveFrUrl(url);
    }
    update(index, patch);
  };

  const addVariant = () => {
    const base = variants[variants.length - 1];
    const next = emptyVariantDraft();
    // On reprend la couleur par défaut mais pas les URLs : chaque couleur a sa page.
    onChange([...variants, { ...next, colorHex: base?.colorHex || '#d9d9d9' }]);
  };

  const removeVariant = (index: number) => {
    if (variants.length <= 1) return;
    onChange(variants.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {variants.map((variant, index) => (
        <div
          key={variant.id}
          className={cn(
            'space-y-3',
            isMulti && 'rounded-2xl border border-[#dee2e6] bg-[#f8f9fa]/60 p-4'
          )}
        >
          {isMulti && (
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={variant.colorHex || '#d9d9d9'}
                onChange={e => update(index, { colorHex: e.target.value })}
                title="Pastille de couleur"
                className="w-10 h-10 rounded-full border border-[#dee2e6] cursor-pointer bg-white p-0.5 shrink-0"
              />
              <input
                type="text"
                placeholder={`Nom de la couleur (ex: Beige)`}
                className={cn(inputClass, 'py-2')}
                value={variant.color}
                onChange={e => update(index, { color: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeVariant(index)}
                title="Supprimer cette couleur"
                className="p-2 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">
              <span aria-hidden="true">🇧🇪</span> Lien belge (URL)
            </label>
            <input
              required
              type="url"
              placeholder="https://jysk.be/fr/..."
              className={inputClass}
              value={variant.url}
              onChange={e => handleUrlChange(index, e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-[#212529]">
                <span aria-hidden="true">🇫🇷</span> Lien français (optionnel)
              </label>
              {!variant.urlFrManual && variant.urlFr && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a7c59] bg-[#eef2f0] px-2 py-0.5 rounded-full">
                  <Wand2 className="w-3 h-3" /> déduit
                </span>
              )}
            </div>
            <input
              type="url"
              placeholder="https://jysk.fr/..."
              className={inputClass}
              value={variant.urlFr}
              onChange={e => update(index, { urlFr: e.target.value, urlFrManual: true })}
            />
            <p className="text-xs text-[#6c757d] mt-1.5">
              Déduit du lien belge quand c'est possible. Si la page française a une
              adresse différente, collez-la ici.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#212529] mb-1.5">
              Lien de l'image (optionnel)
            </label>
            <input
              type="url"
              placeholder="https://.../image.jpg"
              className={inputClass}
              value={variant.imageUrl}
              onChange={e => update(index, { imageUrl: e.target.value })}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addVariant}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 border border-dashed border-[#dee2e6] text-sm font-medium text-[#6c757d] hover:text-[#212529] hover:border-[#a8d5ba] hover:bg-[#f8f9fa] rounded-xl transition-colors"
      >
        <Plus className="w-4 h-4" />
        {isMulti ? 'Ajouter une autre couleur' : 'Cet article existe en plusieurs couleurs'}
      </button>
    </div>
  );
}
