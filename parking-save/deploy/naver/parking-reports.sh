#!/usr/bin/env bash
# 이용자 정보 오류 신고 검토(운영 서버, root). 앱 컨테이너 안의 node:sqlite로 직접 조회·처리.
# 사용: parking-reports                       → 검토 대기 목록
#       parking-reports reviewed <id> <이름>   → 확인 처리(원천 데이터 수정은 별도)
#       parking-reports dismiss <id> <이름>    → 기각
set -euo pipefail
CMD="${1:-list}"
DBP="${PARKING_DB_IN_CONTAINER:-/data/parking.sqlite}"  # 컨테이너 안 DB 경로(검증 시에만 바꿈)
run() { docker exec -e Q_CMD="$CMD" -e Q_ID="${2:-}" -e Q_BY="${3:-}" -e Q_DB="$DBP" parking-save node -e "$1" 2>/dev/null; }
case "$CMD" in
  list)
    run "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.Q_DB,{readOnly:true});
const L={FEE:'요금',HOURS:'운영시간',LOCATION:'위치',CLOSED:'폐쇄',OTHER:'기타'};
const r=d.prepare(\"SELECT r.id,r.parking_lot_id p,l.name,r.category c,r.message m,r.created_at t FROM lot_reports r JOIN parking_lots l ON l.id=r.parking_lot_id WHERE r.status='NEW' ORDER BY r.created_at DESC LIMIT 100\").all();
if(!r.length)console.log('검토 대기 신고 없음');for(const x of r)console.log('#'+x.id+' '+x.t.slice(0,16)+' ['+L[x.c]+'] 시설 '+x.p+' '+x.name+'\n   '+(x.m||'(내용 없음)'));" ;;
  reviewed|dismiss)
    [[ "${2:-}" =~ ^[0-9]+$ ]] && [ -n "${3:-}" ] || { echo "사용법: parking-reports $CMD <id> <이름>"; exit 2; }
    run "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.Q_DB);
const st=process.env.Q_CMD==='reviewed'?'REVIEWED':'DISMISSED';
const r=d.prepare(\"UPDATE lot_reports SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='NEW'\").run(st,process.env.Q_BY.slice(0,60),new Date().toISOString(),Number(process.env.Q_ID));
console.log(r.changes?'신고 #'+process.env.Q_ID+' 처리 완료':'신고 #'+process.env.Q_ID+'는 대기 상태가 아니거나 없습니다.');process.exit(r.changes?0:1);" "$2" "$3" ;;
  *) echo "사용법: parking-reports [reviewed|dismiss <id> <이름>]"; exit 2 ;;
esac
