/**
 * EcoSmart Vision AI Module (Google Gemini)
 * Analyzes recyclable waste photos using Google Gemini Vision API.
 * Uses native Node 22 fetch without external dependencies.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const PILOT_CATEGORIES = [
  { id: 'cardboard', name: 'Cardboard', hints: 'boxes, packaging, corrugated paper' },
  { id: 'pet_plastic_bottles', name: 'PET Plastic Bottles', hints: 'clear or tinted beverage bottles, water bottles, soda bottles' },
  { id: 'aluminium', name: 'Aluminium', hints: 'beverage cans, clean food cans, foil, aluminium scrap' },
  { id: 'brass', name: 'Brass', hints: 'valves, fittings, fixtures, plumbing yellow metal scrap' },
  { id: 'glass', name: 'Glass', hints: 'glass bottles, jars, beverage glassware' }
];

export const PILOT_BENCHMARK_RATES = {
  cardboard: {
    ratePerKg: 150,
    exampleKg: 5,
    exampleTotal: 750,
    exampleText: '5kg of cardboard will fetch approx ₦750 (market rate: ₦150/kg)'
  },
  pet_plastic_bottles: {
    ratePerKg: 200,
    exampleKg: 5,
    exampleTotal: 1000,
    exampleText: '5kg of plastic will fetch approx ₦1,000 (market rate: ₦200/kg)'
  },
  aluminium: {
    ratePerKg: 750,
    exampleKg: 2,
    exampleTotal: 1500,
    exampleText: '2kg of aluminium cans will fetch approx ₦1,500 (market rate: ₦750/kg)'
  },
  brass: {
    ratePerKg: 2500,
    exampleKg: 1,
    exampleTotal: 2500,
    exampleText: '1kg of clean brass will fetch approx ₦2,500 (market rate: ₦2,500/kg)'
  },
  glass: {
    ratePerKg: 80,
    exampleKg: 10,
    exampleTotal: 800,
    exampleText: '10kg of glass bottles will fetch approx ₦800 (market rate: ₦80/kg)'
  }
};

/**
 * Extract clean base64 string and MIME type from data URL or raw base64.
 */
export function parseImagePayload(photoInput) {
  if (!photoInput || typeof photoInput !== 'string') return null;

  const dataUrlMatch = photoInput.match(/^data:([a-zA-Z0-9/+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1].toLowerCase(),
      base64Data: dataUrlMatch[2].trim()
    };
  }

  // Fallback if raw base64
  return {
    mimeType: 'image/jpeg',
    base64Data: photoInput.trim()
  };
}

/**
 * Analyze an uploaded waste photo using Gemini Vision.
 *
 * @param {Object} options
 * @param {string} options.photoFile - Data URL or base64 string
 * @param {string} [options.apiKey] - Gemini API Key (defaults to process.env.GEMINI_API_KEY)
 * @param {string} [options.model] - Model name (defaults to gemini-1.5-flash)
 * @param {Function} [options.fetchFn] - Custom fetch function for testing
 * @returns {Promise<Object>} Analysis result
 */
export async function analyzeWasteImage({
  photoFile,
  apiKey = process.env.GEMINI_API_KEY,
  model = DEFAULT_MODEL,
  fetchFn = globalThis.fetch
} = {}) {
  // 1. Check API Key
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return {
      ok: true,
      detected: false,
      detectedMaterialId: null,
      materialId: null,
      confidence: 'unavailable',
      material: null,
      isSupported: false,
      guidance: 'Gemini API key is not configured. Select your material category manually.'
    };
  }

  // 2. Validate Image Data
  const parsed = parseImagePayload(photoFile);
  if (!parsed || !parsed.base64Data || parsed.base64Data.length < 50) {
    return {
      ok: true,
      detected: false,
      detectedMaterialId: null,
      materialId: null,
      confidence: 'unavailable',
      material: null,
      isSupported: false,
      guidance: 'No valid image data provided for analysis. Please select the category manually.'
    };
  }

  // 3. Build Prompt
  const prompt = `You are the AI waste classifier for EcoSmart, an open marketplace for recyclables.
Examine this image and identify the primary recyclable material shown.

Active pilot material categories:
1. "cardboard": Cardboard packaging, shipping boxes, clean carton boards.
2. "pet_plastic_bottles": PET plastic bottles (drinking water bottles, soda bottles, clear plastic jugs).
3. "aluminium": Aluminium beverage cans, aluminium food containers, clean scrap aluminium.
4. "brass": Yellow brass metal fittings, pipes, valves, keys, plumbing hardware.
5. "glass": Glass bottles, jars, beverage glass containers.

If the item is NOT one of these 5 pilot categories (e.g. food waste, hazardous materials, electronics, plastic bags, mixed unrecyclable trash, textiles), classify as "unsupported".

Respond ONLY with a valid JSON object matching this schema:
{
  "detectedMaterialId": "cardboard" | "pet_plastic_bottles" | "aluminium" | "brass" | "glass" | "unsupported",
  "confidence": "high" | "medium" | "low",
  "description": "Short 1-sentence description of the item seen",
  "recyclabilityTips": "1-sentence practical instruction for preparing this material (e.g. rinse, crush, remove lids)"
}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: parsed.mimeType,
              data: parsed.base64Data
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json'
    }
  };

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        ok: true,
        detected: false,
        detectedMaterialId: null,
        materialId: null,
        confidence: 'unavailable',
        material: null,
        isSupported: false,
        guidance: `Vision service returned HTTP ${response.status}. Please select the material category manually.`
      };
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      return {
        ok: true,
        detected: false,
        detectedMaterialId: null,
        materialId: null,
        confidence: 'unavailable',
        material: null,
        isSupported: false,
        guidance: 'Could not detect material in image. Please select the category manually.'
      };
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(candidateText);
    } catch {
      return {
        ok: true,
        detected: false,
        detectedMaterialId: null,
        materialId: null,
        confidence: 'unavailable',
        material: null,
        isSupported: false,
        guidance: 'Unable to parse AI response. Please select the category manually.'
      };
    }

    const detectedId = parsedResult.detectedMaterialId;
    const isPilot = PILOT_CATEGORIES.some(c => c.id === detectedId);
    const isUnsupported = detectedId === 'unsupported';

    if (isPilot) {
      const matched = PILOT_CATEGORIES.find(c => c.id === detectedId);
      const rateInfo = PILOT_BENCHMARK_RATES[detectedId];
      return {
        ok: true,
        detected: true,
        detectedMaterialId: detectedId,
        materialId: detectedId,
        confidence: parsedResult.confidence || 'medium',
        material: matched.name,
        isSupported: true,
        description: parsedResult.description || `Detected ${matched.name}`,
        guidance: parsedResult.recyclabilityTips || `Confirmed as ${matched.name}.`,
        estimatedRatePerKg: rateInfo?.ratePerKg || null,
        estimatedValueTip: rateInfo?.exampleText || null,
        benchmarkInfo: rateInfo || null
      };
    } else if (isUnsupported) {
      return {
        ok: true,
        detected: true,
        detectedMaterialId: 'unsupported',
        materialId: 'unsupported',
        confidence: parsedResult.confidence || 'medium',
        material: 'Non-pilot material',
        isSupported: false,
        description: parsedResult.description || 'Non-pilot item detected',
        guidance: parsedResult.recyclabilityTips || 'This item does not match our current pilot materials. You may still record feedback.'
      };
    } else {
      return {
        ok: true,
        detected: false,
        detectedMaterialId: null,
        materialId: null,
        confidence: 'low',
        material: null,
        isSupported: false,
        guidance: 'Item classification uncertain. Please select the category manually.'
      };
    }
  } catch (err) {
    return {
      ok: true,
      detected: false,
      detectedMaterialId: null,
      materialId: null,
      confidence: 'unavailable',
      material: null,
      isSupported: false,
      guidance: 'Vision service timeout or network error. Please select your material category manually.'
    };
  }
}
