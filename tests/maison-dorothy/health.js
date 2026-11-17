// 메종도로시 상태 점검 — GitHub Actions 가 매일 실행 (실패하면 GitHub 이 메일로 알림)
// 실행: node tests/maison-dorothy/health.js   (SKIP_SITE=1 이면 사이트 확인 생략: 오픈 전 점검용)
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../../maison-dorothy/logic.js');

const ROOT = path.join(__dirname, '../../maison-dorothy');
const SITE = process.env.SITE_URL || 'https://remnant1981-bit.github.io/remnant1981/maison-dorothy/';
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'), ctx);
const C = ctx.window.DOROTHY;

const fails = [], warns = [], oks = [];
const get = async (url, ms = 30000) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { redirect: 'follow', signal: ctl.signal }); } finally { clearTimeout(t); }
};

async function checkSheet() {
  if (!C.productsUrl) { warns.push('config.js 에 productsUrl 이 없어 시트 점검을 건너뜀'); return null; }
  let d;
  for (let i = 0; i < 3 && !d; i++) {   // 구글 쪽 일시 오류 대비 3번까지
    try { const r = await get(C.productsUrl + '?products=1'); if (r.ok) d = await r.json(); } catch (e) { /* 재시도 */ }
    if (!d) await new Promise(z => setTimeout(z, 3000));
  }
  if (!d) { fails.push('구글 시트(공개 웹앱)에 연결되지 않음 — 배포가 내려갔거나 권한이 바뀌었는지 확인'); return null; }
  const ps = L.parseSheet(d.rows);
  if (!ps) { fails.push('상품 탭을 읽을 수 없음 — "상품명" 머리줄이나 상품 줄이 있는지 확인'); return null; }
  oks.push(`상품표 읽힘: 손님에게 보이는 옷 ${ps.length}벌`);
  if (/주문번호|받는분/.test(JSON.stringify(d))) fails.push('공개 웹앱 응답에 주문 정보가 섞여 있음 — 즉시 확인 필요');
  const noPrice = ps.filter(p => !L.hasPrice(p));
  if (noPrice.length) warns.push(`가격이 비어 있는 옷 ${noPrice.length}벌 ("가격 문의"로 보임): ${noPrice.map(p => p.name).slice(0, 8).join(', ')}`);
  const noImg = ps.filter(p => !p.img);
  if (noImg.length) warns.push(`사진이 없는 옷 ${noImg.length}벌: ${noImg.map(p => p.name).join(', ')}`);
  const s = L.parseSettings(d.settings);
  if (!s || !s.open) warns.push('설정 탭의 영업요일·오픈·마감을 읽지 못함 — 형식 확인 (예: 월~토, 10:00, 20:00)');
  if (!s || !s.bank) warns.push('설정 탭에 입금계좌가 비어 있음');
  return ps;
}

// 사진이 실제로 열리는지 (파일명은 저장소에 있는지, 드라이브 링크는 공유가 켜져 있는지)
async function checkImages(ps) {
  const broken = [];
  const urls = [];
  ps.forEach(p => [p.img, ...(p.gallery || [])].filter(Boolean).forEach(f => urls.push({ p, f })));
  for (const { p, f } of urls) {
    if (!/^https:/.test(f)) { if (!fs.existsSync(path.join(ROOT, 'images', f))) broken.push(`${p.name}: images/${f} 파일 없음`); continue; }
    try {
      const r = await get(f, 20000);
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\//.test(type)) broken.push(`${p.name}: 사진을 열 수 없음 (${r.status}) — 드라이브 공유가 "링크가 있는 모든 사용자"인지 확인`);
    } catch (e) { broken.push(`${p.name}: 사진 주소 응답 없음`); }
  }
  if (broken.length) fails.push(`깨진 사진 ${broken.length}개\n  - ${broken.join('\n  - ')}`);
  else oks.push(`사진 ${urls.length}장 모두 열림`);
}

async function checkSite() {
  if (process.env.SKIP_SITE) { warns.push('사이트 확인 생략 (SKIP_SITE)'); return; }
  try {
    const r = await get(SITE);
    const html = await r.text();
    if (!r.ok) fails.push(`손님 페이지가 열리지 않음 (${r.status}) ${SITE}`);
    else if (!html.includes('메종도로시')) fails.push('손님 페이지 내용이 이상함 (매장 이름이 없음)');
    else oks.push(`손님 페이지 열림 ${SITE}`);
    if (r.ok && C.preview) warns.push('아직 미리보기 모드(preview: true) — 오픈 준비 중 띠가 보이고 주문이 접수되지 않음');
  } catch (e) { fails.push(`손님 페이지 응답 없음 ${SITE}`); }
}

(async () => {
  const ps = await checkSheet();
  if (ps) await checkImages(ps);
  await checkSite();
  const md = [
    `## 메종도로시 상태 점검 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
    fails.length ? `### ❌ 문제 ${fails.length}건\n${fails.map(x => '- ' + x).join('\n')}` : '### ✅ 문제 없음',
    warns.length ? `### ⚠️ 확인하면 좋은 것\n${warns.map(x => '- ' + x).join('\n')}` : '',
    oks.length ? `### 정상\n${oks.map(x => '- ' + x).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  process.exit(fails.length ? 1 : 0);
})();
