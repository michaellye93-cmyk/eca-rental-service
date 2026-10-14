import { BLANK, fillText } from '../../services/agreements/template';
import { LETTER_FOOTER_NOTE, letterBlocks, type LetterTemplate } from '../../services/agreements/letters';

/** Shows a blank line where a value is missing, highlighted so it stands out on screen. */
function Filled({ text, values }: { text: string; values: Record<string, string> }) {
  const parts = fillText(text, values).split(BLANK);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <mark className="bg-amber-100 text-amber-800 rounded px-1">missing</mark>}
        </span>
      ))}
    </>
  );
}

const NUMBERED = /^((?:\d+(?:\.\d+)*\.?)|(?:\([a-z0-9]+\))|(?:[a-z]\)))\s+/i;

function Title({ text, values }: { text: string; values: Record<string, string> }) {
  return (
    <h3 className="mx-auto my-4 w-fit max-w-full border-2 border-[#1E3A5F] px-6 py-2 text-center text-base font-bold uppercase text-[#1E3A5F]">
      <Filled text={text} values={values} />
    </h3>
  );
}

/** The letter as it will print: the same letterhead, blocks and filled text as the PDF. */
export default function LetterPreview({ letter, values }: { letter: LetterTemplate; values: Record<string, string> }) {
  return (
    <article className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 sm:p-10 text-[13px] leading-relaxed text-gray-900 max-w-3xl mx-auto">
      {/* Letterhead, as printed at the top of every page */}
      <header className="flex items-center gap-3 border-b-2 border-[#C5A059] pb-3 mb-2">
        <img src="/agreement-logo.png" alt="" className="w-10 h-10 object-contain" onError={event => { event.currentTarget.src = '/logo.svg'; }} />
        <div className="min-w-0">
          <p className="font-bold text-[#1E3A5F]">{values.company_name || 'Company name'}</p>
          <p className="text-[11px] text-gray-500">
            {[values.company_reg_no && `Company No. ${values.company_reg_no}`, values.company_address].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>
      <Title text={letter.title} values={values} />
      <div className="space-y-3">
        {letterBlocks(letter.body).map((block, i) => {
          if (block.type === 'page') return <hr key={i} className="my-6 border-dashed border-gray-300" aria-label="New page" />;
          if (block.type === 'title') return <Title key={i} text={block.text} values={values} />;
          if (block.type === 'quote') return <p key={i} className="pl-8 italic text-gray-700 whitespace-pre-line"><Filled text={block.text} values={values} /></p>;
          if (block.type === 'fields') {
            return (
              <dl key={i} className="grid grid-cols-[auto_1fr] gap-x-3 font-bold border-b border-gray-200 pb-3">
                {block.rows.map(([label, value], r) => (
                  <div key={r} className="contents">
                    <dt><Filled text={label} values={values} /> :</dt>
                    <dd className="font-normal"><Filled text={value} values={values} /></dd>
                  </div>
                ))}
              </dl>
            );
          }
          if (block.type === 'table') {
            return (
              <table key={i} className="mx-auto w-4/5 border-collapse text-center">
                {block.heading && <thead><tr><th colSpan={Math.max(...block.rows.map(r => r.length))} className="border border-gray-700 bg-slate-100 py-1"><Filled text={block.heading} values={values} /></th></tr></thead>}
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>{row.map((cell, c) => <td key={c} className="border border-gray-700 py-1 px-2"><Filled text={cell} values={values} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            );
          }
          const numbered = NUMBERED.exec(block.text);
          return numbered ? (
            <p key={i} className="flex gap-3 whitespace-pre-line"><span className="w-5 shrink-0">{numbered[1]}</span><span><Filled text={block.text.slice(numbered[0].length)} values={values} /></span></p>
          ) : (
            <p key={i} className="whitespace-pre-line"><Filled text={block.text} values={values} /></p>
          );
        })}
      </div>
      <p className="mt-8 border-t border-gray-200 pt-2 text-center text-[11px] italic text-gray-500">{LETTER_FOOTER_NOTE}</p>
    </article>
  );
}
