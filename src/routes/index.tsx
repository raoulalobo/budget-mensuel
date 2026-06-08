import { createFileRoute, Link } from '@tanstack/react-router'
import { Authenticated, Unauthenticated, AuthLoading } from 'convex/react'
import {
  Wallet,
  Sun,
  Moon,
  ArrowRight,
  LayoutDashboard,
  CalendarDays,
  PiggyBank,
  Target,
  Repeat,
  Camera,
  Sparkles,
  Users,
  StickyNote,
  Tags,
  AlertTriangle,
  FileDown,
  ShieldCheck,
  Check,
} from 'lucide-react'
import { useDarkMode } from '../lib/theme'
import SiteFooter from '../components/SiteFooter'

/**
 * Route "/" : HOMEPAGE PUBLIQUE (point d'entrée de l'application).
 *
 * Page de présentation accessible à TOUS (connectés ou non) : elle récapitule
 * l'application et ses fonctionnalités, avec des appels à l'action vers le
 * budget (`/tableau`). Elle ne dépend PAS de l'AppShell ni de l'authentification
 * (cf. le gate route-aware dans `src/routes/__root.tsx`).
 */
export const Route = createFileRoute('/')({
  component: Home,
})

/** Liste des fonctionnalités mises en avant (icône + titre + description). */
const FEATURES: Array<{
  icon: React.ReactNode
  title: string
  desc: string
}> = [
  {
    icon: <CalendarDays className="h-5 w-5" />,
    title: 'Budget mensuel',
    desc: 'Revenus, dépenses fixes/variables, crédits et épargne — avec le prévu et le réel côte à côte, mois par mois.',
  },
  {
    icon: <LayoutDashboard className="h-5 w-5" />,
    title: 'Tableau de bord & graphiques',
    desc: 'Vue annuelle et récap mensuel : revenus vs dépenses, évolution du net, répartition des dépenses.',
  },
  {
    icon: <PiggyBank className="h-5 w-5" />,
    title: 'Patrimoine (Avoir)',
    desc: 'Suivez vos placements et l’évolution de votre patrimoine dans le temps.',
  },
  {
    icon: <Target className="h-5 w-5" />,
    title: 'Objectifs d’épargne',
    desc: 'Définissez des objectifs (fonds d’urgence, vacances…) et suivez leur progression.',
  },
  {
    icon: <Repeat className="h-5 w-5" />,
    title: 'Lignes récurrentes',
    desc: 'Loyer, abonnements, salaire… des modèles à appliquer à n’importe quel mois en un clic.',
  },
  {
    icon: <Camera className="h-5 w-5" />,
    title: 'Import CSV & photo (IA)',
    desc: 'Importez vos relevés, ou prenez en photo un ticket : l’IA en extrait les montants automatiquement.',
  },
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: 'Assistant IA & récaps',
    desc: 'Un assistant conversationnel qui analyse vos données et des récapitulatifs mensuels générés par IA.',
  },
  {
    icon: <Users className="h-5 w-5" />,
    title: 'Budget partagé',
    desc: 'Invitez votre conjoint·e par code, avec des rôles éditeur ou lecteur. Idéal pour un foyer.',
  },
  {
    icon: <StickyNote className="h-5 w-5" />,
    title: 'Notes & reçus',
    desc: 'Ajoutez des notes (clavier ou dictée vocale) et joignez des photos justificatives à chaque ligne.',
  },
  {
    icon: <Tags className="h-5 w-5" />,
    title: 'Tags & recherche',
    desc: 'Étiquetez vos lignes et retrouvez-les instantanément par libellé ou par tag.',
  },
  {
    icon: <AlertTriangle className="h-5 w-5" />,
    title: 'Alertes & prévision',
    desc: 'Repérez les postes en dépassement et anticipez votre reste à dépenser et votre net projeté.',
  },
  {
    icon: <FileDown className="h-5 w-5" />,
    title: 'Export PDF & mode sombre',
    desc: 'Exportez vos bilans mensuels et annuels en PDF, avec une interface en thème clair ou sombre.',
  },
]

/** Étapes « Comment ça marche ». */
const STEPS: Array<{ title: string; desc: string }> = [
  {
    title: 'Créez votre compte',
    desc: 'Inscription en quelques secondes avec un email et un mot de passe.',
  },
  {
    title: 'Saisissez ou importez',
    desc: 'Ajoutez vos mois à la main, importez un CSV, ou photographiez vos tickets.',
  },
  {
    title: 'Pilotez & partagez',
    desc: 'Suivez vos graphiques, fixez vos objectifs et partagez le budget avec vos proches.',
  },
]

function Home() {
  const { dark, toggle } = useDarkMode()

  return (
    <div className="min-h-screen">
      {/* ── Barre supérieure ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <span className="flex shrink-0 items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">Budget mensuel</span>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className="app-btn-ghost px-2"
              title={dark ? 'Passer en clair' : 'Passer en sombre'}
              aria-label="Basculer le thème"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {/* CTA d'en-tête, adapté à l'état d'authentification. */}
            <AuthLoading>
              <Link to="/tableau" className="app-btn-primary">
                Accéder au budget
              </Link>
            </AuthLoading>
            <Unauthenticated>
              <Link to="/tableau" className="app-btn-ghost hidden sm:inline-flex">
                Se connecter
              </Link>
              <Link to="/tableau" className="app-btn-primary">
                Créer un compte
              </Link>
            </Unauthenticated>
            <Authenticated>
              <Link to="/tableau" className="app-btn-primary">
                Accéder à mon budget
              </Link>
            </Authenticated>
          </div>
        </div>
      </header>

      <main>
        {/* ── Héro ────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 pb-12 pt-16 text-center sm:pt-24">
          <span className="app-badge mx-auto mb-5 inline-flex items-center gap-1.5 bg-primary/10 px-3 py-1 text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Budget, patrimoine, épargne &
            IA
          </span>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
            Gérez votre argent,{' '}
            <span className="text-primary">simplement et à plusieurs</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Suivez votre budget mensuel, votre patrimoine et vos objectifs
            d’épargne. Importez vos tickets par photo, laissez l’IA résumer vos
            mois, et partagez tout avec votre foyer.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <AuthLoading>
              <Link to="/tableau" className="app-btn-primary px-6 py-2.5 text-base">
                Accéder au budget <ArrowRight className="h-4 w-4" />
              </Link>
            </AuthLoading>
            <Unauthenticated>
              <Link to="/tableau" className="app-btn-primary px-6 py-2.5 text-base">
                Commencer gratuitement <ArrowRight className="h-4 w-4" />
              </Link>
            </Unauthenticated>
            <Authenticated>
              <Link to="/tableau" className="app-btn-primary px-6 py-2.5 text-base">
                Accéder à mon budget <ArrowRight className="h-4 w-4" />
              </Link>
            </Authenticated>
            <a href="#fonctionnalites" className="app-btn-ghost px-5 py-2.5 text-base">
              Voir les fonctionnalités
            </a>
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Vos données restent privées —
            supprimables à tout moment.
          </p>
        </section>

        {/* ── Fonctionnalités ─────────────────────────────────────────────── */}
        <section
          id="fonctionnalites"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12"
        >
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Tout ce qu’il faut pour votre budget
            </h2>
            <p className="mt-2 text-muted-foreground">
              Une application complète, du suivi quotidien au pilotage annuel.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="app-card p-5">
                <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {f.icon}
                </span>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Comment ça marche ───────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">Comment ça marche</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="app-card p-5">
                <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                  {i + 1}
                </span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bloc CTA final ──────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="app-card flex flex-col items-center gap-4 p-8 text-center sm:p-12">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Prêt·e à reprendre le contrôle de votre budget ?
            </h2>
            <p className="max-w-xl text-muted-foreground">
              Créez votre espace en quelques secondes. Mode sombre, partage et
              IA inclus.
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" /> Gratuit
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" /> Sans engagement
              </li>
              <li className="flex items-center gap-1.5">
                <Moon className="h-4 w-4 text-primary" /> Thème clair/sombre
              </li>
            </ul>
            <AuthLoading>
              <Link to="/tableau" className="app-btn-primary px-6 py-2.5 text-base">
                Accéder au budget <ArrowRight className="h-4 w-4" />
              </Link>
            </AuthLoading>
            <Unauthenticated>
              <Link to="/tableau" className="app-btn-primary px-6 py-2.5 text-base">
                Créer mon compte <ArrowRight className="h-4 w-4" />
              </Link>
            </Unauthenticated>
            <Authenticated>
              <Link to="/tableau" className="app-btn-primary px-6 py-2.5 text-base">
                Accéder à mon budget <ArrowRight className="h-4 w-4" />
              </Link>
            </Authenticated>
          </div>
        </section>
      </main>

      {/* ── Pied de page (liens + mentions légales) ───────────────────────── */}
      <SiteFooter />
    </div>
  )
}
