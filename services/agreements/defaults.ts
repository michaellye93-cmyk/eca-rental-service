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
    'IN WITNESS WHEREOF the parties have signed this Agreement on the date first written above.',
    'The Lessee | {{customer_name}} | {{customer_nric}} | {{agreement_date}}',
    'For and on behalf of the Lessor | {{company_name}} | {{company_reg_no}} | {{agreement_date}}',
    'Witness | {{witness_name}} | {{witness_id}} | {{agreement_date}}',
  ),
};

// Clauses both types share: using the vehicle, services, accidents, default and recovery, and the general terms.
const useOfVehicle = (n: number, recoveryClause: number) => para(
  `${n}. USING THE VEHICLE`,
  `${n}.1 Lawful use. Use the Vehicle carefully and only for lawful e-hailing work and the Lessee's own personal use. Keep your driving licence, PSV licence, e-hailing registration and platform approvals valid at all times.`,
  `${n}.2 Approved drivers only. Only the Lessee, or another driver the Lessor approves in writing, may drive or keep the Vehicle.`,
  `${n}.3 No third parties. Do not sell, rent out, sub-let ("sewa atas sewa"), lend, pawn or hand the Vehicle to anyone else, and do not let anyone use your identity on an e-hailing platform with it.`,
  `${n}.4 Safe driving. Do not drive carelessly or while affected by alcohol, drugs, tiredness or illness.`,
  `${n}.5 No changes. Do not modify the Vehicle, remove parts, or tamper with the odometer, GPS tracker or safety equipment.`,
  `${n}.6 Charges from use. The Lessee pays all tolls, parking, fuel, summonses, compounds and fines incurred while the Vehicle is with the Lessee, even if the notice arrives later.`,
  `${n}.7 GPS and recovery. The Lessee consents to the Vehicle being tracked by GPS at all times for safety, servicing and protecting the Vehicle, and to the Lessor using that location to recover the Vehicle under clause ${recoveryClause}.`,
  `${n}.8 Report changes. Tell the Lessor promptly of any warning light, defect, breakdown, lost key or document, and any change of phone number, address or where the Vehicle is normally kept.`,
);

const services = (n: number) => para(
  `${n}. ROAD TAX, INSURANCE AND MAINTENANCE`,
  `${n}.1 Road tax and insurance. The Lessor renews the Vehicle's road tax and insurance and gives the Lessee the documents needed to drive lawfully.`,
  `${n}.2 Servicing. The Lessee brings the Vehicle for scheduled servicing and inspection when asked. Routine servicing and approved repairs are arranged by the Lessor.`,
  `${n}.3 Not covered. Unless the Lessor agrees in writing, the Lessee pays for bulbs, wipers, remote batteries, punctures, tyres, cosmetic or body damage, and any damage caused by negligence, misuse, unapproved repair or late reporting.`,
  `${n}.4 Repairs need approval. Except in a genuine emergency, get the Lessor's written approval before any repair. The Lessor does not pay for work it did not approve.`,
);

const accidents = (n: number) => para(
  `${n}. ACCIDENT, THEFT AND DAMAGE`,
  `${n}.1 Tell the Lessor at once. Secure the Vehicle and notify the Lessor immediately of any accident, theft, fire, flood, seizure or serious damage.`,
  `${n}.2 Police report. Make any required police report and give the Lessor the report, photos, the other party's details and insurer documents within 24 hours.`,
  `${n}.3 Do not settle. Do not admit fault, settle a claim or arrange non-emergency repair without the Lessor's written approval.`,
  `${n}.4 Lessee's share. The Lessee pays the insurance excess, any loss the insurance does not cover, towing, and the cost of minor damage, where caused by the Lessee's negligence, misuse, breach or late reporting.`,
  `${n}.5 Rent continues. Rent remains payable while the Vehicle is off the road because of the Lessee's accident, negligence, misuse or missed servicing.`,
);

/** Rent: payment, late charge, no deductions, records and statements, yearly review. */
const rentClauses = (n: number) => [
  `${n}.1 Rent. The Lessee pays {{rent_amount}} per {{rental_cycle}}, on or before the due day in Section A, into the payment account in Section A. A payment counts when the money reaches the Lessor and can be matched to this agreement.`,
  `${n}.2 Late charge. On rent not paid by the due day, a late charge of 18% a year (1.5% a month) is added on the overdue amount, counted daily from the second day after the due day until it is paid. The due day does not change.`,
  `${n}.3 No deductions. The Lessee may not hold back or reduce rent because of a repair, claim or dispute unless the Lessor agrees in writing.`,
  `${n}.4 Records and statements. The Lessee keeps proof of every payment. The Lessor's payment records are conclusive unless they contain an obvious error. The Lessor sends the Lessee a payment statement at least every six months. Any dispute must be raised in writing within 14 days of receiving a statement; after that the statement is final.`,
  `${n}.5 Yearly rent review. Once a year, the Lessor may adjust the rent to reflect changes in insurance, road tax or maintenance costs by giving 30 days' written notice.`,
];

/** Default, written notice, recovery with a record of each step, and immediate recovery in serious cases. */
const defaultAndRecovery = (n: number, title: string) => [
  `${n}. ${title}`,
  `${n}.1 Default. Default includes rent unpaid for 14 days after its due day, false information, abandoning the Vehicle, illegal use, losing a required licence or e-hailing approval, letting a third party use the Vehicle, or tampering with the tracker.`,
  `${n}.2 Default notice. The Lessor sends a written default notice stating the breach and giving at least 7 days to put it right, or any longer period the law requires.`,
  `${n}.3 Recovery. If the default is not put right in time, the Lessor may end this agreement, recover the Vehicle by lawful means and claim arrears and reasonable recovery, towing, storage and repair costs. The Lessor keeps a record of each notice and step taken.`,
  `${n}.4 Serious cases. If the Vehicle is abandoned, used illegally, held by a third party or at risk of loss, the Lessor may recover it at once and then notify the Lessee.`,
];

const general = (n: number) => para(
  `${n}. GENERAL`,
  `${n}.1 Notices. Notices may be given by hand, post, email or WhatsApp to the latest contact details given. Each party keeps its contact details up to date.`,
  `${n}.2 Personal data. The Lessor may use the Lessee's identity, contact, payment, emergency-contact, vehicle and GPS information to run this agreement, for insurance, safety, recovery and legal compliance.`,
  `${n}.3 Indemnity. The Lessee covers the Lessor against claims, fines and costs arising from the Lessee's use or custody of the Vehicle or breach of this agreement, except where caused by the Lessor.`,
  `${n}.4 Whole agreement. This agreement is the whole agreement. Any change or waiver must be in writing and signed by both parties. Do not rely on any promise that is not written here.`,
  `${n}.5 Transfer. The Lessee may not transfer this agreement. The Lessor may transfer its rights to a financier or related company by written notice.`,
  `${n}.6 Electronic signing. This agreement may be signed electronically where the method identifies the signer and keeps a reliable record.`,
  `${n}.7 Language. The key points in clause 1 are also given in Bahasa Malaysia. If the two versions differ, the English version applies.`,
  `${n}.8 Law. Malaysian law applies. If any term cannot be enforced, the rest of the agreement still applies. Any right the law gives the Lessee that cannot be excluded still applies.`,
);

const INITIALS = "Lessee's initials: ____________";

const BELI_TERMS = para(
  '1. KEY POINTS / PERKARA UTAMA',
  `1.1 Rental only. The rent is market rent for using the Vehicle and the services in this agreement. No equity or ownership builds up, and nothing is refunded if the Ownership Reward is not earned.\nSewaan sahaja. Sewa ialah bayaran untuk menggunakan Kenderaan dan perkhidmatan dalam perjanjian ini. Tiada ekuiti atau hak milik terkumpul, dan tiada bayaran dikembalikan jika Ganjaran Pemilikan tidak diperoleh.\n${INITIALS}`,
  `1.2 Ownership Reward. If the Lessee meets every condition in clause 6, the Lessor gives the Lessee an option to buy the Vehicle for RM1 by a separate Completion Letter. Until then, the Lessor owes the Lessee nothing beyond the rental.\nGanjaran Pemilikan. Jika Penyewa memenuhi setiap syarat dalam klausa 6, Pemberi Sewa memberi Penyewa opsyen untuk membeli Kenderaan dengan harga RM1 melalui Surat Penyelesaian yang berasingan. Sehingga itu, Pemberi Sewa tidak berhutang apa-apa kepada Penyewa selain sewaan.\n${INITIALS}`,
  `1.3 Paying everything late is not enough. Settling all money in the end does not by itself earn the Ownership Reward. Payments must also be On-Time as clause 6 requires.\nMembayar semua secara lewat tidak mencukupi. Bayaran mesti dibuat Tepat Pada Masa seperti yang dikehendaki oleh klausa 6.\n${INITIALS}`,
  `1.4 Losing the reward. Ending early, repossession for non-payment or another serious breach ends the right to the Ownership Reward. Ending early also carries the fee in clause 9.6.\nKehilangan ganjaran. Penamatan awal, penarikan balik kenderaan kerana tidak membayar atau pelanggaran serius lain menamatkan hak kepada Ganjaran Pemilikan. Penamatan awal juga dikenakan fi dalam klausa 9.6.\n${INITIALS}`,
  '2. THE LEASE',
  '2.1 Fixed period. The Lessor leases the Vehicle in Section D to the Lessee from the Commencement Date for the Lease Period in Section A. The lease ends on the Scheduled Maturity Date unless it ends earlier. Any extension must be in writing.',
  '2.2 Ownership stays with the owner. The Vehicle belongs to the registered owner or financier unless and until it is sold to the Lessee under clause 7. The Lessee may not sell or pledge it.',
  '2.3 Condition at handover. The Lessee accepts the Vehicle in the condition recorded at handover (odometer, fuel and photos), apart from any defect reported at handover.',
  '2.4 Inspection. The Lessor may inspect the Vehicle on reasonable notice, or at once for safety, insurance, default or recovery reasons.',
  '3. RENT AND PAYMENT',
  ...rentClauses(3),
  '3.6 Downpayment. Any downpayment in Section A is paid before handover. It is not rent, not a security deposit and not refundable.',
  '3.7 Security deposit. Any security deposit in Section A may be used for unpaid sums, loss or damage. Any balance is settled at the final account.',
  useOfVehicle(4, 9),
  services(5),
  '6. PAYMENT PERFORMANCE AND OWNERSHIP REWARD',
  '6.1 On-Time Payment. A rent payment is On-Time if it is received on the due day or within three days after it.',
  '6.2 Serious Late Payment. A rent payment still unpaid 14 days after its due day.',
  '6.3 Earning the Ownership Reward. The Lessee earns the Ownership Reward only when the Lessee: (a) completes the full Lease Period; (b) pays all rent and other sums by the Scheduled Maturity Date or within 30 days after it; (c) has at least {{min_on_time_rentals}} of the {{duration}} rent payments On-Time; (d) has no Chronic Late Payment under clause 6.4 and no unresolved default; (e) has not let a third party use the Vehicle, used it illegally, abandoned it, tampered with the odometer or tracker, or damaged it on purpose; (f) has no unpaid summons, compound or fine, and any insurance claim from the Lessee\'s use is settled; and (g) returns the Vehicle for a final inspection, which it passes apart from fair wear and tear.',
  '6.4 Chronic Late Payment. Any one of these: fewer than {{min_on_time_rentals}} On-Time payments; three or more Serious Late Payments in any 12 months; six or more Serious Late Payments in the Lease Period; arrears unpaid for more than 30 days in a row on two or more occasions; or repossession or termination for non-payment.',
  '6.5 Warning first. Except for serious misconduct, the Lessor gives written notice of a breach that puts the Ownership Reward at risk, with at least seven days to put it right. Paying arrears clears the debt but does not change the payment record.',
  '6.6 Payment plan. Near the end of the lease the Lessor may, at its choice, agree a written payment plan of up to 180 days for temporary arrears and say in writing whether the Ownership Reward is kept. A plan payment more than seven days late ends that protection.',
  '7. OWNERSHIP REWARD: OPTION TO BUY',
  '7.1 Completion Letter. When the Lessee has earned the Ownership Reward, the Lessor issues a Completion Letter giving the Lessee the option to buy the Vehicle for RM1. The option stays open for 60 days from the letter.',
  '7.2 Buying the Vehicle. The Lessee takes up the option by signing the Completion Letter and paying RM1 and the transfer costs in clause 7.3. The Lessor then settles any finance on the Vehicle and arranges the legal transfer.',
  '7.3 Costs. The Lessor pays any outstanding finance on the Vehicle. The Lessee pays JPJ, PUSPAKOM, inspection, registration, insurance-change and other official transfer costs.',
  '7.4 Timing. The Lessor starts the transfer within 14 days after the option is taken up and the Lessee\'s documents and costs are received, and aims to complete it within 90 days.',
  '7.5 Replacement vehicle. If the Vehicle cannot be transferred for a reason that is not the Lessee\'s fault, or the Lessor replaces it during the lease, the Lessee\'s payment record carries over to a reasonably equivalent vehicle.',
  '7.6 No cash value. The Ownership Reward has no cash value, cannot be exchanged for money and cannot be transferred to anyone else.',
  accidents(8),
  ...defaultAndRecovery(9, 'DEFAULT, RECOVERY AND ENDING THE LEASE'),
  '9.5 Ending early. The Lessee may end the lease with one month\'s written notice by returning the Vehicle, paying all sums due and completing the return inspection. Ending early ends the Ownership Reward, and rent already paid is not refunded.',
  '9.6 Early-termination fee. A Lessee who ends the lease early, or whose lease the Lessor ends for default, pays an early-termination fee of four weeks\' rent. The parties agree this is a genuine estimate of the Lessor\'s loss from a long-term lease ending early (finding a new driver, the Vehicle standing idle and administration).',
  '9.7 Return condition. The Vehicle, keys, documents and accessories must be returned in the condition recorded at handover, apart from fair wear and tear.',
  general(10),
);

// Sewa Biasa: the short version (owner's request of 2026-10-09), its terms on one page.
const BIASA_TERMS = para(
  '1. THE RENTAL',
  '1.1 Rental only. The Lessee rents the Vehicle in Section D for the Rental Period in Section A, in the condition recorded at handover (odometer, fuel and photos), and never owns it. If the Vehicle is not returned at the end, the rental continues {{rental_cycle}} by {{rental_cycle}} on the same terms until ended under clause 5.',
  '2. RENT',
  '2.1 Rent. The Lessee pays {{rent_amount}} per {{rental_cycle}} on or before the due day in Section A, into the payment account in Section A, without any deduction.',
  '2.2 Late charge. Overdue rent carries a late charge of 18% a year (1.5% a month), counted daily from the second day after the due day until paid.',
  '2.3 Records and review. The Lessor\'s payment records are conclusive unless they contain an obvious error. The Lessor may review the rent once a year by giving 30 days\' written notice.',
  '3. DEPOSIT',
  '3.1 Refund or forfeit. The deposit is not rent. Within 14 days after the Vehicle is returned and checked, the Lessor refunds it less anything owed (rent, late charges, summonses, damage, cleaning, missing items and recovery costs). It is forfeited if the Vehicle is returned without the notice in clause 5.1, abandoned, or recovered for default.',
  '4. USE AND CARE',
  '4.1 Lawful use. Use the Vehicle only for lawful e-hailing work and personal use, keep all licences and platform approvals valid, and let no one else drive it without the Lessor\'s written approval. No sub-letting ("sewa atas sewa").',
  '4.2 No tampering. Do not modify the Vehicle or tamper with the odometer or GPS tracker. The Lessee consents to GPS tracking and to its use to recover the Vehicle.',
  '4.3 Costs. The Lessee pays tolls, fuel, parking, summonses and fines incurred during the rental. The Lessor renews road tax and insurance and arranges approved servicing; the Lessee brings the Vehicle in when asked.',
  '4.4 Accidents. Tell the Lessor at once, make a police report within 24 hours, and do not admit fault or arrange repairs without approval. The Lessee pays the insurance excess and any damage caused by negligence or misuse, and rent continues while the Vehicle is off the road for those reasons.',
  '5. ENDING, RECOVERY AND GENERAL',
  '5.1 Ending. Either party may end the rental with two weeks\' written notice. The Vehicle, keys and documents must be returned in the handover condition, apart from fair wear and tear.',
  '5.2 Default and recovery. If rent is 14 days overdue or the Lessee breaks this agreement, the Lessor sends a written notice giving 7 days to put it right. If it is not put right, the Lessor may end the rental, recover the Vehicle by lawful means and claim arrears and recovery costs. If the Vehicle is abandoned, used illegally or held by a third party, the Lessor may recover it at once.',
  '5.3 General. Notices may be given by hand, email or WhatsApp. The Lessor may use the Lessee\'s personal and GPS data to run this agreement. Any change must be in writing and signed by both parties. Malaysian law applies.',
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
        'Ownership Reward | Option to buy the Vehicle for RM1 if at least {{min_on_time_rentals}} of the {{duration}} rent payments are On-Time and the other conditions in Section B, clause 6 are met',
        "Early-termination fee | Four weeks' rent (Section B, clause 9.6)"]
      : ['Deposit (refundable) | {{deposit_amount}}']),
    'Permitted use | E-hailing and the Lessee\'s personal use',
    'Payment account | {{company_bank_account}}',
  ),
});

const preamble = (verb: string) => para(
  'THIS AGREEMENT is made on {{agreement_date}} BETWEEN {{company_name}} (Company No. {{company_reg_no}}) of {{company_address}} (the "Lessor") AND {{customer_name}} (NRIC No. {{customer_nric}}) of {{customer_address}} (the "Lessee").',
  `The Lessor agrees to ${verb} the vehicle described in Section D (the "Vehicle") to the Lessee, and the Lessee agrees to take it, on the terms set out in Sections A to D of this Agreement.`,
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
