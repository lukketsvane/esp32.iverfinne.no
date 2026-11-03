# ENTROPI Stereo Control · rasterverkstad 2.0

Fungerande statisk webapp for lokal etterbehandling av bilete frå to ESP32-CAM-kamera, med stereo-loop, dokumentert firmware-adapter, PWA-cache, fire-kolonne-galleri og dither-eksport. Ingen pakkeinstallasjon, konto eller sky-API trengst.

## Opne

Start ein lokal statisk server i denne mappa, til dømes `python -m http.server 8765`, og opne `http://localhost:8765`. Alternativt kan heile mappa leggjast på ein statisk HTTPS-vert. `file://` kan blokkere modul-arbeidaren på somme nettlesarar. Ein ZIP med heile mappa er nok til å installere på eigen vert.

## 19 rastermetodar

Ingen, posterisering, Bayer 2×2/4×4/8×8/16×16, tilfeldig støy, interleaved gradientstøy, halvtonar, rasterlinjer, krysskravur, Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra, Sierra 2-raders og Sierra Lite. 16 innebygde palettar + eigendefinert HEX-palett. 12 uttrykkspresets. Parametrar: rasterstyrke, blokkstorleik, terskel, feildiffusjonsgrad, serpentin, fargeinversjon og støyfrø. Farge: eksponering, kontrast, metning, varme, toning, skuggar, høglys, fade, korn, vignett og skarpleik.

Raster og farge blir rekna i ein `Worker`. Ved rask dragging blir gamle ventande førehandsvisingar hoppa over. Bileta går ikkje til ein modelltenar. GIF blir lagd som ekte GIF89a med palettindeksering og LZW i same arbeidaren. Testar for koden kan køyrast med `node --test tests/*.test.mjs`.

## Reell firmware, ikkje oppdikta API

Adapteren `Entropi firmware` er basert på `lukketsvane/esp32.iverfinne.no`, `device/EntropiCamera/app_httpd.cpp`:

- `GET /status`: `{camera_ready,stream_ready,last_error,recovering,recovery_attempts,psram,framesize,photo_framesize,brightness,storage}`.
- `GET /control?var=photo_framesize&val=6|10|15`: 320×240, 640×480 eller 1600×1200. Berre 320×240 er lov utan PSRAM. Oppløysinga kan ikkje endrast dersom sensoren ikkje er initialisert.
- `GET /capture`: JPEG som binærblob, ikkje JSON. Kan gi HTTP 503 når kamera ikkje er klart.

`0x106` er rapportert som sensor-/probe-problem ved oppstart. Redusert oppløysing løyser vanlegvis ikkje ein sensor som ikkje initialiserer. For kamera 2 bør me først kontrollere kameraflatkabel, pin-layout, straumforsyning og sensorstøtte.

**Nettverksgrenser:** `https://esp32.iverfinne.no` kan ikkje utan vidare kalle eit `http://192.168.4.1`-kamera. HTTPS mixed content, CORS og ESP32 sin separate access point gjer at begge kamera treng ein samanhengande, lovleg tilkoplingsveg (same-origin proxy, firmware-hosting eller gjennomført opplasting/bridge). I standardfirmwaren er ESP32 sitt lokalnett `ENTROPI`, og det er ikkje to uavhengige kamera-API på same adresse. Appen påstår aldri at dei er tilkopla utan ekte svar.

## Galleri og eksport

Last inn eit eller fleire bilete; første to blir opna i kameravisarane, alle blir lagra i IndexedDB med 320×320-thumbnail. Fire kvadratiske ruter per rad, inkludert smale mobilskjermar, og høgst 36 nye thumbnails per «Vis fleire». Last eit biletet tilbake til kamera 1 eller kamera 2 via eksplisitt val, ikkje blokkerande modal. PNG og WebP blir eksporterte frå behandla 960×540-ramme. GIF-eksport: 8, 12, 20 eller 24 rammer; 320/480/640 px breidd; vald loop-modus og dither følgjer kvar ramme. Animasjonskontrollane og dither/kamerajusteringa har ulik tilstand.

## Produksjonsplassering

For den eksisterande statiske nettstaden kan mappa leggjast under `control/` i webroten, slik at kontrollpanelet ligg på `https://esp32.iverfinne.no/control/`. Dette erstattar ikkje den eksisterande fotoflyt-/3D-visaren på hovudsida eller kamera-firmwaren.

The GitHub preview deploy omits bundled PNG icons and demo JPEG. The demo button generates its own image locally and the PWA manifest uses the SVG icon. The downloadable ZIP also has PNG icons and a JPEG fixture.
