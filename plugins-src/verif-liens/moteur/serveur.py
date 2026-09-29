"""Verificateur de liens - backend ExziHub, en WebSocket (aiohttp).

  GET  http://localhost:8002/health  -> 200 (voyant de la sidebar du hub)
  WS   ws://localhost:8002/ws

Hub -> serveur :
  {"type": "verifier", "urls": [...], "limite": 100}
  {"type": "annuler"}
Serveur -> hub (diffuse a toutes les fenetres ouvertes) :
  {"type": "etat", "occupe": bool}                                 a la connexion et a chaque changement
  {"type": "progres", "faits", "total", "vivants", "morts"}        pendant une verification (limite en frequence)
  {"type": "resultat", "vivants": [...], "morts": [{url, code, erreur}], "total"}
  {"type": "erreur", "message": ...}

Un seul test tourne a la fois. Une URL est "en ligne" si le serveur repond avec
un code 2xx ou 3xx. On tente HEAD (leger, ne telecharge pas la page) et on retente
en GET quand le serveur refuse HEAD (405/501) ou qu'il echoue.

Lance par ExziHub (pythonw serveur.py, sans console : ne rien attendre de stdin/stdout).
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional, Set
from urllib.parse import urlparse

import aiohttp
from aiohttp import web

PORT = 8002
UA = "Mozilla/5.0 (ExziHub verif-liens)"
DELAI_S = 10          # temps max par requete
PROGRES_MS = 300      # frequence d'envoi de la progression

CLIENTS: Set[web.WebSocketResponse] = set()
OCCUPE = False
ANNULER = asyncio.Event()


# Envoie un message a toutes les fenetres du plugin connectees.
async def diffuser(message: dict) -> None:
    """Envoie a toutes les fenetres connectees, en ignorant celles qui sont parties."""
    texte = json.dumps(message)
    for ws in list(CLIENTS):
        try:
            await ws.send_str(texte)
        except ConnectionError:
            CLIENTS.discard(ws)


# Teste une URL : HEAD puis GET en repli ; en ligne si le code est 2xx ou 3xx.
async def tester(session: aiohttp.ClientSession, url: str, sem: asyncio.Semaphore):
    """Renvoie (url, code, erreur, en_ligne). code/erreur : l'un des deux, jamais les deux."""
    if ANNULER.is_set():
        return url, None, "annule", False
    async with sem:
        if ANNULER.is_set():
            return url, None, "annule", False
        try:
            async with session.head(url, allow_redirects=True) as r:
                if r.status not in (405, 501):
                    return url, r.status, None, 200 <= r.status < 400
        except Exception:
            pass  # HEAD refuse ou en echec : on retente en GET
        try:
            async with session.get(url, allow_redirects=True) as r:
                return url, r.status, None, 200 <= r.status < 400
        except Exception as e:
            return url, None, type(e).__name__, False


# Teste toute la liste : lance les requetes en parallele (bornees par le semaphore),
# envoie la progression au fur et a mesure puis le resultat final.
async def verifier(urls: list, limite: int) -> None:
    global OCCUPE
    OCCUPE = True
    ANNULER.clear()
    await diffuser({"type": "etat", "occupe": True})

    vivants: list = []
    morts: list = []
    total = len(urls)
    sem = asyncio.Semaphore(limite)
    timeout = aiohttp.ClientTimeout(total=DELAI_S)
    connector = aiohttp.TCPConnector(limit=limite)
    dernier = 0.0
    try:
        async with aiohttp.ClientSession(
            timeout=timeout, connector=connector, headers={"User-Agent": UA}
        ) as session:
            taches = [asyncio.ensure_future(tester(session, u, sem)) for u in urls]
            for fini in asyncio.as_completed(taches):
                url, code, erreur, en_ligne = await fini
                if en_ligne:
                    vivants.append(url)
                else:
                    morts.append({"url": url, "code": code, "erreur": erreur})
                maintenant = asyncio.get_event_loop().time()
                if (maintenant - dernier) * 1000 >= PROGRES_MS:
                    dernier = maintenant
                    await diffuser({
                        "type": "progres",
                        "faits": len(vivants) + len(morts),
                        "total": total,
                        "vivants": len(vivants),
                        "morts": len(morts),
                    })
    finally:
        OCCUPE = False

    await diffuser({"type": "resultat", "vivants": vivants, "morts": morts, "total": total})
    await diffuser({"type": "etat", "occupe": False})


# Va chercher un fichier (M3U, liste de liens) a une URL et renvoie son texte au front.
# C'est le moteur qui telecharge, pas le navigateur : pas de blocage CORS.
async def charger(url: str) -> None:
    try:
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout, headers={"User-Agent": UA}) as session:
            async with session.get(url) as r:
                r.raise_for_status()
                texte = await r.text()
    except Exception as e:
        await diffuser({"type": "erreur", "message": f"Fetch failed: {type(e).__name__}"})
        return
    await diffuser({"type": "charge", "texte": texte, "url": url})


# Identifie les serveurs derriere une liste de liens : hote unique, nombre de liens qui le visent,
# et resolution DNS (le domaine pointe-t-il vers une IP ?). Recon passive : on ne se connecte pas
# aux services, on interroge seulement le DNS.
async def serveurs(urls: list) -> None:
    global OCCUPE
    OCCUPE = True
    await diffuser({"type": "etat", "occupe": True})

    compte: dict = {}
    for u in urls:
        hote = urlparse(u).hostname or "?"
        compte[hote] = compte.get(hote, 0) + 1

    loop = asyncio.get_event_loop()
    sem = asyncio.Semaphore(50)

    async def resoudre(hote: str):
        async with sem:
            try:
                infos = await loop.getaddrinfo(hote, None)
                return hote, infos[0][4][0]
            except Exception:
                return hote, None

    ips = dict(await asyncio.gather(*[resoudre(h) for h in compte]))
    liste = sorted(
        ({"hote": h, "nb": n, "ip": ips.get(h)} for h, n in compte.items()),
        key=lambda s: -s["nb"],
    )
    OCCUPE = False
    await diffuser({"type": "serveurs_resultat", "serveurs": liste, "total": len(urls)})
    await diffuser({"type": "etat", "occupe": False})


# Une fenetre du plugin connectee : recoit ses commandes (verifier / serveurs / annuler) et lui renvoie l'etat.
async def sur_ws(requete: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(max_msg_size=128 * 1024 * 1024)  # grosses listes de liens
    await ws.prepare(requete)
    CLIENTS.add(ws)
    tache: Optional[asyncio.Task] = None
    try:
        await ws.send_str(json.dumps({"type": "etat", "occupe": OCCUPE}))
        async for msg in ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                cmd = json.loads(msg.data)
            except ValueError:
                continue
            if cmd.get("type") == "verifier":
                if OCCUPE:
                    await ws.send_str(json.dumps(
                        {"type": "erreur", "message": "Une verification est deja en cours."}))
                    continue
                urls = [u for u in cmd.get("urls", []) if isinstance(u, str)]
                limite = max(1, min(1000, int(cmd.get("limite", 100))))
                tache = asyncio.ensure_future(verifier(urls, limite))
            elif cmd.get("type") == "serveurs":
                if OCCUPE:
                    await ws.send_str(json.dumps(
                        {"type": "erreur", "message": "Une operation est deja en cours."}))
                    continue
                urls = [u for u in cmd.get("urls", []) if isinstance(u, str)]
                tache = asyncio.ensure_future(serveurs(urls))
            elif cmd.get("type") == "charger":
                url = cmd.get("url")
                if isinstance(url, str) and url.startswith(("http://", "https://")):
                    asyncio.ensure_future(charger(url))
                else:
                    await ws.send_str(json.dumps({"type": "erreur", "message": "Invalid URL."}))
            elif cmd.get("type") == "annuler":
                ANNULER.set()
    finally:
        CLIENTS.discard(ws)
    return ws


# Voyant de la barre laterale du hub : repond 200 tant que le moteur tourne.
async def sur_health(_requete: web.Request) -> web.Response:
    return web.Response(text="ok")


# Monte les routes et lance le serveur sur 127.0.0.1:8002 (local uniquement).
def main() -> None:
    app = web.Application()
    app.add_routes([web.get("/health", sur_health), web.get("/ws", sur_ws)])
    web.run_app(app, host="127.0.0.1", port=PORT, print=None, handle_signals=False)


if __name__ == "__main__":
    main()
