# Open-source / self-hosted try-on model register

Fill in one entry per candidate **from the source repository and model card at evaluation
time**. An open-source repository is not automatically usable commercially: code, checkpoint,
base model and training-data licences can each differ.

> The "reported" licences below are leads to verify, written from general knowledge on
> 2026-11-05 — **not verified**. Several widely used VTON models have been published under
> non-commercial licences (e.g. CC BY-NC-SA 4.0) and trained on non-commercial datasets
> (VITON-HD, DressCode). Confirm before any commercial use.

| Field | IDM-VTON | OOTDiffusion | CatVTON | StableVITON |
| --- | --- | --- | --- | --- |
| Repository | yisol/IDM-VTON | levihsu/OOTDiffusion | Zheng-Chong/CatVTON | rlawjdghek/StableVITON |
| Code licence (reported, verify) | CC BY-NC-SA 4.0 | CC BY-NC-SA 4.0 | CC BY-NC-SA 4.0 | CC BY-NC-SA 4.0 |
| Checkpoint licence | verify | verify | verify | verify |
| Base model + licence | verify (SDXL-based) | verify (SD-based) | verify (SD-based) | verify (SD-based) |
| Training data licence | verify | verify | verify | verify |
| Commercial use allowed? | verify | verify | verify | verify |
| GPU / VRAM needed | measure | measure | measure | measure |
| Inference latency (p50 / p95) | measure | measure | measure | measure |
| Input limits (resolution, pose, crop) | measure | measure | measure | measure |
| Garment types supported | verify | verify | verify | verify |
| Quality findings (link to run) | — | — | — | — |
| Decision | — | — | — | — |

A self-hosted model is integrated by implementing `VirtualTryOnProvider`
(`apps/api/src/tryon/provider.ts`) — the rest of the app doesn't change.
