const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = require('node-fetch');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Qwen API configuration
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

// System prompt for Qwen
const SYSTEM_PROMPT = `You are a strict programming teacher.

Analyze the student's code thoroughly and provide feedback.

Return ONLY valid JSON in this format:
{
  "errors": "...",
  "explanation": "...",
  "corrected": "...",
  "tips": "..."
}

Rules:
- errors: List syntax errors, logical errors, or runtime issues. If none, say "No syntax errors detected."
- explanation: Explain why the code has problems in simple terms for beginners
- corrected: Provide the corrected version of the code with fixes applied
- tips: Share best practices, optimization tips, and learning suggestions

Keep explanations beginner-friendly and encouraging.`;

// Helper function to clean JSON response from Qwen
function cleanJsonResponse(text) {
  // Remove markdown code blocks if present
  let cleaned = text.trim();
  
  // Remove ```json or ``` blocks
  cleaned = cleaned.replace(/```json\s*/g, '');
  cleaned = cleaned.replace(/```\s*/g, '');
  
  // Find first { and last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  
  return cleaned;
}

// POST endpoint: /review
app.post('/review', async (req, res) => {
  try {
    const { code, language } = req.body;
    
    // Validate input
    if (!code || !language) {
      return res.status(400).json({
        error: 'Missing required fields: code and language are required'
      });
    }
    
    // Check if API key is configured
    if (!QWEN_API_KEY) {
      console.error('QWEN_API_KEY is not set in environment variables');
      return res.status(500).json({
        error: 'API key not configured',
        errors: '⚠️ Server configuration error: API key missing.',
        explanation: 'Please contact the administrator to set up the Qwen API key.',
        corrected: code,
        tips: 'API key configuration is required for code review.'
      });
    }
    
    // Construct the user prompt
    const userPrompt = `Language: ${language}\n\nStudent Code:\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\`\n\nAnalyze this code and provide feedback in the specified JSON format.`;
    
    // Prepare request to Qwen API
    const requestBody = {
      model: 'qwen-plus', // Using qwen-plus for good balance of speed and quality
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.3, // Lower temperature for more consistent JSON output
      max_tokens: 2000
    };
    
    // Call Qwen API
    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Qwen API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Failed to get review from AI service',
        errors: '⚠️ Unable to analyze code at this moment.',
        explanation: 'The AI review service encountered an error. Please try again later.',
        corrected: code,
        tips: 'Check your internet connection and try again.'
      });
    }
    
    const data = await response.json();
    
    // Extract the assistant's reply
    const assistantMessage = data.choices[0]?.message?.content;
    
    if (!assistantMessage) {
      throw new Error('No response content from Qwen API');
    }
    
    // Clean and parse JSON
    const cleanedJson = cleanJsonResponse(assistantMessage);
    let reviewResult;
    
    try {
      reviewResult = JSON.parse(cleanedJson);
      
      // Validate that all required fields exist
      if (!reviewResult.errors) reviewResult.errors = 'No specific errors identified.';
      if (!reviewResult.explanation) reviewResult.explanation = 'The code was analyzed but no detailed explanation was generated.';
      if (!reviewResult.corrected) reviewResult.corrected = code;
      if (!reviewResult.tips) reviewResult.tips = 'Keep practicing and writing clean code!';
      
    } catch (parseError) {
      console.error('Failed to parse Qwen response:', assistantMessage);
      console.error('Parse error:', parseError);
      
      // Fallback response if parsing fails
      reviewResult = {
        errors: '⚠️ Could not parse AI response, but here\'s a basic review.',
        explanation: 'The AI generated a response that couldn\'t be formatted properly. Your code has been reviewed.',
        corrected: code,
        tips: 'Consider checking your code for common errors: syntax, logic, and best practices.'
      };
    }
    
    // Send successful response
    res.json(reviewResult);
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Internal server error',
      errors: '⚠️ An unexpected error occurred.',
      explanation: 'The server encountered an error while processing your request.',
      corrected: req.body?.code || '',
      tips: 'Please try again later or contact support if the issue persists.'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'AI Code Reviewer server is running',
    apiConfigured: !!QWEN_API_KEY
  });
});

// Root endpoint for basic info
app.get('/', (req, res) => {
  res.json({
    name: 'AI Code Reviewer API',
    version: '1.0.0',
    endpoints: {
      review: 'POST /review',
      health: 'GET /health'
    },
    status: 'running'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AI Code Reviewer server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 Review endpoint: http://localhost:${PORT}/review`);
  console.log(`🔑 Qwen API key ${QWEN_API_KEY ? '✓ configured' : '✗ NOT configured'}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
