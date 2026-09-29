# Link Checker (`verif-liens`)

Plugin ExziHub qui teste une liste d'URL et ne garde que celles qui **répondent**.
Utile pour nettoyer une liste de liens : retirer les adresses mortes, ne conserver
que les vivantes.

> Portée : l'outil mesure une **disponibilité HTTP** (est-ce que le serveur répond ?).
> Ce n'est pas un validateur d'identifiants ni un scanner : il fait une requête web
> normale sur chaque URL, comme le ferait un navigateur.

## Entrée (commune aux deux modes)

Tu fournis des liens de trois façons (elles se cumulent) : collés dans la zone de texte,
chargés depuis un fichier (`.txt`, `.csv`, `.m3u`/`.m3u8`) par le bouton **Load a file…** ou
par glisser-déposer, ou récupérés depuis une **URL** via le champ **Fetch** (utile pour une
liste en ligne, ex. `https://iptv-org.github.io/iptv/countries/fr.m3u` : c'est le moteur qui
télécharge, pas le navigateur, donc pas de blocage CORS). Seules les lignes qui sont des **URL** (`http://…` /
`https://…`) sont retenues ; les autres lignes sont ignorées — un fichier M3U (avec ses
lignes `#EXTINF`) passe donc directement, seules ses URL sont prises. Les doublons sont retirés.

Le plugin a deux modes, choisis en haut de l'écran.

## Mode « Links » — disponibilité

1. Tu cliques **Check**. Le moteur teste chaque URL et affiche une barre de progression.
2. Résultat : le nombre de liens **en ligne / total**, la liste des vivants et celle des
   morts (avec le code HTTP ou le type d'erreur). Boutons **Copy live links**
   (presse-papier) et **Save live links** (fichier `live-links.txt` dans Téléchargements).

Un lien est **en ligne** si le serveur répond avec un code **2xx ou 3xx**. Le test tente
d'abord `HEAD` (léger, ne télécharge pas la page) et retombe sur `GET` si le serveur refuse
`HEAD`. Le réglage **Parallel requests** (défaut 100) fixe le nombre de requêtes menées en
même temps : plus haut = plus rapide, mais plus de charge réseau. Baisse-le si beaucoup d'URL
visent le même serveur (sinon risque d'être limité ou bloqué).

## Mode « Servers » — identification d'infrastructure

1. Tu cliques **Identify servers**.
2. Le moteur extrait le **serveur** (hôte) de chaque URL, regroupe, compte combien de liens
   visent chacun, et fait une **résolution DNS** (le domaine pointe-t-il vers une IP ?).
3. Résultat : un tableau **hôte / nombre de liens / IP**, exportable en CSV
   (`servers-report.csv`) — la forme d'un rapport d'identification.

C'est de la **recon passive** : on interroge seulement le DNS, on ne se connecte pas aux
services. Utile pour ramener une longue liste de liens à la poignée de serveurs distincts
qui sont derrière.

## Comment ça marche

Comme Coût des plats, le plugin est un **front React** piloté par un **moteur Python** local,
via WebSocket. Le hub lance le moteur (bouton Start/Stop du plugin) et installe ses
dépendances à l'installation.

- **Front** (`src/VerifTool.tsx`) : l'interface. Se connecte à `ws://localhost:8002/ws`.
- **Moteur** (`moteur/serveur.py`, [aiohttp](https://docs.aiohttp.org)) : serveur
  asynchrone. L'asynchrone permet de tenir des centaines de requêtes en attente en même
  temps (on ne fait qu'attendre le réseau), là où des threads plafonneraient vite.

### Protocole WebSocket

Le moteur écoute sur le port **8002** :

- `GET http://localhost:8002/health` → `200` (voyant de la barre latérale du hub).
- `WS ws://localhost:8002/ws` :

Front → moteur :

| Message | Effet |
|---|---|
| `{"type":"verifier","urls":[…],"limite":100}` | mode Links : teste chaque URL |
| `{"type":"serveurs","urls":[…]}` | mode Servers : hôtes uniques + DNS |
| `{"type":"charger","url":"https://…"}` | va chercher un fichier de liens à cette URL |
| `{"type":"annuler"}` | interrompt l'opération en cours |

Moteur → front (diffusé à toutes les fenêtres du plugin ouvertes) :

| Message | Contenu |
|---|---|
| `{"type":"etat","occupe":bool}` | à la connexion et à chaque changement |
| `{"type":"progres","faits","total","vivants","morts"}` | pendant un test (fréquence limitée) |
| `{"type":"resultat","vivants":[…],"morts":[{url,code,erreur}],"total"}` | fin du mode Links |
| `{"type":"serveurs_resultat","serveurs":[{hote,nb,ip}],"total"}` | fin du mode Servers |
| `{"type":"charge","texte":"…","url"}` | contenu récupéré par Fetch |
| `{"type":"erreur","message"}` | erreur (ex. une opération déjà en cours) |

Un seul test tourne à la fois.

## Fichiers

```
verif-liens/
  manifest.json          id, nom, icône, port 8002, commande de lancement du moteur
  package.json           script de build
  src/
    index.tsx            enregistre le plugin dans le hub
    VerifTool.tsx        l'interface
    styles.css
  moteur/
    serveur.py           le moteur (aiohttp : serveur WebSocket + client HTTP)
    requirements.txt     aiohttp
```

## Build

Depuis `plugins-src/` :

```
npm run build --workspace=verif-liens
```

Compile le front (`tsc --noEmit` + Vite), copie le manifest et le moteur dans
`hub/plugins/verif-liens/`. Le hub charge le plugin au démarrage suivant.

Pour le distribuer (écran Tools, autres appareils) : `node plugins-src/publier.cjs verif-liens`
(après avoir monté la version dans `manifest.json` et `package.json`).

## Limites

- Le moteur a besoin de **Python + aiohttp** (installé automatiquement à l'installation
  du plugin ; bureau Windows uniquement, comme les autres plugins à moteur).
- Un lien qui répond lentement peut être compté hors ligne : le délai par requête est de
  **10 s**. C'est un état à l'instant du test, pas une garantie dans la durée.
- Le test se connecte **directement** à chaque URL. À n'utiliser que sur des adresses que
  tu as le droit de contacter.
