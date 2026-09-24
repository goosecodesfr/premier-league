// Nation codes (FIFA-style) with display names and flags.

const RAW: [string, string, string][] = [
  // [FIFA code, name, ISO alpha-2 or special]
  ['ENG', 'England', 'gb-eng'], ['SCO', 'Scotland', 'gb-sct'], ['WAL', 'Wales', 'gb-wls'], ['NIR', 'Northern Ireland', 'gb'],
  ['IRL', 'Republic of Ireland', 'ie'], ['GER', 'Germany', 'de'], ['ARG', 'Argentina', 'ar'], ['ESP', 'Spain', 'es'],
  ['FRA', 'France', 'fr'], ['BRA', 'Brazil', 'br'], ['ITA', 'Italy', 'it'], ['NED', 'Netherlands', 'nl'], ['NOR', 'Norway', 'no'],
  ['USA', 'United States', 'us'], ['KOR', 'Korea Republic', 'kr'], ['SWE', 'Sweden', 'se'], ['CHN', 'China PR', 'cn'],
  ['DEN', 'Denmark', 'dk'], ['KSA', 'Saudi Arabia', 'sa'], ['POR', 'Portugal', 'pt'], ['POL', 'Poland', 'pl'],
  ['BEL', 'Belgium', 'be'], ['AUS', 'Australia', 'au'], ['IND', 'India', 'in'], ['ROU', 'Romania', 'ro'], ['AUT', 'Austria', 'at'],
  ['TUR', 'Türkiye', 'tr'], ['URU', 'Uruguay', 'uy'], ['SUI', 'Switzerland', 'ch'], ['COL', 'Colombia', 'co'], ['CHI', 'Chile', 'cl'],
  ['CRO', 'Croatia', 'hr'], ['PAR', 'Paraguay', 'py'], ['NGA', 'Nigeria', 'ng'], ['CIV', "Côte d'Ivoire", 'ci'], ['MAR', 'Morocco', 'ma'],
  ['SEN', 'Senegal', 'sn'], ['GHA', 'Ghana', 'gh'], ['ECU', 'Ecuador', 'ec'], ['SRB', 'Serbia', 'rs'], ['VEN', 'Venezuela', 've'],
  ['PER', 'Peru', 'pe'], ['GRE', 'Greece', 'gr'], ['JPN', 'Japan', 'jp'], ['UKR', 'Ukraine', 'ua'], ['CZE', 'Czechia', 'cz'],
  ['CAN', 'Canada', 'ca'], ['FIN', 'Finland', 'fi'], ['CMR', 'Cameroon', 'cm'], ['BOL', 'Bolivia', 'bo'], ['MLI', 'Mali', 'ml'],
  ['KVX', 'Kosovo', 'xk'], ['BIH', 'Bosnia and Herzegovina', 'ba'], ['HUN', 'Hungary', 'hu'], ['ISL', 'Iceland', 'is'],
  ['ALG', 'Algeria', 'dz'], ['ALB', 'Albania', 'al'], ['SVK', 'Slovakia', 'sk'], ['NZL', 'New Zealand', 'nz'], ['SVN', 'Slovenia', 'si'],
  ['COD', 'Congo DR', 'cd'], ['MEX', 'Mexico', 'mx'], ['JAM', 'Jamaica', 'jm'], ['GAM', 'Gambia', 'gm'], ['GUI', 'Guinea', 'gn'],
  ['GEO', 'Georgia', 'ge'], ['TUN', 'Tunisia', 'tn'], ['SUR', 'Suriname', 'sr'], ['ANG', 'Angola', 'ao'], ['QAT', 'Qatar', 'qa'],
  ['CPV', 'Cabo Verde', 'cv'], ['BFA', 'Burkina Faso', 'bf'], ['CYP', 'Cyprus', 'cy'], ['MNE', 'Montenegro', 'me'],
  ['GNB', 'Guinea-Bissau', 'gw'], ['BUL', 'Bulgaria', 'bg'], ['ISR', 'Israel', 'il'], ['TOG', 'Togo', 'tg'], ['RUS', 'Russia', 'ru'],
  ['MKD', 'North Macedonia', 'mk'], ['SLE', 'Sierra Leone', 'sl'], ['ZIM', 'Zimbabwe', 'zw'], ['RSA', 'South Africa', 'za'],
  ['CGO', 'Congo', 'cg'], ['LUX', 'Luxembourg', 'lu'], ['PAN', 'Panama', 'pa'], ['CUW', 'Curacao', 'cw'], ['AZE', 'Azerbaijan', 'az'],
  ['HAI', 'Haiti', 'ht'], ['IDN', 'Indonesia', 'id'], ['SYR', 'Syria', 'sy'], ['IRQ', 'Iraq', 'iq'], ['COM', 'Comoros', 'km'],
  ['CRC', 'Costa Rica', 'cr'], ['KEN', 'Kenya', 'ke'], ['HON', 'Honduras', 'hn'], ['EQG', 'Equatorial Guinea', 'gq'],
  ['UAE', 'United Arab Emirates', 'ae'], ['EGY', 'Egypt', 'eg'], ['GAB', 'Gabon', 'ga'], ['MTN', 'Mauritania', 'mr'],
  ['LTU', 'Lithuania', 'lt'], ['ARM', 'Armenia', 'am'], ['DOM', 'Dominican Republic', 'do'], ['BEN', 'Benin', 'bj'],
  ['HKG', 'Hong Kong', 'hk'], ['MLT', 'Malta', 'mt'], ['GRN', 'Grenada', 'gd'], ['ZAM', 'Zambia', 'zm'],
  ['TRI', 'Trinidad and Tobago', 'tt'], ['LVA', 'Latvia', 'lv'], ['MDA', 'Moldova', 'md'], ['UGA', 'Uganda', 'ug'],
  ['GUY', 'Guyana', 'gy'], ['EST', 'Estonia', 'ee'], ['LBR', 'Liberia', 'lr'], ['MAD', 'Madagascar', 'mg'], ['IRN', 'Iran', 'ir'],
  ['UZB', 'Uzbekistan', 'uz'], ['CTA', 'Central African Republic', 'cf'], ['MOZ', 'Mozambique', 'mz'], ['PHI', 'Philippines', 'ph'],
  ['PLE', 'Palestine', 'ps'], ['SLV', 'El Salvador', 'sv'], ['GUA', 'Guatemala', 'gt'], ['ATG', 'Antigua and Barbuda', 'ag'],
  ['SKN', 'Saint Kitts and Nevis', 'kn'], ['FRO', 'Faroe Islands', 'fo'], ['TPE', 'Chinese Taipei', 'tw'], ['BDI', 'Burundi', 'bi'],
  ['LBY', 'Libya', 'ly'], ['JOR', 'Jordan', 'jo'], ['TAN', 'Tanzania', 'tz'], ['LCA', 'Saint Lucia', 'lc'], ['BLR', 'Belarus', 'by'],
  ['MSR', 'Montserrat', 'ms'], ['BER', 'Bermuda', 'bm'], ['MAS', 'Malaysia', 'my'], ['RWA', 'Rwanda', 'rw'], ['MWI', 'Malawi', 'mw'],
  ['LBN', 'Lebanon', 'lb'], ['CUB', 'Cuba', 'cu'], ['YEM', 'Yemen', 'ye'], ['BAN', 'Bangladesh', 'bd'], ['CHA', 'Chad', 'td'],
  ['VAN', 'Vanuatu', 'vu'], ['NIG', 'Niger', 'ne'], ['NAM', 'Namibia', 'na'], ['AFG', 'Afghanistan', 'af'], ['SRI', 'Sri Lanka', 'lk'],
  ['SOM', 'Somalia', 'so'], ['PAK', 'Pakistan', 'pk'], ['NCL', 'New Caledonia', 'nc'], ['THA', 'Thailand', 'th'], ['BRB', 'Barbados', 'bb'],
  ['TJK', 'Tajikistan', 'tj'], ['LIE', 'Liechtenstein', 'li'], ['PUR', 'Puerto Rico', 'pr'], ['GIB', 'Gibraltar', 'gi'], ['AND', 'Andorra', 'ad'],
  ['MOZ', 'Mozambique', 'mz'], ['HAI', 'Haiti', 'ht'],
];

export interface Nation { code: string; name: string; flag: string }

function flagEmoji(iso: string): string {
  const special: Record<string, string> = {
    'gb-eng': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'gb-sct': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
    'gb-wls': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
  };
  if (special[iso]) return special[iso];
  if (iso.length !== 2) return '\u{1F3F3}';
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const NATIONS: Record<string, Nation> = {};
export const NATION_BY_NAME: Record<string, Nation> = {};
for (const [code, name, iso] of RAW) {
  const n = { code, name, flag: flagEmoji(iso) };
  NATIONS[code] = n;
  NATION_BY_NAME[name] = n;
}
// Common alternative spellings / codes
const ALIASES: Record<string, string> = {
  'Ivory Coast': 'CIV', Turkey: 'TUR', 'Czech Republic': 'CZE', 'South Korea': 'KOR', 'DR Congo': 'COD', 'Cape Verde': 'CPV',
  'Bosnia & Herzegovina': 'BIH', USA: 'USA', 'Korea, South': 'KOR',
};
for (const [alias, code] of Object.entries(ALIASES)) NATION_BY_NAME[alias] = NATIONS[code];
// Wikipedia sometimes uses these codes
export const CODE_ALIASES: Record<string, string> = { DRC: 'COD', NLD: 'NED', GBR: 'ENG', SLO: 'SVN', CZR: 'CZE' };

export function nation(code: string | null | undefined): Nation {
  if (!code) return { code: '---', name: 'Unknown', flag: '\u{1F3F3}' };
  const c = CODE_ALIASES[code] ?? code;
  return NATIONS[c] ?? { code: c, name: c, flag: '\u{1F3F3}' };
}
