import './style.css';
import * as db from './db.js';
import { parseWordFile, bookNameFromFile, sectionsOf } from './parser.js';

const app = document.getElementById('app');

// ---------- 共通ユーティリティ ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 『…』で囲まれた部分を強調表示
const fmtMeaning = (m) => esc(m).replace(/『(.*?)』/g, '<b>$1</b>');

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const settings = {
  get(key, def) {
    try {
      const v = localStorage.getItem('mytan.' + key);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, v) {
    try {
      localStorage.setItem('mytan.' + key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};

// 読み上げ（Web Speech API）
let enVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  enVoice =
    voices.find((v) => v.lang === 'en-US' && /Google|Samantha|Aria|Jenny/i.test(v.name)) ||
    voices.find((v) => v.lang === 'en-US') ||
    voices.find((v) => v.lang?.startsWith('en')) ||
    null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (enVoice) u.voice = enVoice;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}
function stopSpeak() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ---------- 対象（ファイル / セクション / グループ）の解決 ----------

async function resolveTarget(p) {
  const t = p.get('t');
  if (t === 'book' || t === 'section') {
    const book = await db.get('books', p.get('b'));
    if (!book) return null;
    if (t === 'book') return { title: book.name, sub: 'ファイル', words: book.words };
    const sec = p.get('s');
    return { title: `${book.name} / ${sec}`, sub: 'セクション', words: book.words.filter((w) => w.s === sec) };
  }
  if (t === 'group') {
    const group = await db.get('groups', p.get('g'));
    if (!group) return null;
    const books = new Map((await db.getAll('books')).map((b) => [b.id, b]));
    const words = [];
    for (const ref of group.refs) {
      const b = books.get(ref.bookId);
      if (b) words.push(...b.words.filter((w) => w.s === ref.section));
    }
    return { title: group.name, sub: 'グループ', words };
  }
  return null;
}

function targetQuery(p) {
  const q = new URLSearchParams();
  for (const k of ['t', 'b', 's', 'g']) if (p.get(k) !== null) q.set(k, p.get(k));
  return q;
}

// ---------- ルーティング ----------

let cleanup = null;

async function route() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  stopSpeak();
  const hash = location.hash.slice(1) || '/';
  const [path, qs] = hash.split('?');
  const p = new URLSearchParams(qs || '');
  window.scrollTo(0, 0);
  try {
    switch (path) {
      case '/menu':
        return await viewMenu(p);
      case '/list':
        return await viewList(p);
      case '/flash':
        return await viewFlash(p);
      case '/type':
        return await viewType(p);
      default:
        return await viewTop();
    }
  } catch (e) {
    console.error(e);
    app.replaceChildren(h(`<div class="card error">エラーが発生しました: ${esc(e.message)}</div>`));
  }
}
window.addEventListener('hashchange', route);
route();

function notFound() {
  app.replaceChildren(
    h(`<div class="card">対象の単語帳が見つかりません。<p><a class="btn" href="#/">トップへ戻る</a></p></div>`),
  );
}

function backBar(href, label) {
  return `<nav class="backbar"><a href="${href}" class="back">‹ ${esc(label)}</a></nav>`;
}

// ---------- トップ ----------

async function viewTop() {
  const books = (await db.getAll('books')).sort((a, b) => a.createdAt - b.createdAt);
  const groups = (await db.getAll('groups')).sort((a, b) => a.createdAt - b.createdAt);
  const bookMap = new Map(books.map((b) => [b.id, b]));

  const bookHtml = books
    .map((b) => {
      const secs = sectionsOf(b.words);
      return `
      <div class="card book" data-id="${b.id}">
        <div class="book-head">
          <div>
            <div class="book-name">${esc(b.name)}</div>
            <div class="muted">${b.words.length}語 ・ ${secs.length}セクション</div>
          </div>
          <div class="actions">
            <a class="btn primary" href="#/menu?t=book&b=${encodeURIComponent(b.id)}">学習</a>
            <button class="btn ghost danger" data-del-book="${b.id}" title="削除">削除</button>
          </div>
        </div>
        <details>
          <summary>セクション一覧</summary>
          <ul class="sections">
            ${secs
              .map(
                (s) => `
              <li>
                <label class="chk"><input type="checkbox" class="sec-chk" data-book="${b.id}" data-sec="${esc(s.name)}">
                  <span>${esc(s.name)}</span><span class="muted">${s.count}語</span></label>
                <a class="btn small" href="#/menu?t=section&b=${encodeURIComponent(b.id)}&s=${encodeURIComponent(s.name)}">学習</a>
              </li>`,
              )
              .join('')}
          </ul>
        </details>
      </div>`;
    })
    .join('');

  const groupHtml = groups
    .map((g) => {
      let count = 0;
      const labels = g.refs.map((r) => {
        const b = bookMap.get(r.bookId);
        if (b) count += b.words.filter((w) => w.s === r.section).length;
        return `${b ? b.name : '(削除済み)'} / ${r.section}`;
      });
      return `
      <div class="card group">
        <div class="book-head">
          <div>
            <div class="book-name">${esc(g.name)}</div>
            <div class="muted">${count}語 ・ ${g.refs.length}セクション</div>
          </div>
          <div class="actions">
            <a class="btn primary" href="#/menu?t=group&g=${encodeURIComponent(g.id)}">学習</a>
            <button class="btn ghost danger" data-del-group="${g.id}">削除</button>
          </div>
        </div>
        <div class="tags">${labels.map((l) => `<span class="tag">${esc(l)}</span>`).join('')}</div>
      </div>`;
    })
    .join('');

  app.replaceChildren(
    h(`
    <section>
      <label class="upload card" id="drop">
        <input type="file" id="file" accept=".tsv,.txt,.csv,text/tab-separated-values,text/csv,text/plain" multiple hidden>
        <div class="upload-icon">＋</div>
        <div><b>単語ファイルをアップロード</b></div>
        <div class="muted small-text">TSV / CSV（セクション・単語・種類・意味・IPA の順、IPA は省略可）<br>クリックまたはドラッグ＆ドロップ</div>
      </label>
      <div id="msg"></div>
    </section>

    <section>
      <h2>単語帳</h2>
      ${books.length ? bookHtml : '<p class="muted">まだ単語帳がありません。ファイルをアップロードしてください。</p>'}
    </section>

    ${
      books.length
        ? `<section>
      <h2>グループ</h2>
      <div class="card group-make">
        <div class="muted small-text">単語帳の「セクション一覧」でセクションにチェックを入れてグループを作成できます。</div>
        <div class="row">
          <input type="text" id="group-name" placeholder="グループ名" maxlength="50">
          <button class="btn primary" id="make-group">作成 (<span id="sel-count">0</span>)</button>
        </div>
      </div>
      ${groupHtml || '<p class="muted">グループはまだありません。</p>'}
    </section>`
        : ''
    }
  `),
  );

  const msg = (text, cls = '') => {
    document.getElementById('msg').innerHTML = text ? `<div class="notice ${cls}">${text}</div>` : '';
  };

  async function handleFiles(files) {
    const results = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const words = parseWordFile(text, file.name);
        if (!words.length) {
          results.push(`<span class="ng">${esc(file.name)}: 単語が見つかりませんでした</span>`);
          continue;
        }
        const name = bookNameFromFile(file.name);
        const existing = (await db.getAll('books')).find((b) => b.name === name);
        if (existing && !confirm(`「${name}」は既に登録されています。上書きしますか？`)) continue;
        await db.put('books', {
          id: existing ? existing.id : db.newId(),
          name,
          createdAt: existing ? existing.createdAt : Date.now(),
          words,
        });
        results.push(`${esc(name)}: ${words.length}語を登録しました`);
      } catch (e) {
        results.push(`<span class="ng">${esc(file.name)}: 読み込みに失敗しました (${esc(e.message)})</span>`);
      }
    }
    await viewTop();
    if (results.length) msg(results.join('<br>'));
  }

  const fileInput = document.getElementById('file');
  fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));
  const drop = document.getElementById('drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handleFiles([...e.dataTransfer.files]);
  });

  app.querySelectorAll('[data-del-book]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const b = bookMap.get(btn.dataset.delBook);
      if (!confirm(`単語帳「${b.name}」を削除しますか？`)) return;
      await db.remove('books', b.id);
      viewTop();
    }),
  );
  app.querySelectorAll('[data-del-group]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const g = groups.find((x) => x.id === btn.dataset.delGroup);
      if (!confirm(`グループ「${g.name}」を削除しますか？`)) return;
      await db.remove('groups', g.id);
      viewTop();
    }),
  );

  const makeBtn = document.getElementById('make-group');
  if (makeBtn) {
    const updateCount = () => {
      document.getElementById('sel-count').textContent = app.querySelectorAll('.sec-chk:checked').length;
    };
    app.querySelectorAll('.sec-chk').forEach((c) => c.addEventListener('change', updateCount));
    makeBtn.addEventListener('click', async () => {
      const checked = [...app.querySelectorAll('.sec-chk:checked')];
      const nameEl = document.getElementById('group-name');
      const name = nameEl.value.trim();
      if (!checked.length) return msg('グループに含めるセクションにチェックを入れてください。', 'warn');
      if (!name) {
        nameEl.focus();
        return msg('グループ名を入力してください。', 'warn');
      }
      await db.put('groups', {
        id: db.newId(),
        name,
        createdAt: Date.now(),
        refs: checked.map((c) => ({ bookId: c.dataset.book, section: c.dataset.sec })),
      });
      await viewTop();
      msg(`グループ「${esc(name)}」を作成しました`);
    });
  }
}

// ---------- トレーニングメニュー ----------

async function viewMenu(p) {
  const target = await resolveTarget(p);
  if (!target) return notFound();
  const q = targetQuery(p).toString();
  const modes = [
    { href: `#/list?${q}`, icon: '📖', name: '単語帳', desc: '英語と意味を一覧表示' },
    { href: `#/list?${q}&dir=je`, icon: '📖', name: '単語帳(日英)', desc: '英語を隠して一覧表示' },
    { href: `#/list?${q}&dir=ej`, icon: '📖', name: '単語帳(英日)', desc: '意味を隠して一覧表示' },
    { href: `#/flash?${q}&dir=je`, icon: '🃏', name: 'フラッシュカード(日英)', desc: '意味 → 英語' },
    { href: `#/flash?${q}&dir=ej`, icon: '🃏', name: 'フラッシュカード(英日)', desc: '英語 → 意味' },
    { href: `#/type?${q}`, icon: '⌨️', name: '打ち込み', desc: '意味を見て英語を入力' },
  ];
  app.replaceChildren(
    h(`
    ${backBar('#/', 'トップ')}
    <div class="target-head">
      <span class="badge">${esc(target.sub)}</span>
      <h1>${esc(target.title)}</h1>
      <div class="muted">${target.words.length}語</div>
    </div>
    <div class="mode-grid">
      ${modes
        .map(
          (m) => `<a class="card mode" href="${m.href}">
            <span class="mode-icon">${m.icon}</span>
            <span><span class="mode-name">${m.name}</span><span class="muted small-text">${m.desc}</span></span>
          </a>`,
        )
        .join('')}
    </div>
  `),
  );
}

// ---------- 単語帳（一覧） ----------

async function viewList(p) {
  const target = await resolveTarget(p);
  if (!target) return notFound();
  const dir = p.get('dir');
  const words = target.words;
  const menuHref = `#/menu?${targetQuery(p)}`;
  const modeName = dir === 'je' ? '単語帳(日英)' : dir === 'ej' ? '単語帳(英日)' : '単語帳';

  const state = {
    per: settings.get('listPer', 20),
    page: 0,
    hideEn: dir === 'je',
    hideJa: dir === 'ej',
    revealed: new Set(), // 個別に表示したセル "en:idx" / "ja:idx"
  };

  app.replaceChildren(
    h(`
    ${backBar(menuHref, 'メニュー')}
    <div class="target-head compact">
      <h1>${esc(modeName)}</h1>
      <div class="muted">${esc(target.title)} ・ ${words.length}語</div>
    </div>
    <div class="toolbar">
      <div class="seg" id="per">
        ${[20, 50, 0].map((n) => `<button data-per="${n}">${n ? n + '件' : '全件'}</button>`).join('')}
      </div>
      <div class="seg">
        <button id="tg-en">英語を隠す</button>
        <button id="tg-ja">意味を隠す</button>
      </div>
    </div>
    <div id="list"></div>
    <div class="pager" id="pager"></div>
  `),
  );

  const listEl = document.getElementById('list');
  const pagerEl = document.getElementById('pager');

  function render() {
    const per = state.per || words.length || 1;
    const pages = Math.max(1, Math.ceil(words.length / per));
    if (state.page >= pages) state.page = pages - 1;
    const start = state.page * per;
    const slice = words.slice(start, start + per);

    app.querySelectorAll('#per button').forEach((b) => b.classList.toggle('on', Number(b.dataset.per) === state.per));
    document.getElementById('tg-en').classList.toggle('on', state.hideEn);
    document.getElementById('tg-ja').classList.toggle('on', state.hideJa);

    listEl.innerHTML = slice
      .map((w, i) => {
        const idx = start + i;
        const enHidden = state.hideEn && !state.revealed.has('en:' + idx);
        const jaHidden = state.hideJa && !state.revealed.has('ja:' + idx);
        return `
        <div class="word-row">
          <div class="num">${idx + 1}</div>
          <div class="en cell ${state.hideEn ? (enHidden ? 'hidden' : 'peek') : ''}" data-cell="en:${idx}">
            <div class="cell-body">
              <div class="word">${esc(w.w)} <button class="speak" data-speak="${idx}" title="読み上げ">🔊</button></div>
              <div class="meta">${w.ipa ? `<span class="ipa">/${esc(w.ipa)}/</span>` : ''}</div>
            </div>
            <div class="cover">タップで表示</div>
          </div>
          <div class="ja cell ${state.hideJa ? (jaHidden ? 'hidden' : 'peek') : ''}" data-cell="ja:${idx}">
            <div class="cell-body">
              ${w.t ? `<span class="pos">${esc(w.t)}</span>` : ''}${fmtMeaning(w.m)}
            </div>
            <div class="cover">タップで表示</div>
          </div>
        </div>`;
      })
      .join('');

    if (pages > 1) {
      pagerEl.innerHTML = `
        <button class="btn" data-pg="prev" ${state.page === 0 ? 'disabled' : ''}>‹ 前へ</button>
        <span>${state.page + 1} / ${pages}</span>
        <button class="btn" data-pg="next" ${state.page >= pages - 1 ? 'disabled' : ''}>次へ ›</button>`;
    } else pagerEl.innerHTML = '';
  }

  app.querySelectorAll('#per button').forEach((b) =>
    b.addEventListener('click', () => {
      state.per = Number(b.dataset.per);
      state.page = 0;
      settings.set('listPer', state.per);
      render();
    }),
  );
  document.getElementById('tg-en').addEventListener('click', () => {
    state.hideEn = !state.hideEn;
    state.revealed.clear();
    render();
  });
  document.getElementById('tg-ja').addEventListener('click', () => {
    state.hideJa = !state.hideJa;
    state.revealed.clear();
    render();
  });
  listEl.addEventListener('click', (e) => {
    const sp = e.target.closest('[data-speak]');
    if (sp) {
      speak(words[Number(sp.dataset.speak)].w);
      return;
    }
    const cell = e.target.closest('.cell.hidden, .cell.peek');
    if (!cell) return;
    const key = cell.dataset.cell;
    if (state.revealed.has(key)) state.revealed.delete(key);
    else state.revealed.add(key);
    render();
  });
  pagerEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg]');
    if (!b) return;
    state.page += b.dataset.pg === 'next' ? 1 : -1;
    render();
    window.scrollTo(0, 0);
  });
  render();
}

// ---------- フラッシュカード ----------

async function viewFlash(p) {
  const target = await resolveTarget(p);
  if (!target) return notFound();
  const dir = p.get('dir') === 'ej' ? 'ej' : 'je';
  const menuHref = `#/menu?${targetQuery(p)}`;
  const modeName = dir === 'je' ? 'フラッシュカード(日英)' : 'フラッシュカード(英日)';

  const opt = {
    order: settings.get('flashOrder', 'seq'),
    speech: settings.get('flashSpeech', true),
    timing: settings.get('flashTiming', 5), // 3 / 5 / 10 / 0(手動)
  };

  const radio = (name, value, label) =>
    `<label class="opt"><input type="radio" name="${name}" value="${value}" ${String(opt[name]) === String(value) ? 'checked' : ''}><span>${label}</span></label>`;

  app.replaceChildren(
    h(`
    ${backBar(menuHref, 'メニュー')}
    <div class="target-head compact">
      <h1>${esc(modeName)}</h1>
      <div class="muted">${esc(target.title)} ・ ${target.words.length}語</div>
    </div>
    <div class="card settings">
      <div class="set-row"><div class="set-label">順番</div><div class="seg-opts">${radio('order', 'seq', '最初から')}${radio('order', 'rand', 'ランダム')}</div></div>
      <div class="set-row"><div class="set-label">読み上げ</div><div class="seg-opts">${radio('speech', true, 'ON')}${radio('speech', false, 'OFF')}</div></div>
      <div class="set-row"><div class="set-label">表示</div><div class="seg-opts">${radio('timing', 3, '3秒')}${radio('timing', 5, '5秒')}${radio('timing', 10, '10秒')}${radio('timing', 0, '手動めくり')}</div></div>
      ${'speechSynthesis' in window ? '' : '<div class="notice warn">このブラウザは読み上げに対応していません。</div>'}
      <button class="btn primary big" id="start" ${target.words.length ? '' : 'disabled'}>スタート</button>
    </div>
  `),
  );

  document.getElementById('start').addEventListener('click', () => {
    const fd = (name) => app.querySelector(`input[name="${name}"]:checked`).value;
    opt.order = fd('order');
    opt.speech = fd('speech') === 'true';
    opt.timing = Number(fd('timing'));
    settings.set('flashOrder', opt.order);
    settings.set('flashSpeech', opt.speech);
    settings.set('flashTiming', opt.timing);
    runFlash(target, dir, opt, menuHref, modeName);
  });
}

function runFlash(target, dir, opt, menuHref, modeName) {
  const list = opt.order === 'rand' ? shuffle(target.words) : target.words.slice();
  let idx = 0;
  let phase = 0; // 0: 問題面, 1: 答え面
  let timer = null;
  let paused = false;
  const auto = opt.timing > 0;

  app.replaceChildren(
    h(`
    ${backBar(menuHref, 'メニュー')}
    <div class="flash-wrap">
      <div class="flash-top">
        <span class="muted">${esc(modeName)}</span>
        <span id="fc-count" class="muted"></span>
      </div>
      <div class="progress"><div id="fc-bar"></div></div>
      <div class="flashcard" id="card" role="button" tabindex="0"></div>
      <div class="flash-ctrl">
        <button class="btn" id="fc-prev">‹ 前</button>
        ${auto ? '<button class="btn" id="fc-pause">一時停止</button>' : ''}
        <button class="btn" id="fc-speech">${opt.speech ? '🔊 ON' : '🔇 OFF'}</button>
        <button class="btn" id="fc-next">次 ›</button>
      </div>
      <div class="muted small-text center">${auto ? `${opt.timing}秒ごとに自動でめくります` : 'カードをクリック／タップでめくります'}</div>
    </div>
  `),
  );

  const card = document.getElementById('card');
  const timerBar = () =>
    auto && !paused ? `<div class="timer"><div style="animation-duration:${opt.timing}s"></div></div>` : '';

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function enHtml(w) {
    return `<div class="fc-en">${esc(w.w)}</div>${w.ipa ? `<div class="ipa">/${esc(w.ipa)}/</div>` : ''}`;
  }
  function jaHtml(w) {
    return `<div class="fc-ja">${w.t ? `<span class="pos">${esc(w.t)}</span>` : ''}${fmtMeaning(w.m)}</div>`;
  }

  function show() {
    clear();
    if (idx >= list.length) return finish();
    const w = list[idx];
    document.getElementById('fc-count').textContent = `${idx + 1} / ${list.length}`;
    document.getElementById('fc-bar').style.width = `${((idx + phase * 0.5) / list.length) * 100}%`;
    const front = dir === 'je' ? jaHtml(w) : enHtml(w);
    const back = dir === 'je' ? enHtml(w) : jaHtml(w);
    card.className = 'flashcard' + (phase ? ' answered' : '');
    card.innerHTML = `
      <div class="fc-section muted small-text">${esc(w.s)}</div>
      <div class="fc-front">${front}</div>
      ${phase ? `<div class="fc-divider"></div><div class="fc-back">${back}</div>` : ''}
      ${timerBar()}`;
    const enShownNow = (dir === 'je' && phase === 1) || (dir === 'ej' && phase === 0);
    if (enShownNow && opt.speech) speak(w.w);
    if (auto && !paused) timer = setTimeout(advance, opt.timing * 1000);
  }

  function advance() {
    if (phase === 0) phase = 1;
    else {
      phase = 0;
      idx++;
    }
    show();
  }

  function back() {
    if (phase === 1) phase = 0;
    else if (idx > 0) {
      idx--;
      phase = 0;
    }
    show();
  }

  function finish() {
    clear();
    stopSpeak();
    document.getElementById('fc-bar').style.width = '100%';
    card.className = 'flashcard done';
    card.innerHTML = `
      <div class="fc-done">お疲れさまでした！</div>
      <div class="muted">${list.length}語 完了</div>
      <div class="row center">
        <button class="btn primary" id="fc-again">もう一度</button>
        <a class="btn" href="${menuHref}">メニューへ</a>
      </div>`;
    document.getElementById('fc-again').addEventListener('click', (e) => {
      e.stopPropagation();
      runFlash(target, dir, opt, menuHref, modeName);
    });
  }

  card.addEventListener('click', (e) => {
    if (idx >= list.length || e.target.closest('a,button')) return;
    advance(); // 自動モードでもタップで先に進められる
  });
  document.getElementById('fc-next').addEventListener('click', () => idx < list.length && advance());
  document.getElementById('fc-prev').addEventListener('click', () => {
    if (idx >= list.length) {
      idx = list.length - 1;
      phase = 0;
      return show();
    }
    back();
  });
  document.getElementById('fc-speech').addEventListener('click', (e) => {
    opt.speech = !opt.speech;
    settings.set('flashSpeech', opt.speech);
    e.currentTarget.textContent = opt.speech ? '🔊 ON' : '🔇 OFF';
    if (!opt.speech) stopSpeak();
  });
  const pauseBtn = document.getElementById('fc-pause');
  if (pauseBtn)
    pauseBtn.addEventListener('click', () => {
      if (idx >= list.length) return;
      paused = !paused;
      pauseBtn.textContent = paused ? '再開' : '一時停止';
      pauseBtn.classList.toggle('on', paused);
      if (paused) {
        clear();
        const t = card.querySelector('.timer');
        if (t) t.remove();
      } else show();
    });

  const onKey = (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (idx < list.length) advance();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      back();
    }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => {
    clear();
    document.removeEventListener('keydown', onKey);
  };

  show();
}

// ---------- 打ち込み ----------

const norm = (c) =>
  c
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑–—]/g, '-')
    .replace(/ /g, ' ');
const isAlnum = (c) => /[a-z0-9]/i.test(c);

async function viewType(p) {
  const target = await resolveTarget(p);
  if (!target) return notFound();
  const menuHref = `#/menu?${targetQuery(p)}`;
  let order = settings.get('typeOrder', 'seq');

  app.replaceChildren(
    h(`
    ${backBar(menuHref, 'メニュー')}
    <div class="target-head compact">
      <h1>打ち込み</h1>
      <div class="muted">${esc(target.title)} ・ ${target.words.length}語</div>
    </div>
    <div class="card settings">
      <div class="set-row"><div class="set-label">順番</div><div class="seg-opts">
        <label class="opt"><input type="radio" name="order" value="seq" ${order === 'seq' ? 'checked' : ''}><span>最初から</span></label>
        <label class="opt"><input type="radio" name="order" value="rand" ${order === 'rand' ? 'checked' : ''}><span>ランダム</span></label>
      </div></div>
      <button class="btn primary big" id="start" ${target.words.length ? '' : 'disabled'}>スタート</button>
    </div>
  `),
  );
  document.getElementById('start').addEventListener('click', () => {
    order = app.querySelector('input[name="order"]:checked').value;
    settings.set('typeOrder', order);
    runType(target, order, menuHref);
  });
}

function runType(target, order, menuHref) {
  const list = order === 'rand' ? shuffle(target.words) : target.words.slice();
  let idx = 0;
  let pos = 0;
  let miss = 0;
  let totalMiss = 0;
  let skipped = 0;
  let locked = false;
  let nextTimer = null;

  app.replaceChildren(
    h(`
    ${backBar(menuHref, 'メニュー')}
    <div class="type-wrap">
      <div class="flash-top">
        <span class="muted">打ち込み</span>
        <span id="ty-count" class="muted"></span>
      </div>
      <div class="progress"><div id="ty-bar"></div></div>
      <div class="card type-card" id="ty-card">
        <div class="fc-section muted small-text" id="ty-sec"></div>
        <div class="fc-ja" id="ty-q"></div>
        <div class="type-target" id="ty-target"></div>
        <div class="ipa center" id="ty-ipa"></div>
        <input id="ty-input" class="type-input" type="text" autocomplete="off" autocorrect="off"
          autocapitalize="off" spellcheck="false" inputmode="latin" enterkeyhint="next" placeholder="ここに英語を入力">
        <div class="row center">
          <button class="btn" id="ty-hint">ヒント</button>
          <button class="btn" id="ty-skip">答えを見る</button>
        </div>
      </div>
    </div>
  `),
  );

  const input = document.getElementById('ty-input');
  const cardEl = document.getElementById('ty-card');
  const targetEl = document.getElementById('ty-target');

  function renderTarget(showAll = false) {
    const w = list[idx].w;
    targetEl.innerHTML = [...w]
      .map((c, i) => {
        if (i < pos) return `<span class="ok">${esc(c)}</span>`;
        if (c === ' ') return `<span class="sp ${i === pos ? 'cur' : ''}">&nbsp;</span>`;
        if (showAll) return `<span class="ans">${esc(c)}</span>`;
        return `<span class="blank ${i === pos ? 'cur' : ''}">${isAlnum(c) ? '&nbsp;' : esc(c)}</span>`;
      })
      .join('');
  }

  function show() {
    if (nextTimer) clearTimeout(nextTimer);
    if (idx >= list.length) return finish();
    const w = list[idx];
    pos = 0;
    miss = 0;
    locked = false;
    cardEl.classList.remove('correct', 'revealed');
    document.getElementById('ty-count').textContent = `${idx + 1} / ${list.length}`;
    document.getElementById('ty-bar').style.width = `${(idx / list.length) * 100}%`;
    document.getElementById('ty-sec').textContent = w.s;
    document.getElementById('ty-q').innerHTML = `${w.t ? `<span class="pos">${esc(w.t)}</span>` : ''}${fmtMeaning(w.m)}`;
    document.getElementById('ty-ipa').textContent = '';
    input.value = '';
    input.disabled = false;
    renderTarget();
    input.focus();
  }

  function complete(revealed) {
    locked = true;
    const w = list[idx];
    totalMiss += miss;
    cardEl.classList.add(revealed ? 'revealed' : 'correct');
    if (revealed) {
      renderTarget(true);
    } else renderTarget();
    document.getElementById('ty-ipa').textContent = w.ipa ? `/${w.ipa}/` : '';
    speak(w.w);
    nextTimer = setTimeout(
      () => {
        idx++;
        show();
      },
      revealed ? 2500 : 1200,
    );
  }

  function flashError() {
    miss++;
    cardEl.classList.remove('shake');
    void cardEl.offsetWidth;
    cardEl.classList.add('shake');
  }

  // 入力された文字列を 1 文字ずつ照合する
  function processTyped(typed) {
    const w = list[idx].w;
    for (const ch of typed) {
      if (pos >= w.length) break;
      const c = norm(ch);
      if (c === norm(w[pos])) {
        pos++;
      } else if (!isAlnum(w[pos])) {
        // スペースや記号は入力を省略できる
        let q = pos;
        while (q < w.length && !isAlnum(w[q])) q++;
        if (q < w.length && c === norm(w[q])) pos = q + 1;
        else {
          flashError();
          break;
        }
      } else {
        flashError();
        break;
      }
    }
    // 末尾の記号は自動で埋める
    let q = pos;
    while (q < w.length && !isAlnum(w[q])) q++;
    if (q >= w.length) pos = w.length;
  }

  let composing = false;
  input.addEventListener('compositionstart', () => (composing = true));
  input.addEventListener('compositionend', () => {
    composing = false;
    onInput();
  });
  input.addEventListener('input', () => {
    if (!composing) onInput();
  });

  function onInput() {
    if (locked) {
      input.value = '';
      return;
    }
    const w = list[idx].w;
    const accepted = w.slice(0, pos);
    const val = input.value;
    const typed = val.startsWith(accepted) ? val.slice(accepted.length) : val.slice(Math.min(val.length, pos));
    processTyped(typed);
    input.value = w.slice(0, pos);
    renderTarget();
    if (pos >= w.length) complete(false);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && locked) {
      e.preventDefault();
      if (nextTimer) clearTimeout(nextTimer);
      idx++;
      show();
    }
  });

  document.getElementById('ty-hint').addEventListener('click', () => {
    if (locked) return;
    const w = list[idx].w;
    miss++;
    pos++;
    while (pos < w.length && !isAlnum(w[pos])) pos++;
    input.value = w.slice(0, pos);
    renderTarget();
    if (pos >= w.length) complete(false);
    else input.focus();
  });
  document.getElementById('ty-skip').addEventListener('click', () => {
    if (locked) return;
    skipped++;
    miss++;
    complete(true);
  });

  function finish() {
    document.getElementById('ty-bar').style.width = '100%';
    cardEl.classList.remove('correct', 'revealed');
    cardEl.innerHTML = `
      <div class="fc-done">お疲れさまでした！</div>
      <div class="stats">
        <div><b>${list.length}</b><span class="muted">問題数</span></div>
        <div><b>${totalMiss}</b><span class="muted">ミス</span></div>
        <div><b>${skipped}</b><span class="muted">答えを見た</span></div>
      </div>
      <div class="row center">
        <button class="btn primary" id="ty-again">もう一度</button>
        <a class="btn" href="${menuHref}">メニューへ</a>
      </div>`;
    document.getElementById('ty-again').addEventListener('click', () => runType(target, order, menuHref));
  }

  cleanup = () => {
    if (nextTimer) clearTimeout(nextTimer);
  };
  show();
}
