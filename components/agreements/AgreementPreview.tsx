import { BLANK, fillText, isClauseHeading, parseParagraphs, parseRows, sectionHeading, type AgreementTemplate } from '../../services/agreements/template';

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
      <header className="text-center mb-6">
        <h3 className="text-base font-bold uppercase"><Filled text={template.title} values={values} /></h3>
        {values.company_name && (
          <p className="text-xs text-gray-600 mt-1">
            {values.company_name}{values.company_reg_no && ` (${values.company_reg_no})`}
            {values.company_address && <><br />{values.company_address}</>}
          </p>
        )}
      </header>
      {template.sections.map((section, index) => (
        <section key={section.id} className="mb-6">
          <h4 className="bg-slate-100 px-2.5 py-1.5 font-bold text-[13px] mb-3">{sectionHeading(index, fillText(section.title, values))}</h4>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 pt-6">
              {parseRows(section.body).map((cells, i) => (
                <div key={i}>
                  <div className="border-b border-gray-700 h-10" />
                  <p className="font-bold mt-1"><Filled text={cells[0] ?? ''} values={values} /></p>
                  <p>Name: <Filled text={cells[1] ?? ''} values={values} /></p>
                  <p>ID: <Filled text={cells[2] ?? ''} values={values} /></p>
                  <p>Date: ____________</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </article>
  );
}
