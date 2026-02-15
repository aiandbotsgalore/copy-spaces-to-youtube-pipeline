# Batch Pipeline Lifecycle

This pipeline tracks each requested Space in per-item JSON state files under `batches/<batch_id>/items/` on the `pipeline-state` branch.

## Stages

1. `submit_batch.yml`
2. `process_batch.yml`
3. `ingest_worker.yml`
4. `youtube_upload.yml`
5. `finalize_batch.yml`

## Item Statuses

- `queued`
- `claimed`
- `preflight_filtered`
- `downloading`
- `release_created`
- `youtube_uploading`
- `youtube_uploaded`
- `failed_retryable`
- `failed_permanent`

Terminal states are:

- `youtube_uploaded`
- `preflight_filtered`
- `failed_permanent`

## Notes

- Strict preflight is enabled in `submit_batch.yml`.
- YouTube visibility defaults to `private`.
- Category defaults to `Podcasts & Blogs`.
- Retry budget defaults to 3 attempts per item.
