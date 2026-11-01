#!/usr/bin/env python3
"""WebP и AVIF для карты Кас-Хатара: `py -3.13 tools/make-map-formats.py`.

Кадр не меняется: оба файла собираются из того же JPEG, который остаётся
запасным вариантом (`public/map/kas-khatar.jpg`, 4333×3064), поэтому рисунки,
метки и масштаб гекса ложатся на все три формата одинаково. Формат выбирает
браузер — `<picture>` в `components/MapBoard.tsx` берёт первый поддержанный
`<source>`: AVIF, затем WebP, иначе JPEG.

Качество подобрано по PSNR относительно JPEG-эталона на полном кадре:

| формат | качество | вес | PSNR |
| --- | --- | --- | --- |
| JPEG (эталон) | q85 4:2:2 | 2 723 655 Б | — |
| WebP | 82 (method 6) | ~54 % | 36,0 дБ |
| AVIF | 65 (speed 4) | ~41 % | 35,8 дБ |

`--check` ничего не пишет: сверяет, что файлы на месте, распаковываются в тот
же размер и легче JPEG (код 1 при расхождении). Пересобрать после замены
карты: `py -3.13 tools/make-map-formats.py` (нужен Pillow с libwebp и libavif —
`py -3.13 -m pip install --upgrade pillow`).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Консоль Windows часто живёт в cp1251, где нет «×», «·», «✓» и «✗», а в поток
# (Cline, CI, `| more`) Python пишет локальной кодировкой, которую читатель ждёт
# как UTF-8. Поэтому: в живой консоли — её кодировка, в потоке — UTF-8, и в
# обоих случаях непереводимый символ заменяется, а не роняет прогон.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        if not stream.isatty():
            stream.reconfigure(encoding="utf-8")
        stream.reconfigure(errors="replace")

try:
    from PIL import Image, features
except ImportError:  # pragma: no cover - зависит от машины
    print("нужен Pillow: py -3.13 -m pip install --upgrade pillow", file=sys.stderr)
    raise SystemExit(1)

PROJECT_DIR = Path(__file__).resolve().parents[1]
MAP_DIR = PROJECT_DIR / "public" / "map"
JPEG = MAP_DIR / "kas-khatar.jpg"
TARGETS = (("webp", "WEBP", {"quality": 82, "method": 6}), ("avif", "AVIF", {"quality": 65, "speed": 4}))


def human(bytes_count: int) -> str:
    return f"{bytes_count / 1024 / 1024:.2f} МБ ({bytes_count:,} Б)".replace(",", " ")


def build(reference: Path) -> int:
    """Пересобирает WebP и AVIF рядом с JPEG и печатает вес каждого файла."""
    jpeg_bytes = reference.stat().st_size
    with Image.open(reference) as source:
        source.load()
        frame = source.convert("RGB")
    print(f"эталон: {reference.name} | {frame.width}x{frame.height} | {human(jpeg_bytes)}")
    failed = False
    for extension, pillow_format, params in TARGETS:
        target = reference.with_suffix(f".{extension}")
        frame.save(target, pillow_format, **params)
        written = target.stat().st_size
        share = written / jpeg_bytes * 100
        print(f"  {extension}: {human(written)} | {share:.0f} % от JPEG")
        if written >= jpeg_bytes:
            print(f"  {extension} тяжелее JPEG — формат не даёт выигрыша", file=sys.stderr)
            failed = True
    return 1 if failed else 0


def check(reference: Path) -> int:
    """Сверяет готовые файлы с JPEG: размер кадра и вес, ничего не пересобирая."""
    jpeg_bytes = reference.stat().st_size
    problems: list[str] = []
    with Image.open(reference) as source:
        expected = source.size
    print(f"эталон: {reference.name} | {expected[0]}x{expected[1]} | {human(jpeg_bytes)}")
    for extension, pillow_format, _params in TARGETS:
        target = reference.with_suffix(f".{extension}")
        if not target.is_file():
            problems.append(f"нет {target.name}: запустите tools/make-map-formats.py")
            continue
        try:
            with Image.open(target) as image:
                size = image.size
                image.load()
        except Exception as error:  # noqa: BLE001 - сообщение важнее класса
            problems.append(f"{target.name} не распаковывается: {error}")
            continue
        written = target.stat().st_size
        if size != expected:
            problems.append(f"{target.name}: кадр {size[0]}x{size[1]}, а у JPEG {expected[0]}x{expected[1]}")
        if written >= jpeg_bytes:
            problems.append(f"{target.name} весит {human(written)} — не легче JPEG")
        print(f"  {extension}: {size[0]}x{size[1]} | {human(written)} | {written / jpeg_bytes * 100:.0f} % от JPEG")
    if problems:
        for problem in problems:
            print(f"  [!] {problem}", file=sys.stderr)
        return 1
    print("  [ok] оба формата на месте, кадр тот же, вес меньше JPEG")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="WebP и AVIF для карты: тот же кадр, меньше вес")
    parser.add_argument("source", nargs="?", default=str(JPEG), help="JPEG-карта (по умолчанию public/map/kas-khatar.jpg)")
    parser.add_argument("--check", action="store_true", help="только сверить готовые файлы, ничего не писать")
    args = parser.parse_args()

    reference = Path(args.source)
    if not reference.is_file():
        print(f"нет файла {reference}", file=sys.stderr)
        return 1
    for format_name, pillow_name, _params in TARGETS:
        if not features.check(pillow_name.lower()):
            print(f"Pillow собран без {pillow_name} — переустановите: py -3.13 -m pip install --upgrade pillow", file=sys.stderr)
            return 1
    return check(reference) if args.check else build(reference)


if __name__ == "__main__":
    raise SystemExit(main())
