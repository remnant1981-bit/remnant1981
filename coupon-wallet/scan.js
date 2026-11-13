/* 쿠폰 지갑 - 기프티콘 자동 인식 (브라우저 전용)
 * 1) 기기 내장 BarcodeDetector로 바코드 번호 판독 (지원 기기에서만, 무료·오프라인)
 * 2) 사용자가 설정에 넣은 API 키로 Claude 비전 호출 → 브랜드·상품·금액·유효기간·번호·메모 추출
 * 결과는 폼에 채워 주기만 하며, 저장은 사용자가 확인한 뒤에 함. */
(function (root) {
  'use strict';

  const SDK_SRC = 'vendor/anthropic-sdk.js';
  const BARCODE_FORMATS = ['code_128', 'ean_13', 'ean_8', 'code_39', 'itf', 'upc_a', 'upc_e', 'codabar', 'qr_code', 'data_matrix'];
  let sdkPromise = null;

  // 크기가 큰 SDK(약 360KB)는 인식을 처음 쓸 때만 내려받음
  function loadSdk() {
    if (root.Anthropic) return Promise.resolve(root.Anthropic);
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SDK_SRC;
        s.onload = () => (root.Anthropic ? resolve(root.Anthropic) : reject(new Error('sdk-missing')));
        s.onerror = () => { sdkPromise = null; reject(new Error('sdk-load')); };
        document.head.appendChild(s);
      });
    }
    return sdkPromise;
  }

  // 지원하지 않는 기기는 null, 지원하지만 못 읽으면 []
  async function detectBarcodes(blob) {
    if (!('BarcodeDetector' in root)) return null;
    try {
      const supported = await root.BarcodeDetector.getSupportedFormats();
      const formats = BARCODE_FORMATS.filter(f => supported.includes(f));
      if (!formats.length) return null;
      const bmp = await createImageBitmap(blob);
      try {
        const found = await new root.BarcodeDetector({ formats }).detect(bmp);
        return found.map(f => ({ format: f.format, value: f.rawValue }));
      } finally { if (bmp.close) bmp.close(); }
    } catch (e) { return []; }
  }

  function splitDataUrl(u) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(u || '');
    return m ? { mediaType: m[1], data: m[2] } : null;
  }

  function describeError(Anthropic, e) {
    if (e && e.message === 'sdk-load') return 'AI 모듈을 불러오지 못함 (인터넷 연결 확인)';
    if (e && e.code === 'refusal') return 'AI가 이 이미지의 처리를 거절함';
    if (e && e.code === 'truncated') return 'AI 응답이 중간에 끊김. 다시 시도해 주세요';
    if (e && e.code === 'parse') return '인식 결과를 읽지 못함. 다시 시도하거나 직접 입력해 주세요';
    if (Anthropic) {
      if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않음 (설정에서 확인)';
      if (e instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 사용할 수 없음 (권한 확인)';
      if (e instanceof Anthropic.RateLimitError) return '요청이 많아 잠시 제한됨. 잠시 후 다시 시도해 주세요';
      if (e instanceof Anthropic.BadRequestError) {
        return /credit/i.test(String(e.message)) ? 'API 크레딧이 부족함 (Anthropic 콘솔에서 충전)' : `요청 오류: ${String(e.message).slice(0, 120)}`;
      }
      if (e instanceof Anthropic.APIConnectionError) return '네트워크 오류. 연결을 확인해 주세요';
      if (e instanceof Anthropic.APIError) return `API 오류 (${e.status || '?'})`;
    }
    return '인식 중 오류가 발생함';
  }

  async function askClaude({ dataUrl, apiKey, model, signal }) {
    const Anthropic = await loadSdk();
    const img = splitDataUrl(dataUrl);
    if (!img) { const e = new Error('unsupported image'); e.code = 'parse'; throw e; }
    const spec = root.CW.SCAN_MODELS.find(m => m.id === model) || root.CW.SCAN_MODELS[0];
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60000 });
    const params = {
      model: spec.id,
      max_tokens: 4096, // 항상 켜진 사고 토큰이 포함되므로 넉넉히
      system: root.CW.SCAN_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: root.CW.SCAN_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
          { type: 'text', text: '이 이미지에서 쿠폰 정보를 추출해 주세요.' }
        ]
      }]
    };
    let msg;
    if (spec.fallback) {
      // 안전 분류기가 거절하면 서버에서 대체 모델로 재시도
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
      msg = await client.beta.messages.create(params, { signal });
    } else {
      msg = await client.messages.create(params, { signal });
    }
    if (msg.stop_reason === 'refusal') { const e = new Error('refusal'); e.code = 'refusal'; throw e; }
    if (msg.stop_reason === 'max_tokens') { const e = new Error('truncated'); e.code = 'truncated'; throw e; }
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = root.CW.parseScan(text);
    if (!parsed) { const e = new Error('parse'); e.code = 'parse'; throw e; }
    return parsed;
  }

  // 반환: { merged, barcodes(null=기기 미지원), usedAi, aiError }
  async function run({ file, dataUrl, apiKey, model, signal }) {
    const [bc, ai] = await Promise.allSettled([
      detectBarcodes(file),
      apiKey ? askClaude({ dataUrl, apiKey, model, signal }) : Promise.resolve(null)
    ]);
    const barcodes = bc.status === 'fulfilled' ? bc.value : null;
    let parsed = null, aiError = '';
    if (ai.status === 'fulfilled') parsed = ai.value;
    else if (!(signal && signal.aborted)) aiError = describeError(root.Anthropic, ai.reason);
    return { merged: root.CW.mergeScan(parsed, barcodes), barcodes, usedAi: !!apiKey, aiOk: !!parsed, aiError };
  }

  root.CWScan = { run, detectBarcodes };
})(typeof self !== 'undefined' ? self : this);
