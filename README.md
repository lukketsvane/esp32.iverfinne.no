# Entropi · ESP32 og iPhone

Foto frå ESP32-CAM eller telefonen blir til ei djupnebasert 3D-vising på telefonen. Depth Anything V2 Small køyrer lokalt i ein nettlesararbeidar med ONNX Runtime WASM. WebGL viser isotropiske Gaussian-splats av dei synlege flatene. Djupna er estimert frå eitt bilete, i relative einingar.

3D blir berre vist. Nedlasting gjeld originalfotoet. Ingen kamerabilete blir sende til ein modelltenar.

## Nettapp

[esp32.iverfinne.no](https://esp32.iverfinne.no) brukar berre telefonkameraet eller eit kamerafoto frå ESP32. Første trykk på den svarte flata opnar kameraet; neste trykk tek foto og lagar 3D på telefonen. Kameraet si lokale side kan opne nettappen og overføre fotoet direkte mellom dei to nettlesarvindauga. Meldinga blir kontrollert mot avsendarvindauge og opphav; biletet går ikkje gjennom Vercel.

Oppsettet følgjer den opphavlege Entropi-sida: svart heilskjerm, ein liten optisk søkjar og ei éinpiksels framdriftslinje. Dobbelttrykk på resultatet gir eit nytt foto. Tilgjengelege kontrollar for retur og lagring av originalfoto blir berre synlege ved tastaturfokus; feil viser eit prøv-igjen-symbol. Ingen bileteveljar eller opplasting er tilgjengeleg. Modell og WASM blir kontrollerte med SHA-256 og mellomlagra i IndexedDB når nettlesaren tillèt det.

## ESP32-CAM

Kople telefonen til **ENTROPI**, passord **entropi2026**, og opne **http://192.168.4.1/** i Safari.

- Søkjar og foto har separate oppløysingar. Foto kan bruke 1600 × 1200 med PSRAM; utan PSRAM blir begge avgrensa til 320 × 240.
- Opptak pausar kameratilgangen, hentar ei fersk ramme og gjenopprettar søkjaren. Innstillingar blir lagra på kameraet.
- JPEG blir lagra på microSD når skriving og kontroll lykkast. Ved lagringsfeil kan fotoet framleis lastast ned til telefonen.
- Galleriet viser lagra JPEG etter omlasting og omstart. Berre validerte filnamn kan hentast.
- Wi-Fi og statussida startar uavhengig av sensoren. Kameraet får inntil tre gjenopprettingsforsøk med pause mellom forsøka.

For lokal 3D utan internett: kopier heile `pointcloud/` til rota på eit FAT-formatert microSD-kort. Kameraet brukar SD i éinbitsmodus og formaterer aldri kortet. Dei store filene er om lag 40 MB; dei blir sende til telefonen og køyrde der. Utan kort kan telefonen hente og mellomlagre dei med internett.

## Bygg og kontroll

Nettappen er statiske filer utan byggjesteg. `pointcloud/` og `vendor/` er felles kjelde for nettappen og firmware; firmwarebyggjet legg den vesle koden inn i flash. Modell og WASM blir haldne utanfor flash.

```powershell
python prepare-models.py
python device/build-ui.py
node --test device/tests/ui.test.mjs tests/app.test.mjs tests/scene.test.mjs
arduino-cli compile --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app --build-path device/build device/EntropiCamera
```

ESP32 core **3.3.12**, AI Thinker ESP32-CAM, 4 MB flash, `huge_app`. Ta full backup av eksisterande flash og kontroller rett port før overføring. Backup, genererte headerar, bygg og ferdige firmwarefiler er ignorerte av Git og Vercel.

Automatiske testar dekkjer opptaksflyt, galleri, feilhandtering, avbrot, meldingsopphav, djupnegeometri, Gaussian-data, modellintegritet og at berre JPEG kan lastast ned. Ekte modellkøyring og WebGL er kontrollerte i Chromium på PC. Fysisk iPhone/Safari, sensor, SD-lagring og Wi-Fi-portal må kontrollerast på maskinvara.

Søkjar og djupneprojeksjon er tilpassa [entropi.iverfinne.no](https://github.com/lukketsvane/entropi.iverfinne.no), commit `4f2aa4ce11349350d4b924e2a876655f0502f65b`. Modellrevisjon, storleik og kontrollsummar ligg i `pointcloud/models/manifest.json`. Modell- og runtime-lisensar følgjer filene. Espressif-lisensen er bevart i firmware.
