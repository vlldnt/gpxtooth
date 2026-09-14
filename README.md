<p align="center">
  <img src="assets/logoGPXTooth.png" alt="Logo GPXtooth" width="120" />
</p>

<h1 align="center">GPXtooth</h1>

<p align="center">
  Dashboard GPS pour visualiser et analyser tes traces GPX :<br />
  carte, vitesse, altitude, fréquence cardiaque et pente des côtes.
</p>

<p align="center">
  <a href="https://gpxtooth.vieilledent.eu"><strong>gpxtooth.vieilledent.eu</strong></a>
  <br />
  Rien à installer, ça marche directement dans le navigateur.
</p>

---

## Utilisation

1. Ouvre [gpxtooth.vieilledent.eu](https://gpxtooth.vieilledent.eu)
2. Clique sur **Importer** et choisis un fichier `.gpx` (ou **Voir la démo**)
3. Donne un nom à ta trace et explore

Tes traces sont enregistrées dans ton navigateur : elles restent disponibles d'une visite à l'autre et personne d'autre n'y a accès.

## Fonctionnalités

- **Carte interactive** — fonds OpenStreetMap, OpenTopoMap et satellite, plein écran
- **Panneau traces sur la carte** — toutes tes traces en couleurs vives ; la trace sélectionnée est opaque, les autres restent visibles en transparence ; filtre par type (VTT, course, rando, vélo)
- **Colorisation** — trace colorée selon la vitesse, l'altitude ou la fréquence cardiaque
- **Graphiques synchronisés** — FC, vitesse, altitude et pente : survoler la carte ou un graphique place le curseur partout
- **Pente des côtes** — chaque montée est détectée du point bas au sommet, avec sa pente moyenne, sa longueur et son D+ ; les descentes sont ignorées
- **Thème clair / sombre** — bouton soleil / lune, suit le réglage du système par défaut
- **Mobile** — carte en haut, graphiques en carrousel à faire défiler

## Confidentialité

- **Sans compte** : aucune donnée n'est envoyée, tout reste dans le `localStorage` de ton navigateur.
- **Compte propriétaire** : une fois connecté, les traces sont enregistrées sur le serveur et accessibles depuis n'importe quel appareil. Mot de passe hashé (scrypt), session en cookie `HttpOnly` / `Secure` / `SameSite=Strict`, connexion bloquée après 5 échecs.

## Stack

- HTML / CSS / JavaScript vanilla, sans framework
- [Leaflet](https://leafletjs.com/) pour la carte, Canvas pour les graphiques
- API Node.js sans dépendance pour le compte propriétaire
- Docker (Nginx + Node) derrière un reverse proxy HTTPS

## Auteur

[@vlldnt](https://github.com/vlldnt) — [vieilledent.eu](https://vieilledent.eu)
