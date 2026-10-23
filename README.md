# Entropi · ESP32 og iPhone

Foto frå ESP32-CAM eller telefonen blir viste i svart-kvitt. Høgresida har to val: foto øvst og splats nedst. Foto er standard og krev ingen djupnemodell. Splats blir rekna lokalt med Depth Anything V2 Small og ONNX Runtime WASM. WebGL viser dei synlege flatene med isotropiske Gaussian-splats; djupna er estimert frå eitt bilete i relative einingar.

Kameraet treng ikkje minnekort. Lagring gir eit vanleg PNG-bilete av den synlege foto- eller splatvisinga; ingen 3D-fil blir eksportert. Ingen kamerabilete blir sende til ein modelltenar.

## Nettapp

[esp32.iverfinne.no](https://esp32.iverfinne.no) brukar telefonkameraet. Første trykk opnar kameraet; neste trykk tek foto. Dei to vala på høgresida viser same opptak som svart-kvitt foto eller splats. Ei ferdig 3D-vising blir bevart når du byter att og fram. ESP32-kameraet har den same flyten på si lokale side.

Oppsettet følgjer den opphavlege Entropi-sida: svart heilskjerm, ein liten optisk søkjar og ei éinpiksels framdriftslinje. Søkjaren har fast 2:3-format, sentrert utsnitt og same optiske form som Entropi, med dithering direkte i kamerabiletet. Opptaket brukar same sentrerte utsnitt og optiske form som søkjaren, i full oppløysing. Svartkvitt-vising, lagring og utskrift brukar dette innramma fotoet; djupneberekninga får fargeversjonen utan dithering. Bayer er standard; stilvala og tre fingrar justerer same svartkvittbehandling før og etter opptaket. To trykkbare hakk på høgresida vel foto eller splats; fire hakk på venstresida vel gråtonar, Bayer, Floyd–Steinberg eller Atkinson for foto; splats har eigne C64-, EGA-, CGA- og fosforstilar. Små ikon gir nytt foto, lagring og utskrift. Dobbelttrykk og langt trykk fungerer òg. Siste foto og scena blir bevarte når du går tilbake til kameraet; miniatyren opnar dei igjen utan ny berekning. Foto held fast storleik utan zoom eller panorering; tre fingrar opp/ned justerer finare/grovare korn, og venstre/høgre justerer kontrasten. Sentreringsikonet stiller 3D-visinga tilbake til den opphavlege kameravinkelen. Foto og splats hugsar kvar sine stilval, og lagring/utskrift brukar same prosesserte bilete som visinga. Knappane er berre SVG utan bakgrunn eller ramme. Lagring bevarer svartkvittbehandling og vald splatstil. På trygg HTTPS brukar støtta nettlesarar delingsarket; på lokal HTTP blir PNG-biletet opna i ei rein lagringsvising med native biletmeny ved langt trykk. Kameraet har ikkje noko innstillingspanel; eit opptak som feilar viser eit prøv-igjen-ikon. Ingen bileteveljar eller opplasting er tilgjengeleg. Modell og WASM blir kontrollerte med SHA-256 og mellomlagra i IndexedDB når nettlesaren tillèt det.

Nettappen kan leggjast til på heimskjermen med same søkjarikon som favikonet. Han opnar utan nettlesarramme og held på fotoet ved mellombels bakgrunn og tilbakekomst. 3D-motoren blir gjenbrukt mellom opptak og frigitt etter 30 sekund utan arbeid eller når ein inaktiv motor går i bakgrunnen. Tap av grafikkonteksten byggjer opp att visinga frå ferdige punktdata. Appskalet blir mellomlagra for bruk utan internett; splats krev at modellfilene finst i den aktuelle appen si nettlesarlagring. På iPhone kan denne lagringa vere skild frå vanleg Safari. Wi-Fi-symbolet opnar tilkoplinga for ESP32-kameraet utan automatisk modellnedlasting. På nett utan internett brukar appen det lagra skalet innan 1,5 sekund dersom nettførespurnaden blir hengande.

Mellom opptak og ferdige splats er flata svart med ei tynn framdriftslinje; kjeldefotoet blir ikkje vist. Nye splats byrjar med nokre få punkt og blir gradvis tettare over om lag fire sekund, utan lastetekst. Redusert rørsle hoppar over innfasinga; lagring og utskrift fullfører henne før biletet blir teke ut.

I 3D-visinga roterer éin finger resultatet; to fingrar flyttar og zoomar. Tre fingrar opp viser fleire punkt, ned færre; mot høgre blir punkta skarpare, mot venstre mjukare. Retninga blir låst etter ei lita startrørsle. Justeringa skjer direkte i visinga utan ny modellkøyring.

Trykk på printarsymbolet, eller hald inne resultatet i eit halvt sekund og slepp, for å skrive ut det synlege fotoutsnittet eller den aktuelle 3D-visinga på **Luxorp.PX10-DAAF**. Den lokale kamerasida sender den ferdigkoda jobben til ESP32-en på same side. Kameraet finn og koplar til skrivaren med Bluetooth; inga ekstrafane eller Bluetooth-utviding på telefonen er nødvendig for denne flyten. Når heile jobben er motteken, eig kameraet sendinga vidare sjølv om telefonen forlèt sida. Éin jobb blir send om gongen og blir halden i minnet utan minnekort. Kameraførehandsvisinga pausar under sendinga for å gi radioen arbeidsrom.

Den offentlege nettappen brukar framleis Bluetooth direkte i ein nettlesar med Web Bluetooth. På iPhone krev denne nettlesartransporten ei støtta utviding. Den eldre HTTPS-hjelparen finst vidare for eldre kameraversjonar. Han får korte, automatiske nye forsøk ved ei uttrykkeleg avvising, og held på same utskriftsøkt ved eit kort bakgrunnsopphald dersom nettlesaren og tilkoplinga tillèt det.

Utskrifta er 384 punkt brei med svart mønster på kvitt papir. Begge transportane brukar den største pakkestorleiken tilkoplinga rapporterer, opptil 512 byte, med 20 byte som fallback. Ei fastlåst bufferpause får etter fem sekund ein liten prøvepakke av dei neste usende dataa, opptil tre gonger per jobb. Ein ny pause frå skrivaren blir respektert. Jobb-ID og sekvens hindrar automatisk omspeling av ein motteken jobb; ei uviss kvittering blir følgd opp med statusoppslag, ikkje ny opplasting. Ei broten tilkopling avsluttar ein delvis send jobb. Eit nytt trykk etter feil er eit uttrykkeleg nytt forsøk og kan gi ei ny utskrift. Statusen stadfestar overføringa til skrivaren, ikkje fysisk papirresultat.

## ESP32-CAM

1. Skann den trykte QR-koden. [Klargjeringa](https://esp32.iverfinne.no/start/) lastar og kontrollerer modellane automatisk. Tidlegare lagra modellar blir brukte om igjen. Foto kan opnast utan å vente på 3D.
2. Når telefonen er klar, hald inne Wi-Fi-koden på sida og vel å kople til **ENTROPI**. Nettet er ope og fungerer utan internett. Wi-Fi-innstillingane er eit alternativ under hjelp.
3. Trykk **Opne kameraet**. Foto er tilgjengeleg straks kameraet svarar. Vel splats for lokal modelloverføring til kamerasida. På iPhone kan Safari vise tilkoplingshandlingar ved [langt trykk på eit QR-bilete](https://developer.apple.com/videos/play/tech-talks/206/); den konkrete systemdialogen må kontrollerast på telefonen.

Tilkoplinga krev inga PWA-installering. Den nye trykkfila peikar til `/start/`, som går utanom gamle klargjeringssider i mellomlageret. `/prepare/` fungerer vidare for eksisterande kodar og lokale overføringar. Direkte **http://192.168.4.1/** fungerer for foto utan klargjering.

Klargjeringssida held på modellane ved tilkoplingsfeil og prøver igjen i same kamerafane. Avbroten klargjering held fram ved historikkretur. Lasting utan framdrift i 30 sekund gir nytt forsøk. Trygge oppdateringar ventar medan kamera, overføring eller lasting er i bruk. «Tilbake til kameraet» beheld fotoet som er ope. Kameraet brukar vanleg lokal HTTP utan DNS- eller portalomdirigering. Manglande modellar utløyser klargjering berre når du vel splats; foto fungerer vidare. Dersom nettlesardata blir sletta, klargjer telefonen på nytt for splats.

- Søkjar og foto har separate oppløysingar. Foto kan bruke 1600 × 1200 med PSRAM; utan PSRAM blir begge avgrensa til 320 × 240.
- Opptak pausar kameratilgangen, hentar ei fersk ramme og gjenopprettar søkjaren. JPEG-formatet blir kontrollert frå sjølve JPEG-headeren ved byte av oppløysing. Sensor- og nettverksinnstillingar blir bevarte på kameraet.
- Foto blir halde i minnet og kan lagrast på telefonen. Siste foto er tilgjengeleg medan sida er open.
- Wi-Fi og statussida startar uavhengig av sensoren. Kameraet får inntil tre gjenopprettingsforsøk med pause mellom forsøka.

Modell og WASM ligg i telefonen. Kameraet leverer berre JPEG og den vesle visingskoden frå flash. Avbrot under opptak kan ikkje opne eit forelda resultat; ferdige eller pågåande splats blir bevarte for siste foto. Modelloverføring krev rett vindauge, eksakt opphav og økt-ID; begge filene må ha rett storleik og SHA-256 og kunne lesast tilbake før klargjeringa blir stadfesta. Foto blir ikkje overførte til klargjeringstenesta.

## Bygg og kontroll

Nettappen er statiske filer utan byggjesteg. `pointcloud/` og `vendor/` er felles kjelde for nettappen og firmware; firmwarebyggjet legg den vesle koden inn i flash. Modell og WASM blir haldne utanfor flash.

Ved endring av appskalet må cacheversjonen i `sw.js` aukast; klargjeringa har eigne cachefamiliar for `/prepare/` og `/start/` i `prepare/sw.js`. Dette held den mellomlagra offline-versjonen samla ved oppdatering.

```powershell
python prepare-models.py
python device/build-ui.py
node --test
arduino-cli compile --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app --build-path device/build device/EntropiCamera
```

ESP32 core **3.3.12**, AI Thinker ESP32-CAM, 4 MB flash, `huge_app`. Ta full backup av eksisterande flash og kontroller rett port før overføring. Backup, genererte headerar, bygg og ferdige firmwarefiler er ignorerte av Git og Vercel.

Automatiske testar dekkjer opptaksflyt, feilhandtering, avbrot, meldingsopphav, djupnegeometri, Gaussian-data, modellintegritet og at lagring gir same svartkvitt, utsnitt eller splatstil som visinga. GitHub Actions køyrer testane ved push og pull request; Linux-byggjemiljøet køyrer òg den native C++-testen av JPEG-parseren. Lokalt blir denne testen eksplisitt hoppa over dersom ein C++-vertskompilator manglar. Ekte modellkøyring og WebGL er kontrollerte i Chromium på PC. Brukaren sitt iPhone-opptak stadfestar søkjar og JPEG-opptak; den nye klargjeringa og 3D utan internett må òg kontrollerast på fysisk iPhone/Safari.

Søkjar og djupneprojeksjon er tilpassa [entropi.iverfinne.no](https://github.com/lukketsvane/entropi.iverfinne.no), commit `4f2aa4ce11349350d4b924e2a876655f0502f65b`. Modellrevisjon, storleik og kontrollsummar ligg i `pointcloud/models/manifest.json`. Modell- og runtime-lisensar følgjer filene. Espressif-lisensen er bevart i firmware.
