// AIT-TBC | templates.mjs | Ramesh Konda | 2026-10-28 | JSON-file store for Admin email templates (data/templates.json)
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

// Email template store: a JSON file on the mail server, edited from the app's Admin tab
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_TEMPLATE } from '../shared/emailRender.mjs';

export const createTemplateStore = (file) => {
  const read = () => {
    if (!existsSync(file)) return [{ ...DEFAULT_TEMPLATE, updatedAt: Date.now() }];
    return JSON.parse(readFileSync(file, 'utf8'));
  };
  const write = (list) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(list, null, 2));
  };
  const clean = (t) => ({
    name: String(t.name || 'Untitled').slice(0, 100),
    css: String(t.css || ''),
    headerHtml: String(t.headerHtml || ''),
    footerHtml: String(t.footerHtml || ''),
  });

  return {
    list: read,
    get: (idOrName) => read().find(t => t.id === idOrName || t.name.toLowerCase() === String(idOrName).toLowerCase()),
    create(t) {
      const list = read();
      const created = { id: randomUUID(), ...clean(t), updatedAt: Date.now() };
      write([...list, created]);
      return created;
    },
    update(id, t) {
      const list = read();
      const i = list.findIndex(x => x.id === id);
      if (i === -1) return null;
      list[i] = { ...list[i], ...clean(t), id, updatedAt: Date.now() };
      write(list);
      return list[i];
    },
    remove(id) {
      const list = read();
      const next = list.filter(x => x.id !== id);
      if (next.length === list.length) return false;
      write(next);
      return true;
    },
  };
};
