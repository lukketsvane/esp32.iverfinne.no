# Camera interaction review

The review covered capture, processing, comparing with the original, adjusting the result, exporting and revisiting the archive. The interface keeps the image central and uses gestures to supplement the existing accessible icon controls.

| Finding | Implemented behavior |
| --- | --- |
| Releasing a stationary long press closed the export menu, making it easy to miss a format. | Hold for 360 ms and release to leave the glass menu open, then tap a format. Hold, drag and release also exports directly. Small finger movement is tolerated. |
| A long image hold could trigger printing, an expensive action with little visible warning. | Hold for 450 ms to see the original temporarily. Release restores the processed image; dragging or a second finger cancels the comparison. Printing uses its icon. |
| Double-tapping could leave the result instead of resetting its adjustments. | Double-tap resets tone position and width while retaining the chosen preset and review screen. Simple taps avoid unnecessary full-resolution rendering. |
| Delete confirmation remained armed after unrelated actions. | Two consecutive taps within three seconds confirm deletion. Other actions, focus changes, leaving the archive and hiding the app disarm it. |
| Outlined controls competed with the photograph. | Symbols have transparent, unframed hit areas of at least 44 pixels. The contextual format menu alone uses glass. Keyboard names and focus feedback remain available. |
| Loading and result feedback could distract from the image. | Loading follows the finder perimeter. A single 1.4-second depth sweep appears over the finished result, stops on interaction and respects reduced motion. It never enters exported pixels. |
| Archive thumbnails could represent the input rather than the finished expression. | Archive previews preserve the processed image, crop and recipe. Edits made while the first archive write is pending are queued for saving. Originals remain in the editable master. |

The hold menu follows Apple's [context-menu guidance](https://developer.apple.com/design/human-interface-guidelines/context-menus). Gesture alternatives remain available through icons and keyboard controls, consistent with the [gesture guidance](https://developer.apple.com/design/human-interface-guidelines/gestures). Browser implementation does not make this a native UIKit interface.

## Stereo quality review

The normal processed view now attempts measured stereo disparity before estimated depth. Invalid matches remain invalid through normalization, rendering and archive storage. The 3D renderer counts valid samples before reducing density, preserving detail that the previous whole-frame stride discarded.

The pair protocol starts the peer capture request before capturing locally, then receives the peer JPEG. Pair IDs, camera IDs, JPEG dimensions and bounded lengths are checked before committing the pair. Timing metadata preserves the separate camera clocks and explicitly records that the hardware is not synchronized.

The existing fixed alignment profile did not reliably fit the real pairs examined during this review. A proposed automatic row correction improved one pair but retained large disparity disagreements; it was not promoted to production. The strict acceptance criteria and estimated fallback remain. A fresh stationary scene must be checked after flashing; metric depth requires calibration beyond these changes.

## Verification boundaries

The browser walkthrough uses the actual root and generated device controllers, Chromium touch events and representative WebKit interactions. Camera and depth fixtures isolate the gestures; these checks do not prove physical iPhone behavior. The Windows WebKit harness cannot cover the archive's Blob persistence, which is checked in Chromium and the storage tests.

Evidence is retained under `test-results/`: the integrated gesture reports, pulse checks, full JavaScript and Python test logs, both firmware build logs, full flash backups, independent application readbacks and fresh capture reports. Physical camera capture and calibration are assessed separately from browser layout and simulated input.
