# Dorita

Dorita talks to your Roomba over your local network and gives you the rest980 web UI in Home
Assistant's sidebar (status, battery and bin, start/pause/dock/locate/empty bin, preferences, the
weekly schedule, and a live cleaning map on robots that report their position), plus the
[REST API](https://github.com/crutchcrew/dorita#endpoints) for automations.

## Setup

1. Get the robot's BLID and local password once, from any computer with Docker (see
   [Getting your BLID and password](https://github.com/crutchcrew/dorita#getting-your-blid-and-password)
   for other ways):

   ```sh
   docker run -it --rm oven/bun bunx --package dorita980 get-roomba-password-cloud '<iRobot email>' '<iRobot password>'
   ```

   Your iRobot account password isn't stored anywhere.

2. Give the robot a fixed IP in your router.
3. On the **Configuration** tab, set `blid`, `password` and `robotIP`, then start the app and turn
   on **Show in sidebar**.

The robot accepts **one local connection at a time**. With `keepAlive` on (the default) this app
holds it, so close the iRobot app, and don't add Home Assistant's own iRobot integration for the
same robot. Some robots accept new connections only for a short time after they boot: if Dorita
stays "connecting", restart the robot.

## Options

| Option                           | Default          |                                                                                                                                                  |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blid`, `password`               |                  | **Required.** From step 1.                                                                                                                       |
| `robotIP`                        |                  | **Required.** Discovery broadcasts can't leave the app's Docker network.                                                                         |
| `robotPort`                      | `8883`           | MQTT/TLS port (firmware 2.x).                                                                                                                    |
| `firmwareVersion`                | `2`              | `1` for firmware 1.6.x, `2` for 2.x and later (j, i, s series too).                                                                              |
| `keepAlive`                      | on               | Off: connect per request, leaving the robot free for the iRobot app (no live updates).                                                           |
| `trustedNetworks`                | `172.30.32.0/23` | Clients served without basic auth. That range is Home Assistant's internal network: the sidebar (ingress), Home Assistant itself and other apps. |
| `basicAuthUser`, `basicAuthPass` |                  | Required for any client outside `trustedNetworks`. Without them those clients get 403.                                                           |
| `robotCiphers`                   | `AES128-SHA256`  | Cipher list for the robot connection.                                                                                                            |
| `robotTlsMaxVersion`             |                  | `TLSv1.2` for robots that reset the TLS handshake (seen on a Roomba j7+).                                                                        |

The app runs on Node.js, so robots that need the `AES128-SHA256` TLS cipher (most firmware 2.x+
robots) work.

## Using it from Home Assistant

Home Assistant reaches the app on its internal network, without credentials, at
`http://<hostname>:8099`. The hostname is on the app's **Info** tab (for this repository it looks
like `xxxxxxxx-dorita`). For example, in `configuration.yaml`:

```yaml
rest:
  - resource: http://xxxxxxxx-dorita:8099/api/status
    scan_interval: 30
    sensor:
      - name: Roomba battery
        value_template: '{{ value_json.state.batPct }}'
        unit_of_measurement: '%'
        device_class: battery
      - name: Roomba phase
        value_template: '{{ value_json.state.cleanMissionStatus.phase }}'
    binary_sensor:
      - name: Roomba connected
        value_template: "{{ value_json.connection == 'connected' }}"
        device_class: connectivity

rest_command:
  roomba:
    url: 'http://xxxxxxxx-dorita:8099/api/local/action/{{ action }}'
    method: post
```

Actions: `start`, `stop`, `pause`, `resume`, `dock`, `clean`, `find`, `evac`. A template vacuum
can wrap the sensors and `rest_command.roomba` into a `vacuum` entity.

## Reaching it from outside Home Assistant

The port is closed by default. To use the API from another machine (a dashboard, Prometheus), map
`3000/tcp` on the **Network** tab and set `basicAuthUser` and `basicAuthPass`. That port always
asks for basic auth and answers `403` until it's configured: `trustedNetworks` apply only to the
internal port `8099`, which Home Assistant never publishes. (A published port can't be trusted by
address: Docker may relay its clients from an address inside Home Assistant's network.)
