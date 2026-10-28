# ENTROPI stereo på tur

## Oppstart utan PC eller internett

Kople kvar ESP32-CAM til sin eigen regulerte 5 V USB-utgang frå Linocell 5000 mAh. Powerbanken har éin USB-A- og éin USB-C-utgang, med maksimalt 2,1 A samla. Bruk høvelege kablar eller USB-programmeringsbasar. Ikkje før 5 V inn på 3,3 V-pinnen. Sikre kablar og kort mot lause kontaktar og kortslutning.

Etter oppstart lagar primærkameraet det opne Wi-Fi-nettet ENTROPI på 192.168.4.1. Kamera 2 blir kopla til automatisk som 192.168.4.2. Telefonen skal bruke dette nettet sjølv om det ikkje har internett.

1. Vel ENTROPI i Wi-Fi-innstillingane på telefonen.
2. Opne Safari på http://192.168.4.1/
3. Vent til søkjaren viser kameraet. Trykk i søkjaren for å ta foto.
4. Trykk ikonet med to rektangel i biletvisinga for å lagre eit side-ved-side-JPEG med begge kamerabileta, i full sensoroppløysing.
5. På iPhone via lokalt HTTP: hald inne det opna biletet, og vel lagring til Bilder/Foto. Kontroller at fila er lagra før neste opptak.

Originalpara blir mellomlagra i nettlesaren sitt lokale arkiv. Lagre viktige bilete til Foto; sletting av nettstaddata kan fjerne arkivet.

## Fast montert rigg

Kameraa brukar den målte riggprofilen frå 28.10.2026 automatisk. Den tidlegare justeringssida og høgdeglidebrytaren er fjerna; eldre lenkjer med `?kalibrer=1` opnar kameraet. Ikkje flytt kameraa i festet etter denne målinga. Originalfotoa blir bevarte utan korreksjon.

Berekninga tek omsyn til den vertikale disparitetsretninga og korrigerer samsvarslinjene før stereo. Resultatet er relativ djupn utan metrisk kalibrering eller synkroniserte eksponeringar. Hald riggen og motivet i ro og bruk godt lys. Manglande sikre samsvar gir fotoet tilbake, med originalparet tilgjengeleg for lagring.

Kamera 2 prøver tilkoplinga på nytt kvart 15. sekund medan nettet er borte. Den lokale USB-brua kontrollerer at vald port tilhøyrer primærkameraet; Windows-portnummer kan endre seg.

## Verifisering 25.10.2026

- Begge ESP32-CAM vart identifiserte via MAC, fekk ny firmware og bestod flash-kontroll.
- ENTROPI på 192.168.4.1 vart påvist. Primærkameraet rapporterte gyldig paring med kamera 2 på 192.168.4.2.
- Tre påfølgjande opptak gav seks ulike, gyldige JPEG-bilete på 640 × 480.
- Nettlesarsimulering med ekte biletfiler verifiserte lagring som eitt 1280 × 480 side-ved-side-JPEG, og at justeringssida henta begge kamera.
- Faktisk drift med begge korta frå denne powerbanken og lagring på fysisk iPhone er ikkje testa. Driftstid er ikkje målt.

Fullstendige flashkopiar: test-results/rig-primary-before.bin og test-results/rig-secondary-before.bin.
Bygd firmware: device/build/primary-rig og device/build/secondary-rig.
