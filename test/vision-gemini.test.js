import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImagePayload, analyzeWasteImage, PILOT_CATEGORIES } from '../vision.js';
import { createApp } from '../server.js';

const generatorDetails = {
  role: 'generator',
  name: 'Amaka Eze',
  email: 'amaka.vision@example.com',
  area: 'Ikeja, Lagos'
};

async function fixture(t, options = {}) {
  let time = Date.now();
  const messages = [];
  const provider = { configured: true, send: async (email, code) => { messages.push({ email, code }); return 'email_test'; }, ...options.provider };
  const app = createApp({ demoPayments: true, dbPath: ':memory:', now: () => time, ...options, provider, origin: 'http://localhost:3000' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.db.close(); });

  let cookie = '';
  async function request(path, data, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(x => x.split('=')));
    for (const item of response.headers.getSetCookie()) {
      const [key, value] = item.split(';')[0].split('=');
      jar[key] = value;
    }
    cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    return { status: response.status, data: await response.json(), headers: response.headers };
  }

  async function registerAndVerify(details) {
    await request('/api/register', details);
    const code = messages.at(-1)?.code;
    return await request('/api/verify', { code });
  }

  return { ...app, request, registerAndVerify, messages, advance: ms => time += ms };
}

test('parseImagePayload extracts base64 data and MIME types accurately', () => {
  const pngPayload = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
  const parsedPng = parseImagePayload(pngPayload);
  assert.equal(parsedPng.mimeType, 'image/png');
  assert.equal(parsedPng.base64Data, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');

  const jpegPayload = 'data:image/jpeg;base64,9j4AAQSkZJRgABAQEASABIAAD';
  const parsedJpeg = parseImagePayload(jpegPayload);
  assert.equal(parsedJpeg.mimeType, 'image/jpeg');
  assert.equal(parsedJpeg.base64Data, '9j4AAQSkZJRgABAQEASABIAAD');

  assert.equal(parseImagePayload(null), null);
  assert.equal(parseImagePayload(''), null);
});

test('analyzeWasteImage gracefully handles missing API key and invalid images', async () => {
  // Without API key
  const noKeyRes = await analyzeWasteImage({
    photoFile: 'data:image/jpeg;base64,abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    apiKey: ''
  });
  assert.equal(noKeyRes.detected, false);
  assert.equal(noKeyRes.confidence, 'unavailable');
  assert.match(noKeyRes.guidance, /manually/i);

  // With API key but empty image
  const emptyImgRes = await analyzeWasteImage({
    photoFile: '',
    apiKey: 'test-api-key'
  });
  assert.equal(emptyImgRes.detected, false);
  assert.equal(emptyImgRes.confidence, 'unavailable');
  assert.match(emptyImgRes.guidance, /manually/i);
});

test('analyzeWasteImage accurately parses Gemini AI responses for pilot materials', async () => {
  const mockFetchPet = async (url, options) => {
    assert.ok(url.includes('generativelanguage.googleapis.com'));
    assert.ok(options.body.includes('pet_plastic_bottles'));
    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      detectedMaterialId: 'pet_plastic_bottles',
                      confidence: 'high',
                      description: 'Crushed transparent plastic water bottle',
                      recyclabilityTips: 'Rinse, remove plastic cap, and compress bottle.'
                    })
                  }
                ]
              }
            }
          ]
        };
      }
    };
  };

  const petResult = await analyzeWasteImage({
    photoFile: 'data:image/jpeg;base64,mockValidBase64DataExceedingFiftyCharactersLength1234567890',
    apiKey: 'fake-test-key',
    fetchFn: mockFetchPet
  });

  assert.equal(petResult.ok, true);
  assert.equal(petResult.detected, true);
  assert.equal(petResult.detectedMaterialId, 'pet_plastic_bottles');
  assert.equal(petResult.confidence, 'high');
  assert.equal(petResult.material, 'PET Plastic Bottles');
  assert.equal(petResult.isSupported, true);
  assert.match(petResult.guidance, /compress bottle/i);
});

test('analyzeWasteImage handles non-pilot unsupported materials correctly', async () => {
  const mockFetchUnsupported = async () => ({
    ok: true,
    async json() {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    detectedMaterialId: 'unsupported',
                    confidence: 'high',
                    description: 'E-waste / damaged circuit board',
                    recyclabilityTips: 'Electronic waste is not accepted in this pilot phase.'
                  })
                }
              ]
            }
          }
        ]
      };
    }
  });

  const unsuppResult = await analyzeWasteImage({
    photoFile: 'data:image/jpeg;base64,mockValidBase64DataExceedingFiftyCharactersLength1234567890',
    apiKey: 'fake-test-key',
    fetchFn: mockFetchUnsupported
  });

  assert.equal(unsuppResult.detected, true);
  assert.equal(unsuppResult.detectedMaterialId, 'unsupported');
  assert.equal(unsuppResult.isSupported, false);
});

test('analyzeWasteImage handles Gemini HTTP errors and timeouts safely', async () => {
  const mockFetchError = async () => ({
    ok: false,
    status: 429,
    async text() { return 'Resource has been exhausted (e.g. check quota).'; }
  });

  const errResult = await analyzeWasteImage({
    photoFile: 'data:image/jpeg;base64,mockValidBase64DataExceedingFiftyCharactersLength1234567890',
    apiKey: 'fake-test-key',
    fetchFn: mockFetchError
  });

  assert.equal(errResult.detected, false);
  assert.equal(errResult.confidence, 'unavailable');
  assert.match(errResult.guidance, /manually/i);
});

test('End-to-End API: Generator intake-analyze endpoint integrates with Vision module', async t => {
  const mockVisionAnalyzer = async ({ photoFile }) => {
    return {
      ok: true,
      detected: true,
      detectedMaterialId: 'aluminium',
      materialId: 'aluminium',
      confidence: 'high',
      material: 'Aluminium',
      isSupported: true,
      description: 'Crushed soft drink beverage can',
      guidance: 'Rinse can thoroughly and flatten before collection.'
    };
  };

  const app = await fixture(t, { visionAnalyzer: mockVisionAnalyzer });
  const verified = await app.registerAndVerify(generatorDetails);
  assert.equal(verified.status, 200);

  const res = await app.request('/api/generator/intake-analyze', {
    photoFile: 'data:image/jpeg;base64,sampleCanImage'
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.detected, true);
  assert.equal(res.data.detectedMaterialId, 'aluminium');
  assert.equal(res.data.confidence, 'high');
  assert.match(res.data.guidance, /Rinse can/i);
});
