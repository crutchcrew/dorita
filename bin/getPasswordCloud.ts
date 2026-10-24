#!/usr/bin/env bun

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.log(
    'Usage: bun run get-password-cloud <iRobot username> <iRobot password> [Gigya API Key]',
  );
  process.exit();
}

const apiKeyOverride = process.argv[4] || process.env.GIGYA_API_KEY;
const countryCode = process.env.IROBOT_COUNTRY_CODE || 'US';
const discoveryUrl =
  process.env.IROBOT_DISCOVERY_URL ||
  'https://disc-prod.iot.irobotapi.com/v1/discover/endpoints?country_code=' + countryCode;

interface Endpoints {
  apiKey: string;
  gigyaBase: string;
  httpBase: string;
}

interface JsonResponse {
  statusCode: number;
  body: any;
}

// fetch() that parses JSON bodies and never throws on HTTP error statuses.
async function request(
  uri: string,
  options: { form?: Record<string, string>; json?: unknown } = {},
): Promise<JsonResponse> {
  const init: RequestInit = { method: 'GET', headers: { Accept: 'application/json' } };
  if (options.form) {
    init.method = 'POST';
    init.body = new URLSearchParams(options.form);
  } else if (options.json) {
    init.method = 'POST';
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.json);
  }

  const res = await fetch(uri, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { statusCode: res.status, body };
}

function fail(message: string, detail: unknown): never {
  console.log(message);
  console.log(detail);
  process.exit(1);
}

function pickHttpBase(deployments: Record<string, { httpBase?: string }>): string | null {
  const keys = Object.keys(deployments || {})
    .toSorted()
    .toReversed();
  for (const key of keys) {
    const dep = deployments[key];
    if (dep?.httpBase) return dep.httpBase;
  }
  return null;
}

async function getEndpoints(): Promise<Endpoints> {
  if (apiKeyOverride && process.env.GIGYA_BASE && process.env.IROBOT_HTTP_BASE) {
    return {
      apiKey: apiKeyOverride,
      gigyaBase: process.env.GIGYA_BASE,
      httpBase: process.env.IROBOT_HTTP_BASE,
    };
  }

  const response = await request(discoveryUrl);
  if (response.statusCode >= 400) throw response.body || response;

  const body = response.body || {};
  const gigya = body.gigya || {};
  const apiKey = apiKeyOverride || gigya.api_key;
  const datacenter = gigya.datacenter_domain;
  const gigyaBase =
    process.env.GIGYA_BASE ||
    (datacenter ? 'https://accounts.' + datacenter : 'https://accounts.us1.gigya.com');
  const httpBase =
    process.env.IROBOT_HTTP_BASE ||
    pickHttpBase(body.deployments || {}) ||
    body.httpBase ||
    'https://unauth2.prod.iot.irobotapi.com';

  if (!apiKey) throw new Error('No Gigya API key in discovery response');
  return { apiKey, gigyaBase, httpBase };
}

async function main(): Promise<void> {
  let endpoints: Endpoints;
  try {
    endpoints = await getEndpoints();
  } catch (error) {
    fail(
      'Fatal error discovering iRobot endpoints. Please check your network or override env vars.',
      error,
    );
  }

  let gigyaResponse: JsonResponse;
  try {
    gigyaResponse = await request(endpoints.gigyaBase + '/accounts.login', {
      form: {
        apiKey: endpoints.apiKey,
        targetenv: 'mobile',
        loginID: username!,
        password: password!,
        format: 'json',
        targetEnv: 'mobile',
      },
    });
  } catch (error) {
    fail(
      'Fatal error login into Gigya API. Please check your credentials or Gigya API Key.',
      error,
    );
  }

  const { statusCode } = gigyaResponse;
  const body = gigyaResponse.body;
  if (statusCode === 401 || statusCode === 403) {
    fail('Authentication error. Check your credentials.', gigyaResponse);
  } else if (statusCode === 400) {
    fail('Error login into Gigya API.', gigyaResponse);
  } else if (statusCode !== 200) {
    console.log('Unespected response. Checking again...');
    return;
  }

  if (body?.statusCode === 403) fail('Authentication error. Please check your credentials.', body);
  if (body?.statusCode === 400) fail('Error login into Gigya API.', body);
  if (
    !(
      body?.statusCode === 200 &&
      body.errorCode === 0 &&
      body.UID &&
      body.UIDSignature &&
      body.signatureTimestamp &&
      body.sessionInfo?.sessionToken
    )
  ) {
    fail('Error login into iRobot account. Missing fields in login response.', body);
  }

  let robots: Record<string, { name: string; sku: string; softwareVer: string; password: string }>;
  try {
    const login = await request(endpoints.httpBase + '/v2/login', {
      json: {
        app_id: 'ANDROID-C7FB240E-DF34-42D7-AE4E-A8C17079A294',
        assume_robot_ownership: 0,
        gigya: {
          signature: body.UIDSignature,
          timestamp: body.signatureTimestamp,
          uid: body.UID,
        },
      },
    });
    robots = login.body?.robots;
    if (!robots) throw login.body;
  } catch (error) {
    fail('Fatal error login into iRobot account. Please check your credentials or API Key.', error);
  }

  console.log('Found ' + Object.keys(robots).length + ' robot(s)!');
  for (const [blid, robot] of Object.entries(robots)) {
    console.log(
      'Robot "' + robot.name + '" (sku: ' + robot.sku + ' SoftwareVer: ' + robot.softwareVer + '):',
    );
    console.log('BLID=> ' + blid);
    console.log('Password=> ' + robot.password + ' <= Yes, all this string.');
    console.log('');
  }
  console.log('Use this credentials in dorita980 lib :)');
}

await main();
