# 출시 체크리스트 — 파킹세이브

기준 2026-11-13. 서버 생성부터 공개 출시까지 순서대로 따라 하는 목록. 명령의 자세한 설명은 `DEPLOYMENT.md` 9절, 보안 점검은 `SECURITY_REVIEW.md`.
표시: **[직접]** 콘솔·신청·결정 등 직접 하실 일 · **[서버]** SSH로 서버에서 실행 · **[확인]** 결과 확인

## 0단계. 미리 신청할 것 (승인에 며칠 걸릴 수 있음)

- [ ] **[직접]** 공공데이터포털 인증키 **재발급** — 예전 키는 대화에 노출됨. 새 키는 서버 환경파일에만 넣고 채팅·메일에 붙이지 않음
- [ ] **[직접]** 공공데이터포털 **특일 정보(15012690) 활용신청** — 없으면 시설 약 93%가 요일별 요금·운영 판정 불가 (**출시 필수**)
- [ ] **[직접]** 서울 열린데이터광장 인증키(선택) — 서울 실시간 잔여면수·혼잡 경향
- [ ] **[직접]** 브이월드 인증키(선택, 무료) — 지도 배경 교체용. 도메인 확정 후 그 도메인으로 발급
- [ ] **[직접]** 법률 검토 의뢰 — 위치기반서비스사업 신고 여부, 약관·처리방침(운영 주체·보관 기간·시행일) 확정 (**공개 출시 필수**)

## 1단계. 서버·도메인 (약 30분)

- [ ] **[직접]** 네이버클라우드 서버 생성: Micro(1vCPU·1GB), Ubuntu 22.04/24.04, 공인 IP
- [ ] **[직접]** 방화벽(ACG): 80·443 전체 허용, **22는 본인 IP만**, 3000은 열지 않음
- [ ] **[직접]** 도메인 DNS A 레코드 → 서버 공인 IP
- [ ] **[확인]** PC에서 `ping <도메인>` 이 서버 IP로 응답
- [ ] **[직접]** GitHub Actions 탭에서 `ParkingSave image` 워크플로 성공 확인(GHCR 이미지). 저장소가 비공개면 패키지를 공개로 바꾸거나 서버에서 `docker login ghcr.io`

## 2단계. 설치 (약 10분)

```bash
# [서버]
git clone https://github.com/remnant1981-bit/remnant1981.git
cd remnant1981/parking-save/deploy/naver
sudo DOMAIN=<도메인> EMAIL=<알림 받을 메일> bash setup.sh
```

- [ ] **[확인]** 마지막에 `완료` 출력, `curl -s https://<도메인>/api/health` → `"status"` 응답(키 넣기 전이라 `degraded`가 정상)
- [ ] **[확인]** `curl -s -o /dev/null -w "%{http_code}" https://<도메인>/admin` → **404** (관리자 화면 외부 차단)
- [ ] **[서버]** SSH 비밀번호 로그인 끄기(키 인증만): `/etc/ssh/sshd_config`에서 `PasswordAuthentication no` 후 `sudo systemctl restart ssh` — **키로 접속되는지 먼저 확인한 뒤**

## 3단계. 키 입력·첫 수집 (약 10분)

```bash
# [서버] 아래 항목만 채우고 나머지는 그대로
sudo nano /etc/parking-save/env
#   DATA_GO_KR_SERVICE_KEY=<새로 받은 키>
#   SEOUL_OPENAPI_KEY=<있으면>
#   ALERT_WEBHOOK_URL=<Slack·Discord 웹훅, 있으면>
sudo parking-update
sudo parking-sync holidays
sudo parking-sync standard-parking
tail -n 5 /var/log/parking-save-sync.log
```

- [ ] **[확인]** 수집 로그에 `HTTP 200`, 헬스체크 `"status":"ok"`
- [ ] **[확인]** 웹훅을 넣었다면 `sudo parking-alert "테스트 알림"` → 채널에 메시지 도착
- [ ] **[서버]** 관리자 화면 접속 확인: PC에서 `ssh -L 3000:127.0.0.1:3000 <서버>` → 브라우저 `http://localhost:3000/admin` → `/etc/parking-save/env`의 `ADMIN_API_TOKEN` 입력 → 수집 상태·품질 리포트 확인

## 4단계. 화면 확인 (약 20분, 휴대폰으로)

- [ ] **[확인]** 홈 → "현재 위치 사용" → 위치 권한 허용 → 결과 카드·요금 표시
- [ ] **[확인]** 목적지 검색(예: 세종대로) → "대략 위치" 안내와 결과
- [ ] **[확인]** 상세 → **네이버 지도 앱 길찾기** 버튼이 앱을 엶 (Android·iPhone 각각)
- [ ] **[확인]** 지도 탭에 배경 지도가 보임
- [ ] **[확인]** Safari(iPhone)·삼성 인터넷에서 같은 흐름
- [ ] **[확인]** 홈 화면에 추가(PWA) → 아이콘으로 실행
- [ ] **[확인]** 정보 오류 신고 보내기 → 관리자 화면 신고 목록에 보임
- [ ] **[확인]** 카카오톡 등에 상세 링크 공유 → 미리보기 이미지(이름·요금)가 뜸

## 5단계. 공개 출시

- [ ] **[직접]** 법률 검토 결과 반영: 약관·처리방침의 "확인 필요" 문구를 확정 내용으로 교체 → 반영 요청
- [ ] **[직접]** 네이버 서치어드바이저·구글 서치 콘솔에 사이트 등록 → `https://<도메인>/sitemap.xml` 제출
- [ ] **[직접]** 백업 외부 보관 방식 결정(주 1회 PC 또는 오브젝트 스토리지로 복사)
- [ ] **[확인]** 하루 뒤: 자동 수집(04:17)·백업(03:37) 로그, 헬스 `ok`, 알림 채널 조용함

## 6단계. 출시 후 (트래픽이 늘면)

- [ ] 지도 배경을 브이월드로 교체: 환경파일에 `MAP_TILE_PROVIDER=vworld`, `VWORLD_API_KEY=<키>` → `sudo parking-update` → 지도 탭 확인
- [ ] 외부 전문 보안 점검 1회
- [ ] 지오코딩 제공자 결정(건물·상호 이름 검색) — 정해지면 목적지 검색 부분만 교체
- [ ] 임시 기준값 조정: 검색 반경, 실시간 신선도, 혼잡 구간, 도보 시간 가정(1.3배·분속 67m)

## 문제가 생기면

| 증상 | 먼저 볼 것 |
|---|---|
| 사이트가 안 열림 | `sudo systemctl status nginx`, `docker ps`(parking-save 실행 중인지), `sudo parking-update` |
| 헬스 `degraded` | 응답의 `issues`: `STANDARD_SYNC_STALE` → 수집 로그 / `MIGRATIONS_PENDING` → `parking-update` / `MAP_TILE_FALLBACK` → 브이월드 키 / `ERROR_BURST` → `docker logs parking-save 2>&1 \| grep '"level":"error"'` |
| 수집 실패 | `/var/log/parking-save-sync.log`의 오류 코드(인증 실패면 키 확인, 호출 제한이면 다음 날 자동 재시도) |
| 데이터가 이상함 | 관리자 화면 → 품질 리포트, 해당 시설은 "수동 보정"(확인 근거 필수, 되돌리기 가능) |
| DB 손상 의심 | `sudo parking-restore-test`로 최신 백업 확인 → `DEPLOYMENT.md` 9-5 "복원 절차" |
