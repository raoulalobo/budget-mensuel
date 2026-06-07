import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'

/**
 * Fournisseur Convex + authentification pour toute l'application.
 *
 * - `ConvexReactClient`  : client temps réel qui parle au backend Convex.
 *   L'URL provient de la variable d'env `VITE_CONVEX_URL` (cf. .env.local).
 * - `ConvexAuthProvider` : enveloppe le client pour gérer l'état d'auth
 *   (connexion / inscription par email+mot de passe via Convex Auth) et
 *   exposer les hooks `useAuthActions`, `<Authenticated>`, etc.
 *
 * Le client est créé une seule fois au niveau module pour éviter de le
 * recréer à chaque rendu.
 */
const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL as string
if (!CONVEX_URL) {
  console.error('Variable d’environnement VITE_CONVEX_URL manquante')
}

const convex = new ConvexReactClient(CONVEX_URL)

export default function AppConvexProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
}
