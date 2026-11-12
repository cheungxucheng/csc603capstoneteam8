/**
 * ============================================================================
 * OwlChemy — LLM & RAG Integration Service (Groq & Hugging Face)
 * ============================================================================
 * 
 * Connects OwlChemy's teaching assistant interface to Large Language Models (LLMs).
 * Injects retrieved course document passages into the prompt context (RAG),
 * enforces Socratic and pedagogical guidance, and manages live provider inference.
 * ============================================================================
 */

// Supported high-speed models on Groq Cloud
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const GROQ_FALLBACK_MODELS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

// Hugging Face models
const DEFAULT_HF_MODEL = process.env.HUGGINGFACE_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

// Endpoint URLs
const GROQ_ROUTER_URL = 'https://api.groq.com/openai/v1/chat/completions';
const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';

function getGroqKey() {
  return (process.env.GROQ_API_KEY || '').trim();
}

function getHfToken() {
  return (
    process.env.HUGGINGFACE_API_TOKEN ||
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_ACCESS_TOKEN ||
    ''
  ).trim();
}

/**
 * Format retrieved document passages into a clean prompt context block for the LLM
 */
function formatCourseContext(passages) {
  if (!passages || passages.length === 0) {
    return 'No specific course material matches were found for this query in the student notes.';
  }

  return passages
    .map((passage, idx) => {
      const docTitle = passage.document || `Document ${idx + 1}`;
      const chunkNum = passage.chunkIndex !== undefined ? ` (Chunk #${passage.chunkIndex + 1})` : '';
      const relevance = passage.score ? ` [Match Confidence: ${Math.round(passage.score * 100)}%]` : '';
      return `[Passage ${idx + 1} | Source: "${docTitle}"${chunkNum}${relevance}]\n${passage.text.trim()}`;
    })
    .join('\n\n');
}

/**
 * Assemble the system prompt defining the OwlChemy AI study tutor persona
 */
function buildSystemPrompt(formattedContext) {
  return `You are OwlChemy, an insightful, patient, and encouraging AI study partner and tutor.
Your mission is academic alchemy: turning raw study materials, lecture notes, and student questions into deep understanding and exam-ready mastery.

You are provided with relevant excerpts retrieved from the student's uploaded course materials below.

================ COURSE MATERIALS CONTEXT ================
${formattedContext}
==========================================================

TUTORING GUIDELINES:
1. Ground your explanation primarily in the provided course materials whenever relevant.
2. Structure your explanation cleanly:
   - Start with an intuitive, plain-language concept summary (use an analogy where helpful).
   - Walk through the core mechanism or biological/scientific steps clearly.
   - Mention the specific course document source if referenced.
3. If the question extends beyond the excerpts, provide an accurate educational answer, but kindly note that this was not in their uploaded notes.
4. Conclude your response with a quick thought exercise or a practice question to help the student test their recall.
5. Maintain a wise, encouraging, and collaborative tone.`;
}

/**
 * Primary LLM Generation function.
 * 
 * Supports:
 * - Groq Cloud (Free high-speed models: qwen/qwen3.8-27b, openai/gpt-oss-120b, openai/gpt-oss-20b)
 * - Hugging Face Router
 * - Fallback RAG simulator when tokens/credits are absent
 * 
 * @param {Object} options
 * @param {string} options.message - The student's latest question
 * @param {Array} options.retrievedPassages - Array of retrieved passage objects
 * @param {Array} [options.conversationHistory] - Previous messages in this study session
 * @returns {Promise<{answer: string, citations: Array, followUp: string, provider: string, demo?: boolean}>}
 */
async function generateOwlChemyResponse({ message, retrievedPassages = [], conversationHistory = [] }) {
  const groqKey = getGroqKey();
  const hfToken = getHfToken();
  const formattedContext = formatCourseContext(retrievedPassages);
  const systemPrompt = buildSystemPrompt(formattedContext);

  // Build OpenAI-compatible chat messages array
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-4);
    for (const msg of recent) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  messages.push({ role: 'user', content: message });

  // 1. Try Groq Cloud if API key is provided
  if (groqKey) {
    const modelsToTry = [DEFAULT_GROQ_MODEL, ...GROQ_FALLBACK_MODELS.filter(m => m !== DEFAULT_GROQ_MODEL)];

    for (const modelName of modelsToTry) {
      try {
        console.log(`[OwlChemy LLM] Calling Groq Cloud model "${modelName}"...`);
        const res = await callOpenAiCompatibleChat({
          url: GROQ_ROUTER_URL,
          token: groqKey,
          model: modelName,
          messages
        });

        if (res.ok) {
          console.log(`[OwlChemy LLM] Successfully received response from Groq ("${modelName}")!`);
          return {
            answer: res.content,
            citations: retrievedPassages.slice(0, 3),
            followUp: 'Would you like to try a practice question on this topic?',
            provider: `groq:${modelName}`,
            demo: false
          };
        }

        console.warn(`[OwlChemy LLM] Groq model "${modelName}" returned status ${res.status}: ${res.errorText}`);

        // If it's an authentication error, don't retry models
        if (res.status === 401 || res.status === 403) {
          break;
        }

      } catch (err) {
        console.warn(`[OwlChemy LLM] Groq request error for "${modelName}":`, err.message);
      }
    }
  }

  // 2. Try Hugging Face Router if token is provided
  if (hfToken) {
    console.log(`[OwlChemy LLM] Calling Hugging Face model "${DEFAULT_HF_MODEL}" via ${HF_ROUTER_URL}...`);

    try {
      const res = await callOpenAiCompatibleChat({
        url: HF_ROUTER_URL,
        token: hfToken,
        model: DEFAULT_HF_MODEL,
        messages
      });

      if (res.ok) {
        console.log(`[OwlChemy LLM] Successfully received response from Hugging Face model "${DEFAULT_HF_MODEL}"!`);
        return {
          answer: res.content,
          citations: retrievedPassages.slice(0, 3),
          followUp: 'Would you like to try a practice question or explore another concept?',
          provider: `huggingface:${DEFAULT_HF_MODEL}`,
          demo: false
        };
      }

      console.error(`[OwlChemy LLM] Hugging Face returned status ${res.status}: ${res.errorText}`);

    } catch (err) {
      console.error('[OwlChemy LLM] Network error calling Hugging Face:', err.message);
    }
  }

  // 3. Fallback simulator if neither provider returned a response
  if (!groqKey && !hfToken) {
    console.warn('\n[OwlChemy LLM] No LLM API Key configured in .env. Falling back to simulated RAG response.');
  }

  return generateSimulatedRAGResponse(message, retrievedPassages);
}

/**
 * Generic caller for OpenAI-compatible chat completions APIs
 */
async function callOpenAiCompatibleChat({ url, token, model, messages }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 650,
        top_p: 0.9
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      let parsedErr = {};
      try { parsedErr = JSON.parse(errText); } catch (_) {}
      const errMsg = parsedErr.error?.message || parsedErr.error || parsedErr.message || errText;
      return { ok: false, status: response.status, errorText: errMsg };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    return { ok: true, content };

  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 0, errorText: err.message };
  }
}

/**
 * Fallback response generator that synthesizes the retrieved passages when
 * external API requests cannot be completed.
 */
function generateSimulatedRAGResponse(prompt, retrievedPassages) {
  let passageSnippet = '';
  let sourceDoc = 'Course materials';

  if (retrievedPassages && retrievedPassages.length > 0) {
    passageSnippet = retrievedPassages[0].text;
    sourceDoc = retrievedPassages[0].document || sourceDoc;
  } else {
    passageSnippet = 'Selective transport, membrane potentials, and cellular energy expenditure are foundational concepts in cellular biology.';
  }

  const answer = `Based on your course materials in "${sourceDoc}":

${passageSnippet}

Here is how OwlChemy breaks down “${prompt}”:
1. Core Mechanism: Identify whether energy (ATP) is required or if substances move passively down their concentration gradient.
2. Big Picture: Connect this mechanism to how cells maintain internal homeostasis despite external fluctuations.

✦ Check your understanding: If you placed a cell in pure water (a hypotonic solution), which direction would water move, and why?`;

  return {
    answer,
    citations: retrievedPassages.slice(0, 2),
    followUp: 'Would you like to answer the practice question or review another topic?',
    provider: 'local-rag-simulator',
    demo: true
  };
}

module.exports = {
  generateOwlChemyResponse,
  generateStudySparkResponse: generateOwlChemyResponse,
  formatCourseContext,
  buildSystemPrompt,
  getHfToken,
  getGroqKey,
  DEFAULT_MODEL: DEFAULT_GROQ_MODEL
};
