# rest980

A REST API and web UI for iRobot Roomba robots, built on [dorita980](https://github.com/crutchcrew/dorita/tree/main/packages/dorita980). Control the robot from any browser or HTTP client on your network, and watch a live map of the cleaning path.

From the root of this repository:

```bash
bun install
cp .env.example .env   # fill in BLID, PASSWORD and ROBOT_IP
bun start
```

See [REST API and web UI](https://github.com/crutchcrew/dorita#rest-api-and-web-ui) for configuration, Docker and the list of endpoints.
