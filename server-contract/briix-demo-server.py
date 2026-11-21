"""BRIIX demo static server (aiohttp), bind 127.0.0.1:8440, root /home/badai/briix-demo.
/ и SPA-пути без расширения отдаются как index.html (демо — SPA на hash-роутах).
/api/* проксируется на media-bff (127.0.0.1:8390) с strip prefix /api;
стриминг (SSE/аудио) проксируется потоково. Rate limit: 30 req/min на IP (в памяти, MVP).
CORS не нужен — same-origin через Caddy (demo.briix.ru)."""
import asyncio
import mimetypes
import os
import time

# На сервере mimetypes не знает .m4a/.aac — без этого <audio> в браузере может не играть.
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/aac", ".aac")
from collections import defaultdict, deque

import aiohttp
from aiohttp import web

ROOT = "/home/badai/briix-demo"
BFF_BASE = "http://127.0.0.1:8390"
API_PREFIX = "/api"
RATE_LIMIT = 300         # запросов (правка 21.11: лента студии грузит обложки/пики десятками — 30 рвал приёмку, инфра#35/#22)
RATE_WINDOW = 60.0       # секунд, на IP

# Большие таймауты: генерация музыки до 900 с; SSE — без общего total.
UPSTREAM_TIMEOUT = aiohttp.ClientTimeout(total=None, sock_connect=15, sock_read=950)

# Заголовки hop-by-hop и мешающие проксированию — не переписываем.
_SKIP_REQ_HEADERS = {"connection", "keep-alive", "proxy-authorization", "te", "upgrade", "transfer-encoding"}
_SKIP_RESP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "te", "trailer",
    "transfer-encoding", "upgrade", "content-encoding", "content-length",
}

_rate = defaultdict(deque)


def rate_allow(ip: str) -> bool:
    now = time.monotonic()
    q = _rate[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        q.append(now)  # продлеваем окно, чтобы burst не пробивал лимит
        return False
    q.append(now)
    return True


async def static_file(request: web.Request) -> web.FileResponse:
    # aiohttp 3.14 угадывает mime через свой реестр CONTENT_TYPES (не mimetypes),
    # из-за этого .m4a отдавался как application/octet-stream и <audio> не играл.
    rel = request.match_info.get("tail", "")
    root = os.path.realpath(ROOT)
    path = os.path.realpath(os.path.join(root, rel))
    # Запрос директории (со слэшем или без) → index.html внутри неё.
    if path.startswith(root + os.sep) and os.path.isdir(path):
        path = os.path.join(path, "index.html")
    if not path.startswith(root + os.sep) or not os.path.isfile(path):
        raise web.HTTPNotFound()
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return web.FileResponse(path, headers={"Content-Type": ctype})


async def index_or_static(request: web.Request) -> web.FileResponse:
    # Точный "/" и любые пути без расширения (SPA) → index.html;
    # файлы с расширением отдаёт штатный static route.
    return web.FileResponse(os.path.join(ROOT, "index.html"))


async def api_proxy(request: web.Request) -> web.StreamResponse:
    ip = request.remote or "?"
    if not rate_allow(ip):
        return web.json_response({"error": "rate_limited", "detail": "max 30 req/min"}, status=429)

    tail = request.match_info.get("tail", "")
    url = f"{BFF_BASE}/{tail}"
    if request.query:
        url += "?" + request.query_string

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _SKIP_REQ_HEADERS and k.lower() != "host"
    }

    body = await request.read()
    session: aiohttp.ClientSession = request.app["client"]
    try:
        up = await session.request(
            request.method, url, data=body if body else None, headers=headers,
            allow_redirects=False,
        )
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError):
        return web.json_response({"error": "upstream_unavailable"}, status=502)

    resp = web.StreamResponse(status=up.status, reason=up.reason)
    for k, v in up.headers.items():
        if k.lower() not in _SKIP_RESP_HEADERS and k.lower() != "content-length":
            resp.headers[k] = v
    # content-length известен только если тело не стрим: aiohttp посчитает сам.
    await resp.prepare(request)
    try:
        async for chunk in up.content.iter_any():
            await resp.write(chunk)
        await resp.write_eof()
    except (aiohttp.ClientError, ConnectionResetError, asyncio.TimeoutError):
        pass  # клиент или upstream оборвали стрим — это нормально для SSE
    finally:
        up.release()
    return resp


def make_app() -> web.Application:
    app = web.Application()
    app.router.add_route("*", f"{API_PREFIX}/{{tail:.*}}", api_proxy)
    app.router.add_get("/", index_or_static)
    app.router.add_get("/{tail:.*}", static_file)

    async def open_client(app: web.Application) -> None:
        app["client"] = aiohttp.ClientSession(timeout=UPSTREAM_TIMEOUT)

    async def close_client(app: web.Application) -> None:
        await app["client"].close()

    app.on_startup.append(open_client)
    app.on_cleanup.append(close_client)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="127.0.0.1", port=8440, print=None)
