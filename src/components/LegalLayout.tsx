import { Link } from '@tanstack/react-router'
import { Wallet, Sun, Moon, ArrowLeft } from 'lucide-react'
import { useDarkMode } from '../lib/theme'
import SiteFooter from './SiteFooter'

/**
 * Habillage des pages légales PUBLIQUES (mentions légales, confidentialité).
 *
 * Barre supérieure (logo → homepage + bouton thème), un titre, un conteneur de
 * texte lisible, puis le pied de page commun `SiteFooter`. Autonome (ne dépend
 * pas de l'AppShell ni de l'authentification).
 */
export default function LegalLayout({
  title,
  updatedAt,
  children,
}: {
  title: string
  updatedAt?: string
  children: React.ReactNode
}) {
  const { dark, toggle } = useDarkMode()

  return (
    <div className="flex min-h-screen flex-col">
      {/* Barre supérieure */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">Budget mensuel</span>
          </Link>
          <button
            type="button"
            onClick={toggle}
            className="app-btn-ghost ml-auto px-2"
            title={dark ? 'Passer en clair' : 'Passer en sombre'}
            aria-label="Basculer le thème"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Contenu */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Retour à l'accueil
        </Link>
        <h1 className="text-3xl font-bold">{title}</h1>
        {updatedAt && (
          <p className="mt-1 text-sm text-muted-foreground">
            Dernière mise à jour : {updatedAt}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-6 text-sm leading-relaxed text-foreground/90">
          {children}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}

/** Section d'une page légale : un sous-titre + son contenu. */
export function LegalSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}
