-- 중복 판정 규칙 보정 전에 잘못 병합되어 남은 출처 연결 정리:
-- 어떤 공고 자신의 (원천, 원천 공고ID)인데 다른 공고에 출처로 붙어 있는 행을 삭제
DELETE FROM announcement_sources
WHERE EXISTS (
  SELECT 1 FROM announcements a
  WHERE a.source_id = announcement_sources.source_id
    AND a.source_notice_id = announcement_sources.source_notice_id
    AND a.id <> announcement_sources.announcement_id
);
