import { useEffect, useState } from 'react'
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
  Settings,
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
  const { dark, toggle } = useDarkMode()
  const role = useBudgetRole()

  // Crée les rubriques par défaut au premier accès (idempotent ; seul un
  // propriétaire/éditeur peut écrire).
  const ensureDefaults = useMutation(api.sections.ensureDefaults)
  useEffect(() => {
    if (role.canEdit) void ensureDefaults()
  }, [role.canEdit, ensureDefaults])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          {/* Logo + titre */}
          <Link
            to="/tableau"
            className="mr-2 flex shrink-0 items-center gap-2 font-bold"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">Budget mensuel</span>
          </Link>

          {/* Liens de navigation : la nav rétrécit et défile horizontalement sur
              petit écran (pattern « tab bar »), pour ne jamais déborder la page. */}
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
            <NavLink to="/tableau" icon={<LayoutDashboard className="h-4 w-4" />}>
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

          <div className="flex shrink-0 items-center gap-1">
            {/* Sélecteur d'espace budget partagé */}
            <BudgetSwitcher />
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
            {/* Menu de compte (profil + déconnexion) */}
            <ProfileMenu />
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
 * Menu de compte : déclenché par l'avatar + nom, il regroupe les actions liées
 * au compte en sous-éléments — « Modifier mon profil » (→ /profil) et
 * « Déconnexion ». Même pattern de menu déroulant que `BudgetSwitcher`.
 */
function ProfileMenu() {
  const me = useQuery(api.users.me)
  const { signOut } = useAuthActions()
  const [open, setOpen] = useState(false)
  if (!me) return null

  const label = me.name ?? me.email ?? 'Profil'

  return (
    <div className="relative">
      {/* Déclencheur : avatar + nom + chevron */}
      <button
        type="button"
        className="app-btn-ghost px-2"
        onClick={() => setOpen((o) => !o)}
        title="Mon compte"
      >
        <Avatar avatarUrl={me.avatarUrl} name={me.name} email={me.email} size={24} />
        <span className="hidden max-w-28 truncate sm:inline">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <>
          {/* Voile cliquable pour fermer le menu */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-md border border-border bg-card shadow-lg">
            {/* En-tête : repère visuel (avatar + nom + email) */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Avatar
                avatarUrl={me.avatarUrl}
                name={me.name}
                email={me.email}
                size={32}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{label}</p>
                {me.email && (
                  <p className="truncate text-xs text-muted-foreground">{me.email}</p>
                )}
              </div>
            </div>

            {/* Sous-élément : modifier le profil */}
            <Link
              to="/profil"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
              Modifier mon profil
            </Link>

            {/* Sous-élément : déconnexion */}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void signOut()
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Déconnexion
            </button>
          </div>
        </>
      )}
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
      className="app-btn-ghost shrink-0 px-3 text-muted-foreground"
      activeProps={{
        className:
          'app-btn shrink-0 px-3 bg-accent text-accent-foreground font-semibold',
      }}
    >
      {icon}
      <span className="hidden whitespace-nowrap sm:inline">{children}</span>
    </Link>
  )
}
