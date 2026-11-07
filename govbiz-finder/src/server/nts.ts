// 국세청 사업자등록정보 '상태조회' 연계. 진위확인 API(대표자명·개업일 등 추가 입력 필요)와 구분한다.
// 상태조회가 제공하는 값만 반환: 납세자상태(계속/휴업/폐업), 과세유형, 폐업일 등.
// 대표자명·상호·주소·매출·종업원 수·연구소 여부는 이 API 가 제공한다고 가정하지 않는다.
// 주의: 실제 엔드포인트/필드는 공식 문서(공공데이터포털) 기준으로 연동 전 재확인 필요(OPEN_ISSUES #2). 실연동은 미검증.

export interface NtsStatus {
  bizNo: string;
  statusText: string | null;       // 예: 계속사업자 / 휴업자 / 폐업자 / 국세청에 등록되지 않은 사업자등록번호
  statusCode: "01" | "02" | "03" | null;
  taxType: string | null;          // 예: 부가가치세 일반과세자
  closedAt: string | null;         // YYYY-MM-DD
  registered: boolean;
  isMock: boolean;
}
export interface NtsAdapter {
  readonly isMock: boolean;
  lookupStatus(bizNo: string): Promise<NtsStatus>;
}

export class NtsError extends Error {
  constructor(message: string, readonly kind: "config" | "upstream" | "rate_limit") {
    super(message);
  }
}

/** 키가 없는 개발환경용. 결과는 항상 '테스트 데이터'로 표시된다. 마지막 자리 기준 결정적 응답. */
export class MockNtsAdapter implements NtsAdapter {
  readonly isMock = true;
  async lookupStatus(bizNo: string): Promise<NtsStatus> {
    const last = Number(bizNo[9]);
    if (last === 9) return { bizNo, statusText: "국세청에 등록되지 않은 사업자등록번호입니다.", statusCode: null, taxType: null, closedAt: null, registered: false, isMock: true };
    if (last === 8) return { bizNo, statusText: "폐업자", statusCode: "03", taxType: "폐업자", closedAt: "2024-12-31", registered: true, isMock: true };
    if (last === 7) return { bizNo, statusText: "휴업자", statusCode: "02", taxType: "부가가치세 일반과세자", closedAt: null, registered: true, isMock: true };
    return { bizNo, statusText: "계속사업자", statusCode: "01", taxType: "부가가치세 일반과세자", closedAt: null, registered: true, isMock: true };
  }
}

export class DataGoKrNtsAdapter implements NtsAdapter {
  readonly isMock = false;
  constructor(private serviceKey: string, private fetchImpl: typeof fetch = fetch) {}
  async lookupStatus(bizNo: string): Promise<NtsStatus> {
    const url = "https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=" + encodeURIComponent(this.serviceKey);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ b_no: [bizNo] }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new NtsError("국세청 API 호출에 실패했습니다.", "upstream");
    }
    if (res.status === 429) throw new NtsError("호출 제한에 도달했습니다.", "rate_limit");
    if (!res.ok) throw new NtsError(`국세청 API 오류(${res.status})`, "upstream");
    const body = (await res.json().catch(() => null)) as { data?: Record<string, string>[] } | null;
    const row = body?.data?.[0];
    if (!row) throw new NtsError("국세청 API 응답을 해석할 수 없습니다.", "upstream");
    const code = row.b_stt_cd as "01" | "02" | "03" | "";
    const closed = row.end_dt && /^\d{8}$/.test(row.end_dt) ? `${row.end_dt.slice(0, 4)}-${row.end_dt.slice(4, 6)}-${row.end_dt.slice(6, 8)}` : null;
    return {
      bizNo,
      statusText: row.b_stt || row.tax_type || null,
      statusCode: code || null,
      taxType: row.tax_type || null,
      closedAt: closed,
      registered: !!code,
      isMock: false,
    };
  }
}

export function getNtsAdapter(): NtsAdapter {
  const key = process.env.NTS_API_KEY;
  return key ? new DataGoKrNtsAdapter(key) : new MockNtsAdapter();
}
