import * as React from 'react'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'
import { fr } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Calendrier thémé (shadcn/ui) basé sur react-day-picker (v10).
 *
 * - Locale française (`fr`) : mois/jours en français, semaine débutant le lundi.
 * - Styles alignés sur les tokens du projet (primary/accent/muted-foreground…).
 * - Les jours sont rendus par un `DayButton` custom : contrôle déterministe du
 *   rendu (sélection, aujourd'hui, hors-mois, désactivé) indépendamment des
 *   classes par défaut de la lib.
 */
export type CalendarProps = React.ComponentProps<typeof DayPicker>

export function Calendar({ className, classNames, ...props }: CalendarProps) {
  const defaults = getDefaultClassNames()
  return (
    <DayPicker
      locale={fr}
      showOutsideDays
      className={cn('p-3', className)}
      classNames={{
        months: cn(defaults.months, 'relative flex flex-col gap-4'),
        month: cn(defaults.month, 'w-full space-y-3'),
        month_caption: cn(
          defaults.month_caption,
          'flex h-9 items-center justify-center px-9',
        ),
        caption_label: cn(defaults.caption_label, 'text-sm font-medium capitalize'),
        nav: cn(defaults.nav, 'absolute inset-x-0 top-0 flex items-center justify-between'),
        button_previous: cn(
          defaults.button_previous,
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground',
        ),
        button_next: cn(
          defaults.button_next,
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground',
        ),
        month_grid: cn(defaults.month_grid, 'w-full border-collapse'),
        weekdays: cn(defaults.weekdays, 'flex'),
        weekday: cn(
          defaults.weekday,
          'w-9 text-[0.8rem] font-normal text-muted-foreground',
        ),
        week: cn(defaults.week, 'mt-1 flex w-full'),
        day: cn(defaults.day, 'p-0 text-center text-sm'),
        ...classNames,
      }}
      components={{
        // Chevron unique (v9+) : orienté gauche/droite selon `orientation`.
        Chevron: ({ orientation, className: cl, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('h-4 w-4', cl)} {...rest} />
          ) : (
            <ChevronRight className={cn('h-4 w-4', cl)} {...rest} />
          ),
        // Bouton de jour custom : styles pilotés par les `modifiers`.
        DayButton: ({ day, modifiers, className: cl, ...rest }) => (
          <button
            {...rest}
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-normal transition',
              'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              modifiers.today && !modifiers.selected && 'border border-ring',
              modifiers.selected &&
                'bg-primary font-medium text-primary-foreground hover:bg-primary hover:text-primary-foreground',
              modifiers.outside && 'text-muted-foreground opacity-50',
              modifiers.disabled && 'opacity-40 hover:bg-transparent',
              cl,
            )}
          />
        ),
      }}
      {...props}
    />
  )
}
