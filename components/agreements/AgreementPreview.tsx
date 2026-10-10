import { BLANK, fillText, isClauseHeading, parseParagraphs, parseRows, sectionHeading, startsNewPage, type AgreementTemplate } from '../../services/agreements/template';

interface AgreementPreviewProps {
  template: AgreementTemplate;
  values: Record<string, string>;
}

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

/** The agreement as it will print: the same sections, order and filled text as the PDF. */
export default function AgreementPreview({ template, values }: AgreementPreviewProps) {
  return (
    <article className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 sm:p-10 text-[13px] leading-relaxed text-gray-900 max-w-3xl mx-auto">
      {/* Letterhead, as printed at the top of every page */}
      <header className="flex items-center gap-3 border-b-2 border-[#C5A059] pb-3 mb-6">
        <img src="/agreement-logo.png" alt="" className="w-10 h-10 object-contain" onError={event => { event.currentTarget.src = '/logo.svg'; }} />
        <div className="min-w-0">
          <p className="font-bold text-[#1E3A5F]">{values.company_name || 'Company name'}</p>
          <p className="text-[11px] text-gray-500">
            {[values.company_reg_no && `Company No. ${values.company_reg_no}`, values.company_address].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>
      <h3 className="text-center text-base font-bold uppercase text-[#1E3A5F]"><Filled text={template.title} values={values} /></h3>
      <div className="w-16 border-t-2 border-[#C5A059] mx-auto mt-2 mb-5" />
      {template.preamble && (
        <div className="space-y-2 mb-6">
          {parseParagraphs(fillText(template.preamble, values)).map((block, i) => <p key={i}><Filled text={block} values={values} /></p>)}
        </div>
      )}
      {template.sections.map((section, index) => (
        <section key={section.id} className="mb-6">
          {startsNewPage(section, index) && (
            <p className="flex items-center gap-2 text-[11px] text-gray-400 my-4" aria-hidden="true">
              <span className="flex-1 border-t border-dashed border-gray-300" />New page<span className="flex-1 border-t border-dashed border-gray-300" />
            </p>
          )}
          <h4 className="bg-[#1E3A5F] text-white px-2.5 py-1.5 font-bold text-[13px] mb-3">{sectionHeading(index, fillText(section.title, values))}</h4>
          {section.layout === 'clauses' && (
            <div className="space-y-2">
              {parseParagraphs(fillText(section.body, values)).map((paragraph, i) => (
                <p key={i} className={`whitespace-pre-line ${isClauseHeading(paragraph) ? 'font-bold pt-2' : ''}`}><Filled text={paragraph} values={values} /></p>
              ))}
            </div>
          )}
          {section.layout === 'table' && (
            <table className="w-full border-collapse">
              <tbody>
                {parseRows(section.body).map((cells, i) => (
                  <tr key={i}>
                    {cells.length === 1 ? (
                      <th colSpan={2} className="border border-gray-300 px-2 py-1 text-left"><Filled text={cells[0]} values={values} /></th>
                    ) : (
                      <>
                        <th className="border border-gray-300 px-2 py-1 text-left align-top w-2/5"><Filled text={cells[0]} values={values} /></th>
                        <td className="border border-gray-300 px-2 py-1 align-top"><Filled text={cells.slice(1).join(' | ')} values={values} /></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {section.layout === 'signature' && (
            <>
              {parseRows(section.body).filter(cells => cells.length === 1).map((cells, i) => <p key={i} className="mb-3"><Filled text={cells[0]} values={values} /></p>)}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {parseRows(section.body).filter(cells => cells.length > 1).map((cells, i) => (
                  <div key={i} className="border border-gray-300">
                    <p className="bg-slate-200 px-2 py-1 font-bold text-[#1E3A5F]"><Filled text={cells[0]} values={values} /></p>
                    <div className="px-2 pb-2">
                      <div className="border-b border-gray-700 h-14" />
                      <p className="text-[10px] italic text-gray-500">Signature</p>
                      <p>Name: <Filled text={cells[1] ?? ''} values={values} /></p>
                      <p>NRIC / Co. No.: <Filled text={cells[2] ?? ''} values={values} /></p>
                      <p>Date: {cells[3] ? <Filled text={cells[3]} values={values} /> : '____________'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ))}
    </article>
  );
}
