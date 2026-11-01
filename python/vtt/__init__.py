"""VTT на Python для shared-хостинга SpaceWeb (mod_wsgi).

Тот же JSON API, что у Node-сервера (`app/api/**` + `lib/store.ts`), но без
Node.js: запросы обслуживает Apache + mod_wsgi, комнаты лежат в том же Upstash
Redis (или в файлах, если ключей нет).

Точка входа — `python/wsgi.py`, локальный запуск — `python/devserver.py`.
"""
