# 테스트 결과

- 일자: 2026-11-18 / Python 3.13.18 / unittest
- 최종 결과: 통과 11건 / 실패 0건

## 경과 (투명성)
최초 실행에서 1건 실패(`test_summary`). 원인은 스크립트 결함이 아니라 테스트 기대값 오류였음 (출력에 없는 열 `대표 지시`의 문구를 검증). 해당 잘못된 단언 1줄을 제거하고 재실행하여 통과함. 테스트를 비활성화하지 않았음.

## 테스트 항목
| 항목 | 내용 |
|---|---|
| split_escaped_pipe | `\|` 복원, 빈 셀 |
| parse_only_record_section | `## 양식`·다음 섹션 표 무시, 셀 내 파이프 |
| empty_cells_kept | 빈 검수 셀 |
| bad_row_warns | 열 수 불일치 행 경고·제외 |
| summary | 상태별 건수, 미완료, 검수 미완료, 비표준 값 |
| escape_on_output | 출력 시 `\|` 이스케이프 |
| no_section / missing_column / empty_table | 오류·빈 표 |
| cli_output_and_readonly | 기본 파일 미생성, --output 저장, 입력 불변, 동일 경로 거부 |
| missing_file | 종료 코드 2 |

## 실제 실행 (ops/work-log.md)
- `python3 ops_status.py` 종료 코드 0. 5건 전부 완료, 미완료 0건, 검수 미완료 0건.
- 비표준 검수 값 1건 표시: W-003 `조이 1차 검토(검수팀장 미운영)`.
- `--output` 파일 저장 확인. 실행 전후 work-log.md md5 동일 (수정 없음).
