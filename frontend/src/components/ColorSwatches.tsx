import React from 'react';
import { cn } from '../utils/cn';
import type { Variant } from '../utils/variants';

interface ColorSwatchesProps {
  variants: Variant[];
  activeId: string;
  onSelect: (variantId: string) => void;
  size?: 'sm' | 'md';
  /** Affiche le nom de la couleur active sous les pastilles. */
  showLabel?: boolean;
}

/**
 * Sélecteur de couleur. Le clic est isolé du reste de la carte (ouverture de la
 * fiche, glisser-déposer) via stopPropagation sur pointer down et click.
 */
export function ColorSwatches({ variants, activeId, onSelect, size = 'sm', showLabel = true }: ColorSwatchesProps) {
  if (variants.length < 2) return null;

  const active = variants.find(v => v.id === activeId) || variants[0];
  const dot = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div onPointerDown={stop} onClick={stop} onKeyDown={stop}>
      <div className="flex flex-wrap items-center gap-1.5">
        {variants.map(variant => {
          const isActive = variant.id === active.id;
          return (
            <button
              key={variant.id}
              type="button"
              title={variant.color || 'Sans nom'}
              aria-label={variant.color || 'Sans nom'}
              aria-pressed={isActive}
              onClick={(e) => { e.stopPropagation(); onSelect(variant.id); }}
              className={cn(
                'rounded-full border transition-all duration-200 shrink-0',
                dot,
                isActive
                  ? 'ring-2 ring-offset-2 ring-[#212529] border-transparent scale-105'
                  : 'border-[#dee2e6] hover:scale-110'
              )}
              style={
                variant.colorHex
                  ? { backgroundColor: variant.colorHex }
                  : variant.imageUrl
                    ? { backgroundImage: `url(${variant.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { backgroundColor: '#e9ecef' }
              }
            />
          );
        })}
      </div>

      {showLabel && active.color && (
        <p className="text-xs text-[#6c757d] mt-2 truncate">
          Couleur : <span className="font-medium text-[#212529]">{active.color}</span>
        </p>
      )}
    </div>
  );
}
