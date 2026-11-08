-- 기업정보 선택 항목 확장(모두 선택 입력, 미입력 = 확인 필요)
ALTER TABLE companies ADD COLUMN enterprise_size TEXT;      -- 소상공인 | 중소기업 | 중견기업 | 대기업
ALTER TABLE companies ADD COLUMN certifications TEXT;       -- 쉼표 구분 인증 목록
ALTER TABLE companies ADD COLUMN youth_ceo TEXT;            -- yes | no (대표자 만 39세 이하)
ALTER TABLE companies ADD COLUMN has_patent TEXT;           -- yes | no
ALTER TABLE companies ADD COLUMN interest_categories TEXT;  -- 쉼표 구분 분야 ID
