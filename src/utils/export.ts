export function toCSV(rows: Record<string, any>[], headers?: string[]) {
  if (!rows.length) return '';
  const cols = headers || Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const lines = [cols.join(',')].concat(rows.map(r => cols.map(c => escape(r[c])).join(',')));
  return lines.join('\n');
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}