# ENTROPI lokalt

USB-brua brukar den eksisterande `stereo-snap`-kommandoen på riggen. Begge kameraa må vere para. Ho endrar ikkje firmware eller Wi-Fi. Opptaka er sekvensielle, ikkje maskinvaresynkroniserte.

Bygg grensesnittet frå rotmappa:

```powershell
python device/build-ui.py
```

Start med Python-miljøet som har PySerial, Pillow, NumPy, Torch og Transformers, og den lagra modellen `depth-anything/Depth-Anything-V2-Small-hf`:

```powershell
python local/bridge.py --serial COM16 --cache C:\sti\til\hf_cache
```

Bruk USB-porten til primærkameraet. Etter siste USB-tilkopling 28.10.2026 vart `COM16` stadfesta som primærkamera `c0b62c0d5020` og `COM13` som sekundærkamera `c443180d5020`. Portnummer kan endre seg; brua kontrollerer kamera-ID og primærrolla med `rig-check` ved oppstart og avviser sekundærkameraet med ei konkret feilmelding. Eit nytt opptak kontrollerer også identiteten dersom han ikkje alt er stadfesta.

Opne <http://127.0.0.1:19305> på PC-en. Brua lyttar berre lokalt. Den første modellkøyringa lastar den mellomlagra modellen; seinare justering av djupnekurva krev ikkje ny inferens. Modellen brukar 770 pikslar som arbeidsstorleik og returnerer flyttalsdjupn i fotoformatet. Nære flater har høge verdiar.

`POST /api/capture` tek eitt ferskt par og gir to URL-ar med same opptaks-ID. `POST /api/depth` tek JPEG, PNG eller WebP og returnerer little-endian float32 med dimensjonar, polaritet og modellnamn i svarhovuda. Begge originalane blir bevarte i nettlesaren sitt eksisterande fotoarkiv. Serveren held berre dei åtte siste para i minnet.

```powershell
python -m unittest discover -s local -p test_bridge.py
```
