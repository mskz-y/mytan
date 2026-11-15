// 単語ファイルの解析
// 列構成: セクション / 単語またはフレーズ / 種類 / 日本語の意味 / 読み(IPA)

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const HEADER_WORDS = ['セクション', 'section', '単語', 'word'];

export function parseWordFile(text, fileName) {
  text = text.replace(/^﻿/, '');
  const isCsv = /\.csv$/i.test(fileName);
  const lines = text.split(/\r?\n/);
  const words = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let cols = isCsv || !line.includes('\t') ? (line.includes('\t') ? line.split('\t') : parseCsvLine(line)) : line.split('\t');
    cols = cols.map((c) => c.trim());
    if (i === 0 && HEADER_WORDS.includes(cols[0]?.toLowerCase())) return; // ヘッダー行
    const [section = '', word = '', type = '', meaning = '', ipa = ''] = cols;
    if (!word) return;
    words.push({ s: section || '(なし)', w: word, t: type, m: meaning, ipa });
  });
  return words;
}

export function bookNameFromFile(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

export function sectionsOf(words) {
  const order = [];
  const counts = new Map();
  for (const w of words) {
    if (!counts.has(w.s)) { counts.set(w.s, 0); order.push(w.s); }
    counts.set(w.s, counts.get(w.s) + 1);
  }
  return order.map((name) => ({ name, count: counts.get(name) }));
}
