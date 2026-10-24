# dorita980

Unofficial SDK for iRobot Roomba robots. It talks to your robot directly on your local network: start, stop and dock it, read its state, change cleaning preferences and schedules, clean specific rooms, and stream live mission data.

```bash
bun add dorita980
```

```javascript
import dorita980 from 'dorita980';

const robot = new dorita980.Local('MyBlid', 'MyPassword', '192.168.1.104');

robot.on('connect', async () => {
  await robot.clean();
  robot.end();
});
```

The package also installs two command-line tools that fetch your robot's BLID and password: `get-roomba-password` and `get-roomba-password-cloud`.

See the [full documentation](https://github.com/crutchcrew/dorita#readme) for compatibility, getting your credentials and the complete API.
