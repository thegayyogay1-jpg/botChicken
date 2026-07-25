const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 📝 2. กล่องเก็บรายการใบสั่งฝากเงินจำลอง (ในแรม)
let depositOrders = []; 

// 📡 LINE Webhook
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

        // ==================== [ 🛠️ คำสั่งพิเศษสำหรับขอ ID กลุ่ม และ UID ] ====================
        if (userMsg === "ขอไอดี") {
            let replyText = "";
            
            // 1. เช็กว่าพิมพ์ในกลุ่มไหม ถ้าพิมพ์ในกลุ่มให้ดึง Group ID ออกมา
            if (event.source.type === 'group') {
                replyText += `👥 ไอดีกลุ่มนี้คือ:\n👉 ${event.source.groupId}\n\n`;
            } else {
                replyText += `👤 อันนี้พิมพ์ในแชทส่วนตัว ไม่ใช่กลุ่มจ้า\n\n`;
            }
            
            // 2. แถม UID ส่วนตัวของน้าไปให้ด้วยเลย
            replyText += `👤 ไอดีของคุณ (UID):\n👉 ${userId}`;

            // 3. สั่งให้บอทยิงตอบกลับ
            try {
                await axios.post('https://api.line.me/v2/bot/message/reply', {
                    replyToken: replyToken,
                    messages: [{ "type": "text", "text": replyText }]
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${TOKEN}`
                    }
                });
            } catch (e) { console.error("❌ ส่งข้อความคำสั่งขอไอดีล้มเหลว:", e.message); }
            continue; // ทำงานจบแล้วข้ามไปอีเวนต์ถัดไป
        }
    return res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('บอททดสอบระบบฝากเงินแบบเช็กเศษสตางค์ รันปกติจ้า'); });
app.listen(process.env.PORT || 3000, () => { console.log('Full-Flow Test Server is running...'); });
