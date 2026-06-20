import { useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Calendar } from './ui/calendar'
import { formatDate, isoFromDate } from '../lib/budget'
import { cn } from '../lib/utils'

/**
 * Champ de saisie de date réutilisable (design soigné, shadcn).
 *
 * Remplace les `<input type="date">` natifs : un déclencheur stylé ouvre un
 * popover contenant un calendrier `react-day-picker` (français, lundi en tête,
 * thème clair/sombre). La valeur est une chaîne ISO `YYYY-MM-DD` (ou '' si vide) —
 * exactement le format consommé par les états/mutations de l'app.
 *
 * Exemple :
 *   <DateField value={date} onChange={setDate} clearable placeholder="Choisir une date" />
 */
export default function DateField({
  value,
  onChange,
  placeholder = 'Choisir une date',
  disabled = false,
  clearable = false,
  size = 'default',
  className,
}: {
  /** Date ISO 'YYYY-MM-DD' (vide/undefined = aucune date). */
  value?: string
  /** Émet la nouvelle date ISO, ou '' à l'effacement. */
  onChange: (iso: string) => void
  placeholder?: string
  disabled?: boolean
  /** Affiche une croix d'effacement quand une date est posée. */
  clearable?: boolean
  /** 'compact' pour les cellules de tableau (import). */
  size?: 'default' | 'compact'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(`${value}T12:00:00`) : undefined
  const label = formatDate(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex w-full items-center gap-2 rounded-md border border-input bg-background text-left transition outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
            size === 'compact' ? 'px-2 py-1 text-sm' : 'px-3 py-2 text-sm',
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn('flex-1 truncate', !label && 'text-muted-foreground')}>
            {label || placeholder}
          </span>
          {clearable && value && (
            // Croix d'effacement : ne doit pas ouvrir le calendrier.
            <span
              role="button"
              aria-label="Effacer la date"
              tabIndex={0}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange('')
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            onChange(d ? isoFromDate(d) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
