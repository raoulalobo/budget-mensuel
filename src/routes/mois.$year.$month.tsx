import { createFileRoute } from '@tanstack/react-router'
import MonthView from '../components/MonthView'

/**
 * Route détaillée d'un mois : /mois/2025/1 => Janvier 2025.
 * Les paramètres d'URL (`year`, `month`) sont des chaînes : on les convertit
 * en nombres avant de les passer à <MonthView>.
 */
export const Route = createFileRoute('/mois/$year/$month')({
  component: MonthPage,
})

function MonthPage() {
  const { year, month } = Route.useParams()
  return <MonthView year={Number(year)} month={Number(month)} />
}
