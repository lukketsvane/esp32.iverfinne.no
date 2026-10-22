# Entropi · ESP32 og iPhone

Foto frå ESP32-CAM eller telefonen blir viste i svart-kvitt. Høgresida har to val: foto øvst og splats nedst. Foto er standard og krev ingen djupnemodell. Splats blir rekna lokalt med Depth Anything V2 Small og ONNX Runtime WASM. WebGL viser dei synlege flatene med isotropiske Gaussian-splats; djupna er estimert frå eitt bilete i relative einingar.

Kameraet treng ikkje minnekort. 3D blir berre vist; nedlasting gjeld originalfotoet. Ingen kamerabilete blir sende til ein modelltenar.

## Nettapp

[esp32.iverfinne.no](https://esp32.iverfinne.no) brukar telefonkameraet. Første trykk opnar kameraet; neste trykk tek foto. Dei to vala på høgresida viser same opptak som svart-kvitt foto eller splats. Ei ferdig 3D-vising blir bevart når du byter att og fram. ESP32-kameraet har den same flyten på si lokale side.

Oppsettet følgjer den opphavlege Entropi-sida: svart heilskjerm, ein liten optisk søkjar og ei éinpiksels framdriftslinje. Søkjaren viser heile kameraramma i rett format. To trykkbare hakk på høgresida vel foto eller splats; fire hakk på venstresida vel C64, EGA, CGA eller grøn fosfor når splats er valt. Små ikon gir nytt foto, lagring og utskrift. Dobbelttrykk og langt trykk fungerer òg. Siste foto og scena blir bevarte når du går tilbake til kameraet; miniatyren opnar dei igjen utan ny berekning. Ingen bileteveljar eller opplasting er tilgjengeleg. Modell og WASM blir kontrollerte med SHA-256 og mellomlagra i IndexedDB når nettlesaren tillèt det.

Nettappen kan leggjast til på heimskjermen med same søkjarikon som favikonet. Han opnar utan nettlesarramme og held på fotoet ved mellombels bakgrunn og tilbakekomst. Appskalet blir mellomlagra for bruk utan internett; splats krev at modellfilene finst i den aktuelle appen si nettlesarlagring. På iPhone kan denne lagringa vere skild frå vanleg Safari. Wi-Fi-symbolet opnar tilkoplinga for ESP32-kameraet utan automatisk modellnedlasting. På nett utan internett brukar appen det lagra skalet innan 1,5 sekund dersom nettførespurnaden blir hengande.

I 3D-visinga roterer éin finger resultatet; to fingrar flyttar og zoomar. Tre fingrar opp viser fleire punkt, ned færre; mot høgre blir punkta skarpare, mot venstre mjukare. Retninga blir låst etter ei lita startrørsle. Justeringa skjer direkte i visinga utan ny modellkøyring.

Trykk på printarsymbolet, eller hald inne resultatet i eit halvt sekund og slepp, for å skrive ut fotoet eller den aktuelle 3D-visinga på **Luxorp.PX10-DAAF**. Nettappen brukar Bluetooth direkte i ein nettlesar med Web Bluetooth. Den lokale kamerasida opnar ei trygg utskriftsside på telefonen; trykk på printarsymbolet for å velje printaren. Sidan og utskriftskoden blir lagra under klargjeringa, og biletet går berre mellom fanene på telefonen. Utskrifta er 384 punkt brei med svart mønster på kvitt papir. På iPhone må nettlesaren ha Web Bluetooth-støtte.

## ESP32-CAM

1. Skann den trykte QR-koden. [Klargjeringa](https://esp32.iverfinne.no/prepare/) lastar og kontrollerer modellane automatisk. Tidlegare lagra modellar blir brukte om igjen. Foto kan opnast utan å vente på 3D.
2. Når telefonen er klar, hald inne Wi-Fi-koden på sida og vel å kople til **ENTROPI**. Nettet er ope og fungerer utan internett. Wi-Fi-innstillingane er eit alternativ under hjelp.
3. Trykk **Opne kameraet**. Foto er tilgjengeleg straks kameraet svarar. Vel splats for lokal modelloverføring til kamerasida. På iPhone kan Safari vise tilkoplingshandlingar ved [langt trykk på eit QR-bilete](https://developer.apple.com/videos/play/tech-talks/206/); den konkrete systemdialogen må kontrollerast på telefonen.

Tilkoplinga krev inga PWA-installering. Den trykte QR-adressa er uendra. Direkte **http://192.168.4.1/** fungerer for foto utan klargjering.

Klargjeringssida held på modellane ved tilkoplingsfeil og prøver igjen i same kamerafane. «Tilbake til kameraet» beheld fotoet som er ope. Kameraet brukar vanleg lokal HTTP utan DNS- eller portalomdirigering. Manglande modellar utløyser klargjering berre når du vel splats; foto fungerer vidare. Dersom nettlesardata blir sletta, klargjer telefonen på nytt for splats.

- Søkjar og foto har separate oppløysingar. Foto kan bruke 1600 × 1200 med PSRAM; utan PSRAM blir begge avgrensa til 320 × 240.
- Opptak pausar kameratilgangen, hentar ei fersk ramme og gjenopprettar søkjaren. Innstillingar blir lagra på kameraet.
- Foto blir halde i minnet og kan lagrast på telefonen. Siste foto er tilgjengeleg medan sida er open.
- Wi-Fi og statussida startar uavhengig av sensoren. Kameraet får inntil tre gjenopprettingsforsøk med pause mellom forsøka.

Modell og WASM ligg i telefonen. Kameraet leverer berre JPEG og den vesle visingskoden frå flash. Avbrot under opptak kan ikkje opne eit forelda resultat; ferdige eller pågåande splats blir bevarte for siste foto. Modelloverføring krev rett vindauge, eksakt opphav og økt-ID; begge filene må ha rett storleik og SHA-256 og kunne lesast tilbake før klargjeringa blir stadfesta. Foto blir ikkje overførte til klargjeringstenesta.

## Bygg og kontroll

Nettappen er statiske filer utan byggjesteg. `pointcloud/` og `vendor/` er felles kjelde for nettappen og firmware; firmwarebyggjet legg den vesle koden inn i flash. Modell og WASM blir haldne utanfor flash.

Ved endring av appskalet må cacheversjonen i `sw.js` aukast; klargjeringa har ei eiga cacheversjon i `prepare/sw.js`. Dette held den mellomlagra offline-versjonen samla ved oppdatering.

```powershell
python prepare-models.py
python device/build-ui.py
node --test
arduino-cli compile --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app --build-path device/build device/EntropiCamera
```

ESP32 core **3.3.12**, AI Thinker ESP32-CAM, 4 MB flash, `huge_app`. Ta full backup av eksisterande flash og kontroller rett port før overføring. Backup, genererte headerar, bygg og ferdige firmwarefiler er ignorerte av Git og Vercel.

Automatiske testar dekkjer opptaksflyt, feilhandtering, avbrot, meldingsopphav, djupnegeometri, Gaussian-data, modellintegritet og at berre JPEG kan lastast ned. Ekte modellkøyring og WebGL er kontrollerte i Chromium på PC. Brukaren sitt iPhone-opptak stadfestar søkjar og JPEG-opptak; den nye klargjeringa og 3D utan internett må òg kontrollerast på fysisk iPhone/Safari.

Søkjar og djupneprojeksjon er tilpassa [entropi.iverfinne.no](https://github.com/lukketsvane/entropi.iverfinne.no), commit `4f2aa4ce11349350d4b924e2a876655f0502f65b`. Modellrevisjon, storleik og kontrollsummar ligg i `pointcloud/models/manifest.json`. Modell- og runtime-lisensar følgjer filene. Espressif-lisensen er bevart i firmware.
