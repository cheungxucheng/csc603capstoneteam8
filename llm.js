/**
 * ============================================================================
 * Study Spark — LLM & RAG Integration Service (Hugging Face)
 * ============================================================================
 * 
 * This module connects Study Spark's chat interface to Large Language Models
 * (LLMs) via the Hugging Face Inference API. It receives student questions,
 * injects retrieved course passages into the prompt context (Retrieval-Augmented
 * Generation / RAG), and generates helpful pedagogical responses.
 * 
 * ----------------------------------------------------------------------------
 * HOW TO CONFIGURE YOUR HUGGING FACE TOKEN:
 * ----------------------------------------------------------------------------
 * 1. Create a free account at https://huggingface.co
 * 2. Generate a User Access Token with 'read' permissions at:
 *    https://huggingface.co/settings/tokens
 * 3. (If using Llama models): Visit the model page on Hugging Face (e.g.
 *    https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct) and click
 *    "Acknowledge license" to gain access.
 * 4. Create a `.env` file in the project root (see `.env.example`) and set:
 *    HUGGINGFACE_API_TOKEN=hf_your_token_here
 *    HUGGINGFACE_MODEL=meta-llama/Llama-3.2-3B-Instruct
 * ============================================================================
 */

// Recommended models available on Hugging Face Serverless / Router API:
// - 'meta-llama/Llama-3.2-3B-Instruct' (Fast, lightweight, great for instruction following)
// - 'meta-llama/Meta-Llama-3-8B-Instruct' (Higher quality reasoning, requires accepted license)
// - 'mistralai/Mistral-7B-Instruct-v0.3' (High quality open weights model)
// - 'HuggingFaceH4/zephyr-7b-beta' (No gated access needed, good fallback)
const DEFAULT_MODEL = 'meta-llama/Llama-3.2-3B-Instruct';

// Hugging Face standard OpenAI-compatible Chat Completions Router Endpoint:
const HF_CHAT_ROUTER_URL = 'https://router.huggingface.co/hf-inference/v1/chat/completions';

// Alternative Serverless Inference Endpoint (per-model):
// https://api-inference.huggingface.co/models/${modelId}

/**
 * Retrieve Hugging Face API token from environment variables
 */
function getHfToken() {
  return (
    process.env.HUGGINGFACE_API_TOKEN ||
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_ACCESS_TOKEN ||
    ''
  ).trim();
}

/**
 * Get the target Hugging Face model identifier
 */
function getHfModel() {
  return (process.env.HUGGINGFACE_MODEL || DEFAULT_MODEL).trim();
}

/**
 * Format retrieved document passages into a clean prompt context block for the LLM
 * 
 * @param {Array<{document: string, text: string, score: number}>} passages 
 * @returns {string} Formatted context string
 */
function formatCourseContext(passages) {
  if (!passages || passages.length === 0) {
    return 'No specific course material matches were found for this query.';
  }

  return passages
    .map((passage, idx) => {
      const docTitle = passage.document || `Document ${idx + 1}`;
      const relevance = passage.score ? `(Relevance: ${Math.round(passage.score * 100)}%)` : '';
      return `[Passage ${idx + 1} | Source: "${docTitle}" ${relevance}]\n${passage.text.trim()}`;
    })
    .join('\n\n');
}

/**
 * Assemble the system prompt that defines the AI Study Partner persona and RAG guidelines.
 * 
 * TO CUSTOMIZE PROMPT BEHAVIOR:
 * - Modify the persona instructions below to change tone (e.g. Socratic vs direct answers).
 * - Adjust citation rules to require explicit quote matching.
 */
function buildSystemPrompt(formattedContext) {
  return `You are Study Spark, an encouraging, patient, and knowledgeable AI study partner and teaching assistant.
Your goal is to help students truly understand concepts, connect ideas, and prepare for exams—not merely memorize answers.

You are provided with relevant excerpts from the student's uploaded course materials below.

================ COURSE MATERIALS CONTEXT ================
${formattedContext}
==========================================================

GUIDELINES FOR YOUR RESPONSE:
1. Ground your explanation primarily in the provided course materials whenever relevant.
2. Break down complex biological/scientific ideas into digestible steps or intuitive analogies.
3. If the answer cannot be found in the provided excerpts, draw upon your general knowledge to give a correct educational explanation, but politely mention that this specific topic wasn't detailed in their uploaded notes.
4. Conclude your explanation with a quick thought exercise or practice question to test the student's understanding.
5. Keep your tone supportive, academic, and engaging.`;
}

/**
 * Primary LLM Generation function.
 * Receives the student query, retrieved document passages, and optional conversation history,
 * then calls the Hugging Face Inference API.
 * 
 * If no Hugging Face API token is provided or if the remote API fails (e.g. rate limit / model loading),
 * it returns a structured fallback response and logs instructional guidance.
 * 
 * @param {Object} options
 * @param {string} options.message - The student's latest question
 * @param {Array} options.retrievedPassages - Array of retrieved passage objects
 * @param {Array} [options.conversationHistory] - Previous messages in this study session
 * @returns {Promise<{answer: string, citations: Array, followUp: string, provider: string, demo?: boolean}>}
 */
async function generateStudySparkResponse({ message, retrievedPassages = [], conversationHistory = [] }) {
  const token = getHfToken();
  const model = getHfModel();
  const formattedContext = formatCourseContext(retrievedPassages);
  const systemPrompt = buildSystemPrompt(formattedContext);

  // --------------------------------------------------------------------------
  // Check if Hugging Face token is present
  // --------------------------------------------------------------------------
  if (!token) {
    console.warn('\n[StudySpark LLM] ================================================');
    console.warn('[StudySpark LLM] Hugging Face Access Token is NOT configured.');
    console.warn('[StudySpark LLM] To enable live LLM inference with Llama:');
    console.warn('[StudySpark LLM] 1. Create an access token at https://huggingface.co/settings/tokens');
    console.warn('[StudySpark LLM] 2. Add HUGGINGFACE_API_TOKEN=hf_... in your .env file');
    console.warn('[StudySpark LLM] Returning simulated RAG response based on retrieved passages.');
    console.warn('[StudySpark LLM] ================================================\n');

    return generateSimulatedRAGResponse(message, retrievedPassages);
  }

  // --------------------------------------------------------------------------
  // Build OpenAI-compatible chat messages array for Hugging Face Router
  // --------------------------------------------------------------------------
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Include recent conversation history if provided (up to last 4 messages for context window efficiency)
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-4);
    for (const msg of recent) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Add the current user prompt
  messages.push({ role: 'user', content: message });

  // --------------------------------------------------------------------------
  // Execute call to Hugging Face API
  // --------------------------------------------------------------------------
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // 45s timeout for cold starts

    console.log(`[StudySpark LLM] Calling Hugging Face model: ${model}...`);

    const response = await fetch(HF_CHAT_ROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,        // Creativity vs consistency (0.0 = deterministic, 1.0 = creative)
        max_tokens: 600,         // Limit generation length for concise, focused study answers
        top_p: 0.9
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    // If Hugging Face returns an error status (e.g. 401 Unauthorized, 403 Forbidden, 503 Model Loading)
    if (!response.ok) {
      const errText = await response.text();
      let parsedErr = {};
      try { parsedErr = JSON.parse(errText); } catch (_) {}

      console.error(`[StudySpark LLM] Hugging Face API returned status ${response.status}:`, parsedErr.error || errText);

      // Handle common Hugging Face response cases
      if (response.status === 401 || response.status === 403) {
        console.error('[StudySpark LLM] Check that your HUGGINGFACE_API_TOKEN is valid and that you have requested access to the gated model (e.g. meta-llama).');
      } else if (response.status === 503) {
        console.warn('[StudySpark LLM] Model is currently loading on Hugging Face infrastructure. Retrying shortly or using fallback.');
      }

      // Fallback gracefully so the UI never breaks for the user
      const fallback = generateSimulatedRAGResponse(message, retrievedPassages);
      fallback.warning = `Hugging Face API returned ${response.status}: ${parsedErr.error || 'Check server logs for token/model permissions'}`;
      return fallback;
    }

    const data = await response.json();
    const generatedAnswer = data?.choices?.[0]?.message?.content?.trim();

    if (!generatedAnswer) {
      throw new Error('Hugging Face response contained empty choices');
    }

    console.log('[StudySpark LLM] Successfully received response from Hugging Face model!');

    return {
      answer: generatedAnswer,
      citations: retrievedPassages.slice(0, 3),
      followUp: 'Would you like to explore an example or try a practice question on this?',
      provider: `huggingface:${model}`,
      demo: false
    };

  } catch (error) {
    console.error('[StudySpark LLM] Network or execution error calling Hugging Face:', error.message);
    const fallback = generateSimulatedRAGResponse(message, retrievedPassages);
    fallback.warning = `LLM call failed (${error.message}). Showing simulated answer from retrieved notes.`;
    return fallback;
  }
}

/**
 * Fallback response generator that synthesizes the retrieved passages when
 * HF_API_TOKEN is not yet set or when external API requests cannot be completed.
 */
function generateSimulatedRAGResponse(prompt, retrievedPassages) {
  let passageContext = '';
  if (retrievedPassages && retrievedPassages.length > 0) {
    passageContext = retrievedPassages[0].text;
  } else {
    passageContext = 'Selective transport, membrane potentials, and cellular energy expenditure are foundational concepts in cellular biology.';
  }

  const answer = `Based on your course materials:

${passageContext}

Here is the key takeaway for “${prompt}”:
1. Focus on the core mechanism: identify whether energy (ATP) is required or if substances move passively down their concentration gradient.
2. Structure your study: relate this concept back to how cells maintain internal homeostasis.

[Note: To enable live Llama inference, set your HUGGINGFACE_API_TOKEN in your environment or .env file.]`;

  return {
    answer,
    citations: retrievedPassages.slice(0, 2),
    followUp: 'Would you like to try a practice question or review another topic?',
    provider: 'local-rag-simulator',
    demo: true
  };
}

module.exports = {
  generateStudySparkResponse,
  formatCourseContext,
  buildSystemPrompt,
  getHfToken,
  getHfModel,
  DEFAULT_MODEL
};
