# Entropi · ESP32 og iPhone

Foto frå ESP32-CAM eller telefonen blir til ei djupnebasert 3D-vising på telefonen. Depth Anything V2 Small køyrer lokalt i ein nettlesararbeidar med ONNX Runtime WASM. WebGL viser isotropiske Gaussian-splats av dei synlege flatene. Djupna er estimert frå eitt bilete, i relative einingar.

Kameraet treng ikkje minnekort. 3D blir berre vist; nedlasting gjeld originalfotoet. Ingen kamerabilete blir sende til ein modelltenar.

## Nettapp

[esp32.iverfinne.no](https://esp32.iverfinne.no) brukar telefonkameraet. Første trykk på den svarte flata opnar kameraet; neste trykk tek foto og lagar 3D på telefonen. ESP32-kameraet har den same visinga på si lokale side.

Oppsettet følgjer den opphavlege Entropi-sida: svart heilskjerm, ein liten optisk søkjar og ei éinpiksels framdriftslinje. Fire strekar langs venstre kant vel C64, EGA, CGA eller grøn fosfor; høgre kant vel punktmengda for neste foto. Alt blir rekna lokalt med same djupnemodell. Dobbelttrykk på resultatet gir eit nytt foto. Tilgjengelege kontrollar for retur og lagring av originalfoto blir berre synlege ved tastaturfokus; feil viser eit prøv-igjen-symbol. Ingen bileteveljar eller opplasting er tilgjengeleg. Modell og WASM blir kontrollerte med SHA-256 og mellomlagra i IndexedDB når nettlesaren tillèt det.

## ESP32-CAM

1. Opne [klargjeringa](https://esp32.iverfinne.no/prepare/) i Safari med internett og vent på «Klar».
2. Kople telefonen til det opne Wi-Fi-nettet **ENTROPI** utan passord, og opne **http://192.168.4.1/** i full Safari.
3. Ved første foto: trykk på klargjeringssymbolet. Dei kontrollerte modellfilene blir overførte mellom to vindauge på telefonen og lagra for kameraet si lokale side. Deretter fungerer 3D utan internett.

Safari og Wi-Fi-innloggingsvindauget kan ha skilde lagringsmiljø. Bruk full Safari for både klargjering og kamera. Dersom nettlesardata blir sletta, klargjer telefonen på nytt.

- Søkjar og foto har separate oppløysingar. Foto kan bruke 1600 × 1200 med PSRAM; utan PSRAM blir begge avgrensa til 320 × 240.
- Opptak pausar kameratilgangen, hentar ei fersk ramme og gjenopprettar søkjaren. Innstillingar blir lagra på kameraet.
- Foto blir halde i minnet og kan lagrast på telefonen. Siste foto er tilgjengeleg medan sida er open.
- Wi-Fi og statussida startar uavhengig av sensoren. Kameraet får inntil tre gjenopprettingsforsøk med pause mellom forsøka.

Modell og WASM ligg i telefonen. Kameraet leverer berre JPEG og den vesle visingskoden frå flash. Modelloverføring krev rett vindauge, eksakt opphav og økt-ID; begge filene må ha rett storleik og SHA-256 og kunne lesast tilbake før klargjeringa blir stadfesta. Foto blir ikkje overførte til klargjeringstenesta.

## Bygg og kontroll

Nettappen er statiske filer utan byggjesteg. `pointcloud/` og `vendor/` er felles kjelde for nettappen og firmware; firmwarebyggjet legg den vesle koden inn i flash. Modell og WASM blir haldne utanfor flash.

```powershell
python prepare-models.py
python device/build-ui.py
node --test
arduino-cli compile --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app --build-path device/build device/EntropiCamera
```

ESP32 core **3.3.12**, AI Thinker ESP32-CAM, 4 MB flash, `huge_app`. Ta full backup av eksisterande flash og kontroller rett port før overføring. Backup, genererte headerar, bygg og ferdige firmwarefiler er ignorerte av Git og Vercel.

Automatiske testar dekkjer opptaksflyt, feilhandtering, avbrot, meldingsopphav, djupnegeometri, Gaussian-data, modellintegritet og at berre JPEG kan lastast ned. Ekte modellkøyring og WebGL er kontrollerte i Chromium på PC. Brukaren sitt iPhone-opptak stadfestar søkjar og JPEG-opptak; den nye klargjeringa og 3D utan internett må òg kontrollerast på fysisk iPhone/Safari.

Søkjar og djupneprojeksjon er tilpassa [entropi.iverfinne.no](https://github.com/lukketsvane/entropi.iverfinne.no), commit `4f2aa4ce11349350d4b924e2a876655f0502f65b`. Modellrevisjon, storleik og kontrollsummar ligg i `pointcloud/models/manifest.json`. Modell- og runtime-lisensar følgjer filene. Espressif-lisensen er bevart i firmware.
