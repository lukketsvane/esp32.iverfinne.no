# ENTROPI stereo på tur

## Oppstart utan PC eller internett

Kople kvar ESP32-CAM til sin eigen regulerte 5 V USB-utgang frå Linocell 5000 mAh. Powerbanken har éin USB-A- og éin USB-C-utgang, med maksimalt 2,1 A samla. Bruk høvelege kablar eller USB-programmeringsbasar. Ikkje før 5 V inn på 3,3 V-pinnen. Sikre kablar og kort mot lause kontaktar og kortslutning.

Etter oppstart lagar primærkameraet det opne Wi-Fi-nettet ENTROPI på 192.168.4.1. Kamera 2 blir kopla til automatisk som 192.168.4.2. Telefonen skal bruke dette nettet sjølv om det ikkje har internett.

1. Vel ENTROPI i Wi-Fi-innstillingane på telefonen.
2. Opne Safari på http://192.168.4.1/
3. Vent til søkjaren viser kameraet. Trykk i søkjaren for å ta foto.
4. Trykk ikonet med to rektangel i biletvisinga for å lagre eit side-ved-side-JPEG med begge kamerabileta, i full sensoroppløysing.
5. På iPhone via lokalt HTTP: hald inne det opna biletet, og vel lagring til Bilder/Foto. Kontroller at fila er lagra før neste opptak.

Ingen minnekortlagring eller automatisk varig arkiv er aktiv. Eit usikra biletepar kan gå tapt ved ny opplasting, omstart eller lukking av nettlesaren.

## Rett inn linsene

Opne http://192.168.4.1/?kalibrer=1 med telefonen på ENTROPI. Justeringsvisinga legg kamera 1 i raudt over kamera 2 i cyan. Sikt mot ein stilleståande gjenstand med rette vassrette kantar. Løysne kamerafesta og rett dei to optiske aksane slik at same kant ligg på same høgd i begge bileta. Sikre skruane. Opne «Til kameraet» når dei er rette.

Bileta er korrigerte til same rotasjonsretning i firmware. Den siste fysisk monterte prototypen hadde enno om lag 130 pikslar vertikal forskyving ved 640 × 480, og krev innretting for stabil 3D. Kameraa må peike parallelt og vere stive under opptak. Utløysingane er ikkje maskinvaresynkroniserte, så bruk helst stilleståande motiv og hald kameraet i ro.

## Verifisering 25.10.2026

- Begge ESP32-CAM vart identifiserte via MAC, fekk ny firmware og bestod flash-kontroll.
- ENTROPI på 192.168.4.1 vart påvist. Primærkameraet rapporterte gyldig paring med kamera 2 på 192.168.4.2.
- Tre påfølgjande opptak gav seks ulike, gyldige JPEG-bilete på 640 × 480.
- Nettlesarsimulering med ekte biletfiler verifiserte lagring som eitt 1280 × 480 side-ved-side-JPEG, og at justeringssida henta begge kamera.
- Faktisk drift med begge korta frå denne powerbanken og lagring på fysisk iPhone er ikkje testa. Driftstid er ikkje målt.

Fullstendige flashkopiar: test-results/rig-primary-before.bin og test-results/rig-secondary-before.bin.
Bygd firmware: device/build/primary-rig og device/build/secondary-rig.
