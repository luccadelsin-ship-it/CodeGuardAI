"""Prepare or explicitly submit Mecha Mayhem reference parts to Triverse.

The default command is a local plan. Credit-consuming task creation requires
--execute-paid-tasks, --max-total-credits, and a matching --approve for EACH item.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "assets" / "reference"
SOURCE_MANIFEST = REFERENCE / "manifest.json"
OUTPUT = ROOT / "public" / "assets" / "triverse"
RESULT_MANIFEST = OUTPUT / "manifest.json"
API = "https://api.triverse.ai/api/v1"
DOC_PRICE = {"quality": 35, "speed": 25}  # Planning only; API quote is authoritative.
CATEGORIES = ("heads", "torsos", "legs", "weapons", "full_robots")
TERMS_URL = "https://triverse.ai/terms-of-service"
PRICING_URL = "https://triverse.ai/pricing"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category", action="append", choices=CATEGORIES,
                        help="Select one or more categories; default is the 24 modular parts.")
    parser.add_argument("--only", action="append", metavar="CATEGORY/NAME",
                        help="Select an exact item, e.g. --only heads/striker (repeatable).")
    parser.add_argument("--include-full-robots", action="store_true",
                        help="Also select the six complete robot references in the default plan.")
    parser.add_argument("--mode", choices=DOC_PRICE, default="quality")
    parser.add_argument("--polygon-limit", type=int, default=50000)
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument("--execute-paid-tasks", action="store_true",
                        help="Upload images and create credit-consuming Triverse tasks.")
    parser.add_argument("--approve", action="append", metavar="CATEGORY/NAME",
                        help="Explicitly approve a new paid task for this exact item (repeatable).")
    parser.add_argument("--max-total-credits", type=int,
                        help="Required for execution; preflight cap on quoted credits for new tasks in this run.")
    parser.add_argument("--poll-seconds", type=float, default=7)
    parser.add_argument("--timeout-minutes", type=float, default=45)
    args = parser.parse_args()
    if not 1000 <= args.polygon_limit <= 1500000:
        parser.error("--polygon-limit must be 1,000 to 1,500,000")
    if args.texture_size not in (1024, 2048, 4096):
        parser.error("--texture-size must be 1024, 2048, or 4096")
    if args.poll_seconds < 5 or args.timeout_minutes <= 0:
        parser.error("Use --poll-seconds >= 5 and --timeout-minutes > 0")
    if args.execute_paid_tasks and (args.max_total_credits is None or args.max_total_credits < 0):
        parser.error("Execution requires an explicit nonnegative --max-total-credits")
    if args.max_total_credits is not None and not args.execute_paid_tasks:
        parser.error("--max-total-credits only applies with --execute-paid-tasks")
    return args


def selected_items(args: argparse.Namespace) -> list[dict[str, Any]]:
    items = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))["items"]
    categories = set(args.category or CATEGORIES[:4])
    if args.include_full_robots and not args.category:
        categories.add("full_robots")
    selected = [item for item in items if item["category"] in categories]
    if args.only:
        names = set(args.only)
        selected = [item for item in selected if f"{item['category']}/{item['name']}" in names]
        missing = names - {f"{item['category']}/{item['name']}" for item in selected}
        if missing:
            raise ValueError(f"Unknown or excluded --only item(s): {', '.join(sorted(missing))}")
    for item in selected:
        input_path = REFERENCE / item["triverse_input"]
        if not input_path.is_file():
            raise FileNotFoundError(input_path)
    return selected


def load_results() -> dict[str, Any]:
    if RESULT_MANIFEST.is_file():
        return json.loads(RESULT_MANIFEST.read_text(encoding="utf-8"))
    return {
        "generator": "Triverse image-to-model API v1",
        "api_documentation": "https://docs.triverse.ai/api-endpoints/image-to-3d",
        "terms_url": TERMS_URL,
        "pricing_url": PRICING_URL,
        "rights_note": "Review the current Triverse account plan and terms before commercial use. No license is assumed by this manifest.",
        "items": {},
    }


def save_results(results: dict[str, Any]) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    temporary = RESULT_MANIFEST.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(RESULT_MANIFEST)


def api_data(response: Any, operation: str) -> dict[str, Any]:
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
        raise RuntimeError(f"Triverse {operation} failed: {payload!r}")
    return payload["data"]


def run(args: argparse.Namespace, items: list[dict[str, Any]]) -> None:
    api_key = os.environ.get("TRIVERSE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Set TRIVERSE_API_KEY in the environment before execution. Do not paste it into the script.")
    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("Install Python requests: python -m pip install requests") from exc

    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
    results = load_results()
    spent_in_run = 0
    last_upload = 0.0
    approved = set(args.approve or [])
    for index, item in enumerate(items, 1):
        key = f"{item['category']}/{item['name']}"
        input_path = REFERENCE / item["triverse_input"]
        image_sha = hashlib.sha256(input_path.read_bytes()).hexdigest()
        output_path = OUTPUT / item["category"] / f"{item['name']}.glb"
        settings = {"mode": args.mode, "polygon_limit": args.polygon_limit, "texture_size": args.texture_size}
        order_hash = hashlib.sha256(f"{key}:{image_sha}:{settings}".encode()).hexdigest()[:14]
        order_id = f"mm_{item['category']}_{item['name']}_{order_hash}"
        record = results["items"].setdefault(key, {
            "source_image": str(input_path.relative_to(ROOT)).replace("\\", "/"),
            "source_sha256": image_sha,
            "settings": settings,
            "client_order_id": order_id,
            "status": "LOCAL_ONLY",
            "terms_url": TERMS_URL,
            "license": "UNVERIFIED — check Triverse account plan and terms",
        })
        if record.get("source_sha256") != image_sha or record.get("settings") != settings:
            raise RuntimeError(f"Existing result for {key} has a different source or settings; archive it before rerunning")
        if output_path.is_file() and record.get("status") == "SUCCESS":
            print(f"[{index}/{len(items)}] {key}: already downloaded")
            continue
        if record.get("status") in ("FAILED", "CANCELLED"):
            print(f"[{index}/{len(items)}] {key}: previous task {record['status']}; no automatic paid retry")
            continue

        if not record.get("task_uuid"):
            if key not in approved:
                print(f"[{index}/{len(items)}] {key}: skipped; add --approve {key} to authorize its paid task")
                continue
            quote = api_data(session.post(f"{API}/tasks/pricing/quote", json={
                "flow_name": "image-to-model", "params": {"turbo": args.mode == "speed"},
            }, timeout=30), "pricing quote")
            cost = int(quote["cost_credits"])
            available = int(quote["available_credits"])
            record["quoted_credits"] = cost
            record["available_credits_at_quote"] = available
            record["quoted_at"] = now()
            save_results(results)
            if cost > available:
                raise RuntimeError(f"Insufficient Triverse credits for {key}: {cost} required, {available} available")
            if spent_in_run + cost > args.max_total_credits:
                print(f"Credit cap reached before {key}: {spent_in_run} used in this run, next task costs {cost}")
                break

            if not record.get("file_key"):
                # The upload endpoint allows 10 uploads per minute. 6.2 s between uploads stays below that limit.
                delay = max(0.0, 6.2 - (time.monotonic() - last_upload))
                if delay:
                    time.sleep(delay)
                with input_path.open("rb") as stream:
                    upload = api_data(session.post(f"{API}/upload/image", files={
                        "file": (input_path.name, stream, "image/png"),
                    }, timeout=120), "image upload")
                last_upload = time.monotonic()
                record["file_key"] = upload["file_key"]
                record["status"] = "UPLOADED"
                record["uploaded_at"] = now()
                save_results(results)

            payload = {
                "image_file": record["file_key"],
                "model_version": "v2",
                "polygon_limit": args.polygon_limit,
                "texture_size": args.texture_size,
                "turbo": args.mode == "speed",
                "client_order_id": order_id,
            }
            task = api_data(session.post(f"{API}/tasks/image-to-model", json=payload, timeout=60), "task creation")
            record["task_uuid"] = task["task_uuid"]
            record["status"] = task.get("status", "PENDING")
            record["created_at"] = now()
            record["task_cost_credits"] = task.get("cost_credits", cost)
            spent_in_run += cost
            save_results(results)
            print(f"[{index}/{len(items)}] {key}: task {record['task_uuid']} created ({cost} quoted credits)")
        else:
            print(f"[{index}/{len(items)}] {key}: resuming task {record['task_uuid']}")

        deadline = time.monotonic() + args.timeout_minutes * 60
        while time.monotonic() < deadline:
            task = api_data(session.get(f"{API}/tasks/{record['task_uuid']}", timeout=30), "task status")
            record["status"] = task["status"]
            record["progress"] = task.get("progress")
            record["task_output"] = task.get("output")
            record["last_checked_at"] = now()
            save_results(results)
            print(f"  {record['status']} {record['progress']}%", flush=True)
            if record["status"] in ("SUCCESS", "FAILED", "CANCELLED"):
                break
            time.sleep(args.poll_seconds)
        else:
            print(f"  Timeout: task remains {record['status']}; rerun to resume polling")
            continue

        if record["status"] != "SUCCESS":
            record["error"] = task.get("error")
            save_results(results)
            continue
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = output_path.with_suffix(".glb.part")
        with session.get(f"{API}/tasks/download/{record['task_uuid']}", stream=True, timeout=180) as download:
            download.raise_for_status()
            with temporary.open("wb") as stream:
                for chunk in download.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        stream.write(chunk)
        with temporary.open("rb") as stream:
            if stream.read(4) != b"glTF":
                temporary.unlink(missing_ok=True)
                raise RuntimeError(f"Triverse download for {key} was not a GLB; inspect the task output")
        temporary.replace(output_path)
        record["downloaded_glb"] = str(output_path.relative_to(ROOT)).replace("\\", "/")
        record["downloaded_sha256"] = hashlib.sha256(output_path.read_bytes()).hexdigest()
        record["downloaded_at"] = now()
        save_results(results)
        print(f"  Saved {output_path.relative_to(ROOT)}")
    print(f"New task credits quoted in this run: {spent_in_run} / {args.max_total_credits}")


def main() -> int:
    args = parse_args()
    try:
        items = selected_items(args)
        if not items:
            raise ValueError("No images selected")
        planning_price = DOC_PRICE[args.mode]
        print(f"Selected {len(items)} images, {args.mode} mode, ~{len(items) * planning_price} credits at the documented API price.")
        print("The live pricing quote is checked before each task; it may differ from this planning number.")
        for item in items:
            print(f"  {item['category']}/{item['name']} <- {item['triverse_input']}")
        if args.execute_paid_tasks:
            unknown_approvals = set(args.approve or []) - {f"{item['category']}/{item['name']}" for item in items}
            if unknown_approvals:
                raise ValueError(f"Approval does not match a selected item: {', '.join(sorted(unknown_approvals))}")
            run(args, items)
        else:
            print("PLAN ONLY: no API request, image upload, or paid task was made.")
        return 0
    except (OSError, ValueError, RuntimeError, KeyError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
