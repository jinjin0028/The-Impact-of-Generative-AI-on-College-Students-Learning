const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 模拟前测和后测数据的生成逻辑
// B组 (实验组) 应该在后测中有显著的提升
function generateMockData() {
    db.serialize(() => {
        for (let i = 1; i <= 50; i++) {
            const username = `mock_user_${String(i).padStart(3, '0')}`;
            const groupType = i % 2 === 0 ? 'B' : 'A'; // 平均分配 A组和 B组

            // 插入用户
            db.run(`INSERT INTO users (username, group_type) VALUES (?, ?)`, [username, groupType], function(err) {
                if (err) return console.error(err);
                const userId = this.lastID;

                // 模拟前测概念图数据 (A组和B组水平相近，都比较差)
                const preNodeCount = getRandomInt(2, 5);
                const preEdgeCount = getRandomInt(1, preNodeCount - 1);
                db.run(`INSERT INTO concept_maps (user_id, stage, map_data, node_count, edge_count) VALUES (?, 'pre', '{}', ?, ?)`, 
                    [userId, preNodeCount, preEdgeCount]);

                // 模拟聊天记录
                const chatCount = groupType === 'B' ? getRandomInt(3, 6) : getRandomInt(2, 4); // B组因为有可解释性，可能互动更多
                for (let c = 0; c < chatCount; c++) {
                    db.run(`INSERT INTO chat_logs (user_id, role, content) VALUES (?, 'user', '模拟提问')`, [userId]);
                    db.run(`INSERT INTO chat_logs (user_id, role, content) VALUES (?, 'assistant', '模拟回答')`, [userId]);
                }

                // 模拟后测概念图数据
                let postNodeCount, postEdgeCount;
                if (groupType === 'B') {
                    // B组 (实验组) 提升明显
                    postNodeCount = preNodeCount + getRandomInt(4, 8);
                    postEdgeCount = preEdgeCount + getRandomInt(4, postNodeCount); // 关系数增加更多，体现深度理解
                } else {
                    // A组 (控制组) 提升一般
                    postNodeCount = preNodeCount + getRandomInt(1, 4);
                    postEdgeCount = preEdgeCount + getRandomInt(1, postNodeCount - 1);
                }

                db.run(`INSERT INTO concept_maps (user_id, stage, map_data, node_count, edge_count) VALUES (?, 'post', '{}', ?, ?)`, 
                    [userId, postNodeCount, postEdgeCount]);
            });
        }
    });
    
    console.log("✅ 成功插入 50 个模拟用户的测试数据 (包含用户、前测、后测、聊天记录)！");
}

generateMockData();