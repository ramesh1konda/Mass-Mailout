// AIT-TBC | TemplateAdmin.tsx | Ramesh Konda | 2026-10-28 | Admin tab: HTML email template designer (CSS, header, footer) with live preview
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

import React, { useEffect, useMemo, useState } from 'react';
import { EmailTemplate } from '../types';
import { renderEmailHtml } from '../shared/emailRender.mjs';

interface TemplateAdminProps {
  templates: EmailTemplate[];
  serverOnline: boolean;
  onSaved: () => void; // reload the list from the server
}

const blank: Omit<EmailTemplate, 'id'> = { name: 'New template', css: '', headerHtml: '', footerHtml: '' };

const sampleBody = `<p>Dear {{name}}</p>
<p>Please find attached your Insurance Reminder Notice.</p>
<p>Should you have any questions please feel free to contact us.</p>`;

const TemplateAdmin: React.FC<TemplateAdminProps> = ({ templates, serverOnline, onSaved }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<EmailTemplate, 'id'> & { id?: string }>(blank);
  const [previewBody, setPreviewBody] = useState(sampleBody);
  const [previewData, setPreviewData] = useState('{"name": "Jane Citizen", "email": "jane@example.com"}');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Select the first template once the list arrives
  useEffect(() => {
    if (!selectedId && templates.length) select(templates[0]);
  }, [templates]);

  const select = (t: EmailTemplate) => { setSelectedId(t.id); setDraft({ ...t }); setMessage(null); };
  const startNew = () => { setSelectedId(null); setDraft({ ...blank }); setMessage(null); };

  const sampleData = useMemo(() => { try { return JSON.parse(previewData); } catch { return {}; } }, [previewData]);
  const previewHtml = useMemo(
    () => renderEmailHtml({ template: draft, body: previewBody, bodyIsHtml: true, data: sampleData }),
    [draft, previewBody, sampleData]
  );

  const dirty = selectedId ? JSON.stringify(templates.find(t => t.id === selectedId)) !== JSON.stringify(draft) : true;

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const res = await fetch(selectedId ? `/api/templates/${selectedId}` : '/api/templates', {
        method: selectedId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved: EmailTemplate = await res.json();
      setSelectedId(saved.id); setDraft(saved);
      setMessage('Saved.');
      onSaved();
    } catch (err: any) {
      setMessage(`Save failed: ${err.message}`);
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm(`Delete template "${draft.name}"?`)) return;
    await fetch(`/api/templates/${selectedId}`, { method: 'DELETE' });
    startNew();
    onSaved();
  };

  const field = 'w-full px-3 py-2 rounded-lg border font-mono text-xs focus:ring-2 focus:ring-blue-500 outline-none';

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Admin: Email Templates</h2>
        <button onClick={startNew} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-black">
          <i className="fas fa-plus mr-2"></i>New Template
        </button>
      </div>

      {!serverOnline && (
        <div className="p-3 rounded-xl text-xs font-bold border bg-slate-100 text-slate-600 border-slate-200">
          Mail server not running. Start it with "npm run server" to load and save templates.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {templates.map(t => (
          <button key={t.id} onClick={() => select(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${t.id === selectedId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 hover:border-blue-300'}`}>
            {t.name}
          </button>
        ))}
        {!selectedId && <span className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-dashed text-blue-600">{draft.name} (unsaved)</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase">Template name</span>
            <input className="w-full px-3 py-2 rounded-lg border font-semibold mt-1" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase">Styles (CSS)</span>
            <textarea rows={8} className={field} value={draft.css} onChange={e => setDraft({ ...draft, css: e.target.value })}
              placeholder={'body { font-family: calibri, arial, sans-serif; }\np.smaller { font-size: 0.9em; }'} />
            <span className="text-[11px] text-slate-400">Inlined into each element when sent, so Outlook and Gmail keep the styling.</span>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase">Header (HTML)</span>
            <textarea rows={5} className={field} value={draft.headerHtml} onChange={e => setDraft({ ...draft, headerHtml: e.target.value })}
              placeholder={'<p><img src="https://example.com/logo.png" alt="Logo" width="200" /></p>'} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase">Footer (HTML)</span>
            <textarea rows={6} className={field} value={draft.footerHtml} onChange={e => setDraft({ ...draft, footerHtml: e.target.value })}
              placeholder={'<p>Regards,</p>\n<p><img src="https://example.com/footer.png" alt="" width="750" /></p>'} />
          </label>
          <p className="text-[11px] text-slate-400">
            Merge fields work in the header and footer too: <code>{'{{column}}'}</code> or <code>@Field(column)</code>, matched to CSV column names.
            Images must use a public https:// URL.
          </p>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving || !serverOnline || !dirty} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold disabled:bg-slate-300">
              {saving ? 'Saving...' : selectedId ? 'Save Changes' : 'Create Template'}
            </button>
            {selectedId && <button onClick={remove} disabled={!serverOnline} className="px-4 py-2 text-red-600 font-semibold hover:bg-red-50 rounded-lg">Delete</button>}
            {message && <span className="text-xs font-semibold text-slate-500">{message}</span>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b text-xs font-bold text-slate-500 uppercase">Live preview</div>
            <iframe title="Template preview" srcDoc={previewHtml} sandbox="" className="w-full h-[480px] bg-white" />
          </div>
          <details className="bg-white rounded-2xl border shadow-sm p-4">
            <summary className="text-xs font-bold text-slate-500 uppercase cursor-pointer">Preview sample body and data</summary>
            <textarea rows={5} className={`${field} mt-3`} value={previewBody} onChange={e => setPreviewBody(e.target.value)} />
            <textarea rows={2} className={`${field} mt-2`} value={previewData} onChange={e => setPreviewData(e.target.value)} />
            <span className="text-[11px] text-slate-400">Sample merge data as JSON; it is only used for this preview.</span>
          </details>
        </div>
      </div>
    </div>
  );
};

export default TemplateAdmin;
