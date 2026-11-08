-- 원천 특기사항(원문). 요금 계산에는 쓰지 않고, 혼합 요금 등 계산 불가 시설에서 사용자에게 원문을 보여주기 위해 보관한다.
ALTER TABLE parking_lots ADD COLUMN fee_note TEXT;
