"""
블로그 대표 이미지(썸네일) 자동 생성

- 1200x630 (공유 미리보기 비율). 글 목록에서 정사각형으로 잘려도 보이도록 글자는 가운데 배치
- 큰 문구: front matter 의 thumbnail_text (없으면 제목), 작은 문구: 카테고리·블로그명
- 색상: 카테고리별로 고정 (같은 카테고리는 같은 색 → 블로그 통일감)
- 한글 폰트: 설정 → 시스템 폰트 → 없으면 나눔고딕(OFL) 자동 다운로드

사용: python thumbnail.py "썸네일 문구" --sub "기술노트" -o out.png
"""

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE_DIR = Path(__file__).resolve().parent
FONT_DIR = BASE_DIR / "fonts"
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-ExtraBold.ttf"
SYSTEM_FONTS = [
    "C:/Windows/Fonts/malgunbd.ttf",                                   # Windows 맑은 고딕 Bold
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",                      # macOS
    "/usr/share/fonts/truetype/nanum/NanumGothicExtraBold.ttf",        # Ubuntu fonts-nanum
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",             # Ubuntu fonts-noto-cjk
]

# (배경 시작, 배경 끝, 포인트) — 어두운 배경 + 흰 글자로 대비 확보
PALETTES = [
    ("#0f2a4a", "#1f5f8b", "#7fd1ff"),
    ("#1b2b1f", "#2f6b47", "#9be3b4"),
    ("#2b1630", "#6a2c70", "#f3a6ff"),
    ("#2e1a0e", "#8a4b17", "#ffc58a"),
    ("#141a2e", "#3a3f8f", "#b3b8ff"),
    ("#2a0f14", "#8b1f2f", "#ffadb8"),
]
W, H = 1200, 630


def find_font(custom: str = "") -> str:
    for p in [custom, *SYSTEM_FONTS]:
        if p and Path(p).is_file():
            return p
    FONT_DIR.mkdir(exist_ok=True)
    local = FONT_DIR / "NanumGothic-ExtraBold.ttf"
    if not local.is_file():
        urllib.request.urlretrieve(FONT_URL, local)
    return str(local)


def _hex(c: str):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _gradient(c1: str, c2: str) -> Image.Image:
    a, b = _hex(c1), _hex(c2)
    img = Image.new("RGB", (W, H), a)
    px = img.load()
    for y in range(H):
        for x in range(0, W, 4):
            t = (x / W) * 0.6 + (y / H) * 0.4
            col = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
            for dx in range(4):
                px[x + dx, y] = col
    return img


def _wrap(draw, text: str, font, max_w: int) -> list:
    """띄어쓰기 단위 줄바꿈 (한 단어가 너무 길면 글자 단위)"""
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
            continue
        if cur:
            lines.append(cur)
        cur = ""
        for ch in word:
            if draw.textlength(cur + ch, font=font) <= max_w:
                cur += ch
            else:
                lines.append(cur)
                cur = ch
    if cur:
        lines.append(cur)
    return lines


def make_thumbnail(text: str, out: Path, sub: str = "", footer: str = "",
                   font_path: str = "", palette_key: str = "") -> Path:
    key = palette_key or sub or text
    c1, c2, accent = PALETTES[int(hashlib.md5(key.encode()).hexdigest(), 16) % len(PALETTES)]
    img = _gradient(c1, c2)
    d = ImageDraw.Draw(img)
    fp = find_font(font_path)
    text = " ".join(text.split())

    # 글자 크기: 3줄 이내로 들어갈 때까지 줄임
    max_w = 980
    for size in range(96, 40, -4):
        font = ImageFont.truetype(fp, size)
        lines = _wrap(d, text, font, max_w)
        if len(lines) <= 3:
            break
    lines = lines[:3]
    lh = int(size * 1.3)
    block = lh * len(lines)
    y = (H - block) // 2 + (20 if sub else 0)

    if sub:
        sf = ImageFont.truetype(fp, 34)
        sw = d.textlength(sub, font=sf)
        d.rounded_rectangle([(W - sw) / 2 - 22, y - 92, (W + sw) / 2 + 22, y - 36], radius=28, fill=accent)
        d.text((W / 2, y - 64), sub, font=sf, fill=_hex(c1), anchor="mm")

    for i, line in enumerate(lines):
        d.text((W / 2 + 3, y + i * lh + lh / 2 + 3), line, font=font, fill=(0, 0, 0), anchor="mm")  # 그림자
        d.text((W / 2, y + i * lh + lh / 2), line, font=font, fill=(255, 255, 255), anchor="mm")

    d.rectangle([W / 2 - 60, y + block + 26, W / 2 + 60, y + block + 32], fill=accent)
    if footer:
        ff = ImageFont.truetype(fp, 28)
        d.text((W / 2, H - 44), footer, font=ff, fill=(220, 225, 235), anchor="mm")

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG", optimize=True)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="블로그 썸네일 생성")
    ap.add_argument("text")
    ap.add_argument("--sub", default="")
    ap.add_argument("--footer", default="")
    ap.add_argument("-o", "--out", default="thumbnail.png")
    a = ap.parse_args()
    print(make_thumbnail(a.text, Path(a.out), a.sub, a.footer))
    sys.exit(0)
