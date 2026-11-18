"""설정·캠페인·대기열 공통 함수"""

import csv
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent

DEFAULT_CONFIG = {
    "timezone": "Asia/Seoul",
    "campaigns_file": "campaigns.csv",
    "queue_dir": "queue",
    "posted_dir": "queue/posted",
    "failed_dir": "queue/failed",
    "disclosure": "[광고]",
    "post_method": "auto",       # auto / api / intent (README 참고)
    "ai": {
        "model": "claude-sonnet-5-5",
        "effort": "low",
        "variants": 3,           # 캠페인당 트윗 초안 수 (문구 돌려쓰기 → 같은 글 반복 방지)
        "style_prompt": "",      # 계정별 추가 지시 (예: '직장인 대상, 반말 금지')
    },
    "rate_limit": {
        "max_per_run": 1,
        "max_per_24h": 3,        # X 스팸 판정·API 비용 관리
        "min_gap_minutes": 180,
        "campaign_cooldown_hours": 24,   # 같은 캠페인 연속 게시 방지
    },
    "quiet_hours": [1, 7],       # 이 시간대(KST, 시작 포함·끝 미포함)엔 게시 안 함
}


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    path = BASE_DIR / "config.json"
    if path.exists():
        user = json.loads(path.read_text(encoding="utf-8-sig"))
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


def now(cfg: dict) -> dt.datetime:
    return dt.datetime.now(ZoneInfo(cfg["timezone"]))


def path(cfg: dict, key: str) -> Path:
    p = Path(cfg[key])
    return p if p.is_absolute() else BASE_DIR / p


def parse_time(s: str, cfg: dict) -> dt.datetime | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).replace(tzinfo=ZoneInfo(cfg["timezone"]))
        except ValueError:
            pass
    t = dt.datetime.fromisoformat(s)
    return t if t.tzinfo else t.replace(tzinfo=ZoneInfo(cfg["timezone"]))


def load_campaigns(cfg: dict, include_expired: bool = False) -> list[dict]:
    """campaigns.csv → [{name,url,benefit,target,deadline,notes,active}]"""
    f = path(cfg, "campaigns_file")
    if not f.exists():
        return []
    today = now(cfg).date()
    out = []
    with f.open(encoding="utf-8-sig", newline="") as fp:
        for row in csv.DictReader(fp):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            if not row.get("name") or not row.get("url") or row["name"].startswith("#"):
                continue
            if row.get("active", "y").lower() in ("n", "no", "0", "false", "x"):
                continue
            dl = row.get("deadline", "")
            if dl and not include_expired:
                try:
                    if dt.date.fromisoformat(dl) < today:
                        continue
                except ValueError:
                    pass
            out.append(row)
    return out


def read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def append_jsonl(p: Path, row: dict) -> None:
    with p.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(row, ensure_ascii=False) + "\n")
