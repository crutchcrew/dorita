# @dorita980/mock-robot

A fake firmware 2.x Roomba: an MQTT broker over TLS that accepts dorita980 commands and publishes simulated robot state. The rest980 tests use it, and you can use it to try the web UI without a real robot:

```bash
bun run mock-robot
BLID=mockblid PASSWORD=mockpass ROBOT_IP=127.0.0.1 bun start
```

Private; not published to npm.
