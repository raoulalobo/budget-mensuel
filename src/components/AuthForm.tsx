import { useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { Wallet } from 'lucide-react'
import PasswordInput from './PasswordInput'

/**
 * Formulaire d'authentification (Convex Auth — provider "password").
 *
 * Gère deux modes via un seul écran :
 *  - `signIn` : connexion d'un compte existant
 *  - `signUp` : création d'un nouveau compte
 *
 * Le `flow` est passé à `signIn('password', { email, password, flow })` :
 * Convex Auth se charge du hachage du mot de passe et de la création de session.
 */
export default function AuthForm() {
  const { signIn } = useAuthActions()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    // À l'inscription : les deux mots de passe doivent correspondre.
    if (mode === 'signUp' && password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    setLoading(true)
    try {
      // `flow` indique à Convex Auth s'il s'agit d'une connexion ou inscription.
      await signIn('password', { email, password, flow: mode })
    } catch (err) {
      // Message générique : on n'expose pas le détail (compte inexistant, etc.).
      setError(
        mode === 'signIn'
          ? 'Échec de la connexion. Vérifiez vos identifiants.'
          : 'Échec de l’inscription. Cet email est peut-être déjà utilisé.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="app-card w-full max-w-sm p-8">
        {/* En-tête / logo */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Wallet className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold">Budget mensuel</h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'signIn'
              ? 'Connectez-vous pour accéder à votre budget'
              : 'Créez un compte pour démarrer votre budget'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="app-input"
              placeholder="vous@exemple.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Mot de passe
            </label>
            <PasswordInput
              id="password"
              required
              minLength={8}
              autoComplete={
                mode === 'signIn' ? 'current-password' : 'new-password'
              }
              value={password}
              onChange={setPassword}
            />
            {mode === 'signUp' && (
              <span className="text-xs text-muted-foreground">
                Au moins 8 caractères.
              </span>
            )}
          </div>

          {/* Confirmation du mot de passe (inscription uniquement) */}
          {mode === 'signUp' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirm" className="text-sm font-medium">
                Confirmer le mot de passe
              </label>
              <PasswordInput
                id="confirm"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={setConfirm}
              />
            </div>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="app-btn-primary mt-2"
            disabled={loading}
          >
            {loading
              ? 'Veuillez patienter…'
              : mode === 'signIn'
                ? 'Se connecter'
                : 'Créer mon compte'}
          </button>
        </form>

        {/* Bascule connexion / inscription */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === 'signIn' ? 'Pas encore de compte ?' : 'Déjà inscrit ?'}{' '}
          <button
            type="button"
            className="font-semibold text-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setMode(mode === 'signIn' ? 'signUp' : 'signIn')
              setError(null)
              setConfirm('')
            }}
          >
            {mode === 'signIn' ? 'Créer un compte' : 'Se connecter'}
          </button>
        </p>
      </div>
    </div>
  )
}
