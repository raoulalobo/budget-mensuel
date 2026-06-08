import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import {
  User,
  ImagePlus,
  Trash2,
  Save,
  Loader2,
  KeyRound,
  Mail,
  AlertTriangle,
  X,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { uploadImageFile } from '../lib/upload'

/**
 * Route /profil : gestion du compte de l'utilisateur connecté.
 *
 * Trois blocs : photo de profil (avatar), identité (pseudo + email en lecture
 * seule) et changement de mot de passe. Tout cible l'utilisateur RÉELLEMENT
 * connecté (indépendant du budget partagé regardé).
 */
export const Route = createFileRoute('/profil')({
  component: ProfilePage,
})

function ProfilePage() {
  const me = useQuery(api.users.me)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <User className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Profil</h1>
          <p className="text-sm text-muted-foreground">
            Gérez votre photo, votre pseudo et votre mot de passe.
          </p>
        </div>
      </div>

      {me === undefined ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : me === null ? (
        <p className="text-muted-foreground">Non connecté.</p>
      ) : (
        <>
          <AvatarCard avatarUrl={me.avatarUrl} name={me.name} email={me.email} />
          <IdentityCard name={me.name} email={me.email} />
          <PasswordCard />
          <DangerZoneCard />
        </>
      )}
    </div>
  )
}

/** Carte « Photo de profil » : aperçu + changer / retirer. */
function AvatarCard({
  avatarUrl,
  name,
  email,
}: {
  avatarUrl: string | null
  name: string | null
  email: string | null
}) {
  const generateUploadUrl = useMutation(api.users.generateAvatarUploadUrl)
  const setAvatar = useMutation(api.users.setAvatar)
  const removeAvatar = useMutation(api.users.removeAvatar)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBusy(true)
    setError(null)
    try {
      // Compression + upload, puis rattachement de l'avatar au profil.
      const storageId = await uploadImageFile(file, () => generateUploadUrl())
      await setAvatar({ storageId: storageId as Id<'_storage'> })
    } catch {
      setError("Échec de l'envoi de l'image.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <ImagePlus className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Photo de profil</h2>
      </div>
      <div className="flex items-center gap-4">
        <Avatar avatarUrl={avatarUrl} name={name} email={email} size={64} />
        <div className="flex flex-wrap gap-2">
          <label className="app-btn-ghost cursor-pointer">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            {avatarUrl ? 'Changer' : 'Ajouter une photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleChange}
              disabled={busy}
            />
          </label>
          {avatarUrl && (
            <button
              className="app-btn-danger"
              onClick={() => void removeAvatar()}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4" /> Retirer
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {error}
        </p>
      )}
    </div>
  )
}

/** Carte « Identité » : pseudo éditable + email en lecture seule. */
function IdentityCard({
  name,
  email,
}: {
  name: string | null
  email: string | null
}) {
  const updateProfile = useMutation(api.users.updateProfile)
  const [value, setValue] = useState(name ?? '')
  const [saved, setSaved] = useState(false)

  const dirty = value.trim() !== (name ?? '')

  async function save() {
    await updateProfile({ name: value })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="app-card flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Identité</h2>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">
          Pseudo (nom affiché)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="app-input flex-1"
            placeholder="Ex. Alex"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (dirty) void save()
            }}
          />
          <button
            className="app-btn-primary"
            onClick={() => void save()}
            disabled={!dirty}
          >
            <Save className="h-4 w-4" /> {saved ? 'Enregistré' : 'Enregistrer'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ce pseudo s'affiche dans l'app et pour vos budgets partagés.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Adresse email</label>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Mail className="h-4 w-4 shrink-0" />
          <span className="truncate">{email ?? '—'}</span>
          <span className="ml-auto text-xs">lecture seule</span>
        </div>
      </div>
    </div>
  )
}

/** Carte « Mot de passe » : ancien / nouveau / confirmer. */
function PasswordCard() {
  const changePassword = useAction(api.users.changePassword)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    // Validations côté client.
    if (next.length < 8) {
      setMsg({ ok: false, text: 'Le nouveau mot de passe doit faire au moins 8 caractères.' })
      return
    }
    if (next !== confirm) {
      setMsg({ ok: false, text: 'La confirmation ne correspond pas au nouveau mot de passe.' })
      return
    }
    setBusy(true)
    try {
      await changePassword({ currentPassword: current, newPassword: next })
      setMsg({ ok: true, text: 'Mot de passe mis à jour.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setMsg({ ok: false, text: cleanConvexError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="app-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Mot de passe</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Mot de passe actuel</label>
          <input
            type="password"
            autoComplete="current-password"
            className="app-input"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Nouveau (≥ 8 car.)</label>
          <input
            type="password"
            autoComplete="new-password"
            className="app-input"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Confirmer</label>
          <input
            type="password"
            autoComplete="new-password"
            className="app-input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="app-btn-primary"
          disabled={busy || !current || !next || !confirm}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Mettre à jour
        </button>
        {msg && (
          <span
            className={
              msg.ok
                ? 'text-sm text-emerald-700 dark:text-emerald-300'
                : 'text-sm text-amber-700 dark:text-amber-300'
            }
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  )
}

/**
 * Carte « Zone de danger » : suppression définitive du compte et des données.
 * Ouvre une modale de confirmation où l'utilisateur doit taper « SUPPRIMER ».
 */
function DangerZoneCard() {
  const [open, setOpen] = useState(false)

  return (
    <div className="app-card flex flex-col gap-3 border-destructive/40 p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <h2 className="font-semibold text-destructive">Zone de danger</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Supprimer votre compte efface définitivement toutes vos données (mois,
        avoir, épargne, lignes récurrentes, partages, photos). Cette action est
        irréversible.
      </p>
      <div>
        <button className="app-btn-danger" onClick={() => setOpen(true)}>
          <Trash2 className="h-4 w-4" /> Supprimer mon compte
        </button>
      </div>

      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Modale de confirmation de suppression (saisie du mot « SUPPRIMER »). */
function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const deleteAccount = useMutation(api.users.deleteAccount)
  const { signOut } = useAuthActions()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = confirm.trim().toUpperCase() === 'SUPPRIMER'

  async function handleDelete() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await deleteAccount({})
      // Compte supprimé : on nettoie l'état client (retour à l'écran de connexion).
      await signOut()
    } catch (err) {
      setError(cleanConvexError(err))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="app-card w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h2 className="font-semibold">Supprimer mon compte</h2>
          </div>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          Toutes vos données seront <strong>définitivement supprimées</strong> et
          vous ne pourrez plus vous reconnecter. Cette action est irréversible.
        </p>

        <label className="mt-4 block text-sm">
          Tapez <strong className="font-mono">SUPPRIMER</strong> pour confirmer :
          <input
            className="app-input mt-1 font-mono uppercase tracking-widest"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="SUPPRIMER"
            autoFocus
          />
        </label>

        {error && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button className="app-btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            className="app-btn-danger"
            onClick={() => void handleDelete()}
            disabled={!ready || busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Supprimer définitivement
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Avatar rond réutilisable : affiche la photo si disponible, sinon l'initiale
 * du pseudo/email, sinon une icône. `size` en pixels.
 */
export function Avatar({
  avatarUrl,
  name,
  email,
  size = 32,
}: {
  avatarUrl: string | null
  name: string | null
  email: string | null
  size?: number
}) {
  const initial = (name ?? email ?? '').trim().charAt(0).toUpperCase()
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-primary"
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt="Avatar"
          className="h-full w-full object-cover"
        />
      ) : initial ? (
        <span style={{ fontSize: size * 0.42 }} className="font-semibold">
          {initial}
        </span>
      ) : (
        <User style={{ width: size * 0.55, height: size * 0.55 }} />
      )}
    </span>
  )
}

/**
 * Extrait le message lisible d'une erreur Convex
 * (« [CONVEX A(...)] … Uncaught Error: msg at handler … » → `msg`).
 */
function cleanConvexError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.match(/Uncaught Error:\s*([^\n]*)/)
  return (m ? m[1] : raw).replace(/\s+at handler.*$/, '').trim() || 'Une erreur est survenue.'
}
