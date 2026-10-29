# ENTROPI lokalt

USB-brua brukar den eksisterande `stereo-snap`-kommandoen på riggen. Begge kameraa må vere para. Ho endrar ikkje firmware eller Wi-Fi. Opptaka er sekvensielle, ikkje maskinvaresynkroniserte.

Bygg grensesnittet frå rotmappa:

```powershell
python device/build-ui.py
```

Start med Python-miljøet som har PySerial, Pillow, NumPy, Torch og Transformers, og den lagra modellen `depth-anything/Depth-Anything-V2-Small-hf`:

```powershell
python local/bridge.py --serial COM13 --cache C:\sti\til\hf_cache
```

Bruk USB-porten til primærkameraet. Ved kontroll 28.10.2026 kl. 23.45 svarte primærkameraet `c0b62c0d5020` på `COM13` og sekundærkameraet `c443180d5020` på `COM15`. Portnummer kan endre seg; brua kontrollerer kamera-ID og primærrolla med `rig-check` ved oppstart og avviser sekundærkameraet med ei konkret feilmelding. Eit nytt opptak kontrollerer også identiteten dersom han ikkje alt er stadfesta. Kjem eit par skadd over USB, tek brua eit nytt par éin gong før ho melder feil.

Opne <http://127.0.0.1:19305> på PC-en. Brua lyttar berre lokalt. Ho tek eit første stereopar ved oppstart; statusførespurnader brukar siste par og ventar aldri på eit nytt USB-opptak. Søkjaren hentar små enkeltbilete frå primærkameraet med `camera-preview`, om lag eitt i sekundet. Eldre firmware utan kommandoen får siste stereopar i staden. Den første modellkøyringa lastar den mellomlagra modellen; seinare justering av djupnekurva krev ikkje ny inferens. Modellen brukar 770 pikslar som arbeidsstorleik og returnerer flyttalsdjupn i fotoformatet. Nære flater har høge verdiar.

`POST /api/capture` tek eitt ferskt par og gir to URL-ar med same opptaks-ID. `POST /api/depth` tek JPEG, PNG eller WebP og returnerer little-endian float32 med dimensjonar, polaritet og modellnamn i svarhovuda. Begge originalane blir bevarte i nettlesaren sitt eksisterande fotoarkiv. Serveren held berre dei åtte siste para i minnet.

```powershell
python -m unittest discover -s local -p "test_*.py"
```

## Riggkontroll

`stereo-check.html` måler kor godt stereopar passar den faste riggprofilen, med same kode og arbeidsstorleik som appen. Han viser dekninga med profilen og kva radforskyving innan ±40 px som gir best dekning. Appen sjølv forskyv aldri rader; verktøyet viser berre om kameraa har flytta seg i festet og profilen må målast på nytt. Start ein lokal server frå rotmappa og opne sida med eitt eller fleire par, der `sti/1` tyder `sti/1-left.jpg` og `sti/1-right.jpg`:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

<http://127.0.0.1:8000/local/stereo-check.html?pair=/test-results/direct-download-live-after-flash/1>

Paret frå 28.10.2026 kl. 18.59 gav 0 % dekning med profilen og best dekning, 5,6 %, ved 28 px forskyving (om lag 140 px i fotoet).

## Trygg overføring av firmware

`flash.py` overfører berre app-partisjonen til eitt kamera. Først kontrollerer han at porten høyrer til rett kamera ved å samanlikne MAC-adressa med kamera-ID-en for rolla, og tek full backup av heile flashminnet på 4 MB. Deretter kontrollerer han at biletet får plass i app-partisjonen. Med `--write` skriv han appen på 0x10000, kontrollerer med `verify-flash`, les appen tilbake og samanliknar byte for byte, og stadfestar at partisjonstabellen og innstillingane (0x8000–0xE000) er uendra. Feilar noko etter at skrivinga har starta, blir den gamle appen frå backupen skriven tilbake og kontrollert.

Utan `--write` blir berre identitet og backup kontrollerte. Backup og logg hamnar i `device/firmware/backups/`, som Git ignorerer.

```powershell
python local/flash.py --role primary --port COM13 --image device/build/primary/EntropiCamera.ino.bin
python local/flash.py --role primary --port COM13 --image device/build/primary/EntropiCamera.ino.bin --write
```

Byggjet må ha den private riggheaderen for eit para kamera; sjå hovud-README. Verktøyet er testa mot eit simulert kort og har enno ikkje vore køyrt mot kameraa.
