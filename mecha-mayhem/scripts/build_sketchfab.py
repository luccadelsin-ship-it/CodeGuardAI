"""Download the CC BY Sketchfab props via Objaverse and normalize with Blender.

Requires `pip install objaverse` and Blender 5.x on PATH (or BLENDER_PATH).
"""

import json
import os
from pathlib import Path
import subprocess

import objaverse


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "assets" / "sketchfab"
BLENDER = os.environ.get("BLENDER_PATH", r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe")
PROPS = [
    dict(name="cargo_crate", uid="96f95f993d1746298003cdda74a126a2", height=1.5,
         title="Sci-Fi Crate Prop", author="CraigG124", url="https://sketchfab.com/3d-models/sci-fi-crate-prop-96f95f993d1746298003cdda74a126a2"),
    dict(name="loot_crate", uid="b019f3602b6a4dc9a49223533e0079fc", height=1.35,
         title="Sci- Fi Crate", author="Bailief", url="https://sketchfab.com/3d-models/sci-fi-crate-b019f3602b6a4dc9a49223533e0079fc"),
    dict(name="energy_barrel", uid="481f7499eaf64b8792bffc59a8b4e05a", height=1.2,
         title="Sci-fi barrel", author="Igor_K.", url="https://sketchfab.com/3d-models/sci-fi-barrel-481f7499eaf64b8792bffc59a8b4e05a"),
    dict(name="outpost_tower", uid="c271103cd2f84ed3992baeda6416bbb0", height=8.0,
         title="Sci-Fi Tower", author="Jonathan", url="https://sketchfab.com/3d-models/sci-fi-tower-c271103cd2f84ed3992baeda6416bbb0"),
    dict(name="radar_tower", uid="61ec1fa948e04e2eaf87b44e03ff7da2", height=6.0,
         title="Sci-Fi Tower", author="vabart", url="https://sketchfab.com/3d-models/sci-fi-tower-61ec1fa948e04e2eaf87b44e03ff7da2"),
]


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    downloaded = objaverse.load_objects([prop["uid"] for prop in PROPS], download_processes=5)
    for prop in PROPS:
        source = downloaded.get(prop["uid"])
        if not source:
            raise RuntimeError(f"Objaverse missing {prop['uid']}")
        destination = OUTPUT / f"{prop['name']}.glb"
        command = [BLENDER, "--background", "--python", str(ROOT / "scripts" / "process_sketchfab.py"),
                   "--", str(source), str(destination), str(prop["height"])]
        result = subprocess.run(command, capture_output=True, text=True)
        print(result.stdout[-1000:])
        if result.returncode:
            raise RuntimeError(result.stderr[-3000:])
    manifest = [{key: value for key, value in prop.items() if key != "height"} | {
        "path": f"/assets/sketchfab/{prop['name']}.glb", "license": "CC BY 4.0",
        "modifications": "Scaled to game metres and re-centered to a ground pivot in Blender."
    } for prop in PROPS]
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
