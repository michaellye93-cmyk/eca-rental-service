import type { AgreementKind, AgreementSection } from './template.ts';

/**
 * The built-in agreement drafts (2026-10-09, for the owner to review), used until an admin saves their own version on
 * the Agreements page. Placeholders in {{double braces}} are filled from the form; see PLACEHOLDERS in template.ts.
 * Company details are never written here: they are typed on the Agreements page and kept in the database.
 */
const para = (...lines: string[]) => lines.join('\n\n');
const rows = (...lines: string[]) => lines.join('\n');

const lessorRows = [
  'THE LESSOR',
  'Company | {{company_name}} ({{company_reg_no}})',
  'Address | {{company_address}}',
  'Contact | {{company_phone}}  {{company_email}}',
];
const lesseeRows = [
  'THE LESSEE',
  'Name | {{customer_name}}',
  'NRIC / Passport | {{customer_nric}}',
  'Mobile | {{customer_phone}}',
  'Address | {{customer_address}}',
  'Emergency contact | {{emergency_contact_name}}, {{emergency_contact_phone}}',
  'Approved other driver | {{approved_driver}}',
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
    'Normal vehicle location | {{vehicle_location}}',
    'Odometer at handover | {{odometer_km}} km',
    'Fuel level at handover | {{fuel_level}}',
  ),
};

const signature: AgreementSection = {
  id: 'signature',
  title: 'Signature',
  layout: 'signature',
  body: rows(
    'The Lessee | {{customer_name}} | {{customer_nric}}',
    'For and on behalf of the Lessor | {{company_rep_name}} | {{company_rep_id}}',
    'Witness | {{witness_name}} | {{witness_id}}',
  ),
};

// Clauses both types share: using the vehicle, services, accidents and the general terms.
const useOfVehicle = (n: number) => para(
  `${n}. USING THE VEHICLE`,
  `${n}.1 Lawful use. Use the Vehicle carefully and only for lawful e-hailing work and the Lessee's own personal use. Keep your driving licence, PSV licence, e-hailing registration and platform approvals valid at all times.`,
  `${n}.2 Approved drivers only. Only the Lessee, or another driver the Lessor approves in writing, may drive or keep the Vehicle.`,
  `${n}.3 No third parties. Do not sell, rent out, sub-let ("sewa atas sewa"), lend, pawn or hand the Vehicle to anyone else, and do not let anyone use your identity on an e-hailing platform with it.`,
  `${n}.4 Safe driving. Do not drive carelessly or while affected by alcohol, drugs, tiredness or illness.`,
  `${n}.5 No changes. Do not modify the Vehicle, remove parts, or tamper with the odometer, GPS tracker or safety equipment.`,
  `${n}.6 Charges from use. The Lessee pays all tolls, parking, fuel, summonses, compounds and fines incurred while the Vehicle is with the Lessee, even if the notice arrives later.`,
  `${n}.7 GPS. The Lessee agrees to GPS monitoring of the Vehicle for safety, servicing, protecting the Vehicle and lawful recovery.`,
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

const general = (n: number) => para(
  `${n}. GENERAL`,
  `${n}.1 Notices. Notices may be given by hand, post, email or WhatsApp to the latest contact details given. Each party keeps its contact details up to date.`,
  `${n}.2 Personal data. The Lessor may use the Lessee's identity, contact, payment, emergency-contact, vehicle and GPS information to run this agreement, for insurance, safety, recovery and legal compliance.`,
  `${n}.3 Indemnity. The Lessee covers the Lessor against claims, fines and costs arising from the Lessee's use or custody of the Vehicle or breach of this agreement, except where caused by the Lessor.`,
  `${n}.4 Whole agreement. This agreement is the whole agreement. Any change or waiver must be in writing and signed by both parties. Do not rely on any promise that is not written here.`,
  `${n}.5 Transfer. The Lessee may not transfer this agreement. The Lessor may transfer its rights to a financier or related company by written notice.`,
  `${n}.6 Electronic signing. This agreement may be signed electronically where the method identifies the signer and keeps a reliable record.`,
  `${n}.7 Law. Malaysian law applies. If any term cannot be enforced, the rest of the agreement still applies. Any right the law gives the Lessee that cannot be excluded still applies.`,
);

const BELI_TERMS = para(
  '1. KEY POINTS',
  '1.1 This is a lease. The Lessee rents and uses the Vehicle during the Lease Period. The Lessee does not own the Vehicle, and the rent is not a purchase instalment.',
  '1.2 Ownership Reward. If the Lessee completes the full Lease Period and meets the payment standard in clause 6, the Lessor transfers the Vehicle to the Lessee as an Ownership Reward.',
  '1.3 Paying everything late is not enough. Settling all money in the end does not by itself earn the Ownership Reward. Payments must also be On-Time as clause 6 requires.',
  '1.4 Early termination, repossession for non-payment or another serious breach ends the right to the Ownership Reward.',
  '2. THE LEASE',
  '2.1 Fixed period. The Lessor leases the Vehicle in Section D to the Lessee from the Commencement Date for the Lease Period in Section A. The lease ends on the Scheduled Maturity Date unless it ends earlier. Any extension must be in writing.',
  '2.2 Ownership stays with the owner. The Vehicle belongs to the registered owner or financier until it is transferred under clause 7. The Lessee may not sell or pledge it.',
  '2.3 Condition at handover. The Lessee accepts the Vehicle in the condition recorded at handover (odometer, fuel and photos), apart from any defect reported at handover.',
  '2.4 Inspection. The Lessor may inspect the Vehicle on reasonable notice, or at once for safety, insurance, default or recovery reasons.',
  '3. RENT AND PAYMENT',
  '3.1 Rent. The Lessee pays {{rent_amount}} per {{rental_cycle}}, on or before the due day in Section A, into the payment account in Section A. A payment counts when the money reaches the Lessor and can be matched to this agreement.',
  '3.2 Late charge. On rent not paid by the due day, a late charge of 18% a year is added on the overdue amount, counted daily from the second day after the due day until it is paid. The due day does not change.',
  '3.3 No deductions. The Lessee may not hold back or reduce rent because of a repair, claim or dispute unless the Lessor agrees in writing.',
  '3.4 Records. The Lessee keeps proof of every payment. The Lessor\'s payment records apply unless reliable evidence shows a mistake. The Lessee may ask for a payment statement at any time and should raise any dispute within 14 days of receiving it.',
  '3.5 Security deposit. The security deposit in Section A may be used for unpaid sums, loss or damage. Any balance is settled at the final account.',
  useOfVehicle(4),
  services(5),
  '6. PAYMENT PERFORMANCE AND OWNERSHIP REWARD',
  '6.1 On-Time Payment. A rent payment is On-Time if it is received on the due day or within three days after it.',
  '6.2 Serious Late Payment. A rent payment still unpaid 14 days after its due day.',
  '6.3 Earning the Ownership Reward. The Lessee earns the Ownership Reward only when the Lessee: (a) completes the full Lease Period; (b) pays all rent and other sums by the Scheduled Maturity Date or within 30 days after it; (c) has at least {{min_on_time_rentals}} of the {{duration}} rent payments On-Time; (d) has no Chronic Late Payment under clause 6.4 and no unresolved default; (e) has not let a third party use the Vehicle, used it illegally, abandoned it, tampered with the odometer or tracker, or damaged it on purpose; and (f) returns the Vehicle for a final inspection and provides the transfer documents and costs.',
  '6.4 Chronic Late Payment. Any one of these: fewer than {{min_on_time_rentals}} On-Time payments; three or more Serious Late Payments in any 12 months; six or more Serious Late Payments in the Lease Period; arrears unpaid for more than 30 days in a row on two or more occasions; or repossession or termination for non-payment.',
  '6.5 Warning first. Except for serious misconduct, the Lessor gives written notice of a breach that puts the Ownership Reward at risk, with at least seven days to put it right. Paying arrears clears the debt but does not change the payment record.',
  '6.6 Payment plan. Near the end of the lease the Lessor may, at its choice, agree a written payment plan of up to 180 days for temporary arrears and say in writing whether the Ownership Reward is kept. A plan payment more than seven days late ends that protection.',
  '7. TRANSFER OF THE VEHICLE',
  '7.1 Confirmation. When the Lessee has earned the Ownership Reward, the Lessor confirms it in writing and arranges any settlement with the financier and the legal transfer of the Vehicle to the Lessee.',
  '7.2 Costs. The Lessor pays any outstanding finance on the Vehicle. The Lessee pays JPJ, PUSPAKOM, inspection, registration, insurance-change and other official transfer costs.',
  '7.3 Timing. The Lessor starts the transfer within 14 days after the confirmation and receipt of the Lessee\'s documents and costs, and aims to complete it within 90 days.',
  '7.4 Replacement vehicle. If the Vehicle cannot be transferred for a reason that is not the Lessee\'s fault, or the Lessor replaces it during the lease, the Lessee\'s payment record carries over to a reasonably equivalent vehicle.',
  accidents(8),
  '9. DEFAULT, RECOVERY AND ENDING THE LEASE',
  '9.1 Default. Default includes a Serious Late Payment, false information, abandoning the Vehicle, illegal use, losing a required licence or e-hailing approval, letting a third party use the Vehicle, or tampering with the tracker.',
  '9.2 Lessor\'s action. After any required notice, the Lessor may demand payment or return of the Vehicle, end this agreement, recover the Vehicle through lawful means, and claim arrears and reasonable recovery, towing, storage and repair costs.',
  '9.3 Ending early. The Lessee may end the lease with one month\'s written notice by returning the Vehicle, paying all sums due and completing the return inspection. Ending early ends the Ownership Reward, and rent already paid is not refunded.',
  '9.4 Return condition. The Vehicle, keys, documents and accessories must be returned in the condition recorded at handover, apart from fair wear and tear.',
  general(10),
);

const BIASA_TERMS = para(
  '1. THE RENTAL',
  '1.1 Rental only. The Lessor rents the Vehicle in Section D to the Lessee from the Start Date for the Rental Period in Section A. The Lessee never owns the Vehicle, and rent paid does not count towards buying it.',
  '1.2 After the Rental Period. If the Vehicle is not returned at the end of the Rental Period, the rental continues on the same terms, {{rental_cycle}} by {{rental_cycle}}, until either party ends it under clause 7.',
  '1.3 Condition at handover. The Lessee accepts the Vehicle in the condition recorded at handover (odometer, fuel and photos), apart from any defect reported at handover.',
  '1.4 Inspection. The Lessor may inspect the Vehicle on reasonable notice, or at once for safety, insurance, default or recovery reasons.',
  '2. RENT AND PAYMENT',
  '2.1 Rent. The Lessee pays {{rent_amount}} per {{rental_cycle}}, on or before the due day in Section A, into the payment account in Section A. A payment counts when the money reaches the Lessor and can be matched to this agreement.',
  '2.2 Late charge. On rent not paid by the due day, a late charge of 18% a year is added on the overdue amount, counted daily from the second day after the due day until it is paid. The due day does not change.',
  '2.3 No deductions. The Lessee may not hold back or reduce rent because of a repair, claim or dispute unless the Lessor agrees in writing.',
  '2.4 Records. The Lessee keeps proof of every payment. The Lessor\'s payment records apply unless reliable evidence shows a mistake.',
  '3. DEPOSIT',
  '3.1 Refundable deposit. The Lessee pays the deposit in Section A before handover. It is not rent and may not be used as the last rent payment unless the Lessor agrees in writing.',
  '3.2 Refund. Within 14 days after the Vehicle is returned and checked, the Lessor refunds the deposit less any unpaid rent, late charges, summonses, damage, cleaning, missing items and recovery costs, with a list of any deductions.',
  '3.3 Forfeit. The deposit is forfeited if the Lessee returns the Vehicle without the notice in clause 7.1, abandons it, or the Lessor has to recover it because of the Lessee\'s default. This does not limit the Lessor\'s claim for any larger amount owed.',
  useOfVehicle(4),
  services(5),
  accidents(6),
  '7. ENDING THE RENTAL',
  '7.1 By the Lessee. The Lessee may end the rental by giving two weeks\' written notice, returning the Vehicle and paying all sums due.',
  '7.2 By the Lessor. The Lessor may end the rental by giving two weeks\' written notice, or at once if the Lessee is in default under clause 8.',
  '7.3 Return condition. The Vehicle, keys, documents and accessories must be returned in the condition recorded at handover, apart from fair wear and tear, with the same fuel level.',
  '8. DEFAULT AND RECOVERY',
  '8.1 Default. Default includes rent unpaid for 14 days after its due day, false information, abandoning the Vehicle, illegal use, losing a required licence or e-hailing approval, letting a third party use the Vehicle, or tampering with the tracker.',
  '8.2 Lessor\'s action. After any required notice, the Lessor may demand payment or return of the Vehicle, end this agreement, recover the Vehicle through lawful means, and claim arrears and reasonable recovery, towing, storage and repair costs.',
  general(9),
);

const schedule = (kind: AgreementKind): AgreementSection => ({
  id: 'schedule',
  title: 'Schedule',
  layout: 'table',
  body: rows(
    'Agreement ref. | {{agreement_ref}}',
    'Agreement date | {{agreement_date}}',
    ...lessorRows,
    ...lesseeRows,
    kind === 'SEWABELI' ? 'THE LEASE' : 'THE RENTAL',
    'Vehicle | {{vehicle_make}} {{vehicle_model}}, {{vehicle_plate}} (details in Section D)',
    '{{rental_cycle_label}} rent | {{rent_amount}}',
    'Payment due | {{payment_due}}',
    `${kind === 'SEWABELI' ? 'Lease' : 'Rental'} period | {{duration_text}}`,
    `${kind === 'SEWABELI' ? 'Commencement' : 'Start'} date | {{start_date}}`,
    `${kind === 'SEWABELI' ? 'Scheduled maturity date' : 'End date'} | {{end_date}}`,
    ...(kind === 'SEWABELI'
      ? ['Total scheduled rent | {{aggregate_rental}}', 'Security deposit | {{deposit_amount}}',
        'Ownership Reward standard | At least {{min_on_time_rentals}} of the {{duration}} rent payments On-Time (Section B, clause 6)']
      : ['Deposit (refundable) | {{deposit_amount}}']),
    'Permitted use | E-hailing and the Lessee\'s personal use',
    'Payment account | {{company_bank_account}}',
  ),
});

export const DEFAULT_SECTIONS: Record<AgreementKind, { title: string; sections: AgreementSection[] }> = {
  SEWABELI: {
    title: 'Vehicle Leasing Agreement (Sewa Beli)',
    sections: [schedule('SEWABELI'), { id: 'terms', title: 'General terms', layout: 'clauses', body: BELI_TERMS }, signature, vehicle],
  },
  SEWA_BIASA: {
    title: 'Vehicle Rental Agreement (Sewa Biasa)',
    sections: [schedule('SEWA_BIASA'), { id: 'terms', title: 'General terms', layout: 'clauses', body: BIASA_TERMS }, signature, vehicle],
  },
};
