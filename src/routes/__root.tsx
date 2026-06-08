import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Authenticated, Unauthenticated, AuthLoading } from 'convex/react'

import ConvexProvider from '../integrations/convex/provider'
import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import AppShell from '../components/AppShell'
import AuthForm from '../components/AuthForm'
import {
  Skeleton,
  SkeletonStatCards,
  SkeletonChartCard,
} from '../components/Skeleton'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Budget mensuel' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
        {/*
          Application du thème AVANT l'hydratation React : évite le flash de
          thème clair (FOUC) et thème aussi la page de connexion. Lit le choix
          sauvegardé ('theme' dans localStorage), sinon la préférence système.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ConvexProvider>
          <AppGate>{children}</AppGate>

          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        </ConvexProvider>
        <Scripts />
      </body>
    </html>
  )
}

/**
 * Gate d'accès « conscient de la route ».
 *
 *  - La HOMEPAGE publique (`/`) est rendue telle quelle, pour TOUT le monde
 *    (ni authentification, ni AppShell) : c'est le point d'entrée de l'app.
 *  - Toutes les autres routes restent protégées :
 *      AuthLoading     → esquisse (skeleton) pendant la résolution de l'auth
 *      Unauthenticated → formulaire de connexion / inscription
 *      Authenticated   → l'app (AppShell + page courante)
 */
function AppGate({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Page publique : aucun gating.
  if (pathname === '/') return <>{children}</>

  return (
    <>
      <AuthLoading>
        {/* Esquisse de l'app pendant la résolution de l'authentification. */}
        <div className="min-h-screen">
          <div className="border-b border-border bg-card/80">
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ml-auto h-7 w-24" />
            </div>
          </div>
          <div className="mx-auto max-w-6xl px-4 py-6">
            <SkeletonStatCards />
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <SkeletonChartCard />
              <SkeletonChartCard />
            </div>
          </div>
        </div>
      </AuthLoading>

      <Unauthenticated>
        <AuthForm />
      </Unauthenticated>

      <Authenticated>
        <AppShell>{children}</AppShell>
      </Authenticated>
    </>
  )
}
