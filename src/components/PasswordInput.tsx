import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * Champ de saisie de mot de passe avec bouton « œil » (afficher/masquer).
 *
 * Encapsule un `<input>` dont le `type` bascule entre `password` et `text`, avec
 * une icône cliquable à droite. Réutilisé sur l'écran d'authentification et la
 * page Profil. `onChange` renvoie directement la valeur (chaîne), pour des call
 * sites concis : `onChange={setPassword}`.
 */
export default function PasswordInput({
  value,
  onChange,
  id,
  placeholder = '••••••••',
  autoComplete,
  required = false,
  minLength,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  autoComplete?: string
  required?: boolean
  minLength?: number
  className?: string
}) {
  // Visibilité du mot de passe (local au champ).
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        // `pr-10` réserve la place de l'icône à droite.
        className={`app-input pr-10 ${className}`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        // `tabIndex={-1}` : on ne veut pas que Tab s'arrête sur l'œil.
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        title={show ? 'Masquer' : 'Afficher'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
