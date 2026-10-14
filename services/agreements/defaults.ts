import type { AgreementKind, AgreementSection } from './template.ts';

/**
 * The built-in agreement drafts (2026-10-09, for the owner to review), used until an admin saves their own version on
 * the Agreements page. Placeholders in {{double braces}} are filled from the form; see PLACEHOLDERS in template.ts.
 * Company details are never written here: they are typed on the Agreements page and kept in the database.
 */
const para = (...lines: string[]) => lines.join('\n\n');
const rows = (...lines: string[]) => lines.join('\n');

const lesseeRows = [
  'THE LESSEE',
  'Name | {{customer_name}}',
  'NRIC / Passport | {{customer_nric}}',
  'Mobile | {{customer_phone}}',
  'Address | {{customer_address}}',
  'Emergency contact | {{emergency_contact_name}}, {{emergency_contact_phone}}',
];

const vehicle: AgreementSection = {
  id: 'vehicle',
  title: 'Vehicle details',
  layout: 'table',
  body: rows(
    'Registration no. | {{vehicle_plate}}',
    'Make and model | {{vehicle_make}} {{vehicle_model}}',
    'Colour | {{vehicle_colour}}',
    'Chassis no. | {{vehicle_chassis_no}}',
    'Registration date | {{vehicle_registered_date}}',
    'Registered owner | {{vehicle_owner_name}}',
    "Registered owner's NRIC / company no. | {{vehicle_owner_id}}",
    'Odometer at handover | {{odometer_km}} km',
    'Fuel level at handover | {{fuel_level}}',
  ),
};

const signature: AgreementSection = {
  id: 'signature',
  title: 'Signature',
  layout: 'signature',
  body: rows(
    'Signed by the parties on the date shown against each signature.',
    'The Lessee | {{customer_name}} | {{customer_nric}} | {{agreement_date}}',
    'For and on behalf of the Lessor | {{company_name}} | {{company_reg_no}} | {{agreement_date}}',
    'Witness | {{witness_name}} | {{witness_id}} | {{agreement_date}}',
  ),
};

// Clauses both types share: using the vehicle, services, accidents, default and recovery, and the general terms.
const useOfVehicle = (n: number, recoveryClause: number) => para(
  `${n}. USING THE VEHICLE`,
  `${n}.1 Lawful use. The Lessee uses the Vehicle carefully and only for lawful e-hailing work and the Lessee's own personal use, and keeps the Lessee's driving licence, PSV licence, e-hailing registration and platform approvals valid at all times.`,
  `${n}.2 Approved drivers only. Only the Lessee, or another driver the Lessor approves in writing, may drive or keep the Vehicle.`,
  `${n}.3 No third parties. The Lessee must not sell, rent out, sub-let ("sewa atas sewa"), lend, pawn or hand the Vehicle to anyone else, and must not let anyone use the Lessee's identity on an e-hailing platform with it.`,
  `${n}.4 Safe driving. Do not drive carelessly or while affected by alcohol, drugs, tiredness or illness.`,
  `${n}.5 No changes. Do not modify the Vehicle, remove parts, or tamper with the odometer, GPS tracker or safety equipment.`,
  `${n}.6 Charges from use. The Lessee pays all tolls, parking, fuel, summonses, compounds and fines incurred while the Vehicle is with the Lessee, even if the notice arrives later.`,
  `${n}.7 GPS and recovery. The Lessee consents to the Vehicle being tracked by GPS at all times for safety, servicing and protecting the Vehicle, and to the Lessor using and sharing that location with the police, its insurer or its recovery agent to recover the Vehicle under clause ${recoveryClause}.`,
  `${n}.8 Report changes. Tell the Lessor promptly of any warning light, defect, breakdown, lost key or document, and any change of phone number, address or where the Vehicle is normally kept.`,
);

const services = (n: number) => para(
  `${n}. ROAD TAX, INSURANCE AND MAINTENANCE`,
  `${n}.1 Road tax and insurance. The Lessor renews the Vehicle's road tax and insurance and gives the Lessee the documents needed to drive lawfully.`,
  `${n}.2 Servicing. The Lessee brings the Vehicle for scheduled servicing and inspection when asked. Routine servicing and approved repairs are arranged by the Lessor.`,
  `${n}.3 Not covered. Unless the Lessor agrees in writing, the Lessee pays for bulbs, wipers, remote batteries, punctures and tyres, for cosmetic or body damage not recovered from insurance, and for any damage caused by the Lessee's negligence, misuse, unapproved repair or late reporting.`,
  `${n}.4 Repairs need approval. Except in a genuine emergency, get the Lessor's written approval before any repair. The Lessor does not pay for work it did not approve.`,
);

const accidents = (n: number) => para(
  `${n}. ACCIDENT, THEFT AND DAMAGE`,
  `${n}.1 Tell the Lessor at once. Secure the Vehicle and notify the Lessor immediately of any accident, theft, fire, flood, seizure or serious damage.`,
  `${n}.2 Police report. Make any required police report and give the Lessor the report, photos, the other party's details and insurer documents within 24 hours.`,
  `${n}.3 Do not settle. Do not admit fault, settle a claim or arrange non-emergency repair without the Lessor's written approval.`,
  `${n}.4 Lessee's share. For any accident, loss or damage while the Vehicle is with the Lessee, the Lessee pays the insurance excess and towing. Loss the insurance does not cover, and any damage, are paid by the Lessee in full where caused by the Lessee's negligence, misuse, breach or late reporting.`,
  `${n}.5 Rent continues. Rent remains payable while the Vehicle is off the road because of the Lessee's accident, negligence, misuse or missed servicing.`,
);

/** Rent: payment, late charge, no deductions, records and statements, yearly review. */
const rentClauses = (n: number) => [
  `${n}.1 Rent. The Lessee pays the Rent of {{rent_amount}} per {{rental_cycle}}, on or before the due day in Section A, into the payment account in Section A, quoting the Vehicle's registration number. A payment counts on the day the money reaches that account and is identified as the Lessee's.`,
  `${n}.2 Late charge. Rent not paid by the due day carries a late charge at 18% a year, worked out daily on the amount still unpaid (including late charges already added) from the second day after the due day until it is paid. The due day does not change.`,
  `${n}.3 No deductions. The Lessee may not hold back or reduce rent because of a repair, claim or dispute unless the Lessor agrees in writing.`,
  `${n}.4 Records and statements. The Lessee keeps proof of every payment. The Lessor's payment records are conclusive unless they contain an obvious error. The Lessor gives the Lessee a statement at least every six months; a dispute must be raised in writing within 14 days of the statement, after which it is final.`,
  `${n}.5 Fixed Rent. The Rent in Section A is fixed for the Lease Period. Any change must be agreed in writing by both parties.`,
];

/** Default, written notice, recovery with a record of each step, and immediate recovery in serious cases. */
const defaultAndRecovery = (n: number, title: string) => [
  `${n}. ${title}`,
  `${n}.1 Default. Each of these is a default: Rent unpaid 14 days after its due day; false information given to the Lessor; abandoning the Vehicle; illegal use; losing a required licence or e-hailing approval; letting a third party use the Vehicle; tampering with the tracker or odometer; or any other serious breach of this Agreement.`,
  `${n}.2 Default notice. The Lessor sends a written default notice stating the breach and giving at least 7 days to put it right, or any longer period the law requires.`,
  `${n}.3 Recovery. If the default is not put right in time, the Lessor may end this Agreement, recover the Vehicle by lawful means and claim arrears, late charges and reasonable recovery, towing, storage and repair costs. Ending this Agreement does not cancel any sum the Lessee owes. The Lessor keeps a record of each notice and step taken.`,
  `${n}.4 Serious cases. If the Vehicle is abandoned, used illegally, held by a third party or at risk of loss, the Lessor may recover it at once and then notify the Lessee.`,
];

const general = (n: number) => para(
  `${n}. GENERAL`,
  `${n}.1 Notices. Notices may be given by hand, post, email or WhatsApp to the latest contact details given. Each party keeps its contact details up to date.`,
  `${n}.2 Personal data. The Lessor collects and uses the Lessee's identity, contact, emergency-contact, payment, vehicle and GPS data to run this Agreement and for insurance, safety, recovery of the Vehicle, collection of sums due and legal compliance. The Lessor may disclose that data, including any default, to its insurer, financier, lawyers, recovery or debt-collection agent, the authorities, and a credit reporting agency registered under the Credit Reporting Agencies Act 2010 (such as CTOS). The Lessee may ask to see or correct the data using the Lessor's contact details.\nData peribadi. Pemberi Sewa mengumpul dan menggunakan data identiti, hubungan, kenalan kecemasan, bayaran, kenderaan dan GPS Penyewa untuk melaksanakan Perjanjian ini dan bagi tujuan insurans, keselamatan, pemulihan Kenderaan, kutipan jumlah terhutang dan pematuhan undang-undang. Pemberi Sewa boleh mendedahkan data tersebut, termasuk sebarang keingkaran, kepada penanggung insurans, pembiaya, peguam, ejen pemulihan atau kutipan hutang, pihak berkuasa, dan agensi pelaporan kredit yang berdaftar di bawah Akta Agensi Pelaporan Kredit 2010 (seperti CTOS). Penyewa boleh meminta untuk melihat atau membetulkan data tersebut melalui butiran hubungan Pemberi Sewa.`,
  `${n}.3 Indemnity. The Lessee covers the Lessor against claims, fines and costs arising from the Lessee's use or custody of the Vehicle or breach of this Agreement, except where caused by the Lessor.`,
  `${n}.4 Whole agreement. Sections A to D are the whole agreement between the parties. Any change or waiver must be in writing and signed by both parties. Neither party relies on any promise that is not written here.`,
  `${n}.5 Transfer. The Lessee may not transfer this Agreement. The Lessor may transfer its rights to a financier or related company by written notice, and may appoint an agent to collect sums due or recover the Vehicle.`,
  `${n}.6 Electronic signing. This agreement may be signed electronically where the method identifies the signer and keeps a reliable record.`,
  `${n}.7 Language. The key points in clause 1 and the personal-data notice in clause ${n}.2 are also given in Bahasa Malaysia. If the two versions differ, the English version applies.`,
  `${n}.8 Law. Malaysian law applies. If any term cannot be enforced, the rest of the agreement still applies. Any right the law gives the Lessee that cannot be excluded still applies.`,
);

const INITIALS = "Lessee's initials: ____________";

const BELI_TERMS = para(
  '1. KEY POINTS / PERKARA UTAMA',
  `1.1 Rental only. The Rent is a market rent for using the Vehicle and the Lessor's services under this Agreement. The Lessee builds up no ownership or equity, and nothing is refunded if the Ownership Reward is not earned.\nSewa sahaja. Sewa ialah sewa pasaran untuk menggunakan Kenderaan dan perkhidmatan Pemberi Sewa di bawah Perjanjian ini. Penyewa tidak memperoleh apa-apa hak milik atau ekuiti, dan tiada bayaran dikembalikan jika Ganjaran Pemilikan tidak diperoleh.\n${INITIALS}`,
  `1.2 Ownership Reward. If the Lessee meets every condition in clause 6, the Lessor gives the Lessee an option to buy the Vehicle for RM1 by a separate Completion Letter (clause 7). Until then the Lessee has no right to the Vehicle beyond this lease.\nGanjaran Pemilikan. Jika Penyewa memenuhi setiap syarat dalam klausa 6, Pemberi Sewa memberi Penyewa opsyen untuk membeli Kenderaan dengan harga RM1 melalui Surat Penyelesaian yang berasingan (klausa 7). Sehingga itu, Penyewa tiada hak ke atas Kenderaan selain sewaan ini.\n${INITIALS}`,
  `1.3 Paying late is not enough. Settling everything in the end does not by itself earn the Ownership Reward. At least {{min_on_time_rentals}} of the {{duration}} Rent payments must be On-Time, as clause 6 requires.\nBayar lewat tidak mencukupi. Menjelaskan semua bayaran pada akhirnya tidak dengan sendirinya melayakkan Ganjaran Pemilikan. Sekurang-kurangnya {{min_on_time_rentals}} daripada {{duration}} bayaran Sewa mesti Tepat Pada Masa, seperti yang dikehendaki oleh klausa 6.\n${INITIALS}`,
  `1.4 Losing the reward. Ending early, repossession for non-payment or another serious breach ends the right to the Ownership Reward. Ending early without notice also carries the early-termination fee in clause 9.6.\nKehilangan ganjaran. Penamatan awal, penarikan balik Kenderaan kerana tidak membayar atau pelanggaran serius lain menamatkan hak kepada Ganjaran Pemilikan. Penamatan awal tanpa notis juga dikenakan fi penamatan awal dalam klausa 9.6.\n${INITIALS}`,
  '2. THE LEASE',
  '2.1 Fixed period. The Lessor leases the Vehicle in Section D to the Lessee from the Commencement Date for the Lease Period, both stated in Section A. The lease ends on the Scheduled Maturity Date in Section A unless it ends earlier under clause 9 or continues under clause 2.5.',
  '2.2 Ownership stays with the owner. The Vehicle belongs to its registered owner (Section D) or financier, which is the Lessor or has authorised the Lessor to lease it, unless and until it is sold to the Lessee under clause 7. The Lessee may not sell, pledge or claim it.',
  '2.3 Condition at handover. The Lessee accepts the Vehicle in the condition recorded at handover (odometer, fuel and photos), apart from any defect reported at handover.',
  '2.4 Inspection. The Lessor may inspect the Vehicle on reasonable notice, or at once for safety, insurance, default or recovery reasons.',
  '2.5 After the Scheduled Maturity Date. If the Lessee keeps the Vehicle after the Scheduled Maturity Date, this Agreement continues {{rental_cycle}} by {{rental_cycle}} on the same terms, and Rent stays payable, until the Vehicle is returned or the Lessee takes up the option under clause 7.2.',
  '3. RENT AND PAYMENT',
  ...rentClauses(3),
  '3.6 Downpayment. The downpayment in Section A is required and paid before handover. It is not Rent, not a security deposit and not refundable.',
  '3.7 Security deposit. Any security deposit in Section A is not Rent. The Lessor may use it for unpaid sums, loss or damage. Any balance is refunded within 14 days after the Vehicle is returned and checked or the transfer under clause 7 is completed. If the Lessee moves to another vehicle from the Lessor, the deposit is settled before the new agreement starts and is not carried over to it.',
  useOfVehicle(4, 9),
  services(5),
  '6. PAYMENT PERFORMANCE AND OWNERSHIP REWARD',
  '6.1 On-Time Payment. A Rent payment is On-Time if the money reaches the Lessor on the due day or within 3 days after it. A payment on the second or third day is On-Time but still carries the late charge in clause 3.2.',
  '6.2 Serious Late Payment. A Rent payment is a Serious Late Payment if it is still unpaid 14 days after its due day.',
  '6.3 Earning the Ownership Reward. The Lessee earns the Ownership Reward only if the Lessee:',
  '(a) completes the full Lease Period;',
  '(b) pays all Rent and other sums due by the Scheduled Maturity Date, or within 30 days after it;',
  '(c) makes at least {{min_on_time_rentals}} of the {{duration}} Rent payments On-Time;',
  '(d) has no Chronic Late Payment (clause 6.4) and no default that is not put right;',
  '(e) has not let a third party use the Vehicle, used it illegally, abandoned it, tampered with the odometer or tracker, or damaged it on purpose;',
  '(f) has no unpaid summons, compound or fine, and every insurance claim from the Lessee\'s use is settled; and',
  '(g) returns the Vehicle for a final inspection and it passes, apart from fair wear and tear.',
  '6.4 Chronic Late Payment. Chronic Late Payment means any one of these: fewer than {{min_on_time_rentals}} On-Time payments; 3 or more Serious Late Payments in any 12 months; 6 or more Serious Late Payments in the Lease Period; arrears unpaid for more than 30 days in a row on 2 or more occasions; or repossession or termination for non-payment.',
  '6.5 Warning first. Except for serious misconduct, the Lessor gives written notice of a breach that puts the Ownership Reward at risk, with at least 7 days to put it right. Paying arrears clears the debt but does not change the payment record.',
  '6.6 Payment plan. In the last 3 months of the Lease Period the Lessor may, at its choice, agree in writing a payment plan of up to 180 days for arrears and state whether the Ownership Reward is kept. If a plan payment is more than 7 days late, that protection ends.',
  '7. OWNERSHIP REWARD: OPTION TO BUY',
  '7.1 Completion Letter. When the Lessee has earned the Ownership Reward, the Lessor issues a Completion Letter giving the Lessee the option to buy the Vehicle for RM1. The option stays open for 60 days from the letter.',
  '7.2 Buying the Vehicle. The Lessee takes up the option by signing the Completion Letter and paying RM1 and the transfer costs in clause 7.3 within the 60 days. The Lessor then arranges the transfer of registration under clause 7.4.',
  '7.3 Costs. The Lessor pays any outstanding finance on the Vehicle. The Lessee pays JPJ, PUSPAKOM, inspection, registration, insurance-change and other official transfer costs.',
  '7.4 Timing. The Lessor starts the transfer within 14 days after the option is taken up and the Lessee\'s documents and costs are received, and aims to complete it within 90 days.',
  '7.5 Replacement vehicle. If the Vehicle cannot be transferred for a reason that is not the Lessee\'s fault, or the Lessor replaces it during the lease, the Lessee\'s payment record carries over to a reasonably equivalent vehicle.',
  '7.6 No cash value. The Ownership Reward has no cash value, cannot be exchanged for money and cannot be transferred to anyone else.',
  accidents(8),
  ...defaultAndRecovery(9, 'DEFAULT, RECOVERY AND ENDING THE LEASE'),
  '9.5 Ending early. The Lessee may end the lease by giving one month\'s written notice, returning the Vehicle, paying all sums due and completing the return inspection. Ending early ends the Ownership Reward; Rent already paid is not refunded.',
  '9.6 Early-termination fee. If the Lessee ends the lease early without the notice in clause 9.5, or the Lessor ends it for default, the Lessee pays an early-termination fee of one month\'s Rent (four weeks\' Rent if Rent is weekly), charged once, on top of arrears and the costs in clause 9.3. The parties agree it is a reasonable estimate of the Lessor\'s loss from the lease ending early (re-letting, the Vehicle standing idle and administration).',
  '9.7 Return condition. The Vehicle, keys, documents and accessories must be returned in the condition recorded at handover, apart from fair wear and tear.',
  general(10),
);

// Sewa Biasa: the short version (owner's request of 2026-10-09), its terms on one page.
const BIASA_TERMS = para(
  '1. THE RENTAL',
  '1.1 Rental only. The Lessee rents the Vehicle in Section D for the Rental Period in Section A, as recorded at handover, and never owns it; its registered owner (Section D) is the Lessor or has authorised the Lessor to rent it out. If not returned at the end, the rental continues {{rental_cycle}} by {{rental_cycle}} on the same terms until ended under clause 5.',
  '2. RENT',
  '2.1 Rent. The Lessee pays the Rent of {{rent_amount}} per {{rental_cycle}} by the due day in Section A into the payment account in Section A, quoting the plate number, without any deduction.',
  '2.2 Late charge. Overdue Rent carries a late charge of 18% a year, added daily on the unpaid amount (including earlier late charges) from the second day after the due day until paid.',
  '2.3 Records and review. The Lessor\'s payment records are conclusive unless clearly wrong; the Rent may be reviewed once a year on 30 days\' written notice.',
  '3. DEPOSIT',
  '3.1 Refund or forfeit. The deposit is not Rent. Within 14 days after the Vehicle is returned and checked, the Lessor refunds it less anything owed (unpaid Rent and charges, summonses, damage, cleaning and recovery costs). The whole deposit is forfeited if the Vehicle is returned without the notice in clause 5.1, abandoned, or recovered for non-payment or another default.',
  '4. USE AND CARE',
  '4.1 Lawful use. Use the Vehicle only for lawful e-hailing work and personal use, keep all licences and platform approvals valid, and let no one else drive it without the Lessor\'s written approval. No sub-letting ("sewa atas sewa"), modifying the Vehicle or tampering with the odometer or GPS tracker; the Lessee consents to GPS tracking, including for recovery.',
  '4.2 Costs. The Lessee pays tolls, fuel, parking, summonses and fines during the rental and brings the Vehicle in for servicing when asked; the Lessor renews road tax and insurance and arranges servicing.',
  '4.3 Accidents. Tell the Lessor at once, report to the police within 24 hours, and do not admit fault or arrange repairs without approval. The Lessee pays the insurance excess and towing, and any uninsured loss or damage caused by the Lessee\'s negligence, misuse or breach; Rent continues meanwhile.',
  '5. ENDING, RECOVERY AND GENERAL',
  '5.1 Ending. Either party may end the rental with one week\'s written notice. The Vehicle, keys and documents must be returned in the handover condition, apart from fair wear and tear.',
  '5.2 Default and recovery. If rent is 3 days overdue or the Lessee breaks this Agreement, the Lessor sends a written notice giving 7 days to put it right. If it is not put right, the Lessor may end the rental, recover the Vehicle lawfully and claim arrears, late charges and recovery costs, which ending the rental does not cancel. If the Vehicle is abandoned, used illegally or held by a third party, the Lessor may recover it at once.',
  '5.3 General. Notices may be given by hand, email or WhatsApp. Any change must be in writing and signed by both parties. Malaysian law applies.',
  '5.4 Personal data. The Lessor uses the Lessee\'s personal, payment and GPS data to run this Agreement and recover the Vehicle and debts, and may share it, including any default, with its insurer, agents, the authorities and a credit reporting agency such as CTOS.\nData peribadi. Pemberi Sewa menggunakan data peribadi, bayaran dan GPS Penyewa untuk Perjanjian ini dan menuntut Kenderaan serta hutang, dan boleh berkongsinya, termasuk keingkaran, dengan penanggung insurans, ejen, pihak berkuasa dan agensi pelaporan kredit seperti CTOS.',
);

const schedule = (kind: AgreementKind): AgreementSection => ({
  id: 'schedule',
  title: 'Schedule',
  layout: 'table',
  body: rows(
    'Agreement ref. | {{agreement_ref}}',
    'Agreement date | {{agreement_date}}',
    ...lesseeRows,
    kind === 'SEWABELI' ? 'THE LEASE' : 'THE RENTAL',
    'Vehicle | {{vehicle_make}} {{vehicle_model}}, {{vehicle_plate}} (details in Section D)',
    '{{rental_cycle_label}} rent | {{rent_amount}}',
    'Payment due | {{payment_due}}',
    `${kind === 'SEWABELI' ? 'Lease' : 'Rental'} period | {{duration_text}}`,
    `${kind === 'SEWABELI' ? 'Commencement' : 'Start'} date | {{start_date}}`,
    `${kind === 'SEWABELI' ? 'Scheduled maturity date' : 'End date'} | {{end_date}}`,
    ...(kind === 'SEWABELI'
      ? ['Total scheduled rent | {{aggregate_rental}}', 'Downpayment | {{downpayment_amount}}', 'Security deposit | {{deposit_amount}}',
        'Ownership Reward | Option to buy the Vehicle for RM1 if {{min_on_time_rentals}} of the {{duration}} Rent payments are On-Time (Section B, clause 6)',
        "Early-termination fee | One month's Rent, four weeks' if weekly (Section B, clause 9.6)"]
      : ['Deposit (refundable) | {{deposit_amount}}']),
    'Permitted use | E-hailing and the Lessee\'s personal use',
    'Payment account | {{company_bank_account}}',
  ),
});

const preamble = (verb: string) => para(
  'THIS AGREEMENT is made on {{agreement_date}} BETWEEN {{company_name}} (Company No. {{company_reg_no}}) (the "Lessor" / "Pemberi Sewa") AND {{customer_name}} (NRIC / Passport No. {{customer_nric}}) of {{customer_address}} (the "Lessee" / "Penyewa").',
  `The Lessor agrees to ${verb} the vehicle in Section D (the "Vehicle" / "Kenderaan") to the Lessee on the terms in Sections A to D. "Rent" ("Sewa") is the rent in Section A; other capitalised terms are defined in Section A or where they first appear.`,
);

export const DEFAULT_SECTIONS: Record<AgreementKind, { title: string; preamble: string; sections: AgreementSection[] }> = {
  SEWABELI: {
    title: 'Vehicle Leasing Agreement (Sewa Beli)',
    preamble: preamble('lease'),
    sections: [schedule('SEWABELI'), { id: 'terms', title: 'General terms', layout: 'clauses', body: BELI_TERMS }, signature, vehicle],
  },
  SEWA_BIASA: {
    title: 'Vehicle Rental Agreement (Sewa Biasa)',
    preamble: preamble('rent'),
    sections: [schedule('SEWA_BIASA'), { id: 'terms', title: 'General terms', layout: 'clauses', body: BIASA_TERMS }, signature, vehicle],
  },
};
