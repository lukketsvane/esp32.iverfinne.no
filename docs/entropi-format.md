# Entropi numerical master, versions 1 and 2

An `.entropi` file is a standard ZIP archive with a UTF-8 `manifest.json`. Its MIME type is `application/x-entropi`. This browser profile is named `numerical-float32`; it does not claim compatibility with the earlier experimental OpenEXR specimen.

| Member | Contents |
| --- | --- |
| `manifest.json` | Format/version/profile, identity, creation time, source references, numerical metadata, recipe, geometry, capture metadata and member integrity |
| `sources/left` | Unmodified original image bytes; MIME type recorded in the manifest |
| `sources/right` | Optional second original image, preserved independently |
| `data/depth.f32` | Row-major IEEE 754 float32 values, little-endian, before display normalization and tone mapping |
| `data/validity.u8` | One byte per sample: 1 means usable, 0 means invalid; finite values may also be invalid |
| `data/confidence.f32` | Optional source-defined confidence in [0,1], stored separately from validity |
| `preview/image` | Optional rendered preview, with its MIME type recorded |

`manifest.format` is `entropi` and `profile` is `numerical-float32`. The writer uses `version: 2` when the recipe contains active photo edits and `version: 1` otherwise. Version 2 requires `recipe.edits`; readers limited to version 1 reject it instead of silently dropping edits. Both versions use the same archive members. Every non-manifest member has its byte length, type and SHA-256 digest under `files`. ZIP CRC32 also protects each member. These checks detect corruption; they are not signatures or proof of authorship.

The numerical `result` records width, height, model, source, polarity and whether the source supplied normalized values. `quantity` and `units` must agree: `relative-depth`/`relative`, `disparity`/`px`, `depth`/`m`, or `display-intensity`/`intensity`. Metric depth requires explicit calibration metadata. Current monocular model output is relative depth, not metres or sensor RAW. Float32 packaging does not improve capture accuracy.

`recipe` stores VATHOgraphy's preset index (0–4), position (−1 to 1), and width (0.25–3). Editing it never changes numerical samples or original images. `id` and `created` remain unchanged when the document is reopened and resaved. Unknown calibration and exposure timestamps are `null`; capture synchronization defaults to `false`.

Version 2 adds `recipe.edits`: exposure in EV (−3 to 3), contrast (−1 to 1), sharpen and denoise (0–1), a photo preset (`null`, `A4`, `A5`, `B1`, `B5`, `C1`, `F2`, `G3`, `M3`, `P5`, or `X1`), strength (0–1), and a normalized crop `{x,y,width,height}`. Crop dimensions must be positive and its bounds must stay within the original image. Missing fields use neutral defaults: zero adjustments, no preset, strength 1, and the full image. Neutral edits are omitted when writing. Rendering applies photo edits after the depth tone curve, then outputs the crop; the complete originals, depth, validity and confidence remain available for later editing. Preset curves are VSCO-inspired approximations.

The writer uses ZIP DEFLATE when the browser supports it and the compressed member is smaller. Otherwise it writes uncompressed ZIP members. SHA-256 has a local fallback for the ESP32's HTTP page. The reader supports these two methods, bounds both input and total expanded data to 128 MiB, limits image blobs to 32 MiB each and numerical fields to 16,777,216 samples, and rejects malformed, overlapping, duplicated or unsafe entries and unknown format versions.

`createEntropiDocument` copies numerical buffers and validates metadata. `encodeEntropiDocument` returns a Blob. `decodeEntropiDocument` checks integrity and returns the original document shape, ready to render again without another inference pass.

The document tests cover both versions, exact float32 bit and original-byte preservation, identity, reversible crop and rejection of malformed edits. The rendered-export tests cover all ten photo presets, crop dimensions, transparency and 16-bit gray/RGBA TIFF channels. `tests/rendered-export-browser.py` compares module and generated firmware output through independent TIFF decoding in Chromium and WebKit.
