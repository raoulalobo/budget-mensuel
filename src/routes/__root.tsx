import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Authenticated, Unauthenticated, AuthLoading } from 'convex/react'

import ConvexProvider from '../integrations/convex/provider'
import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import AppShell from '../components/AppShell'
import AuthForm from '../components/AuthForm'

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
      </head>
      <body>
        <ConvexProvider>
          {/*
            Gating d'authentification basé sur l'état Convex Auth :
              - AuthLoading    : on attend de savoir si l'utilisateur est connecté
              - Unauthenticated: on affiche le formulaire de connexion/inscription
              - Authenticated  : on affiche l'app (shell + page courante)
          */}
          <AuthLoading>
            <div className="flex min-h-screen items-center justify-center text-muted-foreground">
              Chargement…
            </div>
          </AuthLoading>

          <Unauthenticated>
            <AuthForm />
          </Unauthenticated>

          <Authenticated>
            <AppShell>{children}</AppShell>
          </Authenticated>

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
