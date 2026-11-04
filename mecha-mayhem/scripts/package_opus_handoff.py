"""Create a compact, reproducible source handoff ZIP for Opus 5.5."""

from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Mecha_Mayhem_Opus_5_5.zip"
SOURCES = [
    ROOT / name
    for name in (
        ".gitignore",
        "README.md",
        "index.html",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "assets",
        "public",
        "scripts",
        "src",
        "docs",
    )
]
SOURCES += list((ROOT / "artifacts" / "smoke").glob("*.png"))
SOURCES += list((ROOT / "artifacts" / "visual-qa").glob("*.png"))

with ZipFile(OUT, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for source in SOURCES:
        for path in (source.rglob("*") if source.is_dir() else [source]):
            if not path.is_file() or path.suffix.lower() in {".blend1", ".zip"}:
                continue
            if "__pycache__" in path.parts:
                continue
            archive.write(path, f"Mecha Mayhem/{path.relative_to(ROOT).as_posix()}")

with ZipFile(OUT) as archive:
    corrupt = archive.testzip()
    count = len(archive.namelist())
if corrupt:
    raise RuntimeError(f"Corrupt ZIP entry: {corrupt}")
print(f"{OUT}\nfiles={count}\nbytes={OUT.stat().st_size}\nsha256={sha256(OUT.read_bytes()).hexdigest()}")
