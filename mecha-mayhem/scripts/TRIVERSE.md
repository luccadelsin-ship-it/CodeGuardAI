# Triverse batch pipeline

`triverse_batch.py` consumes the 768 × 768 single-subject images in `assets/reference/triverse-input/`. The default plan selects 24 modular parts (six heads, six torsos with arms, six leg sets, six weapons). `--include-full-robots` adds six complete robot references. These are enlarged crops of a small concept board, so inspect generated geometry before using it in the game.

## Plan without an API key

```powershell
python scripts/triverse_batch.py
python scripts/triverse_batch.py --only heads/striker
```

Plan mode makes **no network requests** and does not create assets or spend credits.

## Generate one approved part

Install `requests`, configure `TRIVERSE_API_KEY` in your environment, then run:

```powershell
python -m pip install requests
python scripts/triverse_batch.py --only heads/striker --approve heads/striker --execute-paid-tasks --max-total-credits 35
```

Each newly created task requires its own `--approve CATEGORY/NAME`, even when selected by `--only` or `--category`. The script checks the live credit quote and available balance before uploading. `--max-total-credits` is a cap on the **quoted** total for new tasks in that invocation; Triverse says a quote is a read-only preflight and cannot guarantee the final task charge. Existing tasks resume polling and downloading without creating a new paid task. Do not place the API key in a file or command argument.

The script uploads each image, creates an `image-to-model` task with a deterministic `client_order_id`, polls status, downloads a GLB to `public/assets/triverse/CATEGORY/NAME.glb`, checks the GLB header, and writes task IDs, output URLs, SHA-256 hashes, and terms references to `public/assets/triverse/manifest.json`. Failed and cancelled tasks are not retried automatically. The image upload rate is limited to one per 6.2 seconds.

The [official quote documentation](https://docs.triverse.ai/api-endpoints/pricing-quote) currently lists **35 credits** for quality and **25 credits** for speed per textured image-to-model task. A complete 24-part quality batch would therefore plan for **840 credits**, but the live quote is authoritative. The API endpoints and response shapes are documented by Triverse: [upload](https://docs.triverse.ai/api-endpoints/upload-files), [image to 3D](https://docs.triverse.ai/api-endpoints/image-to-3d), [task status](https://docs.triverse.ai/api-endpoints/task-status), [download](https://docs.triverse.ai/api-endpoints/download-assets). Review the [current terms](https://triverse.ai/terms-of-service) and [plan rights](https://triverse.ai/pricing) before publishing generated outputs; the script deliberately records their license as unverified.

**Status in this project:** no Triverse task has been submitted or charged. The user's Edge tab could not be controlled in this session and no API key is configured here.
