// Club metadata for the world seed. Colours are club identities (no badges or crests).
// league: PL = Premier League, EUR = European pool, CHAMP = lower-league (Championship) pool.

export type ArchetypeKey = 'purist' | 'pragmatist' | 'gegenpresser' | 'counter' | 'cynic' | 'youth' | 'chequebook' | 'tinkerman';

export interface ClubMeta {
  key: string; // 3-letter code, unique
  name: string;
  short: string;
  dataset: string; // club_name in the ratings dataset
  league: 'PL' | 'EUR' | 'CHAMP';
  country: string; // FIFA-style nation code
  colors: [string, string];
  stadium: string;
  capacity: number;
  reputation: number; // 1..100
  archetype: ArchetypeKey;
  rivals?: string[];
  lastPos?: number; // last season's finishing position (PL only)
  europe?: 'UCL' | 'UEL';
}

export const CLUBS: ClubMeta[] = [
  // ---------------- Premier League 2026-27 ----------------
  { key: 'ARS', name: 'Arsenal', short: 'Arsenal', dataset: 'Arsenal', league: 'PL', country: 'ENG', colors: ['#EF0107', '#FFFFFF'], stadium: 'Emirates Stadium', capacity: 60704, reputation: 92, archetype: 'purist', rivals: ['TOT', 'CHE'], lastPos: 1, europe: 'UCL' },
  { key: 'MCI', name: 'Manchester City', short: 'Man City', dataset: 'Manchester City', league: 'PL', country: 'ENG', colors: ['#6CABDD', '#1C2C5B'], stadium: 'Etihad Stadium', capacity: 61470, reputation: 95, archetype: 'purist', rivals: ['MUN'], lastPos: 2, europe: 'UCL' },
  { key: 'MUN', name: 'Manchester United', short: 'Man United', dataset: 'Manchester United', league: 'PL', country: 'ENG', colors: ['#DA291C', '#FBE122'], stadium: 'Old Trafford', capacity: 74197, reputation: 89, archetype: 'tinkerman', rivals: ['MCI', 'LIV', 'LEE'], lastPos: 3, europe: 'UCL' },
  { key: 'AVL', name: 'Aston Villa', short: 'Aston Villa', dataset: 'Aston Villa', league: 'PL', country: 'ENG', colors: ['#95BFE5', '#670E36'], stadium: 'Villa Park', capacity: 42640, reputation: 81, archetype: 'pragmatist', rivals: [], lastPos: 4, europe: 'UCL' },
  { key: 'LIV', name: 'Liverpool', short: 'Liverpool', dataset: 'Liverpool', league: 'PL', country: 'ENG', colors: ['#C8102E', '#F6EB61'], stadium: 'Anfield', capacity: 61276, reputation: 94, archetype: 'gegenpresser', rivals: ['EVE', 'MUN'], lastPos: 5, europe: 'UCL' },
  { key: 'BOU', name: 'AFC Bournemouth', short: 'Bournemouth', dataset: 'AFC Bournemouth', league: 'PL', country: 'ENG', colors: ['#DA291C', '#111111'], stadium: 'Vitality Stadium', capacity: 11307, reputation: 71, archetype: 'gegenpresser', rivals: [], lastPos: 6, europe: 'UEL' },
  { key: 'SUN', name: 'Sunderland', short: 'Sunderland', dataset: 'Sunderland', league: 'PL', country: 'ENG', colors: ['#EB172B', '#FFFFFF'], stadium: 'Stadium of Light', capacity: 48707, reputation: 70, archetype: 'youth', rivals: ['NEW'], lastPos: 7, europe: 'UEL' },
  { key: 'BHA', name: 'Brighton & Hove Albion', short: 'Brighton', dataset: 'Brighton & Hove Albion', league: 'PL', country: 'ENG', colors: ['#0057B8', '#FFFFFF'], stadium: 'Amex Stadium', capacity: 31876, reputation: 75, archetype: 'youth', rivals: ['CRY'], lastPos: 8, europe: 'UEL' },
  { key: 'BRE', name: 'Brentford', short: 'Brentford', dataset: 'Brentford', league: 'PL', country: 'ENG', colors: ['#E30613', '#FBB800'], stadium: 'Gtech Community Stadium', capacity: 17250, reputation: 70, archetype: 'pragmatist', rivals: ['FUL', 'CHE'], lastPos: 9 },
  { key: 'CHE', name: 'Chelsea', short: 'Chelsea', dataset: 'Chelsea', league: 'PL', country: 'ENG', colors: ['#034694', '#DBA111'], stadium: 'Stamford Bridge', capacity: 40173, reputation: 89, archetype: 'chequebook', rivals: ['TOT', 'ARS', 'FUL'], lastPos: 10 },
  { key: 'FUL', name: 'Fulham', short: 'Fulham', dataset: 'Fulham FC', league: 'PL', country: 'ENG', colors: ['#FFFFFF', '#CC0000'], stadium: 'Craven Cottage', capacity: 29589, reputation: 70, archetype: 'pragmatist', rivals: ['CHE', 'BRE'], lastPos: 11 },
  { key: 'NEW', name: 'Newcastle United', short: 'Newcastle', dataset: 'Newcastle United', league: 'PL', country: 'ENG', colors: ['#241F20', '#41B6E6'], stadium: "St James' Park", capacity: 52305, reputation: 83, archetype: 'gegenpresser', rivals: ['SUN'], lastPos: 12 },
  { key: 'EVE', name: 'Everton', short: 'Everton', dataset: 'Everton', league: 'PL', country: 'ENG', colors: ['#003399', '#FFFFFF'], stadium: 'Hill Dickinson Stadium', capacity: 52888, reputation: 74, archetype: 'cynic', rivals: ['LIV'], lastPos: 13 },
  { key: 'LEE', name: 'Leeds United', short: 'Leeds', dataset: 'Leeds United', league: 'PL', country: 'ENG', colors: ['#FFFFFF', '#1D428A'], stadium: 'Elland Road', capacity: 37645, reputation: 72, archetype: 'purist', rivals: ['MUN', 'HUL'], lastPos: 14 },
  { key: 'CRY', name: 'Crystal Palace', short: 'Crystal Palace', dataset: 'Crystal Palace', league: 'PL', country: 'ENG', colors: ['#1B458F', '#C4122E'], stadium: 'Selhurst Park', capacity: 25486, reputation: 73, archetype: 'counter', rivals: ['BHA'], lastPos: 15 },
  { key: 'NFO', name: 'Nottingham Forest', short: "Nott'm Forest", dataset: 'Nottingham Forest', league: 'PL', country: 'ENG', colors: ['#DD0000', '#FFFFFF'], stadium: 'City Ground', capacity: 30404, reputation: 73, archetype: 'counter', rivals: [], lastPos: 16 },
  { key: 'TOT', name: 'Tottenham Hotspur', short: 'Spurs', dataset: 'Tottenham Hotspur', league: 'PL', country: 'ENG', colors: ['#132257', '#FFFFFF'], stadium: 'Tottenham Hotspur Stadium', capacity: 62850, reputation: 85, archetype: 'gegenpresser', rivals: ['ARS', 'CHE'], lastPos: 17 },
  { key: 'COV', name: 'Coventry City', short: 'Coventry', dataset: 'Coventry City', league: 'PL', country: 'ENG', colors: ['#59B7E8', '#FFFFFF'], stadium: 'Coventry Building Society Arena', capacity: 32609, reputation: 61, archetype: 'pragmatist', rivals: [], lastPos: 18 },
  { key: 'IPS', name: 'Ipswich Town', short: 'Ipswich', dataset: 'Ipswich Town', league: 'PL', country: 'ENG', colors: ['#0044A9', '#FFFFFF'], stadium: 'Portman Road', capacity: 30056, reputation: 62, archetype: 'purist', rivals: [], lastPos: 19 },
  { key: 'HUL', name: 'Hull City', short: 'Hull', dataset: 'Hull City', league: 'PL', country: 'ENG', colors: ['#F5A12D', '#111111'], stadium: 'MKM Stadium', capacity: 25586, reputation: 60, archetype: 'counter', rivals: ['LEE'], lastPos: 20 },

  // ---------------- European pool ----------------
  { key: 'RMA', name: 'Real Madrid', short: 'Real Madrid', dataset: 'Real Madrid', league: 'EUR', country: 'ESP', colors: ['#FFFFFF', '#FEBE10'], stadium: 'Santiago Bernabéu', capacity: 83186, reputation: 99, archetype: 'chequebook', rivals: ['BAR', 'ATM'] },
  { key: 'BAR', name: 'FC Barcelona', short: 'Barcelona', dataset: 'FC Barcelona', league: 'EUR', country: 'ESP', colors: ['#A50044', '#004D98'], stadium: 'Spotify Camp Nou', capacity: 99354, reputation: 96, archetype: 'purist', rivals: ['RMA'] },
  { key: 'ATM', name: 'Atlético Madrid', short: 'Atlético', dataset: 'Atlético Madrid', league: 'EUR', country: 'ESP', colors: ['#CB3524', '#272E61'], stadium: 'Riyadh Air Metropolitano', capacity: 70692, reputation: 88, archetype: 'cynic', rivals: ['RMA'] },
  { key: 'ATH', name: 'Athletic Club', short: 'Athletic', dataset: 'Athletic Club', league: 'EUR', country: 'ESP', colors: ['#EE2523', '#FFFFFF'], stadium: 'San Mamés', capacity: 53289, reputation: 79, archetype: 'gegenpresser', rivals: ['RSO'] },
  { key: 'BET', name: 'Real Betis', short: 'Real Betis', dataset: 'Real Betis Balompié', league: 'EUR', country: 'ESP', colors: ['#0BB363', '#FFFFFF'], stadium: 'Benito Villamarín', capacity: 60721, reputation: 76, archetype: 'purist', rivals: ['SEV'] },
  { key: 'VIL', name: 'Villarreal', short: 'Villarreal', dataset: 'Villarreal CF', league: 'EUR', country: 'ESP', colors: ['#FFE667', '#005187'], stadium: 'Estadio de la Cerámica', capacity: 23008, reputation: 78, archetype: 'pragmatist' },
  { key: 'RSO', name: 'Real Sociedad', short: 'Real Sociedad', dataset: 'Real Sociedad', league: 'EUR', country: 'ESP', colors: ['#0067B1', '#FFFFFF'], stadium: 'Reale Arena', capacity: 39313, reputation: 77, archetype: 'youth', rivals: ['ATH'] },
  { key: 'SEV', name: 'Sevilla', short: 'Sevilla', dataset: 'Sevilla FC', league: 'EUR', country: 'ESP', colors: ['#FFFFFF', '#D71920'], stadium: 'Ramón Sánchez-Pizjuán', capacity: 43883, reputation: 77, archetype: 'tinkerman', rivals: ['BET'] },
  { key: 'BAY', name: 'Bayern Munich', short: 'Bayern', dataset: 'FC Bayern München', league: 'EUR', country: 'GER', colors: ['#DC052D', '#0066B2'], stadium: 'Allianz Arena', capacity: 75024, reputation: 96, archetype: 'purist', rivals: ['BVB'] },
  { key: 'BVB', name: 'Borussia Dortmund', short: 'Dortmund', dataset: 'Borussia Dortmund', league: 'EUR', country: 'GER', colors: ['#FDE100', '#000000'], stadium: 'Signal Iduna Park', capacity: 81365, reputation: 87, archetype: 'gegenpresser', rivals: ['BAY'] },
  { key: 'B04', name: 'Bayer Leverkusen', short: 'Leverkusen', dataset: 'Bayer 04 Leverkusen', league: 'EUR', country: 'GER', colors: ['#E32221', '#000000'], stadium: 'BayArena', capacity: 30210, reputation: 85, archetype: 'purist' },
  { key: 'RBL', name: 'RB Leipzig', short: 'Leipzig', dataset: 'RB Leipzig', league: 'EUR', country: 'GER', colors: ['#DD0741', '#FFFFFF'], stadium: 'Red Bull Arena', capacity: 47069, reputation: 80, archetype: 'gegenpresser' },
  { key: 'SGE', name: 'Eintracht Frankfurt', short: 'Frankfurt', dataset: 'Eintracht Frankfurt', league: 'EUR', country: 'GER', colors: ['#E1000F', '#000000'], stadium: 'Deutsche Bank Park', capacity: 58000, reputation: 78, archetype: 'counter' },
  { key: 'VFB', name: 'VfB Stuttgart', short: 'Stuttgart', dataset: 'VfB Stuttgart', league: 'EUR', country: 'GER', colors: ['#FFFFFF', '#E32219'], stadium: 'MHPArena', capacity: 60058, reputation: 76, archetype: 'gegenpresser' },
  { key: 'WOB', name: 'VfL Wolfsburg', short: 'Wolfsburg', dataset: 'VfL Wolfsburg', league: 'EUR', country: 'GER', colors: ['#65B32E', '#FFFFFF'], stadium: 'Volkswagen Arena', capacity: 28917, reputation: 72, archetype: 'pragmatist' },
  { key: 'INT', name: 'Inter', short: 'Inter', dataset: 'Inter', league: 'EUR', country: 'ITA', colors: ['#0068A8', '#000000'], stadium: 'San Siro', capacity: 75817, reputation: 91, archetype: 'pragmatist', rivals: ['MIL', 'JUV'] },
  { key: 'NAP', name: 'Napoli', short: 'Napoli', dataset: 'Napoli', league: 'EUR', country: 'ITA', colors: ['#12A0D7', '#FFFFFF'], stadium: 'Stadio Diego Armando Maradona', capacity: 54726, reputation: 86, archetype: 'pragmatist' },
  { key: 'JUV', name: 'Juventus', short: 'Juventus', dataset: 'Juventus', league: 'EUR', country: 'ITA', colors: ['#FFFFFF', '#000000'], stadium: 'Allianz Stadium', capacity: 41507, reputation: 88, archetype: 'cynic', rivals: ['INT'] },
  { key: 'MIL', name: 'AC Milan', short: 'Milan', dataset: 'AC Milan', league: 'EUR', country: 'ITA', colors: ['#FB090B', '#000000'], stadium: 'San Siro', capacity: 75817, reputation: 88, archetype: 'pragmatist', rivals: ['INT'] },
  { key: 'ROM', name: 'Roma', short: 'Roma', dataset: 'Roma', league: 'EUR', country: 'ITA', colors: ['#8E1F2F', '#F0BC42'], stadium: 'Stadio Olimpico', capacity: 70634, reputation: 82, archetype: 'tinkerman', rivals: ['LAZ'] },
  { key: 'ATA', name: 'Atalanta', short: 'Atalanta', dataset: 'Atalanta', league: 'EUR', country: 'ITA', colors: ['#1E71B8', '#000000'], stadium: 'Gewiss Stadium', capacity: 24950, reputation: 82, archetype: 'gegenpresser' },
  { key: 'LAZ', name: 'Lazio', short: 'Lazio', dataset: 'Lazio', league: 'EUR', country: 'ITA', colors: ['#87D8F7', '#FFFFFF'], stadium: 'Stadio Olimpico', capacity: 70634, reputation: 79, archetype: 'counter', rivals: ['ROM'] },
  { key: 'FIO', name: 'Fiorentina', short: 'Fiorentina', dataset: 'Fiorentina', league: 'EUR', country: 'ITA', colors: ['#482E92', '#FFFFFF'], stadium: 'Stadio Artemio Franchi', capacity: 43147, reputation: 76, archetype: 'pragmatist' },
  { key: 'PSG', name: 'Paris Saint-Germain', short: 'PSG', dataset: 'Paris Saint-Germain', league: 'EUR', country: 'FRA', colors: ['#004170', '#DA291C'], stadium: 'Parc des Princes', capacity: 47929, reputation: 95, archetype: 'gegenpresser', rivals: ['OM'] },
  { key: 'OM', name: 'Olympique de Marseille', short: 'Marseille', dataset: 'Olympique de Marseille', league: 'EUR', country: 'FRA', colors: ['#2FAEE0', '#FFFFFF'], stadium: 'Orange Vélodrome', capacity: 67394, reputation: 80, archetype: 'tinkerman', rivals: ['PSG'] },
  { key: 'ASM', name: 'AS Monaco', short: 'Monaco', dataset: 'AS Monaco', league: 'EUR', country: 'FRA', colors: ['#E51B22', '#FFFFFF'], stadium: 'Stade Louis II', capacity: 16360, reputation: 77, archetype: 'youth' },
  { key: 'LIL', name: 'Lille OSC', short: 'Lille', dataset: 'Lille OSC', league: 'EUR', country: 'FRA', colors: ['#E01E13', '#20325F'], stadium: 'Stade Pierre-Mauroy', capacity: 50186, reputation: 76, archetype: 'youth' },
  { key: 'NIC', name: 'OGC Nice', short: 'Nice', dataset: 'OGC Nice', league: 'EUR', country: 'FRA', colors: ['#E3001B', '#000000'], stadium: 'Allianz Riviera', capacity: 36178, reputation: 72, archetype: 'counter' },
  { key: 'OL', name: 'Olympique Lyonnais', short: 'Lyon', dataset: 'Olympique Lyonnais', league: 'EUR', country: 'FRA', colors: ['#FFFFFF', '#14387F'], stadium: 'Groupama Stadium', capacity: 59186, reputation: 77, archetype: 'youth' },
  { key: 'SCP', name: 'Sporting CP', short: 'Sporting', dataset: 'Sporting CP', league: 'EUR', country: 'POR', colors: ['#008057', '#FFFFFF'], stadium: 'Estádio José Alvalade', capacity: 50095, reputation: 82, archetype: 'youth', rivals: ['SLB'] },
  { key: 'SLB', name: 'Benfica', short: 'Benfica', dataset: 'SL Benfica', league: 'EUR', country: 'POR', colors: ['#E83030', '#FFFFFF'], stadium: 'Estádio da Luz', capacity: 64642, reputation: 84, archetype: 'youth', rivals: ['SCP', 'FCP'] },
  { key: 'FCP', name: 'FC Porto', short: 'Porto', dataset: 'FC Porto', league: 'EUR', country: 'POR', colors: ['#00428C', '#FFFFFF'], stadium: 'Estádio do Dragão', capacity: 50033, reputation: 83, archetype: 'counter', rivals: ['SLB'] },
  { key: 'SCB', name: 'SC Braga', short: 'Braga', dataset: 'Sporting Clube de Braga', league: 'EUR', country: 'POR', colors: ['#E2001A', '#FFFFFF'], stadium: 'Estádio Municipal de Braga', capacity: 30286, reputation: 72, archetype: 'pragmatist' },
  { key: 'PSV', name: 'PSV Eindhoven', short: 'PSV', dataset: 'PSV', league: 'EUR', country: 'NED', colors: ['#ED1C24', '#FFFFFF'], stadium: 'Philips Stadion', capacity: 35000, reputation: 79, archetype: 'purist', rivals: ['AJA'] },
  { key: 'AJA', name: 'Ajax', short: 'Ajax', dataset: 'Ajax', league: 'EUR', country: 'NED', colors: ['#D2122E', '#FFFFFF'], stadium: 'Johan Cruijff ArenA', capacity: 55500, reputation: 81, archetype: 'youth', rivals: ['FEY', 'PSV'] },
  { key: 'FEY', name: 'Feyenoord', short: 'Feyenoord', dataset: 'Feyenoord', league: 'EUR', country: 'NED', colors: ['#EE2E24', '#FFFFFF'], stadium: 'De Kuip', capacity: 47500, reputation: 78, archetype: 'gegenpresser', rivals: ['AJA'] },
  { key: 'AZA', name: 'AZ Alkmaar', short: 'AZ', dataset: 'AZ Alkmaar', league: 'EUR', country: 'NED', colors: ['#DB0021', '#FFFFFF'], stadium: 'AFAS Stadion', capacity: 19478, reputation: 70, archetype: 'youth' },
  { key: 'GS', name: 'Galatasaray', short: 'Galatasaray', dataset: 'Galatasaray SK', league: 'EUR', country: 'TUR', colors: ['#A90432', '#FDB912'], stadium: 'RAMS Park', capacity: 52280, reputation: 81, archetype: 'chequebook', rivals: ['FB', 'BJK'] },
  { key: 'FB', name: 'Fenerbahçe', short: 'Fenerbahçe', dataset: 'Fenerbahçe SK', league: 'EUR', country: 'TUR', colors: ['#FFED00', '#163962'], stadium: 'Şükrü Saracoğlu', capacity: 47834, reputation: 79, archetype: 'chequebook', rivals: ['GS', 'BJK'] },
  { key: 'BJK', name: 'Beşiktaş', short: 'Beşiktaş', dataset: 'Beşiktaş JK', league: 'EUR', country: 'TUR', colors: ['#FFFFFF', '#000000'], stadium: 'Tüpraş Stadyumu', capacity: 42590, reputation: 76, archetype: 'tinkerman', rivals: ['GS', 'FB'] },
  { key: 'TS', name: 'Trabzonspor', short: 'Trabzonspor', dataset: 'Trabzonspor', league: 'EUR', country: 'TUR', colors: ['#6D2335', '#5AB4E6'], stadium: 'Papara Park', capacity: 40782, reputation: 68, archetype: 'counter' },
  { key: 'CEL', name: 'Celtic', short: 'Celtic', dataset: 'Celtic', league: 'EUR', country: 'SCO', colors: ['#018749', '#FFFFFF'], stadium: 'Celtic Park', capacity: 60411, reputation: 76, archetype: 'purist', rivals: ['RAN'] },
  { key: 'RAN', name: 'Rangers', short: 'Rangers', dataset: 'Rangers FC', league: 'EUR', country: 'SCO', colors: ['#1B458F', '#FFFFFF'], stadium: 'Ibrox Stadium', capacity: 51700, reputation: 74, archetype: 'pragmatist', rivals: ['CEL'] },
  { key: 'CLB', name: 'Club Brugge', short: 'Club Brugge', dataset: 'Club Brugge KV', league: 'EUR', country: 'BEL', colors: ['#0082C3', '#000000'], stadium: 'Jan Breydel Stadium', capacity: 29062, reputation: 75, archetype: 'pragmatist' },
  { key: 'USG', name: 'Union Saint-Gilloise', short: 'Union SG', dataset: 'Union Saint-Gilloise', league: 'EUR', country: 'BEL', colors: ['#FFD200', '#004B93'], stadium: 'Stade Joseph Marien', capacity: 9400, reputation: 66, archetype: 'counter' },
  { key: 'GNK', name: 'KRC Genk', short: 'Genk', dataset: 'KRC Genk', league: 'EUR', country: 'BEL', colors: ['#0055A5', '#FFFFFF'], stadium: 'Cegeka Arena', capacity: 23718, reputation: 68, archetype: 'youth' },
  { key: 'OLY', name: 'Olympiacos', short: 'Olympiacos', dataset: 'Olympiacos FC', league: 'EUR', country: 'GRE', colors: ['#E2001A', '#FFFFFF'], stadium: 'Karaiskakis Stadium', capacity: 32115, reputation: 73, archetype: 'pragmatist', rivals: ['PAO'] },
  { key: 'AEK', name: 'AEK Athens', short: 'AEK', dataset: 'AEK Athens', league: 'EUR', country: 'GRE', colors: ['#FFD700', '#000000'], stadium: 'OPAP Arena', capacity: 32500, reputation: 68, archetype: 'counter' },
  { key: 'PAO', name: 'PAOK', short: 'PAOK', dataset: 'PAOK', league: 'EUR', country: 'GRE', colors: ['#FFFFFF', '#000000'], stadium: 'Toumba Stadium', capacity: 28703, reputation: 69, archetype: 'cynic' },
  { key: 'RBS', name: 'Red Bull Salzburg', short: 'Salzburg', dataset: 'FC Red Bull Salzburg', league: 'EUR', country: 'AUT', colors: ['#D6002A', '#FFFFFF'], stadium: 'Red Bull Arena Salzburg', capacity: 30188, reputation: 74, archetype: 'gegenpresser' },
  { key: 'SHA', name: 'Shakhtar Donetsk', short: 'Shakhtar', dataset: 'Shakhtar Donetsk', league: 'EUR', country: 'UKR', colors: ['#F58220', '#000000'], stadium: 'Arena Lviv', capacity: 34915, reputation: 73, archetype: 'purist' },
  { key: 'SLA', name: 'Slavia Prague', short: 'Slavia', dataset: 'SK Slavia Praha', league: 'EUR', country: 'CZE', colors: ['#E4002B', '#FFFFFF'], stadium: 'Fortuna Arena', capacity: 19370, reputation: 68, archetype: 'cynic' },
  { key: 'FCK', name: 'FC Copenhagen', short: 'Copenhagen', dataset: 'FC København', league: 'EUR', country: 'DEN', colors: ['#FFFFFF', '#1C3F94'], stadium: 'Parken', capacity: 38065, reputation: 70, archetype: 'pragmatist' },
  { key: 'DZG', name: 'Dinamo Zagreb', short: 'Dinamo Zagreb', dataset: 'Dinamo Zagreb', league: 'EUR', country: 'CRO', colors: ['#004A99', '#FFFFFF'], stadium: 'Stadion Maksimir', capacity: 24851, reputation: 70, archetype: 'youth' },
  { key: 'BOD', name: 'Bodø/Glimt', short: 'Bodø/Glimt', dataset: 'FK Bodø/Glimt', league: 'EUR', country: 'NOR', colors: ['#FFE500', '#000000'], stadium: 'Aspmyra Stadion', capacity: 8270, reputation: 66, archetype: 'gegenpresser' },
  { key: 'YB', name: 'Young Boys', short: 'Young Boys', dataset: 'BSC Young Boys', league: 'EUR', country: 'SUI', colors: ['#FFE600', '#000000'], stadium: 'Stadion Wankdorf', capacity: 31500, reputation: 67, archetype: 'pragmatist' },

  // ---------------- Lower-league (Championship) pool ----------------
  { key: 'WHU', name: 'West Ham United', short: 'West Ham', dataset: 'West Ham United', league: 'CHAMP', country: 'ENG', colors: ['#7A263A', '#1BB1E7'], stadium: 'London Stadium', capacity: 62500, reputation: 72, archetype: 'pragmatist' },
  { key: 'WOL', name: 'Wolverhampton Wanderers', short: 'Wolves', dataset: 'Wolverhampton Wanderers', league: 'CHAMP', country: 'ENG', colors: ['#FDB913', '#231F20'], stadium: 'Molineux', capacity: 31750, reputation: 68, archetype: 'counter' },
  { key: 'BUR', name: 'Burnley', short: 'Burnley', dataset: 'Burnley', league: 'CHAMP', country: 'ENG', colors: ['#6C1D45', '#99D6EA'], stadium: 'Turf Moor', capacity: 21944, reputation: 62, archetype: 'cynic' },
  { key: 'LEI', name: 'Leicester City', short: 'Leicester', dataset: 'Leicester City', league: 'CHAMP', country: 'ENG', colors: ['#003090', '#FDBE11'], stadium: 'King Power Stadium', capacity: 32259, reputation: 68, archetype: 'counter', rivals: ['COV'] },
  { key: 'SOU', name: 'Southampton', short: 'Southampton', dataset: 'Southampton', league: 'CHAMP', country: 'ENG', colors: ['#D71920', '#FFFFFF'], stadium: "St Mary's Stadium", capacity: 32384, reputation: 64, archetype: 'purist' },
  { key: 'BIR', name: 'Birmingham City', short: 'Birmingham', dataset: 'Birmingham City', league: 'CHAMP', country: 'ENG', colors: ['#0000FF', '#FFFFFF'], stadium: "St Andrew's", capacity: 29409, reputation: 58, archetype: 'chequebook', rivals: ['AVL'] },
  { key: 'SHU', name: 'Sheffield United', short: 'Sheffield Utd', dataset: 'Sheffield United', league: 'CHAMP', country: 'ENG', colors: ['#EE2737', '#000000'], stadium: 'Bramall Lane', capacity: 32050, reputation: 60, archetype: 'counter' },
  { key: 'MID', name: 'Middlesbrough', short: 'Middlesbrough', dataset: 'Middlesbrough', league: 'CHAMP', country: 'ENG', colors: ['#E11B22', '#FFFFFF'], stadium: 'Riverside Stadium', capacity: 34742, reputation: 58, archetype: 'pragmatist' },
  { key: 'NOR', name: 'Norwich City', short: 'Norwich', dataset: 'Norwich City', league: 'CHAMP', country: 'ENG', colors: ['#FFF200', '#00A650'], stadium: 'Carrow Road', capacity: 27359, reputation: 58, archetype: 'youth', rivals: ['IPS'] },
  { key: 'BRC', name: 'Bristol City', short: 'Bristol City', dataset: 'Bristol City', league: 'CHAMP', country: 'ENG', colors: ['#E21A23', '#FFFFFF'], stadium: 'Ashton Gate', capacity: 27000, reputation: 55, archetype: 'pragmatist' },
  { key: 'WBA', name: 'West Bromwich Albion', short: 'West Brom', dataset: 'West Bromwich Albion', league: 'CHAMP', country: 'ENG', colors: ['#122F67', '#FFFFFF'], stadium: 'The Hawthorns', capacity: 26850, reputation: 58, archetype: 'cynic', rivals: ['AVL'] },
  { key: 'WRE', name: 'Wrexham', short: 'Wrexham', dataset: 'Wrexham', league: 'CHAMP', country: 'WAL', colors: ['#D71920', '#FFFFFF'], stadium: 'STōK Racecourse', capacity: 12600, reputation: 57, archetype: 'chequebook' },
  { key: 'SWA', name: 'Swansea City', short: 'Swansea', dataset: 'Swansea City', league: 'CHAMP', country: 'WAL', colors: ['#FFFFFF', '#121212'], stadium: 'Swansea.com Stadium', capacity: 21088, reputation: 55, archetype: 'purist' },
  { key: 'QPR', name: 'Queens Park Rangers', short: 'QPR', dataset: 'Queens Park Rangers', league: 'CHAMP', country: 'ENG', colors: ['#1D5BA4', '#FFFFFF'], stadium: 'Loftus Road', capacity: 18439, reputation: 54, archetype: 'tinkerman' },
  { key: 'STK', name: 'Stoke City', short: 'Stoke', dataset: 'Stoke City', league: 'CHAMP', country: 'ENG', colors: ['#E03A3E', '#FFFFFF'], stadium: 'bet365 Stadium', capacity: 30089, reputation: 56, archetype: 'cynic' },
  { key: 'WAT', name: 'Watford', short: 'Watford', dataset: 'Watford', league: 'CHAMP', country: 'ENG', colors: ['#FBEE23', '#ED2127'], stadium: 'Vicarage Road', capacity: 22200, reputation: 56, archetype: 'tinkerman' },
];
