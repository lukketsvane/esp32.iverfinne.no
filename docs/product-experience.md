# VATHOgraphy product experience

The product has one core journey: connect the rig, compose, capture, develop, keep the result. Technical preparation supports that journey and never becomes a competing mode.

## Interaction rules

- Keep the camera and finished artwork free of captions, tuning controls and duplicate status text.
- Use familiar icons with accessible names and at least 44-pixel touch targets. Show one short instruction only when an action is necessary, inside the relevant setup or recovery view.
- Match readiness to real evidence: a decoded frame for capture, a validated pair for stereo, verified stored model assets for estimated depth.
- Preserve the capture before development. Closing, interrupting, reloading or failing must leave a way to recover the original and continue.
- Keep measured stereo and estimated depth distinguishable in the result metadata. Never represent rejected stereo matches as calibrated depth.
- Keep the displayed artwork, exported image and print raster consistent. Introductory motion changes presentation only and respects Reduce Motion.

## Journey and release checks

| Moment | Expected experience | Required check |
| --- | --- | --- |
| First connection | One rig connection; both cameras join automatically. | Cold storage and delayed peer discovery do not leave a usable stereo rig behind model setup. |
| One camera available | The shutter still captures and preserves the original. | Model preparation happens only when development needs it; returning keeps the capture. |
| Development | The captured frame remains visible while processing. | Cancel, retry and background recovery do not erase or duplicate the capture. |
| Next capture | Returning to the camera starts a fresh live feed automatically. | The shutter waits for a frame from the new stream; a stalled restart recovers without reloading. |
| Finished result | A black-start depth reveal settles into the chosen expression. | Touch cancels the reveal; export pixels are unchanged. |
| Archive | Finished artwork is the thumbnail; undeveloped captures have a quiet recovery mark. | Recover from originals with the same archive identity, including after reload. |
| Archive navigation | Only the visible view responds to input. | Focus stays in the archive; Escape returns one level; closing restores the previous view. |
| Saving | A tap downloads the image; holding exposes other formats. | No save-preview detour, duplicate download or stale-image export. |
| Update | Existing images, models and settings survive. | Verify web assets, device readback and a fresh capture before claiming installation. |

## Evidence boundaries

Automated state tests establish software behaviour. Desktop browser checks establish layout and interaction in that browser. Firmware readback and JPEG capture establish installation and transport. Physical iPhone onboarding, touch gestures, stereo calibration quality and paper output each require their own direct verification.

Review changes against this journey before release. Fix broken states before adding controls, copy or visual decoration.
