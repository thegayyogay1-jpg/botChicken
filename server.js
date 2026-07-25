const express = require('express');
const app = express();
app.use(express.json());

// ฐานข้อมูลจำลอง (จำในแรม)
let usersWallets = {}; 
let nextMemberId = 1;  
let isRoundOpen = false;
let roundBets = {}; 

// ตัวแปรพักข้อมูลผลไพ่
let pendingResults = null; 

// 👑 [ตั้งค่าแอดมิน] ใส่ LINE USER ID ของแอดมิน
const ADMIN_LIST = [
    "U0d1e353091d90af57b37ff38d36e29bc"
]; 

// ค่าน้ำ / ค่าต๋ง สำหรับระบบตีไก่ (เช่น 0.05 = หัก 5% จากยอดกำไร)
const COMMISSION_RATE = 0.05;

// ฟังก์ชั่นคำนวณแต้มและเด้ง
function parseCard(cardStr) {
    if (!cardStr) return { score: 0, deng: 1 };
    let str = cardStr.trim().toLowerCase();
    let isDeng = false;
    if (str.startsWith('d')) {
        isDeng = true;
        str = str.substring(1);
    }
    const specialChars = ['t', 'j', 'q', 'k'];
    
    // ไพ่คู่ตัวอักษรพิเศษ (เช่น TJ, QK) ให้เป็น 7.5 แต้ม
    if (str.length === 2 && specialChars.includes(str[0]) && specialChars.includes(str[1])) {
        return { score: 7.5, deng: isDeng ? 2 : 1 };
    }
    const getVal = (c) => specialChars.includes(c) ? 0 : parseInt(c);
    if (str.length === 2) {
        let score = (getVal(str[0]) + getVal(str[1])) % 10;
        return { score: score, deng: isDeng ? 2 : 1 };
    }
    return { score: 0, deng: 1 };
}

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId;
            const originalMsg = event.message.text.trim();
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, '');
            
            let replyMessageObject = null; 
            const isAdmin = ADMIN_LIST.includes(userId);

            // 🧽 [คำสั่งแอดมิน] ล้างระบบ
            if (userMsg === 'ล้างระบบ') {
                if (!isAdmin) {
                    replyMessageObject = { type: 'text', text: "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ" };
                } else {
                    usersWallets = {}; nextMemberId = 1; isRoundOpen = false; roundBets = {}; pendingResults = null;
                    replyMessageObject = { type: 'text', text: "👑 [แอดมิน] ♻️ ล้างระบบสมาชิกเริ่มต้นใหม่เรียบร้อยแล้วครับ!" };
                }
            }

            // ลงทะเบียนสมาชิกใหม่อัตโนมัติ
            else {
                if (!usersWallets[userId]) {
                    usersWallets[userId] = { 
                        memberNumber: nextMemberId,
                        memberTitle: `สมาชิกที่ ${nextMemberId}`,
                        name: "ผู้เล่นทั่วไป", 
                        balance: 0,
                        isLockWithdraw: false,
                        pendingWithdrawAmount: 0
                    };
                    nextMemberId++;
                }
                
                const user = usersWallets[userId];
                const mentionText = `👤 ${user.memberTitle} `;

                // ดึงชื่อเล่นชั่วคราว
                if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                    let firstMention = event.message.mention.mentions[0];
                    if (firstMention.userId === userId) {
                        let parts = originalMsg.split(/\s+/);
                        let rawName = parts.find(p => p.includes('@'));
                        if (rawName) user.name = rawName.replace('@', '').trim();
                    }
                }

                // ==========================================
                // PART 1: ระบบเติมเงิน / ถอนเงิน / เช็กยอด
                // ==========================================
                if (originalMsg.startsWith('เติม')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        let targetUserId = null;
                        let amount = 0;
                        const moneyMatch = originalMsg.match(/\d+$/);
                        if (moneyMatch) amount = parseInt(moneyMatch[0]);

                        let cleanText = originalMsg.replace('เติม', '').trim();
                        if (moneyMatch) cleanText = cleanText.substring(0, cleanText.lastIndexOf(moneyMatch[0])).trim();
                        let searchKeyword = cleanText.replace('@', '').trim().toLowerCase().replace(/\s+/g, '');

                        if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                            targetUserId = event.message.mention.mentions[0].userId;
                        } else if (searchKeyword) {
                            for (let uid in usersWallets) {
                                let u = usersWallets[uid];
                                if (u.memberTitle.toLowerCase().replace(/\s+/g, '') === searchKeyword || u.memberNumber.toString() === searchKeyword || u.name.toLowerCase().replace(/\s+/g, '').includes(searchKeyword)) {
                                    targetUserId = uid;
                                    break;
                                }
                            }
                        }

                        if (!targetUserId || isNaN(amount) || amount <= 0) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ เติมเงินไม่สำเร็จ\n📌 รูปแบบ: **เติม [เลขสมาชิก] [จำนวนเงิน]**` };
                        } else {
                            usersWallets[targetUserId].balance += amount;
                            let tUser = usersWallets[targetUserId];
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ✅ เติมเงินสำเร็จ! +${amount} บาท ให้แก่ ${tUser.memberTitle}\n💰 ยอดเงินคงเหลือ: ${tUser.balance} บาท` };
                        }
                    }
                }
                else if (userMsg.startsWith('ถอน')) {
                    if (user.isLockWithdraw) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ ไม่สามารถแจ้งถอนซ้ำได้! มีรายการถอนค้างอยู่ ${user.pendingWithdrawAmount} บาท` };
                    } else {
                        const amount = parseInt(userMsg.replace('ถอน', ''));
                        if (!isNaN(amount) && amount > 0) {
                            if (user.balance < amount) {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยอดเงินในระบบไม่พอ (มีอยู่ ${user.balance} บ.)` };
                            } else {
                                user.isLockWithdraw = true;
                                user.pendingWithdrawAmount = amount;
                                replyMessageObject = {
                                    type: 'text',
                                    text: `🔔 [ระบบรับเรื่องแจ้งถอน]\n👤 ${user.memberTitle}\n💰 ยอดที่ต้องการถอน: **${amount}** บาท\n🔒 Status: ล็อกกระเป๋าชั่วคราว`
                                };
                            }
                        }
                    }
                }
                else if (originalMsg.startsWith('Y ') || originalMsg.startsWith('y ')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน` };
                    } else {
                        const parts = originalMsg.trim().split(/\s+/);
                        let memberNum = parts[1] ? parseInt(parts[1]) : 0;
                        let targetUserId = null;

                        for (let uid in usersWallets) {
                            if (usersWallets[uid].memberNumber === memberNum) {
                                targetUserId = uid;
                                break;
                            }
                        }

                        if (!targetUserId) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ ไม่พบสมาชิกเลขนี้` };
                        } else {
                            const targetUser = usersWallets[targetUserId];
                            if (!targetUser.isLockWithdraw || targetUser.pendingWithdrawAmount <= 0) {
                                replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ สมาชิกไม่ได้แจ้งถอนค้างไว้` };
                            } else {
                                let amount = targetUser.pendingWithdrawAmount;
                                targetUser.balance -= amount;
                                targetUser.isLockWithdraw = false;
                                targetUser.pendingWithdrawAmount = 0;
                                replyMessageObject = { 
                                    type: 'text', 
                                    text: `👑 [แอดมิน] ✅ อนุมัติถอนสำเร็จ!\n👤 สมาชิกที่ ${targetUser.memberNumber}\n📉 หักยอด: -${amount} บาท\n💰 ยอดคงเหลือ: ${targetUser.balance} บาท` 
                                };
                            }
                        }
                    }
                }
                else if (userMsg === 'c') {
                    replyMessageObject = { type: 'text', text: `👤 ${user.memberTitle}\n💰 ยอดเงินคงเหลือ: ${user.balance} บาท` };
                }

                // ==========================================
                // PART 2: เปิด/ปิด/คืน โพยระบบตีไก่
                // ==========================================
                else if (userMsg === 'o') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        isRoundOpen = true; roundBets = {}; pendingResults = null;
                        replyMessageObject = { type: 'text', text: "🟢 [ระบบตีไก่] เปิดรับเดิมพันรอบใหม่แล้ว! ส่งโพยขาที่ต้องการลงได้เลย" };
                    }
                }
                else if (userMsg === 'x') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        if (!isRoundOpen) {
                            replyMessageObject = { type: 'text', text: "⚠️ รอบเดิมพันปิดอยู่แล้ว" };
                        } else {
                            isRoundOpen = false;
                            let summary = "🔴 [ระบบตีไก่] ปิดรับเดิมพันแล้ว!\n📋 [รายการขาที่ลงแข่ง]:\n";
                            let hasData = false;
                            for (let uid in roundBets) {
                                summary += `▪️ ${usersWallets[uid].memberTitle}: ลงขา [${Object.keys(roundBets[uid].khasDetails).join(', ')}] ยอดเดิมพันขาละ ${roundBets[uid].betPerKha} บ.\n`;
                                hasData = true;
                            }
                            if (!hasData) summary += "❌ ไม่มีใครลงเดิมพันในรอบนี้\n";
                            replyMessageObject = { type: 'text', text: summary + `\n⏳ รอแอดมินสรุปผลไพ่ เช่น 'ผล: 53,d8,11,k9'` };
                        }
                    }
                }
                else if (userMsg === 'r') {
                    if (user.isLockWithdraw) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ กระเป๋าโดนล็อก` };
                    } else if (!isRoundOpen) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ ปิดรอบไปแล้ว ยกเลิกไม่ได้` };
                    } else if (!roundBets[userId]) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่มีโพยในรอบนี้` };
                    } else {
                        const savedBet = roundBets[userId];
                        user.balance += savedBet.holding; 
                        delete roundBets[userId]; 
                        replyMessageObject = { type: 'text', text: `${mentionText} 🔄 คืนโพยตีไก่เรียบร้อย!\n💰 ยอดเงินคงเหลือ: ${user.balance} บาท` };
                    }
                }

                // ==========================================
                // PART 3: รับโพยระบบตีไก่ (รูปแบบ: ขา-จำนวนเงิน เช่น 123-100 หรือ 1-100)
                // ==========================================
                else {
                    const lines = originalMsg.split('\n');
                    let isBetMessage = false;
                    
                    for (let line of lines) {
                        let cleanLine = line.toLowerCase().replace(/\s+/g, '');
                        if (cleanLine.includes('-') && !cleanLine.startsWith('ผล:')) {
                            isBetMessage = true;
                            break;
                        }
                    }

                    if (isBetMessage) {
                        if (user.isLockWithdraw) {
                            replyMessageObject = { type: 'text', text: `${mentionText} ❌ ไม่สามารถแทงได้! กระเป๋าถูกล็อกชั่วคราว` };
                        } else if (!isRoundOpen) {
                            replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยังไม่เปิดรอบ!` };
                        } else {
                            // ในระบบตีไก่ ให้ผู้เล่นเลือกจอง "ขา"
                            // รูปแบบ: 1-100 (แทงขา 1 ยอด 100) หรือ 123-100 (แทงขา 1,2,3 ขาละ 100)
                            let newKhasList = [];
                            let betPerKha = 0;

                            for (let line of lines) {
                                let cleanLine = line.toLowerCase().replace(/\s+/g, '');
                                if (cleanLine.includes('-')) {
                                    let parts = cleanLine.split('-');
                                    if (parts.length === 2 && !isNaN(parts[1])) {
                                        let rawKhas = parts[0].split('').map(Number);
                                        let invalidCheck = rawKhas.some(k => k < 1 || k > 10 || isNaN(k)); // รองรับได้สูงสุด 10 ขา
                                        if (!invalidCheck) {
                                            newKhasList.push(...rawKhas);
                                            betPerKha = parseInt(parts[1]);
                                        }
                                    }
                                }
                            }

                            if (newKhasList.length > 0 && betPerKha > 0) {
                                // ขาตีไก่คิดค้ำประกันเบื้องต้น = ยอดแทง x 2 (เด้ง) x (จำนวนขาที่เปิดได้สูงสุดสมมุติ 5 ขา หรือคิดตามจริง)
                                // เพื่อความปลอดภัย กำหนดค้ำประกัน = ยอดแทง * 4 Per Leg
                                let totalLegsCount = newKhasList.length;
                                let requiredHolding = (betPerKha * totalLegsCount) * 4; 

                                if (user.balance < requiredHolding) {
                                    replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยอดเงินไม่พอค้ำประกันระบบตีไก่!\n💡 ต้องมีเงินค้ำประกันอย่างน้อย ${requiredHolding} บาท` };
                                } else {
                                    if (!roundBets[userId]) {
                                        roundBets[userId] = { betPerKha: betPerKha, holding: 0, khasDetails: {} };
                                    }

                                    newKhasList.forEach(k => {
                                        roundBets[userId].khasDetails[k] = true;
                                    });

                                    roundBets[userId].holding += requiredHolding;
                                    user.balance -= requiredHolding;

                                    replyMessageObject = { 
                                        type: 'text', 
                                        text: `${mentionText} 🐓 [รับโพยตีไก่สำเร็จ]\n📌 ขาที่เลือก: ${newKhasList.join(', ')}\n💵 เดิมพันขาละ: ${betPerKha} บ.\n🔒 หักค้ำประกัน: ${requiredHolding} บ.\n💳 ยอดเงินคงเหลือ: ${user.balance} บาท` 
                                    };
                                }
                            } else {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ รูปแบบโพยไม่ถูกต้อง! พิมพ์เช่น: 123-100 (แทงขา 1,2,3 ขาละ 100 บาท)` };
                            }
                        }
                    }
                }

                // ==========================================
                // PART 4: ส่งผลไพ่ตีไก่ (พิมพ์ ผล: ไพ่ขา1,ไพ่ขา2,ไพ่ขา3,...)
                // ==========================================
                if (originalMsg.startsWith('ผล:') || originalMsg.startsWith('ผล ')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        const resultStr = originalMsg.replace(/^ผล:\s*|^ผล\s+/i, '');
                        const results = resultStr.split(','); 

                        pendingResults = { results };
                        let previewText = `🐓 [ตรวจผลไพ่ระบบตีไก่]\n------------------------\n`;
                        
                        for (let i = 0; i < results.length; i++) {
                            let legNum = i + 1;
                            let cardRes = parseCard(results[i]);
                            previewText += `🔹 ขา ${legNum}: ${cardRes.score} แต้ม (${cardRes.deng} เด้ง)\n`;
                        }

                        replyMessageObject = { type: 'text', text: previewText + `\n📢 หากถูกต้องพิมพ์ **OK** เพื่อคิดเงินชนไพ่ทุกคู่` };
                    }
                }

                // ==========================================
                // PART 5: คำนวณเงินระบบตีไก่ (Round-Robin ทุกขาชนกันเอง)
                // ==========================================
                else if (userMsg === 'ok') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else if (!pendingResults) {
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ⚠️ ไม่มีผลไพ่ค้างในระบบ` };
                    } else {
                        let { results } = pendingResults;
                        
                        // สร้าง Object เก็บไพ่แต่ละขา
                        let parsedCards = {};
                        for (let i = 0; i < results.length; i++) {
                            parsedCards[i + 1] = parseCard(results[i]);
                        }

                        let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้งตีไก่ - ทุกขาชนกัน]\n------------------------\n`;

                        // วนลูปคิดเงินผู้เล่นแต่ละคน
                        for (let uid in roundBets) {
                            let savedBet = roundBets[uid];
                            let pUser = usersWallets[uid];
                            let totalNetWinLoss = 0;
                            let legReportText = "";

                            // ดึงขาที่ผู้เล่นคนนี้ลงไว้
                            let myLegs = Object.keys(savedBet.khasDetails).map(Number);

                            for (let myLeg of myLegs) {
                                let myCard = parsedCards[myLeg];
                                if (!myCard) continue;

                                let legWinLoss = 0;

                                // ชนกับขาอื่นๆ ทุกขาที่มีผลไพ่เปิดอยู่
                                for (let oppLeg in parsedCards) {
                                    oppLeg = parseInt(oppLeg);
                                    if (myLeg === oppLeg) continue; // ไม่ชนกับตัวเอง

                                    let oppCard = parsedCards[oppLeg];
                                    let bet = savedBet.betPerKha;

                                    if (myCard.score > oppCard.score) {
                                        // ชนะ
                                        let winAmt = bet * myCard.deng;
                                        let profit = winAmt * (1 - COMMISSION_RATE); // หักค่าน้ำ
                                        legWinLoss += profit;
                                    } else if (myCard.score < oppCard.score) {
                                        // แพ้
                                        let loseAmt = bet * oppCard.deng;
                                        legWinLoss -= loseAmt;
                                    }
                                    // เสมอ = 0
                                }

                                totalNetWinLoss += legWinLoss;
                                let sign = legWinLoss >= 0 ? `+${legWinLoss.toFixed(0)}` : `${legWinLoss.toFixed(0)}`;
                                legReportText += `   ▪️ ขา ${myLeg} (${myCard.score} แต้ม): ${sign} บ.\n`;
                            }

                            // คืนเงินค้ำประกัน + ผลบวกลบสุทธิ
                            let finalReturn = savedBet.holding + totalNetWinLoss;
                            pUser.balance += finalReturn;

                            let overallSign = totalNetWinLoss >= 0 ? `+${totalNetWinLoss.toFixed(0)}` : `${totalNetWinLoss.toFixed(0)}`;
                            summaryText += `👤 ${pUser.memberTitle}:\n${legReportText}   🏆 ผลรวมรอบนี้: **${overallSign} บาท**\n   💳 ยอดเงินคงเหลือล่าสุด: ${pUser.balance} บาท\n------------------------\n`;
                        }

                        replyMessageObject = { type: 'text', text: summaryText + `✨ เคลียร์ยอดตีไก่เรียบร้อย! พิมพ์ O เพื่อเริ่มรอบใหม่` };
                        roundBets = {}; 
                        pendingResults = null; 
                    }
                }
                else if (userMsg === 'no') {
                    if (isAdmin) {
                        pendingResults = null; 
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] 🛑 ยกเลิกผลไพ่แล้ว สามารถส่งผลไพ่ใหม่ได้เลย` };
                    }
                }
            }

            // ส่งข้อความกลับ LINE
            if (replyMessageObject) {
                try {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken: replyToken,
                            messages: [replyMessageObject]
                        })
                    });
                } catch (err) {
                    console.error('Error:', err);
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot Cockfight-Pokdeng is Online!'));
app.listen(process.env.PORT || 3000);
