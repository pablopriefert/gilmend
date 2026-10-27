// What the public record says about damaged parcels, read on 27 Oct 2026. Each entry says what
// the figure measures and what it does not, because the temptation is to turn a survey into a
// damage rate and the calculator must not: its damage rate is a labelled assumption.

export interface ImpactSource {
  id: string;
  title: string;
  /** Language of the title and the source (ISO 639-1), for assistive technology. */
  language: string;
  publisher: string;
  url: string;
  /** ISO date the source was published. */
  publishedOn: string;
  /** ISO date a person last read it. */
  checkedOn: string;
  /** The figures, as the source gives them. */
  figures: string[];
  /** What these figures are not. */
  caveat: string;
}

export const IMPACT_SOURCES: readonly ImpactSource[] = [
  {
    id: "ds-smith-opinium-2026",
    language: "fr",
    title: "Les colis endommagés coûtent 2,3 milliards d'euros par an aux e-commerçants français",
    publisher: "Ecommerce Magazine, reporting a DS Smith study run by Opinium",
    url: "https://www.ecommercemag.fr/logistique-1222/barometre-etude-2182/les-colis-endommages-coutent-23-milliards-deuros-par-an-aux-e-commercants-francais-55038",
    publishedOn: "2026-01-07",
    checkedOn: "2026-10-27",
    figures: [
      "22% of French consumers say they received at least one damaged product in the previous 12 months.",
      "An average cost of 76.50 EUR per damaged article for the merchant, logistics, refunds and customer service included.",
      "2.3 billion EUR a year for French e-commerce, as the study estimates it.",
    ],
    caveat:
      "A survey of 2,000 consumers (data collected in October 2025), commissioned by a packaging supplier. It counts consumers who had a problem, not damaged parcels per 100 shipped, so it gives no per-parcel damage rate and the calculator does not derive one from it.",
  },
  {
    id: "lsa-ds-smith-2026",
    language: "fr",
    title: "E-commerce : les colis endommagés coûtent 2,3 milliards d'euros aux marchands français, selon une étude",
    publisher: "LSA",
    url: "https://www.lsa-conso.fr/e-commerce-les-colis-endommages-coutent-2-3-milliards-d-euros-aux-marchands-francais-selon-une-etude,463876/",
    publishedOn: "2026-01-08",
    checkedOn: "2026-10-27",
    figures: [
      "The same DS Smith and Opinium study: published on 7 January 2026, 2,000 consumers representative of the French population, data collected in October 2025.",
      "About 12 million French people received a damaged product in 2025; household items such as dishes and glass are among the most affected.",
    ],
    caveat: "Second report of the same study, read for its method. Behind a paywall beyond the first paragraphs.",
  },
];
