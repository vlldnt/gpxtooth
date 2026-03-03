GPS Dashboard — visualiser et gérer traces GPX / FIT

Résumé
------
Petit site web pour afficher et gérer des traces GPS (GPX) et des fichiers FIT (Garmin Forerunner 265).

Objectif
--------
- Afficher toutes les traces et points sur une carte interactive (Leaflet).
- Basculer entre plusieurs fonds de carte open-source (OpenStreetMap, Stamen, OpenTopoMap, ...).
- Importer localement des fichiers `.gpx` et `.fit` (exportés depuis Garmin Connect).
- Dashboard pour chaque trace avec distance, durée, dénivelé, vitesse, fréquence cardiaque si disponible, timestamps.
- Coloration des tracés par métrique (vitesse, altitude, temps).

Stack technique
---------------
- Frontend: JavaScript (HTML/CSS/JS), Leaflet pour la carte. Framework optionnel: Vue 3 ou React.
- Traitement FIT: Python (script ou petit service) pour parser/converter les fichiers `.fit` en GeoJSON/GPX.
- Parsing GPX: bibliothèques JS côté client (`togeojson` / `leaflet-gpx`) ou conversion côté serveur.

Install & usage rapide (dev)
---------------------------
1. Prérequis: Node.js (>=16) pour dev frontend, Python 3.10+ pour conversion FIT.

Remarque sur les versions
------------------------
Utiliser les dernières versions disponibles (tag `latest`) pour Node.js, les paquets npm et les dépendances Python, sauf contrainte spécifique. Préférer la version LTS actuelle pour Node.js en production.
2. Installer dépendances frontend (ex. avec npm):

```bash
npm install leaflet togeojson
```

3. Exemple rapide pour traiter un `.fit` en Python (installer `fitparse`):

```bash
python -m pip install fitparse
# puis exécuter le script de conversion fit -> gpx/geojson
```

Confidentialité
---------------
Le traitement peut se faire localement (recommendé) pour éviter l'upload de données sensibles de localisation.

Prochaines étapes
------------------
- Proposer l'architecture détaillée et les dépendances.
- Implémenter un MVP: import GPX côté client + affichage Leaflet.
- Ajouter conversion/parse `.fit` en Python et intégration au frontend.

