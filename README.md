# Entropi · ESP32 og iPhone

## Ufråvikelege UI-reglar

Den aktive kameraflata skal vere heilt svart utan dekorative titlar, statussetningar, kameranummer eller forklaringstekst. Bruk éin liten optisk søkjar ståande og to reine søkjarar ved stereo i liggjande format. Knappar har anten berre ikon eller berre tekst, aldri begge; ikonknappar får namn gjennom `aria-label`. Informasjon og innstillingar høyrer til eigne modale visingar, ikkje utanpå kameraet. VATHOgraphy er den einaste synlege biletflyten; ikkje vis gamle modusikon eller manuell kalibrering. Kontroller begge mobilretningane etter kvar UI-endring.

VATHOgraphy brukar relativ djupn til å lage svartkvite bilete. Søkjaren viser gråtonar, og siste ramme blir ståande gjennom opptak og berekning. Eit stereopar blir først prøvd mot den faste riggprofilen. Berre sikre samsvar blir brukte som målt disparitet; manglande samsvar blir ikkje fylt med oppdikta flater. Når paret blir avvist, kan Depth Anything V2 Small gi eit tydeleg kjeldemerkt estimat. Ingen av desse flytane gir metrisk djupn utan kalibrering.

Kameraet treng ikkje minnekort. Lagring tilbyr 16-bits TIFF og PNG av den framkalla kunsten, ei redigerbar `.entropi`-fil og eksperimentell DNG av dei numeriske verdiane. Standardflyten behandlar foto på telefonen eller den lokale PC-en.

## Nettapp

[esp32.iverfinne.no](https://esp32.iverfinne.no) brukar telefonkameraet. Første trykk opnar kameraet; neste trykk tek foto. ESP32-kameraet har den same VATHOgraphy-flyten på si lokale side.

Normal vising har ein liten optisk søkjar, diskrete ikon og ei éinpiksels framdriftslinje. Siste ramme frys ved opptak og blir erstatta når djupnebiletet er klart. Kameravising, fotoarkiv og lagringsvising er utan synleg tekst. Status- og feilmeldingar er tilgjengelege for skjermlesar; feil gir eit ikon for nytt forsøk. Galleriet ligg oppe til høgre både i søkjaren og i resultatvisinga. Når galleriet blir opna frå eit resultat og lukka igjen, kjem ein tilbake til same bilete. Lagring og utskrift brukar den synlege kunsten; stereopar blir ikkje eksporterte side om side. Originalane, rå flyttalsdjupn og uttrykksval blir bevarte saman i arkivet. Importknappen i arkivet opnar `.entropi`; framkallingsknappen opnar lagra verdiar utan ny modellkøyring.

Eit kort trykk på lagring lastar ned 16-bits TIFF når biletet har eit samsvarande Entropi-dokument; originalfoto og separate førehandsvisingar brukar biletformatet sitt. Andre format brukar den same nedlastingsflyten, utan ei eiga lagringsvising. Modell og WASM blir kontrollerte med SHA-256 og mellomlagra i IndexedDB. Kalibrering har ingen synlege kontrollar.

Nettappen og den lokale kamerasida kan leggjast til på heimskjermen med same søkjarikon. Firmware leverer eit eige 180 × 180 PNG-ikon på `/apple-touch-icon.png`, utan internett. Han opnar utan nettlesarramme og held på fotoet ved mellombels bakgrunn og tilbakekomst. 3D-motoren blir gjenbrukt mellom opptak og frigitt etter 30 sekund utan arbeid eller når ein inaktiv motor går i bakgrunnen. Tap av grafikkonteksten byggjer opp att visinga frå ferdige punktdata. Appskalet blir mellomlagra for bruk utan internett; splats krev at modellfilene finst i den aktuelle appen si nettlesarlagring. På iPhone kan denne lagringa vere skild frå vanleg Safari. Wi-Fi-symbolet opnar tilkoplinga for ESP32-kameraet utan automatisk modellnedlasting. På nett utan internett brukar appen det lagra skalet innan 1,5 sekund dersom nettførespurnaden blir hengande.

Under berekning står søkjarramma urørt med framdriftslinja. Ei avbroten berekning bevarer biletet og gir nytt forsøk utan nytt opptak. Fem stille val styrer uttrykket; éin finger flyttar djupneområdet vassrett, og kniping med tre fingrar endrar breidda. To fingrar flyttar biletet i alle retningar og zoomar frå 1× til 8×. Val og kunstnariske justeringar blir bevarte mellom opptak.

Trykk på printarsymbolet for å skrive ut det synlege biletet på **Luxorp.PX10-DAAF**. Hald inne resultatet for å sjå originalfotoet; dette startar aldri utskrift. Den lokale kamerasida sender den ferdigkoda jobben til ESP32-en på same side. Kameraet finn og koplar til skrivaren med Bluetooth; inga ekstrafane eller Bluetooth-utviding på telefonen er nødvendig for denne flyten. Når heile jobben er motteken, eig kameraet sendinga vidare sjølv om telefonen forlèt sida. Éin jobb blir send om gongen og blir halden i minnet utan minnekort. Kameraførehandsvisinga pausar under sendinga for å gi radioen arbeidsrom.

Den offentlege nettappen brukar framleis Bluetooth direkte i ein nettlesar med Web Bluetooth. På iPhone krev denne nettlesartransporten ei støtta utviding. Den eldre HTTPS-hjelparen finst vidare for eldre kameraversjonar. Han får korte, automatiske nye forsøk ved ei uttrykkeleg avvising, og held på same utskriftsøkt ved eit kort bakgrunnsopphald dersom nettlesaren og tilkoplinga tillèt det.

Utskrifta er 384 punkt brei med svart mønster på kvitt papir. Begge transportane brukar den største pakkestorleiken tilkoplinga rapporterer, opptil 512 byte, med 20 byte som fallback. Ei fastlåst bufferpause får etter fem sekund ein liten prøvepakke av dei neste usende dataa, opptil tre gonger per jobb. Ein ny pause frå skrivaren blir respektert. Jobb-ID og sekvens hindrar automatisk omspeling av ein motteken jobb; ei uviss kvittering blir følgd opp med statusoppslag, ikkje ny opplasting. Ei broten tilkopling avsluttar ein delvis send jobb. Eit nytt trykk etter feil er eit uttrykkeleg nytt forsøk og kan gi ei ny utskrift. Statusen stadfestar overføringa til skrivaren, ikkje fysisk papirresultat.

## ESP32-CAM

1. Slå på riggen og skann [Wi-Fi-koden](prepare/entropi-wifi.png). Denne eine koden gjeld begge kamera: `WIFI:T:nopass;S:ENTROPI;;`.
2. Godta tilkoplinga til **ENTROPI**. Primærkameraet tilbyr DNS og ei lokal velkomstside slik at telefonen kan opne kameraet ved tilkopling. Nettet fungerer utan internett.
3. Kamera 2 blir funne og kontrollert automatisk. Foto er tilgjengeleg med kamera 1 medan det andre koplar til. Ingen kameradresse skal skrivast inn.

Tilkoplinga krev inga PWA-installering eller modellnedlasting for stereopar. Automatisk opning og lagring i iPhone sitt Wi-Fi-vindauge må kontrollerast på den faktiske telefonen. Eldre trykkfiler som peikar til `/start/`, og den valfrie modelloverføringa for eitt kamera, fungerer vidare. Direkte **http://192.168.4.1/** er framleis tilgjengeleg som reserveinngang.

Ein Wi-Fi-QR koplar telefonen til nettet; sjølve systemvindauget blir styrt av telefonen. Dersom Autopålogging tidlegare er slått av for ENTROPI, kan automatisk opning utebli. DNS og portalomdirigering gjeld berre tilgang via riggen sitt eige aksesspunkt.

Den eldre klargjeringssida held på modellane ved tilkoplingsfeil og prøver igjen i same kamerafane. Modellfeil og kamerafeil blir haldne frå kvarandre. Avbroten klargjering held fram ved historikkretur. Lasting utan framdrift i 30 sekund gir nytt forsøk. Trygge oppdateringar ventar medan kamera, overføring eller lasting er i bruk. «Tilbake til kameraet» beheld fotoet som er ope. Modellar er nødvendige for monokulær 3D og djupnekunst; foto og stereopar fungerer utan dei.

- Søkjar og foto har separate oppløysingar. Foto kan bruke 1600 × 1200 med PSRAM; utan PSRAM blir begge avgrensa til 320 × 240.
- Med PSRAM brukar foto JPEG-kvalitet 8 og søkjaren 14, slik at stillbiletet bevarer meir detalj medan førehandsvisinga sender færre byte. Utan PSRAM blir kvaliteten 12. Fotooppløysinga blir henta att etter omstart.
- Opptak pausar kameratilgangen, hentar ei fersk ramme og gjenopprettar søkjaren. JPEG-formatet blir kontrollert frå sjølve JPEG-headeren ved byte av oppløysing. Sensor- og nettverksinnstillingar blir bevarte på kameraet.
- Utløysaren ventar på ei fersk ramme og éi innkøyringsramme etter byte av oppløysing. Den faste pausen på 150 ms blir berre brukt når fotolyset er på. Søkjaren gjenbrukar JPEG-bufferen, og Wi-Fi-søvn er slått av for jamnare overføring.
- Foto blir halde i minnet og kan lagrast på telefonen. Siste foto er tilgjengeleg medan sida er open.
- Wi-Fi og statussida startar uavhengig av sensoren. Kameraet får inntil tre gjenopprettingsforsøk med pause mellom forsøka.

Modell og WASM ligg i telefonen. Kameraet leverer berre JPEG og den vesle visingskoden frå flash. Avbrot under opptak kan ikkje opne eit forelda resultat; ferdige eller pågåande splats blir bevarte for siste foto. Modelloverføring krev rett vindauge, eksakt opphav og økt-ID; begge filene må ha rett storleik og SHA-256 og kunne lesast tilbake før klargjeringa blir stadfesta. Foto blir ikkje overførte til klargjeringstenesta.

## To ESP32-kamera

Kamera 1 fungerer åleine når ingen gyldig partnar er tilgjengeleg. Begge kamera får kvar sin rolle, dei to chip-ID-ane og ein felles privat paringsnøkkel ved bygging. Signerte UDP-utfordringar finn den rette partnaren og den gjeldande adressa. Ei oppføring går ut etter 12 sekund utan svar. Nettlesaren kontrollerer identiteten og eit ferskt JPEG-bilete før paropptak blir aktivert; seinare statuskontrollar prøver igjen etter avbrot. Ferdige bilete og brukarval blir bevarte.

Det same opptaket og dei same kontrollane blir brukte med eitt eller to kamera. Med kamera 2 tilkopla tek utløysaren begge bileta og lagar éi samla 3D-vising. Den eksisterande lagre-/utskriftsknappen brukar den synlege visinga. I liggjande format viser søkjaren begge tilgjengelege kamera side om side. Manglande partnar gir éin sentrert søkjar. Resultat og eksport er framleis eitt bilete. Originalane blir haldne saman i minnet for ny vising; eit ufullstendig par erstattar ikkje førre resultat.

Den første stereoberekninga køyrer lokalt i ein web worker, på opptil 320 × 240. Ho finn samsvarande biletpunkt med census-matching, tekstur-/unikheitskrav og kontroll i begge retningar. Punkt utan påliteleg samsvar blir utelatne; bilete med for få samsvar blir avviste. 3D-visinga avviser manglande stereo. Djupnekunsten kan bruke den lagra monokulære modellen som reserve, og arkivet bevarer kva kjelde som faktisk blei brukt og kvifor stereoparet blei avvist. Eitt kamera brukar den eksisterande fotoflyten og valfrie Depth Anything-visinga.

Stereo brukar ein fast profil for den monterte riggen, målt frå ekte par 28.10.2026: primær c0b62c0d5020 og sekundær c443180d5020. Sensorbileta har hovudsakleg vertikal disparitet. Arbeidsbileta blir roterte før samsvarssøk og korrigerte på tvers av disparitetsretninga; sjølve djupneskilnaden blir bevart. Resultatet blir ført tilbake til originalfotoet. Profilen er førebels: nye par i kvalitetskontrollen 28.10.2026 passa ikkje påliteleg, så eit godkjent opptak kan ikkje reknast som full kalibrering. Profilen blir skalert til 4:3-bilete, og originalfilene blir ikkje endra. Ingen justeringsside, glidebrytar eller lagra nettlesarforskyving blir brukt.

Profilen er ei målt tilnærming utan linsemodell eller metrisk avstand. Eit tredje, separat opptak gav under eitt piksel avvik for 95 prosent av dei kontrollerte samsvara ved arbeidsoppløysing. Matching krev tekstur, unikskap, samsvar i begge retningar og utbreidd punktstøtte; mørke, glatte eller bevegelege motiv kan framleis bli avviste. Eksponeringane er sekvensielle. Ved feil blir foto og originalparet bevarte.

Primærkameraet tilbyr ENTROPI på `http://192.168.4.1`. Bygg kamera 2 med `-DENTROPI_SECONDARY_CAMERA=1`; det koplar seg til ENTROPI og får adresse automatisk. Begge bygg må få `ENTROPI_PRIMARY_ID`, `ENTROPI_SECONDARY_ID` og `ENTROPI_RIG_KEY` frå ein privat, ignorert header via `compiler.cpp.extra_flags=-include<absolutt-sti>`. ID-ane er 12 små heksadesimale teikn slik `/status.camera_id` rapporterer; nøkkelen er 16–128 teikn. Feil eller manglande oppsett gir vanleg eitt-kamera-modus. USB-kommandoen `rig-check` viser parings-/DNS-status utan å vise nøkkelen.

Primærkameraet leverer også `/peer/status`, `/peer/preview` og `/peer/capture` frå den kontrollerte partnaren. Telefonen og ein lokal PC-mellomtenar treng berre å nå primærkameraet. Partnaren si fotooppløysing blir samordna før opptak. Dei to HTTP-opptaka er sekvensielle, ikkje eksponeringssynkroniserte.

For PC-utvikling kan primærkameraet i tillegg få `ENTROPI_WIFI_SSID` og `ENTROPI_WIFI_PASSWORD` frå den private headeren. Det held ENTROPI ope samtidig som det koplar til lokalnettet. Kamera 2 kan bli verande på ENTROPI, slik at riggen fungerer utan heimerutaren. Dersom også kamera 2 blir bygd med LAN-oppsett, går det over til ENTROPI etter 15 sekund utan LAN-tilkopling. USB blir brukt til straum, flashing og diagnostikk; bileta går over Wi-Fi. Private parings- og nettverksbygg skal ikkje publiserast.

## Utløysarknapp

Primærkameraet les ein valfri trykknapp mellom IO13 og GND. Begge punkta sit på same stiftrad på kamerasida: IO4, IO2, IO14, IO15, IO13, IO12, GND, 5V. Lodd to tynne leidningar til loddepunkta for IO13 og GND, og hald dei unna IO12, som styrer oppstarten. Bruk ein momentan trykknapp som er open i kvile; firmware slår på den interne pull-up-motstanden og filtrerer kontaktprell. RST-knappen på modulsida startar kameraet på nytt og er ikkje ein utløysar.

Eit trykk tek same foto som utløysaren på skjermen når kamerasida er open og klar. Eit trykk medan eit ferdig bilete blir vist, tek neste foto direkte. Trykk under opptak eller framkalling blir ikkje utførte seinare. Kamerasida spør etter trykk fire gonger i sekundet, så knappen kan gi inntil eit kvart sekund ekstra forseinking. Utan open kameraside blir trykk berre talde. USB-kommandoen `button-check` viser om knappen er kopla rett. Bygg med `-DENTROPI_BUTTON_GPIO=14` for IO14 eller `-1` for å slå knappen av; sekundærkameraet les aldri knappen.

## Djupnekunst

VATHOgraphy brukar flyttalsdjupn med fem svartkvite tonekurver: Lysband, Dis, Djup, Nærlys og To plan. Dis er standard. Dra vassrett med éin finger for å flytte lysbandet; knip med tre for å endre breidda. Bruk to fingrar til panorering og zoom. Ferdig djupn blir mellomlagra for same opptak. Justering, vising, PNG-lagring og utskriftsgrunnlag brukar den same rasteren utan fotoets luminans eller splatgeometri.

På telefonen brukar modusen den eksisterande Depth Anything V2 Small-modellen med opptil 518 pikslar på lengste side. Tonekurva blir brukt etter interpolering av flyttalsdjupna til fotooppløysinga. Eit komplett stereopar blir prøvd før modellklargjering; klargjering blir først nødvendig dersom paret blir avvist og reserveestimeringa manglar modell. Den [lokale USB-brua](local/README.md) brukar 770 pikslar og tek eit reelt par via riggen sin `stereo-snap`-kommando. Djupnekunsten prøver samsvar mellom begge originalane; begge kameraoriginalane blir bevarte. To tilkopla kamera stadfestar ikkje at bileta er kalibrerte eller maskinvaresynkroniserte.

Djupnekunst og 3D deler no den same modellarbeidaren. Nye foto innan 30 sekund gjenbrukar den innlasta modellen; ein inaktiv arbeidar blir frigitt ved bakgrunn eller etter 30 sekund. Avbrot og feil kastar arbeidaren, og seine svar kan ikkje erstatte eit nyare foto. Nedskalering til modellen ber nettlesaren om høg interpoleringskvalitet. Dette er framleis Depth Anything V2 Small, ikkje Marigold V2.

## Bygg og kontroll

Nettappen er statiske filer utan byggjesteg. `pointcloud/` og `vendor/` er felles kjelde for nettappen og firmware; firmwarebyggjet legg den vesle koden inn i flash. Modell og WASM blir haldne utanfor flash.

Ved endring av appskalet må cacheversjonen i `sw.js` aukast; klargjeringa har eigne cachefamiliar for `/prepare/` og `/start/` i `prepare/sw.js`. Dette held den mellomlagra offline-versjonen samla ved oppdatering.

Modell og WASM har inga utløpstid. Dei blir lagra under SHA-256 i `entropi-depth-v1`, lesne tilbake før klargjeringa er ferdig og gjenbrukte på tvers av appoppdateringar. HTTPS-appen ber om varig nettlesarlagring ved oppstart og modellbruk. Mellombelse nettverks- eller lagringsfeil utløyser ny prøving, ikkje ny modellklargjering. Lokal HTTP støttar ikkje denne førespurnaden om varig lagring, og Safari og heimskjermappen kan ha skilde lager. iOS kan framleis avslå varig lagring; sletting av appdata fjernar også modellen.

```powershell
python prepare-models.py
python device/build-ui.py
node --test
python -m unittest discover -s local -p "test_*.py"
arduino-cli compile --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app --build-path device/build device/EntropiCamera
```

Kamera 2 treng i tillegg `-DENTROPI_SECONDARY_CAMERA=1`, og USB-kommandoane `stereo-snap`, `camera-photo` og `camera-preview` finst berre når primærkameraet blir bygd med `-DENTROPI_USB_STEREO_TEST=1`. Begge går i same `compiler.cpp.extra_flags` som den private headeren.

ESP32 core **3.3.12**, AI Thinker ESP32-CAM, 4 MB flash, `huge_app`. Ta full backup av eksisterande flash og kontroller rett port før overføring. Backup, genererte headerar, bygg og ferdige firmwarefiler er ignorerte av Git og Vercel.

Galleriet og TIFF-eksporten har eigne nettlesartestar. Etter `python device/build-ui.py` kan `python tests/gallery-layout.py`, `python tests/gallery-navigation-browser.py` og `python tests/rendered-export-browser.py` køyrast med Python-pakkane Playwright og tifffile og installerte Chromium/WebKit-motorar. Testane kontrollerer begge mobilretningar, 100 bilete, sveiping, bevart rulleposisjon, fem djupneuttrykk, elleve fotoprofilar og identisk TIFF med utsnitt og transparens frå modulane og firmwarepakken.

`python tests/photo-editor-browser.py` kontrollerer redigeringsflyten med faste testbilete i nettlesaren. Dette er nettlesarprøving, ikkje stadfesting av bruk på fysisk iPhone.

Automatiske testar dekkjer opptaksflyt, feilhandtering, avbrot, meldingsopphav, djupnegeometri, Gaussian-data, modellintegritet og at lagring gir same svartkvitt, utsnitt eller splatstil som visinga. GitHub Actions køyrer `node --test` og testane for dei lokale verktøya (USB-brua og den trygge firmwareoverføringa) ved push og pull request, og byggjer firmware for primærkameraet, kamera 2 og USB-stereovarianten med ESP32 core 3.3.12. Native C++-testar av JPEG-parseren, stereoprotokollen, utskriftsjobben og utløysarknappen køyrer i Linux-byggjemiljøet; lokalt blir dei eksplisitt hoppa over dersom ein C++-vertskompilator manglar. Ekte modellkøyring og WebGL er kontrollerte i Chromium på PC. Brukaren sitt iPhone-opptak stadfestar søkjar og JPEG-opptak; den nye klargjeringa og 3D utan internett må òg kontrollerast på fysisk iPhone/Safari.

Søkjar og djupneprojeksjon er tilpassa [entropi.iverfinne.no](https://github.com/lukketsvane/entropi.iverfinne.no), commit `4f2aa4ce11349350d4b924e2a876655f0502f65b`. Modellrevisjon, storleik og kontrollsummar ligg i `pointcloud/models/manifest.json`. Modell- og runtime-lisensar følgjer filene. Espressif-lisensen er bevart i firmware.

## Redigerbar Entropi-fil

[Formatet](docs/entropi-format.md) bevarer originalbileta byte for byte, dei uendra float32-verdiane før normalisering og tonekurve, ei separat gyldigheitsmaske, kjeldeinformasjon og uttrykksval. Dokumentidentiteten følgjer fila ved opning, redigering og ny lagring. Ho er ein ZIP med JSON og binære flyttalsdata, med SHA-256-kontroll og avgrensa innlesing. Nettlesarprofilen `numerical-float32` brukar versjon 1 for enkel framkalling, versjon 2 for grunnleggande fotoredigering, versjon 3 for panorama og versjon 4 for dei utvida farge-, tone- og korneffektane. Versjon 4 kan òg innehalde panorama. Justeringane kan endrast etter opning; utsnitt fjernar ingen originaldata. Eldre appversjonar avviser formatversjonar dei ikkje støttar. Den tidlegare eksperimentelle OpenEXR-prototypen er ikkje same profil.

PNG brukar den synlege kunsten. TIFF framkallar dei lagra flyttalsverdiane med gjeldande uttrykk og fotoredigering i originalfotoet sin storleik, før det valde utsnittet blir teke ut. Oppskalering skjer før tonekurva, og 16-bits tonar blir avrunda direkte frå flyttal; ugyldige område blir transparente. Svartkvitt brukar gråtone og alfa, medan farga profilar blir lagra med 16 bit per RGBA-kanal. Dette gir finare tonepresisjon, utan å auke dynamikkområdet til sensoren eller hente att tapte detaljar. TIFF har ikkje innebygd ICC-profil, så fargestyringa i andre program kan påverke visinga. DNG mappar dei opphavlege numeriske verdiane direkte til 16 bit; verdiområde, retning og einingar ligg i metadata. DNG er eit eksperimentelt monokromt LinearRaw-bilete, ikkje sensor-RAW eller ei lovnad om at Lightroom brukar eit innebygd djupnekart. Uavhengig TIFF- og LibRaw-innlesing er testa; faktisk Lightroom- og iPhone-import må kontrollerast separat.

Lagring brukar eitt trykk for det synlege biletet. Hald inne lagreknappen og dra opp for å velje PNG, `.entropi`, TIFF eller DNG; slepp utanfor for å avbryte. Piltast opp eller kontekstmeny opnar same veljar med tastatur. Lastinga følgjer heile søkjarramma. Nye arkivoppføringar blir viste etter framkalling, med det ferdige uttrykket og utsnittet som miniatyr og førehandsvising; originalane blir bevarte for vidare redigering.

## Gestar og samordna opptak

Fem små merke langs høgre kant opnar lys, farge, tekstur, utsnitt og fotoprofil. Kvar gruppe har kompakte verktøyval og ein talverdi; dra vassrett over biletet for å justere, utan store miniatyrkort eller synlege glidebaner. Dra fingeren loddrett langs venstre kant for å gli gjennom djupneuttrykka, eller langs høgre kant for å skifte verktøy. Dei usynlege trykkflatene dekkjer òg mellomromma mellom merka. Fotoprofilane A4, A5, B1, B5, C1, F2, G3, M3, P5, X1 og HB2 har justerbar styrke. Dei er VSCO-inspirerte tilnærmingar med eigne tonekurver, ikkje identiske kopiar av proprietære VSCO-profilar. Redigeringa blir lagd på djupnekunsten, og blandar ikkje inn lysstyrken frå originalfotoet.

Fargegruppa har metning, temperatur, fargestikk og HSL for raudt, oransje, gult, grønt, blått og lilla. Lysgruppa har eksponering, kontrast, høglys og skuggar. Filmkorn har eigne verdiar for styrke, storleik og farge; mønsteret er stabilt og knytt til originaloppløysinga. Førehandsvising, gjenopning, 16-bits TIFF og PNG brukar same redigering. Originalfoto og numerisk djupn blir haldne urørde.

Hald inne den levande søkjaren for panorama, flytt kameraet roleg og slepp for å fullføre. Opptaket stoppar etter 15 sekund og tek høgst åtte originalrammer eller stereopar. Rammer utan nok samsvar blir utelatne frå samansyinga, men originalane blir bevarte i `.entropi` saman med transformasjonane. Panorama krev overlapp; ei mislukka samansying erstattar ikkje førre resultat.

Lagringsmenyen tilbyr AI 2×, 4× og 8× som PNG. Real-ESRGAN `realesr-general-x4v3` køyrer lokalt på den framkalla kunsten. 2× brukar modellens 4×-resultat med arealnedskalering; 8× brukar to modellpass. Arbeidet blir delt i overlappande felt og kan avbrytast. WebGPU blir prøvd når nettlesaren tilbyr det; elles blir WASM brukt. Særleg 8× kan ta lang tid på telefon og utan GPU. Oppskaleringa estimerer detaljar og endrar ikkje original- eller djupnedata. Modell og køyremiljø blir kontrollerte med SHA-256; kamerasida kan få dei via den eksisterande HTTPS-hjelparen.

I liggjande kameravising kan lysstyrke og automatisk eksponeringskompensasjon justerast frå -2 til +2. Ei tilkopla partnareining får same verdi gjennom identitetskontrollert vidaresending. Dette er sensoren si eksponeringskompensasjon, ikkje manuell lukkartid eller ISO. Stadfesta verdiar blir lagra på kameraet. USB-brua brukar dei same firmwarefunksjonane og krev kvittering frå rett kamera.

Vidare ikonarbeid skal følgje den handteikna referansen: enkle, litt ujamne strekar på éin piksel, med store usynlege trykkflater.

Knappar viser berre symbol utan fyll, ramme eller fokusboks, med usynlege trykkflater på minst 44 pikslar. Eit kort trykk på lagring lastar ned 16-bits TIFF når biletet har eit samsvarande Entropi-dokument; originalfoto og separate førehandsvisingar brukar biletformatet sitt. Hald inne og slepp for å halde glasmenyen open, eller dra til formatet og slepp for direkte eksport. Hald på biletet for å sjå originalen mellombels; slepp for å gå tilbake. Dobbelttrykk med éin finger nullstiller tonejusteringa. Dobbelttrykk med to fingrar nullstiller berre zoom og forskyving. Samanlikningsknappen opnar ei delt vising med ei grense som kan dragast; originalen følgjer same zoom og forskyving som kunsten. Utskrift krev trykk på utskriftssymbolet. Sletting krev to direkte trykk innan tre sekund, og blir avbroten ved andre handlingar.

Galleriknappen er oppe til høgre. Kryssiktet oppe til venstre er skjult. Handlingane nedst blir berre skjulte medan redigeringsverktøyet er ope. I arkivet sveipar ein til sidene for førre eller neste bilete, eller ned for å lukke arkivet. Piltastane gir same biletskifte. Tilbake til rutenettet bevarer rulleposisjon og fokus; miniatyrane blir lasta ved behov. Sveipa gjeld berre arkivvisinga, slik at draing og kniping i djupnekunsten held fram som før. I ståande resultatvising ligg retur til kameraet nede ved tommelen.

Eit kort trykk på kamerasymbolet i resultatet opnar søkjaren. Hald inne i 400 ms og slepp for å ta neste foto direkte; flytting, ein ekstra finger eller bakgrunn avbryt. Shift+Enter på knappen gir same opptak, og mellomrom utanfor andre kontrollar verkar som utløysar. Førre kunstverk og originalar blir bevarte dersom neste opptak feilar.

`/stereo/capture` og USB-opptak startar førespurnaden til kamera 2 før det lokale opptaket, og ventar med full JPEG-overføring til etterpå. Begge JPEG-ar må passe same par-ID, kamera-ID-ar og storleik før paret blir brukt. Begge kameraa må ha den nye firmwareversjonen. Tidspunkta er frå separate kameraklokker; samordninga er ikkje maskinvaresynkronisering. Den faste riggprofilen må framleis kontrollerast med nye verkelege par etter flytting av kamera eller optikk.
