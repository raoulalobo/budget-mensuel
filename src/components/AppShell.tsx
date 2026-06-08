import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAuthActions } from '@convex-dev/auth/react'
import { useMutation, useQuery } from 'convex/react'
import {
  LayoutDashboard,
  CalendarDays,
  PiggyBank,
  Repeat,
  Sparkles,
  Target,
  Wallet,
  LogOut,
  Sun,
  Moon,
  Users,
  ChevronDown,
  Check,
  Eye,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useDarkMode } from '../lib/theme'
import { BudgetRoleProvider, useBudgetRole } from '../lib/budgetRole'
import { Avatar } from '../routes/profil'

/**
 * Habillage (layout) de l'application pour les pages authentifiées.
 *
 * Enveloppe tout le contenu dans `BudgetRoleProvider` (rôle sur l'espace budget
 * actif), puis rend la barre supérieure (logo, navigation, sélecteur d'espace
 * partagé, thème, déconnexion) + un bandeau « lecture seule » pour les invités
 * en consultation. Le contenu de chaque page est rendu dans `children`.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <BudgetRoleProvider>
      <Shell>{children}</Shell>
    </BudgetRoleProvider>
  )
}

/** Corps du layout (séparé pour pouvoir consommer le contexte de rôle). */
function Shell({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuthActions()
  const { dark, toggle } = useDarkMode()
  const role = useBudgetRole()

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
              Tableau
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
            <NavLink to="/recurrentes" icon={<Repeat className="h-4 w-4" />}>
              Modèles
            </NavLink>
            <NavLink to="/assistant" icon={<Sparkles className="h-4 w-4" />}>
              IA
            </NavLink>
            <NavLink to="/partage" icon={<Users className="h-4 w-4" />}>
              Partage
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {/* Sélecteur d'espace budget partagé */}
            <BudgetSwitcher />
            {/* Accès au profil (avatar + pseudo) */}
            <ProfileButton />
            {/* Bascule de thème clair/sombre */}
            <button
              type="button"
              onClick={toggle}
              className="app-btn-ghost px-2"
              title={dark ? 'Passer en clair' : 'Passer en sombre'}
              aria-label="Basculer le thème"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
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

        {/* Bandeau « lecture seule » pour un invité en consultation. */}
        {role.role === 'viewer' && (
          <div className="border-t border-amber-300 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
            <Eye className="mr-1 inline h-3.5 w-3.5" />
            Lecture seule — budget de <strong>{role.ownerLabel}</strong>. Vous ne
            pouvez pas le modifier.
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}

/**
 * Sélecteur d'espace budget : menu déroulant listant l'espace personnel et les
 * espaces partagés auxquels l'utilisateur a accès. Bascule l'espace actif.
 * N'apparaît que s'il existe au moins un espace partagé (sinon inutile).
 */
function BudgetSwitcher() {
  const budgets = useQuery(api.sharing.myBudgets)
  const switchBudget = useMutation(api.sharing.switchBudget)
  const [open, setOpen] = useState(false)

  // Tant qu'on n'a qu'un seul espace (le sien), pas de sélecteur.
  if (!budgets || budgets.length <= 1) return null
  const active = budgets.find((b) => b.isActive) ?? budgets[0]

  async function choose(ownerId: Id<'users'>) {
    setOpen(false)
    await switchBudget({ ownerId })
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="app-btn-ghost max-w-44 px-2"
        onClick={() => setOpen((o) => !o)}
        title="Changer d'espace budget"
      >
        <Users className="h-4 w-4 shrink-0" />
        <span className="hidden truncate sm:inline">{active.label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <>
          {/* Voile cliquable pour fermer le menu */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-md border border-border bg-card shadow-lg">
            <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              Espace budget
            </p>
            {budgets.map((b) => (
              <button
                key={b.ownerId}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => void choose(b.ownerId)}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {b.isActive && <Check className="h-4 w-4 text-primary" />}
                </span>
                <span className="flex-1 truncate">{b.label}</span>
                <span className="app-badge bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                  {roleLabel(b.role)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Libellé français court d'un rôle. */
function roleLabel(role: 'owner' | 'editor' | 'viewer'): string {
  return role === 'owner' ? 'propriétaire' : role === 'editor' ? 'éditeur' : 'lecteur'
}

/**
 * Bouton d'accès au profil : avatar (ou initiale) + pseudo, lien vers /profil.
 * Mis en évidence quand on est sur la page profil (`activeProps`).
 */
function ProfileButton() {
  const me = useQuery(api.users.me)
  if (!me) return null
  return (
    <Link
      to="/profil"
      className="app-btn-ghost px-2"
      activeProps={{ className: 'app-btn px-2 bg-accent text-accent-foreground' }}
      title="Mon profil"
    >
      <Avatar avatarUrl={me.avatarUrl} name={me.name} email={me.email} size={24} />
      <span className="hidden max-w-28 truncate sm:inline">
        {me.name ?? me.email ?? 'Profil'}
      </span>
    </Link>
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
      <span className="hidden whitespace-nowrap sm:inline">{children}</span>
    </Link>
  )
}
