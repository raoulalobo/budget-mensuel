import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../../lib/utils'

/**
 * Popover thémé (shadcn/ui) basé sur Radix.
 *
 * Réutilise les tokens du projet (`bg-popover`, `text-popover-foreground`, `border`)
 * et les animations de `tw-animate-css` (déjà importé dans src/styles.css).
 *
 * IMPORTANT : le contenu est portalisé sur <body> avec `z-[60]` afin de s'afficher
 * AU-DESSUS des modales custom de l'app (qui sont en `z-50`).
 */
export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-[60] w-auto rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md outline-none',
        // Animations d'entrée/sortie (tw-animate-css) selon l'état/le côté.
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
        'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = 'PopoverContent'
