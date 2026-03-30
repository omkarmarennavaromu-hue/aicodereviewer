// api/review.js - Vercel serverless function for AI Code Reviewer
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only POST requests are accepted'
    });
  }

  try {
    const { code, language } = req.body;

    // Validate input
    if (!code || !language) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Both "code" and "language" are required'
      });
    }

    // Check if API key is configured
    const apiKey = process.env.QWEN_API_KEY;
    if (!apiKey) {
      console.error('QWEN_API_KEY is not configured');
      return res.status(500).json({
        error: 'API key not configured',
        errors: '⚠️ Server configuration error: API key missing.',
        explanation: 'Please contact the administrator to set up the Qwen API key.',
        corrected: code,
        tips: 'API key configuration is required for code review.'
      });
    }

    // Build the prompt for Qwen
    const prompt = `You are a strict programming teacher.

The student wrote code in: ${language}

Analyze the code and return ONLY valid JSON in this format:
{
  "errors": "...",
  "explanation": "...",
  "corrected": "...",
  "tips": "..."
}

Explain in simple beginner-friendly words.

Student Code:
\`\`\`${language.toLowerCase()}
${code}
\`\`\`

Return ONLY the JSON object, no other text, no markdown formatting.`;

    // Prepare request to Qwen API
    const requestBody = {
      model: "qwen-turbo",
      input: {
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      },
      parameters: {
        result_format: "message",
        temperature: 0.3,
        max_tokens: 2000
      }
    };

    // Call Qwen API
    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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
        tips: 'Check your code and try again. If the problem persists, contact support.'
      });
    }

    const data = await response.json();
    
    // Extract the assistant's reply
    let assistantMessage = data?.output?.text;
    
    if (!assistantMessage) {
      throw new Error('No response content from Qwen API');
    }

    // Clean the response by removing markdown code blocks if present
    let cleanedJson = assistantMessage.trim();
    
    // Remove ```json or ``` blocks
    cleanedJson = cleanedJson.replace(/```json\s*/g, '');
    cleanedJson = cleanedJson.replace(/```\s*/g, '');
    
    // Find first { and last }
    const firstBrace = cleanedJson.indexOf('{');
    const lastBrace = cleanedJson.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
    }
    
    // Parse the JSON
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
    
    // Return successful response
    return res.status(200).json(reviewResult);
    
  } catch (error) {
    console.error('Server error:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      errors: '⚠️ An unexpected error occurred while processing your request.',
      explanation: 'The server encountered an error. Please try again later.',
      corrected: req.body?.code || '',
      tips: 'If this error persists, please contact support.'
    });
  }
}
