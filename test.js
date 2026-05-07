const axios = require('axios');
const prompt = `你是一个高可解释性的教育助手。你的回答必须严格按照以下 JSON 格式输出，并且不要包含任何 Markdown 代码块标签（如 \`\`\`json ）。
{
  "reasoning_steps": ["步骤1...", "步骤2..."],
  "references": [{"id": 1, "source": "来源名称"}],
  "final_answer": "你的核心回答文本...",
  "glossary": {"专业术语": "通俗解释"},
  "confidence_score": 0.95,
  "confidence_label": "High",
  "limitations": ["局限性1..."]
}`;
axios.post('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
  model: 'ecnu-plus',
  messages: [
    {role: 'system', content: prompt},
    {role: 'user', content: '什么是工作记忆'}
  ]
}, {
  headers: {
    'Authorization': 'Bearer sk-f96eb5b1678a4996b56381c2b37cf4b0',
    'Content-Type': 'application/json'
  }
}).then(res => console.log(res.data.choices[0].message.content)).catch(err => console.error(err.response ? err.response.data : err.message));