import type { GrabLetterValues } from '../../services/agreements/grabLetter';

/** A box of the letter: its value underlined as printed, or a highlighted gap when it will print as a line to write on. */
function Box({ value }: { value: string }) {
  return value
    ? <span className="underline underline-offset-4 font-semibold">{value}</span>
    : <mark className="bg-amber-100 text-amber-800 rounded px-1">missing</mark>;
}

/** The Grab authorization letter as it will print, word for word. */
export default function GrabLetterPreview({ values }: { values: GrabLetterValues }) {
  return (
    <article className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 sm:p-10 text-[13px] leading-loose text-gray-900 max-w-3xl mx-auto">
      <h3 className="text-center text-base font-bold mb-6">LETTER OF AUTHORIZATION</h3>
      <p className="font-bold mb-6">SUBJECT : LETTER TO AUTHORIZE THE USE OF VEHICLE</p>
      <p className="text-justify mb-6">
        I, (name of vehicle owner) <Box value={values.owner_name} />, (I/C No.) <Box value={values.owner_ic_no} />, am the vehicle owner of
        (vehicle model) <Box value={values.vehicle_model} /> (car plate number) <Box value={values.vehicle_plate} />.
      </p>
      <p className="text-justify mb-4">
        I hereby authorize and grant permission to (Grab Driver-Partner’s name) <Box value={values.driver_name} /> (I/C No.){' '}
        <Box value={values.driver_ic_no} />, to use my vehicle to register with E-hailing Driver and to use my vehicle to carry out E-hailing services.
      </p>
      <p className="mb-8">Thank you.</p>
      <p className="mb-10">Yours truly,</p>
      <div className="w-48 border-t border-gray-900" />
      <p>(Vehicle Owner’s Signature)</p>
      <p>Vehicle Owner’s Name: <Box value={values.owner_signatory_name} /></p>
      <p>Date : <Box value={values.letter_date} /></p>
    </article>
  );
}
