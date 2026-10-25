# ENTROPI · iPhone 16e · 25.10.2026

## Bruk

- Ståande iPhone 16e: 390 × 844 CSS-punkt.
- Liggjande iPhone 16e: 844 × 390 CSS-punkt.
- Offentleg HTTPS-PWA: https://esp32.iverfinne.no
- Direkte stereokamera på sitt eige Wi-Fi: http://192.168.4.1/
- Stereojustering: http://192.168.4.1/?kalibrer=1

### Installer som iPhone-app

1. Opne https://esp32.iverfinne.no i Safari medan telefonen har internett.
2. Trykk Del, deretter «Legg til på Hjem-skjermen».
3. La «Open as Web App» / «Opne som nettapp» vere aktiv.
4. Legg til og start Entropi frå heimskjermen.
5. Opne appen minst éin gong medan nettet fungerer så Service Worker kan lagre dei nødvendige filene.

**Safari Feature Flags:** Ikkje aktiver eksperimentelle flagg. Bruk vanlege standardinnstillingar. Behald kamera- og lokalnettverkstilgang når operativsystemet spør.

### Stereokamera på tur

1. Kople begge ESP32-CAM til regulert 5 V frå powerbanken.
2. Vel det opne ENTROPI-nettet på iPhone. Bruk nettet utan internett.
3. Opne http://192.168.4.1 i Safari. Lokal HTTP er kameraets direkte kontrollflate og krev ikkje heimetenar eller internett.
4. Landskapsmodus viser begge kameraførehandsvisingane samtidig, med utløysaren på høgre side.
5. Trykk utløysaren. To original-JPEG blir lagra i lokalt arkiv når det er tilgjengeleg.
6. Opne arkivet for å lagre venstre og høgre original eller same side-ved-side-JPEG til Bilder/Foto.
7. Bruk «Juster stereo» dersom kantane i dei to bileta ikkje ligg på same høgd.

Arkivet i HTTPS-PWA-en og arkivet på http://192.168.4.1 er **separate**. Same foto blir ikkje automatisk delt mellom dei. PWA-arkivet er lagra i IndexedDB for den installerte appen. Kameraarkivet brukar IndexedDB på det lokale kameraopphavet. Verken arkiv er ein erstatning for eksport til Foto/Filer. Nettlesarlagringa kan bli sletta av brukaren/OS-et eller ved full lagringskvote.

## Nye funksjonar

- Elegant ståande og eigne liggjande grensesnitt med safe-area-marg, lesbare treffflater og tilpassa kameravindauge.
- Eige stereo-søkjaroppsett på sida, to videobilete i liggjande modus.
- Utløysar som fungerer i begge retningar, med 3 s og 10 s tidtakar.
- Automatisk lokalt fotoarkiv som bevarer originalfilene; eksport, individuell lagring og sletting med stadfesting.
- For stereo: fulloppløyselege venstre/høgre originalar og JPEG side-ved-side.
- Tilkoplingsvising, tydeleg status for eitt eller to kamera, direkte hjelp til optisk justering.
- Offentleg PWA: byte mellom fram- og bakkamera, manifest med heimskjermikon og nyttige startadresser, offline appskal via Service Worker.
- Lokal stereo: manuell raud/cyan-justering på http://192.168.4.1/?kalibrer=1.
- Alle eksisterande retro, foto og Gaussian-splats-stilar vart haldne intakte.

## Verifikasjon

- 18 skjermbilete av lokal kameraapp, 390 × 844 og 844 × 390.
- 13 skjermbilete av HTTPS-PWA, inkludert offline-arkiv.
- Skjermbileta er Chromium/Edge med iPhone 16e-einingstorleik, touch og DPR 3, ikkje ei fysisk Safari/iPhone-køyring.
- Browser-testane verifiserer at arkivert foto overlever sida sin reload, at begge stereo-JPEG blir fanga, at eksport fungerer, og at appen kan opne offline frå Service Worker-cache.
- Full testsuite: 416 beståtte av 419, 3 skippa, ingen feil.
- Fysisk iPhone Safari, PWA-installasjon, strømforbruk frå bank og fotoskriving under faktisk turistbruk krev felttest.

## Testfiler

- test-results/iphone16e/screens
- test-results/iphone16e/report.json
- test-results/iphone16e/pwa-report.json
- Desktop/ENTROPI-iPhone16e-Preview/index.html
- Desktop/ENTROPI-iPhone16e-UI.zip

## Viktige tekniske grenser

- Stereosensorane er ikkje maskinvaresynkroniserte. Bruk stilleståande motiv.
- Stereo-Djupnerekning krev justerte, parallelle optiske aksar og gode samsvar.
- Kameraserveren på lokal HTTP kan ikkje bruke Service Worker. Det er ikkje noko å slå på under Safari Feature Flags for å endre dette.
- For visse API-ar varierer iOS-støtte med versjon og om appen køyrer frå heimskjermen; bruk føresetnadsprøving og vanlege fallbacks.
