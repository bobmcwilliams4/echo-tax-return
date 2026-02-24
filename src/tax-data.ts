// Echo Tax Return — Multi-Year Tax Data (2019-2024)
// All IRS tax brackets, standard deductions, SS wage bases, EITC tables, CTC amounts
import type { FilingStatus } from './types';

type Bracket = { rate: number; min: number; max: number };
type BracketTable = Record<FilingStatus, Bracket[]>;

// ═══════════════════════════════════════════════════════════════
// TAX BRACKETS BY YEAR
// ═══════════════════════════════════════════════════════════════

const BRACKETS_2024: BracketTable = {
  single: [
    { rate: 0.10, min: 0, max: 11600 }, { rate: 0.12, min: 11600, max: 47150 },
    { rate: 0.22, min: 47150, max: 100525 }, { rate: 0.24, min: 100525, max: 191950 },
    { rate: 0.32, min: 191950, max: 243725 }, { rate: 0.35, min: 243725, max: 609350 },
    { rate: 0.37, min: 609350, max: Infinity },
  ],
  married_joint: [
    { rate: 0.10, min: 0, max: 23200 }, { rate: 0.12, min: 23200, max: 94300 },
    { rate: 0.22, min: 94300, max: 201050 }, { rate: 0.24, min: 201050, max: 383900 },
    { rate: 0.32, min: 383900, max: 487450 }, { rate: 0.35, min: 487450, max: 731200 },
    { rate: 0.37, min: 731200, max: Infinity },
  ],
  married_separate: [
    { rate: 0.10, min: 0, max: 11600 }, { rate: 0.12, min: 11600, max: 47150 },
    { rate: 0.22, min: 47150, max: 100525 }, { rate: 0.24, min: 100525, max: 191950 },
    { rate: 0.32, min: 191950, max: 243725 }, { rate: 0.35, min: 243725, max: 365600 },
    { rate: 0.37, min: 365600, max: Infinity },
  ],
  head_of_household: [
    { rate: 0.10, min: 0, max: 16550 }, { rate: 0.12, min: 16550, max: 63100 },
    { rate: 0.22, min: 63100, max: 100500 }, { rate: 0.24, min: 100500, max: 191950 },
    { rate: 0.32, min: 191950, max: 243700 }, { rate: 0.35, min: 243700, max: 609350 },
    { rate: 0.37, min: 609350, max: Infinity },
  ],
  widow: [
    { rate: 0.10, min: 0, max: 23200 }, { rate: 0.12, min: 23200, max: 94300 },
    { rate: 0.22, min: 94300, max: 201050 }, { rate: 0.24, min: 201050, max: 383900 },
    { rate: 0.32, min: 383900, max: 487450 }, { rate: 0.35, min: 487450, max: 731200 },
    { rate: 0.37, min: 731200, max: Infinity },
  ],
};

const BRACKETS_2023: BracketTable = {
  single: [
    { rate: 0.10, min: 0, max: 11000 }, { rate: 0.12, min: 11000, max: 44725 },
    { rate: 0.22, min: 44725, max: 95375 }, { rate: 0.24, min: 95375, max: 182100 },
    { rate: 0.32, min: 182100, max: 231250 }, { rate: 0.35, min: 231250, max: 578125 },
    { rate: 0.37, min: 578125, max: Infinity },
  ],
  married_joint: [
    { rate: 0.10, min: 0, max: 22000 }, { rate: 0.12, min: 22000, max: 89450 },
    { rate: 0.22, min: 89450, max: 190750 }, { rate: 0.24, min: 190750, max: 364200 },
    { rate: 0.32, min: 364200, max: 462500 }, { rate: 0.35, min: 462500, max: 693750 },
    { rate: 0.37, min: 693750, max: Infinity },
  ],
  married_separate: [
    { rate: 0.10, min: 0, max: 11000 }, { rate: 0.12, min: 11000, max: 44725 },
    { rate: 0.22, min: 44725, max: 95375 }, { rate: 0.24, min: 95375, max: 182100 },
    { rate: 0.32, min: 182100, max: 231250 }, { rate: 0.35, min: 231250, max: 346875 },
    { rate: 0.37, min: 346875, max: Infinity },
  ],
  head_of_household: [
    { rate: 0.10, min: 0, max: 15700 }, { rate: 0.12, min: 15700, max: 59850 },
    { rate: 0.22, min: 59850, max: 95350 }, { rate: 0.24, min: 95350, max: 182100 },
    { rate: 0.32, min: 182100, max: 231250 }, { rate: 0.35, min: 231250, max: 578100 },
    { rate: 0.37, min: 578100, max: Infinity },
  ],
  widow: [
    { rate: 0.10, min: 0, max: 22000 }, { rate: 0.12, min: 22000, max: 89450 },
    { rate: 0.22, min: 89450, max: 190750 }, { rate: 0.24, min: 190750, max: 364200 },
    { rate: 0.32, min: 364200, max: 462500 }, { rate: 0.35, min: 462500, max: 693750 },
    { rate: 0.37, min: 693750, max: Infinity },
  ],
};

const BRACKETS_2022: BracketTable = {
  single: [
    { rate: 0.10, min: 0, max: 10275 }, { rate: 0.12, min: 10275, max: 41775 },
    { rate: 0.22, min: 41775, max: 89075 }, { rate: 0.24, min: 89075, max: 170050 },
    { rate: 0.32, min: 170050, max: 215950 }, { rate: 0.35, min: 215950, max: 539900 },
    { rate: 0.37, min: 539900, max: Infinity },
  ],
  married_joint: [
    { rate: 0.10, min: 0, max: 20550 }, { rate: 0.12, min: 20550, max: 83550 },
    { rate: 0.22, min: 83550, max: 178150 }, { rate: 0.24, min: 178150, max: 340100 },
    { rate: 0.32, min: 340100, max: 431900 }, { rate: 0.35, min: 431900, max: 647850 },
    { rate: 0.37, min: 647850, max: Infinity },
  ],
  married_separate: [
    { rate: 0.10, min: 0, max: 10275 }, { rate: 0.12, min: 10275, max: 41775 },
    { rate: 0.22, min: 41775, max: 89075 }, { rate: 0.24, min: 89075, max: 170050 },
    { rate: 0.32, min: 170050, max: 215950 }, { rate: 0.35, min: 215950, max: 323925 },
    { rate: 0.37, min: 323925, max: Infinity },
  ],
  head_of_household: [
    { rate: 0.10, min: 0, max: 14650 }, { rate: 0.12, min: 14650, max: 55900 },
    { rate: 0.22, min: 55900, max: 89050 }, { rate: 0.24, min: 89050, max: 170050 },
    { rate: 0.32, min: 170050, max: 215950 }, { rate: 0.35, min: 215950, max: 539900 },
    { rate: 0.37, min: 539900, max: Infinity },
  ],
  widow: [
    { rate: 0.10, min: 0, max: 20550 }, { rate: 0.12, min: 20550, max: 83550 },
    { rate: 0.22, min: 83550, max: 178150 }, { rate: 0.24, min: 178150, max: 340100 },
    { rate: 0.32, min: 340100, max: 431900 }, { rate: 0.35, min: 431900, max: 647850 },
    { rate: 0.37, min: 647850, max: Infinity },
  ],
};

const BRACKETS_2021: BracketTable = {
  single: [
    { rate: 0.10, min: 0, max: 9950 }, { rate: 0.12, min: 9950, max: 40525 },
    { rate: 0.22, min: 40525, max: 86375 }, { rate: 0.24, min: 86375, max: 164925 },
    { rate: 0.32, min: 164925, max: 209425 }, { rate: 0.35, min: 209425, max: 523600 },
    { rate: 0.37, min: 523600, max: Infinity },
  ],
  married_joint: [
    { rate: 0.10, min: 0, max: 19900 }, { rate: 0.12, min: 19900, max: 81050 },
    { rate: 0.22, min: 81050, max: 172750 }, { rate: 0.24, min: 172750, max: 329850 },
    { rate: 0.32, min: 329850, max: 418850 }, { rate: 0.35, min: 418850, max: 628300 },
    { rate: 0.37, min: 628300, max: Infinity },
  ],
  married_separate: [
    { rate: 0.10, min: 0, max: 9950 }, { rate: 0.12, min: 9950, max: 40525 },
    { rate: 0.22, min: 40525, max: 86375 }, { rate: 0.24, min: 86375, max: 164925 },
    { rate: 0.32, min: 164925, max: 209425 }, { rate: 0.35, min: 209425, max: 314150 },
    { rate: 0.37, min: 314150, max: Infinity },
  ],
  head_of_household: [
    { rate: 0.10, min: 0, max: 14200 }, { rate: 0.12, min: 14200, max: 54200 },
    { rate: 0.22, min: 54200, max: 86350 }, { rate: 0.24, min: 86350, max: 164900 },
    { rate: 0.32, min: 164900, max: 209400 }, { rate: 0.35, min: 209400, max: 523600 },
    { rate: 0.37, min: 523600, max: Infinity },
  ],
  widow: [
    { rate: 0.10, min: 0, max: 19900 }, { rate: 0.12, min: 19900, max: 81050 },
    { rate: 0.22, min: 81050, max: 172750 }, { rate: 0.24, min: 172750, max: 329850 },
    { rate: 0.32, min: 329850, max: 418850 }, { rate: 0.35, min: 418850, max: 628300 },
    { rate: 0.37, min: 628300, max: Infinity },
  ],
};

const BRACKETS_2020: BracketTable = {
  single: [
    { rate: 0.10, min: 0, max: 9875 }, { rate: 0.12, min: 9875, max: 40125 },
    { rate: 0.22, min: 40125, max: 85525 }, { rate: 0.24, min: 85525, max: 163300 },
    { rate: 0.32, min: 163300, max: 207350 }, { rate: 0.35, min: 207350, max: 518400 },
    { rate: 0.37, min: 518400, max: Infinity },
  ],
  married_joint: [
    { rate: 0.10, min: 0, max: 19750 }, { rate: 0.12, min: 19750, max: 80250 },
    { rate: 0.22, min: 80250, max: 171050 }, { rate: 0.24, min: 171050, max: 326600 },
    { rate: 0.32, min: 326600, max: 414700 }, { rate: 0.35, min: 414700, max: 622050 },
    { rate: 0.37, min: 622050, max: Infinity },
  ],
  married_separate: [
    { rate: 0.10, min: 0, max: 9875 }, { rate: 0.12, min: 9875, max: 40125 },
    { rate: 0.22, min: 40125, max: 85525 }, { rate: 0.24, min: 85525, max: 163300 },
    { rate: 0.32, min: 163300, max: 207350 }, { rate: 0.35, min: 207350, max: 311025 },
    { rate: 0.37, min: 311025, max: Infinity },
  ],
  head_of_household: [
    { rate: 0.10, min: 0, max: 14100 }, { rate: 0.12, min: 14100, max: 53700 },
    { rate: 0.22, min: 53700, max: 85500 }, { rate: 0.24, min: 85500, max: 163300 },
    { rate: 0.32, min: 163300, max: 207350 }, { rate: 0.35, min: 207350, max: 518400 },
    { rate: 0.37, min: 518400, max: Infinity },
  ],
  widow: [
    { rate: 0.10, min: 0, max: 19750 }, { rate: 0.12, min: 19750, max: 80250 },
    { rate: 0.22, min: 80250, max: 171050 }, { rate: 0.24, min: 171050, max: 326600 },
    { rate: 0.32, min: 326600, max: 414700 }, { rate: 0.35, min: 414700, max: 622050 },
    { rate: 0.37, min: 622050, max: Infinity },
  ],
};

const BRACKETS_2019: BracketTable = {
  single: [
    { rate: 0.10, min: 0, max: 9700 }, { rate: 0.12, min: 9700, max: 39475 },
    { rate: 0.22, min: 39475, max: 84200 }, { rate: 0.24, min: 84200, max: 160725 },
    { rate: 0.32, min: 160725, max: 204100 }, { rate: 0.35, min: 204100, max: 510300 },
    { rate: 0.37, min: 510300, max: Infinity },
  ],
  married_joint: [
    { rate: 0.10, min: 0, max: 19400 }, { rate: 0.12, min: 19400, max: 78950 },
    { rate: 0.22, min: 78950, max: 168400 }, { rate: 0.24, min: 168400, max: 321450 },
    { rate: 0.32, min: 321450, max: 408200 }, { rate: 0.35, min: 408200, max: 612350 },
    { rate: 0.37, min: 612350, max: Infinity },
  ],
  married_separate: [
    { rate: 0.10, min: 0, max: 9700 }, { rate: 0.12, min: 9700, max: 39475 },
    { rate: 0.22, min: 39475, max: 84200 }, { rate: 0.24, min: 84200, max: 160725 },
    { rate: 0.32, min: 160725, max: 204100 }, { rate: 0.35, min: 204100, max: 306175 },
    { rate: 0.37, min: 306175, max: Infinity },
  ],
  head_of_household: [
    { rate: 0.10, min: 0, max: 13850 }, { rate: 0.12, min: 13850, max: 52850 },
    { rate: 0.22, min: 52850, max: 84200 }, { rate: 0.24, min: 84200, max: 160700 },
    { rate: 0.32, min: 160700, max: 204100 }, { rate: 0.35, min: 204100, max: 510300 },
    { rate: 0.37, min: 510300, max: Infinity },
  ],
  widow: [
    { rate: 0.10, min: 0, max: 19400 }, { rate: 0.12, min: 19400, max: 78950 },
    { rate: 0.22, min: 78950, max: 168400 }, { rate: 0.24, min: 168400, max: 321450 },
    { rate: 0.32, min: 321450, max: 408200 }, { rate: 0.35, min: 408200, max: 612350 },
    { rate: 0.37, min: 612350, max: Infinity },
  ],
};

const ALL_BRACKETS: Record<number, BracketTable> = {
  2024: BRACKETS_2024, 2023: BRACKETS_2023, 2022: BRACKETS_2022,
  2021: BRACKETS_2021, 2020: BRACKETS_2020, 2019: BRACKETS_2019,
};

// ═══════════════════════════════════════════════════════════════
// STANDARD DEDUCTIONS BY YEAR
// ═══════════════════════════════════════════════════════════════

const ALL_STANDARD_DEDUCTIONS: Record<number, Record<FilingStatus, number>> = {
  2024: { single: 14600, married_joint: 29200, married_separate: 14600, head_of_household: 21900, widow: 29200 },
  2023: { single: 13850, married_joint: 27700, married_separate: 13850, head_of_household: 20800, widow: 27700 },
  2022: { single: 12950, married_joint: 25900, married_separate: 12950, head_of_household: 19400, widow: 25900 },
  2021: { single: 12550, married_joint: 25100, married_separate: 12550, head_of_household: 18800, widow: 25100 },
  2020: { single: 12400, married_joint: 24800, married_separate: 12400, head_of_household: 18650, widow: 24800 },
  2019: { single: 12200, married_joint: 24400, married_separate: 12200, head_of_household: 18350, widow: 24400 },
};

// ═══════════════════════════════════════════════════════════════
// SOCIAL SECURITY WAGE BASES
// ═══════════════════════════════════════════════════════════════

const SS_WAGE_BASES: Record<number, number> = {
  2024: 168600, 2023: 160200, 2022: 147000,
  2021: 142800, 2020: 137700, 2019: 132900,
};

// ═══════════════════════════════════════════════════════════════
// CHILD TAX CREDIT BY YEAR
// ═══════════════════════════════════════════════════════════════

interface CTCParams {
  amount: number;
  refundable_max: number;
  phaseout_single: number;
  phaseout_joint: number;
}

const CTC_BY_YEAR: Record<number, CTCParams> = {
  2024: { amount: 2000, refundable_max: 1700, phaseout_single: 200000, phaseout_joint: 400000 },
  2023: { amount: 2000, refundable_max: 1600, phaseout_single: 200000, phaseout_joint: 400000 },
  2022: { amount: 2000, refundable_max: 1500, phaseout_single: 200000, phaseout_joint: 400000 },
  2021: { amount: 3600, refundable_max: 3600, phaseout_single: 75000, phaseout_joint: 150000 }, // American Rescue Plan — $3,600 under 6, $3,000 6-17, fully refundable
  2020: { amount: 2000, refundable_max: 1400, phaseout_single: 200000, phaseout_joint: 400000 },
  2019: { amount: 2000, refundable_max: 1400, phaseout_single: 200000, phaseout_joint: 400000 },
};

// ═══════════════════════════════════════════════════════════════
// EITC BY YEAR (simplified — HoH/single use same phaseouts)
// ═══════════════════════════════════════════════════════════════

interface EITCParams {
  max: number;
  phaseout_start_single: number;
  phaseout_start_joint: number;
  phaseout_end_single: number;
  phaseout_end_joint: number;
  investment_income_limit: number;
}

const EITC_BY_YEAR: Record<number, Record<number, EITCParams>> = {
  2024: {
    0: { max: 632, phaseout_start_single: 9800, phaseout_start_joint: 16370, phaseout_end_single: 18591, phaseout_end_joint: 25511, investment_income_limit: 11600 },
    1: { max: 3995, phaseout_start_single: 12390, phaseout_start_joint: 18970, phaseout_end_single: 46560, phaseout_end_joint: 53120, investment_income_limit: 11600 },
    2: { max: 6604, phaseout_start_single: 12390, phaseout_start_joint: 18970, phaseout_end_single: 52918, phaseout_end_joint: 59478, investment_income_limit: 11600 },
    3: { max: 7430, phaseout_start_single: 12390, phaseout_start_joint: 18970, phaseout_end_single: 56838, phaseout_end_joint: 63398, investment_income_limit: 11600 },
  },
  2023: {
    0: { max: 600, phaseout_start_single: 9800, phaseout_start_joint: 16370, phaseout_end_single: 17640, phaseout_end_joint: 24210, investment_income_limit: 11000 },
    1: { max: 3995, phaseout_start_single: 11750, phaseout_start_joint: 18190, phaseout_end_single: 46560, phaseout_end_joint: 53000, investment_income_limit: 11000 },
    2: { max: 6604, phaseout_start_single: 11750, phaseout_start_joint: 18190, phaseout_end_single: 52918, phaseout_end_joint: 59358, investment_income_limit: 11000 },
    3: { max: 7430, phaseout_start_single: 11750, phaseout_start_joint: 18190, phaseout_end_single: 56838, phaseout_end_joint: 63278, investment_income_limit: 11000 },
  },
  2022: {
    0: { max: 560, phaseout_start_single: 9160, phaseout_start_joint: 15290, phaseout_end_single: 16480, phaseout_end_joint: 22610, investment_income_limit: 10300 },
    1: { max: 3733, phaseout_start_single: 10980, phaseout_start_joint: 17040, phaseout_end_single: 43492, phaseout_end_joint: 49622, investment_income_limit: 10300 },
    2: { max: 6164, phaseout_start_single: 10980, phaseout_start_joint: 17040, phaseout_end_single: 49399, phaseout_end_joint: 55529, investment_income_limit: 10300 },
    3: { max: 6935, phaseout_start_single: 10980, phaseout_start_joint: 17040, phaseout_end_single: 53057, phaseout_end_joint: 59187, investment_income_limit: 10300 },
  },
  2021: {
    0: { max: 1502, phaseout_start_single: 11610, phaseout_start_joint: 17550, phaseout_end_single: 21430, phaseout_end_joint: 27380, investment_income_limit: 10000 },
    1: { max: 3618, phaseout_start_single: 10640, phaseout_start_joint: 16370, phaseout_end_single: 42158, phaseout_end_joint: 48108, investment_income_limit: 10000 },
    2: { max: 5980, phaseout_start_single: 10640, phaseout_start_joint: 16370, phaseout_end_single: 47915, phaseout_end_joint: 53865, investment_income_limit: 10000 },
    3: { max: 6728, phaseout_start_single: 10640, phaseout_start_joint: 16370, phaseout_end_single: 51464, phaseout_end_joint: 57414, investment_income_limit: 10000 },
  },
  2020: {
    0: { max: 538, phaseout_start_single: 8790, phaseout_start_joint: 14680, phaseout_end_single: 15820, phaseout_end_joint: 21710, investment_income_limit: 3650 },
    1: { max: 3584, phaseout_start_single: 10540, phaseout_start_joint: 16370, phaseout_end_single: 41756, phaseout_end_joint: 47646, investment_income_limit: 3650 },
    2: { max: 5920, phaseout_start_single: 10540, phaseout_start_joint: 16370, phaseout_end_single: 47440, phaseout_end_joint: 53330, investment_income_limit: 3650 },
    3: { max: 6660, phaseout_start_single: 10540, phaseout_start_joint: 16370, phaseout_end_single: 50594, phaseout_end_joint: 56844, investment_income_limit: 3650 },
  },
  2019: {
    0: { max: 529, phaseout_start_single: 8650, phaseout_start_joint: 14450, phaseout_end_single: 15570, phaseout_end_joint: 21370, investment_income_limit: 3600 },
    1: { max: 3526, phaseout_start_single: 10370, phaseout_start_joint: 16370, phaseout_end_single: 41094, phaseout_end_joint: 46884, investment_income_limit: 3600 },
    2: { max: 5828, phaseout_start_single: 10370, phaseout_start_joint: 16370, phaseout_end_single: 46703, phaseout_end_joint: 52493, investment_income_limit: 3600 },
    3: { max: 6557, phaseout_start_single: 10370, phaseout_start_joint: 16370, phaseout_end_single: 50162, phaseout_end_joint: 55952, investment_income_limit: 3600 },
  },
};

// ═══════════════════════════════════════════════════════════════
// ADDITIONAL CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SALT_CAP = 10000; // All years 2018+
const QBI_RATE = 0.20;  // Section 199A
const SE_INCOME_FACTOR = 0.9235;
const ODC_AMOUNT = 500;

// Early distribution penalty rate (Form 5329)
const EARLY_DIST_PENALTY_RATE = 0.10;

// ═══════════════════════════════════════════════════════════════
// PUBLIC API — GET TAX DATA FOR A SPECIFIC YEAR
// ═══════════════════════════════════════════════════════════════

export function getTaxBrackets(year: number, filingStatus: FilingStatus): Bracket[] {
  const table = ALL_BRACKETS[year] || ALL_BRACKETS[2024];
  return table[filingStatus] || table.single;
}

export function getStandardDeduction(year: number, filingStatus: FilingStatus): number {
  const table = ALL_STANDARD_DEDUCTIONS[year] || ALL_STANDARD_DEDUCTIONS[2024];
  return table[filingStatus] || table.single;
}

export function getSSWageBase(year: number): number {
  return SS_WAGE_BASES[year] || SS_WAGE_BASES[2024];
}

export function getCTCParams(year: number): CTCParams {
  return CTC_BY_YEAR[year] || CTC_BY_YEAR[2024];
}

export function getEITCParams(year: number, numChildren: number): EITCParams | null {
  const table = EITC_BY_YEAR[year] || EITC_BY_YEAR[2024];
  const children = Math.min(3, numChildren);
  return table[children] || null;
}

export function getSALTCap(): number { return SALT_CAP; }
export function getQBIRate(): number { return QBI_RATE; }
export function getSEIncomeFactor(): number { return SE_INCOME_FACTOR; }
export function getODCAmount(): number { return ODC_AMOUNT; }
export function getEarlyDistPenaltyRate(): number { return EARLY_DIST_PENALTY_RATE; }

export function getSupportedYears(): number[] {
  return Object.keys(ALL_BRACKETS).map(Number).sort();
}

export function isYearSupported(year: number): boolean {
  return year in ALL_BRACKETS;
}
