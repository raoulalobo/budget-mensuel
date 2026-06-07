import { convexAuth } from '@convex-dev/auth/server'
import { Password } from '@convex-dev/auth/providers/Password'

/**
 * Configuration de l'authentification Convex Auth.
 *
 * On active uniquement le provider `Password` : inscription et connexion
 * par email + mot de passe (pas de service tiers). Convex Auth gère le
 * hachage du mot de passe, les sessions et les jetons JWT.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
})
