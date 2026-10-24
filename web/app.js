'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const POLL_MS = 3000;
  const ROBOT_RADIUS_CM = 17;

  const PHASES = {
    charge: 'Docked',
    charging: 'Charging',
    run: 'Cleaning',
    stop: 'Stopped',
    pause: 'Paused',
    stuck: 'Stuck',
    evac: 'Emptying bin',
    hmUsrDock: 'Returning to dock',
    hmMidMsn: 'Returning to recharge',
    hmPostMsn: 'Finishing up',
    dock: 'Docking',
    chargingerror: 'Base unplugged',
    new: 'Starting',
    recharge: 'Recharging'
  };

  const ERRORS = {
    1: 'Left wheel off floor',
    2: 'Main brushes stuck',
    3: 'Right wheel off floor',
    4: 'Left wheel stuck',
    5: 'Right wheel stuck',
    6: 'Stuck near a cliff',
    7: 'Left wheel error',
    8: 'Bin error',
    9: 'Bumper stuck',
    10: 'Right wheel error',
    11: 'Bin error',
    12: 'Cliff sensor issue',
    13: 'Both wheels off floor',
    14: 'Bin missing',
    15: 'Reboot required',
    16: 'Bumped unexpectedly',
    17: 'Path blocked',
    18: 'Docking issue',
    19: 'Undocking issue',
    20: 'Docking issue',
    21: 'Navigation problem',
    22: 'Navigation problem',
    23: 'Battery issue',
    24: 'Navigation problem',
    25: 'Reboot required',
    26: 'Vacuum problem',
    27: 'Vacuum problem',
    29: 'Software update needed',
    30: 'Vacuum problem',
    31: 'Reboot required',
    32: 'Smart map problem',
    33: 'Path blocked',
    34: 'Reboot required',
    35: 'Unrecognised cleaning pad',
    36: 'Bin full',
    37: 'Tank needs refilling',
    38: 'Vacuum problem',
    39: 'Reboot required',
    40: 'Navigation problem',
    41: 'Timed out',
    42: 'Localization problem',
    43: 'Navigation problem',
    44: 'Pump issue',
    45: 'Lid open',
    46: 'Low battery',
    47: 'Reboot required',
    48: 'Path blocked'
  };

  const CONNECTION_LABELS = {
    idle: 'Starting',
    discovering: 'Looking for robot',
    connecting: 'Connecting',
    connected: 'Connected',
    ready: 'Ready',
    'on-demand': 'On demand',
    offline: 'Offline',
    error: 'Connection error',
    stopped: 'Stopped'
  };

  const ui = {
    status: null,
    view: {},
    path: [],
    pathMission: null,
    scheduleDirty: false,
    busyPrefs: new Set(),
    pollTimer: null,
    events: null
  };

  // ---------- API ----------

  async function api (path, options) {
    options = options || {};
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) throw new Error((body && body.message) || res.status + ' ' + res.statusText);
    return body;
  }

  // Firmware 1.x responses are wrapped in { ok: ... }.
  function unwrap (resp) {
    if (resp && typeof resp === 'object' && resp.ok && typeof resp.ok === 'object') return resp.ok;
    return resp;
  }

  // ---------- Normalizing robot data ----------

  function viewFromState (state, previous) {
    const view = Object.assign({}, previous);
    if (!state) return view;
    const mission = state.cleanMissionStatus || {};
    Object.assign(view, {
      name: state.name,
      sku: state.sku,
      softwareVer: state.softwareVer,
      batteryType: state.batteryType,
      batPct: state.batPct,
      bin: state.bin,
      pose: state.pose,
      phase: mission.phase,
      cycle: mission.cycle,
      error: mission.error,
      notReady: mission.notReady,
      mssnM: mission.mssnM,
      sqft: mission.sqft,
      nMssn: mission.nMssn,
      initiator: mission.initiator,
      rssi: state.signal && state.signal.rssi,
      bbrun: state.bbrun,
      schedule: state.cleanSchedule || null,
      prefs: {
        carpetBoost: state.carpetBoost ? 'auto' : (state.vacHigh ? 'performance' : 'eco'),
        cleaningPasses: !state.noAutoPasses ? 'auto' : (state.twoPass ? 'two' : 'one'),
        edgeClean: state.openOnly ? 'off' : 'on',
        alwaysFinish: state.binPause ? 'off' : 'on'
      }
    });
    return view;
  }

  function viewFromMission (mission, previous) {
    // Firmware 2.x getMission() returns state fields, 1.x returns { ok: {...} }.
    if (mission && mission.cleanMissionStatus) return viewFromState(Object.assign({}, previous.rawState, mission), previous);
    const m = unwrap(mission) || {};
    const flags = m.missionFlags || {};
    return Object.assign({}, previous, {
      batPct: m.batPct,
      phase: m.phase,
      cycle: m.cycle,
      error: m.error,
      notReady: m.notReady,
      mssnM: m.mssnM,
      sqft: m.sqft,
      pose: m.pos,
      bin: { present: !flags.binRemoved, full: Boolean(flags.binFull) }
    });
  }

  function prefsFromV1 (resp) {
    const p = (unwrap(resp) || {}).cleaningPreferences;
    if (!p) return null;
    return {
      carpetBoost: p.carpetBoost,
      cleaningPasses: { 1: 'one', 2: 'two' }[p.cleaningPasses] || 'auto',
      edgeClean: p.edgeClean ? 'on' : 'off',
      alwaysFinish: p.alwaysFinish ? 'on' : 'off'
    };
  }

  // ---------- Rendering ----------

  function setText (id, text) {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }

  function formatMinutes (minutes) {
    if (minutes === undefined || minutes === null) return '–';
    if (minutes < 60) return minutes + ' min';
    return Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
  }

  function phaseLabel (view) {
    const { phase, cycle, batPct } = view;
    if (!phase) return '—';
    if (phase === 'charge' && cycle && cycle !== 'none') return 'Recharging';
    if (phase === 'charge') return batPct >= 100 ? 'Docked' : 'Charging';
    if (phase === 'stop' && cycle && cycle !== 'none') return 'Paused';
    return PHASES[phase] || phase;
  }

  function phaseDetail (view) {
    if (view.error) return 'Error ' + view.error + ': ' + (ERRORS[view.error] || 'Check the iRobot app');
    if (view.notReady) return 'Not ready (code ' + view.notReady + ')';
    if (view.cycle && view.cycle !== 'none') {
      const by = view.initiator && view.initiator !== 'none' ? ' · started by ' + view.initiator : '';
      return 'Mission: ' + view.cycle + by;
    }
    return view.phase === 'charge' ? 'Ready to clean' : ' ';
  }

  function primaryAction (view) {
    const { phase, cycle } = view;
    const inMission = cycle && cycle !== 'none';
    if (phase === 'run') return { action: 'pause', label: 'Pause', icon: '❚❚' };
    if (phase && phase.indexOf('hm') === 0) return { action: 'pause', label: 'Pause', icon: '❚❚' };
    if (inMission && (phase === 'stop' || phase === 'pause' || phase === 'stuck')) return { action: 'resume', label: 'Resume', icon: '▶' };
    const actions = (ui.status && ui.status.actions) || [];
    return { action: actions.indexOf('clean') > -1 ? 'clean' : 'start', label: 'Clean', icon: '▶' };
  }

  function canControl () {
    const connection = ui.status && ui.status.connection;
    return connection === 'connected' || connection === 'ready' || connection === 'on-demand';
  }

  function renderStatus () {
    const status = ui.status || {};
    const pill = $('connection');
    pill.dataset.state = status.connection || 'idle';
    setText('connection', CONNECTION_LABELS[status.connection] || status.connection || '');

    const banner = $('banner');
    const error = status.lastError;
    if (error && status.connection !== 'connected') {
      banner.hidden = false;
      banner.dataset.kind = 'error';
      setText('banner-title', 'Can\'t reach the robot.');
      setText('banner-text', error.message + (error.hint ? ' — ' + error.hint : ''));
    } else if (status.local === false) {
      banner.hidden = false;
      banner.dataset.kind = 'warn';
      setText('banner-title', 'Local API disabled.');
      setText('banner-text', 'Set ENABLE_LOCAL=yes to control the robot from this page.');
    } else {
      banner.hidden = true;
    }

    const meta = [];
    if (status.firmwareVersion) meta.push('Firmware ' + status.firmwareVersion + '.x');
    if (status.robotIP) meta.push(status.robotIP);
    setText('robot-meta', meta.join(' · ') || 'Connecting…');

    renderControls();
  }

  function renderControls () {
    const enabled = canControl();
    const primary = primaryAction(ui.view);
    const btn = $('primary-action');
    btn.dataset.action = primary.action;
    btn.querySelector('.btn-icon').textContent = primary.icon;
    btn.querySelector('.btn-text').textContent = primary.label;
    // Show the actions this firmware supports, minus the one already offered
    // by the primary button.
    const actions = (ui.status && ui.status.actions) || [];
    document.querySelectorAll('.control-row [data-action]').forEach((el) => {
      el.hidden = actions.indexOf(el.dataset.action) === -1 || el.dataset.action === primary.action;
    });
    document.querySelectorAll('[data-action]').forEach((el) => {
      if (el.getAttribute('aria-busy') !== 'true') el.disabled = !enabled;
    });
    document.querySelectorAll('#prefs input').forEach((el) => { el.disabled = !enabled; });
  }

  function renderView () {
    const view = ui.view;
    if (view.name) {
      setText('robot-name', view.name);
      document.title = view.name + ' · ' + phaseLabel(view);
    }
    setText('phase', phaseLabel(view));
    const detail = $('phase-detail');
    setText('phase-detail', phaseDetail(view));
    detail.style.color = view.error ? 'var(--danger)' : '';

    const pct = typeof view.batPct === 'number' ? view.batPct : null;
    setText('battery-pct', pct === null ? '–' : pct + '%');
    $('battery').setAttribute('aria-label', pct === null ? 'Battery unknown' : 'Battery ' + pct + '%');
    $('battery').dataset.level = pct === null ? '' : pct <= 15 ? 'low' : pct <= 35 ? 'mid' : 'ok';
    $('battery-ring').style.strokeDashoffset = String(326.73 * (1 - (pct || 0) / 100));

    setText('stat-time', formatMinutes(view.mssnM));
    const area = $('stat-area');
    setText('stat-area', typeof view.sqft === 'number' ? view.sqft + ' ft²' : '–');
    area.title = typeof view.sqft === 'number' ? (view.sqft * 0.0929).toFixed(1) + ' m²' : '';
    const bin = $('stat-bin');
    if (!view.bin) {
      setText('stat-bin', '–');
      delete bin.dataset.alert;
    } else if (view.bin.present === false) {
      setText('stat-bin', 'Missing');
      bin.dataset.alert = '';
    } else if (view.bin.full) {
      setText('stat-bin', 'Full');
      bin.dataset.alert = '';
    } else {
      setText('stat-bin', 'OK');
      delete bin.dataset.alert;
    }
    setText('stat-missions', typeof view.nMssn === 'number' ? String(view.nMssn) : '–');

    renderControls();
    renderPrefs();
    renderSchedule();
    renderInfo();
  }

  function renderPrefs () {
    const prefs = ui.view.prefs;
    document.querySelectorAll('#prefs fieldset').forEach((fieldset) => {
      const key = fieldset.dataset.pref;
      if (ui.busyPrefs.has(key)) return;
      fieldset.querySelectorAll('input').forEach((input) => {
        input.checked = Boolean(prefs && prefs[key] === input.value);
      });
    });
  }

  function renderSchedule () {
    const schedule = ui.view.schedule;
    $('schedule-empty').hidden = Boolean(schedule);
    $('schedule-save').hidden = !schedule;
    if (!schedule || ui.scheduleDirty) return;
    const key = JSON.stringify(schedule);
    const form = $('schedule');
    if (form.dataset.key === key) return;
    form.dataset.key = key;
    form.textContent = '';
    DAYS.forEach((day, i) => {
      const enabled = schedule.cycle[i] && schedule.cycle[i] !== 'none';
      // Coerce to numbers: these values come from the robot and end up in innerHTML.
      const h = Math.min(23, Math.max(0, parseInt(schedule.h[i], 10) || 0));
      const m = Math.min(59, Math.max(0, parseInt(schedule.m[i], 10) || 0));
      const time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      const row = document.createElement('div');
      row.className = 'schedule-row';
      row.innerHTML =
        '<span class="day" id="day-' + i + '">' + day + '</span>' +
        '<input type="time" step="60" value="' + time + '" aria-labelledby="day-' + i + '"' + (enabled ? '' : ' disabled') + '>' +
        '<label class="switch"><input type="checkbox" aria-label="Clean on ' + day + '"' + (enabled ? ' checked' : '') + '><span></span></label>';
      form.appendChild(row);
    });
    $('schedule-save').disabled = true;
  }

  function renderInfo () {
    const view = ui.view;
    const status = ui.status || {};
    const rows = [
      ['Name', view.name],
      ['Model', view.sku],
      ['Software', view.softwareVer],
      ['IP address', status.robotIP],
      ['Wi-Fi signal', typeof view.rssi === 'number' ? view.rssi + ' dBm' : null],
      ['Battery type', view.batteryType],
      ['Lifetime runtime', view.bbrun ? view.bbrun.hr + ' h ' + view.bbrun.min + ' min' : null],
      ['Live updates', status.live ? 'Yes' : 'Polling']
    ].filter((row) => row[1] !== undefined && row[1] !== null && row[1] !== '');
    const info = $('info');
    const html = rows.map(([label, value]) => '<dt>' + label + '</dt><dd>' + escapeHtml(String(value)) + '</dd>').join('');
    if (info.innerHTML !== html) info.innerHTML = html;
  }

  function escapeHtml (value) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Map ----------

  let mapFrame = null;
  function scheduleMapDraw () {
    if (mapFrame) return;
    mapFrame = requestAnimationFrame(() => {
      mapFrame = null;
      drawMap();
    });
  }

  function addPathPoint (pose, view) {
    // Start a new path when a new mission starts, like the server does.
    if (view.nMssn !== undefined && view.nMssn !== ui.pathMission) {
      ui.pathMission = view.nMssn;
      ui.path = [];
      scheduleMapDraw();
    }
    if (!pose || !pose.point) return;
    if (!view.cycle || view.cycle === 'none') return;
    const last = ui.path[ui.path.length - 1];
    if (last && last.x === pose.point.x && last.y === pose.point.y) return;
    ui.path.push({ x: pose.point.x, y: pose.point.y, theta: pose.theta });
    scheduleMapDraw();
  }

  function drawMap () {
    const canvas = $('map');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const pose = ui.view.pose && ui.view.pose.point ? ui.view.pose : null;
    $('map-empty').hidden = ui.path.length > 0 || Boolean(pose && (pose.point.x || pose.point.y));
    if (!ui.path.length && !pose) return;

    // Robot coordinates (cm) have x pointing away from the dock and y to the
    // left; draw the dock at the bottom with the robot driving "up".
    const toScreen = (p) => ({ x: -p.y, y: -p.x });
    const points = ui.path.map(toScreen);
    const robot = pose ? toScreen(pose.point) : null;
    const all = points.concat([{ x: 0, y: 0 }], robot ? [robot] : []);

    let minX = Math.min(...all.map((p) => p.x));
    let maxX = Math.max(...all.map((p) => p.x));
    let minY = Math.min(...all.map((p) => p.y));
    let maxY = Math.max(...all.map((p) => p.y));
    const minSpan = 300;
    if (maxX - minX < minSpan) { const c = (minX + maxX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
    if (maxY - minY < minSpan) { const c = (minY + maxY) / 2; minY = c - minSpan / 2; maxY = c + minSpan / 2; }

    const margin = 28;
    const scale = Math.min((rect.width - margin * 2) / (maxX - minX), (rect.height - margin * 2) / (maxY - minY));
    const offsetX = (rect.width - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetY = (rect.height - (maxY - minY) * scale) / 2 - minY * scale;
    const sx = (p) => p.x * scale + offsetX;
    const sy = (p) => p.y * scale + offsetY;

    const styles = getComputedStyle(document.documentElement);
    const pathRgb = styles.getPropertyValue('--path').trim();
    const muted = styles.getPropertyValue('--muted').trim();
    const line = styles.getPropertyValue('--line').trim();

    // 1 m grid.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil((-offsetX / scale) / 100) * 100; x * scale + offsetX < rect.width; x += 100) {
      ctx.moveTo(x * scale + offsetX, 0);
      ctx.lineTo(x * scale + offsetX, rect.height);
    }
    for (let y = Math.ceil((-offsetY / scale) / 100) * 100; y * scale + offsetY < rect.height; y += 100) {
      ctx.moveTo(0, y * scale + offsetY);
      ctx.lineTo(rect.width, y * scale + offsetY);
    }
    ctx.stroke();

    if (points.length > 1) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(sx(p), sy(p)) : ctx.moveTo(sx(p), sy(p))));
      // Approximate cleaned area: a stroke as wide as the robot.
      ctx.strokeStyle = 'rgba(' + pathRgb + ', .16)';
      ctx.lineWidth = Math.max(ROBOT_RADIUS_CM * 2 * scale, 4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(' + pathRgb + ', .85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Dock.
    const dock = { x: sx({ x: 0 }), y: sy({ y: 0 }) };
    ctx.fillStyle = muted;
    ctx.fillRect(dock.x - 12, dock.y + 4, 24, 6);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Dock', dock.x, dock.y + 24);

    if (robot) {
      const r = Math.max(ROBOT_RADIUS_CM * scale, 8);
      const x = sx(robot);
      const y = sy(robot);
      const theta = (pose.theta || 0) * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(' + pathRgb + ')';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.sin(theta) * r, y - Math.cos(theta) * r);
      ctx.stroke();
    }
  }

  // ---------- Actions ----------

  function toast (message, kind) {
    const el = document.createElement('div');
    el.className = 'toast';
    if (kind) el.dataset.kind = kind;
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 2500);
  }

  const ACTION_MESSAGES = {
    start: 'Starting to clean',
    clean: 'Starting to clean',
    pause: 'Pausing',
    resume: 'Resuming',
    stop: 'Stopping',
    dock: 'Sending the robot home',
    find: 'Playing a sound on the robot',
    evac: 'Emptying the bin'
  };

  async function runAction (btn) {
    const action = btn.dataset.action;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
      await api('/api/local/action/' + action, { method: 'POST' });
      toast(ACTION_MESSAGES[action] || 'Done');
      if (!(ui.status && ui.status.live)) setTimeout(refresh, 1000);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      btn.removeAttribute('aria-busy');
      renderControls();
    }
  }

  async function setPref (fieldset, input) {
    const key = fieldset.dataset.pref;
    const previous = ui.view.prefs && ui.view.prefs[key];
    ui.busyPrefs.add(key);
    fieldset.setAttribute('aria-busy', 'true');
    try {
      await api('/api/local/config/' + key + '/' + input.value, { method: 'POST' });
      ui.view.prefs = Object.assign({}, ui.view.prefs, { [key]: input.value });
      toast('Preference saved');
      if (!(ui.status && ui.status.live)) loadPreferences();
    } catch (error) {
      toast(error.message, 'error');
      fieldset.querySelectorAll('input').forEach((el) => { el.checked = el.value === previous; });
    } finally {
      ui.busyPrefs.delete(key);
      fieldset.removeAttribute('aria-busy');
    }
  }

  async function saveSchedule () {
    const rows = Array.from(document.querySelectorAll('.schedule-row'));
    const week = { cycle: [], h: [], m: [] };
    rows.forEach((row) => {
      const [h, m] = row.querySelector('input[type="time"]').value.split(':').map((n) => parseInt(n, 10) || 0);
      week.cycle.push(row.querySelector('input[type="checkbox"]').checked ? 'start' : 'none');
      week.h.push(h);
      week.m.push(m);
    });
    const btn = $('schedule-save');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      await api('/api/local/config/week', { method: 'POST', body: week });
      ui.scheduleDirty = false;
      ui.view.schedule = week;
      $('schedule').dataset.key = JSON.stringify(week);
      toast('Schedule saved');
    } catch (error) {
      btn.disabled = false;
      toast(error.message, 'error');
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }

  // ---------- Data loading ----------

  async function loadPreferences () {
    if (!ui.status || ui.status.firmwareVersion !== 1) return;
    try {
      const prefs = prefsFromV1(await api('/api/local/config/preferences'));
      if (prefs) ui.view.prefs = prefs;
      const week = unwrap(await api('/api/local/config/week'));
      if (week && week.cycle) ui.view.schedule = week;
      renderView();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function refresh () {
    if (!ui.status) return;
    try {
      if (ui.status.firmwareVersion === 1) {
        ui.view = viewFromMission(await api('/api/local/info/mission'), ui.view);
        addPathPoint(ui.view.pose, ui.view);
      } else {
        const state = await api(ui.status.live ? '/api/status' : '/api/local/info/state');
        const robotState = ui.status.live ? state.state : state;
        ui.view = viewFromState(robotState, ui.view);
        ui.view.rawState = robotState;
      }
      renderView();
      scheduleMapDraw();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function startPolling () {
    clearInterval(ui.pollTimer);
    // Firmware 1.x has no push updates; firmware 2.x without keepAlive
    // reconnects per request, so only refresh on demand there.
    if (ui.status.firmwareVersion === 1) {
      ui.pollTimer = setInterval(refresh, POLL_MS);
      loadPreferences();
    }
    refresh();
  }

  function startEvents () {
    const events = new EventSource('/api/events');
    ui.events = events;
    events.addEventListener('status', (e) => {
      ui.status = Object.assign({}, ui.status, JSON.parse(e.data));
      renderStatus();
      renderInfo();
    });
    events.addEventListener('state', (e) => {
      const state = JSON.parse(e.data);
      ui.view = viewFromState(state, ui.view);
      ui.view.rawState = state;
      renderView();
      scheduleMapDraw();
    });
    events.addEventListener('mission', (e) => {
      const mission = JSON.parse(e.data);
      if (mission.pose) ui.view.pose = mission.pose;
      addPathPoint(mission.pose, Object.assign({}, ui.view, mission.cleanMissionStatus || {}));
    });
    events.addEventListener('error', () => {
      if (events.readyState === EventSource.CONNECTING && ui.status) {
        ui.status = Object.assign({}, ui.status, { connection: 'connecting' });
        renderStatus();
      }
    });
  }

  async function init () {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (btn && !btn.disabled) runAction(btn);
    });
    $('prefs').addEventListener('change', (e) => {
      const fieldset = e.target.closest('fieldset');
      if (fieldset) setPref(fieldset, e.target);
    });
    $('schedule').addEventListener('input', (e) => {
      if (e.target.type === 'checkbox') {
        e.target.closest('.schedule-row').querySelector('input[type="time"]').disabled = !e.target.checked;
      }
      ui.scheduleDirty = true;
      $('schedule-save').disabled = false;
    });
    $('schedule-save').addEventListener('click', saveSchedule);
    $('refresh').addEventListener('click', () => {
      refresh();
      loadPreferences();
    });
    $('map-clear').addEventListener('click', () => {
      ui.path = [];
      scheduleMapDraw();
      api('/api/path', { method: 'DELETE' }).catch(() => {});
    });
    if (window.ResizeObserver) new ResizeObserver(scheduleMapDraw).observe($('map'));
    connect();
  }

  async function connect () {
    try {
      const status = await api('/api/status');
      ui.status = status;
      ui.path = status.path || [];
      if (status.state && status.state.cleanMissionStatus) ui.pathMission = status.state.cleanMissionStatus.nMssn;
      if (status.state) {
        ui.view = viewFromState(status.state, ui.view);
        ui.view.rawState = status.state;
      }
      renderStatus();
      renderView();
      scheduleMapDraw();
      if (status.live) startEvents();
      else startPolling();
    } catch (error) {
      toast('Can\'t reach the server: ' + error.message, 'error');
      setTimeout(connect, 5000);
    }
  }

  init();
})();
