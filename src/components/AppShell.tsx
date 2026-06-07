import { Link } from '@tanstack/react-router'
import { useAuthActions } from '@convex-dev/auth/react'
import {
  LayoutDashboard,
  CalendarDays,
  PiggyBank,
  Target,
  Wallet,
  LogOut,
} from 'lucide-react'

/**
 * Habillage (layout) de l'application pour les pages authentifiées :
 * une barre supérieure avec le logo, les liens de navigation principaux et
 * le bouton de déconnexion. Le contenu de chaque page est rendu dans `children`.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuthActions()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          {/* Logo + titre */}
          <Link to="/" className="mr-4 flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">Budget mensuel</span>
          </Link>

          {/* Liens de navigation. `activeProps` met en évidence l'onglet courant. */}
          <nav className="flex items-center gap-1">
            <NavLink to="/" icon={<LayoutDashboard className="h-4 w-4" />}>
              Tableau de bord
            </NavLink>
            <NavLink to="/mois" icon={<CalendarDays className="h-4 w-4" />}>
              Mois
            </NavLink>
            <NavLink to="/avoir" icon={<PiggyBank className="h-4 w-4" />}>
              Avoir
            </NavLink>
            <NavLink to="/epargne" icon={<Target className="h-4 w-4" />}>
              Épargne
            </NavLink>
          </nav>

          <div className="ml-auto">
            <button
              type="button"
              onClick={() => void signOut()}
              className="app-btn-ghost"
              title="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}

/**
 * Lien de navigation stylé, actif quand la route correspond.
 * `activeOptions={{ exact: ... }}` : "/" doit être exact, les autres préfixes.
 */
function NavLink({
  to,
  icon,
  children,
}: {
  to: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      className="app-btn-ghost px-3 text-muted-foreground"
      activeProps={{
        className: 'app-btn px-3 bg-accent text-accent-foreground font-semibold',
      }}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  )
}
