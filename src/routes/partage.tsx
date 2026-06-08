import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  Users,
  UserPlus,
  LogIn,
  Copy,
  Check,
  Trash2,
  Crown,
  Pencil,
  Eye,
  DoorOpen,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { SkeletonCard } from '../components/Skeleton'

/**
 * Route /partage : gestion du BUDGET PARTAGÉ.
 *
 * Permet à l'utilisateur de :
 *  - rejoindre le budget de quelqu'un via un CODE ;
 *  - (s'il est propriétaire) inviter par code avec un rôle (éditeur/lecteur),
 *    gérer les membres (changer leur rôle, les retirer) ;
 *  - (s'il est membre invité) quitter un budget partagé.
 *
 * Toutes les actions passent par `api.sharing.*` ; l'affichage se met à jour en
 * temps réel.
 */
export const Route = createFileRoute('/partage')({
  component: SharePage,
})

type Role = 'owner' | 'editor' | 'viewer'

function SharePage() {
  const team = useQuery(api.sharing.budgetTeam)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Partage du budget</h1>
          <p className="text-sm text-muted-foreground">
            Invitez votre conjoint·e ou vos proches à consulter ou co-gérer votre
            budget — ou rejoignez le leur.
          </p>
        </div>
      </div>

      {/* Rejoindre un budget via un code (toujours disponible). */}
      <JoinCard />

      {team === undefined ? (
        <SkeletonCard lines={3} />
      ) : team === null ? null : team.isOwner ? (
        // Propriétaire de l'espace regardé : invitations + gestion des membres.
        <>
          <InviteCard />
          <MembersCard team={team} />
        </>
      ) : (
        // Invité dans cet espace : information + quitter.
        <MemberView team={team} />
      )}
    </div>
  )
}

/** Carte « Rejoindre un budget » : saisie d'un code d'invitation. */
function JoinCard() {
  const redeem = useMutation(api.sharing.redeemInvite)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    const c = code.trim()
    if (!c) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await redeem({ code: c })
      setMsg({
        ok: true,
        text: `Vous avez rejoint le budget de ${res.ownerLabel} (${roleLabel(res.role)}).`,
      })
      setCode('')
    } catch (err) {
      setMsg({ ok: false, text: cleanConvexError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleJoin} className="app-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <LogIn className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Rejoindre un budget</h2>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-muted-foreground">
            Code d'invitation reçu
          </label>
          <input
            className="app-input font-mono uppercase tracking-widest"
            placeholder="Ex. ABX7-K9P2"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button type="submit" className="app-btn-primary" disabled={busy || !code.trim()}>
          <LogIn className="h-4 w-4" /> Rejoindre
        </button>
      </div>
      {msg && (
        <p
          className={
            msg.ok
              ? 'rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
          }
        >
          {msg.text}
        </p>
      )}
    </form>
  )
}

/** Carte « Inviter » : génération d'un code avec rôle + liste des codes en attente. */
function InviteCard() {
  const team = useQuery(api.sharing.budgetTeam)
  const createInvite = useMutation(api.sharing.createInvite)
  const revokeInvite = useMutation(api.sharing.revokeInvite)
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGenerate() {
    const res = await createInvite({ role })
    setLastCode(res.code)
    setCopied(false)
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* presse-papier indisponible : l'utilisateur copie manuellement */
    }
  }

  const invites = team?.invites ?? []

  return (
    <div className="app-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Inviter quelqu'un</h2>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Rôle accordé</label>
          <select
            className="app-input"
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
          >
            <option value="editor">Éditeur (peut modifier)</option>
            <option value="viewer">Lecteur (consultation seule)</option>
          </select>
        </div>
        <button type="button" className="app-btn-primary" onClick={() => void handleGenerate()}>
          <UserPlus className="h-4 w-4" /> Générer un code
        </button>
      </div>

      {/* Dernier code généré, mis en avant pour copie/partage. */}
      {lastCode && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Partagez ce code (SMS, WhatsApp…). Usage unique.
            </p>
            <p className="font-mono text-xl font-bold tracking-widest">{lastCode}</p>
          </div>
          <button className="app-btn-ghost px-3" onClick={() => void copy(lastCode)}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
      )}

      {/* Codes en attente d'utilisation. */}
      {invites.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            Codes en attente ({invites.length})
          </p>
          {invites.map((inv) => (
            <div
              key={inv.inviteId}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="font-mono font-semibold tracking-widest">{inv.code}</span>
              <RoleBadge role={inv.role} />
              <div className="ml-auto flex items-center gap-1">
                <button
                  className="app-btn-ghost px-2 text-xs"
                  onClick={() => void copy(inv.code)}
                  title="Copier"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void revokeInvite({ inviteId: inv.inviteId })}
                  title="Révoquer ce code"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Carte « Membres » (vue propriétaire) : rôles + retrait. */
function MembersCard({
  team,
}: {
  team: NonNullable<ReturnType<typeof useTeam>>
}) {
  const setMemberRole = useMutation(api.sharing.setMemberRole)
  const removeMember = useMutation(api.sharing.removeMember)

  return (
    <div className="app-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Membres ({team.members.length})</h2>
      </div>
      <div className="flex flex-col gap-1">
        {team.members.map((m) => (
          <div
            key={m.userId}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="flex-1 truncate">
              {m.label}
              {m.isSelf && <span className="text-muted-foreground"> (vous)</span>}
            </span>
            {m.role === 'owner' ? (
              <RoleBadge role="owner" />
            ) : (
              <>
                {/* Le propriétaire peut changer le rôle d'un membre. */}
                <select
                  className="rounded border border-input bg-background px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
                  value={m.role}
                  onChange={(e) =>
                    void setMemberRole({
                      memberId: m.userId,
                      role: e.target.value as 'editor' | 'viewer',
                    })
                  }
                >
                  <option value="editor">Éditeur</option>
                  <option value="viewer">Lecteur</option>
                </select>
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void removeMember({ memberId: m.userId })}
                  title="Retirer ce membre"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Vue d'un invité (non propriétaire) : son rôle + bouton « Quitter ». */
function MemberView({
  team,
}: {
  team: NonNullable<ReturnType<typeof useTeam>>
}) {
  const leaveBudget = useMutation(api.sharing.leaveBudget)
  const owner = team.members.find((m) => m.role === 'owner')

  return (
    <div className="app-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Budget partagé de {owner?.label ?? '—'}</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Vous êtes <RoleBadge role={team.myRole} /> sur cet espace.
      </p>
      <div>
        <button
          className="app-btn-danger"
          onClick={() => void leaveBudget({ ownerId: team.ownerId })}
          title="Quitter ce budget partagé"
        >
          <DoorOpen className="h-4 w-4" /> Quitter ce budget
        </button>
      </div>
    </div>
  )
}

/** Badge coloré + icône d'un rôle. */
function RoleBadge({ role }: { role: Role }) {
  const map = {
    owner: { icon: <Crown className="h-3 w-3" />, label: 'Propriétaire' },
    editor: { icon: <Pencil className="h-3 w-3" />, label: 'Éditeur' },
    viewer: { icon: <Eye className="h-3 w-3" />, label: 'Lecteur' },
  }[role]
  return (
    <span className="app-badge inline-flex items-center gap-1 bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {map.icon}
      {map.label}
    </span>
  )
}

/** Libellé français d'un rôle (pour les messages). */
function roleLabel(role: Role): string {
  return role === 'owner' ? 'propriétaire' : role === 'editor' ? 'éditeur' : 'lecteur'
}

/**
 * Extrait le message lisible d'une erreur Convex.
 * Convex enrobe les `throw new Error('msg')` côté serveur dans une chaîne du type
 * « [CONVEX M(...)] … Uncaught Error: msg at handler (…) ». On ne garde que `msg`.
 */
function cleanConvexError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.match(/Uncaught Error:\s*([^\n]*)/)
  return (m ? m[1] : raw).replace(/\s+at handler.*$/, '').trim() || 'Code invalide.'
}

// Alias de type pour les props (la query `budgetTeam` n'a pas de type exporté).
function useTeam() {
  return useQuery(api.sharing.budgetTeam)
}
