-- 업종 분야(대분류, 선택 입력). 농가·관광업체 등 업종 한정 공고 판정에 사용
ALTER TABLE companies ADD COLUMN industry_group TEXT;
