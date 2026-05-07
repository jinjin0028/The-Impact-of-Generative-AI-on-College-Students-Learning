require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');
const { Parser } = require('json2csv');
const jStat = require('jstat');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. 初始化数据库
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Database opening error: ', err);
});

db.serialize(() => {
    // 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        group_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 聊天记录表
    db.run(`CREATE TABLE IF NOT EXISTS chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        role TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // 概念图测试记录表 (新增)
    db.run(`CREATE TABLE IF NOT EXISTS concept_maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        stage TEXT, -- 'pre' (前测) 或 'post' (后测)
        map_data TEXT, -- JSON 字符串 (包含 nodes 和 edges)
        node_count INTEGER,
        edge_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

// 2. 路由：用户登录与分组分配
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row) {
            // 已存在用户
            res.json({ id: row.id, username: row.username, group_type: row.group_type });
        } else {
            // 新用户，随机分配 A 或 B 组
            const groupType = Math.random() < 0.5 ? 'A' : 'B';
            db.run(`INSERT INTO users (username, group_type) VALUES (?, ?)`, [username, groupType], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id: this.lastID, username, group_type: groupType });
            });
        }
    });
});

// 3. 路由：获取用户当前实验状态 (是否已完成前测、后测)
app.get('/api/user-status/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all(`SELECT stage FROM concept_maps WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const stages = rows.map(r => r.stage);
        res.json({ 
            preDone: stages.includes('pre'), 
            postDone: stages.includes('post') 
        });
    });
});

// 4. 路由：保存概念图数据
app.post('/api/concept-map', (req, res) => {
    const { userId, stage, mapData, nodeCount, edgeCount } = req.body;
    db.run(`INSERT INTO concept_maps (user_id, stage, map_data, node_count, edge_count) VALUES (?, ?, ?, ?, ?)`,
        [userId, stage, JSON.stringify(mapData), nodeCount, edgeCount],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// 5. 路由：处理 LLM 聊天请求
app.post('/api/chat', async (req, res) => {
    const { userId, message, groupType } = req.body;
    
    // 记录用户消息
    db.run(`INSERT INTO chat_logs (user_id, role, content) VALUES (?, ?, ?)`, [userId, 'user', message]);

    try {
        let systemPrompt = "你是一个教育助手，帮助学生学习心理学和教育学概念。";

        if (groupType === 'B') {
            systemPrompt = `你是一个高可解释性的教育助手。你的回答必须严格按照以下 JSON 格式输出，并且不要包含任何 Markdown 代码块标签（如 \`\`\`json ）。
{
  "reasoning_steps": ["步骤1...", "步骤2..."],
  "references": [{"id": 1, "source": "来源名称"}],
  "final_answer": "你的核心回答文本...",
  "glossary": {"专业术语": "通俗解释"},
  "confidence_score": 0.95,
  "confidence_label": "High",
  "limitations": ["局限性1..."]
}`;
        }

        // 调用 ECNU API
        console.log(`[API Request] URL: ${process.env.ECNU_BASE_URL}/chat/completions`);
        console.log(`[API Request] Model: ${process.env.MODEL_NAME || "ecnu-plus"}`);
        console.log(`[API Request] Key length: ${process.env.ECNU_API_KEY ? process.env.ECNU_API_KEY.length : 0}`);
        
        const response = await axios.post(
            `${process.env.ECNU_BASE_URL}/chat/completions`,
            {
                model: process.env.MODEL_NAME || "ecnu-plus",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.ECNU_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000 // 增加超时时间到 60 秒
            }
        );

        let aiContent = response.data.choices[0].message.content;

        // 如果是 B 组，确保清洗并解析 JSON
        let finalResponse = aiContent;
        if (groupType === 'B') {
            try {
                // 清理可能带有的 markdown json 标记
                const cleanJson = aiContent.replace(/```json\n?|\n?```/g, '').trim();
                finalResponse = JSON.parse(cleanJson);
            } catch (e) {
                console.error("JSON parsing error:", e, aiContent);
                // 降级处理
                finalResponse = {
                    reasoning_steps: ["无法解析推理过程"],
                    references: [],
                    final_answer: aiContent,
                    glossary: {},
                    confidence_score: 0.8,
                    confidence_label: "Medium",
                    limitations: ["格式解析异常"]
                };
            }
        }

        // 记录 AI 回答
        db.run(`INSERT INTO chat_logs (user_id, role, content) VALUES (?, ?, ?)`, 
            [userId, 'assistant', typeof finalResponse === 'string' ? finalResponse : JSON.stringify(finalResponse)]);

        res.json({ reply: finalResponse });
    } catch (apiError) {
      console.error("====== 大模型 API 调用失败 ======");
      if (apiError.response) {
        // 请求已发出，但服务器响应的状态码不在 2xx 范围内
        console.error("Status:", apiError.response.status);
        console.error("Data:", JSON.stringify(apiError.response.data, null, 2));
      } else if (apiError.request) {
        // 请求已发出，但没有收到响应（网络问题、DNS问题等）
        console.error("No response received. The request was:", apiError.request._currentUrl || "Unknown URL");
        console.error("Message:", apiError.message);
      } else {
        // 在设置请求时发生了一些触发错误的事情
        console.error("Error Message:", apiError.message);
      }
      console.error("=================================");
      
      return res.status(500).json({ error: 'AI 服务暂时不可用，请稍后再试。' });
    }
});

// 6. 路由：导出分析数据 (CSV格式)
app.get('/api/export', (req, res) => {
    // 联合查询用户表和概念图表，计算前测和后测的节点与关系数量差值
    const query = `
        SELECT 
            u.id as user_id, 
            u.username, 
            u.group_type,
            MAX(CASE WHEN c.stage = 'pre' THEN c.node_count END) as pre_node_count,
            MAX(CASE WHEN c.stage = 'post' THEN c.node_count END) as post_node_count,
            MAX(CASE WHEN c.stage = 'pre' THEN c.edge_count END) as pre_edge_count,
            MAX(CASE WHEN c.stage = 'post' THEN c.edge_count END) as post_edge_count,
            (MAX(CASE WHEN c.stage = 'post' THEN c.node_count END) - MAX(CASE WHEN c.stage = 'pre' THEN c.node_count END)) as node_growth,
            (MAX(CASE WHEN c.stage = 'post' THEN c.edge_count END) - MAX(CASE WHEN c.stage = 'pre' THEN c.edge_count END)) as edge_growth
        FROM users u
        LEFT JOIN concept_maps c ON u.id = c.user_id
        GROUP BY u.id
        ORDER BY u.id ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        try {
            const fields = ['user_id', 'username', 'group_type', 'pre_node_count', 'post_node_count', 'node_growth', 'pre_edge_count', 'post_edge_count', 'edge_growth'];
            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(rows);
            
            res.header('Content-Type', 'text/csv; charset=utf-8');
            // 添加 BOM 使 Excel 能正确识别 UTF-8
            res.header('Content-Disposition', 'attachment; filename="experiment_analysis_data.csv"');
            res.send('\uFEFF' + csv);
        } catch (error) {
            res.status(500).json({ error: 'Failed to generate CSV' });
        }
    });
});

// 获取在线分析数据 API
app.get('/api/analysis-data', (req, res) => {
  const query = `
    SELECT 
      u.id as user_id,
      u.username,
      u.group_type,
      c_pre.node_count as pre_node_count,
      c_post.node_count as post_node_count,
      (c_post.node_count - c_pre.node_count) as node_growth,
      c_pre.edge_count as pre_edge_count,
      c_post.edge_count as post_edge_count,
      (c_post.edge_count - c_pre.edge_count) as edge_growth
    FROM users u
    LEFT JOIN concept_maps c_pre ON u.id = c_pre.user_id AND c_pre.stage = 'pre'
    LEFT JOIN concept_maps c_post ON u.id = c_post.user_id AND c_post.stage = 'post'
    WHERE c_pre.id IS NOT NULL AND c_post.id IS NOT NULL
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '数据库查询失败' });
    }

    const groupA = rows.filter(r => r.group_type === 'A');
    const groupB = rows.filter(r => r.group_type === 'B');

    // 提取增量数据
    const aNodeGrowth = groupA.map(r => r.node_growth);
    const bNodeGrowth = groupB.map(r => r.node_growth);
    const aEdgeGrowth = groupA.map(r => r.edge_growth);
    const bEdgeGrowth = groupB.map(r => r.edge_growth);

    // 计算均值
    const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    // T检验函数
    const tTest = (arr1, arr2) => {
      if (arr1.length < 2 || arr2.length < 2) return { pValue: null };
      const pVal = jStat.ttest(tStat(arr1, arr2), arr1.length + arr2.length - 2, 2);
      return { pValue: pVal };
    };

    const tStat = (arr1, arr2) => {
        const mean1 = jStat.mean(arr1);
        const mean2 = jStat.mean(arr2);
        const var1 = jStat.variance(arr1, true);
        const var2 = jStat.variance(arr2, true);
        const n1 = arr1.length;
        const n2 = arr2.length;
        const pooledVar = ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2);
        const se = Math.sqrt(pooledVar * (1 / n1 + 1 / n2));
        return (mean1 - mean2) / se;
    }

    const result = {
      summary: {
        total_users: rows.length,
        group_a_count: groupA.length,
        group_b_count: groupB.length
      },
      stats: {
        node_growth: {
          mean_A: mean(aNodeGrowth),
          mean_B: mean(bNodeGrowth),
          t_test: tTest(aNodeGrowth, bNodeGrowth)
        },
        edge_growth: {
          mean_A: mean(aEdgeGrowth),
          mean_B: mean(bEdgeGrowth),
          t_test: tTest(aEdgeGrowth, bEdgeGrowth)
        }
      },
      raw_data: {
        group_a: {
            node_growth: aNodeGrowth,
            edge_growth: aEdgeGrowth
        },
        group_b: {
            node_growth: bNodeGrowth,
            edge_growth: bEdgeGrowth
        }
      }
    };

    res.json(result);
  });
});

// 获取分析数据明细 API
app.get('/api/data-details', (req, res) => {
  const query = `
    SELECT 
      u.id as user_id,
      u.username,
      u.group_type,
      c_pre.node_count as pre_node_count,
      c_post.node_count as post_node_count,
      (c_post.node_count - c_pre.node_count) as node_growth,
      c_pre.edge_count as pre_edge_count,
      c_post.edge_count as post_edge_count,
      (c_post.edge_count - c_pre.edge_count) as edge_growth
    FROM users u
    LEFT JOIN concept_maps c_pre ON u.id = c_pre.user_id AND c_pre.stage = 'pre'
    LEFT JOIN concept_maps c_post ON u.id = c_post.user_id AND c_post.stage = 'post'
    WHERE c_pre.id IS NOT NULL AND c_post.id IS NOT NULL
    ORDER BY u.id DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '数据库查询失败' });
    }
    res.json(rows);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});