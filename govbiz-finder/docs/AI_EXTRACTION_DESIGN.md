# 공고문 자격요건 AI 추출 설계 (초안)

상태: **설계·샘플 비교 단계**. 운영 반영(DB 테이블, 수집 후 자동 실행, 화면 표시)은 샘플 결과 확인 후 별도 승인.

## 1. 목적
- 현재 맞춤 공고 판정은 공고명·지원대상 문구에서 **정규식으로 추정한 규칙**(신뢰도 0.5~0.7)에 의존함.
- 그래서 공고명에 키워드가 없으면 놓치거나, 타 업종·타 지역 공고(6G, 농산물 등)가 섞임.
- 공고 본문을 AI로 읽고 자격요건을 **기존 매칭 엔진의 규칙 형식**으로 바꿔 정확도를 높임.
- 매칭 판정 자체는 계속 규칙 엔진이 함. AI는 "규칙 재료"만 만듦(CLAUDE.md §7: 규칙 기반 판정에 AI 호출 금지).

## 2. 원칙(인계 기준 대응)
| 원칙 | 적용 |
|---|---|
| 확정 판정 금지 | AI 규칙 신뢰도 0.8(명시)/0.55(추정) → 명시 조건 하한 0.9 미만이라 불일치여도 숨기지 않고 '조건 불일치 가능성' 탭에 표시 |
| 근거 제시 | 규칙마다 원문 근거 문장(`AI 추출(참고): …`)을 붙임 → 기존 '원문 근거' UI에 그대로 노출 |
| 불확실 = 확인 필요 | 추정 조건(0.55)은 0.6 미만이라 불일치로 확정하지 않음. 미입력은 기존대로 '확인 필요' |
| 개인정보 | 공고문(공개 데이터)만 전송. 기업정보·사업자번호·이용자 정보는 전송하지 않음 |
| 프롬프트 인젝션 | 공고문을 `<announcement>` 태그로 감싸고 "지시 무시" 명시, 태그 위장 문자열 제거, Structured Outputs로 출력 형식 고정, 허용 목록 밖 값은 버림 |
| 비용 통제 | 공고 원문 해시 단위 캐시, 수집 직후 Batch API(50% 할인)로 일괄 처리, 1회 비용 상한, 사용량 기록 |
| 비밀키 | `ANTHROPIC_API_KEY`는 PC·서버 환경변수에만. 코드·저장소·채팅 금지 |

## 3. 추출 스키마 → 매칭 규칙
`src/domain/ai-extract.ts`

| AI field_key | 값 | 매칭 엔진 규칙 |
|---|---|---|
| region_sido / region_sigungu | 시도 표준명 / ○○시·군·구 | 동일 키 |
| enterprise_size | 소상공인·중소기업·중견기업·대기업 | 동일 |
| business_age_years | lte/gte + 숫자 1개 | 동일(달력 기준 판정) |
| industry_group / tech_field / certification | 서비스 분류 목록 | 동일 |
| revenue_band / employee_band | 서비스 구간 목록 | 동일 |
| research_institute / venture / export | yes / no | 동일 |
| other_requirements | 위에 안 맞는 요건(우대·가점 포함) | 규칙 아님. 상세 화면 '기타 요건(참고)'로 표시 예정 |
| summary | 지원내용·대상·신청방법 1문장씩 | 카드 3줄 요약(선택) |

- 허용 목록 밖 값, 형식 오류, 중복 항목은 버리고 사유를 기록(`dropped`).
- 단위 테스트: `tests/ai-extract.test.ts`(변환·인젝션 방어·표시 단계·비용 계산).

## 4. 처리 흐름(운영 반영 시 — 승인 필요)
1. 수집(runSource) 후 `content_hash`가 새로 생기거나 바뀐 공고만 대상 큐에 넣음.
2. 하루 1회 Batch API로 제출 → 완료 후 결과 저장(최대 24시간, 보통 1시간 이내).
3. 결과는 신규 테이블에 저장, `loadRules`가 기존 규칙과 합침(같은 field_key면 신뢰도 높은 쪽 우선, 공고 지역 규칙(1.0)은 항상 유지).
4. 관리자 화면에 처리 건수·실패·누적 비용 표시. 월 비용 상한(예: $20) 초과 시 자동 중지.

### 신규 테이블 제안(미적용, 승인 대상)
```sql
CREATE TABLE ai_extractions (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,          -- 원문 바뀌면 재추출
  version TEXT NOT NULL,               -- 프롬프트·스키마 버전(AI_EXTRACT_VERSION)
  model TEXT NOT NULL,
  output_json TEXT,                    -- 검증 전 원본(감사용)
  rules_json TEXT,                     -- 검증 후 규칙
  status TEXT NOT NULL,                -- ok | failed
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, content_hash, version)
);
```

## 5. 알려진 제한
- 기업마당·K-Startup API가 주는 본문은 **요약 본문**임. 첨부 공고문(HWP/PDF)의 세부 자격요건은 포함 안 됨 → 첨부 파싱은 별도 과제(수집 정책 검토 필요).
- 모델 출력은 틀릴 수 있음 → 확정 판정에 쓰지 않고 '참고'로만 표시.
- 단가·모델명은 변경될 수 있음 → 실행 시점 확인(`AI_PRICES`).

## 6. 샘플 비교(현재 단계, PC에서 실행)
```
cd govbiz-finder && npm install && npm run ai:sample -- --dry-run
```
- 위는 API 호출 없이 대상 50건과 모델별 예상 비용만 출력.
- 실제 비교: PC에서 환경변수로 키 설정 후 실행(키는 채팅에 붙여넣지 말 것).
```
set ANTHROPIC_API_KEY=발급키 && npm run ai:sample
```
- 기본 모델: Haiku·Sonnet·Opus 3종, 50건, 비용 상한 $3(예상 합계 약 $1~2).
- 결과: `data/ai-sample/report-<시각>.md`(공고별 규칙 기반 vs 모델별 추출 비교표) + `.json`.
- 판정: 비교표에서 누락·오추출을 확인해 모델 선택 → 운영 반영 승인 요청.
