import { createFileRoute } from '@tanstack/react-router'
import LegalLayout, { LegalSection } from '../components/LegalLayout'

/**
 * Route PUBLIQUE "/mentions-legales".
 *
 * Mentions légales du site. Les informations propres à l'éditeur (nom, contact,
 * adresse) sont à compléter — repérées par « [À compléter] ».
 */
export const Route = createFileRoute('/mentions-legales')({
  component: MentionsLegales,
})

function MentionsLegales() {
  return (
    <LegalLayout title="Mentions légales">
      <p>
        Conformément à la législation en vigueur, voici les mentions légales du
        site <strong>Budget mensuel</strong>.
      </p>

      <LegalSection title="Éditeur du site">
        <p>
          Le site est édité par{' '}
          <strong>[À compléter : nom de l'éditeur]</strong>.
          <br />
          Contact : <strong>[À compléter : adresse e-mail de contact]</strong>.
          <br />
          Adresse : <strong>[À compléter : adresse postale, le cas échéant]</strong>.
        </p>
      </LegalSection>

      <LegalSection title="Hébergement">
        <p>
          Le site est hébergé par <strong>Vercel Inc.</strong> — 340 S Lemon Ave
          #4133, Walnut, CA 91789, États-Unis (
          <a
            href="https://vercel.com"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            vercel.com
          </a>
          ).
        </p>
        <p>
          Les données applicatives sont stockées et traitées via{' '}
          <strong>Convex</strong> (Convex, Inc. —{' '}
          <a
            href="https://convex.dev"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            convex.dev
          </a>
          ).
        </p>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          L'ensemble des éléments du site (structure, textes, interface, logo)
          est protégé par le droit de la propriété intellectuelle. Toute
          reproduction ou représentation, totale ou partielle, sans autorisation
          de l'éditeur est interdite.
        </p>
      </LegalSection>

      <LegalSection title="Responsabilité">
        <p>
          L'application est un outil de suivi de budget personnel fourni « en
          l'état ». L'éditeur ne saurait être tenu responsable des décisions
          financières prises sur la base des informations saisies par
          l'utilisateur.
        </p>
      </LegalSection>

      <LegalSection title="Données personnelles">
        <p>
          Le traitement de vos données personnelles est décrit dans notre{' '}
          <a href="/confidentialite" className="text-primary hover:underline">
            politique de confidentialité
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
