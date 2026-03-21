# GPXtooth

Dashboard GPS local pour visualiser et gérer ses traces GPX.

**[Ouvrir GPXtooth](https://vlldnt.github.io/gpxtooth/)** — importe tes fichiers `.gpx` et commence à explorer.

## Utilisation

1. Ouvre [vlldnt.github.io/gpxtooth](https://vlldnt.github.io/gpxtooth/)
2. Clique sur **Importer** ou glisse-dépose un fichier `.gpx`
3. Donne un nom à ta trace et c'est parti

Tes traces sont sauvegardées dans ton navigateur. Elles restent disponibles d'une session à l'autre, et personne d'autre n'y a accès.

## Fonctionnalités

- **Carte interactive** — Leaflet avec fonds OSM, OpenTopoMap et Satellite (ESRI)
- **Import GPX** — drag & drop ou sélecteur de fichier, avec choix du nom
- **Colorisation** — trace colorée par vitesse, altitude, fréquence cardiaque ou couleur unie
- **Graphiques** — FC, vitesse et altitude avec crosshair synchronisé carte/graphiques
- **Sidebar** — liste des traces avec filtres par type (VTT, running, hiking, cycling…)
- **Plein écran** — carte fullscreen avec graphiques superposés, header auto-hide
- **100 % local** — aucune donnée envoyée, tout reste dans le `localStorage` du navigateur

## Structure

```
gpxtooth/
├── index.html
├── style.css
├── vtt.gpx
└── scripts/
    ├── gpx-parser.js
    ├── map.js
    ├── charts.js
    ├── storage.js
    ├── ui.js
    └── app.js
```

## Stack

- HTML / CSS / JS vanilla (aucun framework)
- [Leaflet](https://leafletjs.com/) pour la carte
- Canvas API pour les graphiques
- localStorage pour la persistance

## Confidentialité

Aucune donnée n'est envoyée à un serveur. Chaque navigateur conserve ses propres traces dans son `localStorage`, isolées des autres utilisateurs.

## Auteur

[@vlldnt](https://github.com/vlldnt) — [vieilledent.eu](https://vieilledent.eu)
