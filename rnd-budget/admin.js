// 관리자 화면. 서버가 없는 정적 사이트라 '화면 가림' 수준의 보호이며, 이 화면에서 다루는 값은 모두 공개 설정이다.
(function () {
  'use strict';
  const CFG = window.RB_CONFIG || {}, RB = window.RB;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } kids.forEach((c) => e.append(c)); return e; };
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } } };

  // ---------- 비밀번호(PBKDF2-SHA256). 형식: pbkdf2-sha256$반복수$salt$hash ----------
  const ITER = 310000;
  async function derive(pw, salt, iter) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
  }
  async function makeHash(pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2-sha256$${ITER}$${RB.b64encode(salt)}$${RB.b64encode(await derive(pw, salt, ITER))}`;
  }
  async function verify(pw, stored) {
    const m = String(stored).split('$');
    if (m.length !== 4 || m[0] !== 'pbkdf2-sha256') return false;
    const iter = Number(m[1]); if (!(iter >= 100000 && iter <= 5000000)) return false;
    const got = RB.b64encode(await derive(pw, RB.b64decode(m[2]), iter));
    let diff = got.length ^ m[3].length; for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (m[3].charCodeAt(i) || 0); // 길이·내용 일정 시간 비교
    return diff === 0;
  }
  const stored = (CFG.admin && CFG.admin.hash) || '';
  let newHash = '';

  // ---------- 기능 스위치 ----------
  const FLAGS = { examples: '예시로 체험하기', project: '연차·공동기관 편성', scenarios: '여러 안 저장·불러오기', faq: '자주 묻는 질문', steps: '상단 단계 메뉴', legalHeader: '상단 적용 법령 문구', helper: '편성 도우미', noticeImport: '공고문에서 기준 가져오기', execution: '집행 현황판', details: '세부 비목(세목) 입력', ministry: '소관 부처·사업 유형 선택' };
  const live = Object.assign(Object.fromEntries(Object.keys(FLAGS).map((k) => [k, false])), CFG.features || {});
  const preview = Object.assign({}, live, (ls.get('rb.preview', null) || {}).features || {});
  const publish = Object.assign({}, live);
  function savePreview() {
    const diff = Object.fromEntries(Object.keys(FLAGS).filter((k) => preview[k] !== live[k]).map((k) => [k, preview[k]]));
    if (Object.keys(diff).length) ls.set('rb.preview', { features: diff }); else ls.del('rb.preview');
  }
  function renderFlags() {
    $('flags').querySelector('tbody').replaceChildren(...Object.entries(FLAGS).map(([k, label]) => el('tr', {},
      el('td', {}, label, ' ', el('small', { class: 'hint', text: k })),
      el('td', {}, el('span', { class: `st ${live[k] ? 'ok' : 'warn'}`, text: live[k] ? '켜짐' : '꺼짐' })),
      el('td', {}, el('input', { type: 'checkbox', checked: preview[k], 'aria-label': `${label} 미리보기`, 'data-pv': k, onchange: (e) => { preview[k] = e.target.checked; savePreview(); } })),
      el('td', {}, el('input', { type: 'checkbox', checked: publish[k], 'aria-label': `${label} 운영에 반영`, 'data-pub': k, onchange: (e) => { publish[k] = e.target.checked; } })))));
  }
  $('clearPreview').addEventListener('click', () => { ls.del('rb.preview'); Object.assign(preview, live); renderFlags(); });

  // ---------- 설정 파일 만들기 ----------
  const q = (v) => `'${String(v).replace(/[\\'\n\r<>]/g, '')}'`;
  const val = (id) => $(id).value.trim();
  function configText() {
    const ga = val('cGa'), ads = val('cAds');
    if (ga && !/^G-[A-Z0-9]{4,}$/.test(ga)) throw new Error('방문 통계 측정 ID는 G-로 시작하는 값입니다(예: G-AB12CD34EF).');
    if (ads && !/^ca-pub-\d{10,20}$/.test(ads)) throw new Error('애드센스 게시자 ID는 ca-pub-숫자 형식입니다.');
    for (const id of ['cTop', 'cBottom']) if (val(id) && !/^\d{6,20}$/.test(val(id))) throw new Error('광고 단위 ID는 숫자입니다.');
    const hash = newHash || stored;
    return `// 운영 설정(공개 정보만). 비밀번호·키를 넣지 말 것. 관리자 화면(admin.html)에서 만든 파일
window.RB_CONFIG = {
  // 구글 애드센스(승인 후 입력). 비우면 광고 영역이 표시되지 않음
  adsenseClient: ${q(ads)},
  adsenseSlots: { top: ${q(val('cTop'))}, bottom: ${q(val('cBottom'))} },
  // 방문 통계(구글 애널리틱스 4). 비우면 통계 코드를 불러오지 않음. 입력 내용은 보내지 않음
  analytics: { ga4: ${q(ga)} },
  // 기능 스위치(단계적 공개). false = 화면에서 숨김(코드·데이터는 유지)
  features: {
${Object.keys(FLAGS).map((k) => `    ${k}: ${publish[k] ? 'true' : 'false'},${' '.repeat(Math.max(1, 14 - k.length - (publish[k] ? 4 : 5)))}// ${FLAGS[k]}`).join('\n')}
  },
  // 관리자 화면 비밀번호의 암호화 값(비밀번호 원문은 절대 적지 말 것)
  admin: { hash: ${q(hash)} },
  // 문의 연락처(비우면 표시 안 함)
  contact: ${q(val('cContact'))},
};
`;
  }
  const say = (id, msg, ok = true) => { const e = $(id); e.textContent = msg; e.hidden = false; e.className = ok ? 'nok' : 'nerr'; };
  $('dlConfig').addEventListener('click', () => {
    try {
      const url = URL.createObjectURL(new Blob([configText()], { type: 'text/javascript' }));
      const a = el('a', { href: url, download: 'config.js' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      say('cfgOk', '✔ config.js 를 내려받았습니다. 저장소의 rnd-budget/config.js 를 이 파일로 바꿔 배포하세요.');
    } catch (e) { say('cfgOk', e.message, false); }
  });
  $('cpConfig').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(configText()); say('cfgOk', '✔ 설정 내용을 복사했습니다.'); } catch (e) { say('cfgOk', e.message || '복사하지 못했습니다. 내려받기를 이용하세요.', false); }
  });
  $('mkHash').addEventListener('click', async () => {
    const a = $('pw1').value, b = $('pw2').value;
    $('pwOk').hidden = true;
    if (a.length < 12) return say('pwErr', '12자 이상으로 정하세요.', false);
    if (a !== b) return say('pwErr', '두 칸이 서로 다릅니다.', false);
    $('pwErr').hidden = true;
    newHash = await makeHash(a);
    $('pw1').value = ''; $('pw2').value = '';
    say('pwOk', '✔ 암호화 값을 만들었습니다. 3번의 ‘설정 파일 내려받기’에 자동으로 포함됩니다. 배포한 뒤부터 이 비밀번호로 로그인합니다.');
    renderChecks();
  });

  // ---------- 런칭 점검표 ----------
  const MANUAL = [['sc', '구글 서치콘솔에 사이트 등록, 사이트맵(rnd-budget/sitemap.xml) 제출'], ['nv', '네이버 서치어드바이저에 사이트 등록, 사이트맵 제출'], ['ga', 'GA4에서 rb_xlsx_download 를 주요 이벤트(전환)로 표시'], ['dom', '전용 도메인 연결 여부 결정(애드센스 신청 전)'], ['ads', '애드센스 신청·승인 후 광고 ID 입력'], ['kpi', '지표 시트(KPI_TRACKER.xlsx) 주간 입력 시작'], ['law', '법령·고시 개정 확인 일정 등록(월 1회)']];
  async function renderChecks() {
    const row = (level, msg) => el('li', { class: level }, el('span', { text: msg }));
    const exists = async (u, needle) => { try { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) return false; return needle ? (await r.text()).includes(needle) : true; } catch { return false; } };
    const off = Object.keys(FLAGS).filter((k) => !live[k]).map((k) => FLAGS[k]);
    const days = Math.round((Date.now() - new Date(`${RB.BASIS_DATE}T00:00:00+09:00`).getTime()) / 86400000);
    const items = [
      row(stored || newHash ? 'ok' : 'warn', stored ? '관리자 비밀번호: 설정됨' : newHash ? '관리자 비밀번호: 암호화 값 생성됨(배포 필요)' : '관리자 비밀번호: 미설정 — 지금은 누구나 이 화면을 열 수 있습니다'),
      row(CFG.analytics && CFG.analytics.ga4 ? 'ok' : 'warn', CFG.analytics && CFG.analytics.ga4 ? `방문 통계: 설정됨(${CFG.analytics.ga4})` : '방문 통계: 미설정 — 방문·다운로드 수를 알 수 없습니다'),
      row(CFG.contact ? 'ok' : 'warn', CFG.contact ? '문의 연락처: 표시 중' : '문의 연락처: 미설정 — 오류 제보를 받을 창구가 없습니다'),
      row(CFG.adsenseClient ? 'ok' : 'info', CFG.adsenseClient ? '광고: 설정됨' : '광고: 미설정(승인 후 입력)'),
      row((await exists('privacy.html')) ? 'ok' : 'error', '개인정보 처리 안내 페이지(privacy.html)'),
      row((await exists('sitemap.xml', '<urlset')) ? 'ok' : 'error', '사이트맵(sitemap.xml)'),
      row((await exists('index.html', 'id="faqLd"')) ? 'ok' : 'error', '자주 묻는 질문 구조화 데이터(검색 노출용)'),
      row(days > 60 ? 'warn' : 'ok', `법령 기준일 ${RB.BASIS_DATE}(${days}일 전)${days > 60 ? ' — 개정 여부를 다시 확인하세요' : ''}`),
      row('info', off.length ? `꺼져 있는 기능: ${off.join(', ')}` : '모든 기능이 켜져 있습니다'),
    ];
    $('autoChecks').replaceChildren(...items);
  }
  function renderManual() {
    const done = ls.get('rb.adminTodo', {});
    $('manual').replaceChildren(...MANUAL.map(([k, t]) => el('li', {}, el('label', {}, el('input', { type: 'checkbox', checked: !!done[k], onchange: (e) => { done[k] = e.target.checked; ls.set('rb.adminTodo', done); } }), ' ', t))));
  }

  function open() {
    $('gate').hidden = true; $('panel').hidden = false;
    $('pwState').textContent = stored ? '설정됨' : '미설정';
    $('cGa').value = (CFG.analytics && CFG.analytics.ga4) || ''; $('cAds').value = CFG.adsenseClient || '';
    $('cTop').value = (CFG.adsenseSlots && CFG.adsenseSlots.top) || ''; $('cBottom').value = (CFG.adsenseSlots && CFG.adsenseSlots.bottom) || ''; $('cContact').value = CFG.contact || '';
    renderFlags(); renderChecks(); renderManual();
  }
  // 비밀번호가 설정돼 있으면 로그인 후 열림(탭을 닫으면 다시 로그인)
  let authed = false; try { authed = sessionStorage.getItem('rb.admin') === stored; } catch { /* 무시 */ }
  if (!stored || authed) open();
  else {
    $('gate').hidden = false;
    let tries = 0;
    const go = async () => {
      $('login').disabled = true;
      await new Promise((r) => setTimeout(r, Math.min(8000, 300 * 2 ** tries))); // 틀릴수록 대기 시간 증가
      const ok = await verify($('pw').value, stored);
      $('login').disabled = false;
      if (!ok) { tries++; $('gateErr').hidden = false; $('pw').select(); return; }
      try { sessionStorage.setItem('rb.admin', stored); } catch { /* 무시 */ }
      $('pw').value = ''; open();
    };
    $('login').addEventListener('click', go);
    $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('pw').focus();
  }
})();
