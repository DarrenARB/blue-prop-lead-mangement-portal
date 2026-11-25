// Small CSV reader: handles quoted fields, commas or semicolons, CRLF, and a UTF-8 BOM.

export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  const headers = (rows.shift() ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows };
}

// Guess what each column holds from its header name.
export function guessField(header) {
  const h = header.toLowerCase().replace(/[^a-z]/g, "");
  if (/(email|emailaddress|mail)/.test(h)) return "email";
  if (/(mobile|cell|phone|whatsapp|number|tel|contact)/.test(h)) return "phone";
  if (/^(first|firstname|name|givenname|fname)$/.test(h) || h === "firstnames") return "first_name";
  if (/(last|surname|lname|familyname)/.test(h)) return "last_name";
  if (/(suburb|area|town|city|location|neighbourhood|neighborhood)/.test(h)) return "suburb";
  if (/(fullname|clientname|contactname)/.test(h)) return "full_name";
  return "";
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("Couldn’t read that file."));
    r.readAsText(file);
  });
}

export function downloadCsv(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
