import type { Driver } from '../../types.ts';
import { calculateDriverMetrics, isSewaBiasa } from '../../utils.ts';
import { longDate, ringgit, type CompanyDetails } from './template.ts';

/**
 * The letters the Agreements page makes for a driver: cancelling a Sewa Beli agreement, demanding unpaid rent, and the
 * final letter of demand warning of a CTOS listing. Each is one editable text (Agreements -> Edit templates), filled from
 * the driver, Fleet, the company details and the rent schedule. The PDF is made in the browser and never stored.
 */
export type LetterKind = 'BATAL_SEWABELI' | 'TUNTUT_SEWA' | 'CTOS_LOD';
export const LETTER_KINDS: LetterKind[] = ['BATAL_SEWABELI', 'TUNTUT_SEWA', 'CTOS_LOD'];
export const LETTER_LABELS: Record<LetterKind, string> = {
  BATAL_SEWABELI: 'Surat Batal Sewa Beli',
  TUNTUT_SEWA: 'Surat Tuntut Sewa',
  CTOS_LOD: 'CTOS LOD',
};

/**
 * A letter's wording. `title` prints boxed at the top. The body is paragraphs separated by a blank line:
 * - "1. ..." hangs the text after its number;
 * - "> ..." prints indented in italics (a quotation);
 * - "# ..." is another boxed title (e.g. the English page);
 * - a block whose every line has "|" is a table: rows of two cells print as a bold field list ("Kepada | {{customer_name}}"),
 *   wider rows as a ruled table (a one-cell row heads it);
 * - "---" alone starts a new page.
 */
export interface LetterTemplate {
  title: string;
  body: string;
}

/** Printed above the footer of every letter page, as on the reference letters: they carry no signature. */
export const LETTER_FOOTER_NOTE = 'Notis ini adalah cetakan komputer dan tidak perlu tandatangan';

const BULAN = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const parts = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCDate() === Number(match[3]) && date.getUTCMonth() === Number(match[2]) - 1 ? date : null;
};
/** "14 Oktober 2026" for a YYYY-MM-DD date; '' when not a date. */
export const longDateBM = (value: string): string => {
  const date = parts(value);
  return date ? `${date.getUTCDate()} ${BULAN[date.getUTCMonth()]} ${date.getUTCFullYear()}` : '';
};
/** The date `days` days after a YYYY-MM-DD date, as YYYY-MM-DD; '' when not a date. */
export const deadlineDate = (value: string, days: number): string => {
  const date = parts(value);
  return date ? new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10) : '';
};

/** Rounded to the nearest RM10, as the reference letter's discount table rounds. */
const nearestTen = (value: number) => Math.round(value / 10) * 10;
const money = (value: number) => ringgit(Math.round(value * 100) / 100);
/** A typed amount ("1,200", "RM 300.50"); 0 when empty or not a number. */
export const typedAmount = (typed: string): number => {
  const value = Number((typed || '').replace(/[,\sRMrm]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : 0;
};
/** "0123456789" for a phone stored as 60123456789. */
const localPhone = (phone = '') => phone.replace(/\D/g, '').replace(/^60(?=1|[3-9])/, '0');

/** What staff type for one letter. Amounts are typed text; dates YYYY-MM-DD. */
export interface LetterInput {
  driver: Driver;
  /** The driver's car on Fleet, when it is there. */
  car: { plateNumber: string; make: string; model: string } | null;
  company: Partial<CompanyDetails>;
  letterDate: string;
  /** Kuala Lumpur's date (YYYY-MM-DD): rent is never counted past it. */
  today?: string;
  payWithinDays: number;
  reference: string;
  /** Costs added to the rent owed, typed for this letter (e.g. after the car came back damaged). */
  repairCost?: string;
  paintDentCost?: string;
}

/** Every value a letter can print; an empty one prints as a line to write on. */
export const LETTER_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'company_name', label: 'Company name' },
  { key: 'company_reg_no', label: 'Company registration no.' },
  { key: 'company_address', label: 'Company address' },
  { key: 'company_phone', label: 'Company phone' },
  { key: 'company_email', label: 'Company email' },
  { key: 'company_bank_account', label: "Payment account (the driver's type)" },
  { key: 'letter_ref', label: 'Reference no.' },
  { key: 'letter_date', label: 'Letter date (Malay)' },
  { key: 'letter_date_en', label: 'Letter date (English)' },
  { key: 'customer_name', label: "Driver's name" },
  { key: 'customer_nric', label: "Driver's NRIC" },
  { key: 'customer_phone', label: "Driver's phone" },
  { key: 'customer_address', label: "Driver's address" },
  { key: 'vehicle_plate', label: 'Plate' },
  { key: 'vehicle_make_model', label: 'Make and model' },
  { key: 'agreement_type', label: 'Agreement type' },
  { key: 'start_date', label: 'Agreement start date' },
  { key: 'rent_amount', label: 'Rent per cycle' },
  { key: 'rental_cycle', label: 'Rent cycle (minggu / bulan)' },
  { key: 'rent_arrears', label: 'Rent owed (rent schedule)' },
  { key: 'cycles_owed', label: 'Rents owed (e.g. 9 minggu)' },
  { key: 'arrears_as_of', label: 'Rent owed as at (Malay date)' },
  { key: 'repair_cost', label: 'Repair cost (typed)' },
  { key: 'paint_dent_cost', label: 'Paint and dent cost (typed)' },
  { key: 'total_debt', label: 'Total owed (rent + typed costs)' },
  { key: 'debt_breakdown', label: 'Total owed, item by item' },
  { key: 'amount_7_days', label: 'Pay within 7 days (10% off, nearest RM10)' },
  { key: 'amount_14_days', label: 'Pay within 14 days (5% off, nearest RM10)' },
  { key: 'pay_within_days', label: 'Days to pay' },
  { key: 'pay_by_date', label: 'Pay-by date (Malay)' },
  { key: 'pay_by_date_en', label: 'Pay-by date (English)' },
];

/**
 * Every value for one letter. The rent owed is the rent schedule's (calculateDriverMetrics: rent only, no late charge)
 * as at the end of the letter date, counting every payment up to then (a delisted driver's rent already stops at the
 * delist date). A letter dated ahead counts only up to `today`, so it never asks for rent not yet due.
 */
export const letterValues = (input: LetterInput): Record<string, string> => {
  const { driver, car, company } = input;
  const letterDay = parts(input.letterDate) ? input.letterDate : '';
  const today = input.today && parts(input.today) ? input.today : '';
  const asOf = today && (!letterDay || letterDay > today) ? today : letterDay;
  const asOfDate = asOf ? new Date(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1, Number(asOf.slice(8, 10)), 12) : undefined;
  const metrics = calculateDriverMetrics(driver, asOfDate);
  const arrears = Math.max(0, metrics.principalOutstanding);
  const repair = typedAmount(input.repairCost ?? '');
  const paint = typedAmount(input.paintDentCost ?? '');
  const total = arrears + repair + paint;
  const cycle = driver.rentalCycle === 'MONTHLY' ? 'bulan' : 'minggu';
  const owed = Math.round(metrics.cyclesOwed * 10) / 10;
  const breakdown = [`hutang sewa ${money(arrears)}`, repair ? `kos baiki kereta ${money(repair)}` : '', paint ? `kos cat dan kemek ${money(paint)}` : '']
    .filter(Boolean);
  const biasa = isSewaBiasa(driver);
  const payBy = letterDay ? deadlineDate(letterDay, input.payWithinDays) : '';
  const values: Record<string, string> = {
    company_name: company.company_name ?? '',
    company_reg_no: company.company_reg_no ?? '',
    company_address: company.company_address ?? '',
    company_phone: company.company_phone ?? '',
    company_email: company.company_email ?? '',
    company_bank_account: (biasa ? company.company_bank_account_sewabiasa : company.company_bank_account_sewabeli) ?? '',
    letter_ref: input.reference,
    letter_date: longDateBM(letterDay),
    letter_date_en: longDate(letterDay),
    customer_name: driver.name ?? '',
    customer_nric: driver.nric ?? '',
    customer_phone: localPhone(driver.phone),
    customer_address: driver.address ?? '',
    vehicle_plate: car?.plateNumber || driver.carPlate || '',
    vehicle_make_model: car ? `${car.make} ${car.model}`.trim() : '',
    agreement_type: biasa ? 'Sewa Biasa' : 'Sewa Beli',
    start_date: longDateBM(driver.contractStartDate),
    rent_amount: driver.rentalRate > 0 ? money(driver.rentalRate) : '',
    rental_cycle: cycle,
    rent_arrears: money(arrears),
    cycles_owed: `${owed} ${cycle}`,
    arrears_as_of: longDateBM(asOf),
    repair_cost: repair ? money(repair) : '',
    paint_dent_cost: paint ? money(paint) : '',
    total_debt: money(total),
    debt_breakdown: breakdown.length > 1 ? `${breakdown.join(' + ')} = ${money(total)}` : breakdown[0],
    amount_7_days: money(nearestTen(total * 0.9)),
    amount_14_days: money(nearestTen(total * 0.95)),
    pay_within_days: String(input.payWithinDays),
    pay_by_date: longDateBM(payBy),
    pay_by_date_en: longDate(payBy),
  };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, (value || '').trim()]));
};

const para = (...blocks: string[]) => blocks.join('\n\n');
const rows = (...lines: string[]) => lines.join('\n');

/** The details block under each letter's title. */
const recipient = rows(
  'Kepada | {{customer_name}}',
  'No. Kad Pengenalan | {{customer_nric}}',
  'No. Telefon | {{customer_phone}}',
  'No. Rujukan | {{letter_ref}}',
  'No. Plat Kenderaan | {{vehicle_plate}}',
  'Jumlah Hutang | {{total_debt}}',
  'Tarikh | {{letter_date}}',
);

/**
 * The built-in drafts (2026-10-14), written in Bahasa Malaysia from the owner's reference letters, for the owner to review
 * (a lawyer's review is advised). Company details are never written here: they come from the database.
 */
const DEFAULT_LETTERS: Record<LetterKind, LetterTemplate> = {
  BATAL_SEWABELI: {
    title: 'NOTIS PEMBATALAN SEWA BELI DAN TUNTUTAN HUTANG',
    body: para(
      recipient,
      'Tuan/Puan,',
      '1. Kami merujuk kepada Perjanjian Sewa Beli ("Perjanjian") yang bermula pada {{start_date}} di antara {{company_name}} ("Syarikat") dan tuan/puan bagi kenderaan {{vehicle_make_model}} bernombor pendaftaran {{vehicle_plate}} ("Kenderaan").',
      '2. Sewa tidak dibayar melebihi empat belas (14) hari selepas tarikh matang walaupun peringatan bertulis (termasuk melalui WhatsApp) telah diberi. Ini keingkaran yang memberi hak kepada Syarikat untuk menamatkan Perjanjian dan mengambil balik Kenderaan.',
      '3. PEMBATALAN. Perjanjian ini DIBATALKAN mulai tarikh surat ini. Kenderaan hendaklah diserahkan kepada Syarikat dengan segera jika belum ditarik balik. Semua hak tuan/puan di bawah Perjanjian, termasuk Ganjaran Pemilikan (opsyen membeli Kenderaan dengan harga RM1), turut tamat. Barang peribadi yang tertinggal dalam Kenderaan boleh dituntut dalam tempoh 14 hari.',
      '4. TUNTUTAN HUTANG. Pembatalan ini tidak menghapuskan hutang tuan/puan. Jumlah yang dituntut ialah {{debt_breakdown}} (sewa tertunggak sehingga {{arrears_as_of}}). Sila jelaskan jumlah ini ke akaun {{company_bank_account}} dan hantar bukti bayaran kepada kami. Diskaun diberi jika bayaran penuh dibuat mengikut jadual di bawah, dikira dari tarikh surat ini:',
      rows(
        'JUMLAH HUTANG: {{total_debt}}',
        'Bayar dalam 7 hari | {{amount_7_days}} | Diskaun 10%',
        'Bayar dalam 14 hari | {{amount_14_days}} | Diskaun 5%',
        'Bayar selepas 14 hari | {{total_debt}} | Tiada diskaun',
      ),
      '5. Caj lewat bayar dan fi penamatan awal di bawah Perjanjian tidak akan dituntut jika jumlah di atas dijelaskan mengikut jadual. Pelan bayaran ansuran boleh dipohon dengan menghubungi Syarikat di {{company_phone}}.',
      '6. Sekiranya tiada bayaran atau maklum balas dalam tempoh {{pay_within_days}} hari dari tarikh surat ini (selewat-lewatnya {{pay_by_date}}), kes tuan/puan akan dirujuk kepada ejen kutipan hutang atau peguam untuk tindakan undang-undang, termasuk caj lewat bayar, fi penamatan awal dan kos, tanpa notis lanjut.',
    ),
  },
  TUNTUT_SEWA: {
    title: 'NOTIS TUNTUTAN BAYARAN HUTANG SEWA KERETA',
    body: para(
      recipient,
      'Tuan/Puan,',
      '1. Kami merujuk kepada Perjanjian {{agreement_type}} ("Perjanjian") yang bermula pada {{start_date}} di antara {{company_name}} ("Syarikat", iaitu Pemberi Sewa) dan tuan/puan bagi kenderaan {{vehicle_make_model}} bernombor pendaftaran {{vehicle_plate}} ("Kenderaan"), dengan sewa sebanyak {{rent_amount}} se{{rental_cycle}}.',
      '2. Setakat {{arrears_as_of}}, tuan/puan masih berhutang {{debt_breakdown}}. Jumlah ini belum termasuk caj lewat bayar di bawah Perjanjian, yang Syarikat tidak akan menuntut jika jumlah di bawah dijelaskan mengikut jadual.',
      '3. Dengan ini kami menuntut tuan/puan menjelaskan hutang tersebut dengan segera ke akaun {{company_bank_account}} dan menghantar bukti bayaran kepada kami. Sebagai galakan, kami menawarkan diskaun sekiranya bayaran penuh dibuat mengikut jadual di bawah, dikira dari tarikh surat ini:',
      rows(
        'JUMLAH HUTANG: {{total_debt}}',
        'Bayar dalam 7 hari | {{amount_7_days}} | Diskaun 10%',
        'Bayar dalam 14 hari | {{amount_14_days}} | Diskaun 5%',
        'Bayar selepas 14 hari | {{total_debt}} | Tiada diskaun',
      ),
      '4. Surat ini juga merupakan notis keingkaran bertulis di bawah Perjanjian. Sekiranya tiada bayaran atau maklum balas diterima dalam tempoh {{pay_within_days}} hari dari tarikh surat ini (iaitu selewat-lewatnya {{pay_by_date}}), Syarikat berhak menamatkan Perjanjian dan mengambil balik Kenderaan mengikut Perjanjian, dan akan melantik ejen kutipan hutang untuk menuntut keseluruhan hutang tertunggak berserta kos, tanpa notis lanjut.',
      '5. Pelan bayaran ansuran boleh dipohon dengan menghubungi Syarikat di {{company_phone}}. Sekiranya bayaran telah dibuat, sila abaikan notis ini dan kemukakan bukti bayaran kepada kami. Sekian, harap maklum.',
    ),
  },
  CTOS_LOD: {
    title: 'SURAT PERINGATAN TERAKHIR',
    body: para(
      rows(
        'Peringatan Terakhir Kepada | {{customer_name}}',
        'No. Kad Pengenalan | {{customer_nric}}',
        'No. Plat Kenderaan | {{vehicle_plate}}',
        'Jumlah Tertunggak | {{total_debt}}',
        'No. Rujukan | {{letter_ref}}',
        'Tarikh Surat Dikeluarkan | {{letter_date}}',
      ),
      'Tuan/Puan,',
      'Tuan/puan masih gagal menjelaskan tunggakan sebanyak {{total_debt}} kepada {{company_name}} ("Syarikat") di bawah Perjanjian {{agreement_type}} bagi kenderaan {{vehicle_plate}} walaupun telah diberi notis tuntutan bertulis. Ini adalah amaran terakhir.',
      'Sekiranya tiada bayaran atau maklum balas dalam tempoh {{pay_within_days}} hari dari tarikh surat ini (iaitu selewat-lewatnya {{pay_by_date}}), nama tuan/puan akan disenaraikan bersama CTOS Data Systems Sdn Bhd.',
      'Untuk makluman tuan/puan, CTOS ialah agensi pelaporan kredit yang berdaftar di bawah Akta Agensi Pelaporan Kredit 2010 dan dirujuk secara meluas oleh bank dan institusi kewangan di Malaysia. Syarikat ialah pelanggan berdaftar CTOS, dan pendedahan ini dibuat menurut persetujuan tuan/puan dalam Perjanjian. Penyenaraian ini boleh menjejaskan permohonan pinjaman, kad kredit atau sewa beli tuan/puan pada masa hadapan. Penyenaraian dalam CTOS hanyalah langkah pertama kami: sekiranya notis ini terus diabaikan, hutang ini tidak akan dihapuskan dan kami akan mengambil apa-apa tindakan undang-undang yang ada untuk menuntutnya semula berserta kos.',
      'Walau bagaimanapun, kami masih memberi satu peluang terakhir. Tuan/puan tidak perlu membayar sekali gus hari ini. Tuan/puan hanya perlu menghubungi kami dengan segera untuk mendaftar pelan bayaran ansuran.',
      'Sila hubungi {{company_phone}} dengan segera.',
      '---',
      '# FINAL REMINDER LETTER',
      rows(
        'Final reminder to | {{customer_name}}',
        'Identity card no. | {{customer_nric}}',
        'Vehicle plate no. | {{vehicle_plate}}',
        'Total outstanding | {{total_debt}}',
        'Reference no. | {{letter_ref}}',
        'Date of this letter | {{letter_date_en}}',
      ),
      'Dear Sir/Madam,',
      'You have failed to settle your outstanding debt of {{total_debt}} to {{company_name}} (the "Company") under your {{agreement_type}} agreement for vehicle {{vehicle_plate}}, despite a written demand. This is your final warning.',
      'If we receive no payment or response within {{pay_within_days}} days of the date of this letter (that is, by {{pay_by_date_en}}), your name will be listed with CTOS Data Systems Sdn Bhd.',
      'CTOS is a credit reporting agency registered under the Credit Reporting Agencies Act 2010 and widely relied on by banks and financial institutions in Malaysia. The Company is a registered CTOS subscriber, and this disclosure is made under the consent you gave in the agreement. A listing may affect your future applications for loans, credit cards or hire purchase. Listing you with CTOS is only our first step: if this notice is ignored, the debt will not be written off and we will take every legal action available to recover it, with costs.',
      'However, we are giving you one last chance. You do not need to pay a lump sum today. Contact us immediately to sign up for an instalment plan.',
      'Please call {{company_phone}} immediately.',
    ),
  },
};

/** The built-in draft for a letter: a fresh copy, safe to edit. */
export const defaultLetter = (kind: LetterKind): LetterTemplate => ({ ...DEFAULT_LETTERS[kind] });

/** A saved letter when it has the right shape, else the built-in draft. */
export const letterFromStored = (kind: LetterKind, stored: unknown): LetterTemplate => {
  const value = stored as { title?: unknown; body?: unknown } | null;
  return value && typeof value.title === 'string' && typeof value.body === 'string' ? { title: value.title, body: value.body } : defaultLetter(kind);
};

/** A safe file name, e.g. "CTOS LOD XAA1001 Fixture Driver.pdf". */
export const letterFileName = (kind: LetterKind, plate: string, driver: string): string =>
  `${[LETTER_LABELS[kind], plate, driver].map(part => (part || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()).filter(Boolean).join(' ')}.pdf`;

/** How the letter body is laid out, block by block (see LetterTemplate). */
export type LetterBlock =
  | { type: 'page' }
  | { type: 'title'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'fields'; rows: [string, string][] }
  | { type: 'table'; heading: string; rows: string[][] }
  | { type: 'paragraph'; text: string };

/** The body as blocks, in order. */
export const letterBlocks = (body: string): LetterBlock[] =>
  body.split(/\r?\n\s*\r?\n/).map(block => block.trim()).filter(Boolean).map((block): LetterBlock => {
    if (/^-{3,}$/.test(block)) return { type: 'page' };
    if (block.startsWith('# ')) return { type: 'title', text: block.slice(2).trim() };
    if (block.startsWith('>')) return { type: 'quote', text: block.replace(/^>\s?/gm, '').trim() };
    const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const cells = lines.map(line => line.split('|').map(cell => cell.trim()));
    const ruled = cells.filter(row => row.length > 1);
    if (ruled.length && ruled.every(row => row.length === 2) && ruled.length === cells.length) {
      return { type: 'fields', rows: cells.map(row => [row[0], row[1]] as [string, string]) };
    }
    if (ruled.length && (ruled.length === cells.length || (cells[0].length === 1 && ruled.length === cells.length - 1))) {
      return { type: 'table', heading: cells[0].length === 1 ? cells[0][0] : '', rows: ruled };
    }
    return { type: 'paragraph', text: block };
  });
