import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../Dialog';
import {
  COMPANY_FIELDS, KIND_LABELS, LAYOUT_LABELS, PLACEHOLDERS, defaultTemplate, sectionHeading,
  type AgreementKind, type AgreementSection, type AgreementTemplate, type CompanyDetails, type SectionLayout,
} from '../../services/agreements/template';

interface TemplateEditorProps {
  templates: Record<AgreementKind, AgreementTemplate>;
  company: CompanyDetails;
  onSaveTemplate: (kind: AgreementKind, template: AgreementTemplate) => Promise<void>;
  onResetTemplate: (kind: AgreementKind) => Promise<void>;
  onSaveCompany: (company: CompanyDetails) => Promise<void>;
  onDone: () => void;
}

const labelLook = 'block text-sm font-bold text-gray-700 mb-1';
const inputLook = 'w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

const HINTS: Record<SectionLayout, string> = {
  clauses: 'One paragraph per clause; leave an empty line between clauses. Start with a number (1., 1.1, (a)) to hang the text after it.',
  table: 'One row per line: Label | value. A line with no bar prints as a heading row.',
  signature: 'One signature box per line: Party | Name | ID.',
};

/** Admins change each agreement type's sections and the company details here. */
export default function TemplateEditor({ templates, company, onSaveTemplate, onResetTemplate, onSaveCompany, onDone }: TemplateEditorProps) {
  const [kind, setKind] = useState<AgreementKind>('SEWABELI');
  const [drafts, setDrafts] = useState(templates);
  const [companyDraft, setCompanyDraft] = useState(company);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // What is saved now, to tell which drafts changed
  const [saved, setSaved] = useState({ templates, company });
  const template = drafts[kind];
  const KINDS = ['SEWABELI', 'SEWA_BIASA'] as const;
  const changedKinds = KINDS.filter(id => JSON.stringify(drafts[id]) !== JSON.stringify(saved.templates[id]));
  const companyChanged = JSON.stringify(companyDraft) !== JSON.stringify(saved.company);
  const unsaved = changedKinds.length > 0 || companyChanged;

  const setTemplate = (next: AgreementTemplate) => setDrafts(current => ({ ...current, [kind]: next }));
  const setSection = (index: number, change: Partial<AgreementSection>) =>
    setTemplate({ ...template, sections: template.sections.map((section, i) => (i === index ? { ...section, ...change } : section)) });
  const move = (index: number, by: number) => {
    const sections = [...template.sections];
    const [moved] = sections.splice(index, 1);
    sections.splice(index + by, 0, moved);
    setTemplate({ ...template, sections });
  };
  const remove = (index: number) => setTemplate({ ...template, sections: template.sections.filter((_, i) => i !== index) });
  const add = () => setTemplate({ ...template, sections: [...template.sections, { id: crypto.randomUUID(), title: 'New section', layout: 'clauses', body: '' }] });

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: done });
    } catch (err) {
      setMessage({ ok: false, text: reason(err) });
    } finally {
      setBusy(false);
    }
  };
  /** Saves every changed type and the company details, one at a time, and says exactly which were saved. */
  const save = () => {
    const untitled = KINDS.find(id => !drafts[id].title.trim() || drafts[id].sections.some(section => !section.title.trim()));
    if (untitled) {
      setMessage({ ok: false, text: `Give the ${KIND_LABELS[untitled]} agreement and every section a title.` });
      return;
    }
    if (!unsaved) {
      setMessage({ ok: true, text: 'Nothing to save: no changes.' });
      return;
    }
    const done: string[] = [];
    void run(async () => {
      try {
        for (const id of changedKinds) {
          await onSaveTemplate(id, drafts[id]);
          setSaved(current => ({ ...current, templates: { ...current.templates, [id]: drafts[id] } }));
          done.push(`${KIND_LABELS[id]} template`);
        }
        if (companyChanged) {
          await onSaveCompany(companyDraft);
          setSaved(current => ({ ...current, company: companyDraft }));
          done.push('company details');
        }
      } catch (err) {
        throw new Error(`${done.length ? `Saved: ${done.join(', ')}. ` : ''}Not saved: ${reason(err)}`);
      }
    }, `Saved: ${[...changedKinds.map(id => `${KIND_LABELS[id]} template`), ...(companyChanged ? ['company details'] : [])].join(', ')}.`);
  };
  const reset = () => {
    setConfirmReset(false);
    void run(async () => {
      try {
        await onResetTemplate(kind);
      } catch (err) {
        throw new Error(`Not reset: ${reason(err)}`);
      }
      setTemplate(defaultTemplate(kind));
      setSaved(current => ({ ...current, templates: { ...current.templates, [kind]: defaultTemplate(kind) } }));
    }, `${KIND_LABELS[kind]} is back to the built-in draft.`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Agreement type" className="inline-flex rounded-lg border border-gray-300 bg-white p-1">
          {(['SEWABELI', 'SEWA_BIASA'] as const).map(id => (
            <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md ${kind === id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {KIND_LABELS[id]}{changedKinds.includes(id) && <span className="ml-1" title="Unsaved changes">•</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirmReset(true)} disabled={busy} className="px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4" aria-hidden="true" /> Use built-in draft
          </button>
          <button type="button" onClick={() => (unsaved ? setConfirmLeave(true) : onDone())} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
          <button type="button" onClick={save} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg shadow-sm">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm rounded p-2 border ${message.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>{message.text}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label htmlFor="agreement-title" className={labelLook}>Agreement title</label>
            <input id="agreement-title" className={inputLook} value={template.title} onChange={event => setTemplate({ ...template, title: event.target.value })} />
          </div>
          {template.sections.map((section, index) => (
            <div key={section.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-48">
                  <label htmlFor={`section-title-${section.id}`} className={labelLook}>{sectionHeading(index, '').replace(/ - $/, '')} title</label>
                  <input id={`section-title-${section.id}`} className={inputLook} value={section.title} onChange={event => setSection(index, { title: event.target.value })} />
                </div>
                <div>
                  <label htmlFor={`section-layout-${section.id}`} className={labelLook}>Layout</label>
                  <select id={`section-layout-${section.id}`} className={inputLook} value={section.layout} onChange={event => setSection(index, { layout: event.target.value as SectionLayout })}>
                    {(Object.keys(LAYOUT_LABELS) as SectionLayout[]).map(layout => <option key={layout} value={layout}>{LAYOUT_LABELS[layout]}</option>)}
                  </select>
                </div>
                <div className="flex">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${section.title} up`} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-30"><ArrowUp className="w-4 h-4" aria-hidden="true" /></button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === template.sections.length - 1} aria-label={`Move ${section.title} down`} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-30"><ArrowDown className="w-4 h-4" aria-hidden="true" /></button>
                  <button type="button" onClick={() => remove(index)} aria-label={`Remove ${section.title}`} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                </div>
              </div>
              <textarea aria-label={`${section.title} text`} rows={Math.min(24, Math.max(5, section.body.split('\n').length + 1))} className={`${inputLook} font-mono text-[13px]`}
                value={section.body} onChange={event => setSection(index, { body: event.target.value })} />
              <p className="text-xs text-gray-500">{HINTS[section.layout]}</p>
            </div>
          ))}
          <button type="button" onClick={add} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm font-semibold text-gray-600 hover:border-blue-400 hover:text-blue-700 flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" aria-hidden="true" /> Add section
          </button>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="font-bold text-gray-900">Company details</h3>
            <p className="text-xs text-gray-500">Printed on both agreement types.</p>
            {COMPANY_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`company-${key}`} className={labelLook}>{label}</label>
                <input id={`company-${key}`} className={inputLook} value={companyDraft[key]} onChange={event => setCompanyDraft(current => ({ ...current, [key]: event.target.value }))} />
              </div>
            ))}
          </div>
          <details className="bg-white rounded-xl border border-gray-200 p-4">
            <summary className="font-bold text-gray-900 cursor-pointer">Fill-in fields</summary>
            <p className="text-xs text-gray-500 mt-2 mb-2">Type these in any section; the generator fills them. Any other {'{{name}}'} becomes an extra box to fill.</p>
            <ul className="text-xs space-y-1">
              {PLACEHOLDERS.map(({ key, label }) => (
                <li key={key} className="flex justify-between gap-2"><code className="text-blue-700">{`{{${key}}}`}</code><span className="text-gray-500 text-right">{label}</span></li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
      {confirmLeave && (
        <ConfirmDialog title="Leave without saving" confirmLabel="Leave without saving" onConfirm={onDone} onCancel={() => setConfirmLeave(false)}>
          <p>You have unsaved changes{changedKinds.length ? ` to ${changedKinds.map(id => KIND_LABELS[id]).join(' and ')}` : ''}{companyChanged ? `${changedKinds.length ? ' and' : ' to'} the company details` : ''}. Leave and lose them?</p>
        </ConfirmDialog>
      )}
      {confirmReset && (
        <ConfirmDialog title="Use the built-in draft" confirmLabel="Use built-in draft" onConfirm={reset} onCancel={() => setConfirmReset(false)}>
          <p>Replace the saved {KIND_LABELS[kind]} sections with the built-in draft? Your changes to this type are lost. Company details stay.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
