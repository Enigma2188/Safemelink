/** Category identity, not danger/severity. No automatic mapping of legacy categories. */
export const NETWORK_CATEGORY_IDS_V2 = Object.freeze([
  'CIVIC_SAFETY',
  'ROADS_TRAFFIC',
  'LIGHTING',
  'ENVIRONMENT_DECORUM',
  'COMMUNITY_INFORMATION',
] as const);

export type NetworkCategoryIdV2 = (typeof NETWORK_CATEGORY_IDS_V2)[number];
export type NetworkCategoryIconV2 = 'shield' | 'road' | 'lightbulb' | 'leaf' | 'information';

export const NETWORK_CATEGORY_NAVY_V2 = '#061B36';

type CategoryDefinition = Readonly<{
  label: string;
  color: string;
  iconId: NetworkCategoryIconV2;
  iconForeground: typeof NETWORK_CATEGORY_NAVY_V2;
}>;

// Accent on navy OR navy text/glyph on filled accent. Not white on yellow/orange.
// Labels + semantic icons must accompany colors in future UI; actual rendering untested.
export const NETWORK_CATEGORY_REGISTRY_V2 = Object.freeze({
  CIVIC_SAFETY: Object.freeze({ label: 'Sicurezza', color: '#FF6474', iconId: 'shield', iconForeground: NETWORK_CATEGORY_NAVY_V2 }),
  ROADS_TRAFFIC: Object.freeze({ label: 'Strade e viabilità', color: '#FFB454', iconId: 'road', iconForeground: NETWORK_CATEGORY_NAVY_V2 }),
  LIGHTING: Object.freeze({ label: 'Illuminazione', color: '#FFE066', iconId: 'lightbulb', iconForeground: NETWORK_CATEGORY_NAVY_V2 }),
  ENVIRONMENT_DECORUM: Object.freeze({ label: 'Ambiente e decoro', color: '#42D6C4', iconId: 'leaf', iconForeground: NETWORK_CATEGORY_NAVY_V2 }),
  COMMUNITY_INFORMATION: Object.freeze({ label: 'Servizi pubblici', color: '#79B8FF', iconId: 'information', iconForeground: NETWORK_CATEGORY_NAVY_V2 }),
} as const satisfies Record<NetworkCategoryIdV2, CategoryDefinition>);

export const isNetworkCategoryIdV2 = (value: unknown): value is NetworkCategoryIdV2 =>
  typeof value === 'string' && NETWORK_CATEGORY_IDS_V2.some(id => id === value);
