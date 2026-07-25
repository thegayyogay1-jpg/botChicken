const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 👥 1. กระเป๋าเงินจำลอง
let mockUsersWallets = {
    "U2fb9233e5c539ae3970cbd698e2e18db": { // 👈 อย่าลืมเปลี่ยนเป็น UID ของน้าหากต้องการเพิ่มเครดิตเข้าไอดีนี้
        name: "น้า (ผู้ทดสอบ)",
        balance: 100
    }
};

// 📝 2. กล่องเก็บรายการใบสั่งฝากเงินจำลอง (ในแรม)
let depositOrders = []; 

// ฟังก์ชันล้างใบสั่งฝากเงินที่หมดอายุ (เกิน 5 นาที)
function cleanExpiredOrders() {
    const now = Date.now();
    depositOrders = depositOrders.filter(order => order.expireAt > now);
}

// 📡 LINE Webhook
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    // ล้างใบฝากหมดอายุก่อนเริ่มทำงาน
    cleanExpiredOrders();

    for (let event of events) {
        const userMsg = event.message && event.message.text ? event.message.text.trim() : null;
        const replyToken = event.replyToken;
        const userId = event.source.userId;

        if (!userMsg) continue;

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

        // ==================== [ 🌟 สเต็ปที่ 1: ลูกค้าพิมพ์ "ฝาก XXX" ] ====================
        if (userMsg.startsWith('ฝาก')) {
            const amountMatch = userMsg.match(/ฝาก\s*([0-9]+)/);
            
            if (amountMatch) {
                const baseAmount = parseInt(amountMatch[1]); // ยอดเงินหลัก เช่น 500
                
                if (baseAmount < 10) {
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [{ "type": "text", "text": "❌ ระบบฝากขั้นต่ำ 10 บาทค่ะ" }]
                        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                    } catch (e) { console.error(e); }
                    continue;
                }

                // 🎲 สุ่มเศษสตางค์ .01 ถึง .99
                const randomSatang = Math.floor(Math.random() * 99) + 1; 
                const finalAmount = parseFloat(`${baseAmount}.${randomSatang < 10 ? '0' + randomSatang : randomSatang}`);

                // 🕒 สร้างเวลาหมดอายุ (5 นาทีนับจากนี้)
                const expireMinutes = 5;
                const expireAt = Date.now() + (expireMinutes * 60 * 1000);

                // 💾 บันทึกใบสั่งฝากชั่วคราวลงในแรม
                depositOrders.push({
                    userId: userId,
                    amount: finalAmount,
                    expireAt: expireAt
                });

                console.log(`📝 สร้างใบฝากเงินสำเร็จ: ยอด ${finalAmount} บาท สำหรับ UID: ${userId}`);

                // 💬 ยิงข้อความบอกยอดเศษสตางค์ให้ลูกค้าโอน
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "text",
                                "text": `💰 โอนเงินฝากเครดิต 💰\n\n⚠️ กรุณาโอนยอดเงินตรงเป๊ะ:\n👉 ${finalAmount} บาท 👈\n\n(ระบบจะเติมเครดิตให้อัตโนมัติทันที)\n⏳ ต้องโอนภายใน ${expireMinutes} นาทีเท่านั้นนะคะ!`
                            }
                        ]
                    }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                } catch (lineErr) {
                    console.error("❌ ยิงข้อความแจ้งยอดโอนล้มเหลว:", lineErr.message);
                }

            } else {
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ "type": "text", "text": "💡 กรุณาระบุจำนวนเงินที่ต้องการฝาก เช่น พิมพ์ว่า: ฝาก 500" }]
                    }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                } catch (e) { console.error(e); }
            }
            continue;
        }

        // ==================== [ 🌟 สเต็ปที่ 2: ดักแจ้งเตือนธนาคาร (KDeposit) และตรวจคู่ยอด ] ====================
        if (userMsg.startsWith('KDeposit')) {
            console.log(`🤖 บอทได้รับแจ้งเตือนธนาคาร: "${userMsg}"`);
            
            const match = userMsg.match(/([0-9]+\.[0-9]{2})/);
            if (match) {
                const bankAmount = parseFloat(match[1]); // ยอดที่ธนาคารแจ้งโอนเข้า
                console.log(`🔍 ค้นหาใบสั่งฝากในแรมที่ตรงกับยอด: ${bankAmount} บาท...`);

                const orderIndex = depositOrders.findIndex(order => order.amount === bankAmount);

                if (orderIndex !== -1) {
                    const matchedOrder = depositOrders[orderIndex];
                    const targetUserId = matchedOrder.userId;

                    // 💳 ทำการเติมเครดิตในแรม
                    if (mockUsersWallets[targetUserId]) {
                        mockUsersWallets[targetUserId].balance += bankAmount;
                        console.log(`✅ [จับคู่สำเร็จ] เติมเงินให้คุณ ${mockUsersWallets[targetUserId].name} จำนวน ${bankAmount} บาท!`);

                        // 💬 ส่งข้อความยินดีด้วยไปที่กลุ่มหลัก
                        try {
                            await axios.post('https://api.line.me/v2/bot/message/push', {
                                to: "Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // 👈 พอน้าได้ไอดีกลุ่มตัว C มาแล้ว เอามาเปลี่ยนตรงนี้แทนเลยครับน้า!
                                messages: [
                                    {
                                        "type": "text",
                                        "text": `🎉 ระบบได้รับยอดเงินโอน ${bankAmount} บาท เรียบร้อยแล้วค่ะ!\n👤 เติมเครดิตให้คุณ: ${mockUsersWallets[targetUserId].name}\n💳 เครดิตคงเหลือปัจจุบัน: ${mockUsersWallets[targetUserId].balance} บาท`
                                    }
                                ]
                            }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                        } catch (err) {
                            console.error("❌ ส่งข้อความ Push ยินดีด้วยล้มเหลว:", err.message);
                        }

                        // 🗑️ ลบใบสั่งฝากชิ้นนี้ออกจากแรม
                        depositOrders.splice(orderIndex, 1);

                    } else {
                        console.log(`⚠️ พบยอดโอนตรง แต่ UID ${targetUserId} ไม่มีกระเป๋าเงินจำลองรองรับ`);
                    }
                } else {
                    console.log(`❌ ไม่พบใบสั่งฝากเงินในระบบที่ตรงกับยอด ${bankAmount} บาท`);
                }
            }
            continue;
        }

    } // จบลูป event
    return res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('บอททดสอบระบบฝากเงินแบบเช็กเศษสตางค์ รันปกติจ้า'); });
app.listen(process.env.PORT || 3000, () => { console.log('Full-Flow Test Server is running...'); });
