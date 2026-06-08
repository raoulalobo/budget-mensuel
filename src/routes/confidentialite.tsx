import { createFileRoute } from '@tanstack/react-router'
import LegalLayout, { LegalSection } from '../components/LegalLayout'

/**
 * Route PUBLIQUE "/confidentialite".
 *
 * Politique de confidentialité (RGPD). Le contact du responsable de traitement
 * est à compléter (« [À compléter] »).
 */
export const Route = createFileRoute('/confidentialite')({
  component: Confidentialite,
})

function Confidentialite() {
  return (
    <LegalLayout title="Politique de confidentialité">
      <p>
        Cette politique explique quelles données <strong>Budget mensuel</strong>{' '}
        collecte, pourquoi, et quels sont vos droits.
      </p>

      <LegalSection title="Données collectées">
        <ul className="list-disc pl-5">
          <li>
            <strong>Compte</strong> : votre adresse e-mail et votre mot de passe
            (stocké de façon chiffrée/haché, jamais en clair).
          </li>
          <li>
            <strong>Données budgétaires</strong> : les informations que vous
            saisissez (mois, lignes, montants, patrimoine, objectifs, notes,
            tags) et les fichiers que vous joignez (photos de tickets, avatar).
          </li>
          <li>
            <strong>Partage</strong> : les liens entre comptes que vous créez
            (membres invités, rôles).
          </li>
        </ul>
        <p>
          Aucune donnée n'est revendue. Aucun traceur publicitaire tiers n'est
          utilisé.
        </p>
      </LegalSection>

      <LegalSection title="Finalité du traitement">
        <p>
          Vos données servent uniquement à fournir le service : afficher et
          calculer votre budget, générer des graphiques et des récapitulatifs,
          et permettre le partage que vous décidez.
        </p>
      </LegalSection>

      <LegalSection title="Fonctionnalités d'IA">
        <p>
          Lorsque vous utilisez l'analyse de tickets par photo ou l'assistant /
          les récapitulatifs IA, les données concernées (image ou extrait de vos
          chiffres) sont transmises à des prestataires d'IA aux seules fins de
          produire le résultat demandé. Ces fonctionnalités ne s'activent que sur
          votre action.
        </p>
      </LegalSection>

      <LegalSection title="Hébergement & sous-traitants">
        <p>
          Les données sont hébergées via <strong>Convex</strong> (base de données
          et stockage de fichiers) et le site est servi par <strong>Vercel</strong>.
        </p>
      </LegalSection>

      <LegalSection title="Durée de conservation">
        <p>
          Vos données sont conservées tant que votre compte existe. Vous pouvez{' '}
          <strong>supprimer votre compte et toutes vos données à tout moment</strong>{' '}
          depuis votre profil : la suppression est immédiate et irréversible.
        </p>
      </LegalSection>

      <LegalSection title="Vos droits (RGPD)">
        <p>
          Vous disposez d'un droit d'accès, de rectification, de portabilité et
          d'effacement de vos données. L'accès et la rectification se font
          directement dans l'application ; l'effacement via la suppression de
          compte. Pour toute autre demande, contactez le responsable de
          traitement : <strong>[À compléter : adresse e-mail de contact]</strong>.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          L'application n'utilise que le stockage strictement nécessaire à son
          fonctionnement (session d'authentification, préférence de thème). Aucun
          cookie de suivi publicitaire n'est déposé.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
