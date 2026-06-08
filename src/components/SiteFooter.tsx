import { Link } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'

/**
 * Pied de page public du site (homepage + pages légales).
 *
 * Regroupe la marque, des liens de navigation et les liens légaux (mentions
 * légales, confidentialité). Le lien « Fonctionnalités » pointe vers l'ancre de
 * la homepage (`/#fonctionnalites`) pour fonctionner depuis n'importe quelle page.
 */
export default function SiteFooter() {
  // Année du copyright : on lit l'année courante de façon SSR-safe.
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Marque + accroche */}
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-2 font-bold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Wallet className="h-4 w-4" />
              </span>
              Budget mensuel
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Suivi de budget personnel et partagé : mois, patrimoine, épargne,
              import par photo et assistant IA.
            </p>
          </div>

          {/* Colonne Produit */}
          <nav className="flex flex-col gap-2 text-sm">
            <span className="font-semibold">Produit</span>
            <a
              href="/#fonctionnalites"
              className="text-muted-foreground hover:text-foreground"
            >
              Fonctionnalités
            </a>
            <Link
              to="/tableau"
              className="text-muted-foreground hover:text-foreground"
            >
              Mon budget
            </Link>
          </nav>

          {/* Colonne Légal */}
          <nav className="flex flex-col gap-2 text-sm">
            <span className="font-semibold">Légal</span>
            <Link
              to="/mentions-legales"
              className="text-muted-foreground hover:text-foreground"
            >
              Mentions légales
            </Link>
            <Link
              to="/confidentialite"
              className="text-muted-foreground hover:text-foreground"
            >
              Confidentialité
            </Link>
          </nav>
        </div>

        {/* Barre de copyright */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <span>© {year} Budget mensuel. Tous droits réservés.</span>
          <span className="flex items-center gap-3">
            <Link to="/mentions-legales" className="hover:text-foreground">
              Mentions légales
            </Link>
            <Link to="/confidentialite" className="hover:text-foreground">
              Confidentialité
            </Link>
          </span>
        </div>
      </div>
    </footer>
  )
}
